#!/usr/bin/env node
/**
 * Product · 31 — recipe next-seat ghost toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pickRecipeNextSeatGhost,
  pickAnchorNode,
  candidateSeats,
  seatOverlaps,
  sketchFromNodes,
  NODE_W,
  NODE_H,
  GAP,
} from "../vendor/next-action/recipe-seat-ghost.mjs";
import { boxesFromGraph } from "../vendor/next-action/collision-nudge.mjs";
import { MIN_COVERED } from "../vendor/next-action/recipe.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "recipes.json");

function fail(msg) {
  console.error(`✗ next-action-recipe-seat-ghost: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "recipe-seat-ghost.mjs")), "missing recipe-seat-ghost.mjs");
assert(existsSync(CORPUS), "missing recipes.json");

const corpus = JSON.parse(readFileSync(CORPUS, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  // Text + LLM → confident recipe next = image; free seat to the right of last/selected
  const graph = {
    nodes: [
      { id: "t1", type: "text", x: 100, y: 200 },
      { id: "llm1", type: "llm", x: 400, y: 180 },
    ],
    links: [],
    selectedId: "llm1",
  };
  const pick = pickRecipeNextSeatGhost(corpus, graph);
  toy("text-llm-picks", !!pick, pick ? `${pick.type}@${pick.x},${pick.y} (${pick.dir})` : "null");
  toy(
    "picks-image-type",
    !!(pick && pick.type === "image"),
    pick ? pick.type : "—"
  );
  toy(
    "seat-right-of-selected",
    !!(pick && pick.dir === "right" && pick.x > 400),
    pick ? `dir=${pick.dir} x=${pick.x}` : "—"
  );
  toy("has-slug-title", !!(pick && pick.slug && pick.title), pick ? `${pick.slug}` : "—");
  toy("reason-present", !!(pick && pick.reason), pick ? pick.reason : "—");
}

{
  // Prefer selected as anchor even when not last-added
  const graph = {
    nodes: [
      { id: "t1", type: "text", x: 100, y: 200 },
      { id: "llm1", type: "llm", x: 400, y: 180 },
      { id: "extra", type: "text", x: 700, y: 500 }, // would break multiset if counted — wait, second text may break character-sprites
    ],
  };
  // Actually 2 texts breaks character-sprites (only 1 text). Use selected llm without extra text.
}

{
  const graph = {
    nodes: [
      { id: "t1", type: "text", x: 80, y: 220 },
      { id: "llm1", type: "llm", x: 360, y: 200 },
    ],
    links: [],
    selectedId: "t1",
  };
  const pick = pickRecipeNextSeatGhost(corpus, graph);
  const anchor = pickAnchorNode(graph);
  toy("anchor-selected", !!(anchor && anchor.id === "t1"), anchor ? anchor.id : "—");
  // right of text overlaps llm (nodes are close); helper should still pick a free seat
  toy(
    "seat-from-selected-text",
    !!(pick && pick.type === "image" && (pick.dir === "below" || pick.dir === "left" || pick.dir === "right")),
    pick ? `x=${pick.x} dir=${pick.dir}` : "null"
  );
}

{
  // Multi-select stays quiet
  const graph = {
    nodes: [
      { id: "t1", type: "text", x: 100, y: 200 },
      { id: "llm1", type: "llm", x: 400, y: 180 },
    ],
    links: [],
    selectedIds: ["t1", "llm1"],
  };
  toy("multi-select-quiet", pickRecipeNextSeatGhost(corpus, graph) === null, "null");
}

{
  // Empty / single node / no tables
  toy("empty-quiet", pickRecipeNextSeatGhost(corpus, { nodes: [], links: [] }) === null, "null");
  toy(
    "single-text-quiet",
    pickRecipeNextSeatGhost(corpus, {
      nodes: [{ id: "t1", type: "text", x: 100, y: 100 }],
      links: [],
    }) === null,
    "null (MIN_COVERED)"
  );
  toy(
    "no-corpus-quiet",
    pickRecipeNextSeatGhost(null, {
      nodes: [
        { id: "t1", type: "text", x: 100, y: 200 },
        { id: "llm1", type: "llm", x: 400, y: 180 },
      ],
    }) === null,
    "null"
  );
}

{
  // Occupied right seat → fall through to below
  const graph = {
    nodes: [
      { id: "t1", type: "text", x: 100, y: 200 },
      { id: "llm1", type: "llm", x: 400, y: 180 },
      // blocker to the right of llm1 (selected)
      { id: "block", type: "comment", x: 400 + NODE_W + GAP, y: 180 },
    ],
    links: [],
    selectedId: "llm1",
  };
  // comment ignored in boxes — use a real type that doesn't break recipe: use upload? that changes multiset.
  // Place a blocker with same types? Better: occupy seat with geometry-only by using a node that fits recipe.
  // character-sprites remaining after text+llm is image — can't add another llm without changing match.
  // Use oversized w on llm so right seat calculation uses that, and put a text that's already counted... 
  // Simpler: manually test seatOverlaps + candidate fallback with synthetic boxes via occupied image position
}

{
  // Right of llm occupied by an image that STILL matches a longer recipe? text+llm+image → rivals disagree → quiet.
  // So for occupied-right fallback, use a blocker node type that is still a partial of a recipe where next stays image.
  // neon-shrine: text,llm,image,llm,ivideo — after text+llm next is image. Adding a stray resize wouldn't match.
  // Put blocker as a comment? comments ignored by boxesFromGraph.
  // Force overlap by placing a second llm far away for multiset... no that breaks.
  // Approach: place blocker with type "image" at the right seat — then multiset is text+llm+image → confidentRecipe null.
  // So test seatOverlaps / candidateSeats directly + a graph where right is blocked by overlapping coords of existing llm twin.
}

{
  // Tiny single-recipe corpus so an off-path "edit" blocker doesn't flatten confidence.
  // Block the right seat of llm; expect below.
  const local = {
    schemaVersion: 1,
    recipes: [
      {
        id: "kit",
        slug: "kit",
        title: "Kit",
        sequence: ["text", "llm", "image", "edit"],
        multiset: { text: 1, llm: 1, image: 1, edit: 1 },
      },
    ],
  };
  const rightX = 400 + NODE_W + GAP;
  const graph = {
    nodes: [
      { id: "t1", type: "text", x: 100, y: 200 },
      { id: "llm1", type: "llm", x: 400, y: 180 },
      { id: "block", type: "edit", x: rightX, y: 180 },
    ],
    links: [],
    selectedId: "llm1",
  };
  const pick = pickRecipeNextSeatGhost(local, graph);
  toy(
    "occupied-right-falls-to-below",
    !!(pick && pick.type === "image" && pick.dir === "below"),
    pick ? `dir=${pick.dir} y=${pick.y} type=${pick.type}` : "null"
  );
}

{
  // All seats blocked → quiet
  const graph = {
    nodes: [
      { id: "t1", type: "text", x: 100, y: 200, w: 900, h: 800 },
      { id: "llm1", type: "llm", x: 400, y: 180 },
    ],
    links: [],
    selectedId: "llm1",
  };
  const pick = pickRecipeNextSeatGhost(corpus, graph);
  toy("all-seats-blocked-quiet", pick === null, pick ? `leaked ${pick.dir}` : "null");
}

{
  // Flat / disagreeing recipes stay quiet (text+image alone — rivals disagree on next)
  const pick = pickRecipeNextSeatGhost(corpus, {
    nodes: [
      { id: "t1", type: "text", x: 100, y: 200 },
      { id: "img1", type: "image", x: 400, y: 180 },
    ],
    links: [],
  });
  toy("flat-disagree-quiet", pick === null, pick ? pick.type : "null");
}

{
  const seats = candidateSeats({ x: 10, y: 20, w: NODE_W, h: NODE_H });
  toy("three-seat-dirs", seats.length === 3 && seats[0].dir === "right" && seats[1].dir === "below" && seats[2].dir === "left", seats.map((s) => s.dir).join(","));
  const boxes = boxesFromGraph({
    nodes: [{ id: "a", type: "text", x: 10 + NODE_W + GAP, y: 20 }],
  });
  toy(
    "seatOverlaps-detects",
    seatOverlaps(seats[0], boxes, GAP) === true,
    "right blocked"
  );
  toy(
    "seatOverlaps-clear-below",
    seatOverlaps(seats[1], boxes, GAP) === false,
    "below free"
  );
}

{
  const sk = sketchFromNodes({
    nodes: [
      { type: "text" },
      { type: "llm" },
      { type: "comment" },
    ],
  });
  toy("sketch-ignores-comment", sk.numNodes === 2 && sk.nodeTypeCounts.text === 1 && sk.nodeTypeCounts.llm === 1, JSON.stringify(sk.nodeTypeCounts));
  toy("gates-min-covered", MIN_COVERED >= 2, `MIN_COVERED=${MIN_COVERED}`);
}

// Editor wiring pins
{
  toy("html-has-ghost-css", /\.na-recipe-seat-ghost\s*\{/.test(index), ".na-recipe-seat-ghost");
  toy("html-has-ghost-keyframes", /@keyframes\s+naRecipeSeatGhostPulse/.test(index), "naRecipeSeatGhostPulse");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,220}na-recipe-seat-ghost/.test(index) ||
      /na-recipe-seat-ghost[\s\S]{0,220}prefers-reduced-motion/.test(index) ||
      /recipeSeatGhostReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-clearRecipeSeatGhost", index.includes("clearRecipeSeatGhost"), "fn");
  toy("html-applyRecipeSeatGhost", index.includes("applyRecipeSeatGhost"), "fn");
  toy("html-scheduleRecipeSeatGhost", index.includes("scheduleRecipeSeatGhost"), "fn");
  toy("html-pickRecipeNextSeatGhost-call", /pickRecipeNextSeatGhost\s*\(/.test(index), "call site");
  toy("html-click-addNode", /na-recipe-seat-ghost[\s\S]{0,800}addNode\s*\(/.test(index) || /clearRecipeSeatGhost\(\);\s*[\s\S]{0,200}addNode\s*\(/.test(index), "click→addNode");
  toy("html-startWire-clears", /function startWire[\s\S]{0,220}clearRecipeSeatGhost/.test(index), "startWire clears");
  toy("html-startNodeDrag-clears", /function startNodeDrag[\s\S]{0,220}clearRecipeSeatGhost/.test(index), "drag clears");
  toy("html-run-schedules", /runGroup[\s\S]{0,400}scheduleRecipeSeatGhost/.test(index), "run schedules");
  toy("html-idle-schedules", /pointerup[\s\S]{0,120}scheduleRecipeSeatGhost/.test(index), "idle beat");
  toy(
    "surface-exports-pickRecipeNextSeatGhost",
    /pickRecipeNextSeatGhost\(query\)/.test(surface) && /from "\.\/recipe-seat-ghost\.mjs"/.test(surface),
    "editor-surface"
  );
  toy("surface-hasRecipes", /hasRecipes\(\)/.test(surface), "hasRecipes");
  toy(
    "readme-mentions-31",
    /·\s*31|Product · 31|recipe-seat-ghost|next-seat/.test(readme),
    "README · 31"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?31/.test(index) && !/\?product=31/.test(index),
    "no ?product=31"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "no-forbidden-na-ghost-substr",
    !index.includes("na-ghost"),
    "check-layout safe"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-31-usage.gif")),
    "product-31-usage.gif"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\nrecipe-seat-ghost toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  fail(failed.map((f) => f.name).join(", "));
}
console.log("✓ next-action-recipe-seat-ghost");
