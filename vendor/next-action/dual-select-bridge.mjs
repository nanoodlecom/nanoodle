/**
 * Product · 37 — dual-select bridge suggest (pure helpers).
 *
 * With exactly two selected nodes, pick ONE high-prior directed gallery
 * port-pair (out → in) between them so the editor can soft-pulse those
 * ports and draw a faint ghost wire. Reuses gallery port-pair priors (#621).
 * Quiet when selection count ≠ 2, flat/weak prior, already wired, or no pair.
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
 * Normalize selected ids: prefer selectedIds; fall back to selectedId alone.
 * @param {{ selectedId?: string|null, selectedIds?: string[] }} graph
 * @returns {string[]}
 */
function selectedNodeIds(graph = {}) {
  if (Array.isArray(graph.selectedIds) && graph.selectedIds.length) {
    return [...new Set(graph.selectedIds.filter(Boolean))];
  }
  if (graph.selectedId) return [graph.selectedId];
  return [];
}

/**
 * Pick the single best directed bridge between exactly two selected nodes.
 *
 * Confidence gates (same spirit as · 30 / port-suggest):
 * - top pair count ≥ MIN_PAIR
 * - top leads second pair by MIN_LEAD
 * - top share of scored-pair mass ≥ MIN_SHARE
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{ nodes?: any[], links?: any[], selectedId?: string|null, selectedIds?: string[] }} graph
 * @returns {{
 *   from: { nodeId: string, port: string, type: string },
 *   to: { nodeId: string, port: string, type: string },
 *   count: number,
 *   share: number
 * } | null}
 */
export function pickDualSelectBridge(tables, graph = {}) {
  if (!tables?.topTargets) return null;
  const ids = selectedNodeIds(graph);
  if (ids.length !== 2) return null;

  const idSet = new Set(ids);
  const nodes = (graph.nodes || []).filter((n) => n && idSet.has(n.id));
  if (nodes.length !== 2) return null;

  const sub = {
    nodes,
    links: graph.links || [],
  };
  const { outs, ins } = danglingPorts(tables, sub);
  if (!outs.length || !ins.length) return null;

  /** @type {Array<{ from: {nodeId:string,port:string,type:string}, to: {nodeId:string,port:string,type:string}, count: number }>} */
  const scored = [];
  for (const out of outs) {
    if (!out?.nodeId || !out.port || !out.type) continue;
    for (const inn of ins) {
      if (!inn?.nodeId || !inn.port || !inn.type) continue;
      if (inn.nodeId === out.nodeId) continue;
      // Only bridges between the two selected nodes (both ends already filtered).
      const count = pairCount(tables, out.type, out.port, inn.type, inn.port);
      if (count > 0) {
        scored.push({
          from: { nodeId: out.nodeId, port: out.port, type: out.type },
          to: { nodeId: inn.nodeId, port: inn.port, type: inn.type },
          count,
        });
      }
    }
  }
  if (!scored.length) return null;
  scored.sort(
    (a, b) =>
      b.count - a.count ||
      a.from.nodeId.localeCompare(b.from.nodeId) ||
      a.from.port.localeCompare(b.from.port) ||
      a.to.nodeId.localeCompare(b.to.nodeId) ||
      a.to.port.localeCompare(b.to.port)
  );
  const sum = scored.reduce((a, r) => a + r.count, 0);
  const top = scored[0];
  const second = scored[1];
  const share = top.count / sum;
  if (top.count < MIN_PAIR) return null;
  if (!leads(top.count, second && second.count)) return null;
  if (share < MIN_SHARE) return null;
  return {
    from: top.from,
    to: top.to,
    count: top.count,
    share,
  };
}
