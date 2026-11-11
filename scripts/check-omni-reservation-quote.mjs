#!/usr/bin/env node
// Gemini Omni Flash v1.2 (+ upscale sibling) bill via refundable_reservation:
// reserve $N, settle measured tokens, refund unused. Before this fix,
// genericScanUsd walked rates_per_million_tokens.input (2.55) and quoted it
// as a flat clip price — the chip stuck at ~$2.55/clip at every res/duration.
// Offline, zero API spend. Pins both engines.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

function loadResolver(src, end) {
  const s = src.indexOf("const EST = {"), e = src.indexOf(end);
  if (s < 0 || e < 0) throw new Error("pricing block not found");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.slice(s, e) + "\nthis.videoUnitUsd=videoUnitUsd; this.videoBaseUsd=videoBaseUsd;", ctx);
  return ctx;
}

const OMNI_12 = {
  type: "refundable_reservation",
  reservation_usd: 15,
  currency: "USD",
  rates_per_million_tokens: { input: 2.55, output: 12.0 },
};
const OMNI_12_UPSCALE = {
  type: "refundable_reservation",
  reservation_usd: 3,
  currency: "USD",
  rates_per_output_second: { "720p": 0.05, "1080p": 0.1 },
};

const CASES = [
  ["google/gemini-omni-flash/v1.2", OMNI_12, 15, [
    { duration: "8", resolution: "720p" },
    { duration: "8", resolution: "4k" },
    { duration: "15", resolution: "720p" },
    { duration: "", resolution: "" },
  ]],
  ["google/gemini-omni-flash/v1.2/upscale", OMNI_12_UPSCALE, 3, [
    { duration: "8", resolution: "720p" },
    { duration: "8", resolution: "1080p" },
    { duration: "", resolution: "" },
  ]],
];

const ENGINES = [
  ["editor", fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), "function nodeUnitUsd("],
  ["play", fs.readFileSync(path.join(ROOT, "play.html"), "utf8"), "async function nodeUnitUsdPlay("],
];

for (const [name, src, end] of ENGINES) {
  const R = loadResolver(src, end);
  for (const [id, pricing, want, rows] of CASES) {
    for (const fields of rows) {
      const got = R.videoUnitUsd(pricing, fields);
      const label = `${name}: ${id} ${fields.duration || "default"}s ${fields.resolution || "default"}`;
      if (got == null || !isFinite(got) || Math.abs(got - want) > 1e-6) {
        fail(`${label} = ${got}, want ${want} (must not leak token rate 2.55)`);
      } else {
        ok(`${label} = $${want} (reservation hold)`);
      }
    }
    // Explicit: never quote the token input rate as a clip.
    const leaked = R.videoUnitUsd(pricing, { duration: "8", resolution: "720p" });
    if (leaked != null && Math.abs(leaked - 2.55) < 1e-9) {
      fail(`${name}: ${id} leaked rates_per_million_tokens.input as clip price`);
    }
  }
}

if (failed) { console.error(failed + " failure(s)"); process.exit(1); }
console.log("\n✓ omni-reservation-quote: v1.2 quotes reservation_usd 15 (not 2.55); upscale quotes 3.");
