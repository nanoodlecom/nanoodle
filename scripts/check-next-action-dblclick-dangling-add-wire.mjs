#!/usr/bin/env node
/**
 * Product · 40 — double-click dangling → add+wire toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "../vendor/next-action/port-suggest.mjs";
import {
  catalogCandidates,
  pickTopComplement,
  candidateSeats,
  seatOverlaps,
  pickFreeSeat,
  isPortDangling,
  pickDblclickDanglingAddWire,
  NODE_W,
  NODE_H,
  GAP,
} from "../vendor/next-action/dblclick-dangling-add-wire.mjs";
import { boxesFromGraph } from "../vendor/next-action/collision-nudge.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-dblclick-dangling-add-wire: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "dblclick-dangling-add-wire.mjs")), "missing dblclick-dangling-add-wire.mjs");
assert(existsSync(CORPUS), "missing port-suggest.json");

const tables = JSON.parse(readFileSync(CORPUS, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");
const helper = readFileSync(join(NA, "dblclick-dangling-add-wire.mjs"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  toy("gates-exported", MIN_PAIR >= 2 && MIN_LEAD > 1 && MIN_SHARE > 0, `pair=${MIN_PAIR} lead=${MIN_LEAD} share=${MIN_SHARE}`);
  toy("seat-sizes", NODE_W > 0 && NODE_H > 0 && GAP > 0, `W=${NODE_W} H=${NODE_H} gap=${GAP}`);
}

{
  const cands = catalogCandidates(tables, "out");
  toy("catalog-out-candidates", cands.length >= 3, `n=${cands.length}`);
  toy(
    "catalog-has-image-inputs",
    cands.some((c) => c.type === "image" && c.ports.includes("prompt")),
    "image.prompt"
  );
}

{
  // text.text out → image.prompt consumer
  const top = pickTopComplement(tables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
  });
  toy("text-out-picks", !!top, top ? `${top.type}.${top.port}` : "null");
  toy(
    "text-out-image-prompt",
    !!(top && top.type === "image" && top.port === "prompt"),
    top ? `${top.type}.${top.port} count=${top.count}` : "—"
  );
  toy("text-out-meets-gates", !!(top && top.count >= MIN_PAIR && top.share >= MIN_SHARE), top ? `share=${top.share.toFixed(3)}` : "—");
}

{
  // image.prompt in → text.text producer
  const top = pickTopComplement(tables, {
    dir: "in",
    srcType: "image",
    srcPort: "prompt",
  });
  toy("image-in-picks", !!top, top ? `${top.type}.${top.port}` : "null");
  toy(
    "image-in-text-producer",
    !!(top && top.type === "text" && top.port === "text"),
    top ? `${top.type}.${top.port}` : "—"
  );
}

{
  // Flat / weak → null
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
    "flat-complement-null",
    pickTopComplement(flat, { dir: "out", srcType: "text", srcPort: "text" }) === null,
    "flat"
  );

  const tie = {
    topTargets: {
      "text|text": { "image|prompt": 4, "llm|prompt": 4 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
    },
  };
  toy(
    "no-lead-complement-null",
    pickTopComplement(tie, { dir: "out", srcType: "text", srcPort: "text" }) === null,
    "tied"
  );

  toy(
    "null-tables-complement",
    pickTopComplement(null, { dir: "out", srcType: "text", srcPort: "text" }) === null,
    "null tables"
  );
}

{
  // Seat helpers
  const seats = candidateSeats({ x: 100, y: 200, w: 220, h: 160 });
  toy("three-candidate-seats", seats.length === 3, `n=${seats.length}`);
  toy("first-seat-right", seats[0]?.dir === "right" && seats[0].x > 100, seats[0] ? `${seats[0].dir}@${seats[0].x}` : "—");

  const leftFirst = candidateSeats({ x: 100, y: 200 }, { preferLeft: true });
  toy("prefer-left-first", leftFirst[0]?.dir === "left", leftFirst[0]?.dir || "—");

  const graph = {
    nodes: [
      { id: "t1", type: "text", x: 100, y: 200, w: 220, h: 160 },
      { id: "blocker", type: "llm", x: 100 + 220 + GAP, y: 200, w: 220, h: 160 },
    ],
  };
  const boxes = boxesFromGraph(graph);
  const rightSeat = seats[0];
  toy("right-overlaps-blocker", seatOverlaps(rightSeat, boxes.filter((b) => b.id !== "t1"), GAP) === true, "blocked");

  const free = pickFreeSeat(graph, { id: "t1", x: 100, y: 200, w: 220, h: 160 });
  toy(
    "free-seat-skips-blocker",
    !!(free && free.dir !== "right"),
    free ? `${free.dir}@${free.x},${free.y}` : "null"
  );

  const open = pickFreeSeat(
    { nodes: [{ id: "t1", type: "text", x: 100, y: 200, w: 220, h: 160 }] },
    { id: "t1", x: 100, y: 200, w: 220, h: 160 }
  );
  toy("open-right-seat", !!(open && open.dir === "right"), open ? `${open.dir}@${open.x}` : "null");
}

{
  // Full picker: dangling text out → image at free seat
  const graph = {
    nodes: [{ id: "t1", type: "text", x: 180, y: 240, w: 220, h: 160 }],
    links: [],
  };
  const pick = pickDblclickDanglingAddWire(tables, graph, {
    nodeId: "t1",
    port: "text",
    dir: "out",
  });
  toy("dblclick-text-picks", !!pick, pick ? `add ${pick.addType}.${pick.addPort} @${pick.x},${pick.y}` : "null");
  toy(
    "dblclick-adds-image-prompt",
    !!(pick && pick.addType === "image" && pick.addPort === "prompt"),
    pick ? `${pick.addType}.${pick.addPort}` : "—"
  );
  toy(
    "dblclick-seat-right",
    !!(pick && pick.seatDir === "right" && pick.x > 180),
    pick ? `${pick.seatDir} x=${pick.x}` : "—"
  );
  toy(
    "dblclick-source-echo",
    !!(pick && pick.source.nodeId === "t1" && pick.source.port === "text" && pick.source.dir === "out"),
    pick ? `${pick.source.nodeId}.${pick.source.port}` : "—"
  );
}

{
  // Dangling image input → text producer to the left
  const graph = {
    nodes: [{ id: "img1", type: "image", x: 500, y: 220, w: 220, h: 200 }],
    links: [],
  };
  const pick = pickDblclickDanglingAddWire(tables, graph, {
    nodeId: "img1",
    port: "prompt",
    dir: "in",
  });
  toy("dblclick-image-in-picks", !!pick, pick ? `add ${pick.addType}.${pick.addPort}` : "null");
  toy(
    "dblclick-image-in-text",
    !!(pick && pick.addType === "text" && pick.addPort === "text"),
    pick ? `${pick.addType}.${pick.addPort}` : "—"
  );
  toy(
    "dblclick-image-in-left-seat",
    !!(pick && pick.seatDir === "left" && pick.x < 500),
    pick ? `${pick.seatDir} x=${pick.x}` : "—"
  );
}

{
  // Already wired → not dangling → null
  const graph = {
    nodes: [
      { id: "t1", type: "text", x: 100, y: 200 },
      { id: "img1", type: "image", x: 400, y: 200 },
    ],
    links: [{ from: { node: "t1", port: "text" }, to: { node: "img1", port: "prompt" } }],
  };
  toy(
    "wired-out-null",
    pickDblclickDanglingAddWire(tables, graph, { nodeId: "t1", port: "text", dir: "out" }) === null,
    "wired out"
  );
  toy(
    "wired-in-null",
    pickDblclickDanglingAddWire(tables, graph, { nodeId: "img1", port: "prompt", dir: "in" }) === null,
    "wired in"
  );
  toy(
    "isPortDangling-false-when-wired",
    isPortDangling(tables, graph, "t1", "text", "out") === false,
    "not dangling"
  );
}

{
  // Multi-select quiet
  const graph = {
    nodes: [{ id: "t1", type: "text", x: 100, y: 200 }],
    links: [],
    selectedIds: ["t1", "x"],
  };
  toy(
    "multi-select-null",
    pickDblclickDanglingAddWire(tables, graph, { nodeId: "t1", port: "text", dir: "out" }) === null,
    "multi"
  );
}

{
  // No free seat (surrounded) → null
  const gW = NODE_W, gH = NODE_H, g = GAP;
  const ax = 400, ay = 300;
  const graph = {
    nodes: [
      { id: "t1", type: "text", x: ax, y: ay, w: gW, h: gH },
      { id: "r", type: "llm", x: ax + gW + g, y: ay, w: gW, h: gH },
      { id: "b", type: "llm", x: ax, y: ay + gH + g, w: gW, h: gH },
      { id: "l", type: "llm", x: ax - gW - g, y: ay, w: gW, h: gH },
    ],
    links: [],
  };
  toy(
    "no-free-seat-null",
    pickDblclickDanglingAddWire(tables, graph, { nodeId: "t1", port: "text", dir: "out" }) === null,
    "surrounded"
  );
}

{
  // Missing geometry / ids
  toy(
    "missing-xy-null",
    pickDblclickDanglingAddWire(tables, {
      nodes: [{ id: "t1", type: "text" }],
      links: [],
    }, { nodeId: "t1", port: "text", dir: "out" }) === null,
    "no xy"
  );
  toy(
    "missing-nodeId-null",
    pickDblclickDanglingAddWire(tables, {
      nodes: [{ id: "t1", type: "text", x: 0, y: 0 }],
      links: [],
    }, { port: "text", dir: "out" }) === null,
    "no nodeId"
  );
  toy(
    "unknown-node-null",
    pickDblclickDanglingAddWire(tables, {
      nodes: [{ id: "t1", type: "text", x: 0, y: 0 }],
      links: [],
    }, { nodeId: "nope", port: "text", dir: "out" }) === null,
    "unknown"
  );
  toy(
    "null-tables-picker",
    pickDblclickDanglingAddWire(null, {
      nodes: [{ id: "t1", type: "text", x: 0, y: 0 }],
      links: [],
    }, { nodeId: "t1", port: "text", dir: "out" }) === null,
    "null tables"
  );
}

{
  toy("helper-exports-pick", /export function pickDblclickDanglingAddWire/.test(helper), "pick");
  toy("helper-exports-complement", /export function pickTopComplement/.test(helper), "complement");
  toy("helper-exports-seat", /export function pickFreeSeat/.test(helper), "seat");
  toy("helper-uses-rankDropTypes", /rankDropTypes/.test(helper), "rankDropTypes");
  toy("helper-uses-danglingPorts", /danglingPorts/.test(helper), "danglingPorts");
  toy("helper-uses-gates", /MIN_PAIR/.test(helper) && /MIN_LEAD/.test(helper) && /MIN_SHARE/.test(helper), "gates");
  toy("helper-uses-collision", /boxesFromGraph/.test(helper) && /overlapDepth/.test(helper), "collision-nudge");
}

// Exercise the real handler and structural mutation/history functions. A
// candidate's baked socket name may disappear or be disabled by its model.
{
  const cut = (start, end)=>{
    const a = index.indexOf(start), b = index.indexOf(end, a);
    assert(a >= 0 && b > a, `missing editor function ${start}`);
    return index.slice(a, b);
  };
  const source = [
    cut("function addNode(type, x, y, fields){", "\n// A node's output ports"),
    cut("function connect(fromNode, fromPort, toNode, toPort){", "\n/* ======================================================================\n   QUICK ADD"),
    cut("function removeNode(id){", "\nfunction updateDelBtn()"),
    cut("function pushUndo(boundary){", "\nfunction _restore("),
    cut("function _restore(from, to){", "\nfunction syncUndoBtn()"),
    cut("let _dblclickAddWireCueTimer", "function dblclickDanglingAddWireCandidate("),
    cut("function dblclickDanglingAddWireCandidate(portEl){", '\nimport("./vendor/next-action/dblclick-dangling-add-wire.mjs")'),
    cut("// Delegation includes newly-grown sockets", "\n/* Next-action scores"),
  ].join("\n");
  function attempt(options = {}) {
    const dir = options.dir || "out", opp = dir === "out" ? "in" : "out";
    const port = (node, name, pd, ptype = "text", disabled = false)=>{
      const attrs = new Map(), classes = new Set(disabled ? ["disabled"] : []);
      const p = {
        dataset: { node, port: name, dir: pd, ptype }, children: [], isConnected:true,
        classList: { contains(value) { return classes.has(value); }, add(value) { classes.add(value); }, remove(value) { classes.delete(value); } },
        getAttribute(key) { return attrs.has(key) ? attrs.get(key) : null; },
        setAttribute(key, value) { attrs.set(key, value); }, removeAttribute(key) { attrs.delete(key); },
        appendChild(child) { p.children.push(child); child.parentElement=p; },
        contains(child) { return child===p || p.children.includes(child); },
        closest(sel) { return sel===".port" ? p : null; }, matches(sel) { return sel===".port"; },
      };
      return p;
    };
    const origin = port("n1", "prompt", dir);
    let removed = 0, remembered = 0, pulses = 0, connects = 0;
    const element = ports=>({
      style: {},
      querySelectorAll(sel) { return ports.filter(p=> sel.includes(`data-dir="${p.dataset.dir}"`)); },
      remove() { removed++; },
    });
    const initial = { id: "n1", type: "image", x: 0, y: 0, el: element([origin]) };
    const undoBefore = [{ s: "previous" }], redoBefore = [{ s: "future" }];
    const timers = new Map(), editorListeners = new Map(), windowListeners = new Map();
    let timerId = 0;
    if(options.fullHistory) while(undoBefore.length < 25) undoBefore.push({ s: `step ${undoBefore.length}` });
    const context = {
      graph: { nodes: [initial], links: [] }, nid: 2, lid: 1,
      undoStack: undoBefore.slice(), redoStack: redoBefore.slice(), undoMuted: false, UNDO_DEPTH: 25,
      selected: initial, multiSel: new Set(),
      runningNodes:new Set(), flash() {},
      NODE_TYPES: { image: {title:"Image"}, llm: {title:"LLM"} },
      tempWire:null, nodeGestPtrs:new Set(),
      geoOn() { return !options.engineOff; }, dblclickAddWireReducedMotion() { return !!options.reducedMotion; },
      t(key) { return options.french ? key.replace("Add", "Ajouter") : key; },
      setTimeout(fn, ms) { timers.set(++timerId, {fn,ms}); return timerId; }, clearTimeout(id) { timers.delete(id); },
      document: { createElement() {
        return { events:new Map(), setAttribute() {},
          addEventListener(name, fn) { this.events.set(name,fn); },
          closest(sel) { return sel===".na-dblclick-add-wire-add" ? this : sel===".port" ? this.parentElement : null; },
          remove() { const p=this.parentElement; if(p) p.children=p.children.filter(child=>child!==this); },
        };
      } },
      editor: { addEventListener(name,fn) { editorListeners.set(name,fn); } },
      abortWireDragForDblclick() {},
      quickAddCandidates() { return [["llm", {}]]; }, socketsForDrop() { return ["prompt"]; },
      byId(id) { return context.graph.nodes.find(n=> n.id === id); },
      serializeGraph() { return {
        nodes: context.graph.nodes.map(n=>({ id: n.id, type: n.type, x: n.x, y: n.y })),
        links: context.graph.links,
      }; },
      _snap() { return JSON.stringify(context.serializeGraph()); },
      applyGraphData(data) {
        context.graph.nodes=data.nodes.map(n=>({ ...n, el:element([]) }));
        context.graph.links=data.links;
      },
      syncUndoBtn() {}, _stashResults() {}, save() {}, redraw() {}, updateDelBtn() {},
      refreshImageInputs() {}, refreshVideoInputs() {}, refreshPortFills() {},
      recompactImageLinks() {}, recompactVideoLinks() {},
      IMG_PORT_RE: /^img\d+$/, EDIT_IMG_RE: /^image\d*$/, VID_PORT_RE: /^clip\d+$/,
      wouldCycle() { return !!options.cycle; },
      buildNodeEl(n) {
        const ports = options.missing ? [] : [port(n.id, "prompt", opp, options.mismatched ? "image" : "text", options.disabled)];
        if(options.fallback) ports.push(port(n.id, "other", opp));
        n.el = element(ports);
        if(options.partialAddThrows) throw new Error("render failed after insertion");
      },
      ensureModelForInput(n) { if(options.upgrade) n.el = element([port(n.id, "prompt", opp)]); },
      separateOnAdd() {}, rememberAdd() { remembered++; },
      select() {}, dismissConnectHint() {}, pulseDblclickAddWirePorts() { pulses++; },
      window: { addEventListener(name,fn) { windowListeners.set(name,fn); }, __nextAction: {
        hasPortPriors() { return true; },
        pickDblclickDanglingAddWire() { return { addType: "llm", addPort: "prompt", x: 240, y: 0 }; },
      } },
    };
    runInNewContext(source, context);
    const originalConnect = context.connect;
    context.connect = (...args)=>{
      connects++;
      if(options.connectRefused) return false;
      const ok = originalConnect(...args);
      if(options.connectThrows) throw new Error("paint failed after linking");
      return ok;
    };
    const before = JSON.stringify(context.serializeGraph());
    const accepted = options.noAction ? false : context.tryDblclickDanglingAddWire(origin);
    return { context, accepted, connects, removed, remembered, pulses, before, undoBefore, redoBefore, origin, timers, editorListeners, windowListeners };
  }
  for(const dir of ["out", "in"]) {
    const good = attempt({ dir });
    const link = good.context.graph.links[0];
    toy(`live-${dir}-connects-once`, good.accepted && good.connects === 1 && link &&
      link.from.node === (dir === "out" ? "n1" : "n2") && link.to.node === (dir === "out" ? "n2" : "n1"), "matching live socket");
    for(const option of ["missing", "disabled", "mismatched"]) {
      const failed = attempt({ dir, [option]: true, fullHistory: true });
      toy(`live-${dir}-${option}-no-edge`, !failed.accepted && failed.connects === 0, "invalid socket never connects");
      toy(`live-${dir}-${option}-no-orphan`, JSON.stringify(failed.context.serializeGraph()) === failed.before &&
        failed.removed === 1 && failed.remembered === 0 && failed.pulses === 0, "provisional node removed");
      toy(`live-${dir}-${option}-history-restored`, JSON.stringify(failed.context.undoStack) === JSON.stringify(failed.undoBefore) &&
        JSON.stringify(failed.context.redoStack) === JSON.stringify(failed.redoBefore) &&
        failed.context.nid === 2 && failed.context.lid === 1 && !failed.context.undoMuted, "full undo/redo and identifiers preserved");
    }
    const fallback = attempt({ dir, disabled: true, fallback: true });
    toy(`live-${dir}-fallback-connects`, fallback.accepted && fallback.connects === 1 &&
      fallback.context.graph.links[0][dir === "out" ? "to" : "from"].port === "other", "enabled matching fallback");
  }
  const upgraded = attempt({ disabled: true, upgrade: true });
  toy("live-model-upgrade-rereads-socket", upgraded.accepted && upgraded.connects === 1, "post-upgrade live socket");
  for(const option of ["cycle", "connectRefused", "connectThrows", "partialAddThrows"]) {
    const failed = attempt({ [option]: true });
    toy(`live-${option}-rolls-back`, !failed.accepted && JSON.stringify(failed.context.serializeGraph()) === failed.before &&
      JSON.stringify(failed.context.undoStack) === JSON.stringify(failed.undoBefore) &&
      JSON.stringify(failed.context.redoStack) === JSON.stringify(failed.redoBefore), "failed add/wire preserves canvas and history");
  }
  const good = attempt();
  const undoOnce = JSON.parse(good.context.undoStack.at(-1).s);
  toy("live-success-is-one-undo-step", undoOnce.nodes.length === 1 && undoOnce.links.length === 0 &&
    good.context.undoStack.length === good.undoBefore.length + 1, "add, model upgrade and wire share the pre-add snapshot");
  const afterSuccess=JSON.stringify(good.context.serializeGraph());
  good.context._restore(good.context.undoStack, good.context.redoStack);
  toy("undo-removes-node-and-wire", JSON.stringify(good.context.serializeGraph())===good.before, "one undo restores original graph");
  good.context._restore(good.context.redoStack, good.context.undoStack);
  toy("redo-restores-node-and-wire", JSON.stringify(good.context.serializeGraph())===afterSuccess, "one redo restores entire action");
  const hover = attempt({ noAction:true, french:true });
  const hoverBefore = JSON.stringify(hover.context.serializeGraph());
  hover.origin.setAttribute("title", "original port title");
  hover.context.showDblclickPortCue(hover.origin);
  const button = hover.origin.children[0];
  toy("hover-offers-actual-node", button && button.title === "Ajouter LLM" && hover.origin.classList.contains("na-dblclick-add-wire-ready"), "small localized predicted-node button");
  toy("hover-does-not-mutate-graph-or-history", JSON.stringify(hover.context.serializeGraph())===hoverBefore &&
    JSON.stringify(hover.context.undoStack)===JSON.stringify(hover.undoBefore), "read-only affordance");
  toy("native-tooltip-is-delayed", hover.origin.getAttribute("title")==="original port title", "original title retained until delay");
  const timer = [...hover.timers.values()].find(timer=>timer.ms===350); timer.fn();
  toy("native-tooltip-names-predicted-node", hover.origin.getAttribute("title").includes("Ajouter LLM"), "actual chosen type after delay");
  hover.editorListeners.get("pointerout")({ relatedTarget:button });
  toy("pointer-can-reach-plus", hover.origin.children.length===1, "entering adjacent child button keeps cue");
  button.events.get("click")({ preventDefault(){}, stopPropagation(){} });
  toy("plus-click-adds-and-wires-once", hover.context.graph.nodes.length===2 && hover.context.graph.links.length===1 && hover.origin.children.length===0, "single explicit button action");
  toy("cue-restores-original-title", hover.origin.getAttribute("title")==="original port title", "no stale action tooltip");
  for(const key of ["Enter", " "]){
    const focused = attempt({ noAction:true, reducedMotion:true });
    focused.editorListeners.get("focusin")({ target:focused.origin });
    toy(`focus-${key}-does-not-add`, focused.origin.children.length===1 && focused.context.graph.nodes.length===1, "focus only offers action");
    focused.context.dblclickAddWireKey({ key, target:focused.origin, preventDefault(){}, stopPropagation(){} });
    toy(`key-${key}-adds-in-reduced-motion`, focused.context.graph.nodes.length===2 && focused.context.graph.links.length===1, "keyboard action keeps semantics");
  }
  const quiet = attempt({ noAction:true, engineOff:true });
  toy("disabled-feature-has-no-cue", !quiet.context.showDblclickPortCue(quiet.origin) && quiet.origin.children.length===0, "disable flags respected");
  for(const moved of [false, true]){
    const touch = attempt({ noAction:true });
    touch.editorListeners.get("pointerdown")({ target:touch.origin, pointerType:"touch", pointerId:7, clientX:10, clientY:10 });
    if(moved) touch.windowListeners.get("pointermove")({ pointerId:7, clientX:30, clientY:10 });
    touch.windowListeners.get("pointerup")({ pointerId:7, clientX:10, clientY:10 });
    for(const timer of [...touch.timers.values()]) if(timer.ms===0) timer.fn();
    toy(`touch-${moved ? "drag" : "tap"}-cue`, touch.origin.children.length===(moved ? 0 : 1) && touch.context.graph.nodes.length===1, "tap offers button; drag does not");
    if(!moved){
      const button = touch.origin.children[0];
      touch.editorListeners.get("pointerdown")({ target:button, pointerType:"touch", pointerId:8, clientX:20, clientY:10 });
      touch.editorListeners.get("pointerout")({ target:button, pointerType:"touch", relatedTarget:null });
      toy("touch-lift-retains-plus-until-click", touch.origin.children[0]===button && touch.context.graph.nodes.length===1, "native touch exit precedes its synthesized click");
      button.events.get("click")({ preventDefault(){}, stopPropagation(){} });
      toy("touch-plus-click-adds-and-wires", touch.context.graph.nodes.length===2 && touch.context.graph.links.length===1, "retained action receives the explicit click");
    }
  }
}

// Editor wiring pins
{
  toy("html-has-port-pulse-css", /\.port\.na-dblclick-add-wire-port\s*\{/.test(index), ".na-dblclick-add-wire-port");
  toy("html-has-keyframes", /@keyframes\s+naDblclickAddWirePulse/.test(index), "keyframes");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,280}na-dblclick-add-wire/.test(index) ||
      /na-dblclick-add-wire[\s\S]{0,280}prefers-reduced-motion/.test(index) ||
      /dblclickAddWireReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-tryDblclick", index.includes("tryDblclickDanglingAddWire"), "try fn");
  toy("html-pulse-fn", index.includes("pulseDblclickAddWirePorts"), "pulse fn");
  toy("html-clear-fn", index.includes("clearDblclickAddWirePulse"), "clear fn");
  toy("html-pick-call", /pickDblclickDanglingAddWire\s*\(/.test(index), "call site");
  toy("html-import", /dblclick-dangling-add-wire\.mjs/.test(index), "import");
  toy(
    "html-port-dblclick-hook",
    /dblclick[\s\S]{0,200}tryDblclickDanglingAddWire|tryDblclickDanglingAddWire[\s\S]{0,200}dblclick|addEventListener\(\s*["']dblclick["']/.test(index) &&
      /onPortDblclick|portDblclick|tryDblclickDanglingAddWire/.test(index),
    "port dblclick"
  );
  toy(
    "html-abort-wire-drag",
    /tempWire\s*=\s*null/.test(index) && /tryDblclickDanglingAddWire/.test(index),
    "clear tempWire"
  );
  toy(
    "html-multi-quiet",
    /multiSel\.size\s*>=\s*2/.test(index) && /tryDblclickDanglingAddWire/.test(index),
    "multi quiet"
  );
  toy(
    "html-geoOn-gate",
    /function dblclickDanglingAddWireCandidate[\s\S]{0,500}geoOn/.test(index),
    "geoOn"
  );
  toy(
    "html-connect-call",
    /function tryDblclickDanglingAddWire[\s\S]{0,6000}connect\(/.test(index),
    "connect()"
  );
  toy(
    "html-addNode-call",
    /function tryDblclickDanglingAddWire[\s\S]{0,6000}addNode\(/.test(index),
    "addNode()"
  );
  toy(
    "surface-exports-pick",
    /pickDblclickDanglingAddWire\(query\)/.test(surface) &&
      /from "\.\/dblclick-dangling-add-wire\.mjs"/.test(surface),
    "editor-surface"
  );
  toy(
    "readme-mentions-40",
    /·\s*40|Product · 40|dblclick-dangling-add-wire/.test(readme),
    "README · 40"
  );
  toy(
    "readme-check-script",
    readme.includes("check-next-action-dblclick-dangling-add-wire.mjs"),
    "README check"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?40/.test(index) && !/\?product=40/.test(index),
    "no ?product=40"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-40-usage.gif")),
    "product-40-usage.gif"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\ndblclick-dangling-add-wire toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  const hard = failed.filter((f) => f.name !== "usage-gif-present");
  if (hard.length) fail(hard.map((f) => f.name).join(", "));
  console.warn("⚠ usage gif missing — capture next");
  process.exit(2);
}
console.log("✓ next-action-dblclick-dangling-add-wire");
