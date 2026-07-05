#!/usr/bin/env node
// Verifies the workflow-compatibility classifier in play.html: when an app's
// underlying graph is edited, does the builder correctly decide whether the
// customized UI still fits (keep it) or whether the app's input/output SHAPE
// changed (offer a patchling port)?
//
// This is the rule the round-trip hinges on, and it must hold WITHOUT any
// inference — so we test it directly. Same cheap technique as check-export.mjs:
//   1. Pull play.html's module script out as text.
//   2. Run it in a node:vm sandbox with inert DOM stubs, injecting a hook the
//      moment ioSignature()/workflowCompatible() exist, then throw a sentinel to
//      stop before the editor's DOM-wiring code.
//   3. Run a table of "old graph → new graph" edits and assert each is classified
//      compatible (UI kept) or incompatible (needs porting) as expected.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = join(ROOT, "play.html");

// ---- 1. extract the module script that defines the classifier -------------
function extractScript(html) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!/\bsrc=/i.test(m[1]) && /\bfunction ioSignature\s*\(/.test(m[2])) return m[2];
  }
  throw new Error("could not find the inline <script> defining ioSignature() in play.html");
}

// ---- 2. make it runnable under node:vm ------------------------------------
function prepare(code) {
  // Drop the patchling import (only used inside event handlers) and stub the names.
  code = code.replace(
    /import\s*\{[^}]*\}\s*from\s*["'][^"']*patchling[^"']*["'];?/,
    "const buildEnvironment=()=>({}),generateDiff=()=>{},smartapply=()=>{},parseDiffPerFile=()=>{},callLlmForApply=()=>{},setEnv=()=>{};",
  );
  // Inject the hook after shareableGraph()'s definition — by then NoodleApp,
  // ioSignature and workflowCompatible all exist — then throw to halt before
  // the editor's DOM wiring (mirrors scripts/check-export.mjs).
  const anchor = "// SHARE: pack";
  const at = code.indexOf(anchor);
  if (at === -1)
    throw new Error("anchor '// SHARE: pack' not found in play.html — update scripts/check-workflow-compat.mjs");
  const hook =
    ";globalThis.__compatTest = {" +
    "  sig:   (g)    => ioSignature(g)," +
    "  compat:(a, b) => workflowCompatible(a, b)," +
    "  fits:  (s, g) => uiFitsGraph(s, g)," +
    "};" +
    "throw new Error('__COMPAT_TEST_HOOK_READY__');\n";
  return code.slice(0, at) + hook + code.slice(at);
}

// A self-returning, primitive-coercible, non-thenable proxy that absorbs every
// DOM access the top-of-module code makes before our hook fires.
function inert() {
  const fn = () => p;
  const p = new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === Symbol.iterator) return function* () {};
      if (prop === "then") return undefined;
      return p;
    },
    set: () => true,
    has: () => true,
    construct: () => p,
    apply: () => p,
  });
  return p;
}

// The builder defines window.NoodleApp by injecting RUNTIME_JS as a <script> element
// (injectEngineForBuilder). The classifier needs that engine, so unlike check-export
// our document actually RUNS a script element's text in the sandbox when it's appended.
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
      return base[prop]; // everything else stays inert
    },
  });
}

function loadClassifier() {
  const code = prepare(extractScript(readFileSync(PLAY, "utf8")));
  const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const ctx = {
    localStorage, sessionStorage: localStorage,
    location: { origin: "", pathname: "", hash: "", href: "", replace() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    addEventListener() {}, removeEventListener() {}, setTimeout() {}, clearTimeout() {},
    fetch: () => Promise.reject(new Error("no network")),
    console, TextEncoder, TextDecoder, URL, btoa, atob, crypto, performance: { now: () => 0 },
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.window.parent = ctx;
  ctx.document = scriptAwareDocument(ctx);
  vm.createContext(ctx);
  try {
    new vm.Script(code, { filename: "play.html#module" }).runInContext(ctx);
  } catch (e) {
    if (!String(e && e.message).includes("__COMPAT_TEST_HOOK_READY__")) throw e;
  }
  if (!ctx.__compatTest) throw new Error("compat test hook did not initialize");
  return ctx.__compatTest;
}

// ---- graph builders (serialized #g= shape: nodes + from/to-port links) -----
const node = (id, type, fields) => ({ id, type, fields: fields || {} });
const link = (from, to, port) => ({ from: { node: from, port: port || "text" }, to: { node: to, port: "prompt" } });

// A prompt typed straight into an image node (one text input → one image out)
const loneImage = () => ({ nodes: [node("i1", "image", { prompt: "a cat" })], links: [] });
// text → image: same user-facing shape as loneImage (one text input → one image)
const textToImage = (text, extra) => ({
  nodes: [node("t1", "text", { text: text || "a cat" }), node("i1", "image", extra || {})],
  links: [link("t1", "i1")],
});
const textToVideo = () => ({
  nodes: [node("t1", "text", { text: "a cat" }), node("v1", "tvideo", {})],
  links: [{ from: { node: "t1", port: "text" }, to: { node: "v1", port: "prompt" } }],
});
const empty = () => ({ nodes: [], links: [] });

// ---- 3. scenario table: each edit and its expected classification ----------
// compatible:true  → the customized UI still fits, keep it (no port).
// compatible:false → the input/output shape changed, the app must be ported.
const SCENARIOS = [
  { name: "identical graph",                 a: textToImage(),                 b: textToImage(),                 compatible: true },
  { name: "starting text changed",           a: textToImage("a cat"),          b: textToImage("a dog"),          compatible: true },
  { name: "model changed",                   a: textToImage("x", {}),          b: textToImage("x", { model: "flux-pro" }), compatible: true },
  { name: "image size changed",              a: textToImage("x", {}),          b: textToImage("x", { size: "1024x1024" }), compatible: true },
  { name: "same shape, different structure", a: textToImage(),                 b: loneImage(),                   compatible: true },
  { name: "empty ↔ empty",                   a: empty(),                       b: empty(),                       compatible: true },

  { name: "output image → video",            a: textToImage(),                 b: textToVideo(),                 compatible: false },
  { name: "added image input + 2nd output",  a: textToImage(),
    b: { nodes: [node("t1", "text", { text: "a cat" }), node("i1", "image", {}), node("u1", "upload", {})], links: [link("t1", "i1")] },
    compatible: false },
  { name: "empty → has a workflow",          a: empty(),                       b: textToImage(),                 compatible: false },
];

// Extra invariants the classifier must satisfy regardless of scenarios.
function structuralChecks(t, failures) {
  // audio nodes alias to tts (materialize) — must classify, not crash on the unknown type
  const audioGraph = { nodes: [node("a1", "audio", { prompt: "lofi" })], links: [] };
  const ttsGraph = { nodes: [node("s1", "tts", { prompt: "lofi" })], links: [] };
  if (t.sig(audioGraph) === null) failures.push("ioSignature() returned null for an audio node (alias not handled)");
  if (!t.compat(audioGraph, ttsGraph)) failures.push("audio and tts should be compatible (audio aliases to tts)");

  // unknown node types are dropped by materialize → must not affect the signature
  const withUnknown = { nodes: [node("z1", "frobnicate", {}), node("i1", "image", { prompt: "a cat" })], links: [] };
  if (!t.compat(loneImage(), withUnknown)) failures.push("an unknown/dropped node changed the signature — materialize drop not honored");

  // the base signature shape is the documented contract; lock it so a refactor can't silently change it
  const got = t.sig(loneImage());
  const want = JSON.stringify({ ins: ["textarea"], outs: ["image"] });
  if (got !== want) failures.push(`base signature drifted:\n  want: ${want}\n  got:  ${got}`);

  // uiFitsGraph: the UI must be judged against the shape it was AUTHORED for (uiSig),
  // not the last graph swapped in. This is the "declined the port, then tweaked a
  // textbox" bug: the app's stored graph is already the video graph, but the UI was
  // written for an image app, so a later video-shaped edit must still need a port.
  const imageSig = t.sig(textToImage());
  if (!t.fits(imageSig, textToImage("a different prompt")))
    failures.push("uiFitsGraph: an image UI should still fit an image graph after a text-only edit");
  if (t.fits(imageSig, textToVideo()))
    failures.push("uiFitsGraph: an image UI must NOT fit a video graph (port still required)");
  // the regression itself: UI authored for image, graph already swapped to video (port
  // declined), then a *video-shaped* textbox tweak → must still report needs-port.
  const videoAfterTweak = textToVideo(); // same shape as the declined-into graph
  if (t.fits(imageSig, videoAfterTweak))
    failures.push("uiFitsGraph: declined-port app lost its port-needed state after a same-shape edit (regression)");
  if (!t.fits(null, textToVideo()))
    failures.push("uiFitsGraph: a null uiSig (legacy app) should be treated as fitting");
}

// ---- run ------------------------------------------------------------------
const failures = [];
try {
  const t = loadClassifier();
  for (const s of SCENARIOS) {
    const got = t.compat(s.a, s.b);
    if (got !== s.compatible)
      failures.push(`"${s.name}": expected ${s.compatible ? "compatible (keep UI)" : "incompatible (port)"}, got ${got ? "compatible" : "incompatible"}`
        + `\n    sig(old)=${t.sig(s.a)}\n    sig(new)=${t.sig(s.b)}`);
  }
  // compatibility must be symmetric
  for (const s of SCENARIOS)
    if (t.compat(s.a, s.b) !== t.compat(s.b, s.a))
      failures.push(`"${s.name}": classification is not symmetric`);
  structuralChecks(t, failures);
} catch (e) {
  failures.push("could not run the classifier: " + (e && e.stack ? e.stack : e));
}

if (failures.length) {
  process.stderr.write("✗ workflow-compatibility classifier is wrong:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write(`✓ workflow-compatibility classifier holds across ${SCENARIOS.length} scenarios.\n`);
