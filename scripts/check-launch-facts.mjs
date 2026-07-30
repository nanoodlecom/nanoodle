#!/usr/bin/env node
// Keep the launch drafts in growth/ true.
//
// These files are paste-ready copy for public venues (Hacker News, Product Hunt,
// AlternativeTo, r/mcp). A wrong figure in them is not a typo — a human pastes it
// in public and it gets quoted back. That happened: the r/mcp draft sat for 11
// days claiming a sequencing gate that had already cleared, three drafts claimed
// package versions two releases old, and one revision claimed the 20% markup on a
// paid MCP call goes to the workflow's author when no published workflow claims
// it. Nothing read those files, so nothing caught it.
//
// This guard reads them. It is offline, spends nothing, and asserts only figures
// it can derive from this repo or check for internal agreement:
//
//   1. versions   — every X.Y.Z in a launch file is one of the versions the
//                   checklist's re-check block pins, or the sibling
//                   nanoodle-mcp checkout's own version, or sits on a line
//                   marked as history.
//   2. counts     — every "<n> workflows/graphs/examples" claim equals the
//                   number of entries in index.html's EXAMPLES array, which
//                   sync-examples.mjs already pins to awesome-noodles and which
//                   is the same set mcp.nanoodle.com serves.
//   3. repos      — every "<n> public repos" claim agrees with the others and is
//                   at least the number of org repos README's ecosystem table
//                   links to.
//   4. dates      — the re-check block's verification dates agree with each
//                   other and with the header date.
//   5. retired    — sentences this repo has already proved false cannot come
//                   back.
//   6. one home   — a post body lives in launch-checklist.md and nowhere else,
//                   so a correction is made once.
//
// A line counts as HISTORY (its figures are exempt) when it carries one of the
// markers below — that is how a "what the old copy said" table records a stale
// figure on purpose:
//
//   said · Old copy · (this draft, · not this draft
//
// Usage: node scripts/check-launch-facts.mjs
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECKLIST = "growth/launch-checklist.md";
// The paste home first; the four drafts point at it and hold framing only.
const LAUNCH_FILES = [
  CHECKLIST,
  "growth/show-hn-draft.md",
  "growth/product-hunt-draft.md",
  "growth/launch-alternativeto.md",
  "growth/2026-07-17-ecosystem-shares.md",
  "growth/shares.md",
];
const DRAFTS = LAUNCH_FILES.filter((f) => f !== CHECKLIST);

const HISTORY_MARKERS = [/\bsaid\b/i, /Old copy/i, /\(this draft,/i, /not this draft/i];
const isHistory = (line) => HISTORY_MARKERS.some((re) => re.test(line));

const fail = [];
const bad = (file, lineNo, msg) => fail.push(`${file}:${lineNo}: ${msg}`);

/**
 * Every claim in these files is hand-wrapped prose, so "13 public\nrepos" and
 * "the 20% goes to\nwhoever" are one claim split over two lines. A per-line scan
 * misses both. Walk a 2-line window instead and keep only matches that START on
 * the first line, so nothing is reported twice.
 *
 * `fn(text, report)` receives the window; call `report(msgFromMatch)` with a
 * match whose `.index` decides whether it belongs to this line.
 *
 * A markdown table row is scanned cell by cell. The "what the old copy said"
 * tables put the marker in the left cell, and exempting the whole row would
 * exempt the "true today" cell beside it — which is the one cell that must stay
 * honest, because that is where a figure rots next.
 */
function scanClaims(file, fn) {
  const ls = src.get(file).split("\n");
  ls.forEach((line, i) => {
    if (line.trimStart().startsWith("|")) {
      for (const cell of line.split("|")) {
        if (isHistory(cell)) continue;
        fn(cell, (m, msg) => bad(file, i + 1, msg));
      }
      return;
    }
    if (isHistory(line)) return;
    // A history line never joins the window; its figures are exempt on purpose.
    // Wrapped prose inside a blockquote or a bullet carries the marker again on
    // the continuation line ("> - The 20% goes" / ">   to whoever…"), so strip it
    // or the joined sentence never matches.
    const raw = ls[i + 1] && !isHistory(ls[i + 1]) ? ls[i + 1] : "";
    const next = raw.replace(/^[\s>*-]+/, "");
    const window = next ? `${line} ${next}` : line;
    fn(window, (m, msg) => {
      if (m.index >= line.length + 1) return; // starts on the next line; that line reports it
      bad(file, i + 1, msg);
    });
  });
}

function read(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) {
    fail.push(`${rel}: missing — the launch drafts are load-bearing; do not delete one silently`);
    return null;
  }
  return readFileSync(p, "utf8");
}

const src = new Map();
for (const f of LAUNCH_FILES) {
  const t = read(f);
  if (t !== null) src.set(f, t);
}
if (!src.has(CHECKLIST)) { report(); process.exit(fail.length ? 1 : 0); }

const lines = (f) => src.get(f).split("\n");

// ---------------------------------------------------------------- repo facts

// How many cards the 📚 Examples panel actually ships. sync-examples.mjs (gate
// 39) pins this array to one card per graph in awesome-noodles, and the hosted
// MCP server exposes that same set, so this one number backs the "ten
// ready-made graphs" and "ten workflows are published" claims at once.
function exampleCount() {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const start = html.indexOf("const EXAMPLES = [");
  if (start < 0) { fail.push("index.html: EXAMPLES array not found — this guard cannot check the example count"); return null; }
  const end = html.indexOf("\n];", start);
  if (end < 0) { fail.push("index.html: EXAMPLES array is not terminated by a line starting `];`"); return null; }
  const n = (html.slice(start, end).match(/\bslug:"/g) || []).length;
  if (!n) { fail.push("index.html: EXAMPLES array parsed to 0 cards — the guard's parse is stale, fix it before trusting it"); return null; }
  return n;
}

// Repos README's ecosystem table links to. The org can hold more (a .github
// profile repo, an experiment), so this is a floor, not the number itself.
function readmeRepoFloor() {
  const md = readFileSync(join(ROOT, "README.md"), "utf8");
  const names = new Set();
  for (const m of md.matchAll(/github\.com\/nanoodlecom\/([A-Za-z0-9._-]+)/g)) {
    if (m[1] !== "nanoodlecom") names.add(m[1]);
  }
  return names.size;
}

// The sibling nanoodle-mcp checkout, when present, is what "the repo and the
// hosted server run <version>" means. Absent, that claim is unverifiable here
// and the guard says so instead of guessing.
function mcpRepoVersion() {
  const p = resolve(ROOT, "..", "nanoodle-mcp", "package.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")).version || null; } catch { return null; }
}

const EXAMPLES = exampleCount();
const REPO_FLOOR = readmeRepoFloor();
const MCP_REPO = mcpRepoVersion();

// ------------------------------------------------------------- 1. versions

// The checklist's re-check block is the one place a human updates on launch
// morning, so it is the canonical table for every other file.
const canonical = new Map(); // label -> version
{
  const want = [
    ["npm nanoodle", /^npm view nanoodle version\s+#\s*(\d+\.\d+\.\d+)\s+on\s+(\d{4}-\d{2}-\d{2})/],
    ["npm nanoodle-mcp", /^npm view nanoodle-mcp version\s+#\s*(\d+\.\d+\.\d+)\s+on\s+(\d{4}-\d{2}-\d{2})/],
    ["PyPI nanoodle", /^pip index versions nanoodle\s+#\s*(\d+\.\d+\.\d+)\s+on\s+(\d{4}-\d{2}-\d{2})/],
  ];
  const text = src.get(CHECKLIST);
  const dates = new Set();
  for (const [label, re] of want) {
    const m = text.split("\n").map((l) => l.match(re)).find(Boolean);
    if (!m) {
      fail.push(`${CHECKLIST}: the re-check block has no "${label}" line of the form ` +
        `\`<command>  # <version> on <YYYY-MM-DD>\` — that block is what every other launch file is checked against`);
      continue;
    }
    canonical.set(label, m[1]);
    dates.add(m[2]);
  }
  // 4. dates — a half-done refresh leaves two dates in the block.
  if (dates.size > 1) {
    fail.push(`${CHECKLIST}: the re-check block carries ${dates.size} different verification dates ` +
      `(${[...dates].join(", ")}) — re-check all three on the same day or the block claims more than was checked`);
  }
  const header = text.match(/^Written (\d{4}-\d{2}-\d{2})\./m);
  if (!header) {
    fail.push(`${CHECKLIST}: no "Written <YYYY-MM-DD>." header line — the file must date its own facts`);
  } else if (dates.size === 1 && !dates.has(header[1])) {
    fail.push(`${CHECKLIST}: header says the facts were checked on ${header[1]} but the re-check block ` +
      `says ${[...dates][0]} — make them the same date`);
  }
}

const allowedVersions = new Set(canonical.values());
if (MCP_REPO) allowedVersions.add(MCP_REPO);

for (const f of LAUNCH_FILES) {
  scanClaims(f, (text, report) => {
    for (const m of text.matchAll(/\b(\d+\.\d+\.\d+)\b/g)) {
      const v = m[1];
      if (allowedVersions.has(v)) continue;
      if (/the repo and the hosted server run/i.test(text)) {
        if (!MCP_REPO) continue; // no sibling checkout to check against — see below
        report(m, `claims the nanoodle-mcp repo runs ${v}, but ../nanoodle-mcp/package.json says ${MCP_REPO}`);
        continue;
      }
      report(m, `version ${v} is not one of the versions launch-checklist.md pins ` +
        `(${[...allowedVersions].join(", ")}). Re-check it and update the checklist's re-check block first, ` +
        `or mark the line as history.`);
    }
  });
}
if (!MCP_REPO) {
  console.log("check-launch-facts: no ../nanoodle-mcp checkout — skipped the \"repo and hosted server run X\" claim.");
}

// --------------------------------------------------------------- 2. counts

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const COUNT_RE = new RegExp(
  String.raw`\b(\d+|${Object.keys(WORDS).join("|")})\s+(?:ready-made\s+|published\s+|curated\s+)*(workflows?|graphs?|examples?)\b`,
  "gi",
);
if (EXAMPLES) {
  for (const f of LAUNCH_FILES) {
    scanClaims(f, (text, report) => {
      for (const m of text.matchAll(COUNT_RE)) {
        const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1].toLowerCase()];
        if (n === EXAMPLES) continue;
        report(m, `says "${m[0]}" but index.html ships ${EXAMPLES} example graphs ` +
          `(and mcp.nanoodle.com serves that same set). Re-run sync-examples.mjs, then fix the copy.`);
      }
    });
  }
}

// ---------------------------------------------------------------- 3. repos

{
  const claims = [];
  for (const f of LAUNCH_FILES) {
    scanClaims(f, (text, report) => {
      for (const m of text.matchAll(/\b(\d+)\+?\s+public\s+repos\b/gi)) {
        claims.push({ n: Number(m[1]), raw: m[0].replace(/\s+/g, " "), report: (msg) => report(m, msg) });
      }
    });
  }
  const distinct = new Set(claims.map((c) => c.n));
  if (distinct.size > 1) {
    for (const c of claims) {
      c.report(`says "${c.raw}" while another launch file says a different number (${[...distinct].sort().join(", ")}) — they must agree`);
    }
  }
  for (const c of claims) {
    if (c.n < REPO_FLOOR) {
      c.report(`says "${c.raw}" but README's ecosystem table already links ${REPO_FLOOR} org repos — the claim is stale`);
    }
  }
}

// -------------------------------------------------------------- 5. retired

const RETIRED = [
  [/\b20%\s+goes\s+to\b/i,
    "the 20% markup only reaches a workflow author when that graph names a Nano address in x402.author " +
    "(authorFor() in nanoodle-mcp/src/gate.mjs); no published graph does, so today the server wallet keeps it. " +
    "Describe the payout as routable, never as something already happening."],
  [/authors?\s+(?:get|earn|receive)s?\s+the\s+20%/i,
    "same as above — no published workflow claims the markup yet, so this reads as a payout that is not happening."],
  [/straight\s+from\s+an\s+open\s+gallery/i,
    "the Examples panel does not fetch anything. The graphs and thumbs are mirrored from awesome-noodles by " +
    "scripts/sync-examples.mjs and shipped inline so the gallery stays fetch-free. Say mirrored and inline."],
  [/only\s+job\s+is\s+hunting\s+backticks/i,
    "scripts/check-html-js.mjs syntax-checks every inline script in the HTML. The backtick is the bug it was " +
    "written for, not its only job."],
];
// Deliberately NOT here: a bare "no signup" ban. These files also *discuss* the
// phrase ("dropped 'no signup' — inaccurate"), and a guard you have to write
// around teaches people to write around it. That rule stays a human rule, at the
// top of launch-checklist.md.
for (const f of LAUNCH_FILES) {
  scanClaims(f, (text, report) => {
    for (const [re, why] of RETIRED) {
      const m = text.match(re);
      if (m) report(m, `retired claim (${re.source}): ${why}`);
    }
  });
}

// ------------------------------------------------------------- 6. one home

// The checklist quotes each post body as a blockquote. No draft may repeat one of
// those lines: two copies of a body drift, and the 20% sentence proved it by
// needing the same correction twice.
{
  const bodyLines = new Set(
    lines(CHECKLIST)
      .filter((l) => l.startsWith("> "))
      .map((l) => l.slice(2).trim())
      .filter((l) => l.length >= 60),
  );
  for (const f of DRAFTS) {
    lines(f).forEach((line, i) => {
      if (bodyLines.has(line.trim())) {
        bad(f, i + 1, `repeats a line of the paste-ready body that lives in ${CHECKLIST}. ` +
          `Keep one copy there and point at it, so a correction is made once.`);
      }
    });
    if (!src.get(f).includes("launch-checklist.md")) {
      fail.push(`${f}: does not point at ${CHECKLIST} — a reader must be told where the paste-ready copy lives`);
    }
  }
}

// ------------------------------------------------------------------ report

function report() {
  if (!fail.length) return;
  console.error("check-launch-facts: the launch drafts state something this repo does not support.\n");
  for (const f of fail) console.error(`  ${f}`);
  console.error("\nThese files get pasted in public. Fix the copy, or fix the fact and then the copy.");
}
report();
if (fail.length) process.exit(1);
console.log(`check-launch-facts: ok — ${LAUNCH_FILES.length} launch files, ${EXAMPLES} examples, ` +
  `versions ${[...canonical].map(([k, v]) => `${k} ${v}`).join(", ")}.`);
