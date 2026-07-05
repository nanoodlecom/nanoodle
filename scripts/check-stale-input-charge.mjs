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
const runGroupSrc = extractAsyncFn(SRC, "runGroup");

const elStub = () => ({ dataset: {}, querySelector: () => ({ classList: { add() {} }, set innerHTML(_v) {} }) });

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

async function run(world, seed, opts = {}) {
  const ctx = {
    ensureAuth: () => true,
    getKey: () => (opts.signedOut ? null : "k"),          // signed out → runGroup must fall back to DEMO_CTX
    DEMO_CTX: { demo: true },
    openDemoPop: (custom) => { world.demoPopOpened = true; world.demoPopCustom = custom; },
    markDemoResult: (n) => { (world.demoBadged ||= []).push(n.id); },
    setNodeProgress: () => {},
    demoRunLabel: () => "loading sample…",
    demoStarterSig: "STARTER",                             // demo run only serves a sample when the graph matches the starter…
    appHandoffSig: () => (opts.customGraph ? "OTHER" : "STARTER"),   // …so control this in the test to exercise both paths
    componentOf: () => world.ids.slice(),
    groupBusy: () => false,
    ancestors: () => new Set(world.ids),
    runningNodes: new Set(),
    runAbort: null, AbortController,
    updateRunButtons: () => {},
    topoOrder: () => ({ order: world.ids.slice(), cyclic: [] }),
    setStatus: (n, s) => { n.el.dataset.status = s; n._st = s; },
    setStopped: (n) => { n.el.dataset.status = "idle"; n._st = "stopped"; },
    setSkipped: (n) => { n.el.dataset.status = "skip"; n._st = "skip"; },
    byId: (id) => world.nodes[id],
    NODE_TYPES: world.NODE_TYPES,
    graph: { links: world.links },
    imgSpec: () => ({ re: /never/ }), VID_PORT_RE: /^vid\d+$/,
    nodeSig: () => 0, isSeeded: () => false, showResult: () => {}, rerenderNode: () => {}, CTX: {},
    friendlyRunError: (e) => e?.message || String(e),   // identity here — the real mapper is UX-only
    maybeAppNudge: () => {},   // post-first-wow "Create app" nudge — UI-only, inert here

    console,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  new vm.Script(runGroupSrc + `\nglobalThis.__p = runGroup(['${seed}']);`).runInContext(ctx);
  await ctx.__p;
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
  ok(w.demoPopCustom === false, `sample pill shown in SAMPLE mode for the unedited starter (custom=${w.demoPopCustom})`);
}

// 5) Signed out on an EDITED / non-starter graph → NO fake result: the sample can't honestly
//    represent a changed graph, so runGroup opens the pill in "sign in to run your workflow" mode
//    and runs NOTHING (no canned output, no badge, no charge).
{
  const w = makeWorld(2, false);
  await run(w, "n1", { signedOut: true, customGraph: true });
  ok(!w.runs.n1 && !w.paid.length, `edited signed-out graph ran no node and charged nothing (runs=${w.runs.n1 || 0}, paid=${w.paid.length})`);
  ok(w.demoPopOpened === true && w.demoPopCustom === true, `sign-in pill surfaced in CUSTOM mode (opened=${w.demoPopOpened}, custom=${w.demoPopCustom})`);
  ok(!(w.demoBadged || []).length, `no sample badge on a graph we refused to fake (badged=${JSON.stringify(w.demoBadged || [])})`);
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

if (fail) { console.error(`\n✗ stale-input-charge: ${fail} assertion(s) failed.`); process.exit(1); }
console.log("\n✓ stale-input-charge: failed/cyclic upstream poisons dependents — no stale-input charge; succeeded upstream is reused (not re-charged) on retry while the explicit target re-rolls; healthy graphs unaffected.");
