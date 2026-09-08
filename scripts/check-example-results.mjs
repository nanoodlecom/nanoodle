#!/usr/bin/env node
// Guard: every Examples "See result" href must land somewhere real.
//
// The 📚 Examples cards build a result URL as either:
//   • examples/gallery/#<slug>  — a reviewed sample section, or
//   • a special dest            — today character-sprites → examples/iron-verdict/
// Teaching-only cards (LOCAL_ONLY_EXAMPLE_SLUGS) are not gallery files. They
// must hide "See result" (and the preview hash) instead of linking a dead
// #custom-endpoint that dumps the visitor at the gallery top.
//
// Offline. No API spend. Extracts the real result= expression from index.html
// and evaluates it per card so a future teaching slug cannot regress the same way.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const fail = (msg) => { console.error("✗ check-example-results: " + msg); process.exit(1); };

const idx = readFileSync(join(ROOT, "index.html"), "utf8");
const sync = readFileSync(join(ROOT, "scripts", "sync-examples.mjs"), "utf8");
const galleryHtml = readFileSync(join(ROOT, "examples", "gallery", "index.html"), "utf8");
const samples = JSON.parse(readFileSync(join(ROOT, "examples", "gallery", "samples.json"), "utf8"));

function parseSlugSet(src, label) {
  const m = src.match(/const LOCAL_ONLY_EXAMPLE_SLUGS = new Set\(\[([^\]]*)\]\)/);
  if (!m) fail(`${label} has no LOCAL_ONLY_EXAMPLE_SLUGS set`);
  const slugs = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (!slugs.length) fail(`${label} LOCAL_ONLY_EXAMPLE_SLUGS is empty — teaching cards need an explicit list`);
  return new Set(slugs);
}

function exampleSlugs(html) {
  const start = html.indexOf("const EXAMPLES = [");
  const end = html.indexOf("\n];", start);
  if (start < 0 || end < 0) fail("EXAMPLES array not found in index.html");
  const slugs = [...html.slice(start, end).matchAll(/\bslug:"([^"]+)"/g)].map((m) => m[1]);
  if (!slugs.length) fail("EXAMPLES parsed to 0 slugs");
  return slugs;
}

function extractResultExpr(html) {
  const start = html.indexOf("function openExamples()");
  if (start < 0) fail("openExamples() not found");
  const end = html.indexOf("\nfunction ", start + 1);
  const fn = html.slice(start, end < 0 ? undefined : end);
  const m = fn.match(/const result=([^;]+);/);
  if (!m) fail("openExamples has no `const result=…` assignment");
  if (!fn.includes("LOCAL_ONLY_EXAMPLE_SLUGS.has(ex.slug)")) {
    fail("openExamples must consult LOCAL_ONLY_EXAMPLE_SLUGS so teaching cards do not get a gallery hash");
  }
  if (!/const see=result\?/.test(fn)) {
    fail("openExamples must gate the See result <a> on a truthy result (teaching cards hide the link)");
  }
  if (!/const previewWrap=result\?/.test(fn)) {
    fail("openExamples must gate the preview <a> on a truthy result (no dead-hash preview wrap)");
  }
  return { fn, expr: m[1] };
}

const idxOnly = parseSlugSet(idx, "index.html");
const syncOnly = parseSlugSet(sync, "scripts/sync-examples.mjs");
if (idxOnly.size !== syncOnly.size || [...idxOnly].some((s) => !syncOnly.has(s))) {
  fail("LOCAL_ONLY_EXAMPLE_SLUGS drifted between index.html and scripts/sync-examples.mjs: " +
    `index=[${[...idxOnly]}] sync=[${[...syncOnly]}]`);
}

const slugs = exampleSlugs(idx);
for (const s of idxOnly) {
  if (!slugs.includes(s)) fail(`teaching slug ${s} is not an EXAMPLES card`);
}

const galleryIds = new Set([...galleryHtml.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]));
const sampleSlugs = new Set(samples.map((s) => s.slug));
if (galleryIds.size !== sampleSlugs.size || [...galleryIds].some((s) => !sampleSlugs.has(s))) {
  fail("gallery <section id> list drifted from samples.json — run scripts/sync-gallery-samples.mjs");
}

const { expr } = extractResultExpr(idx);
const hrefFor = (slug) => vm.runInNewContext(expr, {
  ex: { slug },
  encodeURIComponent,
  LOCAL_ONLY_EXAMPLE_SLUGS: idxOnly,
});

const GALLERY_PREFIX = "examples/gallery/#";
let checked = 0;
for (const slug of slugs) {
  const result = hrefFor(slug);
  if (idxOnly.has(slug)) {
    if (result) fail(`teaching-only ${slug} still has See result href ${JSON.stringify(result)}`);
    checked++;
    continue;
  }
  if (!result) fail(`${slug} hid See result but is not in LOCAL_ONLY_EXAMPLE_SLUGS`);
  if (result.startsWith(GALLERY_PREFIX)) {
    const id = decodeURIComponent(result.slice(GALLERY_PREFIX.length));
    if (!galleryIds.has(id)) {
      fail(`${slug} See result is ${result} but examples/gallery/ has no <section id="${id}">`);
    }
  } else {
    const file = join(ROOT, result.replace(/\/$/, "/index.html"));
    if (!existsSync(file)) fail(`${slug} See result is ${result} but ${file} does not exist`);
  }
  checked++;
}

console.log(`✓ example See result hrefs resolve (${checked} cards, ${idxOnly.size} teaching-only, ${galleryIds.size} gallery sections)`);
