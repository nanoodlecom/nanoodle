#!/usr/bin/env node
// Behavioural test for the editor's wire-making path — connect() (~6071) and the
// run-time topological order (topoOrder, ~6467) in index.html. No offline harness
// extracted connect() before this one; it lifts the REAL shipped functions out of
// the HTML as text and runs them in node:vm against tiny stubs. No browser, no
// network, no inference.
//
// Invariants pinned (each holds on current main AND after PR #231's wire-loop
// guard merges — see the compatibility note below):
//   1. SINGLE-INPUT-WIRE  — a second connect() into the same input port leaves
//      exactly ONE link (the newest); the displaced wire is dropped from graph.links.
//   2. SELF-LOOP NO-OP    — connect(from===to) adds no link and pushes no undo
//      snapshot (a self-drop must never be a recordable edit).
//   3. PORT-GROWTH WIRING — a successful connect() calls refreshImageInputs AND
//      refreshVideoInputs (the dynamic image/Combine clip ports grow their next
//      slot here); a light pin that the call sites stay wired. Deep growth logic
//      lives in check-image-ports.
//   4. RUN-TIME CYCLE SAFETY — topoOrder() on a cyclic node set TERMINATES and
//      returns the offenders in `cyclic` (excluded from `order`); the run driver
//      badges each one "cycle detected" at ~6562. topoOrder itself never toasts,
//      loops forever, or emits a silent partial order.
//   5. VALID CONNECT      — a normal wire adds exactly one {from,to}-shaped link and
//      preserves every unrelated link.
//
// COMPATIBILITY with PR #231 (branch fix/wire-loop-guard): that PR makes connect()
// REFUSE a loop-making wire at draw time (toast + return false) and adds a
// wouldCycle() helper connect() calls. So this harness deliberately does NOT pin
// "a cycle-making wire is accepted at draw time" — every scenario here wires only
// nodes with no directed back-path, so connect()'s outcome is identical on both
// branches. It extracts wouldCycle() too when present and always stubs toast(), so
// it runs unchanged against #231. The commented "LOOP-REFUSAL" stanza at the bottom
// is the trivial one-line addition to pin #231's refusal once it lands on main.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "index.html"), "utf8");

// ---- string/comment/template-aware brace matcher (same shape as check-share-link) ----
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
function extractFunction(src, name) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}() in index.html`);
  const open = src.indexOf("{", m.index);
  return src.slice(m.index, matchBrace(src, open) + 1);
}

const failures = [];
const ok = (c, m) => { if (!c) failures.push(m); };

// ---- build a runnable bundle from the SHIPPED source ----------------------
// connect() calls, in order: (PR#231 only) wouldCycle → toast; then pushUndo,
// graph.links filter/push (lid++), byId, refreshImageInputs, refreshVideoInputs,
// (inpaint only) rerenderNode, redraw, refreshPortFills, save. topoOrder reads
// graph.links. We supply spies for the ones we assert on and no-op stubs for the
// rest, and seed the module-level `lid` link counter.
let connectFn, topoFn, wouldCycleFn = "";
try {
  connectFn = extractFunction(SRC, "connect");
  topoFn = extractFunction(SRC, "topoOrder");
  if (/function\s+wouldCycle\s*\(/.test(SRC)) wouldCycleFn = extractFunction(SRC, "wouldCycle");  // PR #231
} catch (e) {
  process.stderr.write("✗ check-connect-wires could not extract the shipped functions: " + e.message + "\n");
  process.exit(1);
}

// spies/counters live on the context so the extracted functions mutate them directly
const spy = { pushUndo: 0, refreshImageInputs: 0, refreshVideoInputs: 0, toast: 0 };
const ctx = {
  console,
  graph: { nodes: [], links: [] },
  byId: (id) => ctx.graph.nodes.find((n) => n.id === id) || null,
  pushUndo: () => { spy.pushUndo++; },
  refreshImageInputs: () => { spy.refreshImageInputs++; },
  refreshVideoInputs: () => { spy.refreshVideoInputs++; },
  rerenderNode: () => {},          // only reached for inpaint nodes — not exercised
  redraw: () => {}, refreshPortFills: () => {}, save: () => {},
  toast: () => { spy.toast++; },   // PR #231's loop refusal notice
};
vm.createContext(ctx);
const bundle =
  "let lid = 500;\n" +
  wouldCycleFn + "\n" +
  connectFn + "\n" +
  topoFn + "\n" +
  ";globalThis.__t = { connect, topoOrder };";
try {
  new vm.Script(bundle, { filename: "index.html#connect-wires" }).runInContext(ctx);
} catch (e) {
  process.stderr.write("✗ check-connect-wires could not run the shipped functions: " + (e && e.message) + "\n");
  process.exit(1);
}
const { connect, topoOrder } = ctx.__t;

// helpers to reset per-scenario state
const nodes = (...ids) => ids.map((id) => ({ id, type: "text" }));
function reset(links) { ctx.graph.links = links || []; spy.pushUndo = spy.refreshImageInputs = spy.refreshVideoInputs = spy.toast = 0; }
const into = (port) => ctx.graph.links.filter((l) => l.to.node === "m" && l.to.port === port);

// ---- 1. SINGLE-INPUT-WIRE --------------------------------------------------
// a→(m,prompt) already wired; wire b→(m,prompt). Neither b nor m has a back-path,
// so connect()'s outcome is identical on main and on #231.
ctx.graph.nodes = nodes("a", "b", "m");
reset([{ id: "l1", from: { node: "a", port: "out" }, to: { node: "m", port: "prompt" } }]);
connect("b", "out", "m", "prompt");
{
  const in1 = into("prompt");
  ok(in1.length === 1, `single-input: expected exactly ONE link into (m,prompt), got ${in1.length}`);
  ok(in1[0] && in1[0].from.node === "b", "single-input: the surviving link must be the NEWEST (from b), not the displaced one");
  ok(!ctx.graph.links.some((l) => l.from.node === "a"), "single-input: the displaced a→prompt wire must be removed from graph.links");
}

// ---- 2. SELF-LOOP NO-OP ----------------------------------------------------
ctx.graph.nodes = nodes("a");
reset([]);
const selfRet = connect("a", "out", "a", "in");
ok(ctx.graph.links.length === 0, "self-loop: connect(from===to) must add NO link");
ok(spy.pushUndo === 0, "self-loop: connect(from===to) must NOT push an undo snapshot (a no-op isn't a recordable edit)");
ok(!selfRet, "self-loop: connect(from===to) must not report success");

// ---- 3. PORT-GROWTH WIRING + 5. VALID CONNECT ------------------------------
// c→d is unrelated and must survive; wire a→b (no back-path → accepted on both branches).
ctx.graph.nodes = nodes("a", "b", "c", "d");
reset([{ id: "l9", from: { node: "c", port: "out" }, to: { node: "d", port: "in" } }]);
const okRet = connect("a", "out", "b", "in");
{
  const added = ctx.graph.links.filter((l) => l.from.node === "a" && l.to.node === "b");
  ok(ctx.graph.links.length === 2, `valid-connect: expected 2 links after wiring, got ${ctx.graph.links.length}`);
  ok(added.length === 1, "valid-connect: exactly one a→b link must be added");
  ok(added[0] && added[0].from.port === "out" && added[0].to.node === "b" && added[0].to.port === "in",
     "valid-connect: the new link must carry the correct {from:{node,port},to:{node,port}} shape");
  ok(ctx.graph.links.some((l) => l.id === "l9" && l.from.node === "c" && l.to.node === "d"), "valid-connect: the unrelated c→d link must be preserved");
  ok(spy.pushUndo === 1, "valid-connect: a real wire must push exactly one undo snapshot");
  ok(okRet !== false, "valid-connect: a successful wire must not report refusal");
  // invariant 3 — the dynamic image/video port-growth call sites stay wired
  ok(spy.refreshImageInputs === 1, "port-growth: connect() must call refreshImageInputs (dynamic vision img ports grow here)");
  ok(spy.refreshVideoInputs === 1, "port-growth: connect() must call refreshVideoInputs (Combine clip ports grow here)");
}

// ---- 4. RUN-TIME CYCLE SAFETY (topoOrder) ----------------------------------
// A cyclic set must terminate and surface offenders in `cyclic`; an acyclic set
// must fully order with an empty `cyclic`. Pins the run-time backstop (6498)
// independently of any draw-time loop guard.
reset([
  { id: "c1", from: { node: "a", port: "out" }, to: { node: "b", port: "in" } },
  { id: "c2", from: { node: "b", port: "out" }, to: { node: "a", port: "in" } },
]);
const cyc = topoOrder(new Set(["a", "b"]));
ok(Array.isArray(cyc.cyclic) && cyc.cyclic.includes("a") && cyc.cyclic.includes("b"),
   `cycle-safety: a 2-node cycle must be reported in \`cyclic\` (got ${JSON.stringify(cyc.cyclic)})`);
ok(!cyc.order.includes("a") && !cyc.order.includes("b"), "cycle-safety: cyclic nodes must be EXCLUDED from the runnable order (no silent partial run)");

reset([
  { id: "a1", from: { node: "a", port: "out" }, to: { node: "b", port: "in" } },
  { id: "a2", from: { node: "b", port: "out" }, to: { node: "c", port: "in" } },
]);
const acy = topoOrder(new Set(["a", "b", "c"]));
ok(acy.cyclic.length === 0 && acy.order.length === 3 && acy.order.indexOf("a") < acy.order.indexOf("b") && acy.order.indexOf("b") < acy.order.indexOf("c"),
   `cycle-safety: an acyclic chain must fully order a→b→c with no cyclic offenders (got order=${JSON.stringify(acy.order)}, cyclic=${JSON.stringify(acy.cyclic)})`);

// ---- LOOP-REFUSAL (PR #231) — uncomment once fix/wire-loop-guard lands on main:
// // A wire that closes a directed loop (b→a already wired; now a→b) must be REFUSED:
// // no link added, no undo snapshot, and a toast shown.
// ctx.graph.nodes = nodes("a", "b");
// reset([{ id: "lb", from: { node: "b", port: "out" }, to: { node: "a", port: "in" } }]);
// const refused = connect("a", "out", "b", "in");
// ok(refused === false, "loop-refusal: connect() must return false for a loop-making wire");
// ok(!ctx.graph.links.some((l) => l.from.node === "a" && l.to.node === "b"), "loop-refusal: the loop wire must NOT be added");
// ok(spy.pushUndo === 0, "loop-refusal: a refused wire must not push an undo snapshot");
// ok(spy.toast === 1, "loop-refusal: the user must be told why the wire was refused");

if (failures.length) {
  process.stderr.write("✗ connect() / topoOrder wire rules regressed:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ connect() keeps one wire per input, ignores self-drops, grows dynamic ports; topoOrder flags run-time cycles.\n");
