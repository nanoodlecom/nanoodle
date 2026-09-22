#!/usr/bin/env node
// Offline proof for audio picker prices and the Yue2 file-type wire.
//
// Live catalog (public GET /api/v1/audio-models, no generation spend), captured
// while hunting this bug:
//   * per_second:0 + minimum (Lyria 3 Pro $0.08, HeartMuLa $0.10) used to print
//     "$0.000/s" and hide the fee that actually bills.
//   * microsoft/vibevoice is per_thousand_chars:0 + $0.15/gen → "$0.000/1k".
//   * bytedance/seed-audio-1.0 bills per_prompt_char_block and the picker was blank.
//   * ACE-Step 0.0001–0.0004 /s rounded to "$0.000/s" at 3 decimals.
//   * Whisper-Large-V3 $0.000495/min and mureka extend-lyrics $0.002/gen printed
//     as "$0.00".
//   * yue2-3b/text-to-music and yue2-3b/music-to-music catalog output_format
//     (mp3/wav/flac). The UI sent OpenAI response_format, which WaveSpeed ignores,
//     so wav/flac came back as the default mp3. music-to-music is a remix model
//     and had no format knob at all.
//   * Header-less binary audio (the live speech/music path) must meter the
//     requested duration on play + njs runGraph — ElevenLabs Music v2 at 61s
//     is $1.50, not $0 and not a flat 30s $0.75. x-cost:0 still wins.
//   * Octet-stream playback MIME follows output_format (Yue2 wav → audio/wav).
//
// Zero API spend: the functions are lifted out of index.html, play.html, and
// vendor/njs-engine.js and run against these catalog shapes. Play runGraph pins
// drive the real billed audio path (built-in + njs) with a header-less stub.

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadEngine, calls, catalog } from "./play-engine.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");
const VENDOR = readFileSync(join(ROOT, "vendor", "njs-engine.js"), "utf8");

const YUE2_T2M = "yue2-3b/text-to-music";
const YUE2_M2M = "yue2-3b/music-to-music";
const OF = { values: ["mp3", "wav", "flac"], default: "mp3" };

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

function braceMatch(src, start) {
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced braces from: " + src.slice(start, start + 60));
}
function extractFn(src, name) {
  const at = src.search(new RegExp("(async )?function " + name + "\\("));
  if (at === -1) throw new Error(name + "() not found");
  return braceMatch(src, at);
}
function extractConst(src, name) {
  const at = src.indexOf("const " + name + " = ");
  if (at === -1) throw new Error("const " + name + " not found");
  return braceMatch(src, at);
}
function stripWs(s) { return String(s).split("\n").map((l) => l.trim()).filter(Boolean).join("\n"); }

/* ---- picker / node-chip price strings (editor only) ---------------------- */

{
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extractFn(IDX, "audioPriceLabel"), ctx);
  const cases = [
    ["Lyria 3 Pro zero per_second", { per_second: 0, minimum: 0.08 }, "$0.08/gen"],
    ["HeartMuLa zero per_second", { per_second: 0, minimum: 0.1 }, "$0.10/gen"],
    ["Minimax-Music-02 zero per_second", { per_second: 0, minimum: 0.05 }, "$0.05/gen"],
    ["VibeVoice zero per-1k + per generation", { per_thousand_chars: 0, per_generation: 0.15 }, "$0.15/gen"],
    ["seed-audio per char block", { per_prompt_char_block: 0.09, prompt_char_block_size: 300, minimum: 0.09 }, "$0.090/300ch"],
    // 0.00015 is a float that toFixed(4) prints as 0.0001 — still a visible rate, not "$0.000/s".
    ["ACE-Step sub-mill per second", { per_second: 0.00015, minimum: 0 }, "$0.0001/s"],
    ["ACE-Step 0.0004/s", { per_second: 0.0004 }, "$0.0004/s"],
    ["ElevenLabs Music v2 started minute", { per_billing_interval: 0.75, billing_interval_seconds: 60, billing_interval_label: "started minute", minimum: 0.75 }, "$0.75/started minute"],
    ["Whisper sub-cent per minute", { per_minute: 0.000495 }, "$0.0005/min"],
    ["extend-lyrics sub-cent per generation", { per_generation: 0.002 }, "$0.002/gen"],
    ["ordinary TTS per 1k", { per_thousand_chars: 0.015 }, "$0.015/1k"],
    ["Lyria 3.5 per generation", { per_generation: 0.11 }, "$0.11/gen"],
    ["ElevenLabs Music per second", { per_second: 0.01, minimum: 0 }, "$0.010/s"],
    ["empty pricing", {}, ""],
  ];
  let bad = 0;
  for (const [name, pricing, expect] of cases) {
    const got = ctx.audioPriceLabel(pricing);
    if (got !== expect) { fail(`audioPriceLabel ${name}: ${JSON.stringify(got)} (expected ${JSON.stringify(expect)})`); bad++; }
  }
  if (!bad) ok(`audioPriceLabel matches ${cases.length} live catalog shapes`);
}

/* ---- editor audioFields + collectAudioParams ----------------------------- */

function editor() {
  const ctx = {
    console, JSON, String, Error, isNaN, Number, Array, Object, Math,
    catalogs: { audio: [] },
  };
  ctx.catItem = (kind, id) => (ctx.catalogs[kind] || []).find((m) => m.id === id);
  vm.createContext(ctx);
  vm.runInContext(
    extractConst(IDX, "AUDIO_PARAMS") + "\n"
    + extractFn(IDX, "audioApplies") + "\n"
    + extractFn(IDX, "audioFields") + "\n"
    + extractFn(IDX, "assertGenerateSongLyrics") + "\n"
    + extractFn(IDX, "collectAudioParams"),
    ctx,
  );
  return ctx;
}

function normItem(id, sp, pricing) {
  return { id, voices: [], language: null, pricing: pricing || {}, params: sp || {} };
}
function rawItem(id, sp, pricing) {
  return { id, pricing: pricing || {}, supported_parameters: sp || {} };
}

{
  const E = editor();
  const yue = normItem(YUE2_T2M, { output_format: OF, min_duration: 10, max_duration: 300 }, { per_generation: 0.1 });
  const m2m = normItem(YUE2_M2M, { output_format: OF }, { per_generation: 0.15 });
  const cover = normItem("minimax/music-cover", { min_duration: 5, max_duration: 120 }, { per_second: 0, minimum: 0.15 });

  const musicFmt = E.audioFields("music", yue).find((f) => f.id === "response_format");
  if (!musicFmt || musicFmt.jsonKey !== "output_format")
    fail(`editor music Yue2 format jsonKey: ${JSON.stringify(musicFmt && musicFmt.jsonKey)}`);
  else if (JSON.stringify(musicFmt.options) !== JSON.stringify(["mp3", "wav", "flac"]) || musicFmt.default !== "mp3")
    fail(`editor music Yue2 format options: ${JSON.stringify(musicFmt)}`);
  else ok("editor music Yue2 offers mp3/wav/flac under output_format");

  const remixFmt = E.audioFields("remix", m2m).find((f) => f.id === "response_format");
  if (!remixFmt || remixFmt.jsonKey !== "output_format")
    fail(`editor remix Yue2 music-to-music has no output_format knob: ${JSON.stringify(remixFmt)}`);
  else if (JSON.stringify(remixFmt.options) !== JSON.stringify(["mp3", "wav", "flac"]))
    fail(`editor remix Yue2 options: ${JSON.stringify(remixFmt.options)}`);
  else ok("editor remix Yue2 music-to-music offers the catalog file types");

  const coverFmt = E.audioFields("remix", cover).find((f) => f.id === "response_format");
  if (coverFmt) fail(`editor remix without output_format must not grow a Format control, got ${JSON.stringify(coverFmt)}`);
  else ok("editor remix cover model has no Format control");

  E.catalogs.audio = [yue, m2m, cover, normItem("elevenlabs/music", { min_duration: 5, max_duration: 300 }, { per_second: 0.01 })];

  const wav = E.collectAudioParams({ type: "music", fields: { model: YUE2_T2M, lyrics: "[Verse] hi", response_format: "wav" } });
  if (wav.output_format !== "wav" || "response_format" in wav)
    fail(`editor Yue2 wav must send output_format, got ${JSON.stringify(wav)}`);
  else ok("editor Yue2 text-to-music wav → output_format");

  const mp3 = E.collectAudioParams({ type: "music", fields: { model: YUE2_T2M, lyrics: "[Verse] hi", response_format: "mp3" } });
  if ("output_format" in mp3 || "response_format" in mp3)
    fail(`editor Yue2 default mp3 must be omitted, got ${JSON.stringify(mp3)}`);
  else ok("editor Yue2 default mp3 is omitted");

  const opus = E.collectAudioParams({ type: "music", fields: { model: YUE2_T2M, lyrics: "[Verse] hi", response_format: "opus" } });
  if ("output_format" in opus || "response_format" in opus)
    fail(`editor Yue2 must drop a format outside the catalog enum, got ${JSON.stringify(opus)}`);
  else ok("editor Yue2 drops opus (not in mp3/wav/flac)");

  const classic = E.collectAudioParams({ type: "music", fields: { model: "elevenlabs/music", lyrics: "la", response_format: "wav" } });
  if (classic.response_format !== "wav" || "output_format" in classic)
    fail(`editor music without output_format must keep response_format, got ${JSON.stringify(classic)}`);
  else ok("editor music without output_format still sends response_format");

  const remixWav = E.collectAudioParams({ type: "remix", fields: { model: YUE2_M2M, lyrics: "[Verse] hi", response_format: "flac" } });
  if (remixWav.output_format !== "flac" || "response_format" in remixWav)
    fail(`editor Yue2 music-to-music flac must send output_format, got ${JSON.stringify(remixWav)}`);
  else ok("editor Yue2 music-to-music flac → output_format");

  const stale = E.collectAudioParams({ type: "remix", fields: { model: "minimax/music-cover", lyrics: "la", response_format: "wav" } });
  if ("response_format" in stale || "output_format" in stale)
    fail(`editor cover remix must drop a stale format, got ${JSON.stringify(stale)}`);
  else ok("editor cover remix drops a stale response_format");
}

/* ---- play collectAudioParams (raw catalog) ------------------------------- */

function playCollector() {
  const ctx = { console, JSON, String, Error, isNaN, Number, Array, Object, Math };
  ctx.rawCatItem = async (_kind, id) => ctx._raw.find((m) => m.id === id) || null;
  ctx._raw = [];
  vm.createContext(ctx);
  vm.runInContext(
    extractConst(PLAY, "AUDIO_PARAMS") + "\n"
    + extractFn(PLAY, "assertGenerateSongLyrics") + "\n"
    + extractFn(PLAY, "collectAudioParams"),
    ctx,
  );
  return ctx;
}

{
  const P = playCollector();
  P._raw = [
    rawItem(YUE2_T2M, { output_format: OF }, { per_generation: 0.1 }),
    rawItem(YUE2_M2M, { output_format: OF }, { per_generation: 0.15 }),
    rawItem("minimax/music-cover", { min_duration: 5, max_duration: 120 }, { per_second: 0, minimum: 0.15 }),
    rawItem("elevenlabs/music", { min_duration: 5, max_duration: 300 }, { per_second: 0.01 }),
  ];
  const wav = await P.collectAudioParams({ type: "music", fields: { model: YUE2_T2M, lyrics: "[Verse] hi", response_format: "wav" } });
  if (wav.output_format !== "wav" || "response_format" in wav)
    fail(`play Yue2 wav must send output_format, got ${JSON.stringify(wav)}`);
  else ok("play Yue2 text-to-music wav → output_format");

  const mp3 = await P.collectAudioParams({ type: "music", fields: { model: YUE2_T2M, lyrics: "[Verse] hi", response_format: "mp3" } });
  if ("output_format" in mp3 || "response_format" in mp3)
    fail(`play Yue2 default mp3 must be omitted, got ${JSON.stringify(mp3)}`);
  else ok("play Yue2 default mp3 is omitted");

  const opus = await P.collectAudioParams({ type: "music", fields: { model: YUE2_T2M, lyrics: "[Verse] hi", response_format: "opus" } });
  if ("output_format" in opus || "response_format" in opus)
    fail(`play Yue2 must drop opus, got ${JSON.stringify(opus)}`);
  else ok("play Yue2 drops opus");

  const classic = await P.collectAudioParams({ type: "music", fields: { model: "elevenlabs/music", lyrics: "la", response_format: "wav" } });
  if (classic.response_format !== "wav" || "output_format" in classic)
    fail(`play music without output_format must keep response_format, got ${JSON.stringify(classic)}`);
  else ok("play music without output_format still sends response_format");

  const remixWav = await P.collectAudioParams({ type: "remix", fields: { model: YUE2_M2M, lyrics: "[Verse] hi", response_format: "flac" } });
  if (remixWav.output_format !== "flac" || "response_format" in remixWav)
    fail(`play Yue2 music-to-music flac must send output_format, got ${JSON.stringify(remixWav)}`);
  else ok("play Yue2 music-to-music flac → output_format");

  const stale = await P.collectAudioParams({ type: "remix", fields: { model: "minimax/music-cover", lyrics: "la", response_format: "wav" } });
  if ("response_format" in stale || "output_format" in stale)
    fail(`play cover remix must drop a stale format, got ${JSON.stringify(stale)}`);
  else ok("play cover remix drops a stale response_format");

  P._raw = [];
  const offline = await P.collectAudioParams({ type: "remix", fields: { model: YUE2_M2M, lyrics: "[Verse] hi", response_format: "wav" } });
  if (offline.response_format !== "wav" || "output_format" in offline)
    fail(`play catalog miss must keep response_format (send-everything), got ${JSON.stringify(offline)}`);
  else ok("play catalog miss keeps response_format");
}

/* ---- njs audioParams (vendor + the play.html copy) ----------------------- */

{
  const vendorFn = extractFn(VENDOR, "audioParams");
  const playFn = extractFn(PLAY, "audioParams");
  if (stripWs(vendorFn) !== stripWs(playFn)) fail("njs audioParams drifted between vendor/njs-engine.js and play.html");
  else ok("njs audioParams is the same in vendor and play.html");

  const ctx = { console, JSON, String, Error, isNaN, Number, Array, Object, Math };
  ctx.nonEmpty = (v) => v != null && String(v).trim() !== "";
  ctx.NanoodleError = class NanoodleError extends Error {};
  ctx.catItem = (catalog, kind, id) => {
    if (!catalog || !id) return null;
    const raw = catalog[kind];
    return (Array.isArray(raw) && raw.find((m) => m && m.id === id)) || null;
  };
  vm.createContext(ctx);
  vm.runInContext("const nonEmpty = this.nonEmpty;\n" + vendorFn, ctx);

  const cat = {
    audio: [
      rawItem(YUE2_T2M, { output_format: OF }),
      rawItem(YUE2_M2M, { output_format: OF }),
      rawItem("minimax/music-cover", { min_duration: 5, max_duration: 120 }),
    ],
  };
  const wav = ctx.audioParams({ type: "music", fields: { model: YUE2_T2M, lyrics: "hi", response_format: "wav" } }, { catalog: cat });
  if (wav.output_format !== "wav" || "response_format" in wav)
    fail(`njs Yue2 wav must send output_format, got ${JSON.stringify(wav)}`);
  else ok("njs Yue2 text-to-music wav → output_format");

  const mp3 = ctx.audioParams({ type: "music", fields: { model: YUE2_T2M, lyrics: "hi", response_format: "mp3" } }, { catalog: cat });
  if ("output_format" in mp3 || "response_format" in mp3)
    fail(`njs Yue2 default mp3 must be omitted, got ${JSON.stringify(mp3)}`);
  else ok("njs Yue2 default mp3 is omitted");

  const opus = ctx.audioParams({ type: "music", fields: { model: YUE2_T2M, lyrics: "hi", response_format: "opus" } }, { catalog: cat });
  if ("output_format" in opus || "response_format" in opus)
    fail(`njs Yue2 must drop opus, got ${JSON.stringify(opus)}`);
  else ok("njs Yue2 drops opus");

  const remixWav = ctx.audioParams({ type: "remix", fields: { model: YUE2_M2M, lyrics: "hi", response_format: "flac" } }, { catalog: cat });
  if (remixWav.output_format !== "flac" || "response_format" in remixWav)
    fail(`njs Yue2 music-to-music flac must send output_format, got ${JSON.stringify(remixWav)}`);
  else ok("njs Yue2 music-to-music flac → output_format");

  const stale = ctx.audioParams({ type: "remix", fields: { model: "minimax/music-cover", response_format: "wav" } }, { catalog: cat });
  if ("response_format" in stale || "output_format" in stale)
    fail(`njs cover remix must drop a stale format, got ${JSON.stringify(stale)}`);
  else ok("njs cover remix drops a stale response_format");

  const offline = ctx.audioParams({ type: "music", fields: { model: YUE2_T2M, response_format: "wav" } }, {});
  if (offline.response_format !== "wav" || "output_format" in offline)
    fail(`njs with no catalog must keep response_format, got ${JSON.stringify(offline)}`);
  else ok("njs with no catalog keeps response_format");
}

/* ---- header-less meter uses speechEstUsd; a real x-cost (including 0) wins ---- */

{
  const pins = [
    [IDX, /if\(isNaN\(hc\)\)\{\s*const it = catItem\("audio", model\);\s*est = it \? speechEstUsd\(it\.pricing, it\.params, input, extra\) : null;\s*\}/, "editor genAudio estimates only when x-cost is absent"],
    [IDX, /if\(c && c\.usd==null && est!=null\)\{/, "editor njs substitutes a catalog estimate only when usd is null (x-cost 0 stays exact)"],
    [PLAY, /if\(cAud\.usd==null\)\{ const est = await estSpeechUsd\(model, input, extra\); if\(est!=null\)\{ cAud\.usd = est; cAud\.estimate = true; \} \}/, "play genAudio estimates only when usd is null"],
    [PLAY, /if\(c && c\.usd==null && est!=null\) onCost\(Object\.assign\(\{\}, c, \{ usd:est, estimate:true \}\)\)/, "play njs substitutes a catalog estimate only when usd is null"],
    [PLAY, /return speechEstUsd\(m\.pricing, m\.supported_parameters, input, extra\);/, "play estSpeechUsd delegates to speechEstUsd"],
  ];
  let bad = 0;
  for (const [src, re, name] of pins) {
    if (!re.test(src)) { fail("missing wire: " + name); bad++; }
  }
  if (!bad) ok("speech meter falls back to the catalog estimate only when x-cost is absent");
}

/* ---- play runGraph: header-less binary audio meters requested duration ----
   speechEstUsd is already pinned in check-pricing.mjs. The default play-engine
   fetch always sends x-cost:0, so no existing runGraph can see this path.
   Live speech/music omits x-cost; without the genAudio / njs onCost substitute
   a 61s ElevenLabs v2 track books as $0 (or the old flat 30s $0.75). x-cost:0
   is known-free and must still win. */

const ELV2 = "elevenlabs/music/v2";
catalog.audio.push({
  id: ELV2,
  pricing: {
    per_billing_interval: 0.75,
    billing_interval_seconds: 60,
    billing_interval_label: "started minute",
    minimum: 0.75,
    currency: "USD",
  },
  supported_parameters: { min_duration: 3, max_duration: 600 },
});
catalog.audio.push({
  id: YUE2_T2M,
  pricing: { per_generation: 0.1, currency: "USD" },
  supported_parameters: { output_format: OF, min_duration: 10, max_duration: 300 },
});

function audioFetch(headers) {
  return (url, opts = {}) => {
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = opts.body; }
    calls.push({ url: String(url), body });
    let json = { usd_balance: "9.00" };
    if (/\/api\/v1\/models/.test(url)) json = { data: catalog.chat };
    else if (/\/api\/v1\/image-models/.test(url)) json = { data: catalog.image };
    else if (/\/api\/v1\/video-models/.test(url)) json = { data: catalog.video };
    else if (/\/api\/v1\/audio-models/.test(url)) json = { data: catalog.audio };
    const hdr = { ...headers };
    const isSpeech = /\/audio\/speech/.test(url);
    if (isSpeech && !hdr["content-type"]) hdr["content-type"] = "application/octet-stream";
    const bytes = () => new TextEncoder().encode("fake-audio-bytes");
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: (k) => {
        const key = String(k).toLowerCase();
        return Object.prototype.hasOwnProperty.call(hdr, key) ? hdr[key] : null;
      } },
      json: async () => json,
      text: async () => JSON.stringify(json),
      arrayBuffer: async () => bytes().buffer,
      blob: async () => new Blob([bytes()], { type: hdr["content-type"] || "" }),
    });
  };
}

function loadAudioEngine({ njs, headers, onBlob }) {
  const vendor = join(ROOT, "vendor", "njs-engine.js");
  const w = {};
  if (njs) {
    if (!existsSync(vendor)) throw new Error("njs-engine missing");
    new Function("window", readFileSync(vendor, "utf8"))(w);
  }
  let captured;
  const app = loadEngine((ctx) => {
    captured = ctx;
    ctx.URLSearchParams = URLSearchParams;
    ctx.fetch = audioFetch(headers);
    ctx.localStorage = ctx.sessionStorage = {
      getItem: (k) => (k === "ngpt_key" ? "test-api-key" : k === "njs_engine" ? (njs ? "1" : "0") : null),
      setItem() {}, removeItem() {},
    };
    const create = (blob) => {
      const t = blob && blob.type;
      if (onBlob) onBlob(t);
      return "blob:test-audio";
    };
    ctx.URL = ctx.URL || URL;
    ctx.URL.createObjectURL = create;
    ctx.URL.revokeObjectURL = () => {};
  });
  if (njs) captured.NanoodleEngine = w.NanoodleEngine;
  return app;
}

async function runMusicCost({ njs, headers, fields, onBlob }) {
  calls.length = 0;
  const app = loadAudioEngine({ njs, headers, onBlob });
  const seen = [];
  const g = app.materialize({
    nodes: [{ id: "m1", type: "music", x: 0, y: 0, fields }],
    links: [],
  });
  await app.runGraph(g, { onResult: (n) => seen.push(n) });
  const node = seen[0] || g.nodes.find((n) => n.id === "m1");
  return { node, posts: calls.filter((c) => /\/audio\/speech/.test(c.url)) };
}

{
  const fields = { model: ELV2, prompt: "choir", duration: "61" };
  for (const njs of [false, true]) {
    const label = njs ? "njs" : "play";
    const miss = await runMusicCost({ njs, headers: {}, fields });
    if (miss.posts.length !== 1) fail(`${label}: ElevenLabs v2 61s should POST once, got ${miss.posts.length}`);
    else if (Number(miss.posts[0].body.duration) !== 61)
      fail(`${label}: duration 61 not forwarded, got ${JSON.stringify(miss.posts[0].body)}`);
    else ok(`${label}: ElevenLabs v2 61s POSTs duration 61`);
    const got = miss.node && miss.node.costUsd;
    if (got !== 1.5) fail(`${label}: header-less 61s must meter $1.50, got ${got}`);
    else ok(`${label}: header-less 61s meters $1.50 (not $0 / not flat 30s $0.75)`);

    const zero = await runMusicCost({ njs, headers: { "x-cost": "0" }, fields });
    if (zero.node && zero.node.costUsd !== 0)
      fail(`${label}: x-cost:0 must book $0, got ${zero.node && zero.node.costUsd}`);
    else ok(`${label}: x-cost:0 wins over the catalog estimate`);
  }
}

/* ---- octet-stream playback MIME follows output_format (Yue2) ---------- */

{
  const fields = {
    model: YUE2_T2M,
    prompt: "cinematic choir",
    lyrics: "[Verse]\nhello",
    response_format: "wav",
  };
  const blobs = [];
  const builtIn = await runMusicCost({ njs: false, headers: {}, fields, onBlob: (t) => blobs.push(t) });
  if (builtIn.posts.length !== 1) fail(`play: Yue2 wav should POST once, got ${builtIn.posts.length}`);
  else if (builtIn.posts[0].body.output_format !== "wav")
    fail(`play: Yue2 wav POST missing output_format, got ${JSON.stringify(builtIn.posts[0].body)}`);
  else if (blobs[0] !== "audio/wav")
    fail(`play: octet-stream + output_format wav must tag audio/wav, got ${JSON.stringify(blobs)}`);
  else ok("play: octet-stream Yue2 wav playback is audio/wav (not audio/mpeg)");

  const njs = await runMusicCost({ njs: true, headers: {}, fields });
  const url = njs.node && njs.node.out && njs.node.out.audio;
  if (njs.posts.length !== 1) fail(`njs: Yue2 wav should POST once, got ${njs.posts.length}`);
  else if (njs.posts[0].body.output_format !== "wav")
    fail(`njs: Yue2 wav POST missing output_format, got ${JSON.stringify(njs.posts[0].body)}`);
  else if (typeof url !== "string" || !url.startsWith("data:audio/wav"))
    fail(`njs: octet-stream + output_format wav must be data:audio/wav, got ${JSON.stringify(url && url.slice(0, 40))}`);
  else ok("njs: octet-stream Yue2 wav playback is data:audio/wav");
}

if (failed) {
  console.error(`\n✗ ${failed} audio billing check(s) failed`);
  process.exit(1);
}
console.log("\n✓ audio price labels, Yue2 output_format, and header-less speech meter agree across editor, play, and njs");
