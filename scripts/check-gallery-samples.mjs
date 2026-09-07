#!/usr/bin/env node
// First-party gallery review page + Examples-modal cards (commit 39de469).
//
// "See result" and "Open workflow" are two doors into the same reviewed graph.
// Nothing previously asserted they stay pointed at the same slug, that the
// generated gallery page matches samples.json, or that Open workflow still
// loads the ORIGINAL EXAMPLES index after the featured-card sort. A typo in
// either door is a silent 404 / wrong workflow on the first-run path.
//
// Offline, no network, no inference.
//
//   G1. samples.json hashes + assets still render the committed gallery page
//   G2. local() refuses path traversal / missing / illegal names (no fetch)
//   G3. every gallery sample slug is an EXAMPLES card (except character-sprites
//       → Iron Verdict); every other EXAMPLES card has a sample
//   G4. EXAMPLES.graph matches gallery workflow.json (Open workflow ≡ reviewed)
//   G5. file thumbs exist; preview-null cards keep an empty thumb
//   G6. real openExamples(): featured order, encoded #slug, Iron Verdict
//       exception, Open workflow uses the pre-sort index, deslop quote / emoji
//       fallback, slug characters that need encodeURIComponent
//   G7. sitemap lists /examples/gallery/; chrome strings go through t()
//   G8. pre-commit fires on the gallery files (cannot silently disappear)
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import vm from "node:vm";
import { parseExamples } from "./check-example-models.mjs";
import { GALLERY_ROOT, local, main as verifyGallery } from "./sync-gallery-samples.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const GAME = "character-sprites";

let failed = 0;
const fail = (msg) => { console.error("✗ " + msg); failed++; };
const ok = (msg) => console.log("✓ " + msg);

function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error(`function ${name}() not found`);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`could not brace-match ${name}()`);
}

function normGraph(g) {
  return {
    nodes: (g.nodes || []).map((n) => ({
      id: n.id, type: n.type, name: n.name || "", fields: n.fields || {},
    })).sort((a, b) => a.id.localeCompare(b.id)),
    links: (g.links || []).map((l) => ({ from: l.from, to: l.to }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

function hrefs(html) {
  return [...String(html).matchAll(/\bhref="([^"]+)"/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// G1. generated page + committed hashes
// ---------------------------------------------------------------------------
try {
  verifyGallery({ check: true });
  ok("gallery index.html matches samples.json (hashes + assets)");
} catch (e) {
  fail("gallery page / hashes: " + e.message);
}

// ---------------------------------------------------------------------------
// G2. local() allow-list — the review page interpolates these into href/src
// ---------------------------------------------------------------------------
{
  assert.equal(local("deslop/LLM.txt"), "deslop/LLM.txt");
  const refusals = [
    "../iron-verdict/screenshot.png",   // exists, but walks out of gallery/
    "deslop/../favicon/preview.webp",
    "nope.webp",
    "deslop/missing.txt",
    "has space.webp",
    "https://example.com/x.webp",
    "deslop/LLM.txt/../../../index.html",
  ];
  for (const file of refusals) {
    try {
      local(file);
      fail(`local(${JSON.stringify(file)}) should refuse`);
    } catch (e) {
      if (!/Missing\/invalid sample asset/.test(e.message))
        fail(`local(${JSON.stringify(file)}) threw the wrong error: ${e.message}`);
    }
  }
  ok("local() allows in-tree files and refuses traversal / missing / illegal names");
}

// ---------------------------------------------------------------------------
// G3–G5. EXAMPLES ↔ samples.json lockstep
// ---------------------------------------------------------------------------
const examples = parseExamples(IDX);
const samples = JSON.parse(readFileSync(join(GALLERY_ROOT, "samples.json"), "utf8"));
const exampleSlugs = examples.map((e) => e.slug);
const sampleSlugs = samples.map((s) => s.slug);
const sampleBySlug = new Map(samples.map((s) => [s.slug, s]));

if (new Set(exampleSlugs).size !== exampleSlugs.length)
  fail("EXAMPLES has duplicate slugs");
if (new Set(sampleSlugs).size !== sampleSlugs.length)
  fail("samples.json has duplicate slugs");
if (!exampleSlugs.includes(GAME))
  fail("EXAMPLES is missing the character-sprites → Iron Verdict card");
if (sampleBySlug.has(GAME))
  fail("character-sprites belongs on Iron Verdict, not samples.json");

for (const slug of sampleSlugs)
  if (!exampleSlugs.includes(slug)) fail(`samples.json ${slug} has no EXAMPLES card`);
for (const slug of exampleSlugs)
  if (slug !== GAME && !sampleBySlug.has(slug)) fail(`EXAMPLES ${slug} has no gallery sample`);
ok(`EXAMPLES ↔ samples.json slugs lockstep (${sampleSlugs.length} samples + ${GAME})`);

for (const ex of examples) {
  const sample = sampleBySlug.get(ex.slug);
  if (!sample) continue;
  const workflow = JSON.parse(readFileSync(join(GALLERY_ROOT, sample.workflow), "utf8"));
  if (JSON.stringify(normGraph(ex.graph)) !== JSON.stringify(normGraph(workflow)))
    fail(`${ex.slug}: EXAMPLES.graph drifted from ${sample.workflow} (Open workflow ≠ reviewed graph)`);
  const expectedThumb = sample.preview ? "examples/gallery/" + sample.preview : "";
  if ((ex.thumb || "") !== expectedThumb)
    fail(`${ex.slug}: EXAMPLES.thumb ${JSON.stringify(ex.thumb)} ≠ ${JSON.stringify(expectedThumb)}`);
  if (ex.thumb && !ex.thumb.startsWith("data:") && !existsSync(join(ROOT, ex.thumb)))
    fail(`${ex.slug}: thumb file missing: ${ex.thumb}`);
}
if (!existsSync(join(ROOT, "examples/iron-verdict/screenshot.png")))
  fail("examples/iron-verdict/screenshot.png missing (character-sprites card override)");
if (!existsSync(join(ROOT, "examples/iron-verdict/index.html")))
  fail("examples/iron-verdict/index.html missing (See result target)");
ok("Open workflow graphs match reviewed workflow.json; thumbs exist");

// ---------------------------------------------------------------------------
// G6. real openExamples()
// ---------------------------------------------------------------------------
const openSrc = extractFn(IDX, "openExamples");
const firstLit = /const first=\[([^\]]+)\]/.exec(openSrc);
const first = firstLit ? [...firstLit[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
if (first.length < 3) fail("openExamples featured-slug list is missing");
for (const slug of first)
  if (!exampleSlugs.includes(slug)) fail(`featured slug ${slug} is not an EXAMPLES card`);

function renderCards(list) {
  const loaded = [];
  const cards = [];
  const shelf = {
    _html: "",
    children: [],
    set innerHTML(v) { this._html = v; if (v === "") this.children = []; },
    get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); return c; },
  };
  const modal = { hidden: true };
  const ctx = {
    EXAMPLES: list,
    esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c])),
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
  return { cards, loaded, modal, first };
}

{
  const { cards, loaded, modal } = renderCards(examples);
  if (cards.length !== examples.length)
    fail(`openExamples rendered ${cards.length} cards, expected ${examples.length}`);
  if (modal.hidden) fail("openExamples must unhide #examplesmodal");

  const expectedOrder = [
    ...first,
    ...exampleSlugs.filter((s) => !first.includes(s)),
  ];
  const gotOrder = [];
  cards.forEach((card, pos) => {
    const links = hrefs(card.innerHTML);
    if (links.length < 2) { fail(`card ${pos} is missing See result / preview hrefs`); return; }
    if (new Set(links).size !== 1)
      fail(`card ${pos} preview href and See result href diverged: ${links.join(" | ")}`);
    const href = links[0];
    const slug = expectedOrder[pos];
    const idx = exampleSlugs.indexOf(slug);
    gotOrder.push(slug);
    const want = slug === GAME
      ? "examples/iron-verdict/"
      : "examples/gallery/#" + encodeURIComponent(slug);
    if (href !== want) fail(`${slug}: See result href ${JSON.stringify(href)} ≠ ${JSON.stringify(want)}`);
    if (typeof card._btn.onclick !== "function") {
      fail(`${slug}: Open workflow button has no onclick`);
      return;
    }
    loaded.length = 0;
    card._btn.onclick();
    if (loaded.length !== 1 || loaded[0] !== idx)
      fail(`${slug}: Open workflow called loadExample(${JSON.stringify(loaded[0])}), expected ${idx} (pre-sort index)`);

    if (slug === "deslop") {
      if (!/ex-quote/.test(card.innerHTML) || /<img\b/.test(card.innerHTML))
        fail("deslop card must show the reviewed quote, not a missing thumb");
    } else if (slug === "sing") {
      if (!/ex-em/.test(card.innerHTML) || /<img\b/.test(card.innerHTML))
        fail("sing card (no preview) must fall back to the emoji, not a broken img");
    } else if (slug === GAME) {
      if (!card.innerHTML.includes("examples/iron-verdict/screenshot.png"))
        fail("character-sprites card must preview Iron Verdict screenshot.png");
    } else if (!/<img class="ex-im"/.test(card.innerHTML)) {
      fail(`${slug}: expected a file thumb <img>`);
    }
  });
  if (JSON.stringify(gotOrder) !== JSON.stringify(expectedOrder))
    fail(`featured sort drifted: ${gotOrder.join(",")} ≠ ${expectedOrder.join(",")}`);
  ok("openExamples preserves loadExample index, encodes slugs, and special-cases Iron Verdict / deslop / sing");
}

{
  const weird = { slug: "a/b#c", title: "edge", desc: "d", em: "!", thumb: "", graph: { nodes: [], links: [] } };
  const { cards } = renderCards([...examples, weird]);
  const edge = cards.at(-1);
  const want = "examples/gallery/#" + encodeURIComponent(weird.slug);
  const links = hrefs(edge.innerHTML);
  if (links.some((h) => h !== want) || !links.length)
    fail(`slug ${JSON.stringify(weird.slug)} must encode to ${want}, got ${links.join(" | ")}`);
  else ok("See result encodes slugs that contain / and #");
}

if (!/t\("See result"\)/.test(openSrc) || !/t\("Open workflow"\)/.test(openSrc))
  fail('openExamples chrome must go through t("See result") / t("Open workflow")');
else ok("See result / Open workflow chrome is translated");

// ---------------------------------------------------------------------------
// G7. sitemap
// ---------------------------------------------------------------------------
{
  const sitemap = readFileSync(join(ROOT, "sitemap.xml"), "utf8");
  if (!sitemap.includes("https://nanoodle.com/examples/gallery/"))
    fail("sitemap.xml is missing https://nanoodle.com/examples/gallery/");
  else ok("sitemap.xml lists the gallery review page");
}

// ---------------------------------------------------------------------------
// G8. pre-commit cannot drop this guard
// ---------------------------------------------------------------------------
{
  const hook = readFileSync(join(ROOT, ".githooks/pre-commit"), "utf8");
  const trigger = (hook.match(/touches_gallerysamples=.*/) || [""])[0];
  if (!trigger) fail("pre-commit has no touches_gallerysamples trigger");
  else {
    for (const needle of ["examples/gallery", "sync-gallery-samples", "check-gallery-samples", "index\\.html"])
      if (!trigger.includes(needle)) fail(`touches_gallerysamples must include ${needle}`);
    const reLit = /grep -E '([^']+)'/.exec(trigger);
    if (!reLit) fail("could not parse touches_gallerysamples grep");
    else {
      const re = new RegExp(reLit[1]);
      for (const path of ["examples/gallery/samples.json", "examples/gallery/deslop/graph.json", "index.html", "scripts/check-gallery-samples.mjs"])
        if (!re.test(path)) fail(`touches_gallerysamples must match ${path}`);
    }
  }
  if (!/\[ -z "\$touches_gallerysamples" \]/.test(hook))
    fail("pre-commit early-exit chain must include touches_gallerysamples");
  const block = (hook.match(/if \[ -n "\$touches_gallerysamples" \]; then\n([\s\S]*?)\nfi/) || [])[1] || "";
  if (!/check-gallery-samples\.mjs/.test(block))
    fail("pre-commit must run check-gallery-samples.mjs when gallery files are staged");
  else ok("pre-commit runs this check on gallery / Examples-modal files");
}

if (failed) {
  console.error(`check-gallery-samples: ${failed} failure(s)`);
  process.exit(1);
}
console.log("check-gallery-samples: OK");
