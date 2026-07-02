#!/usr/bin/env node
// i18n coverage guard (offline, no network).
//
// Catches the class of regression where a user-facing chrome string exists in
// NO language map at all — invisible to any cross-language comparison, which
// only sees keys that exist somewhere. Two checks:
//
//  1. Parity: every language map (es/fr/de/pt/ja) has the exact same key set.
//  2. Chrome coverage: every static title= / placeholder= / aria-label=
//     attribute and every quick-add group header in index.html must be an
//     i18n key (or explicitly allowlisted below). Dynamic template-built
//     attributes (${...}) are exempt — they must translate at the call site.
//
// Plus mechanism pins for fixes that regressed once already (run button,
// run-cost chip, aria-label translation).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(root, "index.html"), "utf8");
let failed = 0;
const fail = (msg) => { console.error("✗ " + msg); failed++; };

// Intentionally untranslated chrome (brands, proper nouns). Keep this SHORT —
// every entry here is invisible to non-English users.
const ALLOW = new Set([
  "Noodle Cookoff",
]);

// ---- parse the maps -------------------------------------------------------
const LANGS = ["es", "fr", "de", "pt", "ja"];
const begin = src.indexOf("I18N-MAPS-BEGIN"), end = src.indexOf("I18N-MAPS-END");
if (begin < 0 || end < 0) { fail("I18N-MAPS markers not found"); process.exit(1); }
const block = src.slice(begin, end);
const maps = {};
for (let i = 0; i < LANGS.length; i++) {
  const from = block.indexOf(`\n  ${LANGS[i]}:{`);
  const to = i + 1 < LANGS.length ? block.indexOf(`\n  ${LANGS[i + 1]}:{`) : block.length;
  if (from < 0) { fail(`language block ${LANGS[i]} not found`); process.exit(1); }
  const keys = new Set();
  for (const m of block.slice(from, to).matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:\s*"/gm))
    keys.add(JSON.parse('"' + m[1] + '"'));
  maps[LANGS[i]] = keys;
}

// ---- 1. cross-language parity --------------------------------------------
const ref = maps.es;
for (const lang of LANGS.slice(1)) {
  for (const k of ref) if (!maps[lang].has(k)) fail(`key missing in ${lang}: "${k}"`);
  for (const k of maps[lang]) if (!ref.has(k)) fail(`key missing in es (present in ${lang}): "${k}"`);
}

// ---- 2. static chrome coverage --------------------------------------------
const misses = new Set();
const covered = (s) => ref.has(s) || ALLOW.has(s);
for (const m of src.matchAll(/\s(title|placeholder|aria-label)="([^"]{2,140})"/g)) {
  const s = m[2].trim();
  if (!s || covered(s)) continue;
  if (!/[a-zA-Z]{3}/.test(s)) continue;      // symbols/ids, nothing to translate
  if (/[${]/.test(s)) continue;              // template-built: translated at the call site
  if (/^https?:/.test(s)) continue;          // example URLs
  misses.add(`${m[1]}="${s}"`);
}
for (const m of src.matchAll(/class="grp">([^<${]{2,60})</g)) {
  const s = m[1].trim();
  if (s && !covered(s)) misses.add(`quick-add group header "${s}"`);
}
for (const s of misses) fail(`untranslatable chrome string (add an i18n key in ALL languages, or allowlist): ${s}`);

// ---- 3. mechanism pins -----------------------------------------------------
const pins = [
  ['run button translated', 'run.textContent = running ? t("■ Stop") : t("▶ Run")'],
  ['run-cost chip translated', '${esc(t("to run"))}'],
  ['aria-label handled by translateTree', '["placeholder","title","aria-label"].forEach'],
  ['t() $-safe replacement', 'String(s).replace(String(s).trim(),()=>hit)'],
];
for (const [name, needle] of pins) if (!src.includes(needle)) fail(`mechanism pin lost: ${name}`);

if (failed) { console.error(`\ncheck-i18n-coverage: ${failed} problem(s)`); process.exit(1); }
console.log(`check-i18n-coverage: OK (${ref.size} keys × ${LANGS.length} languages, chrome fully covered)`);
