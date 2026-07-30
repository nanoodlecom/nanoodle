#!/usr/bin/env node
/**
 * gen-demo-clip.mjs — render the signed-out sample clip (demo-sample.mp4).
 *
 * WHY THIS EXISTS
 * ---------------
 * A signed-out visitor can Run the starter graph and see real canned results (DEMO_LLM_TEXT +
 * demo-sample.jpg). index.html also covers ONE extension of that graph: an 📽️ Image→Video node
 * hung off the image output. That node serves demo-sample.mp4.
 *
 * The clip has to be an HONEST sample. It is a real image→video generation from the SHIPPED
 * demo-sample.jpg, not a pan-and-scan of the still. This script is how it was made, so the asset
 * is reproducible and its provenance lives in the repo.
 *
 * THIS SCRIPT SPENDS REAL MONEY. It is hand-run only. No hook, no CI job calls it.
 * At the defaults below the generation costs about 0.12 USD.
 *
 * USAGE
 *   NANOGPT_API_KEY=... node scripts/gen-demo-clip.mjs            # dry run: prints the plan + price
 *   NANOGPT_API_KEY=... node scripts/gen-demo-clip.mjs --yes      # generate, encode, write the file
 *
 * OPTIONS (env)
 *   MODEL       video model id            (default below)
 *   RESOLUTION  480p | 720p | 1080p       (default below)
 *   DURATION    seconds, 2..12            (default below)
 *   KEEP_RAW=1  also keep the provider's original download next to the encoded file
 *
 * PROVENANCE OF THE COMMITTED FILE
 *   model       bytedance-seedance-v1-pro-fast (SeeDance V1 Pro Fast)
 *   source      demo-sample.jpg (the shipped still, unmodified — frame 0 of the clip IS that still)
 *   settings    720p, 5s, 16:9
 *   cost        0.12 USD, metered by NanoGPT on 2026-07-28 (runId vid_ms5jr1es67cfaa050a06)
 *   encode      H.264 High, no audio track, faststart (see FFMPEG_ARGS)
 *   result      640x360, 24 fps, 5.04 s, 223 KB (2828 KB before the encode)
 *
 * OUTPUT SIZE
 *   Signed-out visitors fetch this file, so keep it well under 2 MB. The ffmpeg step below
 *   re-encodes to 640px wide at CRF 30 and the script REFUSES to write a file over SIZE_CAP.
 *   If a future model returns something bigger, lower the width or raise the CRF — do not raise
 *   the cap.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC_IMAGE = path.join(ROOT, "demo-sample.jpg");
const OUT_CLIP = path.join(ROOT, "demo-sample.mp4");

const NANOGPT = "https://nano-gpt.com";
const MODEL = process.env.MODEL || "bytedance-seedance-v1-pro-fast";
const RESOLUTION = process.env.RESOLUTION || "720p";
const DURATION = process.env.DURATION || "5";
const ASPECT = "16:9";
const SIZE_CAP = 2 * 1024 * 1024;          // 2 MB — the honest ceiling for an asset every visitor may fetch
const POLL_MS = 5000;
const POLL_LIMIT = 180;                    // 15 minutes, then give up rather than poll forever

// The motion the still cannot show. Deliberately gentle: the sample must read as "the shop is
// alive", not as a different scene, because the visitor sees the still one node upstream.
const PROMPT = "Gentle cinematic push-in on the ramen shop window. Steam rises and curls from the "
  + "bowl. Rain streaks down the glass and ripples the puddles. The lanterns and neon signs flicker "
  + "softly. Subtle handheld drift, no cuts, no camera whip.";

// 640px wide keeps the node preview crisp and the file small. No audio track: the sample models
// used here render silent clips, and a silent track would only add bytes.
const FFMPEG_ARGS = (input, output) => ([
  "-y", "-i", input,
  "-an",
  "-vf", "scale=640:-2:flags=lanczos",
  "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "30",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  output,
]);

const die = (msg) => { console.error("✗ " + msg); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY = process.env.NANOGPT_API_KEY;
if (!KEY) die("NANOGPT_API_KEY is not set");
if (!fs.existsSync(SRC_IMAGE)) die(`missing source still: ${SRC_IMAGE}`);

// Catalog price for the exact settings, so the operator sees the bill before agreeing to it.
async function quote() {
  const r = await fetch(`${NANOGPT}/api/v1/video-models`, { headers: { Authorization: "Bearer " + KEY } });
  if (!r.ok) return null;
  const m = ((await r.json()).data || []).find((x) => x.id === MODEL);
  const per = m?.pricing?.per_second_by_resolution?.[RESOLUTION];
  return (per == null) ? null : per * Number(DURATION);
}

const est = await quote();
console.log(`model       ${MODEL}`);
console.log(`source      ${path.relative(ROOT, SRC_IMAGE)}`);
console.log(`settings    ${RESOLUTION}, ${DURATION}s, ${ASPECT}`);
console.log(`estimate    ${est == null ? "unknown (model not in the catalog)" : "$" + est.toFixed(3)}`);
console.log(`output      ${path.relative(ROOT, OUT_CLIP)} (cap ${(SIZE_CAP / 1024 / 1024).toFixed(0)} MB)`);

if (!process.argv.includes("--yes")) {
  console.log("\ndry run — re-run with --yes to spend and write the file.");
  process.exit(0);
}

// ---- 1. submit ------------------------------------------------------------
const b64 = fs.readFileSync(SRC_IMAGE).toString("base64");
const body = {
  model: MODEL,
  prompt: PROMPT,
  imageDataUrl: `data:image/jpeg;base64,${b64}`,
  resolution: RESOLUTION,
  duration: DURATION,
  aspect_ratio: ASPECT,
};
console.log("\n→ submitting…");
const sub = await fetch(`${NANOGPT}/api/generate-video`, {
  method: "POST",
  headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const subText = await sub.text();
if (!sub.ok) die(`submit failed ${sub.status}: ${subText.slice(0, 500)}`);
const subJson = JSON.parse(subText);
const runId = subJson.runId || subJson.id;
if (!runId) die(`no runId in the reply: ${subText.slice(0, 500)}`);
console.log(`  runId ${runId}`);

// ---- 2. poll --------------------------------------------------------------
let out = null, cost = subJson.cost ?? null;
for (let i = 0; i < POLL_LIMIT; i++) {
  await sleep(POLL_MS);
  let s;
  try {
    s = await (await fetch(`${NANOGPT}/api/video/status?requestId=${encodeURIComponent(runId)}`,
      { headers: { Authorization: "Bearer " + KEY } })).json();
  } catch { continue; }
  const st = String(s.data?.status || s.status || "").toUpperCase();
  process.stdout.write(`\r  ${st} ${(i + 1) * POLL_MS / 1000}s   `);
  if (s.cost != null) cost = s.cost;
  if (s.data?.cost != null) cost = s.data.cost;
  if (st === "COMPLETED" || st === "SUCCEEDED") {
    const o = s.data?.output || s.output || {};
    out = o.video?.url || o.url || (Array.isArray(o.video) ? o.video[0]?.url : null);
    break;
  }
  if (st === "FAILED" || st === "ERROR" || st === "CANCELLED") die(`\njob ${st}: ${JSON.stringify(s).slice(0, 500)}`);
}
console.log("");
if (!out) die("no video URL — the job never completed. The charge (if any) already happened; do NOT re-run blindly.");
console.log(`  url ${out}`);
console.log(`  cost ${cost == null ? "not reported by the API — read it off the NanoGPT balance" : "$" + Number(cost).toFixed(4)}`);

// ---- 3. download ----------------------------------------------------------
const raw = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "demo-clip-")), "raw.mp4");
const dl = await fetch(out);
if (!dl.ok) die(`download failed ${dl.status}`);
fs.writeFileSync(raw, Buffer.from(await dl.arrayBuffer()));
console.log(`  raw ${(fs.statSync(raw).size / 1024).toFixed(0)} KB → ${raw}`);

// ---- 4. encode small ------------------------------------------------------
try { execFileSync("ffmpeg", FFMPEG_ARGS(raw, OUT_CLIP), { stdio: ["ignore", "ignore", "pipe"] }); }
catch (e) { die(`ffmpeg failed: ${String(e.stderr || e).slice(0, 500)}`); }

const size = fs.statSync(OUT_CLIP).size;
if (size > SIZE_CAP) {
  fs.unlinkSync(OUT_CLIP);
  die(`encoded file is ${(size / 1024 / 1024).toFixed(2)} MB, over the ${(SIZE_CAP / 1024 / 1024).toFixed(0)} MB cap — `
    + "lower the scale width or raise the CRF in FFMPEG_ARGS and re-encode the raw file. Do not raise the cap.");
}
if (process.env.KEEP_RAW === "1") {
  const keep = OUT_CLIP.replace(/\.mp4$/, ".raw.mp4");
  fs.copyFileSync(raw, keep);
  console.log(`  kept raw at ${path.relative(ROOT, keep)} (do NOT commit it)`);
}
console.log(`\n✓ wrote ${path.relative(ROOT, OUT_CLIP)} — ${(size / 1024).toFixed(0)} KB`);
console.log("  Update the PROVENANCE block at the top of this file with the model, settings and real cost.");
