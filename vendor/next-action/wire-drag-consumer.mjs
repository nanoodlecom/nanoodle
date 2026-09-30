/**
 * Product · 32 — wire-drag consumer quick-add polish (pure helpers).
 *
 * While dragging from an **out** port and dropping on empty canvas, softly
 * re-rank #quickadd type candidates by gallery consumer priors for that out
 * (port→type), so obvious sink types float first under Suggested. Quiet when
 * the prior is flat / missing / incompatible. Soft-applies suggestion-memory
 * accept/ignore when a memory object is provided.
 *
 * This is a polish layer on the out→consumer path — not a twin of #621
 * rankDropTypes (which still handles in→producer and is the fallback).
 *
 * No tip panel, no ghost overlay, no ?product= surface. Predictions stay
 * inside the existing #quickadd Suggested rows only.
 */

import { portsOf } from "./port-suggest.mjs";

export const MAX_CONSUMER_SUGGEST = 3;
export const SOURCE = "wire-drag-consumer";
export const REASON = "fits this output";
export const MIN_PAIR = 2;
export const MIN_LEAD = 1.35;
export const MIN_SHARE = 0.18;

/**
 * @typedef {{
 *   typeToType?: Record<string, number>,
 *   portPair?: Record<string, number>,
 *   topTargets?: Record<string, Record<string, number>>,
 *   portCatalog?: Record<string, { inputs: string[], outputs: string[] }>,
 * }} PortSuggestTables
 */

function portNames(ports) {
  const names = [];
  for (const p of ports || []) {
    const name = typeof p === "string" ? p : p && p.name;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Gallery edge count from (srcType, srcPort) into (toType, toPort). */
export function pairCount(tables, fromType, fromPort, toType, toPort) {
  if (!fromType || !fromPort || !toType || !toPort) return 0;
  const n = tables?.topTargets?.[`${fromType}|${fromPort}`]?.[`${toType}|${toPort}`];
  return Number(n) || 0;
}

/**
 * Aggregate consumer type counts for one (srcType|srcPort) against candidates.
 * Picks the best input port per candidate type.
 *
 * @param {PortSuggestTables} tables
 * @param {string} srcType
 * @param {string} srcPort
 * @param {Array<{ type: string, ports?: Array<{ name?: string }|string> }>} candidates
 * @returns {Array<{ type: string, count: number, port: string }>}
 */
export function scoreOutConsumers(tables, srcType, srcPort, candidates) {
  /** @type {Array<{ type: string, count: number, port: string }>} */
  const scored = [];
  if (!tables?.topTargets || !srcType || !srcPort || !Array.isArray(candidates)) {
    return scored;
  }
  for (const c of candidates) {
    if (!c?.type || c.type === "comment") continue;
    const names = portNames(c.ports);
    const fallback = portsOf(tables, c.type).inputs;
    const use = names.length ? names : fallback;
    let best = 0;
    let bestPort = "";
    for (const name of use) {
      const count = pairCount(tables, srcType, srcPort, c.type, name);
      if (count > best || (count === best && count > 0 && name < bestPort)) {
        best = count;
        bestPort = name;
      }
    }
    // Soft type→type fallback when this candidate has no port-pair hit
    if (!(best > 0) && tables.typeToType) {
      const tt = Number(tables.typeToType[`${srcType}→${c.type}`]) || 0;
      if (tt > 0) {
        best = tt * 0.5;
        bestPort = use[0] || fallback[0] || "";
      }
    }
    if (best > 0) scored.push({ type: c.type, count: best, port: bestPort });
  }
  scored.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  return scored;
}

/**
 * Apply suggestion-memory boost to scored rows (mutates scores into weight).
 *
 * @param {Array<{ type: string, count: number, port: string }>} scored
 * @param {{ boost?: (action: string) => number }|null} memory
 * @returns {Array<{ type: string, count: number, port: string, score: number, reason: string, source: string }>}
 */
export function applyMemoryToConsumers(scored, memory) {
  const mem = memory || null;
  return (scored || []).map((r) => {
    let score = Math.max(0, Number(r.count) || 0);
    let reason = REASON;
    if (mem && typeof mem.boost === "function") {
      const b = Number(mem.boost("add:" + r.type)) || 1;
      if (b !== 1) {
        score = (score > 0 ? score : 0.4) * b;
        if (b > 1.05 && !(Number(r.count) > 0)) reason = "you often pick";
      }
    }
    return {
      type: r.type,
      count: r.count,
      port: r.port,
      score,
      reason,
      source: SOURCE,
    };
  });
}

/**
 * Confidence gate: quiet when flat / lead weak / share below threshold / thin mass.
 *
 * @param {Array<{ type: string, count?: number, port?: string, score: number, reason?: string, source?: string }>} rows
 * @param {{ minShare?: number, minLead?: number, max?: number, minPair?: number }} [opts]
 * @returns {{ order: string[], byType: Record<string, { type: string, count: number, share: number, port: string, reason: string, source: string }> } | null}
 */
export function gateWireDragConsumers(rows, opts = {}) {
  const minShare = opts.minShare ?? MIN_SHARE;
  const minLead = opts.minLead ?? MIN_LEAD;
  const max = opts.max ?? MAX_CONSUMER_SUGGEST;
  const minPair = opts.minPair ?? MIN_PAIR;
  if (!Array.isArray(rows) || !rows.length) return null;

  const ranked = rows
    .map((r) => ({
      type: r.type,
      count: Math.max(0, Number(r.count) || 0),
      port: r.port || "",
      score: Math.max(0, Number(r.score) || 0),
      reason: r.reason || REASON,
      source: r.source || SOURCE,
    }))
    .filter((r) => r.type && r.score > 0)
    .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));

  if (!ranked.length) return null;
  const sum = ranked.reduce((a, r) => a + r.score, 0);
  if (!(sum > 0)) return null;

  const top = ranked[0];
  const second = ranked[1];
  const topShare = top.score / sum;
  const leads =
    !second || second.score <= 0 || top.score >= second.score * minLead;
  if (!leads || topShare < minShare) return null;
  // Prefer raw gallery mass for the pair floor (memory alone shouldn't invent a tip)
  if (top.count < minPair && top.score < minPair) return null;

  const order = [];
  /** @type {Record<string, { type: string, count: number, share: number, port: string, reason: string, source: string }>} */
  const byType = {};
  for (const r of ranked) {
    const share = r.score / sum;
    if (share < minShare) continue;
    order.push(r.type);
    byType[r.type] = {
      type: r.type,
      count: r.count,
      share,
      port: r.port,
      reason: r.reason,
      source: r.source,
    };
    if (order.length >= max) break;
  }
  return order.length ? { order, byType } : null;
}

/**
 * Rank consumer types for an **out** wire-drag → empty-canvas quick-add.
 * Returns null for in-dir, missing priors, incompatible candidates, or flat prior.
 *
 * @param {PortSuggestTables} tables
 * @param {{
 *   dir?: "out"|"in",
 *   srcType?: string,
 *   srcPort?: string,
 *   candidates?: Array<{ type: string, ports?: Array<{ name?: string }|string> }>,
 *   memory?: { boost?: (action: string) => number }|null,
 *   minShare?: number,
 *   minLead?: number,
 *   max?: number,
 *   minPair?: number,
 * }} [query]
 * @returns {{ order: string[], byType: Record<string, { type: string, count: number, share: number, port: string, reason: string, source: string }> } | null}
 */
export function rankWireDragConsumers(tables, query = {}) {
  if (!tables?.topTargets) return null;
  const dir = query.dir === "in" ? "in" : "out";
  // Polish is out→consumer only; in→producer stays on rankDropTypes.
  if (dir !== "out") return null;
  const { srcType, srcPort } = query;
  const candidates = query.candidates || [];
  if (!srcType || !srcPort || !candidates.length) return null;

  const scored = scoreOutConsumers(tables, srcType, srcPort, candidates);
  if (!scored.length) return null;
  const weighted = applyMemoryToConsumers(scored, query.memory || null);
  return gateWireDragConsumers(weighted, {
    minShare: query.minShare,
    minLead: query.minLead,
    max: query.max ?? MAX_CONSUMER_SUGGEST,
    minPair: query.minPair,
  });
}

export { portsOf };
