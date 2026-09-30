/**
 * Product · 28 — selected input producer suggest (pure helpers).
 *
 * With exactly one node selected that has an unwired input, softly lift
 * gallery-common producer node types that feed that input into Suggested
 * (ranked first + small "suggested" tag + short reason). Quiet when
 * nothing is selected, no dangling input, or the prior is flat.
 *
 * Signal: gallery edge / port-producer priors (invert port-suggest
 * topTargets / typeToType) + suggestion-memory. Soft-merge must not stomp
 * stronger sources (selected-output-consumer / recipe / post-first /
 * learned / first-trio / empty-followup / add-search-popular / …)
 * already present in prior Suggested rows.
 *
 * No tip panel, no ghost overlay, no ?product= surface. Callers leave
 * add-node / search lists exactly as today when unsure.
 */

import { MIN_SHARE, MIN_LEAD } from "./hints.mjs";
import { danglingPorts, portsOf } from "./port-suggest.mjs";

export const MAX_PRODUCER_SUGGEST = 3;
export const SOURCE = "selected-input-producer";
export const REASON = "feeds selected input";
export const MIN_PAIR = 2;

/** Sources that already own a stronger Suggested lift — keep their reason. */
export const STRONG_SOURCES = Object.freeze([
  "first-trio",
  "recipe",
  "post-first",
  "learned",
  "cold-start",
  "first-node",
  "empty-followup",
  "add-search-popular",
  "selected-output-consumer",
]);

/**
 * Resolve the single selected node. Multi-select / missing → null.
 * @param {{ nodes?: any[], selectedId?: string|null, selectedIds?: string[] }} graph
 */
export function selectedNode(graph = {}) {
  if (Array.isArray(graph.selectedIds) && graph.selectedIds.length > 1) {
    return null;
  }
  const id =
    graph && graph.selectedId
      ? graph.selectedId
      : Array.isArray(graph.selectedIds) && graph.selectedIds.length === 1
        ? graph.selectedIds[0]
        : null;
  if (!id) return null;
  const nodes = graph.nodes || [];
  const n = nodes.find((x) => x && x.id === id);
  if (!n || !n.type || n.type === "comment") return null;
  return n;
}

/**
 * Unwired inputs on the selected node (uses port catalog + live links).
 * @param {import("./port-suggest.mjs").PortSuggestTables} portTables
 * @param {{ nodes?: any[], links?: any[], selectedId?: string|null }} graph
 * @returns {Array<{nodeId:string, port:string, type:string}>}
 */
export function selectedDanglingInputs(portTables, graph = {}) {
  const sel = selectedNode(graph);
  if (!sel || !portTables) return [];
  const { ins } = danglingPorts(portTables, graph);
  return ins.filter((o) => o.nodeId === sel.id);
}

/**
 * Aggregate producer type counts for one or more (dstType|dstPort) keys
 * by inverting topTargets (srcType|srcPort → {dstType|dstPort: count}).
 * @param {import("./port-suggest.mjs").PortSuggestTables} portTables
 * @param {Array<{type:string, port:string}>} inputs
 * @returns {Record<string, number>} type → count
 */
export function producerCountsForInputs(portTables, inputs) {
  /** @type {Record<string, number>} */
  const counts = {};
  if (!portTables?.topTargets || !Array.isArray(inputs)) return counts;
  const want = new Set();
  for (const inp of inputs) {
    if (!inp?.type || !inp?.port) continue;
    want.add(`${inp.type}|${inp.port}`);
  }
  if (!want.size) return counts;
  for (const [srcKey, targets] of Object.entries(portTables.topTargets)) {
    if (!targets || typeof targets !== "object") continue;
    const fromType = String(srcKey).split("|")[0];
    if (!fromType || fromType === "comment") continue;
    for (const [dstKey, n] of Object.entries(targets)) {
      if (!want.has(String(dstKey))) continue;
      const c = Number(n) || 0;
      if (!(c > 0)) continue;
      counts[fromType] = (counts[fromType] || 0) + c;
    }
  }
  return counts;
}

/**
 * Soft type→type fallback when port-pair mass is thin but type edges exist.
 * Invert typeToType keys ending with `→selType` (or prefix-scan `*→selType`).
 * @param {import("./port-suggest.mjs").PortSuggestTables} portTables
 * @param {string} selType
 * @returns {Record<string, number>}
 */
export function typeToTypeProducers(portTables, selType) {
  /** @type {Record<string, number>} */
  const counts = {};
  if (!portTables?.typeToType || !selType) return counts;
  const suffix = `→${selType}`;
  for (const [k, n] of Object.entries(portTables.typeToType)) {
    if (!String(k).endsWith(suffix)) continue;
    const fromType = String(k).slice(0, -suffix.length);
    if (!fromType || fromType === "comment") continue;
    const c = Number(n) || 0;
    if (!(c > 0)) continue;
    counts[fromType] = (counts[fromType] || 0) + c;
  }
  return counts;
}

/**
 * Raw scored add:* producer rows (before confidence gate).
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} portTables
 * @param {{ nodes?: any[], links?: any[], selectedId?: string|null }} graph
 * @param {{
 *   memory?: { boost?: (action:string)=>number }|null,
 *   nodeTypes?: Set<string>|null,
 *   k?: number,
 * }} [opts]
 * @returns {Array<{action:string, type:string, score:number, source:string, reason:string}>}
 */
export function scoreSelectedProducers(portTables, graph = {}, opts = {}) {
  const sel = selectedNode(graph);
  if (!sel || !portTables?.topTargets) return [];
  const inputs = selectedDanglingInputs(portTables, graph);
  if (!inputs.length) return [];

  let counts = producerCountsForInputs(portTables, inputs);
  const portMass = Object.values(counts).reduce((a, n) => a + n, 0);
  // Soft type→type blend when port pairs are sparse
  if (portMass < MIN_PAIR) {
    const tt = typeToTypeProducers(portTables, sel.type);
    for (const [t, n] of Object.entries(tt)) {
      counts[t] = (counts[t] || 0) + n * 0.5;
    }
  }

  const mem = opts.memory || null;
  const known = opts.nodeTypes || null;
  const k = opts.k ?? MAX_PRODUCER_SUGGEST;

  /** @type {Array<{action:string, type:string, score:number, source:string, reason:string}>} */
  const rows = [];
  for (const [type, baseRaw] of Object.entries(counts)) {
    if (!type || type === "comment") continue;
    if (known && !known.has(type)) continue;
    const action = "add:" + type;
    let score = Math.max(0, Number(baseRaw) || 0);
    let source = SOURCE;
    let reason = REASON;
    if (mem && typeof mem.boost === "function") {
      const b = Number(mem.boost(action)) || 1;
      if (b !== 1) {
        score = (score > 0 ? score : 0.4) * b;
        if (b > 1.05 && !(Number(baseRaw) > 0)) {
          reason = "you often pick";
        }
      }
    }
    if (!(score > 0)) continue;
    rows.push({ action, type, score, source, reason });
  }

  rows.sort(
    (a, b) => b.score - a.score || a.action.localeCompare(b.action)
  );
  return rows.slice(0, Math.max(k * 4, k));
}

/**
 * Confidence gate matching projectHints (share + lead). [] when thin/flat.
 *
 * @param {Array<{action:string, score:number, type?:string, source?:string, reason?:string}>} rows
 * @param {{ minShare?: number, minLead?: number, max?: number, minPair?: number }} [opts]
 */
export function gateConfidentProducers(rows, opts = {}) {
  const minShare = opts.minShare ?? MIN_SHARE;
  const minLead = opts.minLead ?? MIN_LEAD;
  const max = opts.max ?? MAX_PRODUCER_SUGGEST;
  const minPair = opts.minPair ?? MIN_PAIR;
  if (!Array.isArray(rows) || !rows.length) return [];
  const sum = rows.reduce((a, r) => a + Math.max(0, Number(r.score) || 0), 0);
  if (!(sum > 0)) return [];
  const ranked = rows
    .map((r) => ({
      ...r,
      action: String(r.action || ""),
      type: r.type || String(r.action || "").replace(/^add:/, ""),
      score: Math.max(0, Number(r.score) || 0),
      share: Math.max(0, Number(r.score) || 0) / sum,
      source: r.source || SOURCE,
      reason: r.reason || REASON,
    }))
    .filter((r) => r.action)
    .sort((a, b) => b.share - a.share || a.action.localeCompare(b.action));
  if (!ranked.length) return [];
  const top = ranked[0];
  const second = ranked[1];
  const leads =
    !second || second.share <= 0 || top.share >= second.share * minLead;
  if (!leads || top.share < minShare) return [];
  if (top.score < minPair) return [];
  const out = [];
  for (const r of ranked) {
    if (r.share < minShare) continue;
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Rank producer types that feed the selected node's unwired input(s).
 * Quiet ([]) when no selection, no dangling input, or flat prior.
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} portTables
 * @param {{ nodes?: any[], links?: any[], selectedId?: string|null }} graph
 * @param {{
 *   memory?: { boost?: (action:string)=>number }|null,
 *   nodeTypes?: Set<string>|null,
 *   minShare?: number,
 *   minLead?: number,
 *   max?: number,
 *   minPair?: number,
 * }} [opts]
 */
export function rankSelectedInputProducers(portTables, graph = {}, opts = {}) {
  const scored = scoreSelectedProducers(portTables, graph, {
    memory: opts.memory || null,
    nodeTypes: opts.nodeTypes || null,
    k: opts.max ?? MAX_PRODUCER_SUGGEST,
  });
  return gateConfidentProducers(scored, {
    minShare: opts.minShare,
    minLead: opts.minLead,
    max: opts.max ?? MAX_PRODUCER_SUGGEST,
    minPair: opts.minPair,
  });
}

/**
 * Soft-merge producer hits into prior Suggested add rows.
 * Does not stomp stronger sources already present for the same type.
 * No hits → prior unchanged.
 *
 * @param {Array<{type:string, action?:string, reason?:string, source?:string, share?:number}>} priorAdds
 * @param {Array<{type:string, action?:string, reason?:string, source?:string, share?:number}>} producerHits
 * @param {{ max?: number }} [opts]
 */
export function softMergeSelectedProducers(priorAdds, producerHits, opts = {}) {
  const max = opts.max ?? MAX_PRODUCER_SUGGEST;
  const prior = Array.isArray(priorAdds) ? priorAdds : [];
  const hits = Array.isArray(producerHits) ? producerHits : [];
  if (!hits.length) return prior.slice(0, max);

  /** @type {Map<string, {type:string, action:string, reason:string, source:string, share:number}>} */
  const by = new Map();
  for (const a of prior) {
    if (!a || !a.type) continue;
    by.set(a.type, {
      type: a.type,
      action: a.action || "add:" + a.type,
      reason: a.reason || "often added next",
      source: a.source || "",
      share: Number(a.share) || 0,
    });
  }
  for (const h of hits) {
    if (!h || !h.type) continue;
    const existing = by.get(h.type);
    if (existing && STRONG_SOURCES.includes(existing.source)) {
      continue;
    }
    if (existing && existing.source && existing.source !== SOURCE) {
      continue;
    }
    by.set(h.type, {
      type: h.type,
      action: h.action || "add:" + h.type,
      reason: h.reason || REASON,
      source: h.source || SOURCE,
      share: Number(h.share) || 0,
    });
  }

  const ordered = [];
  const seen = new Set();
  for (const a of prior) {
    if (!a || !a.type || seen.has(a.type)) continue;
    if (!by.has(a.type)) continue;
    ordered.push(by.get(a.type));
    seen.add(a.type);
  }
  const extras = [...by.values()]
    .filter((r) => !seen.has(r.type))
    .sort((a, b) => b.share - a.share || a.type.localeCompare(b.type));
  for (const r of extras) {
    ordered.push(r);
    seen.add(r.type);
    if (ordered.length >= max) break;
  }
  return ordered.slice(0, max);
}

export { MIN_SHARE, MIN_LEAD, portsOf };
