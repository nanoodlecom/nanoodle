#!/usr/bin/env node
/**
 * Product · 15 — layout mode particles toys.
 */
import {
  MODES,
  MODE_HEADS,
  NODE_W,
  NODE_H,
  COL_GAP,
  ROW_GAP,
  LERP,
  MAX_STEP,
  COOL_EPS,
  boxesFromGraph,
  topoDepths,
  normalizeMode,
  proposeLayoutMode,
  applyLayoutMode,
  scrambleLayout,
  meanTargetError,
  layoutModeSummary,
  lerpToward,
} from "../vendor/next-action/layout-mode-particles.mjs";

function fail(msg) {
  console.error(`✗ next-action-layout-mode: ${msg}`);
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

function chainGraph(messy = false) {
  return {
    nodes: [
      { id: "a", x: messy ? 200 : 0, y: messy ? 200 : 0, type: "text" },
      { id: "b", x: messy ? 210 : 220, y: messy ? 205 : 0, type: "llm" },
      { id: "c", x: messy ? 205 : 440, y: messy ? 198 : 0, type: "image" },
    ],
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
    ],
  };
}

// 1. Empty graph
{
  const p = proposeLayoutMode({ nodes: [] }, "flow");
  const r = applyLayoutMode({ nodes: [] }, "flow");
  toy(
    "empty-graph",
    p.positions.length === 0 && r.positions.length === 0 && r.movedIds.length === 0,
    `pos=${p.positions.length} apply=${r.positions.length}`
  );
}

// 2. Single node
{
  const g = { nodes: [{ id: "a", x: 100, y: 100, type: "text" }] };
  const p = proposeLayoutMode(g, "flow");
  toy(
    "single-node",
    p.positions.length === 1 && p.positions[0].id === "a" && MODES.includes(p.mode),
    `n=${p.positions.length} mode=${p.mode} head=${p.headId}`
  );
}

// 3. LTR flow mode spreads left→right
{
  const g = chainGraph(true);
  const p = proposeLayoutMode(g, "flow");
  const byId = Object.fromEntries(p.positions.map((t) => [t.id, t]));
  toy(
    "flow-mode-ltr",
    byId.a.x < byId.b.x && byId.b.x < byId.c.x && p.mode === "flow",
    `x a=${byId.a.x} b=${byId.b.x} c=${byId.c.x} head=${p.headId}`
  );
}

// 4. Columns mode type buckets
{
  const g = chainGraph(true);
  const p = proposeLayoutMode(g, "columns");
  const byId = Object.fromEntries(p.positions.map((t) => [t.id, t]));
  toy(
    "columns-mode",
    p.mode === "columns" && byId.a.x < byId.b.x && byId.b.x < byId.c.x,
    `x a=${byId.a.x} b=${byId.b.x} c=${byId.c.x} head=${p.headId}`
  );
}

// 5. Radial mode places around centroid (not collinear LTR)
{
  const g = chainGraph(true);
  const p = proposeLayoutMode(g, "radial");
  const xs = p.positions.map((t) => t.x);
  const ys = p.positions.map((t) => t.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  toy(
    "radial-mode",
    p.mode === "radial" && p.positions.length === 3 && spanY > 20,
    `spanX=${spanX.toFixed(0)} spanY=${spanY.toFixed(0)} head=${p.headId}`
  );
}

// 6. Mode switch changes targets
{
  const g = chainGraph(true);
  const flow = proposeLayoutMode(g, "flow");
  const radial = proposeLayoutMode(g, "radial");
  const cols = proposeLayoutMode(g, "columns");
  const key = (arr) =>
    arr.positions
      .map((p) => `${p.id}:${Math.round(p.x)},${Math.round(p.y)}`)
      .sort()
      .join("|");
  const kFlow = key(flow);
  const kRad = key(radial);
  const kCol = key(cols);
  toy(
    "mode-switch-changes-targets",
    kFlow !== kRad && kFlow !== kCol,
    `flow≠radial=${kFlow !== kRad} flow≠cols=${kFlow !== kCol}`
  );
}

// 7. Apply moves nodes on messy graph
{
  const g = chainGraph(true);
  const r = applyLayoutMode(g, "flow", { force: true });
  toy(
    "apply-moves-nodes",
    r.movedIds.length >= 1 && r.positions.length >= 1 && !r.cool,
    `moved=${r.movedIds.length} err=${r.meanErr.toFixed(1)} mode=${r.mode}`
  );
}

// 8. Scramble then apply
{
  const g = chainGraph(false);
  const scrambled = scrambleLayout(g);
  const g2 = {
    nodes: g.nodes.map((n) => {
      const p = scrambled.positions.find((x) => x.id === n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
    links: g.links,
  };
  const r = applyLayoutMode(g2, "flow", { force: true });
  toy(
    "scramble-then-apply",
    scrambled.movedIds.length === 3 && r.movedIds.length >= 1,
    `scramble=${scrambled.movedIds.length} apply=${r.movedIds.length}`
  );
}

// 9. Cool near-noop
{
  const g = chainGraph(false);
  // Snap once to land near targets
  const first = applyLayoutMode(g, "flow", { force: true, t: 1 });
  const gCool = {
    nodes: g.nodes.map((n) => {
      const p = first.targets.find((t) => t.id === n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
    links: g.links,
  };
  const r = applyLayoutMode(gCool, "flow");
  const forced = applyLayoutMode(gCool, "flow", { force: true });
  toy(
    "cool-near-noop",
    r.cool && r.positions.length === 0 && r.meanErr <= COOL_EPS,
    `cool=${r.cool} pos=${r.positions.length} err=${r.meanErr.toFixed(2)} forcePos=${forced.positions.length}`
  );
}

// 10. Comments skipped
{
  const boxes = boxesFromGraph({
    nodes: [
      { id: "c", x: 0, y: 0, type: "comment" },
      { id: "t", x: 10, y: 10, type: "text" },
    ],
  });
  const p = proposeLayoutMode(
    {
      nodes: [
        { id: "c", x: 0, y: 0, type: "comment" },
        { id: "t", x: 10, y: 10, type: "text" },
      ],
    },
    "flow"
  );
  toy(
    "comments-skipped",
    boxes.length === 1 && p.positions.length === 1 && p.positions[0].id === "t",
    `boxes=${boxes.map((b) => b.id).join(",")} pos=${p.positions.map((t) => t.id).join(",")}`
  );
}

// 11. Normalize mode + selection ids
{
  const g = chainGraph(true);
  const p = proposeLayoutMode(g, "FLOW", { ids: ["a", "b"] });
  toy(
    "normalize-and-selection",
    normalizeMode("FLOW") === "flow" &&
      normalizeMode("nope") === "flow" &&
      p.mode === "flow" &&
      p.positions.length === 2 &&
      p.positions.every((t) => t.id === "a" || t.id === "b"),
    `mode=${p.mode} ids=${p.positions.map((t) => t.id).join(",")}`
  );
}

// 12. Max step clamp + summary
{
  const g = chainGraph(true);
  const p = proposeLayoutMode(g, "radial");
  const moved = lerpToward(g, p.positions, 1, { maxStep: MAX_STEP });
  const ok = moved.every((m) => Math.hypot(m.dx, m.dy) <= MAX_STEP + 0.1);
  const r = applyLayoutMode(g, "radial", { force: true });
  const s = layoutModeSummary(r);
  toy(
    "max-step-and-summary",
    (moved.length === 0 || ok) && typeof s === "string" && s.includes("radial"),
    `moved=${moved.length} summary="${s}"`
  );
}

const passed = toys.filter((t) => t.ok).length;
const total = toys.length;
console.log(`\nnext-action-layout-mode toys: ${passed}/${total}`);
assert(MODES.length === 3, "three modes");
assert(MODE_HEADS.flow && MODE_HEADS.columns && MODE_HEADS.radial, "mode heads");
assert(NODE_W > 0 && NODE_H > 0 && COL_GAP > 0 && ROW_GAP > 0 && LERP > 0, "constants");
assert(typeof proposeLayoutMode === "function", "proposeLayoutMode");
assert(typeof applyLayoutMode === "function", "applyLayoutMode");
assert(typeof scrambleLayout === "function", "scrambleLayout");
assert(typeof meanTargetError === "function", "meanTargetError");
assert(typeof topoDepths === "function", "topoDepths");
if (passed < total) fail(`${total - passed} toy(s) failed`);
console.log("✓ next-action-layout-mode ok");
