#!/usr/bin/env node
// Leftover 🎧 Clean voice edges after #709.
// That PR shipped happy-path source precedence (audio > video > link),
// video-as-is, trim + video-ext, empty refuse, blob:/data: refuse,
// duration 0.6–3600 + fallback, extra shape, est 6/30, OGG / download
// reword, AbortError / unrelated pass, default model, measured duration,
// unread → 60 s, blob never reaches send, and 202 billing wiring.
// This file pins leftover URL/type/duration/error those toys never hit:
// whitespace-only ports, non-string ports, javascript:/file:/ftp: refuse
// before send, http:// still hosted, wired audio with a .mp4 name stays
// audio, case-insensitive video ext, seconds 0 / -1 / NaN → fallback,
// exact 0.6 / 3600 stay, estSeconds 0 / garbage → 30, "public http(s)
// source" + "verify the source duration" (no "audio") reword, null/empty
// error pass-through. Offline, zero API spend. New file so it does not
// collide with check-clean-voice.mjs.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);
const check = (c, m) => { if (c) ok(m); else fail(m); };

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

function load(block, label) {
  const ctx = {
    console, setTimeout,
    document: {
      createElement: () => ({
        removeAttribute() {}, load() {},
        set src(v) { this._src = v; setTimeout(() => this.onerror && this.onerror(), 0); },
      }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    block +
      "\n;globalThis.__c = { cleanVoiceSource, cleanVoiceSeconds, cleanVoiceExtra, cleanVoiceEstSeconds, cleanVoiceError, cleanVoiceRun, CLEANVOICE_DEFAULT_MODEL, CLEANVOICE_FALLBACK_SECS };",
    ctx,
    { filename: label + "#cleanvoice-edges" }
  );
  return ctx.__c;
}

const msgOf = (fn) => { try { fn(); return ""; } catch (e) { return String(e && e.message); } };

const IDX_BLOCK = twinBlock(IDX, "index.html");
const PLAY_BLOCK = twinBlock(PLAY, "play.html");

for (const [label, block] of [["index.html", IDX_BLOCK], ["play.html", PLAY_BLOCK]]) {
  console.log(label);
  const C = load(block, label);
  const A = "https://cdn.example/a.mp3";
  const V = "https://cdn.example/v.mp4";

  check(/no audio/.test(msgOf(() => C.cleanVoiceSource({ audio: "   ", video: "\t" }, { url: "  " }))),
    label + ": whitespace-only audio / video / url is empty (not a hosted file)");
  check(/no audio/.test(msgOf(() => C.cleanVoiceSource({ audio: 1, video: { href: A } }, {}))),
    label + ": non-string audio / video ports are ignored");
  const wsLink = C.cleanVoiceSource({ audio: "  " }, { url: "  " + A + "  " });
  check(wsLink.url === A && wsLink.video === false,
    label + ": whitespace audio falls through to a trimmed pasted audio link");

  check(/hosted file/.test(msgOf(() => C.cleanVoiceSource({ audio: "javascript:alert(1)" }, {}))),
    label + ": javascript: is refused before any request");
  check(/hosted file/.test(msgOf(() => C.cleanVoiceSource({ audio: "file:///tmp/a.mp3" }, {}))),
    label + ": file: is refused before any request");
  check(/hosted file/.test(msgOf(() => C.cleanVoiceSource({}, { url: "ftp://files.example/a.mp3" }))),
    label + ": ftp: is refused before any request");
  const http = C.cleanVoiceSource({}, { url: "http://cdn.example/a.mp3" });
  check(http.url === "http://cdn.example/a.mp3" && http.video === false,
    label + ": http:// (not only https) is a hosted file");

  const audioMp4 = C.cleanVoiceSource({ audio: "https://cdn.example/clip.mp4" }, {});
  check(audioMp4.url.endsWith("clip.mp4") && audioMp4.video === false,
    label + ": a wired audio port stays audio even when the URL looks like a video");
  for (const ext of [".MOV", ".MkV", ".AVI", ".m4v", ".WEBM"]) {
    const s = C.cleanVoiceSource({}, { url: "https://pod.example/ep" + ext + "?x=1" });
    check(s.video === true, label + ": pasted " + ext + " (+ query) reads as video");
  }
  const audioExt = C.cleanVoiceSource({}, { url: "https://pod.example/ep.WAV#t=1" });
  check(audioExt.video === false, label + ": pasted .WAV with a hash stays audio");

  check(C.cleanVoiceSeconds(0) === C.CLEANVOICE_FALLBACK_SECS
    && C.cleanVoiceSeconds(-4) === C.CLEANVOICE_FALLBACK_SECS
    && C.cleanVoiceSeconds(NaN) === C.CLEANVOICE_FALLBACK_SECS,
    label + ": duration 0 / negative / NaN → the fallback quote");
  check(C.cleanVoiceSeconds(0.6) === 0.6 && C.cleanVoiceSeconds(3600) === 3600,
    label + ": duration 0.6 s and 3600 s stay (the clamp edges)");
  check(C.cleanVoiceEstSeconds({ duration: "0" }) === 30
    && C.cleanVoiceEstSeconds({ duration: "-5" }) === 30
    && C.cleanVoiceEstSeconds({ duration: "abc" }) === 30
    && C.cleanVoiceEstSeconds({ duration: "  " }) === 30,
    label + ": estimate 0 / negative / garbage duration → 30 s (not 0, not fallback 60)");

  check(/public https link/.test(C.cleanVoiceError(new Error("source must be a public http(s) source URL")).message),
    label + ": NanoGPT 'public http(s) source' is reworded at the node");
  check(/OGG/.test(C.cleanVoiceError(new Error("Unable to verify the source duration.")).message),
    label + ": 'verify the source duration' (no 'audio') still names the formats that work");
  check(C.cleanVoiceError(null) == null && C.cleanVoiceError("") === "",
    label + ": null / empty error passes through (does not invent a message)");

  let called = false, msg = "";
  try {
    await C.cleanVoiceRun("", { audio: "javascript:void(0)" }, {}, async () => { called = true; return "u"; });
  } catch (e) { msg = e.message; }
  check(!called && /hosted file/.test(msg),
    label + ": javascript: never reaches send() — no request, no spend");
}

if (failed) { console.error("\n✗ check-clean-voice-edges: " + failed + " failure(s)"); process.exit(1); }
console.log("✓ check-clean-voice-edges — leftover URL / type / duration / error edges hold");
