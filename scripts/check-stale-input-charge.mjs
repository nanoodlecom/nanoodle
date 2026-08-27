#!/usr/bin/env node
// When an upstream node FAILS mid-run, its previous output is stale — a downstream node must NOT
// execute on it (that would charge real money for a doomed/outdated input and show a "done" child
// under an "error" parent). The editor's runGroup poisons dependents: a failed (or cyclic) node
// taints its whole downstream subtree, which is shown "skipped" and never run. This extracts the
// REAL runGroup() from index.html and drives it with stubbed leaf helpers + spy run()s, asserting
// the downstream paid call never fires on failure — and still fires normally on success.
// Offline node:vm, same extraction technique as check-quickadd.mjs. No network, no API spend.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "index.html"), "utf8");

function extractAsyncFn(src, name) {
  const start = src.indexOf("async function " + name + "(");
  if (start === -1) throw new Error(`async function ${name}() not found in index.html`);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`could not brace-match ${name}()`);
}
function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error(`function ${name}() not found in index.html`);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`could not brace-match ${name}()`);
}
const runGroupSrc = extractAsyncFn(SRC, "runGroup");
const isPaidNanoTypeSrc = extractFn(SRC, "isPaidNanoType");
const ancestorsSrc = extractFn(SRC, "ancestors");
const topoOrderSrc = extractFn(SRC, "topoOrder");
const groupBusySrc = extractFn(SRC, "groupBusy");
const playBusySrc = extractFn(SRC, "playBusy");
const updateRunButtonsSrc = extractFn(SRC, "updateRunButtons");
const dropWorkHolderSrc = extractFn(SRC, "dropWorkHolder");
const stopSeedRunSrc = extractFn(SRC, "stopSeedRun");
const isInputKindSrc = extractFn(SRC, "isInputKind");
const INPUT_KINDSSrc = (() => {
  const m = SRC.match(/const\s+INPUT_KINDS\s*=\s*\{[^}]*\}/);
  if (!m) throw new Error("const INPUT_KINDS not found in index.html");
  return m[0] + ";";
})();

const elStub = () => {
  const run = { disabled: false, textContent: "▶", title: "" };
  return {
    dataset: {},
    querySelector: (sel) => {
      if (typeof sel === "string" && sel.includes("data-act=run")) return run;
      return { classList: { add() {} }, set innerHTML(_v) {} };
    },
    _run: run,
  };
};

// Build a linear chain of `len` nodes (n0 -> n1 -> ... wired image->image). n0's run is a spy that
// optionally throws; every node records run-count + would-be paid call. order/ancestors cover all.
function makeWorld(len, failFirst) {
  const nodes = {}, ids = [];
  for (let i = 0; i < len; i++) {
    const id = "n" + i; ids.push(id);
    nodes[id] = { id, type: i === 0 ? "img" : "edit", fields: {}, out: i === 0 ? { image: "STALE_PRIOR_RUN" } : {}, el: elStub() };
  }
  const runs = {}, paid = [];
  const NODE_TYPES = {
    img: { inputs: [], async run(n) { runs[n.id] = (runs[n.id] || 0) + 1; if (failFirst) throw new Error("nano-gpt 500 — transient"); return { image: "FRESH_" + n.id }; } },
    edit: { inputs: [{ name: "image", type: "image" }], async run(n, inp) {
      runs[n.id] = (runs[n.id] || 0) + 1;
      if (!inp.image) throw new Error("no image input");
      paid.push(n.id + "<=" + inp.image);   // a real genImage charge would happen here
      return { image: "EDITED_" + n.id };
    } },
  };
  const links = ids.slice(1).map((id, i) => ({ id: "l" + i, from: { node: ids[i], port: "image" }, to: { node: id, port: "image" } }));
  return { nodes, ids, runs, paid, NODE_TYPES, links };
}

function bindWorld(world, opts = {}) {
  const runningNodes = world.runningNodes || new Set();
  const seedRuns = world.seedRuns || new Set();
  const seedCtl = world.seedCtl || new Map();
  const nodeWork = world.nodeWork || new Map();
  const runLockCount = world.runLockCount || new Map();
  const liveAborts = world.liveAborts || new Set();
  world.runningNodes = runningNodes;
  world.seedRuns = seedRuns;
  world.seedCtl = seedCtl;
  world.nodeWork = nodeWork;
  world.runLockCount = runLockCount;
  world.liveAborts = liveAborts;
  const ctx = {
    ensureAuth: () => true,
    getKey: () => (opts.signedOut ? null : "k"),          // signed out → runGroup must fall back to DEMO_CTX
    DEMO_CTX: { demo: true },
    openDemoPop: (mode) => { world.demoPopOpened = true; world.demoPopMode = mode; },
    markDemoResult: (n) => { (world.demoBadged ||= []).push(n.id); },
    setNodeProgress: () => {},
    demoRunLabel: () => "loading sample…",
    // demoMode is the single free-sample chokepoint: exact starter, same-shape field edit, or wall.
    demoMode: () => (opts.customGraph ? null : (opts.shapeEdit ? "shape" : "exact")),
    demoStarterSig: "STARTER",
    appHandoffSig: () => (opts.customGraph ? "OTHER" : "STARTER"),
    componentOf: (id) => {
      const seen = new Set([id]), stack = [id];
      while (stack.length) {
        const n = stack.pop();
        for (const l of world.links) {
          if (l.from.node === n && !seen.has(l.to.node)) { seen.add(l.to.node); stack.push(l.to.node); }
          if (l.to.node === n && !seen.has(l.from.node)) { seen.add(l.from.node); stack.push(l.from.node); }
        }
      }
      return seen;
    },
    runningNodes, seedRuns, seedCtl, nodeWork, runLockCount, liveAborts,
    lockRunIds: (ids) => { for (const id of ids) { runningNodes.add(id); runLockCount.set(id, (runLockCount.get(id) || 0) + 1); } },
    unlockRunIds: (ids) => {
      for (const id of ids) {
        const n = (runLockCount.get(id) || 1) - 1;
        if (n <= 0) { runLockCount.delete(id); runningNodes.delete(id); }
        else runLockCount.set(id, n);
      }
    },
    runAbort: null, AbortController,
    t: (s) => s,
    $: (id) => {
      world.dom = world.dom || {};
      if (!world.dom[id]) {
        world.dom[id] = {
          hidden: false, textContent: "", title: "", disabled: false,
          classList: { toggle() {}, add() {}, remove() {} },
        };
      }
      return world.dom[id];
    },
    paintRunLive: () => {},
    refreshRunEstimate: () => {},
    flash: () => {},
    setStatus: (n, s) => { n.el.dataset.status = s; n._st = s; },
    setStopped: (n) => { n.el.dataset.status = "idle"; n._st = "stopped"; },
    setSkipped: (n) => { n.el.dataset.status = "skip"; n._st = "skip"; },
    byId: (id) => world.nodes[id],
    NODE_TYPES: world.NODE_TYPES,
    graph: { links: world.links, nodes: Object.values(world.nodes) },
    imgSpec: () => ({ re: /never/ }), VID_PORT_RE: /^vid\d+$/,
    nodeSig: () => 0, isSeeded: () => false, showResult: () => {}, rerenderNode: () => {}, CTX: {},
    // prompt-length caps (PROMPT LENGTH CAPS): identity here — this harness is about stale inputs
    // reaching a paid call, not about how long the prompt that reaches it is.
    withPromptBudget: (rn) => rn, withFittedPrompt: (rn) => ({ rn, trimmed: null }), announcePromptFit: () => {},
    friendlyRunError: (e) => e?.message || String(e),   // identity here — the real mapper is UX-only
    maybeAppNudge: () => {},   // post-first-wow "Create app" nudge — UI-only, inert here
    console,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  new vm.Script(
    isPaidNanoTypeSrc + "\n" + ancestorsSrc + "\n" + topoOrderSrc + "\n" +
    groupBusySrc + "\n" + playBusySrc + "\n" + updateRunButtonsSrc + "\n" +
    dropWorkHolderSrc + "\n" + stopSeedRunSrc + "\n" + runGroupSrc +
    "\nglobalThis.runGroup = runGroup;" +
    "\nglobalThis.groupBusy = groupBusy;" +
    "\nglobalThis.playBusy = playBusy;" +
    "\nglobalThis.updateRunButtons = updateRunButtons;" +
    "\nglobalThis.stopSeedRun = stopSeedRun;",
  ).runInContext(ctx);
  return ctx;
}

async function run(world, seed, opts = {}) {
  const ctx = bindWorld(world, opts);
  ctx.__p = ctx.runGroup([seed]);
  await ctx.__p;
  return ctx;
}

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

// 1) Upstream failure → direct dependent is skipped, never charged.
{
  const w = makeWorld(2, true);
  await run(w, "n1");
  ok(!w.runs.n1, `dependent never executed on a failed upstream (run count=${w.runs.n1 || 0})`);
  ok(w.paid.length === 0, `zero paid calls on stale input (got ${w.paid.length})`);
  ok(w.nodes.n1._st === "skip", `dependent shown 'skip', not 'done' (status=${w.nodes.n1._st})`);
  ok(w.nodes.n0._st === "error", `failed node shown 'error' (status=${w.nodes.n0._st})`);
}

// 2) Failure poison is TRANSITIVE: a 3-node chain skips the whole downstream subtree.
{
  const w = makeWorld(3, true);
  await run(w, "n2");
  ok(!w.runs.n1 && !w.runs.n2, `entire downstream subtree skipped (n1=${w.runs.n1 || 0}, n2=${w.runs.n2 || 0})`);
  ok(w.paid.length === 0, `no paid call anywhere downstream of the failure (got ${w.paid.length})`);
}

// 3) Control: a HEALTHY graph still runs every node and consumes FRESH output (no over-blocking).
{
  const w = makeWorld(2, false);
  await run(w, "n1");
  ok(w.runs.n1 === 1, `dependent runs normally when upstream succeeds (run count=${w.runs.n1})`);
  ok(w.paid[0] === "n1<=FRESH_n0", `dependent consumed FRESH upstream output, not stale (got ${w.paid[0]})`);
  ok(w.nodes.n1._sig !== undefined, `real run minted a seed-cache signature (sig=${w.nodes.n1._sig})`);
}

// 4) Signed out → the run still happens, but as a SAMPLE: DEMO_CTX reaches every run(), the
//    sample pill opens, results get badged, and NO seed-cache signature is minted (the first
//    real run after sign-in must regenerate, not "skip" onto a canned result).
{
  const w = makeWorld(2, false);
  const seen = [];
  const origRun = w.NODE_TYPES.edit.run;
  w.NODE_TYPES.edit.run = async (n, inp, c) => { seen.push(c && c.demo === true); return origRun(n, inp, c); };
  await run(w, "n1", { signedOut: true });
  ok(seen.length === 1 && seen[0] === true, `signed-out run executed against DEMO_CTX (saw demo=${seen[0]})`);
  ok(w.demoPopOpened === true, "sample pill (openDemoPop) surfaced on a signed-out run");
  ok((w.demoBadged || []).includes("n1"), `sample results are badged (badged=${JSON.stringify(w.demoBadged || [])})`);
  ok(w.nodes.n1._sig === undefined, `demo run minted NO seed-cache signature (sig=${w.nodes.n1._sig})`);
  ok(w.demoPopMode === "exact", `sample pill shown in exact mode for the unedited starter (mode=${w.demoPopMode})`);
}

// 5) Signed out on a TOPOLOGY-changed / non-starter graph → NO fake result: the sample can't
//    honestly represent a different graph, so runGroup opens the pill in wall mode and runs NOTHING.
{
  const w = makeWorld(2, false);
  await run(w, "n1", { signedOut: true, customGraph: true });
  ok(!w.runs.n1 && !w.paid.length, `topology-changed signed-out graph ran no node and charged nothing (runs=${w.runs.n1 || 0}, paid=${w.paid.length})`);
  ok(w.demoPopOpened === true && w.demoPopMode === null, `sign-in pill surfaced in wall mode (opened=${w.demoPopOpened}, mode=${w.demoPopMode})`);
  ok(!(w.demoBadged || []).length, `no sample badge on a graph we refused to fake (badged=${JSON.stringify(w.demoBadged || [])})`);
}

// 5b) Signed out on the starter SHAPE with field tweaks → still free-samples (canned results),
//     but the pill uses "shape" mode so the UI can warn that edits aren't reflected yet.
{
  const w = makeWorld(2, false);
  const seen = [];
  const origRun = w.NODE_TYPES.edit.run;
  w.NODE_TYPES.edit.run = async (n, inp, c) => { seen.push(c && c.demo === true); return origRun(n, inp, c); };
  await run(w, "n1", { signedOut: true, shapeEdit: true });
  ok(seen.length === 1 && seen[0] === true, `shape-edit signed-out run still uses DEMO_CTX (saw demo=${seen[0]})`);
  ok(w.demoPopMode === "shape", `sample pill shown in shape mode for light field edits (mode=${w.demoPopMode})`);
  ok((w.demoBadged || []).includes("n1"), `shape-edit sample results are still badged`);
}

// 6) Retry reuse: after a downstream failure the user re-runs (or per-node Runs the failed node).
//    Succeeded UPSTREAM nodes — even ones with no visible seed (LLM, video) — that still hold their
//    output at an unchanged signature must be REUSED, not re-executed and re-charged. Only the node
//    the user explicitly targeted (the seedIds) is re-run. Here n0,n1 already succeeded (out + _sig
//    present); n2 is the retried target. n1 is a PAID edit node, so a reuse miss would re-charge it.
{
  const w = makeWorld(3, false);
  w.nodes.n0._sig = 0;                                   // nodeSig() stub is ()=>0, so _sig=0 == "unchanged"
  w.nodes.n1._sig = 0; w.nodes.n1.out = { image: "PRIOR_EDIT_n1" };   // n1 succeeded on the prior run
  // n2.out stays {} — it's the node being retried
  await run(w, "n2");                                    // Run targeting only n2 (per-node retry on the failed node)
  ok(!w.runs.n0 && !w.runs.n1, `succeeded upstream REUSED, not re-executed on retry (n0=${w.runs.n0 || 0}, n1=${w.runs.n1 || 0})`);
  ok(w.runs.n2 === 1, `the explicitly targeted (retried) node re-executes (run count=${w.runs.n2})`);
  ok(w.paid.length === 1 && w.paid[0] === "n2<=PRIOR_EDIT_n1", `only the target charged, on the REUSED upstream output (paid=${JSON.stringify(w.paid)})`);
  ok(w.nodes.n1._st === "done", `reused upstream node shown 'done' (status=${w.nodes.n1._st})`);
}

// 7) Preserved re-roll: a per-node Run on a node the user explicitly targets ALWAYS re-executes it,
//    even when its signature is unchanged and it still holds output — that's an intentional re-roll.
//    Its own upstream is still reused (not re-charged), so the two rules coexist.
{
  const w = makeWorld(2, false);
  w.nodes.n0._sig = 0;                                   // n0 succeeded previously (unchanged) → reusable
  w.nodes.n1._sig = 0; w.nodes.n1.out = { image: "PRIOR_n1" };   // n1 also already has an output…
  await run(w, "n1");                                    // …but the user explicitly re-runs n1
  ok(w.runs.n1 === 1, `explicitly targeted node re-rolls despite unchanged sig + present output (run count=${w.runs.n1})`);
  ok(!w.runs.n0, `the targeted node's own upstream is still reused, not re-charged (n0=${w.runs.n0 || 0})`);
  ok(w.nodes.n1.out.image === "EDITED_n1", `the re-roll produced fresh output (got ${w.nodes.n1.out.image})`);
}

// 8) Parallel sibling Plays: A→B, A→C. Play on B must NOT claim C. Both branches
//    run; shared paid A executes once (in-flight wait / reuse — never double-charged).
{
  let aGo;
  const aHold = new Promise((r) => { aGo = r; });
  let aBegan;
  const aBeganP = new Promise((r) => { aBegan = r; });
  const nodes = {
    nA: { id: "nA", type: "img", fields: {}, out: {}, el: elStub() },
    nB: { id: "nB", type: "edit", fields: {}, out: {}, el: elStub() },
    nC: { id: "nC", type: "edit", fields: {}, out: {}, el: elStub() },
  };
  const runs = {}, paid = [];
  const NODE_TYPES = {
    img: { inputs: [], async run(n) {
      runs[n.id] = (runs[n.id] || 0) + 1;
      paid.push(n.id);
      aBegan();
      await aHold;
      return { image: "FRESH_A" };
    } },
    edit: { inputs: [{ name: "image", type: "image" }], async run(n, inp) {
      runs[n.id] = (runs[n.id] || 0) + 1;
      paid.push(n.id + "<=" + inp.image);
      return { image: "EDITED_" + n.id };
    } },
  };
  const links = [
    { id: "l1", from: { node: "nA", port: "image" }, to: { node: "nB", port: "image" } },
    { id: "l2", from: { node: "nA", port: "image" }, to: { node: "nC", port: "image" } },
  ];
  const w = { nodes, ids: ["nA", "nB", "nC"], runs, paid, NODE_TYPES, links };
  const ctx = bindWorld(w);
  const pB = ctx.runGroup(["nB"]);
  await aBeganP;                                    // A is in-flight for B
  ok(w.seedRuns.has("nB") && !w.seedRuns.has("nC"),
    `Play on B must mark only B as a live seed, not sibling C (seeds=${[...w.seedRuns]})`);
  ok(!w.runningNodes.has("nC"),
    `Play on B must NOT lock sibling C (running=${[...w.runningNodes]})`);
  ok(w.runningNodes.has("nA"), "shared ancestor A is in runningNodes while B waits");
  ok(!ctx.playBusy("nC"), "C's Play is not playBusy — a joinable ancestor must not block it");
  ok(!ctx.groupBusy(ctx.ancestors(["nC"])),
    "groupBusy(ancestors(C)) must be false while A runs for B (joinable ancestor ≠ dead Play)");
  ok(!w.nodes.nC.el._run.disabled, "C's Play button stays enabled while A is in flight for B");
  ok(w.nodes.nC.el._run.textContent === "▶", `C's Play stays ▶, not Stop (got ${w.nodes.nC.el._run.textContent})`);
  const pC = ctx.runGroup(["nC"]);                  // start C while A (and B's wait) are live
  ok(w.seedRuns.has("nB") && w.seedRuns.has("nC"),
    `B and C can be in flight at once (seeds=${[...w.seedRuns]})`);
  ok(!w.nodes.nC.el._run.disabled && w.nodes.nC.el._run.textContent === "■",
    "pressing C joins A: C's button becomes ■ Stop, still enabled");
  aGo();
  await Promise.all([pB, pC]);
  ok(w.runs.nA === 1, `shared upstream A must run once, not twice (nA=${w.runs.nA || 0})`);
  ok(w.runs.nB === 1 && w.runs.nC === 1, `both sibling branches execute (nB=${w.runs.nB || 0}, nC=${w.runs.nC || 0})`);
  ok(w.paid.filter((x) => x === "nA").length === 1, `paid A charged once (paid=${JSON.stringify(w.paid)})`);
  ok(w.nodes.nB.out.image === "EDITED_nB" && w.nodes.nC.out.image === "EDITED_nC",
    "both siblings produced output from the shared A result");
}

// 9) Stop on B does not abort C. Shared A already finished; C is mid-run.
{
  let releaseC;
  const cHold = new Promise((r) => { releaseC = r; });
  const nodes = {
    nA: { id: "nA", type: "img", fields: {}, out: { image: "PRIOR_A" }, el: elStub(), _sig: 0 },
    nB: { id: "nB", type: "edit", fields: {}, out: {}, el: elStub() },
    nC: { id: "nC", type: "edit", fields: {}, out: {}, el: elStub() },
  };
  const runs = {}, paid = [];
  const NODE_TYPES = {
    img: { inputs: [], async run(n) { runs[n.id] = (runs[n.id] || 0) + 1; return { image: "FRESH_A" }; } },
    edit: { inputs: [{ name: "image", type: "image" }], async run(n, inp) {
      runs[n.id] = (runs[n.id] || 0) + 1;
      paid.push(n.id + "<=" + inp.image);
      if (n.id === "nC") await cHold;
      return { image: "EDITED_" + n.id };
    } },
  };
  const links = [
    { id: "l1", from: { node: "nA", port: "image" }, to: { node: "nB", port: "image" } },
    { id: "l2", from: { node: "nA", port: "image" }, to: { node: "nC", port: "image" } },
  ];
  const w = { nodes, ids: ["nA", "nB", "nC"], runs, paid, NODE_TYPES, links };
  const ctx = bindWorld(w);
  const pB = ctx.runGroup(["nB"]);
  const pC = ctx.runGroup(["nC"]);
  // Wait until C is inside its run (hold) and B has likely finished (A reused, B is instant).
  await pB;
  ok(w.seedRuns.has("nC") && !w.seedRuns.has("nB"), "B finished; C still the live seed");
  const ctlC = w.seedCtl.get("nC");
  const ctlB = [...w.liveAborts].find((c) => c !== ctlC);
  if (ctlB && !ctlB.signal.aborted) ctlB.abort();   // Stop on B after B finished is a no-op; abort leftover if any
  // Stop B's controller must not be C's.
  ok(ctlC && !ctlC.signal.aborted, "C's controller must still be live after B stopped");
  releaseC();
  await pC;
  ok(w.runs.nC === 1, `C still completed after Stop on B (nC=${w.runs.nC || 0})`);
  ok(!w.runs.nA, `succeeded A still reused, not re-charged (nA=${w.runs.nA || 0})`);
}

// 10) Stop on B after C has joined: A keeps going (not a second charge), then C runs.
{
  let aGo;
  const aHold = new Promise((r) => { aGo = r; });
  let aBegan;
  const aBeganP = new Promise((r) => { aBegan = r; });
  const nodes = {
    nA: { id: "nA", type: "img", fields: {}, out: {}, el: elStub() },
    nB: { id: "nB", type: "edit", fields: {}, out: {}, el: elStub() },
    nC: { id: "nC", type: "edit", fields: {}, out: {}, el: elStub() },
  };
  const runs = {}, paid = [];
  const NODE_TYPES = {
    img: { inputs: [], async run(n) {
      runs[n.id] = (runs[n.id] || 0) + 1;
      paid.push(n.id);
      aBegan();
      const sig = n._runCtl && n._runCtl.signal;
      await new Promise((res, rej) => {
        if (sig && sig.aborted) return rej(Object.assign(new Error("aborted"), { name: "AbortError" }));
        const onAbort = () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (sig) sig.addEventListener("abort", onAbort);
        aHold.then(() => { if (sig) sig.removeEventListener("abort", onAbort); res(); }, rej);
      });
      return { image: "FRESH_A" };
    } },
    edit: { inputs: [{ name: "image", type: "image" }], async run(n, inp) {
      runs[n.id] = (runs[n.id] || 0) + 1;
      paid.push(n.id + "<=" + inp.image);
      return { image: "EDITED_" + n.id };
    } },
  };
  const links = [
    { id: "l1", from: { node: "nA", port: "image" }, to: { node: "nB", port: "image" } },
    { id: "l2", from: { node: "nA", port: "image" }, to: { node: "nC", port: "image" } },
  ];
  const w = { nodes, ids: ["nA", "nB", "nC"], runs, paid, NODE_TYPES, links };
  const ctx = bindWorld(w);
  const pB = ctx.runGroup(["nB"]);
  await aBeganP;
  const pC = ctx.runGroup(["nC"]);                  // C joins in-flight A
  await Promise.resolve();
  ctx.stopSeedRun("nB");                            // Stop B; C already holds A
  aGo();
  await Promise.all([pB, pC]);
  ok(w.runs.nA === 1, `Stop B after C joined must not cancel/re-run A (nA=${w.runs.nA || 0})`);
  ok(!w.runs.nB, `stopped seed B must not run after C joined (nB=${w.runs.nB || 0})`);
  ok(w.runs.nC === 1, `C still runs after Stop on B (nC=${w.runs.nC || 0})`);
  ok(w.nodes.nA._st === "done", `A must finish done, not stopped, when C still holds it (st=${w.nodes.nA._st})`);
  ok(w.nodes.nC.out.image === "EDITED_nC", "C produced output from the shared A result after Stop on B");
  ok(w.paid.filter((x) => x === "nA").length === 1, `A still charged once (paid=${JSON.stringify(w.paid)})`);
}

// 11) Stop on B with no joiner may cancel in-flight A.
{
  let aBegan;
  const aBeganP = new Promise((r) => { aBegan = r; });
  const nodes = {
    nA: { id: "nA", type: "img", fields: {}, out: {}, el: elStub() },
    nB: { id: "nB", type: "edit", fields: {}, out: {}, el: elStub() },
  };
  const runs = {};
  const NODE_TYPES = {
    img: { inputs: [], async run(n) {
      runs[n.id] = (runs[n.id] || 0) + 1;
      aBegan();
      const sig = n._runCtl && n._runCtl.signal;
      await new Promise((res, rej) => {
        if (sig && sig.aborted) return rej(Object.assign(new Error("aborted"), { name: "AbortError" }));
        const onAbort = () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (sig) sig.addEventListener("abort", onAbort);
      });
      return { image: "FRESH_A" };
    } },
    edit: { inputs: [{ name: "image", type: "image" }], async run(n, inp) {
      runs[n.id] = (runs[n.id] || 0) + 1;
      return { image: "EDITED_" + n.id };
    } },
  };
  const links = [{ id: "l1", from: { node: "nA", port: "image" }, to: { node: "nB", port: "image" } }];
  const w = { nodes, ids: ["nA", "nB"], runs, paid: [], NODE_TYPES, links };
  const ctx = bindWorld(w);
  const pB = ctx.runGroup(["nB"]);
  await aBeganP;
  ctx.stopSeedRun("nB");
  await pB;
  ok(w.nodes.nA._st === "stopped", `Stop B with no joiner may cancel A (st=${w.nodes.nA._st})`);
  ok(!w.runs.nB, `B must not run after Stop cancelled A (nB=${w.runs.nB || 0})`);
}

// 12) Input / source kinds have no Play control — generate nodes with empty inputs still do.
{
  const ikCtx = { NODE_TYPES: { text: { group: "Inputs" }, upload: { group: "Inputs" }, aupload: { group: "Inputs" },
    vupload: { group: "Inputs" }, choice: { group: "Inputs" }, comment: { note: true },
    image: { group: "Image", inputs: [] }, llm: { group: "Text", inputs: [] }, join: { group: "Text" } } };
  ikCtx.globalThis = ikCtx;
  vm.createContext(ikCtx);
  new vm.Script(INPUT_KINDSSrc + "\n" + isInputKindSrc + "\nglobalThis.isInputKind = isInputKind;").runInContext(ikCtx);
  for (const k of ["text", "upload", "aupload", "vupload", "choice", "comment"]) {
    ok(ikCtx.isInputKind(k) === true, `isInputKind(${k}) is a source/input — no Play`);
  }
  ok(ikCtx.isInputKind("image") === false, "isInputKind(image) is a generate node even with empty inputs — keep Play");
  ok(ikCtx.isInputKind("llm") === false, "isInputKind(llm) is a generate node even with empty inputs — keep Play");
  ok(ikCtx.isInputKind("join") === false, "isInputKind(join) is a processor — keep Play");
  ok(SRC.includes("hidePlay") && SRC.includes("isInputKind(n.type)") && SRC.includes('data-act="run"'),
    "editor Play button is gated on isInputKind / hidePlay");
}

if (fail) { console.error(`\n✗ stale-input-charge: ${fail} assertion(s) failed.`); process.exit(1); }
console.log("\n✓ stale-input-charge: failed/cyclic upstream poisons dependents — no stale-input charge; succeeded upstream is reused (not re-charged) on retry while the explicit target re-rolls; sibling Plays stay enabled while a shared ancestor is in flight and join it without double-charging A; Stop on B after C joined keeps A alive; input kinds have no Play; healthy graphs unaffected.");
