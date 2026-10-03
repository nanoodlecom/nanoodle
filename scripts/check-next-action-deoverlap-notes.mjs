#!/usr/bin/env node
/**
 * Leftover #624 edges: sticky notes never slide, bad coordinates are
 * skipped, an empty graph does not throw, and a stack still separates
 * when the caller omits addedId. The production check pins the tidy+nudge
 * happy path and the add-menu undo wiring.
 */
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { countOverlaps, resolveCollisions } from "../vendor/next-action/collision-nudge.mjs";
import { proposeTidyDeltas } from "../vendor/next-action/auto-tidy.mjs";
import { planDeoverlap } from "../vendor/next-action/deoverlap.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`✗ next-action-deoverlap-notes: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

{
  const graph = {
    nodes: [
      { id: "note", type: "comment", x: 100, y: 100, w: 240, h: 180 },
      { id: "a", type: "text", x: 100, y: 100, w: 220, h: 160 },
    ],
  };
  assert(countOverlaps(graph) === 0, "a sticky note stacked on a card is not an overlap");
  const plan = planDeoverlap(graph, { addedId: "a" });
  assert(plan.positions.length === 0 && plan.movedIds.length === 0, "adding on a note does not slide the note");
  assert(proposeTidyDeltas(graph, "a").length === 0, "tidy also ignores the note");
}

{
  const graph = {
    nodes: [
      { id: "bad", type: "text", x: Number.NaN, y: 40, w: 220, h: 160 },
      { id: "a", type: "text", x: 40, y: 40, w: 220, h: 160 },
      { id: "b", type: "llm", x: 50, y: 50, w: 220, h: 200 },
    ],
  };
  assert(countOverlaps(graph) > 0, "finite stacked cards still overlap when a sibling has NaN coords");
  const plan = planDeoverlap(graph, { addedId: "b" });
  assert(!plan.positions.some((p) => p.id === "bad"), "a NaN card is not moved");
  assert(plan.positions.some((p) => p.id === "a" || p.id === "b"), "the finite stack still slides");
}

{
  let empty;
  try { empty = planDeoverlap({}); }
  catch (e) { fail(`empty graph must not throw: ${e}`); }
  assert(empty.positions.length === 0 && empty.cleared === true, "empty graph is already clear");
  let none;
  try { none = planDeoverlap(null); }
  catch (e) { fail(`null graph must not throw: ${e}`); }
  assert(none.positions.length === 0, "null graph stays quiet");
}

{
  const graph = {
    nodes: [
      { id: "a", type: "text", x: 40, y: 40, w: 240, h: 180 },
      { id: "b", type: "llm", x: 70, y: 60, w: 260, h: 220 },
    ],
  };
  const plan = planDeoverlap(graph);
  assert(plan.positions.length > 0, "a stack still separates when addedId is omitted");
  const resolved = resolveCollisions(graph, { maxPasses: 14 });
  assert(resolved.cleared, "collision-only still clears the stack");
}

{
  const index = readFileSync(join(ROOT, "index.html"), "utf8");
  const sep = index.slice(index.indexOf("function separateOnAdd"), index.indexOf("function separateOnAdd") + 700);
  assert(sep.includes('n.type==="comment"'), "the editor drops notes before it plans a slide");
  assert(sep.includes("catch"), "a planner throw does not break add");
}

console.log("✓ next-action-deoverlap-notes: notes stay put, NaN is skipped, omitted addedId still clears a stack");
