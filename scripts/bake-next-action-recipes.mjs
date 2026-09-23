#!/usr/bin/env node
/**
 * Product · 8 — bake Examples gallery graphs → vendor/next-action/corpus/recipes.json
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRecipes } from "../vendor/next-action/recipe.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY = join(ROOT, "examples", "gallery");
const OUT_DIR = join(ROOT, "vendor", "next-action", "corpus");
const OUT = join(OUT_DIR, "recipes.json");

function loadTitles() {
  /** @type {Record<string, string>} */
  const map = {};
  const samplesPath = join(GALLERY, "samples.json");
  if (!existsSync(samplesPath)) return map;
  try {
    const raw = JSON.parse(readFileSync(samplesPath, "utf8"));
    const items = Array.isArray(raw) ? raw : raw.samples || raw.items || [];
    for (const s of items) {
      if (s?.slug) map[s.slug] = s.title || s.slug;
    }
  } catch (_) {}
  return map;
}

const titles = loadTitles();
const dirs = readdirSync(GALLERY).filter((d) => existsSync(join(GALLERY, d, "graph.json")));
const entries = dirs.map((slug) => ({
  slug,
  title: titles[slug] || slug,
  graph: JSON.parse(readFileSync(join(GALLERY, slug, "graph.json"), "utf8")),
}));

const corpus = buildRecipes(entries);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(corpus, null, 2) + "\n");
console.log(
  `✓ baked ${corpus.exampleCount} recipes → ${OUT.replace(ROOT + "/", "")}`
);
for (const r of corpus.recipes) {
  console.log(`  ${r.slug}: ${r.sequence.join(" → ")}`);
}
