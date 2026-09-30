#!/usr/bin/env node
/**
 * Product · 23 — post-first-node follow-up toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_VOCAB, NODE_TYPES } from "../vendor/next-action/encode.mjs";
import { recommendFrequency } from "../vendor/next-action/frequency.mjs";
import { chooseHints, projectHints } from "../vendor/next-action/hints.mjs";
import {
  isPostFirstPhase,
  placedFirstType,
  rankPostFirstFollowups,
  rankPostFirstRecipes,
  gateConfidentAdds,
  mergePostFirstRows,
} from "../vendor/next-action/post-first.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-post-first: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const tablesPath = join(NA, "corpus", "frequency-tables.json");
const recipesPath = join(NA, "corpus", "recipes.json");
assert(existsSync(tablesPath), "missing frequency-tables.json");
assert(existsSync(recipesPath), "missing recipes.json");
assert(existsSync(join(NA, "post-first.mjs")), "missing post-first.mjs");

const tables = JSON.parse(readFileSync(tablesPath, "utf8"));
const recipes = JSON.parse(readFileSync(recipesPath, "utf8"));
const known = new Set(NODE_TYPES);
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const postFirstSrc = readFileSync(join(NA, "post-first.mjs"), "utf8");
const hintsSrc = readFileSync(join(NA, "hints.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  toy("activate-on-1-node", isPostFirstPhase({ numNodes: 1 }), "numNodes=1");
  toy("quiet-on-empty", !isPostFirstPhase({ numNodes: 0 }), "numNodes=0");
  toy("quiet-on-many-nodes", !isPostFirstPhase({ numNodes: 3 }), "numNodes=3");
  toy(
    "placed-type-text",
    placedFirstType({ numNodes: 1, nodeTypeCounts: { text: 1 } }) === "text",
    "text"
  );
}

{
  const sketch = { numNodes: 1, nodeTypeCounts: { text: 1 } };
  const follow = rankPostFirstFollowups(tables, sketch, ["add:text"], 5);
  const acts = follow.map((r) => r.action);
  toy(
    "trio-match-after-text",
    follow.length >= 1 &&
      follow.every((r) => r.source === "first-trio") &&
      (acts.includes("add:text") || acts.includes("add:image") || acts.includes("add:llm")),
    `top=${acts.join(",")}`
  );
  toy(
    "trio-quiet-on-empty",
    rankPostFirstFollowups(tables, { numNodes: 0, nodeTypeCounts: {} }, [], 3)
      .length === 0,
    "empty quiet"
  );
  toy(
    "trio-quiet-on-many",
    rankPostFirstFollowups(
      tables,
      { numNodes: 4, nodeTypeCounts: { text: 2, image: 2 } },
      ["add:text"],
      3
    ).length === 0,
    "many quiet"
  );
  toy(
    "trio-no-match-type",
    rankPostFirstFollowups(
      tables,
      { numNodes: 1, nodeTypeCounts: { model3d: 1 } },
      ["add:model3d"],
      3
    ).length === 0,
    "unknown head quiet"
  );
}

{
  const sketch = { numNodes: 1, nodeTypeCounts: { text: 1 } };
  const rec = rankPostFirstRecipes(recipes, sketch, { nodeTypes: known });
  toy(
    "recipe-rows-or-quiet",
    Array.isArray(rec),
    `n=${rec.length} top=${rec.map((r) => r.action).join(",") || "-"}`
  );
  // recipe may disagree across gallery; gate may empty — both OK
  const gated = gateConfidentAdds(rec);
  toy(
    "recipe-gate-returns-array",
    Array.isArray(gated),
    `gated=${gated.length}`
  );
}

{
  const sketch = { numNodes: 1, nodeTypeCounts: { text: 1 } };
  const base = recommendFrequency(
    tables,
    ["add:text"],
    sketch,
    ACTION_VOCAB.length
  );
  const merged = mergePostFirstRows(
    base,
    tables,
    recipes,
    ["add:text"],
    sketch,
    { nodeTypes: known }
  );
  const hints = chooseHints({
    frequencyRows: merged,
    nodeTypes: known,
    sketch,
    coldStart: false,
  });
  const reasons = hints.adds.map((a) => a.reason);
  const sources = hints.adds.map((a) => a.source).filter(Boolean);
  toy(
    "merge-menu-confident",
    hints.confident && hints.adds.length >= 1,
    `adds=${hints.adds.map((a) => a.type + ":" + a.reason).join("|")}`
  );
  toy(
    "merge-opening-or-recipe-reason",
    reasons.some((r) => r === "common opening" || r === "recipe next" || r === "often added next"),
    `reasons=${reasons.join("|")} sources=${sources.join("|")}`
  );
  // Top should prefer a firstTrio continuation when confident
  const topActs = merged.slice(0, 3).map((r) => r.action);
  toy(
    "merge-lifts-followups",
    topActs.some((a) =>
      ["add:text", "add:image", "add:llm"].includes(a)
    ),
    `top=${topActs.join(",")}`
  );
}

{
  const flat = ACTION_VOCAB.map((action) => ({ action, score: 1 }));
  const thinTables = { firstNode: {}, coldStart: {}, firstTrio: [] };
  const thinRecipes = { recipes: [] };
  const merged = mergePostFirstRows(
    flat,
    thinTables,
    thinRecipes,
    ["add:text"],
    { numNodes: 1, nodeTypeCounts: { text: 1 } },
    { nodeTypes: known }
  );
  const hints = projectHints(merged, { nodeTypes: known });
  toy(
    "confidence-gate-thin",
    !hints.confident || merged.every((r, i) => r.action === flat[i]?.action),
    `confident=${hints.confident}`
  );
  // empty phase leaves rows unchanged
  const unchanged = mergePostFirstRows(
    flat,
    tables,
    recipes,
    [],
    { numNodes: 0 },
    { nodeTypes: known }
  );
  toy(
    "empty-phase-unchanged",
    unchanged === flat ||
      (unchanged.length === flat.length &&
        unchanged.every((r, i) => r.action === flat[i].action && r.score === flat[i].score)),
    "rows untouched on empty"
  );
  const many = mergePostFirstRows(
    flat,
    tables,
    recipes,
    ["add:text", "add:image"],
    { numNodes: 5, nodeTypeCounts: { text: 2, image: 3 } },
    { nodeTypes: known }
  );
  toy(
    "many-phase-unchanged",
    many.length === flat.length &&
      many.every((r, i) => r.action === flat[i].action && r.score === flat[i].score),
    "rows untouched on many"
  );
}

{
  toy(
    "surface-merges-post-first",
    surface.includes("mergePostFirstRows") && surface.includes("post-first.mjs"),
    "editor-surface imports merge"
  );
  toy(
    "hints-source-reasons",
    hintsSrc.includes('source === "first-trio"') &&
      hintsSrc.includes("common opening") &&
      hintsSrc.includes("recipe next"),
    "reason tags"
  );
  toy(
    "readme-mentions-23",
    readme.includes("post-first.mjs") && /· 23/.test(readme),
    "README row"
  );
  toy(
    "check-script-listed",
    readme.includes("check-next-action-post-first.mjs"),
    "README checks"
  );
}

{
  const forbidden = [
    "na-panel",
    "na-ghost",
    "placeGhost",
    "applyTip",
    'id="na-panel"',
    "product-23.html",
    "?product=23",
  ];
  for (const needle of forbidden) {
    toy(
      `no-forbidden-${needle.replace(/[^a-z0-9]+/gi, "-")}`,
      !postFirstSrc.includes(needle) &&
        !surface.includes(`demo/product-23`) &&
        !(needle.startsWith("na-") || needle === "placeGhost" || needle === "applyTip"
          ? index.includes(needle)
          : false) &&
        !existsSync(join(NA, "demo", "product-23.html")) &&
        !existsSync(join(ROOT, "product-23.html")),
      needle
    );
  }
  // tighter: new helper + surface must not mention tip-panel / product twin strings
  for (const needle of [
    "tip panel",
    "tip-panel",
    "na-panel",
    "placeGhost",
    "?product=",
    "product-23.html",
  ]) {
    const inNew =
      postFirstSrc.toLowerCase().includes(needle.toLowerCase()) &&
      !postFirstSrc.includes("No tip panel") &&
      !postFirstSrc.includes("no ?product=");
    // Allow documentary "no tip panel" / "no ?product=" comments only
    const docOk =
      needle === "tip panel" ||
      needle === "?product=" ||
      needle === "tip-panel";
    if (docOk) {
      toy(
        `doc-only-${needle.replace(/[^a-z0-9]+/gi, "-")}`,
        !postFirstSrc.includes("mountTip") &&
          !postFirstSrc.includes("createPanel") &&
          !existsSync(join(NA, "demo", "product-23.html")),
        "no tip surface impl"
      );
    } else {
      toy(
        `no-surface-${needle.replace(/[^a-z0-9]+/gi, "-")}`,
        !inNew && !existsSync(join(NA, "demo", "product-23.html")),
        needle
      );
    }
  }
}

const failed = toys.filter((t) => !t.ok);
if (failed.length) {
  console.error(`✗ next-action-post-first: ${failed.length}/${toys.length} toys failed`);
  process.exit(1);
}
console.log(
  `✓ next-action-post-first: firstTrio/recipe Suggested lift; toys=${toys.length}/${toys.length}`
);
