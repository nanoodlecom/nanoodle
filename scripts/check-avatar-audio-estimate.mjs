#!/usr/bin/env node
// Guard: the 🎬 Avatar / lip-sync run-cost estimate prices the WIRED AUDIO's length, not the 5 s video
// default. The creator-ad example's real run spoke a 13.1 s MiniMax voice and LongCat billed 14 s × $0.04
// = $0.56, while the chip said 5 s × $0.04 = $0.20. Lifts avatarAudioEstSeconds out of index.html (editor)
// and play.html (player/export), checks the twins match, runs the cases, and checks both estimators
// apply it to the lipsync node.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.error("FAIL: " + m); } };
function lift(file, name = "avatarAudioEstSeconds") {
  const s = readFileSync(join(ROOT, file), "utf8");
  const i = s.indexOf(`function ${name}(`);
  if (i < 0) { ok(false, `${file}: ${name} missing`); return null; }
  let d = 0, j = s.indexOf("{", i);
  for (; j < s.length; j++) { if (s[j] === "{") d++; else if (s[j] === "}" && --d === 0) break; }
  return { src: s, fn: s.slice(i, j + 1).split("\n").map(l => l.trim()).join("\n") };
}
const ed = lift("index.html"), pl = lift("play.html");
if (ed && pl) {
  ok(ed.fn === pl.fn, "index.html and play.html avatarAudioEstSeconds differ (twin drift)");
  const est = new Function("EST", ed.fn + "\nreturn avatarAudioEstSeconds;")({ ttsChars: 600 });
  const tts = (prompt) => ({ type: "tts", fields: prompt ? { prompt } : {} });
  const script = "Okay so this little clay pot waters my basil for me. You fill the base, the terracotta wicks it up, and I genuinely forgot about it for a week. Handmade, tiny, and my herbs have never looked this good.";
  ok(est(null, "", null) === null, "no audio wired → null (model default)");
  ok(est(tts(), "", 13.1) === 14, "measured 13.1 s → 14 s billed");
  ok(Math.abs(est(tts(), "", 13.1) * 0.04 - 0.56) < 1e-9, "measured 13.1 s × $0.04/s → $0.56 (the real run)");
  ok(est({ type: "music", fields: { duration: "20" } }, "", null) === 20, "source duration knob → its seconds");
  const w = est(tts(), script, null), usd = w * 0.04;
  ok(w >= 12 && w <= 15 && usd >= 0.48 && usd <= 0.60, `~38-word script → ${w}s / $${usd.toFixed(2)} (want 12–15 s, ≈$0.52–0.56)`);
  ok(est(tts(script), "", null) === w, "Speech node's own typed text counts the same as wired text");
  ok(est(tts(), "", null) === 40, "unknown text → the Speech chip's 600-char assumption at 15 chars/s");
  ok(est({ type: "aupload", fields: {} }, "", null) === null, "unmeasured upload with no knob → null");
  ok(est(tts(), "", null) * 0.04 > 0.2, "never back to the old 5 s × $0.04 = $0.20 once a Speech node is wired");
}
// LongCat's billing limits are on DURATION, not dollars: NanoGPT's catalog (GET /api/v1/video-models,
// 2026-10-30) gives longcat-avatar-1.5 pricing.per_second_by_resolution {480p: 0.04, 720p: 0.08} with
// minimum_billable_duration 3 and maximum_billable_duration 30 ("rounded up to whole seconds, then
// clamped"). So 480p bills $0.12–$1.20 and 720p $0.24–$2.40. Both twins clamp the seconds, then price.
const edC = lift("index.html", "avatarClampSecs"), plC = lift("play.html", "avatarClampSecs");
if (edC && plC) {
  ok(edC.fn === plC.fn, "index.html and play.html avatarClampSecs differ (twin drift)");
  const clampS = new Function(edC.fn + "\nreturn avatarClampSecs;")();
  const est = ed && new Function("EST", ed.fn + "\nreturn avatarAudioEstSeconds;")({ ttsChars: 600 });
  const lc = "longcat-avatar-1.5", tts = { type: "tts", fields: {} };
  const P = { per_second_by_resolution: { "480p": 0.04, "720p": 0.08 }, minimum_billable_duration: 3, maximum_billable_duration: 30, default_resolution: "480p" };
  const usd = (secs, res, pricing = P) => clampS(lc, secs, pricing) * P.per_second_by_resolution[res];
  const cases = [
    // [label, voice seconds (already whole), resolution, expected $]
    ["minimum (0.5 s voice → 1 s → 3 s billed)", est(tts, "", 0.5), "480p", 0.12],
    ["minimum (0.5 s voice → 1 s → 3 s billed)", est(tts, "", 0.5), "720p", 0.24],
    ["mid (13.1 s voice → 14 s billed)", est(tts, "", 13.1), "480p", 0.56],
    ["mid (13.1 s voice → 14 s billed)", est(tts, "", 13.1), "720p", 1.12],
    ["maximum (30 s voice)", 30, "480p", 1.20],
    ["maximum (30 s voice)", 30, "720p", 2.40],
    ["over the maximum (40 s unknown-script assumption)", est(tts, "", null), "480p", 1.20],
    ["over the maximum (40 s unknown-script assumption)", est(tts, "", null), "720p", 2.40],
  ];
  for (const [label, secs, res, want] of cases) {
    const got = usd(secs, res);
    ok(Math.abs(got - want) < 1e-9, `${res} ${label}: got $${got.toFixed(2)}, want $${want.toFixed(2)}`);
  }
  ok(Math.abs(usd(30, "720p") - 2.40) < 1e-9 && Math.abs(usd(30, "720p") - 1.20) > 0.5, "720p ceiling is $2.40, not the 480p $1.20");
  ok(clampS(lc, 2, {}) === 3 && clampS(lc, 31, null) === 30, "longcat-avatar-1.5 falls back to 3–30 s when the catalog omits the limits");
  ok(clampS("longcat-avatar", 100, { minimum_billable_duration: 3, maximum_billable_duration: 120 }) === 100, "LongCat Avatar 1.0 uses its own 120 s ceiling from the catalog");
  ok(clampS("omnihuman-1.5", 1, {}) === 1 && clampS("omnihuman-1.5", 400, null) === 400, "avatar models with no billable-duration limits are not clamped");
  ok(clampS(lc, null, P) === null, "no estimate stays no estimate");
}
if (ed) ok(/if\(n\.type==="lipsync"\)\{[\s\S]{0,900}duration: avatarClampSecs\(fields\.model, secs, it\.pricing\)/.test(ed.src.slice(ed.src.indexOf("function nodeUnitUsd(n)"))), "index.html lipsync estimate doesn't clamp the billable seconds before pricing");
if (pl) ok(/if\(n\.type==="lipsync" && STATE && STATE\.graph\)\{[\s\S]{0,900}duration: avatarClampSecs\(f\.model, secs, pricing\)/.test(pl.src.slice(pl.src.indexOf("async function nodeUnitUsdPlay(n)"))), "play.html lipsync estimate doesn't clamp the billable seconds before pricing");
for (const [f, x] of [["index.html", ed], ["play.html", pl]]) if (x) ok(!/avatarClampUsd/.test(x.src), `${f}: the old fixed-dollar avatarClampUsd is back`);
if (ed) ok(/if\(n\.type==="lipsync"\)\{[\s\S]{0,900}avatarAudioEstSeconds\(/.test(ed.src.slice(ed.src.indexOf("function nodeUnitUsd(n)"))), "index.html nodeUnitUsd doesn't price lipsync off avatarAudioEstSeconds");
if (pl) ok(/if\(n\.type==="lipsync" && STATE && STATE\.graph\)\{[\s\S]{0,900}avatarAudioEstSeconds\(/.test(pl.src.slice(pl.src.indexOf("async function nodeUnitUsdPlay(n)"))), "play.html nodeUnitUsdPlay doesn't price lipsync off avatarAudioEstSeconds");
if (fails) { console.error(`check-avatar-audio-estimate: ${fails} failure(s)`); process.exit(1); }
console.log("check-avatar-audio-estimate: ok — avatar/lip-sync estimates bill the wired audio's seconds (13.1 s → 14 s → $0.56), clamped to LongCat's 3–30 billable seconds (480p $0.12–$1.20, 720p $0.24–$2.40)");
