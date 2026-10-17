#!/usr/bin/env node
// An untouched video audio switch is absent from modelOpts. NanoGPT bills the
// catalog default for that omitted key. x402 quotes 2026-10-09 (POST
// /api/generate-video, no key, header x-x402: true, HTTP 402 payment.amountUsd,
// nothing runs):
//   bytedance-seedance-v1.5-pro       720p 5s  omit $0.26  audio on $0.26  off $0.13
//   bytedance-seedance-v1.5-pro-fast  720p 5s  omit $0.20  audio on $0.20  off $0.10
//   veo3-video                        fixed 8s omit $4.80  audio on $4.80  off $3.20
//   veo3-fast-video                   fixed 8s omit $1.60  audio on $1.60  off $1.20
//   veo3-1-fast-video                 8s       omit $1.20  audio on $1.20  off $0.80
//   pixverse-c1                       720p 5s  omit $0.25  audio on $0.325 off $0.25
//     (catalog default false; the catalog per-second table is what the estimate
//     uses — the quote confirmed the COLUMN, and it is the silent one)
// The estimate used to assume audio off whenever the key was missing, so the
// default-on models showed about half the bill. Explicit false stays silent.
// Offline, zero API spend.
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
  vm.runInContext(src.slice(s, e) +
    "\nthis.applyVideoQuotePricing=applyVideoQuotePricing; this.videoUnitUsd=videoUnitUsd; this.videoPriceFields=videoPriceFields; this.videoAudioOn=videoAudioOn;", ctx);
  return ctx;
}

const DUR = { type: "select", options: [] };
const onCtx = { params: { duration: DUR, generateAudio: { type: "switch", default: true, label: "Generate Audio" } }, defaults: { generateAudio: true } };
const offCtx = { params: { duration: DUR, generateAudio: { type: "switch", default: false, label: "Generate Audio" } }, defaults: { generateAudio: false } };
const snakeOn = { params: { duration: DUR, generate_audio: { type: "switch", default: true } }, defaults: { generate_audio: true } };

// Published catalog rates for Seedance (1/1.7 of the quote). applyVideoQuotePricing
// replaces them with the measured 402 table, which is what the node chip uses.
const PRO_CATALOG = { currency: "USD", raw: { type: "resolution-per-second-audio-toggle", defaultDuration: 5, defaultResolution: "720p",
  withoutAudioPricesPerSecond: { "480p": 0.007058823529411765, "720p": 0.015294117647058823, "1080p": 0.030588235294117645 },
  withAudioPricesPerSecond: { "480p": 0.01411764705882353, "720p": 0.030588235294117645, "1080p": 0.06117647058823529 } } };
const FAST_CATALOG = { currency: "USD", raw: { type: "resolution-per-second-audio-toggle", defaultDuration: 5, defaultResolution: "720p",
  withoutAudioPricesPerSecond: { "720p": 0.011764705882352941, "1080p": 0.01764705882352941 },
  withAudioPricesPerSecond: { "720p": 0.023529411764705882, "1080p": 0.03529411764705882 } } };
const VEO = { currency: "USD", with_audio: 4.8, without_audio: 3.2, fixed_duration_seconds: 8 };
const VEO_FAST = { currency: "USD", with_audio: 1.6, without_audio: 1.2, fixed_duration_seconds: 8 };
const VEO31_FAST = { currency: "USD", text_image_with_audio_per_second: 0.15, text_image_without_audio_per_second: 0.1, default_duration: 8, default_resolution: "720p" };
const PIX = { currency: "USD", raw: { type: "resolution-per-second-audio-toggle", defaultDuration: 5, defaultResolution: "720p",
  withoutAudioPricesPerSecond: { "720p": 0.029411764705882356 },
  withAudioPricesPerSecond: { "720p": 0.03823529411764706 } } };

const ENGINES = [["editor", IDX, "function nodeUnitUsd("], ["play", PLAY, "async function nodeUnitUsdPlay("]];
for (const [name, src, end] of ENGINES) {
  const R = loadResolver(src, end);
  const pro = R.applyVideoQuotePricing("bytedance-seedance-v1.5-pro", PRO_CATALOG);
  const fast = R.applyVideoQuotePricing("bytedance-seedance-v1.5-pro-fast", FAST_CATALOG);
  const usd = (pricing, fields, ctx) => R.videoUnitUsd(pricing, R.videoPriceFields((ctx && ctx.params) || { duration: DUR }, fields), false, false, undefined, ctx);
  const bare = { duration: "5", resolution: "720p", modelOpts: {} };
  const cases = [
    [usd(pro, bare, onCtx), 0.26, "seedance pro 720p 5s untouched (catalog default on)"],
    [usd(pro, { ...bare, modelOpts: { generateAudio: false } }, onCtx), 0.13, "seedance pro explicit audio off"],
    [usd(pro, { ...bare, modelOpts: { generateAudio: true } }, onCtx), 0.26, "seedance pro explicit audio on"],
    [usd(pro, bare), 0.13, "seedance pro no param descriptor stays on the silent tier"],
    [usd(fast, bare, onCtx), 0.20, "seedance fast 720p 5s untouched"],
    [usd(fast, { ...bare, modelOpts: { generateAudio: false } }, onCtx), 0.10, "seedance fast explicit audio off"],
    [usd(VEO, { modelOpts: {} }, onCtx), 4.8, "veo3 untouched"],
    [usd(VEO, { modelOpts: { generateAudio: false } }, onCtx), 3.2, "veo3 explicit audio off"],
    [usd(VEO_FAST, { modelOpts: {} }, onCtx), 1.6, "veo3 fast untouched"],
    [usd(VEO31_FAST, { duration: "8", modelOpts: {} }, onCtx), 1.2, "veo 3.1 fast 8s untouched"],
    [usd(VEO31_FAST, { duration: "8", modelOpts: { generateAudio: false } }, onCtx), 0.8, "veo 3.1 fast explicit audio off"],
    [usd(PIX, bare, offCtx), 0.14705882352941178, "pixverse c1 untouched (catalog default off)"],
    [usd(PIX, { ...bare, modelOpts: { generateAudio: true } }, offCtx), 0.1911764705882353, "pixverse c1 explicit audio on"],
    [usd({ currency: "USD", per_duration: { "5": 0.35 }, audio_multiplier: 2 }, { duration: "5", modelOpts: {} }, snakeOn), 0.7, "audio_multiplier honors a default-on switch"],
    [usd({ currency: "USD", per_duration: { "5": 0.35 }, audio_multiplier: 2 }, { duration: "5", modelOpts: {} }), 0.35, "audio_multiplier without a descriptor stays at the base rate"],
  ];
  const bad = cases.filter(([got, want]) => !close(got, want));
  if (bad.length) fail(name + ": " + bad.map(([g, w, l]) => l + " got " + g + " want " + w).join("; "));
  else ok(name + ": untouched audio switch prices the catalog default (" + cases.length + " cases)");

  if (R.videoAudioOn({ modelOpts: {} }, onCtx) !== true) fail(name + ": default-on descriptor must read as audio on");
  else if (R.videoAudioOn({ modelOpts: { generateAudio: false } }, onCtx) !== false) fail(name + ": explicit false must stay off");
  else if (R.videoAudioOn({ modelOpts: {} }, offCtx) !== false) fail(name + ": default-off descriptor must read as audio off");
  else ok(name + ": videoAudioOn matches the billed default");
}

if (failed) { console.error("✗ audio switch default: " + failed + " failed"); process.exit(1); }
console.log("✓ audio switch default");
