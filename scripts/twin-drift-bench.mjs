#!/usr/bin/env node
// Timing harness for scripts/check-twin-drift.mjs. It builds the 3 cases the RUNTIME tables quote —
// a clean tree, 200 departures that left BOTH surfaces, and 200 departures that left 1 surface —
// runs each 5 times in a scratch copy, and prints the wall and CPU range it measured, plus the load
// average the machine held. Every runtime figure in the guard header, in .githooks/pre-commit and in
// docs/twin-drift.md comes from this command.
//
// The 200 departures are the FIRST 200 baseline entries in hash order, so the case is the same on
// every machine and on every run. Every occurrence of each of those lines is deleted, because the
// guard counts occurrences, not just presence.
//
// Timings vary by machine and by load. Quote the range you measured, and say what the load average
// was while you measured it.
//
// Offline. No network, no API spend, no writes outside the scratch directory.
//   node scripts/twin-drift-bench.mjs [samples]

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, loadavg } from "node:os";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLES = Math.max(1, parseInt(process.argv[2] || "5", 10));
const DEPARTURES = 200; // the guard's MAX_CLASSIFY ceiling — 201 reports totals instead

const hash = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
const baseline = JSON.parse(readFileSync(join(ROOT, "scripts", "twin-drift-baseline.json"), "utf8"));
const doomed = new Set(
  baseline.lines
    .slice()
    .sort()
    .slice(0, DEPARTURES)
    .map((l) => String(l).slice(0, 16))
);

// The generated regions are OFF LIMITS. A line deleted from inside the njs-engine block breaks that
// block's own data-hash, and the guard then stops at that error in 0.08 s without classifying
// anything — which is how a bench measures a "200-departure" case that never ran. The regions are
// found the same way the guard finds them, and their lines are simply never deleted.
const NJS_BLOCK = /<script id="njs-engine" data-hash="([0-9a-f]{16})">\n([\s\S]*?)\n<\/script>/g;
const MARKED = [
  /\/\* === PROMPT-CAPS-BEGIN === \*\/[\s\S]*?\/\* === PROMPT-CAPS-END === \*\//g,
  /\/\* === I18N-MAPS-BEGIN[\s\S]*?\/\* === I18N-MAPS-END === \*\//g,
  /\/\* === RUNWARE-AIRS-BEGIN === \*\/[\s\S]*?\/\* === RUNWARE-AIRS-END === \*\//g,
];
const blanks = (m) => "\n".repeat((m.match(/\n/g) || []).length);

function surfaces(drop) {
  const out = {};
  for (const f of ["index.html", "play.html"]) {
    const raw = readFileSync(join(ROOT, f), "utf8");
    const lines = raw.split("\n");
    if (!drop.includes(f)) { out[f] = lines; continue; }
    let blanked = raw.replace(NJS_BLOCK, blanks);
    for (const re of MARKED) blanked = blanked.replace(re, blanks);
    const hand = blanked.split("\n");
    out[f] = lines.filter((l, i) => {
      const t = hand[i].trim();
      return !(t.length > 40 && doomed.has(hash(t)));
    });
  }
  return out;
}

function sandbox(drop) {
  const dir = mkdtempSync(join(tmpdir(), "twin-drift-bench-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  for (const f of ["check-twin-drift.mjs", "twin-drift-baseline.json"]) {
    copyFileSync(join(ROOT, "scripts", f), join(dir, "scripts", f));
  }
  const s = surfaces(drop);
  for (const f of Object.keys(s)) writeFileSync(join(dir, f), s[f].join("\n"));
  // CPU time of a CHILD process is not in the parent's process.cpuUsage(), so the child reports its
  // own: this wrapper imports the guard and writes its CPU total on the way out. The guard calls
  // process.exit(), and an "exit" listener still runs on that path.
  writeFileSync(
    join(dir, "scripts", "cpu-wrapper.mjs"),
    'import { writeFileSync } from "node:fs";\n' +
      'process.on("exit", () => {\n' +
      "  const c = process.cpuUsage();\n" +
      '  try { writeFileSync(process.argv[2], String((c.user + c.system) / 1e6)); } catch (e) {}\n' +
      "});\n" +
      'await import("./check-twin-drift.mjs");\n'
  );
  return dir;
}

function run(dir) {
  const cpuFile = join(dir, "cpu.txt");
  const t0 = process.hrtime.bigint();
  let code = 0;
  try {
    execFileSync("node", [join(dir, "scripts", "cpu-wrapper.mjs"), cpuFile], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch (e) {
    if (e.status === undefined) throw e;
    code = e.status;
  }
  const wall = Number(process.hrtime.bigint() - t0) / 1e9;
  return { wall, cpu: Number(readFileSync(cpuFile, "utf8")), code };
}

const CASES = [
  { name: "clean tree, nothing departs", drop: [] },
  { name: `${DEPARTURES} departures, gone from both`, drop: ["index.html", "play.html"] },
  { name: `${DEPARTURES} departures, gone from 1 surface`, drop: ["play.html"] },
];

const fmt = (xs) => `${Math.min(...xs).toFixed(2)}-${Math.max(...xs).toFixed(2)} s`;
console.log(`load average at start: ${loadavg().map((n) => n.toFixed(2)).join(" ")}`);
for (const c of CASES) {
  const dir = sandbox(c.drop);
  const wall = [], cpu = [];
  let code = null;
  try {
    for (let i = 0; i < SAMPLES; i++) {
      const r = run(dir);
      wall.push(r.wall);
      cpu.push(r.cpu);
      code = r.code;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    `${c.name.padEnd(38)} ${fmt(wall).padEnd(14)} wall  ${fmt(cpu).padEnd(14)} CPU  ` +
      `(${SAMPLES} samples, guard exit ${code})`
  );
}
console.log(`load average at end:   ${loadavg().map((n) => n.toFixed(2)).join(" ")}`);
