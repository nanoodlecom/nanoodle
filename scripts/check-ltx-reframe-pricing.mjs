#!/usr/bin/env node
// Offline regression for the real editor/player quote surfaces. Catalog captured
// from https://nano-gpt.com/api/v1/video-models on 2026-11-13. No provider requests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const model = JSON.parse(readFileSync(new URL("./fixtures/ltx-reframe-catalog-2026-11-13.json", import.meta.url)));
const id = model.id;
const near = (got, want) => assert.ok(got != null && Math.abs(got - want) < 1e-9, `${got} != ${want}`);

// Lift shipped functions, including nested templates, without reimplementing the meter.
function fn(src, name) {
  const m = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{").exec(src);
  assert.ok(m, name);
  let depth = 0, mode = "code";
  const templates = [];
  for (let i = src.indexOf("{", m.index); i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i++; }
      else if (c === "/" && n === "*") { mode = "block"; i++; }
      else if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (templates.length && depth === templates.at(-1)) { templates.pop(); mode = "tpl"; }
        else if (depth === 0) return src.slice(m.index, i + 1);
      }
    } else if (mode === "line") { if (c === "\n") mode = "code"; }
    else if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i++; } }
    else if (mode === "sq" || mode === "dq") {
      if (c === "\\") i++;
      else if (c === (mode === "sq" ? "'" : '"')) mode = "code";
    } else if (mode === "tpl") {
      if (c === "\\") i++;
      else if (c === "`") mode = "code";
      else if (c === "$" && n === "{") { mode = "code"; templates.push(depth); depth++; i++; }
    }
  }
  throw new Error("unbalanced function " + name);
}

const source = { id: "source", type: "vupload", fields: {} };
const reframe = { id: "reframe", type: "vedit", fields: { model: id, duration: 999, resolution: "720p" } };
const still = { id: "still", type: "image", fields: { model: "still" } };
const graph = { nodes: [source, reframe, still], links: [
  { from: { node: source.id, port: "video" }, to: { node: reframe.id, port: "video" } },
] };
const image = { id: "still", pricing: { per_image: { square: 3 } }, supported_parameters: {} };
const types = { vupload: {}, vedit: { modelKind: "video", modelFilter: "v2v" }, image: { modelKind: "image" } };
const settings = { params: model.supported_parameters.parameters, defaults: model.supported_parameters.defaults };

for (const [file, end] of [["index.html", "function nodeUnitUsd("], ["play.html", "async function nodeUnitUsdPlay("]]) {
  const html = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const element = { hidden: true, innerHTML: "", title: "", focus() {} };
  let normalized, probes = 0, repaints = 0;
  const ctx = {
    console, graph, STATE: { graph }, NODE_TYPES: types, SETTING_MODEL_KIND: { vedit: "video", image: "image" },
    REF_PORT_RE: /^ref\d+$/, COST: {}, RUNS_N: 1, EMBEDDED: false, injectPreflightStyles() {},
    byId: (id) => graph.nodes.find(n => n.id === id),
    catItem: (kind) => kind === "video" ? normalized : { sizePrices: { square: 3 } },
    rawCatItem: async (kind) => kind === "video" ? model : image,
    modelHasImageRole: () => false, videoRefsPriced: () => false,
    t: (s) => s, esc: (s) => s, fmtUsd: (n) => `$${n.toFixed(2)}`,
    $: () => element, ensureRunCostEl: () => element,
    graphHasGifImageNodes: () => false, graphHasGifImageNodesPlay: () => false,
    refreshDemoGhosts() {}, inDemoRun: () => false,
    updateNodePrice: () => repaints++,
    cleanVoiceMediaSeconds: async (_url, isVideo) => { assert.equal(isVideo, true); probes++; return 5.041667; },
    fetch() { throw new Error("network calls are forbidden in this regression"); },
  };
  vm.createContext(ctx);
  const block = html.slice(html.indexOf("const EST = {"), html.indexOf(end));
  vm.runInContext(block + "\nthis.videoUnitUsd=videoUnitUsd; this.inputVideoPriceFields=inputVideoPriceFields; this.inputVideoSecondRate=inputVideoSecondRate;", ctx);
  for (const [resolution, rate] of [["720p", 0.1], ["1080p", 0.2]]) {
    for (const seconds of [0.5, 1, 5, 5.041667, 12.25, 60]) {
      const fields = ctx.inputVideoPriceFields(model.pricing, { resolution, duration: 999 }, { fields: { duration: seconds } }, null);
      near(ctx.videoUnitUsd(model.pricing, fields, false, false, "v2v", settings), seconds * rate);
    }
  }
  assert.equal(ctx.videoUnitUsd(model.pricing, { duration: 5 }, false, false, "v2v", settings), null);
  near(ctx.videoUnitUsd(model.pricing, { inputVideoSeconds: 5 }, false, false, "v2v", settings), 1);
  assert.equal(ctx.videoUnitUsd(model.pricing, { inputVideoSeconds: 5, resolution: "4k" }, false, false, "v2v", settings), null);
  for (const seconds of [null, "", 0, -1, NaN, Infinity, "5 seconds", 60.01]) {
    assert.equal(ctx.videoUnitUsd(model.pricing, { inputVideoSeconds: seconds, resolution: "720p" }, false, false, "v2v", settings), null);
  }
  const changedLimits = { ...model.pricing, maximum_seconds: 400, maximum_frames: 300, max_input_bytes: 100 };
  near(ctx.videoUnitUsd(changedLimits, { inputVideoSeconds: 5, resolution: "720p" }, false, false, "v2v", settings), 0.5);
  near(ctx.inputVideoPriceFields(model.pricing, {}, { fields: { duration: 50 } }, 5.041667).inputVideoSeconds, 5.041667);

  source.fields = {};
  if (file === "index.html") {
    const names = ["normVideo", "imageOutputIsGif", "imageUnitUsd", "livePrice", "nodeUnitUsd", "workflowCost", "refreshRunEstimate", "pickerRowPrice"];
    vm.runInContext(names.map(name => fn(html, name)).join("\n") + "\nthis.api={normVideo,livePrice,nodeUnitUsd,workflowCost,refreshRunEstimate,pickerRowPrice};let picker={kind:'video',filter:'v2v'};", ctx);
    normalized = ctx.api.normVideo(model);
    assert.equal(normalized.price, "$0.20/input s");
    assert.equal(normalized.sortUsd, null);
    assert.equal(ctx.api.pickerRowPrice(normalized), "$0.20/input s");
    for (const [resolution, rate] of [["720p", 0.1], ["1080p", 0.2]]) {
      reframe.fields.resolution = resolution;
      for (const seconds of [0.5, 5, 5.041667, 12.25, 60]) {
        source.fields.duration = seconds;
        near(ctx.api.nodeUnitUsd(reframe), seconds * rate);
        assert.equal(ctx.api.livePrice("video", reframe.fields, "v2v", reframe), `~$${(seconds * rate).toFixed(2)}/clip`);
        near(ctx.api.workflowCost().usd, 3 + seconds * rate);
      }
    }
    source.fields = {};
    assert.match(ctx.api.livePrice("video", reframe.fields, "v2v", reframe), /input s.*Video duration needed/);
    ctx.api.refreshRunEstimate();
    assert.match(element.innerHTML, /3\.00.*subtotal \+ unknown video/);
    assert.doesNotMatch(element.innerHTML, /303|300/);
    graph.nodes = [source, reframe];
    ctx.api.refreshRunEstimate();
    assert.equal(element.hidden, false);
    assert.equal(element.innerHTML, "Video duration needed");
    graph.nodes = [source, reframe, still];
    reframe.fields.resolution = "720p";
    source.fields.video = "https://fixture.invalid/metadata-only.mp4";
    assert.equal(ctx.api.nodeUnitUsd(reframe), null);
    await Promise.resolve(); await Promise.resolve();
    near(ctx.api.nodeUnitUsd(reframe), 0.5041667);
    assert.equal(probes, 1);
    assert.ok(repaints > 0, "measured duration refreshes the card");
  } else {
    const names = ["nodeUnitUsdPlay", "refreshRunCost", "paintRunCost", "showRunPreflight"];
    vm.runInContext("let _runCostToken=0,_runCost=null;\n" + names.map(name => fn(html, name)).join("\n") + "\nthis.api={nodeUnitUsdPlay,refreshRunCost,paintRunCost,showRunPreflight};", ctx);
    for (const [resolution, rate] of [["720p", 0.1], ["1080p", 0.2]]) {
      reframe.fields.resolution = resolution;
      for (const seconds of [0.5, 5, 5.041667, 12.25, 60]) {
        source.fields.duration = seconds;
        near(await ctx.api.nodeUnitUsdPlay(reframe), seconds * rate);
        await ctx.api.refreshRunCost();
        near(ctx.COST.estUsd, 3 + seconds * rate);
      }
    }
    source.fields = {};
    await ctx.api.refreshRunCost();
    assert.match(element.innerHTML, /3\.00.*subtotal \+ unknown video/);
    ctx.api.showRunPreflight();
    assert.match(element.innerHTML, /Video duration needed/);
    assert.doesNotMatch(element.innerHTML, /This app costs about/);
    graph.nodes = [source, reframe];
    await ctx.api.refreshRunCost();
    assert.equal(element.hidden, false);
    assert.match(element.innerHTML, /Video duration needed/);
    assert.doesNotMatch(element.innerHTML, /\$0|300/);
    graph.nodes = [source, reframe, still];
    source.fields.video = "https://fixture.invalid/metadata-only.mp4";
    reframe.fields.resolution = "720p";
    assert.equal(await ctx.api.nodeUnitUsdPlay(reframe), null);
    await Promise.resolve(); await Promise.resolve();
    near(await ctx.api.nodeUnitUsdPlay(reframe), 0.5041667);
    assert.equal(probes, 1);
  }
  console.log(`PASS ${file}: source seconds × resolution; limits ignored; missing-duration subtotal; metadata refresh`);
}
console.log("PASS LTX Reframe quote surfaces — no paid calls");
