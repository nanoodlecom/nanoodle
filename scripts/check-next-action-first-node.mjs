#!/usr/bin/env node
/**
 * Product · 20 — first-node empty-canvas onboarding toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_VOCAB, NODE_TYPES } from "../vendor/next-action/encode.mjs";
import { recommendFrequency } from "../vendor/next-action/frequency.mjs";
import { chooseHints, projectHints } from "../vendor/next-action/hints.mjs";
import {
  isEmptyCanvas,
  firstNodeCounts,
  rankFirstNodes,
  rankFirstTrioFollowups,
  mergeFirstNodeRows,
  firstNodeSeat,
  shouldSeatFirstNode,
} from "../vendor/next-action/first-node.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-first-node: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const tablesPath = join(NA, "corpus", "frequency-tables.json");
assert(existsSync(tablesPath), "missing frequency-tables.json");
assert(existsSync(join(NA, "first-node.mjs")), "missing first-node.mjs");

const tables = JSON.parse(readFileSync(tablesPath, "utf8"));
const known = new Set(NODE_TYPES);
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  toy("empty-canvas-true", isEmptyCanvas({ numNodes: 0 }, []), "numNodes=0 hist=[]");
  toy(
    "empty-canvas-false-nodes",
    !isEmptyCanvas({ numNodes: 1 }, []),
    "numNodes=1"
  );
  toy(
    "empty-canvas-false-hist",
    !isEmptyCanvas({ numNodes: 0 }, ["add:text"]),
    "hist cold blocked"
  );
}

{
  const counts = firstNodeCounts(tables);
  toy(
    "firstNode-counts",
    (counts["add:text"] || 0) > 0,
    `add:text=${counts["add:text"]}`
  );
  const ranked = rankFirstNodes(tables, { numNodes: 0 }, [], 3);
  toy(
    "rank-first-nodes",
    ranked.length >= 1 && ranked[0].action === "add:text" && ranked[0].source === "first-node",
    `top=${ranked.map((r) => r.action).join(",")}`
  );
  toy(
    "rank-first-nodes-nonempty-quiet",
    rankFirstNodes(tables, { numNodes: 2 }, [], 3).length === 0,
    "quiet when not empty"
  );
}

{
  const follow = rankFirstTrioFollowups(tables, ["add:text"], { numNodes: 1 }, 5);
  const acts = follow.map((r) => r.action);
  toy(
    "trio-followup-after-text",
    follow.length >= 1 &&
      follow.every((r) => r.source === "first-trio") &&
      (acts.includes("add:text") || acts.includes("add:image")),
    `top=${acts.join(",")}`
  );
  toy(
    "trio-followup-empty-quiet",
    rankFirstTrioFollowups(tables, [], { numNodes: 0 }, 3).length === 0,
    "no followups on empty"
  );
  toy(
    "trio-followup-long-hist-quiet",
    rankFirstTrioFollowups(
      tables,
      ["add:text", "add:image", "add:llm"],
      { numNodes: 3 },
      3
    ).length === 0,
    "prefix length >2 quiet"
  );
}

{
  const base = recommendFrequency(tables, [], { numNodes: 0 }, ACTION_VOCAB.length);
  const merged = mergeFirstNodeRows(base, tables, [], { numNodes: 0 });
  const hints = chooseHints({
    frequencyRows: merged,
    nodeTypes: known,
    sketch: { numNodes: 0 },
    coldStart: true,
  });
  toy(
    "empty-menu-confident-text",
    hints.confident &&
      hints.adds[0]?.type === "text" &&
      hints.adds[0]?.reason === "common first node",
    `adds=${hints.adds.map((a) => a.type + ":" + a.reason).join("|")}`
  );
}

{
  const base = recommendFrequency(
    tables,
    ["add:text"],
    { numNodes: 1 },
    ACTION_VOCAB.length
  );
  const merged = mergeFirstNodeRows(base, tables, ["add:text"], { numNodes: 1 });
  const hints = chooseHints({
    frequencyRows: merged,
    nodeTypes: known,
    sketch: { numNodes: 1 },
    coldStart: false,
  });
  const reasons = hints.adds.map((a) => a.reason);
  toy(
    "after-first-opening-reason",
    hints.confident &&
      hints.adds.length >= 1 &&
      reasons.some((r) => r === "common opening" || r === "often added next"),
    `adds=${hints.adds.map((a) => a.type + ":" + a.reason).join("|")}`
  );
}

{
  const flat = ACTION_VOCAB.map((action) => ({ action, score: 1 }));
  const thinTables = { firstNode: {}, coldStart: {}, firstTrio: [] };
  const merged = mergeFirstNodeRows(flat, thinTables, [], { numNodes: 0 });
  const hints = projectHints(merged, { nodeTypes: known });
  toy(
    "unsure-leaves-lists",
    !hints.confident,
    `confident=${hints.confident}`
  );
}

{
  const seat = firstNodeSeat({
    viewW: 1000,
    viewH: 800,
    panX: 0,
    panY: 0,
    scale: 1,
    nodeW: 210,
    nodeH: 120,
  });
  toy(
    "first-seat-center",
    seat.x === Math.round(1000 / 2 - 210 / 2) &&
      seat.y === Math.round(800 / 2 - 120 / 2),
    JSON.stringify(seat)
  );
  toy(
    "should-seat-empty",
    shouldSeatFirstNode({ numNodes: 0 }, true) &&
      !shouldSeatFirstNode({ numNodes: 1 }, true) &&
      !shouldSeatFirstNode({ numNodes: 0 }, false),
    "helpers gate"
  );
}

{
  toy(
    "surface-merges-first-node",
    surface.includes("mergeFirstNodeRows") && surface.includes("first-node.mjs"),
    "editor-surface imports merge"
  );
  toy(
    "index-imports-first-node",
    index.includes('import("./vendor/next-action/first-node.mjs")') &&
      index.includes("firstNodeSeatFn"),
    "index dynamic import"
  );
  toy(
    "index-seats-empty-spawn",
    index.includes("function spawnFirstSeat") &&
      index.includes("firstNodeSeatFn") &&
      index.includes("spawnFirstSeat()") &&
      /Product · 20/.test(index),
    "spawnCenter empty seat"
  );
  for (const needle of ["na-panel", "na-ghost", "placeGhost", "applyTip", "id=\"na-panel\""]) {
    toy(`no-${needle.replace(/[^a-z0-9]+/gi, "-")}`, !index.includes(needle), "forbidden surface");
  }
  toy(
    "no-product-twin-html",
    !existsSync(join(NA, "demo", "product-20.html")) &&
      !existsSync(join(ROOT, "product-20.html")),
    "no mini-demo html"
  );
}

const failed = toys.filter((t) => !t.ok);
if (failed.length) {
  console.error(`✗ next-action-first-node: ${failed.length}/${toys.length} toys failed`);
  process.exit(1);
}
console.log(
  `✓ next-action-first-node: empty seat + firstNode/firstTrio menu boost; toys=${toys.length}/${toys.length}`
);
