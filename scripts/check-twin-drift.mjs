#!/usr/bin/env node
// Offline guard against TWIN DRIFT between the two engine surfaces: index.html (the editor) and
// play.html (the app player + the self-contained .html export).
//
// WHY THIS EXISTS
// The two files are 26,000 lines together and they share a large body of character-for-character
// identical, HAND-MAINTAINED code — identical after a leading/trailing whitespace strip, because
// play.html nests it deeper (pricing resolver, Combine/MP4CAT remux, resize geometry, audio helpers,
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
// The SHARED SET: every distinct line that appears in both files IDENTICALLY AFTER LEADING AND
// TRAILING WHITESPACE IS STRIPPED, and that is longer than 40 characters once stripped. The strip
// is load-bearing, not cosmetic: play.html nests the same code one or two levels deeper than
// index.html, so most twins are NOT byte-identical in the files — only after the trim. Generated
// regions are blanked first, so the generated nanoodle-js bundle and the probe-written prompt-cap
// table never count as hand-maintained duplication.
// scripts/twin-drift-baseline.json stores three things per line: the hash, the per-surface
// OCCURRENCE COUNT (a line that appears twice in one surface can be edited in one place and still
// be "present"), and THE STRIPPED TEXT ITSELF. The text is what makes section 4b able to ask
// whether the two surfaces still agree about a line that left both of them.
//
// WHAT IT FAILS ON  (see section 4 for the exact rules)
//   DRIFT      — a baseline line left the shared set, or lost an occurrence on one surface only,
//                because ONE surface edited it and the other did not. The edited replacement is
//                still sitting in the file that moved. The guard names both file:line positions.
//   DELETION   — a baseline line is gone from one surface and still LIVE on the other. Nothing
//                replaced it. The code did not move; one engine simply stopped doing it.
//   DIVERGENCE — a baseline line left BOTH surfaces, and each surface now carries its OWN,
//                DIFFERENT near-identical replacement. Both engines still do the work; they now do
//                it differently. Leaving both surfaces is not proof of extraction.
//   GROWTH     — the shared-line COUNT went up, or a shared line gained an occurrence.
// THE ONE EXEMPTION, stated exactly. A departure that left BOTH surfaces prints a note instead of
// failing UNLESS all 3 of these hold: index.html carries a near-identical replacement, play.html
// carries one too, and those 2 replacements are near-identical to each other. So the exemption
// covers every departure from both surfaces where at most ONE surface kept a look-alike line. That
// includes the case where 1 engine edited the line and the other dropped it outright: the guard
// cannot fail that, and section 4b says why (a real extraction control produced exactly that shape
// by coincidence). On the tree as it stands the exemption covers 0 lines, because nothing departs;
// it is a rule about future departures, not a list of excused twins.
// A line still live on one surface always fails, even when the generated bundle happens to carry
// the same text (see section 4b). It does NOT fail on a correctly MIRRORED edit either (both
// surfaces changed together, to the SAME new text): membership moves, the count holds, the new twin
// is in the shared set, and the guard only asks for a baseline refresh.
//
// REFRESH (deliberate, same shape as the CSP golden in check-deploy-config.mjs):
//   TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs
//
// STATS (every figure docs/twin-drift.md quotes about the shared set, printed):
//   TWIN_DRIFT_STATS=1 node scripts/check-twin-drift.mjs
//
// RUNTIME. No network, no API spend. The cost that matters is the drift classifier: it scores every
// DEPARTING line against every candidate line of the surface that moved, so the worst case is a
// refactor that moves many twins at once, not a normal commit. A departure that left BOTH surfaces
// is the dearest kind, because it is scored against BOTH surfaces. MAX_CLASSIFY caps the work at
// 200 departures; 201 reports totals instead. Measured 2026-07-29 on a machine that held a load
// average of 2.9 to 3.9 throughout, 5 runs each:
//   clean tree, nothing departs          0.19-0.23 s wall  (0.19-0.23 s CPU)
//   200 departures, gone from both       3.29-3.83 s wall  (3.44-4.05 s CPU)
//   200 departures, gone from 1 surface  1.61-2.12 s wall  (1.66-2.23 s CPU)
// An earlier round measured the same 200-departure ceiling at 23-30 s, on a machine under a load
// average of 25 to 34, before bestMatch got its candidate index — it rebuilt every candidate's
// bigram profile on every call. Those runs are not repeated here; the numbers above are.
//
// index.html and play.html carry committed NUL bytes; Node readFileSync(...,"utf8") reads them fine
// (shell grep would need -a). ROOT resolves relative to THIS file so the check relocates into a
// sandbox copy.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts", "twin-drift-baseline.json");

// "Stripped" everywhere in this file means String.prototype.trim(): leading and trailing whitespace
// only. Nothing inside the line is normalised, so a changed space between two tokens is still drift.
//
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

// Caches for bestMatch(), declared here because the top-level comparison in section 4 runs before
// the helpers section and `const` does not hoist. See the helpers for what they hold.
const CAND_INDEX = new Map(); // surface.file -> candidate lines, sorted by length, bigrams prebuilt
const MATCH_MEMO = new Map(); // "<file> <text>" -> the bestMatch result for that pair

// ---------------------------------------------------------------------------
// 1. read both surfaces and blank the GENERATED regions
// ---------------------------------------------------------------------------
// Blanking keeps line numbering true: each match becomes the same number of newlines, so every
// file:line the guard prints is the real line number in the real file.
//
// The generated lines are NOT thrown away. They go into GEN_LINES, which is used for ONE thing: to
// word the note when a line leaves BOTH surfaces and the library already carries the same text.
// GEN_LINES never suppresses a failure — see section 4b for why that was wrong.

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
  // hash -> { text, at: [1-based line numbers], raw: Set of the UNSTRIPPED text of each occurrence }
  // at.length IS the occurrence count. `raw` is for the STATS block only: it is what lets the stats
  // say how many twins are identical WITH their indentation and how many are identical only after
  // the strip.
  const sig = new Map();
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.length <= MIN_LEN) return;
    const h = hash(t);
    const e = sig.get(h);
    if (e) { e.at.push(i + 1); e.raw.add(line); }
    else sig.set(h, { text: t, at: [i + 1], raw: new Set([line]) });
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

// A baseline entry is
//   "<hash> <occurrences in index.html> <occurrences in play.html> <the stripped line>".
// Encoding the counts and the text INTO the line list means the stored digest covers them too, and
// the hash is a checksum of the text: the reader re-hashes the text and refuses an entry whose hash
// does not describe it, so the stored text cannot be hand-swapped for a friendlier line.
const entryOf = (h) => `${h} ${nIdx(h)} ${nPlay(h)} ${IDX.sig.get(h).text}`;
const nowEntries = sharedNow.map(entryOf);
const digest = createHash("sha256").update(nowEntries.join("\n")).digest("hex").slice(0, 32);

// Every figure docs/twin-drift.md quotes about the shared set is printed here, so the document can
// be re-verified with one command instead of trusted:
//   TWIN_DRIFT_STATS=1 node scripts/check-twin-drift.mjs
// This only prints. It never changes what the guard fails on.
if (process.env.TWIN_DRIFT_STATS) {
  const multiIdx = sharedNow.filter((h) => nIdx(h) > 1).length;
  const multiPlay = sharedNow.filter((h) => nPlay(h) > 1).length;
  const multiEither = sharedNow.filter((h) => nIdx(h) > 1 || nPlay(h) > 1).length;
  const alsoInBundle = sharedNow.filter((h) => GEN_LINES.has(h)).length;
  const sameRaw = sharedNow.filter((h) => {
    const b = PLAY.sig.get(h).raw;
    for (const r of IDX.sig.get(h).raw) if (b.has(r)) return true;
    return false;
  }).length;
  console.log(
    `  stats: ${sharedNow.length} distinct shared lines, ${occIdx} occurrences in index.html, ` +
      `${occPlay} in play.html\n` +
      `  stats: ${multiEither} appear more than once inside a surface ` +
      `(${multiIdx} in index.html, ${multiPlay} in play.html)\n` +
      `  stats: ${sameRaw} are identical WITH their indentation; the other ${sharedNow.length - sameRaw}\n` +
      `         match only after the leading/trailing whitespace strip, because play.html nests the\n` +
      `         same code deeper\n` +
      `  stats: ${alsoInBundle} are ALSO carried by the generated njs-engine bundle while both hand\n` +
      `         copies stay live — that is why bundle text presence is not proof of extraction`
  );
}

// ---------------------------------------------------------------------------
// 3. refresh mode
// ---------------------------------------------------------------------------
if (process.env.TWIN_DRIFT_UPDATE) {
  const next = {
    _comment: [
      "Baseline for scripts/check-twin-drift.mjs — the hand-maintained duplication between",
      "index.html and play.html. `count` is a RATCHET: extraction may lower it freely, new",
      "duplication may not raise it silently. Each `lines` entry is `<hash> <n in index.html>",
      "<n in play.html> <the line>`, where the hash is a 16-hex sha256 of the stripped line and the",
      "guard re-hashes the text to prove the two agree. The per-surface counts matter: a line that",
      "appears twice in one file can be edited in one place and still be present. The text matters:",
      "without it the guard cannot tell a real extraction from a line that both surfaces replaced",
      "with DIFFERENT text. Do not hand edit this file.",
      "Refresh deliberately with: TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs",
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
// hash -> the stripped text of that line, as it stood when the baseline was written. Section 4b
// needs it: a line gone from BOTH surfaces has no text left in either file to compare against.
const baseText = new Map();
const ENTRY = /^([0-9a-f]{16}) ([1-9][0-9]*) ([1-9][0-9]*) (.+)$/;
let mismatched = 0;
for (const raw of baseLines) {
  const m = ENTRY.exec(String(raw).trimEnd());
  if (!m) continue;
  // The hash is the checksum of the text. An entry whose text does not hash to its own hash was
  // hand edited, and every rule below would then be measuring the wrong line.
  if (hash(m[4]) !== m[1]) { mismatched++; continue; }
  baseCount.set(m[1], [Number(m[2]), Number(m[3])]);
  baseText.set(m[1], m[4]);
}
if (baseCount.size !== baseLines.length) {
  fail(
    `baseline has ${baseLines.length - baseCount.size} unusable "lines" entries ` +
      `(${relative(ROOT, BASELINE)}), ${mismatched} of them because the stored text does not hash\n` +
      `      to the stored hash. Each entry must be "<16-hex hash> <n index> <n play> <the line>".\n` +
      `      Regenerate: TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
  report();
}
const baseSet = new Set(baseCount.keys());

// The ratchet number is DERIVED from the `lines` array. It is never read from the file.
// The stored digest hashes `lines` only, so a hand-raised `count:` field would otherwise lift the
// ratchet with no digest mismatch at all — and the count is the one number this guard advertises as
// a ratchet. Deriving it means the file cannot disagree with itself. The `count`,
// `occurrencesIndexHtml` and `occurrencesPlayHtml` fields stay in the JSON for a human reader, and
// the guard fails if any of them stops describing `lines`.
const baseTotal = baseSet.size;
const baseOccIdx = [...baseCount.values()].reduce((n, c) => n + c[0], 0);
const baseOccPlay = [...baseCount.values()].reduce((n, c) => n + c[1], 0);
for (const [field, stored, derived] of [
  ["count", baseline.count, baseTotal],
  ["occurrencesIndexHtml", baseline.occurrencesIndexHtml, baseOccIdx],
  ["occurrencesPlayHtml", baseline.occurrencesPlayHtml, baseOccPlay],
]) {
  if (stored === undefined) continue;
  if (Number(stored) !== derived) {
    fail(
      `baseline "${field}" says ${stored}, but its own "lines" array says ${derived} ` +
        `(${relative(ROOT, BASELINE)}) — hand edited?\n` +
        `      The guard uses the derived number, so this edit did not move the ratchet.\n` +
        `      Regenerate: TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
    );
    report();
  }
}

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

if (sharedNow.length > baseTotal) {
  const shown = enteredList(12);
  fail(
    `duplication went UP: ${baseTotal} → ${sharedNow.length} shared lines ` +
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
      `${sharedNow.length} (${baseTotal} before) — this is what a correctly MIRRORED edit\n` +
      `    looks like. Refresh the baseline so the new twins are tracked:\n` +
      `      TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs\n` +
      shown.join("\n") +
      (entered.length > shown.length ? `\n        … and ${entered.length - shown.length} more` : "")
  );
}

// --- 4b. departures: DRIFT / one-sided DELETION / DIVERGENCE (fail) vs EXTRACTION (allowed) ---
// A baseline line can leave the shared set four ways.
//   DRIFT       the line is still on both surfaces, but one side EDITED it. The keeper still carries
//               the original; the mover carries a near-identical variant.
//   DELETION    the line is gone from one surface and still LIVE on the other, and nothing
//               near-identical replaced it. The code did not move — one engine stopped doing it and
//               the other did not. Calling that "deduplication" was a lie: it IS drift.
//   DIVERGENCE  the line is gone from BOTH surfaces, and EACH surface now carries its own
//               near-identical replacement, and the 2 replacements look like each other as well.
//               Two replacements that survive that test are always DIFFERENT from each other:
//               identical replacements would be in the shared set, and candidatesOf() excludes every
//               shared line. So both engines still do the work, and they now do it differently. This
//               is the drift the guard exists to catch and it must fail. It reaches here through no
//               fault of its own — a divergent 2-sided edit does remove the twin from both files,
//               and "left both surfaces" alone cannot tell it from real extraction.
//   EXTRACTION  every other departure from both surfaces. Allowed, note only. This reading also
//               covers the old half of a correctly mirrored edit, because the new twin is shared and
//               is therefore not a candidate replacement — the note names both readings instead of
//               guessing between them.
//
// THE RULE. Leaving both surfaces is NOT what makes a departure an extraction. Leaving both
// surfaces WHILE THE TWO SURFACES STILL AGREE is. "Agree" is decided by the same near-identical
// match the DRIFT rule already uses (bestMatch, Dice over character bigrams, DRIFT_SIMILARITY), run
// once against each surface, PLUS the same test between the 2 replacements themselves. The baseline
// therefore has to store the departed line's TEXT: nothing in either file carries it any more.
//
// WHAT THAT RULE STILL LETS THROUGH, and why. The 3-way test is deliberately narrow. A departure
// where only ONE surface keeps a near-identical line does NOT fail. It looks like divergence in
// principle — 1 engine edited the work, the other stopped doing it — and an earlier draft of this
// rule failed it. Measured against a real extraction control (delete the whole MP4CAT block,
// index.html:9099-9376 and play.html:6657-6934, 123 shared lines gone from both surfaces at once),
// that draft raised a FALSE failure on 1 of the 123: the banner comment
//   /* ---- Lossless in-browser mp4 concatenation (Combine node) -------------------------------
// scored 0.840 against the unrelated surviving banner at index.html:9086
//   /* ---- in-browser video concatenation (the Combine node) ---------------------------------
// because a run of dashes carries the bigram profile and the 2 banners share their opening words.
// A guard that fails a correct extraction is a guard that gets bypassed. So a
// single-sided match alone is not enough; the 2 replacements must also look like each other, which
// is what makes them 2 versions of ONE line instead of 2 coincidences. The blind spot is real and
// docs/twin-drift.md states it.
//
// GEN_LINES IS NOT AN EXEMPTION FROM ANYTHING. Presence of the same text inside the generated
// bundle is a property of the tree TODAY, not evidence that anything moved: 131 of the 893 baseline
// lines are identical to a line already inside the bundle while BOTH hand copies are still live
// (MP4CAT, the pricing resolver, resize geometry — the library ships them too). Treating that text
// presence as "extracted" exited 0 on a one-sided deletion of live MP4CAT code, and — one level
// down — on a 2-sided DIVERGENT edit of the same line. The bundle now only sharpens the wording of
// the note on a departure that is already classified as extraction; it never suppresses a failure.
const drifted = [];
const removed = [];
const diverged = [];
let extracted = 0;
let vanished = 0;

if (left.length > MAX_CLASSIFY) {
  fail(
    `${left.length} baseline lines left the shared set (baseline count ${baseTotal}, now ${sharedNow.length}).\n` +
      `      That is too large a move to attribute line by line. Review the diff, then refresh:\n` +
      `        TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
} else {
  for (const h of left) {
    const inIdx = IDX.sig.get(h);
    const inPlay = PLAY.sig.get(h);
    if (inIdx && inPlay) continue; // still shared — cannot happen, guard anyway
    if (!inIdx && !inPlay) {
      // Gone from BOTH hand-maintained surfaces. Extraction ONLY IF the surfaces still agree.
      const was = baseText.get(h);
      const repIdx = bestMatch(was, IDX);
      const repPlay = bestMatch(was, PLAY);
      if (repIdx && repPlay) {
        const pair = dice(bigrams(repIdx.text), bigrams(repPlay.text));
        if (pair >= DRIFT_SIMILARITY) { diverged.push({ was, repIdx, repPlay, pair }); continue; }
      }
      if (GEN_LINES.has(h)) extracted++;
      else vanished++;
      continue;
    }
    const keeper = inIdx ? IDX : PLAY;
    const mover = inIdx ? PLAY : IDX;
    const text = (inIdx || inPlay).text;
    const at = (inIdx || inPlay).at[0];
    const cand = bestMatch(text, mover);
    if (cand) { drifted.push({ keeper, mover, text, at, cand }); continue; }
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
  if (extracted) bits.push(`${extracted} left both surfaces and are carried by the generated bundle`);
  notes.push(
    `${bits.join(", ")} — none of them left a near-identical\n` +
      `    replacement on BOTH surfaces, so the surfaces still agree. The ratchet allows this. Lower\n` +
      `    the baseline when convenient:\n` +
      `    TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
}

if (diverged.length) {
  const shown = diverged.slice(0, 12).map((d, i) => {
    const pad = Math.max(`index.html:${d.repIdx.line}`.length, `play.html:${d.repPlay.line}`.length);
    return (
      `      ${i + 1}. both surfaces dropped:  ${clip(d.was)}\n` +
      `         ${`index.html:${d.repIdx.line}`.padEnd(pad)}  ${clip(d.repIdx.text)}\n` +
      `         ${`play.html:${d.repPlay.line}`.padEnd(pad)}  ${clip(d.repPlay.text)}`
    );
  });
  fail(
    `TWIN DIVERGENCE — ${diverged.length} line(s) left BOTH surfaces, but the surfaces no longer\n` +
      `      AGREE: each one replaced the line with its OWN different version. Leaving both surfaces\n` +
      `      is only extraction when the 2 surfaces still agree afterwards. Both engines still run\n` +
      `      this code, and they now run it differently. Mirror the edit, or delete the twin on both\n` +
      `      surfaces.\n` +
      shown.join("\n") +
      (diverged.length > shown.length ? `\n      … and ${diverged.length - shown.length} more` : "") +
      `\n      If the two surfaces are MEANT to diverge here, say so deliberately:\n` +
      `        TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
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
    `TWIN DRIFT — ${drifted.length} line(s) that both engines carried identically now differ.\n` +
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
// The digest is REQUIRED, not optional. `if (baseline.digest && …)` made deleting the field a way to
// switch the whole check off, which is the same hand-edit escape the derived `count` closes: inflate
// a line's stored occurrence counts, move `occurrencesIndexHtml` and `occurrencesPlayHtml` to match,
// drop `digest`, and the ratchet rises on a clean tree with exit 0. A missing digest is an error.
const baseDigest = createHash("sha256").update([...baseLines].sort().join("\n")).digest("hex").slice(0, 32);
if (typeof baseline.digest !== "string" || !/^[0-9a-f]{32}$/.test(baseline.digest)) {
  fail(
    `baseline has no usable "digest" field (${relative(ROOT, BASELINE)}) — it is required, because it\n` +
      `      is the only thing that pins the per-line occurrence counts and the stored text.\n` +
      `      Regenerate: TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
} else if (baseline.digest !== baseDigest) {
  fail(
    `baseline digest does not match its own "lines" array (${relative(ROOT, BASELINE)}) — hand edited?\n` +
      `      Regenerate: TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs`
  );
}

report();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// Dice coefficient over character bigrams. Deterministic, dependency-free.
//
// A bigram is packed into 1 integer (first char << 16 | second char) and the profile of a line is
// 2 sorted typed arrays: the bigram keys, and how many times each occurs. Sorted keys let dice()
// intersect 2 profiles with a plain merge over integers. The earlier Map-of-2-character-strings
// version paid a string hash per lookup, and this is the inner loop of the whole guard.
function bigrams(s) {
  const counts = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = (s.charCodeAt(i) << 16) | s.charCodeAt(i + 1);
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  const keys = Int32Array.from(counts.keys()).sort();
  const mult = new Int32Array(keys.length);
  let size = 0;
  for (let i = 0; i < keys.length; i++) {
    mult[i] = counts.get(keys[i]);
    size += mult[i];
  }
  return { keys, mult, size };
}
function dice(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  const ak = a.keys, bk = b.keys, an = ak.length, bn = bk.length;
  let i = 0, j = 0, hits = 0;
  while (i < an && j < bn) {
    const x = ak[i], y = bk[j];
    if (x === y) {
      const m = a.mult[i], n = b.mult[j];
      hits += m < n ? m : n;
      i++; j++;
    } else if (x < y) i++;
    else j++;
  }
  return (2 * hits) / (a.size + b.size);
}

// Candidate index, built ONCE per surface.
//
// bestMatch used to rebuild the bigram map of every candidate line on every call, so the cost was
// O(departures x lines-in-the-mover x line-length). A clean tree never sees it, because nothing
// departs. A big mirrored-but-not-quite refactor does: at the MAX_CLASSIFY ceiling of 200
// departures the guard took 23-30 s while the header promised "well under 2 seconds". It was
// bounded, not hung, but that is the wrong surprise to hand a developer mid-refactor.
// Building each candidate's bigram profile once, and sorting the candidates by length so the length
// band becomes a binary-searched slice, took the same case to seconds instead of half a minute. The
// classification output is byte-identical before and after. RUNTIME in the header has the numbers
// this branch measured.
function candidatesOf(mover) {
  let list = CAND_INDEX.get(mover.file);
  if (list) return list;
  list = [];
  for (const [h, e] of mover.sig) {
    // A shared line is a twin in its own right, not the replacement we are hunting.
    if (sharedNowSet.has(h)) continue;
    list.push({ text: e.text, line: e.at[0], len: e.text.length, grams: bigrams(e.text) });
  }
  list.sort((x, y) => x.len - y.len || x.line - y.line);
  CAND_INDEX.set(mover.file, list);
  return list;
}

// First index in the length-sorted list whose len >= target.
function lowerBound(list, target) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].len < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Find the line in `mover` that looks like an edited copy of `text`.
// A candidate must not itself be in the shared set and must be within a plausible length band of
// the original. Results are memoised: the occurrence-drift report asks for the same match again.
function bestMatch(text, mover) {
  const key = mover.file + "\u0000" + text;
  if (MATCH_MEMO.has(key)) return MATCH_MEMO.get(key);
  const aGrams = bigrams(text);
  const list = candidatesOf(mover);
  const hi = text.length * 1.7;
  let best = null;
  for (let i = lowerBound(list, text.length * 0.6); i < list.length && list[i].len <= hi; i++) {
    const c = list[i];
    const r = dice(aGrams, c.grams);
    if (r < DRIFT_SIMILARITY) continue;
    if (!best || r > best.ratio || (r === best.ratio && c.line < best.line)) {
      best = { ratio: r, text: c.text, line: c.line };
    }
  }
  MATCH_MEMO.set(key, best);
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
