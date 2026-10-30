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
function lift(file) {
  const s = readFileSync(join(ROOT, file), "utf8");
  const i = s.indexOf("function avatarAudioEstSeconds(");
  if (i < 0) { ok(false, `${file}: avatarAudioEstSeconds missing`); return null; }
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
if (ed) ok(/if\(n\.type==="lipsync"\)\{[\s\S]{0,900}avatarAudioEstSeconds\(/.test(ed.src.slice(ed.src.indexOf("function nodeUnitUsd(n)"))), "index.html nodeUnitUsd doesn't price lipsync off avatarAudioEstSeconds");
if (pl) ok(/if\(n\.type==="lipsync" && STATE && STATE\.graph\)\{[\s\S]{0,900}avatarAudioEstSeconds\(/.test(pl.src.slice(pl.src.indexOf("async function nodeUnitUsdPlay(n)"))), "play.html nodeUnitUsdPlay doesn't price lipsync off avatarAudioEstSeconds");
if (fails) { console.error(`check-avatar-audio-estimate: ${fails} failure(s)`); process.exit(1); }
console.log("check-avatar-audio-estimate: ok — avatar/lip-sync estimates bill the wired audio's seconds (13.1 s → 14 s → $0.56)");
