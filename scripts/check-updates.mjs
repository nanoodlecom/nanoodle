#!/usr/bin/env node
// Validate updates.json: a newest-first array of
//   { date:"YYYY-MM-DD", text:"one line", i18n?:{ es,fr,de,pt,ja:"one line" },
//     media?:{ src:"updates-media/x.mp4", poster:"updates-media/x.webp", w, h,
//              audio?:true, captions?:{ en:"updates-media/x.en.vtt", … }, burned?:"en" } }.
// The pre-commit hook runs this when updates.json is staged, so a malformed hand
// edit can't ship and break the in-app Updates changelog.
//
// The optional `i18n` object localizes an entry for the editor's other languages
// (the 📣 Updates modal falls back to English `text` for any missing one). If
// present it is validated STRICTLY (all langs, non-empty, single line). Entries
// with NO i18n are still valid — they just render English everywhere — so an
// English-only commit (or the post-commit --amend that appends one) never blocks.
// Missing translations are reported as a non-fatal reminder to run:
//   node scripts/translate-updates.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Editor UI languages that an entry's i18n object must cover, in full, when set.
// Keep in sync with index.html's I18N_LANGS (es/fr/de/pt/ja).
const LANGS = ["es", "fr", "de", "pt", "ja"];
// Same-origin clip paths only (deployed folder, no traversal). Mirrors index.html's
// UPD_MEDIA_RE and gen-changelog.mjs's MEDIA_RE.
const MEDIA_RE = /^updates-media\/[a-z0-9][a-z0-9._-]*\.(mp4|webp|png|jpg|vtt)$/;
const CAP_LANGS = ["en", ...LANGS];

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
const untranslated = []; // indices with no (or partial) i18n — reported, not fatal
if (!Array.isArray(list)) {
  errs.push("top level must be an array");
} else {
  list.forEach((e, i) => {
    if (typeof e !== "object" || e === null) { errs.push(`#${i}: must be an object`); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) errs.push(`#${i}: date must be YYYY-MM-DD`);
    if (typeof e.text !== "string" || !e.text.trim()) errs.push(`#${i}: text must be a non-empty string`);
    else if (/[\r\n]/.test(e.text)) errs.push(`#${i}: text must be a single line`);

    // Optional usage clip — language-neutral, so one per entry (not per i18n lang).
    // Shape only here; scripts/check-updates-media.mjs checks the files themselves.
    if (e.media !== undefined) {
      const m = e.media;
      if (typeof m !== "object" || m === null || Array.isArray(m)) errs.push(`#${i}: media must be an object { src, poster, w, h }`);
      else {
        const extraM = Object.keys(m).filter(k => !["src", "poster", "w", "h", "audio", "captions", "burned"].includes(k));
        if (extraM.length) errs.push(`#${i}: media has unknown key(s): ${extraM.join(", ")}`);
        if (!MEDIA_RE.test(m.src || "") || !/\.mp4$/.test(m.src)) errs.push(`#${i}: media.src must be updates-media/<name>.mp4`);
        if (!MEDIA_RE.test(m.poster || "") || !/\.(webp|png|jpg)$/.test(m.poster)) errs.push(`#${i}: media.poster must be updates-media/<name>.webp (or .png/.jpg)`);
        if (!(Number.isInteger(m.w) && m.w > 0 && Number.isInteger(m.h) && m.h > 0)) errs.push(`#${i}: media.w / media.h must be positive integers (the clip's pixel size)`);
        // Narrated clips (scripts/make-update-clip.mjs): audio:true, captions {lang: .vtt}, burned: the
        // caption language drawn into the picture. Sound always comes with captions.
        if (m.audio !== undefined && m.audio !== true) errs.push(`#${i}: media.audio is true or absent`);
        if (m.captions !== undefined) {
          if (typeof m.captions !== "object" || m.captions === null || Array.isArray(m.captions)) errs.push(`#${i}: media.captions must be { lang: "updates-media/<name>.<lang>.vtt" }`);
          else for (const [lang, f] of Object.entries(m.captions)) {
            if (!CAP_LANGS.includes(lang)) errs.push(`#${i}: media.captions has unknown language ${lang}`);
            if (!MEDIA_RE.test(f || "") || !/\.vtt$/.test(f)) errs.push(`#${i}: media.captions.${lang} must be updates-media/<name>.vtt`);
          }
        }
        if (m.audio === true && !(m.captions && m.captions.en)) errs.push(`#${i}: a narrated clip (media.audio) needs English captions (media.captions.en)`);
        if (m.burned !== undefined && !(m.captions && m.captions[m.burned])) errs.push(`#${i}: media.burned must name a language in media.captions`);
      }
    }

    if (e.i18n === undefined) { untranslated.push(i); return; }
    if (typeof e.i18n !== "object" || e.i18n === null || Array.isArray(e.i18n)) {
      errs.push(`#${i}: i18n must be an object of { lang: "text" }`); return;
    }
    const extra = Object.keys(e.i18n).filter(k => !LANGS.includes(k));
    if (extra.length) errs.push(`#${i}: i18n has unknown language(s): ${extra.join(", ")}`);
    const missing = [];
    LANGS.forEach(lang => {
      const v = e.i18n[lang];
      if (v === undefined) { missing.push(lang); return; }
      if (typeof v !== "string" || !v.trim()) errs.push(`#${i}: i18n.${lang} must be a non-empty string`);
      else if (/[\r\n]/.test(v)) errs.push(`#${i}: i18n.${lang} must be a single line`);
    });
    if (missing.length) untranslated.push(i); // partial i18n → still needs a backfill
  });
}

if (errs.length) {
  console.error("updates.json:\n  " + errs.join("\n  "));
  process.exit(1);
}

// Non-fatal: nudge toward backfilling translations, but let the commit through so
// English-only entries (and the post-commit auto-append) always ship.
if (untranslated.length) {
  console.warn(
    `updates.json: ${untranslated.length} entr${untranslated.length === 1 ? "y is" : "ies are"} untranslated ` +
    `(missing some of ${LANGS.join("/")}).\n  Backfill with:  node scripts/translate-updates.mjs`
  );
}
