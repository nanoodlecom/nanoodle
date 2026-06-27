#!/usr/bin/env node
// Prepend a one-line changelog entry to updates.json (newest first).
// Called by the post-commit hook for each commit, and runnable by hand:
//   node scripts/add-update.mjs "2026-06-27" "Short, user-facing line"
// updates.json is plain JSON — edit, reword, reorder, or delete entries freely.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "updates.json");

const date = (process.argv[2] || "").trim();
const text = (process.argv[3] || "").replace(/\s+/g, " ").trim();
if (!date || !text) {
  console.error('usage: add-update.mjs "YYYY-MM-DD" "one-line text"');
  process.exit(2);
}

let list = [];
if (existsSync(file)) {
  try {
    list = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.error("updates.json is not valid JSON — fix it first");
    process.exit(1);
  }
  if (!Array.isArray(list)) list = [];
}

// Idempotent: don't double-add the same top entry (e.g. a re-run or an amend).
if (list[0] && list[0].date === date && list[0].text === text) process.exit(0);

list.unshift({ date, text });
writeFileSync(file, JSON.stringify(list, null, 2) + "\n");
