#!/usr/bin/env node
// Guard: usage clips on 📣 Updates entries (updates.json `media`) exist, ship, and
// stay small.
//
// An entry may carry media:{ src:"updates-media/<name>.mp4", poster:"updates-media/
// <name>.webp", w, h } — the PR's real-editor usage GIF, re-encoded. The editor's
// Updates panel lazy-plays it inline; changelog.html shows the poster linking to it.
// This check pins, offline and with Node built-ins only:
//
//  1. every referenced src/poster exists under updates-media/ (a deployed folder —
//     NOT docs/, which .assetsignore keeps off the site) and isn't asset-ignored;
//  2. size caps: clip ≤ 1 MB, poster ≤ 100 KB (never ship a raw multi-MB GIF);
//  3. the clip is a real MP4 with `moov` before `mdat` (+faststart, so it starts
//     playing before the whole file arrives) and no audio track;
//  4. the poster's real pixel size matches media.w × media.h (no layout shift);
//  5. no orphans: every file in updates-media/ is referenced by some entry.
//
// Recipe (from a PR's docs/media/<feature>.gif or raw recording):
//   ffmpeg -i in.gif -an -vf "fps=12,scale='min(720,iw)':-2:flags=lanczos,format=yuv420p" \
//     -c:v libx264 -preset veryslow -crf 23 -tune animation -movflags +faststart updates-media/x.mp4
//   ffmpeg -i updates-media/x.mp4 -frames:v 1 -c:v libwebp -quality 72 updates-media/x.webp
//
//   node scripts/check-updates-media.mjs
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = "updates-media";
const MAX_CLIP = 1_000_000;
const MAX_POSTER = 100_000;
const MEDIA_RE = /^updates-media\/[a-z0-9][a-z0-9._-]*\.(mp4|webp|png|jpg)$/;
let failed = 0;
const fail = (msg) => { console.error("✗ check-updates-media: " + msg); failed++; };

const list = JSON.parse(readFileSync(join(root, "updates.json"), "utf8"));

// .assetsignore: the folder must ship (a docs/-style ignore would 404 every clip).
const ignore = readFileSync(join(root, ".assetsignore"), "utf8").split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"));
const ignored = (p) => ignore.some(g => {
  const re = new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "(/.*)?$");
  return re.test(p);
});
if (ignored(DIR) || ignored(DIR + "/x.mp4")) fail(`.assetsignore excludes ${DIR}/ — clips would 404 on nanoodle.com`);

// Top-level MP4 boxes in order (size/type headers only).
function mp4Boxes(buf) {
  const out = [];
  for (let off = 0; off + 8 <= buf.length;) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    if (size === 1) size = Number(buf.readBigUInt64BE(off + 8));
    else if (size === 0) size = buf.length - off;
    if (size < 8) break;
    out.push({ type, off, size });
    off += size;
  }
  return out;
}
// WebP/PNG/JPEG pixel size from the header.
function imageSize(buf, path) {
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") {
    const chunk = buf.toString("latin1", 12, 16);
    if (chunk === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  }
  if (buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let o = 2; o + 9 < buf.length;) {
      if (buf[o] !== 0xff) break;
      const mk = buf[o + 1], len = buf.readUInt16BE(o + 2);
      if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) return { w: buf.readUInt16BE(o + 7), h: buf.readUInt16BE(o + 5) };
      o += 2 + len;
    }
  }
  fail(`${path}: unrecognized image header (use .webp, .png or .jpg)`);
  return null;
}

const referenced = new Set();
let clips = 0;
list.forEach((e, i) => {
  const m = e && e.media;
  if (m === undefined) return;
  const where = `updates.json[${i}] (${e.date})`;
  if (!m || !MEDIA_RE.test(m.src || "") || !/\.mp4$/.test(m.src) || !MEDIA_RE.test(m.poster || "")) {
    fail(`${where}: media must be { src:"${DIR}/<name>.mp4", poster:"${DIR}/<name>.webp", w, h }`); return;
  }
  clips++;
  for (const p of [m.src, m.poster]) {
    referenced.add(p);
    if (ignored(p)) fail(`${where}: ${p} is excluded by .assetsignore`);
  }
  const src = join(root, m.src), poster = join(root, m.poster);
  if (!existsSync(src)) fail(`${where}: ${m.src} does not exist`);
  else {
    const size = statSync(src).size;
    if (size > MAX_CLIP) fail(`${where}: ${m.src} is ${size} bytes (cap ${MAX_CLIP}) — re-encode smaller (crf/fps/width)`);
    const boxes = mp4Boxes(readFileSync(src));
    const types = boxes.map(b => b.type);
    if (types[0] !== "ftyp") fail(`${where}: ${m.src} is not an MP4 (first box ${types[0] || "none"})`);
    const moov = types.indexOf("moov"), mdat = types.indexOf("mdat");
    if (moov < 0 || mdat < 0) fail(`${where}: ${m.src} is missing moov/mdat`);
    else if (moov > mdat) fail(`${where}: ${m.src} has moov after mdat — re-encode with -movflags +faststart`);
    else {
      const b = boxes[moov], moovBuf = readFileSync(src).subarray(b.off, b.off + b.size);
      if (moovBuf.includes(Buffer.from("soun"))) fail(`${where}: ${m.src} has an audio track — clips are muted loops, encode with -an`);
    }
  }
  if (!existsSync(poster)) fail(`${where}: ${m.poster} does not exist`);
  else {
    const size = statSync(poster).size;
    if (size > MAX_POSTER) fail(`${where}: ${m.poster} is ${size} bytes (cap ${MAX_POSTER})`);
    const dim = imageSize(readFileSync(poster), m.poster);
    if (dim && (dim.w !== m.w || dim.h !== m.h)) fail(`${where}: media.w×h ${m.w}×${m.h} ≠ poster ${dim.w}×${dim.h}`);
  }
});

if (existsSync(join(root, DIR))) {
  for (const f of readdirSync(join(root, DIR))) {
    if (!referenced.has(`${DIR}/${f}`)) fail(`${DIR}/${f} is not referenced by any updates.json entry (orphans still deploy) — attach it or delete it`);
  }
}

// The renderers must keep reading the field (a silent drop would hide every clip).
const idx = readFileSync(join(root, "index.html"), "utf8");
if (!/function updClip\(e\)/.test(idx) || !/updClip\(e\)/.test(idx.split("function updClip(e)")[0])) fail("index.html openUpdates() no longer renders media via updClip(e)");
if (!/preload = "none"/.test(idx) || !/IntersectionObserver/.test(idx)) fail("index.html update clips must stay lazy (preload none + IntersectionObserver)");
const gen = readFileSync(join(root, "scripts", "gen-changelog.mjs"), "utf8");
if (!/clipHtml\(e\)/.test(gen) || !/loading="lazy"/.test(gen)) fail("gen-changelog.mjs no longer renders lazy clip posters");

if (failed) process.exit(1);
console.log(`✓ check-updates-media: ${clips} update clip${clips === 1 ? "" : "s"} exist, ship, are faststart MP4s ≤ ${MAX_CLIP / 1e6} MB with posters ≤ ${MAX_POSTER / 1e3} KB`);
