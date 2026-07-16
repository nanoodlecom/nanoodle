#!/usr/bin/env node
// End-to-end delegation check for the EDITOR (replace-prep Phase F): index.html's
// njs shim with the njs_engine flag ON must route NETWORK nodes through the
// vendor/njs-engine.js bundle and produce byte-identical NanoGPT request bodies
// (and node outputs) to the flag-OFF built-in runners.
//
// Twin of check-njs-delegation.mjs (which proves the same for play.html's
// runGraph). Here we extract the REAL shim (njsOn/njsCtx/njsRunFor) plus the
// REAL built-in pieces it must match — CTX.genChat/genImage and the llm/image/
// edit node runners — into a node:vm sandbox with a recording fetch, then run
// each scenario down both paths and literal-compare every paid request.
// Also proves: flag off → no delegation; no API key → no delegation; the mdl()
// drift preflight still blocks a delegated run BEFORE any paid request.
//
// Offline; skips cleanly when vendor/njs-engine.js is absent.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "index.html"), "utf8");
const VENDOR = join(ROOT, "vendor", "njs-engine.js");

if (!existsSync(VENDOR)) {
  console.log("⊘ skip njs-editor-delegation: vendor/njs-engine.js missing (run scripts/gen-js-engine.mjs)");
  process.exit(0);
}

/* ---- extraction helpers (same technique as check-image-ports.mjs) -------- */

function braceMatch(src, start, open) {
  let depth = 0;
  for (let j = src.indexOf(open, start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("could not brace-match from: " + src.slice(start, start + 60));
}
function extractFn(name) {
  const at = SRC.search(new RegExp("(async )?function " + name + "\\("));
  if (at === -1) throw new Error(`function ${name}() not found in index.html`);
  return braceMatch(SRC, at, "{");
}
function extractConst(name) {
  const at = SRC.indexOf(`const ${name} = `);
  if (at === -1) throw new Error(`const ${name} not found in index.html`);
  return braceMatch(SRC, at, "{") + ";";
}
// a NODE_TYPES entry's REAL run() — object-literal method, renamed standalone via a wrapper object
const NODE_TYPES_AT = SRC.indexOf("const NODE_TYPES = {");
function extractNodeRun(type) {
  const anchor = SRC.indexOf(`\n  ${type}: {`, NODE_TYPES_AT);
  if (anchor === -1) throw new Error(`${type} node literal not found in index.html`);
  const rs = SRC.indexOf("async run(", anchor);
  if (rs === -1) throw new Error(`${type}.run() not found in index.html`);
  return `({ ${braceMatch(SRC, rs, "{")} }).run`;
}
const grab = (re, what) => { const m = SRC.match(re); if (!m) throw new Error(what + " not found in index.html"); return m[0]; };

/* ---- the real bundle, spy-wrapped so we can prove delegation ran ---------- */

const w = {};
new Function("window", readFileSync(VENDOR, "utf8"))(w);
const ENGINE = w.NanoodleEngine;
assert.ok(ENGINE && ENGINE.RUNNERS && ENGINE.NanoClient, "bundle exposes RUNNERS + NanoClient");

/* ---- canned NanoGPT + recording fetch ------------------------------------ */

const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_B64 = IMG.slice(IMG.indexOf(",") + 1);
// RAW catalog (the library's payload gates read supported_parameters)
const RAW_CAT = {
  "/api/v1/models?detailed=true": [{ id: "x" }],
  "/api/v1/image-models": [{ id: "x", supported_parameters: { max_input_images: 9, max_output_images: 9 } }],
  "/api/v1/video-models": [],
  "/api/v1/audio-models": [],
};
const calls = [];
const respond = (json) => ({
  ok: true, status: 200,
  json: async () => json,
  text: async () => JSON.stringify(json),
  headers: { get: () => null },
});
function fakeFetch(url, opts = {}) {
  const path = String(url).replace(/^https?:\/\/[^/]+/i, "");
  const raw = RAW_CAT[path];
  if (raw) return Promise.resolve(respond({ data: raw }));
  calls.push({ url: path, body: opts.body });
  if (/chat\/completions/.test(path)) return Promise.resolve(respond({ choices: [{ message: { content: "ok" } }] }));
  if (/images\/generations/.test(path)) {
    const n = JSON.parse(opts.body).n || 1;
    return Promise.resolve(respond({ data: Array.from({ length: n }, () => ({ b64_json: PNG_B64 })) }));
  }
  return Promise.reject(new Error("unexpected fetch in test: " + path));
}

/* ---- assemble the sandbox: real shim + real built-in pieces + leaf stubs -- */

const REAL = [
  extractFn("njsOn"), extractFn("njsCatalogRaw"), extractFn("njsCatalogs"),
  extractFn("njsCtx"), extractFn("njsRunFor"),
  grab(/const NJS_TYPES = \{[^\n]*\};/, "NJS_TYPES"),
  grab(/const REF_PORT_RE = \/[^\n]*;/, "REF_PORT_RE"),
  extractFn("withLocale"), extractFn("collectImageInputs"), extractFn("llmOpts"),
  extractFn("chatModelCan"), extractFn("modelSupportsAudio"), extractFn("audioInputPart"),
  extractFn("imgExtra"), extractFn("b64ImageMime"), extractFn("imageUnitUsd"),
  extractFn("authHeaders"), extractFn("sigHash"),
  grab(/const catItem = [^\n]*/, "catItem"),
  grab(/const portIdx = [^\n]*/, "portIdx"),
  grab(/const IMG_PORT_RE = \/[^\n]*;/, "IMG_PORT_RE"),
  grab(/const NANOGPT = "[^\n]*;/, "NANOGPT"),
  grab(/const IMG_ENDPOINT  = [^\n]*;/, "IMG_ENDPOINT"),
  grab(/const CHAT_ENDPOINT = [^\n]*;/, "CHAT_ENDPOINT"),
  "const mdl = " + braceMatch(SRC, SRC.indexOf("(n)=>{", SRC.indexOf("const mdl = ")), "{") + ";",
  "let _njsCat = null; const _njsRaw = {};",
  extractConst("CATALOG"),
  extractConst("CTX"),
  "const RUN = { llm:" + extractNodeRun("llm") + ", image:" + extractNodeRun("image") + ", edit:" + extractNodeRun("edit") + " };",
].join("\n");

function makeCtx({ flagOn, key = "test-api-key", drifted = false, spy = [], directive = null }) {
  const ctx = {
    console, URLSearchParams, JSON, Promise, Object, Array, Math, Number, String, isNaN, isFinite, parseInt, parseFloat, Error, DOMException: Error,
    fetch: fakeFetch,
    location: { search: "" },
    localStorage: { getItem: (k) => (k === "ngpt_key" ? key : k === "njs_engine" ? (flagOn ? "1" : null) : null), setItem() {}, removeItem() {} },
    getKey: () => key,
    window: null,                                  // set below (self-reference)
    // leaf stubs — UI / i18n / registries the extracted code touches but the scenarios don't exercise
    t: (s) => s, toast() {}, flagAuth() {}, accrue() {}, setNodeProgress() {},
    localeDirective: () => directive,              // null = default locale (withLocale passthrough); a string = non-English UI
    modelDrifted: () => drifted,
    httpRunError: (st, tx) => new Error(st + ": " + tx),
    runSignal: () => undefined,
    PENDING_VIDEO: new Map(), PENDING_AUDIO: new Map(),
    maskToSource: (m) => m,
    imgSpec: () => ({ re: /^image\d*$/, cap: 9 }),
    normChat: (x) => x, normImg: (x) => x, normVideo: (x) => x, normAudio: (x) => x,
    SIZES: [["1024x1024", "square"]],
    EST: { chatImageUsd: 0.14 },
    NODE_TYPES: { llm: { audioInput: "audio_input", modelKind: "chat" }, image: { modelKind: "image" }, edit: { modelKind: "image" } },
    // normalized catalog (the editor helpers' view): capability flags flattened, maxOut for the gallery clamp
    catalogs: { chat: [{ id: "x" }], image: [{ id: "x", maxOut: 9, sizePrices: {} }], video: [], audio: [] },
    loraParams: () => ({}), needsCustomCivitai: () => false,
    MEDIA_INLINE_MAX: 4.4 * 1024 * 1024,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  new vm.Script(REAL).runInContext(ctx);
  if (flagOn) {
    const wrapped = { ...ENGINE, RUNNERS: {} };
    for (const [k, fn] of Object.entries(ENGINE.RUNNERS)) wrapped.RUNNERS[k] = (...a) => { spy.push(k); return fn(...a); };
    ctx.NanoodleEngine = wrapped;
  }
  return ctx;
}

/* ---- scenarios: run built-in vs delegated, literal-compare --------------- */

const SCENARIOS = [
  // [name, type, fields, inp, directive] — directive simulates a non-English UI (withLocale must fire on BOTH paths)
  ["llm chat", "llm", { model: "x", system: "You are terse.", prompt: "Hello" }, {}, null],
  ["llm chat localized", "llm", { model: "x", system: "You are terse.", prompt: "Hola" }, {}, "Respond in Spanish."],
  ["image seed", "image", { model: "x", prompt: "a fox", seed: "7" }, {}, null],
  ["edit multi-ref", "edit", { model: "x", prompt: "merge" }, { image: IMG, image2: IMG }, null],
];
const norm = (c) => JSON.stringify(c);

let failed = 0;
for (const [name, type, fields, inp, directive] of SCENARIOS) {
  const n = { id: "n1", type, fields };

  calls.length = 0;
  const off = makeCtx({ flagOn: false, directive });
  assert.equal(off.njsRunFor(type, n, inp, n), null, "flag off → njsRunFor null");
  const outOff = await new vm.Script(`RUN[${JSON.stringify(type)}](${JSON.stringify(n)}, ${JSON.stringify(inp)}, CTX)`).runInContext(off);
  const reqOff = calls.map(norm).sort();

  calls.length = 0;
  const spy = [];
  const on = makeCtx({ flagOn: true, spy, directive });
  const run = on.njsRunFor(type, n, inp, n);
  if (!run) { failed++; console.log(`✗ ${name}: delegation did not engage (njsRunFor returned null)`); continue; }
  const outOn = await run();
  const reqOn = calls.map(norm).sort();

  if (!spy.includes(type)) { failed++; console.log(`✗ ${name}: library runner never ran (spy: ${spy.join(",") || "nothing"})`); continue; }
  if (directive && !reqOn.some((r) => r.includes(directive))) {
    failed++; console.log(`✗ ${name}: delegated request lost the locale directive`); continue;
  }
  if (JSON.stringify(reqOff) !== JSON.stringify(reqOn)) {
    failed++;
    console.log(`✗ ${name}: flag-on requests differ from flag-off\n  off: ${reqOff.join("\n       ")}\n  on:  ${reqOn.join("\n       ")}`);
    continue;
  }
  if (JSON.stringify(outOff) !== JSON.stringify(outOn)) {
    failed++;
    console.log(`✗ ${name}: node output differs\n  off: ${JSON.stringify(outOff)}\n  on:  ${JSON.stringify(outOn)}`);
    continue;
  }
  console.log(`✓ ${name} (${reqOn.length} req byte-identical, out identical, delegated: ${[...new Set(spy)].join(",")})`);
}

// guards: keyless session never delegates; drift preflight blocks BEFORE any paid request
{
  const keyless = makeCtx({ flagOn: true, key: null });
  assert.equal(keyless.njsRunFor("llm", { id: "n1", type: "llm", fields: {} }, {}, { id: "n1" }), null);
  console.log("✓ no API key → built-in path (njsRunFor null)");

  calls.length = 0;
  const dr = makeCtx({ flagOn: true, drifted: true, spy: [] });
  let threw = null;
  await dr.njsRunFor("llm", { id: "n1", type: "llm", fields: { model: "gone", prompt: "hi" } }, {}, { id: "n1" })().catch((e) => { threw = e; });
  assert.ok(threw, "drifted model must throw");
  assert.equal(calls.length, 0, "drift preflight must block before any paid request");
  console.log("✓ drifted model id blocked by mdl() preflight before any paid request");
}

// vetoes: per-run shapes the library doesn't yet match must stay on the built-in path
{
  const on = makeCtx({ flagOn: true });
  const rf = (type, fields, inp, node) => on.njsRunFor(type, { id: "n1", type, fields }, inp, node || { id: "n1", type, fields });
  assert.equal(rf("image", { model: "x", prompt: "p", variations: "2" }, {}), null, "image variations>1 must not delegate (library skips the clamp on catalog miss)");
  assert.notEqual(rf("image", { model: "x", prompt: "p", variations: "1" }, {}), null, "image variations=1 still delegates");
  assert.equal(rf("tvideo", { model: "x", prompt: "p" }, { ref1: IMG }), null, "tvideo with wired refs must not delegate (hardcoded key, no cap)");
  assert.notEqual(rf("tvideo", { model: "x", prompt: "p" }, {}), null, "tvideo without refs still delegates");
  assert.equal(rf("remix", { model: "x", prompt: "p" }, { audio: "blob:null/abc" }), null, "blob: media input must not delegate (library posts the object URL verbatim)");
  assert.equal(rf("vedit", { model: "x", prompt: "p" }, {}), null, "vedit is excluded from NJS_TYPES (library drops wired refs)");
  assert.equal(rf("lipsync", { model: "x" }, {}), null, "lipsync is excluded from NJS_TYPES (library lacks the trim-retry ladder)");
  on.PENDING_VIDEO.set("n1", { sig: 1, runId: "r1" });   // a BUILT-IN engine's pending job (no njs tag)
  assert.equal(rf("ivideo", { model: "x", prompt: "p" }, { image: IMG }), null, "a built-in pending job keeps the node on the built-in engine (resume, don't re-submit)");
  on.PENDING_VIDEO.set("n1", { sig: 1, runId: "r1", njs: true });
  assert.notEqual(rf("ivideo", { model: "x", prompt: "p" }, { image: IMG }), null, "an njs-tagged pending job still delegates (this engine can resume it)");
  console.log("✓ vetoes: gallery clamp / tvideo refs / blob: media / excluded types / foreign pending jobs all fall back to built-in");
}

// keep-pending-on-abort: Stop must NOT delete a submitted (charged) job's pending entry — only a
// genuine failure may. Drives the real njsCtx wrappers with a fake NanoClient.
{
  const on = makeCtx({ flagOn: true });
  const fail = (err) => ({ NanoClient: class { constructor() {} video(m, p, o, i, io2) { io2.onRunId("job-1"); return Promise.reject(err); } } });
  for (const [label, err, expectKept] of [
    ["abort (NanoodleError code aborted)", Object.assign(new Error("run aborted"), { code: "aborted" }), true],
    ["abort (DOMException AbortError)", Object.assign(new Error("Aborted"), { name: "AbortError" }), true],
    ["poll timeout", Object.assign(new Error("timed out"), { code: "timeout" }), true],
    ["genuine job failure", new Error("video failed: content policy"), false],
  ]) {
    on.PENDING_VIDEO.clear();
    const ctx = on.njsCtx(fail(err), { id: "n1" });
    await ctx.video("m", "p", {}, undefined).catch(() => {});
    const kept = on.PENDING_VIDEO.has("n1");
    assert.equal(kept, expectKept, `${label}: pending entry ${expectKept ? "must survive" : "must be deleted"} (got kept=${kept})`);
  }
  console.log("✓ pending jobs survive Stop/timeout and are deleted only on genuine failure");
}

if (failed) { console.log(`\n${failed}/${SCENARIOS.length} editor delegation scenarios failed`); process.exit(1); }
console.log(`\n✓ njs-editor-delegation: flag-gated editor delegation matches the built-in runners (${SCENARIOS.length} scenarios + veto/pending guards)`);
