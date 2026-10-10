#!/usr/bin/env node
/**
 * Recipe completions re-rank the add menu and the Examples shelf.
 * Empty canvases and close disagreements stay quiet.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  buildRecipes,
  recommendRecipes,
  sequenceFromGraph,
  isPartialMatch,
  remainingSequence,
  typeMultiset,
  confidentRecipe,
  mergeRecipeHint,
  liftRecipeType,
} from "../vendor/next-action/recipe.mjs";
import { pickSearchLift } from "../vendor/next-action/add-search-popular.mjs";

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
  const rec = recommendRecipes(corpus, sketch, 8);
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
  assert(merged.confident && merged.adds[0].type === "edit" && merged.adds[0].reason === hit.reason && merged.adds[0].source === "recipe", "recipe leads the add list");
  assert(merged.recipe.type === "edit", "the shelf mark knows the next type");
  assert(liftRecipeType(["upload", "image", "edit"], "edit").join(",") === "edit,upload,image", "a search hit that is the next type rises to the top");
  assert(liftRecipeType(["edit", "image"], "edit") === null, "already first does not rewrite the list");
  assert(liftRecipeType(["upload", "image"], "edit") === null, "a type that is not a hit is not inserted");
  assert(liftRecipeType(["upload", "image"], "") === null && liftRecipeType(["upload"], "upload") === null, "an unsure or single-row list stays put");
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
  assert(surface.includes("confidentRecipe") && surface.includes("mergeRecipeHint") && surface.includes("liftRecipeType"), "engine merges a confident recipe");
  assert(index.includes("liftRecipeType"), "typed search pins the recipe next type when it is already a hit");
  assert(/edit:\s*\{[\s\S]{0,500}?desc:"[^"]*image/i.test(index), "Edit stays a description hit for an image-prefix search");
  assert(surface.includes("corpus/recipes.json"), "engine loads the baked recipes");
  assert(index.includes("eh.recipe"), "Examples shelf reads the matched recipe");
  assert(index.includes("recipe.reason"), "the shelf mark can name the recipe");
}

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
function extractFunction(src, name) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) fail(`could not find function ${name}() in index.html`);
  const open = src.indexOf("{", m.index);
  return src.slice(m.index, matchBrace(src, open) + 1);
}

const index = readFileSync(join(ROOT, "index.html"), "utf8");

// Query "im" is a title prefix of Image and only a description hit for Edit.
// Popular lift would put Image first. A confident Game character kit pin must
// keep Edit first and tagged, and must not insert Edit when it is not a hit.
{
  const tables = JSON.parse(readFileSync(join(NA, "corpus", "frequency-tables.json"), "utf8"));
  const NODE_TYPES = {
    upload: { title: "Image input", desc: "bring in a picture", em: "in", group: "Image" },
    image: { title: "Image", desc: "Text → image", em: "im", group: "Image", kw: "generate picture" },
    ivideo: { title: "Image→Video", desc: "still to clip", em: "iv", group: "Video" },
    trim: { title: "Trim audio", desc: "cut a clip", em: "tr", group: "Audio" },
    edit: { title: "Edit", desc: "Image(s) + text → image", em: "ed", group: "Image", kw: "change modify" },
    resize: { title: "Resize / crop", desc: "scale a picture", em: "rz", group: "Image" },
  };
  const recipeHints = {
    confident: true,
    adds: [
      { type: "edit", action: "add:edit", share: 0.5, reason: "from Game character kit recipe", source: "recipe" },
      { type: "text", action: "add:text", share: 0.4, reason: "common first node", source: "blend" },
    ],
    recipe: { slug: "character-sprites", title: "Game character kit", reason: "from Game character kit recipe", type: "edit" },
  };
  const quietHints = {
    confident: true,
    adds: [{ type: "text", action: "add:text", share: 0.4, reason: "common first node", source: "blend" }],
  };
  const addlist = { innerHTML: "", querySelector: () => ({ classList: { add() {} } }) };
  const ctx = {
    NODE_TYPES,
    LANG: "en",
    window: {
      __nextAction: {
        disabled: false,
        pickSearchLift(q, meta, ids) { return pickSearchLift(q, tables, meta, ids); },
        liftRecipeType,
      },
    },
    esc: (s) => String(s ?? ""),
    t: (s) => s,
    $: (id) => (id === "addlist" ? addlist : id === "addpop" ? { querySelector: () => ({ hidden: false }) } : null),
    __hints: recipeHints,
  };
  vm.createContext(ctx);
  new vm.Script(
    [
      "function nextActionHints(){ return globalThis.__hints; }",
      extractFunction(index, "addHintMap"),
      extractFunction(index, "addSearchTypeMeta"),
      extractFunction(index, "nodeRow"),
      extractFunction(index, "addMatchRank"),
      extractFunction(index, "add3dTie"),
      extractFunction(index, "renderAddList"),
    ].join("\n"),
    { filename: "index.html#recipe-search" }
  ).runInContext(ctx);

  function rows() {
    return [...addlist.innerHTML.matchAll(/<button([^>]*)>/g)].map((m) => {
      const tag = m[1];
      return {
        type: (tag.match(/data-type="([^"]+)"/) || [])[1],
        sug: /class="suggested"/.test(tag),
        title: (tag.match(/title="([^"]*)"/) || [])[1] || "",
      };
    });
  }

  ctx.renderAddList("im");
  let got = rows();
  assert(got[0] && got[0].type === "edit" && got[0].sug && got[0].title === "from Game character kit recipe", `query im must keep Edit first and tagged, got ${JSON.stringify(got.slice(0, 4))}`);
  assert(got.filter((r) => r.type === "edit").length === 1, "query im does not duplicate Edit");
  assert(got.some((r) => r.type === "image"), "query im still lists Image");

  ctx.__hints = quietHints;
  ctx.renderAddList("im");
  got = rows();
  assert(got[0] && got[0].type === "image" && got[0].sug && got[0].title === "popular match", `an unsure im search stays the popular Image row, got ${JSON.stringify(got.slice(0, 4))}`);
  assert(!got.some((r) => r.type === "edit" && r.sug && r.title.includes("recipe")), "an unsure im search does not take a recipe tag");

  ctx.__hints = recipeHints;
  ctx.renderAddList("crop");
  got = rows();
  assert(got.length && got.every((r) => r.type !== "edit"), `crop must not insert Edit, got ${JSON.stringify(got.map((r) => r.type))}`);
  assert(got[0].type === "resize", "crop still leads with the title match");
}

console.log(`✓ next-action-recipe: ${corpus.recipes.length} gallery recipes, quiet unless one completion leads`);
