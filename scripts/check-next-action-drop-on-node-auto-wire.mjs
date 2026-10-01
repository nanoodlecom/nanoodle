#!/usr/bin/env node
/**
 * Product · 39 — drop-on-node auto-wire toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "../vendor/next-action/port-suggest.mjs";
import {
  MIN_OVERLAP_RATIO,
  overlapMetrics,
  findDropOverlapTarget,
  pickDropAutoWire,
} from "../vendor/next-action/drop-on-node-auto-wire.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-drop-on-node-auto-wire: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "drop-on-node-auto-wire.mjs")), "missing drop-on-node-auto-wire.mjs");
assert(existsSync(CORPUS), "missing port-suggest.json");

const tables = JSON.parse(readFileSync(CORPUS, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");
const helper = readFileSync(join(NA, "drop-on-node-auto-wire.mjs"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  toy("gates-exported", MIN_PAIR >= 2 && MIN_LEAD > 1 && MIN_SHARE > 0, `pair=${MIN_PAIR} lead=${MIN_LEAD} share=${MIN_SHARE}`);
  toy("min-overlap-exported", MIN_OVERLAP_RATIO > 0 && MIN_OVERLAP_RATIO < 1, `ratio=${MIN_OVERLAP_RATIO}`);
}

{
  // Text + Image drop → text.text → image.prompt
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
  };
  const pick = pickDropAutoWire(tables, graph, { draggedId: "img1", targetId: "t1" });
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
  // Direction either way: drag Text onto Image
  const graph = {
    nodes: [
      { id: "img1", type: "image" },
      { id: "t1", type: "text" },
    ],
    links: [],
  };
  const pick = pickDropAutoWire(tables, graph, { draggedId: "t1", targetId: "img1" });
  toy(
    "drag-text-onto-image",
    !!(pick && pick.from.nodeId === "t1" && pick.to.nodeId === "img1" && pick.to.port === "prompt"),
    pick ? `${pick.from.nodeId}→${pick.to.nodeId}.${pick.to.port}` : "null"
  );
}

{
  // Self drop → null
  toy(
    "self-null",
    pickDropAutoWire(tables, {
      nodes: [{ id: "t1", type: "text" }, { id: "img1", type: "image" }],
      links: [],
    }, { draggedId: "t1", targetId: "t1" }) === null,
    "self"
  );
}

{
  // Missing ids
  toy(
    "missing-dragged",
    pickDropAutoWire(tables, {
      nodes: [{ id: "t1", type: "text" }, { id: "img1", type: "image" }],
      links: [],
    }, { targetId: "img1" }) === null,
    "no draggedId"
  );
  toy(
    "missing-target",
    pickDropAutoWire(tables, {
      nodes: [{ id: "t1", type: "text" }, { id: "img1", type: "image" }],
      links: [],
    }, { draggedId: "t1" }) === null,
    "no targetId"
  );
  toy(
    "unknown-id",
    pickDropAutoWire(tables, {
      nodes: [{ id: "t1", type: "text" }],
      links: [],
    }, { draggedId: "t1", targetId: "nope" }) === null,
    "unknown target"
  );
}

{
  // Already wired with that pair → dangling empty → null
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [{ from: { node: "t1", port: "text" }, to: { node: "img1", port: "prompt" } }],
  };
  toy(
    "already-wired-null",
    pickDropAutoWire(tables, graph, { draggedId: "img1", targetId: "t1" }) === null,
    "wired"
  );
}

{
  // Flat / weak tables → null
  const flat = {
    topTargets: {
      "text|text": { "image|prompt": 1, "llm|prompt": 1 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
    },
  };
  toy(
    "flat-null",
    pickDropAutoWire(flat, {
      nodes: [
        { id: "t1", type: "text" },
        { id: "img1", type: "image" },
      ],
      links: [],
    }, { draggedId: "img1", targetId: "t1" }) === null,
    "flat count=1"
  );

  const weak = {
    topTargets: {
      "text|text": { "image|prompt": 5, "llm|prompt": 4 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
    },
  };
  // Between text+image only, llm is not in graph — only one scored pair → share 1, count 5 → picks.
  // Need both candidates in the two-node graph. Use text+image with two competing image ports.
  const tie = {
    topTargets: {
      "text|text": { "image|prompt": 4, "image|seed": 4 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt", "seed"], outputs: ["image"] },
    },
  };
  toy(
    "no-lead-null",
    pickDropAutoWire(tie, {
      nodes: [
        { id: "t1", type: "text" },
        { id: "img1", type: "image" },
      ],
      links: [],
    }, { draggedId: "img1", targetId: "t1" }) === null,
    "tied pairs"
  );
  toy(
    "null-tables",
    pickDropAutoWire(null, {
      nodes: [
        { id: "t1", type: "text" },
        { id: "img1", type: "image" },
      ],
      links: [],
    }, { draggedId: "img1", targetId: "t1" }) === null,
    "null tables"
  );
  toy(
    "empty-nodes",
    pickDropAutoWire(tables, { nodes: [], links: [] }, { draggedId: "a", targetId: "b" }) === null,
    "empty graph"
  );
}

{
  // Clear leader among competing ports
  const lead = {
    topTargets: {
      "text|text": { "image|prompt": 10, "image|seed": 2 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt", "seed"], outputs: ["image"] },
    },
  };
  const pick = pickDropAutoWire(lead, {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
  }, { draggedId: "img1", targetId: "t1" });
  toy(
    "clear-leader-pair",
    !!(pick && pick.to.port === "prompt" && pick.count === 10),
    pick ? `count=${pick.count} →${pick.to.port}` : "null"
  );
}

{
  // Third node exists but is not the drop target — must not wire to it
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
      { id: "llm1", type: "llm" },
    ],
    links: [],
  };
  const pick = pickDropAutoWire(tables, graph, { draggedId: "img1", targetId: "t1" });
  toy(
    "ignores-third-node",
    !!(pick && pick.from.nodeId === "t1" && pick.to.nodeId === "img1"),
    pick ? `${pick.from.nodeId}→${pick.to.nodeId}` : "null"
  );
}

{
  // Overlap helpers
  const a = { id: "a", x: 0, y: 0, w: 100, h: 100 };
  const b = { id: "b", x: 40, y: 40, w: 100, h: 100 };
  const m = overlapMetrics(a, b);
  toy("overlap-area-positive", m.area > 0, `area=${m.area}`);
  toy("overlap-center-in", m.centerInB === true, `centerInB=${m.centerInB}`);
  toy("overlap-ratio", m.ratio > MIN_OVERLAP_RATIO, `ratio=${m.ratio.toFixed(3)}`);

  const far = { id: "c", x: 500, y: 500, w: 100, h: 100 };
  toy(
    "no-overlap-far",
    findDropOverlapTarget(a, [far]) === null,
    "far"
  );
  const hit = findDropOverlapTarget(a, [b, far]);
  toy(
    "picks-overlapping-target",
    !!(hit && hit.targetId === "b"),
    hit ? hit.targetId : "null"
  );
  toy(
    "ignores-self-in-others",
    findDropOverlapTarget(a, [a, b])?.targetId === "b",
    "self skipped"
  );
  const tiny = { id: "d", x: 95, y: 95, w: 100, h: 100 };
  // 5x5 = 25 area, ratio = 25/10000 = 0.0025 — below threshold and centers not inside
  const edge = findDropOverlapTarget(
    { id: "a", x: 0, y: 0, w: 100, h: 100 },
    [{ id: "d", x: 98, y: 98, w: 100, h: 100 }]
  );
  toy("tiny-corner-quiet", edge === null, edge ? `ratio=${edge.ratio}` : "null");
}

{
  toy("helper-exports-pick", /export function pickDropAutoWire/.test(helper), "pickDropAutoWire");
  toy("helper-exports-find", /export function findDropOverlapTarget/.test(helper), "findDropOverlapTarget");
  toy("helper-uses-dangling", /danglingPorts/.test(helper), "danglingPorts");
  toy("helper-uses-pairCount", /pairCount/.test(helper), "pairCount");
  toy("helper-uses-gates", /MIN_PAIR/.test(helper) && /MIN_LEAD/.test(helper) && /MIN_SHARE/.test(helper), "gates");
}

// The baked gallery catalog cannot enable sockets the selected model disables.
{
  const start = index.indexOf("function tryDropOnNodeAutoWire(dragged){");
  const end = index.indexOf("\n/* Next-action scores", start);
  assert(start >= 0 && end > start, "missing auto-wire handler");
  const source = index.slice(start, end);
  function attemptDrop(options = {}) {
    const port = (name, type, disabled) => ({
      dataset: { port: name, ptype: type },
      classList: { contains(value) { return value === "disabled" && !!disabled; } },
    });
    const sourcePort = port("image", "image", options.sourceDisabled);
    const targetPort = port("image", options.mismatched ? "text" : "image", options.targetDisabled);
    const nodes = [
      { id: "img1", type: "image", x: 0, y: 0, el: { querySelectorAll() { return options.missingSource ? [] : [sourcePort]; } } },
      { id: "llm1", type: "llm", x: 0, y: 0, el: { querySelectorAll() { return options.missingTarget ? [] : [targetPort]; } } },
    ];
    const links = options.occupied ? [{ from: { node: "other", port: "image" }, to: { node: "llm1", port: "image" } }] : [];
    let connects = 0;
    const context = {
      graph: { nodes, links }, multiSel: new Set(), geoOn() { return true; },
      dropAutoWireReducedMotion() { return false; },
      findDropOverlapTargetFn() { return { targetId: "llm1" }; },
      dropAutoWireCollectBoxes() { return []; },
      byId(id) { return nodes.find(node => node.id === id); },
      wouldCycle() { return false; }, pulseDropAutoWirePorts() {},
      connect() { connects++; return true; },
      window: { __nextAction: {
        hasPortPriors() { return true; },
        pickDropAutoWire() { return {
          from: { nodeId: "img1", port: "image" },
          to: { nodeId: "llm1", port: "image" },
        }; },
      } },
    };
    runInNewContext(source, context);
    const accepted = context.tryDropOnNodeAutoWire(nodes[0]);
    return { accepted, connects };
  }
  const enabled = attemptDrop();
  toy("live-enabled-ports-connect", enabled.accepted && enabled.connects === 1, "one compatible live connection");
  for (const option of ["missingSource", "missingTarget", "sourceDisabled", "targetDisabled", "mismatched", "occupied"]) {
    const result = attemptDrop({ [option]: true });
    toy(`live-${option}-quiet`, !result.accepted && result.connects === 0, "no illegal or replacement connection");
  }
}

// Exercise the real drag listeners: canceling a touch/pen gesture must never
// create a graph connection, while a matching pointer release still can.
{
  const start = index.indexOf("function startNodeDrag(n, e){");
  const end = index.indexOf("\n// Drag the node's bottom-right grip", start);
  assert(start >= 0 && end > start, "missing node drag handler");
  const source = index.slice(start, end);
  function releaseDrag(type, pointerId = 7, moveFirst = true) {
    const listeners = new Map();
    const attempts = [];
    let saves = 0;
    const context = {
      geoAnim: 0, scale: 1, multiSel: new Set(), nodeGestPtrs: new Set(),
      cancelNodeGest: null, world: { appendChild() {} },
      pushUndo() {}, redraw() {},
      save() { saves++; },
      tryDropOnNodeAutoWire(node) { attempts.push(node.id); },
      window: {
        addEventListener(name, fn) { listeners.set(name, fn); },
        removeEventListener(name, fn) {
          if (listeners.get(name) === fn) listeners.delete(name);
        },
      },
    };
    runInNewContext(source, context);
    const node = { id: "img1", x: 0, y: 0, el: { style: {} } };
    context.startNodeDrag(node, {
      pointerId: 7, clientX: 0, clientY: 0, preventDefault() {},
    });
    if (moveFirst) listeners.get("pointermove")({ pointerId: 7, clientX: 20, clientY: 20 });
    listeners.get(type)({ type, pointerId });
    return { attempts, saves, listeners, active: context.nodeGestPtrs.size };
  }
  const canceled = releaseDrag("pointercancel");
  toy("cancel-never-auto-wires", canceled.attempts.length === 0, "canceled drag creates no link");
  toy("cancel-cleans-listeners", canceled.listeners.size === 0 && canceled.active === 0, "cancel ends the gesture");
  const released = releaseDrag("pointerup");
  toy("release-auto-wires-once", released.attempts.length === 1 && released.saves === 1, "real release attempts one connection");
  const stray = releaseDrag("pointerup", 9);
  toy("stray-pointer-never-auto-wires", stray.attempts.length === 0 && stray.active === 1, "other pointer leaves drag active");
  const clicked = releaseDrag("pointerup", 7, false);
  toy("click-never-auto-wires", clicked.attempts.length === 0, "click without drag creates no link");
}

// Editor wiring pins
{
  toy("html-has-port-pulse-css", /\.port\.na-drop-auto-wire-port\s*\{/.test(index), ".na-drop-auto-wire-port");
  toy("html-has-keyframes", /@keyframes\s+naDropAutoWirePulse/.test(index), "keyframes");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,280}na-drop-auto-wire/.test(index) ||
      /na-drop-auto-wire[\s\S]{0,280}prefers-reduced-motion/.test(index) ||
      /dropAutoWireReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-tryDropOnNodeAutoWire", index.includes("tryDropOnNodeAutoWire"), "fn");
  toy("html-pulseDropAutoWirePorts", index.includes("pulseDropAutoWirePorts"), "pulse fn");
  toy("html-clearDropAutoWirePulse", index.includes("clearDropAutoWirePulse"), "clear fn");
  toy("html-pickDropAutoWire-call", /pickDropAutoWire\s*\(/.test(index), "call site");
  toy("html-findDropOverlap-import", /drop-on-node-auto-wire\.mjs/.test(index), "import");
  toy(
    "html-startNodeDrag-hook",
    /function startNodeDrag[\s\S]{0,2400}tryDropOnNodeAutoWire/.test(index),
    "drag end hook"
  );
  toy(
    "html-multi-quiet",
    /_dropAutoWireSingle|multiSel\.size\s*>=\s*2/.test(index) &&
      /tryDropOnNodeAutoWire/.test(index),
    "multi quiet"
  );
  toy(
    "html-geoOn-gate",
    /function tryDropOnNodeAutoWire[\s\S]{0,400}geoOn/.test(index),
    "geoOn"
  );
  toy(
    "html-connect-call",
    /function tryDropOnNodeAutoWire[\s\S]{0,2400}connect\(/.test(index),
    "connect()"
  );
  toy(
    "surface-exports-pickDropAutoWire",
    /pickDropAutoWire\(query\)/.test(surface) && /from "\.\/drop-on-node-auto-wire\.mjs"/.test(surface),
    "editor-surface"
  );
  toy(
    "readme-mentions-39",
    /·\s*39|Product · 39|drop-on-node-auto-wire/.test(readme),
    "README · 39"
  );
  toy(
    "readme-check-script",
    readme.includes("check-next-action-drop-on-node-auto-wire.mjs"),
    "README check"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?39/.test(index) && !/\?product=39/.test(index),
    "no ?product=39"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-39-usage.gif")),
    "product-39-usage.gif"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\ndrop-on-node-auto-wire toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  const hard = failed.filter((f) => f.name !== "usage-gif-present");
  if (hard.length) fail(hard.map((f) => f.name).join(", "));
  console.warn("⚠ usage gif missing — capture next");
  process.exit(2);
}
console.log("✓ next-action-drop-on-node-auto-wire");
