#!/usr/bin/env node
// Leftover duration-knob / duration-scaled pricing edges after #629 + #630.
// Those PRs shipped the happy-path pins (Wan 2–30 list, P-Video duration×rate,
// seedance 5s vs 10s, LTX unset/20s, audio MAX clamp, hidden no-duration knob).
// This file pins the other half of those clamps and the twin/safety paths they
// left alone. Offline, zero API spend. New file so it does not collide with
// open leftover PRs.
//
//   * P-Video billable FLOOR: a leftover/typed duration below
//     minimum_billable_duration must quote the floor (2s Pro used to underquote).
//   * videoPriceFields keeps duration when the catalog lists `seconds` (Sora),
//     not only `duration`. Null fields must not throw.
//   * Audio send clamps BELOW min (1s leftover on a 5s music model; remix
//     secduration). #630 only pinned 500→300.
//   * Blank audio estimate when EST.audioSeconds is BELOW min_duration (60s
//     floor) — #630 only pinned EST above max.
//   * LTX-2.3 frames follow an explicit fps, not only the 24 fps default.
//   * seedance duration_multiplier uses catalog base_duration (not a hard 5).
//   * P-Video default_mode / QUALITY / draft:"false" table pick.
//   * Editor range-less number duration still falls back to 5/10 (#629 keep).
//   * rangeDurOpts: >120 steps / bad step / hi<lo stay empty; 0.5s step lists.
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
function resolver(src, end) {
  const s = src.indexOf("const EST = {"), e = src.indexOf(end);
  if (s < 0 || e < 0) throw new Error("pricing block not found");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.slice(s, e) + "\nthis.videoUnitUsd=videoUnitUsd; this.audioBilledSeconds=audioBilledSeconds; this.videoPriceFields=videoPriceFields;", ctx);
  return ctx;
}

const PV2PRO = { currency: "USD", speed_per_second_by_resolution: { "480p": 0.02, "768p": 0.035 }, quality_per_second_by_resolution: { "480p": 0.04, "768p": 0.075 }, minimum_billable_duration: 5, maximum_billable_duration: 15, default_duration: 5, default_resolution: "768p", default_mode: "speed" };
const PV2PRO_Q = Object.assign({}, PV2PRO, { default_mode: "quality" });
const PV2 = { currency: "USD", full_per_second_by_resolution: { "720p": 0.025, "1080p": 0.05 }, draft_per_second_by_resolution: { "720p": 0.015, "1080p": 0.03 }, minimum_billable_duration: 1, maximum_billable_duration: 20, default_duration: 5, default_resolution: "720p" };
const PVEDIT = { currency: "USD", full_per_second: 0.045, draft_per_second: 0.025, minimum_billable_duration: 1, maximum_billable_duration: 15 };
const SEED_BASE10 = { currency: "USD", base_prices_by_resolution: { "480p": 0.12002, "720p": 0.285 }, duration_multiplier: 2, base_duration: 10 };
const LTX23Q = { currency: "USD", raw: { type: "ltx23-quality-megapixel", pricePerMegapixel: 0.0014161764705882354, megapixelsByResolution: { "720p": 0.9216, landscape_16_9: 0.9216 }, defaultDuration: 6, defaultResolution: "landscape_16_9", defaultFramesPerSecond: 24, defaultNumFrames: 145 } };
const SORA_SEC = { currency: "USD", per_second: 0.1, default_duration: 8 };

for (const [name, src, end] of [["editor", IDX, "function nodeUnitUsd("], ["play", PLAY, "async function nodeUnitUsdPlay("]]) {
  const R = resolver(src, end);
  const cases = [
    ["P-Video 2 Pro 2s 768p speed floors to 5s", R.videoUnitUsd(PV2PRO, { duration: "2" }), 0.175],
    ["P-Video 2 0.5s 720p full floors to 1s", R.videoUnitUsd(PV2, { duration: "0.5" }), 0.025],
    ["P-Video Edit 0.5s full floors to 1s", R.videoUnitUsd(PVEDIT, { duration: "0.5" }), 0.045],
    ["P-Video 2 Pro empty mode uses default_mode quality", R.videoUnitUsd(PV2PRO_Q, { duration: "5", modelOpts: { mode: "" } }), 0.375],
    ["P-Video 2 Pro QUALITY picks the quality table", R.videoUnitUsd(PV2PRO, { duration: "5", modelOpts: { mode: "QUALITY" } }), 0.375],
    ["P-Video 2 draft:\"false\" stays on the full table", R.videoUnitUsd(PV2, { duration: "10", resolution: "1080p", modelOpts: { draft: "false" } }), 0.5],
    ["seedance base_duration 10: 10s is the base clip", R.videoUnitUsd(SEED_BASE10, { duration: "10", resolution: "480p" }), 0.12002],
    ["seedance base_duration 10: 15s takes the multiplier", R.videoUnitUsd(SEED_BASE10, { duration: "15", resolution: "480p" }), 0.24004],
    ["LTX-2.3 Quality 10s @12fps = 121 frames", R.videoUnitUsd(LTX23Q, { duration: "10", fps: "12" }), 0.0014161764705882354 * 0.9216 * 121],
    ["LTX-2.3 Quality 10s default fps = 241 frames", R.videoUnitUsd(LTX23Q, { duration: "10" }), 0.0014161764705882354 * 0.9216 * 241],
  ];
  let bad = 0;
  for (const [what, got, want] of cases) if (!near(got, want)) { fail(`${name}: ${what} → ${got} (want ${want})`); bad++; }
  if (!bad) ok(`${name}: ${cases.length} leftover duration-scaled pricing cases`);

  const lo = R.audioBilledSeconds({ min_duration: 60, max_duration: 300 }, { duration: "" });
  const lo2 = R.audioBilledSeconds({ min_duration: 60, max_duration: 300 }, {});
  if (lo !== 60 || lo2 !== 60) fail(`${name}: blank audio estimate below min_duration must floor to 60, got ${lo}/${lo2}`);
  else ok(`${name}: blank audio estimate floors to min_duration when EST is below the range`);

  const keepSec = R.videoPriceFields({ seconds: { type: "select" } }, { duration: "8", resolution: "720p" });
  if (keepSec.duration !== "8" || keepSec.resolution !== "720p") fail(`${name}: videoPriceFields dropped duration on a seconds-param model`);
  else ok(`${name}: videoPriceFields keeps duration when the catalog lists seconds`);
  const sora = R.videoUnitUsd(SORA_SEC, keepSec);
  if (!near(sora, 0.8)) fail(`${name}: Sora seconds-param 8s priced ${sora}, want 0.8`);
  else ok(`${name}: Sora seconds-param 8s still scales the per_second estimate`);
  try {
    const nil = R.videoPriceFields({}, null);
    if (nil !== null) fail(`${name}: videoPriceFields(null fields) must return fields as-is`);
    else ok(`${name}: videoPriceFields(null fields) does not throw`);
  } catch (e) {
    fail(`${name}: videoPriceFields(null fields) threw ${e && e.message}`);
  }
}

// ---- editor: range-less number duration still falls back to 5/10 (#629) ----
{
  const code = [
    "var SIZES = [['1024x1024','square']];",
    IDX.slice(IDX.indexOf("const SIZE_FALLBACK"), IDX.indexOf("function applyDimFields(")).replace(/^const /gm, "var "),
    block(IDX, "function applyDimFields(fields, defs){"),
    block(IDX, "function dimDefs(type, model){"),
    "var catalogs = { image:[], video:[] };",
    "function catItem(kind,id){ return (catalogs[kind]||[]).find(function(m){ return m.id===id; }); }",
  ].join("\n");
  const ed = { console, Math };
  vm.createContext(ed);
  vm.runInContext(code, ed);
  ed.catalogs.video = [
    { id: "range-less-number", params: { duration: { type: "number", default: 5 } } },
  ];
  const d = ed.dimDefs("tvideo", "range-less-number").find((x) => x.f === "duration");
  const listed = (d && d.options || []).map((o) => String(o[0])).join(",");
  if (!d) fail("editor: range-less number duration produced no def");
  else if (d.hidden) fail("editor: range-less number duration must stay visible (it is a listed param)");
  else if (listed !== "5,10") fail("editor: range-less number duration list is " + listed + " (want the 5/10 fallback)");
  else ok("editor: range-less number duration still falls back to 5/10");
}

// ---- rangeDurOpts safety + fractional step (both engines) ----
{
  const ed = {}, pl = {};
  vm.createContext(ed);
  vm.createContext(pl);
  vm.runInContext(block(IDX, "function rangeDurOpts(param){"), ed);
  vm.runInContext(block(PLAY, "function rangeDurOpts(param){"), pl);
  for (const [name, R] of [["editor", ed], ["play", pl]]) {
    const huge = R.rangeDurOpts({ min: 1, max: 300, step: 1 });
    const badStep = R.rangeDurOpts({ min: 2, max: 30, step: 0 });
    const inverted = R.rangeDurOpts({ min: 30, max: 2, step: 1 });
    const missing = R.rangeDurOpts({ type: "number", default: 5 });
    const fine = (R.rangeDurOpts({ min: 0.5, max: 5, step: 0.5 }) || []).map((o) => o[0]).join(",");
    if (huge.length) fail(`${name}: rangeDurOpts must refuse a >120-step range, got ${huge.length}`);
    else if (badStep.length || inverted.length || missing.length) fail(`${name}: rangeDurOpts must stay empty for step 0 / hi<lo / missing min-max`);
    else if (fine !== "0.5,1,1.5,2,2.5,3,3.5,4,4.5,5") fail(`${name}: 0.5s step list is ${fine}`);
    else ok(`${name}: rangeDurOpts refuses absurd ranges and lists a 0.5s step`);
  }
}

// ---- audio send: BELOW-min clamp + remix secduration (both engines) ----
const MUSIC = { id: "elevenlabs/music", supported_parameters: { min_duration: 5, max_duration: 300 }, pricing: { per_second: 0.01 } };
const SFX = { id: "elevenlabs/sound-effects/v2", supported_parameters: { min_duration: 0.5, max_duration: 22 }, pricing: { per_second: 0.002 } };
const COVER = { id: "cover-no-per-second", supported_parameters: { min_duration: 5, max_duration: 300 }, pricing: {} };
{
  const code = [
    block(IDX, "const AUDIO_PARAMS = {").replace(/^const\s/, "var "),
    block(IDX, "function audioApplies(at, it){"),
    block(IDX, "function audioFields(kind, it){"),
    block(IDX, "function assertGenerateSongLyrics(model, lyrics){"),
    block(IDX, "function collectAudioParams(n){"),
    "var catalogs = { audio:[] };",
    "function catItem(kind,id){ return (catalogs[kind]||[]).find(function(m){ return m.id===id; }); }",
  ].join("\n");
  const ed = { console, Math };
  vm.createContext(ed);
  vm.runInContext(code, ed);
  const norm = (m) => ({ id: m.id, voices: [], language: null, params: m.supported_parameters, pricing: m.pricing });
  ed.catalogs.audio = [norm(MUSIC), norm(SFX), norm(COVER)];
  const a = ed.collectAudioParams({ type: "music", fields: { model: MUSIC.id, duration: "1" } });
  const b = ed.collectAudioParams({ type: "music", fields: { model: SFX.id, duration: "0.1" } });
  const c = ed.collectAudioParams({ type: "remix", fields: { model: SFX.id, duration: "0.1" } });
  const d = ed.collectAudioParams({ type: "remix", fields: { model: COVER.id, duration: "1" } });
  if (a.duration !== 5) fail(`editor: leftover 1s on a 5s music model posted ${a.duration}`);
  else if (b.duration !== 0.5) fail(`editor: leftover 0.1s on SFX v2 posted ${b.duration}`);
  else if (c.duration !== 0.5) fail(`editor: remix secduration leftover 0.1s posted ${c.duration}`);
  else if (d.duration != null) fail(`editor: cover remix (no per_second) must not send duration, got ${d.duration}`);
  else ok("editor: audio send floors leftover short durations (music + remix secduration)");
}
{
  const src = PLAY.slice(PLAY.indexOf("  const AUDIO_PARAMS = {"));
  const code = [
    block(src, "const AUDIO_PARAMS = {").replace(/^const\s/, "var "),
    block(PLAY, "function assertGenerateSongLyrics(model, lyrics){"),
    block(PLAY, "async function collectAudioParams(n){"),
    "var CAT = {};",
    "async function rawCatItem(kind, id){ return CAT[id] || null; }",
  ].join("\n");
  const pl = { console, Math };
  vm.createContext(pl);
  vm.runInContext(code, pl);
  pl.CAT = { [MUSIC.id]: MUSIC, [SFX.id]: SFX, [COVER.id]: COVER };
  vm.runInContext("CAT = this.CAT;", pl);
  const a = await pl.collectAudioParams({ type: "music", fields: { model: MUSIC.id, duration: "1" } });
  const b = await pl.collectAudioParams({ type: "remix", fields: { model: SFX.id, duration: "0.1" } });
  const c = await pl.collectAudioParams({ type: "remix", fields: { model: COVER.id, duration: "1" } });
  if (a.duration !== 5) fail(`play: leftover 1s on a 5s music model posted ${a.duration}`);
  else if (b.duration !== 0.5) fail(`play: remix secduration leftover 0.1s posted ${b.duration}`);
  else if (c.duration != null) fail(`play: cover remix (no per_second) must not send duration, got ${c.duration}`);
  else ok("play: audio send floors leftover short durations (music + remix secduration)");
}

if (failed) { console.error("\ncheck-duration-knob-edges: " + failed + " failure(s)"); process.exit(1); }
console.log("\ncheck-duration-knob-edges: OK");
