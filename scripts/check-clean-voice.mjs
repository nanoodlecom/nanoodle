#!/usr/bin/env node
// Offline guard for the 🎧 Clean voice node (NanoGPT noise_reduction audio models:
// ElevenLabs Audio Isolation, VEED Clean Audio — POST /api/v1/audio/speech → 202 + runId →
// /api/tts/status → hosted audio).
//
// Lifts the SHIPPED clean-voice twin block out of index.html and play.html, asserts the two
// copies match after trim (and play's has no backticks — it lives in String.raw RUNTIME_JS),
// then runs it in node:vm with a stub <audio>/<video> element and a fake send(): source
// precedence (audio > video > pasted link), the hosted-only refusal for blob:/data: sources
// BEFORE any request, the duration quote NanoGPT requires, the error rewording, and the run-cost
// math against the editor's real audioUnitUsd. Also pins the wiring around it in both runtimes.
// No browser, no network, no spend.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

const failures = [];
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { console.error("  ✗ " + m); failures.push(m); } };

function twinBlock(src, label) {
  const start = src.search(/\/\* =+\n\s*🎧 CLEAN VOICE — strip background noise/);
  if (start < 0) throw new Error(label + ": clean-voice twin header not found");
  const runAt = src.indexOf("async function cleanVoiceRun(", start);
  if (runAt < 0) throw new Error(label + ": cleanVoiceRun not found");
  let depth = 0;
  for (let j = src.indexOf("{", runAt); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(label + ": could not brace-match cleanVoiceRun");
}
function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error(name + " not found");
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("could not brace-match " + name);
}
const norm = (s) => s.split("\n").map((l) => l.trim()).join("\n");
const IDX_BLOCK = twinBlock(IDX, "index.html");
const PLAY_BLOCK = twinBlock(PLAY, "play.html");

console.log("clean-voice twin");
ok(norm(IDX_BLOCK) === norm(PLAY_BLOCK), "index.html and play.html carry the same clean-voice block (after trim)");
ok(!PLAY_BLOCK.includes("`") && !PLAY_BLOCK.includes("${"), "play.html copy has no backticks or ${ (RUNTIME_JS is a String.raw template)");

function load(block, label, mediaSecs) {
  const made = [];
  const ctx = {
    console, setTimeout,
    document: { createElement: (tag) => {
      const el = { tag, removeAttribute() {}, load() {},
        set src(v) { this._src = v; made.push(this); setTimeout(() => {
          if (mediaSecs == null) this.onerror && this.onerror(); else { this.duration = mediaSecs; this.onloadedmetadata && this.onloadedmetadata(); }
        }, 0); } };
      return el;
    } },
  };
  vm.createContext(ctx);
  vm.runInContext(block + "\n;globalThis.__c = { cleanVoiceSource, cleanVoiceSeconds, cleanVoiceExtra, cleanVoiceEstSeconds, cleanVoiceError, cleanVoiceRun, CLEANVOICE_DEFAULT_MODEL, CLEANVOICE_FALLBACK_SECS };", ctx, { filename: label + "#cleanvoice" });
  return { C: ctx.__c, made };
}
const msgOf = (fn) => { try { fn(); return ""; } catch (e) { return String(e && e.message); } };

const audioUnitUsd = (() => {
  const c = { EST: { ttsChars: 600, audioSeconds: 30, sttMinutes: 1 } };
  vm.createContext(c);
  const numLine = IDX.match(/^const _num = .*$/m);
  if (!numLine) throw new Error("_num not found");
  vm.runInContext("const EST = globalThis.EST;\n" + numLine[0] + "\n" + extractFn(IDX, "audioUnitUsd") + "\nglobalThis.__f = audioUnitUsd;", c);
  return c.__f;
})();
const EL = { per_second: 0.002016666666666667, minimum: 0.00121, currency: "USD" };            // live catalog, 2026-10-09
const VEED = { per_billing_interval: 0.01375, billing_interval_seconds: 60, minimum: 0.01375, currency: "USD" };

for (const [label, block] of [["index.html", IDX_BLOCK], ["play.html", PLAY_BLOCK]]) {
  console.log(label);
  const { C } = load(block, label, 6.05);
  const A = "https://cdn.example/a.mp3", V = "https://cdn.example/v.mp4";
  ok(C.cleanVoiceSource({ audio: A, video: V }, { url: "https://x/y.mp3" }).url === A, "wired audio wins over a wired video and the pasted link");
  const sv = C.cleanVoiceSource({ video: V }, {});
  ok(sv.url === V && sv.video === true, "a wired video rides as-is (NanoGPT takes video URLs; the voice comes back as audio)");
  const sl = C.cleanVoiceSource({}, { url: "  https://pod.example/ep12.MP4?x=1 " });
  ok(sl.url === "https://pod.example/ep12.MP4?x=1" && sl.video === true, "the pasted link is trimmed; a video extension reads as video");
  ok(C.cleanVoiceSource({}, { url: "https://pod.example/ep12.mp3" }).video === false, "an audio link reads as audio");
  ok(/no audio/.test(msgOf(() => C.cleanVoiceSource({}, {}))), "nothing wired and no link → a clear 'no audio' error");
  ok(/hosted file/.test(msgOf(() => C.cleanVoiceSource({ audio: "blob:https://nanoodle.com/1234" }, {}))), "a blob: clip (Trim, Extract audio, Speech) is refused before any request");
  ok(/hosted file/.test(msgOf(() => C.cleanVoiceSource({ audio: "data:audio/mpeg;base64,AAAA" }, {}))), "a data: upload is refused before any request (NanoGPT rejects it)");
  ok(C.cleanVoiceSeconds(6.0532) === 6.05 && C.cleanVoiceSeconds(0.1) === 0.6 && C.cleanVoiceSeconds(99999) === 3600, "duration quote is rounded and clamped to NanoGPT's 0.6–3600 s");
  ok(C.cleanVoiceSeconds(null) === C.CLEANVOICE_FALLBACK_SECS && C.cleanVoiceSeconds(Infinity) === C.CLEANVOICE_FALLBACK_SECS, "unknown length → the fallback quote (the server re-measures before billing)");
  ok(JSON.stringify(C.cleanVoiceExtra(A, 23.56)) === JSON.stringify({ audio: A, duration: 23.56 }), "request extra = { audio, duration } (both models accept `audio`)");
  ok(C.cleanVoiceEstSeconds({ duration: "6" }) === 6 && C.cleanVoiceEstSeconds({}) === 30 && C.cleanVoiceEstSeconds(null) === 30, "estimate seconds: the wired node's duration knob, else 30 s");
  ok(/OGG/.test(C.cleanVoiceError(new Error("Unable to verify the source audio duration for ElevenLabs Audio Isolation.")).message), "unverifiable length (e.g. OGG) → names the formats that work");
  ok(/must be public/.test(C.cleanVoiceError(new Error("Unable to download the VEED Clean Audio source audio.")).message), "download failure → the link must be public");
  const ab = new Error("x"); ab.name = "AbortError";
  ok(C.cleanVoiceError(ab) === ab, "Stop (AbortError) passes through untouched");
  const other = new Error("402: insufficient balance");
  ok(C.cleanVoiceError(other) === other, "unrelated errors pass through untouched");

  let sent = null;
  const out = await C.cleanVoiceRun("", { video: V }, {}, async (model, extra) => { sent = { model, extra }; return "https://cdn.cachegalaxy.com/predictions/x/1.mp3"; });
  ok(out.audio === "https://cdn.cachegalaxy.com/predictions/x/1.mp3", "run returns the hosted result on the audio port");
  ok(sent && sent.model === C.CLEANVOICE_DEFAULT_MODEL && sent.model === "elevenlabs/audio-isolation", "blank model → ElevenLabs Audio Isolation");
  ok(sent && sent.extra.audio === V && sent.extra.duration === 6.05, "the measured media length becomes the duration quote");
  const { C: C2 } = load(block, label, null);
  let sent2 = null;
  await C2.cleanVoiceRun("veed/clean-audio", { audio: A }, {}, async (m, e) => { sent2 = { m, e }; return "u"; });
  ok(sent2.m === "veed/clean-audio" && sent2.e.duration === 60, "unreadable metadata → 60 s quote, picked model kept");
  let called = false, msg = "";
  try { await C2.cleanVoiceRun("", { audio: "blob:x" }, {}, async () => { called = true; return "u"; }); } catch (e) { msg = e.message; }
  ok(!called && /hosted file/.test(msg), "a local clip never reaches send() — no request, no spend");
  try { await C2.cleanVoiceRun("", { audio: A }, {}, async () => { throw new Error("Unable to download the ElevenLabs Audio Isolation source audio."); }); } catch (e) { msg = e.message; }
  ok(/must be public/.test(msg), "NanoGPT's 400 is reworded at the node");
}

console.log("cost");
const near = (a, b) => Math.abs(a - b) < 1e-9;
ok(near(audioUnitUsd(EL, undefined, 6), 0.0121), "ElevenLabs: 6 s ≈ $0.0121 (per second)");
ok(near(audioUnitUsd(EL, undefined, 23.562448979591835), 0.047517605442176876), "ElevenLabs: 23.56 s matches the live bill ($0.04752)");
ok(near(audioUnitUsd(EL, undefined, 0.3), 0.00121), "ElevenLabs: floored at the $0.00121 minimum");
ok(near(audioUnitUsd(VEED, undefined, 23.5), 0.01375) && near(audioUnitUsd(VEED, undefined, 61), 0.0275), "VEED: per started minute ($0.01375 for 23.5 s, two minutes for 61 s)");
ok(/kind==="audio" && t\.modelFilter==="denoise"[\s\S]{0,400}cleanVoiceEstSeconds\(src && src\.fields\)/.test(IDX), "editor run-cost chip meters the wired source's duration");
ok(/n\.type==="cleanvoice"[\s\S]{0,400}cleanVoiceEstSeconds\(src && src\.fields\)/.test(PLAY), "app run-cost chip meters it the same way");
ok(/ct\.includes\("application\/json"\)\)\{\s*const j = await r\.json\(\); accrue\(j, undefined, r\);/.test(IDX), "editor bills the real cost from the 202 reply (accrue(j) before polling)");
ok(/ct\.includes\("application\/json"\)\)\{\s*const j = await r\.json\(\); onCost\(costWithHeaders\(j, r\)\);/.test(PLAY), "app bills the real cost from the 202 reply");

console.log("wiring");
ok(/const denoise = !dead && !!c\.noise_reduction;/.test(IDX) && /stt, denoise, pricing:p/.test(IDX), "editor catalog flags noise_reduction models as denoise (no model ids)");
ok(/cleanvoice: \{[\s\S]{0,400}modelKind:"audio", modelFilter:"denoise",[\s\S]{0,200}inputs:\[\{name:"audio", type:"audio"\},\{name:"video", type:"video"\}\]/.test(IDX), "editor node: audio model picker filtered to denoise; audio + video in");
ok(/case "cleanvoice": return !!c\.noise_reduction;/.test(PLAY), "app model swap list mirrors the denoise filter");
ok(/cleanvoice:"audio",\s*\};/.test(PLAY), "app settings know Clean voice picks an audio model");
for (const [label, src] of [["index.html", IDX], ["play.html", PLAY]]) {
  ok(/\|transcribe\|cleanvoice\)\$\/\.test\(type\)/.test(src), label + ": Clean voice is a paid NanoGPT type (demo mode, sign-in gating)");
  ok(/cleanvoice:\["🎧","Clean voice"\]/.test(src), label + ": card meta");
}
ok(/cleanvoice: \{\s*em:"🎧", title:"Clean voice",[\s\S]{0,300}cleanVoiceRun\(mdl\(n\), inp, n\.fields/.test(PLAY), "app runtime runs the shared cleanVoiceRun");
// noise_reduction models must not leak into the other audio pickers (they need a source file)
const normAudio = IDX.slice(IDX.indexOf("function normAudio("), IDX.indexOf("function normAudio(") + 9000);
ok(/const gen = usable && !dead && mod\.startsWith\("text"\)/.test(normAudio), "Music/Speech stay text-driven — an audio→audio cleaner can't appear there");
// the bridge already allows the two endpoints this node hits
const bridge = (() => { const c = {}; vm.createContext(c); vm.runInContext(extractFn(PLAY, "classifyBridgePath") + "\nglobalThis.__b = classifyBridgePath;", c); return c.__b; })();
ok(bridge("/api/v1/audio/speech") === "charge" && bridge("/api/tts/status") === "poll", "shared-app bridge: submit is metered as a charge, status polling is free");

if (failures.length) { console.error("\n✗ check-clean-voice: " + failures.length + " failure(s)"); process.exit(1); }
console.log("✓ check-clean-voice — twin block, hosted-only guard, duration quote, cost and wiring all hold");
