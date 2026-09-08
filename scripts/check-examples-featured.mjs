#!/usr/bin/env node
// Pins the #468 Examples-modal Elo ranking and first-click punch lockstep.
//
// After the reorder, `first` is an explicit ranking of EVERY card (soft
// noodles last). A new slug left out of `first` silently falls last. Titles
// and descriptions go through t(), so a punch that forgets the I18N maps
// ships English-only cards. The deslop quote must keep the same booking
// facts as the Open-workflow draft.
//
// Complements check-gallery-samples.mjs (See result / Open workflow doors)
// without depending on that still-open PR.
//
// Offline, no network, no inference.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { parseExamples } from "./check-example-models.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");

const LEAD = ["night-market-postcard", "fibo-studio-still", "combine-images", "image-model-arena"];
const SOFT = ["talking-avatar", "sing", "omni-flash-turntable", "deslop"];
const LANGS = ["es", "fr", "de", "pt", "ja"];
const FACTS = ["$15", "8 September", "14 days"];

let failed = 0;
const fail = (msg) => { console.error("✗ " + msg); failed++; };
const ok = (msg) => console.log("✓ " + msg);

function matchBrace(src, openIdx) {
  let depth = 0;
  const tmpl = [];
  let mode = "code";
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i++; }
      else if (c === "/" && n === "*") { mode = "block"; i++; }
      else if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (tmpl.length && depth === tmpl[tmpl.length - 1]) { tmpl.pop(); mode = "tpl"; }
        else if (depth === 0) return i;
      }
    } else if (mode === "line") { if (c === "\n") mode = "code"; }
    else if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i++; } }
    else if (mode === "sq") { if (c === "\\") i++; else if (c === "'") mode = "code"; }
    else if (mode === "dq") { if (c === "\\") i++; else if (c === '"') mode = "code"; }
    else if (mode === "tpl") {
      if (c === "\\") i++;
      else if (c === "`") mode = "code";
      else if (c === "$" && n === "{") { mode = "code"; tmpl.push(depth); depth++; i++; }
    }
  }
  throw new Error("unbalanced braces from index " + openIdx);
}

function extractFn(src, name) {
  const sig = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = sig.exec(src);
  if (!m) throw new Error("function " + name + "() not found");
  const open = src.indexOf("{", m.index);
  return src.slice(m.index, matchBrace(src, open) + 1);
}

function i18nKeys(lang) {
  const begin = IDX.indexOf("I18N-MAPS-BEGIN"), end = IDX.indexOf("I18N-MAPS-END");
  if (begin < 0 || end < 0) throw new Error("I18N-MAPS markers not found");
  const block = IDX.slice(begin, end);
  const i = LANGS.indexOf(lang);
  const from = block.indexOf(`\n  ${lang}:{`);
  const to = i + 1 < LANGS.length ? block.indexOf(`\n  ${LANGS[i + 1]}:{`) : block.length;
  if (from < 0) throw new Error("language block " + lang + " not found");
  const keys = new Set();
  for (const m of block.slice(from, to).matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:\s*"/gm))
    keys.add(JSON.parse('"' + m[1] + '"'));
  return keys;
}

function nodeText(ex, id) {
  const n = ex.graph.nodes.find((node) => node.id === id);
  return (n && n.fields && n.fields.text) || "";
}

const examples = parseExamples(IDX);
const slugs = examples.map((e) => e.slug);
const openSrc = extractFn(IDX, "openExamples");
const firstLit = /const first=\[([^\]]+)\]/.exec(openSrc);
const first = firstLit ? [...firstLit[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];

if (first.length < slugs.length) fail("openExamples featured list is shorter than EXAMPLES");
if (new Set(first).size !== first.length) fail("openExamples featured list has duplicate slugs");
for (const slug of first)
  if (!slugs.includes(slug)) fail(`featured slug ${slug} is not an EXAMPLES card`);
for (const slug of slugs)
  if (!first.includes(slug)) fail(`EXAMPLES ${slug} is missing from first[] (would silently rank last)`);
if (JSON.stringify(first.slice(0, 4)) !== JSON.stringify(LEAD))
  fail("Elo lead must be postcard, FIBO, combine, arena — got " + first.slice(0, 4).join(", "));
if (JSON.stringify(first.slice(-4)) !== JSON.stringify(SOFT))
  fail("soft noodles must be last (talking-avatar, sing, turntable, deslop) — got " + first.slice(-4).join(", "));
if (!first.includes("character-sprites"))
  fail("character-sprites (Iron Verdict) must stay in the explicit ranking");
if (!failed) ok("first[] is a complete Elo ranking (lead / Iron Verdict / soft last)");

const skillAt = IDX.indexOf('id="skilloutcome"');
const listAt = IDX.indexOf('id="exampleslist"');
if (skillAt < 0 || listAt < 0 || skillAt > listAt)
  fail("Iron Verdict #skilloutcome must sit above #exampleslist in the modal");
else ok("Iron Verdict pitch sits above the ranked cards");

const maps = Object.fromEntries(LANGS.map((lang) => [lang, i18nKeys(lang)]));
for (const ex of examples) {
  for (const field of ["title", "desc"]) {
    const s = String(ex[field] || "").trim();
    if (!s) { fail(`${ex.slug}: empty ${field}`); continue; }
    for (const lang of LANGS) {
      if (!maps[lang].has(s))
        fail(`${ex.slug} ${field} ${JSON.stringify(s)} is missing from I18N.${lang}`);
    }
  }
}
if (!failed) ok("every EXAMPLES title and desc is an I18N key in all five languages");

const deslop = examples.find((e) => e.slug === "deslop");
const draft = deslop ? nodeText(deslop, "n1") : "";
for (const fact of FACTS) {
  if (!draft.includes(fact)) fail(`deslop draft lost ${JSON.stringify(fact)}`);
}
const quote = /<blockquote class="ex-quote"[^>]*>([\s\S]*?)<\/blockquote>/.exec(openSrc);
if (!quote) fail("openExamples deslop quote is missing");
else {
  for (const fact of FACTS) {
    if (!quote[1].includes(fact)) fail(`deslop quote lost ${JSON.stringify(fact)}`);
  }
}
if (deslop && quote && FACTS.every((f) => draft.includes(f) && quote[1].includes(f)))
  ok("deslop quote and Open-workflow draft keep $15 / 8 September / 14 days");

const talk = examples.find((e) => e.slug === "talking-avatar");
const script = talk ? nodeText(talk, "n2") : "";
if (!/fifteen-dollar|\$15/i.test(script) || !/chain/i.test(script))
  fail("talking-avatar spoken script must keep the $15 check and chain/brakes brief");
else ok("talking-avatar first-click script still sells the shop-check job");

const sing = examples.find((e) => e.slug === "sing");
const song = sing ? nodeText(sing, "n1") : "";
if (!/kickstand/i.test(song) || !/shop bell/i.test(song))
  fail("sing instructions must keep the punched kickstand / shop-bell brief");
else ok("sing first-click brief still sells the closing-credits job");

const omni = examples.find((e) => e.slug === "omni-flash-turntable");
const object = omni ? nodeText(omni, "n2") : "";
if (!/chrome/i.test(object) || !/helmet/i.test(object))
  fail("omni-flash-turntable object must keep the punched chrome helmet");
else ok("omni-flash-turntable first-click object is still the chrome helmet");

{
  const cards = [];
  const loaded = [];
  const shelf = {
    _html: "",
    children: [],
    set innerHTML(v) { this._html = v; if (v === "") this.children = []; },
    get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); return c; },
  };
  const modal = { hidden: true };
  const ctx = {
    EXAMPLES: examples,
    esc: (s) => String(s ?? ""),
    t: (s) => s,
    renderCommunity() {},
    loadExample(i) { loaded.push(i); },
    $: (id) => {
      if (id === "exampleslist") return shelf;
      if (id === "examplesmodal") return modal;
      throw new Error("unexpected $" + id);
    },
    document: {
      createElement() {
        const btn = { onclick: null };
        const card = { className: "", innerHTML: "", querySelector: (sel) => sel === "button" ? btn : null, _btn: btn };
        cards.push(card);
        return card;
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(openSrc + "\nopenExamples();", ctx);
  const got = cards.map((c) => {
    const title = /<h3 class="ex-tt">([^<]*)<\/h3>/.exec(c.innerHTML);
    return examples.find((e) => e.title === (title && title[1]))?.slug;
  });
  if (JSON.stringify(got) !== JSON.stringify(first))
    fail("openExamples rendered " + got.join(", ") + " — expected " + first.join(", "));
  cards.forEach((c, pos) => { if (c._btn.onclick) c._btn.onclick(); });
  const expectedIdx = first.map((slug) => slugs.indexOf(slug));
  if (JSON.stringify(loaded) !== JSON.stringify(expectedIdx))
    fail("Open workflow used sorted positions " + JSON.stringify(loaded) + " instead of original indexes " + JSON.stringify(expectedIdx));
  if (!failed) ok("openExamples paints Elo order and Open workflow keeps the original EXAMPLES index");
}

if (failed) {
  console.error(`\ncheck-examples-featured: ${failed} problem(s)`);
  process.exit(1);
}
console.log("check-examples-featured: ok");
