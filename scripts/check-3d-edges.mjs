#!/usr/bin/env node
// Leftover 3D edges after #620.
// That PR shipped catalog labels, drop routing, CSP drop, sample.glb parse,
// Create-app copy, NJS_TYPES omission, stripInjectedMedia remote/examples/..,
// and the model_url → model.url → video.url chain.
// This file pins the other half: 32 MB IDB cap, serialize stub (name/size, no
// bytes), share blanking, data:/blob: teaching samples stripped, http preview
// refused, spanning-catalog run estimate is never "exact", play.html has no 3D
// runtime, and Create-app resume still wins over the 3D block (without burning
// the one-shot nudge). Offline, zero API spend. New file so it does not collide
// with open leftover PRs.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

function extractFn(src, name) {
  const at = src.search(new RegExp("function " + name + "\\("));
  if (at < 0) throw new Error(name + "() not found");
  let depth = 0;
  for (let j = src.indexOf("{", at); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error("could not brace-match " + name);
}
const grab = (src, re, what) => {
  const m = src.match(re);
  if (!m) throw new Error(what + " not found");
  return m[0];
};

ok(grab(IDX, /const GLB_CAP = 32 \* 1024 \* 1024;/, "GLB_CAP") === "const GLB_CAP = 32 * 1024 * 1024;",
  "GLB_CAP is 32 MB");
ok(/if\(buf\.byteLength > GLB_CAP\)[\s\S]{0,180}return;[\s\S]{0,40}n\._glbBytes = buf/.test(IDX),
  "putGlbBytes refuses oversize before storing bytes");
ok(/if\(bytes\.byteLength <= GLB_CAP\)[\s\S]{0,80}node\._glbBytes = bytes/.test(IDX),
  "serializeGraph only inlines a data: GLB that fits the cap");
ok(IDX.includes('fields.modelFile = { name:n._glbName, size:n._glbSize }')
  || IDX.includes("fields.modelFile = { name:n._glbName, size:n._glbSize}"),
  "the graph keeps a {name, size} stub, not the bytes");
ok(IDX.includes("GLB bytes live in IndexedDB / n._glbBytes, never in the JSON snapshot"),
  "serializeGraph comment still forbids bytes in the snapshot");

{
  const priv = {
    UPLOAD_FIELD: { upload: "image", aupload: "audio", vupload: "video", mupload: "model" },
    SAFE_MEDIA_RE: /^(data:|blob:)/,
    SAMPLE_GLB_RE: /^examples\/[A-Za-z0-9_./-]+\.glb$/,
  };
  vm.createContext(priv);
  vm.runInContext(
    extractFn(IDX, "stripInjectedMedia") + "\n" +
    extractFn(IDX, "glbPreviewUrl") + "\n" +
    extractFn(IDX, "shareableGraph") + "\n" +
    "globalThis.stripInjectedMedia=stripInjectedMedia; globalThis.glbPreviewUrl=glbPreviewUrl; globalThis.shareableGraph=shareableGraph;",
    priv);

  const dataSample = { type: "model3d", fields: { sample: "data:model/gltf-binary;base64,AAAA" } };
  priv.stripInjectedMedia(dataSample);
  ok(!dataSample.fields.sample, "a data: teaching sample is stripped (only examples/*.glb may stay)");

  const blobSample = { type: "model3d", fields: { sample: "blob:https://nanoodle.com/abc" } };
  priv.stripInjectedMedia(blobSample);
  ok(!blobSample.fields.sample, "a blob: teaching sample is stripped");

  const shared = priv.shareableGraph({
    nodes: [{ type: "mupload", fields: { model: "data:model/gltf-binary;base64,AAAA", modelFile: { name: "cup.glb", size: 12 } } }],
    links: [],
  });
  ok(shared.nodes[0].fields.model === "", "shareableGraph blanks the mupload model field");
  ok(shared.nodes[0].fields.modelFile && shared.nodes[0].fields.modelFile.name === "cup.glb",
    "shareableGraph keeps the {name, size} stub (no bytes to leak)");

  ok(priv.glbPreviewUrl("http://cdn.example/a.glb", { allowRemote: true }) === "",
    "http is refused even when remote preview is allowed");
  ok(priv.glbPreviewUrl("javascript:alert(1)", { allowRemote: true }) === "",
    "javascript: is not a preview URL");
  ok(priv.glbPreviewUrl("data:model/gltf-binary;base64,AA") === "data:model/gltf-binary;base64,AA",
    "a data: GLB is previewed locally");
  ok(priv.glbPreviewUrl("blob:https://nanoodle.com/x") === "blob:https://nanoodle.com/x",
    "a blob: GLB is previewed locally");
  ok(priv.glbPreviewUrl("", { allowRemote: true }) === "" && priv.glbPreviewUrl(null) === "",
    "empty / null preview URLs stay empty");
}

{
  const catalogs = { model3d: [] };
  const graph = { nodes: [], links: [] };
  const ctx = {
    _num: (x) => (x != null && isFinite(+x)) ? +x : null,
    NODE_TYPES: {
      model3d: { modelKind: "model3d" },
      image: { modelKind: "image" },
    },
    graph,
    catalogs,
    catItem: (kind, id) => (catalogs[kind] || []).find((m) => m.id === id) || null,
    effectiveModelFields: (n) => n.fields || {},
    nodeUnitUsd: (n) => {
      if (n.type === "model3d") return 0.2;
      if (n.type === "image") return 0.04;
      return null;
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    extractFn(IDX, "fmtUsdPlain") + "\n" +
    extractFn(IDX, "model3dPriceLabels") + "\n" +
    extractFn(IDX, "workflowCost") + "\n" +
    "globalThis.fmtUsdPlain=fmtUsdPlain; globalThis.model3dPriceLabels=model3dPriceLabels; globalThis.workflowCost=workflowCost;",
    ctx);

  const spanning = { id: "trellis", pricing: { per_run: 0.2, per_run_by_variant: { "512": 0.1, "1024": 0.2, "1536": 0.45 } }, defaults: { resolution: "1024" } };
  const single = { id: "tripo", pricing: { per_run: 0.3, per_run_by_variant: { default: 0.3 } }, defaults: {} };
  ctx.catalogs.model3d = [spanning, single];

  ctx.graph.nodes = [{ type: "model3d", fields: { model: "trellis" } }];
  let c = ctx.workflowCost();
  ok(c.exact === false && c.range3d === true && c.off3d === false,
    "a spanning 3D catalog is not an exact bill while knobs are still at default, got " + JSON.stringify(c));
  ok(c.lo === 0.2 && c.hi === 0.2, "default knobs still quote per_run for the chip range");

  ctx.graph.nodes = [{ type: "model3d", fields: { model: "trellis", modelOpts: { resolution: "1536" } } }];
  c = ctx.workflowCost();
  ok(c.exact === false && c.range3d === true && c.off3d === true && c.lo === 0.1 && c.hi === 0.45,
    "once a 3D knob leaves the default the chip range is the variant span, got " + JSON.stringify(c));

  ctx.graph.nodes = [{ type: "model3d", fields: { model: "tripo" } }];
  c = ctx.workflowCost();
  ok(c.exact === true && c.range3d === false && c.off3d === false && c.usd === 0.2,
    "a single-price 3D catalog stays exact, got " + JSON.stringify(c));
}

{
  const ser = {
    graph: { nodes: [] },
    nid: 2, lid: 1, panX: 0, panY: 0, scale: 1,
    GLB_CAP: 32 * 1024 * 1024,
    dataUrlToBytes(url) {
      return url.includes("huge") ? new ArrayBuffer(32 * 1024 * 1024 + 1) : new ArrayBuffer(128);
    },
    URL: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} },
    Blob,
    idbPutGlb() {},
  };
  vm.createContext(ser);
  vm.runInContext(extractFn(IDX, "serializeGraph") + "\nglobalThis.serializeGraph=serializeGraph;", ser);

  ser.graph.nodes = [{
    id: "n1", type: "mupload", x: 0, y: 0, w: 200,
    fields: { model: "data:model/gltf-binary;base64,small", modelFile: { name: "cup.glb", size: 9 } },
  }];
  const small = ser.serializeGraph();
  ok(ser.graph.nodes[0]._glbBytes && ser.graph.nodes[0]._glbBytes.byteLength === 128,
    "serializeGraph lifts a small data: GLB into IndexedDB-backed bytes");
  ok(small.nodes[0].fields.model === "" && small.nodes[0].fields.modelFile
    && small.nodes[0].fields.modelFile.name === "cup.glb" && small.nodes[0].fields.modelFile.size === 128,
    "serialized mupload is a {name, size} stub with a blank model field");
  ok(small.nodes[0]._glbBytes == null, "serialized JSON does not carry the GLB bytes");

  ser.graph.nodes = [{
    id: "n2", type: "mupload", x: 0, y: 0, w: 200,
    fields: { model: "data:model/gltf-binary;base64,huge" },
  }];
  const huge = ser.serializeGraph();
  ok(!ser.graph.nodes[0]._glbBytes, "an oversize data: GLB is not stored");
  ok(huge.nodes[0].fields.model === "" && !huge.nodes[0].fields.modelFile,
    "an oversize data: GLB is blanked and leaves no stub");
}

const resumeAt = IDX.indexOf("appSyncSig()===lastHandoffSig");
const blockAt = IDX.indexOf('n.type==="model3d" || n.type==="mupload"');
const nudgeAt = IDX.indexOf("they've reached the builder — the post-run nudge is spent");
ok(resumeAt > 0 && blockAt > resumeAt, "same-graph Create-app resume returns before the 3D block");
ok(blockAt > 0 && nudgeAt > blockAt, "the 3D block returns before dismissAppNudge (does not burn the one-shot)");
ok(IDX.includes("does not burn the one-shot nudge or open the builder"),
  "Create-app 3D block comment still names the nudge / builder contract");

ok(!/const NJS_TYPES = \{[^}]*model3d/.test(PLAY) && !/const NJS_TYPES = \{[^}]*mupload/.test(PLAY),
  "play RUNTIME NJS_TYPES still has no model3d / mupload");
ok(!PLAY.includes("function putGlbBytes") && !PLAY.includes("function loadGlbViewer") && !PLAY.includes("function model3dStatusUrl"),
  "play.html has no 3D viewer / poll / byte helpers");

ok(IDX.includes("function newModel3dOutKey()") && IDX.includes("fields.model3dOutKey"),
  "paid 3D results are keyed by model3dOutKey, not only node id");
ok(/try\{ if\(typeof restoreModel3dOuts==="function"\) restoreModel3dOuts\(\); \}/.test(IDX),
  "applyGraphData rehydrates 3D outs so Save→Load is not stash-blind");
ok(IDX.includes("restoreModel3dOuts({legacy:true})"),
  "boot load() still accepts a pre-key { n2: url } stash");

{
  const store = new Map();
  const ctx = {
    graph: { nodes: [] },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    crypto: { randomUUID: () => "11111111-2222-3333-4444-555555555555" },
    showResult() {},
    setStatus() {},
  };
  vm.createContext(ctx);
  vm.runInContext(
    extractFn(IDX, "newModel3dOutKey") + "\n" +
    extractFn(IDX, "model3dOutUrl") + "\n" +
    extractFn(IDX, "stashModel3dOuts") + "\n" +
    extractFn(IDX, "restoreModel3dOuts") + "\n" +
    "globalThis.stashModel3dOuts=stashModel3dOuts; globalThis.restoreModel3dOuts=restoreModel3dOuts;",
    ctx);

  const urlA = "https://cdn.example/a.glb";
  const urlB = "https://cdn.example/b.glb";
  ctx.graph.nodes = [{ id: "n2", type: "model3d", fields: {}, out: { model: urlA } }];
  ctx.stashModel3dOuts();
  const afterRun = JSON.parse(store.get("noodle_model3d_out"));
  const key = ctx.graph.nodes[0].fields.model3dOutKey;
  ok(key === "k:11111111-2222-3333-4444-555555555555" && afterRun[key] === urlA,
    "stash mints model3dOutKey and stores the https URL under it");
  ok(afterRun.n2 == null, "stash drops the legacy n2 slot once the result has a stable key");

  // 📂 Load of the same backup: applyGraphData rebuilds nodes without n.out, then restore.
  ctx.graph.nodes = [{ id: "n2", type: "model3d", fields: { model3dOutKey: key }, out: {} }];
  ctx.restoreModel3dOuts();
  ok(ctx.graph.nodes[0].out && ctx.graph.nodes[0].out.model === urlA,
    "restore by model3dOutKey brings the paid GLB back after Save→Load");

  // An Example / other file that reuses n2 but has no key must not inherit urlA.
  ctx.graph.nodes = [{ id: "n2", type: "model3d", fields: {}, out: {} }];
  ctx.restoreModel3dOuts();
  ok(!ctx.graph.nodes[0].out || !ctx.graph.nodes[0].out.model,
    "restore without a key does not attach another workflow's n2 result");

  // save() of that example must MERGE, not rewrite the map to {}.
  ctx.stashModel3dOuts();
  const afterExample = JSON.parse(store.get("noodle_model3d_out"));
  ok(afterExample[key] === urlA,
    "save() on a graph with no 3D out keeps the previous paid URL");

  // Boot load() of a pre-fix graph still reads the old { n2: url } map.
  store.set("noodle_model3d_out", JSON.stringify({ n2: urlB }));
  ctx.graph.nodes = [{ id: "n2", type: "model3d", fields: {}, out: {} }];
  ctx.restoreModel3dOuts({ legacy: true });
  ok(ctx.graph.nodes[0].out && ctx.graph.nodes[0].out.model === urlB,
    "legacy boot restore still accepts { n2: url }");
}

if (fail) { console.error("\n✗ check-3d-edges: " + fail + " failed"); process.exit(1); }
console.log("\n✓ check-3d-edges");
