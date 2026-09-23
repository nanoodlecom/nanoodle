#!/usr/bin/env node
/**
 * Product · 12 — collision-aware nudge toys.
 */
import {
  boxesFromGraph,
  proposeCollisionDeltas,
  resolveCollisions,
  planCollisionPasses,
  applyDeltasAbsolute,
  minPairGap,
  countOverlaps,
  overlapDepth,
  NODE_W,
  NODE_H,
  GAP,
  MAX_NUDGE,
  MAX_PASSES,
  TIP_OVERLAP_X,
  TIP_OVERLAP_Y,
} from "../vendor/next-action/collision-nudge.mjs";

function fail(msg) {
  console.error(`✗ next-action-collision-nudge: ${msg}`);
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

// 1. Empty graph → no deltas / resolve no-op
{
  const d = proposeCollisionDeltas({ nodes: [] });
  const r = resolveCollisions({ nodes: [] });
  toy(
    "empty-graph",
    d.length === 0 && r.positions.length === 0 && r.cleared,
    `deltas=${d.length} pos=${r.positions.length}`
  );
}

// 2. Single node → no deltas
{
  const g = { nodes: [{ id: "a", x: 100, y: 100, type: "text" }] };
  const d = proposeCollisionDeltas(g);
  const r = resolveCollisions(g);
  toy(
    "single-node",
    d.length === 0 && r.positions.length === 0 && r.cleared,
    `n=${d.length}`
  );
}

// 3. Perfect stack → de-overlaps (both may move); gap improves
{
  const g = {
    nodes: [
      { id: "a", x: 200, y: 200, type: "text" },
      { id: "b", x: 200, y: 200, type: "llm" },
    ],
  };
  const before = minPairGap(g, []);
  const r = resolveCollisions(g);
  const gAfter = {
    nodes: g.nodes.map((n) => {
      const p = r.positions.find((x) => x.id === n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
  };
  const after = minPairGap(gAfter, []);
  toy(
    "perfect-stack-deoverlaps",
    r.positions.length >= 1 && after > before,
    `moved=${r.movedIds.join(",")} passes=${r.passes} before=${before.toFixed(1)} after=${after.toFixed(1)} cleared=${r.cleared}`
  );
}

// 4. Distant nodes → no-op
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: 600, y: 400, type: "image" },
    ],
  };
  const d = proposeCollisionDeltas(g);
  const r = resolveCollisions(g);
  toy(
    "distant-no-op",
    d.length === 0 && r.positions.length === 0 && r.cleared,
    `n=${d.length}`
  );
}

// 5. Iteration cap respected
{
  const g = {
    nodes: [
      { id: "a", x: 100, y: 100, type: "text" },
      { id: "b", x: 110, y: 110, type: "llm" },
      { id: "c", x: 105, y: 105, type: "image" },
      { id: "d", x: 115, y: 100, type: "video" },
    ],
  };
  const cap = 3;
  const r = resolveCollisions(g, { maxPasses: cap, maxNudge: 8, lerp: 0.15 });
  toy(
    "iteration-cap",
    r.passes <= cap,
    `passes=${r.passes} cap=${cap} cleared=${r.cleared}`
  );
}

// 6. Newly added (or any) colliding node MAY move — unlike · 11
{
  const g = {
    nodes: [
      { id: "old", x: 200, y: 200, type: "text" },
      { id: "new", x: 210, y: 210, type: "llm" },
    ],
  };
  const d = proposeCollisionDeltas(g);
  const ids = d.map((x) => x.id);
  toy(
    "new-node-may-move",
    ids.includes("new") || ids.includes("old"),
    `ids=${ids.join(",")} (·12 may move either)`
  );
  toy(
    "all-pairs-moves-both-often",
    ids.includes("new") && ids.includes("old"),
    `ids=${ids.join(",")}`
  );
}

// 7. Comments ignored
{
  const boxes = boxesFromGraph({
    nodes: [
      { id: "c", x: 0, y: 0, type: "comment" },
      { id: "t", x: 10, y: 10, type: "text" },
      { id: "u", x: 15, y: 15, type: "llm" },
    ],
  });
  const r = resolveCollisions({
    nodes: [
      { id: "c", x: 0, y: 0, type: "comment" },
      { id: "t", x: 10, y: 10, type: "text" },
      { id: "u", x: 15, y: 15, type: "llm" },
    ],
  });
  toy(
    "comments-ignored",
    boxes.length === 2 && !r.movedIds.includes("c"),
    `boxes=${boxes.map((b) => b.id).join(",")} moved=${r.movedIds.join(",")}`
  );
}

// 8. Gap improves after multi-pass
{
  const g = {
    nodes: [
      { id: "a", x: 200, y: 200, type: "text" },
      { id: "b", x: 220, y: 220, type: "llm" },
      { id: "c", x: 240, y: 200, type: "image" },
    ],
  };
  const before = minPairGap(g, []);
  const overlapsBefore = countOverlaps(g);
  const r = resolveCollisions(g);
  const gAfter = {
    nodes: g.nodes.map((n) => {
      const p = r.positions.find((x) => x.id === n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
  };
  const after = minPairGap(gAfter, []);
  const overlapsAfter = countOverlaps(gAfter);
  toy(
    "gap-improves",
    overlapsBefore > 0 && (overlapsAfter < overlapsBefore || r.cleared) && overlapsAfter <= overlapsBefore,
    `before=${before.toFixed(1)} after=${after.toFixed(1)} ov ${overlapsBefore}→${overlapsAfter} cleared=${r.cleared} passes=${r.passes}`
  );
}

// 9. Max nudge clamp per pass
{
  const g = {
    nodes: [
      { id: "a", x: 100, y: 100, type: "text" },
      { id: "b", x: 100, y: 100, type: "llm" },
    ],
  };
  const d = proposeCollisionDeltas(g);
  const ok = d.every((x) => Math.hypot(x.dx, x.dy) <= MAX_NUDGE + 0.1);
  toy("max-nudge-clamp", d.length >= 1 && ok, `n=${d.length} max=${MAX_NUDGE}`);
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

// 11. resolve clears simple two-node overlap within default passes
{
  const g = {
    nodes: [
      { id: "a", x: 100, y: 100, type: "text" },
      { id: "b", x: 130, y: 120, type: "llm" },
    ],
  };
  const r = resolveCollisions(g);
  toy(
    "resolve-clears-pair",
    r.cleared && r.passes > 0 && r.passes <= MAX_PASSES,
    `passes=${r.passes} cleared=${r.cleared}`
  );
}


// 12. tip half-card overlap clears (mode-12 landing feel)
{
  const g = {
    nodes: [
      { id: "a", x: 280, y: 200, type: "text" },
      { id: "b", x: 280 + TIP_OVERLAP_X, y: 200 + TIP_OVERLAP_Y, type: "llm" },
    ],
  };
  const r = resolveCollisions(g);
  toy(
    "tip-overlap-clears",
    r.cleared && r.passes > 0 && r.passes <= MAX_PASSES,
    `passes=${r.passes} cleared=${r.cleared} tip=+${TIP_OVERLAP_X},+${TIP_OVERLAP_Y}`
  );
}

// 13. planCollisionPasses exposes per-pass snapshots (for rAF animation)
{
  const g = {
    nodes: [
      { id: "a", x: 100, y: 100, type: "text" },
      { id: "b", x: 130, y: 120, type: "llm" },
    ],
  };
  const plan = planCollisionPasses(g);
  const snapsOk =
    plan.passSnapshots.length === plan.passes &&
    plan.passSnapshots.length > 0 &&
    plan.passSnapshots.every(
      (s) => Array.isArray(s.positions) && s.positions.length >= 1
    );
  const last = plan.passSnapshots[plan.passSnapshots.length - 1];
  const finalsMatch =
    last &&
    last.positions.length === plan.positions.length &&
    last.positions.every((p) => {
      const f = plan.positions.find((x) => x.id === p.id);
      return f && Math.abs(f.x - p.x) < 0.01 && Math.abs(f.y - p.y) < 0.01;
    });
  toy(
    "plan-pass-snapshots",
    snapsOk && finalsMatch && plan.cleared,
    `snaps=${plan.passSnapshots.length} cleared=${plan.cleared}`
  );
}

// 14. box size toward real editor cards
{
  toy(
    "box-size-realish",
    NODE_W >= 200 && NODE_H >= 200 && GAP >= 24 && GAP <= 40,
    `NODE=${NODE_W}x${NODE_H} GAP=${GAP}`
  );

// 15. per-node measured sizes respected (tall image vs short text)
{
  const g = {
    nodes: [
      { id: "t", x: 100, y: 100, type: "text", w: 211, h: 228 },
      { id: "i", x: 180, y: 140, type: "image", w: 314, h: 423 },
    ],
  };
  const before = countOverlaps(g);
  const r = resolveCollisions(g);
  const gAfter = {
    nodes: g.nodes.map((n) => {
      const p = r.positions.find((x) => x.id === n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
  };
  const after = countOverlaps(gAfter);
  toy(
    "measured-tall-cards-clear",
    before > 0 && r.cleared && after === 0,
    `ov ${before}→${after} passes=${r.passes} cleared=${r.cleared}`
  );
}
}

const passed = toys.filter((t) => t.ok).length;
const total = toys.length;
console.log(`\nnext-action-collision-nudge toys: ${passed}/${total}`);
assert(NODE_W > 0 && NODE_H > 0 && GAP > 0 && MAX_PASSES > 0, "constants positive");
assert(TIP_OVERLAP_X >= 60 && TIP_OVERLAP_Y >= 24, "tip overlap half-cardish");
assert(typeof planCollisionPasses === "function", "planCollisionPasses exported");
assert(typeof overlapDepth === "function", "overlapDepth exported");
assert(typeof resolveCollisions === "function", "resolveCollisions exported");
if (passed < total) fail(`${total - passed} toy(s) failed`);
console.log("✓ next-action-collision-nudge ok");
