#!/usr/bin/env node
// PixVerse V6 Max-style pricing: {per_second_without_audio, per_second_with_audio}
// resolution tables billed × requested seconds, with the Generate audio switch
// (generateAudio, catalog default off) picking the column.
// Before this fix videoBaseUsd fell to genericScanUsd, which read
// minimum_duration_seconds (1) as a $1/s rate: the picker and the node chip
// quoted $5.00 at 5s and $15.00 at 15s whatever the resolution or audio.
// The keys now ride the existing with-/without-audio per-second loops in
// videoBaseUsd (the veo3.x tiers), so no new twin lines were added.
// Catalog: GET https://nano-gpt.com/api/v1/video-models (id pixverse-v6-max,
// 2026-10-22), formula "requested duration in seconds × the resolution rate
// for the selected audio setting". Both engines. Offline, zero API spend.
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
const close = (a, b) => a != null && isFinite(a) && Math.abs(a - b) < 1e-9;

function loadResolver(src, end) {
  const s = src.indexOf("const EST = {"), e = src.indexOf(end);
  if (s < 0 || e < 0) throw new Error("pricing block not found");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    src.slice(s, e) +
      "\nthis.applyVideoQuotePricing=applyVideoQuotePricing; this.videoUnitUsd=videoUnitUsd; this.videoPriceFields=videoPriceFields;",
    ctx
  );
  return ctx;
}

const ID = "pixverse-v6-max";
const PRICING = {
  currency: "USD",
  unit: "per_output_second",
  per_second_without_audio: { "360p": 0.027, "540p": 0.04, "720p": 0.049, "1080p": 0.098 },
  per_second_with_audio: { "360p": 0.04, "540p": 0.049, "720p": 0.067, "1080p": 0.124 },
  minimum_duration_seconds: 1,
  maximum_duration_seconds: 15,
  default_duration_seconds: 5,
  default_resolution: "720p",
  default_generate_audio: false,
};
const opt = (v) => ({ value: v, label: v });
const PARAMS = {
  resolution: { type: "select", default: "720p", options: ["360p", "540p", "720p", "1080p"].map(opt) },
  duration: { type: "select", default: "5", options: Array.from({ length: 15 }, (_, i) => opt(String(i + 1))) },
  aspect_ratio: { type: "select", default: "auto", options: ["auto", "16:9"].map(opt) },
  generateAudio: { type: "switch", default: false, aliases: ["generate_audio_switch"] },
  generate_multi_clip_switch: { type: "switch", default: false },
  seed: { type: "number", default: 0 },
};
const CTX = { params: PARAMS, defaults: {} };
const ENGINES = [
  ["editor", IDX, "function nodeUnitUsd("],
  ["play", PLAY, "async function nodeUnitUsdPlay("],
];

// [label, resolution, duration, generateAudio (undefined = untouched switch), expected]
const CASES = [
  ["720p 5s audio off", "720p", "5", false, 0.245],
  ["1080p 5s audio off", "1080p", "5", false, 0.49],
  ["1080p 5s audio on", "1080p", "5", true, 0.62],
  ["360p 15s audio off", "360p", "15", false, 0.405],
  ["1080p 15s audio on", "1080p", "15", true, 1.86],
  ["720p 5s untouched switch (catalog default off)", "720p", "5", undefined, 0.245],
];

for (const [name, src, end] of ENGINES) {
  const R = loadResolver(src, end);
  const p = R.applyVideoQuotePricing(ID, PRICING);
  // videoPricingHasDurationRate only gates the VIDEO_QUOTE_PER_SECOND overlay;
  // pixverse-v6-max has no overlay row, so its catalog pricing passes through untouched.
  if (p !== PRICING) fail(name + ": pixverse-v6-max catalog pricing must pass through applyVideoQuotePricing");
  else ok(name + ": catalog pricing passes through (no quote overlay)");

  for (const [label, res, dur, audio, want] of CASES) {
    const fields = { model: ID, resolution: res, duration: dur };
    if (audio !== undefined) fields.modelOpts = { generateAudio: audio };
    const got = R.videoUnitUsd(p, R.videoPriceFields(PARAMS, fields), 0, false, "t2v", CTX);
    if (!close(got, want)) fail(name + ": " + label + " must quote $" + want + ", got " + got);
    else ok(name + ": " + label + " = $" + want);
  }

  // Alias key stored by the switch still bills the with-audio column.
  const alias = R.videoUnitUsd(p, { resolution: "1080p", duration: "5", modelOpts: { generate_audio_switch: true } }, 0, false, "t2v", CTX);
  if (!close(alias, 0.62)) fail(name + ": generate_audio_switch alias must bill with-audio ($0.62), got " + alias);
  else ok(name + ": generate_audio_switch alias bills the with-audio column");

  // Picker row: no node fields, catalog defaults (720p, 5s, audio off).
  const picker = R.videoUnitUsd(p, {}, false, false, "t2v", CTX);
  if (!close(picker, 0.245)) fail(name + ": picker default must quote $0.245 (720p 5s no audio), got " + picker);
  else ok(name + ": picker default = $0.245 (720p 5s no audio), not $5.00");

  // Pricing only (no params descriptor): default_resolution, 5s fallback (= default_duration_seconds).
  const bare = R.videoUnitUsd(p, {}, false, false, "t2v");
  if (!close(bare, 0.245)) fail(name + ": pricing-only default must quote $0.245, got " + bare);
  else ok(name + ": pricing-only default reads default_resolution (720p × 5s)");

  // Unknown resolution falls back to the catalog default (720p), not the first/cheapest key.
  const unk = R.videoUnitUsd(p, { resolution: "4k", duration: "5" }, 0, false, "t2v", CTX);
  if (!close(unk, 0.245)) fail(name + ": unknown 4k must fall back to 720p ($0.245), got " + unk);
  else ok(name + ": unknown resolution falls back to default 720p");
}

if (failed) {
  console.error("\n✗ check-video-audio-per-second: " + failed + " failed");
  process.exit(1);
}
console.log("\n✓ check-video-audio-per-second");
