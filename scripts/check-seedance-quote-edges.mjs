#!/usr/bin/env node
// Leftover Seedance 1.5 Pro / Pro-Fast quote-overlay edges after #703.
// That PR shipped the measured 402 ladder (720p 5s silent $0.13 / audio $0.26,
// 480p, 4s, 1080p 12s, Fast 720p/1080p) plus explicit generateAudio:false
// without a descriptor. This file pins the other half those fixtures never
// hit: a catalog `raw` table is NOT a duration-rate skip (that is the bug —
// overlay must still replace the 1/1.7 rates), a real per_second table still
// skips, unknown / empty / Fast-missing-480p resolution uses the 720p
// default (not first-key 480p), and duration 0 / NaN / negative still meters
// the default 5s. Both engines. Offline, zero API spend. New file so it does
// not collide with check-seedance-quote / check-video-quote-edges.
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
      "\nthis.applyVideoQuotePricing=applyVideoQuotePricing; this.videoPricingHasDurationRate=videoPricingHasDurationRate; this.videoUnitUsd=videoUnitUsd; this.videoPriceFields=videoPriceFields;",
    ctx
  );
  return ctx;
}

const PRO = "bytedance-seedance-v1.5-pro";
const FAST = "bytedance-seedance-v1.5-pro-fast";
const PRO_CATALOG = { currency: "USD", raw: { type: "resolution-per-second-audio-toggle", defaultDuration: 5, defaultResolution: "720p",
  withoutAudioPricesPerSecond: { "480p": 0.007058823529411765, "720p": 0.015294117647058823, "1080p": 0.030588235294117645 },
  withAudioPricesPerSecond: { "480p": 0.01411764705882353, "720p": 0.030588235294117645, "1080p": 0.06117647058823529 } } };
const FAST_CATALOG = { currency: "USD", raw: { type: "resolution-per-second-audio-toggle", defaultDuration: 5, defaultResolution: "720p",
  withoutAudioPricesPerSecond: { "720p": 0.011764705882352941, "1080p": 0.01764705882352941 },
  withAudioPricesPerSecond: { "720p": 0.023529411764705882, "1080p": 0.03529411764705882 } } };

const ENGINES = [["editor", IDX, "function nodeUnitUsd("], ["play", PLAY, "async function nodeUnitUsdPlay("]];
for (const [name, src, end] of ENGINES) {
  const R = loadResolver(src, end);
  const usd = (pricing, fields) => R.videoUnitUsd(pricing, R.videoPriceFields({ duration: { type: "select", options: [] } }, fields));

  if (R.videoPricingHasDurationRate(PRO_CATALOG) !== false || R.videoPricingHasDurationRate(FAST_CATALOG) !== false)
    fail(name + ": a catalog raw audio-toggle table must not count as a duration-rate skip");
  else ok(name + ": catalog raw is not a duration-rate skip (overlay still applies)");

  const pro = R.applyVideoQuotePricing(PRO, PRO_CATALOG);
  const fast = R.applyVideoQuotePricing(FAST, FAST_CATALOG);
  if (pro === PRO_CATALOG || pro.raw?.withoutAudioPricesPerSecond?.["720p"] !== 0.026)
    fail(name + ": Seedance raw catalog must be replaced by the 402 table, got " + JSON.stringify(pro?.raw?.withoutAudioPricesPerSecond));
  else if (PRO_CATALOG.raw.withoutAudioPricesPerSecond["720p"] !== 0.015294117647058823)
    fail(name + ": overlay mutated the catalog object");
  else if (fast === FAST_CATALOG || fast.raw?.withoutAudioPricesPerSecond?.["720p"] !== 0.02)
    fail(name + ": Fast raw catalog must be replaced by the 402 table");
  else ok(name + ": overlay replaces the 1/1.7 raw table and does not mutate the catalog");

  const skipPer = { per_second: 9 };
  const skipRes = { per_second_by_resolution: { "720p": 9 } };
  if (R.applyVideoQuotePricing(PRO, skipPer) !== skipPer || R.applyVideoQuotePricing(FAST, skipRes) !== skipRes)
    fail(name + ": a real catalog duration table must still skip the Seedance overlay");
  else ok(name + ": catalog per_second / per_second_by_resolution skips the overlay");

  const silent = { duration: "5", resolution: "720p", modelOpts: { generateAudio: false } };
  const twoK = usd(pro, { ...silent, resolution: "2k" });
  const p768 = usd(pro, { ...silent, resolution: "768p" });
  const empty = usd(pro, { ...silent, resolution: "" });
  if (!close(twoK, 0.13) || !close(p768, 0.13) || !close(empty, 0.13))
    fail(name + ": unknown/empty res must use default 720p ($0.13 silent), got 2k=" + twoK + " 768p=" + p768 + " empty=" + empty);
  else ok(name + ": unknown 2k/768p/empty res falls back to default 720p, not first-key 480p");

  const fast480off = usd(fast, { duration: "5", resolution: "480p", modelOpts: { generateAudio: false } });
  const fast480on = usd(fast, { duration: "5", resolution: "480p", modelOpts: { generateAudio: true } });
  if (!close(fast480off, 0.10) || !close(fast480on, 0.20))
    fail(name + ": Fast has no 480p column — must use default 720p ($0.10/$0.20), got " + fast480off + "/" + fast480on);
  else ok(name + ": Fast missing 480p falls back to default 720p");

  let durBad = 0;
  for (const d of ["0", "-1", "nope", "NaN", ""]) {
    const v = usd(pro, { duration: d, resolution: "720p", modelOpts: { generateAudio: false } });
    if (!close(v, 0.13)) {
      fail(name + ": duration " + JSON.stringify(d) + " must meter default 5s ($0.13 silent), got " + v);
      durBad++;
    }
  }
  if (!durBad) ok(name + ": duration 0 / NaN / negative / empty still meters the default 5s");
}

if (failed) { console.error("✗ seedance quote edges: " + failed + " failed"); process.exit(1); }
console.log("✓ seedance quote edges");
