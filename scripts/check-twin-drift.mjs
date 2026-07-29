#!/usr/bin/env node
// Offline guard against TWIN DRIFT between the two engine surfaces: index.html (the editor) and
// play.html (the app player + the self-contained .html export).
//
// WHY THIS EXISTS
// The two files are 26,000 lines together and they share a large body of byte-identical,
// HAND-MAINTAINED code (pricing resolver, Combine/MP4CAT remux, resize geometry, audio helpers,
// the balance cache, the njs delegation shim). Every engine change is therefore a 2-surface edit.
// Dual-engine drift is the dominant historical bug class in this repo (PRs #64, #74, #88 and the
// whole node audit).
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
// duplication. Both the distinct lines AND the per-surface OCCURRENCE COUNT of each line live in
// scripts/twin-drift-baseline.json, because a line that appears twice in one surface can be edited
// in one place and still be "present".
//
// WHAT IT FAILS ON  (see section 4 for the exact rules)
//   DRIFT     — a baseline line left the shared set, or lost an occurrence on one surface only,
//               because ONE surface edited it and the other did not. The edited replacement is still
//               sitting in the file that moved. The guard names both file:line positions.
//   DELETION  — a baseline line is gone from one surface and still LIVE on the other. Nothing
//               replaced it. The code did not move; one engine simply stopped doing it.
//   GROWTH    — the shared-line COUNT went up, or a shared line gained an occurrence.
// It does NOT fail on real EXTRACTION: a line that left BOTH surfaces, or that moved into the
// generated nanoodle-js bundle, only prints a note. It does NOT fail on a correctly MIRRORED edit
// either (both surfaces changed together): membership moves, the count holds, and the guard only
// asks for a baseline refresh.
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
//
// The generated lines are NOT thrown away. They go into GEN_LINES, because "the line moved into the
// library bundle" is the one legitimate way for a shared line to leave a single surface.

const GEN_LINES = new Set(); // hashes of every line inside a generated region, either file

// Marker-delimited generated regions. Every one of these markers is written by a script and appears
// at most once per file, so a plain regex is safe here.
const MARKED = [
  // both files — the prompt-cap table written into BOTH by scripts/probe-prompt-caps.mjs. It is
  // generated identically into the two surfaces, so a one-sided edit is not reachable by hand.
  { name: "PROMPT-CAPS table", re: /\/\* === PROMPT-CAPS-BEGIN === \*\/[\s\S]*?\/\* === PROMPT-CAPS-END === \*\//g },
  // index.html — generated i18n maps (scripts/translate-updates.mjs + gen-lang-pages.mjs feed them).
  { name: "I18N-MAPS", re: /\/\* === I18N-MAPS-BEGIN[\s\S]*?\/\* === I18N-MAPS-END === \*\//g },
  // index.html — the Runware AIR table written by scripts/update-runware-airs.mjs.
  { name: "RUNWARE-AIRS", re: /\/\* === RUNWARE-AIRS-BEGIN === \*\/[\s\S]*?\/\* === RUNWARE-AIRS-END === \*\//g },
];

// play.html — the whole nanoodle-js bundle written by scripts/gen-js-engine.mjs. It carries the
// LIBRARY's copy of resizePlan / MP4CAT / prompt caps. Counting it would book the library as hand
// duplication.
//
// The block is identified by its data-hash, NOT by a lazy `<script ...>...</script>` match. play.html
// also contains the STRING LITERAL that the export builder uses to re-emit the tag:
//   const engTag = engText ? '<script id="njs-engine">\n' + ...
// Every `</script` inside RUNTIME_JS is written escaped as `<\/script`, so a lazy match that starts
// on that literal does not close until the LAST real `</script>` in the file. That blanked 2,398
// lines of hand-written player code — boot(), the export builder, the balance cache, the
// __appready__ handoff, the model picker — and made a one-sided edit anywhere in them invisible.
//
// scripts/gen-js-engine.mjs:165 writes data-hash = sha256(bundle).slice(0,16). We re-derive it. A
// quoted string inside RUNTIME_JS cannot forge a body whose sha256 matches its own declared hash.
const NJS_BLOCK = /<script id="njs-engine" data-hash="([0-9a-f]{16})">\n([\s\S]*?)\n<\/script>/g;

const blanks = (m) => "\n".repeat((m.match(/\n/g) || []).length);

function collectGenerated(text) {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.length > MIN_LEN) GEN_LINES.add(hash(t));
  }
}

function blankGenerated(src, file) {
  let out = src.replace(NJS_BLOCK, (m, declared, body) => {
    const actual = hash16(body);
    if (actual !== declared) {
      fail(
        `${file}: the generated njs-engine block does not match its own data-hash ` +
          `(declared ${declared}, content hashes to ${actual}).\n` +
          `      That block is generated — it must not be hand edited. Regenerate it:\n` +
          `        node scripts/gen-js-engine.mjs`
      );
      return m; // leave it in place; the guard is failing anyway
    }
    collectGenerated(body);
    return blanks(m);
  });
  for (const g of MARKED) {
    out = out.replace(g.re, (m) => {
      collectGenerated(m);
      return blanks(m);
    });
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
  const lines = blankGenerated(raw, file).split("\n");
  // hash -> { text, at: [1-based line numbers] }   ... at.length IS the occurrence count
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
const hash16 = hash;

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

const nIdx = (h) => IDX.sig.get(h).at.length;
const nPlay = (h) => PLAY.sig.get(h).at.length;

const occIdx = sharedNow.reduce((n, h) => n + nIdx(h), 0);
const occPlay = sharedNow.reduce((n, h) => n + nPlay(h), 0);

// A baseline entry is "<hash> <occurrences in index.html> <occurrences in play.html>". Encoding the
// counts INTO the line list means the stored digest covers them too.
const entryOf = (h) => `${h} ${nIdx(h)} ${nPlay(h)}`;
const nowEntries = sharedNow.map(entryOf);
const digest = createHash("sha256").update(nowEntries.join("\n")).digest("hex").slice(0, 32);

// ---------------------------------------------------------------------------
// 3. refresh mode
// ---------------------------------------------------------------------------
if (process.env.TWIN_DRIFT_UPDATE) {
  const next = {
    _comment: [
      "Baseline for scripts/check-twin-drift.mjs — the hand-maintained duplication between",
      "index.html and play.html. `count` is a RATCHET: extraction may lower it freely, new",
      "duplication may not raise it silently. Each `lines` entry is `<hash> <n in index.html>",
      "<n in play.html>`, where the hash is a 16-hex sha256 of the stripped line. The per-surface",
      "counts matter: a line that appears twice in one file can be edited in one place and still",
      "be present. Refresh deliberately with: TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs",
      "Ranked extraction plan: docs/twin-drift.md",
    ].join(" "),
    count: sharedNow.length,
    occurrencesIndexHtml: occIdx,
    occurrencesPlayHtml: occPlay,
    digest,
    lines: nowEntries,
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
if (!baseLines.length) {
  fail(
    `baseline has no "lines" array (${relative(ROOT, BASELINE)}) — regenerate it:\n` +
      `      TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
  report();
}
// hash -> [occurrences in index.html, occurrences in play.html]
const baseCount = new Map();
for (const raw of baseLines) {
  const [h, a, b] = String(raw).trim().split(/\s+/);
  if (!/^[0-9a-f]{16}$/.test(h || "")) continue;
  baseCount.set(h, [Number(a) > 0 ? Number(a) : 1, Number(b) > 0 ? Number(b) : 1]);
}
if (baseCount.size !== baseLines.length) {
  fail(
    `baseline has ${baseLines.length - baseCount.size} malformed "lines" entries ` +
      `(${relative(ROOT, BASELINE)}) — each must be "<16-hex hash> <n index> <n play>".\n` +
      `      Regenerate: TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
  report();
}
const baseSet = new Set(baseCount.keys());

// ---------------------------------------------------------------------------
// 4. compare
// ---------------------------------------------------------------------------
const left = [...baseSet].filter((h) => !sharedNowSet.has(h)).sort();
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

// --- 4b. departures: DRIFT / one-sided DELETION (fail) vs EXTRACTION (allowed) ---
// A baseline line can leave the shared set three ways.
//   EXTRACTION  the line left BOTH surfaces, or it moved into the generated nanoodle-js bundle.
//               That is the work we want. Allowed, note only. The baseline stores hashes, not text,
//               so a line gone from both surfaces cannot be told apart from the old half of a
//               mirrored edit — the note names both readings instead of guessing.
//   DRIFT       the line is still on both surfaces, but one side EDITED it. The keeper still carries
//               the original byte-for-byte; the mover carries a near-identical variant.
//   DELETION    the line is gone from one surface and still LIVE on the other, and nothing
//               near-identical replaced it. The code did not move — one engine stopped doing it and
//               the other did not. Calling that "deduplication" was a lie: it IS drift.
const drifted = [];
const removed = [];
let extracted = 0;
let vanished = 0;

if (left.length > MAX_CLASSIFY) {
  fail(
    `${left.length} baseline lines left the shared set (baseline count ${baseline.count}, now ${sharedNow.length}).\n` +
      `      That is too large a move to attribute line by line. Review the diff, then refresh:\n` +
      `        TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
} else {
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
    if (cand) { drifted.push({ keeper, mover, text, at, cand }); continue; }
    if (GEN_LINES.has(h)) { extracted++; continue; } // moved into the generated bundle
    removed.push({ keeper, mover, text, at });
  }
}

// --- 4c. OCCURRENCE counts: a line can stay "present" and still drift ------
// Membership by presence is not enough. 74 of the 893 shared lines appear more than once inside a
// surface (28 in index.html, 65 in play.html).
// Editing 1 of 2 identical copies in index.html leaves the hash present, so nothing leaves the
// shared set — and the pricing resolver's per_duration branch is one of those lines. Counts may only
// go DOWN, and only on both surfaces together.
const dropped = [];
const rose = [];
for (const h of sharedNow) {
  const was = baseCount.get(h);
  if (!was) continue; // entered the set — handled by 4a
  const dI = nIdx(h) - was[0];
  const dP = nPlay(h) - was[1];
  if (dI === 0 && dP === 0) continue;
  if (dI > 0 || dP > 0) { rose.push({ h, was, now: [nIdx(h), nPlay(h)] }); continue; }
  if (dI < 0 && dP < 0) continue; // both surfaces lost a copy together — mirrored, allowed
  const mover = dI < 0 ? IDX : PLAY;
  const keeper = dI < 0 ? PLAY : IDX;
  dropped.push({ h, was, now: [nIdx(h), nPlay(h)], mover, keeper, text: IDX.sig.get(h).text });
}

// --- 4d. emit ---------------------------------------------------------------
if (extracted || vanished) {
  const bits = [];
  if (vanished) bits.push(`${vanished} left both surfaces (extraction, or the old half of a mirrored edit)`);
  if (extracted) bits.push(`${extracted} moved into the generated bundle`);
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

if (removed.length) {
  const shown = removed.slice(0, 12).map((d, i) => {
    return (
      `      ${i + 1}. gone from ${d.mover.file}, still live at ${d.keeper.file}:${d.at}\n` +
      `         ${clip(d.text)}`
    );
  });
  fail(
    `ONE-SIDED DELETION — ${removed.length} line(s) left one surface and are still live on the other.\n` +
      `      Nothing near-identical replaced them, so this is not extraction: 1 engine stopped doing\n` +
      `      the work and the other still does it. Delete the twin too, or put the line back.\n` +
      shown.join("\n") +
      (removed.length > shown.length ? `\n      … and ${removed.length - shown.length} more` : "") +
      `\n      If the two surfaces are MEANT to diverge here, say so deliberately:\n` +
      `        TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
}

if (dropped.length) {
  const shown = dropped.slice(0, 12).map((d, i) => {
    const cand = bestMatch(d.text, d.mover);
    const where = d.mover.sig.get(d.h).at.join(", ");
    return (
      `      ${i + 1}. ${d.mover.file} went from ${d.was[d.mover === IDX ? 0 : 1]} to ` +
      `${d.now[d.mover === IDX ? 0 : 1]} copies; ${d.keeper.file} still has ` +
      `${d.now[d.keeper === IDX ? 0 : 1]}\n` +
      `         kept at ${d.mover.file}:${where}  ${clip(d.text)}\n` +
      (cand ? `         edited to ${d.mover.file}:${cand.line}  ${clip(cand.text)}\n` : "")
    ).trimEnd();
  });
  fail(
    `TWIN DRIFT (occurrence count) — ${dropped.length} shared line(s) lost a copy on 1 surface only.\n` +
      `      The line is still present, so the shared set did not change — but 1 of its call sites\n` +
      `      was edited or deleted and the other engine kept all of its own. Mirror it.\n` +
      shown.join("\n") +
      (dropped.length > shown.length ? `\n      … and ${dropped.length - shown.length} more` : "") +
      `\n      If the two surfaces are MEANT to diverge here, say so deliberately:\n` +
      `        TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
}

if (rose.length) {
  const shown = rose.slice(0, 12).map((d, i) => {
    const a = IDX.sig.get(d.h);
    return (
      `      ${i + 1}. index.html ${d.was[0]}→${d.now[0]}, play.html ${d.was[1]}→${d.now[1]}` +
      `  ${clip(a.text)}`
    );
  });
  fail(
    `duplication went UP: ${rose.length} shared line(s) gained a copy.\n` +
      `      The distinct count held, so the ratchet in 4a did not see it. A second copy of a line\n` +
      `      that already lives on both surfaces is a third place a future edit must reach.\n` +
      shown.join("\n") +
      (rose.length > shown.length ? `\n      … and ${rose.length - shown.length} more` : "") +
      `\n      If the duplication is deliberate, raise the ratchet on purpose:\n` +
      `        TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
}

// --- 4e. cheap sanity: the stored digest must describe the stored lines ----
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
