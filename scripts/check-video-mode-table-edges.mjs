#!/usr/bin/env node
// Leftover Kandinsky per_video_by_mode edges after #688 / #693.
// Those PRs shipped t2v/i2v dollar amounts, the model-list default,
// minimum floor, unknown-mode dearest, duration-ignored, and the
// chip/picker filter pins. This file pins the leftover table-shape
// contract those cases never hit: a v2v node with a video_to_video
// key uses that rate (not dearest), an empty or NaN-only table does
// not invent a price, 0 is a real rate, and "" / null filter still
// mean the model-list text_to_video pick. Both engines. Offline,
// zero API spend. New file so it does not collide with
// check-video-per-video-by-mode.
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
const near = (a, b) => a != null && Math.abs(a - b) < 1e-9;

function load(src, end) {
  const s = src.indexOf("const EST = {"), e = src.indexOf(end);
  if (s < 0 || e < 0) throw new Error("pricing block not found");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.slice(s, e) + "\nthis.videoUnitUsd=videoUnitUsd;", ctx);
  return ctx;
}

const V2V = {
  per_video_by_mode: { text_to_video: 0.16, image_to_video: 0.17, video_to_video: 0.99 },
};
const ENGINES = [
  ["editor", IDX, "function nodeUnitUsd("],
  ["play", PLAY, "async function nodeUnitUsdPlay("],
];

for (const [name, src, end] of ENGINES) {
  const { videoUnitUsd } = load(src, end);

  const v2v = videoUnitUsd(V2V, {}, false, false, "v2v");
  if (!near(v2v, 0.99))
    fail(name + ": v2v with video_to_video must use that key ($0.99), got " + v2v);
  else ok(name + ": v2v with video_to_video uses that rate, not dearest");

  const empty = videoUnitUsd({ per_video_by_mode: {} }, {});
  const nanOnly = videoUnitUsd({ per_video_by_mode: { text_to_video: "nope", image_to_video: NaN } }, {});
  if (empty != null)
    fail(name + ": empty per_video_by_mode must not invent a price, got " + empty);
  else if (nanOnly != null && !Number.isNaN(nanOnly))
    fail(name + ": NaN-only table must not invent a finite price, got " + nanOnly);
  else if (Number.isNaN(nanOnly))
    fail(name + ": NaN-only table must not return NaN");
  else ok(name + ": empty / NaN-only table does not invent a price");

  const zero = videoUnitUsd({ per_video_by_mode: { text_to_video: 0 }, minimum: 0 }, {}, false, false, "t2v");
  if (!near(zero, 0))
    fail(name + ": 0 is a real per_video_by_mode rate, got " + zero);
  else ok(name + ": 0 is a real rate, not a missing key");

  const blank = videoUnitUsd(V2V, {}, false, false, "");
  const nul = videoUnitUsd(V2V, {}, false, false, null);
  if (!near(blank, 0.16) || !near(nul, 0.16))
    fail(name + ": \"\" / null filter must stay text_to_video ($0.16), got " + blank + "/" + nul);
  else ok(name + ": \"\" / null filter still means the model-list text_to_video pick");
}

if (failed) {
  console.error("\n✗ check-video-mode-table-edges: " + failed + " failed");
  process.exit(1);
}
console.log("\n✓ check-video-mode-table-edges");
