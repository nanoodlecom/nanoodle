#!/usr/bin/env node
// Video "mode" knob dead-ends (found investigating MiniMax H3 Max / Wan 3.0 Prime wiring, which
// both ship a Seedance-2.5-style `mode` select: auto / text-to-video / image-to-video / video-edit /
// video-extend / reference-to-video).
//
// videoOptDefs() surfaces every catalog select/switch param as a "⚙️ Model options" knob, gated only
// by modeOK() for the `mode` key. Before this fix modeOK only excluded "reference-to-video" (needs a
// ref-image param) and "video-edit" (needs a source video) — "video-extend" (ALSO needs a source
// video), "image-to-video" (needs a source image) and "text-to-video" (forcing it on a node that
// ALWAYS sends an image/video as the primary input) were offered on every node regardless of what
// that node can actually feed. Each is a silent-drop risk, not just a decoy option:
//   - tvideo (Text→Video, no image/video port) offering "image-to-video"/"video-edit"/"video-extend"
//     → picking one sends mode:"<x>" with no image/video; the provider either 400s or silently
//     falls back, and the user has no idea why.
//   - ivideo (Image→Video, ALWAYS sends the wired image) offering "text-to-video"/"video-edit"/
//     "video-extend" → forcing "text-to-video" tells the model to ignore the image the user paid to
//     send; picking "video-edit"/"video-extend" (no video port on ivideo) is the same dead end as tvideo.
//   - vedit (Video edit, ALWAYS sends the wired video) offering "text-to-video"/"image-to-video"
//     → forcing "text-to-video" tells the model to ignore the video just sent.
//
// Catalog-driven, no model-name lists: modeOK gates purely on the NODE's declared input shape
// (modelFilter t2v/i2v/v2v) plus (for reference-to-video, unchanged) whether the model actually
// advertises a ref-image param. Offline: extracts the real videoOptDefs/modeOK from index.html and
// drives them in a node:vm sandbox. No browser, no API spend.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

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

const bundle = [
  grab(/const PRICE_OR_DIM_PARAM = \/[^\n]*;/, "PRICE_OR_DIM_PARAM"),
  grab(/const VIDEO_IMG_ROLE_KEYS = \{[^}]*\};/, "VIDEO_IMG_ROLE_KEYS"),
  grab(/const VIDEO_REF_PRICE_KEYS = \[[^\]]*\];/, "VIDEO_REF_PRICE_KEYS"),
  grab(/const videoRefsModePriced = \(p\)=>[\s\S]*?;/, "videoRefsModePriced"),
  grab(/const videoRefsPriced = \(m\)=> \{[^}]*\};/, "videoRefsPriced"),
  extractFn(IDX, "videoFreetextSkip"),
  extractFn(IDX, "videoOptDefs"),
  "globalThis.__t = { videoOptDefs };",
].join("\n");

// Real node shapes (mirrors NODE_TYPES): tvideo/vedit carry refInputs; ivideo does not (endFrame
// instead) — only refInputs + a ref-image param together turn on "reference-to-video".
const ctx = {
  NODE_TYPES: {
    tvideo: { modelKind: "video", modelFilter: "t2v", refInputs: true },
    ivideo: { modelKind: "video", modelFilter: "i2v", endFrame: true },
    vedit: { modelKind: "video", modelFilter: "v2v", refInputs: true },
    lipsync: { modelKind: "video", modelFilter: "avatar" },
  },
};
vm.createContext(ctx);
new vm.Script(bundle, { filename: "index.html#video-mode-gate" }).runInContext(ctx);
const T = ctx.__t;

// A Seedance-2.5 / Wan-3.0-Prime-shaped `mode` select — the same 6-option catalog shape both ship —
// plus a ref-image param so "reference-to-video" is reachable AT ALL (else it's excluded regardless
// of node, which the existing canRef gate already covers and this file leaves untouched).
const MODE_MODEL = "omni-video-model";
ctx.catItem = (_kind, id) => id === MODE_MODEL ? {
  params: {
    mode: {
      type: "select",
      options: [
        { value: "auto", label: "Automatic" },
        { value: "text-to-video", label: "Text to video" },
        { value: "image-to-video", label: "Image to video" },
        { value: "video-edit", label: "Video edit" },
        { value: "video-extend", label: "Video extend" },
        { value: "reference-to-video", label: "Reference to video" },
      ],
      default: "auto",
    },
    reference_images: { max: 4 },
  },
  defaults: { mode: "auto" },
} : null;

const modeValues = (nodeType) => {
  const defs = T.videoOptDefs(MODE_MODEL, nodeType);
  const modeDef = defs.find((d) => d.key === "mode");
  return modeDef ? modeDef.options.map((o) => o.value) : [];
};

// ---- tvideo (Text→Video): no image port, no video port ----------------------
{
  const vals = modeValues("tvideo");
  ok(vals.includes("auto"), "tvideo: auto always offered");
  ok(vals.includes("text-to-video"), "tvideo: text-to-video is the node's own purpose — must stay offered");
  ok(vals.includes("reference-to-video"), "tvideo: reference-to-video is reachable (refInputs + a ref param) — must stay offered");
  ok(!vals.includes("image-to-video"),
    `tvideo has no image port — "image-to-video" must be hidden (dead-end: mode set, no image sent), got ${JSON.stringify(vals)}`);
  ok(!vals.includes("video-edit"),
    `tvideo has no video port — "video-edit" must be hidden, got ${JSON.stringify(vals)}`);
  ok(!vals.includes("video-extend"),
    `tvideo has no video port — "video-extend" must be hidden (same dead end as video-edit), got ${JSON.stringify(vals)}`);
}

// ---- ivideo (Image→Video): ALWAYS sends the wired image, no video port, no refInputs ----------
{
  const vals = modeValues("ivideo");
  ok(vals.includes("auto"), "ivideo: auto always offered");
  ok(vals.includes("image-to-video"), "ivideo: image-to-video is the node's own purpose — must stay offered");
  ok(!vals.includes("text-to-video"),
    `ivideo always sends the wired image as the primary input — "text-to-video" must be hidden (forcing it tells the model to ignore what was just paid to send), got ${JSON.stringify(vals)}`);
  ok(!vals.includes("video-edit"),
    `ivideo has no video port — "video-edit" must be hidden, got ${JSON.stringify(vals)}`);
  ok(!vals.includes("video-extend"),
    `ivideo has no video port — "video-extend" must be hidden, got ${JSON.stringify(vals)}`);
  ok(!vals.includes("reference-to-video"),
    `ivideo has no refInputs (endFrame instead) — "reference-to-video" must stay hidden regardless of the model's ref param, got ${JSON.stringify(vals)}`);
}

// ---- vedit (Video edit): ALWAYS sends the wired video, no image port ----------------------------
{
  const vals = modeValues("vedit");
  ok(vals.includes("auto"), "vedit: auto always offered");
  ok(vals.includes("video-edit"), "vedit: video-edit is the node's own purpose — must stay offered");
  ok(vals.includes("video-extend"), "vedit: video-extend also needs a source video, which vedit supplies — must stay offered");
  ok(vals.includes("reference-to-video"), "vedit: reference-to-video is reachable (refInputs + a ref param) — must stay offered");
  ok(!vals.includes("text-to-video"),
    `vedit always sends the wired video as the primary input — "text-to-video" must be hidden, got ${JSON.stringify(vals)}`);
  ok(!vals.includes("image-to-video"),
    `vedit has no image port — "image-to-video" must be hidden, got ${JSON.stringify(vals)}`);
}

// ---- a model with no ref param at all: reference-to-video stays excluded on every node ----------
{
  ctx.catItem = (_kind, id) => id === "no-ref-model" ? {
    params: {
      mode: {
        type: "select",
        options: [
          { value: "auto", label: "Automatic" },
          { value: "text-to-video", label: "Text to video" },
          { value: "reference-to-video", label: "Reference to video" },
        ],
      },
    },
    defaults: {},
  } : null;
  for (const nt of ["tvideo", "vedit"]) {
    const defs = T.videoOptDefs("no-ref-model", nt);
    const modeDef = defs.find((d) => d.key === "mode");
    // vedit strips BOTH text-to-video (no video port fed by "text-to-video") and reference-to-video
    // (no ref param) here, leaving only "auto" — under 2 options, so the whole control is dropped
    // (nothing meaningful to choose). tvideo keeps auto+text-to-video, so the control still renders.
    ok(!(modeDef && modeDef.options.some((o) => o.value === "reference-to-video")),
      `${nt}: reference-to-video stays hidden without a ref-image param (unchanged canRef gate), got ${JSON.stringify(modeDef && modeDef.options.map((o) => o.value))}`);
  }
}

// ---- Omni-shaped catalog: no mode param at all (live 2026-09-01) ------------
{
  ctx.catItem = (_kind, id) => id === "google/gemini-omni-flash/v1.1" ? {
    params: {
      duration: { type: "select", options: [{ value: "8" }], default: "8" },
      resolution: { type: "select", options: [{ value: "720p" }, { value: "4k" }], default: "720p" },
      aspect_ratio: { type: "select", options: [{ value: "16:9" }], default: "16:9" },
    },
    pricing: { per_second_by_mode_and_resolution: { reference_to_video: { "720p": 0.16 } } },
    defaults: {},
  } : null;
  for (const nt of ["tvideo", "ivideo", "vedit"]) {
    const defs = T.videoOptDefs("google/gemini-omni-flash/v1.1", nt);
    ok(!defs.some((d) => d.key === "mode"),
      `${nt}: Omni 1.1 has no mode param — no mode knob (got ${JSON.stringify(defs.map((d) => d.key))})`);
  }
}

// ---- Omni-shaped pricing + a Seedance-style mode select: canRef via billed r2v mode ----
{
  ctx.catItem = (_kind, id) => id === "omni-with-mode" ? {
    params: {
      mode: {
        type: "select",
        options: [
          { value: "auto", label: "Automatic" },
          { value: "text-to-video", label: "Text to video" },
          { value: "reference-to-video", label: "Reference to video" },
        ],
        default: "auto",
      },
    },
    pricing: { per_second_by_mode: { text_to_video: 0.13, reference_to_video: 0.16 } },
    defaults: { mode: "auto" },
  } : null;
  const tvideo = T.videoOptDefs("omni-with-mode", "tvideo");
  const modeDef = tvideo.find((d) => d.key === "mode");
  ok(modeDef && modeDef.options.some((o) => o.value === "reference-to-video"),
    `tvideo: billed reference_to_video mode (no reference_images param) still offers the mode — got ${JSON.stringify(modeDef && modeDef.options.map((o) => o.value))}`);
  const ivideo = T.videoOptDefs("omni-with-mode", "ivideo");
  const iMode = ivideo.find((d) => d.key === "mode");
  ok(!(iMode && iMode.options.some((o) => o.value === "reference-to-video")),
    `ivideo: still no refInputs — reference-to-video stays hidden even when pricing advertises r2v, got ${JSON.stringify(iMode && iMode.options.map((o) => o.value))}`);
}

if (fail) {
  console.error(`\n✗ video-mode-gate: ${fail} assertion(s) failed.`);
  process.exit(1);
}
console.log("\n✓ video-mode-gate: the `mode` knob only offers generation types the node can actually feed (auto/text-to-video on tvideo, image-to-video on ivideo, video-edit+video-extend+reference-to-video on vedit) — no dead-end selection silently ignores a wired input or sends an unfed mode.");
