#!/usr/bin/env node
// Vision gate for the LLM node's wired image ports (twin of the audio gate).
//
// A wire left on a disabled image socket (pick a vision model, wire img1, swap to a
// text-only model — imageInputDefs renders the socket disabled but the LINK survives)
// used to ride into the paid chat POST as image_url parts the model cannot see but
// NanoGPT still bills. The audio port had the same shape and was fixed with a
// capability gate (modelSupportsAudio / chatModelCan("audio_input") + drop + warn);
// images had no gate on either engine. This pins the twin:
//
//   editor (index.html llm run): modelSupportsImages(n) gates collectImageInputs —
//     known text-only drops + toasts, vision/unknown keeps, permissive on miss.
//   play (play.html RUNTIME llm run): chatModelCan(model, "vision") gates the POST —
//     known text-only drops + notes, vision keeps.
//
// Offline: editor side extracts the REAL functions + the REAL llm run() (same
// technique as check-image-ports.mjs); play side drives the REAL runGraph() with a
// seeded catalog (same harness as check-llm-capability-gates.mjs). No browser, no spend.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadEngine, calls, catalog } from "./play-engine.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");

let fail = 0;
const ok = (c, m) => {
  if (!c) { fail++; console.log("  ✗ " + m); }
  else console.log("  ✓ " + m);
};

function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error(name + "() not found in index.html");
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("could not brace-match " + name + "()");
}
const grab = (re, what) => {
  const m = IDX.match(re);
  if (!m) throw new Error(what + " not found in index.html");
  return m[0];
};
function extractNodeRun(src, type, alias) {
  const anchor = src.indexOf("\n  " + type + ": {\n");
  if (anchor === -1) throw new Error(type + " node literal not found in index.html");
  const rs = src.indexOf("async run(", anchor);
  if (rs === -1) throw new Error(type + ".run() not found in index.html");
  let depth = 0;
  for (let j = src.indexOf("{", rs); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0)
      return src.slice(rs, j + 1).replace(/^async run/, "async function " + alias);
  }
  throw new Error("could not brace-match " + type + ".run()");
}

// ---- editor side: drive the REAL llm run() --------------------------------
const toasts = [];
let sentMessages = null;
const editorCtx = {
  console,
  graph: { links: [] },
  NODE_TYPES: { llm: { imageInputs: "vision", modelKind: "chat", audioInput: "audio_input" } },
  // normalized catalog shape (normChat): vision/audio_input booleans; miss → undefined.
  catItem: (kind, id) =>
    id === "vision-yes" ? { vision: true, audio_input: false } :
    id === "vision-no" ? { vision: false, audio_input: false } : null,
  mdl: (n) => n.fields.model,
  toast: (msg, kind) => toasts.push({ msg, kind }),
  urlToDataUrl: async (u) => u,
  MEDIA_INLINE_MAX: 4 * 1024 * 1024,
};
vm.createContext(editorCtx);
new vm.Script(
  grab(/const IMG_PORT_RE = \/[^\n]*;/, "IMG_PORT_RE") + "\n" +
  grab(/const EDIT_IMG_RE = \/[^\n]*;/, "EDIT_IMG_RE") + "\n" +
  grab(/const portIdx = [^\n]*;/, "portIdx") + "\n" +
  grab(/const IMG_INPUT_ROLES = \{[^\n]*\};/, "IMG_INPUT_ROLES") + "\n" +
  ["modelSupportsImages", "imgSpec", "collectImageInputs", "modelSupportsAudio",
   "audioInputPart", "llmOpts", "chatModelCan"].map((n) => extractFn(IDX, n)).join("\n") + "\n" +
  extractNodeRun(IDX, "llm", "__llmRun") + "\n" +
  "globalThis.__t = { llmRun: __llmRun, modelSupportsImages };",
).runInContext(editorCtx);
const T = editorCtx.__t;

const IMG = "data:image/png;base64,AA";
async function editorRun(model, inp) {
  toasts.length = 0;
  sentMessages = null;
  const out = await T.llmRun(
    { id: "m1", type: "llm", fields: { model, prompt: "hi" } },
    inp,
    { genChat: async (messages) => { sentMessages = messages; return "TEXT"; } },
  );
  return out;
}
const imgParts = () =>
  (sentMessages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((p) => p.type === "image_url");

{
  await editorRun("vision-yes", { img1: IMG, prompt: "hi" });
  ok(imgParts().length === 1, "editor: vision model keeps the wired image_url part");
  ok(toasts.length === 0, "editor: vision model warns nothing");
}
{
  await editorRun("vision-no", { img1: IMG, img2: IMG, prompt: "hi" });
  ok(imgParts().length === 0, "editor: known text-only model drops wired images (no billed image tokens it cannot see)");
  ok(toasts.length === 1 && /text-only/i.test(toasts[0].msg),
    `editor: dropping images warns once ("...text-only..."), got ${JSON.stringify(toasts)}`);
}
{
  await editorRun("typed-in-id", { img1: IMG, prompt: "hi" });
  ok(imgParts().length === 1, "editor: uncatalogued model stays permissive (keeps the image, no false drop)");
  ok(toasts.length === 0, "editor: uncatalogued model warns nothing");
}
ok(T.modelSupportsImages({ id: "m1", type: "llm", fields: { model: "vision-no" } }) === false,
  "editor modelSupportsImages: known text-only reports incapable (the disabled-socket signal)");

// ---- play side: drive the REAL runGraph() -----------------------------------
catalog.chat = [
  { id: "vision-yes", capabilities: { vision: true } },
  { id: "vision-no", capabilities: {} },
  // exact live id from the #563 follow-up (NanoGPT 400: "does not support image inputs") —
  // present with no vision flag = known text-only.
  { id: "mistralai/mistral-small-24b-instruct-2501", capabilities: {} },
];
const app = loadEngine();
const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
let _l = 0;
const link = (from, fromPort, to, toPort) => ({ id: "l" + (++_l), from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
const chatCalls = () => calls.filter((c) => /\/chat\/completions/.test(c.url));
const chatImgParts = (call) =>
  (call.body.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((p) => p.type === "image_url");

async function playRun(model) {
  calls.length = 0;
  const notes = [];
  const g = app.materialize({ nodes: [
    node("u1", "upload", { image: IMG }),
    node("t1", "text", { text: "Describe" }),
    node("m1", "llm", { model, prompt: "hi" }),
  ], links: [
    link("u1", "image", "m1", "img1"),
    link("t1", "text", "m1", "prompt"),
  ]});
  await app.runGraph(g, { onStatus: (id, kind, msg) => notes.push(String(msg || "")) });
  return { call: chatCalls()[0], notes };
}

{
  const { call } = await playRun("vision-yes");
  ok(call && chatImgParts(call).length === 1, "play: vision model keeps the wired image_url part");
}
{
  const { call, notes } = await playRun("vision-no");
  ok(call && chatImgParts(call).length === 0, "play: known text-only model drops the wired image (no billed image tokens it cannot see)");
  ok(notes.some((m) => /image.*ignored.*text-only/i.test(m)),
    `play: dropping the image surfaces a note, notes=${JSON.stringify(notes)}`);
}
{
  // Live incident (#563 follow-up): the model arrived via a Choice wire, not the typed field —
  // the gate must read the RESOLVED model (rn). Exact repro: img1 wired on a vision model, then
  // mistralai/mistral-small-24b-instruct-2501 selected. NanoGPT 400'd "does not support image
  // inputs" because the delegated path (default ON) bypassed the built-in gate; the built-in
  // path below must drop + note.
  calls.length = 0;
  const notes = [];
  const MISTRAL = "mistralai/mistral-small-24b-instruct-2501";
  const g = app.materialize({ nodes: [
    node("u1", "upload", { image: IMG }),
    node("t1", "text", { text: "Describe" }),
    node("c1", "choice", { options: MISTRAL, selected: MISTRAL }),
    node("m1", "llm", { model: "vision-yes", prompt: "hi" }),
  ], links: [
    link("u1", "image", "m1", "img1"),
    link("t1", "text", "m1", "prompt"),
    link("c1", "text", "m1", "model"),
  ]});
  await app.runGraph(g, { onStatus: (id, kind, msg) => notes.push(String(msg || "")) });
  const call = chatCalls()[0];
  ok(call && chatImgParts(call).length === 0, "play: Choice-wired text-only model drops the wired image (gate reads the resolved model)");
  ok(notes.some((m) => /image.*ignored.*text-only/i.test(m)),
    `play: Choice-wired drop surfaces a note, notes=${JSON.stringify(notes)}`);
}
{
  // Drift preflight (assertModelAvailable) supersedes permissive-keep for a catalog-MISSING
  // model — same as the audio scenarios in check-llm-capability-gates.mjs.
  calls.length = 0;
  const g = app.materialize({ nodes: [node("m1", "llm", { model: "not-in-catalog", prompt: "hi" })], links: [] });
  await app.runGraph(g, {});
  ok(!chatCalls().length, "play: catalog-missing (drifted) model is blocked before any send");
}

if (fail) {
  console.error(`\n✗ vision-image-gate: ${fail} assertion(s) failed.`);
  process.exit(1);
}
console.log("\n✓ vision-image-gate: wired images ride only to models that can see them — dropped + disclosed on known text-only, kept on vision, permissive on unknown; drifted ids still blocked pre-send.");
