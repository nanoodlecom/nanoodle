#!/usr/bin/env node
// Leftover paid-3D stash/restore edges after #687.
// That PR shipped key mint, Save→Load restore, no cross-graph n2 attach,
// merge-on-empty-save, legacy boot { n2: url }, and nodeSig ignore.
// This file pins the leftover URL / shape contract those cases never hit:
// only https:// paid URLs enter noodle_model3d_out (blob:/data:/http:/
// javascript: refuse), corrupt or array stash JSON does not throw and does
// not wipe a later https merge, an already-https n.out is not overwritten,
// mupload is not a 3D result, a key without the k: prefix is reminted, and
// a stash entry that is not https does not rehydrate. Offline, zero API
// spend. New file so it does not collide with check-3d-edges.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

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

function harness(store) {
  const ctx = {
    graph: { nodes: [] },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    crypto: { randomUUID: () => "bbbbbbbb-cccc-dddd-eeee-ffffffffffff" },
    showResult() {},
    setStatus() {},
  };
  vm.createContext(ctx);
  vm.runInContext(
    extractFn(IDX, "newModel3dOutKey") + "\n" +
    extractFn(IDX, "model3dOutUrl") + "\n" +
    extractFn(IDX, "stashModel3dOuts") + "\n" +
    extractFn(IDX, "restoreModel3dOuts") + "\n" +
    "globalThis.stashModel3dOuts=stashModel3dOuts; globalThis.restoreModel3dOuts=restoreModel3dOuts; globalThis.model3dOutUrl=model3dOutUrl;",
    ctx
  );
  return ctx;
}

const HTTPS = "https://cdn.example/paid.glb";
const refused = [
  ["blob:https://nanoodle.com/abc", "blob:"],
  ["data:model/gltf-binary;base64,AAAA", "data:"],
  ["http://cdn.example/a.glb", "http://"],
  ["javascript:alert(1)", "javascript:"],
  ["", "empty"],
  [null, "null"],
];
{
  const store = new Map();
  const ctx = harness(store);
  let bad = 0;
  for (const [url, label] of refused) {
    if (ctx.model3dOutUrl(url) !== "") {
      fail(`model3dOutUrl accepted ${label}`);
      bad++;
    }
    ctx.graph.nodes = [{ id: "n2", type: "model3d", fields: {}, out: { model: url } }];
    ctx.stashModel3dOuts();
    const raw = store.get("noodle_model3d_out");
    const map = raw ? JSON.parse(raw) : {};
    if (Object.keys(map).length) {
      fail(`stash stored a ${label} URL: ${JSON.stringify(map)}`);
      bad++;
    }
  }
  if (!bad) ok("blob:/data:/http:/javascript:/empty never enter noodle_model3d_out");
}

{
  const store = new Map();
  store.set("noodle_model3d_out", "{not json");
  const ctx = harness(store);
  ctx.graph.nodes = [{ id: "n2", type: "model3d", fields: {}, out: { model: HTTPS } }];
  try {
    ctx.stashModel3dOuts();
  } catch (e) {
    fail("corrupt stash JSON must not throw: " + (e && e.message));
  }
  const map = JSON.parse(store.get("noodle_model3d_out"));
  const key = ctx.graph.nodes[0].fields.model3dOutKey;
  if (map[key] === HTTPS && Object.keys(map).length === 1)
    ok("corrupt stash JSON hydrates empty and still merges the next https URL");
  else fail("corrupt stash JSON did not recover: " + JSON.stringify(map));
}

{
  const store = new Map();
  store.set("noodle_model3d_out", JSON.stringify(["https://cdn.example/old.glb"]));
  const ctx = harness(store);
  ctx.graph.nodes = [{ id: "n2", type: "model3d", fields: {}, out: { model: HTTPS } }];
  ctx.stashModel3dOuts();
  const map = JSON.parse(store.get("noodle_model3d_out"));
  if (Array.isArray(map) || map[0])
    fail("array stash must be treated as empty, got " + JSON.stringify(map));
  else if (map[ctx.graph.nodes[0].fields.model3dOutKey] === HTTPS)
    ok("array stash is treated as empty and then merges https");
  else fail("array stash recover failed: " + JSON.stringify(map));
}

{
  const store = new Map();
  const ctx = harness(store);
  const keep = "https://cdn.example/already.glb";
  store.set("noodle_model3d_out", JSON.stringify({ "k:other": HTTPS }));
  ctx.graph.nodes = [{
    id: "n2",
    type: "model3d",
    fields: { model3dOutKey: "k:other" },
    out: { model: keep },
  }];
  ctx.restoreModel3dOuts();
  if (ctx.graph.nodes[0].out.model === keep)
    ok("restore does not overwrite an already-https n.out");
  else fail("restore overwrote a live https out: " + ctx.graph.nodes[0].out.model);
}

{
  const store = new Map();
  const ctx = harness(store);
  ctx.graph.nodes = [{ id: "n2", type: "mupload", fields: {}, out: { model: HTTPS } }];
  ctx.stashModel3dOuts();
  const raw = store.get("noodle_model3d_out");
  const map = raw ? JSON.parse(raw) : {};
  if (!Object.keys(map).length) ok("mupload is not stashed as a paid 3D result");
  else fail("mupload leaked into noodle_model3d_out: " + JSON.stringify(map));
}

{
  const store = new Map();
  const ctx = harness(store);
  ctx.graph.nodes = [{
    id: "n2",
    type: "model3d",
    fields: { model3dOutKey: "n2" },
    out: { model: HTTPS },
  }];
  ctx.stashModel3dOuts();
  const key = ctx.graph.nodes[0].fields.model3dOutKey;
  const map = JSON.parse(store.get("noodle_model3d_out"));
  if (key && key.indexOf("k:") === 0 && map[key] === HTTPS && map.n2 == null)
    ok("a key without the k: prefix is reminted before stash");
  else fail("k: remint failed: key=" + key + " map=" + JSON.stringify(map));
}

{
  const store = new Map();
  const ctx = harness(store);
  store.set("noodle_model3d_out", JSON.stringify({ "k:paid": "blob:https://nanoodle.com/x" }));
  ctx.graph.nodes = [{ id: "n2", type: "model3d", fields: { model3dOutKey: "k:paid" }, out: {} }];
  ctx.restoreModel3dOuts();
  if (!ctx.graph.nodes[0].out || !ctx.graph.nodes[0].out.model)
    ok("restore refuses a stash entry that is not https");
  else fail("restore attached a blob: stash entry");
}

{
  const store = new Map();
  const ctx = harness(store);
  ctx.graph.nodes = [{ id: "n2", type: "model3d", fields: { model3dOutKey: "k:missing" }, out: {} }];
  try {
    ctx.restoreModel3dOuts();
  } catch (e) {
    fail("missing stash must not throw: " + (e && e.message));
  }
  if (!ctx.graph.nodes[0].out || !ctx.graph.nodes[0].out.model)
    ok("missing noodle_model3d_out is a no-op restore");
  else fail("missing stash invented an out");
}

if (failed) {
  console.error(`\n✗ check-3d-stash-edges: ${failed} failure(s)`);
  process.exit(1);
}
console.log("✓ check-3d-stash-edges: only https paid GLBs persist; corrupt/array stash and non-https outs stay inert.");
