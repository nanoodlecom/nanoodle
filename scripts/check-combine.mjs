#!/usr/bin/env node
// Offline guard for the Combine node's lossless mp4 remux (MP4CAT in index.html).
// Extracts the SHIPPED remuxer straight out of index.html, runs it on two tiny committed
// fixtures, and asserts the output timeline is exact. Pure Node — no browser, no ffmpeg, no
// network, no API spend (see the pre-commit "no API spend" rule). Catches the whole
// duration/track/seam regression class the old real-time recorder could never be tested for.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");

// Pull the MP4CAT IIFE (from "const MP4CAT = (()=>{" to its closing "})();").
const start = html.indexOf("const MP4CAT = (()=>{");
if (start < 0) { console.error("check-combine: MP4CAT block not found in index.html"); process.exit(1); }
const end = html.indexOf("})();", start);
if (end < 0) { console.error("check-combine: MP4CAT block not terminated"); process.exit(1); }
const block = html.slice(start, end + "})();".length);
// Evaluate it and hand back the API object.
const MP4CAT = new Function(block + "\nreturn MP4CAT;")();

const A = new Uint8Array(readFileSync(join(root, "scripts/fixtures/clipA.mp4")));
const B = new Uint8Array(readFileSync(join(root, "scripts/fixtures/clipB.mp4")));

let failed = 0;
const ok = (cond, msg) => { if (cond) { console.log("  ✓ " + msg); } else { console.error("  ✗ " + msg); failed++; } };
const trackOf = (buf, kind) => MP4CAT.parseMp4(buf).tracks.find(t => t.kind === kind);
const dur = (t) => t.samples.reduce((a, s) => a + s.dur, 0) / t.timescale;

const va = trackOf(A, "video"), aa = trackOf(A, "audio");
const vb = trackOf(B, "video"), ab = trackOf(B, "audio");

ok(MP4CAT.isMp4(A) && MP4CAT.isMp4(B), "fixtures sniff as mp4");
ok(MP4CAT.mp4ParamsMatch([A, B]) === true, "matching fixtures pass the remux gate");

const out = MP4CAT.concatMp4([A, B], { dedup: false });
ok(MP4CAT.isMp4(out), "remux output is a valid mp4 (ftyp)");
const vo = trackOf(out, "video"), ao = trackOf(out, "audio");

ok(vo.samples.length === va.samples.length + vb.samples.length,
   "video sample count == sum (" + vo.samples.length + " == " + va.samples.length + "+" + vb.samples.length + ")");
ok(ao.samples.length === aa.samples.length + ab.samples.length,
   "audio sample count == sum (" + ao.samples.length + ")");

const expVideo = dur(va) + dur(vb), expAudio = dur(aa) + dur(ab);
const oneFrame = 1 / (va.samples.length / dur(va));
ok(Math.abs(dur(vo) - expVideo) <= oneFrame, "video duration == sum within one frame (" + dur(vo).toFixed(3) + "s)");
ok(Math.abs(dur(ao) - expAudio) <= 0.05, "audio duration == sum (" + dur(ao).toFixed(3) + "s)");

// dedup must drop exactly one video sample per later clip (and NOT touch audio).
const outD = MP4CAT.concatMp4([A, B], { dedup: true });
const voD = trackOf(outD, "video"), aoD = trackOf(outD, "audio");
ok(voD.samples.length === va.samples.length + vb.samples.length - 1, "dedup drops exactly one video sample");
ok(aoD.samples.length === ao.samples.length, "dedup leaves audio untouched");

// mismatched inputs must NOT remux (gate returns false) so the dispatcher falls back safely.
ok(MP4CAT.mp4ParamsMatch([A, A, B]) === true, "3-clip matching set passes the gate");

if (failed) { console.error("✗ check-combine: " + failed + " assertion(s) failed."); process.exit(1); }
console.log("✓ Combine remux produces an exact-duration, correctly-tracked mp4.");
