#!/usr/bin/env node
// Image-picker allowlists that are NOT catalog-derivable, copied as an editor Set
// vs a play object. A one-sided edit hides a working mask or offers a text-to-image
// slot that 400s on a paid send:
//
//   INPAINT_OK — edit models live-verified (2026-06-26) to HONOR a brushed mask
//     (outside-mask change < 6/255). Many advertise "inpainting" yet regenerate the
//     whole image (ideogram-v2/v3/v4, qwen-image, seedream-v4, glm-image-edit).
//     True *inpaint* ids also open the Inpaint node via the name regex; INPAINT_OK
//     only WIDENS that picker. Those optional-mask models stay in Edit too.
//
//   NEEDS_SRC_IDS — edit-only ids the catalog labels "text+image->image" whose name
//     carries no upscal/img2img tell (live-probed 2026-07-31: hidream-e1-1, wan-2.6-
//     image-edit, vidu-q2-reference). Without the list they surface as generators
//     and fail with no source image. Optional-image editors that DO work text-only
//     (nano-banana-2-lite, seedream-v4.5, qwen-image-3) must stay out.
//
// Offline: extract both maps + editor normImg + play modelSuits; drive them on the
// same catalog table. No browser, no API spend.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

let fail = 0;
const ok = (c, m) => {
  if (!c) { fail++; console.log("  ✗ " + m); }
  else console.log("  ✓ " + m);
};

function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error(name + "() not found");
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("could not brace-match " + name + "()");
}

function grabAssign(src, name) {
  const re = new RegExp("(?:const|var|let)\\s+" + name + "\\s*=");
  const m = re.exec(src);
  if (!m) throw new Error(name + " assignment not found");
  let depth = 0;
  for (let i = m.index + m[0].length; i < src.length; i++) {
    const c = src[i];
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === ";" && depth === 0) return src.slice(m.index, i + 1);
  }
  throw new Error("could not find end of " + name);
}

function keysOf(v) {
  if (v instanceof Set) return [...v].sort();
  if (Array.isArray(v)) return [...v].sort();
  if (v && typeof v === "object") return Object.keys(v).sort();
  throw new Error("unexpected map shape: " + typeof v);
}

function loadMap(src, name) {
  const assigns = [];
  const re = new RegExp("(?:const|var|let)\\s+" + name + "\\s*=", "g");
  let m;
  while ((m = re.exec(src))) {
    assigns.push(grabAssign(src.slice(m.index), name));
  }
  if (!assigns.length) throw new Error(name + " not found");
  return assigns.map((a) => keysOf(new Function(a + "; return " + name + ";")()));
}

const WANT_INPAINT_OK = [
  "bria-fibo", "bria-fibo-edit",
  "nano-banana", "nano-banana-2", "nano-banana-pro", "nano-banana-edit",
  "nano-banana-pro-edit", "nano-banana-pro-edit-ultra",
  "reve-2-edit", "reve-2-remix",
  "pruna-ai/p-image/edit", "pruna-ai/p-image/edit-lora",
  "kling-image-o1", "fal-ai/boogu-image/edit", "gemini-flash-edit", "flux-kontext",
  "imagineart/imagineart-2.0-edit-preview/image-to-image",
].sort();

const WANT_NEEDS_SRC = ["hidream-e1-1", "vidu-q2-reference", "wan-2.6-image-edit"].sort();

// Comment-documented false advertisers / optional-image editors — must stay out of
// INPAINT_OK (a mask on these regenerates the whole image) and NEEDS_SRC_IDS
// (they generate from a bare prompt).
const INPAINT_NO = [
  "ideogram-v2", "ideogram-v3", "ideogram-v4",
  "qwen-image", "seedream-v4", "glm-image-edit",
  "nano-banana-2-lite", "seedream-v4.5", "qwen-image-3",
  "flux-2-pro-image-to-image",
];
const NEEDS_SRC_NO = ["nano-banana-2-lite", "seedream-v4.5", "qwen-image-3", "nano-banana"];

// ---- A. membership twins --------------------------------------------------
{
  const idxInpaint = loadMap(IDX, "INPAINT_OK");
  const playInpaint = loadMap(PLAY, "INPAINT_OK");
  ok(idxInpaint.length === 1, `index.html INPAINT_OK ×${idxInpaint.length}`);
  ok(playInpaint.length === 1, `play.html INPAINT_OK ×${playInpaint.length}`);
  for (const got of [...idxInpaint, ...playInpaint]) {
    ok(JSON.stringify(got) === JSON.stringify(WANT_INPAINT_OK),
      `INPAINT_OK === shipped allowlist (got ${JSON.stringify(got)})`);
  }
  for (const id of INPAINT_NO) {
    const leaked = [...idxInpaint, ...playInpaint].some((ks) => ks.includes(id));
    ok(!leaked, `INPAINT_OK rejects ${JSON.stringify(id)}`);
  }

  const idxSrc = loadMap(IDX, "NEEDS_SRC_IDS");
  const playSrc = loadMap(PLAY, "NEEDS_SRC_IDS");
  ok(idxSrc.length === 1, `index.html NEEDS_SRC_IDS ×${idxSrc.length}`);
  ok(playSrc.length === 1, `play.html NEEDS_SRC_IDS ×${playSrc.length}`);
  for (const got of [...idxSrc, ...playSrc]) {
    ok(JSON.stringify(got) === JSON.stringify(WANT_NEEDS_SRC),
      `NEEDS_SRC_IDS === shipped allowlist (got ${JSON.stringify(got)})`);
  }
  for (const id of NEEDS_SRC_NO) {
    const leaked = [...idxSrc, ...playSrc].some((ks) => ks.includes(id));
    ok(!leaked, `NEEDS_SRC_IDS rejects ${JSON.stringify(id)}`);
  }
}

// ---- B. editor normImg ↔ play modelSuits lockstep -------------------------
const editor = (() => {
  const bundle = [
    grabAssign(IDX, "INPAINT_OK"),
    grabAssign(IDX, "NEEDS_SRC_IDS"),
    grabAssign(IDX, "IMG_INPUT_ROLES"),
    "function imageTakesLora(){ return false; }",
    extractFn(IDX, "normImg"),
    "globalThis.__t = { normImg };",
  ].join("\n");
  const ctx = {};
  vm.createContext(ctx);
  new vm.Script(bundle, { filename: "index.html#inpaint-src" }).runInContext(ctx);
  return ctx.__t;
})();

const play = (() => {
  const bundle = [
    grabAssign(PLAY, "INPAINT_OK"),
    grabAssign(PLAY, "NEEDS_SRC_IDS"),
    extractFn(PLAY, "modelSuits"),
    "globalThis.__t = { modelSuits };",
  ].join("\n");
  const ctx = {};
  vm.createContext(ctx);
  new vm.Script(bundle, { filename: "play.html#inpaint-src" }).runInContext(ctx);
  return ctx.__t;
})();

function flagsOf(m) {
  const n = editor.normImg(m);
  return {
    gen: !!n.gen,
    edit: !!n.edit,
    inpaint: !!n.inpaint,
    playImage: !!play.modelSuits("image", m),
    playEdit: !!play.modelSuits("edit", m),
    playInpaint: !!play.modelSuits("inpaint", m),
  };
}

function pin(m, want, label) {
  const g = flagsOf(m);
  ok(g.gen === want.gen && g.playImage === want.gen,
    `${label}: gen/image=${want.gen} (editor=${g.gen} play=${g.playImage})`);
  ok(g.edit === want.edit && g.playEdit === want.edit,
    `${label}: edit=${want.edit} (editor=${g.edit} play=${g.playEdit})`);
  ok(g.inpaint === want.inpaint && g.playInpaint === want.inpaint,
    `${label}: inpaint=${want.inpaint} (editor=${g.inpaint} play=${g.playInpaint})`);
}

const textImage = (id, extra = {}) => ({
  id,
  architecture: { modality: extra.mod || "text+image->image" },
  capabilities: { image_to_image: extra.i2i !== false },
});

// INPAINT_OK optional-mask editor: stays in Edit AND opens Inpaint. Modality
// starts with "text" and the id has no upscal/img2img tell → also stays in Gen
// (these models work text-only; the mask is optional).
pin(textImage("nano-banana"), { gen: true, edit: true, inpaint: true },
  "nano-banana (INPAINT_OK, optional-mask)");
pin(textImage("flux-kontext"), { gen: true, edit: true, inpaint: true },
  "flux-kontext (INPAINT_OK)");
pin(textImage("gemini-flash-edit"), { gen: true, edit: true, inpaint: true },
  "gemini-flash-edit (INPAINT_OK)");

// INPAINT_OK id that ALSO matches the image-to-image name regex: leaves Gen
// (needsSrc) but stays in Edit and opens Inpaint.
pin(textImage("imagineart/imagineart-2.0-edit-preview/image-to-image"),
  { gen: false, edit: true, inpaint: true },
  "imagineart …/image-to-image (INPAINT_OK + name-regex needsSrc)");

// True mask-requiring inpainter: Inpaint only. The name regex hides it from
// Gen/Edit so a picker that sends no mask cannot 400.
pin(textImage("flux-lora/inpainting"), { gen: false, edit: false, inpaint: true },
  "flux-lora/inpainting (needsMask)");

// NEEDS_SRC_IDS: catalog says text+image but a bare prompt 400s. Must leave Gen,
// stay in Edit, stay out of Inpaint (mask not verified).
pin(textImage("hidream-e1-1"), { gen: false, edit: true, inpaint: false },
  "hidream-e1-1 (NEEDS_SRC_IDS)");
pin(textImage("wan-2.6-image-edit"), { gen: false, edit: true, inpaint: false },
  "wan-2.6-image-edit (NEEDS_SRC_IDS)");
pin(textImage("vidu-q2-reference"), { gen: false, edit: true, inpaint: false },
  "vidu-q2-reference (NEEDS_SRC_IDS)");

// Optional-image editor that works text-only — the reason NEEDS_SRC_IDS is an
// id list, not a modality rule. Must stay in Gen. Not mask-verified.
pin(textImage("nano-banana-2-lite"), { gen: true, edit: true, inpaint: false },
  "nano-banana-2-lite (optional-image, text-only works)");
pin(textImage("seedream-v4.5"), { gen: true, edit: true, inpaint: false },
  "seedream-v4.5 (optional-image, text-only works)");
pin(textImage("qwen-image-3"), { gen: true, edit: true, inpaint: false },
  "qwen-image-3 (optional-image, text-only works)");

// Comment-documented false advertisers: image_to_image editors that ignore a
// mask. Edit yes, Inpaint no.
pin(textImage("ideogram-v2"), { gen: true, edit: true, inpaint: false },
  "ideogram-v2 (advertises inpaint, regenerates whole image)");
pin(textImage("qwen-image"), { gen: true, edit: true, inpaint: false },
  "qwen-image (advertises inpaint, regenerates whole image)");
pin(textImage("glm-image-edit"), { gen: true, edit: true, inpaint: false },
  "glm-image-edit (advertises inpaint, regenerates whole image)");

// Name-regex needsSrc without INPAINT_OK: leave Gen, stay in Edit, no Inpaint.
pin(textImage("foo-upscale"), { gen: false, edit: true, inpaint: false },
  "*-upscale name regex (needsSrc, no mask)");
pin(textImage("bar-image-to-image"), { gen: false, edit: true, inpaint: false },
  "*-image-to-image name regex (needsSrc, no mask)");
pin(textImage("baz-img2img"), { gen: false, edit: true, inpaint: false },
  "*-img2img name regex (needsSrc, no mask)");

// Plain text→image generator (no i2i): Gen only.
pin({
  id: "plain-t2i",
  architecture: { modality: "text->image" },
  capabilities: {},
}, { gen: true, edit: false, inpaint: false },
  "plain text→image (no i2i, not on either list)");

if (fail) {
  console.error(`\n✗ inpaint-src-gates: ${fail} assertion(s) failed.`);
  process.exit(1);
}
console.log("\n✓ inpaint-src-gates: INPAINT_OK + NEEDS_SRC_IDS twins agree; editor normImg and play modelSuits stay in lockstep on mask-ok / needs-source / false-advertiser cases.");
