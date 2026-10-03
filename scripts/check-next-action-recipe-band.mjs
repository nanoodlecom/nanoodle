#!/usr/bin/env node
/**
 * Leftover #622 edges: close recipe rivals that disagree stay quiet, an
 * unknown next type is dropped, comments-only is empty, and the engine
 * merges a recipe after anti-slop so a unique completion can lead.
 * The production check pins the gallery rebuild + one sprites completion.
 */
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CLOSE_BAND, MIN_COVERED, confidentRecipe, mergeRecipeHint, recommendRecipes } from "../vendor/next-action/recipe.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-recipe-band: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const sketch = { numNodes: 2, nodeTypeCounts: { text: 1, llm: 1 } };

{
  const corpus = {
    recipes: [
      { id: "a", slug: "a", title: "A", sequence: ["text", "llm", "music"], multiset: { text: 1, llm: 1, music: 1 } },
      { id: "b", slug: "b", title: "B", sequence: ["text", "llm", "image"], multiset: { text: 1, llm: 1, image: 1 } },
    ],
  };
  const rec = recommendRecipes(corpus, sketch, 8);
  assert(rec.length === 2 && rec[0].score === rec[1].score, "tied rivals share a score");
  assert(confidentRecipe(corpus, sketch) === null, "tied rivals that want different next nodes stay quiet");
  assert(CLOSE_BAND === 0.95 && MIN_COVERED === 2, "the quiet-band constants stay the shipped floor");
}

{
  const corpus = {
    recipes: [
      { id: "a", slug: "a", title: "A", sequence: ["text", "llm", "music"], multiset: { text: 1, llm: 1, music: 1 } },
      { id: "b", slug: "b", title: "B", sequence: ["text", "llm", "image"], multiset: { text: 1, llm: 1, image: 1 } },
    ],
  };
  const agree = {
    recipes: [
      corpus.recipes[0],
      { id: "c", slug: "c", title: "C", sequence: ["text", "llm", "music", "tts"], multiset: { text: 1, llm: 1, music: 1, tts: 1 } },
    ],
  };
  const hit = confidentRecipe(agree, sketch);
  assert(hit && hit.type === "music" && hit.action === "add:music", `agreeing rivals still complete, got ${JSON.stringify(hit)}`);
}

{
  const far = {
    recipes: [
      { id: "a", slug: "a", title: "A", sequence: ["text", "llm", "music"], multiset: { text: 1, llm: 1, music: 1 } },
      { id: "long", slug: "long", title: "Long", sequence: ["text", "llm", "image", "edit", "resize", "ivideo", "vedit"], multiset: { text: 1, llm: 1, image: 1, edit: 1, resize: 1, ivideo: 1, vedit: 1 } },
    ],
  };
  const hit = confidentRecipe(far, sketch);
  assert(hit && hit.type === "music", `a far rival does not veto the leader, got ${JSON.stringify(hit)}`);
  const matches = recommendRecipes(far, sketch, 8);
  assert(matches[1] && matches[1].score < matches[0].score * CLOSE_BAND, "the far rival sits below the close band");
}

{
  const corpus = {
    recipes: [
      { id: "ghost", slug: "ghost", title: "Ghost", sequence: ["text", "llm", "notatype"], multiset: { text: 1, llm: 1, notatype: 1 } },
    ],
  };
  assert(confidentRecipe(corpus, sketch, { nodeTypes: new Set(["text", "llm", "image"]) }) === null, "an unknown next type is not a completion");
  const raw = confidentRecipe(corpus, sketch);
  assert(raw && raw.type === "notatype", "without a vocab filter the leftover type is still returned");
}

{
  const corpus = {
    recipes: [
      { id: "a", slug: "a", title: "A", sequence: ["text", "llm", "music"], multiset: { text: 1, llm: 1, music: 1 } },
    ],
  };
  assert(recommendRecipes(corpus, { numNodes: 3, nodeTypeCounts: { comment: 3 } }, 5).length === 0, "comments-only is not a partial");
  assert(confidentRecipe(corpus, { numNodes: 3, nodeTypeCounts: { comment: 3 } }) === null, "comments-only is not a completion");
  assert(confidentRecipe(corpus, { numNodes: 1, nodeTypeCounts: { text: 1 } }) === null, "one covered node stays under MIN_COVERED");
}

{
  const hint = {
    confident: true,
    adds: [{ type: "image", action: "add:image", share: 0.4, reason: "often added next" }],
    wire: { reason: "often wired next" },
    setModel: null,
    openExamples: null,
  };
  const recipe = { slug: "sing", title: "Sing", type: "llm", action: "add:llm", reason: "from Sing recipe" };
  const merged = mergeRecipeHint(hint, recipe);
  assert(merged.adds[0].type === "llm" && merged.adds[0].reason === recipe.reason, "a unique recipe can lead even when anti-slop preferred image");
  assert(merged.adds[1] && merged.adds[1].type === "image", "the previous add stays behind the recipe");
  assert(merged.wire && merged.wire.reason === "often wired next", "a recipe does not invent or drop a wire hint");
}

{
  const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
  const anti = surface.indexOf("rerankShallowAdds");
  const rec = surface.indexOf("mergeRecipeHint");
  assert(anti !== -1 && rec !== -1 && anti < rec, "engine merges a recipe after anti-slop, not before");
}

console.log("✓ next-action-recipe-band: close disagreements stay quiet, unknown types drop, comments are not a match");
