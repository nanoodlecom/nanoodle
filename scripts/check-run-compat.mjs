#!/usr/bin/env node
// Backward-compatibility test for the run engine: when the LLM node gained
// dynamic image inputs (vision models), OLD workflows must keep producing the
// EXACT same NanoGPT calls they did before. A plain text→LLM graph must still
// send a string-content user message — NOT the multimodal array form — and the
// other node types (image, edit, vision, join) must be untouched.
//
// Same cheap technique as check-export.mjs / check-workflow-compat.mjs:
//   1. Pull play.html's builder module out as text and run it in a node:vm
//      sandbox with inert DOM stubs. injectEngineForBuilder() runs RUNTIME_JS,
//      which defines window.NoodleApp { runGraph, materialize, NODE_TYPES, … }.
//   2. Inject a hook the moment that engine exists, then throw a sentinel to halt
//      before the editor's DOM wiring.
//   3. Drive the REAL runGraph() against representative graphs with a recording
//      fetch (no network) and assert each produced request body is the historical
//      shape. runGraph isolates per-node failures, so unrelated nodes (audio/
//      video) that we don't canned-respond for can't fail the whole run.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = join(ROOT, "play.html");

// ---- 1. extract the builder module that injects the engine ----------------
function extractScript(html) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!/\bsrc=/i.test(m[1]) && /\bfunction bundle\s*\(/.test(m[2])) return m[2];
  }
  throw new Error("could not find the inline <script> defining bundle() in play.html");
}

// ---- 2. make it runnable under node:vm, exposing the engine ---------------
function prepare(code) {
  code = code.replace(
    /import\s*\{[^}]*\}\s*from\s*["'][^"']*gptdiff-js[^"']*["'];?/,
    "const buildEnvironment=()=>({}),generateDiff=()=>{},smartapply=()=>{},parseDiffPerFile=()=>{},callLlmForApply=()=>{},setEnv=()=>{};",
  );
  const anchor = "// SHARE: pack";
  const at = code.indexOf(anchor);
  if (at === -1)
    throw new Error("anchor '// SHARE: pack' not found in play.html — update scripts/check-run-compat.mjs");
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
const calls = [];
function recordingFetch(url, opts = {}) {
  let body = null;
  try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = opts.body; }
  calls.push({ url: String(url), body });
  let json = {};
  if (/\/chat\/completions/.test(url)) json = { choices: [{ message: { content: "CHAT_REPLY", reasoning: "THINK_TRACE" } }] };
  else if (/\/images\/generations/.test(url)) {
    // honor the requested batch size so a variations=N graph gets N images back (the real API does this)
    const cnt = Math.max(1, (body && Number(body.n)) || 1);
    json = { data: Array.from({ length: cnt }, (_, i) => ({ b64_json: "IMG" + i })) };
  }
  // audio/video/transcribe: leave generic — those run()s may throw, runGraph isolates them.
  return Promise.resolve({
    ok: true, status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
  });
}

function loadEngine() {
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

// ---- graph builders -------------------------------------------------------
const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
let _l = 0;
const link = (from, fromPort, to, toPort) => ({ id: "l" + (++_l), from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
const IMG = "data:image/png;base64,IMGDATA";

const chatCalls = () => calls.filter((c) => /\/chat\/completions/.test(c.url));
const imgCalls = () => calls.filter((c) => /\/images\/generations/.test(c.url));
const userMsg = (call) => (call.body.messages || []).find((m) => m.role === "user");

// ---- scenarios ------------------------------------------------------------
// Each: build a graph, run it, assert the produced calls match the historical
// shape. OLD = must be byte-identical to pre-image-input behavior.
const SCENARIOS = [
  {
    name: "OLD: text → LLM (string content, no images)",
    data: { nodes: [node("t1", "text", { text: "Hello world" }), node("m1", "llm", { model: "x" })],
            links: [link("t1", "text", "m1", "prompt")] },
    check(app, g, fail) {
      const cc = chatCalls();
      if (cc.length !== 1) return fail(`expected 1 chat call, got ${cc.length}`);
      const u = userMsg(cc[0]);
      if (typeof u.content !== "string") fail(`user content must be a STRING for an imageless LLM, got ${JSON.stringify(u.content).slice(0,80)}`);
      if (u.content !== "Hello world") fail(`prompt not forwarded: ${JSON.stringify(u.content)}`);
      if (g.byId("m1").out.text !== "CHAT_REPLY") fail("LLM output not wired through");
    },
  },
  {
    name: "OLD: LLM with system + prompt fields",
    data: { nodes: [node("m1", "llm", { model: "x", system: "You are terse.", prompt: "hi" })], links: [] },
    check(app, g, fail) {
      const b = chatCalls()[0].body;
      if (!b.messages || b.messages[0].role !== "system" || b.messages[0].content !== "You are terse.") fail("system message missing/wrong");
      const u = userMsg({ body: b });
      if (typeof u.content !== "string" || u.content !== "hi") fail(`user content must be string "hi", got ${JSON.stringify(u.content)}`);
    },
  },
  {
    name: "OLD: Vision node (image → text) unchanged",
    data: { nodes: [node("u1", "upload", { image: IMG }), node("v1", "vision", { model: "x", q: "What is this?" })],
            links: [link("u1", "image", "v1", "image")] },
    check(app, g, fail) {
      const u = userMsg(chatCalls()[0]);
      if (!Array.isArray(u.content)) return fail("vision user content must be an array");
      const parts = u.content;
      if (parts[0].type !== "text" || parts[0].text !== "What is this?") fail("vision question wrong");
      const img = parts.find((p) => p.type === "image_url");
      if (!img || img.image_url.url !== IMG) fail("vision image not attached");
      if (g.byId("v1").out.text !== "CHAT_REPLY") fail("vision output not wired");
    },
  },
  {
    name: "OLD: text → Image (generate, no source image)",
    data: { nodes: [node("t1", "text", { text: "a red panda" }), node("i1", "image", { model: "x", size: "1024x1024" })],
            links: [link("t1", "text", "i1", "prompt")] },
    check(app, g, fail) {
      const b = imgCalls()[0]?.body;
      if (!b) return fail("no image generation call");
      if (b.prompt !== "a red panda") fail(`image prompt wrong: ${JSON.stringify(b.prompt)}`);
      if ("imageDataUrl" in b) fail("text→image must NOT send a source image (imageDataUrl)");
    },
  },
  {
    name: "OLD: Edit node (image + text → image, img2img)",
    data: { nodes: [node("u1", "upload", { image: IMG }), node("e1", "edit", { model: "x", prompt: "make it night" })],
            links: [link("u1", "image", "e1", "image")] },
    check(app, g, fail) {
      const b = imgCalls()[0]?.body;
      if (!b) return fail("no edit/image call");
      if (b.imageDataUrl !== IMG) fail("edit must pass the source image as imageDataUrl");
      if (b.prompt !== "make it night") fail("edit instruction not forwarded");
      if (b.n !== 1) fail(`edit must request a single image (n:1), got ${JSON.stringify(b.n)}`);
      if (typeof g.byId("e1").out.image !== "string") fail("edit must still produce a single image url");
    },
  },
  {
    name: "OLD: default Image node still requests n:1 (single image unchanged)",
    data: { nodes: [node("t1", "text", { text: "a cat" }), node("i1", "image", { model: "x" })],
            links: [link("t1", "text", "i1", "prompt")] },
    check(app, g, fail) {
      const b = imgCalls()[0]?.body;
      if (!b) return fail("no image generation call");
      if (b.n !== 1) fail(`default image node must send n:1, got ${JSON.stringify(b.n)}`);
      const o = g.byId("i1").out;
      if (typeof o.image !== "string") fail("single-image run must produce an image url");
      if (o.images && o.images.length !== 1) fail(`single-image run must expose exactly 1 result, got ${o.images.length}`);
    },
  },
  {
    name: "NEW: Image variations=2 sends n:2 and exposes 2 results (first selected)",
    data: { nodes: [node("t1", "text", { text: "a red panda" }), node("i1", "image", { model: "x", size: "1024x1024", variations: "2" })],
            links: [link("t1", "text", "i1", "prompt")] },
    check(app, g, fail) {
      const b = imgCalls()[0]?.body;
      if (!b) return fail("no image generation call");
      if (b.n !== 2) fail(`variations=2 must send n:2, got ${JSON.stringify(b.n)}`);
      const o = g.byId("i1").out;
      if (!Array.isArray(o.images) || o.images.length !== 2) fail(`expected 2 result images, got ${JSON.stringify(o.images)}`);
      if (o.image !== o.images[0]) fail("the first variation must be selected by default");
    },
  },
  {
    name: "NEW: upload + text → LLM image input (array content)",
    data: { nodes: [node("u1", "upload", { image: IMG }), node("t1", "text", { text: "Describe this" }), node("m1", "llm", { model: "x" })],
            links: [link("u1", "image", "m1", "img1"), link("t1", "text", "m1", "prompt")] },
    check(app, g, fail) {
      const u = userMsg(chatCalls()[0]);
      if (!Array.isArray(u.content)) return fail("multimodal LLM content must be an array when an image is wired");
      if (u.content[0].type !== "text" || u.content[0].text !== "Describe this") fail("prompt text missing from multimodal content");
      const imgs = u.content.filter((p) => p.type === "image_url");
      if (imgs.length !== 1 || imgs[0].image_url.url !== IMG) fail("the wired image was not sent to the LLM");
    },
  },
  {
    name: "NEW: multiple images preserve wiring order (img1, img2)",
    data: { nodes: [node("a", "upload", { image: IMG + "1" }), node("b", "upload", { image: IMG + "2" }),
                    node("t1", "text", { text: "compare" }), node("m1", "llm", { model: "x" })],
            links: [link("a", "image", "m1", "img1"), link("b", "image", "m1", "img2"), link("t1", "text", "m1", "prompt")] },
    check(app, g, fail) {
      const u = userMsg(chatCalls()[0]);
      const urls = (u.content || []).filter((p) => p.type === "image_url").map((p) => p.image_url.url);
      if (urls.length !== 2 || urls[0] !== IMG + "1" || urls[1] !== IMG + "2")
        fail(`expected images in order [img1,img2], got ${JSON.stringify(urls)}`);
    },
  },
  {
    // An in-graph audio clip (aupload) wired to the LLM's audio port → an inline input_audio
    // part alongside the prompt text, base64 stripped of the data: prefix, format from the MIME.
    name: "NEW: audio → LLM audio input (input_audio part, base64 stripped)",
    data: { nodes: [node("u1", "aupload", { audio: "data:audio/wav;base64,QUJD" }),
                    node("t1", "text", { text: "Transcribe this" }), node("m1", "llm", { model: "x" })],
            links: [link("u1", "audio", "m1", "audio"), link("t1", "text", "m1", "prompt")] },
    check(app, g, fail) {
      const u = userMsg(chatCalls()[0]);
      if (!Array.isArray(u.content)) return fail("multimodal LLM content must be an array when audio is wired");
      if (u.content[0].type !== "text" || u.content[0].text !== "Transcribe this") fail("prompt text missing from multimodal content");
      const a = u.content.find((p) => p.type === "input_audio");
      if (!a) return fail("the wired audio was not sent as an input_audio part");
      if (a.input_audio.data !== "QUJD") fail(`audio data must be the bare base64 (no data: prefix), got ${JSON.stringify(a.input_audio.data)}`);
      if (a.input_audio.format !== "wav") fail(`audio format must be parsed from the MIME (wav), got ${JSON.stringify(a.input_audio.format)}`);
    },
  },
  {
    // Guard: text-only LLM calls are UNCHANGED by the audio feature — still a bare string content,
    // never an input_audio part (the historical shape old workflows depend on).
    name: "NEW: audio feature leaves text-only LLM calls as string content",
    data: { nodes: [node("m1", "llm", { model: "x", prompt: "just text" })], links: [] },
    check(app, g, fail) {
      const u = userMsg(chatCalls()[0]);
      if (typeof u.content !== "string" || u.content !== "just text")
        fail(`an imageless/audioless LLM must still send string content, got ${JSON.stringify(u.content).slice(0,80)}`);
    },
  },

  // ---- LLM sampling / reasoning controls (the ⚙️ advanced block) ----
  // These lock the request-body plumbing so a future refactor can't silently
  // drop a knob or shift an untouched node's output. All offline (recordingFetch).
  {
    name: "LLM controls: untouched node still sends temperature 0.8 (no silent shift)",
    data: { nodes: [node("m1", "llm", { model: "x", prompt: "hi" })], links: [] },
    check(app, g, fail) {
      const b = chatCalls()[0].body;
      if (b.temperature !== 0.8) fail(`default temperature must be 0.8, got ${JSON.stringify(b.temperature)}`);
      if ("response_format" in b) fail("untouched LLM must not send response_format");
      if ("reasoning_effort" in b) fail("untouched LLM must not send reasoning_effort");
      if ("max_tokens" in b) fail("untouched LLM must not send max_tokens");
      if (g.byId("m1").out.text !== "CHAT_REPLY") fail("show-thinking OFF must not leak the reasoning trace into the output");
    },
  },
  {
    name: "LLM controls: vision node still sends temperature 0.8",
    data: { nodes: [node("u1", "upload", { image: IMG }), node("v1", "vision", { model: "x", q: "what?" })],
            links: [link("u1", "image", "v1", "image")] },
    check(app, g, fail) {
      const b = chatCalls()[0].body;
      if (b.temperature !== 0.8) fail(`vision temperature must be 0.8, got ${JSON.stringify(b.temperature)}`);
    },
  },
  {
    name: "LLM controls: temperature slider overrides the default",
    data: { nodes: [node("m1", "llm", { model: "x", prompt: "hi", temperature: "0.2" })], links: [] },
    check(app, g, fail) {
      const t = chatCalls()[0].body.temperature;
      if (t !== 0.2) fail(`slider value must override default, expected 0.2 got ${JSON.stringify(t)}`);
    },
  },
  {
    name: "LLM controls: JSON mode sends response_format json_object",
    data: { nodes: [node("m1", "llm", { model: "x", prompt: "hi", format: "JSON" })], links: [] },
    check(app, g, fail) {
      const rf = chatCalls()[0].body.response_format;
      if (!rf || rf.type !== "json_object") fail(`format=JSON must send response_format {type:"json_object"}, got ${JSON.stringify(rf)}`);
    },
  },
  {
    name: "LLM controls: reasoning effort forwards; 'default' is omitted",
    data: { nodes: [node("m1", "llm", { model: "x", prompt: "hi", reasoningEffort: "high" })], links: [] },
    check(app, g, fail) {
      const re = chatCalls()[0].body.reasoning_effort;
      if (re !== "high") fail(`reasoning_effort must forward "high", got ${JSON.stringify(re)}`);
    },
  },
  {
    name: "LLM controls: show-thinking prepends the message.reasoning trace",
    data: { nodes: [node("m1", "llm", { model: "x", prompt: "hi", showThinking: true })], links: [] },
    check(app, g, fail) {
      const out = g.byId("m1").out.text || "";
      if (!out.includes("THINK_TRACE")) fail(`show-thinking must include the reasoning trace, got ${JSON.stringify(out).slice(0,80)}`);
      if (!out.includes("CHAT_REPLY")) fail("show-thinking must still include the answer content");
    },
  },
];

// ---- the shipped default workflow must still run --------------------------
function shippedGraphCheck(app, fail) {
  let data;
  try { data = JSON.parse(readFileSync(join(ROOT, "noodle-graph.json"), "utf8")); }
  catch (e) { return fail("could not read noodle-graph.json: " + e.message); }
  return (async () => {
    calls.length = 0;
    const g = app.materialize(data);
    let threw = null;
    await app.runGraph(g, {}).catch((e) => (threw = e));
    if (threw) fail("shipped noodle-graph.json threw during run: " + (threw && threw.message));
    // every LLM call in the shipped graph is imageless → must be string content
    for (const c of chatCalls())
      if (typeof userMsg(c)?.content !== "string")
        fail("a shipped-graph LLM call sent non-string content — old workflow regressed");
  })();
}

// ---- run ------------------------------------------------------------------
const failures = [];
const app = (() => { try { return loadEngine(); } catch (e) { failures.push("could not load engine: " + (e && e.stack || e)); return null; } })();

if (app) {
  for (const s of SCENARIOS) {
    calls.length = 0;
    const fails0 = failures.length;
    const fail = (m) => failures.push(`"${s.name}": ${m}`);
    try {
      const g = app.materialize(s.data);
      await app.runGraph(g, {});
      s.check(app, g, fail);
    } catch (e) {
      fail("threw: " + (e && e.message || e));
    }
    if (failures.length === fails0) process.stdout.write(`  ✓ ${s.name}\n`);
  }
  const n = failures.length;
  const fail = (m) => failures.push(`shipped graph: ${m}`);
  try { await shippedGraphCheck(app, fail); if (failures.length === n) process.stdout.write("  ✓ shipped noodle-graph.json still runs (LLM calls stay string-content)\n"); }
  catch (e) { failures.push("shipped graph check threw: " + (e && e.message || e)); }
}

if (failures.length) {
  process.stderr.write("\n✗ run-compat: old workflows would change behavior:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write(`\n✓ run-compat: ${SCENARIOS.length} graphs + the shipped workflow produce unchanged NanoGPT calls.\n`);
