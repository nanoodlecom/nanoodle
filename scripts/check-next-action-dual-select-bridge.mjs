#!/usr/bin/env node
/**
 * Product · 37 — dual-select bridge suggest toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "../vendor/next-action/port-suggest.mjs";
import { pickDualSelectBridge } from "../vendor/next-action/dual-select-bridge.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-dual-select-bridge: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "dual-select-bridge.mjs")), "missing dual-select-bridge.mjs");
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
  // Exactly 2 selected: Text + Image unwired → bridge Text.text → Image.prompt
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
    selectedIds: ["t1", "img1"],
  };
  const pick = pickDualSelectBridge(tables, graph);
  toy("two-selected-picks", !!pick, pick ? `${pick.from.type}.${pick.from.port}→${pick.to.type}.${pick.to.port}` : "null");
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
  // Direction either way: Image + Text selected (order shouldn't matter)
  const graph = {
    nodes: [
      { id: "img1", type: "image" },
      { id: "t1", type: "text" },
    ],
    links: [],
    selectedIds: ["img1", "t1"],
  };
  const pick = pickDualSelectBridge(tables, graph);
  toy(
    "order-independent",
    !!(pick && pick.from.nodeId === "t1" && pick.to.nodeId === "img1"),
    pick ? `${pick.from.nodeId}→${pick.to.nodeId}` : "null"
  );
}

{
  // 0 selected → null
  toy(
    "zero-selected-quiet",
    pickDualSelectBridge(tables, {
      nodes: [
        { id: "t1", type: "text" },
        { id: "img1", type: "image" },
      ],
      links: [],
      selectedIds: [],
    }) === null,
    "null"
  );
}

{
  // 1 selected → null
  toy(
    "one-selected-quiet",
    pickDualSelectBridge(tables, {
      nodes: [
        { id: "t1", type: "text" },
        { id: "img1", type: "image" },
      ],
      links: [],
      selectedIds: ["t1"],
      selectedId: "t1",
    }) === null,
    "null"
  );
}

{
  // 3 selected → null
  toy(
    "three-selected-quiet",
    pickDualSelectBridge(tables, {
      nodes: [
        { id: "t1", type: "text" },
        { id: "img1", type: "image" },
        { id: "llm1", type: "llm" },
      ],
      links: [],
      selectedIds: ["t1", "img1", "llm1"],
    }) === null,
    "null"
  );
}

{
  // Already wired Text→Image.prompt → that pair not picked (likely quiet)
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [{ from: { node: "t1", port: "text" }, to: { node: "img1", port: "prompt" } }],
    selectedIds: ["t1", "img1"],
  };
  const pick = pickDualSelectBridge(tables, graph);
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
  // Flat competing pairs between the two nodes → quiet
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
  // Two nodes only: text+llm — only one pair direction exists in this flat table for them,
  // so use text+image with equal llm elsewhere isn't right. Flat between the two:
  // text → image.prompt vs text → image.seed if both exist with equal counts.
  const flat2 = {
    topTargets: {
      "text|text": { "image|prompt": 5, "image|seed": 5 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt", "seed"], outputs: ["image"] },
    },
  };
  const pick = pickDualSelectBridge(flat2, {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
    selectedIds: ["t1", "img1"],
  });
  toy("flat-quiet", pick === null, pick ? `${pick.from.port}→${pick.to.port}` : "null");
}

{
  const weak = {
    topTargets: { "text|text": { "image|prompt": 1 } },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
    },
  };
  const pick = pickDualSelectBridge(weak, {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
    selectedIds: ["t1", "img1"],
  });
  toy("below-min-pair-quiet", pick === null, pick ? "leaked" : "null");
}

{
  toy(
    "no-tables-quiet",
    pickDualSelectBridge(null, {
      nodes: [
        { id: "a", type: "text" },
        { id: "b", type: "image" },
      ],
      links: [],
      selectedIds: ["a", "b"],
    }) === null,
    "null"
  );
  toy(
    "empty-graph-quiet",
    pickDualSelectBridge(tables, { nodes: [], links: [], selectedIds: ["a", "b"] }) === null,
    "null"
  );
}

{
  // Clear leader among ports on the two selected nodes
  const lead = {
    topTargets: {
      "text|text": { "image|prompt": 10, "image|seed": 2 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt", "seed"], outputs: ["image"] },
    },
  };
  const pick = pickDualSelectBridge(lead, {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
    selectedIds: ["t1", "img1"],
  });
  toy(
    "clear-leader-pair",
    !!(pick && pick.to.port === "prompt" && pick.count === 10),
    pick ? `count=${pick.count} →${pick.to.port}` : "null"
  );
}

{
  // Third node exists but is NOT selected — must not bridge to it
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
      { id: "llm1", type: "llm" },
    ],
    links: [],
    selectedIds: ["t1", "img1"],
  };
  const pick = pickDualSelectBridge(tables, graph);
  toy(
    "ignores-unselected-third",
    !!(pick && pick.from.nodeId === "t1" && pick.to.nodeId === "img1" && pick.to.nodeId !== "llm1"),
    pick ? `${pick.from.nodeId}→${pick.to.nodeId}.${pick.to.port}` : "null"
  );
}

{
  toy("gates-exported", MIN_PAIR >= 2 && MIN_LEAD > 1 && MIN_SHARE > 0, `pair=${MIN_PAIR} lead=${MIN_LEAD} share=${MIN_SHARE}`);
}

// Editor wiring pins
{
  toy("html-has-ghost-css", /#wires\s+path\.na-dual-bridge-ghost\s*\{/.test(index) || /\.na-dual-bridge-ghost\s*\{/.test(index), ".na-dual-bridge-ghost");
  toy("html-has-port-pulse-css", /\.port\.na-dual-bridge-port\s*\{/.test(index), ".na-dual-bridge-port");
  toy("html-has-ghost-keyframes", /@keyframes\s+naDualBridgeGhostPulse/.test(index) || /@keyframes\s+naDualBridgePulse/.test(index), "keyframes");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,280}na-dual-bridge/.test(index) ||
      /na-dual-bridge[\s\S]{0,280}prefers-reduced-motion/.test(index) ||
      /dualBridgeReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-clearDualSelectBridge", index.includes("clearDualSelectBridge"), "fn");
  toy("html-applyDualSelectBridge", index.includes("applyDualSelectBridge"), "fn");
  toy("html-scheduleDualSelectBridge", index.includes("scheduleDualSelectBridge"), "fn");
  toy("html-pickDualSelectBridge-call", /pickDualSelectBridge\s*\(/.test(index), "call site");
  toy("html-redraw-draws-ghost", /_dualBridgeGhost[\s\S]{0,500}na-dual-bridge-ghost/.test(index), "redraw path");
  toy("html-startWire-clears", /function startWire[\s\S]{0,220}clearDualSelectBridge/.test(index), "startWire clears");
  toy("html-geoSetMulti-schedules", /function geoSetMulti[\s\S]{0,700}scheduleDualSelectBridge/.test(index), "geoSetMulti");
  toy("html-geoToggleMulti-schedules", /function geoToggleMulti[\s\S]{0,700}scheduleDualSelectBridge/.test(index), "geoToggleMulti");
  toy("html-click-connect", /na-dual-bridge-ghost[\s\S]{0,400}connect\(/.test(index) || /acceptDualSelectBridge/.test(index), "click/enter connect");
  toy(
    "surface-exports-pickDualSelectBridge",
    /pickDualSelectBridge\(query\)/.test(surface) && /from "\.\/dual-select-bridge\.mjs"/.test(surface),
    "editor-surface"
  );
  toy(
    "readme-mentions-37",
    /·\s*37|Product · 37|dual-select-bridge/.test(readme),
    "README · 37"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?37/.test(index) && !/\?product=37/.test(index),
    "no ?product=37"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-37-usage.gif")),
    "product-37-usage.gif"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\ndual-select-bridge toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  // Allow usage-gif to fail until capture; re-run after GIF
  const hard = failed.filter((f) => f.name !== "usage-gif-present");
  if (hard.length) fail(hard.map((f) => f.name).join(", "));
  console.warn("⚠ usage gif missing — capture next");
  process.exit(2);
}
console.log("✓ next-action-dual-select-bridge");
