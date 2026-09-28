#!/usr/bin/env node
/**
 * Adding a node that lands on top of another slides them apart.
 * A clear landing does not move anything. The slide shares the add's undo.
 */
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { proposeTidyDeltas, minPairGap as tidyGap } from "../vendor/next-action/auto-tidy.mjs";
import { countOverlaps, resolveCollisions } from "../vendor/next-action/collision-nudge.mjs";
import { planDeoverlap } from "../vendor/next-action/deoverlap.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`✗ next-action-deoverlap: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

{
  const graph = {
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, w: 220, h: 160 },
      { id: "b", type: "llm", x: 800, y: 600, w: 220, h: 200 },
    ],
  };
  assert(countOverlaps(graph) === 0, "distant nodes are not an overlap");
  const plan = planDeoverlap(graph, { addedId: "b" });
  assert(plan.positions.length === 0 && plan.movedIds.length === 0, "no overlap means nothing moves");
}

{
  const graph = {
    nodes: [
      { id: "a", type: "text", x: 100, y: 100 },
      { id: "b", type: "image", x: 100, y: 100 },
    ],
  };
  const deltas = proposeTidyDeltas(graph, "b");
  assert(deltas.length === 1 && deltas[0].id === "a", "tidy moves the neighbour, not the new node");
  assert(Math.hypot(deltas[0].dx, deltas[0].dy) <= 96, "tidy nudge is clamped");
  assert(tidyGap(graph, deltas) > tidyGap(graph, []), "tidy opens air between the pair");
}

{
  const graph = {
    nodes: [
      { id: "a", type: "text", x: 40, y: 40, w: 240, h: 180 },
      { id: "b", type: "llm", x: 70, y: 60, w: 260, h: 220 },
    ],
  };
  assert(countOverlaps(graph) > 0, "stacked cards overlap");
  const resolved = resolveCollisions(graph, { maxPasses: 14 });
  assert(resolved.positions.length > 0, "collision nudge proposes a slide");
  assert(resolved.cleared, "multi-pass nudge clears the stack");
  const plan = planDeoverlap(graph, { addedId: "b" });
  assert(plan.positions.length > 0, "deoverlap moves a stacked add");
  assert(!plan.positions.some((p) => !graph.nodes.find((n) => n.id === p.id)), "only existing nodes move");
  const after = {
    nodes: graph.nodes.map((n) => {
      const p = plan.positions.find((q) => q.id === n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
  };
  assert(countOverlaps(after) === 0, "the combined plan clears measured overlap");
}

{
  const index = readFileSync(join(ROOT, "index.html"), "utf8");
  const tidy = readFileSync(join(ROOT, "vendor/next-action/auto-tidy.mjs"), "utf8");
  const nudge = readFileSync(join(ROOT, "vendor/next-action/collision-nudge.mjs"), "utf8");
  assert(index.includes("function separateOnAdd"), "editor separates on add");
  assert(index.includes("separateOnAdd(n)"), "add paths call the separator");
  const spawn = index.slice(index.indexOf("function spawnCenter"), index.indexOf("function spawnCenter") + 700);
  const quick = index.slice(index.indexOf("function quickSpawn"), index.indexOf("function quickSpawn") + 1200);
  assert(spawn.includes("separateOnAdd(n)"), "add menu separates");
  assert(quick.includes("separateOnAdd(n)"), "quick-add separates");
  assert(!spawn.includes("pushUndo") && !quick.includes("pushUndo"), "the slide does not open its own undo step");
  assert(index.indexOf("function addNode") < index.indexOf("separateOnAdd(n)"), "separation runs after the add");
  assert(!tidy.includes("na-panel") && !nudge.includes("placeGhost"), "no panel or ghost");
  assert(!index.includes("Mess up") && !index.includes("Scramble"), "no demo scramble button");
}

console.log("✓ next-action-deoverlap: overlap slides apart, a clear landing stays put, undo stays with the add");
