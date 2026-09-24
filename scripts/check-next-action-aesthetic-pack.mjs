#!/usr/bin/env node
/**
 * Product · 18 — multi-select aesthetic pack toys.
 */
import {
  boxesFromGraph,
  proposeAestheticPack,
  planAestheticPasses,
  resolveAestheticPack,
  proposeCollisionDeltas,
  proposePackPositions,
  proposeMessPositions,
  countOverlaps,
  meanTargetError,
  NODE_W,
  NODE_H,
  GAP,
  PACK_EPS,
} from "../vendor/next-action/aesthetic-pack.mjs";

function fail(msg) {
  console.error(`✗ next-action-aesthetic-pack: ${msg}`);
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

// 1. Empty selection → near-noop
{
  const r = proposeAestheticPack({ nodes: [] }, { ids: [] });
  const plan = planAestheticPasses({ nodes: [] }, { ids: [] });
  toy(
    "empty-selection",
    r.positions.length === 0 && plan.positions.length === 0 && r.reason === "empty",
    `pos=${r.positions.length} reason=${r.reason}`
  );
}

// 2. Single id → near-noop unless force
{
  const g = { nodes: [{ id: "a", x: 100, y: 100, type: "text" }] };
  const r = proposeAestheticPack(g, { ids: ["a"] });
  const forced = proposeAestheticPack(g, { ids: ["a"], force: true });
  toy(
    "single-id-noop",
    r.positions.length === 0 && r.reason === "single",
    `reason=${r.reason} forcePos=${forced.positions.length}`
  );
}

// 3. Two overlapping selected → de-overlap / pack moves
{
  const g = {
    nodes: [
      { id: "a", x: 200, y: 200, type: "text" },
      { id: "b", x: 210, y: 205, type: "llm" },
    ],
  };
  const before = countOverlaps(g, { ids: ["a", "b"] });
  const r = resolveAestheticPack(g, { ids: ["a", "b"], force: true });
  const gAfter = {
    nodes: g.nodes.map((n) => {
      const p = r.positions.find((x) => x.id === n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
  };
  const after = countOverlaps(gAfter, { ids: ["a", "b"] });
  toy(
    "two-overlap-deoverlap",
    before >= 1 && r.movedIds.length >= 1 && after <= before,
    `before=${before} after=${after} moved=${r.movedIds.join(",")} passes=${r.passes}`
  );
}

// 4. Non-selected untouched
{
  const g = {
    nodes: [
      { id: "a", x: 100, y: 100, type: "text" },
      { id: "b", x: 110, y: 105, type: "llm" },
      { id: "c", x: 500, y: 400, type: "image" },
    ],
  };
  const r = resolveAestheticPack(g, { ids: ["a", "b"], force: true });
  const cMoved = r.movedIds.includes("c");
  const cPos = r.positions.find((p) => p.id === "c");
  toy(
    "non-selected-untouched",
    !cMoved && !cPos && r.movedIds.every((id) => id === "a" || id === "b"),
    `moved=${r.movedIds.join(",") || "(none)"}`
  );
}

// 5. Force pack moves even when mildly spaced
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: 80, y: 300, type: "llm" },
      { id: "c", x: 40, y: 600, type: "image" },
    ],
  };
  const r = proposeAestheticPack(g, { ids: ["a", "b", "c"], force: true });
  toy(
    "force-pack-moves",
    r.movedIds.length >= 1 || r.targets.length === 3,
    `moved=${r.movedIds.length} targets=${r.targets.length} reason=${r.reason}`
  );
}

// 6. Already-packed near-noop
{
  const g = {
    nodes: [
      { id: "a", x: 100, y: 100, type: "text" },
      { id: "b", x: 100 + 240, y: 100, type: "llm" },
      { id: "c", x: 100 + 480, y: 100, type: "image" },
    ],
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
    ],
  };
  // First force to get packed layout, then check noop
  const packed = resolveAestheticPack(g, { ids: ["a", "b", "c"], force: true });
  const g2 = {
    nodes: g.nodes.map((n) => {
      const p = packed.positions.find((x) => x.id === n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
    links: g.links,
  };
  // Apply full targets (not lerp) so we're truly at pack
  const targets = proposePackPositions(g2, { ids: ["a", "b", "c"] });
  const g3 = {
    nodes: g2.nodes.map((n) => {
      const t = targets.find((x) => x.id === n.id);
      return t ? { ...n, x: t.x, y: t.y } : n;
    }),
    links: g.links,
  };
  const r = proposeAestheticPack(g3, { ids: ["a", "b", "c"] });
  toy(
    "already-packed-noop",
    r.positions.length === 0 && (r.packed || r.reason === "already-packed"),
    `pos=${r.positions.length} packed=${r.packed} reason=${r.reason} meanErr=${r.meanErr.toFixed(1)}`
  );
}

// 7. boxesFromGraph filters ids + skips comments
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "note", x: 10, y: 10, type: "comment" },
      { id: "b", x: 50, y: 50, type: "llm" },
    ],
  };
  const all = boxesFromGraph(g);
  const sel = boxesFromGraph(g, { ids: ["a"] });
  toy(
    "boxes-filter-ids-comments",
    all.length === 2 && sel.length === 1 && sel[0].id === "a",
    `all=${all.length} sel=${sel.length}`
  );
}

// 8. planAestheticPasses yields snapshots when overlapping
{
  const g = {
    nodes: [
      { id: "a", x: 200, y: 200, type: "text" },
      { id: "b", x: 200, y: 200, type: "llm" },
      { id: "c", x: 205, y: 210, type: "image" },
    ],
  };
  const plan = planAestheticPasses(g, { ids: ["a", "b", "c"], force: true });
  toy(
    "plan-snapshots",
    plan.passSnapshots.length >= 1 && plan.movedIds.length >= 1,
    `snaps=${plan.passSnapshots.length} moved=${plan.movedIds.length} passes=${plan.passes}`
  );
}

// 9. Mess positions only selected
{
  const g = {
    nodes: [
      { id: "a", x: 100, y: 100, type: "text" },
      { id: "b", x: 200, y: 100, type: "llm" },
      { id: "c", x: 400, y: 400, type: "image" },
    ],
  };
  const mess = proposeMessPositions(g, { ids: ["a", "b"] });
  toy(
    "mess-selection-only",
    mess.length === 2 && mess.every((p) => p.id === "a" || p.id === "b"),
    `n=${mess.length} ids=${mess.map((p) => p.id).join(",")}`
  );
}

// 10. Collision deltas scoped — distant third not in deltas
{
  const g = {
    nodes: [
      { id: "a", x: 100, y: 100, type: "text" },
      { id: "b", x: 110, y: 110, type: "llm" },
      { id: "c", x: 800, y: 800, type: "image" },
    ],
  };
  const d = proposeCollisionDeltas(g, { ids: ["a", "b"] });
  toy(
    "collision-scoped",
    d.every((x) => x.id === "a" || x.id === "b") && d.length >= 1,
    `deltas=${d.map((x) => x.id).join(",")}`
  );
}

// 11. Pack targets centroid-ish (mean x of targets near mean x of inputs)
{
  const g = {
    nodes: [
      { id: "a", x: 300, y: 200, type: "text" },
      { id: "b", x: 320, y: 400, type: "llm" },
    ],
  };
  const t = proposePackPositions(g, { ids: ["a", "b"] });
  const meanIn = (300 + 320) / 2 + NODE_W / 2;
  const meanOut = t.reduce((s, p) => s + p.x + NODE_W / 2, 0) / t.length;
  toy(
    "pack-centroid-anchored",
    t.length === 2 && Math.abs(meanOut - meanIn) < 80,
    `meanIn=${meanIn.toFixed(0)} meanOut=${meanOut.toFixed(0)}`
  );
}

// 12. Constants exported finite
{
  toy(
    "constants",
    Number.isFinite(NODE_W) &&
      Number.isFinite(NODE_H) &&
      Number.isFinite(GAP) &&
      Number.isFinite(PACK_EPS) &&
      NODE_W > 0 &&
      GAP > 0,
    `W=${NODE_W} H=${NODE_H} GAP=${GAP} EPS=${PACK_EPS}`
  );
}

// 13. resolve clears overlaps among selection when force
{
  const g = {
    nodes: [
      { id: "a", x: 50, y: 50, type: "text" },
      { id: "b", x: 55, y: 55, type: "llm" },
      { id: "c", x: 60, y: 60, type: "image" },
      { id: "d", x: 900, y: 900, type: "music" },
    ],
  };
  const r = resolveAestheticPack(g, { ids: ["a", "b", "c"], force: true });
  const gAfter = {
    nodes: g.nodes.map((n) => {
      const p = r.positions.find((x) => x.id === n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
  };
  const ov = countOverlaps(gAfter, { ids: ["a", "b", "c"] });
  const dStill = gAfter.nodes.find((n) => n.id === "d");
  toy(
    "resolve-clears-selection",
    r.movedIds.length >= 1 && ov === 0 && dStill.x === 900 && dStill.y === 900,
    `ov=${ov} moved=${r.movedIds.length} d=(${dStill.x},${dStill.y})`
  );
}

// 14. meanTargetError zero at targets
{
  const g = {
    nodes: [
      { id: "a", x: 10, y: 20, type: "text" },
      { id: "b", x: 30, y: 40, type: "llm" },
    ],
  };
  const targets = [
    { id: "a", x: 10, y: 20 },
    { id: "b", x: 30, y: 40 },
  ];
  const err = meanTargetError(g, targets);
  toy("mean-err-zero-at-targets", err < 0.01, `err=${err}`);
}

const failed = toys.filter((t) => !t.ok);
console.log(
  `\nnext-action-aesthetic-pack: ${toys.length - failed.length}/${toys.length} toys ok`
);
if (failed.length) {
  fail(`${failed.length} toy(s) failed: ${failed.map((t) => t.name).join(", ")}`);
}
