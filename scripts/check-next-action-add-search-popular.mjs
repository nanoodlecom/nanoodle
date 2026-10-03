#!/usr/bin/env node
/**
 * Product · 26 — add-search popular match toys.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickSearchLift, matchRank, REASON } from "../vendor/next-action/add-search-popular.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const tables = JSON.parse(readFileSync(join(NA, "corpus", "frequency-tables.json"), "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const helper = readFileSync(join(NA, "add-search-popular.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");

function fail(msg) {
  console.error(`✗ next-action-add-search-popular: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}
assert(existsSync(join(NA, "add-search-popular.mjs")), "missing helper");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

const meta = {
  upload: { title: "Image input" },
  image: { title: "Image" },
  ivideo: { title: "Image→Video" },
  text: { title: "Text" },
  llm: { title: "LLM" },
  edit: { title: "Edit" },
};

{
  const lift = pickSearchLift("image", tables, meta, ["upload", "image", "ivideo", "edit"]);
  toy("image-lifts-popular", lift && lift.type === "image" && lift.reason === REASON, JSON.stringify(lift));
}

{
  const lift = pickSearchLift("image", tables, meta, ["image", "upload", "ivideo"]);
  toy("already-first-no-tag", lift == null, JSON.stringify(lift));
}

{
  toy("empty-quiet", pickSearchLift("", tables, meta, ["image", "text"]) == null, "empty");
  toy("one-letter-quiet", pickSearchLift("i", tables, meta, ["image", "ivideo", "upload"]) == null, "i");
  toy("nonsense-quiet", pickSearchLift("zzzz", tables, meta, ["image", "text"]) == null, "zzzz");
}

{
  const tied = {
    unigram: { "add:image": 10, "add:ivideo": 10, "add:upload": 1 },
  };
  const lift = pickSearchLift("image", tied, meta, ["upload", "image", "ivideo"]);
  toy("tied-popularity-quiet", lift == null, JSON.stringify(lift));
}

{
  toy("no-fuzzy", matchRank("image", meta.image, "imge") === -1, "typo");
  toy("no-desc-match", !/desc|haystack|levenshtein|charsInOrder/.test(helper), "title/id only");
}

toy("surface", /pickSearchLift\(/.test(surface) && /add-search-popular\.mjs/.test(surface), "surface");
toy("html", index.includes("pickSearchLift") && index.includes("addSearchTypeMeta"), "html");
toy("readme", /·\s*26/.test(readme) && readme.includes("check-next-action-add-search-popular.mjs"), "readme");

const failed = toys.filter((t) => !t.ok);
console.log(`\nadd-search-popular toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) fail(`${failed.length} failed`);
console.log("✓ next-action-add-search-popular");
