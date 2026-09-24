#!/usr/bin/env node
/**
 * Product · 19 — paired 2D transport toys.
 */
import {
  boxesFromGraph,
  bakePairedExemplars,
  PAIRED_EXEMPLARS,
  matchPair,
  matchTypeOrder,
  proposeTransportDeltas,
  applyTransport,
  transportLayout,
  detectMessy,
  proposeMessPositions,
  meanDeltaNorm,
  typeMultisetKey,
  COL_GAP,
  LERP,
  MAX_STEP,
  COOL_EPS,
} from "../vendor/next-action/paired-transport.mjs";

function fail(msg) {
  console.error(`✗ next-action-paired-transport: ${msg}`);
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

// 1. Empty graph → no deltas / transport no-op
{
  const p = proposeTransportDeltas({ nodes: [] });
  const r = transportLayout({ nodes: [] });
  toy(
    "empty-graph",
    p.deltas.length === 0 && r.positions.length === 0 && !r.messy,
    `deltas=${p.deltas.length} pos=${r.positions.length}`
  );
}

// 2. Single node → propose may match pair but not messy alone
{
  const g = { nodes: [{ id: "a", x: 100, y: 100, type: "text" }] };
  const info = detectMessy(g);
  const r = transportLayout(g);
  toy(
    "single-node-noop",
    !info.messy && r.positions.length === 0,
    `messy=${info.messy} pos=${r.positions.length}`
  );
}

// 3. Bake / catalog non-empty + stable ids
{
  const baked = bakePairedExemplars();
  const ids = new Set(baked.map((p) => p.id));
  toy(
    "bake-exemplars",
    baked.length >= 6 &&
      ids.size === baked.length &&
      PAIRED_EXEMPLARS.length === baked.length &&
      baked.every((p) => p.messy.length === p.types.length && p.cool.length === p.types.length),
    `n=${baked.length} ids=${[...ids].slice(0, 3).join(",")}`
  );
}

// 4. Messy stack → messy=true and transport moves nodes
{
  const g = {
    nodes: [
      { id: "a", x: 200, y: 200, type: "text" },
      { id: "b", x: 205, y: 205, type: "llm" },
      { id: "c", x: 210, y: 200, type: "image" },
    ],
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
    ],
  };
  const info = detectMessy(g);
  const r = transportLayout(g);
  toy(
    "messy-stack-moves",
    info.messy && r.positions.length >= 1 && r.movedIds.length >= 1 && !!r.pairId,
    `messy=${info.messy} moved=${r.movedIds.join(",")} mean=${info.meanNorm.toFixed(1)} pair=${r.pairId}`
  );
}

// 5. Already-cool LTR → near-noop
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: COL_GAP, y: 0, type: "llm" },
      { id: "c", x: COL_GAP * 2, y: 0, type: "image" },
    ],
  };
  // Force once to exact cool targets via transport with t=1
  const forced = transportLayout(g, { force: true, t: 1, maxStep: 1e9 });
  const gCool = {
    nodes: g.nodes.map((n) => {
      const p = forced.positions.find((x) => x.id === n.id);
      // Or use delta.to
      const d = forced.deltas.find((x) => x.id === n.id);
      if (p) return { ...n, x: p.x, y: p.y };
      if (d) return { ...n, x: d.toX, y: d.toY };
      return n;
    }),
  };
  // Align exactly to proposed targets
  const prop = proposeTransportDeltas(gCool);
  const gExact = {
    nodes: gCool.nodes.map((n) => {
      const d = prop.deltas.find((x) => x.id === n.id);
      return d ? { ...n, x: d.toX, y: d.toY } : n;
    }),
  };
  const info = detectMessy(gExact);
  const r = transportLayout(gExact);
  toy(
    "already-cool-noop",
    !info.messy && r.positions.length === 0 && info.meanNorm <= COOL_EPS,
    `messy=${info.messy} mean=${info.meanNorm.toFixed(2)} pair=${info.pairId}`
  );
}

// 6. Type-match: text/llm/image picks text-llm-image pair
{
  const g = {
    nodes: [
      { id: "z", x: 10, y: 80, type: "image" },
      { id: "x", x: 5, y: 10, type: "text" },
      { id: "y", x: 8, y: 40, type: "llm" },
    ],
  };
  const { pair, matches } = matchPair(g);
  toy(
    "type-match-pair-id",
    pair && pair.id === "text-llm-image" && matches.length === 3,
    `pair=${pair?.id} matches=${matches.length}`
  );
}

// 7. Type order matching is stable (Hungarian-lite greedy)
{
  const boxes = boxesFromGraph({
    nodes: [
      { id: "a1", x: 0, y: 100, type: "text" },
      { id: "a2", x: 0, y: 10, type: "text" },
      { id: "b", x: 50, y: 50, type: "llm" },
    ],
  });
  const m = matchTypeOrder(boxes, ["text", "llm", "text"]);
  const byBox = new Map(m.map((x) => [boxes[x.boxIndex].id, x.slot]));
  // Lower y text → earlier text slot (0), higher y text → slot 2
  toy(
    "type-order-greedy",
    byBox.get("a2") === 0 && byBox.get("b") === 1 && byBox.get("a1") === 2,
    `a2→${byBox.get("a2")} b→${byBox.get("b")} a1→${byBox.get("a1")}`
  );
}

// 8. Mess + transport roundtrip: mess then transport reduces mean |Δ|
{
  const g0 = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: COL_GAP, y: 0, type: "llm" },
      { id: "c", x: COL_GAP * 2, y: 0, type: "image" },
    ],
  };
  // Place on cool first
  const cool = transportLayout(g0, { force: true, t: 1, maxStep: 1e9 });
  let g = {
    nodes: g0.nodes.map((n) => {
      const d = cool.deltas.find((x) => x.id === n.id);
      return d ? { ...n, x: d.toX, y: d.toY } : n;
    }),
  };
  const mess = proposeMessPositions(g);
  g = {
    nodes: g.nodes.map((n) => {
      const m = mess.find((x) => x.id === n.id);
      return m ? { ...n, x: m.x, y: m.y } : n;
    }),
  };
  const before = detectMessy(g);
  const moved = applyTransport(g, before.deltas, { t: 1, maxStep: 1e9 });
  const g2 = {
    nodes: g.nodes.map((n) => {
      const p = moved.find((x) => x.id === n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
  };
  const after = detectMessy(g2);
  toy(
    "mess-transport-roundtrip",
    before.messy && before.meanNorm > after.meanNorm && after.meanNorm < before.meanNorm * 0.5,
    `before=${before.meanNorm.toFixed(1)} after=${after.meanNorm.toFixed(1)}`
  );
}

// 9. Delta caps: MAX_STEP respected
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: 5, y: 5, type: "llm" },
      { id: "c", x: 8, y: 2, type: "image" },
    ],
  };
  const prop = proposeTransportDeltas(g);
  const pos = applyTransport(g, prop.deltas, { t: 1, maxStep: MAX_STEP });
  const ok = pos.every((p) => Math.hypot(p.dx, p.dy) <= MAX_STEP + 0.6);
  toy(
    "delta-caps-max-step",
    pos.length >= 1 && ok,
    `n=${pos.length} maxSeen=${Math.max(0, ...pos.map((p) => Math.hypot(p.dx, p.dy))).toFixed(1)} cap=${MAX_STEP}`
  );
}

// 10. LERP partial step smaller than full
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: 10, y: 10, type: "llm" },
      { id: "c", x: 15, y: 5, type: "image" },
    ],
  };
  const prop = proposeTransportDeltas(g);
  const half = applyTransport(g, prop.deltas, { t: 0.5, maxStep: 1e9 });
  const full = applyTransport(g, prop.deltas, { t: 1, maxStep: 1e9 });
  const meanH = meanDeltaNorm(half);
  const meanF = meanDeltaNorm(full);
  toy(
    "lerp-partial-vs-full",
    half.length && full.length && meanH < meanF * 0.85,
    `half=${meanH.toFixed(1)} full=${meanF.toFixed(1)} LERP=${LERP}`
  );
}

// 11. Pair id stable across identical type multisets
{
  const g1 = {
    nodes: [
      { id: "1", x: 1, y: 1, type: "text" },
      { id: "2", x: 2, y: 2, type: "llm" },
      { id: "3", x: 3, y: 3, type: "music" },
    ],
  };
  const g2 = {
    nodes: [
      { id: "p", x: 100, y: 50, type: "music" },
      { id: "q", x: 10, y: 20, type: "text" },
      { id: "r", x: 40, y: 30, type: "llm" },
    ],
  };
  const a = matchPair(g1);
  const b = matchPair(g2);
  toy(
    "pair-id-stable",
    a.pair && b.pair && a.pair.id === b.pair.id && a.pair.id === "text-music",
    `a=${a.pair?.id} b=${b.pair?.id}`
  );
}

// 12. boxesFromGraph skips comments + bad coords
{
  const boxes = boxesFromGraph({
    nodes: [
      { id: "ok", x: 1, y: 2, type: "text" },
      { id: "c", x: 3, y: 4, type: "comment" },
      { id: "bad", x: NaN, y: 0, type: "llm" },
      { id: null, x: 0, y: 0, type: "image" },
    ],
  });
  toy(
    "boxes-filter",
    boxes.length === 1 && boxes[0].id === "ok",
    `n=${boxes.length}`
  );
}

// 13. Arrow field: messy graph yields |Δ| arrows usable for overlay
{
  const g = {
    nodes: [
      { id: "a", x: 50, y: 50, type: "text" },
      { id: "b", x: 55, y: 60, type: "llm" },
      { id: "c", x: 48, y: 70, type: "image" },
    ],
  };
  const prop = proposeTransportDeltas(g);
  const arrows = prop.deltas.filter((d) => Math.hypot(d.dx, d.dy) > 1);
  toy(
    "delta-field-arrows",
    arrows.length >= 2 &&
      arrows.every(
        (d) =>
          Number.isFinite(d.fromX) &&
          Number.isFinite(d.toX) &&
          d.id
      ),
    `arrows=${arrows.length} pair=${prop.pairId} mean=${prop.meanNorm.toFixed(1)}`
  );
}

// 14. typeMultisetKey order-independent
{
  const k1 = typeMultisetKey(["image", "text", "llm"]);
  const k2 = typeMultisetKey(["text", "llm", "image"]);
  toy("multiset-key", k1 === k2 && k1.includes("image"), `key=${k1}`);
}

const failed = toys.filter((t) => !t.ok);
console.log(
  `\npaired-transport toys: ${toys.length - failed.length}/${toys.length}`
);
if (failed.length) {
  fail(`${failed.length} toy(s) failed: ${failed.map((t) => t.name).join(", ")}`);
}
console.log("✓ next-action-paired-transport: all toys passed");
