#!/usr/bin/env node
// Behavioural test for the editor's undo/redo snapshot machine in index.html —
// the safety net that makes destructive edits (a shared #g=/#j= link overwriting
// your canvas, a 📂 Load file, a describe-apply, delete/drag) reversible. The
// toolbar literally promises "↺ Undo restores your previous workflow"; if this
// regresses, that promise silently lies (a stranger's link wipes your graph with
// no way back).
//
// No browser, no network, no inference. We lift the REAL shipped functions out of
// index.html as text — serializeGraph, applyGraphData (+ stripInjectedMedia), the
// whole undo block (pushUndo/_snap/_restore/syncUndoBtn/undo/redo), b64urlToBytes,
// loadFile, loadFromHash — and run them in a node:vm sandbox against DOM stubs
// (same technique as check-editor-ports: buildNodeEl/redraw/etc. are no-ops; only
// the graph-state bookkeeping serializeGraph actually reads is real).
//
// Invariants pinned:
//   1. ROUND-TRIP  mutate → pushUndo → mutate → undo() restores the prior graph
//      content EXACTLY (nodes/links/positions/view); redo() reapplies the edit.
//      (nid/lid counters drift monotonically UP by design — see FINDINGS — so we
//      compare graph content and assert the counters never move backward.)
//   2. FORK        a fresh pushUndo after an undo clears redoStack (no stale redo).
//   3. MUTE        while _restore runs (undoMuted), pushUndo is suppressed — a
//      restore never pollutes the stack with intermediate snapshots.
//   4. DEPTH       pushing past UNDO_DEPTH drops the OLDEST, order intact.
//   5. PARK        loadFromHash(#g=/#j=/#ga=) parks the previously-stored graph so
//      one undo() after opening a stranger's link brings YOUR workflow back; and
//      loadFile() parks the live canvas before replacing it.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "index.html"), "utf8");

const failures = [];
const fail = (m) => failures.push(m);
const ok = (c, m) => { if (!c) fail(m); };

// ---- JS-string/comment/template-aware brace matcher (from check-share-link) ---
function matchBrace(src, openIdx) {
  let depth = 0;
  const tmpl = [];
  let mode = "code";
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i++; }
      else if (c === "/" && n === "*") { mode = "block"; i++; }
      else if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (tmpl.length && depth === tmpl[tmpl.length - 1]) { tmpl.pop(); mode = "tpl"; }
        else if (depth === 0) return i;
      }
    } else if (mode === "line") { if (c === "\n") mode = "code"; }
    else if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i++; } }
    else if (mode === "sq") { if (c === "\\") i++; else if (c === "'") mode = "code"; }
    else if (mode === "dq") { if (c === "\\") i++; else if (c === '"') mode = "code"; }
    else if (mode === "tpl") {
      if (c === "\\") i++;
      else if (c === "`") mode = "code";
      else if (c === "$" && n === "{") { mode = "code"; tmpl.push(depth); depth++; i++; }
    }
  }
  throw new Error("unbalanced braces from index " + openIdx);
}
// pull `[async] function <name>(...) { ... }` out as text (keeps a leading `async`)
function extractFunction(src, name) {
  const sig = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}()`);
  const open = src.indexOf("{", m.index + m[0].length - 1);
  const close = matchBrace(src, open);
  return src.slice(m.index, close + 1);
}
// pull a contiguous span of shipped source between two exact anchor lines (inclusive)
function sliceBetween(src, startAnchor, endAnchor) {
  const s = src.indexOf(startAnchor);
  if (s === -1) throw new Error("start anchor not found: " + startAnchor);
  const e = src.indexOf(endAnchor, s);
  if (e === -1) throw new Error("end anchor not found: " + endAnchor);
  return src.slice(s, e + endAnchor.length);
}
function grabLine(src, re, what) {
  const m = src.match(re);
  if (!m) throw new Error("could not find " + what);
  return m[0];
}

// ---- lift the real pieces ---------------------------------------------------
let PIECES;
try {
  PIECES = {
    UPLOAD_FIELD: grabLine(SRC, /const UPLOAD_FIELD = \{[^}]*\};/, "UPLOAD_FIELD"),
    SAFE_MEDIA_RE: grabLine(SRC, /const SAFE_MEDIA_RE = \/[^\n]*;/, "SAFE_MEDIA_RE"),
    serializeGraph: extractFunction(SRC, "serializeGraph"),
    stripInjectedMedia: extractFunction(SRC, "stripInjectedMedia"),
    applyGraphData: extractFunction(SRC, "applyGraphData"),
    b64urlToBytes: extractFunction(SRC, "b64urlToBytes"),
    loadFile: extractFunction(SRC, "loadFile"),
    loadFromHash: extractFunction(SRC, "loadFromHash"),
    // the whole undo machine, verbatim, as one span
    undoBlock: sliceBetween(
      SRC,
      "const undoStack = [], redoStack = [];",
      "const redo = ()=> { _restore(redoStack, undoStack); syncUndoBtn(); };"
    ),
  };
} catch (e) {
  process.stderr.write("✗ undo-history harness could not lift the shipped code:\n\n- " + e.message + "\n");
  process.exit(1);
}

// ---- stubs: everything applyGraphData/loadFile/loadFromHash touch besides ----
//      the graph bookkeeping serializeGraph actually reads.
const prelude = `
  var panX = 0, panY = 0, scale = 1, selected = null, nid = 1, lid = 1;
  var graph = { nodes: [], links: [] };
  var world = { innerHTML: "" };
  var NODE_TYPES = { text:1, llm:1, image:1, edit:1, tts:1, music:1, upload:1 };
  var buildHookPushes = false;                    // MUTE test: make buildNodeEl attempt a pushUndo
  function buildNodeEl(n){ if(buildHookPushes) pushUndo(); }
  var runningNodes = new Set();                     // run-guard: undo/redo refuse while any node is executing
  function showResult(){}                           // applyGraphData repaints carried-over n.out through this (DOM no-op here)
  function setStatus(){}
  function redraw(){}
  function refreshPortFills(){}
  function refreshAllPrices(){}
  function recompactImageLinks(){}
  function refreshImageInputs(){}
  function recompactVideoLinks(){}
  function refreshVideoInputs(){}
  function applyWorld(){}
  function save(){}
  function setPendingApp(){}
  function toast(){}
  function flash(){}
  function alert(){}
  function t(s){ return s; }
  function byId(id){ return graph.nodes.find(n=>n.id===id); }
  var __ub = {};
  function $(id){ return (__ub[id] || (__ub[id] = { disabled:false })); }
  var __ls = new Map();
  var localStorage = {
    getItem: k => (__ls.has(k) ? __ls.get(k) : null),
    setItem: (k,v) => __ls.set(k, String(v)),
    removeItem: k => __ls.delete(k),
  };
  var window = { resetDescribeVersions: function(){} };
  var history = { replaceState: function(){} };
  var location = { hash: "", pathname: "/", search: "" };
  class FileReader { readAsText(file){ this.result = file && file.__text; if(this.onload) this.onload(); } }
`;

// ---- the control surface node drives (all lexical/global in one script scope)
const surface = `
  globalThis.__t = {
    depth: UNDO_DEPTH,
    pushUndo, undo, redo, applyGraphData, loadFile, loadFromHash,
    snap: () => JSON.parse(JSON.stringify(serializeGraph())),
    stacks: () => ({ undo: undoStack.slice(), redo: redoStack.slice() }),
    counters: () => ({ nid, lid }),
    reset: () => { undoStack.length = 0; redoStack.length = 0; },
    setStored: (s) => { if(s == null) __ls.delete("noodle_graph"); else __ls.set("noodle_graph", s); },
    setHash: (h) => { location.hash = h; },
    setBuildHook: (on) => { buildHookPushes = !!on; },
    setNodeX: (id, x) => { const n = byId(id); if(n) n.x = x; },
    addNode: (node) => { graph.nodes.push(node); const num = s=>parseInt(String(s).replace(/\\D/g,''),10)||0; nid = Math.max(nid, num(node.id)+1); },
    addLink: (l) => { graph.links.push(l); },
    setRunning: (ids) => { runningNodes.clear(); (ids||[]).forEach(id=>runningNodes.add(id)); },
    setOut: (id, out, sig) => { const n = byId(id); if(n){ n.out = out; if(sig!=null) n._sig = sig; } },
    outOf: (id) => { const n = byId(id); return n && n.out; },
    sigOf: (id) => { const n = byId(id); return n && n._sig; },
  };
`;

const bundle = [
  prelude,
  PIECES.UPLOAD_FIELD, PIECES.SAFE_MEDIA_RE,
  PIECES.serializeGraph, PIECES.stripInjectedMedia, PIECES.applyGraphData,
  PIECES.b64urlToBytes,
  PIECES.undoBlock,
  PIECES.loadFile, PIECES.loadFromHash,
  surface,
].join("\n");

const ctx = { console, atob, TextDecoder };
vm.createContext(ctx);
try {
  new vm.Script(bundle, { filename: "index.html#undo-history" }).runInContext(ctx);
} catch (e) {
  process.stderr.write("✗ undo-history sandbox failed to build: " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
}
const T = ctx.__t;

// ---- helpers ----------------------------------------------------------------
// a legit uploaded photo: a data: URL (as FileReader/canvas.toDataURL always produce
// locally). It survives stripInjectedMedia (SAFE_MEDIA_RE) and MUST survive a park —
// blanking it, the way a share-out re-serialize would, is exactly the "your photo is
// gone after ↺ Undo" regression this check exists to catch. Kept distinctive so a
// blanked or dropped value is impossible to miss.
const PHOTO = "data:image/png;base64,QQBBUEhPVE9fTVVTVF9TVVJWSVZF";
const SPEC = () => ({
  v: 1,
  nodes: [
    { id: "n1", type: "text", x: 10, y: 20, fields: { text: "hello" } },
    { id: "n2", type: "llm", x: 100, y: 40, fields: { prompt: "p" } },
    { id: "u1", type: "upload", x: 200, y: 60, fields: { image: PHOTO } },
  ],
  links: [{ id: "l1", from: { node: "n1", port: "text" }, to: { node: "n2", port: "prompt" } }],
  nid: "3", lid: "2", view: { panX: 5, panY: 6, scale: 1.5 },
});
// the field value of the uploaded photo currently on the canvas (asserting on the value,
// not just node presence, is what pins "the photo survived" vs "an empty upload node did")
const photoOf = (snap) => { const n = (snap.nodes || []).find((x) => x.id === "u1"); return n && n.fields && n.fields.image; };
// graph content minus the monotonic id counters (which drift up by design)
const content = (snap) => { const c = JSON.parse(JSON.stringify(snap)); delete c.nid; delete c.lid; return JSON.stringify(c); };
const b64url = (obj) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64");

// =============================================================================
// 1. ROUND-TRIP  (+ redo reapplies)
// =============================================================================
T.reset();
T.applyGraphData(SPEC());
const before = T.snap();
const beforeCtr = T.counters();
T.pushUndo();
ok(T.stacks().undo.length === 1, "ROUND-TRIP: pushUndo should record exactly one snapshot");
// a real structural edit: add a node + wire, move an existing node
T.addNode({ id: "n7", type: "image", x: 300, y: 88, fields: {} });
T.addLink({ id: "l5", from: { node: "n2", port: "text" }, to: { node: "n7", port: "prompt" } });
T.setNodeX("n1", 777);
const editSnap = T.snap();
ok(content(editSnap) !== content(before), "ROUND-TRIP precondition: the edit must change the serialized graph");
T.undo();
const afterUndo = T.snap();
ok(content(afterUndo) === content(before),
  "ROUND-TRIP: after undo the graph content must match the pre-edit snapshot exactly");
ok(photoOf(afterUndo) === PHOTO,
  "ROUND-TRIP: the uploaded photo (data: URL) must come back intact after undo, not blanked");
const afterCtr = T.counters();
ok(afterCtr.nid >= beforeCtr.nid && afterCtr.lid >= beforeCtr.lid,
  "ROUND-TRIP: id counters must never move backward across a restore");
ok(T.stacks().undo.length === 0 && T.stacks().redo.length === 1,
  "ROUND-TRIP: undo pops the undo stack and parks the undone state for redo");
T.redo();
ok(content(T.snap()) === content(editSnap),
  "ROUND-TRIP: redo must reapply the edit exactly");
ok(T.stacks().undo.length === 1, "ROUND-TRIP: redo returns the snapshot to the undo stack");

// =============================================================================
// 2. FORK  — a fresh edit after undo drops the orphaned redo future
// =============================================================================
T.reset();
T.applyGraphData(SPEC());
T.pushUndo();
T.setNodeX("n1", 111);
T.undo();
ok(T.stacks().redo.length === 1, "FORK precondition: an undo should leave a redo entry");
T.setNodeX("n1", 222);
T.pushUndo();                                  // a new edit forks history
ok(T.stacks().redo.length === 0, "FORK: a fresh pushUndo after undo must clear the redo stack");
ok(T.stacks().undo.length === 1, "FORK: the fresh pushUndo still records its own snapshot");

// =============================================================================
// 3. MUTE  — pushUndo is suppressed while _restore rebuilds the graph
// =============================================================================
T.reset();
T.applyGraphData(SPEC());          // n1,n2 → any restore rebuilds 2 nodes
T.pushUndo();                      // undoStack = [S0]
T.setNodeX("n1", 999);
T.setBuildHook(true);              // now every buildNodeEl() during apply attempts pushUndo()
T.undo();                          // _restore → applyGraphData → buildNodeEl ×2 → pushUndo (muted)
T.setBuildHook(false);
ok(T.stacks().undo.length === 0,
  "MUTE: a restore must not push intermediate snapshots onto the undo stack (undoMuted broke)");
ok(T.stacks().redo.length === 1,
  "MUTE: the restore's redo entry must survive (an un-muted pushUndo would wipe it)");

// =============================================================================
// 4. DEPTH  — past UNDO_DEPTH drop the oldest, order intact, no corruption
// =============================================================================
T.reset();
T.applyGraphData({ v: 1, nodes: [{ id: "n1", type: "text", x: 0, y: 0, fields: {} }], links: [], nid: "2", lid: "1", view: {} });
const N = T.depth + 5;
for (let i = 1; i <= N; i++) { T.setNodeX("n1", i); T.pushUndo(); }
const stack = T.stacks().undo;
ok(stack.length === T.depth, `DEPTH: the undo stack must cap at UNDO_DEPTH (${T.depth}), got ${stack.length}`);
const xs = stack.map((s) => JSON.parse(s).nodes[0].x);
const expected = Array.from({ length: T.depth }, (_, k) => k + 1 + (N - T.depth)); // oldest (N-depth) dropped
ok(JSON.stringify(xs) === JSON.stringify(expected),
  `DEPTH: overflow must drop the OLDEST snapshots and keep order (expected x=${expected[0]}..${expected[expected.length-1]}, got ${xs[0]}..${xs[xs.length-1]})`);

// =============================================================================
// 5a. PARK — loadFromHash(#j=) parks the previously-stored graph
// =============================================================================
const prevGraph = { v: 1, nodes: [{ id: "p1", type: "text", x: 1, y: 2, fields: { text: "MY OWN WORK" } }, { id: "u1", type: "upload", x: 3, y: 4, fields: { image: PHOTO } }], links: [], nid: "3", lid: "1", view: {} };
const strangerGraph = { v: 1, nodes: [{ id: "s1", type: "image", x: 9, y: 9, fields: {} }], links: [], nid: "2", lid: "1", view: {} };
const prevStored = JSON.stringify(prevGraph);
T.reset();
T.applyGraphData({ nodes: [], links: [] });        // boot state: canvas empty (as at page load)
T.setStored(prevStored);                            // the noodle this browser already has
T.setHash("#j=" + b64url(strangerGraph));           // the shared link being opened
const applied = await T.loadFromHash();
ok(applied === true, "PARK/#j=: opening a valid shared link must apply it");
ok(T.snap().nodes.some((n) => n.id === "s1"), "PARK/#j=: the stranger's graph must be on the canvas after open");
const parked = T.stacks().undo;
ok(parked.length === 1 && parked[0] === prevStored,
  "PARK/#j=: the previously-stored graph must be parked verbatim into the undo stack before overwrite");
T.undo();
ok(T.snap().nodes.some((n) => n.id === "p1"),
  "PARK/#j=: one undo after opening a stranger's link must restore YOUR previous workflow");
ok(photoOf(T.snap()) === PHOTO,
  "PARK/#j=: your uploaded photo must survive the park — a stranger's link must not silently blank it on the way back");

// 5b. PARK — no stored graph → nothing to park (never snapshot an empty canvas)
T.reset();
T.applyGraphData({ nodes: [], links: [] });
T.setStored(null);
T.setHash("#j=" + b64url(strangerGraph));
await T.loadFromHash();
ok(T.stacks().undo.length === 0, "PARK/#j=: with nothing stored, no empty snapshot is parked");

// 5c. PARK — loadFile() parks the live canvas before replacing it
T.reset();
T.applyGraphData(SPEC());                           // a real workflow is open
const liveBefore = T.snap();
T.loadFile({ __text: JSON.stringify(strangerGraph) });
ok(T.snap().nodes.some((n) => n.id === "s1"), "PARK/file: loading a file must replace the canvas");
ok(T.stacks().undo.length === 1, "PARK/file: loading a file over a non-empty canvas must park the prior workflow");
T.undo();
ok(content(T.snap()) === content(liveBefore), "PARK/file: undo after a file load must restore the prior workflow");
ok(photoOf(T.snap()) === PHOTO,
  "PARK/file: the uploaded photo on the parked canvas must survive a file-load undo, not be blanked");

// 5d. PARK — loadFile() over an EMPTY canvas parks nothing
T.reset();
T.applyGraphData({ nodes: [], links: [] });
T.loadFile({ __text: JSON.stringify(strangerGraph) });
ok(T.stacks().undo.length === 0, "PARK/file: loading a file over an empty canvas must not park an empty snapshot");

// =============================================================================
// 6. RESULT CARRY-OVER — an undo/redo (or any applyGraphData) must NOT wipe a
//    node's generated output + seed-skip signature. serializeGraph never persists
//    n.out/n._sig, so without the carry-over an undo would force a paid re-run of
//    every result — the P1 money bug this fix closes.
// =============================================================================
T.reset();
T.setRunning([]);
T.applyGraphData(SPEC());
T.setOut("n2", { text: "EXPENSIVE_LLM_OUTPUT" }, "sig-n2");   // n2 has a paid result + its skip signature
T.pushUndo();
T.setNodeX("n1", 999);                                        // a trivial layout edit
T.undo();                                                     // ↺ Undo — must bring back the graph WITHOUT dropping n2's output
ok(T.outOf("n2") && T.outOf("n2").text === "EXPENSIVE_LLM_OUTPUT",
  "CARRY-OVER: undo must preserve a node's generated result (not force a paid re-run)");
ok(T.sigOf("n2") === "sig-n2",
  "CARRY-OVER: undo must preserve the fixed-seed skip signature so the result isn't recomputed");
// a type swap under a reused id must NOT inherit the stale output
T.reset();
T.applyGraphData(SPEC());
T.setOut("n1", { text: "STALE" }, "sig-n1");
T.applyGraphData({ v:1, nodes:[{ id:"n1", type:"image", x:10, y:20, fields:{} }], links:[], nid:"2", lid:"1", view:{} });
ok(!T.outOf("n1") || !T.outOf("n1").text,
  "CARRY-OVER: a different node TYPE under a reused id must not inherit the prior node's output");

// =============================================================================
// 7. RUN-GUARD — undo/redo must be refused while a node is executing, so a paid
//    in-flight result can't write into a detached node object and vanish (mirrors
//    the per-node delete guard).
// =============================================================================
T.reset();
T.setRunning([]);
T.applyGraphData(SPEC());
T.pushUndo();
T.setNodeX("n1", 555);
const guardBefore = T.snap();
T.setRunning(["n2"]);                                         // a run is now in flight
T.undo();
ok(content(T.snap()) === content(guardBefore),
  "RUN-GUARD: undo must be REFUSED while a node is running (graph unchanged)");
ok(T.stacks().undo.length === 1,
  "RUN-GUARD: a refused undo must not pop the undo stack");
T.setRunning([]);                                             // run finished
T.undo();
ok(T.snap().nodes[0].x !== 555,
  "RUN-GUARD: once idle, undo works normally again");

// ---- report -----------------------------------------------------------------
if (failures.length) {
  process.stderr.write("✗ undo/redo history is broken (↺ Undo no longer restores the previous workflow):\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ undo/redo restores the previous workflow (round-trip, fork, mute, depth cap, shared-link + file park).\n");
