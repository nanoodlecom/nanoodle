#!/usr/bin/env node
// Leftover 3D edges after #620.
// That PR shipped catalog labels, drop routing, CSP drop, sample.glb parse,
// Create-app copy, NJS_TYPES omission, stripInjectedMedia remote/examples/..,
// and the model_url → model.url → video.url chain.
// This file pins the other half: 32 MB IDB cap, workspace references, portable
// backups, share blanking, data:/blob: teaching samples stripped, http preview
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
  const at = src.search(new RegExp("(?:async )?function " + name + "\\("));
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
ok(/if\(buf\.byteLength > GLB_CAP\)[\s\S]{0,180}return;[\s\S]{0,40}storeUploadedModel\(n, buf, name\)/.test(IDX),
  "putGlbBytes refuses oversize before storing bytes");
ok(/if\(bytes\.byteLength <= GLB_CAP\)[\s\S]{0,80}storeUploadedModel\(node, bytes,/.test(IDX),
  "serializeGraph only inlines a data: GLB that fits the cap");
ok(IDX.includes("fields.modelFile = { name:n._glbName, size:n._glbSize, key }"),
  "workspace snapshots keep a per-upload file reference without model bytes");
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
    nodes: [{ type: "mupload", fields: { model: "data:model/gltf-binary;base64,AAAA", modelFile: { name: "cup.glb", size: 12, key: "file:private" } } }],
    links: [],
  });
  ok(shared.nodes[0].fields.model === "", "shareableGraph blanks the mupload model field");
  ok(shared.nodes[0].fields.modelFile?.name === "cup.glb" && shared.nodes[0].fields.modelFile.key === null,
    "shareableGraph keeps the filename and clears the private file reference");

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
  const db = new Map(), downloads = [];
  let lastUUID = 0;
  const ser = {
    graph: { nodes: [] },
    nid: 2, lid: 1, panX: 0, panY: 0, scale: 1,
    GLB_CAP: 32 * 1024 * 1024,
    crypto: { randomUUID: () => "fixture-" + (++lastUUID) },
    dataUrlToBytes(url) {
      if (url.includes("huge")) return new ArrayBuffer(32 * 1024 * 1024 + 1);
      const bytes = new Uint8Array(128);
      bytes[0] = url.includes("other") ? 2 : 1;
      return bytes.buffer;
    },
    URL: { createObjectURL(blob) { if (blob.type === "application/json") downloads.push(blob); return "blob:test"; }, revokeObjectURL() {} },
    Blob, btoa,
    idbPutGlb(key, record) { db.set(key, record); },
    async idbGetGlb(key) { return db.get(key) || null; },
    byId(id) { return ser.graph.nodes.find(n => n.id === id); },
    document: { createElement() { return { click() {} }; } },
    setTimeout() {}, toast() {}, t: text => text,
  };
  vm.createContext(ser);
  vm.runInContext([
    "uploadedModelName", "modelFileMime", "newModel3dOutKey", "storeUploadedModel",
    "readUploadedModel", "restoreUploadedModel", "serializeGraph", "saveFile", "contentBytesToDataUrl",
  ].map(name => extractFn(IDX, name)).join("\n") +
    "\nObject.assign(globalThis, { serializeGraph, restoreUploadedModel, saveFile });", ser);

  ser.graph.nodes = [{
    id: "n1", type: "mupload", x: 0, y: 0, w: 200,
    fields: { model: "data:model/gltf-binary;base64,small", modelFile: { name: "cup.glb", size: 9 } },
  }];
  const small = ser.serializeGraph();
  ok(ser.graph.nodes[0]._glbBytes && ser.graph.nodes[0]._glbBytes.byteLength === 128,
    "serializeGraph lifts a small data: GLB into IndexedDB-backed bytes");
  ok(small.nodes[0].fields.model === "" && small.nodes[0].fields.modelFile
    && small.nodes[0].fields.modelFile.name === "cup.glb" && small.nodes[0].fields.modelFile.size === 128,
    "workspace serialize preserves mupload metadata with a blank model field");
  ok(small.nodes[0]._glbBytes == null, "serialized JSON does not carry the GLB bytes");

  ser.graph.nodes = [{
    ...small.nodes[0], fields: { model: "data:model/gltf-binary;base64,other", modelFile: { name: "cup.glb", size: 128 } },
  }];
  const other = ser.serializeGraph();
  const original = JSON.parse(JSON.stringify(small.nodes[0]));
  const replacement = JSON.parse(JSON.stringify(other.nodes[0]));
  await ser.restoreUploadedModel(original);
  await ser.restoreUploadedModel(replacement);
  ok(original.fields.modelFile.key !== replacement.fields.modelFile.key &&
    new Uint8Array(original._glbBytes)[0] === 1 && new Uint8Array(replacement._glbBytes)[0] === 2,
    "matching node IDs, filenames and sizes keep separate uploaded bytes");

  ser.graph.nodes = [JSON.parse(JSON.stringify(small.nodes[0]))];
  await ser.saveFile();
  const backup = JSON.parse(await downloads[0].text());
  const saved = backup.nodes[0].fields;
  ok(saved.model.startsWith("data:model/gltf-binary;base64,") &&
    Buffer.from(saved.model.split(",")[1], "base64")[0] === 1 && !saved.modelFile.key &&
    ser.graph.nodes[0].fields.model === "",
    "Save-file reads unloaded bytes from IndexedDB and includes them without changing the workspace snapshot");

  db.set("n1", { name:"cup.glb", bytes:original._glbBytes });
  const legacy = { id:"n1", fields:{ modelFile:{ name:"cup.glb", size:128 } } };
  const shared = { id:"n1", fields:{ modelFile:{ name:"cup.glb", size:128, key:null } } };
  await ser.restoreUploadedModel(legacy);
  await ser.restoreUploadedModel(shared);
  ok(new Uint8Array(legacy._glbBytes)[0] === 1 && !shared._glbBytes,
    "legacy local records still restore and public references need a new upload");

  ser.graph.nodes = [{
    id: "n2", type: "mupload", x: 0, y: 0, w: 200,
    fields: { model: "data:model/gltf-binary;base64,huge" },
  }];
  const huge = ser.serializeGraph();
  ok(!ser.graph.nodes[0]._glbBytes, "an oversize data: GLB is not stored");
  ok(huge.nodes[0].fields.model === "" && !huge.nodes[0].fields.modelFile,
    "an oversize data: GLB is blanked and leaves no stub");
}

const createApp = IDX.slice(IDX.indexOf("function startAppRequest(kind)"), IDX.indexOf('$("makeapp").onclick'));
const canvasOnlyAt = createApp.indexOf("if(usesCanvas && graph.nodes.some");
const blockAt = createApp.indexOf('n.type==="model3d"');
ok(!createApp.includes('n.type==="mupload"'), "3D uploads go through the app builder");
const handoffAt = createApp.indexOf("serializeGraph()");
ok(canvasOnlyAt > 0 && blockAt > canvasOnlyAt, "the 3D guard applies to creating or updating from the canvas");
ok(blockAt > 0 && handoffAt > blockAt && /showCreateAppBlock\(\);\s*return;/.test(createApp.slice(blockAt, handoffAt)),
  "the 3D block shows its warning and returns before the builder handoff");

const PLAY_RUNTIME = PLAY.replace(/<!-- NJS-ENGINE:BEGIN[\s\S]*?NJS-ENGINE:END -->/, "");
ok(!/const NJS_TYPES = \{[^}]*model3d/.test(PLAY_RUNTIME) && !/const NJS_TYPES = \{[^}]*mupload/.test(PLAY_RUNTIME),
  "play RUNTIME NJS_TYPES still has no model3d / mupload");
ok(!PLAY_RUNTIME.includes("function putGlbBytes") && !PLAY_RUNTIME.includes("function loadGlbViewer") && !PLAY_RUNTIME.includes("function model3dStatusUrl"),
  "play runtime has no 3D viewer / poll / byte helpers");

ok(IDX.includes("function newModel3dOutKey()") && IDX.includes("fields.model3dOutKey"),
  "paid 3D results are keyed by model3dOutKey, not only node id");
ok(/delete f\.sel; delete f\.brush; delete f\.model3dOutKey/.test(IDX),
  "nodeSig ignores model3dOutKey the same way it ignores sel/brush");
ok(IDX.includes("function stampModel3dOutKey(") && /stampModel3dOutKey\(n\)/.test(IDX),
  "a successful 3D run stamps the key on the live node, not only the run copy");
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

{
  const sig = { graph: { nodes: [{ id: "n2", type: "model3d", fields: { model: "tripo3d/v2.5", prompt: "a cup" } }] } };
  sig.byId = (id) => sig.graph.nodes.find((n) => n.id === id);
  sig.crypto = { randomUUID: () => "aaaa-bbbb-cccc-dddd-eeeeeeeeeeee" };
  vm.createContext(sig);
  vm.runInContext(
    extractFn(IDX, "sigHash") + "\n" +
    extractFn(IDX, "nodeSig") + "\n" +
    extractFn(IDX, "newModel3dOutKey") + "\n" +
    extractFn(IDX, "stampModel3dOutKey") + "\n" +
    "globalThis.nodeSig=nodeSig; globalThis.stampModel3dOutKey=stampModel3dOutKey;",
    sig);

  const live = sig.graph.nodes[0];
  const inp = { image: "data:image/png;base64,xx" };
  const before = sig.nodeSig(live, inp);
  const copy = { id: live.id, type: live.type, fields: Object.assign({}, live.fields) };
  sig.stampModel3dOutKey(copy);
  const after = sig.nodeSig(live, inp);
  ok(live.fields.model3dOutKey === "k:aaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "stampModel3dOutKey writes the key onto the live node via byId, not only the run copy");
  ok(copy.fields.model3dOutKey === live.fields.model3dOutKey,
    "the run copy is synced to the same key");
  ok(before === after,
    "nodeSig stays " + before + " after model3dOutKey is added (was a re-bill if it moved)");
}

if (fail) { console.error("\n✗ check-3d-edges: " + fail + " failed"); process.exit(1); }
console.log("\n✓ check-3d-edges");
