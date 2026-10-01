/**
 * Product · 48 — quickadd-after-abort origin-fit (pure helpers).
 *
 * When a canceled wire drag opens #quickadd (drop on empty canvas), softly
 * re-rank Suggested type candidates by gallery consumer/producer priors for
 * the aborted origin port (type|port|dir), so the resume add is obvious.
 *
 * Distinct from · 32 (live out-drag consumer polish), · 35 (live in-drag
 * producer polish), and · 46 (abort → pulse origin port). This module is the
 * after-abort Suggested re-rank for both dirs, self-contained on main.
 *
 * Quiet when flat / missing / incompatible. Soft-applies suggestion-memory
 * when provided. No tip panel, no ghost overlay, no ?product= surface —
 * predictions stay inside existing #quickadd Suggested rows only.
 */

import { portsOf } from "./port-suggest.mjs";

export const MAX_ORIGIN_FIT = 3;
export const SOURCE = "quickadd-after-abort";
export const REASON_OUT = "Uses this output";
export const REASON_IN = "Provides this input";
export const MIN_PAIR = 2;
export const MIN_LEAD = 1.35;
export const MIN_SHARE = 0.18;

/** Short, translatable reasons describe what selecting the row will connect. */
export function originFitReason(dir, ptype) {
  const reasons = dir === "in"
    ? { text: "Provides text", image: "Provides an image", video: "Provides video", audio: "Provides audio", model3d: "Provides a 3D model" }
    : { text: "Uses this text", image: "Uses this image", video: "Uses this video", audio: "Uses this audio", model3d: "Uses this 3D model" };
  return reasons[ptype] || (dir === "in" ? REASON_IN : REASON_OUT);
}

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
 * Aggregate consumer type counts for one aborted out port (srcType|srcPort).
 * @param {PortSuggestTables} tables
 * @param {string} srcType
 * @param {string} srcPort
 * @param {Array<{ type: string, ports?: Array<{ name?: string }|string> }>} candidates
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
 * Aggregate producer type counts for one aborted in port (dstType|dstPort).
 * @param {PortSuggestTables} tables
 * @param {string} dstType
 * @param {string} dstPort
 * @param {Array<{ type: string, ports?: Array<{ name?: string }|string> }>} candidates
 */
export function scoreInProducers(tables, dstType, dstPort, candidates) {
  /** @type {Array<{ type: string, count: number, port: string }>} */
  const scored = [];
  if (!tables?.topTargets || !dstType || !dstPort || !Array.isArray(candidates)) {
    return scored;
  }
  for (const c of candidates) {
    if (!c?.type || c.type === "comment") continue;
    const names = portNames(c.ports);
    const fallback = portsOf(tables, c.type).outputs;
    const use = names.length ? names : fallback;
    let best = 0;
    let bestPort = "";
    for (const name of use) {
      const count = pairCount(tables, c.type, name, dstType, dstPort);
      if (count > best || (count === best && count > 0 && name < bestPort)) {
        best = count;
        bestPort = name;
      }
    }
    if (!(best > 0) && tables.typeToType) {
      const tt = Number(tables.typeToType[`${c.type}→${dstType}`]) || 0;
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
 * Apply suggestion-memory boost (mutates scores into weight).
 * @param {Array<{ type: string, count: number, port: string }>} scored
 * @param {{ boost?: (action: string) => number }|null} memory
 * @param {"out"|"in"} dir
 */
export function applyMemoryToOriginFit(scored, memory, dir, ptype) {
  const mem = memory || null;
  const reason = originFitReason(dir, ptype);
  return (scored || []).map((r) => {
    let score = Math.max(0, Number(r.count) || 0);
    let why = reason;
    if (mem && typeof mem.boost === "function") {
      const b = Number(mem.boost("add:" + r.type)) || 1;
      if (b !== 1) {
        score = (score > 0 ? score : 0.4) * b;
        if (b > 1.05 && !(Number(r.count) > 0)) why = "you often pick";
      }
    }
    return {
      type: r.type,
      count: r.count,
      port: r.port,
      score,
      reason: why,
      source: SOURCE,
    };
  });
}

/**
 * Confidence gate: quiet when flat / lead weak / share below threshold / thin mass.
 * @param {Array<{ type: string, count?: number, port?: string, score: number, reason?: string, source?: string }>} rows
 * @param {{ minShare?: number, minLead?: number, max?: number, minPair?: number }} [opts]
 */
export function gateOriginFit(rows, opts = {}) {
  const minShare = opts.minShare ?? MIN_SHARE;
  const minLead = opts.minLead ?? MIN_LEAD;
  const max = opts.max ?? MAX_ORIGIN_FIT;
  const minPair = opts.minPair ?? MIN_PAIR;
  if (!Array.isArray(rows) || !rows.length) return null;

  const ranked = rows
    .map((r) => ({
      type: r.type,
      count: Math.max(0, Number(r.count) || 0),
      port: r.port || "",
      score: Math.max(0, Number(r.score) || 0),
      reason: r.reason || REASON_OUT,
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
 * Rank Suggested types for an aborted wire drag that opens #quickadd.
 * Handles both out→consumer and in→producer. Returns null when quiet.
 *
 * @param {PortSuggestTables} tables
 * @param {{
 *   dir?: "out"|"in",
 *   srcType?: string,
 *   srcPort?: string,
 *   ptype?: string,
 *   candidates?: Array<{ type: string, ports?: Array<{ name?: string }|string> }>,
 *   memory?: { boost?: (action: string) => number }|null,
 *   minShare?: number,
 *   minLead?: number,
 *   max?: number,
 *   minPair?: number,
 * }} [query]
 */
export function rankQuickaddAfterAbort(tables, query = {}) {
  if (!tables?.topTargets) return null;
  const dir = query.dir === "in" ? "in" : "out";
  const { srcType, srcPort } = query;
  const candidates = query.candidates || [];
  if (!srcType || !srcPort || !candidates.length) return null;

  const scored =
    dir === "in"
      ? scoreInProducers(tables, srcType, srcPort, candidates)
      : scoreOutConsumers(tables, srcType, srcPort, candidates);
  if (!scored.length) return null;
  const weighted = applyMemoryToOriginFit(scored, query.memory || null, dir, query.ptype);
  return gateOriginFit(weighted, {
    minShare: query.minShare,
    minLead: query.minLead,
    max: query.max ?? MAX_ORIGIN_FIT,
    minPair: query.minPair,
  });
}

export { portsOf };
