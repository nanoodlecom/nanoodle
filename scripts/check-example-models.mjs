#!/usr/bin/env node
// Audit the 📚 Examples gallery's pinned model ids against the live NanoGPT catalog.
//
// The gallery mirrors awesome-noodles verbatim, pinned fields.model included (see
// scripts/sync-examples.mjs for why that's deliberate). The cost of pinning is that NanoGPT
// renames and retires ids: when one goes, the example still LOADS but its node refuses to send —
// modelDrifted() blocks it at run preflight with "this model is no longer available". No charge,
// no opaque 4xx, but a starter workflow that can't run is a bad first click, and nothing would
// otherwise tell us it happened.
//
// So this is the alert. It runs monthly in CI (.github/workflows/example-models-audit.yml), the
// same build/audit-time-only shape as check-lora-models: it fetches the public catalog, touches
// no user and no deployed app, and a FAILING run means "go refresh the graphs upstream, then
// re-run scripts/sync-examples.mjs".
//
// Two ways an id can be bad, both reported:
//   • gone      — not in the catalog for its kind at all → modelDrifted() blocks the node.
//   • dead      — present, but on the app's own known-dead list (normAudio's `dead` regex: models
//                 the catalog still advertises whose generation service 502s on every call). The
//                 picker hides these, so a pinned one is a guaranteed dead end that drift can't see.
//
// A catalog outage is never a build failure — the committed app keeps working, so we exit 0.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "index.html"), "utf8");
const NANOGPT = "https://nano-gpt.com";
const ENDPOINTS = {
  chat: "/api/v1/models?detailed=true",
  image: "/api/v1/image-models",
  video: "/api/v1/video-models",
  audio: "/api/v1/audio-models",
};

// ---- node type → catalog kind, read out of NODE_TYPES so it can't drift from the app ----------
function nodeKinds() {
  const out = {};
  const begin = src.indexOf("const NODE_TYPES = {");
  if (begin < 0) throw new Error("NODE_TYPES not found");
  // Each entry starts at two-space indent: `  image: {` … and runs to the next such header.
  const body = src.slice(begin);
  const heads = [...body.matchAll(/^ {2}(\w+):\s*\{/gm)];
  for (let i = 0; i < heads.length; i++) {
    const from = heads[i].index;
    const to = i + 1 < heads.length ? heads[i + 1].index : from + 8000;
    const m = /modelKind:"(\w+)"/.exec(body.slice(from, to));
    if (m) out[heads[i][1]] = m[1];
  }
  return out;
}

// ---- the app's own known-dead list, lifted from normAudio -------------------------------------
function deadIds() {
  const m = /const dead = \/\^\(([^)]*)\)\$\/i\.test\(m\.id\)/.exec(src) || /const dead = \/\^([^/]*)\$\/i\.test\(m\.id\)/.exec(src);
  if (!m) return [];
  return m[1].split("|").map((s) => s.replace(/\\/g, ""));
}

// ---- every pinned model in EXAMPLES, with the card + node it belongs to ------------------------
function pinnedModels(kinds) {
  const start = src.indexOf("const EXAMPLES = [");
  const arr = src.slice(start, src.indexOf("\n];", start));
  const out = [];
  let slug = "?";
  for (const line of arr.split("\n")) {
    const s = /slug:"([^"]+)"/.exec(line);
    if (s) slug = s[1];
    for (const n of line.matchAll(/\{id:"([^"]+)",type:"(\w+)",[^}]*?fields:\{([^}]*)\}/g)) {
      const kind = kinds[n[2]];
      if (!kind) continue;                                   // not a model-bearing node
      const mm = /"?model"?:"([^"]+)"/.exec(n[3]);
      if (mm) out.push({ slug, node: n[1], type: n[2], kind, id: mm[1] });
    }
  }
  return out;
}

const kinds = nodeKinds();
const pins = pinnedModels(kinds);
if (!pins.length) {
  console.error("check-example-models: parsed 0 pinned models out of EXAMPLES — the entry shape changed. Audited nothing; refusing to report success.");
  process.exit(1);
}

const need = [...new Set(pins.map((p) => p.kind))];
const live = {};
for (const kind of need) {
  try {
    const r = await fetch(`${NANOGPT}${ENDPOINTS[kind]}`, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = (await r.json()).data || [];
    const ids = data.map((m) => m && m.id).filter(Boolean);
    // A 200 with no usable model array means the shape moved under us. Reporting "all live" off
    // an empty list would turn this audit into a no-op that always passes — the opposite of its job.
    if (!ids.length) {
      console.error(`check-example-models: ${kind} catalog fetched but held 0 models — unexpected shape at ${ENDPOINTS[kind]}. Audited nothing; refusing to report success.`);
      process.exit(1);
    }
    live[kind] = new Set(ids);
  } catch (e) {
    console.error(`check-example-models: ${kind} catalog fetch failed (${e.message}) — skipping audit`);
    process.exit(0);
  }
}

const dead = new Set(deadIds().map((s) => s.toLowerCase()));
const gone = pins.filter((p) => !live[p.kind].has(p.id));
const rotten = pins.filter((p) => live[p.kind].has(p.id) && dead.has(p.id.toLowerCase()));

for (const p of gone)
  console.error(`✗ ${p.slug}: ${p.type} node ${p.node} pins "${p.id}" — gone from the ${p.kind} catalog; the node will refuse to run`);
for (const p of rotten)
  console.error(`✗ ${p.slug}: ${p.type} node ${p.node} pins "${p.id}" — listed but on the app's known-dead list; every call fails`);

if (gone.length || rotten.length) {
  console.error(`\nRefresh the graph(s) in github.com/nanoodlecom/awesome-noodles, then: node scripts/sync-examples.mjs`);
  process.exit(1);
}
console.log(`check-example-models: OK (${pins.length} pinned ids across ${need.length} catalogs, all live)`);
