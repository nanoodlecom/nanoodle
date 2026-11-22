#!/usr/bin/env node
// Guard: Updates entry text must never carry shell-expansion artifacts.
//
// Entry text sometimes travels through shell steps (scripts that assemble or
// post entries). An unquoted heredoc or double-quoted string expands $0 to
// the shell's own name, $1..$9 to positional args (usually empty), $HOME to a
// path — silently corrupting prices in the published feed. This happened live
// on 2026-11-22: "About $0.04 a run" shipped as "About /bin/bash.04 a run"
// (Restore the Photo, PR #895). This check scans every string field of every
// updates.json entry for the artifacts such an expansion leaves behind, so
// the corruption fails CI instead of reaching the panel.
//
// Legitimate dollar amounts ("$0.04") are fine and never match: the patterns
// below only fire on shell paths and shell names fused to digits.
import { readFileSync } from "node:fs";

const entries = JSON.parse(readFileSync(new URL("../updates.json", import.meta.url), "utf8"));
const ARTIFACTS = [
  /\/bin\/(bash|sh|zsh|dash)\b/,        // $0 expanded to the shell's path
  /\b(bash|zsh|dash)\.\d{2}\b/,          // shell name fused to a decimal tail
  /\/home\/[a-z_][a-z0-9_-]*\//,         // $HOME expanded into text
  /\/usr\/bin\/env\b/,                   // interpreter paths are never copy
  /\$\{?[A-Z_]{2,}\}?/,                  // unexpanded $VAR left in text
];
function* strings(o) {
  if (typeof o === "string") yield o;
  else if (Array.isArray(o)) for (const v of o) yield* strings(v);
  else if (o && typeof o === "object") for (const v of Object.values(o)) yield* strings(v);
}
let bad = 0;
for (const e of entries) {
  for (const s of strings(e)) {
    for (const re of ARTIFACTS) {
      if (re.test(s)) {
        console.error(`✗ shell-expansion artifact in ${e.date} entry: ${re} matched: ${s.slice(0, 120)}`);
        bad++;
      }
    }
  }
}
if (bad) { console.error(`✗ check-updates-shell-artifacts: ${bad} artifact(s)`); process.exit(1); }
console.log(`✓ no shell-expansion artifacts in ${entries.length} updates entries.`);
