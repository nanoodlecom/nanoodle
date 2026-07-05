#!/usr/bin/env node
// Offline guard for resizePlan — the pure fit/fill/exact geometry math behind the 📐 Resize/crop node.
// A twin copy ships in BOTH engines: index.html (editor, ~5346) and play.html's RUNTIME_JS (exported
// app, ~2321). Engine drift between the two copies is THE dominant historical bug class in this repo
// (dual-engine parity misses: PRs #74, #64, #88; the node audit found engine drift dominant), and a
// geometry error here ships WRONG DIMENSIONS into paid image/video jobs on both surfaces.
//
// We lift the SHIPPED resizePlan out of each file as text and run it in-process (pure Math, no DOM, no
// canvas, no network, no API spend — see the "no API spend" rule). Two invariants are hard-pinned:
//   1. PARITY — the two extracted copies produce byte-identical output over the FULL input table
//      (including degenerate inputs), AND are byte-identical after whitespace normalization.
//   2. GEOMETRY — a hand-computed table pins fit (letterbox), fill (center-crop), exact (stretch),
//      never-upscale (fit only), blank-side aspect derivation, and integer canvas dimensions.
// It also pins the ≤1024px scaledDataURL cap constant in both engines (protects localStorage + share
// size). Runtime well under 2s. Non-zero exit + a pointed message on any failure.
//
// index.html carries committed NUL bytes; Node readFileSync(...,"utf8") reads them fine (shell grep
// would need -a). ROOT is resolved relative to THIS file so the check relocates into a sandbox copy.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const failures = [];
const fail = (msg) => failures.push(msg);

// ---- brace-matcher (string/comment/template aware) — same shape as check-share-link.mjs ----
function matchBrace(src, openIdx) {
  let depth = 0;
  const tmpl = [];
  let mode = "code"; // code | sq | dq | tpl | line | block
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

// pull `function <name>(...) { ... }` out as text (works at any indentation — no line anchor)
function extractFunction(src, name) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}()`);
  const open = src.indexOf("{", m.index);
  const close = matchBrace(src, open);
  return src.slice(m.index, close + 1);
}

// compile extracted resizePlan text into a callable (pure Math — no DOM, no closure deps)
function compile(text) {
  return new Function(text + "\nreturn resizePlan;")();
}

// ---- load both engines --------------------------------------------------------------------
const ENGINES = [
  { file: "index.html", label: "index.html (editor)" },
  { file: "play.html", label: "play.html (exported app RUNTIME_JS)" },
];

for (const e of ENGINES) {
  try {
    e.src = readFileSync(join(ROOT, e.file), "utf8");
    e.text = extractFunction(e.src, "resizePlan");
    e.fn = compile(e.text);
  } catch (err) {
    fail(`${e.file}: could not extract/compile resizePlan — ${err.message}`);
  }
}
if (failures.length) { report(); }

// ---- canonicalize a plan so NaN / ±Infinity are DISTINGUISHED (JSON collapses them to null) ----
function canon(p) {
  if (p === null || p === undefined) return String(p);
  const tag = (v) =>
    Number.isNaN(v) ? "NaN" : v === Infinity ? "Inf" : v === -Infinity ? "-Inf" : v;
  return JSON.stringify(["cw", "ch", "dx", "dy", "dw", "dh"].map((k) => tag(p[k])));
}

const [IDX, PLAY] = ENGINES;

// ============================================================================================
// INVARIANT 1 — PARITY
// ============================================================================================
// 1a. Byte-identical after normalization. resizePlan has no strings/regex/templates, so stripping
//     comments then collapsing all whitespace is a safe semantic normalization: it ignores
//     indentation (col 0 in index.html vs nested in RUNTIME_JS) and inline comment wording (the
//     copies legitimately differ by one trailing "blank side" comment) while catching any real
//     divergence in the executable code.
const normalize = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/\s+/g, "");
if (normalize(IDX.text) !== normalize(PLAY.text)) {
  fail(
    "PARITY(text): resizePlan differs between index.html and play.html after whitespace " +
      "normalization — the two engines have DRIFTED. A geometry change must be mirrored into " +
      "both copies (RUNTIME_JS twin), or one surface ships wrong dimensions into paid jobs."
  );
}

// ============================================================================================
// GEOMETRY TABLE — hand-computed expectations. tw/th arrive as Math.max(0, parseInt||0), i.e.
// non-negative integers (index.html:4664-4665), and 0 means "blank / derive from source aspect".
// ============================================================================================
// Each row: [sw, sh, mode, tw, th, expected-plan-or-null, note]
const TABLE = [
  // fit — scale to fit inside box, keep aspect, NEVER upscale; canvas == the fitted image (no
  // letterbox padding — the output box shrinks to the scaled image, dx=dy=0).
  [1000, 500, "fit", 400, 400, { cw: 400, ch: 200, dx: 0, dy: 0, dw: 400, dh: 200 }, "landscape→portrait box: scale 0.4, no pad"],
  [500, 1000, "fit", 400, 400, { cw: 200, ch: 400, dx: 0, dy: 0, dw: 200, dh: 400 }, "portrait→square box"],
  [100, 100, "fit", 400, 400, { cw: 100, ch: 100, dx: 0, dy: 0, dw: 100, dh: 100 }, "NEVER upscale — small source stays 100²"],
  [1000, 500, "fit", 500, 0, { cw: 500, ch: 250, dx: 0, dy: 0, dw: 500, dh: 250 }, "blank height: scale from width only"],
  [1000, 500, "fit", 0, 250, { cw: 500, ch: 250, dx: 0, dy: 0, dw: 500, dh: 250 }, "blank width: scale from height only"],
  [1000, 500, "fit", 2000, 2000, { cw: 1000, ch: 500, dx: 0, dy: 0, dw: 1000, dh: 500 }, "upscaling box clamped — source unchanged"],
  // fractional intermediate: pins Math.round in the fit w/h path (99.9→100). Math.floor would give ch=99,
  // so this row catches a round→floor rounding drift the integer-only rows above cannot distinguish.
  [1000, 999, "fit", 100, 100, { cw: 100, ch: 100, dx: 0, dy: 0, dw: 100, dh: 100 }, "round in fit: 999*0.1=99.9→100 (floor→99)"],

  // exact — stretch to the box exactly (aspect not preserved). Blank side ← source aspect.
  [1000, 500, "exact", 400, 400, { cw: 400, ch: 400, dx: 0, dy: 0, dw: 400, dh: 400 }, "stretch to box"],
  [1000, 500, "exact", 400, 0, { cw: 400, ch: 200, dx: 0, dy: 0, dw: 400, dh: 200 }, "blank height ← source aspect"],
  [1000, 500, "exact", 0, 200, { cw: 400, ch: 200, dx: 0, dy: 0, dw: 400, dh: 200 }, "blank width ← source aspect"],
  [100, 100, "exact", 400, 400, { cw: 400, ch: 400, dx: 0, dy: 0, dw: 400, dh: 400 }, "exact DOES upscale"],
  // fractional blank-side derivation: pins Math.round in bh (100*200/300=66.67→67). floor→66, so this
  // catches a round→floor drift in the blank-aspect path that the integer-derivation rows cannot.
  [300, 200, "exact", 100, 0, { cw: 100, ch: 67, dx: 0, dy: 0, dw: 100, dh: 67 }, "round in blank bh: 66.67→67 (floor→66)"],

  // fill — cover the box (scale to the LARGER ratio) then center-crop the overflow.
  [1000, 500, "fill", 400, 400, { cw: 400, ch: 400, dx: -200, dy: 0, dw: 800, dh: 400 }, "wide source: horizontal center-crop"],
  [500, 1000, "fill", 400, 400, { cw: 400, ch: 400, dx: 0, dy: -200, dw: 400, dh: 800 }, "tall source: vertical center-crop"],
  [100, 100, "fill", 400, 400, { cw: 400, ch: 400, dx: 0, dy: 0, dw: 400, dh: 400 }, "fill DOES upscale"],
  [1000, 500, "fill", 400, 0, { cw: 400, ch: 200, dx: 0, dy: 0, dw: 400, dh: 200 }, "blank side ← source aspect → no crop"],

  // no target set → null (guards resizeCropImage from producing a 0-target canvas)
  [1000, 500, "fit", 0, 0, null, "no target → null"],
  [1000, 500, "fill", 0, 0, null, "no target → null (fill)"],
  [1000, 500, "exact", 0, 0, null, "no target → null (exact)"],
];

for (const [sw, sh, mode, tw, th, exp, note] of TABLE) {
  const got = IDX.fn(sw, sh, mode, tw, th);
  const g = canon(got), e = canon(exp);
  if (g !== e) {
    fail(`GEOMETRY: resizePlan(${sw},${sh},"${mode}",${tw},${th}) — ${note}\n    expected ${e}\n    got      ${g}`);
    continue;
  }
  // integer canvas dimensions (c.width/c.height need integers) for every non-null plan
  if (got !== null && !(Number.isInteger(got.cw) && Number.isInteger(got.ch))) {
    fail(`GEOMETRY(int): resizePlan(${sw},${sh},"${mode}",${tw},${th}) produced non-integer canvas size cw=${got.cw} ch=${got.ch}`);
  }
}

// 1b. Functional parity — both engines must return byte-identical plans over the FULL table
//     (including the degenerate rows below). This is the primary drift guard: same code ⇒ same
//     output on every input, even the garbage ones.
const PARITY_INPUTS = TABLE.map(([sw, sh, mode, tw, th]) => [sw, sh, mode, tw, th]).concat([
  // degenerate probes (also feed the pin below) — parity must hold on these too
  [0, 500, "fit", 400, 400],
  [0, 500, "fill", 400, 400],
  [NaN, 500, "fit", 400, 400],
  [1000, 0, "exact", 400, 0],
]);
for (const [sw, sh, mode, tw, th] of PARITY_INPUTS) {
  const gi = canon(IDX.fn(sw, sh, mode, tw, th));
  const gp = canon(PLAY.fn(sw, sh, mode, tw, th));
  if (gi !== gp) {
    fail(`PARITY(output): resizePlan(${sw},${sh},"${mode}",${tw},${th}) diverges — index=${gi} play=${gp}`);
  }
}

// ---- DEGENERATE BEHAVIOR PIN ---------------------------------------------------------------
// tw/th are always integers ≥0 in production, but sw/sh come from img.naturalWidth/Height. For a
// real decoded image those are ≥1, but the function has no explicit guard. We pin the ONE
// degenerate path the code actually protects (fit clamps via Math.max(1,...)); the unprotected
// fill/NaN paths are reported as FINDINGS, NOT asserted here (they can't happen with a decoded
// image, and pinning "produces NaN" would be a brittle assertion of a bug).
{
  const p = IDX.fn(0, 500, "fit", 400, 400); // scale=min(Inf,0.8)=0.8 → clamped to finite ≥1
  const ok = p && Number.isInteger(p.cw) && Number.isInteger(p.ch) && p.cw >= 1 && p.ch >= 1;
  if (!ok) fail(`DEGENERATE: fit with a 0-width source no longer clamps to a finite ≥1 canvas (got ${canon(p)})`);
}

// ---- scaledDataURL 1024px cap (both engines) -----------------------------------------------
// Editor: `function scaledDataURL(src, sw, sh, max=1024)`. RUNTIME_JS twin: `function scaledDataUrl
// (src, sw, sh, max){ max = max || 1024; }` (note the lower-case name + different default form).
// The cap bounds localStorage quota + share-link payload size; pin the constant is 1024 in both.
function scaledCap(src, file) {
  // name is scaledDataURL (index.html) or scaledDataUrl (play.html RUNTIME_JS) — match either.
  let m = /function\s+scaledData[Uu][Rr][Ll]\s*\([^)]*\bmax\s*=\s*(\d+)\s*\)/.exec(src);        // default-param form
  if (!m) m = /function\s+scaledData[Uu][Rr][Ll]\b[\s\S]{0,200}?\bmax\s*=\s*max\s*\|\|\s*(\d+)/.exec(src); // `max = max || N` form
  if (!m) { fail(`${file}: could not locate the scaledDataURL 1024px cap constant`); return null; }
  return parseInt(m[1], 10);
}
const capIdx = scaledCap(IDX.src, "index.html");
const capPlay = scaledCap(PLAY.src, "play.html");
if (capIdx !== null && capPlay !== null) {
  if (capIdx !== 1024) fail(`CAP: index.html scaledDataURL cap is ${capIdx}px, expected 1024`);
  if (capPlay !== 1024) fail(`CAP: play.html scaledDataUrl cap is ${capPlay}px, expected 1024`);
  if (capIdx !== capPlay) fail(`CAP: scaledDataURL cap drifted between engines — index=${capIdx} play=${capPlay}`);
}

report();

function report() {
  if (failures.length) {
    process.stderr.write("✗ resizePlan geometry / parity check failed:\n\n- " + failures.join("\n\n- ") + "\n");
    process.exit(1);
  }
  process.stdout.write(
    "✓ resizePlan is parity-locked across both engines; fit/fill/exact geometry + 1024px cap pinned.\n"
  );
}
