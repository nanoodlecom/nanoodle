#!/usr/bin/env node
/**
 * Product · 11 — auto-tidy on node add toys.
 */
import {
  boxesFromGraph,
  proposeTidyDeltas,
  tidyAfterAdd,
  applyDeltasAbsolute,
  minPairGap,
  overlapDepth,
  NODE_W,
  NODE_H,
  GAP,
  MAX_NUDGE,
} from "../vendor/next-action/auto-tidy.mjs";

function fail(msg) {
  console.error(`✗ next-action-auto-tidy: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

// 1. Empty graph → no deltas
{
  const d = proposeTidyDeltas({ nodes: [] }, "n1");
  toy("empty-graph", d.length === 0, `n=${d.length}`);
}

// 2. Single node → no deltas
{
  const g = { nodes: [{ id: "a", x: 100, y: 100, type: "text" }] };
  const d = tidyAfterAdd(g, "a");
  toy("single-node", d.length === 0, `n=${d.length}`);
}

// 3. Two overlapping nodes after add → neighbor moves away
{
  const g = {
    nodes: [
      { id: "old", x: 200, y: 200, type: "text" },
      { id: "new", x: 210, y: 210, type: "llm" },
    ],
  };
  const before = minPairGap(g, []);
  const d = proposeTidyDeltas(g, "new");
  toy(
    "overlap-moves-neighbor",
    d.length === 1 && d[0].id === "old" && (Math.abs(d[0].dx) > 1 || Math.abs(d[0].dy) > 1),
    `deltas=${JSON.stringify(d)} beforeGap=${before.toFixed(1)}`
  );
}

// 4. Distant nodes → no move
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: 600, y: 400, type: "image" },
    ],
  };
  const d = proposeTidyDeltas(g, "b");
  toy("distant-no-move", d.length === 0, `n=${d.length}`);
}

// 5. New node itself not in delta list
{
  const g = {
    nodes: [
      { id: "n1", x: 100, y: 100, type: "text" },
      { id: "n2", x: 120, y: 110, type: "llm" },
      { id: "n3", x: 140, y: 120, type: "image" },
    ],
  };
  const d = proposeTidyDeltas(g, "n2");
  toy(
    "new-node-not-moved",
    d.every((x) => x.id !== "n2"),
    `ids=${d.map((x) => x.id).join(",")}`
  );
}

// 6. Gap after tidy improves (overlap reduced)
{
  const g = {
    nodes: [
      { id: "a", x: 200, y: 200, type: "text" },
      { id: "b", x: 220, y: 220, type: "llm" },
    ],
  };
  const before = minPairGap(g, []);
  const d = proposeTidyDeltas(g, "b");
  const after = minPairGap(g, d);
  toy(
    "gap-improves",
    after > before,
    `before=${before.toFixed(1)} after=${after.toFixed(1)}`
  );
}

// 7. Idempotent-ish: second tidy with no remaining overlap → empty/small
{
  const g0 = {
    nodes: [
      { id: "a", x: 200, y: 200, type: "text" },
      { id: "b", x: 210, y: 205, type: "llm" },
    ],
  };
  const d1 = proposeTidyDeltas(g0, "b");
  const abs = applyDeltasAbsolute(g0, d1);
  const g1 = {
    nodes: g0.nodes.map((n) => {
      const p = abs.find((x) => x.id === n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
  };
  // If still overlapping, one more pass; then check a pass with plenty of room
  const d2 = proposeTidyDeltas(g1, "b");
  const abs2 = applyDeltasAbsolute(g1, d2);
  const g2 = {
    nodes: g1.nodes.map((n) => {
      const p = abs2.find((x) => x.id === n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
  };
  // Force distant and re-tidy
  g2.nodes[0].x = 0;
  g2.nodes[0].y = 0;
  g2.nodes[1].x = 500;
  g2.nodes[1].y = 400;
  const d3 = proposeTidyDeltas(g2, "b");
  toy("idempotent-distant", d3.length === 0, `n=${d3.length} (after room)`);
}

// 8. Max nudge clamp
{
  const g = {
    nodes: [
      { id: "a", x: 100, y: 100, type: "text" },
      { id: "b", x: 100, y: 100, type: "llm" }, // perfect stack
    ],
  };
  const d = proposeTidyDeltas(g, "b");
  const mag = d.length ? Math.hypot(d[0].dx, d[0].dy) : 0;
  toy(
    "max-nudge-clamp",
    d.length === 1 && mag <= MAX_NUDGE + 0.1,
    `mag=${mag.toFixed(1)} max=${MAX_NUDGE}`
  );
}

// 9. Comments ignored in boxesFromGraph
{
  const boxes = boxesFromGraph({
    nodes: [
      { id: "c", x: 0, y: 0, type: "comment" },
      { id: "t", x: 10, y: 10, type: "text" },
    ],
  });
  toy(
    "comments-ignored",
    boxes.length === 1 && boxes[0].id === "t",
    `ids=${boxes.map((b) => b.id).join(",")}`
  );
}

// 10. boxesFromGraph reads {id,x,y}
{
  const boxes = boxesFromGraph({
    nodes: [{ id: "z", x: 50, y: 75, type: "image" }],
  });
  toy(
    "boxes-from-graph",
    boxes.length === 1 &&
      boxes[0].x === 50 &&
      boxes[0].y === 75 &&
      boxes[0].cx === 50 + NODE_W / 2 &&
      boxes[0].cy === 75 + NODE_H / 2,
    `box=${JSON.stringify(boxes[0])}`
  );
}

// 11. Unknown added id → no deltas
{
  const d = proposeTidyDeltas(
    { nodes: [{ id: "a", x: 0, y: 0, type: "text" }] },
    "missing"
  );
  toy("unknown-added-id", d.length === 0, `n=${d.length}`);
}

const passed = toys.filter((t) => t.ok).length;
const total = toys.length;
console.log(`\nnext-action-auto-tidy toys: ${passed}/${total}`);
assert(NODE_W > 0 && NODE_H > 0 && GAP > 0, "constants positive");
assert(typeof overlapDepth === "function", "overlapDepth exported");
if (passed < total) fail(`${total - passed} toy(s) failed`);
console.log("✓ next-action-auto-tidy ok");
