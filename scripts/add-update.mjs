#!/usr/bin/env node
// Insert a one-line changelog entry into updates.json at its date's position
// (the list is newest-first; the 📣 modal renders file order and labels each
// run of consecutive dates once, so an out-of-place date renders as a weird
// back-and-forth timeline — insertion MUST keep the list date-sorted).
// Called by the post-commit hook for each commit, and runnable by hand:
//   node scripts/add-update.mjs "2026-06-27" "Short, user-facing line"
//   node scripts/add-update.mjs --day-end "2026-06-27" "…"   # below existing same-day entries
// --day-end is for automated feeds (the NanoGPT model-sync cron): hand-written
// product updates keep the top of their day, mirrored model news files in under
// them. updates.json is plain JSON — edit, reword, reorder, or delete freely.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "updates.json");

const argv = process.argv.slice(2).filter(a => a !== "--day-end");
const dayEnd = process.argv.includes("--day-end");
const date = (argv[0] || "").trim();
const text = (argv[1] || "").replace(/\s+/g, " ").trim();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !text) {
  console.error('usage: add-update.mjs [--day-end] "YYYY-MM-DD" "one-line text"');
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

// Idempotent: don't double-add the same entry (e.g. a re-run or an amend).
if (list.some(e => e && e.date === date && e.text === text)) process.exit(0);

// Newest-first insert position: top of the entry's day, or --day-end for below
// any entries already carrying that date.
let at = list.findIndex(e => e && (dayEnd ? e.date < date : e.date <= date));
if (at === -1) at = list.length;
list.splice(at, 0, { date, text });
writeFileSync(file, JSON.stringify(list, null, 2) + "\n");
