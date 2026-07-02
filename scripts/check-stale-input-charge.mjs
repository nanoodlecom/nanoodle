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

async function run(world, seed) {
  const ctx = {
    ensureAuth: () => true,
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
}

if (fail) { console.error(`\n✗ stale-input-charge: ${fail} assertion(s) failed.`); process.exit(1); }
console.log("\n✓ stale-input-charge: failed/cyclic upstream poisons dependents — no stale-input charge; healthy graphs unaffected.");
