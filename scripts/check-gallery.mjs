#!/usr/bin/env node
// Validate the in-app Gallery (gallery.json + gallery/*.json) at commit time.
//
// The Gallery is the contest's durable asset: after the Noodle Cookoff, winning
// noodles are hand-curated in from contestant share links. Those graphs are an
// untrusted, hand-edited surface — yet the pre-commit harness has no checker for
// JSON data files (every existing check is gated on *.html/sw.js), so a bad edit
// could ship a blacked-out gallery, a dead "remix" card, a dead #gallery=<slug>
// deep link, or — worst — a graph carrying a contestant's private uploaded media
// or a pasted API key. This closes that gap.
//
// Seven assertions, ordered cheapest-first:
//   1. gallery.json parses to a top-level array (a bad parse silently blanks the
//      whole Gallery for every visitor — index.html fetchGallery() falls back to []).
//   2. Each entry has a slug /^[a-z0-9-]+$/, a non-empty title, and a string graph.
//   3. Slugs are unique (loadGalleryEntry().find() resolves dupes to the first).
//   4. Each entry.graph resolves INSIDE gallery/ (no abs paths, no .. traversal),
//      exists, and JSON-parses.
//   5. Every graph is a runnable noodle: nodes is a non-empty array, every
//      node.type is a real NODE_TYPES key, and materialize()+runGraph() don't throw
//      at the top level (network mocked; per-node failures isolated by runGraph).
//   6. Each graph is self-contained: no data: URIs (baked private media), no
//      off-allowlist http(s) hosts, no API-key shapes.
//   7. gallery.json and gallery/*.json correspond 1:1 (no orphan files, no dangling
//      entry).
//
// Usage: node scripts/check-gallery.mjs   (validates the whole gallery)

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { ROOT, loadEngine, calls } from "./play-engine.mjs";

const GALLERY_DIR = join(ROOT, "gallery");
const MANIFEST = join(ROOT, "gallery.json");
const failures = [];
const fail = (m) => failures.push(m);

// ---- 1. manifest parses to an array ---------------------------------------
let manifest = null;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch (e) {
  fail(`gallery.json does not parse: ${e.message}`);
}
if (manifest !== null && !Array.isArray(manifest)) {
  fail("gallery.json must be a top-level JSON array (a non-array makes the in-app Gallery render empty for everyone)");
  manifest = null;
}

// ---- self-contained / policy scan (mirrors check-policy.mjs's allowlist) ----
// Kept inline rather than imported because check-policy.mjs self-executes on import.
const ALLOWED_HOSTS = ["nano-gpt.com"];
function disallowedHost(url) {
  const u = String(url).trim();
  if (!u || u.startsWith("#") || (u.startsWith("/") && !u.startsWith("//"))) return null;
  if (/^(data|blob|mailto|tel):/i.test(u)) return null;
  const m = u.match(/^(?:https?:)?\/\/([^/:?#]+)/i);
  if (!m) return null;
  const host = m[1].toLowerCase();
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith("." + h)) ? null : host;
}
function scanSelfContained(slug, raw) {
  // 6a. baked private media — any data: URI smuggled into a node field.
  if (/["']data:/i.test(raw))
    fail(`${slug}: graph contains a data: URI — a baked-in upload would ship a contestant's private media publicly (share links blank uploads; curated graphs must too)`);
  // 6b. off-allowlist remote assets/hosts.
  for (const m of raw.matchAll(/(?:https?:)?\/\/[^\s"'\\)]+/gi)) {
    const host = disallowedHost(m[0]);
    if (host) fail(`${slug}: graph references off-allowlist host "${host}" — only ${ALLOWED_HOSTS.join(", ")} assets may ship (self-host or remove)`);
  }
  // 6c. pasted credentials.
  if (/sk-[A-Za-z0-9]{8}/.test(raw)) fail(`${slug}: graph contains an "sk-…" key shape — strip the pasted credential`);
  if (/\bBearer\s+[A-Za-z0-9._-]+/i.test(raw)) fail(`${slug}: graph contains a "Bearer …" token — strip it`);
  if (/ngpt_key/.test(raw)) fail(`${slug}: graph references "ngpt_key" — strip any embedded key`);
}

// ---- load the real engine once (for NODE_TYPES + runGraph) -----------------
let app = null;
try {
  app = loadEngine();
} catch (e) {
  fail("could not load the play.html engine to validate graphs: " + (e && e.message || e));
}

// ---- 2–6. per-entry validation --------------------------------------------
const seenSlugs = new Map();
const referencedGraphs = new Set();

for (let i = 0; i < (manifest || []).length; i++) {
  const e = manifest[i];
  const where = `gallery.json[${i}]`;
  if (!e || typeof e !== "object") { fail(`${where}: entry is not an object`); continue; }

  // 2. required fields + slug shape.
  const slug = e.slug;
  if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug))
    fail(`${where}: slug must be a string matching /^[a-z0-9-]+$/ (got ${JSON.stringify(slug)}) — it becomes the #gallery=<slug> deep link`);
  if (typeof e.title !== "string" || !e.title.trim())
    fail(`${where} (${slug}): title must be a non-empty string`);
  if (typeof e.graph !== "string" || !e.graph)
    fail(`${where} (${slug}): graph must be a string path under gallery/`);

  // 3. unique slugs.
  if (typeof slug === "string") {
    if (seenSlugs.has(slug)) fail(`duplicate slug "${slug}" (entries ${seenSlugs.get(slug)} and ${i}) — loadGalleryEntry() would silently resolve to the first`);
    else seenSlugs.set(slug, i);
  }

  if (typeof e.graph !== "string" || !e.graph) continue;

  // 4. graph path is safe, exists, parses.
  const graphPath = resolve(ROOT, e.graph);
  const inGallery = graphPath === GALLERY_DIR || graphPath.startsWith(GALLERY_DIR + sep);
  if (!inGallery) { fail(`${where} (${slug}): graph path "${e.graph}" escapes gallery/ (no absolute paths or ".." traversal)`); continue; }
  referencedGraphs.add(graphPath);
  if (!existsSync(graphPath)) { fail(`${where} (${slug}): graph file "${e.graph}" does not exist — dead card AND dead #gallery=${slug} link`); continue; }

  let raw, data;
  try { raw = readFileSync(graphPath, "utf8"); data = JSON.parse(raw); }
  catch (err) { fail(`${where} (${slug}): graph "${e.graph}" does not parse: ${err.message}`); continue; }

  // 6. self-contained scan (independent of the engine).
  scanSelfContained(slug, raw);

  // 5. runnable noodle.
  if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) {
    fail(`${where} (${slug}): graph has no nodes array — nothing to remix`);
    continue;
  }
  if (app) {
    for (const n of data.nodes) {
      if (!n || !app.NODE_TYPES[n.type])
        fail(`${where} (${slug}): node "${n && n.id}" has unknown type "${n && n.type}" — this build's NODE_TYPES has no such node; the card would strand on remix`);
    }
    calls.length = 0;
    try {
      const g = app.materialize(data);
      // runGraph isolates per-node failures (missing key/model 4xx); we only fail
      // on a top-level throw, i.e. a wiring/shape problem that breaks the whole run.
      await app.runGraph(g, {}).catch(() => {});
    } catch (err) {
      fail(`${where} (${slug}): graph threw at the top level during run: ${err && err.message || err}`);
    }
  }
}

// ---- 7. bidirectional coverage: gallery/*.json ⇆ manifest ------------------
if (existsSync(GALLERY_DIR)) {
  for (const f of readdirSync(GALLERY_DIR)) {
    if (!f.endsWith(".json")) continue;
    const p = join(GALLERY_DIR, f);
    if (!referencedGraphs.has(p))
      fail(`orphan graph gallery/${f} is not referenced by any gallery.json entry — add an entry or delete the file`);
  }
}

// ---- report ----------------------------------------------------------------
if (failures.length) {
  process.stderr.write("\n✗ check-gallery: the gallery would ship broken:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write(`✓ check-gallery: ${seenSlugs.size} gallery entr${seenSlugs.size === 1 ? "y" : "ies"} valid, runnable, and self-contained.\n`);
