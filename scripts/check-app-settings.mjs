#!/usr/bin/env node
// Verifies the play page's per-node SETTINGS surface (deriveSettings in
// play.html): the "Optional settings" panel must expose every app's models —
// and the other per-step knobs (size, duration, aspect, frames, …) — as
// swappable controls, WITHOUT ever folding them into the IO signature.
//
// Why a dedicated check: settings are how the runtime lets a user swap a model
// at run time, but they must stay OUT of deriveInputs() — ioSignature() maps
// deriveInputs().kind, and a swapped model / different size must read as
// shape-PRESERVING (no patchling port). One typo that leaks a knob into
// deriveInputs would silently make every model swap look like a breaking edit.
//
// Same cheap technique as check-workflow-compat.mjs (no browser, no inference):
//   1. Pull play.html's module script out as text.
//   2. Run it in a node:vm sandbox with inert DOM stubs, grab window.NoodleApp
//      at the "// SHARE: pack" anchor, then throw a sentinel to halt before the
//      editor's DOM wiring.
//   3. Drive deriveSettings()/deriveInputs() over a table of graphs and assert
//      the right knobs appear, every knob is renderable, and none leak into the
//      input signature.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = join(ROOT, "play.html");

// ---- 1. extract the module script that defines the runtime ----------------
function extractScript(html) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    // skip the generated njs-engine bundle — it carries the library's own deriveSettings
    if (/njs-engine/.test(m[1])) continue;
    if (!/\bsrc=/i.test(m[1]) && /\bfunction deriveSettings\s*\(/.test(m[2])) return m[2];
  }
  throw new Error("could not find the inline <script> defining deriveSettings() in play.html");
}

// ---- 2. make it runnable under node:vm ------------------------------------
function prepare(code) {
  code = code.replace(
    /import\s*\{[^}]*\}\s*from\s*["'][^"']*patchling[^"']*["'];?/,
    "const buildEnvironment=()=>({}),generateDiff=()=>{},smartapply=()=>{},parseDiffPerFile=()=>{},callLlmForApply=()=>{},setEnv=()=>{};",
  );
  const anchor = "// SHARE: pack";
  const at = code.indexOf(anchor);
  if (at === -1)
    throw new Error("anchor '// SHARE: pack' not found in play.html — update scripts/check-app-settings.mjs");
  const hook =
    ";globalThis.__settingsTest = globalThis.NoodleApp;" +
    "throw new Error('__SETTINGS_TEST_HOOK_READY__');\n";
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

// The runtime defines window.NoodleApp by also injecting RUNTIME_JS as a <script>
// element; run that script's text when it's appended (mirrors check-workflow-compat).
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

function loadRuntime() {
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
    if (!String(e && e.message).includes("__SETTINGS_TEST_HOOK_READY__")) throw e;
  }
  if (!ctx.__settingsTest) throw new Error("settings test hook did not initialize (NoodleApp missing)");
  return ctx.__settingsTest;
}

// ---- graph builders -------------------------------------------------------
const node = (id, type, fields) => ({ id, type, fields: fields || {} });
const graph = (nodes, links) => ({ nodes, links: links || [] });

// kinds that fieldHtml() knows how to render
const RENDERABLE = new Set(["model", "select", "number", "boolean", "text", "textarea", "image", "audio", "video"]);
const CATALOG_KINDS = new Set(["chat", "image", "video", "audio"]);

// ---- run ------------------------------------------------------------------
const failures = [];
function fail(msg) { failures.push(msg); }

try {
  const App = loadRuntime();
  for (const fn of ["deriveSettings", "deriveInputs", "materialize"])
    if (typeof App[fn] !== "function") fail(`NoodleApp.${fn}() is not exported — the runtime API changed`);

  if (!failures.length) {
    const settingsOf = (g) => App.deriveSettings(App.materialize(g));
    const inputsOf = (g) => App.deriveInputs(App.materialize(g));
    // index a settings list by field, asserting each entry references its node
    const byField = (list) => {
      const map = {};
      for (const s of list) {
        if (s.nodeId == null || !s.node) fail(`setting "${s.field}" is missing its node reference`);
        if (!RENDERABLE.has(s.kind)) fail(`setting "${s.field}" has unrenderable kind "${s.kind}"`);
        if (s.kind === "model" && !CATALOG_KINDS.has(s.modelKind))
          fail(`model setting "${s.field}" has invalid modelKind "${s.modelKind}"`);
        map[s.field] = s;
      }
      return map;
    };

    // 1) every kind of model-bearing node surfaces a swappable model knob with the right catalog
    const MODEL_NODES = {
      llm: "chat", vision: "chat", image: "image", edit: "image",
      tvideo: "video", ivideo: "video", vedit: "video", lipsync: "video",
      music: "audio", tts: "audio", transcribe: "audio",
    };
    for (const [type, kind] of Object.entries(MODEL_NODES)) {
      const s = byField(settingsOf(graph([node("n1", type, { model: "some/model" })])));
      if (!s.model) { fail(`${type}: no model setting surfaced — its model is not swappable`); continue; }
      if (s.model.kind !== "model") fail(`${type}: model setting kind is "${s.model.kind}", expected "model"`);
      if (s.model.modelKind !== kind) fail(`${type}: model setting modelKind is "${s.model.modelKind}", expected "${kind}"`);
    }

    // 2) representative non-model knobs are present with the expected control kind
    const KNOB = [
      { type: "image",      field: "size",       kind: "select" },
      { type: "tvideo",     field: "duration",   kind: "select" },
      { type: "tvideo",     field: "resolution", kind: "select" },
      { type: "tvideo",     field: "aspect",     kind: "select" },
      { type: "vision",     field: "q",        kind: "textarea" },
      { type: "join",       field: "sep",      kind: "text" },
      { type: "transcribe", field: "language", kind: "text" },
      { type: "music",      field: "instrumental", kind: "boolean" },
      { type: "music",      field: "seed",     kind: "number" },
    ];
    for (const k of KNOB) {
      const s = byField(settingsOf(graph([node("n1", k.type, {})])));
      if (!s[k.field]) fail(`${k.type}: knob "${k.field}" is not surfaced in settings`);
      else if (s[k.field].kind !== k.kind) fail(`${k.type}.${k.field}: kind is "${s[k.field].kind}", expected "${k.kind}"`);
    }
    // select knobs must carry options
    const img = byField(settingsOf(graph([node("n1", "image", {})])));
    if (img.size && !(Array.isArray(img.size.options) && img.size.options.length))
      fail("image.size select has no options");

    // 3) THE invariant: settings must NEVER leak into deriveInputs() (would corrupt ioSignature).
    //    deriveInputs may only emit content kinds — never a knob kind.
    const KNOB_KINDS = new Set(["model", "select", "number", "boolean"]);
    const mixed = graph(
      [node("t1", "text", { text: "a cat" }), node("i1", "image", { model: "m", size: "1024x1024" })],
      [{ from: { node: "t1", port: "text" }, to: { node: "i1", port: "prompt" } }],
    );
    for (const it of inputsOf(mixed))
      if (KNOB_KINDS.has(it.kind)) fail(`deriveInputs leaked a setting (kind "${it.kind}") — ioSignature would break`);
    // an image app's input signature must still be exactly its prompt (one textarea)
    const imgInputs = inputsOf(graph([node("i1", "image", { model: "m", prompt: "a cat" })]));
    if (!(imgInputs.length === 1 && imgInputs[0].kind === "textarea"))
      fail(`image app inputs drifted: expected one textarea, got ${JSON.stringify(imgInputs.map((i) => i.kind))}`);

    // 4) a knob fed by a link is decided upstream → no control offered
    const fedPrompt = graph(
      [node("u1", "upload", {}), node("t1", "text", { text: "x" }), node("v1", "ivideo", {})],
      [
        { from: { node: "u1", port: "image" }, to: { node: "v1", port: "image" } },
        { from: { node: "t1", port: "text" },  to: { node: "v1", port: "prompt" } },
      ],
    );
    if (byField(settingsOf(fedPrompt)).prompt)
      fail("ivideo: a link-fed prompt still offered a setting control (fieldOverride not honored)");

    // 5) aliased/unknown nodes must not crash deriveSettings (audio → tts via materialize)
    const aliased = settingsOf(graph([node("a1", "audio", { model: "m" })]));
    if (!byField(aliased).model) fail("audio (aliased to tts): no model setting after materialize");

    // 6) vframes' frame count is SHAPE-affecting: run() emits frame1..frameN and downstream
    //    links read fixed frameK ports. The knob's floor (min) must rise to the highest wired
    //    frame port, or an app user lowering it starves those consumers mid-run — AFTER the
    //    upstream paid steps already generated and charged. Raising must stay allowed.
    const vfGraph = (outLinks) => graph(
      [node("v1", "vupload", {}), node("f1", "vframes", { frames: "3" }), node("e1", "edit", { model: "m", prompt: "x" })],
      [{ from: { node: "v1", port: "video" }, to: { node: "f1", port: "video" } }, ...outLinks],
    );
    const framesKnob = (outLinks) => byField(settingsOf(vfGraph(outLinks))).frames;
    const wired3 = framesKnob([{ from: { node: "f1", port: "frame3" }, to: { node: "e1", port: "image" } }]);
    if (!wired3) fail("vframes: no frames setting surfaced");
    else if (wired3.min !== 3) fail(`vframes: frames floor must rise to the highest wired frame port (frame3 wired → min 3), got min ${JSON.stringify(wired3.min)}`);
    const wired1 = framesKnob([{ from: { node: "f1", port: "frame1" }, to: { node: "e1", port: "image" } }]);
    if (wired1 && wired1.min !== 1) fail(`vframes: only frame1 wired must keep min 1, got ${JSON.stringify(wired1.min)}`);
    const unwired = byField(settingsOf(graph([node("f1", "vframes", {})]))).frames;
    if (!unwired || unwired.min !== 1 || unwired.max !== 12)
      fail(`vframes: unwired frames knob must keep min 1 / max 12 (raising stays allowed), got min ${unwired && unwired.min} max ${unwired && unwired.max}`);
  }
} catch (e) {
  fail("could not run the settings surface: " + (e && e.stack ? e.stack : e));
}

if (failures.length) {
  process.stderr.write("✗ play page settings surface is wrong:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ play page surfaces swappable models + per-node settings (and keeps them out of the IO signature).\n");
