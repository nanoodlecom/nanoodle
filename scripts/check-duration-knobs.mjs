#!/usr/bin/env node
// Duration-knob audit guard (live catalog audit 2026-09-28, after #629). Every duration-like knob
// must agree with the NanoGPT catalog in BOTH engines (index.html editor + play.html runtime):
//
//   * P-Video 2 / 2 Pro / Edit price per second on the chosen duration (mode / draft tables, clamped to
//     minimum/maximum_billable_duration). genericScanUsd used to quote their 480p leaf as a flat clip price.
//   * seedance-video / seedance-lite-video: duration_multiplier bills the 10s option only — the 5s
//     clip is the base price (it used to double every clip).
//   * LTX-2.3 Quality (raw megapixel): frames follow the chosen duration, not the fixed 145-frame default.
//   * A catalogued t2v/i2v model with NO duration param (Veo 3 fixed 8s, Hailuo 2.3 Pro fixed 5s, …)
//     hides the 5/10 soft knob, and a stale node duration no longer moves its estimate.
//   * Audio duration (music / sfx / remix) is clamped to the model's min/max_duration before POST, and a
//     blank duration's default estimate never exceeds the model's range (22s SFX v2, 8s Mirelo inpaint).
//
// Offline, zero API spend. Pricing/params are verbatim live catalog shapes.
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
  vm.runInContext(src.slice(s, e) + "\nthis.videoUnitUsd=videoUnitUsd; this.audioBilledSeconds=audioBilledSeconds;", ctx);
  return ctx;
}

// ---- live pricing shapes (2026-09-28) ----
const PV2PRO = { currency: "USD", speed_per_second_by_resolution: { "480p": 0.02, "768p": 0.035 }, quality_per_second_by_resolution: { "480p": 0.04, "768p": 0.075 }, minimum_billable_duration: 5, maximum_billable_duration: 15, default_duration: 5, default_resolution: "768p", default_mode: "speed" };
const PV2 = { currency: "USD", full_per_second_by_resolution: { "720p": 0.025, "1080p": 0.05 }, draft_per_second_by_resolution: { "720p": 0.015, "1080p": 0.03 }, minimum_billable_duration: 1, maximum_billable_duration: 20, default_duration: 5, default_resolution: "720p" };
const PVEDIT = { currency: "USD", full_per_second: 0.045, draft_per_second: 0.025, minimum_billable_duration: 1, maximum_billable_duration: 15 };
const SEEDANCE = { currency: "USD", base_prices_by_resolution: { "480p": 0.12002, "720p": 0.285, "1080p": 0.57 }, duration_multiplier: 2 };
const LTX23Q = { currency: "USD", raw: { type: "ltx23-quality-megapixel", pricePerMegapixel: 0.0014161764705882354, megapixelsByResolution: { "720p": 0.9216, landscape_16_9: 0.9216 }, defaultDuration: 6, defaultResolution: "landscape_16_9", defaultFramesPerSecond: 24, defaultNumFrames: 145 } };
const HAILUO23 = { currency: "USD", per_second: 0.098, supported_durations: [5] };

for (const [name, src, end] of [["editor", IDX, "function nodeUnitUsd("], ["play", PLAY, "async function nodeUnitUsdPlay("]]) {
  const R = resolver(src, end);
  const cases = [
    ["P-Video 2 Pro 5s 768p speed", R.videoUnitUsd(PV2PRO, { duration: "5" }), 0.175],
    ["P-Video 2 Pro 15s 768p quality", R.videoUnitUsd(PV2PRO, { duration: "15", modelOpts: { mode: "quality" } }), 1.125],
    ["P-Video 2 Pro 20s clamps to 15 billable", R.videoUnitUsd(PV2PRO, { duration: "20", resolution: "480p" }), 0.3],
    ["P-Video 2 1s 720p full", R.videoUnitUsd(PV2, { duration: "1" }), 0.025],
    ["P-Video 2 20s 1080p draft", R.videoUnitUsd(PV2, { duration: "20", resolution: "1080p", modelOpts: { draft: true } }), 0.6],
    ["P-Video Edit full × default 5s", R.videoUnitUsd(PVEDIT, {}), 0.225],
    ["P-Video Edit draft × 10s", R.videoUnitUsd(PVEDIT, { duration: "10", modelOpts: { draft: "true" } }), 0.25],
    ["seedance-video 480p 5s = base", R.videoUnitUsd(SEEDANCE, { duration: "5", resolution: "480p" }), 0.12002],
    ["seedance-video 480p 10s = base × 2", R.videoUnitUsd(SEEDANCE, { duration: "10", resolution: "480p" }), 0.24004],
    ["LTX-2.3 Quality 20s = 481 frames", R.videoUnitUsd(LTX23Q, { duration: "20" }), 0.0014161764705882354 * 0.9216 * 481],
    ["LTX-2.3 Quality unset = 145-frame default", R.videoUnitUsd(LTX23Q, {}), 0.0014161764705882354 * 0.9216 * 145],
  ];
  let bad = 0;
  for (const [what, got, want] of cases) if (!near(got, want)) { fail(`${name}: ${what} → ${got} (want ${want})`); bad++; }
  if (!bad) ok(`${name}: ${cases.length} duration-scaled pricing cases`);

  const sfx = R.audioBilledSeconds({ min_duration: 0.5, max_duration: 22 }, { duration: "" });
  const inpaint = R.audioBilledSeconds({ min_duration: 1, max_duration: 8 }, {});
  const music = R.audioBilledSeconds({ min_duration: 5, max_duration: 300 }, { duration: "" });
  const typed = R.audioBilledSeconds({ min_duration: 5, max_duration: 300 }, { duration: 500 });
  if (sfx !== 22 || inpaint !== 8) fail(`${name}: blank audio duration estimate not clamped to max (sfx ${sfx}, inpaint ${inpaint})`);
  else if (music !== null) fail(`${name}: blank in-range audio estimate should stay on EST (null), got ${music}`);
  else if (typed !== 300) fail(`${name}: typed 500s on a 300s model bills ${typed}`);
  else ok(`${name}: blank audio estimate stays inside min/max_duration`);
}

// ---- editor: hidden soft duration on catalogued no-duration t2v/i2v ----
{
  const code = [
    "var SIZES = [['1024x1024','square']];",
    IDX.slice(IDX.indexOf("const SIZE_FALLBACK"), IDX.indexOf("function applyDimFields(")).replace(/^const /gm, "var "),
    block(IDX, "function applyDimFields(fields, defs){"),
    block(IDX, "function dimDefs(type, model, fields){"),
    block(IDX, "function videoDimParams(n){"),
    block(IDX, "function videoPriceFields(params, fields){"),
    "var catalogs = { image:[], video:[] };",
    "function catItem(kind,id){ return (catalogs[kind]||[]).find(function(m){ return m.id===id; }); }",
  ].join("\n");
  const ed = { console, Math };
  vm.createContext(ed);
  vm.runInContext(code, ed);
  ed.catalogs.video = [
    { id: "veo3-video", params: { aspect_ratio: { type: "select", options: [{ value: "16:9" }, { value: "9:16" }], default: "16:9" } } },
    { id: "alibaba/wan-3.0/image-to-video-spicy", params: { duration: { type: "number", min: 2, max: 30, step: 1, default: 5 } } },
  ];
  const veo = ed.dimDefs("tvideo", "veo3-video").find((d) => d.f === "duration");
  const wan = ed.dimDefs("ivideo", "alibaba/wan-3.0/image-to-video-spicy").find((d) => d.f === "duration");
  const off = ed.dimDefs("tvideo", "not-in-catalog").find((d) => d.f === "duration");
  if (!veo || !veo.hidden) fail("editor: Veo 3 (no duration param) must keep a HIDDEN duration def, got " + JSON.stringify(veo));
  else ok("editor: catalogued no-duration t2v hides the 5/10 knob");
  if (!wan || wan.hidden) fail("editor: Wan 3.0 Spicy duration must stay visible");
  else ok("editor: listed duration stays visible");
  if (!off || off.hidden) fail("editor: uncatalogued model keeps the visible soft duration");
  else ok("editor: uncatalogued model keeps the visible soft duration");
  const wire = ed.videoDimParams({ type: "tvideo", fields: { model: "veo3-video", duration: "10", aspect: "16:9" } });
  if (String(wire.duration) !== "10") fail("editor send: hidden def must not change the wire (library parity), got " + JSON.stringify(wire));
  else ok("editor send: hidden duration keeps library send parity");
  const pf = ed.videoPriceFields({}, { duration: "10", resolution: "1080p" });
  const keep = ed.videoPriceFields({ duration: {} }, { duration: "10" });
  if (pf.duration !== "" || pf.resolution !== "1080p") fail("editor: videoPriceFields must drop a stale duration only");
  else if (keep.duration !== "10") fail("editor: videoPriceFields dropped a listed duration");
  else ok("editor: stale duration on a no-duration model no longer moves the estimate");
  const refresh = block(IDX, "function refreshDims(n){");
  if (!/defs\.filter\(d=> !d\.hidden\)/.test(refresh)) fail("editor: refreshDims no longer skips hidden defs");
  else ok("editor: refreshDims renders only visible defs");
  const R = resolver(IDX, "function nodeUnitUsd(");
  const a = R.videoUnitUsd(HAILUO23, pf), b = R.videoUnitUsd(HAILUO23, ed.videoPriceFields({}, { duration: "5" }));
  if (!near(a, 0.49) || !near(b, 0.49)) fail(`editor: Hailuo 2.3 Pro (fixed 5s) priced ${a}/${b}, want 0.49`);
  else ok("editor: Hailuo 2.3 Pro stays at its fixed 5s price with a stale 10s field");
}

// ---- play: twin price strip + row hide + wiring ----
{
  const pvf = block(PLAY, "function videoPriceFields(params, fields){");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(pvf, ctx);
  const pf = ctx.videoPriceFields({}, { duration: "10" });
  if (pf.duration !== "") fail("play: videoPriceFields must drop a stale duration");
  else ok("play: videoPriceFields twin drops a stale duration");
  if (!/videoUnitUsd\(pricing, videoPriceFields\(pp, f\), ref(?:Wired|Count), videoWired(?:, [\w.]+)?\)/.test(PLAY)) fail("play: nodeUnitUsdPlay no longer strips stale duration");
  else ok("play: nodeUnitUsdPlay prices through videoPriceFields");
  const fill = block(PLAY, "function fillDimLists(){");
  if (!/if\(it\.field==="duration"\)\{/.test(fill)) fail("play: fillDimLists no longer hides a catalogued model's missing duration row on every video node");
  else ok("play: fillDimLists hides the duration row for catalogued no-duration models");
  const eLivePrice = block(IDX, "function livePrice(kind, fields, nodeFilter){");
  if (!/videoPriceFields\(it\.params, fields\)/.test(eLivePrice)) fail("editor: livePrice no longer strips stale duration");
  else ok("editor: livePrice prices through videoPriceFields");
}

// ---- audio duration clamp on send (both engines) ----
const MUSIC = { id: "elevenlabs/music", supported_parameters: { min_duration: 5, max_duration: 300 }, pricing: { per_second: 0.01 } };
const SFX = { id: "elevenlabs/sound-effects/v2", supported_parameters: { min_duration: 0.5, max_duration: 22 }, pricing: { per_second: 0.002 } };
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
  ed.catalogs.audio = [norm(MUSIC), norm(SFX)];
  const a = ed.collectAudioParams({ type: "music", fields: { model: MUSIC.id, duration: "500" } });
  const b = ed.collectAudioParams({ type: "music", fields: { model: SFX.id, duration: "120" } });
  const c = ed.collectAudioParams({ type: "music", fields: { model: MUSIC.id, duration: "60" } });
  if (a.duration !== 300 || b.duration !== 22 || c.duration !== 60) fail(`editor: audio duration not clamped on send (${a.duration}, ${b.duration}, ${c.duration})`);
  else ok("editor: audio duration clamps to the catalog range on send (500→300, leftover 120→22 on SFX v2, 60 kept)");
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
  pl.CAT = { [MUSIC.id]: MUSIC, [SFX.id]: SFX };
  vm.runInContext("CAT = this.CAT;", pl);
  const a = await pl.collectAudioParams({ type: "music", fields: { model: MUSIC.id, duration: "500" } });
  const b = await pl.collectAudioParams({ type: "music", fields: { model: SFX.id, duration: "120" } });
  const c = await pl.collectAudioParams({ type: "music", fields: { model: "offline-model", duration: "500" } });
  if (a.duration !== 300 || b.duration !== 22) fail(`play: audio duration not clamped on send (${a.duration}, ${b.duration})`);
  else if (c.duration !== 500) fail(`play: catalog miss must keep the send-everything fallback, got ${c.duration}`);
  else ok("play: audio duration clamps to the catalog range on send (catalog miss unchanged)");
}

// the library (njs, the default send path) posts fields.duration raw — both engines clamp it first
{
  const e = block(IDX, "function njsRunFor(type, rn, inp, n){");
  const p = block(PLAY, "function njsRunFor(type, rn, inp, runKey){");
  if (!/type==="music" \|\| type==="remix"[\s\S]{0,400}rn\.fields\.duration = Math\.min\(\+ap\.max_duration/.test(e)) fail("editor: njsRunFor no longer clamps audio duration before the library send");
  else ok("editor: njsRunFor clamps audio duration before the library send");
  if (!/type==="music" \|\| type==="remix"[\s\S]{0,400}rn\.fields\.duration = Math\.min\(\+asp\.max_duration/.test(p)) fail("play: njsRunFor no longer clamps audio duration before the library send");
  else ok("play: njsRunFor clamps audio duration before the library send");
}

if (failed) { console.error("\ncheck-duration-knobs: " + failed + " failure(s)"); process.exit(1); }
console.log("\ncheck-duration-knobs: OK");
