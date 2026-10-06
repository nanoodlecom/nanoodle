#!/usr/bin/env node
// Kandinsky 6 (kandinsky6-lite / kandinsky6-pro, NanoGPT Oct 6) price one fixed 5s clip by mode:
// pricing.per_video_by_mode = {text_to_video, image_to_video}. No branch read that key, so the
// estimate fell to genericScanUsd and quoted $25 a clip in both engines. Pins: Text → Video bills
// text_to_video, Image → Video bills image_to_video, the model list (no node) shows the
// text_to_video price, the minimum still floors it, and an unknown mode quotes the dearest mode.
// Offline, zero API spend. Prices from /api/v1/video-models on 2026-10-06; GET
// /api/estimate-video-cost agrees on text_to_video ($0.16 / $1.35).
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

function load(src, end) {
  const s = src.indexOf("const EST = {"), e = src.indexOf(end);
  if (s < 0 || e < 0) throw new Error("pricing block not found");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.slice(s, e) + "\nthis.videoUnitUsd=videoUnitUsd;", ctx);
  return ctx;
}

const LITE = { currency: "USD", per_video_by_mode: { text_to_video: 0.16, image_to_video: 0.17 }, minimum: 0.16, fixed_duration_seconds: 5, resolution: "480p", num_inference_steps: 10, audio_included: true };
const PRO = { currency: "USD", per_video_by_mode: { text_to_video: 1.35, image_to_video: 1.4 }, minimum: 1.35, fixed_duration_seconds: 5, resolution: "480p", num_inference_steps: 50, audio_included: true };
const near = (a, b) => a != null && Math.abs(a - b) < 1e-9;

const ENGINES = [
  ["editor", IDX, "function nodeUnitUsd("],
  ["play", PLAY, "async function nodeUnitUsdPlay("],
];

for (const [name, src, end] of ENGINES) {
  const { videoUnitUsd } = load(src, end);
  const cases = [
    ["lite t2v node", videoUnitUsd(LITE, {}, false, false, "t2v"), 0.16],
    ["lite i2v node", videoUnitUsd(LITE, {}, false, false, "i2v"), 0.17],
    ["lite model list", videoUnitUsd(LITE, {}), 0.16],
    ["pro t2v node", videoUnitUsd(PRO, {}, false, false, "t2v"), 1.35],
    ["pro i2v node", videoUnitUsd(PRO, {}, false, false, "i2v"), 1.4],
    ["pro 10s duration ignored (fixed 5s clip)", videoUnitUsd(PRO, { duration: "10" }, false, false, "t2v"), 1.35],
    ["unknown mode quotes dearest", videoUnitUsd({ per_video_by_mode: { text_to_video: 0.5, image_to_video: 0.7 } }, {}, false, false, "v2v"), 0.7],
    ["minimum floors a cheaper mode", videoUnitUsd({ per_video_by_mode: { text_to_video: 0.1 }, minimum: 0.2 }, {}, false, false, "t2v"), 0.2],
  ];
  for (const [label, got, want] of cases) {
    if (near(got, want)) ok(`${name}: ${label} = $${want}`);
    else fail(`${name}: ${label} quoted ${got}, want ${want}`);
  }
}

// The node chip and the model-picker row must pass the node's filter too, or an Image → Video node
// shows the text_to_video price ($0.16 / $1.35) while the run bar adds image_to_video ($0.17 / $1.40).
{
  const pins = [
    ["chip passes the node filter", /livePrice\(t\.modelKind, fields, t\.modelFilter\)/],
    ["livePrice forwards it to videoUnitUsd", /videoUnitUsd\(applyVideoQuotePricing\(fields\.model, it\.pricing\), videoPriceFields\(it\.params, fields\), false, false, nodeFilter\)/],
    ["picker rows price by the picker filter", /videoUnitUsd\(applyVideoQuotePricing\(m\.id, m\.pricing\), \{\}, false, false, picker\.filter\)/],
    ["picker rows render pickerRowPrice", /<span class="price">\$\{esc\(pickerRowPrice\(m\)\)\}<\/span>/],
  ];
  for (const [label, re] of pins) {
    if (re.test(IDX)) ok(`editor: ${label}`);
    else fail(`editor: ${label} (pin not found in index.html)`);
  }
}

if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1); }
console.log("✓ check-video-per-video-by-mode");
