#!/usr/bin/env node
/**
 * Product · 8 — recipe / subgraph completer toys.
 */
import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRecipes,
  recommendRecipes,
  sequenceFromGraph,
  isPartialMatch,
  remainingSequence,
  typeMultiset,
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

const dirs = readdirSync(GALLERY).filter((d) =>
  existsSync(join(GALLERY, d, "graph.json"))
);
assert(dirs.length >= 4, `need gallery graphs, got ${dirs.length}`);

let titles = {};
try {
  const raw = JSON.parse(readFileSync(join(GALLERY, "samples.json"), "utf8"));
  const items = Array.isArray(raw) ? raw : [];
  for (const s of items) if (s?.slug) titles[s.slug] = s.title || s.slug;
} catch (_) {}

const entries = dirs.map((slug) => ({
  slug,
  title: titles[slug] || slug,
  graph: JSON.parse(readFileSync(join(GALLERY, slug, "graph.json"), "utf8")),
}));
const rebuilt = buildRecipes(entries);
assert(rebuilt.exampleCount >= 4, `too few recipes: ${rebuilt.exampleCount}`);
assert(
  rebuilt.recipes.some((r) => r.slug === "talking-avatar"),
  "missing talking-avatar recipe"
);
assert(
  rebuilt.recipes.some((r) => r.slug === "sing"),
  "missing sing recipe"
);
assert(
  rebuilt.recipes.some((r) => r.slug === "character-sprites"),
  "missing character-sprites recipe"
);

if (!existsSync(CORPUS)) {
  writeFileSync(CORPUS, JSON.stringify(rebuilt, null, 2) + "\n");
  console.log("  baked missing corpus →", CORPUS);
}
const corpus = JSON.parse(readFileSync(CORPUS, "utf8"));
assert(Array.isArray(corpus.recipes) && corpus.recipes.length >= 4, "corpus recipes empty");
assert(
  JSON.stringify(rebuilt.recipes.map((r) => r.slug).sort()) ===
    JSON.stringify(corpus.recipes.map((r) => r.slug).sort()),
  "corpus slug set mismatch vs rebuild"
);

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  const empty = recommendRecipes(corpus, { numNodes: 0, nodeTypeCounts: {} }, 3);
  toy("empty-canvas-quiet", empty.length === 0, `n=${empty.length}`);
}

{
  // Partial talking-avatar: text + image → expect tts / lipsync / text stages
  const sketch = { numNodes: 2, nodeTypeCounts: { text: 1, image: 1 } };
  const rec = recommendRecipes(corpus, sketch, 5);
  const ta = rec.find((r) => r.slug === "talking-avatar");
  toy(
    "partial-talking-avatar",
    !!ta && ta.actions.length >= 2 && ta.actions.every((a) => a.startsWith("add:")),
    ta
      ? `actions=${ta.actions.join(",")} remaining=${ta.remaining.slice(0, 4).join("→")}`
      : `tops=${rec.map((r) => r.slug).join(",")}`
  );
  toy(
    "talking-avatar-suggests-audio",
    !!ta &&
      (ta.actions.includes("add:tts") ||
        ta.actions.includes("add:lipsync") ||
        ta.remaining.includes("tts") ||
        ta.remaining.includes("lipsync")),
    `actions=${ta?.actions?.join(",")}`
  );
}

{
  // Partial sing / sprites: text + llm
  const sketch = { numNodes: 2, nodeTypeCounts: { text: 1, llm: 1 } };
  const rec = recommendRecipes(corpus, sketch, 5);
  const sing = rec.find((r) => r.slug === "sing");
  const sprites = rec.find((r) => r.slug === "character-sprites");
  toy(
    "partial-sing",
    !!sing && sing.actions.length >= 1 && sing.remaining.includes("music"),
    sing
      ? `actions=${sing.actions.join(",")} remHasMusic=${sing.remaining.includes("music")}`
      : `tops=${rec.map((r) => r.slug).join(",")}`
  );
  toy(
    "partial-character-sprites",
    !!sprites &&
      (sprites.actions.includes("add:image") ||
        sprites.actions.includes("add:resize") ||
        sprites.actions.includes("add:edit")),
    sprites ? `actions=${sprites.actions.join(",")}` : `tops=${rec.map((r) => r.slug).join(",")}`
  );
  toy("text-llm-ranked-nonempty", rec.length >= 1, `n=${rec.length} top=${rec[0]?.slug}`);
}

{
  // Caps at 3 add actions even when remainder is huge (storyboard)
  const sketch = { numNodes: 1, nodeTypeCounts: { text: 1 } };
  const rec = recommendRecipes(corpus, sketch, 5);
  const big = rec.find((r) => r.slug === "storyboard-relay") || rec[0];
  toy(
    "actions-capped-at-3",
    !!big && big.actions.length <= 3 && big.actions.length >= 1,
    `slug=${big?.slug} n=${big?.actions?.length} rem=${big?.remaining?.length}`
  );
}

{
  // Full recipe match → no chip for that recipe
  const ta = corpus.recipes.find((r) => r.slug === "talking-avatar");
  const full = recommendRecipes(corpus, { numNodes: ta.sequence.length, nodeTypeCounts: ta.multiset }, 5);
  toy(
    "complete-recipe-skipped",
    !full.some((r) => r.slug === "talking-avatar"),
    `hits=${full.map((r) => r.slug).join(",") || "(none)"}`
  );
}

{
  // Helpers smoke
  const seq = sequenceFromGraph({ nodes: [{ type: "comment" }, { type: "text" }, { type: "llm" }] });
  const ms = typeMultiset(seq);
  toy(
    "helpers-sequence-multiset",
    seq.join(",") === "text,llm" && ms.text === 1 && ms.llm === 1 && isPartialMatch(ms, { text: 2, llm: 1 }),
    `seq=${seq.join("→")}`
  );
  const rem = remainingSequence(["text", "llm", "image"], { text: 1 });
  toy("helpers-remaining", rem.join(",") === "llm,image", `rem=${rem.join("→")}`);
}

const failed = toys.filter((t) => !t.ok);
console.log(
  `next-action-recipe: ${toys.length - failed.length}/${toys.length} toys ok · recipes=${corpus.recipes.length}`
);
if (failed.length) fail(`${failed.length} toy(s) failed`);
process.exit(0);
