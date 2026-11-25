#!/usr/bin/env node
// Demo film autoplay (initial-moment Cycle 6, 2026-11-23).
//
// The starter arc's payoff is a 5 s film, but in every measured cycle
// (1, 2, 6 — local harness and live) the film and the narration landed as
// silent players parked at 0:00, and the 60 s after the payoff showed
// nothing moving: a stranger who never presses play never sees the beat
// that proves this isn't a single-model tool. The fix plays the canned
// film, muted, the moment it lands.
//
// Contract pinned here (source-level, offline — no browser, no spend):
//  1. markDemoResult looks up the result's <video> and plays it.
//  2. The play is muted-first (the only autoplay browsers grant) and the
//     play() promise rejection is swallowed — a refusing browser degrades
//     to the old poster + play button, never an unhandled rejection.
//  3. The narration <audio> is NOT autoplayed (no audio play in the fn).
//  4. Autoplay lives ONLY inside markDemoResult, whose single call site is
//     gated on ctx.demo — real runs never autoplay a visitor's clips.
//  5. The honesty badge still lands (autoplay doesn't replace badging),
//     and the badge early-return still prevents double-marking.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error(name + "() not found in index.html");
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("could not brace-match " + name + "()");
}

const fn = (() => { try { return extractFn(IDX, "markDemoResult"); } catch (_) { return ""; } })();
ok(fn.length > 0, "markDemoResult exists");

// 1 + 2. Muted, guarded video autoplay.
ok(/querySelector\("video"\)/.test(fn), "markDemoResult looks up the result's <video>");
ok(/\.muted\s*=\s*true/.test(fn), "film is muted before play (autoplay-safe)");
ok(/\.play\(\)/.test(fn), "markDemoResult plays the film");
ok(/\.catch\(/.test(fn), "play() rejection is caught (graceful degradation)");

// 3. No audio autoplay anywhere in the marking path.
ok(!/querySelector\("audio"\)/.test(fn) && !/<audio[^>]*autoplay/.test(fn), "narration <audio> is not autoplayed");

// 4. Demo-only scoping: exactly one call site, gated on ctx.demo.
const calls = [...IDX.matchAll(/markDemoResult\(n\)/g)].length - 1;   // minus the definition itself
ok(calls === 1, "markDemoResult has exactly one call site");
ok(/if\(ctx\.demo\) markDemoResult\(n\)/.test(IDX), "the call site is gated on ctx.demo (real runs unaffected)");

// 5. Badge intact + early return intact.
ok(fn.includes("demobadge"), "sample badge still inserted by markDemoResult");
ok(/querySelector\("\.demobadge"\)\) return/.test(fn), "already-badged results still return early (no double-mark / double-play)");

console.log(fail ? `check-demo-autoplay: ${fail} FAILED` : "check-demo-autoplay: all passed");
process.exit(fail ? 1 : 0);
