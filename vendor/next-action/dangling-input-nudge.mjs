/**
 * Product · 29 — dangling-input nudge (pure helpers).
 *
 * After idle / a settled run, pick ONE high-prior unwired input so the
 * editor can soft-pulse it inside existing node chrome. Reuses gallery
 * port-pair priors (#621), inverted for the destination side (mirror of
 * · 22 dangling-output nudge). Never creates a wire. Flat / missing
 * priors, multi-select, or no hungry inputs stay quiet.
 */

import {
  MIN_PAIR,
  MIN_LEAD,
  MIN_SHARE,
  danglingPorts,
  pairCount,
} from "./port-suggest.mjs";

function leads(top, second) {
  return !second || second <= 0 || top >= second * MIN_LEAD;
}

/**
 * Inbound source counts for one destination port (invert topTargets).
 * @returns {number[]} positive counts, unsorted
 */
function inboundCounts(tables, inn) {
  const destKey = `${inn.type}|${inn.port}`;
  const out = [];
  const targets = tables?.topTargets;
  if (!targets) return out;
  for (const row of Object.values(targets)) {
    if (!row || typeof row !== "object") continue;
    const n = Number(row[destKey]) || 0;
    if (n > 0) out.push(n);
  }
  return out;
}

/**
 * Destination-port prior must itself be confident: some source(s) clearly
 * feed this input in the gallery (same gates as · 22 / port-suggest).
 */
function priorConfident(tables, inn) {
  const ranked = inboundCounts(tables, inn).sort((a, b) => b - a);
  if (!ranked.length) return false;
  const sum = ranked.reduce((a, b) => a + b, 0);
  const top = ranked[0];
  const second = ranked[1];
  if (top < MIN_PAIR) return false;
  if (!leads(top, second)) return false;
  if (top / sum < MIN_SHARE) return false;
  return true;
}

/**
 * Score a dangling in: max gallery prior from any dangling-compatible out,
 * else the strongest inbound topTargets mass for that destination port.
 */
function scoreIn(tables, inn, outs) {
  if (!priorConfident(tables, inn)) return 0;
  let best = 0;
  for (const out of outs) {
    if (!out?.nodeId || out.nodeId === inn.nodeId) continue;
    const c = pairCount(tables, out.type, out.port, inn.type, inn.port);
    if (c > best) best = c;
  }
  if (best > 0) return best;
  const ranked = inboundCounts(tables, inn);
  let mass = 0;
  for (const n of ranked) {
    if (n > mass) mass = n;
  }
  return mass;
}

/**
 * Quiet under multi-select (same contract as · 28 selected helpers).
 * @param {{ selectedId?: string|null, selectedIds?: string[] }} graph
 */
function isMultiSelect(graph = {}) {
  return Array.isArray(graph.selectedIds) && graph.selectedIds.length > 1;
}

/**
 * Pick one dangling input to nudge.
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{ nodes?: any[], links?: any[], selectedId?: string|null, selectedIds?: string[] }} graph
 * @param {{ preferSelected?: boolean }} [opts]
 * @returns {{ nodeId: string, port: string, type: string, count: number, share: number } | null}
 */
export function pickDanglingInputNudge(tables, graph = {}, opts = {}) {
  if (!tables?.topTargets) return null;
  if (isMultiSelect(graph)) return null;
  const nodes = graph.nodes || [];
  if (nodes.length < 2) return null;

  const { outs, ins } = danglingPorts(tables, graph);
  if (!ins.length) return null;

  /**
   * @param {Array<{nodeId:string,port:string,type:string}>} candidateIns
   */
  function pickFrom(candidateIns) {
    /** @type {Array<{nodeId:string,port:string,type:string,count:number}>} */
    const scored = [];
    for (const inn of candidateIns) {
      if (!inn?.nodeId || !inn.port || !inn.type) continue;
      const count = scoreIn(tables, inn, outs);
      if (count > 0) scored.push({ nodeId: inn.nodeId, port: inn.port, type: inn.type, count });
    }
    if (!scored.length) return null;
    scored.sort(
      (a, b) =>
        b.count - a.count ||
        a.nodeId.localeCompare(b.nodeId) ||
        a.port.localeCompare(b.port)
    );
    const sum = scored.reduce((a, r) => a + r.count, 0);
    const top = scored[0];
    const second = scored[1];
    const share = top.count / sum;
    if (top.count < MIN_PAIR) return null;
    if (!leads(top.count, second && second.count)) return null;
    if (share < MIN_SHARE) return null;
    return {
      nodeId: top.nodeId,
      port: top.port,
      type: top.type,
      count: top.count,
      share,
    };
  }

  const preferSelected = opts.preferSelected !== false;
  if (preferSelected && graph.selectedId) {
    const sel = ins.filter((o) => o.nodeId === graph.selectedId);
    if (sel.length) {
      const picked = pickFrom(sel);
      if (picked) return picked;
    }
  }
  return pickFrom(ins);
}
