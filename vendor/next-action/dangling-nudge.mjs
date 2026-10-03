/**
 * Product · 22 — dangling-port nudge (pure helpers).
 *
 * After the canvas has been idle, pick ONE dangling output whose gallery
 * prior is confident AND that still has a live compatible input on another
 * node. The editor pulses that port inside existing chrome. No wire is created.
 *
 * Quiet when the graph has a single node, the prior is flat, two outputs tie,
 * nothing on the canvas can receive the wire, a drag is in progress, or more
 * than one node is selected. A pulse that does not name a real next drop is
 * not a nudge.
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
 * The source port's own destination row must be confident. A flat
 * topTargets smear never pulses, even if only one output is dangling.
 */
function priorConfident(tables, out) {
  const targets = tables?.topTargets?.[`${out.type}|${out.port}`] || {};
  const ranked = Object.values(targets)
    .map((v) => Number(v) || 0)
    .filter((n) => n > 0)
    .sort((a, b) => b - a);
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
 * Best live gallery pair from this dangling output into a dangling input
 * on a different node. Gallery mass with no partner on the canvas scores 0
 * — there is nothing to drop the wire on.
 */
function liveScore(tables, out, ins) {
  if (!priorConfident(tables, out)) return 0;
  let best = 0;
  for (const inn of ins) {
    if (!inn?.nodeId || inn.nodeId === out.nodeId) continue;
    const c = pairCount(tables, out.type, out.port, inn.type, inn.port);
    if (c > best) best = c;
  }
  return best >= MIN_PAIR ? best : 0;
}

/**
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{ nodes?: any[], links?: any[], selectedId?: string|null, selectedIds?: string[] }} graph
 * @param {{ dragging?: boolean, disabled?: boolean }} [opts]
 * @returns {{ nodeId: string, port: string, type: string, dir: "out", count: number, share: number } | null}
 */
export function pickDanglingNudge(tables, graph = {}, opts = {}) {
  if (opts.disabled || opts.dragging) return null;
  if (!tables?.topTargets) return null;
  if (Array.isArray(graph.selectedIds) && graph.selectedIds.length > 1) return null;
  const nodes = (graph.nodes || []).filter((n) => n && n.id && n.type && n.type !== "comment");
  if (nodes.length < 2) return null;

  const { outs, ins } = danglingPorts(tables, graph);
  if (!outs.length || !ins.length) return null;

  /** @type {Array<{nodeId:string,port:string,type:string,count:number}>} */
  const scored = [];
  for (const o of outs) {
    if (!o?.nodeId || !o.port || !o.type) continue;
    const count = liveScore(tables, o, ins);
    if (count > 0) scored.push({ nodeId: o.nodeId, port: o.port, type: o.type, count });
  }
  if (!scored.length) return null;
  scored.sort(
    (a, b) =>
      b.count - a.count ||
      a.nodeId.localeCompare(b.nodeId) ||
      a.port.localeCompare(b.port)
  );
  const top = scored[0];
  const second = scored[1];
  if (!leads(top.count, second && second.count)) return null;
  const sum = scored.reduce((a, r) => a + r.count, 0);
  const share = top.count / sum;
  if (top.count < MIN_PAIR || share < MIN_SHARE) return null;
  return {
    nodeId: top.nodeId,
    port: top.port,
    type: top.type,
    dir: "out",
    count: top.count,
    share,
  };
}

export { MIN_PAIR, MIN_LEAD, MIN_SHARE };
