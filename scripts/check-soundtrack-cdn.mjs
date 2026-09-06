#!/usr/bin/env node
// Offline guard for the Soundtrack node's CDN-audio refuse. Generated Music /
// Remix clips come back as https URLs on the provider CDN. The browser mux
// cannot read those bytes (CORS), so a missing preflight used to "succeed"
// with a silent video. Editor + Play both throw before any decode.
//
// Lifts the SHIPPED browser muxSoundtrack (the copy whose first statement is
// the https? guard) out of index.html and play.html and runs it in node:vm.
// The njs/ffmpeg copy can fetch CDN audio and is not this guard. No browser,
// no network, no API spend.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

function matchBrace(src, openIdx) {
  let depth = 0;
  const tmpl = [];
  let mode = "code";
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i++; }
      else if (c === "/" && n === "*") { mode = "block"; i++; }
      else if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (tmpl.length && depth === tmpl[tmpl.length - 1]) { tmpl.pop(); mode = "tpl"; }
        else if (depth === 0) return i;
      }
    } else if (mode === "line") { if (c === "\n") mode = "code"; }
    else if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i++; } }
    else if (mode === "sq") { if (c === "\\") i++; else if (c === "'") mode = "code"; }
    else if (mode === "dq") { if (c === "\\") i++; else if (c === '"') mode = "code"; }
    else if (mode === "tpl") {
      if (c === "\\") i++;
      else if (c === "`") mode = "code";
      else if (c === "$" && n === "{") { mode = "code"; tmpl.push(depth); depth++; i++; }
    }
  }
  throw new Error("unbalanced braces from index " + openIdx);
}

// play.html also embeds the njs/ffmpeg mux (no CORS hole). Pin the browser copy
// by finding the function whose body starts with the https? refuse.
function extractBrowserMux(src, label) {
  const guard = "if(/^https?:/.test(audioUrl))";
  const at = src.indexOf(guard);
  if (at < 0) throw new Error(label + ": browser muxSoundtrack https? guard not found");
  const start = src.lastIndexOf("async function muxSoundtrack", at);
  if (start < 0) throw new Error(label + ": muxSoundtrack signature not found before the https? guard");
  const open = src.indexOf("{", start);
  return src.slice(start, matchBrace(src, open) + 1);
}

function loadMux(label, src) {
  const fn = extractBrowserMux(src, label);
  const ctx = {
    window: {},
    fetch() { throw new Error(label + ": fetch must not run on the CDN refuse path"); },
  };
  vm.createContext(ctx);
  vm.runInContext(fn + "\n;this.muxSoundtrack=muxSoundtrack;", ctx, { filename: label + "#muxSoundtrack" });
  return ctx;
}

const failures = [];
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { console.error("  ✗ " + m); failures.push(m); } };

async function probe(label, src) {
  console.log("• " + label);
  const S = loadMux(label, src);
  let cdn = "";
  try {
    await S.muxSoundtrack("data:video/mp4;base64,xx", "https://cdn.example/track.mp3", false);
  } catch (e) { cdn = e.message || String(e); }
  ok(/soundtrack/i.test(cdn) && /CORS/i.test(cdn),
    "https CDN audio throws the soundtrack/CORS refuse (no silent mux)");
  ok(/Audio input|download the song/i.test(cdn),
    "CDN refuse names a local Audio input (or download) as the fix");

  let http = "";
  try {
    await S.muxSoundtrack("data:video/mp4;base64,xx", "http://cdn.example/track.mp3", false);
  } catch (e) { http = e.message || String(e); }
  ok(/soundtrack/i.test(http) && /CORS/i.test(http),
    "http remote audio hits the same refuse");

  let local = "";
  try {
    await S.muxSoundtrack("data:video/mp4;base64,xx", "data:audio/wav;base64,xx", false);
  } catch (e) { local = e.message || String(e); }
  ok(local && !/soundtrack/i.test(local),
    "data: audio is not the CDN refuse (local bytes may still mux)");
}

await probe("index.html", IDX);
await probe("play.html", PLAY);

if (failures.length) {
  console.error("✗ check-soundtrack-cdn: " + failures.length + " assertion(s) failed.");
  process.exit(1);
}
console.log("✓ soundtrack mux refuses provider CDN audio (editor + Play) so the track cannot come out silent");
