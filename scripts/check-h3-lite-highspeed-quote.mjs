#!/usr/bin/env node
// MiniMax H3 Lite / H3 Highspeed publish only {minimum, note}, so the
// "~$X to run" chip sat flat at the 4s floor for every duration. These are
// the 402 quotes from POST /api/generate-video (no key, x-x402: true, nothing
// runs), measured 2026-10-29. Both engines. Offline, zero API spend.
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
  vm.runInContext(src.slice(s, e) + "\nthis.applyVideoQuotePricing=applyVideoQuotePricing; this.videoUnitUsd=videoUnitUsd;", ctx);
  return ctx;
}

const NOTE = "Output duration and resolution determine pricing. Reference media may add charges. See model settings and the generation quote.";
const CASES = [
  ["minimax/h3-highspeed", 0.408, [["4", "768p", 0.408], ["7", "768p", 0.714], ["15", "768p", 1.53], ["", "", 0.51]]],
  ["minimax/h3-lite", 0.17, [["4", "480p", 0.17], ["5", "480p", 0.2125], ["15", "480p", 0.6375], ["5", "768p", 0.34], ["15", "768p", 1.02], ["", "", 0.34]]],
];
const ENGINES = [
  ["editor", fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), "function nodeUnitUsd("],
  ["play", fs.readFileSync(path.join(ROOT, "play.html"), "utf8"), "async function nodeUnitUsdPlay("],
];

for (const [name, src, end] of ENGINES) {
  const R = loadResolver(src, end);
  for (const [id, minimum, rows] of CASES) {
    const p = R.applyVideoQuotePricing(id, { currency: "USD", minimum, note: NOTE });
    for (const [duration, resolution, want] of rows) {
      const got = R.videoUnitUsd(p, { duration, resolution });
      const label = `${name}: ${id} ${duration || "default"}s ${resolution || "default"}`;
      if (got == null || !isFinite(got) || Math.abs(got - want) > 1e-6) fail(`${label} = ${got}, want ${want}`);
      else ok(`${label} = $${want}`);
    }
  }
}
if (failed) { console.error(failed + " failure(s)"); process.exit(1); }
