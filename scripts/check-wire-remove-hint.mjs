#!/usr/bin/env node
// The wire tooltip matches the gesture and the language (UX review 2026-11-25).
// handleWireTap snips on one mouse click but arms-then-snips on touch; the tooltip
// said "tap to remove" on every device, in English for every language.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const IDX = readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "index.html"), "utf8");
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } else console.log("  ✓ " + m); };
ok(!IDX.includes("<title>tap to remove</title>"), "no fixed English \"tap to remove\" tooltip");
ok(/const wireTip = esc\(t\(matchMedia\("\(pointer:coarse\)"\)\.matches \? "tap twice to remove" : "click to remove"\)\);/.test(IDX), "tooltip follows the pointer type, translated");
ok(/<title>\$\{wireTip\}<\/title>/.test(IDX), "wire hit paths use it");
const block = IDX.slice(IDX.indexOf("I18N-MAPS-BEGIN"), IDX.indexOf("I18N-MAPS-END"));
for (const k of ["click to remove", "tap twice to remove"]) ok(block.split(JSON.stringify(k) + ":").length - 1 === 5, `"${k}" in all 5 languages`);
if (fail) { console.log(`check-wire-remove-hint: ${fail} failed`); process.exit(1); }
console.log("✓ wire tooltip matches the gesture and the language");
