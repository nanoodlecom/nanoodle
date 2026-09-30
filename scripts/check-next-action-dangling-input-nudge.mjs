#!/usr/bin/env node
/**
 * Product · 29 — dangling-input nudge toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "../vendor/next-action/port-suggest.mjs";
import { pickDanglingInputNudge } from "../vendor/next-action/dangling-input-nudge.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-dangling-input-nudge: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "dangling-input-nudge.mjs")), "missing dangling-input-nudge.mjs");
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
  // Text + Image unwired → Image.prompt is the clear hungry-input nudge
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
  };
  const pick = pickDanglingInputNudge(tables, graph);
  toy("text-image-picks", !!pick, pick ? `${pick.type}.${pick.port}` : "null");
  toy(
    "picks-image-prompt",
    !!(pick && pick.type === "image" && pick.port === "prompt" && pick.nodeId === "img1"),
    pick ? `${pick.nodeId}.${pick.port}` : "—"
  );
  toy("has-share", !!(pick && pick.share >= MIN_SHARE), pick ? `share=${pick.share.toFixed(3)}` : "—");
  toy("meets-min-pair", !!(pick && pick.count >= MIN_PAIR), pick ? `count=${pick.count}` : "—");
}

{
  // Prefer selected node's dangling in when confident
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
      { id: "llm1", type: "llm" },
    ],
    links: [],
    selectedId: "img1",
  };
  const pick = pickDanglingInputNudge(tables, graph);
  toy(
    "prefer-selected-image",
    !!(pick && pick.nodeId === "img1" && pick.port === "prompt"),
    pick ? `${pick.nodeId}.${pick.port} count=${pick.count}` : "null"
  );
}

{
  // Selected with no confident prior falls through to graph-wide
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
      { id: "c1", type: "comment" },
    ],
    links: [],
    selectedId: "c1",
  };
  const pick = pickDanglingInputNudge(tables, graph);
  toy(
    "fallback-graph-wide",
    !!(pick && pick.type === "image" && pick.port === "prompt"),
    pick ? `${pick.type}.${pick.port}` : "null"
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
  const pick = pickDanglingInputNudge(tables, graph);
  toy("multi-select-quiet", pick === null, pick ? "leaked" : "null");
}

{
  // Wired Text→Image.prompt leaves no confident hungry image.prompt
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [{ from: { node: "t1", port: "text" }, to: { node: "img1", port: "prompt" } }],
  };
  const pick = pickDanglingInputNudge(tables, graph);
  toy(
    "wired-prompt-not-picked",
    !(pick && pick.nodeId === "img1" && pick.port === "prompt"),
    pick ? `${pick.nodeId}.${pick.port}` : "quiet-or-other"
  );
}

{
  const flat = {
    topTargets: {
      // Equal mass into two destinations → neither candidate leads among scored ins
      "text|text": { "llm|prompt": 3, "image|prompt": 3 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
    },
  };
  const pick = pickDanglingInputNudge(flat, {
    nodes: [
      { id: "t1", type: "text" },
      { id: "a", type: "llm" },
      { id: "b", type: "image" },
    ],
    links: [],
  });
  toy("flat-quiet", pick === null, pick ? `${pick.type}.${pick.port}` : "null");
}

{
  const weak = {
    topTargets: { "text|text": { "image|prompt": 1 } },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
    },
  };
  const pick = pickDanglingInputNudge(weak, {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
  });
  toy("below-min-pair-quiet", pick === null, pick ? "leaked" : "null");
}

{
  toy("single-node-quiet", pickDanglingInputNudge(tables, { nodes: [{ id: "img1", type: "image" }], links: [] }) === null, "null");
  toy("no-tables-quiet", pickDanglingInputNudge(null, { nodes: [{ id: "a", type: "text" }, { id: "b", type: "image" }], links: [] }) === null, "null");
  toy("empty-graph-quiet", pickDanglingInputNudge(tables, { nodes: [], links: [] }) === null, "null");
}

{
  toy("gates-exported", MIN_PAIR >= 2 && MIN_LEAD > 1 && MIN_SHARE > 0, `pair=${MIN_PAIR} lead=${MIN_LEAD} share=${MIN_SHARE}`);
}

// Editor wiring pins
{
  toy("html-has-nudge-css", /\.port\.na-dangling-input-nudge\s*\{/.test(index), ".port.na-dangling-input-nudge");
  toy("html-has-nudge-keyframes", /@keyframes\s+naDangleInPulse/.test(index), "naDangleInPulse");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,160}na-dangling-input-nudge/.test(index) ||
      /na-dangling-input-nudge[\s\S]{0,200}prefers-reduced-motion/.test(index) ||
      /danglingInputNudgeReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-clearDanglingInputNudge", index.includes("clearDanglingInputNudge"), "fn");
  toy("html-applyDanglingInputNudge", index.includes("applyDanglingInputNudge"), "fn");
  toy("html-scheduleDanglingInputNudge", index.includes("scheduleDanglingInputNudge"), "fn");
  toy("html-pickDanglingInputNudge-call", /pickDanglingInputNudge\s*\(/.test(index), "call site");
  toy("html-startWire-clears", /function startWire[\s\S]{0,220}clearDanglingInputNudge/.test(index), "startWire clears");
  toy("html-run-schedules", /runGroup[\s\S]{0,400}scheduleDanglingInputNudge/.test(index), "run schedules");
  toy(
    "surface-exports-pickDanglingInputNudge",
    /pickDanglingInputNudge\(query\)/.test(surface) && /from "\.\/dangling-input-nudge\.mjs"/.test(surface),
    "editor-surface"
  );
  toy(
    "readme-mentions-29",
    /·\s*29|Product · 29|dangling-input-nudge/.test(readme),
    "README · 29"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?29/.test(index) && !/\?product=29/.test(index),
    "no ?product=29"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-29-usage.gif")),
    "product-29-usage.gif"
  );
  toy(
    "distinct-from-22-class",
    !/\.port\.na-dangling-nudge\s*\{/.test(index) || /\.port\.na-dangling-input-nudge\s*\{/.test(index),
    "·29 class present (·22 optional)"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\ndangling-input-nudge toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  fail(failed.map((f) => f.name).join(", "));
}
console.log("✓ next-action-dangling-input-nudge");
