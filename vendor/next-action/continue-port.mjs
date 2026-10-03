/**
 * Product · 33 — post-wire continue-port (pure helpers).
 *
 * Right after a wire lands, pick ONE remaining dangling port on those two
 * nodes when a live partner elsewhere on the graph can still take it.
 * The editor pulses that port. A tie, a fully used pair, or a leftover
 * port with nowhere to drop stays quiet.
 *
 * Distinct from the idle dangling nudge: the trigger is the wire that just
 * landed, and the search is only the two nodes that wire joined.
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

function liveOutScore(tables, out, ins) {
  let best = 0;
  for (const inn of ins) {
    if (!inn?.nodeId || inn.nodeId === out.nodeId) continue;
    const c = pairCount(tables, out.type, out.port, inn.type, inn.port);
    if (c > best) best = c;
  }
  return best >= MIN_PAIR ? best : 0;
}

function liveInScore(tables, inn, outs) {
  let best = 0;
  for (const out of outs) {
    if (!out?.nodeId || out.nodeId === inn.nodeId) continue;
    const c = pairCount(tables, out.type, out.port, inn.type, inn.port);
    if (c > best) best = c;
  }
  return best >= MIN_PAIR ? best : 0;
}

/**
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{ nodes?: any[], links?: any[], selectedIds?: string[] }} graph
 * @param {{ fromNodeId?: string, toNodeId?: string, fromId?: string, toId?: string }} [opts]
 * @returns {{ nodeId: string, port: string, type: string, dir: "out"|"in", count: number, share: number } | null}
 */
export function pickContinuePort(tables, graph = {}, opts = {}) {
  if (!tables?.topTargets) return null;
  if (Array.isArray(graph.selectedIds) && graph.selectedIds.length > 1) return null;
  const fromNodeId = opts.fromNodeId || opts.fromId || null;
  const toNodeId = opts.toNodeId || opts.toId || null;
  if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return null;
  const nodes = (graph.nodes || []).filter((n) => n && n.id && n.type && n.type !== "comment");
  if (nodes.length < 2) return null;
  const scope = new Set([fromNodeId, toNodeId]);
  if (!nodes.some((n) => scope.has(n.id))) return null;

  const { outs: allOuts, ins: allIns } = danglingPorts(tables, graph);
  const outs = allOuts.filter((o) => scope.has(o.nodeId));
  const ins = allIns.filter((i) => scope.has(i.nodeId));
  if (!outs.length && !ins.length) return null;

  /** @type {Array<{nodeId:string,port:string,type:string,dir:"out"|"in",count:number}>} */
  const scored = [];
  for (const o of outs) {
    if (!o?.nodeId || !o.port || !o.type) continue;
    const count = liveOutScore(tables, o, allIns);
    if (count > 0) scored.push({ nodeId: o.nodeId, port: o.port, type: o.type, dir: "out", count });
  }
  for (const inn of ins) {
    if (!inn?.nodeId || !inn.port || !inn.type) continue;
    const count = liveInScore(tables, inn, allOuts);
    if (count > 0) scored.push({ nodeId: inn.nodeId, port: inn.port, type: inn.type, dir: "in", count });
  }
  if (!scored.length) return null;
  scored.sort(
    (a, b) =>
      b.count - a.count ||
      a.nodeId.localeCompare(b.nodeId) ||
      a.port.localeCompare(b.port) ||
      a.dir.localeCompare(b.dir)
  );
  const top = scored[0];
  const second = scored[1];
  // Two near-tied leftovers do not pick a side. One clear leftover does.
  if (!leads(top.count, second && second.count)) return null;
  const sum = scored.reduce((a, r) => a + r.count, 0);
  const share = top.count / sum;
  if (top.count < MIN_PAIR || share < MIN_SHARE) return null;
  return { ...top, share };
}

export { MIN_PAIR, MIN_LEAD, MIN_SHARE };
