#!/usr/bin/env node
/**
 * Recipe completions re-rank the add menu and the Examples shelf.
 * Empty canvases and close disagreements stay quiet.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRecipes,
  recommendRecipes,
  sequenceFromGraph,
  isPartialMatch,
  remainingSequence,
  typeMultiset,
  confidentRecipe,
  mergeRecipeHint,
} from "../vendor/next-action/recipe.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "recipes.json");
const GALLERY = join(ROOT, "examples", "gallery");

function fail(msg) {
  console.error(`✗ next-action-recipe: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const dirs = readdirSync(GALLERY).filter((d) => existsSync(join(GALLERY, d, "graph.json")));
assert(dirs.length >= 4, `need gallery graphs, got ${dirs.length}`);
const samples = JSON.parse(readFileSync(join(GALLERY, "samples.json"), "utf8"));
const titles = {};
for (const s of samples) if (s?.slug) titles[s.slug] = s.title || s.slug;
const entries = dirs.map((slug) => ({
  slug,
  title: titles[slug] || slug,
  graph: JSON.parse(readFileSync(join(GALLERY, slug, "graph.json"), "utf8")),
}));
const rebuilt = buildRecipes(entries);
assert(rebuilt.exampleCount >= 4, `too few recipes: ${rebuilt.exampleCount}`);
for (const slug of ["talking-avatar", "sing", "character-sprites", "photo-to-video"]) {
  assert(rebuilt.recipes.some((r) => r.slug === slug), `missing ${slug}`);
}

assert(existsSync(CORPUS), "corpus/recipes.json missing");
const corpus = JSON.parse(readFileSync(CORPUS, "utf8"));
assert(
  JSON.stringify(rebuilt.recipes) === JSON.stringify(corpus.recipes),
  "corpus recipes drifted from a gallery rebuild"
);

assert(recommendRecipes(corpus, { numNodes: 0, nodeTypeCounts: {} }, 3).length === 0, "empty canvas stays quiet");
assert(confidentRecipe(corpus, { numNodes: 0, nodeTypeCounts: {} }) === null, "empty canvas is not a completion");
assert(confidentRecipe(corpus, { numNodes: 1, nodeTypeCounts: { text: 1 } }) === null, "one node is not confident");

{
  const sketch = { numNodes: 2, nodeTypeCounts: { text: 1, image: 1 } };
  const rec = recommendRecipes(corpus, sketch, 5);
  const ta = rec.find((r) => r.slug === "talking-avatar");
  assert(ta && ta.actions.length >= 2 && ta.actions.every((a) => a.startsWith("add:")), "talking-avatar partial");
  assert(
    ta.actions.includes("add:tts") || ta.actions.includes("add:lipsync") || ta.remaining.includes("tts") || ta.remaining.includes("lipsync"),
    "talking-avatar still leads toward speech"
  );
  assert(confidentRecipe(corpus, sketch) === null, "text+image recipes disagree, so the menu stays put");
}

{
  const sketch = { numNodes: 2, nodeTypeCounts: { text: 1, llm: 1 } };
  const rec = recommendRecipes(corpus, sketch, 5);
  const sing = rec.find((r) => r.slug === "sing");
  const sprites = rec.find((r) => r.slug === "character-sprites");
  assert(sing && sing.remaining.includes("music"), "sing partial keeps music");
  assert(sprites && (sprites.actions.includes("add:image") || sprites.actions.includes("add:resize") || sprites.actions.includes("add:edit")), "sprites partial");
}

{
  const sketch = { numNodes: 1, nodeTypeCounts: { text: 1 } };
  const rec = recommendRecipes(corpus, sketch, 5);
  const big = rec.find((r) => r.slug === "storyboard-relay") || rec[0];
  assert(big && big.actions.length <= 3 && big.actions.length >= 1, "actions capped at 3");
}

{
  const ta = corpus.recipes.find((r) => r.slug === "talking-avatar");
  const full = recommendRecipes(corpus, { numNodes: ta.sequence.length, nodeTypeCounts: ta.multiset }, 5);
  assert(!full.some((r) => r.slug === "talking-avatar"), "a finished recipe is not suggested again");
}

{
  const seq = sequenceFromGraph({ nodes: [{ type: "comment" }, { type: "text" }, { type: "llm" }] });
  const ms = typeMultiset(seq);
  assert(seq.join(",") === "text,llm" && ms.text === 1 && ms.llm === 1 && isPartialMatch(ms, { text: 2, llm: 1 }), "helpers");
  assert(remainingSequence(["text", "llm", "image"], { text: 1 }).join(",") === "llm,image", "remaining");
}

{
  const sketch = { numNodes: 4, nodeTypeCounts: { text: 1, llm: 1, image: 1, resize: 1 } };
  const hit = confidentRecipe(corpus, sketch);
  assert(hit && hit.slug === "character-sprites" && hit.type === "edit", `expected Game character kit → edit, got ${JSON.stringify(hit)}`);
  assert(hit.reason === "from Game character kit recipe", "reason names the example");
  const merged = mergeRecipeHint({ confident: true, adds: [{ type: "text", action: "add:text", share: 0.4, reason: "often added next" }], wire: null, setModel: null, openExamples: null }, hit);
  assert(merged.confident && merged.adds[0].type === "edit" && merged.adds[0].reason === hit.reason, "recipe leads the add list");
  assert(merged.adds[1].type === "text", "frequency rows stay behind the recipe");
  assert(!merged.wire, "a recipe completion is not a wire");
  assert(merged.recipe.slug === "character-sprites", "shelf can lift the matched example");
  assert(mergeRecipeHint(merged, null).adds[0].type === "edit", "a null recipe does not rewrite hints");
}

{
  const mod = readFileSync(join(NA, "recipe.mjs"), "utf8");
  const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
  const index = readFileSync(join(ROOT, "index.html"), "utf8");
  assert(!mod.includes("na-chip") && !mod.includes("Mess up") && !mod.includes("placeGhost"), "no chips, ghosts, or demo buttons");
  assert(surface.includes("confidentRecipe") && surface.includes("mergeRecipeHint"), "engine merges a confident recipe");
  assert(surface.includes("corpus/recipes.json"), "engine loads the baked recipes");
  assert(index.includes("eh.recipe"), "Examples shelf reads the matched recipe");
  assert(index.includes("recipe.reason"), "the shelf mark can name the recipe");
}

console.log(`✓ next-action-recipe: ${corpus.recipes.length} gallery recipes, quiet unless one completion leads`);
