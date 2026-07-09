#!/usr/bin/env node
// An async music/TTS job bills at /api/v1/audio/speech submit but can outlast the runtime's
// 5-min poll window. Re-running the SAME node must RESUME the in-flight job (poll its runId)
// instead of POSTing — and paying — a second time. Editing the node's inputs must submit a
// fresh job. Offline node:vm, same technique as check-video-resume.mjs.
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
  if (at === -1) throw new Error("anchor '// SHARE: pack' not found in play.html — update scripts/check-audio-resume.mjs");
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

function loadEngine() {
  const calls = [];
  function recordingFetch(url, opts = {}) {
    let body = null; try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = opts.body; }
    calls.push({ url: String(url), body });
    let json = {};
    // Async music: JSON body with runId, no immediate url → poll path.
    if (/\/audio\/speech/.test(url))
      json = { runId: "aud-" + calls.filter((c) => /\/audio\/speech/.test(c.url)).length, status: "pending", cost: 0.05 };
    else if (/\/tts\/status/.test(url))
      json = { status: "processing" };   // never completes → timeout path
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "application/json" : null) },
      json: async () => json, text: async () => JSON.stringify(json),
    });
  }
  // Controllable clock so the 300000ms poll loop exits fast.
  let clock = 1_000_000;
  const FakeDate = function () { return new Date(0); };
  FakeDate.now = () => (clock += 6000);

  const code = prepare(extractScript(readFileSync(PLAY, "utf8")));
  const localStorage = { _k: "test-api-key", getItem(k) { return k === "ngpt_key" ? this._k : null; }, setItem() {}, removeItem() {} };
  const ctx = {
    localStorage, sessionStorage: localStorage,
    location: { origin: "", pathname: "", hash: "", href: "", replace() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    addEventListener() {}, removeEventListener() {}, setTimeout: (fn) => fn && fn(), clearTimeout() {},
    fetch: recordingFetch, console, TextEncoder, TextDecoder, URL, URLSearchParams, btoa, atob, crypto,
    performance: { now: () => 0 }, Date: FakeDate,
    DOMException: globalThis.DOMException || class DOMException extends Error {},
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.window.parent = ctx;
  ctx.document = scriptAwareDocument(ctx);
  vm.createContext(ctx);
  try { new vm.Script(code, { filename: "play.html#module" }).runInContext(ctx); }
  catch (e) { if (!String(e && e.message).includes("__READY__")) throw e; }
  if (!ctx.__t || !ctx.__t.app) throw new Error("run-test hook did not initialize");
  return { app: ctx.__t.app, calls };
}

const music = (id, prompt) => ({ id, type: "music", x: 0, y: 0, fields: { prompt, model: "x" } });
const graph = (nodes) => ({ nodes, links: [], byId: (id) => nodes.find((n) => n.id === id) });
const posts = (calls) => calls.filter((c) => /\/audio\/speech/.test(c.url)).length;
const opts = { onStatus() {}, onResult() {}, onStart() {} };

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

// 1) RESUME: re-running the same timed-out node must not re-submit (charged once).
{
  const { app, calls } = loadEngine();
  const g = graph([music("m1", "lofi beat")]);
  await app.runGraph(g, opts).catch(() => {});
  await app.runGraph(g, opts).catch(() => {});
  ok(posts(calls) === 1, `timed-out audio job resumed on unchanged re-run (POSTs=${posts(calls)}, want 1)`);
}

// 2) EDIT INVALIDATES RESUME
{
  const { app, calls } = loadEngine();
  const n = music("m1", "lofi beat");
  const g = graph([n]);
  await app.runGraph(g, opts).catch(() => {});
  n.fields.prompt = "jazz piano";
  await app.runGraph(g, opts).catch(() => {});
  ok(posts(calls) === 2, `edited audio node submits a fresh job, not a stale resume (POSTs=${posts(calls)}, want 2)`);
}

// 3) SIBLING NO-COLLAPSE
{
  const { app, calls } = loadEngine();
  const g = graph([music("m1", "same"), music("m2", "same")]);
  await app.runGraph(g, opts).catch(() => {});
  ok(posts(calls) === 2, `two identical sibling music nodes each submit their own job (POSTs=${posts(calls)}, want 2)`);
}

if (fail) { console.error(`\n✗ audio-resume: ${fail} assertion(s) failed.`); process.exit(1); }
console.log("\n✓ audio-resume: timed-out async audio jobs resume (charged once), edits resubmit, siblings stay distinct.");
