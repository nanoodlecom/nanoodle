#!/usr/bin/env node
// Leftover Product · 12 collision-nudge edges after #614 / #624 / #657.
// Shipped checks pin happy-path stack-clear + a clear landing staying put.
// Open leftover PRs pin deoverlap notes (#627) and editor tidy/grid (#635).
// This file pins the other half of the shared geometry used by add, tidy,
// and dangling add+wire seats: comments/NaN/null-id drop out of boxes,
// non-positive size falls back to NODE_W/H, touching AABB at gap=0 is not
// an overlap, coincident centers push both nodes on a stable diagonal,
// per-node deltas clamp to MAX_NUDGE, unknown/NaN apply is a no-op on
// that id, maxPasses exhaustion reports cleared:false, and an already-
// clear pair is a no-op. Offline, zero API spend. New file so it does
// not collide with open leftover PRs.
import {
  NODE_W,
  NODE_H,
  GAP,
  MAX_NUDGE,
  boxesFromGraph,
  overlapDepth,
  proposeCollisionDeltas,
  applyDeltasAbsolute,
  countOverlaps,
  planCollisionPasses,
  resolveCollisions,
} from "../vendor/next-action/collision-nudge.mjs";

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

{
  const boxes = boxesFromGraph({
    nodes: [
      { id: "note", type: "comment", x: 0, y: 0, w: 180, h: 80 },
      { id: "t", type: "text", x: 0, y: 0 },
      { id: null, type: "text", x: 40, y: 40 },
      { type: "text", x: 80, y: 80 },
      { id: "nan", type: "text", x: NaN, y: 0 },
      { id: "neg", type: "text", x: 10, y: 10, w: -5, h: 0 },
    ],
  });
  const ids = boxes.map((b) => b.id).sort();
  const neg = boxes.find((b) => b.id === "neg");
  if (ids.join(",") !== "neg,t")
    fail(`comments/NaN/null-id must drop out, got ${ids.join(",")}`);
  else if (!neg || neg.w !== NODE_W || neg.h !== NODE_H)
    fail(`non-positive size must fall back to NODE_W/H, got ${JSON.stringify(neg)}`);
  else ok("boxesFromGraph skips comments/NaN/null-id and defaults non-positive size");
}

{
  if (boxesFromGraph(null).length !== 0 || boxesFromGraph({}).length !== 0)
    fail("null/empty graph must yield no boxes");
  else if (countOverlaps(null) !== 0)
    fail("null graph must report zero overlaps");
  else ok("null/empty graph stays quiet");
}

{
  const a = { id: "a", x: 0, y: 0, w: 100, h: 100, cx: 50, cy: 50 };
  const b = { id: "b", x: 100, y: 0, w: 100, h: 100, cx: 150, cy: 50 };
  const touch = overlapDepth(a, b, 0);
  if (touch.overlap || touch.ox !== 0)
    fail(`touching AABB at gap=0 must not overlap, got ${JSON.stringify(touch)}`);
  const padded = overlapDepth(a, b, GAP);
  if (!padded.overlap || !(padded.ox > 0))
    fail(`the same pair must collide once gap padding is required, got ${JSON.stringify(padded)}`);
  else ok("touching edges at gap=0 are not an overlap; required gap still collides");
}

{
  const deltas = proposeCollisionDeltas({
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, w: 220, h: 160 },
      { id: "b", type: "image", x: 0, y: 0, w: 220, h: 160 },
    ],
  });
  const byId = Object.fromEntries(deltas.map((d) => [d.id, d]));
  if (!byId.a || !byId.b)
    fail(`coincident stack must move both nodes, got ${JSON.stringify(deltas)}`);
  else if (!(byId.a.dx < 0 && byId.b.dx > 0 && byId.a.dy < 0 && byId.b.dy > 0))
    fail(`coincident push must be the stable diagonal, got ${JSON.stringify(deltas)}`);
  else ok("coincident centers push both nodes apart on the stable diagonal");
}

{
  const deltas = proposeCollisionDeltas({
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, w: 400, h: 400 },
      { id: "b", type: "image", x: 1, y: 1, w: 400, h: 400 },
      { id: "c", type: "llm", x: 2, y: 2, w: 400, h: 400 },
    ],
  });
  const over = deltas.filter((d) => Math.hypot(d.dx, d.dy) > MAX_NUDGE + 0.6);
  if (over.length)
    fail(`per-node delta must clamp to MAX_NUDGE=${MAX_NUDGE}, got ${JSON.stringify(deltas)}`);
  else if (!deltas.length)
    fail("a piled trio must still propose a clamped nudge");
  else ok("accumulated collision deltas clamp to MAX_NUDGE");
}

{
  const applied = applyDeltasAbsolute(
    { nodes: [{ id: "a", x: 10, y: 20 }] },
    [{ id: "ghost", dx: 5, dy: 5 }, { id: "a", dx: NaN, dy: 3 }]
  );
  if (applied.length !== 1 || applied[0].id !== "a" || applied[0].x !== 10 || applied[0].y !== 23)
    fail(`unknown id must skip and NaN dx must be 0, got ${JSON.stringify(applied)}`);
  else if (applyDeltasAbsolute({ nodes: [{ id: "a", x: 1, y: 1 }] }, null).length !== 0)
    fail("null deltas must stay quiet");
  else ok("applyDeltasAbsolute skips unknown ids and treats NaN dx as 0");
}

{
  const stacked = {
    nodes: [
      { id: "a", type: "text", x: 100, y: 100, w: 220, h: 160 },
      { id: "b", type: "image", x: 100, y: 100, w: 220, h: 160 },
    ],
  };
  if (countOverlaps(stacked) !== 1)
    fail(`stacked pair must count as one overlap, got ${countOverlaps(stacked)}`);
  const one = planCollisionPasses(stacked, { maxPasses: 1 });
  if (one.cleared || one.passes !== 1 || one.movedIds.length !== 2)
    fail(`maxPasses=1 must move both and stay uncleared, got ${JSON.stringify({
      cleared: one.cleared, passes: one.passes, moved: one.movedIds,
    })}`);
  const full = resolveCollisions(stacked);
  if (!full.cleared || full.passes < 2)
    fail(`default resolve must eventually clear the stack, got ${JSON.stringify({
      cleared: full.cleared, passes: full.passes,
    })}`);
  else ok("exhausted maxPasses reports cleared:false; default resolve still clears");
}

{
  const clear = planCollisionPasses({
    nodes: [
      { id: "a", type: "text", x: 0, y: 0 },
      { id: "b", type: "image", x: 800, y: 600 },
    ],
  });
  if (!clear.cleared || clear.passes !== 0 || clear.positions.length !== 0)
    fail(`a clear pair must be a no-op, got ${JSON.stringify(clear)}`);
  else ok("already-clear pair is a no-op (cleared, zero passes)");
}

if (failed) {
  console.error(`\n${failed} leftover collision-nudge pin(s) failed`);
  process.exit(1);
}
console.log("✓ collision-nudge leftover pins");
