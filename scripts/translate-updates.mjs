#!/usr/bin/env node
// Backfill the per-entry `i18n` translations in updates.json (es/fr/de/pt/ja) so
// the in-app 📣 Updates changelog reads in the visitor's editor language.
//
// This is a HAND-RUN / CI helper — it spends NanoGPT credits, so it is NEVER
// wired into a git hook (pre-commit must stay offline; see the changelog memo).
// The post-commit hook adds new English entries; run this before you push to
// translate them. It is idempotent: entries already carrying all five languages
// are skipped, and if nothing is missing it makes ZERO API calls and exits 0.
//
// Usage:
//   NANOGPT_API_KEY=sk-... node scripts/translate-updates.mjs        # backfill
//   node scripts/translate-updates.mjs --key sk-... --model zai-org/glm-5.2:thinking  # explicit
//   node scripts/translate-updates.mjs --dry-run                      # list gaps, no spend
//
// The editor UI languages (index.html I18N_LANGS). Keep in sync with check-updates.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LANGS = { es: "Spanish", fr: "French", de: "German", pt: "Portuguese", ja: "Japanese" };
const CHAT_ENDPOINT = "https://nano-gpt.com/api/v1/chat/completions";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "updates.json");

// --- args ---
const argv = process.argv.slice(2);
const flag = (name, short) => {
  const i = argv.findIndex(a => a === name || (short && a === short));
  return i >= 0 ? (argv[i + 1] || "") : "";
};
const dryRun = argv.includes("--dry-run");
const key = flag("--key", "-k") || process.env.NANOGPT_API_KEY || "";
// Default to GLM-5.2's thinking variant for higher translation fidelity across the
// five languages. Override with --model / NANOGPT_MODEL (e.g. plain zai-org/glm-5.2).
const model = flag("--model", "-m") || process.env.NANOGPT_MODEL || "zai-org/glm-5.2:thinking";

// don't-translate protected tokens — mirrors the localizer brief used to seed the backlog.
const KEEP = "emoji; brand/product names (nanoodle, nano-gpt, NanoGPT, Nano, Cookoff, Noodle Cookoff, LoRA, HuggingFace, Flux, FLUX.2, Z-Image, LTX, TinyURL, da.gd, Veo 3, Kling, Seedance, Nano-Banana, Seedream, Mureka, Discord, Reddit, r/nanocurrency, X, Facebook); keyboard keys (F, Z, Y, Ctrl/Cmd/⌘); clickable UI button labels (Run, Fit, Gallery, Create app, My apps, Updates, Submit, Trim, Image, Edit, Inpaint, Video, LLM, Speech, Transcribe, Combine, Describe changes); $ prices; model ids; URLs";

const unesc = s => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const oneLine = s => unesc(s).replace(/[\r\n]+/g, " ").trim();

let list;
try { list = JSON.parse(readFileSync(file, "utf8")); }
catch (e) { console.error("updates.json: invalid JSON — " + e.message); process.exit(1); }
if (!Array.isArray(list)) { console.error("updates.json: top level must be an array"); process.exit(1); }

// Which (lang -> [indices]) still need translating?
const gaps = {};
for (const lang of Object.keys(LANGS)) {
  const idx = [];
  list.forEach((e, i) => {
    if (!e || typeof e.text !== "string") return;
    const have = e.i18n && typeof e.i18n[lang] === "string" && e.i18n[lang].trim();
    if (!have) idx.push(i);
  });
  if (idx.length) gaps[lang] = idx;
}

const totalGaps = Object.values(gaps).reduce((n, a) => n + a.length, 0);
if (!totalGaps) { console.log(`updates.json: all ${list.length} entries fully translated (${Object.keys(LANGS).join("/")}). Nothing to do.`); process.exit(0); }

console.log(`updates.json: ${totalGaps} missing translation(s):`);
for (const [lang, idx] of Object.entries(gaps)) console.log(`  ${lang}: ${idx.length} (entries ${idx.join(", ")})`);
if (dryRun) { console.log("--dry-run: no API calls made."); process.exit(0); }
if (!key) { console.error("\nNo API key. Pass --key sk-... or set NANOGPT_API_KEY (this step spends credits)."); process.exit(2); }

async function translateBatch(lang, indices) {
  const langName = LANGS[lang];
  const items = indices.map(i => ({ i, text: list[i].text }));
  const sys =
    `You are a professional software localizer for nanoodle, a no-server, bring-your-own-key AI workflow web app. ` +
    `Translate each changelog line into natural, fluent, idiomatic ${langName} as a product changelog would read (concise, user-facing). ` +
    `Address the reader informally where the language allows (German du, Spanish tú, Portuguese você; French vous is fine) — match a friendly indie-app tone. ` +
    `Keep each ONE line (no newlines). Do NOT translate: ${KEEP}. Preserve meaning exactly; add or drop nothing. ` +
    `Return ONLY a JSON object mapping each input index (string key) to its ${langName} translation.`;
  const user = JSON.stringify(items);
  const r = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!r.ok) throw new Error(`${lang}: HTTP ${r.status} — ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error(`${lang}: empty response`);
  let map;
  try { map = JSON.parse(content); } catch { throw new Error(`${lang}: model did not return JSON — ${content.slice(0, 200)}`); }
  return map;
}

let wrote = 0;
for (const [lang, indices] of Object.entries(gaps)) {
  process.stdout.write(`translating ${indices.length} → ${lang} … `);
  let map;
  try { map = await translateBatch(lang, indices); }
  catch (e) { console.log("FAILED"); console.error("  " + e.message); continue; }
  let n = 0;
  for (const i of indices) {
    const v = map[String(i)];
    if (typeof v !== "string" || !v.trim()) { console.error(`  #${i} ${lang}: no translation returned`); continue; }
    (list[i].i18n ||= {})[lang] = oneLine(v);
    n++; wrote++;
  }
  console.log(`ok (${n}/${indices.length})`);
}

if (wrote) {
  writeFileSync(file, JSON.stringify(list, null, 2) + "\n");
  console.log(`\nWrote ${wrote} translation(s) to updates.json. Run: node scripts/check-updates.mjs`);
} else {
  console.error("\nNo translations written.");
  process.exit(1);
}
