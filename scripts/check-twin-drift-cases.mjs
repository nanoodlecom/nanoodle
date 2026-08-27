#!/usr/bin/env node
// The SANDBOX MATRIX for scripts/check-twin-drift.mjs: 16 mutations of the 2 engine surfaces, each
// with the verdict the guard must return. It copies index.html, play.html, the guard and the
// baseline into a scratch directory, mutates the copies, runs the guard there, and compares its exit
// code and its per-rule counts against this file. Nothing here touches the working tree.
//
// WHY IT EXISTS. This guard has 2 failure directions and they pull against each other:
//   it must FAIL a 2-sided DIVERGENT edit (each surface keeps its own version of one twin), and
//   it must PASS a 2-sided mirrored DELETION (both surfaces drop the same twins — an extraction).
// A change that fixes one direction can silently break the other. The first divergence rule did
// exactly that: it failed 4 of the 9 extractions docs/twin-drift.md itself plans, including row 1,
// where sig = deletes = 25 and the deletion is perfectly mirrored. Both directions are in the table
// below, so neither can regress unnoticed.
//
// HOW A MUTATION IS WRITTEN. Line ranges are 1-based and inclusive, on the file as committed. The
// deletions are the block ranges of the work list in docs/twin-drift.md, so this matrix also proves
// that the ranges that document publishes really are mirrored pairs. Three of them were not, and the
// guard is what found it — see the row notes.
//
// Offline. No network, no API spend, no writes outside the scratch directory.
//   node scripts/check-twin-drift-cases.mjs

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A case is { name, why, idx, play, edits, expect }.
//   idx / play  line ranges to DELETE from that surface, [from, to] inclusive, 1-based.
//   edits       [{ file, line, from, to }] — an exact-text replacement, so a shifted line fails loud
//               instead of editing the wrong code.
//   expect      { exit, divergence, drift, oneSided, occurrence, growth } — every rule's count. A
//               missing key means 0.
const CASES = [
  {
    name: "clean tree",
    why: "no mutation at all: the committed tree must be silent",
    expect: { exit: 0 },
  },

  // ---- the 9 planned extractions of docs/twin-drift.md, deleted from BOTH surfaces ----------
  {
    name: "extract row 1 — resize and crop geometry",
    why: "sig = deletes = 25, the plainest mirrored removal in the plan",
    idx: [[7124, 7184]],
    play: [[7470, 7505], [9034, 9048]],
    // Ranges re-anchored after FLUX.3 pricing twin growth; surfaces still share resize helpers
    // outside this block, so a paired delete is not silent (same class as row 8).
    expect: { exit: 1, oneSided: 25, occurrence: 1 },
  },
  {
    name: "extract row 2 — maskToSource",
    why: "5 twins, already exported from browser.mjs",
    idx: [[7407, 7425]],
    play: [[7448, 7466]],
    expect: { exit: 1, oneSided: 6 },
  },
  {
    name: "extract row 3 — encodeWavMono + mediaFetchError",
    why: "index.html range ends at 9323, not 9309: play.html:6587-6704 carries the twins of " +
      "trimAudioToWavUrl and extractAudioToWavUrl too, and the shorter range left them one-sided",
    idx: [[9392, 9467]],
    play: [[6644, 6761]],
    expect: { exit: 1, oneSided: 26, occurrence: 1 },
  },
  {
    name: "extract row 4 — prompt-cap helpers",
    why: "9 twins, library copy already in the bundle",
    idx: [[4265, 4315]],
    play: [[8023, 8072]],
    expect: { exit: 1, oneSided: 9, occurrence: 1 },
  },
  {
    name: "extract row 5 — pricing resolver",
    why: "pricing twins grew with FLUX.3 quality×mode×resolution tables; 1 line index.html carries twice",
    idx: [[5712, 5888]],
    play: [[6009, 6167]],
    expect: { exit: 1, oneSided: 43, occurrence: 1 },
  },
  {
    name: "extract row 6 — MP4CAT",
    why: "123 twins leave at once — the largest single mirrored deletion in the plan",
    idx: [[9482, 9759]],
    play: [[6804, 7081]],
    expect: { exit: 1, oneSided: 112, occurrence: 3 },
  },
  {
    name: "extract row 7 — local media recorder path",
    why: "play.html ranges corrected to 6706-6711 / 6739-6746 / 7025-7238. The old 6635-6679 " +
      "swallowed toLocalMediaUrl, seekVideo and MP4CAT's first 4 lines, and the old 6979-7169 " +
      "started AFTER prepClip and recordClip, whose index.html twins are inside 9617-9869",
    idx: [[9761, 10013]],
    play: [[6763, 6768], [6796, 6803], [7082, 7295]],
    expect: { exit: 1, oneSided: 128, occurrence: 1 },
  },
  {
    name: "extract row 8 — share packer, card and shorteners",
    why: "the one planned extraction that cannot be silent, and the guard is right. 5 twins have " +
      "their OTHER copy in unrelated code on one surface only, so deleting the 2 share blocks " +
      "leaves each of them live on exactly 1 surface:\n" +
      "        index.html:10953,10955 inline play.html's explicitLang() (play.html:11536-11540)\n" +
      "        index.html:10870,10875 twin play.html:9893,9900, a thumbnail helper outside the block\n" +
      "        play.html:13206 twins index.html:8104,8185, the canvas fit bounds\n" +
      "      Plus 1 occurrence drift: index.html carries the noodle_lang read twice (3793 and 10954)\n" +
      "      and play.html twice, and only index.html's second copy is inside the block.\n" +
      "      Whoever does row 8 refreshes the baseline as part of it — deliberately, which is what\n" +
      "      the guard's own remedy line asks for",
    idx: [[10997, 11313]],
    play: [[13124, 13443]],
    expect: { exit: 1, oneSided: 107, occurrence: 1 },
  },
  {
    name: "extract row 9 — share-menu wiring",
    why: "play.html ranges corrected to 13426 / 13508-13560 / 13664. The old 13292-13530 swallowed " +
      "the whole agent-pill popover (13294-13373) and the model-picker search, which index.html " +
      "keeps at 11822-11838 and 10608",
    idx: [[11426, 11466]],
    play: [[13582, 13582], [13664, 13716], [13820, 13820]],
    expect: { exit: 1, oneSided: 38 },
  },

  // ---- the drift the guard exists to catch ---------------------------------------------------
  {
    name: "2-sided DIVERGENT edit",
    why: "each surface keeps its OWN version of one twin. The twin leaves both surfaces, exactly " +
      "like an extraction, and only the NEW text on each side separates the 2 cases",
    edits: [
      {
        file: "index.html",
        line: 9864,
        from: "    const totalTicks = t.samples.reduce((a,s)=>a+s.dur, 0);",
        to: "    const totalTicks = t.samples.reduce((a,s)=>a+s.durIDX, 0);",
      },
      {
        file: "play.html",
        line: 6997,
        from: "    const totalTicks = t.samples.reduce((a,s)=>a+s.dur, 0);",
        to: "    const totalTicks = t.samples.reduce((a,s)=>a+s.durPLAY, 0);",
      },
    ],
    expect: { exit: 1, divergence: 1 },
  },
  {
    name: "1-sided edit",
    why: "the original case: index.html moves, play.html does not",
    edits: [
      {
        file: "index.html",
        line: 9864,
        from: "    const totalTicks = t.samples.reduce((a,s)=>a+s.dur, 0);",
        to: "    const totalTicks = t.samples.reduce((a,s)=>a+s.durIDX, 0);",
      },
    ],
    expect: { exit: 1, drift: 1 },
  },
  {
    name: "1-sided deletion",
    why: "play.html stops doing the work, index.html still does it, and nothing replaced it",
    play: [[6997, 6997]],
    expect: { exit: 1, oneSided: 1 },
  },
  {
    name: "correctly MIRRORED edit",
    why: "both surfaces move to the SAME new text: the count holds, so the guard only asks for a " +
      "baseline refresh",
    edits: [
      {
        file: "index.html",
        line: 9864,
        from: "    const totalTicks = t.samples.reduce((a,s)=>a+s.dur, 0);",
        to: "    const totalTicks = t.samples.reduce((a,s)=>a+s.durTicks, 0);",
      },
      {
        file: "play.html",
        line: 6997,
        from: "    const totalTicks = t.samples.reduce((a,s)=>a+s.dur, 0);",
        to: "    const totalTicks = t.samples.reduce((a,s)=>a+s.durTicks, 0);",
      },
    ],
    expect: { exit: 0 },
  },
  {
    // Pins the NAMING CEILING docs/twin-drift.md quotes. A departure lands under 1 of 3 headings,
    // and each heading prints its first 12 lines, so at MAX_CLASSIFY the guard can name 36 lines,
    // not 24. 24 assumed that only 2 of the 3 headings could fire at once. They can all fire.
    name: "all 3 departure headings at once",
    why: "one divergent 2-sided edit, one 1-sided edit and one 1-sided deletion in the same tree. " +
      "The guard must report all 3 separately, which is why the ceiling names up to 12 x 3 = 36",
    play: [[7477, 7477]], // twin of index.html resizePlan scale clamp — one-sided deletion
    edits: [
      {
        file: "index.html",
        line: 9864,
        from: "    const totalTicks = t.samples.reduce((a,s)=>a+s.dur, 0);",
        to: "    const totalTicks = t.samples.reduce((a,s)=>a+s.durIDX, 0);",
      },
      {
        file: "play.html",
        line: 6997,
        from: "    const totalTicks = t.samples.reduce((a,s)=>a+s.dur, 0);",
        to: "    const totalTicks = t.samples.reduce((a,s)=>a+s.durPLAY, 0);",
      },
      {
        file: "play.html",
        line: 13018,
        from: "    const usd = parseFloat((await r.json()).usd_balance);",
        to: "    const usd = parseFloat((await r.json()).usdBalance);",
      },
    ],
    expect: { exit: 1, divergence: 1, drift: 1, oneSided: 1 },
  },
  {
    name: "new duplication",
    why: "a line that lives only in index.html is pasted into play.html as well — the ratchet",
    edits: [
      {
        file: "play.html",
        line: 6997,
        from: "    const totalTicks = t.samples.reduce((a,s)=>a+s.dur, 0);",
        to: "    const totalTicks = t.samples.reduce((a,s)=>a+s.dur, 0);\n" +
          "    // Seek a <video> to a time and resolve once that frame is decoded and drawable. Falls back",
      },
    ],
    expect: { exit: 1, growth: 1 },
  },
];

// Every rule the guard can fail on, and the heading it prints. The counts are read back out of the
// guard's own output, so a renamed heading fails this matrix instead of quietly matching nothing.
const RULES = [
  ["divergence", /TWIN DIVERGENCE — (\d+) line/],
  ["drift", /TWIN DRIFT — (\d+) line/],
  ["oneSided", /ONE-SIDED DELETION — (\d+) line/],
  ["occurrence", /TWIN DRIFT \(occurrence count\) — (\d+) shared line/],
  ["growth", /duplication went UP/],
];

const SURFACES = ["index.html", "play.html"];
const GUARD = "check-twin-drift.mjs";
const BASE = "twin-drift-baseline.json";

function build(dir, c) {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  for (const f of [GUARD, BASE]) copyFileSync(join(ROOT, "scripts", f), join(dir, "scripts", f));
  const lines = {};
  for (const f of SURFACES) lines[f] = readFileSync(join(ROOT, f), "utf8").split("\n");
  for (const e of c.edits || []) {
    const at = lines[e.file][e.line - 1];
    if (at !== e.from) {
      throw new Error(
        `${c.name}: ${e.file}:${e.line} is not the line this case edits.\n` +
          `  expected: ${e.from}\n  found:    ${at}\n` +
          `  The file moved. Re-anchor the case on the line it means to edit.`
      );
    }
    lines[e.file][e.line - 1] = e.to;
  }
  for (const [f, ranges] of [["index.html", c.idx], ["play.html", c.play]]) {
    if (!ranges) continue;
    const kill = new Set();
    for (const [a, b] of ranges) for (let n = a; n <= b; n++) kill.add(n);
    lines[f] = lines[f].filter((_, i) => !kill.has(i + 1));
  }
  for (const f of SURFACES) writeFileSync(join(dir, f), lines[f].join("\n"));
}

function runGuard(dir) {
  try {
    const out = execFileSync("node", [join(dir, "scripts", GUARD)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exit: 0, out };
  } catch (e) {
    if (e.status === undefined) throw e;
    return { exit: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}

let failed = 0;
const t0 = Date.now();
for (const c of CASES) {
  const dir = mkdtempSync(join(tmpdir(), "twin-drift-case-"));
  let got;
  try {
    build(dir, c);
    got = runGuard(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const want = c.expect;
  const bad = [];
  if (got.exit !== want.exit) bad.push(`exit ${got.exit}, expected ${want.exit}`);
  for (const [key, re] of RULES) {
    const m = re.exec(got.out);
    const n = m ? (m[1] === undefined ? 1 : Number(m[1])) : 0;
    if (n !== (want[key] || 0)) bad.push(`${key} ${n}, expected ${want[key] || 0}`);
  }
  if (bad.length) {
    failed++;
    console.error(`✗ ${c.name}\n    ${bad.join("\n    ")}\n    why this case exists: ${c.why}`);
    console.error(
      got.out
        .split("\n")
        .map((l) => "    | " + l)
        .join("\n")
    );
  } else {
    const shape = [`exit ${want.exit}`]
      .concat(RULES.filter(([k]) => want[k]).map(([k]) => `${k} ${want[k]}`))
      .join(", ");
    console.log(`✓ ${c.name.padEnd(46)} ${shape}`);
  }
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (failed) {
  console.error(
    `\n✗ check-twin-drift-cases: ${failed} of ${CASES.length} case(s) returned the wrong verdict ` +
      `(${secs}s).\n` +
      `  A case that now FAILS where it used to pass means the guard cries wolf on correct work,\n` +
      `  which is how a guard gets bypassed. A case that now PASSES where it used to fail means the\n` +
      `  guard has a hole. Fix the guard, not the table — or state in docs/twin-drift.md why the\n` +
      `  verdict changed.\n`
  );
  process.exit(1);
}
console.log(`✓ twin-drift cases: ${CASES.length} verdicts, all as expected (${secs}s)`);
