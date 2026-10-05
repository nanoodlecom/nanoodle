#!/usr/bin/env node
/**
 * Product · 52 — held-out mode coverage for the intent-spread head.
 *
 * Leave-one-graph-out: for each gallery graph G, the fold weights trained
 * without G (train-intent-spread.py --holdout-graph G) rank the next rows at
 * every branch point in G (state: producer just built, no consumer yet).
 *
 *   baseline-count   gallery consumer counts from the other graphs (· 27 style)
 *   baseline-head    same MoG head, plain marginal top-3 (no spread)
 *   spread           baseline-head rows passed through spreadIntentRows()
 *
 * second-fork: at a multi-mode branch point, one consumer is already wired
 * (each in turn); truth = the other consumers' modes. This is the
 * "branch off an output that is already used" path.
 *
 * mode coverage@3 = |modes(top3) ∩ true fork modes| / min(3, |true modes|)
 * type recall@3   = |top3 ∩ true consumer types| / min(3, |true types|)
 *
 *   node scripts/eval-intent-spread.mjs <fold-weights-dir> [--json out.json]
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { modeMixture, spreadIntentRows, MODE_OF_TYPE, CONSUMERS_BY_PORT } from "../vendor/next-action/intent-spread.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(readFileSync(join(ROOT, "vendor/next-action/corpus/intent-forks.json"), "utf8"));
const dir = process.argv[2];
if (!dir) { console.error("usage: eval-intent-spread.mjs <fold-weights-dir>"); process.exit(2); }
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;

function countsTop3(fork) {
  const counts = {};
  for (const f of corpus.forks) {
    if (f.graph === fork.graph || f.producerType !== fork.producerType) continue;
    for (const t of f.consumerTypes) counts[t] = (counts[t] || 0) + 1;
  }
  const order = CONSUMERS_BY_PORT[fork.portType] || [];
  return order.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || order.indexOf(a) - order.indexOf(b)).slice(0, 3);
}

/** Graph sketch with one producer selected (so anchorContext reproduces the fork state). */
function forkGraph(fork, wired = []) {
  const nodes = [{ id: "P", type: fork.producerType }];
  const links = [];
  wired.forEach((t, j) => { nodes.push({ id: "w" + j, type: t }); links.push({ from: { node: "P", port: "out" }, to: { node: "w" + j, port: "in" } }); });
  let i = 0;
  for (const [t, c] of Object.entries(fork.contextCounts)) {
    const n = t === fork.producerType ? c - 1 : c;
    for (let k = 0; k < n; k++) nodes.push({ id: "c" + i++, type: t });
  }
  return { nodes, links, selectedId: "P", selectedIds: [] };
}

function score(rows, fork) {
  const truthModes = new Set(fork.truthModes || fork.modes);
  const truthTypes = new Set(fork.truthTypes || fork.consumerTypes);
  const modes = new Set(rows.map((t) => MODE_OF_TYPE[t]).filter(Boolean));
  const covM = [...truthModes].filter((m) => modes.has(m)).length / Math.min(3, truthModes.size);
  const covT = [...truthTypes].filter((t) => rows.includes(t)).length / Math.min(3, truthTypes.size);
  return { covM, covT, distinct: modes.size };
}

const systems = ["baseline-count", "baseline-head", "spread"];
const agg = {};
const BUCKETS = ["all", "multi", "second"];
const zero = () => ({ covM: 0, covT: 0, distinct: 0, full: 0, n: 0 });
for (const s of systems) agg[s] = Object.fromEntries(BUCKETS.map((b) => [b, zero()]));
const perFork = [];
let missing = 0, fired = 0;
function evalState(w, fork, wired, buckets, label) {
  const counts = { ...fork.contextCounts };
  for (const t of wired) counts[t] = (counts[t] || 0) + 1;
  const usedModes = [...new Set(wired.map((t) => MODE_OF_TYPE[t]))];
  const ctx = { producerType: fork.producerType, portType: fork.portType, usedModes, contextCounts: counts };
  const mix = modeMixture(w, ctx);
  if (!mix) return;
  const head = Object.entries(mix.marginal).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([t]) => t);
  const prior = head.map((t) => ({ type: t, action: "add:" + t, reason: "often added next", source: "blend" }));
  const res = spreadIntentRows(w, forkGraph({ ...fork, contextCounts: fork.contextCounts }, wired), prior, {});
  if (res.changed) fired++;
  const rows = { "baseline-count": countsTop3(fork), "baseline-head": head, spread: res.adds.map((a) => a.type) };
  const target = wired.length
    ? { truthTypes: fork.consumerTypes.filter((t) => !wired.includes(t)), truthModes: fork.modes.filter((m) => !usedModes.includes(m)) }
    : {};
  const rec = { state: label, forkId: fork.forkId, wired, truth: target.truthTypes || fork.consumerTypes, modes: target.truthModes || fork.modes, why: res.why, pi: Object.fromEntries(Object.entries(mix.pi).map(([k, v]) => [k, +v.toFixed(3)])) };
  for (const s of systems) {
    const sc = score(rows[s], { ...fork, ...target });
    rec[s] = rows[s];
    for (const bucket of buckets) {
      const a = agg[s][bucket];
      a.covM += sc.covM; a.covT += sc.covT; a.distinct += sc.distinct; a.full += sc.covM >= 1 ? 1 : 0; a.n++;
    }
  }
  perFork.push(rec);
}
for (const fork of corpus.forks) {
  const wPath = join(dir, `fold-${fork.graph}.json`);
  if (!existsSync(wPath)) { missing++; continue; }
  const w = JSON.parse(readFileSync(wPath, "utf8"));
  evalState(w, fork, [], fork.modes.length >= 2 ? ["all", "multi"] : ["all"], "fresh");
  if (fork.modes.length >= 2) {
    for (const first of [...new Set(fork.consumerTypes)]) {
      const rest = fork.modes.filter((m) => m !== MODE_OF_TYPE[first]);
      if (!rest.length) continue;
      evalState(w, fork, [first], ["second"], "second-fork");
    }
  }
}
const summary = {};
for (const s of systems) {
  summary[s] = {};
  for (const b of BUCKETS) {
    const a = agg[s][b];
    summary[s][b] = { n: a.n, modeCoverage3: +(a.covM / a.n).toFixed(3), typeRecall3: +(a.covT / a.n).toFixed(3), distinctModes3: +(a.distinct / a.n).toFixed(2), fullModeCoverage: +(a.full / a.n).toFixed(3) };
  }
}
const out = { folds: corpus.graphs.length, forks: perFork.length, missing, spreadFired: fired, summary, perFork };
console.log(JSON.stringify(summary, null, 2));
console.log(`forks=${perFork.length} missing=${missing} spreadFired=${fired}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2) + "\n");
