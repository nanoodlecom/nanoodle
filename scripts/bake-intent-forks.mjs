#!/usr/bin/env node
/**
 * Product · 52 — bake intent-fork walkbacks from the Examples gallery.
 *
 * For every gallery graph, each producer output that feeds consumers is a
 * branch point. Walk the consumers back in every order (≤ 24 permutations):
 * each step is one example — context = producer + its ancestors + the
 * consumers already added, target = the next consumer type, tagged with its
 * intent mode (MODE_OF_TYPE). A light catalog prior (every compatible
 * consumer of every producer, low weight) keeps unseen modes alive.
 *
 * Writes vendor/next-action/corpus/intent-forks.json (training + held-out
 * fork list for mode-coverage checks). Deterministic; no network.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { MODE_OF_TYPE, OUT_PORT, CONSUMERS_BY_PORT, TYPES, PORT_TYPES, MODES, IN_DIM, rowMode } from "../vendor/next-action/intent-spread.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY = join(ROOT, "examples", "gallery");
const OUT = join(ROOT, "vendor", "next-action", "corpus", "intent-forks.json");
const CATALOG_WEIGHT = 0.15;

function permutations(arr, cap = 24) {
  const out = [];
  const rec = (rest, acc) => {
    if (out.length >= cap) return;
    if (!rest.length) { out.push(acc); return; }
    for (let i = 0; i < rest.length; i++) rec(rest.slice(0, i).concat(rest.slice(i + 1)), acc.concat(rest[i]));
  };
  rec(arr, []);
  return out;
}

function ancestors(id, preds) {
  const seen = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const p of preds.get(cur) || []) if (!seen.has(p)) { seen.add(p); stack.push(p); }
  }
  return seen;
}

export function bakeIntentForks(galleryDir = GALLERY) {
  const graphs = readdirSync(galleryDir)
    .filter((d) => existsSync(join(galleryDir, d, "graph.json")))
    .sort();
  const examples = [];
  const forks = [];
  for (const slug of graphs) {
    const g = JSON.parse(readFileSync(join(galleryDir, slug, "graph.json"), "utf8"));
    const nodes = (g.nodes || []).filter((n) => n && n.type && n.type !== "comment");
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const preds = new Map();
    /** @type {Map<string, string[]>} producer id → consumer ids (by output port) */
    const fan = new Map();
    for (const l of g.links || []) {
      const a = l?.from?.node, b = l?.to?.node;
      if (!byId.has(a) || !byId.has(b)) continue;
      if (!preds.has(b)) preds.set(b, []);
      preds.get(b).push(a);
      const key = a;
      if (!fan.has(key)) fan.set(key, []);
      fan.get(key).push(b);
    }
    for (const [pid, cids] of [...fan.entries()].sort((x, y) => String(x[0]).localeCompare(String(y[0])))) {
      const producer = byId.get(pid);
      const portType = OUT_PORT[producer.type];
      if (!portType) continue;
      const consumers = cids.map((c) => byId.get(c)).filter((n) => n && rowMode(n.type, portType));
      if (!consumers.length) continue;
      const base = {};
      for (const aid of ancestors(pid, preds)) {
        const t = byId.get(aid)?.type;
        if (t) base[t] = (base[t] || 0) + 1;
      }
      base[producer.type] = (base[producer.type] || 0) + 1;
      const forkId = `${slug}#${pid}`;
      const types = consumers.map((n) => n.type);
      const modes = [...new Set(types.map((t) => MODE_OF_TYPE[t]))];
      forks.push({ graph: slug, forkId, producerType: producer.type, portType, contextCounts: { ...base }, consumerTypes: types, modes });
      const perms = permutations(consumers.map((_, i) => i));
      const w = 1 / perms.length;
      for (const perm of perms) {
        const counts = { ...base };
        const usedModes = [];
        for (const i of perm) {
          const t = consumers[i].type;
          const mode = MODE_OF_TYPE[t];
          examples.push({
            kind: "walkback", graph: slug, forkId, producerType: producer.type, portType,
            usedModes: usedModes.slice(), contextCounts: { ...counts }, target: t, mode, weight: +w.toFixed(6),
          });
          counts[t] = (counts[t] || 0) + 1;
          if (!usedModes.includes(mode)) usedModes.push(mode);
        }
      }
    }
  }
  // Catalog prior: every producer type × every compatible consumer, low weight.
  for (const producerType of TYPES) {
    const portType = OUT_PORT[producerType];
    if (!portType) continue;
    for (const t of CONSUMERS_BY_PORT[portType] || []) {
      examples.push({
        kind: "catalog", graph: "_catalog", forkId: `_catalog#${producerType}`, producerType, portType,
        usedModes: [], contextCounts: { [producerType]: 1 }, target: t, mode: MODE_OF_TYPE[t], weight: CATALOG_WEIGHT,
      });
    }
  }
  return {
    schemaVersion: 1,
    product: "intent-spread",
    label: "Product · 52",
    source: "examples-gallery walkbacks + catalog prior",
    vocab: { types: TYPES, portTypes: PORT_TYPES, modes: MODES, inDim: IN_DIM, consumersByPort: CONSUMERS_BY_PORT, modeOfType: MODE_OF_TYPE },
    graphCount: graphs.length,
    graphs,
    catalogWeight: CATALOG_WEIGHT,
    walkbackCount: examples.filter((e) => e.kind === "walkback").length,
    catalogCount: examples.filter((e) => e.kind === "catalog").length,
    forkCount: forks.length,
    multiModeForkCount: forks.filter((f) => f.modes.length >= 2).length,
    forks,
    examples,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = bakeIntentForks();
  const check = process.argv.includes("--check");
  const text = JSON.stringify(out) + "\n";
  if (check) {
    const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (cur !== text) { console.error(`✗ ${relative(ROOT, OUT)} is stale — run node scripts/bake-intent-forks.mjs`); process.exit(1); }
    console.log(`✓ ${relative(ROOT, OUT)} current`);
  } else {
    writeFileSync(OUT, text);
    console.log(`wrote ${relative(ROOT, OUT)}: ${out.graphCount} graphs, ${out.forkCount} branch points (${out.multiModeForkCount} multi-mode), ${out.walkbackCount} walkbacks + ${out.catalogCount} catalog rows`);
  }
}
