#!/usr/bin/env node
// Leftover Grok Lite / H3 Max Turbo Extend quote-overlay edges after #681.
// That PR shipped happy-path duration×resolution quotes (Grok default /
// 1s 480p / 15s ladder, Turbo default / minimum / 15s 1080p+2k) plus
// recast / infinitetalk / talking-avatar staying on their floor.
// This file pins the leftover fallback contract those fixtures never hit:
// a resolution that is not on the new id's table must use that id's
// default (Grok 720p, Turbo 768p) — not the first/lowest key — duration
// 0 / NaN / negative still meters the default length, a catalog duration
// table still skips the overlay for these ids, and refWired does not
// invent the $0.01 start-image surcharge #681 left out. Both engines.
// Offline, zero API spend. New file so it does not collide with
// check-video-quote-edges / check-pricing.
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
      "\nthis.applyVideoQuotePricing=applyVideoQuotePricing; this.videoUnitUsd=videoUnitUsd;",
    ctx
  );
  return ctx;
}

const GROK = "grok-imagine-video-1.5-lite";
const TURBO = "minimax/h3-max-turbo/extend-video";
const GROK_MIN = {
  currency: "USD",
  minimum: 0.02,
  note: "Output duration and resolution determine pricing.",
};
const TURBO_MIN = { currency: "USD", minimum: 0.025 };
const ENGINES = [
  ["editor", IDX, "function nodeUnitUsd("],
  ["play", PLAY, "async function nodeUnitUsdPlay("],
];

for (const [name, src, end] of ENGINES) {
  const R = loadResolver(src, end);

  const grok = R.applyVideoQuotePricing(GROK, GROK_MIN);
  const turbo = R.applyVideoQuotePricing(TURBO, TURBO_MIN);
  if (grok === GROK_MIN || grok.per_second_by_resolution?.["720p"] !== 0.03)
    fail(name + ": Grok minimum-only catalog must still overlay the 720p table");
  else if (turbo === TURBO_MIN || turbo.per_second_by_resolution?.["768p"] !== 0.04)
    fail(name + ": Turbo minimum-only catalog must still overlay the 768p table");
  else ok(name + ": Grok / Turbo minimum-only catalog still overlays");

  const catalogGrok = { per_second_by_resolution: { "720p": 9 } };
  const catalogTurbo = { per_second_by_resolution: { "768p": 9 } };
  if (R.applyVideoQuotePricing(GROK, catalogGrok) !== catalogGrok)
    fail(name + ": Grok catalog duration table must skip the overlay");
  else if (R.applyVideoQuotePricing(TURBO, catalogTurbo) !== catalogTurbo)
    fail(name + ": Turbo catalog duration table must skip the overlay");
  else ok(name + ": Grok / Turbo catalog duration table skips the overlay");

  const grok2k = R.videoUnitUsd(grok, { duration: "15", resolution: "2k" });
  const grok768 = R.videoUnitUsd(grok, { duration: "15", resolution: "768p" });
  if (!close(grok2k, 0.45) || !close(grok768, 0.45))
    fail(name + ": Grok 2k/768p must fall back to default 720p ($0.45), got " + grok2k + "/" + grok768);
  else ok(name + ": Grok unknown 2k/768p falls back to default 720p, not 480p");

  const turbo720 = R.videoUnitUsd(turbo, { duration: "15", resolution: "720p" });
  if (!close(turbo720, 0.6))
    fail(name + ": Turbo 720p must fall back to default 768p ($0.60), got " + turbo720);
  else ok(name + ": Turbo unknown 720p falls back to default 768p, not 480p");

  let durBad = 0;
  for (const d of ["0", "-1", "nope", "NaN"]) {
    const v = R.videoUnitUsd(grok, { duration: d, resolution: "720p" });
    if (!close(v, 0.18)) {
      fail(name + ": Grok duration " + JSON.stringify(d) + " must meter default 6s ($0.18), got " + v);
      durBad++;
    }
  }
  const turboZero = R.videoUnitUsd(turbo, { duration: "0", resolution: "768p" });
  if (!close(turboZero, 0.2)) {
    fail(name + ": Turbo duration 0 must meter default 5s ($0.20), got " + turboZero);
    durBad++;
  }
  if (!durBad) ok(name + ": duration 0 / NaN / negative still meters the default length");

  const wired = R.videoUnitUsd(grok, { duration: "6", resolution: "720p" }, true);
  if (!close(wired, 0.18))
    fail(name + ": Grok refWired must not invent the $0.01 start-image surcharge, got " + wired);
  else ok(name + ": Grok refWired stays on the duration×resolution table");
}

if (failed) {
  console.error("\n✗ check-video-quote-lite-edges: " + failed + " failed");
  process.exit(1);
}
console.log("\n✓ check-video-quote-lite-edges");
