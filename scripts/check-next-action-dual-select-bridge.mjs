#!/usr/bin/env node
/**
 * Product · 37 — dual-select bridge suggest toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import vm from "node:vm";
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

// Exercise the editor's acceptance guard against live graph and socket changes.
function editorFn(name) {
  const start = index.indexOf("function " + name + "(");
  assert(start >= 0, "missing editor helper " + name);
  let depth = 0;
  for (let i = index.indexOf("{", start); i < index.length; i++) {
    if (index[i] === "{") depth++;
    else if (index[i] === "}" && --depth === 0) return index.slice(start, i + 1);
  }
  fail("unbalanced editor helper " + name);
}
{
  const classes = (...initial) => {
    const values = new Set(initial);
    return { contains: x => values.has(x), add: x => values.add(x), remove: x => values.delete(x) };
  };
  const a = { dataset: { ptype:"text" }, classList:classes() };
  const b = { dataset: { ptype:"text" }, classList:classes() };
  const graph = { nodes:[{id:"t1",type:"text"},{id:"img1",type:"image"}], links:[] };
  const g = { from:{node:"t1",port:"text"}, to:{node:"img1",port:"prompt"}, type:"text" };
  let portPresent = true, enabled = true, connects = 0;
  const ctx = {
    graph, multiSel:new Set(["t1","img1"]), tempWire:null, nodeGestPtrs:new Set(),
    window:{ __nextAction:{ disabled:false, hasPortPriors:()=>true, pickDualSelectBridge:q=>pickDualSelectBridge(tables,q) }, matchMedia:()=>({matches:true}) },
    byId:id=>graph.nodes.find(n=>n.id===id), geoOn:()=>enabled,
    document:{
      querySelector:sel=>sel.includes('data-dir="out"') ? a : (portPresent ? b : null),
      querySelectorAll:()=>[a,b],
    },
    redraw(){}, clearTimeout(){}, setTimeout(){return 1;},
    connect(fromNode,fromPort,toNode,toPort){ connects++; graph.links.push({from:{node:fromNode,port:fromPort},to:{node:toNode,port:toPort}}); return true; },
  };
  vm.createContext(ctx);
  vm.runInContext('var _dualBridgeGhost=null, _dualBridgeKey="", _dualBridgeTimer=0;\n' +
    ["wouldCycle","clearDualSelectBridgePorts","clearDualSelectBridge","dualSelectBridgePorts","applyDualSelectBridge","acceptDualSelectBridge","handleDualSelectBridgeKey"].map(editorFn).join("\n"),ctx);
  ctx.applyDualSelectBridge();
  toy("editor-reduced-motion-static-action",!!ctx._dualBridgeGhost,"static preview survives reduced motion");
  toy("editor-live-pair-valid",!!ctx.dualSelectBridgePorts(g),"ports match");
  ctx.multiSel.delete("img1");
  toy("editor-stale-selection-refused",!ctx.dualSelectBridgePorts(g),"one selected");
  ctx.multiSel.add("img1");
  b.classList.add("disabled");
  toy("editor-model-disabled-refused",!ctx.dualSelectBridgePorts(g),"disabled input");
  b.classList.remove("disabled"); b.dataset.ptype="image";
  toy("editor-model-type-change-refused",!ctx.dualSelectBridgePorts(g),"incompatible socket");
  b.dataset.ptype="text"; portPresent=false;
  toy("editor-removed-socket-refused",!ctx.dualSelectBridgePorts(g),"socket gone");
  portPresent=true;
  graph.links=[{from:{node:"third",port:"text"},to:{node:"img1",port:"prompt"}}];
  toy("editor-occupied-input-preserved",!ctx.dualSelectBridgePorts(g),"never replaces an existing wire");
  graph.links=[{from:{node:"img1",port:"image"},to:{node:"t1",port:"in"}}];
  toy("editor-cycle-refused",!ctx.dualSelectBridgePorts(g),"live DAG check");
  graph.links=[]; ctx.window.__nextAction.disabled=true;
  toy("editor-engine-off-refused",!ctx.dualSelectBridgePorts(g),"disabled hints");
  ctx.window.__nextAction.disabled=false; enabled=false;
  toy("editor-flags-off-refused",!ctx.dualSelectBridgePorts(g),"disabled editor mode");
  enabled=true;
  const event = target => ({ key:"Enter", target, preventDefault(){this.prevented=true;}, stopPropagation(){} });
  ctx._dualBridgeGhost=g;
  const typing=event({tagName:"TEXTAREA",classList:classes()});
  ctx.handleDualSelectBridgeKey(typing);
  toy("editor-typing-enter-untouched",!typing.prevented && connects===0,"no global Enter hijack");
  for(const gesture of ["wire", "node"]){
    const wire={x1:0,y1:0,x2:20,y2:30};
    if(gesture==="wire") ctx.tempWire=wire; else ctx.nodeGestPtrs.add(7);
    ctx._dualBridgeGhost=g; a.classList.add("na-dual-bridge-port"); b.classList.add("na-dual-bridge-port");
    ctx.applyDualSelectBridge();
    toy(`editor-${gesture}-gesture-clears-preview`,!ctx._dualBridgeGhost && !a.classList.contains("na-dual-bridge-port") && !b.classList.contains("na-dual-bridge-port"),"pending preview cannot reappear during pointer gesture");
    ctx._dualBridgeGhost=g;
    toy(`editor-${gesture}-gesture-refuses-acceptance`,!ctx.acceptDualSelectBridge() && connects===0 && graph.links.length===0 &&
      (gesture==="wire" ? ctx.tempWire===wire : ctx.nodeGestPtrs.has(7)),"gesture state survives stale action acceptance");
    ctx.tempWire=null; ctx.nodeGestPtrs.clear();
  }
  ctx._dualBridgeGhost=g;
  const accept=event({classList:classes("na-dual-bridge-hit")});
  ctx.handleDualSelectBridgeKey(accept);
  toy("editor-focused-enter-connects-once",accept.prevented && connects===1 && graph.links.length===1 && !ctx._dualBridgeGhost,"normal wire replaces preview");
  ctx.handleDualSelectBridgeKey(accept);
  toy("editor-repeat-cannot-connect-twice",connects===1,"one acceptance");
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
