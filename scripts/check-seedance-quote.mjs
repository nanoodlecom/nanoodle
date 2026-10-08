#!/usr/bin/env node
// Seedance 1.5 Pro bills more than its public catalog table. The catalog's raw
// withAudio/withoutAudio per-second rates are exactly 1/1.7 of the quote
// POST /api/generate-video returns before it charges (no key, x-x402: true,
// 402 payment.amountUsd, nothing runs), measured 2026-10-08 across 480p/720p/
// 1080p, 4s/5s/12s and audio on/off, and matched by a real 5s 720p silent run
// at $0.13. The quote tables live in VIDEO_QUOTE_PER_SECOND and replace the raw
// catalog rates. The node's own generateAudio still picks the column: the film
// example sets it false, so a clip estimates $0.13. Offline, zero API spend.
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
    "\nthis.applyVideoQuotePricing=applyVideoQuotePricing; this.videoUnitUsd=videoUnitUsd; this.videoPriceFields=videoPriceFields;", ctx);
  return ctx;
}

// The published catalog rates (2026-10-08), which under-quote.
const PRO_CATALOG = { currency: "USD", raw: { type: "resolution-per-second-audio-toggle", defaultDuration: 5, defaultResolution: "720p",
  withoutAudioPricesPerSecond: { "480p": 0.007058823529411765, "720p": 0.015294117647058823, "1080p": 0.030588235294117645 },
  withAudioPricesPerSecond: { "480p": 0.01411764705882353, "720p": 0.030588235294117645, "1080p": 0.06117647058823529 } } };
const FAST_CATALOG = { currency: "USD", raw: { type: "resolution-per-second-audio-toggle", defaultDuration: 5, defaultResolution: "720p",
  withoutAudioPricesPerSecond: { "720p": 0.011764705882352941, "1080p": 0.01764705882352941 },
  withAudioPricesPerSecond: { "720p": 0.023529411764705882, "1080p": 0.03529411764705882 } } };
const PRO = "bytedance-seedance-v1.5-pro", FAST = "bytedance-seedance-v1.5-pro-fast";

const ENGINES = [["editor", IDX, "function nodeUnitUsd("], ["play", PLAY, "async function nodeUnitUsdPlay("]];
for (const [name, src, end] of ENGINES) {
  const R = loadResolver(src, end);
  const pro = R.applyVideoQuotePricing(PRO, PRO_CATALOG);
  const fast = R.applyVideoQuotePricing(FAST, FAST_CATALOG);
  const DUR = { type: "select", options: [] }; // the catalog lists a duration param, so the node's duration counts
  const usd = (pricing, fields, params) => R.videoUnitUsd(pricing, R.videoPriceFields(params || { duration: DUR }, fields));
  const cases = [
    [usd(pro, { duration: "5", resolution: "720p", modelOpts: { generateAudio: false } }), 0.13, "pro 720p 5s audio off"],
    [usd(pro, { duration: "5", resolution: "720p", modelOpts: { generateAudio: true } }), 0.26, "pro 720p 5s audio on"],
    [usd(pro, { duration: "5", resolution: "480p", modelOpts: { generateAudio: false } }), 0.06, "pro 480p 5s audio off"],
    [usd(pro, { duration: "12", resolution: "1080p", modelOpts: { generateAudio: true } }), 1.248, "pro 1080p 12s audio on"],
    [usd(pro, { duration: "4", resolution: "720p", modelOpts: { generateAudio: false } }), 0.104, "pro 720p 4s audio off"],
    [usd(fast, { duration: "5", resolution: "720p", modelOpts: { generateAudio: false } }), 0.10, "fast 720p 5s audio off"],
    [usd(fast, { duration: "5", resolution: "720p", modelOpts: { generateAudio: true } }), 0.20, "fast 720p 5s audio on"],
    [usd(fast, { duration: "12", resolution: "1080p", modelOpts: { generateAudio: true } }), 0.72, "fast 1080p 12s audio on"],
  ];
  const bad = cases.filter(([got, want]) => !close(got, want));
  if (bad.length) fail(name + ": " + bad.map(([g, w, l]) => l + " got " + g + " want " + w).join("; "));
  else ok(name + ": seedance quotes match the 402 amountUsd (film clip 720p 5s silent = $0.13)");
  // without the model's param descriptor, an absent switch still prices the explicit value
  const bare = usd(pro, { duration: "5", resolution: "720p", modelOpts: { generateAudio: false } }, {});
  if (!close(bare, 0.13)) fail(name + ": explicit audio off must stay off without a param descriptor, got " + bare);
  else ok(name + ": explicit generateAudio:false stays on the silent tier");
}

if (IDX.includes("grows clip1, clip2")) fail("editor AI-builder note still says clip1; Combine ports are vid1");
else if (!IDX.includes('note:"grows vid1, vid2,') || !IDX.includes("// grows vid1, vid2,"))
  fail("editor AI-builder note should name vid1, vid2");
else ok("editor AI-builder note names vid1, vid2");

if (failed) { console.error(`✗ seedance quote: ${failed} failed`); process.exit(1); }
console.log("✓ seedance quote");
