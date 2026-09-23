#!/usr/bin/env node
/**
 * Product · 14 — port facing helper toys.
 */
import {
  FACINGS,
  FACING_PRIORS,
  NODE_W,
  NODE_H,
  NUDGE,
  MAX_NUDGE,
  COOL_MATCH_EPS,
  boxesFromGraph,
  adjacency,
  nodeRole,
  pickFacingPrior,
  proposeFacing,
  softNudgeForFacing,
  facingMatchRatio,
  applyFacingHints,
  scrambleFacing,
  facingSummary,
} from "../vendor/next-action/port-facing.mjs";

function fail(msg) {
  console.error(`✗ next-action-port-facing: ${msg}`);
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

// 1. Empty graph
{
  const p = proposeFacing({ nodes: [] });
  const r = applyFacingHints({ nodes: [] });
  toy(
    "empty-graph",
    p.facings.length === 0 && r.positions.length === 0 && r.facings.length === 0,
    `facings=${p.facings.length} pos=${r.positions.length}`
  );
}

// 2. Single node → one facing; apply near-noop when unlinked orphan matches
{
  const g = { nodes: [{ id: "a", x: 100, y: 100, type: "text" }] };
  const p = proposeFacing(g);
  const r = applyFacingHints(g);
  toy(
    "single-node",
    p.facings.length === 1 &&
      FACINGS.includes(p.facings[0].facing) &&
      p.facings[0].role === "source",
    `facing=${p.facings[0]?.facing} role=${p.facings[0]?.role} cool=${r.cool}`
  );
}

// 3. LTR chain: source faces right, sink faces left
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: 220, y: 0, type: "llm" },
      { id: "c", x: 440, y: 0, type: "image" },
    ],
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
    ],
  };
  const p = proposeFacing(g);
  const byId = Object.fromEntries(p.facings.map((f) => [f.id, f]));
  toy(
    "ltr-chain-faces",
    byId.a.facing === "right" &&
      byId.c.facing === "left" &&
      (byId.b.facing === "right" || byId.b.facing === "left"),
    `a=${byId.a.facing} b=${byId.b.facing} c=${byId.c.facing} prior=${p.priorId}`
  );
}

// 4. Vertical stack faces up/down
{
  const g = {
    nodes: [
      { id: "a", x: 100, y: 0, type: "text" },
      { id: "b", x: 100, y: 160, type: "llm" },
      { id: "c", x: 100, y: 320, type: "image" },
    ],
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
    ],
  };
  const p = proposeFacing(g);
  const byId = Object.fromEntries(p.facings.map((f) => [f.id, f]));
  toy(
    "stacked-faces-updown",
    p.axis === "y" &&
      byId.a.facing === "down" &&
      byId.c.facing === "up",
    `axis=${p.axis} a=${byId.a.facing} c=${byId.c.facing} prior=${p.priorId}`
  );
}

// 5. Already-cool LTR → apply near-noop (no positions unless force)
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: 220, y: 0, type: "llm" },
      { id: "c", x: 440, y: 0, type: "image" },
    ],
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
    ],
  };
  const r = applyFacingHints(g);
  const forced = applyFacingHints(g, { force: true });
  toy(
    "already-cool-noop",
    r.cool && r.positions.length === 0 && r.matchRatio >= COOL_MATCH_EPS,
    `cool=${r.cool} pos=${r.positions.length} match=${r.matchRatio.toFixed(2)} forcePos=${forced.positions.length}`
  );
}

// 6. Roles from adjacency
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: 10, y: 0, type: "llm" },
      { id: "c", x: 20, y: 0, type: "image" },
    ],
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
    ],
  };
  const { outs, ins } = adjacency(g);
  toy(
    "roles-source-middle-sink",
    nodeRole("a", outs, ins, "text") === "source" &&
      nodeRole("b", outs, ins, "llm") === "middle" &&
      nodeRole("c", outs, ins, "image") === "sink",
    `a=${nodeRole("a", outs, ins, "text")} b=${nodeRole("b", outs, ins, "llm")} c=${nodeRole("c", outs, ins, "image")}`
  );
}

// 7. Soft nudge moves at least one neighbor on messy facing
{
  const g = {
    nodes: [
      { id: "a", x: 200, y: 200, type: "text" },
      { id: "b", x: 190, y: 210, type: "llm" }, // almost on top — wrong side
    ],
    links: [{ from: { node: "a" }, to: { node: "b" } }],
  };
  const p = proposeFacing(g);
  const nudged = softNudgeForFacing(g, p.facings);
  const r = applyFacingHints(g, { force: true });
  toy(
    "soft-nudge-moves",
    nudged.length >= 1 || r.positions.length >= 1,
    `nudge=${nudged.length} applyPos=${r.positions.length} facingA=${p.facings.find((f) => f.id === "a")?.facing}`
  );
}

// 8. Comments ignored
{
  const boxes = boxesFromGraph({
    nodes: [
      { id: "c", x: 0, y: 0, type: "comment" },
      { id: "t", x: 10, y: 10, type: "text" },
    ],
  });
  const p = proposeFacing({
    nodes: [
      { id: "c", x: 0, y: 0, type: "comment" },
      { id: "t", x: 10, y: 10, type: "text" },
    ],
  });
  toy(
    "comments-ignored",
    boxes.length === 1 &&
      p.facings.length === 1 &&
      p.facings[0].id === "t",
    `boxes=${boxes.map((b) => b.id).join(",")} facings=${p.facings.map((f) => f.id).join(",")}`
  );
}

// 9. Selection ids
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: 220, y: 0, type: "llm" },
      { id: "c", x: 440, y: 0, type: "image" },
    ],
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
    ],
  };
  const p = proposeFacing(g, { ids: ["a", "b"] });
  toy(
    "selection-ids",
    p.facings.length === 2 &&
      p.facings.every((f) => f.id === "a" || f.id === "b"),
    `ids=${p.facings.map((f) => f.id).join(",")}`
  );
}

// 10. Scramble returns all four facings cycling
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: 10, y: 0, type: "llm" },
      { id: "c", x: 20, y: 0, type: "image" },
      { id: "d", x: 30, y: 0, type: "edit" },
    ],
  };
  const s = scrambleFacing(g);
  const set = new Set(s.facings.map((f) => f.facing));
  toy(
    "scramble-facings",
    s.facings.length === 4 && set.size === 4 && s.priorId === "scramble",
    `set=${[...set].join(",")} prior=${s.priorId}`
  );
}

// 11. Max nudge clamp
{
  const g = {
    nodes: [
      { id: "a", x: 0, y: 0, type: "text" },
      { id: "b", x: 5, y: 5, type: "llm" },
    ],
    links: [{ from: { node: "a" }, to: { node: "b" } }],
  };
  const p = proposeFacing(g);
  const moved = softNudgeForFacing(g, p.facings, { nudge: 500, maxNudge: MAX_NUDGE });
  const ok = moved.every((m) => Math.hypot(m.dx, m.dy) <= MAX_NUDGE + 0.1);
  toy(
    "max-nudge-clamp",
    moved.length >= 1 && ok,
    `n=${moved.length} maxMag=${moved.length ? Math.max(...moved.map((m) => Math.hypot(m.dx, m.dy))).toFixed(1) : 0}`
  );
}

// 12. Summary string + prior pick
{
  const boxes = [
    { id: "a", type: "text", x: 0, y: 0 },
    { id: "b", type: "llm", x: 200, y: 0 },
    { id: "c", type: "image", x: 400, y: 0 },
  ];
  const prior = pickFacingPrior(boxes);
  const p = proposeFacing({
    nodes: boxes,
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
    ],
  });
  const r = applyFacingHints({
    nodes: boxes,
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
    ],
  });
  const s = facingSummary(r);
  toy(
    "summary-and-prior",
    typeof s === "string" && s.length > 5 && prior.axis === "x" && FACING_PRIORS.some((p) => p.id === prior.id),
    `summary="${s}" prior=${prior.id}`
  );
}

const passed = toys.filter((t) => t.ok).length;
const total = toys.length;
console.log(`\nnext-action-port-facing toys: ${passed}/${total}`);
assert(FACINGS.length === 4, "four facings");
assert(FACING_PRIORS.length >= 3, "priors baked");
assert(NODE_W > 0 && NODE_H > 0 && NUDGE > 0 && MAX_NUDGE > 0, "constants positive");
assert(typeof proposeFacing === "function", "proposeFacing exported");
assert(typeof applyFacingHints === "function", "applyFacingHints exported");
assert(typeof scrambleFacing === "function", "scrambleFacing exported");
assert(typeof facingMatchRatio === "function", "facingMatchRatio exported");
if (passed < total) fail(`${total - passed} toy(s) failed`);
console.log("✓ next-action-port-facing ok");
