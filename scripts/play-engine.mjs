// Shared test harness: load play.html's run engine in a node:vm sandbox so a
// checker can drive the REAL runGraph()/materialize()/NODE_TYPES with no browser
// and no network. This module has NO top-level side effects — importing it only
// defines functions — so several check-*.mjs can reuse it without re-running each
// other's assertions.
//
// Technique (same as check-export.mjs):
//   1. Pull play.html's builder <script> out as text.
//   2. Run it in a node:vm context with inert DOM stubs; injectEngineForBuilder()
//      appends a <script> whose text is RUNTIME_JS, which we execute in-context so
//      window.NoodleApp { runGraph, materialize, NODE_TYPES, … } actually exists.
//   3. Throw a sentinel at the "// SHARE: pack" anchor to halt before the editor's
//      DOM wiring, then hand the engine back.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = join(ROOT, "play.html");

// ---- extract the builder module that injects the engine -------------------
function extractScript(html) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!/\bsrc=/i.test(m[1]) && /\bfunction bundle\s*\(/.test(m[2])) return m[2];
  }
  throw new Error("could not find the inline <script> defining bundle() in play.html");
}

// ---- make it runnable under node:vm, exposing the engine ------------------
function prepare(code) {
  code = code.replace(
    /import\s*\{[^}]*\}\s*from\s*["'][^"']*gptdiff-js[^"']*["'];?/,
    "const buildEnvironment=()=>({}),generateDiff=()=>{},smartapply=()=>{},parseDiffPerFile=()=>{},callLlmForApply=()=>{},setEnv=()=>{};",
  );
  const anchor = "// SHARE: pack";
  const at = code.indexOf(anchor);
  if (at === -1)
    throw new Error("anchor '// SHARE: pack' not found in play.html — update scripts/play-engine.mjs");
  // By the anchor, injectEngineForBuilder() has run RUNTIME_JS → window.NoodleApp exists.
  const hook =
    ";globalThis.__runTest = { app: window.NoodleApp };" +
    "throw new Error('__RUN_TEST_HOOK_READY__');\n";
  return code.slice(0, at) + hook + code.slice(at);
}

// A self-returning, primitive-coercible, non-thenable proxy that absorbs DOM
// access the top-of-module code makes before our hook fires.
function inert() {
  const fn = () => p;
  const p = new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === Symbol.iterator) return function* () {};
      if (prop === "then") return undefined;
      return p;
    },
    set: () => true, has: () => true, construct: () => p, apply: () => p,
  });
  return p;
}

// The builder defines window.NoodleApp by appending a <script> whose text is
// RUNTIME_JS (injectEngineForBuilder). Run that script's text in the sandbox so
// the engine — and runGraph/NODE_TYPES — actually exist for us to drive.
function scriptAwareDocument(ctx) {
  const base = inert();
  const run = (el) => {
    const text = el && el.__text;
    if (text) new vm.Script(text, { filename: "play.html#runtime" }).runInContext(ctx);
  };
  const head = { appendChild: (el) => (run(el), el), append: (el) => (run(el), el) };
  return new Proxy(base, {
    get(_t, prop) {
      if (prop === "createElement")
        return (tag) =>
          String(tag).toLowerCase() === "script"
            ? { set textContent(v) { this.__text = v; }, setAttribute() {}, style: {} }
            : inert();
      if (prop === "head" || prop === "body") return head;
      return base[prop];
    },
  });
}

// ---- recording fetch: no network, canned NanoGPT responses ----------------
// Shared `calls` log; a caller resets it with `calls.length = 0` before a run.
export const calls = [];
// Seedable model catalogs (default empty → identical to no-catalog behavior). A capability test seeds
// `catalog.chat = [{ id, capabilities:{…} }]` before a run so the engine's catalog-driven gates
// (chatModelCan / rawCatItem) see real flags for the model ids it drives.
export const catalog = { chat: [], image: [], video: [], audio: [] };
export function recordingFetch(url, opts = {}) {
  let body = null;
  try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = opts.body; }
  calls.push({ url: String(url), body });
  let json = {};
  if (/\/chat\/completions/.test(url)) json = { choices: [{ message: { content: "CHAT_REPLY", reasoning: "THINK_TRACE" } }] };
  else if (/\/api\/v1\/models/.test(url)) json = { data: catalog.chat };
  else if (/\/api\/v1\/image-models/.test(url)) json = { data: catalog.image };
  else if (/\/api\/v1\/video-models/.test(url)) json = { data: catalog.video };
  else if (/\/api\/v1\/audio-models/.test(url)) json = { data: catalog.audio };
  else if (/\/images\/generations/.test(url)) {
    // honor the requested batch size so a variations=N graph gets N images back (the real API does this)
    const cnt = Math.max(1, (body && Number(body.n)) || 1);
    json = { data: Array.from({ length: cnt }, (_, i) => ({ b64_json: "IMG" + i })) };
  }
  // audio/video/transcribe: leave generic — those run()s may throw, runGraph isolates them.
  // Real NanoGPT responses carry the live balance on the x-remaining-balance header (and x-cost on
  // binary paths); mirror that so the engines' header-balance capture is exercised, not skipped.
  const hdr = { "x-remaining-balance": "9.87", "x-cost": "0" };
  return Promise.resolve({
    ok: true, status: 200,
    headers: { get: (k) => hdr[String(k).toLowerCase()] ?? null },
    json: async () => json,
    text: async () => JSON.stringify(json),
  });
}

export function loadEngine() {
  const code = prepare(extractScript(readFileSync(PLAY, "utf8")));
  const localStorage = {
    _k: "test-api-key",
    getItem(k) { return k === "ngpt_key" ? this._k : null; },
    setItem() {}, removeItem() {},
  };
  const ctx = {
    localStorage, sessionStorage: localStorage,
    location: { origin: "", pathname: "", hash: "", href: "", replace() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    addEventListener() {}, removeEventListener() {},
    setTimeout: (fn) => fn && fn(), clearTimeout() {},
    fetch: recordingFetch,
    console, TextEncoder, TextDecoder, URL, btoa, atob, crypto, performance: { now: () => 0 },
    DOMException: globalThis.DOMException || class DOMException extends Error {},
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.window.parent = ctx; // parent===window → EMBEDDED false
  ctx.document = scriptAwareDocument(ctx);
  vm.createContext(ctx);
  try {
    new vm.Script(code, { filename: "play.html#module" }).runInContext(ctx);
  } catch (e) {
    if (!String(e && e.message).includes("__RUN_TEST_HOOK_READY__")) throw e;
  }
  if (!ctx.__runTest || !ctx.__runTest.app) throw new Error("run-test hook did not initialize");
  return ctx.__runTest.app;
}
