#!/usr/bin/env node
/**
 * gen-demo-narration.mjs — render the signed-out sample narration (demo-narration.mp3).
 *
 * WHY THIS EXISTS
 * ---------------
 * A signed-out visitor can Run the starter graph and hear a real canned narration:
 * the starter's 🗣️ Speech node serves demo-narration.mp3 (see DEMO_CTX.genAudio in
 * index.html). The narration has to be an HONEST sample: it is the starter's own TTS
 * model reading DEMO_LLM_TEXT — the exact brief the canned 🧠 LLM node shows.
 *
 * PROVENANCE OF THE COMMITTED FILE
 *   model       elevenlabs/eleven-v4-turbo, voice "Sarah", response_format mp3
 *   text        DEMO_LLM_TEXT verbatim (the brief from the winning live run —
 *               the words did not change when the voice did)
 *   captured    standalone on 2026-11-07 via this script's endpoint flow, after the
 *               starter's Speech pin moved off gpt-4o-mini-tts ("really old").
 *               Measured cost 0.041344 USD balance-true for this 608-char text
 *               (catalog price 0.068 USD / 1k chars). A google/gemini-3.8-flash-tts
 *               take (voice "Sulafat") was rendered the same day for comparison —
 *               WAV-only on the speech endpoint and a slower 47.5 s read — and not used.
 *   result      MP3, 128 kbps, ~42.8 s, 686 KB
 *
 * THIS SCRIPT SPENDS REAL MONEY (a few tenths of a cent). It is hand-run only.
 * No hook, no CI job calls it. Use it to regenerate an equivalent narration
 * standalone: it reads DEMO_LLM_TEXT out of index.html so the spoken text can
 * never drift from the brief the visitor sees.
 *
 * USAGE
 *   NANOGPT_API_KEY=<redacted> node scripts/gen-demo-narration.mjs
 *
 * OPTIONS (env)
 *   MODEL   tts model id   (default elevenlabs/eleven-v4-turbo — the starter's Speech model)
 *   VOICE   voice name     (default Sarah — the starter's voice)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "demo-narration.mp3");
const NANOGPT = "https://nano-gpt.com";
const MODEL = process.env.MODEL || "elevenlabs/eleven-v4-turbo";
const VOICE = process.env.VOICE || "Sarah";
const SIZE_CAP = 2 * 1024 * 1024;          // same discipline as gen-demo-clip: visitors fetch this

const die = (msg) => { console.error("✗ " + msg); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY = process.env.NANOGPT_API_KEY;
if (!KEY) die("NANOGPT_API_KEY is not set");

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const m = html.match(/const DEMO_LLM_TEXT = "((?:[^"\\]|\\.)*)";/);
if (!m) die("DEMO_LLM_TEXT not found in index.html");
const text = JSON.parse('"' + m[1] + '"');
console.log(`narrating ${text.length} chars with ${MODEL} / ${VOICE}…`);

const headers = { Authorization: <redacted> ${KEY}`, "x-api-key": KEY, "Content-Type": "application/json" };
const resp = await fetch(`${NANOGPT}/api/v1/audio/speech`, {
  method: "POST", headers,
  body: JSON.stringify({ model: MODEL, input: text, voice: VOICE, response_format: "mp3" }),
});
if (!resp.ok) die(`speech request failed: ${resp.status} ${await resp.text()}`);

let bytes;
const ctype = (resp.headers.get("content-type") || "").toLowerCase();
if (ctype.includes("application/json")) {
  const j = await resp.json();
  const data = (j.data && typeof j.data === "object") ? j.data : {};
  let url = j.url || j.audioUrl || data.url || data.audioUrl;
  const runId = j.runId || j.id || data.runId || data.id;
  // Async providers answer with a run id — poll the status endpoint like the engines do.
  for (let i = 0; !url && runId && i < 60; i++) {
    await sleep(3000);
    const st = await (await fetch(`${NANOGPT}/api/tts/status?runId=${encodeURIComponent(runId)}`, { headers })).json().catch(() => ({}));
    const sd = (st.data && typeof st.data === "object") ? st.data : {};
    url = st.url || st.audioUrl || sd.url || sd.audioUrl;
    if (st.status && /fail|error/i.test(String(st.status))) die(`speech run failed: ${JSON.stringify(st).slice(0, 200)}`);
  }
  if (!url) die(`no audio url in response: ${JSON.stringify(j).slice(0, 200)}`);
  const dl = await fetch(url);
  if (!dl.ok) die(`audio download failed: ${dl.status}`);
  bytes = Buffer.from(await dl.arrayBuffer());
} else {
  bytes = Buffer.from(await resp.arrayBuffer());
}
if (!bytes.length) die("empty audio response");
if (bytes.length > SIZE_CAP) die(`narration is ${bytes.length} bytes — over the ${SIZE_CAP} cap; shorten DEMO_LLM_TEXT instead of raising it`);
fs.writeFileSync(OUT, bytes);
console.log(`✓ wrote ${OUT} (${bytes.length} bytes)`);
