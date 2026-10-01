/**
 * Product · 39 — drop-on-node auto-wire (pure helpers).
 *
 * When a single dragged (or newly placed) node lands on another node's body,
 * pick ONE high-prior directed gallery port-pair between them so the editor
 * can call connect() once. Reuses gallery port-pair priors (#621).
 * Quiet when ids missing/same, flat/weak prior, already wired, or no pair.
 */

import {
  MIN_PAIR,
  MIN_LEAD,
  MIN_SHARE,
  danglingPorts,
  pairCount,
} from "./port-suggest.mjs";

/** Minimum intersection / min(area) to treat as a deliberate drop-on. */
export const MIN_OVERLAP_RATIO = 0.22;

function leads(top, second) {
  return !second || second <= 0 || top >= second * MIN_LEAD;
}

/**
 * Axis-aligned box overlap metrics.
 * @param {{x:number,y:number,w:number,h:number}} a
 * @param {{x:number,y:number,w:number,h:number}} b
 * @returns {{ iw:number, ih:number, area:number, ratio:number, centerInB:boolean, centerInA:boolean }}
 */
export function overlapMetrics(a, b) {
  const ax2 = a.x + a.w, ay2 = a.y + a.h;
  const bx2 = b.x + b.w, by2 = b.y + b.h;
  const iw = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const ih = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const area = iw * ih;
  const minArea = Math.max(1, Math.min(a.w * a.h, b.w * b.h));
  const ratio = area / minArea;
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  const centerInB = acx >= b.x && acx <= bx2 && acy >= b.y && acy <= by2;
  const centerInA = bcx >= a.x && bcx <= ax2 && bcy >= a.y && bcy <= ay2;
  return { iw, ih, area, ratio, centerInB, centerInA };
}

/**
 * Pick the best drop target among other node boxes (largest substantial overlap).
 * Self id is never returned. Multi-node drag should not call this.
 *
 * @param {{ id:string, x:number, y:number, w:number, h:number }} dragged
 * @param {Array<{ id:string, x:number, y:number, w:number, h:number }>} others
 * @param {{ minRatio?: number }} [opts]
 * @returns {{ targetId: string, ratio: number, area: number } | null}
 */
export function findDropOverlapTarget(dragged, others = [], opts = {}) {
  if (!dragged?.id || !Array.isArray(others) || !others.length) return null;
  const minRatio = opts.minRatio == null ? MIN_OVERLAP_RATIO : opts.minRatio;
  let best = null;
  for (const o of others) {
    if (!o || !o.id || o.id === dragged.id) continue;
    if (!(o.w > 0 && o.h > 0 && dragged.w > 0 && dragged.h > 0)) continue;
    const m = overlapMetrics(dragged, o);
    const substantial = m.ratio >= minRatio || m.centerInB || m.centerInA;
    if (!substantial || m.area <= 0) continue;
    if (
      !best ||
      m.area > best.area ||
      (m.area === best.area && m.ratio > best.ratio) ||
      (m.area === best.area && m.ratio === best.ratio && o.id.localeCompare(best.targetId) < 0)
    ) {
      best = { targetId: o.id, ratio: m.ratio, area: m.area };
    }
  }
  return best;
}

/**
 * Pick the single best directed gallery pair between dragged and target nodes.
 *
 * Confidence gates (same spirit as · 30 / · 37 / port-suggest):
 * - top pair count ≥ MIN_PAIR
 * - top leads second pair by MIN_LEAD
 * - top share of scored-pair mass ≥ MIN_SHARE
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {{ draggedId?: string, targetId?: string }} ids
 * @returns {{
 *   from: { nodeId: string, port: string, type: string },
 *   to: { nodeId: string, port: string, type: string },
 *   count: number,
 *   share: number
 * } | null}
 */
export function pickDropAutoWire(tables, graph = {}, ids = {}) {
  if (!tables?.topTargets) return null;
  const draggedId = ids.draggedId;
  const targetId = ids.targetId;
  if (!draggedId || !targetId || draggedId === targetId) return null;

  const idSet = new Set([draggedId, targetId]);
  const nodes = (graph.nodes || []).filter((n) => n && idSet.has(n.id));
  if (nodes.length !== 2) return null;
  if (!nodes.some((n) => n.id === draggedId) || !nodes.some((n) => n.id === targetId)) {
    return null;
  }

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
      // Both ends must be the dragged/target pair (sub already filtered).
      if (!idSet.has(out.nodeId) || !idSet.has(inn.nodeId)) continue;
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
