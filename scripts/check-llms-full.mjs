#!/usr/bin/env node
// Guard: llms-full.txt must not drift away from the sources it is generated from.
//
// Why this exists: llms-full.txt is the single-file reference agents fetch. It
// carries a "do not edit by hand" header, so nobody edits it — which means the
// only thing that keeps it true is somebody remembering to re-run
// scripts/gen-llms-full.mjs. Nobody did, and the file kept advertising the
// retired `draw` node after index.html and both library READMEs had dropped it.
// An agent that reads a stale entry writes a graph that cannot run.
//
// This guard is OFFLINE and deterministic. It checks two things:
//
//   1. Prefix match. Every section built from a file in THIS repo (llms.txt,
//      README.md, index.html) is regenerated and compared byte for byte. Those
//      sections are always the leading parts of the output, so the comparison is
//      a plain startsWith.
//   2. Node keys. Every node type named in the two libraries' supported-node
//      tables must still be registered in index.html's NODE_TYPES. That reaches
//      into the sections this script cannot regenerate offline, and it is the
//      exact check the `draw` rows would have failed.
//
// The library sections' full text needs the sibling repos, so the byte-exact
// check for those runs in CI (.github/workflows/checks.yml) via
// `gen-llms-full.mjs --check` with NANOODLE_JS / NANOODLE_PY pointed at fresh
// checkouts.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localParts, joinParts, firstDiff, OUT_PATH } from "./gen-llms-full.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fails = [];

const actual = fs.readFileSync(OUT_PATH, "utf8");

// --- 1. the locally-sourced prefix -----------------------------------------

const expected = joinParts(localParts()).replace(/\n$/, "");
if (!actual.startsWith(expected + "\n\n")) {
  fails.push(
    "llms-full.txt no longer matches README.md / llms.txt / index.html.\n" +
    "  Regenerate it:  node scripts/gen-llms-full.mjs\n" +
    firstDiff(actual, expected + "\n"));
}

// --- 2. node keys in the libraries' supported-node tables -------------------

function registeredTypes() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const start = html.indexOf("const NODE_TYPES = {");
  if (start < 0) throw new Error("NODE_TYPES not found in index.html");
  const block = html.slice(start, html.indexOf("\n};", start));
  const keys = [...block.matchAll(/^ {2}([a-z]+): \{/gm)].map((m) => m[1]);
  if (!keys.length) throw new Error("parsed 0 NODE_TYPES keys from index.html");
  return new Set(keys);
}

// "upload (image/audio/video)" -> "upload"; "inpaint*" -> "inpaint"
const bareKey = (cell) => cell.replace(/\([^)]*\)/g, "").replace(/[*†\\`]/g, "").trim();

const known = registeredTypes();
// aliases the tables use that are not literal NODE_TYPES keys
const ALIASES = new Set(["upload"]);   // stands for upload / aupload / vupload

const rows = [...actual.matchAll(/^\| *(local|local media†|NanoGPT) *\| *(.+?) *\|$/gm)];
// 3 rows per library table, 2 libraries
if (rows.length !== 6) {
  fails.push(
    `expected 6 supported-node rows in llms-full.txt (3 per library), found ${rows.length}.\n` +
    "  The libraries' README table shape changed, so this guard went blind.\n" +
    "  Update the row regex in scripts/check-llms-full.mjs.");
} else {
  for (const [, runs, cell] of rows) {
    for (const raw of cell.split(",")) {
      const key = bareKey(raw);
      if (!key || ALIASES.has(key)) continue;
      if (!known.has(key)) {
        fails.push(
          `llms-full.txt lists node type "${key}" (row "${runs}"), but index.html no longer registers it.\n` +
          "  Either the type was retired and the library README still advertises it,\n" +
          "  or llms-full.txt is stale — run: node scripts/gen-llms-full.mjs");
      }
    }
  }
}

if (fails.length) {
  console.error("✗ check-llms-full");
  for (const f of fails) console.error("  - " + f.split("\n").join("\n    "));
  process.exit(1);
}
console.log(`✓ check-llms-full — locally-sourced sections match; ${rows.length} supported-node rows name only registered types`);
