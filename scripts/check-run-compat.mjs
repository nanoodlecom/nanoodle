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
import vm from "node:vm";
// The node:vm engine harness (extract play.html → run RUNTIME_JS → real
// runGraph/materialize/NODE_TYPES) lives in a shared, side-effect-free module so
// check-gallery.mjs can reuse the exact same engine without re-running this file.
import { ROOT, loadEngine, calls, catalog } from "./play-engine.mjs";

// Seed the best-effort image catalog so the edit node's max_input_images cap can engage in the
// exported engine (mirrors the editor's cap). capmodel1/3 advertise a small cap; "x" is the
// payload-shape placeholder every image/edit fixture uses — it carries GENEROUS caps so those
// fixtures exercise the uncapped path (n:2 honored, all refs kept). "x" MUST be catalogued: the
// drift preflight (assertModelAvailable) now blocks a run whose model is missing from the LOADED
// catalog, so a bare uncatalogued id would be stopped before any send (proven below).
catalog.image.push(
  { id: "capmodel1", supported_parameters: { max_input_images: 1 } },
  { id: "capmodel3", supported_parameters: { max_input_images: 3 } },
  { id: "x", supported_parameters: { max_input_images: 9, max_output_images: 9 } },
  // the real role-ordered model: catalog says max_items 2 and NOTHING about a minimum (no min_items
  // field exists upstream), which is exactly why the runtime carries the curated IMG_INPUT_ROLES map.
  { id: "flux-pro/v1/vto", supported_parameters: { max_input_images: 2, fixed_image_count: 1 } },
  // the two REAL forced-count shapes: midjourney/higgsfield always return 4 (fixed_image_count 4);
  // fix1model is the fixed_image_count:1 shape that must behave exactly like no forced count at all.
  { id: "fix4model", supported_parameters: { max_output_images: 4, fixed_image_count: 4 } },
  { id: "fix1model", supported_parameters: { max_output_images: 4, fixed_image_count: 1 } },
);

// Seed the best-effort audio catalog. loadCatalogRaw() caches its first NON-EMPTY fetch for the
// whole engine instance (an empty result is treated as transient and retried), so every audio id a
// later scenario needs must be pushed here, BEFORE any scenario runs — a prep()-time push arriving
// after the first audio fetch has already resolved (and cached) would never be seen.
//
// - langmodel/nolangmodel/seedlang: the TTS "explicit language control" knob (Qwen Audio 3.0 TTS
//   Flash, Qwen-3-TTS-1.7B, bytedance/seed-speech-tts-2.0 all advertise supported_parameters.language
//   as a {default, values} object). langmodel is the Qwen shape (labels: English); seedlang is the
//   ByteDance shape (ISO: en, default ""). A leftover ISO code on a label-enum model (or the reverse)
//   must be dropped on the send path — Qwen 400s on `en`, ByteDance 400s on `English`.
//   nolangmodel is a plain TTS model that doesn't advertise language at all (most TTS models) —
//   collectAudioParams must gate the field on the REAL catalog entry, not send it unconditionally,
//   exactly like it already does for voices/duration.
// - music3shape: MiniMax Music 3's real catalog shape — supported_parameters:{} (no min/max_duration,
//   unlike its 02/2.5/2.6 siblings), matching the real upstream API, which has no duration parameter
//   at all (song length is model-chosen).
// "x" is the pre-existing payload-shape placeholder every music/tts/remix fixture below uses — once
// the audio catalog is non-empty it MUST be catalogued too, or the drift preflight blocks it as
// missing (the same rule proven for images above). Generous params keep every existing fixture's
// send-everything assumptions intact.
catalog.audio.push(
  { id: "x", supported_parameters: { voices: ["alloy"], min_duration: 1, max_duration: 300 } },
  { id: "langmodel", supported_parameters: { language: { default: "Auto", values: ["Auto", "English", "Chinese"] } } },
  { id: "nolangmodel", supported_parameters: { voices: ["alloy"] } },
  { id: "seedlang", supported_parameters: { language: { default: "", values: ["", "zh", "en", "ja"] } } },
  { id: "music3shape", supported_parameters: {} },
);

// Video catalog seed: model "x" stays uncatalogued so tvideo catalog-miss still
// soft-sends aspect+duration. vedit-dims advertises all three knobs so the
// advertised-forward case can distinguish "omit leftover" from "drop listed".
catalog.video.push(
  { id: "x", supported_parameters: { parameters: {} } },
  {
    id: "vedit-dims",
    supported_parameters: { parameters: {
      resolution: { type: "select", default: "720p", options: [{ value: "720p" }, { value: "1080p" }] },
      aspect_ratio: { type: "select", default: "16:9", options: [{ value: "16:9" }, { value: "9:16" }] },
      duration: { type: "select", default: "5", options: [{ value: "5" }, { value: "8" }] },
    } },
  },
);

// ---- graph builders -------------------------------------------------------
const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
let _l = 0;
const link = (from, fromPort, to, toPort) => ({ id: "l" + (++_l), from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
const IMG = "data:image/png;base64,IMGDATA";
const AUD = "data:audio/mpeg;base64,AUDDATA";

const chatCalls = () => calls.filter((c) => /\/chat\/completions/.test(c.url));
const imgCalls = () => calls.filter((c) => /\/images\/generations/.test(c.url));
const videoCalls = () => calls.filter((c) => /\/generate-video/.test(c.url));
const audioCalls = () => calls.filter((c) => /\/audio\/speech/.test(c.url));
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
    // A fixed_image_count model returns — and BILLS FOR — N images whatever `n` says. An exported app
    // carrying variations:"1" (baked before the model swap, or from a catalog that hadn't landed) used
    // to request 1, get 4, and show 1: three paid images silently discarded. The runtime must ask for
    // the real number so the send matches the invoice and every image reaches the gallery.
    name: "NEW: fixed_image_count model requests N even when the app says variations=1",
    data: { nodes: [node("t1", "text", { text: "a red panda" }), node("i1", "image", { model: "fix4model", size: "1024x1024", variations: "1" })],
            links: [link("t1", "text", "i1", "prompt")] },
    check(app, g, fail) {
      const b = imgCalls()[0]?.body;
      if (!b) return fail("no image generation call");
      if (b.n !== 4) fail(`fixed_image_count:4 must request n:4 (the count it bills), got ${JSON.stringify(b.n)}`);
      const o = g.byId("i1").out;
      if (!Array.isArray(o.images) || o.images.length !== 4) fail(`all 4 paid images must be surfaced, got ${JSON.stringify(o.images)}`);
    },
  },
  {
    // fixed_image_count:1 is NOT a forced count — it must fall through to the ordinary variations
    // clamp (fixed>1 is the single predicate), or a 3-variation run bills 3 while the quote says 1.
    name: "NEW: fixed_image_count:1 still honours the picked variations",
    data: { nodes: [node("t1", "text", { text: "a red panda" }), node("i1", "image", { model: "fix1model", size: "1024x1024", variations: "3" })],
            links: [link("t1", "text", "i1", "prompt")] },
    check(app, g, fail) {
      const b = imgCalls()[0]?.body;
      if (!b) return fail("no image generation call");
      if (b.n !== 3) fail(`fixed_image_count:1 must send the picked n:3, got ${JSON.stringify(b.n)}`);
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
    name: "NEW: Edit with a high-cap model keeps all wired refs (cap doesn't over-trim)",
    data: { nodes: [node("a", "upload", { image: IMG + "A" }), node("b", "upload", { image: IMG + "B" }),
                    node("c", "upload", { image: IMG + "C" }),
                    node("e1", "edit", { model: "x", prompt: "compose" })],   // "x" advertises max_input_images:9 → no effective cap on 3 refs
            links: [link("a", "image", "e1", "image"), link("b", "image", "e1", "image2"), link("c", "image", "e1", "image3")] },
    check(app, g, fail) {
      const b = imgCalls()[0]?.body;
      if (!b) return fail("no edit/image call");
      if (!Array.isArray(b.imageDataUrl) || b.imageDataUrl.length !== 3) fail(`a high-cap model must not over-trim, got ${Array.isArray(b.imageDataUrl) ? `len ${b.imageDataUrl.length}` : typeof b.imageDataUrl}`);
    },
  },
  {
    // A saved/shared graph can carry a model NanoGPT has renamed or retired. The drift preflight must
    // block that node BEFORE any request — no opaque 4xx, no charge on a dead id. (Twin pinned offline
    // in check-drifted-model.mjs; this proves it through the REAL exported run loop.)
    name: "NEW: Edit with a catalog-missing (drifted) model is blocked before any send",
    data: { nodes: [node("a", "upload", { image: IMG + "A" }),
                    node("e1", "edit", { model: "retired-model-v0", prompt: "compose" })],
            links: [link("a", "image", "e1", "image")] },
    check(app, g, fail) {
      if (imgCalls().length) fail("a drifted (catalog-missing) model must be blocked before any paid image send");
    },
  },
  {
    // flux-pro/v1/vto needs [person, garment], person first: one image is a live-verified 400
    // ("FLUX Virtual Try-On requires two input images…", uncharged). The exported runtime must
    // refuse it locally — a 400 the app could have predicted is still a round trip the user waits on.
    name: "NEW: vto with only the person image never reaches the API (zero fetches)",
    data: { nodes: [node("p", "upload", { image: IMG + "PERSON" }),
                    node("e1", "edit", { model: "flux-pro/v1/vto", prompt: "try it on" })],
            links: [link("p", "image", "e1", "image")] },
    check(app, g, fail) {
      if (imgCalls().length) fail(`a role-ordered model missing a slot must send NOTHING, got ${imgCalls().length} call(s)`);
    },
  },
  {
    // A HOLE is not coverage: image + image3 is two images by length but the garment slot (image2)
    // is empty, and the runtime deliberately does not re-pack role models' ports.
    name: "NEW: vto with a port hole (image + image3) also sends nothing",
    data: { nodes: [node("p", "upload", { image: IMG + "PERSON" }), node("gm", "upload", { image: IMG + "GARMENT" }),
                    node("e1", "edit", { model: "flux-pro/v1/vto", prompt: "try it on" })],
            links: [link("p", "image", "e1", "image"), link("gm", "image", "e1", "image3")] },
    check(app, g, fail) {
      if (imgCalls().length) fail(`a role hole must send NOTHING, got ${imgCalls().length} call(s)`);
    },
  },
  {
    name: "NEW: vto with both roles wired sends [person, garment] in that order",
    data: { nodes: [node("p", "upload", { image: IMG + "PERSON" }), node("gm", "upload", { image: IMG + "GARMENT" }),
                    node("e1", "edit", { model: "flux-pro/v1/vto", prompt: "try it on" })],
            links: [link("p", "image", "e1", "image"), link("gm", "image", "e1", "image2")] },
    check(app, g, fail) {
      const b = imgCalls()[0]?.body;
      if (!b) return fail("both roles wired must produce exactly one image call");
      if (!Array.isArray(b.imageDataUrl) || b.imageDataUrl.length !== 2) return fail(`expected a 2-image array, got ${JSON.stringify(b.imageDataUrl).slice(0, 80)}`);
      if (b.imageDataUrl[0] !== IMG + "PERSON") fail("person must be sent FIRST (order is load-bearing for vto)");
      if (b.imageDataUrl[1] !== IMG + "GARMENT") fail("garment must be sent SECOND");
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
    // Editor dimDefs only puts a dim on the wire when the catalog lists it (vedit
    // is not soft). Play used to forward leftover resolution/aspect/duration on
    // every vedit — a wrong payload for upscalers and Omni v1 (no resolution).
    // Known model "x" lists no dim params → omit leftovers; vedit-dims still forwards.
    name: "vedit omits leftover dims when the catalog does not list them",
    data: { nodes: [node("s1", "vupload", { video: "https://example/clip.mp4" }),
                    node("v1", "vedit", { model: "x", resolution: "1080p", aspect: "9:16", duration: "8" })],
            links: [link("s1", "video", "v1", "video")] },
    check(app, g, fail) {
      const b = videoCalls()[0]?.body;
      if (!b) return fail("no generate-video call recorded");
      if (b.resolution != null) fail(`vedit posted leftover resolution ${JSON.stringify(b.resolution)}`);
      if (b.aspect_ratio != null) fail(`vedit posted leftover aspect_ratio ${JSON.stringify(b.aspect_ratio)}`);
      if (b.duration != null) fail(`vedit posted leftover duration ${JSON.stringify(b.duration)}`);
    },
  },
  {
    name: "vedit forwards advertised resolution + aspect_ratio + duration",
    data: { nodes: [node("s1", "vupload", { video: "https://example/clip.mp4" }),
                    node("v1", "vedit", { model: "vedit-dims", resolution: "1080p", aspect: "9:16", duration: "8" })],
            links: [link("s1", "video", "v1", "video")] },
    check(app, g, fail) {
      const b = videoCalls()[0]?.body;
      if (!b) return fail("no generate-video call recorded");
      if (b.resolution !== "1080p") fail(`resolution not forwarded, got ${JSON.stringify(b.resolution)}`);
      if (b.aspect_ratio !== "9:16") fail(`aspect_ratio dropped, got ${JSON.stringify(b.aspect_ratio)}`);
      if (b.duration !== "8") fail(`duration dropped, got ${JSON.stringify(b.duration)}`);
    },
  },
  {
    // Trust: genVideo applied opts.extra (modelOpts) AFTER opts.dims, so a stale modelOpts.duration
    // (saved graph / describe-copilot / hand edit) overwrote the node's duration. The "~$X to run"
    // chip prices the node field; the API billed the clobber → under-quote. Dims must win after extra.
    name: "tvideo node duration wins over stale modelOpts.duration (no price clobber)",
    data: { nodes: [node("t1", "tvideo", {
              model: "x", prompt: "a drone shot", duration: "5", aspect: "16:9",
              modelOpts: { duration: "10", style: "cinematic" },
            })], links: [] },
    check(app, g, fail) {
      const b = videoCalls()[0]?.body;
      if (!b) return fail("no generate-video call recorded");
      if (b.duration !== "5") fail(`node duration must win over modelOpts.duration, got ${JSON.stringify(b.duration)}`);
      if (b.style !== "cinematic") fail(`non-dim modelOpts must still forward, got ${JSON.stringify(b.style)}`);
      if (b.aspect_ratio !== "16:9") fail(`aspect must still forward, got ${JSON.stringify(b.aspect_ratio)}`);
    },
  },
  {
    // Trust: collectAudioParams clamps UI number_of_songs to 1, but advanced-params JSON used to
    // reintroduce number_of_songs/generation_count after that clamp → API bills N, audioRun surfaces 1.
    // extraJson must not resurrect any song-count key.
    name: "Music extraJson cannot reintroduce number_of_songs (bill-N surface-1 guard)",
    data: { nodes: [node("m1", "music", {
              model: "x", prompt: "lofi beat",
              extraJson: JSON.stringify({ number_of_songs: 4, n: 3, generation_count: 2, style: "chill" }),
            })], links: [] },
    check(app, g, fail) {
      const b = audioCalls()[0]?.body;
      if (!b) return fail("no /audio/speech call recorded for music");
      if (b.input !== "lofi beat") fail(`music prompt must ride as input, got ${JSON.stringify(b.input)}`);
      for (const k of ["number_of_songs", "n", "generation_count", "num_songs", "song_count"]) {
        if (k in b) fail(`song-count key ${k} must be stripped after extraJson, got ${JSON.stringify(b[k])}`);
      }
      if (b.style !== "chill") fail(`non-count extraJson keys must still forward, got ${JSON.stringify(b.style)}`);
    },
  },
  {
    // Remix node (audio+text→audio) rides the same /audio/speech wire as Music, plus a source track
    // under `audio`. An UPLOADED clip is a data: URL and must ride inline exactly as wired.
    name: "Remix node: uploaded data: source rides inline as body.audio (+ input, + lyrics)",
    data: { nodes: [node("a1", "aupload", { audio: AUD }), node("r1", "remix", { model: "x", prompt: "jazzy cover", lyrics: "la la" })],
            links: [link("a1", "audio", "r1", "audio")] },
    check(app, g, fail) {
      const b = audioCalls()[0]?.body;
      if (!b) return fail("no /audio/speech call recorded for the remix node");
      if (b.model !== "x") fail(`remix model not forwarded, got ${JSON.stringify(b.model)}`);
      if (b.input !== "jazzy cover") fail(`remix style prompt must ride as input, got ${JSON.stringify(b.input)}`);
      if (b.audio !== AUD) fail(`remix source track must ride as body.audio, got ${JSON.stringify(b.audio).slice(0, 60)}`);
      if (b.lyrics !== "la la") fail(`remix lyrics not forwarded, got ${JSON.stringify(b.lyrics)}`);
    },
  },
  {
    // Trust: the song-count strip landed for Music only, but Remix shares audioBody's extraJson
    // textarea and the same collectAudioParams. A remix extraJson could still bill N tracks while
    // remixRun surfaces one URL and audioBilledSongs() quotes 1 → silent overcharge.
    name: "Remix extraJson cannot reintroduce number_of_songs (bill-N surface-1 guard)",
    data: { nodes: [node("a1", "aupload", { audio: AUD }), node("r1", "remix", {
              model: "x", prompt: "jazzy cover",
              extraJson: JSON.stringify({ number_of_songs: 4, n: 3, generation_count: 2, style: "chill" }),
            })],
            links: [link("a1", "audio", "r1", "audio")] },
    check(app, g, fail) {
      const b = audioCalls()[0]?.body;
      if (!b) return fail("no /audio/speech call recorded for remix");
      if (b.audio !== AUD) fail(`remix source track must still ride as body.audio, got ${JSON.stringify(b.audio).slice(0, 60)}`);
      for (const k of ["number_of_songs", "n", "generation_count", "num_songs", "song_count"]) {
        if (k in b) fail(`song-count key ${k} must be stripped after extraJson, got ${JSON.stringify(b[k])}`);
      }
      if (b.style !== "chill") fail(`non-count extraJson keys must still forward, got ${JSON.stringify(b.style)}`);
    },
  },
  {
    // MiniMax Music 3's catalog entry declares NO min/max_duration (unlike its 02/2.5/2.6 siblings) —
    // matching the real upstream API, which has no duration parameter at all (length is model-chosen).
    // The Music node must not invent a duration control the catalog doesn't advertise: instrumental
    // mode + free-text lyrics (structured [Verse]/[Chorus] tags included) are "all" params, so they
    // still ride through untouched, but duration/number_of_songs stay gated off.
    name: "Music node: MiniMax-Music-3-shaped model (no duration in catalog) still forwards lyrics + instrumental",
    data: { nodes: [node("m1", "music", {
              model: "music3shape", prompt: "warm acoustic pop, intimate lead vocal",
              lyrics: "[Verse]\nMorning light across the road\n[Chorus]\nCarry the spark and bring it home",
              instrumental: false, duration: "45",
            })], links: [] },
    check(app, g, fail) {
      const b = audioCalls()[0]?.body;
      if (!b) return fail("no /audio/speech call recorded for music3shape");
      if (b.lyrics !== "[Verse]\nMorning light across the road\n[Chorus]\nCarry the spark and bring it home")
        fail(`structured lyrics must forward verbatim, got ${JSON.stringify(b.lyrics)}`);
      if ("instrumental" in b) fail(`instrumental:false must be omitted (only sent when true), got ${JSON.stringify(b.instrumental)}`);
      if ("duration" in b) fail(`a model with no min/max_duration in its catalog entry must not receive a duration knob, got ${JSON.stringify(b.duration)}`);
    },
  },
  {
    // Same shape, instrumental mode on and no lyrics (MiniMax Music 3's other documented mode).
    name: "Music node: instrumental mode sends instrumental:true and omits empty lyrics",
    data: { nodes: [node("m1", "music", { model: "music3shape", prompt: "lofi instrumental beat", instrumental: true })], links: [] },
    check(app, g, fail) {
      const b = audioCalls()[0]?.body;
      if (!b) return fail("no /audio/speech call recorded for music3shape");
      if (b.instrumental !== true) fail(`instrumental:true must forward, got ${JSON.stringify(b.instrumental)}`);
      if ("lyrics" in b) fail(`empty lyrics must be omitted, got ${JSON.stringify(b.lyrics)}`);
    },
  },
  {
    // TTS "Language" knob (Qwen Audio 3.0 TTS Flash / Qwen-3-TTS-1.7B / bytedance/seed-speech-tts-2.0):
    // the model's own docs say naming the language explicitly beats Auto-detect. Catalog-gated exactly
    // like voices/duration — send it only when the picked model actually advertises language control.
    name: "Speech node: language forwards when the model advertises explicit language control",
    data: { nodes: [node("t1", "tts", { model: "langmodel", prompt: "Hello there", language: "English" })], links: [] },
    check(app, g, fail) {
      const b = audioCalls()[0]?.body;
      if (!b) return fail("no /audio/speech call recorded for langmodel");
      if (b.language !== "English") fail(`language must forward, got ${JSON.stringify(b.language)}`);
    },
  },
  {
    // The catalog's own default (Auto) is the no-op value — omitted exactly like response_format:"mp3".
    name: "Speech node: language omitted when left at the catalog default (Auto)",
    data: { nodes: [node("t1", "tts", { model: "langmodel", prompt: "Hello there", language: "Auto" })], links: [] },
    check(app, g, fail) {
      const b = audioCalls()[0]?.body;
      if (!b) return fail("no /audio/speech call recorded for langmodel");
      if ("language" in b) fail(`language:"Auto" (the catalog default) must be omitted, got ${JSON.stringify(b.language)}`);
    },
  },
  {
    // A model that does NOT advertise language control (most TTS models) must never receive the key,
    // even if a stale field value survives a model swap — mirrors the voices/duration cat: gates, and
    // stops a client-invented param from being silently no-op'd (or worse) on a provider that doesn't
    // expect it.
    name: "Speech node: language withheld from a model with no language in its catalog entry",
    data: { nodes: [node("t1", "tts", { model: "nolangmodel", prompt: "Hello there", language: "English" })], links: [] },
    check(app, g, fail) {
      const b = audioCalls()[0]?.body;
      if (!b) return fail("no /audio/speech call recorded for nolangmodel");
      if ("language" in b) fail(`a model without catalog language support must not receive the language key, got ${JSON.stringify(b.language)}`);
    },
  },
  {
    // Live catalog (2026-09-02): alibaba/qwen-audio-3-tts values are Auto/Chinese/English/… —
    // not ISO codes. Exported apps expose Language as free text, so a leftover `en` (or a typed
    // ISO code) used to ride through and 400. Drop anything not in THIS model's values.
    name: "Speech node: leftover ISO language dropped on a Qwen-shaped label enum",
    data: { nodes: [node("t1", "tts", { model: "langmodel", prompt: "Hello there", language: "en" })], links: [] },
    check(app, g, fail) {
      const b = audioCalls()[0]?.body;
      if (!b) return fail("no /audio/speech call recorded for langmodel");
      if ("language" in b) fail(`leftover language:"en" is not in the Qwen-shaped enum and must be omitted, got ${JSON.stringify(b.language)}`);
    },
  },
  {
    // Live catalog: bytedance/seed-speech-tts-2.0 values are "", zh, en, ja, … — not "English".
    // A leftover Qwen label after a model swap must not be posted.
    name: "Speech node: leftover English label dropped on a ByteDance-shaped ISO enum",
    data: { nodes: [node("t1", "tts", { model: "seedlang", prompt: "Hello there", language: "English" })], links: [] },
    check(app, g, fail) {
      const b = audioCalls()[0]?.body;
      if (!b) return fail("no /audio/speech call recorded for seedlang");
      if ("language" in b) fail(`leftover language:"English" is not in the ByteDance-shaped enum and must be omitted, got ${JSON.stringify(b.language)}`);
    },
  },
  {
    name: "Speech node: listed ISO language forwards on a ByteDance-shaped enum",
    data: { nodes: [node("t1", "tts", { model: "seedlang", prompt: "Hello there", language: "en" })], links: [] },
    check(app, g, fail) {
      const b = audioCalls()[0]?.body;
      if (!b) return fail("no /audio/speech call recorded for seedlang");
      if (b.language !== "en") fail(`listed language:"en" must forward on the ByteDance-shaped enum, got ${JSON.stringify(b.language)}`);
    },
  },
  {
    // A CHAINED source (a Music/Remix output on the provider CDN) is an https URL and must pass
    // through untouched — inlining it would re-download CORS-blocked bytes and blow the body cap.
    name: "Remix node: chained https source passes through as a URL (never inlined)",
    data: { nodes: [node("a1", "aupload", { audio: "https://cdn.example/track.mp3" }), node("r1", "remix", { model: "x", prompt: "extend it" })],
            links: [link("a1", "audio", "r1", "audio")] },
    check(app, g, fail) {
      const b = audioCalls()[0]?.body;
      if (!b) return fail("no /audio/speech call recorded for the chained remix");
      if (b.audio !== "https://cdn.example/track.mp3") fail(`https source must pass through verbatim, got ${JSON.stringify(b.audio).slice(0, 60)}`);
      if ("lyrics" in b) fail("empty lyrics must be omitted (only-when-nonempty)");
    },
  },
  {
    // vframes' frame count is SHAPE-affecting: run() emits frame1..frameN and downstream links
    // read fixed frameK ports. An app SETTING (or an old app's persisted value) below the highest
    // wired port used to starve that consumer MID-RUN — after upstream paid steps already charged.
    // The engine must clamp frames up to the wired floor (wiredFramesFloor in play.html). The real
    // extractor needs a browser <video> decode, so stub it with one that emits frame1..frameN from
    // the count the ENGINE hands it — proving the clamp happens before run(), in runGraph itself.
    name: "vframes: engine clamps a lowered frames setting up to the highest wired frame port",
    prep(app) {
      const orig = app.NODE_TYPES.vframes.run;
      app.NODE_TYPES.vframes.run = async (n) => {
        const out = {};
        const count = Math.max(1, parseInt(n.fields.frames, 10) || 1);
        for (let i = 1; i <= count; i++) out["frame" + i] = IMG + i;
        return out;
      };
      return () => { app.NODE_TYPES.vframes.run = orig; };
    },
    data: { nodes: [node("s1", "vupload", { video: "https://example/clip.mp4" }),
                    node("f1", "vframes", { frames: "1" }),   // persisted setting lowered below the wired port
                    node("e1", "edit", { model: "x", prompt: "restyle the third frame" })],
            links: [link("s1", "video", "f1", "video"), link("f1", "frame3", "e1", "image")] },
    check(app, g, fail) {
      const b = imgCalls()[0]?.body;
      if (!b) return fail("the frame3 consumer never ran — the engine did not clamp frames up to the wired port");
      if (b.imageDataUrl !== IMG + "3") fail(`the edit step must receive frame3, got ${JSON.stringify(b.imageDataUrl).slice(0, 40)}`);
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

// ---- the exported app's variations control is pinned by the catalog -------
// fillDimLists lives inside RUNTIME_JS's IIFE (not on window.NoodleApp), so pull the REAL function
// out of play.html by brace-matching and drive it in its own sandbox with a paper DOM. It is the
// play-side twin of the editor's locked dimDefs: on a fixed_image_count model the box is set to N,
// disabled, and captioned — otherwise the run would quietly bill 4× what the box promises.
function extractRuntimeFn(src, name) {
  const start = src.indexOf("\n  function " + name + "(");
  if (start === -1) throw new Error("function " + name + "() not found in play.html");
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start + 1, j + 1);
  }
  throw new Error("could not brace-match " + name + "()");
}
async function fillDimListsCheck(fail) {
  const PLAY_SRC = readFileSync(join(ROOT, "play.html"), "utf8");
  // paper DOM: one row holding one <select>, exactly the shape renderSettings builds
  const mkRow = () => {
    const kids = [];
    const row = {
      kids,
      querySelector: (sel) => kids.find((k) => String(k.className).split(/\s+/).some((c) => "." + c === sel)) || null,
      appendChild: (k) => { k.parentRow = row; kids.push(k); return k; },
    };
    return row;
  };
  const row = mkRow();
  const el = { tagName: "SELECT", value: "1", disabled: false, innerHTML: "", closest: () => row };
  const ctx = {
    console, STATE: { settings: [] },
    document: {
      getElementById: (id) => (id === "set_0" ? el : null),
      createElement: () => ({ className: "", textContent: "", remove() { const i = this.parentRow.kids.indexOf(this); if (i >= 0) this.parentRow.kids.splice(i, 1); } }),
    },
    t: (s) => s, esc: (s) => String(s),
    DIM_FIELDS: {}, SETTING_MODEL_KIND: { image: "image" },
    dimOptionsFromItem: () => ({}),
    rawCatItem: async (_kind, id) => CAT[id] || null,
  };
  const CAT = {
    fix4model: { supported_parameters: { fixed_image_count: 4 } },
    fix1model: { supported_parameters: { fixed_image_count: 1 } },
    plainmodel: { supported_parameters: { max_output_images: 4 } },
  };
  vm.createContext(ctx);
  new vm.Script(extractRuntimeFn(PLAY_SRC, "fillDimLists") + "\nglobalThis.__fill = fillDimLists;",
    { filename: "play.html#fillDimLists" }).runInContext(ctx);

  const drive = async (model) => {
    const nd = { type: "image", fields: { model, variations: "1" } };
    ctx.STATE.settings = [{ node: nd, field: "variations", kind: "select" }];
    ctx.__fill();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    return nd;
  };
  const hint = () => row.querySelector(".fixedhint");

  const n4 = await drive("fix4model");
  if (el.disabled !== true) fail("fixed_image_count must DISABLE the variations box (it is not a choice)");
  if (el.value !== "4") fail(`the box must be pinned to the forced count, got ${JSON.stringify(el.value)}`);
  if (n4.fields.variations !== "4") fail(`the graph field must be pinned too (the estimate reads it), got ${JSON.stringify(n4.fields.variations)}`);
  if (!hint()) fail("a forced count must be disclosed with a .fixedhint caption");
  else if (!/4/.test(hint().textContent)) fail(`the caption must name the count, got ${JSON.stringify(hint().textContent)}`);

  // swapping to a plain model releases the box and drops the caption (no stale "always returns 4")
  const np = await drive("plainmodel");
  if (el.disabled !== false) fail("a non-fixed model must leave the variations box editable");
  if (hint()) fail("the forced-count caption must be removed when the model no longer forces a count");
  if (np.fields.variations !== "1") fail(`a non-fixed model must not rewrite the stored variations, got ${JSON.stringify(np.fields.variations)}`);

  // fixed_image_count:1 is not a forced count — same unlocked, uncaptioned box (the fixed>1 invariant)
  await drive("fix1model");
  if (el.disabled !== false) fail("fixed_image_count:1 must NOT lock the box (fixed>1 is the predicate)");
  if (hint()) fail("fixed_image_count:1 must not claim the model always returns 1");
}

// Editor twin of the leftover-language send-path clamp. play's collectAudioParams is driven via
// runGraph above; index.html's copy is a real function we can extract and call with a paper catalog
// (normAudio-shaped: voices / language / params). Same leftover `en` / `English` cases as the play
// scenarios — a 2-sided fix that only ships on one surface is how #396's enum gap survived a model swap.
function extractIndexBlock(src, anchor) {
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error("anchor not found in index.html: " + anchor);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("could not brace-match index.html block: " + anchor);
}
function editorLanguageClampCheck(fail) {
  const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
  const items = {
    langmodel: { voices: [], language: { default: "Auto", values: ["Auto", "English", "Chinese"] }, params: {}, pricing: {} },
    seedlang: { voices: [], language: { default: "", values: ["", "zh", "en", "ja"] }, params: {}, pricing: {} },
    nolangmodel: { voices: ["alloy"], language: null, params: {}, pricing: {} },
  };
  const ctx = {
    catItem: (_kind, id) => items[id] || null,
  };
  vm.createContext(ctx);
  const src = [
    extractIndexBlock(IDX, "const AUDIO_PARAMS = {"),
    extractIndexBlock(IDX, "function audioApplies(at, it){"),
    extractIndexBlock(IDX, "function audioFields(kind, it){"),
    extractIndexBlock(IDX, "function assertGenerateSongLyrics(model, lyrics){"),
    extractIndexBlock(IDX, "function collectAudioParams(n){"),
    "globalThis.__collect = collectAudioParams;",
  ].join("\n");
  new vm.Script(src, { filename: "index.html#collectAudioParams" }).runInContext(ctx);
  const body = (model, language) => ctx.__collect({ type: "tts", fields: { model, language } });
  const qwenEn = body("langmodel", "en");
  if ("language" in qwenEn) fail(`editor: leftover language:"en" on Qwen-shaped enum must be omitted, got ${JSON.stringify(qwenEn.language)}`);
  const qwenEnLabel = body("langmodel", "English");
  if (qwenEnLabel.language !== "English") fail(`editor: listed language:"English" must forward, got ${JSON.stringify(qwenEnLabel.language)}`);
  const seedLabel = body("seedlang", "English");
  if ("language" in seedLabel) fail(`editor: leftover language:"English" on ByteDance-shaped enum must be omitted, got ${JSON.stringify(seedLabel.language)}`);
  const seedIso = body("seedlang", "en");
  if (seedIso.language !== "en") fail(`editor: listed language:"en" must forward on ByteDance-shaped enum, got ${JSON.stringify(seedIso.language)}`);
  const none = body("nolangmodel", "English");
  if ("language" in none) fail(`editor: language withheld from a model with no catalog language, got ${JSON.stringify(none.language)}`);
}

// ---- run ------------------------------------------------------------------
const failures = [];
const app = (() => { try { return loadEngine(); } catch (e) { failures.push("could not load engine: " + (e && e.stack || e)); return null; } })();

if (app) {
  for (const s of SCENARIOS) {
    calls.length = 0;
    const fails0 = failures.length;
    const fail = (m) => failures.push(`"${s.name}": ${m}`);
    let undo = null;
    try {
      undo = s.prep ? s.prep(app) : null;   // optional engine tweak (e.g. stub a browser-only node); returns a restore fn
      const g = app.materialize(s.data);
      await app.runGraph(g, {});
      s.check(app, g, fail);
    } catch (e) {
      fail("threw: " + (e && e.message || e));
    } finally {
      if (typeof undo === "function") undo();
    }
    if (failures.length === fails0) process.stdout.write(`  ✓ ${s.name}\n`);
  }
  const n = failures.length;
  const fail = (m) => failures.push(`shipped graph: ${m}`);
  try { await shippedGraphCheck(app, fail); if (failures.length === n) process.stdout.write("  ✓ shipped noodle-graph.json still runs (LLM calls stay string-content)\n"); }
  catch (e) { failures.push("shipped graph check threw: " + (e && e.message || e)); }
}

{
  const n = failures.length;
  const fail = (m) => failures.push(`fillDimLists: ${m}`);
  try { await fillDimListsCheck(fail); if (failures.length === n) process.stdout.write("  ✓ exported app pins + discloses a fixed_image_count variations box\n"); }
  catch (e) { failures.push("fillDimLists check threw: " + (e && e.stack || e)); }
}

{
  const n = failures.length;
  const fail = (m) => failures.push(`editor language clamp: ${m}`);
  try { editorLanguageClampCheck(fail); if (failures.length === n) process.stdout.write("  ✓ editor collectAudioParams drops leftover language enums (twin of play)\n"); }
  catch (e) { failures.push("editor language clamp threw: " + (e && e.stack || e)); }
}

if (failures.length) {
  process.stderr.write("\n✗ run-compat: old workflows would change behavior:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write(`\n✓ run-compat: ${SCENARIOS.length} graphs + the shipped workflow produce unchanged NanoGPT calls.\n`);
