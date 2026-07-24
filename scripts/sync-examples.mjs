#!/usr/bin/env node
// Keep the 📚 Examples gallery equal to github.com/nanoodlecom/awesome-noodles.
//
// The gallery used to be a hand-maintained list beside that repo, and it drifted both ways:
// noodles were added there and never landed here, and four entries lived on here after being
// removed there. This makes the repo the source of truth mechanically — one card per
// graphs/*.noodle-graph.json, nothing else.
//
//   node scripts/sync-examples.mjs --check     verify parity, touch nothing (the guard)
//   node scripts/sync-examples.mjs             rewrite index.html's EXAMPLES array in place
//
// --graphs <dir> overrides the default sibling checkout (../awesome-noodles/graphs). With no
// checkout present both modes exit 0 and say so — a contributor without the sibling repo is not
// blocked, exactly like check-js-parity's missing-package skip.
//
// What each card keeps across a sync, keyed by `slug` (= the graph's filename stem, which is also
// its mcp.nanoodle.com tool id): em, title, desc, thumb. Those are gallery presentation and are
// authored here. Everything under `graph` comes from the file, VERBATIM — including fields.model.
//
// Pinned model ids are the point, not an accident. They are what makes an example the thing
// awesome-noodles tuned: the arena genuinely races four different models instead of four copies
// of whichever is newest, photo→video's motion-prompt guide matches the ltx build it was written
// for, and sing/talking-avatar keep the music + lipsync models they were built around. The cost
// is that ids age (NanoGPT renames and retires them); a retired id trips the drifted-model
// preflight, which refuses to send and tells the user the creator needs to update — annoying, but
// it never charges for a dead call. Re-run this script after an upstream refresh to clear it, and
// see scripts/check-example-models.mjs for the monthly catalog audit that catches it first.
//
// Only two things are dropped, both meaningless in this context: nid/lid (applyGraphData rebuilds
// the id counters) and view (loadExample fits the view). x/y/w/sizes are rounded to whole pixels
// for legibility — deterministic and applied to both sides of --check, so it can't mask drift.
//
// Offline, no API spend.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = join(ROOT, "index.html");
const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const gi = argv.indexOf("--graphs");
const GRAPHS = gi >= 0 ? argv[gi + 1] : join(ROOT, "..", "awesome-noodles", "graphs");

if (!existsSync(GRAPHS)) {
  console.log(`sync-examples: SKIP — no awesome-noodles checkout at ${GRAPHS}`);
  process.exit(0);
}

const j = (v) => JSON.stringify(v);
const bare = (o) =>
  "{" + Object.entries(o).map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : j(k)}:${j(v)}`).join(",") + "}";

function portNode(n) {
  const sizes = {};
  for (const [k, v] of Object.entries(n.sizes || {})) if (v) sizes[k] = Math.round(v);

  const parts = [`id:${j(n.id)}`, `type:${j(n.type)}`, `x:${Math.round(n.x)}`, `y:${Math.round(n.y)}`];
  if (n.w != null) parts.push(`w:${Math.round(n.w)}`);
  if (Object.keys(sizes).length) parts.push(`sizes:${bare(sizes)}`);
  parts.push(`fields:${bare(n.fields || {})}`);
  if (n.name) parts.push(`name:${j(n.name)}`);
  return `{${parts.join(",")}}`;
}

// ---- read the current array's presentation layer (slug → em/title/desc/thumb) --------------
const src = readFileSync(IDX, "utf8");
const start = src.indexOf("const EXAMPLES = [");
const end = src.indexOf("\n];", start);
if (start < 0 || end < 0) { console.error("✗ EXAMPLES array not found in index.html"); process.exit(1); }
const current = src.slice(start, end + 3);

const cards = new Map();
const order = [];
for (const m of current.matchAll(
  /\{ em:"([^"]*)", slug:"([^"]*)", title:"([^"]*)", desc:"([^"]*)",\s*\n\s*thumb:"([^"]*)"/g
)) {
  cards.set(m[2], { em: m[1], slug: m[2], title: m[3], desc: m[4], thumb: m[5] });
  order.push(m[2]);
}
if (!cards.size) { console.error("✗ could not parse any example cards — has the entry shape changed?"); process.exit(1); }

// ---- reconcile against the repo -------------------------------------------------------------
const slugs = readdirSync(GRAPHS)
  .filter((f) => f.endsWith(".noodle-graph.json"))
  .map((f) => basename(f, ".noodle-graph.json"))
  .sort();

const missing = slugs.filter((s) => !cards.has(s));           // in the repo, no card here
const extra = order.filter((s) => !slugs.includes(s));        // card here, gone from the repo
if (missing.length || extra.length) {
  for (const s of missing)
    console.error(`✗ ${s} is in awesome-noodles but has no gallery card — add { em, slug:"${s}", title, desc, thumb } to EXAMPLES, then re-run`);
  for (const s of extra)
    console.error(`✗ ${s} has a gallery card but is gone from awesome-noodles — delete its entry (and its i18n keys), then re-run`);
  process.exit(1);
}

// Keep the authored order; it is the README's Image → Video → Audio grouping, not alphabetical.
const built = order.map((slug) => {
  const c = cards.get(slug);
  const g = JSON.parse(readFileSync(join(GRAPHS, `${slug}.noodle-graph.json`), "utf8"));
  const nodes = g.nodes.map(portNode).map((s, i) => (i ? "           " : "") + s).join(",\n");
  const links = g.links
    .map((l) => `{id:${j(l.id)},from:{node:${j(l.from.node)},port:${j(l.from.port)}},to:{node:${j(l.to.node)},port:${j(l.to.port)}}}`)
    .map((s, i) => (i ? "           " : "") + s).join(",\n");
  return ` { em:${j(c.em)}, slug:${j(c.slug)}, title:${j(c.title)}, desc:${j(c.desc)},
   thumb:"${c.thumb}",
   graph:{ v:1,
   nodes:[ ${nodes} ],
   links:[ ${links} ] } },`;
});
const next = "const EXAMPLES = [\n" + built.join("\n") + "\n];";

if (next === current) {
  console.log(`✓ examples gallery matches awesome-noodles (${slugs.length} noodles)`);
  process.exit(0);
}
if (CHECK) {
  console.error("✗ examples gallery has drifted from awesome-noodles — run: node scripts/sync-examples.mjs");
  process.exit(1);
}
writeFileSync(IDX, src.slice(0, start) + next + src.slice(end + 3));
console.log(`✓ examples gallery rewritten from awesome-noodles (${slugs.length} noodles)`);
