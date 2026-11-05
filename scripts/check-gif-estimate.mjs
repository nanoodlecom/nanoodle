#!/usr/bin/env node
// GIF image nodes must NOT be exact-priced from still sizePrices.
//
// GPT Image 2.6 Flare/Sunburst can return animated GIFs via modelOpts.output_format=gif.
// Catalog sizePrices are still-image rates; NanoGPT settles GIF runs from token usage.
// Presenting "$X.XXX/img" (or treating GIF as exact in workflowCost) is a false estimate.
// This pins: imageOutputIsGif, nodeUnitUsd/livePrice (editor), nodeUnitUsdPlay (play),
// and the pre-Run warnGifUnknownCost / play status twin.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDX = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const PLAY = fs.readFileSync(path.join(ROOT, "play.html"), "utf8");
const GUIDE_SRC = fs.readFileSync(path.join(ROOT, "scripts/sync-guide-examples.mjs"), "utf8");
const GUIDE_PAGE = fs.readFileSync(path.join(ROOT, "guide/examples/one-prompt-looping-gif.html"), "utf8");

let failed = 0;
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { failed++; console.error("  ✗ " + m); } };
const fail = (m) => { failed++; console.error("  ✗ " + m); };

function matchBrace(src, openIdx) {
  let i = openIdx, depth = 0, inStr = null, esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error("unbalanced brace from " + openIdx);
}
function extractFn(src, name) {
  const sig = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = sig.exec(src);
  if (!m) throw new Error("function " + name + "() not found");
  const open = src.indexOf("{", m.index);
  return src.slice(m.index, matchBrace(src, open) + 1);
}

console.log("\nstatic pins");
ok(IDX.includes("function imageOutputIsGif("), "index.html defines imageOutputIsGif");
ok(IDX.includes("function warnGifUnknownCost("), "index.html defines warnGifUnknownCost");
ok(/warnLowBalance\(\);\s*warnGifUnknownCost\(\);/.test(IDX), "runAll warns GIF cost before firing");
ok(/warnGifUnknownCost\(\);\s*runGroup\(\[n\.id\]\)/.test(IDX), "per-node ▶ warns GIF cost before runGroup");
ok(PLAY.includes("function imageOutputIsGif("), "play.html defines imageOutputIsGif (twin)");
ok(PLAY.includes("graphHasGifImageNodesPlay("), "play.html defines graphHasGifImageNodesPlay");
ok(PLAY.includes("__gifcost__"), "play run() emits GIF cost status warning");
ok(!/max_request_pixels/.test(IDX + PLAY + GUIDE_SRC + GUIDE_PAGE), "no max_request_pixels assertion in guide/editor/play");

// Guide must not claim frame_count / frame_duration_ms are Image-node UI knobs.
const editMatch = GUIDE_SRC.match(/"one-prompt-looping-gif":\s*\{[\s\S]*?edit:\s*"([^"]*(?:\\.[^"]*)*)"/);
if (!editMatch) fail("could not read one-prompt-looping-gif edit: from sync-guide-examples.mjs");
else {
  const edit = editMatch[1].replace(/\\"/g, '"');
  ok(/modelOpts/.test(edit) && /exported or saved graph JSON/.test(edit),
    "guide edit: tells users to edit GIF knobs in modelOpts JSON");
  ok(!/Open the model options on either Image node to change <em>frame_count<\/em>/.test(edit),
    "guide edit: no longer claims frame_count is an Image-node options control");
  ok(/Quality may be changed via the Image node's model options/.test(edit),
    "guide edit: quality may use Image-node model options");
}
ok(/still-image catalog price is not the GIF bill/.test(GUIDE_SRC),
  "guide costHow: still catalog price is not the GIF bill");
ok(/total request pixel budget/.test(GUIDE_SRC),
  "guide costHow: OpenAI per-frame size + total request pixel budget");
ok(/modelOpts/.test(GUIDE_PAGE) && /exported or saved graph JSON/.test(GUIDE_PAGE),
  "regenerated guide page carries the JSON-editing wording");

console.log("\neditor behavioural");
try {
  // nodeUnitUsd is too large/brace-dense to extract cleanly; pin its GIF gate in source and
  // run livePrice + imageOutputIsGif in a sandbox (same pattern as check-h3-lora-ref-chip).
  ok(/if\(kind==="image"\)\{\s*\/\/[\s\S]*?if\(imageOutputIsGif\(fields\)\) return null;/.test(IDX)
    || /if\(imageOutputIsGif\(fields\)\) return null;/.test(IDX.slice(IDX.indexOf("function nodeUnitUsd("), IDX.indexOf("function nodeUnitUsd(") + 800)),
    "nodeUnitUsd returns null for GIF (source pin)");
  ok(/if\(u==null\)\{ unpriced\+\+; continue; \}/.test(IDX),
    "workflowCost treats null nodeUnitUsd as unpriced");

  const bundle = [
    extractFn(IDX, "imageOutputIsGif"),
    extractFn(IDX, "livePrice"),
    "function catItem(kind, id){ return (catalogs[kind]||[]).find(function(m){ return m.id===id; }); }",
    "function t(s){ return s; }",
    "var catalogs = { image: [{ id: 'gpt-image-2.6-flare', sizePrices: { '1024x1024': 0.04 }, maxOut: 1, fixedCount: 0 }] };",
    "function videoUnitUsd(){ return null; }",
    "function applyVideoQuotePricing(_id, p){ return p; }",
    "function videoPriceFields(){ return {}; }",
    "function modelHasImageRole(){ return false; }",
    "function model3dPriceLabels(){ return { card: '' }; }",
    "function nodeUnitUsd(){ return null; }",
    "var NODE_TYPES = {}, graph = { links: [] }, REF_PORT_RE = /^ref\\d+$/;",
    "this.imageOutputIsGif=imageOutputIsGif; this.livePrice=livePrice;",
  ].join("\n");
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(bundle, sb);

  ok(sb.imageOutputIsGif({ modelOpts: { output_format: "gif" } }) === true, "imageOutputIsGif: gif");
  ok(sb.imageOutputIsGif({ modelOpts: { output_format: "GIF" } }) === true, "imageOutputIsGif: GIF case-insensitive");
  ok(sb.imageOutputIsGif({ modelOpts: { output_format: "png" } }) === false, "imageOutputIsGif: png is not gif");
  ok(sb.imageOutputIsGif({ modelOpts: {} }) === false, "imageOutputIsGif: empty opts");
  ok(sb.imageOutputIsGif({}) === false, "imageOutputIsGif: no modelOpts");

  const stillFields = { model: "gpt-image-2.6-flare", size: "1024x1024" };
  const gifFields = { model: "gpt-image-2.6-flare", size: "1024x1024", modelOpts: { output_format: "gif", frame_count: 12 } };
  ok(/0\.040\/img/.test(sb.livePrice("image", stillFields)), "livePrice: still shows $/img from sizePrices");
  const gifChip = sb.livePrice("image", gifFields);
  ok(gifChip === "GIF · billed on tokens", "livePrice: GIF chip is honest (" + JSON.stringify(gifChip) + ")");
  ok(!/\/img/.test(gifChip) && !/0\.040/.test(gifChip),
    "livePrice: GIF chip does not show the still sizePrices figure");
} catch (e) {
  fail("editor behavioural harness: " + (e && e.stack || e.message));
}

console.log("\nplay behavioural");
try {
  // Extract only the pure GIF predicate + image branch pattern from play RUNTIME.
  ok(/if\(imageOutputIsGif\(f\)\) return null;/.test(PLAY),
    "play nodeUnitUsdPlay returns null for GIF");
  const fn = extractFn(PLAY, "imageOutputIsGif");
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(fn + "\nthis.imageOutputIsGif=imageOutputIsGif;", sb);
  ok(sb.imageOutputIsGif({ modelOpts: { output_format: "gif" } }) === true, "play imageOutputIsGif: gif");
  ok(sb.imageOutputIsGif({ modelOpts: { output_format: "webp" } }) === false, "play imageOutputIsGif: webp");
} catch (e) {
  fail("play behavioural harness: " + (e && e.message));
}

if (failed) {
  console.error("\n✗ gif-estimate: " + failed + " failure(s)");
  process.exit(1);
}
console.log("\n✓ GIF nodes are unpriced / warned; still sizePrices are not used as exact GIF estimates.");
