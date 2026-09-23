/** Encode last-K action tokens + graph sketch → fixed float vector (Product · 1/· 2). */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(HERE, "schema.json"), "utf8"));

export const schema = SCHEMA;
export const ACTION_VOCAB = SCHEMA.actionVocab;
export const NODE_TYPES = SCHEMA.nodeTypes;
export const INTENT_FORKS = SCHEMA.intentForkTags;
export const K = SCHEMA.K;

export function actionIndex(token) {
  const i = ACTION_VOCAB.indexOf(token);
  if (i < 0) throw new Error(`unknown action token: ${token}`);
  return i;
}

export function nodeTypeIndex(t) {
  const i = NODE_TYPES.indexOf(t);
  return i < 0 ? -1 : i;
}

export function intentForkIndex(tag) {
  const i = INTENT_FORKS.indexOf(tag || "none");
  return i < 0 ? 0 : i;
}

/** Dimensions of the encoded feature vector. */
export function inputSize() {
  const V = ACTION_VOCAB.length;
  const T = NODE_TYPES.length;
  // K one-hots + type counts + 5 scalars + selected one-hot
  return K * V + T + 5 + T;
}

export function outputSize() {
  return ACTION_VOCAB.length;
}

/**
 * @param {string[]} history newest-last action tokens (length <= K)
 * @param {{
 *   nodeTypeCounts?: Record<string, number>,
 *   numNodes?: number,
 *   numLinks?: number,
 *   danglingOut?: number,
 *   danglingIn?: number,
 *   selectedType?: string | null,
 * }} sketch
 * @returns {Float32Array}
 */
export function encodeState(history, sketch = {}) {
  const V = ACTION_VOCAB.length;
  const T = NODE_TYPES.length;
  const cap = SCHEMA.encode.countNormCap || 8;
  const out = new Float32Array(inputSize());
  let o = 0;

  const hist = Array.isArray(history) ? history.slice(-K) : [];
  const pad = K - hist.length;
  for (let s = 0; s < K; s++) {
    const tok = s < pad ? null : hist[s - pad];
    if (tok != null) {
      const ai = ACTION_VOCAB.indexOf(tok);
      if (ai >= 0) out[o + ai] = 1;
    }
    o += V;
  }

  const counts = sketch.nodeTypeCounts || {};
  for (let i = 0; i < T; i++) {
    const c = counts[NODE_TYPES[i]] || 0;
    out[o + i] = Math.min(c, cap) / cap;
  }
  o += T;

  const nNodes = sketch.numNodes || 0;
  const nLinks = sketch.numLinks || 0;
  out[o++] = Math.min(nNodes, cap) / cap;
  out[o++] = Math.min(nLinks, cap) / cap;
  out[o++] = sketch.danglingOut ? 1 : 0;
  out[o++] = sketch.danglingIn ? 1 : 0;
  out[o++] = nNodes === 0 ? 1 : 0; // emptyCanvas

  const sel = sketch.selectedType || null;
  const si = sel ? NODE_TYPES.indexOf(sel) : -1;
  if (si >= 0) out[o + si] = 1;
  o += T;

  if (o !== out.length) throw new Error(`encode length drift ${o} != ${out.length}`);
  return out;
}

/** Build a sketch from a partial graph { nodes, links, selectedId? }. */
export function sketchFromGraph(graph = {}) {
  const nodes = graph.nodes || [];
  const links = graph.links || [];
  const counts = Object.fromEntries(NODE_TYPES.map((t) => [t, 0]));
  const byId = new Map();
  for (const n of nodes) {
    byId.set(n.id, n);
    if (counts[n.type] != null) counts[n.type]++;
    else if (NODE_TYPES.includes("comment") && n.type === "comment") counts.comment++;
  }
  const hasOut = new Set();
  const hasIn = new Set();
  for (const L of links) {
    if (L.from?.node) hasOut.add(L.from.node);
    if (L.to?.node) hasIn.add(L.to.node);
  }
  let danglingOut = 0;
  let danglingIn = 0;
  for (const n of nodes) {
    if (n.type === "comment") continue;
    if (!hasOut.has(n.id)) danglingOut++;
    if (!hasIn.has(n.id)) danglingIn++;
  }
  let selectedType = null;
  if (graph.selectedId && byId.has(graph.selectedId)) {
    selectedType = byId.get(graph.selectedId).type;
  }
  return {
    nodeTypeCounts: counts,
    numNodes: nodes.filter((n) => n.type !== "comment").length,
    numLinks: links.length,
    danglingOut,
    danglingIn,
    selectedType,
  };
}

export function smallnetManifest(overrides = {}) {
  const hid = SCHEMA.smallnet.hidden;
  const inS = inputSize();
  const outS = outputSize();
  return {
    id: SCHEMA.smallnet.id,
    version: String(SCHEMA.schemaVersion),
    format: SCHEMA.smallnet.format,
    inputSize: inS,
    outputSize: outS,
    layers: [
      { type: "linear", in: inS, out: hid, activation: SCHEMA.smallnet.activation },
      { type: "linear", in: hid, out: outS, activation: SCHEMA.smallnet.outputActivation },
    ],
    weightsUrl: null,
    ...overrides,
  };
}
