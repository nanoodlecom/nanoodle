#!/usr/bin/env node
// Recompute the "Ranked blocks" and "The work list, in order" tables in docs/twin-drift.md.
//
// WHY THIS IS A SCRIPT. The tables carry 3 different per-block numbers and they were hand written.
// Hand arithmetic put 2 incompatible definitions in the same table: the prose defined the running
// baseline as "893 minus the lines whose every occurrence, on both surfaces, sits inside the block",
// while the column actually subtracted the `sig` number. The 2 rules disagree wherever a twin has an
// occurrence outside the quoted ranges, which is 3 of the 9 rows. This script owns both columns now.
//
// THE DEFINITIONS, one each, and no other rule is used:
//   sig             distinct shared lines with at least 1 occurrence inside the block's index.html
//                   range AND at least 1 occurrence inside its play.html range. It measures how much
//                   of the shared set the block TOUCHES. It is not a deletion count.
//   deletes         distinct shared lines whose EVERY occurrence in index.html and EVERY occurrence
//                   in play.html sits inside the block's ranges. Only these leave the shared set
//                   when the block is deleted; a line with a copy outside the ranges survives.
//   new             this row's `deletes` minus everything the rows above it already deleted.
//   baseline after  the shared-line count minus the running union of `new`.
//
// The shared set itself comes from scripts/check-twin-drift.mjs's baseline, so this script and the
// guard cannot drift apart: it reads the SAME per-line entries the guard pins, and it re-derives
// every occurrence position from index.html and play.html with the same generated-region blanking.
//
// Offline. No network, no API spend.
//   node scripts/twin-drift-worklist.mjs

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_LEN = 40;
const hash = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);

// Same blanking as the guard. Kept in step by the assertion at the bottom: the shared set this
// script derives must equal the baseline the guard pins, line for line.
const NJS_BLOCK = /<script id="njs-engine" data-hash="([0-9a-f]{16})">\n([\s\S]*?)\n<\/script>/g;
const MARKED = [
  /\/\* === PROMPT-CAPS-BEGIN === \*\/[\s\S]*?\/\* === PROMPT-CAPS-END === \*\//g,
  /\/\* === I18N-MAPS-BEGIN[\s\S]*?\/\* === I18N-MAPS-END === \*\//g,
  /\/\* === RUNWARE-AIRS-BEGIN === \*\/[\s\S]*?\/\* === RUNWARE-AIRS-END === \*\//g,
];
const blanks = (m) => "\n".repeat((m.match(/\n/g) || []).length);

function surface(file) {
  let src = readFileSync(join(ROOT, file), "utf8");
  src = src.replace(NJS_BLOCK, (m) => blanks(m));
  for (const re of MARKED) src = src.replace(re, (m) => blanks(m));
  const at = new Map(); // hash -> [1-based line numbers]
  src.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t.length <= MIN_LEN) return;
    const h = hash(t);
    if (at.has(h)) at.get(h).push(i + 1);
    else at.set(h, [i + 1]);
  });
  return at;
}

const IDX = surface("index.html");
const PLAY = surface("play.html");
const shared = [...IDX.keys()].filter((h) => PLAY.has(h));

// The contiguity figure the document opens with: how many of the shared lines sit in a run of 4 or
// more, counted on index.html line numbers, with at most 1 non-shared line inside a run. Printed
// here so that "reproduce every number" is true of that sentence too.
{
  const pos = [];
  for (const h of shared) for (const n of IDX.get(h)) pos.push({ n, h });
  pos.sort((a, b) => a.n - b.n);
  const runs = [];
  let cur = [pos[0]];
  for (let i = 1; i < pos.length; i++) {
    if (pos[i].n - pos[i - 1].n <= 2) cur.push(pos[i]);
    else { runs.push(cur); cur = [pos[i]]; }
  }
  runs.push(cur);
  const big = runs.filter((r) => r.length >= 4);
  const inBig = new Set();
  for (const r of big) for (const p of r) inBig.add(p.h);
  console.log(
    `contiguity: ${inBig.size} of the ${shared.length} shared lines sit in ${big.length} runs of 4 ` +
      `or more\n            (index.html line numbers, at most 1 non-shared line inside a run); ` +
      `${shared.length - inBig.size} are scattered\n`
  );
}

// Line ranges are inclusive, from docs/twin-drift.md. A block may quote more than 1 range per file.
const BLOCKS = [
  { row: 1, name: "Resize and crop geometry", idx: [[6948, 7008]], play: [[7342, 7377], [8833, 8847]] },
  // play.html's maskToSource is 7320-7338. docs/twin-drift.md used to quote 7296-7309 for it, which
  // is audioInputPart — the block-6 range lists are not in the same order on the 2 surfaces, and the
  // work list copied the wrong one. With the wrong range this row measured sig 0.
  { row: 2, name: "`maskToSource`", idx: [[7231, 7249]], play: [[7320, 7338]] },
  // index.html's range used to end at 9201. play.html:6516-6633 also carries the twins of
  // trimAudioToWavUrl and extractAudioToWavUrl (index.html:9202-9215), so the short range deleted
  // them from play.html only. scripts/check-twin-drift-cases.mjs holds the proof.
  { row: 3, name: "`encodeWavMono` + `mediaFetchError`", idx: [[9140, 9215]], play: [[6516, 6633]] },
  { row: 4, name: "Prompt-cap helpers", idx: [[4203, 4253]], play: [[7880, 7929]] },
  { row: 5, name: "Pricing resolver", idx: [[5591, 5735]], play: [[5929, 6058]] },
  { row: 6, name: "MP4CAT", idx: [[9230, 9507]], play: [[6676, 6953]] },
  // play.html used to read 6635-6679 + 6979-7169. 6635-6679 swallowed toLocalMediaUrl, seekVideo and
  // MP4CAT's opening 4 lines, none of which index.html:9509-9761 holds; 6979-7169 started AFTER
  // prepClip and recordClip (6954-6994), which index.html:9509-9761 does hold.
  { row: 7, name: "Local media recorder path", idx: [[9509, 9761]], play: [[6635, 6640], [6668, 6675], [6954, 7167]] },
  { row: 8, name: "Share packer, card and shorteners", idx: [[10745, 11061]], play: [[12834, 13153]] },
  // play.html used to read 13292-13530, which swallowed the whole agent-pill popover (13294-13373)
  // and the model-picker search — code index.html keeps at 11714-11730 and 10500.
  { row: 9, name: "Share-menu wiring", idx: [[11174, 11214]], play: [[13292, 13292], [13374, 13426], [13530, 13530]] },
];

const inside = (n, ranges) => ranges.some(([a, b]) => n >= a && n <= b);
const anyInside = (list, ranges) => list.some((n) => inside(n, ranges));
const allInside = (list, ranges) => list.every((n) => inside(n, ranges));

for (const b of BLOCKS) {
  b.sig = shared.filter((h) => anyInside(IDX.get(h), b.idx) && anyInside(PLAY.get(h), b.play)).length;
  b.deletes = shared.filter((h) => allInside(IDX.get(h), b.idx) && allInside(PLAY.get(h), b.play));
}

const gone = new Set();
let after = shared.length;
const rows = [];
for (const b of BLOCKS) {
  const fresh = b.deletes.filter((h) => !gone.has(h));
  for (const h of fresh) gone.add(h);
  after -= fresh.length;
  rows.push({ ...b, new: fresh.length, after, overlap: b.deletes.length - fresh.length });
}

console.log(`shared set: ${shared.length} distinct lines\n`);
console.log("| # | Block | sig | deletes | new | Baseline after |");
console.log("|---|-------|-----|---------|-----|----------------|");
for (const r of rows) {
  console.log(`| ${r.row} | ${r.name} | ${r.sig} | ${r.deletes.length} | ${r.new} | ${r.after} |`);
}

const rowsWhereSigDiffers = rows.filter((r) => r.sig !== r.deletes.length);
console.log(
  `\nrows where sig != deletes (a twin has a copy outside the quoted ranges): ` +
    (rowsWhereSigDiffers.map((r) => `${r.row} (${r.sig} vs ${r.deletes.length})`).join(", ") || "none")
);
const overlapping = rows.filter((r) => r.overlap);
console.log(
  `rows that overlap an earlier row: ` +
    (overlapping.map((r) => `${r.row} (${r.overlap} line(s) already deleted)`).join(", ") || "none")
);
const first6 = rows[5].after;
console.log(
  `rows 1-6 together: ${shared.length - first6} lines, ${shared.length} down to ${first6}`
);

// The shared set here must be the set the guard pins. If this ever prints a mismatch, one of the 2
// blanking copies moved and the table below is measuring a different repo than the guard.
const BASELINE = join(ROOT, "scripts", "twin-drift-baseline.json");
if (existsSync(BASELINE)) {
  const pinned = JSON.parse(readFileSync(BASELINE, "utf8")).lines.map((l) => String(l).slice(0, 16));
  const a = new Set(shared), b = new Set(pinned);
  const only = [...a].filter((h) => !b.has(h)).length + [...b].filter((h) => !a.has(h)).length;
  console.log(
    only
      ? `\nWARNING: ${only} line(s) differ between this script and scripts/twin-drift-baseline.json`
      : `\nagrees with scripts/twin-drift-baseline.json: ${pinned.length} lines, no difference`
  );
}
