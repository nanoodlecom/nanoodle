#!/usr/bin/env node
/**
 * Product · 4 — bake synthetic build-order corpus from gallery Examples
 * under the Product · 2 schema (vendor/next-action/schema.json).
 * Also writes frequency-tables.json via Product · 3 frequency.mjs.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFrequencyTables } from "../vendor/next-action/frequency.mjs";
import { sketchFromGraph, ACTION_VOCAB, NODE_TYPES } from "../vendor/next-action/encode.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY = join(ROOT, "examples", "gallery");
const OUT_DIR = join(ROOT, "vendor", "next-action", "corpus");

const ADDABLE = new Set(NODE_TYPES);

function walkGraphs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkGraphs(p, out);
    else if (name === "graph.json") out.push(p);
  }
  return out;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Kahn topo with seeded random tie-break among ready nodes. */
function synthOrders(nodes, links, seeds) {
  const ids = nodes.map((n) => n.id);
  const indeg = Object.fromEntries(ids.map((id) => [id, 0]));
  const succ = Object.fromEntries(ids.map((id) => [id, []]));
  for (const L of links) {
    const a = L.from?.node;
    const b = L.to?.node;
    if (!a || !b || indeg[a] == null || indeg[b] == null) continue;
    indeg[b]++;
    succ[a].push(b);
  }
  const orders = [];
  for (const seed of seeds) {
    const rnd = mulberry32(seed);
    const deg = { ...indeg };
    const ready = ids.filter((id) => deg[id] === 0);
    const order = [];
    while (ready.length) {
      // Prefer non-comment when ties; shuffle lightly
      ready.sort((a, b) => {
        const na = nodes.find((n) => n.id === a);
        const nb = nodes.find((n) => n.id === b);
        const ca = na?.type === "comment" ? 1 : 0;
        const cb = nb?.type === "comment" ? 1 : 0;
        if (ca !== cb) return ca - cb;
        return rnd() - 0.5;
      });
      const pick = ready.shift();
      order.push(pick);
      for (const s of succ[pick]) {
        deg[s]--;
        if (deg[s] === 0) ready.push(s);
      }
    }
    if (order.length === ids.length) orders.push(order);
  }
  // Dedup
  const seen = new Set();
  return orders.filter((o) => {
    const k = o.join(",");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function modalityFamily(type) {
  if (type === "image" || type === "edit" || type === "resize") return "image";
  if (type === "ivideo" || type === "vedit") return "video";
  if (type === "music" || type === "tts" || type === "lipsync") return "audio";
  if (type === "llm" || type === "text" || type === "join") return "text";
  return "other";
}

function forkTagForTransition(builtNodes, nextNode, allNodes, links) {
  if (builtNodes.length === 0) return "cold-start";
  const nextType = nextNode.type;
  // Outgoing diversity from last built content node
  const last = [...builtNodes].reverse().find((n) => n.type !== "comment");
  if (last) {
    const outs = links
      .filter((L) => L.from?.node === last.id)
      .map((L) => allNodes.find((n) => n.id === L.to?.node))
      .filter(Boolean);
    const families = new Set(outs.map((n) => modalityFamily(n.type)));
    if (families.size >= 2 && outs.some((n) => n.id === nextNode.id)) {
      if ([...families].includes("audio")) return "audio-attach";
      return "modality-branch";
    }
    if (last.type === "image" && (nextType === "edit" || nextType === "ivideo")) {
      return "modality-branch";
    }
    if (nextType === "edit" && builtNodes.some((n) => n.type === "edit" || n.type === "image")) {
      return "revise-vs-extend";
    }
    if (["tts", "music", "lipsync"].includes(nextType)) return "audio-attach";
  }
  return "none";
}

function addToken(type) {
  const t = `add:${type}`;
  return ACTION_VOCAB.includes(t) ? t : null;
}

function bakeGraph(path, seeds) {
  const g = JSON.parse(readFileSync(path, "utf8"));
  const nodes = g.nodes || [];
  const links = g.links || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const content = nodes.filter((n) => ADDABLE.has(n.type));
  if (content.length < 2) return [];

  const orders = synthOrders(content, links, seeds);
  const examples = [];
  const source = relative(ROOT, path);

  for (const order of orders) {
    const built = [];
    const builtIds = new Set();
    const history = [];
    // Cold start → first add
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      const node = byId[id];
      const tok = addToken(node.type);
      if (!tok) continue;

      const graphNow = { nodes: built.map((b) => ({ ...b })), links: links.filter((L) => builtIds.has(L.from?.node) && builtIds.has(L.to?.node)) };
      const sketch = sketchFromGraph(graphNow);
      const intentFork = forkTagForTransition(built, node, content, links);
      examples.push({
        source,
        history: history.slice(),
        sketch,
        nextAction: tok,
        intentFork,
        exampleId: `${source}#${order.join('-').slice(0, 40)}@${i}`,
      });

      // Apply add
      built.push(node);
      builtIds.add(id);
      history.push(tok);
      if (history.length > 8) history.shift();

      // set:model if present
      if (node.fields?.model && ACTION_VOCAB.includes("set:model")) {
        const sk2 = sketchFromGraph({ nodes: built.map((b) => ({ ...b })), links: graphNow.links });
        examples.push({
          source,
          history: history.slice(),
          sketch: sk2,
          nextAction: "set:model",
          intentFork: "none",
          exampleId: `${source}#set:${id}`,
        });
        history.push("set:model");
        if (history.length > 8) history.shift();
      }

      // Emit wires whose both ends are now built
      for (const L of links) {
        if (L.to?.node !== id) continue;
        if (!builtIds.has(L.from?.node)) continue;
        const sk3 = sketchFromGraph({
          nodes: built.map((b) => ({ ...b })),
          links: links.filter((x) => builtIds.has(x.from?.node) && builtIds.has(x.to?.node) && x !== L),
        });
        examples.push({
          source,
          history: history.slice(),
          sketch: sk3,
          nextAction: "wire",
          intentFork: "none",
          exampleId: `${source}#wire:${L.id || L.from.node + '>' + L.to.node}`,
        });
        history.push("wire");
        if (history.length > 8) history.shift();
      }
    }

    // Terminal run suggestion
    if (built.length >= 2) {
      const sk = sketchFromGraph({ nodes: built.map((b) => ({ ...b })), links });
      examples.push({
        source,
        history: history.slice(),
        sketch: sk,
        nextAction: "run",
        intentFork: "none",
        exampleId: `${source}#run`,
      });
    }
  }
  return examples;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const graphs = walkGraphs(GALLERY).filter((p) => !p.includes(`${join("gallery", "samples")}`));
  // Prefer primary graphs + one alternate each; keep all for volume
  const seeds = [1, 2, 3, 5, 8, 13];
  let examples = [];
  for (const p of graphs) {
    examples = examples.concat(bakeGraph(p, seeds));
  }

  // Drop unknown actions (shouldn't happen)
  examples = examples.filter((e) => ACTION_VOCAB.includes(e.nextAction));

  const corpus = {
    schemaVersion: 1,
    product: "next-action",
    label: "Product · 4",
    bakedAt: new Date().toISOString(),
    graphCount: graphs.length,
    exampleCount: examples.length,
    examples,
  };

  const tables = buildFrequencyTables(examples);
  writeFileSync(join(OUT_DIR, "gallery-synth.json"), JSON.stringify(corpus, null, 2));
  writeFileSync(join(OUT_DIR, "frequency-tables.json"), JSON.stringify(tables, null, 2));

  console.log(
    `✓ bake-next-action: ${examples.length} examples from ${graphs.length} graphs → vendor/next-action/corpus/`
  );
}

main();
