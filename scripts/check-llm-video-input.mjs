#!/usr/bin/env node
// Video input on the LLM node (video_input chat models, e.g. google/gemini-4-argon).
//
// The live NanoGPT catalog flags google/gemini-4-argon with capabilities.video_input:true and
// architecture.input_modalities ["text","image","video","audio"], but the LLM node only grew
// image + audio ports. This pins the video port on both engines:
//   editor: NODE_TYPES.llm.videoInput, modelSupportsVideo gate, videoInputPart → video_url part,
//           dropped + toasted for a known non-video model, permissive on catalog miss.
//   play:   RUNTIME llm declares videoInput and its run() sends the same video_url part.
// Offline, no spend.
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


const ARGON = "google/gemini-4-argon";
const nodeLit = IDX.slice(IDX.indexOf("\n  llm: {\n"), IDX.indexOf("async run(", IDX.indexOf("\n  llm: {\n")));
ok(/videoInput:"video_input"/.test(nodeLit), "editor: llm node declares videoInput:\"video_input\"");
ok(/function refreshVideoInput\(n\)/.test(IDX) && /data-port="video"/.test(extractFn(IDX, "refreshVideoInput")),
  "editor: refreshVideoInput renders a port named \"video\"");
ok(/if\(type==="video" && \(t\.videoInputs \|\| t\.videoInput\)\) return true;/.test(IDX),
  "editor: quick-add offers the LLM node for a dragged video wire");

const toasts = [];
let sent = null;
const editorCtx = {
  console, graph: { links: [] },
  NODE_TYPES: { llm: { imageInputs: "vision", modelKind: "chat", audioInput: "audio_input", videoInput: "video_input" } },
  catItem: (kind, id) =>
    id === ARGON ? { vision: true, audio_input: true, video_input: true } :
    id === "text-only" ? { vision: false, audio_input: false, video_input: false } : null,
  mdl: (n) => n.fields.model,
  toast: (msg, kind) => toasts.push({ msg, kind }),
  urlToDataUrl: async (u) => "data:video/mp4;base64,BLOB",
  MEDIA_INLINE_MAX: 4.4 * 1024 * 1024,
};
vm.createContext(editorCtx);
new vm.Script(
  grab(/const IMG_PORT_RE = \/[^\n]*;/, "IMG_PORT_RE") + "\n" +
  grab(/const EDIT_IMG_RE = \/[^\n]*;/, "EDIT_IMG_RE") + "\n" +
  grab(/const portIdx = [^\n]*;/, "portIdx") + "\n" +
  grab(/const IMG_INPUT_ROLES = \{[^\n]*\};/, "IMG_INPUT_ROLES") + "\n" +
  ["modelSupportsImages", "imgSpec", "collectImageInputs", "modelSupportsAudio", "modelSupportsVideo",
   "videoInputPart", "audioInputPart", "llmOpts", "chatModelCan"].map((n) => extractFn(IDX, n)).join("\n") + "\n" +
  extractNodeRun(IDX, "llm", "__llmRun") + "\n" +
  "globalThis.__t = { llmRun: __llmRun, modelSupportsVideo, videoInputPart };",
).runInContext(editorCtx);
const T = editorCtx.__t;
const vidParts = () => (sent || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === "video_url");
async function run(model, inp) {
  toasts.length = 0; sent = null;
  await T.llmRun({ id: "m1", type: "llm", fields: { model, prompt: "hi" } }, inp,
    { genChat: async (messages) => { sent = messages; return "TEXT"; } });
}
const CLIP = "https://cdn.example.com/clip.mp4";
await run(ARGON, { video: CLIP, prompt: "Describe the clip" });
ok(vidParts().length === 1 && vidParts()[0].video_url.url === CLIP, "editor: Argon sends the wired https clip as a video_url part (URL passed through)");
ok(toasts.length === 0, "editor: Argon warns nothing");
await run(ARGON, { video: "blob:local-trim", prompt: "hi" });
ok(vidParts().length === 1 && /^data:video\//.test(vidParts()[0].video_url.url), "editor: a page-local blob: clip is inlined as a data:video URL");
await run("text-only", { video: CLIP, prompt: "hi" });
ok(vidParts().length === 0 && toasts.length === 1 && /video ignored/.test(toasts[0].msg), "editor: known non-video model drops the clip and warns once");
await run("typed-in-id", { video: CLIP, prompt: "hi" });
ok(vidParts().length === 1, "editor: uncatalogued model stays permissive");
ok(T.modelSupportsVideo({ type: "llm", fields: { model: ARGON } }) === true, "editor: modelSupportsVideo(Argon) is true (port enabled)");
ok(T.modelSupportsVideo({ type: "llm", fields: { model: "text-only" } }) === false, "editor: modelSupportsVideo(text-only) is false (disabled stub)");
let threw = false;
try { T.videoInputPart("data:video/mp4;base64," + "A".repeat(5 * 1024 * 1024)); } catch { threw = true; }
ok(threw, "editor: oversized inline clip is refused before the paid POST");

// ---- play side: drive the REAL runGraph() ----
catalog.chat = [
  { id: ARGON, capabilities: { vision: true, audio_input: true, video_input: true } },
  { id: "text-only", capabilities: {} },
];
const app = loadEngine();
ok(app.NODE_TYPES.llm.videoInput === "video_input", "play: RUNTIME llm declares videoInput");
const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
async function playRun(model) {
  calls.length = 0;
  const g = app.materialize({ nodes: [
    node("v1", "upload", { image: CLIP }),
    node("m1", "llm", { model, prompt: "Describe the clip" }),
  ], links: [{ id: "l1", from: { node: "v1", port: "image" }, to: { node: "m1", port: "video" } }] });
  await app.runGraph(g, {});
  const c = calls.find((c) => /\/chat\/completions/.test(c.url));
  return c ? c.body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === "video_url") : null;
}
{
  const parts = await playRun(ARGON);
  ok(parts && parts.length === 1 && parts[0].video_url.url === CLIP, `play: Argon sends the wired clip as video_url, got ${JSON.stringify(parts)}`);
}
{
  const parts = await playRun("text-only");
  ok(parts && parts.length === 0, "play: known non-video model drops the wired clip");
}

if (fail) { console.error(`\n✗ llm-video-input: ${fail} assertion(s) failed.`); process.exit(1); }
console.log("\n✓ llm-video-input: video_input chat models (Gemini 4 Argon) get a video port that sends a video_url part on both engines.");
