#!/usr/bin/env node
// The sample-run pill follows its workflow (UX review 2026-11-25).
//
// Seen live on nanoodle.com: signed out, Run the starter → #demopop ("Sample run —
// results below are canned examples…"). Close that tab → the canvas is blank, but
// the pill stayed up, promising "results below", with the undo-close notice stacked
// on top of it. Same on switching to another tab, Load, Examples or a share link.
//
// Contract (offline):
//  1. resetDescribeVersions — the one call every wholesale workflow swap makes
//     (pinned by check-version-history) — hides #demopop.
//  2. switchWorkspace, closeWorkspaceNow, restoreClosedWorkspace and
//     openWorkspaceWithGraph all reach it.
//  3. undo/redo (undoRedo) does not, so the pill survives edits inside the sample.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

function extractFn(name) {
  const start = IDX.indexOf("function " + name + "(");
  if (start === -1) return "";
  let depth = 0;
  for (let j = IDX.indexOf("{", start); j < IDX.length; j++) {
    if (IDX[j] === "{") depth++;
    else if (IDX[j] === "}" && --depth === 0) return IDX.slice(start, j + 1);
  }
  return "";
}

// 1. behavioural: run the real assignment against a fake document
const a = IDX.indexOf("window.resetDescribeVersions = ()=>{");
ok(a !== -1, "resetDescribeVersions is a block body");
let depth = 0, end = -1;
for (let j = IDX.indexOf("{", a); j < IDX.length; j++) {
  if (IDX[j] === "{") depth++; else if (IDX[j] === "}" && --depth === 0) { end = j + 1; break; }
}
const pill = { hidden: false };
const ctx = { window: {}, restored: [], document: { getElementById: (id) => (id === "demopop" ? pill : null) } };
ctx.restoreDescribeState = (s) => ctx.restored.push(s);
vm.createContext(ctx);
vm.runInContext(IDX.slice(a, end) + ";", ctx);
ctx.window.resetDescribeVersions();
ok(pill.hidden === true, "a workflow swap hides the sample-run pill");
ok(ctx.restored.length === 1 && ctx.restored[0] === null, "it still clears the describe versions");

// 2. the swaps reach it
for (const fn of ["switchWorkspace", "closeWorkspaceNow", "restoreClosedWorkspace", "openWorkspaceWithGraph"]) {
  ok(/resetDescribeVersions\?\.\(\)/.test(extractFn(fn)), fn + " resets (so the pill goes with the old workflow)");
}

// 3. undo/redo inside one workflow keeps it
const undo = extractFn("_restore");
ok(undo && !/resetDescribeVersions|demopop/.test(undo), "undo/redo leaves the pill alone");

if (fail) { console.log(`check-sample-pill-swap: ${fail} failed`); process.exit(1); }
console.log("✓ the sample-run pill leaves with the workflow it described");
