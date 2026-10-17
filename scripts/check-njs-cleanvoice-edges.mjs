#!/usr/bin/env node
// Leftover 🎧 Clean voice edges after #715 regenerated the njs-engine with
// cleanvoice. Editor/play twins are already pinned in check-clean-voice.mjs
// (#709 happy-path) and check-clean-voice-edges.mjs (#710 leftover
// URL/type/duration). This file pins the headless copy those toys never
// hit: RUNNERS.cleanvoice is a paid NanoGPT type; Node has no <audio> so
// unread metadata quotes CLEANVOICE_FALLBACK_SECS (60), not 0 / omitted;
// blank or whitespace model → elevenlabs/audio-isolation; data:/blob:
// never reach ctx.audio. Offline, zero API spend. New file so it does
// not collide with the editor/play checks or open leftover drafts.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");
const VENDOR = join(ROOT, "vendor", "njs-engine.js");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);
const check = (c, m) => { if (c) ok(m); else fail(m); };

function loadEngine(src, label) {
  const w = {};
  new Function("window", src)(w);
  const E = w.NanoodleEngine;
  if (!E || !E.RUNNERS || !E.NODE_TYPES) throw new Error(label + ": NanoodleEngine incomplete");
  return E;
}

function engines() {
  const out = [];
  const block = /<script id="njs-engine"[^>]*>\n([\s\S]*?)\n<\/script>/.exec(PLAY);
  if (block) out.push(["play.html #njs-engine", loadEngine(block[1], "play.html #njs-engine")]);
  else fail("play.html is missing the njs-engine script block");
  if (existsSync(VENDOR)) out.push(["vendor/njs-engine.js", loadEngine(readFileSync(VENDOR, "utf8"), "vendor/njs-engine.js")]);
  else fail("vendor/njs-engine.js is missing");
  return out;
}

const HOSTED = "https://cdn.example/voice.mp3";

for (const [label, E] of engines()) {
  console.log(label);
  check(E.NODE_TYPES.cleanvoice && E.NODE_TYPES.cleanvoice.network === true && typeof E.RUNNERS.cleanvoice === "function",
    label + ": cleanvoice is a registered paid runner");

  let sent = null;
  const out = await E.RUNNERS.cleanvoice(
    { fields: { model: "  " } },
    { audio: HOSTED },
    { audio: async (model, text, extra) => { sent = { model, text, extra }; return "https://cdn.example/out.mp3"; } }
  );
  check(out && out.audio === "https://cdn.example/out.mp3",
    label + ": runner returns the hosted result on the audio port");
  check(sent && sent.model === "elevenlabs/audio-isolation" && sent.text === "",
    label + ": whitespace model → ElevenLabs Audio Isolation (not a blank POST)");
  check(sent && sent.extra && sent.extra.audio === HOSTED && sent.extra.duration === 60,
    label + ": Node (no document) quotes 60 s — not 0, not omitted (the server re-measures)");

  for (const [kind, src] of [
    ["data:", "data:audio/mpeg;base64,AAAA"],
    ["blob:", "blob:https://nanoodle.com/1234"],
  ]) {
    let called = false, msg = "";
    try {
      await E.RUNNERS.cleanvoice({ fields: {} }, { audio: src }, {
        audio: async () => { called = true; return "u"; },
      });
    } catch (e) { msg = String(e && e.message); }
    check(!called && /hosted file/.test(msg),
      label + ": " + kind + " never reaches ctx.audio — no request, no spend");
  }
}

if (failed) { console.error("\n✗ check-njs-cleanvoice-edges: " + failed + " failure(s)"); process.exit(1); }
console.log("✓ check-njs-cleanvoice-edges — njs Node fallback / default model / refuse-before-send hold");
