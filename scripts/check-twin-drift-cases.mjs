#!/usr/bin/env node
// Offline sandbox matrix for the twin-drift guard: mirrored extractions must not be mistaken
// for divergent edits; one-sided changes, occurrence loss and new duplication must still fail.
// Mutations resolve named source blocks and exact lines, never historical line numbers. Added
// UI, translations or generated bundles cannot move a mutation into unrelated runtime code.
// The nine extraction rows follow the semantic blocks described in docs/twin-drift.md; that
// document's dated line ranges are deliberately not used as executable coordinates.
// No network or API spend. All mutated copies live in a disposable scratch directory.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fn = (name) => ({ fn: name });
const through = (start, end) => ({ start: fn(start), end: fn(end) });
const one = (text) => ({ text });
const TICKS = "    const totalTicks = t.samples.reduce((a,s)=>a+s.dur, 0);";
const ESCAPE = 'document.addEventListener("keydown", (e)=>{ if(e.key==="Escape" && !$("sharemenu").hidden){ e.stopPropagation(); closeShareMenu(); } }, true);';
const URL_CLICK = '$("sm-url").onclick = ()=> $("sm-url").select();';
const SERVICE_CLICK = 'document.querySelectorAll("#sharemenu .sm-svc button").forEach(btn => btn.onclick = async ()=>{';
const tickEdit = (file, suffix) => ({ file, from: TICKS, to: TICKS.replace("s.dur,", "s.dur" + suffix + ",") });

// Expected counts are explicit. A newly surviving copy outside an extraction still requires a
// deliberate review here; anchoring fixes position drift, it does not waive semantic changes.
// Re-anchoring proof (Sept 2026): independently counting exact shared lines before/after these
// complete semantic slices removes 24/5/25/9/92/123/66/133/24 twins in rows 1..9. Rows 1..7 and 9
// leave no one-sided lines or occurrence loss. Row 8 leaves exactly the five copies named below.
// The old numeric windows cut unrelated code (even partial function bodies); their expectations
// of 25..128 one-sided deletions did not test mirrored extraction at all.
const CASES = [
  { name: "clean tree", why: "the unmodified committed surfaces must be silent", expect: { exit: 0 } },
  {
    name: "extract row 1 — resize and crop geometry",
    why: "remove both resize functions and both scaled-image/alpha helpers, wherever they live",
    idx: [fn("resizePlan"), fn("resizeCropImage"), fn("scaledDataURL"), fn("canvasHasAlpha")],
    play: [fn("resizePlan"), fn("resizeCropImage"), fn("scaledDataUrl"), fn("canvasHasAlpha")],
    expect: { exit: 0 },
  },
  {
    name: "extract row 2 — maskToSource",
    why: "remove the complete mask compositor from both hand-maintained runtimes",
    idx: [fn("maskToSource")], play: [fn("maskToSource")],
    expect: { exit: 0 },
  },
  {
    name: "extract row 3 — encodeWavMono + mediaFetchError",
    why: "include trimAudioToWavUrl and extractAudioToWavUrl on both surfaces",
    idx: [through("mediaFetchError", "extractAudioToWavUrl")],
    play: [through("mediaFetchError", "extractAudioToWavUrl")],
    expect: { exit: 0 },
  },
  {
    name: "extract row 4 — prompt-cap helpers",
    why: "remove learned-cap handling through error-cap parsing, excluding the generated table",
    idx: [through("learnPromptCap", "promptCapFromError")],
    play: [through("learnPromptCap", "promptCapFromError")],
    expect: { exit: 0 },
  },
  {
    name: "extract row 5 — pricing resolver",
    why: "remove the resolution/duration/video/chat/audio price resolvers on both surfaces",
    idx: [through("pickByRes", "audioUnitUsd")], play: [through("pickByRes", "audioUnitUsd")],
    expect: { exit: 0 },
  },
  {
    name: "extract row 6 — MP4CAT",
    why: "delete the entire hand-maintained remux IIFE and its banner; leave generated bundles intact",
    idx: [{ mp4cat: true }], play: [{ mp4cat: true }],
    expect: { exit: 0 },
  },
  {
    name: "extract row 7 — local media recorder path",
    why: "remove both recorder pipelines through audio polling, without swallowing seekVideo or MP4CAT",
    idx: [through("pickVideoMime", "pollAudio")],
    play: [fn("pickVideoMime"), fn("loadVideoMeta"), through("prepClip", "pollAudio")],
    expect: { exit: 0 },
  },
  {
    name: "extract row 8 — share packer, card and shorteners",
    why: "some share helper lines also live outside these blocks; those surviving copies must still be reported",
    // Surviving twins: canvas bounds, drawImage, img.src fallback, SUP languages and its return.
    // The noodle_lang read loses one editor copy; the player's copies are outside its share block.
    idx: [through("shrinkShareMedia", "closeShareMenu")],
    play: [through("shrinkShareMedia", "shortenWith")],
    expect: { exit: 1, oneSided: 5, occurrence: 1 },
  },
  {
    name: "extract row 9 — share-menu wiring",
    why: "remove only share URL/button/social/Escape handlers; keep agent and model-picker handlers",
    idx: [{ start: one(URL_CLICK), end: one(ESCAPE) }],
    play: [one(URL_CLICK), { start: one(SERVICE_CLICK), before: one('$("export").onclick = doExport;') }, one(ESCAPE)],
    expect: { exit: 0 },
  },
  {
    name: "2-sided DIVERGENT edit",
    why: "each surface keeps its own new version of the same twin",
    edits: [tickEdit("index.html", "IDX"), tickEdit("play.html", "PLAY")],
    expect: { exit: 1, divergence: 1 },
  },
  {
    name: "1-sided edit", why: "the editor moves and the player does not",
    edits: [tickEdit("index.html", "IDX")], expect: { exit: 1, drift: 1 },
  },
  {
    name: "1-sided deletion", why: "the player loses one live twin and nothing replaces it",
    play: [one(TICKS)], expect: { exit: 1, oneSided: 1 },
  },
  {
    name: "correctly MIRRORED edit", why: "both surfaces move to the same new text",
    edits: [tickEdit("index.html", "Ticks"), tickEdit("play.html", "Ticks")], expect: { exit: 0 },
  },
  {
    name: "all 3 departure headings at once",
    why: "divergent edit, one-sided edit and one-sided deletion must be reported separately",
    play: [one("if(scale>1) scale = 1;                                   // never upscale")],
    edits: [
      tickEdit("index.html", "IDX"), tickEdit("play.html", "PLAY"),
      { file: "play.html", from: "    const usd = parseFloat((await r.json()).usd_balance);",
        to: "    const usd = parseFloat((await r.json()).usdBalance);" },
    ],
    expect: { exit: 1, divergence: 1, drift: 1, oneSided: 1 },
  },
  {
    name: "new duplication", why: "a previously editor-only line is pasted into the player",
    edits: [{ file: "play.html", from: TICKS, to: TICKS + "\n" +
      "    // Seek a <video> to a time and resolve once that frame is decoded and drawable. Falls back" }],
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

function anchors(source, file) {
  // Same generated bundle boundary as the guard, preserving line positions. A generated copy
  // must never satisfy a hand-runtime mutation merely because its implementation matches.
  const lines = source.replace(/<script id="njs-engine" data-hash="[0-9a-f]{16}">\n[\s\S]*?\n<\/script>/g,
    (s) => "\n".repeat(s.split("\n").length - 1)).split("\n");
  function unique(test, label) {
    const found = lines.flatMap((line, i) => test(line) ? [i] : []);
    if (found.length !== 1) throw new Error(`${file}: expected one ${label}, found ${found.length}; review the intended mutation boundary`);
    return found[0];
  }
  function endAt(start, closing) {
    const end = lines.findIndex((line, i) => i >= start && line === closing);
    if (end < start) throw new Error(`${file}:${start + 1}: closing boundary ${JSON.stringify(closing)} not found`);
    return end;
  }
  function range(spec) {
    if (spec.text) {
      const at = unique((line) => line.trim() === spec.text.trim(), JSON.stringify(spec.text));
      return [at, at];
    }
    if (spec.fn) {
      const re = new RegExp("^\\s*(?:async )?function " + spec.fn + "\\(");
      const start = unique((line) => re.test(line), "function " + spec.fn);
      // These named top-level helpers close at their declaration's indentation. Requiring that
      // exact closing line avoids swallowing the following function when translations move.
      if (lines[start].trimEnd().endsWith("}")) return [start, start];
      const indent = /^\s*/.exec(lines[start])[0];
      return [start, endAt(start + 1, indent + "}")];
    }
    if (spec.mp4cat) {
      const start = unique((line) => line.startsWith("/* ---- Lossless in-browser mp4 concatenation"), "MP4CAT banner");
      return [start, endAt(start + 1, "})();")];
    }
    const [start] = range(spec.start);
    const end = spec.before ? range(spec.before)[0] - 1 : range(spec.end)[1];
    if (end < start) throw new Error(`${file}: reversed semantic mutation range ${start + 1}..${end + 1}`);
    return [start, end];
  }
  return range;
}

function build(dir, c) {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  for (const f of [GUARD, BASE]) copyFileSync(join(ROOT, "scripts", f), join(dir, "scripts", f));
  const lines = {};
  const rangesFor = {};
  for (const f of SURFACES) {
    const source = readFileSync(join(ROOT, f), "utf8");
    lines[f] = source.split("\n");
    rangesFor[f] = anchors(source, f);
  }
  for (const e of c.edits || []) {
    const [pos] = rangesFor[e.file](one(e.from));
    const at = lines[e.file][pos];
    if (at !== e.from) {
      throw new Error(
        `${c.name}: ${e.file}:${pos + 1} is not the line this case edits.\n` +
          `  expected: ${e.from}\n  found:    ${at}\n` +
          `  The file moved. Re-anchor the case on the line it means to edit.`
      );
    }
    lines[e.file][pos] = e.to;
  }
  for (const [f, ranges] of [["index.html", c.idx], ["play.html", c.play]]) {
    if (!ranges) continue;
    const kill = new Set();
    for (const spec of ranges) {
      const [a, b] = rangesFor[f](spec);
      for (let n = a; n <= b; n++) kill.add(n);
    }
    lines[f] = lines[f].filter((_, i) => !kill.has(i));
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
      `  guard has a hole. Review the named boundaries and the intended semantic change; never\n` +
      `  replace expected counts merely with whatever the guard happened to report.\n`
  );
  process.exit(1);
}
console.log(`✓ twin-drift cases: ${CASES.length} verdicts, all as expected (${secs}s)`);
