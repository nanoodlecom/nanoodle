#!/usr/bin/env node
/**
 * Product · 24 — model-list suggest toys.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rankModelSuggestions, liftChangedModels } from "../vendor/next-action/model-suggest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const priors = JSON.parse(readFileSync(join(NA, "corpus", "model-suggest.json"), "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");

function fail(msg) {
  console.error(`✗ next-action-model-suggest: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}
assert(existsSync(join(NA, "model-suggest.mjs")), "missing helper");
assert(priors.byNodeType && priors.byNodeType.llm, "llm priors");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

const llmIds = ["rare/new", "google/gemini-3.8-flash", "z-ai/glm-5.3-flash", "other/quiet"];
const list = llmIds.map((id) => ({ id }));

{
  const hits = rankModelSuggestions("llm", llmIds, priors);
  toy("llm-glm-leads", hits[0] && hits[0].id === "z-ai/glm-5.3-flash", hits.map((h) => h.id).join(","));
  const lift = liftChangedModels(list, hits);
  toy(
    "tags-only-the-model-that-moved",
    lift && lift.list[0].id === "z-ai/glm-5.3-flash" && lift.tagged.length === 1 && lift.tagged[0] === "z-ai/glm-5.3-flash",
    JSON.stringify(lift && { order: lift.list.map((m) => m.id), tagged: lift.tagged })
  );
}

{
  const already = [{ id: "z-ai/glm-5.3-flash" }, { id: "google/gemini-3.8-flash" }, { id: "rare/new" }];
  const hits = rankModelSuggestions("llm", already.map((m) => m.id), priors);
  toy("already-first-no-tag", liftChangedModels(already, hits) == null, "null");
}

{
  const flat = { byNodeType: { llm: { "a": 4, "b": 4 } } };
  toy("flat-prior-quiet", rankModelSuggestions("llm", ["a", "b", "c"], flat).length === 0, "tie");
}

{
  toy("search-quiet", rankModelSuggestions("llm", llmIds, priors, { searching: true }).length === 0, "search");
  toy("custom-sort-quiet", rankModelSuggestions("llm", llmIds, priors, { customSort: true }).length === 0, "sort");
}

{
  const hits = rankModelSuggestions("image", ["meta/muse-image/text-to-image", "recraft-v4", "unknown"], priors);
  toy("image-muse-leads", hits[0] && hits[0].id === "meta/muse-image/text-to-image", hits.map((h) => h.id + ":" + h.score).join(","));
}

toy("surface", /rankModelSuggestions\(/.test(surface) && /model-suggest\.mjs/.test(surface) && /model-suggest\.json/.test(surface), "surface");
toy("html", index.includes("liftChangedModels") || /galleryApplied/.test(index), "html");
toy("html-keeps-pin-fallback", /modelHintId\(/.test(index) && /liftPinnedModel\(/.test(index), "existing pin");
toy("readme", /·\s*24/.test(readme) && readme.includes("check-next-action-model-suggest.mjs"), "readme");

const failed = toys.filter((t) => !t.ok);
console.log(`\nmodel-suggest toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) fail(`${failed.length} failed`);
console.log("✓ next-action-model-suggest");
