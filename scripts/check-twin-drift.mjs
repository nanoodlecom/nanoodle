#!/usr/bin/env node
// Offline guard against TWIN DRIFT between the two engine surfaces: index.html (the editor) and
// play.html (the app player + the self-contained .html export).
//
// WHY THIS EXISTS
// The two files are 26,000 lines together and they share a large body of byte-identical,
// HAND-MAINTAINED code (pricing resolver, Combine/MP4CAT remux, resize geometry, audio helpers,
// share/head metadata). Every engine change is therefore a 2-surface edit. Dual-engine drift is the
// dominant historical bug class in this repo (PRs #64, #74, #88 and the whole node audit).
//
// The repo already pins SPECIFIC twins: check-resize-plan, check-pricing, check-combine,
// check-cost-accrue and friends each lift one named function out of both files. check-js-parity and
// check-njs-*-delegation pin each surface against the sibling nanoodle-js bundle. NOTHING compared
// index.html against play.html as whole files. A one-sided edit to any line those targeted guards do
// not name shipped silently. This guard closes that hole.
//
// WHAT IT MEASURES
// The SHARED SET: every distinct line, stripped, longer than 40 characters, that appears
// byte-identically in both files. Generated regions are blanked first, so the generated
// nanoodle-js bundle and the probe-written prompt-cap table never count as hand-maintained
// duplication. The count and a per-line hash list live in scripts/twin-drift-baseline.json.
//
// WHAT IT FAILS ON  (see classify() for the exact rules)
//   DRIFT   — a baseline line left the shared set because ONE surface edited it and the other did
//             not. The edited replacement is still sitting in the file that moved. This is the real
//             failure mode and the guard names both file:line positions.
//   GROWTH  — the shared-line COUNT went up. The ratchet only turns one way.
// It does NOT fail on deduplication: a line that vanished from a surface with no near-identical
// replacement is extraction, which is always allowed and only prints a note. It does NOT fail on a
// correctly MIRRORED edit either (both surfaces changed together): membership moves, the count
// holds, and the guard only asks for a baseline refresh.
//
// REFRESH (deliberate, same shape as the CSP golden in check-deploy-config.mjs):
//   TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs
//
// No network, no API spend, well under 2 seconds. index.html and play.html carry committed NUL
// bytes; Node readFileSync(...,"utf8") reads them fine (shell grep would need -a). ROOT resolves
// relative to THIS file so the check relocates into a sandbox copy.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts", "twin-drift-baseline.json");

// A line must be longer than this (after strip) to enter the shared set. Short lines ("});",
// "return out;", a lone brace) collide between unrelated code and would make the guard cry wolf.
const MIN_LEN = 40;

// How similar a surviving twin and a candidate replacement must be before we call it an edit and
// not a coincidence. Dice coefficient over character bigrams. A one-token edit scores ~0.9; two
// unrelated 60-character lines of the same house style score ~0.3-0.5.
const DRIFT_SIMILARITY = 0.72;

// If the baseline is this far out of date, per-line classification is noise. Report the totals and
// send the developer to the refresh instead.
const MAX_CLASSIFY = 200;

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);

// ---------------------------------------------------------------------------
// 1. read both surfaces and blank the GENERATED regions
// ---------------------------------------------------------------------------
// Blanking keeps line numbering true: each match becomes the same number of newlines, so every
// file:line the guard prints is the real line number in the real file.
const GENERATED = [
  // play.html — the whole nanoodle-js bundle written by scripts/gen-js-engine.mjs. It carries the
  // LIBRARY's copy of resizePlan / MP4CAT / prompt caps. Same strip as check-resize-plan.mjs:85-87
  // and check-app-settings.mjs:35-36. Counting it would book the library as hand duplication.
  { name: "njs-engine bundle", re: /<script id="njs-engine"[\s\S]*?<\/script>/g },
  // both files — the prompt-cap table written into BOTH by scripts/probe-prompt-caps.mjs. It is
  // generated identically into the two surfaces, so a one-sided edit is not reachable by hand.
  { name: "PROMPT-CAPS table", re: /\/\* === PROMPT-CAPS-BEGIN === \*\/[\s\S]*?\/\* === PROMPT-CAPS-END === \*\//g },
  // index.html — generated i18n maps (scripts/translate-updates.mjs + gen-lang-pages.mjs feed them).
  { name: "I18N-MAPS", re: /\/\* === I18N-MAPS-BEGIN[\s\S]*?\/\* === I18N-MAPS-END === \*\//g },
  // index.html — the Runware AIR table written by scripts/update-runware-airs.mjs.
  { name: "RUNWARE-AIRS", re: /\/\* === RUNWARE-AIRS-BEGIN === \*\/[\s\S]*?\/\* === RUNWARE-AIRS-END === \*\//g },
];

function blankGenerated(src) {
  let out = src;
  for (const g of GENERATED) {
    out = out.replace(g.re, (m) => "\n".repeat((m.match(/\n/g) || []).length));
  }
  return out;
}

function loadSurface(file) {
  const path = join(ROOT, file);
  if (!existsSync(path)) {
    fail(`${file} is missing — cannot measure twin drift`);
    return null;
  }
  const raw = readFileSync(path, "utf8");
  const lines = blankGenerated(raw).split("\n");
  // hash -> { text, at: [1-based line numbers] }
  const sig = new Map();
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.length <= MIN_LEN) return;
    const h = hash(t);
    const e = sig.get(h);
    if (e) e.at.push(i + 1);
    else sig.set(h, { text: t, at: [i + 1] });
  });
  return { file, lines, sig };
}

function hash(s) {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

const IDX = loadSurface("index.html");
const PLAY = loadSurface("play.html");
if (failures.length) report();

// ---------------------------------------------------------------------------
// 2. the shared set
// ---------------------------------------------------------------------------
const sharedNow = [];
for (const h of IDX.sig.keys()) if (PLAY.sig.has(h)) sharedNow.push(h);
sharedNow.sort();
const sharedNowSet = new Set(sharedNow);

const occIdx = sharedNow.reduce((n, h) => n + IDX.sig.get(h).at.length, 0);
const occPlay = sharedNow.reduce((n, h) => n + PLAY.sig.get(h).at.length, 0);
const digest = createHash("sha256").update(sharedNow.join("\n")).digest("hex").slice(0, 32);

// ---------------------------------------------------------------------------
// 3. refresh mode
// ---------------------------------------------------------------------------
if (process.env.TWIN_DRIFT_UPDATE) {
  const next = {
    _comment: [
      "Baseline for scripts/check-twin-drift.mjs — the hand-maintained duplication between",
      "index.html and play.html. `count` is a RATCHET: extraction may lower it freely, new",
      "duplication may not raise it silently. `lines` holds a 16-hex sha256 of each shared line,",
      "stripped. Refresh deliberately with: TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs",
      "Ranked extraction plan: docs/twin-drift.md",
    ].join(" "),
    count: sharedNow.length,
    occurrencesIndexHtml: occIdx,
    occurrencesPlayHtml: occPlay,
    digest,
    lines: sharedNow,
  };
  writeFileSync(BASELINE, JSON.stringify(next, null, 2) + "\n");
  console.log(
    `✓ twin-drift baseline written → ${relative(ROOT, BASELINE)}\n` +
      `  ${sharedNow.length} distinct shared lines (${occIdx} in index.html, ${occPlay} in play.html), digest ${digest}`
  );
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  fail(
    `baseline missing (${relative(ROOT, BASELINE)}) — create it deliberately:\n` +
      `      TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
  report();
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
} catch (e) {
  fail(`baseline is not valid JSON (${relative(ROOT, BASELINE)}) — ${e.message}`);
  report();
}
const baseLines = Array.isArray(baseline.lines) ? baseline.lines : [];
const baseSet = new Set(baseLines);
if (!baseLines.length) {
  fail(
    `baseline has no "lines" array (${relative(ROOT, BASELINE)}) — regenerate it:\n` +
      `      TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
  report();
}

// ---------------------------------------------------------------------------
// 4. compare
// ---------------------------------------------------------------------------
const left = baseLines.filter((h) => !sharedNowSet.has(h));
const entered = sharedNow.filter((h) => !baseSet.has(h));

// --- 4a. GROWTH: the ratchet only turns one way. ---------------------------
// The ratchet is on the COUNT, not on set membership. That is deliberate. When a developer does the
// RIGHT thing and mirrors an edit into both surfaces, the old line leaves the set and the new line
// enters it: membership changes, the count does not. Failing that case would punish the exact
// behaviour this guard asks for, and a guard that cries wolf gets bypassed. So membership changes
// only print a note; a HIGHER count fails.
const enteredList = (n) =>
  entered.slice(0, n).map((h) => {
    const a = IDX.sig.get(h), b = PLAY.sig.get(h);
    return `        index.html:${a.at[0]} / play.html:${b.at[0]}  ${clip(a.text)}`;
  });

if (sharedNow.length > baseline.count) {
  const shown = enteredList(12);
  fail(
    `duplication went UP: ${baseline.count} → ${sharedNow.length} shared lines ` +
      `(${entered.length} entered, ${left.length} left).\n` +
      `      Every new shared line is a line some future edit must change in two places.\n` +
      `      Put the code in ONE surface, or route it through the nanoodle-js bundle\n` +
      `      (scripts/gen-js-engine.mjs — see docs/twin-drift.md for what is already extractable).\n` +
      `      If the duplication is deliberate, raise the ratchet on purpose:\n` +
      `        TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs\n` +
      shown.join("\n") +
      (entered.length > shown.length ? `\n        … and ${entered.length - shown.length} more` : "")
  );
} else if (entered.length) {
  const shown = enteredList(6);
  notes.push(
    `${entered.length} line(s) entered the shared set while the count held at ` +
      `${sharedNow.length} (${baseline.count} before) — this is what a correctly MIRRORED edit\n` +
      `    looks like. Refresh the baseline so the new twins are tracked:\n` +
      `      TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs\n` +
      shown.join("\n") +
      (entered.length > shown.length ? `\n        … and ${entered.length - shown.length} more` : "")
  );
}

// --- 4b. departures: DRIFT (fail) vs EXTRACTION (allowed) ------------------
// A baseline line can leave the shared set two ways.
//   EXTRACTION  the code is genuinely gone from a surface (deleted, or moved into the bundle).
//               Nothing near-identical replaced it. Always allowed — that is the work we want.
//   DRIFT       the code is still there on both surfaces, but one side EDITED it. The keeper still
//               carries the original byte-for-byte; the mover carries a near-identical variant.
//               That is exactly the silent one-sided edit this guard exists to catch.
if (left.length > MAX_CLASSIFY) {
  fail(
    `${left.length} baseline lines left the shared set (baseline count ${baseline.count}, now ${sharedNow.length}).\n` +
      `      That is too large a move to attribute line by line. Review the diff, then refresh:\n` +
      `        TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
} else if (left.length) {
  const drifted = [];
  let extracted = 0;
  let vanished = 0;
  for (const h of left) {
    const inIdx = IDX.sig.get(h);
    const inPlay = PLAY.sig.get(h);
    if (inIdx && inPlay) continue; // still shared — cannot happen, guard anyway
    if (!inIdx && !inPlay) { vanished++; continue; } // removed from BOTH surfaces
    const keeper = inIdx ? IDX : PLAY;
    const mover = inIdx ? PLAY : IDX;
    const text = (inIdx || inPlay).text;
    const at = (inIdx || inPlay).at[0];
    const cand = bestMatch(text, mover);
    if (cand) drifted.push({ keeper, mover, text, at, cand });
    else extracted++;
  }
  if (extracted || vanished) {
    const bits = [];
    if (extracted) bits.push(`${extracted} deduplicated onto one surface`);
    if (vanished) bits.push(`${vanished} deleted from both`);
    notes.push(
      `${bits.join(", ")} — the ratchet allows this. Lower the baseline when convenient:\n` +
        `    TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
    );
  }
  if (drifted.length) {
    const shown = drifted.slice(0, 12).map((d, i) => {
      const keptAt = `${d.keeper.file}:${d.at}`;
      const movedAt = `${d.mover.file}:${d.cand.line}`;
      const pad = Math.max(keptAt.length, movedAt.length);
      return (
        `      ${i + 1}. ${keptAt.padEnd(pad)}  ${clip(d.text)}\n` +
        `         ${movedAt.padEnd(pad)}  ${clip(d.cand.text)}`
      );
    });
    fail(
      `TWIN DRIFT — ${drifted.length} line(s) that both engines carried byte-identically now differ.\n` +
        `      One surface was edited and the other was not. Mirror the edit, or delete the twin.\n` +
        shown.join("\n") +
        (drifted.length > shown.length ? `\n      … and ${drifted.length - shown.length} more` : "") +
        `\n      If the two surfaces are MEANT to diverge here, say so deliberately:\n` +
        `        TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
    );
  }
}

// --- 4c. cheap sanity: the stored digest must describe the stored lines ----
const baseDigest = createHash("sha256").update([...baseLines].sort().join("\n")).digest("hex").slice(0, 32);
if (baseline.digest && baseline.digest !== baseDigest) {
  fail(
    `baseline digest does not match its own "lines" array (${relative(ROOT, BASELINE)}) — hand edited?\n` +
      `      Regenerate: TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
}

report();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// Dice coefficient over character bigrams. Deterministic, dependency-free, O(n).
function bigrams(s) {
  const set = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    set.set(g, (set.get(g) || 0) + 1);
  }
  return set;
}
function dice(aGrams, aSize, b) {
  if (aSize === 0 || b.length < 2) return 0;
  const bGrams = bigrams(b);
  let bSize = 0, hits = 0;
  for (const [g, n] of bGrams) {
    bSize += n;
    const m = aGrams.get(g);
    if (m) hits += Math.min(m, n);
  }
  return (2 * hits) / (aSize + bSize);
}

// Find the line in `mover` that looks like an edited copy of `text`.
// A candidate must NOT itself be in the shared set (a shared line is a twin in its own right, not
// the replacement we are hunting) and must be within a plausible length band of the original.
function bestMatch(text, mover) {
  const aGrams = bigrams(text);
  let aSize = 0;
  for (const n of aGrams.values()) aSize += n;
  const lo = text.length * 0.6, hi = text.length * 1.7;
  let best = null;
  for (const [h, e] of mover.sig) {
    if (sharedNowSet.has(h)) continue;
    if (e.text.length < lo || e.text.length > hi) continue;
    const r = dice(aGrams, aSize, e.text);
    if (r >= DRIFT_SIMILARITY && (!best || r > best.ratio)) best = { ratio: r, text: e.text, line: e.at[0] };
  }
  return best;
}

function clip(s) {
  return s.length > 110 ? s.slice(0, 107) + "..." : s;
}

function report() {
  for (const n of notes) console.log(`  note: ${n}`);
  if (failures.length) {
    console.error("\n✗ check-twin-drift failed:\n");
    for (const f of failures) console.error(`  - ${f}\n`);
    console.error(
      `  index.html ↔ play.html duplication is tracked in ${relative(ROOT, BASELINE)}.\n` +
        `  The ranked extraction plan is docs/twin-drift.md.\n`
    );
    process.exit(1);
  }
  console.log(
    `✓ twin drift: ${sharedNow.length} shared lines${notes.length ? " (baseline stale — see notes)" : ", unchanged"} ` +
      `(${occIdx} in index.html, ${occPlay} in play.html)`
  );
  process.exit(0);
}
