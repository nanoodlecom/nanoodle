#!/usr/bin/env node
// Pins the 13 Sep 2026 catalog arrivals that the generic suites do not drive:
//
//   Anima / Anima LoRA  — optional-image gen+edit, named 1k/1.5k sizes, 1–4
//     variations. v1 now lists aspect_ratio, but IMAGE_ASPECT is still FIBO-only,
//     so leftover FIBO aspect must not ride out on an Anima POST (same leak
//     class as Recraft). A banana 2k size must snap onto a listed Anima size,
//     never stay 2k (Anima 400s).
//   Yue2 3B Text-to-Music / Music-to-Music — T2M is Music (not Remix); M2M is
//     Remix (needs a source track). Lyrics still forward. T2M is NOT in the
//     Music-3 / generate-song prompt remapper, so direction stays `input`.
//
// Offline. No API spend. Live catalog GET is optional and skipped on failure.
// check-catalog-norm.mjs (#544) covers generic video/cover/dead flags — this
// file only drives the new ids.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadEngine, calls, catalog } from "./play-engine.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");

const ANIMA = "anima/text-to-image";
const ANIMA_LORA = "anima/text-to-image-lora";
const YUE2_T2M = "yue2-3b/text-to-music";
const YUE2_M2M = "yue2-3b/music-to-music";
const FIBO = "bria/fibo-generate-1.5/text-to-image";
const AUD = "data:audio/mpeg;base64,AUDDATA";

const ANIMA_RAW = {
  id: ANIMA,
  name: "Anima",
  created: 1789300000,
  architecture: { modality: "text+image->image" },
  capabilities: { image_generation: true, image_to_image: true, inpainting: false, nsfw: false },
  pricing: { per_image: { "1k": 0.01, "1.5k": 0.02, auto: 0.01 } },
  supported_parameters: {
    resolutions: ["1k", "1.5k"],
    aspect_ratio: ["1:1", "1:2", "2:1", "9:16", "16:9", "9:21", "21:9"],
    max_output_images: 4,
    max_input_images: 1,
  },
};
const ANIMA_LORA_RAW = {
  ...ANIMA_RAW,
  id: ANIMA_LORA,
  name: "Anima LoRA",
  pricing: { per_image: { "1k": 0.015, "1.5k": 0.03, auto: 0.015 } },
};
const YUE2_T2M_RAW = {
  id: YUE2_T2M,
  name: "Yue2 3B Text-to-Music",
  created: 1789300001,
  category: "audio_music",
  architecture: { modality: "text->music" },
  capabilities: { text_to_music: true },
  pricing: { per_generation: 0.03 },
  supported_parameters: {
    required: ["lyrics", "style"],
    lyrics: { type: "string", required: true },
    style: { type: "string", required: true },
  },
};
const YUE2_M2M_RAW = {
  id: YUE2_M2M,
  name: "Yue2 3B Music-to-Music",
  created: 1789300002,
  category: "audio_music",
  architecture: { modality: "text+audio->music" },
  capabilities: { text_to_music: true, audio_to_music: true },
  pricing: { per_generation: 0.03 },
  supported_parameters: {
    required: ["audio", "lyrics", "style"],
    audio: { type: "string", format: "uri", required: true },
    lyrics: { type: "string", required: true },
    style: { type: "string", required: true },
  },
};

catalog.image.push(
  { id: ANIMA, supported_parameters: { resolutions: ["1k", "1.5k"], max_output_images: 4, max_input_images: 1 } },
  { id: ANIMA_LORA, supported_parameters: { resolutions: ["1k", "1.5k"], max_output_images: 4, max_input_images: 1 } },
  { id: FIBO, supported_parameters: { resolutions: ["1mp", "4mp"] } },
  { id: "recraft-v4", supported_parameters: { resolutions: ["1024x1024"] } },
);
catalog.audio.push(
  { id: YUE2_T2M, supported_parameters: YUE2_T2M_RAW.supported_parameters },
  { id: YUE2_M2M, supported_parameters: YUE2_M2M_RAW.supported_parameters },
);

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

function block(src, anchor) {
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error("anchor not found: " + anchor);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced braces for: " + anchor);
}

function loadEditor() {
  const code = [
    "var EST = { ttsChars: 600, llmInTokens: 1000, llmOutTokens: 500 };",
    "function audioUnitUsd(){ return 0.01; }",
    block(IDX, "function imageTakesLora(id){"),
    // Sets/maps are id lists; empty stand-ins keep Anima off Inpaint / NEEDS_SRC.
    "var INPAINT_OK = new Set();",
    "var IMG_INPUT_ROLES = {};",
    "var NEEDS_SRC_IDS = new Set(['hidream-e1-1','wan-2.6-image-edit','vidu-q2-reference']);",
    block(IDX, "function normImg(m){"),
    block(IDX, "function normAudio(m){"),
    block(IDX, "function normChat(m){"),
    "var SIZES = [['1024x1024','square']];",
    "var SIZE_FALLBACK = SIZES;",
    "var ASPECT_FALLBACK = [['16:9','16:9']];",
    "var DURATION_FALLBACK = [['5','5 sec']];",
    block(IDX, "function selOpts(param){"),
    block(IDX, "function paramDef(param, opts){"),
    block(IDX, "const DIM_TIER_PX = {").replace(/^const\s/, "var "),
    block(IDX, "function dimShape(v){"),
    "var dimNum = " + IDX.match(/const dimNum = \(v\)=>\{[\s\S]*?\};/)[0].replace(/^const dimNum = /, ""),
    block(IDX, "function nearestDimOption(cur, options, def){"),
    block(IDX, "function applyDimFields(fields, defs){"),
    block(IDX, "const IMAGE_ASPECT = {").replace(/^const\s/, "var "),
    block(IDX, "function imageAspectSpec(model){"),
    block(IDX, "function dimDefs(type, model){"),
    block(IDX, "function imgExtra(n){"),
    "function loraParams(){ return {}; }",
    "function needsCustomCivitai(){ return false; }",
    "function airModelTakesNegative(){ return false; }",
    "function t(s){ return s; }",
    "var catalogs = { image: [], audio: [], chat: [] };",
    "function catItem(kind,id){ return (catalogs[kind]||[]).find(m=>m.id===id); }",
  ].join("\n");
  const ctx = { console, Math, isNaN, Number, String, Set, Object, Array };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

const editor = loadEditor();
editor.catalogs.image = [editor.normImg(ANIMA_RAW), editor.normImg(ANIMA_LORA_RAW)];
editor.catalogs.audio = [editor.normAudio(YUE2_T2M_RAW), editor.normAudio(YUE2_M2M_RAW)];

{
  if (/NEEDS_SRC_IDS\s*=\s*new Set\(\[[^\]]*anima/i.test(IDX))
    fail("Anima must not be curated into NEEDS_SRC_IDS (it generates from a bare prompt)");
  else ok("Anima is not on the edit-only NEEDS_SRC_IDS list");
  if (/INPAINT_OK\s*=\s*new Set\(\[[^\]]*anima/i.test(IDX))
    fail("Anima must not be curated into INPAINT_OK (no mask path)");
  else ok("Anima is not on the INPAINT_OK list");
}

{
  const a = editor.normImg(ANIMA_RAW);
  if (!a.gen || !a.edit) fail("Anima must stay Image+Edit (optional reference), got gen=" + a.gen + " edit=" + a.edit);
  else ok("Anima is optional-image gen+edit");
  if (a.inpaint) fail("Anima must not appear on Inpaint (no mask)");
  else ok("Anima stays off Inpaint");
  if (a.lora) fail("Anima (no -lora suffix) must not show the LoRA box");
  else ok("Anima hides the LoRA box");
  if (!a.resolutions.includes("1k") || !a.resolutions.includes("1.5k"))
    fail("Anima resolutions must keep 1k/1.5k, got " + a.resolutions);
  else ok("Anima resolutions are 1k/1.5k");
  if (a.maxOut !== 4) fail("Anima maxOut must be 4, got " + a.maxOut);
  else ok("Anima variations cap is 4");
}

{
  const a = editor.normImg(ANIMA_LORA_RAW);
  if (!a.gen || !a.edit || !a.lora) fail("Anima LoRA must be gen+edit+lora, got " + JSON.stringify({ gen: a.gen, edit: a.edit, lora: a.lora }));
  else ok("Anima LoRA is gen+edit and takes a LoRA");
}

{
  const defs = editor.dimDefs("image", ANIMA);
  const size = defs.find((d) => d.f === "size");
  const listed = (size && size.options || []).map((o) => String(o[0]));
  if (!size || listed.join(",") !== "1k,1.5k") fail("Anima size options drifted, got " + listed.join(","));
  else ok("Anima size control lists 1k/1.5k");
  const vars = defs.find((d) => d.f === "variations");
  const vopts = (vars && vars.options || []).map((o) => String(o[0]));
  if (!vars || vopts.join(",") !== "1,2,3,4") fail("Anima variations must be 1–4, got " + vopts.join(","));
  else ok("Anima variations are 1–4");
  if (defs.some((d) => d.f === "aspect"))
    fail("Anima grew a hardcoded IMAGE_ASPECT knob — v1 lists a different 15-option set than FIBO");
  else ok("Anima has no FIBO IMAGE_ASPECT knob");
}

{
  if (editor.imageAspectSpec(ANIMA) || editor.imageAspectSpec(ANIMA_LORA))
    fail("imageAspectSpec leaked onto Anima (FIBO's 9-option list is the wrong set)");
  else ok("imageAspectSpec stays FIBO-only vs Anima");
  const leak = editor.imgExtra({ fields: { model: ANIMA, aspect: "16:9", seed: "" } });
  if (leak.aspect_ratio) fail("leftover FIBO aspect leaked onto Anima, got " + JSON.stringify(leak));
  else ok("editor imgExtra: leftover aspect does not leak onto Anima");
}

{
  const fields = editor.applyDimFields({ size: "2k", variations: "1" }, editor.dimDefs("image", ANIMA));
  if (fields.size === "2k") fail("banana 2k must snap off Anima (Anima only lists 1k/1.5k)");
  else if (fields.size !== "1k" && fields.size !== "1.5k")
    fail("Anima size snap landed off-list, got " + JSON.stringify(fields.size));
  else ok("banana 2k snaps onto a listed Anima size (" + fields.size + ")");
  const keep = editor.applyDimFields({ size: "1.5k", variations: "3" }, editor.dimDefs("image", ANIMA));
  if (keep.size !== "1.5k") fail("chosen 1.5k must stay pickable, got " + JSON.stringify(keep.size));
  else ok("Anima keeps an already-valid 1.5k size");
}

{
  const t2m = editor.normAudio(YUE2_T2M_RAW);
  if (!t2m.music || t2m.remix || t2m.tts)
    fail("Yue2 T2M must be Music-only, got " + JSON.stringify({ music: t2m.music, remix: t2m.remix, tts: t2m.tts }));
  else ok("Yue2 Text-to-Music is Music, not Remix");
  const m2m = editor.normAudio(YUE2_M2M_RAW);
  if (!m2m.remix) fail("Yue2 M2M must be Remix (audio_to_music + required source track)");
  else ok("Yue2 Music-to-Music is Remix");
}

{
  const tee = editor.normChat({
    id: "TEE/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash TEE",
    capabilities: { vision: true, structured_output: true, reasoning: true, tool_calling: true, audio_input: false },
    pricing: { prompt: 0.65, completion: 1.45 },
  });
  if (!tee.vision || !tee.structured_output)
    fail("DeepSeek V4.1 Flash TEE must keep vision + JSON, got " + JSON.stringify({ vision: tee.vision, structured_output: tee.structured_output }));
  else ok("DeepSeek V4.1 Flash TEE keeps vision + structured_output");
}

const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
let _l = 0;
const link = (from, fromPort, to, toPort) =>
  ({ id: "l" + (++_l), from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
const audioPosts = () => calls.filter((c) => /\/audio\/speech/.test(c.url));
const imagePosts = () => calls.filter((c) => /\/images\/generations/.test(c.url));

const app = loadEngine();

{
  calls.length = 0;
  const g = app.materialize({
    nodes: [node("m1", "music", { model: YUE2_T2M, prompt: "wistful trip-hop, dusty vinyl", lyrics: "[Verse]\nrain on the underpass" })],
    links: [],
  });
  await app.runGraph(g, {});
  const b = audioPosts()[0] && audioPosts()[0].body;
  if (!b) fail("Yue2 T2M: no /audio/speech call");
  else {
    if (b.lyrics !== "[Verse]\nrain on the underpass") fail("Yue2 T2M lyrics must forward, got " + JSON.stringify(b.lyrics));
    else ok("Yue2 T2M forwards lyrics");
    if (b.input !== "wistful trip-hop, dusty vinyl")
      fail("Yue2 T2M is not in the prompt remapper — direction must stay input, got " + JSON.stringify({ input: b.input, prompt: b.prompt }));
    else ok("Yue2 T2M sends direction as input (not remapped to prompt)");
    if ("prompt" in b) fail("Yue2 T2M must not grow a prompt key (that remapper is Music 3 / generate-song), got " + JSON.stringify(b.prompt));
    else ok("Yue2 T2M omits prompt");
  }
}

{
  calls.length = 0;
  const g = app.materialize({
    nodes: [
      node("a1", "aupload", { audio: AUD }),
      node("r1", "remix", { model: YUE2_M2M, prompt: "brighter chorus, same vocal", lyrics: "[Chorus]\nbring it home" }),
    ],
    links: [link("a1", "audio", "r1", "audio")],
  });
  await app.runGraph(g, {});
  const b = audioPosts()[0] && audioPosts()[0].body;
  if (!b) fail("Yue2 M2M remix: no /audio/speech call");
  else {
    if (b.audio !== AUD) fail("Yue2 M2M must send the source track, got " + JSON.stringify(b.audio).slice(0, 60));
    else ok("Yue2 M2M remix sends body.audio");
    if (b.lyrics !== "[Chorus]\nbring it home") fail("Yue2 M2M lyrics must forward, got " + JSON.stringify(b.lyrics));
    else ok("Yue2 M2M forwards lyrics");
    if (b.input !== "brighter chorus, same vocal") fail("Yue2 M2M style must ride as input, got " + JSON.stringify(b.input));
    else ok("Yue2 M2M remix sends style as input");
  }
}

{
  calls.length = 0;
  const g = app.materialize({
    nodes: [node("i1", "image", { model: ANIMA, prompt: "tag-driven portrait", size: "1.5k", aspect: "16:9", variations: "1" })],
    links: [],
  });
  await app.runGraph(g, {});
  const b = imagePosts()[0] && imagePosts()[0].body;
  if (!b) fail("Anima play: no /images/generations call");
  else {
    if (b.size !== "1.5k") fail("Anima play must send size 1.5k, got " + JSON.stringify(b.size));
    else ok("play image.run: Anima sends size 1.5k");
    if (b.aspect_ratio) fail("play image.run: leftover aspect leaked onto Anima, got " + JSON.stringify(b.aspect_ratio));
    else ok("play image.run: leftover aspect does not leak onto Anima");
  }
}

// Live pin — skip (do not fail) when offline so pre-commit stays usable without egress.
try {
  const img = await fetch("https://nano-gpt.com/api/v1/image-models", { signal: AbortSignal.timeout(12000) });
  if (!img.ok) throw new Error("image-models HTTP " + img.status);
  const imageCat = await img.json();
  const row = (imageCat.data || []).find((x) => x.id === ANIMA);
  const sp = (row && row.supported_parameters) || {};
  if (!row) fail("live /api/v1/image-models: Anima missing");
  else if (!Array.isArray(sp.resolutions) || !sp.resolutions.includes("1.5k"))
    fail("live Anima resolutions drifted, got " + JSON.stringify(sp.resolutions));
  else ok("live Anima still lists 1k/1.5k");
  if (row && !(Array.isArray(sp.aspect_ratio) && sp.aspect_ratio.includes("9:21")))
    fail("live Anima aspect_ratio lost 9:21 (v1 list is wider than FIBO) — got " + JSON.stringify(sp.aspect_ratio));
  else if (row) ok("live Anima still advertises a wider aspect_ratio than FIBO");

  const aud = await fetch("https://nano-gpt.com/api/v1/audio-models", { signal: AbortSignal.timeout(12000) });
  if (!aud.ok) throw new Error("audio-models HTTP " + aud.status);
  const audioCat = await aud.json();
  const t2m = (audioCat.data || []).find((x) => x.id === YUE2_T2M);
  const m2m = (audioCat.data || []).find((x) => x.id === YUE2_M2M);
  if (!t2m) fail("live /api/v1/audio-models: Yue2 T2M missing");
  else if (!((t2m.supported_parameters || {}).required || []).includes("lyrics")
    || !((t2m.supported_parameters || {}).required || []).includes("style"))
    fail("live Yue2 T2M required params drifted, got " + JSON.stringify((t2m.supported_parameters || {}).required));
  else ok("live Yue2 T2M still requires lyrics + style");
  if (!m2m) fail("live /api/v1/audio-models: Yue2 M2M missing");
  else if (!((m2m.capabilities || {}).audio_to_music) || !((m2m.supported_parameters || {}).required || []).includes("audio"))
    fail("live Yue2 M2M lost audio_to_music / required audio");
  else ok("live Yue2 M2M still requires a source track");
} catch (e) {
  console.log("⊘ skip live catalog pin: " + (e && e.message ? e.message : e));
}

if (failed) process.exit(1);
console.log("Anima / Yue2 catalog-arrival checks passed.");
