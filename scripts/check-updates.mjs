#!/usr/bin/env node
// Validate updates.json: a newest-first array of { date:"YYYY-MM-DD", text:"one line" }.
// The pre-commit hook runs this when updates.json is staged, so a malformed hand
// edit can't ship and break the in-app Updates changelog.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "updates.json");
if (!existsSync(file)) process.exit(0); // nothing to check yet

let list;
try {
  list = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error("updates.json: invalid JSON — " + e.message);
  process.exit(1);
}

const errs = [];
if (!Array.isArray(list)) {
  errs.push("top level must be an array");
} else {
  list.forEach((e, i) => {
    if (typeof e !== "object" || e === null) { errs.push(`#${i}: must be an object`); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) errs.push(`#${i}: date must be YYYY-MM-DD`);
    if (typeof e.text !== "string" || !e.text.trim()) errs.push(`#${i}: text must be a non-empty string`);
    else if (/[\r\n]/.test(e.text)) errs.push(`#${i}: text must be a single line`);
  });
}

if (errs.length) {
  console.error("updates.json:\n  " + errs.join("\n  "));
  process.exit(1);
}
