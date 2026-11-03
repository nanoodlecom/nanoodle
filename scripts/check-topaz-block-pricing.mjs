#!/usr/bin/env node
// NanoGPT added 4 Topaz edit models on 2026-11-01 (topaz-image-upscale, -transparent-upscale,
// -denoise-max, -super-focus) with pricing.per_image:{} and a started-megapixel-block tariff instead.
// normImg read only per_image, so they priced null: no picker/node chip, the run total skipped them
// ($0), and — being the newest edit models — a brand-new ✂️ Edit node DEFAULTED to Topaz Image Upscale.
// This pins, on both engines: (1) block-billed models price at their floor ("from $X/img", sortUsd set,
// run estimate > 0 and flagged inexact), (2) a new Edit node never defaults to an unpriced / upscale-only /
// no-instruction model while a normal per-image editor exists, (3) ordinary per_image pricing is unchanged.
// Fixture is the live catalog shape (GET /api/v1/image-models, 2026-11-03), trimmed. Offline, $0.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const PLAY = fs.readFileSync(path.join(ROOT, "play.html"), "utf8");
let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);
const near = (a, b) => a != null && isFinite(a) && Math.abs(a - b) < 1e-9;

function extractFn(src, name) {
  const re = new RegExp("(?:^|\\n)([ \\t]*)(?:async )?function " + name + "\\(");
  const m = re.exec(src); if (!m) throw new Error("function not found: " + name);
  const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
  let i = src.indexOf("{", src.indexOf(")", start)), depth = 0;
  // walk braces, skipping strings/template literals/regex-free comments well enough for these helpers
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; } continue; }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced: " + name);
}

const tier = (usd, mp) => ({ usd_per_started_block: usd, megapixels_per_block: mp });
const TOPAZ_UPSCALE = {
  id: "topaz-image-upscale", name: "Topaz Image Upscale", created: 1793577600,
  architecture: { modality: "text+image->image" },
  capabilities: { image_generation: true, image_to_image: true, inpainting: false, nsfw: false },
  pricing: {
    per_image: {}, starting_at: 0.08, billing: "started_megapixel_blocks", megapixel_pixels: 1000000, area_basis: "output",
    target_megapixels: { "2k": 4.194304, "4k": 16.777216, "8k": 67.108864 },
    tariffs: [
      { algorithm: "Standard V2", scale: tier(0.08, 24), target: tier(0.1, 24) },
      { algorithm: "Bloom", scale: tier(0.08, 2), target: tier(0.1, 2) },
      { algorithm: "Wonder 4", target: tier(0.1, 8) },
      { algorithm: "Wonder", scale: tier(0.08, 4), target: tier(0.1, 4) },
    ],
    currency: "USD",
  },
  supported_parameters: {
    prompt_length: { status: "known" }, resolutions: ["scale", "2k", "4k", "8k"],
    topaz_model: ["Standard V2", "Bloom", "Wonder 4", "Wonder"], upscale_factor: { type: "integer", minimum: 1, maximum: 4, default: 2, applies_to: "scale" },
    max_input_images: 1, max_output_images: 1, fixed_image_count: 1,
  },
  tags: ["image-to-image", "upscale", "topaz"],
};
const TOPAZ_DENOISE = {
  id: "topaz-denoise-max", name: "Topaz Denoise Max", created: 1793577600,
  architecture: { modality: "image->image" }, capabilities: { image_to_image: true, nsfw: false },
  pricing: { per_image: {}, starting_at: 0.08, billing: "started_megapixel_blocks", area_basis: "source",
    tariffs: [{ algorithm: "Denoise Max", source: tier(0.08, 20) }] },
  supported_parameters: { prompt_length: { status: "not_applicable" }, resolutions: ["source"], max_input_images: 1, fixed_image_count: 1 },
};
const ERASE = {   // same created stamp, priced, but mask-only and takes no prompt
  id: "flux-pro/v1/erase", name: "FLUX.1 Pro Erase", created: 1793577600,
  architecture: { modality: "image->image" }, capabilities: { image_to_image: true, nsfw: false },
  pricing: { per_image: { auto: 0.05 } },
  supported_parameters: { prompt_length: { status: "not_applicable" }, resolutions: ["auto"], max_input_images: 1 },
};
const BANANA = {
  id: "nano-banana-edit", name: "Nano Banana Edit", created: 1760000000,
  architecture: { modality: "text+image->image" }, capabilities: { image_to_image: true, nsfw: false },
  pricing: { per_image: { square: 0.039 } }, supported_parameters: { prompt_length: { status: "unknown" } },
};
const RAW = [TOPAZ_UPSCALE, TOPAZ_DENOISE, ERASE, BANANA];   // newest-first, Topaz first (native order on the tie)

/* ---- editor: normImg → catalog item, livePrice chip, defModelFor ---- */
const ctx = {
  NEEDS_SRC_IDS: new Set(), INPAINT_OK: new Set(), IMG_INPUT_ROLES: {},
  imageTakesLora: () => false, aspectFromParams: () => null, imageKnobSpec: () => null,
  NODE_TYPES: { edit: { modelKind: "image", modelFilter: "edit" }, image: { modelKind: "image", modelFilter: "gen" } },
  catalogs: { image: [] },
};
vm.createContext(ctx);
vm.runInContext([
  extractFn(INDEX, "blockTariffUsd"), extractFn(INDEX, "normImg"), extractFn(INDEX, "passesFilter"),
  extractFn(INDEX, "defModelFor"), extractFn(INDEX, "imageDefaultOk"), extractFn(INDEX, "imageUnitUsd"),
  extractFn(INDEX, "livePrice"),
  "const catItem = (kind, id) => (catalogs[kind] || []).find(m => m.id === id);",
  "this.normImg = normImg; this.defModelFor = defModelFor; this.livePrice = livePrice; this.imageUnitUsd = imageUnitUsd; this.blockTariffUsd = blockTariffUsd;",
].join("\n"), ctx);

const items = RAW.map(ctx.normImg);
ctx.catalogs.image = items;
const up = items[0], dn = items[1], er = items[2], nb = items[3];

if (up.sortUsd != null && near(up.sortUsd, 0.08)) ok("editor: topaz-image-upscale sortUsd = 0.08 (was null)"); else fail(`editor: topaz-image-upscale sortUsd = ${up.sortUsd}, want 0.08`);
if (up.price === "from $0.080/img") ok(`editor: picker price "${up.price}"`); else fail(`editor: picker price = ${JSON.stringify(up.price)}, want "from $0.080/img"`);
if (up.priceFrom === true && up.edit === true) ok("editor: topaz-image-upscale flagged priceFrom, still an edit model"); else fail(`editor: priceFrom=${up.priceFrom} edit=${up.edit}`);
for (const [size, want] of [["scale", 0.08], ["2k", 0.1], ["4k", 0.1], ["8k", 0.3], ["", 0.08]]) {
  const u = ctx.imageUnitUsd("topaz-image-upscale", size);
  if (near(u, want)) ok(`editor: run estimate unit @${size || "default"} = $${want}`); else fail(`editor: imageUnitUsd(topaz, ${size}) = ${u}, want ${want}`);
}
const chip = ctx.livePrice("image", { model: "topaz-image-upscale", size: "8k" });
if (chip === "from $0.300/img") ok(`editor: node chip @8k "${chip}"`); else fail(`editor: node chip @8k = ${JSON.stringify(chip)}, want "from $0.300/img"`);
if (near(dn.sortUsd, 0.08) && dn.price === "from $0.080/img") ok("editor: topaz-denoise-max (source tariff) priced from $0.080"); else fail(`editor: denoise sortUsd=${dn.sortUsd} price=${dn.price}`);
if (near(nb.sortUsd, 0.039) && nb.price === "$0.039/img" && !nb.priceFrom) ok("editor: per_image pricing unchanged (Nano Banana Edit $0.039/img, no 'from')"); else fail(`editor: banana sortUsd=${nb.sortUsd} price=${nb.price} priceFrom=${nb.priceFrom}`);
if (near(er.sortUsd, 0.05) && er.price === "$0.050/img") ok("editor: flux erase per_image unchanged"); else fail(`editor: erase price=${er.price}`);

const def = ctx.defModelFor("edit");
if (def === "nano-banana-edit") ok("editor: new ✂️ Edit node defaults to nano-banana-edit (skips Topaz upscale/denoise and no-prompt erase)");
else fail(`editor: defModelFor('edit') = ${JSON.stringify(def)}, want "nano-banana-edit" (never Topaz / an unpriced or upscale-only model)`);
// Old localStorage cache rows (pre-fix shape: no priceFrom/promptNA, sortUsd null) must not win either.
ctx.catalogs.image = [{ id: "topaz-image-upscale", edit: true, sortUsd: null, sizePrices: {}, price: "" }, ...items.slice(3)];
if (ctx.defModelFor("edit") === "nano-banana-edit") ok("editor: a stale cached unpriced Topaz row is skipped too"); else fail(`editor: stale cache default = ${ctx.defModelFor("edit")}`);
// Nothing qualifies → keep the old newest-passing behaviour rather than leaving the node blank.
ctx.catalogs.image = items.slice(0, 2);
if (ctx.defModelFor("edit") === "topaz-image-upscale") ok("editor: only Topaz in the catalog → still falls back to newest (node not blank)"); else fail(`editor: fallback default = ${ctx.defModelFor("edit")}`);

/* ---- play.html twin: imageUsd off the RAW catalog pricing ---- */
const pctx = {};
vm.createContext(pctx);
vm.runInContext(extractFn(PLAY, "blockTariffUsd") + "\n" + extractFn(PLAY, "imageUsd") + "\nthis.imageUsd = imageUsd; this.blockTariffUsd = blockTariffUsd;", pctx);
for (const [size, want] of [["scale", 0.08], ["2k", 0.1], ["8k", 0.3], [undefined, 0.08]]) {
  const u = pctx.imageUsd(TOPAZ_UPSCALE.pricing, size, 1);
  if (near(u, want)) ok(`play: imageUsd topaz @${size || "default"} = $${want}`); else fail(`play: imageUsd(topaz, ${size}) = ${u}, want ${want}`);
}
if (near(pctx.imageUsd(BANANA.pricing, "square", 2), 0.078)) ok("play: per_image pricing unchanged (banana ×2 = $0.078)"); else fail("play: banana pricing changed");
if (pctx.imageUsd({ per_image: {} }, "square", 1) === null) ok("play: no tariff and no starting_at stays unpriced (null, not $0)"); else fail("play: empty pricing should stay null");
// Both engines must agree on every size.
for (const size of ["scale", "2k", "4k", "8k", "source", ""]) for (const raw of [TOPAZ_UPSCALE, TOPAZ_DENOISE]) {
  const a = ctx.blockTariffUsd(raw.pricing, size), b = pctx.blockTariffUsd(raw.pricing, size);
  if (a !== b) fail(`twin drift: blockTariffUsd(${raw.id}, ${size}) editor=${a} play=${b}`);
}
ok("editor/play blockTariffUsd agree");

if (failed) { console.error(failed + " failure(s)"); process.exit(1); }
