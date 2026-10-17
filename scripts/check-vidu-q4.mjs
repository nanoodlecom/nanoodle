#!/usr/bin/env node
// Vidu Q4 (catalog fetched 2026-10-12, the card in the Oct 12 model sync) showed three
// editor bugs. Offline, zero API spend. Each section is one bug:
//
// 1. Picker price. pricing.per_second_by_resolution starts at 540p ($0.0495/s) and
//    carries no default_resolution. videoUnitUsd used that first key, so the picker
//    listed ~$0.25 for 5s. The card's resolution knob defaults to 720p
//    (supported_parameters.parameters.resolution.default), which is ~$0.52.
//    Wan 2.5 has the same shape with a lying pricing.default_resolution (480p vs the
//    card's 720p). Seedance 2.0 video-extend's pricing.default_duration is 4s and the
//    card's duration default is 5s. The picker passes {params, defaults}; an explicit
//    field still wins; a call with no settings keeps the old fallback.
//
// 2. Model options. imageUrl (and endImageUrl, referenceImages, image_url) is a media
//    slot. videoFreetextSkip only matched snake_case, so Image→Video drew a raw text box.
//
// 3. Dead-end hint. Image→Video told you to use Text→Video's ref ports even when the
//    model is not in that picker (Vidu Q4: text_to_video false). The hint shows only
//    when the model is actually t2v. "Generate reference mode audio" is hidden on
//    Image→Video, where reference mode cannot be selected.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDX = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const PLAY = fs.readFileSync(path.join(ROOT, "play.html"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);
const near = (a, b) => a != null && isFinite(a) && Math.abs(a - b) < 1e-9;

function loadResolver(src, end) {
  const s = src.indexOf("const EST = {"), e = src.indexOf(end);
  if (s < 0 || e < 0) throw new Error("pricing block not found");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.slice(s, e) + "\nthis.videoUnitUsd=videoUnitUsd;", ctx);
  return ctx;
}

// Live /api/v1/video-models shapes, trimmed to the keys the estimate reads.
const VIDU = {
  currency: "USD",
  per_second_by_resolution: { "540p": 0.0495, "720p": 0.1045, "1080p": 0.132, "2K": 0.209, "4K": 0.429 },
  minimum: 0.1485,
};
const VIDU_CTX = {
  params: {
    resolution: { type: "select", default: "720p", options: [{ value: "540p" }, { value: "720p" }, { value: "1080p" }] },
    duration: { type: "integer", default: "5", options: [{ value: "3" }, { value: "5" }, { value: "16" }] },
  },
  defaults: { resolution: "720p", duration: "5" },
};
const WAN25 = {
  currency: "USD",
  per_second_by_resolution: { "480p": 0.06, "720p": 0.12, "1080p": 0.18 },
  default_duration: 5,
  default_resolution: "480p",
};
const WAN25_CTX = {
  params: {
    resolution: { type: "select", default: "720p", options: [{ value: "480p" }, { value: "720p" }] },
    duration: { type: "select", default: "5", options: [{ value: "5" }, { value: "8" }] },
  },
  defaults: { resolution: "720p", duration: "5" },
};
const EXTEND = {
  currency: "USD",
  per_second_by_resolution: { "480p": 0.16, "720p": 0.24 },
  default_duration: 4,
  default_resolution: "720p",
};
const EXTEND_CTX = {
  params: {
    resolution: { type: "select", default: "720p", options: [{ value: "480p" }, { value: "720p" }] },
    duration: { type: "select", default: "5", options: [{ value: "4" }, { value: "5" }] },
  },
  defaults: { resolution: "720p", duration: "5" },
};

// ---- 1. picker price matches the card default --------------------------------
{
  const engines = [
    ["editor", IDX, "function nodeUnitUsd("],
    ["play", PLAY, "async function nodeUnitUsdPlay("],
  ];
  for (const [name, src, end] of engines) {
    const { videoUnitUsd } = loadResolver(src, end);
    const cases = [
      [videoUnitUsd(VIDU, {}, false, false, "i2v", VIDU_CTX), 0.5225, "vidu-q4 picker uses 720p × 5s (~$0.52), not the cheap 540p tier"],
      [videoUnitUsd(VIDU, { resolution: "720p", duration: "5" }, false, false, "i2v", VIDU_CTX), 0.5225, "vidu-q4 card fields price the same number"],
      [videoUnitUsd(VIDU, { resolution: "540p", duration: "5" }, false, false, "i2v", VIDU_CTX), 0.2475, "an explicit 540p still prices the cheap tier"],
      [videoUnitUsd(VIDU, { resolution: "1080p" }, false, false, "i2v", VIDU_CTX), 0.66, "an explicit resolution keeps the settings duration"],
      [videoUnitUsd(VIDU, {}), 0.2475, "no settings keeps the first price-map key"],
      [videoUnitUsd(WAN25, {}, false, false, undefined, WAN25_CTX), 0.6, "wan-25 card default 720p beats pricing.default_resolution 480p"],
      [videoUnitUsd(WAN25, {}), 0.3, "wan-25 without settings still uses pricing.default_resolution"],
      [videoUnitUsd(EXTEND, {}, false, false, "v2v", EXTEND_CTX), 1.2, "seedance extend card duration 5s beats pricing.default_duration 4s"],
      [videoUnitUsd(EXTEND, {}), 0.96, "seedance extend without settings still uses pricing.default_duration"],
    ];
    for (const [got, want, label] of cases) {
      if (near(got, want)) ok(`${name}: ${label}`);
      else fail(`${name}: ${label} — got ${got}, want ${want}`);
    }
  }
}

// ---- 2 + 3. model options and the ref hint (editor only) --------------------
function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error(name + "() not found");
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("could not brace-match " + name);
}
const grab = (re, what) => {
  const m = IDX.match(re);
  if (!m) throw new Error(what + " not found");
  return m[0];
};

const ui = {
  NODE_TYPES: {
    tvideo: { modelKind: "video", modelFilter: "t2v", refInputs: true },
    ivideo: { modelKind: "video", modelFilter: "i2v", endFrame: true },
    vedit: { modelKind: "video", modelFilter: "v2v", refInputs: true },
  },
  models: {},
  esc: (s) => String(s == null ? "" : s),
  t: (s) => s,
};
ui.catItem = (_kind, id) => ui.models[id] || null;
vm.createContext(ui);
const bundle = [
  grab(/const PRICE_OR_DIM_PARAM = \/[^\n]*;/, "PRICE_OR_DIM_PARAM"),
  grab(/const VIDEO_IMG_ROLE_KEYS = \{[^}]*\};/, "VIDEO_IMG_ROLE_KEYS"),
  grab(/const VIDEO_REF_PRICE_KEYS = \[[^\]]*\];/, "VIDEO_REF_PRICE_KEYS"),
  grab(/const videoRefsModePriced = \(p\)=>[\s\S]*?;/, "videoRefsModePriced"),
  grab(/const videoRefsPriced = \(m\)=> \{[^}]*\};/, "videoRefsPriced"),
  grab(/const VIDEO_REF_MAX = \[[\s\S]*?\];/, "VIDEO_REF_MAX"),
  extractFn(IDX, "videoFreetextSkip"),
  extractFn(IDX, "videoOptDefs"),
  extractFn(IDX, "videoRefSpec"),
  extractFn(IDX, "refreshRefHint"),
  "globalThis.api = { videoFreetextSkip, videoOptDefs, videoRefSpec, refreshRefHint };",
].join("\n");
vm.runInContext(bundle, ui);
const api = ui.api;

const media = [
  ["imageUrl", "imageUrl"],
  ["image_url", "image_url"],
  ["endImageUrl", "endImageUrl"],
  ["lastImageUrl", "lastImageUrl"],
  ["referenceImages", "referenceImages"],
  ["reference_images", "reference_images"],
  ["referenceImageUrls", "referenceImageUrls"],
  ["audioUrl", "audioUrl"],
];
for (const [key, label] of media) {
  if (api.videoFreetextSkip(key, { type: "string", description: "a media slot" })) ok(`media field hidden: ${label}`);
  else fail(`media field still surfaces: ${label}`);
}
const kept = [
  ["seed", { type: "number", description: "Use -1 for a random result." }],
  ["negative_prompt", { type: "text", description: "What to avoid in the video" }],
  ["video_prompt", { type: "text", description: "Controls body movement" }],
  ["guidance_scale", { type: "number", description: "Prompt adherence" }],
];
for (const [key, d] of kept) {
  if (!api.videoFreetextSkip(key, d)) ok(`creative knob kept: ${key}`);
  else fail(`creative knob hidden: ${key}`);
}

// Vidu Q4's Image→Video param list, as the catalog ships it.
ui.models["vidu-q4"] = {
  id: "vidu-q4",
  t2v: false,
  i2v: true,
  params: {
    mode: { type: "select", label: "Generation mode", default: "image-to-video", options: [
      { value: "image-to-video", label: "Image to video" },
      { value: "reference-to-video", label: "Reference to video" },
    ] },
    duration: { type: "integer", label: "Duration", default: "5", options: [{ value: "5" }] },
    resolution: { type: "select", label: "Resolution", default: "720p", options: [{ value: "540p" }, { value: "720p" }] },
    seed: { type: "number", label: "Seed", default: -1 },
    aspect_ratio: { type: "select", label: "Reference mode aspect ratio", default: "16:9", options: [{ value: "16:9" }, { value: "1:1" }] },
    generate_audio: { type: "switch", label: "Generate reference mode audio", default: false },
    reference_images: { type: "text", label: "Reference image URLs", description: "Reference mode only. Up to 12 image URLs." },
    reference_audios: { type: "text", label: "Reference voice URLs", description: "Reference mode only." },
    imageUrl: { type: "string", description: "Starting PNG, JPEG or WebP image, required in image-to-video." },
    prompt: { type: "string", description: "Optional for image-to-video." },
    negative_prompt: { type: "text", label: "Negative prompt", description: "What to avoid" },
  },
  defaults: { resolution: "720p", duration: "5", seed: -1 },
  pricing: {},
};
// A description that mentions reference mode must NOT hide a knob that still works on i2v.
ui.models["h3-max"] = {
  id: "h3-max",
  t2v: true,
  params: {
    prompt_expansion_mode: { type: "select", label: "Prompt Expansion", description: "Reference mode supports balanced or quality.", options: [
      { value: "fast", label: "Fast" }, { value: "balanced", label: "Balanced" },
    ] },
    generate_audio: { type: "switch", label: "Generate Audio", description: "Include synchronized audio in the output", default: true },
  },
  defaults: {},
  pricing: {},
};

const ivideoKeys = api.videoOptDefs("vidu-q4", "ivideo").map((d) => d.key);
if (!ivideoKeys.includes("imageUrl")) ok("Image→Video model options omit imageUrl");
else fail("Image→Video still shows imageUrl: " + JSON.stringify(ivideoKeys));
if (!ivideoKeys.includes("reference_images") && !ivideoKeys.includes("referenceImages")) ok("Image→Video model options omit reference image URLs");
else fail("Image→Video still shows a reference-image text box: " + JSON.stringify(ivideoKeys));
if (!ivideoKeys.includes("generate_audio")) ok("Image→Video hides Generate reference mode audio");
else fail("Image→Video still shows generate_audio: " + JSON.stringify(ivideoKeys));
if (ivideoKeys.includes("seed")) ok("Image→Video still shows Seed");
else fail("Image→Video dropped Seed: " + JSON.stringify(ivideoKeys));
if (ivideoKeys.includes("negative_prompt")) ok("Image→Video still shows a negative prompt");
else fail("Image→Video dropped negative_prompt: " + JSON.stringify(ivideoKeys));

const tvideoKeys = api.videoOptDefs("vidu-q4", "tvideo").map((d) => d.key);
if (tvideoKeys.includes("generate_audio")) ok("Text→Video keeps Generate reference mode audio (the node can select that mode)");
else fail("Text→Video hid generate_audio: " + JSON.stringify(tvideoKeys));
if (!tvideoKeys.includes("imageUrl")) ok("Text→Video also hides imageUrl");
else fail("Text→Video shows imageUrl: " + JSON.stringify(tvideoKeys));

const h3Keys = api.videoOptDefs("h3-max", "ivideo").map((d) => d.key);
if (h3Keys.includes("prompt_expansion_mode") && h3Keys.includes("generate_audio")) ok("a knob that only mentions reference mode in its description stays on Image→Video");
else fail("H3 Image→Video lost a real knob: " + JSON.stringify(h3Keys));

function hintFor(id) {
  const box = { innerHTML: "stale" };
  const n = { id: "n1", type: "ivideo", fields: { model: id }, el: { querySelector: (sel) => sel === "[data-refhint]" ? box : null } };
  api.refreshRefHint(n);
  return box.innerHTML;
}
ui.models["seedance-ref"] = {
  id: "seedance-ref",
  t2v: true,
  params: { reference_images: { type: "text", max: 9 } },
  pricing: {},
};
ui.models["plain-i2v"] = { id: "plain-i2v", t2v: true, params: { seed: { type: "number" } }, pricing: {} };

const viduHint = hintFor("vidu-q4");
if (viduHint === "") ok("Image→Video drops the Text→Video ref hint for Vidu Q4");
else fail("Vidu Q4 still shows the ref hint: " + viduHint);
const seedHint = hintFor("seedance-ref");
if (seedHint.includes("Text→Video") && seedHint.includes("ref ports")) ok("Image→Video keeps the ref hint when the model is on Text→Video");
else fail("t2v ref model lost the hint: " + seedHint);
if (hintFor("plain-i2v") === "") ok("a model with no ref param still has no hint");
else fail("plain i2v grew a ref hint: " + hintFor("plain-i2v"));

if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1); }
console.log("✓ check-vidu-q4");
