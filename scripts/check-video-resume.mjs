#!/usr/bin/env node
// A video job bills at /api/generate-video submit and has no client poll deadline (the job runs
// server-side). Re-running the SAME node after Stop must RESUME the in-flight job (poll its runId)
// instead of POSTing — and paying — a second time. Editing the node's inputs must submit a fresh
// job, never resume a stale render. This drives the REAL play.html RUNTIME_JS runGraph() over a
// video graph with a recording fetch (no network, no API spend) and asserts the generate-video
// POST count. Same offline node:vm technique as check-run-compat.mjs.
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
  if (at === -1) throw new Error("anchor '// SHARE: pack' not found in play.html — update scripts/check-video-resume.mjs");
  return code.slice(0, at) + ";globalThis.__t={app:window.NoodleApp};throw new Error('__READY__');\n" + code.slice(at);
}
function inert() {
  const fn = () => p;
  const p = new Proxy(fn, { get(_t, k) { if (k === Symbol.toPrimitive) return () => ""; if (k === Symbol.iterator) return function* () {}; if (k === "then") return undefined; return p; }, set: () => true, has: () => true, construct: () => p, apply: () => p });
  return p;
}
function scriptAwareDocument(ctx) {
  const base = inert();
  const run = (el) => { const t = el && el.__text; if (t) new vm.Script(t, { filename: "play.html#runtime" }).runInContext(ctx); };
  const head = { appendChild: (el) => (run(el), el), append: (el) => (run(el), el) };
  return new Proxy(base, { get(_t, k) {
    if (k === "createElement") return (tag) => String(tag).toLowerCase() === "script" ? { set textContent(v) { this.__text = v; }, setAttribute() {}, style: {} } : inert();
    if (k === "head" || k === "body") return head; return base[k];
  } });
}

// Each engine instance gets its OWN recording fetch so module-level
// PENDING_VIDEO state (and the call log) is isolated per test.
function loadEngine() {
  const calls = [];
  const net = { complete: false };   // flip to true → /video/status reports COMPLETED (resume phase)
  function recordingFetch(url, opts = {}) {
    let body = null; try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = opts.body; }
    calls.push({ url: String(url), body });
    let json = {};
    if (/\/generate-video/.test(url)) json = { runId: "vid-" + calls.filter((c) => /\/generate-video/.test(c.url)).length, cost: 0.25 };
    else if (/\/video\/status/.test(url))
      json = net.complete
        ? { data: { status: "COMPLETED", output: { url: "https://cdn.example/v.mp4" } } }
        : { data: { status: "IN_PROGRESS" } };
    return Promise.resolve({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) });
  }

  const code = prepare(extractScript(readFileSync(PLAY, "utf8")));
  const localStorage = { _k: "test-api-key", getItem(k) { return k === "ngpt_key" ? this._k : null; }, setItem() {}, removeItem() {} };
  const ctx = {
    localStorage, sessionStorage: localStorage,
    location: { origin: "", pathname: "", hash: "", href: "", replace() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    addEventListener() {}, removeEventListener() {}, setTimeout: (fn) => fn && fn(), clearTimeout() {},
    fetch: recordingFetch, console, TextEncoder, TextDecoder, URL, btoa, atob, crypto,
    performance: { now: () => 0 }, Date,
    DOMException: globalThis.DOMException || class DOMException extends Error {},
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.window.parent = ctx;
  ctx.document = scriptAwareDocument(ctx);
  vm.createContext(ctx);
  try { new vm.Script(code, { filename: "play.html#module" }).runInContext(ctx); }
  catch (e) { if (!String(e && e.message).includes("__READY__")) throw e; }
  if (!ctx.__t || !ctx.__t.app) throw new Error("run-test hook did not initialize");
  return { app: ctx.__t.app, calls, net };
}

const tvideo = (id, prompt) => ({ id, type: "tvideo", x: 0, y: 0, fields: { prompt, model: "veo", duration: "5", aspect: "16:9" } });
const graph = (nodes) => ({ nodes, links: [], byId: (id) => nodes.find((n) => n.id === id) });
const posts = (calls) => calls.filter((c) => /\/generate-video/.test(c.url)).length;
const opts = { onStatus() {}, onResult() {}, onStart() {} };

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

// 1) RESUME after Stop: mid-poll abort leaves PENDING_VIDEO so an unchanged re-run never re-POSTs.
{
  const { app, calls, net } = loadEngine();
  const g = graph([tvideo("tv1", "a cat surfing")]);
  // Progress tick after the first status poll: throw AbortError (same shape as Stop waking sleep).
  const stopOpts = { onResult() {}, onStart() {},
    onStatus(id, kind, msg) { if (kind === "run" && /rendering video/.test(String(msg))) throw new DOMException("canceled", "AbortError"); } };
  await app.runGraph(g, stopOpts).catch(() => {});
  ok(posts(calls) === 1, `aborted run submitted exactly once (POSTs=${posts(calls)}, want 1)`);
  net.complete = true;
  await app.runGraph(g, opts).catch(() => {});
  ok(posts(calls) === 1, `Stop mid-poll keeps the job resumable — unchanged re-run polls, never re-POSTs (POSTs=${posts(calls)}, want 1)`);
}

// 2) EDIT INVALIDATES RESUME: changing the node's inputs must submit a fresh job (no stale render).
{
  const { app, calls, net } = loadEngine();
  const n = tvideo("tv1", "a cat surfing");
  const g = graph([n]);
  const stopOpts = { onResult() {}, onStart() {},
    onStatus(id, kind, msg) { if (kind === "run" && /rendering video/.test(String(msg))) throw new DOMException("canceled", "AbortError"); } };
  await app.runGraph(g, stopOpts).catch(() => {});
  n.fields.prompt = "a DOG surfing";                // edit the prompt → payload signature changes
  net.complete = true;
  await app.runGraph(g, opts).catch(() => {});
  ok(posts(calls) === 2, `edited node submits a fresh job, not a stale resume (POSTs=${posts(calls)}, want 2)`);
}

// 3) SIBLING NO-COLLAPSE: two identical-config nodes are distinct jobs (node-id keyed, not content-keyed).
{
  const { app, calls, net } = loadEngine();
  const g = graph([tvideo("tv1", "same prompt"), tvideo("tv2", "same prompt")]);
  net.complete = true;   // both finish on first status poll
  await app.runGraph(g, opts).catch(() => {});
  ok(posts(calls) === 2, `two identical sibling nodes each submit their own job (POSTs=${posts(calls)}, want 2)`);
}

// 4) STRUCTURE (both engines): video poll loop has no hard deadline — wait for NanoGPT / Stop.
for (const file of ["index.html", "play.html"]) {
  const src = readFileSync(join(ROOT, file), "utf8");
  // Match the RUNTIME genVideo poll: after PENDING_VIDEO.set (or the resume branch) the loop is while(true).
  const hasWhileTrue = /while\s*\(\s*true\s*\)\s*\{[\s\S]{0,400}?video\/status/.test(src)
    || /video\/status[\s\S]{0,200}?while\s*\(\s*true\s*\)/.test(src)
    || /no deadline[\s\S]{0,200}?while\s*\(\s*true\s*\)/.test(src);
  const noHardCap = !/while\s*\(\s*Date\.now\(\)\s*-\s*t0\s*<\s*600000\s*\)/.test(src);
  ok(hasWhileTrue && noHardCap, `${file}: genVideo polls with while(true) (no 600000ms hard cap)`);
}

if (fail) { console.error(`\n✗ video-resume: ${fail} assertion(s) failed.`); process.exit(1); }
console.log("\n✓ video-resume: Stopped video jobs resume (charged once), edits resubmit, siblings stay distinct, no 10-min poll cap.");
