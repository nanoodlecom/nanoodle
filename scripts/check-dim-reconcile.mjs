#!/usr/bin/env node
// A node's dimension value (size / resolution / aspect / duration) is only meaningful for the model
// it was chosen for. nano-banana-2 sizes are tiers ("1k","2k","4k"); qwen-image-3 wants "1024x1024";
// Sora counts length in `seconds` (4/8/12) while most video models offer 5/10. Before this guard both
// engines kept the OLD value across a model swap and injected it as a fake <option>, so a swap from
// nano-banana-2 to qwen-image-3 still sent size="1k" — a paid request the model rejects or silently
// substitutes. This pins the fix offline, in both engines:
//
//   MODEL SWAP  → the value snaps to a real option of the NEW model (aspect first, then pixel count,
//                 then nearest number, then the model's own default)
//   HYDRATION   → an author's stored value survives untouched (the model did not change)
//   BOTH ENGINES agree on every mapping (editor nearestDimOption ↔ play RUNTIME_JS twin)
//
// Offline node:vm, no network, no API spend. Extraction technique mirrors check-drifted-model.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

// Brace-match a block starting at `anchor` (through its balanced closing "}").
function block(src, anchor) {
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error("anchor not found: " + anchor);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced braces for: " + anchor);
}

// dimNum is a one-liner in both files, written differently (const arrow vs function) — grab its line.
function dimNumLine(src) {
  const i = src.search(/(const|function)\s+dimNum\b/);
  if (i === -1) throw new Error("dimNum not found");
  return src.slice(i, src.indexOf("\n", i)).replace(/^const\s/, "var ");
}
function loadEngine(src, tierAnchor) {
  const code = [
    block(src, tierAnchor).replace(/^(const|var)\s/, "var "),
    block(src, "function dimShape(v){"),
    dimNumLine(src),
    block(src, "function nearestDimOption(cur, options, def){"),
  ].join("\n");
  const ctx = { console, Math };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

const opts = (...vals) => vals.map((v) => [v, v]);
// Real catalog shapes (fetched 2026-07-27 from /api/v1/image-models + the video params).
const QWEN = opts("auto", "1024x1024", "512x512", "768x1024", "576x1024", "1024x768", "1024x576");
const BANANA = opts("1k", "2k", "4k");
const GPT_IMAGE = opts("1024x1024", "1024x768", "1024x1536", "1536x1024", "1152x2048", "2048x1152");

const CASES = [
  // [what it is,                        cur,          options,      def,     expected]
  ["tier size → the WxH model's match",  "1k",         QWEN,         "auto",  "1024x1024"],
  ["bigger tier → the largest square",   "2k",         QWEN,         "auto",  "1024x1024"],
  ["WxH size → the tier model's match",  "1024x1024",  BANANA,       "1k",    "1k"],
  ["supported value survives the swap",  "1024x1536",  GPT_IMAGE,    "1024x1024", "1024x1536"],
  ["portrait never becomes landscape",   "1024x1536",  opts("1024x1024", "1536x1024"), "1024x1024", "1024x1024"],
  ["landscape ratio → orientation list", "16:9",       opts("landscape", "portrait"),  "landscape", "landscape"],
  ["portrait ratio → orientation list",  "9:16",       opts("landscape", "portrait"),  "landscape", "portrait"],
  ["ratio → the nearest ratio",          "16:9",       opts("1:1", "4:3", "21:9"),     "1:1",       "21:9"],
  ["duration 5 → Sora's seconds",        "5",          opts("4", "8", "12"),           "4",         "4"],
  ["duration 10 → Sora's seconds",       "10",         opts("4", "8", "12"),           "4",         "8"],
  ["resolution 720p → nearest tier",     "720p",       [["", "model default"], ["480p", "480p"], ["1080p", "1080p"]], "", "480p"],
  ["auto survives when offered",         "auto",       QWEN,         "auto",  "auto"],
  ["auto falls back to the default",     "auto",       BANANA,       "1k",    "1k"],
  ["empty value takes the default",      "",           BANANA,       "1k",    "1k"],
  ["unparseable value takes the default","cinematic",  opts("landscape", "portrait"),  "landscape", "landscape"],
];

const ENGINES = [
  ["editor", loadEngine(IDX, "const DIM_TIER_PX = {")],
  ["play",   loadEngine(PLAY, "var DIM_TIER_PX = {")],
];

// ---- 1. both engines map every case the same, correct way -----------------
for (const [name, ctx] of ENGINES) {
  let bad = 0;
  for (const [what, cur, options, def, want] of CASES) {
    const got = ctx.nearestDimOption(cur, options, def);
    if (String(got) !== String(want)) { fail(`${name}: ${what} — "${cur}" → "${got}" (want "${want}")`); bad++; }
  }
  if (!bad) ok(`${name}: all ${CASES.length} model-swap mappings land on a real option`);
}
// cross-engine parity: an exported app must reconcile exactly like the editor did
{
  let bad = 0;
  for (const [what, cur, options, def] of CASES) {
    const a = String(ENGINES[0][1].nearestDimOption(cur, options, def));
    const b = String(ENGINES[1][1].nearestDimOption(cur, options, def));
    if (a !== b) { fail(`parity: ${what} — editor "${a}" vs play "${b}"`); bad++; }
  }
  if (!bad) ok("editor ↔ play reconcile identically (dual-engine parity)");
}
// a reconciled value is ALWAYS one the new model listed — never an invented one
{
  let bad = 0;
  for (const [what, cur, options, def] of CASES) {
    const got = String(ENGINES[0][1].nearestDimOption(cur, options, def));
    const listed = options.some((o) => String(o[0]) === got) || got === String(def);
    if (!listed) { fail(`${what} — "${got}" is not an option the model offers`); bad++; }
  }
  if (!bad) ok("every reconciled value is an option the new model actually lists");
}

// ---- 2. wiring: reconcile on a model SWAP, never on hydration -------------
{
  const swapSites = IDX.match(/refreshDims\(n, *true\)/g) || [];
  if (swapSites.length < 2)
    fail(`editor: expected both model-swap sites to call refreshDims(n, true) — found ${swapSites.length}`);
  else ok(`editor: ${swapSites.length} model-swap sites reconcile (refreshDims(n, true))`);

  // the picker onPick and the drifted-model "use default" swap are the two that change the model
  const pick = IDX.slice(IDX.indexOf("openPicker(t.modelKind"), IDX.indexOf("openPicker(t.modelKind") + 600);
  if (!/refreshDims\(n, *true\)/.test(pick)) fail("editor: the model picker no longer reconciles dimensions");
  else ok("editor: the model picker reconciles dimensions on pick");

  if (!/function refreshDims\(n, *swapped\)/.test(IDX)) fail("editor: refreshDims lost its `swapped` parameter");
  else ok("editor: refreshDims takes the swapped flag");

  // hydration paths must NOT pass it — a stored graph keeps the author's value
  const hydrate = IDX.slice(IDX.indexOf("function refreshAllPrices()"), IDX.indexOf("function refreshAllPrices()") + 400);
  if (/refreshDims\(n, *true\)/.test(hydrate)) fail("editor: refreshAllPrices reconciles on catalog arrival — it must not (no model change)");
  else ok("editor: catalog arrival leaves stored values alone");
}
{
  if (!/function fillDimLists\(swapped\)/.test(PLAY)) fail("play: fillDimLists lost its `swapped` parameter");
  else ok("play: fillDimLists takes the swapped flag");

  const pick = PLAY.slice(PLAY.indexOf("function pick(id){"), PLAY.indexOf("function pick(id){") + 400);
  if (!/fillDimLists\(true\)/.test(pick)) fail("play: picking a model no longer reconciles its dimensions");
  else ok("play: picking a model reconciles its dimensions");

  const render = PLAY.slice(PLAY.indexOf("fillModelLists();"), PLAY.indexOf("fillModelLists();") + 300);
  if (/fillDimLists\(true\)/.test(render)) fail("play: the first render reconciles — it must keep the author's baked-in value");
  else ok("play: the first render keeps the author's baked-in value");
}

// ---- 3. the user is told what changed (trim-and-disclose doctrine) --------
{
  const body = block(IDX, "function refreshDims(n, swapped){");
  if (!/toast\(t\(/.test(body)) fail("editor: a reconciled dimension changes what the run buys — it must be disclosed, not silent");
  else ok("editor: a reconciled dimension is disclosed to the user");
}

if (failed) { console.error("\ncheck-dim-reconcile: " + failed + " failure(s)"); process.exit(1); }
console.log("\ncheck-dim-reconcile: OK");
