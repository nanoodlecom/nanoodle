#!/usr/bin/env node
// Leftover Product · 12 collision planner edges after #614 / #624 / #670.
// Those pins cover comments/NaN boxes, gap=0 touch, coincident diagonal,
// MAX_NUDGE, unknown/NaN apply, maxPasses=1 uncleared, and already-clear
// no-op. This file pins the remaining planner contract used by animated
// add/tidy slides: minPairGap is negative while boxes still collide and
// positive for a far pair; planCollisionPasses snapshots lockstep with
// passes; a 0/1-node graph proposes no deltas. Offline, zero API spend.
// New file so it does not collide with open leftover PRs.
import {
  minPairGap,
  countOverlaps,
  proposeCollisionDeltas,
  planCollisionPasses,
  resolveCollisions,
  applyDeltasAbsolute,
} from "../vendor/next-action/collision-nudge.mjs";

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

const stacked = {
  nodes: [
    { id: "a", type: "text", x: 100, y: 100, w: 220, h: 160 },
    { id: "b", type: "image", x: 100, y: 100, w: 220, h: 160 },
  ],
};

{
  const gap = minPairGap(stacked);
  if (!(gap < 0))
    fail(`stacked pair minPairGap must be negative, got ${gap}`);
  else if (countOverlaps(stacked) !== 1)
    fail(`stacked pair must still count as one overlap, got ${countOverlaps(stacked)}`);
  else ok("overlapping pair reports a negative minPairGap");
}

{
  if (minPairGap(null) !== 0 || minPairGap({}) !== 0)
    fail("empty/null graph minPairGap must be 0");
  else if (proposeCollisionDeltas({ nodes: [{ id: "a", type: "text", x: 0, y: 0 }] }).length !== 0)
    fail("a single node must propose no collision deltas");
  else if (proposeCollisionDeltas({ nodes: [] }).length !== 0)
    fail("an empty node list must propose no collision deltas");
  else ok("empty/single-node graphs stay quiet (gap 0, no deltas)");
}

{
  const two = planCollisionPasses(stacked, { maxPasses: 2 });
  if (two.passes !== two.passSnapshots.length)
    fail(`passSnapshots must lockstep with passes (passes=${two.passes} snaps=${two.passSnapshots.length})`);
  else if (!two.passSnapshots.length)
    fail("a stacked pair with maxPasses=2 must record at least one snapshot");
  else if (two.passSnapshots.some((s) => !Array.isArray(s.positions) || typeof s.overlaps !== "number"))
    fail(`each snapshot needs positions[] + overlaps, got ${JSON.stringify(two.passSnapshots)}`);
  else if (two.passSnapshots.some((s) => !s.positions.length))
    fail("a colliding pass snapshot must include the moved positions");
  else ok("planCollisionPasses snapshots lockstep with passes");
}

{
  const far = {
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, w: 220, h: 160 },
      { id: "b", type: "image", x: 800, y: 600, w: 220, h: 160 },
    ],
  };
  const full = resolveCollisions(stacked);
  const moved = {
    nodes: stacked.nodes.map((n) => {
      const pos = full.positions.find((p) => p.id === n.id);
      return pos ? { ...n, x: pos.x, y: pos.y } : { ...n };
    }),
  };
  if (!full.cleared || countOverlaps(moved) !== 0)
    fail(`default resolve must clear the two-node stack, got ${JSON.stringify({
      cleared: full.cleared, passes: full.passes, overlaps: countOverlaps(moved),
    })}`);
  else if (!(minPairGap(far) > 0) || countOverlaps(far) !== 0)
    fail(`a far pair must have positive minPairGap, got gap=${minPairGap(far)} overlaps=${countOverlaps(far)}`);
  else ok("cleared stack has zero overlaps; a far pair has positive minPairGap");
}

{
  const deltas = [{ id: "a", dx: 12, dy: -4 }];
  const applied = applyDeltasAbsolute(stacked, deltas);
  const gapped = minPairGap(stacked, deltas);
  if (applied.length !== 1 || applied[0].x !== 112 || applied[0].y !== 96)
    fail(`apply+minPairGap control drifted, got ${JSON.stringify(applied)}`);
  else if (!(gapped > minPairGap(stacked)))
    fail(`applying a separating delta must improve minPairGap (${gapped} vs ${minPairGap(stacked)})`);
  else ok("minPairGap honors pending deltas without mutating the graph");
}

if (failed) {
  console.error(`\n${failed} leftover collision-gap pin(s) failed`);
  process.exit(1);
}
console.log("✓ collision-gap leftover pins");
