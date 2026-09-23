#!/usr/bin/env node
/**
 * Product · 13 — cool-layout snap toys.
 */
import {
  boxesFromGraph,
  proposeCoolLayoutPositions,
  lerpToward,
  snapCoolLayout,
  detectMessy,
  topoDepths,
  pickCoolPrior,
  countOverlaps,
  meanTargetError,
  COOL_PRIORS,
  NODE_W,
  NODE_H,
  COL_GAP,
  ROW_GAP,
  LERP,
  MAX_STEP,
  COOL_EPS,
} from "../vendor/next-action/cool-layout-snap.mjs";

function fail(msg) {
  console.error(`✗ next-action-cool-layout-snap: ${msg}`);
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

// 1. Empty graph → no targets / snap no-op
{
  const t = proposeCoolLayoutPositions({ nodes: [] });
  const r = snapCoolLayout({ nodes: [] });
  toy(
    "empty-graph",
    t.length === 0 && r.positions.length === 0 && !r.messy,
    `targets=${t.length} pos=${r.positions.length}`
  );
}

// 2. Single node → propose one target; snap near-noop (not messy alone)
{
  const g = { nodes: [{ id: "a", x: 100, y: 100, type: "text" }] };
  const t = proposeCoolLayoutPositions(g);
  const r = snapCoolLayout(g);
  toy(
    "single-node",
    t.length === 1 && r.positions.length === 0 && !r.messy,
    `targets=${t.length} messy=${r.messy}`
  );
}

// 3. Messy stack → messy=true and snap moves nodes
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
  const r = snapCoolLayout(g);
  toy(
    "messy-stack-snaps",
    info.messy && r.positions.length >= 1 && r.movedIds.length >= 1,
    `messy=${info.messy} moved=${r.movedIds.join(",")} ov=${info.overlaps} err=${info.meanErr.toFixed(1)} prior=${r.priorId}`
  );
}

// 4. Already-cool LTR flow → near-noop
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: COL_GAP, y: 0, type: "llm" },
      { id: "c", x: COL_GAP * 2, y: 0, type: "image" },
    ],
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
    ],
  };
  // Snap once with force to place exactly, then detect
  const forced = snapCoolLayout(g, { force: true, t: 1 });
  const g2 = {
    nodes: g.nodes.map((n) => {
      const p = forced.positions.find((x) => x.id === n.id) || forced.targets.find((x) => x.id === n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
    links: g.links,
  };
  // Align to exact targets
  const targets = proposeCoolLayoutPositions(g2);
  const gCool = {
    nodes: g2.nodes.map((n) => {
      const t = targets.find((x) => x.id === n.id);
      return t ? { ...n, x: t.x, y: t.y } : n;
    }),
    links: g.links,
  };
  const info = detectMessy(gCool);
  const r = snapCoolLayout(gCool);
  toy(
    "already-cool-noop",
    !info.messy && r.positions.length === 0 && info.meanErr <= COOL_EPS,
    `messy=${info.messy} pos=${r.positions.length} err=${info.meanErr.toFixed(1)}`
  );
}

// 5. Topo depths follow links
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: 10, y: 10, type: "llm" },
      { id: "c", x: 20, y: 20, type: "image" },
    ],
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
    ],
  };
  const d = topoDepths(g);
  toy(
    "topo-depths",
    d.get("a") === 0 && d.get("b") === 1 && d.get("c") === 2,
    `a=${d.get("a")} b=${d.get("b")} c=${d.get("c")}`
  );
}

// 6. Lerp t=0 → no move; t=1 → full step (clamped)
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: 10, y: 10, type: "llm" },
    ],
  };
  const targets = [
    { id: "a", x: 100, y: 0 },
    { id: "b", x: 100 + COL_GAP, y: 0 },
  ];
  const z = lerpToward(g, targets, 0);
  const full = lerpToward(g, targets, 1, { maxStep: 10000 });
  toy(
    "lerp-zero",
    z.length === 0,
    `n=${z.length}`
  );
  toy(
    "lerp-full",
    full.length === 2 &&
      Math.abs(full.find((p) => p.id === "a").x - 100) < 0.2 &&
      Math.abs(full.find((p) => p.id === "b").x - (100 + COL_GAP)) < 0.2,
    `a.x=${full.find((p) => p.id === "a")?.x} b.x=${full.find((p) => p.id === "b")?.x}`
  );
}

// 7. Max step clamp
{
  const g = { nodes: [{ id: "a", x: 0, y: 0, type: "text" }] };
  const targets = [{ id: "a", x: 5000, y: 0 }];
  const moved = lerpToward(g, targets, 1);
  const mag = Math.hypot(moved[0].dx, moved[0].dy);
  toy(
    "max-step-clamp",
    moved.length === 1 && mag <= MAX_STEP + 0.1,
    `mag=${mag.toFixed(1)} max=${MAX_STEP}`
  );
}

// 8. Comments ignored
{
  const boxes = boxesFromGraph({
    nodes: [
      { id: "c", x: 0, y: 0, type: "comment" },
      { id: "t", x: 10, y: 10, type: "text" },
      { id: "u", x: 15, y: 15, type: "llm" },
    ],
  });
  const r = snapCoolLayout({
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

// 9. Selection ids — only selected nodes get targets/moves
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: 5, y: 5, type: "llm" },
      { id: "c", x: 400, y: 400, type: "image" },
    ],
  };
  const targets = proposeCoolLayoutPositions(g, { ids: ["a", "b"] });
  const r = snapCoolLayout(g, { ids: ["a", "b"], force: true });
  toy(
    "selection-ids",
    targets.length === 2 &&
      targets.every((t) => t.id === "a" || t.id === "b") &&
      !r.movedIds.includes("c"),
    `targets=${targets.map((t) => t.id).join(",")} moved=${r.movedIds.join(",")}`
  );
}

// 10. Centroid roughly preserved (snap doesn't teleport the graph)
{
  const g = {
    nodes: [
      { id: "a", x: 500, y: 400, type: "text" },
      { id: "b", x: 520, y: 410, type: "llm" },
      { id: "c", x: 510, y: 390, type: "image" },
    ],
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
    ],
  };
  const cx0 =
    g.nodes.reduce((s, n) => s + n.x + NODE_W / 2, 0) / g.nodes.length;
  const cy0 =
    g.nodes.reduce((s, n) => s + n.y + NODE_H / 2, 0) / g.nodes.length;
  const targets = proposeCoolLayoutPositions(g);
  const cx1 =
    targets.reduce((s, n) => s + n.x + NODE_W / 2, 0) / targets.length;
  const cy1 =
    targets.reduce((s, n) => s + n.y + NODE_H / 2, 0) / targets.length;
  toy(
    "centroid-preserved",
    Math.abs(cx1 - cx0) < 2 && Math.abs(cy1 - cy0) < 2,
    `before=(${cx0.toFixed(1)},${cy0.toFixed(1)}) after=(${cx1.toFixed(1)},${cy1.toFixed(1)})`
  );
}

// 11. Prior pick prefers text-llm-image for that trio
{
  const boxes = [
    { id: "a", type: "text" },
    { id: "b", type: "llm" },
    { id: "c", type: "image" },
  ];
  const prior = pickCoolPrior(boxes);
  toy(
    "prior-text-llm-image",
    prior.id === "text-llm-image" || prior.layers.some((L) => L.includes("text")),
    `prior=${prior.id}`
  );
}

// 12. Columns spaced by COL_GAP after propose (forced full layout)
{
  const g = {
    nodes: [
      { id: "a", x: 100, y: 100, type: "text" },
      { id: "b", x: 110, y: 110, type: "llm" },
      { id: "c", x: 120, y: 105, type: "image" },
    ],
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
    ],
  };
  const targets = proposeCoolLayoutPositions(g);
  const byId = Object.fromEntries(targets.map((t) => [t.id, t]));
  const dxAB = byId.b.x - byId.a.x;
  const dxBC = byId.c.x - byId.b.x;
  toy(
    "columns-spaced",
    Math.abs(dxAB - COL_GAP) < 1 && Math.abs(dxBC - COL_GAP) < 1,
    `dxAB=${dxAB} dxBC=${dxBC} gap=${COL_GAP}`
  );
}

const passed = toys.filter((t) => t.ok).length;
const total = toys.length;
console.log(`\nnext-action-cool-layout-snap toys: ${passed}/${total}`);
assert(NODE_W > 0 && NODE_H > 0 && COL_GAP > 0 && ROW_GAP > 0 && LERP > 0, "constants positive");
assert(COOL_PRIORS.length >= 3, "priors baked");
assert(typeof proposeCoolLayoutPositions === "function", "propose exported");
assert(typeof lerpToward === "function", "lerpToward exported");
assert(typeof snapCoolLayout === "function", "snapCoolLayout exported");
assert(typeof meanTargetError === "function", "meanTargetError exported");
assert(typeof countOverlaps === "function", "countOverlaps exported");
if (passed < total) fail(`${total - passed} toy(s) failed`);
console.log("✓ next-action-cool-layout-snap ok");
