#!/usr/bin/env node
/**
 * Product · 25 — empty-canvas follow-up polish toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_VOCAB, NODE_TYPES } from "../vendor/next-action/encode.mjs";
import { recommendFrequency } from "../vendor/next-action/frequency.mjs";
import { chooseHints, projectHints } from "../vendor/next-action/hints.mjs";
import {
  isNearEmptySketch,
  placedNearEmptyType,
  rankEmptyFollowups,
  gateConfidentAdds,
  shouldApplyEmptyFollowup,
  mergeEmptyFollowupRows,
  STRONG_SOURCES,
} from "../vendor/next-action/empty-followup.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-empty-followup: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const tablesPath = join(NA, "corpus", "frequency-tables.json");
assert(existsSync(tablesPath), "missing frequency-tables.json");
assert(existsSync(join(NA, "empty-followup.mjs")), "missing empty-followup.mjs");

const tables = JSON.parse(readFileSync(tablesPath, "utf8"));
const known = new Set(NODE_TYPES);
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const helperSrc = readFileSync(join(NA, "empty-followup.mjs"), "utf8");
const hintsSrc = readFileSync(join(NA, "hints.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  toy("near-empty-0", isNearEmptySketch({ numNodes: 0 }), "0");
  toy("near-empty-1", isNearEmptySketch({ numNodes: 1 }), "1");
  toy("busy-2-quiet", !isNearEmptySketch({ numNodes: 2 }), "2");
  toy("busy-5-quiet", !isNearEmptySketch({ numNodes: 5 }), "5");
  toy(
    "placed-type-text",
    placedNearEmptyType({ numNodes: 1, nodeTypeCounts: { text: 1 } }) === "text",
    "text"
  );
  toy(
    "placed-type-null-on-empty",
    placedNearEmptyType({ numNodes: 0, nodeTypeCounts: {} }) === null,
    "null"
  );
}

{
  const empty = rankEmptyFollowups(tables, { numNodes: 0, nodeTypeCounts: {} }, [], {
    k: 5,
  });
  const acts = empty.map((r) => r.action);
  toy(
    "lift-empty-trio",
    empty.length >= 2 &&
      empty.every((r) => r.source === "cold-start") &&
      acts.includes("add:text"),
    `n=${empty.length} top=${acts.join(",")}`
  );
  toy(
    "lift-empty-has-diversity",
    new Set(acts).size >= 2,
    `unique=${[...new Set(acts)].join(",")}`
  );
}

{
  const sketch = { numNodes: 1, nodeTypeCounts: { text: 1 } };
  const follow = rankEmptyFollowups(tables, sketch, ["add:text"], 5);
  // k passed wrong — fix call
}
{
  const sketch = { numNodes: 1, nodeTypeCounts: { text: 1 } };
  const follow = rankEmptyFollowups(tables, sketch, ["add:text"], { k: 5 });
  const acts = follow.map((r) => r.action);
  toy(
    "lift-1node-matched",
    follow.length >= 1 &&
      follow.every((r) => r.source === "first-trio") &&
      (acts.includes("add:text") ||
        acts.includes("add:image") ||
        acts.includes("add:llm")),
    `top=${acts.join(",")}`
  );
}

{
  const sketch = { numNodes: 1, nodeTypeCounts: { model3d: 1 } };
  const follow = rankEmptyFollowups(tables, sketch, ["add:model3d"], { k: 5 });
  const acts = follow.map((r) => r.action);
  toy(
    "lift-1node-thin-fallback",
    follow.length >= 1 &&
      follow.every((r) => r.source === "empty-followup") &&
      acts.some((a) =>
        ["add:text", "add:image", "add:llm"].includes(a)
      ),
    `top=${acts.join(",")}`
  );
}

{
  toy(
    "rank-quiet-busy",
    rankEmptyFollowups(
      tables,
      { numNodes: 4, nodeTypeCounts: { text: 2, image: 2 } },
      ["add:text"],
      { k: 3 }
    ).length === 0,
    "busy quiet"
  );
}

{
  const base = recommendFrequency(
    tables,
    [],
    { numNodes: 0 },
    ACTION_VOCAB.length
  );
  const merged = mergeEmptyFollowupRows(base, tables, [], { numNodes: 0 }, {
    nodeTypes: known,
  });
  const hints = chooseHints({
    frequencyRows: merged,
    nodeTypes: known,
    sketch: { numNodes: 0 },
    coldStart: true,
  });
  toy(
    "merge-empty-confident",
    hints.confident && hints.adds.length >= 1,
    `adds=${hints.adds.map((a) => a.type + ":" + a.reason).join("|")}`
  );
  toy(
    "merge-empty-trio-or-pair",
    hints.adds.length >= 2,
    `hintAdds=${hints.adds.length} topMerged=${merged
      .slice(0, 3)
      .map((r) => r.action)
      .join(",")} reasons=${hints.adds.map((a) => a.type+":"+a.reason).join("|")}`
  );
  toy(
    "merge-empty-opening-reason",
    hints.adds.some(
      (a) =>
        a.reason === "common first node" || a.reason === "common opening"
    ),
    `reasons=${hints.adds.map((a) => a.reason).join("|")}`
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
  const merged = mergeEmptyFollowupRows(
    base,
    tables,
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
  toy(
    "merge-1node-when-postfirst-quiet",
    hints.confident && hints.adds.length >= 1,
    `adds=${hints.adds.map((a) => a.type + ":" + a.reason).join("|")}`
  );
}

{
  const sketch = { numNodes: 1, nodeTypeCounts: { text: 1 } };
  const strongPrior = [
    { action: "add:image", score: 40, source: "first-trio" },
    { action: "add:llm", score: 10, source: "first-trio" },
    { action: "add:text", score: 5, source: "first-trio" },
  ];
  toy(
    "should-quiet-strong-prior",
    !shouldApplyEmptyFollowup(strongPrior, sketch),
    "strong first-trio"
  );
  toy(
    "should-quiet-postfirst-flag",
    !shouldApplyEmptyFollowup([], sketch, { postFirstConfident: true }),
    "flag"
  );
  toy(
    "should-quiet-recipe-flag",
    !shouldApplyEmptyFollowup([], sketch, { recipeConfident: true }),
    "recipe flag"
  );
  toy(
    "should-quiet-priorHints-strong",
    !shouldApplyEmptyFollowup([], sketch, {
      priorHints: {
        confident: true,
        adds: [{ type: "image", source: "first-trio", reason: "common opening" }],
      },
    }),
    "priorHints"
  );
  const flatFreq = [
    { action: "add:text", score: 39, source: "frequency" },
  ];
  toy(
    "should-apply-freq-only",
    shouldApplyEmptyFollowup(flatFreq, { numNodes: 0 }),
    "freq-only ok"
  );
  const mergedQuiet = mergeEmptyFollowupRows(
    strongPrior,
    tables,
    ["add:text"],
    sketch,
    { nodeTypes: known }
  );
  toy(
    "merge-quiet-when-postfirst-confident",
    mergedQuiet.length === strongPrior.length &&
      mergedQuiet.every(
        (r, i) =>
          r.action === strongPrior[i].action && r.score === strongPrior[i].score
      ),
    "unchanged"
  );
}

{
  const flat = ACTION_VOCAB.map((action) => ({ action, score: 1 }));
  const many = mergeEmptyFollowupRows(
    flat,
    tables,
    ["add:text", "add:image"],
    { numNodes: 5, nodeTypeCounts: { text: 2, image: 3 } },
    { nodeTypes: known }
  );
  toy(
    "many-phase-unchanged",
    many.length === flat.length &&
      many.every(
        (r, i) => r.action === flat[i].action && r.score === flat[i].score
      ),
    "busy unchanged"
  );
  const thin = mergeEmptyFollowupRows(
    flat,
    { firstNode: {}, coldStart: {}, firstTrio: [] },
    [],
    { numNodes: 0 },
    { nodeTypes: known }
  );
  toy(
    "thin-tables-unchanged-or-empty-boost",
    Array.isArray(thin),
    `n=${thin.length}`
  );
}

{
  toy(
    "surface-merges-empty-followup",
    surface.includes("mergeEmptyFollowupRows") &&
      surface.includes("empty-followup.mjs"),
    "editor-surface imports merge"
  );
  toy(
    "hints-source-reasons",
    hintsSrc.includes('source === "empty-followup"') &&
      hintsSrc.includes('source === "cold-start"') &&
      hintsSrc.includes("common opening") &&
      hintsSrc.includes("common first node"),
    "reason tags"
  );
  toy(
    "readme-mentions-25",
    readme.includes("empty-followup.mjs") && /· 25/.test(readme),
    "README row"
  );
  toy(
    "check-script-listed",
    readme.includes("check-next-action-empty-followup.mjs"),
    "README checks"
  );
  toy(
    "strong-sources-exported",
    Array.isArray(STRONG_SOURCES) && STRONG_SOURCES.includes("post-first"),
    STRONG_SOURCES.join(",")
  );
}

{
  const forbidden = [
    "na-panel",
    "na-ghost",
    "placeGhost",
    "applyTip",
    'id="na-panel"',
    "product-25.html",
    "?product=25",
  ];
  for (const needle of forbidden) {
    toy(
      `no-forbidden-${needle.replace(/[^a-z0-9]+/gi, "-")}`,
      !helperSrc.includes(needle) &&
        !surface.includes("demo/product-25") &&
        !(
          needle.startsWith("na-") ||
          needle === "placeGhost" ||
          needle === "applyTip"
            ? index.includes(needle)
            : false
        ) &&
        !existsSync(join(NA, "demo", "product-25.html")) &&
        !existsSync(join(ROOT, "product-25.html")),
      needle
    );
  }
  for (const needle of [
    "tip panel",
    "tip-panel",
    "na-panel",
    "placeGhost",
    "?product=",
    "product-25.html",
  ]) {
    const docOk =
      needle === "tip panel" ||
      needle === "?product=" ||
      needle === "tip-panel";
    if (docOk) {
      toy(
        `doc-only-${needle.replace(/[^a-z0-9]+/gi, "-")}`,
        !helperSrc.includes("mountTip") &&
          !helperSrc.includes("createPanel") &&
          !existsSync(join(NA, "demo", "product-25.html")),
        "no tip surface impl"
      );
    } else {
      toy(
        `no-surface-${needle.replace(/[^a-z0-9]+/gi, "-")}`,
        !helperSrc.includes(needle) &&
          !existsSync(join(NA, "demo", "product-25.html")),
        needle
      );
    }
  }
}

{
  // gate helper sanity
  const gated = gateConfidentAdds([
    { action: "add:text", score: 50 },
    { action: "add:image", score: 10 },
  ]);
  toy("gate-confident-passes", gated.length >= 1, `n=${gated.length}`);
  const flat = gateConfidentAdds([
    { action: "add:text", score: 1 },
    { action: "add:image", score: 1 },
    { action: "add:llm", score: 1 },
  ]);
  toy("gate-flat-quiets", flat.length === 0, `n=${flat.length}`);
}

const failed = toys.filter((t) => !t.ok);
if (failed.length) {
  console.error(
    `✗ next-action-empty-followup: ${failed.length}/${toys.length} toys failed`
  );
  process.exit(1);
}
console.log(
  `✓ next-action-empty-followup: popular-next Suggested lift; toys=${toys.length}/${toys.length}`
);
