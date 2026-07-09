#!/usr/bin/env node
// The runtime's deterministic-skip cache: a node with a FIXED seed reproduces the same output
// for the same inputs, so play.html's runGraph reuses its prior output instead of paying for an
// identical generation. This asserts the behavior — and guards the keep-mode hot-loop fix: a
// frozen graph (all fixed-seed cache hits) must report generated===0 so "keep generating" stops
// instead of spinning. Same offline node:vm + recording-fetch technique as check-run-compat.mjs
// (no network, no API spend).
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = join(ROOT, "play.html");

function extractScript(html) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html))) if (!/\bsrc=/i.test(m[1]) && /\bfunction bundle\s*\(/.test(m[2])) return m[2];
  throw new Error("could not find the inline <script> defining bundle() in play.html");
}
function prepare(code) {
  code = code.replace(/import\s*\{[^}]*\}\s*from\s*["'][^"']*patchling[^"']*["'];?/,
    "const buildEnvironment=()=>({}),generateDiff=()=>{},smartapply=()=>{},parseDiffPerFile=()=>{},callLlmForApply=()=>{},setEnv=()=>{};");
  const at = code.indexOf("// SHARE: pack");
  if (at === -1) throw new Error("anchor '// SHARE: pack' not found in play.html — update scripts/check-seed-cache.mjs");
  const hook = ";globalThis.__runTest = { app: window.NoodleApp };throw new Error('__RUN_TEST_HOOK_READY__');\n";
  return code.slice(0, at) + hook + code.slice(at);
}
function inert() {
  const fn = () => p;
  const p = new Proxy(fn, { get(_t, prop) {
    if (prop === Symbol.toPrimitive) return () => "";
    if (prop === Symbol.iterator) return function* () {};
    if (prop === "then") return undefined; return p;
  }, set: () => true, has: () => true, construct: () => p, apply: () => p });
  return p;
}
function scriptAwareDocument(ctx) {
  const base = inert();
  const run = (el) => { const text = el && el.__text; if (text) new vm.Script(text, { filename: "play.html#runtime" }).runInContext(ctx); };
  const head = { appendChild: (el) => (run(el), el), append: (el) => (run(el), el) };
  return new Proxy(base, { get(_t, prop) {
    if (prop === "createElement") return (tag) => String(tag).toLowerCase() === "script"
      ? { set textContent(v) { this.__text = v; }, setAttribute() {}, style: {} } : inert();
    if (prop === "head" || prop === "body") return head; return base[prop];
  }});
}
const calls = [];
function recordingFetch(url, opts = {}) {
  let body = null; try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = opts.body; }
  calls.push({ url: String(url), body });
  let json = {};
  if (/\/images\/generations/.test(url)) { const cnt = Math.max(1, (body && Number(body.n)) || 1);
    json = { data: Array.from({ length: cnt }, (_, i) => ({ b64_json: "IMG" + i })) }; }
  else if (/\/generate-video/.test(url)) json = { runId: "vid-" + calls.filter((c) => /\/generate-video/.test(c.url)).length, cost: 0.1 };
  else if (/\/video\/status/.test(url)) json = { data: { status: "COMPLETED", output: { url: "https://example.com/v.mp4" } } };
  return Promise.resolve({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) });
}
function loadEngine() {
  const code = prepare(extractScript(readFileSync(PLAY, "utf8")));
  const localStorage = { _k: "test-api-key", getItem(k){ return k === "ngpt_key" ? this._k : null; }, setItem(){}, removeItem(){} };
  const ctx = { localStorage, sessionStorage: localStorage,
    location: { origin: "", pathname: "", hash: "", href: "", replace(){} },
    navigator: { clipboard: { writeText: async () => {} } },
    addEventListener(){}, removeEventListener(){}, setTimeout: (fn) => fn && fn(), clearTimeout(){},
    fetch: recordingFetch, console, TextEncoder, TextDecoder, URL, btoa, atob, crypto, performance: { now: () => 0 },
    DOMException: globalThis.DOMException || class DOMException extends Error {} };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.window.parent = ctx;
  ctx.document = scriptAwareDocument(ctx);
  vm.createContext(ctx);
  try { new vm.Script(code, { filename: "play.html#module" }).runInContext(ctx); }
  catch (e) { if (!String(e && e.message).includes("__RUN_TEST_HOOK_READY__")) throw e; }
  if (!ctx.__runTest || !ctx.__runTest.app) throw new Error("run-test hook did not initialize");
  return ctx.__runTest.app;
}

const app = loadEngine();
const imgCount = () => calls.filter((c) => /\/images\/generations/.test(c.url)).length;
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log("  ✗ " + msg); } };

// 1) FIXED seed → second pass is a cache hit (no new API call), generated===0 on pass 2.
{
  calls.length = 0;
  const g = app.materialize({ nodes: [{ id: "si", type: "image", x:0,y:0, fields: { model: "x", prompt: "a cat", size: "512x512", seed: "123" } }], links: [] });
  const r1 = await app.runGraph(g, {}); const after1 = imgCount();
  const r2 = await app.runGraph(g, {}); const after2 = imgCount();
  ok(after1 === 1, `fixed seed: expected 1 call on pass 1, got ${after1}`);
  ok(after2 === 1, `fixed seed: pass 2 must reuse cache (no new call), total now ${after2}`);
  ok(r1.generated >= 1 && r2.generated === 0, `fixed seed: generated should be >=1 then 0, got ${r1.generated}/${r2.generated}`);
  ok(g.byId("si").out.image === "data:image/png;base64,IMG0", "fixed seed: cached output must stay wired through");
}
// 2) KEEP-mode hot-loop guard: an instant local upstream (text→image(seed)) must NOT keep
//    `generated` above 0 once the seeded image cache-hits — else keep mode spins forever.
{
  calls.length = 0;
  const g = app.materialize({ nodes: [
    { id: "tx", type: "text", x:0,y:0, fields: { text: "a cat" } },
    { id: "im", type: "image", x:0,y:0, fields: { model: "x", size: "512x512", seed: "7" } },
  ], links: [{ id:"L1", from:{node:"tx",port:"text"}, to:{node:"im",port:"prompt"} }] });
  const r1 = await app.runGraph(g, {}); const r2 = await app.runGraph(g, {});
  ok(r1.generated === 1, `text→image(seed): pass 1 generated should be 1, got ${r1.generated}`);
  ok(r2.generated === 0, `text→image(seed): pass 2 generated MUST be 0 (text node runs but image cache-hits) so keep mode stops; got ${r2.generated}`);
  ok(imgCount() === 1, `text→image(seed): only 1 image call across both passes, got ${imgCount()}`);
}
// 3) BLANK seed → every pass regenerates (no caching).
{
  calls.length = 0;
  const g = app.materialize({ nodes: [{ id: "ui", type: "image", x:0,y:0, fields: { model: "x", prompt: "a dog", size: "512x512" } }], links: [] });
  await app.runGraph(g, {}); await app.runGraph(g, {});
  ok(imgCount() === 2, `blank seed: must regenerate every pass, got ${imgCount()} calls`);
}
// 4) Changing the seed busts the cache.
{
  calls.length = 0;
  const g = app.materialize({ nodes: [{ id: "sx", type: "image", x:0,y:0, fields: { model: "x", prompt: "fox", size: "512x512", seed: "1" } }], links: [] });
  await app.runGraph(g, {});
  g.byId("sx").fields.seed = "2";
  await app.runGraph(g, {});
  ok(imgCount() === 2, `seed change: must regenerate on a new seed, got ${imgCount()} calls`);
}
// 5) FIXED-seed lipsync is seed-cached (parity with the editor's VIDEO_OPT_NODES).
//    Without lipsync in VIDEO_SEED_NODE every re-run re-billed a paid genVideo.
{
  calls.length = 0;
  const vidCount = () => calls.filter((c) => /\/generate-video/.test(c.url)).length;
  // lipsync needs image+audio inputs — wire upload sources that yield data: media on run.
  const g = app.materialize({
    nodes: [
      { id: "img", type: "upload", x: 0, y: 0, fields: { image: "data:image/png;base64,AA" } },
      { id: "aud", type: "aupload", x: 0, y: 0, fields: { audio: "data:audio/wav;base64,AA" } },
      { id: "ls", type: "lipsync", x: 0, y: 0, fields: { model: "avatar-x", prompt: "", modelOpts: { seed: "42" } } },
    ],
    links: [
      { id: "L1", from: { node: "img", port: "image" }, to: { node: "ls", port: "image" } },
      { id: "L2", from: { node: "aud", port: "audio" }, to: { node: "ls", port: "audio" } },
    ],
  });
  const r1 = await app.runGraph(g, {});
  const after1 = vidCount();
  const r2 = await app.runGraph(g, {});
  const after2 = vidCount();
  ok(after1 === 1, `lipsync fixed seed: expected 1 genVideo on pass 1, got ${after1}`);
  ok(after2 === 1, `lipsync fixed seed: pass 2 must reuse cache (no new genVideo), total now ${after2}`);
  ok(r1.generated >= 1 && r2.generated === 0,
    `lipsync fixed seed: generated should be >=1 then 0, got ${r1.generated}/${r2.generated}`);
}

if (failed) { console.error(`✗ seed-cache: ${failed} assertion(s) failed`); process.exit(1); }
console.log("✓ runtime deterministic-skip cache holds (fixed-seed reuse, keep-mode hot-loop guard, blank-seed regenerate).");
