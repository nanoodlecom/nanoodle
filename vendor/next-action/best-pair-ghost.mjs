/**
 * Product · 30 — best-pair ghost wire (pure helpers).
 *
 * After idle / a settled run, pick ONE high-prior dangling (out → in) pair
 * so the editor can draw a faint ghost wire between them. Reuses gallery
 * port-pair priors (#621). Never creates a real wire. Flat / missing
 * priors, multi-select, nodes.length < 2, or no matching pair stay quiet.
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
 * Quiet under multi-select (same contract as · 28 / · 29 helpers).
 * @param {{ selectedId?: string|null, selectedIds?: string[] }} graph
 */
function isMultiSelect(graph = {}) {
  return Array.isArray(graph.selectedIds) && graph.selectedIds.length > 1;
}

/**
 * Pick the single best dangling (out, in) pair by gallery pairCount.
 *
 * Confidence gates (same spirit as · 22 / · 29 / port-suggest):
 * - top pair count ≥ MIN_PAIR
 * - top leads second pair by MIN_LEAD
 * - top share of scored-pair mass ≥ MIN_SHARE
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{ nodes?: any[], links?: any[], selectedId?: string|null, selectedIds?: string[] }} graph
 * @param {{ preferSelected?: boolean }} [opts]
 * @returns {{
 *   from: { nodeId: string, port: string, type: string },
 *   to: { nodeId: string, port: string, type: string },
 *   count: number,
 *   share: number
 * } | null}
 */
export function pickBestPairGhost(tables, graph = {}, opts = {}) {
  if (!tables?.topTargets) return null;
  if (isMultiSelect(graph)) return null;
  const nodes = graph.nodes || [];
  if (nodes.length < 2) return null;

  const { outs, ins } = danglingPorts(tables, graph);
  if (!outs.length || !ins.length) return null;

  /**
   * @param {Array<{nodeId:string,port:string,type:string}>} candidateOuts
   * @param {Array<{nodeId:string,port:string,type:string}>} candidateIns
   */
  function pickFrom(candidateOuts, candidateIns) {
    /** @type {Array<{ from: {nodeId:string,port:string,type:string}, to: {nodeId:string,port:string,type:string}, count: number }>} */
    const scored = [];
    for (const out of candidateOuts) {
      if (!out?.nodeId || !out.port || !out.type) continue;
      for (const inn of candidateIns) {
        if (!inn?.nodeId || !inn.port || !inn.type) continue;
        if (inn.nodeId === out.nodeId) continue;
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

  const preferSelected = opts.preferSelected !== false;
  if (preferSelected && graph.selectedId) {
    const selOuts = outs.filter((o) => o.nodeId === graph.selectedId);
    const selIns = ins.filter((o) => o.nodeId === graph.selectedId);
    // Score out-side and in-side pairs involving the selection; keep the stronger.
    let best = null;
    if (selOuts.length) {
      const picked = pickFrom(selOuts, ins);
      if (picked) best = picked;
    }
    if (selIns.length) {
      const picked = pickFrom(outs, selIns);
      if (picked && (!best || picked.count > best.count)) best = picked;
    }
    if (best) return best;
  }
  return pickFrom(outs, ins);
}
