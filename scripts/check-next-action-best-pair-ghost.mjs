#!/usr/bin/env node
/**
 * Product · 30 — best-pair ghost wire toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "../vendor/next-action/port-suggest.mjs";
import { pickBestPairGhost } from "../vendor/next-action/best-pair-ghost.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-best-pair-ghost: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "best-pair-ghost.mjs")), "missing best-pair-ghost.mjs");
assert(existsSync(CORPUS), "missing port-suggest.json");

const tables = JSON.parse(readFileSync(CORPUS, "utf8"));
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
  // Text + Image unwired → ghost Text.text → Image.prompt
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
  };
  const pick = pickBestPairGhost(tables, graph);
  toy("text-image-picks", !!pick, pick ? `${pick.from.type}.${pick.from.port}→${pick.to.type}.${pick.to.port}` : "null");
  toy(
    "picks-text-to-image-prompt",
    !!(
      pick &&
      pick.from.type === "text" &&
      pick.from.port === "text" &&
      pick.from.nodeId === "t1" &&
      pick.to.type === "image" &&
      pick.to.port === "prompt" &&
      pick.to.nodeId === "img1"
    ),
    pick ? `${pick.from.nodeId}.${pick.from.port}→${pick.to.nodeId}.${pick.to.port}` : "—"
  );
  toy("has-share", !!(pick && pick.share >= MIN_SHARE), pick ? `share=${pick.share.toFixed(3)}` : "—");
  toy("meets-min-pair", !!(pick && pick.count >= MIN_PAIR), pick ? `count=${pick.count}` : "—");
}

{
  // Prefer selected node's dangling out when it forms a confident pair
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
      { id: "llm1", type: "llm" },
    ],
    links: [],
    selectedId: "t1",
  };
  const pick = pickBestPairGhost(tables, graph);
  toy(
    "prefer-selected-out",
    !!(pick && pick.from.nodeId === "t1"),
    pick ? `${pick.from.nodeId}→${pick.to.nodeId}.${pick.to.port} count=${pick.count}` : "null"
  );
}

{
  // Prefer selected destination when selection is the hungry input node
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
      { id: "llm1", type: "llm" },
    ],
    links: [],
    selectedId: "img1",
  };
  const pick = pickBestPairGhost(tables, graph);
  toy(
    "prefer-selected-in",
    !!(pick && pick.to.nodeId === "img1" && pick.to.port === "prompt"),
    pick ? `${pick.from.nodeId}→${pick.to.nodeId}.${pick.to.port}` : "null"
  );
}

{
  // Multi-select stays quiet
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
    selectedIds: ["t1", "img1"],
  };
  const pick = pickBestPairGhost(tables, graph);
  toy("multi-select-quiet", pick === null, pick ? "leaked" : "null");
}

{
  // Wired Text→Image.prompt → that pair gone; may quiet or pick another
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [{ from: { node: "t1", port: "text" }, to: { node: "img1", port: "prompt" } }],
  };
  const pick = pickBestPairGhost(tables, graph);
  toy(
    "wired-pair-not-picked",
    !(
      pick &&
      pick.from.nodeId === "t1" &&
      pick.from.port === "text" &&
      pick.to.nodeId === "img1" &&
      pick.to.port === "prompt"
    ),
    pick ? `${pick.from.nodeId}.${pick.from.port}→${pick.to.nodeId}.${pick.to.port}` : "quiet"
  );
}

{
  // Flat competing pairs → quiet
  const flat = {
    topTargets: {
      "text|text": { "llm|prompt": 4, "image|prompt": 4 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
    },
  };
  const pick = pickBestPairGhost(flat, {
    nodes: [
      { id: "t1", type: "text" },
      { id: "a", type: "llm" },
      { id: "b", type: "image" },
    ],
    links: [],
  });
  toy("flat-quiet", pick === null, pick ? `${pick.from.type}→${pick.to.type}` : "null");
}

{
  const weak = {
    topTargets: { "text|text": { "image|prompt": 1 } },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
    },
  };
  const pick = pickBestPairGhost(weak, {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
  });
  toy("below-min-pair-quiet", pick === null, pick ? "leaked" : "null");
}

{
  toy(
    "single-node-quiet",
    pickBestPairGhost(tables, { nodes: [{ id: "img1", type: "image" }], links: [] }) === null,
    "null"
  );
  toy(
    "no-tables-quiet",
    pickBestPairGhost(null, {
      nodes: [
        { id: "a", type: "text" },
        { id: "b", type: "image" },
      ],
      links: [],
    }) === null,
    "null"
  );
  toy("empty-graph-quiet", pickBestPairGhost(tables, { nodes: [], links: [] }) === null, "null");
}

{
  // Clear leader among many candidates
  const lead = {
    topTargets: {
      "text|text": { "image|prompt": 10, "llm|prompt": 2 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
    },
  };
  const pick = pickBestPairGhost(lead, {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
      { id: "llm1", type: "llm" },
    ],
    links: [],
  });
  toy(
    "clear-leader-pair",
    !!(pick && pick.to.type === "image" && pick.to.port === "prompt" && pick.count === 10),
    pick ? `count=${pick.count} →${pick.to.type}.${pick.to.port}` : "null"
  );
}

{
  toy("gates-exported", MIN_PAIR >= 2 && MIN_LEAD > 1 && MIN_SHARE > 0, `pair=${MIN_PAIR} lead=${MIN_LEAD} share=${MIN_SHARE}`);
}

// Editor wiring pins
{
  toy("html-has-ghost-css", /#wires\s+path\.na-best-pair-ghost\s*\{/.test(index) || /\.na-best-pair-ghost\s*\{/.test(index), ".na-best-pair-ghost");
  toy("html-has-ghost-keyframes", /@keyframes\s+naBestPairGhostPulse/.test(index), "naBestPairGhostPulse");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,200}na-best-pair-ghost/.test(index) ||
      /na-best-pair-ghost[\s\S]{0,200}prefers-reduced-motion/.test(index) ||
      /bestPairGhostReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-clearBestPairGhost", index.includes("clearBestPairGhost"), "fn");
  toy("html-applyBestPairGhost", index.includes("applyBestPairGhost"), "fn");
  toy("html-scheduleBestPairGhost", index.includes("scheduleBestPairGhost"), "fn");
  toy("html-pickBestPairGhost-call", /pickBestPairGhost\s*\(/.test(index), "call site");
  toy("html-redraw-draws-ghost", /_bestPairGhost[\s\S]{0,400}na-best-pair-ghost/.test(index), "redraw path");
  toy("html-startWire-clears", /function startWire[\s\S]{0,220}clearBestPairGhost/.test(index), "startWire clears");
  toy("html-run-schedules", /runGroup[\s\S]{0,400}scheduleBestPairGhost/.test(index), "run schedules");
  toy("html-idle-schedules", /pointerup[\s\S]{0,120}scheduleBestPairGhost/.test(index), "idle beat");
  toy(
    "surface-exports-pickBestPairGhost",
    /pickBestPairGhost\(query\)/.test(surface) && /from "\.\/best-pair-ghost\.mjs"/.test(surface),
    "editor-surface"
  );
  toy(
    "readme-mentions-30",
    /·\s*30|Product · 30|best-pair-ghost/.test(readme),
    "README · 30"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?30/.test(index) && !/\?product=30/.test(index),
    "no ?product=30"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-30-usage.gif")),
    "product-30-usage.gif"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\nbest-pair-ghost toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  fail(failed.map((f) => f.name).join(", "));
}
console.log("✓ next-action-best-pair-ghost");
