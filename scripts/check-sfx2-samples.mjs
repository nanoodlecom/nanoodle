#!/usr/bin/env node
// Mirelo SFX 2.0 samples guard (live catalog 2026-10-15, found on main 7c71d40).
//
// NanoGPT added pricing.multiplier_parameter:"num_samples" for mirelo-ai/sfx2.0 (1–4 samples,
// default 2, every sample billed). Nothing read it, so the Video edit chip said ~$0.11/clip
// for 1, 2 or 4 samples (real: $0.11 / $0.22 / $0.44 at the 10s default). This pins:
//
//   * cost: both engines' videoUnitUsd + audioUnitUsd multiply by the knob, else the catalog
//     multiplier_default, and speechEstUsd meters the request body's num_samples;
//   * knobs: Video edit gets a Samples dim (1–4, default 2) and a number duration clamped to the
//     catalog's 1–600s / 0.1s instead of the 5/10 dropdown; num_samples leaves ⚙️ Model options;
//   * Music node on SFX models: no Lyrics / Instrumental, Samples knob, 30s duration default,
//     catalog formats (wav/mp3/aac/flac, default wav → upload_audio_format), and SFX 1.6's 1–60s;
//   * play twins send the same bodies; the library veto keeps SFX runs on the built-in path.
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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function block(src, anchor, from = 0) {
  const start = src.indexOf(anchor, from);
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
  vm.runInContext(src.slice(s, e) + "\nthis.videoUnitUsd=videoUnitUsd; this.audioUnitUsd=audioUnitUsd; this.speechEstUsd=speechEstUsd; this.audioBilledSeconds=audioBilledSeconds; this.pricingMultiplier=pricingMultiplier;", ctx);
  return ctx;
}

// ---- live catalog shapes (GET /api/v1/video-models, /api/v1/audio-models — 2026-10-15) ----
const SFX2_VIDEO_PRICING = { currency: "USD", min_duration: 1, max_duration: 600, duration_step: 0.1, default_duration: 10, per_second: 0.011, standard_per_second: 0.0165,
  multiplier_parameter: "num_samples", multiplier_min: 1, multiplier_max: 4, multiplier_default: 2 };
const SFX2_VIDEO_PARAMS = {
  duration: { type: "number", label: "Sound duration (seconds)", default: 10, min: 1, max: 600, step: 0.1 },
  num_samples: { type: "number", label: "Samples", description: "Each sample is billed separately.", default: 2, min: 1, max: 4, step: 1 },
  preserve_speech: { type: "boolean", label: "Preserve speech", default: true },
  negative_prompt: { type: "string", label: "Negative prompt", default: "", maxLength: 1000 },
  seed: { type: "number", label: "Seed", default: -1, min: -1, max: 9007199254740988, step: 1 },
};
const SFX2_VIDEO_DEFAULTS = { duration: 10, num_samples: 2, preserve_speech: true, negative_prompt: "", seed: -1 };
const SFX2_AUDIO_PRICING = Object.assign({}, SFX2_VIDEO_PRICING, { min_duration: 0.1, default_duration: 30 });
const SFX2_AUDIO_SP = {
  duration: { label: "Sound duration (seconds)", type: "number", min: 0.1, max: 600, step: 0.1, default: 30 },
  num_samples: { min: 1, max: 4, default: 2 },
  upload_audio_format: { label: "Audio format", type: "string", default: "wav", options: [{ value: "wav", label: "WAV" }, { value: "mp3", label: "MP3" }, { value: "aac", label: "AAC" }, { value: "flac", label: "FLAC" }] },
  min_duration: 0.1, video_min_duration: 1, max_duration: 600, default_text_duration: 30, default_video_duration: 10, duration_step: 0.1,
};
const SFX16_AUDIO = { id: "mirelo-ai/sfx1.6/text-to-audio", name: "Mirelo SFX1.6 Text to Audio",
  pricing: { per_second: 0.01, minimum: 0.01, currency: "USD", multiplier_parameter: "num_samples", multiplier_min: 1, multiplier_max: 4 },
  supported_parameters: { min_duration: 1, max_duration: 60, sample_count_parameter: "num_samples", min_samples: 1, max_samples: 4 } };
const SFX2_AUDIO = { id: "mirelo-ai/sfx2.0", name: "Mirelo SFX 2.0", pricing: SFX2_AUDIO_PRICING, supported_parameters: SFX2_AUDIO_SP };
const SONG = { id: "minimax/music-3", name: "MiniMax Music 3", pricing: { per_generation: 0.1 }, supported_parameters: { min_duration: 5, max_duration: 300 } };

// ---- 1) cost estimators: 1 / 2 / 4 samples (both engines) ----
for (const [name, src, end] of [["editor", IDX, "function nodeUnitUsd("], ["play", PLAY, "async function nodeUnitUsdPlay("]]) {
  const R = resolver(src, end);
  const ctx = { params: SFX2_VIDEO_PARAMS, defaults: SFX2_VIDEO_DEFAULTS };
  const v = (f) => R.videoUnitUsd(SFX2_VIDEO_PRICING, f, 0, true, "v2v", ctx);
  const cases = [
    ["video 10s × 1 sample", v({ duration: "10", num_samples: "1" }), 0.11],
    ["video 10s × 2 samples", v({ duration: "10", num_samples: "2" }), 0.22],
    ["video 10s × 4 samples", v({ duration: "10", num_samples: "4" }), 0.44],
    ["video unset samples = catalog default 2", v({ duration: "10" }), 0.22],
    ["video unset everything = 10s × 2", v({}), 0.22],
    ["video stale modelOpts.num_samples 4 still counts", v({ duration: "10", modelOpts: { num_samples: 4 } }), 0.44],
    ["video 37.5s × 3", v({ duration: "37.5", num_samples: 3 }), 0.011 * 37.5 * 3],
    ["video 9 samples clamps to max 4", v({ duration: "10", num_samples: "9" }), 0.44],
    // Music node chip: audioUnitUsd(base) × pricingMultiplier(node fields) — what nodeUnitUsd / nodeUnitUsdPlay return
    ["audio 30s × 1", R.audioUnitUsd(SFX2_AUDIO_PRICING, 20, 30) * R.pricingMultiplier(SFX2_AUDIO_PRICING, { num_samples: "1" }), 0.33],
    ["audio 30s × 2", R.audioUnitUsd(SFX2_AUDIO_PRICING, 20, 30) * R.pricingMultiplier(SFX2_AUDIO_PRICING, { num_samples: "2" }), 0.66],
    ["audio 30s × 4", R.audioUnitUsd(SFX2_AUDIO_PRICING, 20, 30) * R.pricingMultiplier(SFX2_AUDIO_PRICING, { num_samples: "4" }), 1.32],
    ["multiplier unset = catalog default 2", R.pricingMultiplier(SFX2_AUDIO_PRICING, {}), 2],
    ["multiplier SFX 1.6 (no catalog default) = 1", R.pricingMultiplier(SFX16_AUDIO.pricing, {}), 1],
    ["multiplier on a model without multiplier_parameter = 1", R.pricingMultiplier(SONG.pricing, { num_samples: 4 }), 1],
    ["multiplier 0 / junk clamps to min 1", R.pricingMultiplier(SFX2_AUDIO_PRICING, { num_samples: "0" }), 1],
    ["post-run body with num_samples 4", R.speechEstUsd(SFX2_AUDIO_PRICING, SFX2_AUDIO_SP, "rain", { num_samples: 4 }), 1.32],
    ["post-run body omitting num_samples (default 2)", R.speechEstUsd(SFX2_AUDIO_PRICING, SFX2_AUDIO_SP, "rain", {}), 0.66],
  ];
  let bad = 0;
  for (const [what, got, want] of cases) if (!near(got, want)) { fail(`${name}: ${what} → ${got} (want ${want})`); bad++; }
  if (!bad) ok(`${name}: ${cases.length} multiplier_parameter cost cases (Video edit $0.11 / $0.22 / $0.44 for 1 / 2 / 4 samples)`);
  const blank = R.audioBilledSeconds(SFX2_AUDIO_SP, { duration: "" });
  if (blank !== 30) fail(`${name}: blank SFX 2.0 duration should bill the catalog's 30s text default, got ${blank}`);
  else ok(`${name}: blank SFX 2.0 Music duration bills the catalog's 30s default`);
}

// ---- 2) editor knobs: Video edit dims + Model options ----
{
  const code = [
    "var SIZES = [['1024x1024','square']];",
    IDX.slice(IDX.indexOf("const SIZE_FALLBACK"), IDX.indexOf("function applyDimFields(")).replace(/^const /gm, "var "),
    block(IDX, "function applyDimFields(fields, defs){"),
    block(IDX, "function videoLoraOn(fields){"),
    block(IDX, "function dimDefs(type, model, fields){"),
    block(IDX, "function videoDimParams(n){"),
    "var VIDEO_IMG_ROLE_KEYS = { refs:['reference_images'] }; function videoRefsPriced(){ return false; }",
    "var PRICE_OR_DIM_PARAM = " + IDX.match(/const PRICE_OR_DIM_PARAM = (\/[^\n]*\/);/)[1] + ";",
    block(IDX, "function videoFreetextSkip(key, d){"),
    block(IDX, "function videoOptDefs(model, nodeType){"),
    "var NODE_TYPES = { vedit:{ modelKind:'video', modelFilter:'v2v', refInputs:true }, tvideo:{ modelKind:'video', modelFilter:'t2v' } };",
    "var catalogs = { image:[], video:[] };",
    "function catItem(kind,id){ return (catalogs[kind]||[]).find(function(m){ return m.id===id; }); }",
  ].join("\n");
  const ed = { console, Math };
  vm.createContext(ed);
  vm.runInContext(code, ed);
  ed.catalogs.video = [
    { id: "mirelo-ai/sfx2.0", pricing: SFX2_VIDEO_PRICING, params: SFX2_VIDEO_PARAMS, defaults: SFX2_VIDEO_DEFAULTS },
    { id: "mirelo-ai/sfx1.6/video-to-video", pricing: { per_second: 0.01, supported_durations: [1, 2, 3, 60] }, params: { seed: { type: "number", min: -1, max: 2147483647, step: 1, default: -1 } }, defaults: { seed: -1 } },
  ];
  const defs = ed.dimDefs("vedit", "mirelo-ai/sfx2.0", {});
  const dur = defs.find((d) => d.f === "duration"), smp = defs.find((d) => d.f === "num_samples");
  if (!dur || dur.type !== "number" || dur.min !== 1 || dur.max !== 600 || dur.step !== 0.1 || dur.def !== "10" || dur.hidden)
    fail("editor: SFX 2.0 Video edit duration must be a 1–600s / 0.1s number dim (default 10), got " + JSON.stringify(dur));
  else ok("editor: SFX 2.0 Video edit duration follows the catalog (1–600s, 0.1s steps) — no 5/10 dropdown");
  if (!smp || !eq(smp.options.map((o) => o[0]), ["1", "2", "3", "4"]) || smp.def !== "2" || smp.wire !== "num_samples" || smp.hidden)
    fail("editor: SFX 2.0 Video edit needs a Samples dim 1–4 (default 2) wired as num_samples, got " + JSON.stringify(smp));
  else ok("editor: SFX 2.0 Video edit shows a Samples knob (1–4, default 2)");
  const f1 = { model: "mirelo-ai/sfx2.0", duration: "700", num_samples: "9" };
  ed.applyDimFields(f1, ed.dimDefs("vedit", f1.model, f1));
  const f2 = { model: "mirelo-ai/sfx2.0", duration: "12.34" };
  ed.applyDimFields(f2, ed.dimDefs("vedit", f2.model, f2));
  const f3 = { model: "mirelo-ai/sfx2.0", duration: "5" };   // the old 5/10 dropdown value is a valid length
  ed.applyDimFields(f3, ed.dimDefs("vedit", f3.model, f3));
  if (f1.duration !== "600" || f1.num_samples !== "2") fail(`editor: 700s / 9 samples must clamp to 600s and snap to default 2, got ${f1.duration} / ${f1.num_samples}`);
  else if (f2.duration !== "12.3" || f2.num_samples !== "2") fail(`editor: 12.34s must snap to the 0.1s grid (12.3) and seed samples=2, got ${f2.duration} / ${f2.num_samples}`);
  else if (f3.duration !== "5") fail(`editor: an in-range 5s must be kept, got ${f3.duration}`);
  else ok("editor: duration clamps to 1–600 on the 0.1s grid; Samples seeds 2 and snaps out-of-range values");
  const wire = ed.videoDimParams({ type: "vedit", fields: { model: "mirelo-ai/sfx2.0", duration: "37.5", num_samples: "4" } });
  if (!eq(wire, { duration: 37.5, num_samples: 4 })) fail("editor send: SFX 2.0 Video edit should POST numeric duration + num_samples, got " + JSON.stringify(wire));
  else ok("editor send: Video edit posts { duration: 37.5, num_samples: 4 }");
  const opts = ed.videoOptDefs("mirelo-ai/sfx2.0", "vedit").map((d) => d.key);
  if (opts.includes("num_samples") || opts.includes("duration")) fail("editor: num_samples must leave ⚙️ Model options (the node owns it), got " + JSON.stringify(opts));
  else if (!opts.includes("preserve_speech") || !opts.includes("negative_prompt")) fail("editor: SFX 2.0 still needs its other model options, got " + JSON.stringify(opts));
  else ok("editor: ⚙️ Model options keeps preserve speech / negative prompt / seed, not a duplicate Samples");
  const s16 = ed.dimDefs("vedit", "mirelo-ai/sfx1.6/video-to-video", {});
  if (s16.some((d) => d.f === "num_samples" || (d.f === "duration" && !d.hidden))) fail("editor: SFX 1.6 Video edit lists no samples/duration param — no knobs, got " + JSON.stringify(s16));
  else ok("editor: SFX 1.6 Video edit grows no Samples / duration knob");
  const refresh = block(IDX, "function refreshDims(n){");
  if (!/d\.type==="number"[\s\S]*type="number" data-df=/.test(refresh) || !/clampNumDim\(el\.value, d\)/.test(refresh)) fail("editor: refreshDims no longer renders/clamps the number duration input");
  else ok("editor: refreshDims renders the number input and clamps on edit");
}

// ---- 3) editor knobs: Music node on SFX models ----
{
  const code = [
    block(IDX, "const AUDIO_PARAMS = {").replace(/^const\s/, "var "),
    ...["audioIsSfx", "audioMultiplierSpec", "audioUploadFormat", "audioDurationDefault"].map((f) => block(IDX, "function " + f + "(it){")),
    block(IDX, "function audioApplies(at, it){"),
    block(IDX, "function audioFields(kind, it){"),
    block(IDX, "function assertGenerateSongLyrics(model, lyrics){"),
    block(IDX, "function collectAudioParams(n){"),
    block(IDX, "function musicPromptCopy(it){"),
    IDX.match(/const MUSIC_PROMPT = [^\n]*/)[0].replace(/^const /, "var "),
    IDX.match(/const SFX_PROMPT = [^\n]*/)[0].replace(/^const /, "var "),
    "var catalogs = { audio:[] };",
    "function catItem(kind,id){ return (catalogs[kind]||[]).find(function(m){ return m.id===id; }); }",
  ].join("\n");
  const ed = { console, Math };
  vm.createContext(ed);
  vm.runInContext(code, ed);
  const norm = (m) => ({ id: m.id, name: m.name, voices: [], language: null, params: m.supported_parameters, pricing: m.pricing });
  ed.catalogs.audio = [norm(SFX2_AUDIO), norm(SFX16_AUDIO), norm(SONG), norm({ id: "elevenlabs/sound-effects/v2", name: "ElevenLabs Sound Effects V2", pricing: { per_second: 0.002 }, supported_parameters: { min_duration: 0.5, max_duration: 22 } })];
  const it2 = ed.catItem("audio", SFX2_AUDIO.id), it16 = ed.catItem("audio", SFX16_AUDIO.id), song = ed.catItem("audio", SONG.id);
  const f2 = ed.audioFields("music", it2), ids2 = f2.map((f) => f.id);
  const smp = f2.find((f) => f.id === "num_samples"), fmt = f2.find((f) => f.id === "response_format"), dur = f2.find((f) => f.id === "duration");
  if (ids2.includes("lyrics") || ids2.includes("instrumental")) fail("editor: SFX 2.0 Music must hide Lyrics + Instrumental, got " + JSON.stringify(ids2));
  else ok("editor: SFX Music hides Lyrics and the Instrumental checkbox");
  if (!smp || smp.jsonKey !== "num_samples" || !eq(smp.options, ["1", "2", "3", "4"]) || smp.default !== "2") fail("editor: SFX 2.0 Music Samples knob 1–4 default 2, got " + JSON.stringify(smp));
  else ok("editor: SFX 2.0 Music shows Samples (1–4, default 2)");
  if (!fmt || fmt.jsonKey !== "upload_audio_format" || !eq(fmt.options, ["wav", "mp3", "aac", "flac"]) || fmt.default !== "wav") fail("editor: SFX 2.0 formats must come from the catalog, got " + JSON.stringify(fmt));
  else ok("editor: SFX 2.0 Format = catalog wav/mp3/aac/flac (default wav → upload_audio_format)");
  if (!dur || dur.default !== 30 || dur.min !== 0.1 || dur.max !== 600) fail("editor: SFX 2.0 duration should show the 30s default within 0.1–600, got " + JSON.stringify(dur));
  else ok("editor: SFX 2.0 Duration shows the catalog's 30s default");
  const ids16 = ed.audioFields("music", it16).map((f) => f.id);
  if (ids16.includes("lyrics") || ids16.includes("num_samples")) fail("editor: SFX 1.6 Music (no samples default) hides lyrics and grows no Samples knob, got " + JSON.stringify(ids16));
  else ok("editor: SFX 1.6 / ElevenLabs SFX are treated as SFX too (no Lyrics)");
  const idsEl = ed.audioFields("music", ed.catItem("audio", "elevenlabs/sound-effects/v2")).map((f) => f.id);
  const idsSong = ed.audioFields("music", song).map((f) => f.id);
  if (idsEl.includes("lyrics") || !idsSong.includes("lyrics") || !idsSong.includes("instrumental")) fail(`editor: SFX gate wrong (EL ${idsEl}, song ${idsSong})`);
  else ok("editor: song models keep Lyrics + Instrumental");
  if (ed.musicPromptCopy(it2)[0] !== "sound description" || ed.musicPromptCopy(song)[0] !== "musical style — not lyrics") fail("editor: Music prompt label must switch to a sound description for SFX");
  else ok("editor: SFX Music prompt label = \"sound description\" (songs keep \"musical style\")");
  const b4 = ed.collectAudioParams({ type: "music", fields: { model: SFX2_AUDIO.id, prompt: "rain", num_samples: "4", response_format: "flac", duration: "30", lyrics: "la la" } });
  const b2 = ed.collectAudioParams({ type: "music", fields: { model: SFX2_AUDIO.id, prompt: "rain", num_samples: "2", response_format: "wav", duration: "12.5" } });
  if (!eq(b4, { num_samples: 4, upload_audio_format: "flac" })) fail("editor send: SFX 2.0 Music ×4 flac body wrong, got " + JSON.stringify(b4));
  else if (!eq(b2, { duration: 12.5 })) fail("editor send: defaults (2 samples, wav) must be omitted, got " + JSON.stringify(b2));
  else ok("editor send: Music posts num_samples:4 + upload_audio_format:flac, omits catalog defaults and stale lyrics");
  const b16 = ed.collectAudioParams({ type: "music", fields: { model: SFX16_AUDIO.id, prompt: "rain", duration: "120", num_samples: "4" } });
  if (!eq(b16, { duration: 60 })) fail("editor send: SFX 1.6 clamps duration to 60 and sends no num_samples, got " + JSON.stringify(b16));
  else ok("editor send: SFX 1.6 duration clamps to 1–60");
  const rap = block(IDX, "function refreshAudioParams(n){");
  if (!/Math\.min\(\+f\.max, num\)/.test(rap) || !/delete n\.fields\[mk\]/.test(rap) || !/syncAudioPromptLabel\(n, it\)/.test(rap))
    fail("editor: refreshAudioParams must clamp a leftover duration on model switch, drop a stale Samples value, and relabel the prompt");
  else ok("editor: switching models clamps the duration field (SFX 2.0 120s → SFX 1.6 60s) and drops stale Samples");
}

// ---- 4) play twins: Music body + Video edit dims ----
{
  const src = PLAY.slice(PLAY.indexOf("  const AUDIO_PARAMS = {"));
  const code = [
    block(src, "const AUDIO_PARAMS = {").replace(/^const\s/, "var "),
    block(PLAY, "function assertGenerateSongLyrics(model, lyrics){"),
    block(PLAY, "async function collectAudioParams(n){"),
    "var DURATIONS = [['5','5 sec'],['10','10 sec']];",
    block(PLAY, "var DIM_TIER_PX = {"),
    block(PLAY, "function dimShape(v){"),
    block(PLAY, "function dimNum(v){"),
    block(PLAY, "function nearestDimOption(cur, options, def){"),
    block(PLAY, "function rangeDurOpts(param){"),
    block(PLAY, "function dimOptionsFromItem(type, m){"),
    block(PLAY, "async function videoDimParams(n){"),
    "var CAT = {};",
    "async function rawCatItem(kind, id){ return CAT[kind+':'+id] || null; }",
  ].join("\n");
  const pl = { console, Math };
  vm.createContext(pl);
  vm.runInContext(code, pl);
  pl.CAT = {
    ["audio:" + SFX2_AUDIO.id]: SFX2_AUDIO, ["audio:" + SFX16_AUDIO.id]: SFX16_AUDIO, ["audio:" + SONG.id]: SONG,
    ["video:mirelo-ai/sfx2.0"]: { id: "mirelo-ai/sfx2.0", pricing: SFX2_VIDEO_PRICING, supported_parameters: { parameters: SFX2_VIDEO_PARAMS, defaults: SFX2_VIDEO_DEFAULTS } },
  };
  vm.runInContext("CAT = this.CAT;", pl);
  const b4 = await pl.collectAudioParams({ type: "music", fields: { model: SFX2_AUDIO.id, num_samples: "4", response_format: "flac", duration: "30", lyrics: "la la" } });
  const b2 = await pl.collectAudioParams({ type: "music", fields: { model: SFX2_AUDIO.id, num_samples: "2", response_format: "wav", duration: "12.5" } });
  const b16 = await pl.collectAudioParams({ type: "music", fields: { model: SFX16_AUDIO.id, duration: "120", num_samples: "4" } });
  const bs = await pl.collectAudioParams({ type: "music", fields: { model: SONG.id, lyrics: "la la", instrumental: false } });
  if (!eq(b4, { num_samples: 4, upload_audio_format: "flac" })) fail("play send: SFX 2.0 Music ×4 flac body wrong, got " + JSON.stringify(b4));
  else if (!eq(b2, { duration: 12.5 })) fail("play send: defaults must be omitted, got " + JSON.stringify(b2));
  else if (!eq(b16, { duration: 60 })) fail("play send: SFX 1.6 clamp/samples wrong, got " + JSON.stringify(b16));
  else if (!eq(bs, { lyrics: "la la" })) fail("play send: song models keep lyrics, got " + JSON.stringify(bs));
  else ok("play send: Music bodies match the editor (samples, upload_audio_format, 30s default, SFX 1.6 60s, lyrics on songs only)");
  const w = await pl.videoDimParams({ type: "vedit", fields: { model: "mirelo-ai/sfx2.0", duration: "37.54", num_samples: "4" } });
  const wd = await pl.videoDimParams({ type: "vedit", fields: { model: "mirelo-ai/sfx2.0", duration: "" } });
  if (!eq(w, { duration: 37.5, num_samples: 4 })) fail("play send: Video edit dims should clamp onto the 0.1s grid and send num_samples, got " + JSON.stringify(w));
  else if (!eq(wd, { duration: 10, num_samples: 2 })) fail("play send: blank duration/samples should send the catalog defaults (10s, 2), got " + JSON.stringify(wd));
  else ok("play send: Video edit posts { duration: 37.5, num_samples: 4 } (defaults 10s × 2)");
}

// ---- 5) chips + library veto wiring ----
{
  const nu = block(IDX, "function nodeUnitUsd(n){");
  if (!/return u\*songs\*pricingMultiplier\(it\.pricing, fields\|\|\{\}\)/.test(nu)) fail("editor: nodeUnitUsd must pass the node fields to audioUnitUsd (num_samples)");
  else ok("editor: Music chip / run estimate price the Samples knob");
  const np = block(PLAY, "async function nodeUnitUsdPlay(n){");
  if (!/return u\*songs\*pricingMultiplier\(pricing, f\)/.test(np)) fail("play: nodeUnitUsdPlay must pass the node fields to audioUnitUsd");
  else ok("play: run estimate prices the Samples knob");
  const ej = block(IDX, "function njsRunFor(type, rn, inp, n){"), pj = block(PLAY, "function njsRunFor(type, rn, inp, runKey){");
  if (!/videoMultiplierDim\(catItem\("video", rn\.fields\.model\)\)\) return null/.test(ej) || !/audioIsSfx\(am\)/.test(ej)) fail("editor: njsRunFor must keep SFX Samples runs on the built-in path");
  else if (!/sfx\|sound/.test(pj)) fail("play: njsRunFor must keep SFX runs on the built-in path");
  else ok("both engines: SFX runs stay built-in (the library doesn't send num_samples / upload_audio_format yet)");
}

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\n✓ sfx2-samples: Mirelo SFX 2.0 multiplier_parameter priced and knobbed in both engines");
