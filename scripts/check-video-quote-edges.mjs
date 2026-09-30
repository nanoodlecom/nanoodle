#!/usr/bin/env node
// Leftover H3 quote-overlay edges after #634.
// That PR shipped happy-path duration×resolution quotes (Singularity 5s/15s,
// LoRA, reference-to-video, H3 Max multi-angle/extend) plus "catalog
// per_second_by_resolution wins" and lip-sync stays on its floor.
// This file pins the other half: twin table lockstep, other duration-rate
// shapes that must skip the overlay, unknown-id / null-pricing safety, and
// the overlay keeping the catalog minimum/note without mutating the input.
// Offline, zero API spend. New file so it does not collide with open leftover PRs.
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

function block(src, anchor) {
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error("anchor not found: " + anchor);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced braces for: " + anchor);
}

function loadQuote(src) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(block(src, "const VIDEO_QUOTE_PER_SECOND = {") + "\nthis.VIDEO_QUOTE_PER_SECOND=VIDEO_QUOTE_PER_SECOND;", ctx);
  return ctx.VIDEO_QUOTE_PER_SECOND;
}

function loadResolver(src, end) {
  const s = src.indexOf("const EST = {"), e = src.indexOf(end);
  if (s < 0 || e < 0) throw new Error("pricing block not found");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.slice(s, e) + "\nthis.applyVideoQuotePricing=applyVideoQuotePricing; this.videoPricingHasDurationRate=videoPricingHasDurationRate; this.videoUnitUsd=videoUnitUsd; this.VIDEO_QUOTE_PER_SECOND=VIDEO_QUOTE_PER_SECOND;", ctx);
  return ctx;
}

const ID = "minimax-h3-singularity/image-to-video";
const ENGINES = [
  ["editor", IDX, "function nodeUnitUsd("],
  ["play", PLAY, "async function nodeUnitUsdPlay("],
];

// Twin lockstep: a one-sided edit to VIDEO_QUOTE_PER_SECOND quotes the other engine wrong.
{
  const a = loadQuote(IDX), b = loadQuote(PLAY);
  const keysA = Object.keys(a).sort(), keysB = Object.keys(b).sort();
  if (JSON.stringify(keysA) !== JSON.stringify(keysB)) {
    fail("VIDEO_QUOTE_PER_SECOND keys drifted: editor=" + keysA.join(",") + " play=" + keysB.join(","));
  } else {
    let drift = 0;
    for (const k of keysA) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { fail("quote table drifted for " + k); drift++; }
    }
    if (!drift) ok("VIDEO_QUOTE_PER_SECOND keys+rates lockstep (" + keysA.length + " ids)");
  }
}

for (const [name, src, end] of ENGINES) {
  const R = loadResolver(src, end);

  if (R.videoPricingHasDurationRate(null) !== false || R.videoPricingHasDurationRate(undefined) !== false) {
    fail(name + ": videoPricingHasDurationRate(null) must be false");
  } else ok(name + ": videoPricingHasDurationRate(null) is false");

  const catalogWins = [
    { per_second: 9 },
    { output_per_second: 9 },
    { per_duration: { "5": 1 } },
    { base_price: 1, per_extra_second: 0.1 },
    { per_second_by_mode: { standard: 1 } },
    { base_price_per_second: 0.02 },
  ];
  let skipBad = 0;
  for (const p of catalogWins) {
    const out = R.applyVideoQuotePricing(ID, p);
    if (out !== p) { fail(name + ": duration-rate shape must skip overlay: " + Object.keys(p).join("+")); skipBad++; }
  }
  if (!skipBad) ok(name + ": " + catalogWins.length + " catalog duration-rate shapes skip the overlay");

  const unknown = { currency: "USD", minimum: 1 };
  if (R.applyVideoQuotePricing("not-a-quoted-id", unknown) !== unknown) {
    fail(name + ": unknown id must leave pricing unchanged");
  } else ok(name + ": unknown id leaves pricing unchanged");

  const overlayNull = R.applyVideoQuotePricing(ID, null);
  if (!overlayNull || overlayNull.per_second_by_resolution?.["480p"] !== 0.05) {
    fail(name + ": null pricing + known id still overlays, got " + JSON.stringify(overlayNull));
  } else ok(name + ": null pricing + known id still overlays");

  const srcP = { currency: "USD", minimum: 0.15, note: "Output duration and resolution determine pricing." };
  const over = R.applyVideoQuotePricing(ID, srcP);
  if (over === srcP) fail(name + ": overlay must not mutate the catalog object");
  else if (over.minimum !== 0.15 || over.note !== srcP.note || over.currency !== "USD") {
    fail(name + ": overlay dropped catalog minimum/note/currency");
  } else if (srcP.per_second_by_resolution != null) {
    fail(name + ": overlay mutated the input pricing");
  } else if (over.per_second_by_resolution?.["480p"] !== 0.05) {
    fail(name + ": overlay missing 480p quote");
  } else ok(name + ": overlay keeps minimum/note and does not mutate the input");

  const billed = R.videoUnitUsd(over, { duration: "15", resolution: "480p" });
  if (billed == null || Math.abs(billed - 0.75) > 1e-9) {
    fail(name + ": overlaid 15s 480p → " + billed + " (want 0.75)");
  } else ok(name + ": overlaid 15s 480p still bills $0.75");
}

if (failed) {
  console.error("\n✗ check-video-quote-edges: " + failed + " failed");
  process.exit(1);
}
console.log("\n✓ check-video-quote-edges");
