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
  // <link rel="alternate" type="application/atom+xml" title=…> in <head>: feed-reader
  // metadata, never rendered as page chrome; the feed itself is English-only.
  "nanoodle changelog",
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

// ===========================================================================
//  play.html — the app PLAYER + exported-app chrome.
//  play.html carries TWO key-major dicts ({englishSource:{es,fr,de,pt,ja}}):
//    PLAY_I18N   — RUNTIME chrome, lives inside RUNTIME_JS, SHIPS in every export.
//    PLAY_I18N_B — BUILDER-page chrome (/play only), NEVER bundled into exports.
//  We guard: (1) 5-language parity in each dict, (2) static chrome attrs in
//  play.html are covered by a dict (or allowlisted), (3) the new mechanisms
//  (resolver priority, baked-lang injection, share-link carry, t()-wiring).
// ===========================================================================
const play = fs.readFileSync(path.join(root, "play.html"), "utf8");

// parse a key-major dict: line-based (one entry per line), tolerant of "{...}"
// and "{bal}"-style placeholders inside values — parity just needs each lang tag present.
function parsePlayDict(marker) {
  const at = play.indexOf(marker);
  if (at < 0) { fail(`play.html: dict marker not found: ${marker}`); return new Set(); }
  const lines = play.slice(at).split("\n");
  const keys = new Set();
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*\}\s*;?\s*$/.test(ln)) break;                       // closing brace → end of dict
    const m = ln.match(/^\s*"((?:[^"\\]|\\.)*)"\s*:\s*\{/);
    if (!m) continue;
    const key = JSON.parse('"' + m[1] + '"');
    for (const lang of LANGS) if (!ln.includes(`${lang}:"`)) fail(`play.html ${marker}: key missing ${lang}: "${key}"`);
    keys.add(key);
  }
  if (!keys.size) fail(`play.html: no keys parsed from ${marker}`);
  return keys;
}
const playRun = parsePlayDict("const PLAY_I18N = {");
const playBld = parsePlayDict("const PLAY_I18N_B = {");
// play-only allowlist (kept SHORT). The goal field's static placeholder is overwritten at
// boot by newSuggestion()'s rotating idea (itself an AI-prompt seed, not chrome), so the
// static value is never shown long enough to translate — localizing the suggestion list is
// a separate, larger effort.
const PLAY_ALLOW = new Set([
  "e.g. “add presets”",
]);
const playCovered = (s) => playRun.has(s) || playBld.has(s) || ALLOW.has(s) || PLAY_ALLOW.has(s);

// static chrome-attr coverage. Dynamic attrs are built with t()/tB() at the call
// site — after wiring, those read as `title="'+t("…")+'"`, i.e. they contain a
// quote/plus, so the same $-/{-/quote exemptions that skip template attrs skip them too.
const playMiss = new Set();
for (const m of play.matchAll(/\s(title|placeholder|aria-label)="([^"]{2,140})"/g)) {
  const s = m[2].trim();
  if (!s || playCovered(s)) continue;
  if (!/[a-zA-Z]{3}/.test(s)) continue;      // symbols/ids
  if (/[${}]/.test(s)) continue;             // template-built (${…}) — translated at the call site
  if (/['+]/.test(s)) continue;              // concatenated / t()-wrapped dynamic attr
  if (/^https?:/.test(s)) continue;          // example URLs
  playMiss.add(`${m[1]}="${s}"`);
}
for (const s of playMiss) fail(`play.html untranslatable chrome attr (add a PLAY_I18N/PLAY_I18N_B key in ALL languages, or allowlist): ${s}`);

// mechanism pins — the pieces a well-meaning refactor could silently drop.
const playPins = [
  ['resolver reads the viewer pick first', 'localStorage.getItem("noodle_lang"); if(s && PLAY_LANGS.indexOf(s)>=0) code=s;'],
  ['resolver falls back to the baked creator lang', 'window.NOODLE_APP_LANG && PLAY_LANGS.indexOf(window.NOODLE_APP_LANG)>=0'],
  ['export bakes the creator language', "html = injectInHead(html, '<script>window.NOODLE_APP_LANG=' + JSON.stringify(_appLang)"],
  ['share link carries the creator language', '...(_lang?{lang:_lang}:{})'],
  ['import reads the carried language', 'lang:spec.lang'],
  ['localeDirective reuses the shared resolver', 'function localeDirective(){ return (LANG && LANG!=="en") ? i18nDir(LANG) : ""; }'],
  ['runtime run button translated', 'stopping ? t("■ Stop") : RUN_LABEL'],
  ['runtime chrome localized on mount', 'translateTree(document.body)'],
  ['builder chrome localized on boot', 'translateTreeB(document.body)'],
  ['runtime t() is $-safe', 'String(s).replace(String(s).trim(),()=>hit)'],
  ['builder tB() is $-safe', 'function tB(s){ if(s==null) return s; const hit=i18nLookupB(s); return hit!=null ? String(s).replace(String(s).trim(),()=>hit) : s; }'],
  ['footer stays translatable', '"Made with nanoodle — build your own AI app":'],
  ['user title/tagline opt out of translation', '<h1 id="app-title" data-no-i18n>'],
];
for (const [name, needle] of playPins) if (!play.includes(needle)) fail(`play.html mechanism pin lost: ${name}`);

if (failed) { console.error(`\ncheck-i18n-coverage: ${failed} problem(s)`); process.exit(1); }
console.log(`check-i18n-coverage: OK (index.html ${ref.size} keys; play.html runtime ${playRun.size} + builder ${playBld.size} keys × ${LANGS.length} languages, chrome covered)`);
