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
import { join } from "node:path";
// The node:vm engine harness (extract play.html → run RUNTIME_JS → real
// runGraph/materialize/NODE_TYPES) lives in a shared, side-effect-free module so
// check-gallery.mjs can reuse the exact same engine without re-running this file.
import { ROOT, loadEngine, calls, catalog } from "./play-engine.mjs";

// Seed the best-effort image catalog so the edit node's max_input_images cap can engage in the
// exported engine (mirrors the editor's cap). Model "x" is deliberately absent → an uncatalogued
// model keeps every wired reference (the "no cap → unchanged" path).
catalog.image.push(
  { id: "capmodel1", supported_parameters: { max_input_images: 1 } },
  { id: "capmodel3", supported_parameters: { max_input_images: 3 } },
);

// ---- graph builders -------------------------------------------------------
const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
let _l = 0;
const link = (from, fromPort, to, toPort) => ({ id: "l" + (++_l), from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
const IMG = "data:image/png;base64,IMGDATA";

const chatCalls = () => calls.filter((c) => /\/chat\/completions/.test(c.url));
const imgCalls = () => calls.filter((c) => /\/images\/generations/.test(c.url));
const videoCalls = () => calls.filter((c) => /\/generate-video/.test(c.url));
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
  {
    name: "NEW: Edit node with 2 source images sends imageDataUrl as an ARRAY in wiring order",
    data: { nodes: [node("a", "upload", { image: IMG + "A" }), node("b", "upload", { image: IMG + "B" }),
                    node("e1", "edit", { model: "x", prompt: "put the product in the scene" })],
            links: [link("a", "image", "e1", "image"), link("b", "image", "e1", "image2")] },
    check(app, g, fail) {
      const b = imgCalls()[0]?.body;
      if (!b) return fail("no edit/image call");
      if (!Array.isArray(b.imageDataUrl)) return fail(`multi-ref edit must send imageDataUrl as an ARRAY, got ${typeof b.imageDataUrl}`);
      if (b.imageDataUrl.length !== 2 || b.imageDataUrl[0] !== IMG + "A" || b.imageDataUrl[1] !== IMG + "B")
        fail(`expected [imgA,imgB] in wiring order (image, image2), got ${JSON.stringify(b.imageDataUrl)}`);
      if (b.prompt !== "put the product in the scene") fail("edit instruction not forwarded");
    },
  },
  {
    // THE BUG: a model downgrade hides the surplus ports but leaves their links, which still
    // collect at run time. The exported engine must cap the send to the model's max_input_images
    // (here 1) so it never posts 3 refs a single-image model can't take (a paid call that errors).
    name: "NEW: Edit caps refs to max_input_images (3 wired, maxIn=1 → 1 image sent as a string)",
    data: { nodes: [node("a", "upload", { image: IMG + "A" }), node("b", "upload", { image: IMG + "B" }),
                    node("c", "upload", { image: IMG + "C" }),
                    node("e1", "edit", { model: "capmodel1", prompt: "compose" })],
            links: [link("a", "image", "e1", "image"), link("b", "image", "e1", "image2"), link("c", "image", "e1", "image3")] },
    check(app, g, fail) {
      const b = imgCalls()[0]?.body;
      if (!b) return fail("no edit/image call");
      if (typeof b.imageDataUrl !== "string") return fail(`maxIn=1 must cap to a single STRING image, got ${Array.isArray(b.imageDataUrl) ? `array len ${b.imageDataUrl.length}` : typeof b.imageDataUrl}`);
      if (b.imageDataUrl !== IMG + "A") fail(`must keep the first port (image), got ${JSON.stringify(b.imageDataUrl).slice(0,40)}`);
    },
  },
  {
    name: "NEW: Edit with maxIn=3 sends all 3 refs in order (cap doesn't over-trim)",
    data: { nodes: [node("a", "upload", { image: IMG + "A" }), node("b", "upload", { image: IMG + "B" }),
                    node("c", "upload", { image: IMG + "C" }),
                    node("e1", "edit", { model: "capmodel3", prompt: "compose" })],
            links: [link("a", "image", "e1", "image"), link("b", "image", "e1", "image2"), link("c", "image", "e1", "image3")] },
    check(app, g, fail) {
      const b = imgCalls()[0]?.body;
      if (!b) return fail("no edit/image call");
      if (!Array.isArray(b.imageDataUrl) || b.imageDataUrl.length !== 3) return fail(`maxIn=3 must send all 3, got ${Array.isArray(b.imageDataUrl) ? `len ${b.imageDataUrl.length}` : typeof b.imageDataUrl}`);
      if (b.imageDataUrl[0] !== IMG + "A" || b.imageDataUrl[2] !== IMG + "C") fail(`order must be image,image2,image3, got ${JSON.stringify(b.imageDataUrl)}`);
    },
  },
  {
    name: "NEW: Edit with an uncatalogued model keeps all refs (no cap → unchanged)",
    data: { nodes: [node("a", "upload", { image: IMG + "A" }), node("b", "upload", { image: IMG + "B" }),
                    node("c", "upload", { image: IMG + "C" }),
                    node("e1", "edit", { model: "uncatalogued-x", prompt: "compose" })],
            links: [link("a", "image", "e1", "image"), link("b", "image", "e1", "image2"), link("c", "image", "e1", "image3")] },
    check(app, g, fail) {
      const b = imgCalls()[0]?.body;
      if (!b) return fail("no edit/image call");
      if (!Array.isArray(b.imageDataUrl) || b.imageDataUrl.length !== 3) fail(`an unknown model must not cap (today's behavior), got ${Array.isArray(b.imageDataUrl) ? `len ${b.imageDataUrl.length}` : typeof b.imageDataUrl}`);
    },
  },
  {
    name: "NEW: Edit node with 1 source image still sends imageDataUrl as a STRING (unchanged)",
    data: { nodes: [node("u1", "upload", { image: IMG }), node("e1", "edit", { model: "x", prompt: "make it night" })],
            links: [link("u1", "image", "e1", "image")] },
    check(app, g, fail) {
      const b = imgCalls()[0]?.body;
      if (!b) return fail("no edit/image call");
      if (typeof b.imageDataUrl !== "string") fail(`single-image edit must send imageDataUrl as a STRING, got ${typeof b.imageDataUrl}`);
      if (b.imageDataUrl !== IMG) fail("edit must pass the single source image as the imageDataUrl string");
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
    // Dual-engine parity guard: index.html's vedit.run forwards all three dims (resolution,
    // aspect_ratio, duration); play.html's RUNTIME_JS twin once forwarded ONLY resolution, so
    // exported apps silently rendered wrong-length / wrong-ratio v2v clips and still charged for
    // them. Lock all three into the exported-app generate-video request. (http source URL keeps
    // videoSourceOpts on the no-decode path so the run reaches genVideo under recordingFetch.)
    name: "vedit forwards resolution + aspect_ratio + duration to the video API (exported-app parity)",
    data: { nodes: [node("s1", "vupload", { video: "https://example/clip.mp4" }),
                    node("v1", "vedit", { model: "x", resolution: "1080p", aspect: "9:16", duration: "8" })],
            links: [link("s1", "video", "v1", "video")] },
    check(app, g, fail) {
      const b = videoCalls()[0]?.body;
      if (!b) return fail("no generate-video call recorded");
      if (b.resolution !== "1080p") fail(`resolution not forwarded, got ${JSON.stringify(b.resolution)}`);
      if (b.aspect_ratio !== "9:16") fail(`aspect_ratio dropped (play.html vedit parity bug), got ${JSON.stringify(b.aspect_ratio)}`);
      if (b.duration !== "8") fail(`duration dropped (play.html vedit parity bug), got ${JSON.stringify(b.duration)}`);
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
