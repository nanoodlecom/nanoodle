#!/usr/bin/env node
/**
 * Product · 16 — wire routing helper toys.
 */
import {
  ROUTE_CLASSES,
  NODE_W,
  NODE_H,
  boxesFromGraph,
  normalizeRouteClass,
  segmentHitsBox,
  countHits,
  proposeRoute,
  routeLink,
  routeAllLinks,
  applyWireRouting,
  scrambleWires,
  wireRoutingSummary,
  scoreRoute,
} from "../vendor/next-action/wire-routing.mjs";

function fail(msg) {
  console.error(`✗ next-action-wire-routing: ${msg}`);
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
  // Three nodes in a row; messy stacks middle so wire a→c would pierce b if extended
  return {
    nodes: [
      { id: "a", x: messy ? 100 : 0, y: messy ? 80 : 0, type: "text" },
      { id: "b", x: messy ? 160 : 220, y: messy ? 60 : 0, type: "llm" },
      { id: "c", x: messy ? 220 : 440, y: messy ? 100 : 0, type: "image" },
    ],
    links: [
      { id: "l1", from: { node: "a" }, to: { node: "b" } },
      { id: "l2", from: { node: "b" }, to: { node: "c" } },
    ],
  };
}

function blockedGraph() {
  // Direct cubic from left→right passes through middle node box
  return {
    nodes: [
      { id: "src", x: 0, y: 100, type: "text" },
      { id: "mid", x: 200, y: 80, type: "llm" },
      { id: "dst", x: 420, y: 100, type: "image" },
    ],
    links: [{ id: "lcross", from: { node: "src" }, to: { node: "dst" } }],
  };
}

// 1. Empty / no links
{
  const r = applyWireRouting({ nodes: [], links: [] }, null);
  toy(
    "empty-no-links",
    r.routes.length === 0 && r.summary.n === 0,
    `n=${r.routes.length}`
  );
}

// 2. Nodes but no links
{
  const g = { nodes: [{ id: "a", x: 0, y: 0, type: "text" }], links: [] };
  const r = applyWireRouting(g, null);
  toy("nodes-no-links", r.routes.length === 0, `n=${r.routes.length}`);
}

// 3. Direct when clear path
{
  const g = chainGraph(false);
  const boxes = boxesFromGraph(g);
  // Port-ish endpoints: right of a → left of b, clear of obstacles if exclude a,b
  const x1 = 0 + NODE_W,
    y1 = NODE_H / 2,
    x2 = 220,
    y2 = NODE_H / 2;
  const r = proposeRoute(x1, y1, x2, y2, boxes, {
    excludeIds: ["a", "b"],
    class: "auto",
  });
  toy(
    "direct-when-clear",
    r.class === "direct" || r.score < 500,
    `class=${r.class} score=${r.score.toFixed(1)}`
  );
}

// 4. Force direct class
{
  const r = proposeRoute(0, 50, 400, 50, [], { class: "direct" });
  toy(
    "force-direct",
    r.class === "direct" && r.d.includes("C"),
    `class=${r.class} d=${r.d.slice(0, 40)}…`
  );
}

// 5. Force elbow
{
  const r = proposeRoute(0, 50, 400, 200, [], { class: "elbow" });
  toy(
    "force-elbow",
    r.class === "elbow" && r.d.includes("L") && r.controlPoints.length >= 3,
    `class=${r.class} pts=${r.controlPoints.length}`
  );
}

// 6. Obstacle between ports → around or elbow preferred over penetrating direct
{
  const g = blockedGraph();
  const boxes = boxesFromGraph(g);
  const mid = boxes.find((b) => b.id === "mid");
  const x1 = NODE_W,
    y1 = 100 + NODE_H / 2;
  const x2 = 420,
    y2 = 100 + NODE_H / 2;
  // Confirm direct would hit mid
  const hitsDirect = segmentHitsBox(x1, y1, x2, y2, mid);
  const auto = proposeRoute(x1, y1, x2, y2, boxes, {
    excludeIds: ["src", "dst"],
    class: "auto",
  });
  const forcedDirect = proposeRoute(x1, y1, x2, y2, boxes, {
    excludeIds: ["src", "dst"],
    class: "direct",
  });
  toy(
    "obstacle-prefers-nonpenetrating",
    hitsDirect &&
      (auto.class === "around" || auto.class === "elbow") &&
      auto.score < forcedDirect.score,
    `hitsDirect=${hitsDirect} auto=${auto.class} score ${auto.score.toFixed(0)} < direct ${forcedDirect.score.toFixed(0)}`
  );
}

// 7. Around class skirts box (zero or fewer hits than direct sample)
{
  const g = blockedGraph();
  const boxes = boxesFromGraph(g);
  const x1 = NODE_W,
    y1 = 100 + NODE_H / 2;
  const x2 = 420,
    y2 = 100 + NODE_H / 2;
  const around = proposeRoute(x1, y1, x2, y2, boxes, {
    excludeIds: ["src", "dst"],
    class: "around",
  });
  const hits = countHits(around.controlPoints, boxes, {
    excludeIds: ["src", "dst"],
  });
  toy(
    "around-skirts-box",
    around.class === "around" && hits === 0,
    `hits=${hits} pts=${around.controlPoints.length}`
  );
}

// 8. routeLink + routeAllLinks count
{
  const g = chainGraph(false);
  const routes = routeAllLinks(g, null, { class: "auto" });
  toy(
    "route-all-links",
    routes.length === 2 && routes.every((r) => r.d && r.class),
    `n=${routes.length} classes=${routes.map((r) => r.class).join(",")}`
  );
}

// 9. scramble then apply improves mean score vs forced-direct on tangled layout
{
  const g = blockedGraph();
  // Add second crossing link via an extra node pair for more score signal
  g.nodes.push({ id: "x", x: 100, y: 0, type: "text" });
  g.nodes.push({ id: "y", x: 300, y: 200, type: "image" });
  g.links.push({ id: "l2", from: { node: "x" }, to: { node: "y" } });
  const scrambled = scrambleWires(g, { seed: 3 });
  for (const p of scrambled.positions) {
    const n = g.nodes.find((nn) => nn.id === p.id);
    if (n) {
      n.x = p.x;
      n.y = p.y;
    }
  }
  const bad = applyWireRouting(g, null, { class: "direct" });
  const good = applyWireRouting(g, null, { class: "auto" });
  toy(
    "scramble-then-apply-improves",
    good.summary.meanScore <= bad.summary.meanScore &&
      scrambled.movedIds.length >= 3,
    `messed=${scrambled.movedIds.length} mean auto=${good.summary.meanScore.toFixed(0)} direct=${bad.summary.meanScore.toFixed(0)}`
  );
}

// 10. Summary string shape
{
  const g = chainGraph(false);
  const result = applyWireRouting(g, null, { class: "auto" });
  const s = wireRoutingSummary(result);
  toy(
    "summary-string",
    typeof s === "string" && s.includes("route") && s.includes("wire"),
    s
  );
}

// 11. ROUTE_CLASSES frozen + normalize
{
  toy(
    "route-classes-api",
    ROUTE_CLASSES.length === 3 &&
      normalizeRouteClass("auto") === null &&
      normalizeRouteClass("elbow") === "elbow" &&
      boxesFromGraph({ nodes: [{ id: "z", x: 1, y: 2, type: "text" }] })[0].w ===
        NODE_W,
    `classes=${ROUTE_CLASSES.join("|")} NODE=${NODE_W}x${NODE_H}`
  );
}

// 12. Prefer non-penetrating: scoreRoute penalizes hits heavily
{
  const box = { id: "mid", x: 100, y: 40, w: NODE_W, h: NODE_H };
  const through = [
    [0, 90],
    [400, 90],
  ];
  const above = [
    [0, 90],
    [0, 10],
    [400, 10],
    [400, 90],
  ];
  const sThrough = scoreRoute(through, [box], { excludeIds: [] });
  const sAbove = scoreRoute(above, [box], { excludeIds: [] });
  toy(
    "score-penalizes-hits",
    sThrough > sAbove + 500,
    `through=${sThrough.toFixed(0)} above=${sAbove.toFixed(0)}`
  );
}

const passed = toys.filter((t) => t.ok).length;
const total = toys.length;
console.log(`next-action-wire-routing: ${passed}/${total}`);
if (passed !== total) fail(`${passed}/${total} toys passed`);
process.exit(0);
