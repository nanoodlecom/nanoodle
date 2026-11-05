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
  ok(!/Quality may be changed via the Image node's model options/.test(edit),
    "guide edit: does not claim quality is an Image-node UI control");
  ok(/<em>quality<\/em>/.test(edit) && /modelOpts/.test(edit),
    "guide edit: includes quality in the JSON-editing instructions with the other GIF knobs");
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


console.log("\naggregate chip honesty (LLM + GIF)");
try {
  // refreshRunEstimate / paintRunCost must not present a priced subtotal as a complete total
  // when GIF image nodes make part of the bill unknown.
  ok(/const gifUnknown = graphHasGifImageNodes\(\);/.test(IDX),
    "editor refreshRunEstimate computes gifUnknown");
  ok(/subtotal \+ unknown GIF/.test(IDX),
    "editor chip labels GIF graphs as subtotal + unknown GIF");
  ok(/gifUnknown[\s\S]*?subtotal \+ unknown GIF[\s\S]*?t\("to run"\)/.test(IDX.slice(IDX.indexOf("function refreshRunEstimate("), IDX.indexOf("function refreshRunEstimate(")+2400)),
    "editor uses subtotal label when GIF unknown (not plain 'to run')");
  ok(/gifUnknown: graphHasGifImageNodesPlay\(\)/.test(PLAY),
    "play refreshRunCost stamps gifUnknown on the forecast");
  ok(/const gifUnknown = !!rc\.gifUnknown;/.test(PLAY),
    "play paintRunCost reads gifUnknown from the forecast (harness-extractable)");
  ok(/gifUnknown \? t\("subtotal \+ unknown GIF"\) : t\("\/run"\)/.test(PLAY),
    "play /run chip uses subtotal label when GIF unknown");

  // Behavioural: a graph with LLM + GIF must not paint a confident total that omits GIF unknown.
  // Pin via source: when gifUnknown, the suffix is the subtotal label (never bare "to run").
  const refreshSlice = IDX.slice(IDX.indexOf("function refreshRunEstimate("), IDX.indexOf("function refreshRunEstimate(") + 2200);
  ok(/gifUnknown[\s\S]*?t\("subtotal \+ unknown GIF"\)[\s\S]*?t\("to run for real"\)[\s\S]*?t\("to run"\)/.test(refreshSlice),
    "editor: GIF path uses subtotal label; non-GIF keeps 'to run'");
  ok(!/el\.innerHTML = demo \? amt \+ `\$\{esc\(t\("to run for real"\)\)\}` : amt \+ `\$\{esc\(t\("to run"\)\)\}`;/.test(refreshSlice),
    "editor: no longer always paints confident 'to run' total (regression gate)");
} catch (e) {
  fail("aggregate chip honesty: " + (e && e.message));
}

console.log("\npost-run GIF fallback (no still settlement)");
try {
  // When response omits settled cost, GIF must NOT fall back to still imageUnitUsd / estImageUsd.
  ok(/const gifOut = !!\(extra && typeof extra==="object" && String\(extra\.output_format\|\|""\)\.toLowerCase\(\)==="gif"\);/.test(IDX),
    "editor genImage detects gifOut from extra.output_format");
  ok(/const unit = gifOut \? null : imageUnitUsd\(model, size\);/.test(IDX),
    "editor genImage: GIF leaves unit null (no still imageUnitUsd fallback)");
  ok(/const gifOut = !!\(extra && typeof extra==="object" && String\(extra\.output_format\|\|""\)\.toLowerCase\(\)==="gif"\);/.test(PLAY),
    "play genImage detects gifOut from extra.output_format");
  ok(/if\(c\.usd==null && !gifOut\)\{ const est = await estImageUsd/.test(PLAY),
    "play genImage: skips estImageUsd still fallback when gifOut");

  // Sandbox: mirror the genImage fallback decision without pulling the whole CTX.
  const bundle = [
    extractFn(IDX, "imageOutputIsGif"),
    "function gifFallbackUnit(extra, stillUnit){ var gifOut = !!(extra && typeof extra===\"object\" && String(extra.output_format||\"\").toLowerCase()===\"gif\"); return gifOut ? null : stillUnit; }",
    "this.imageOutputIsGif=imageOutputIsGif; this.gifFallbackUnit=gifFallbackUnit;",
  ].join("\n");
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(bundle, sb);
  ok(sb.gifFallbackUnit({ output_format: "gif" }, 0.04) === null,
    "fallback: GIF + missing settlement → null (not still 0.04)");
  ok(sb.gifFallbackUnit({ output_format: "GIF" }, 0.04) === null,
    "fallback: GIF case-insensitive → null");
  ok(sb.gifFallbackUnit({ output_format: "png" }, 0.04) === 0.04,
    "fallback: still png keeps catalog unit");
  ok(sb.gifFallbackUnit({}, 0.04) === 0.04,
    "fallback: no output_format keeps catalog unit");
} catch (e) {
  fail("post-run GIF fallback: " + (e && e.stack || e.message));
}

console.log("\npixel-budget-compatible preset");
try {
  const WF = JSON.parse(fs.readFileSync(path.join(ROOT, "examples/gallery/one-prompt-looping-gif/workflow.json"), "utf8"));
  const GRAPH = JSON.parse(fs.readFileSync(path.join(ROOT, "examples/gallery/one-prompt-looping-gif/graph.json"), "utf8"));
  const BUDGET = 8294400;
  const imgNodes = (g) => g.nodes.filter((n) => n.type === "image");
  for (const n of imgNodes(WF)) {
    const mo = n.fields.modelOpts || {};
    const [w, h] = String(n.fields.size || "").split("x").map(Number);
    const fc = +mo.frame_count || 0;
    const nOut = Math.max(1, parseInt(n.fields.variations, 10) || 1);
    const px = fc * w * h * nOut;
    ok(String(mo.output_format || "").toLowerCase() === "gif", n.id + " workflow output_format=gif");
    ok(n.fields.size === "1024x1024", n.id + " workflow size is 1024x1024 (editor catalog floor)");
    ok(fc === 7, n.id + " workflow frame_count is 7 (was 12; 12×1024² exceeds budget)");
    ok(px <= BUDGET, n.id + " workflow pixels " + px + " ≤ " + BUDGET + " (7×1024×1024=" + (7*1024*1024) + ")");
    ok(mo.background === "opaque", n.id + " workflow background stays opaque");
  }
  // Saved graph documents the real 512² × 12 run (within budget at 512).
  for (const n of imgNodes(GRAPH)) {
    const mo = n.fields.modelOpts || {};
    const [w, h] = String(n.fields.size || "").split("x").map(Number);
    const fc = +mo.frame_count || 0;
    const px = fc * w * h;
    ok(n.fields.size === "512x512", n.id + " graph.json keeps saved 512×512");
    ok(fc === 12, n.id + " graph.json keeps saved 12 frames");
    ok(px <= BUDGET, n.id + " graph pixels " + px + " ≤ budget");
  }
  // EXAMPLES card in index.html must match the compatible workflow numbers.
  const ex = IDX.match(/slug:"one-prompt-looping-gif"[\s\S]*?graph:\{[\s\S]*?links:\[[\s\S]*?\] \} \}/);
  if (!ex) fail("could not locate EXAMPLES card for one-prompt-looping-gif");
  else {
    ok(/"frame_count":7/.test(ex[0]) && !/"frame_count":12/.test(ex[0]),
      "EXAMPLES card uses frame_count 7 (not 12)");
    ok(/"size":"1024x1024"/.test(ex[0]), "EXAMPLES card uses 1024x1024");
    ok(/7-frame looping/.test(ex[0]), "EXAMPLES desc mentions 7-frame");
  }
  // 12×1024² would be over budget — pin the arithmetic so a future bump can't silently regress.
  ok(12 * 1024 * 1024 > BUDGET, "pin: 12×1024² = " + (12*1024*1024) + " exceeds " + BUDGET);
  ok(7 * 1024 * 1024 <= BUDGET, "pin: 7×1024² = " + (7*1024*1024) + " fits " + BUDGET);
} catch (e) {
  fail("pixel-budget preset: " + (e && e.stack || e.message));
}


if (failed) {
  console.error("\n✗ gif-estimate: " + failed + " failure(s)");
  process.exit(1);
}
console.log("\n✓ GIF nodes are unpriced / warned; aggregate chips honest; post-run fallback leaves GIF unknown; preset fits pixel budget.");
