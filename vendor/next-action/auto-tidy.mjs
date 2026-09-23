/**
 * Product · 11 — Auto-tidy on node add (pure helpers, no DOM).
 * After a tip/recipe add lands tight or stacked, gently push neighbors
 * outward so the new node has breathing room. Not full cool-layout.
 */

/** Approx node card size (editor chrome). */
export const NODE_W = 180;
export const NODE_H = 100;
/** Desired gap between node boxes (beyond AABB). */
export const GAP = 32;
/** Max per-neighbor nudge distance (px). */
export const MAX_NUDGE = 96;
/** Soft lerp factor applied to the separation vector (0–1). */
export const LERP = 0.55;

/**
 * @param {{ nodes?: Array<{id:string,x?:number,y?:number,type?:string}> }} graph
 * @returns {{ id:string, x:number, y:number, cx:number, cy:number }[]}
 */
export function boxesFromGraph(graph) {
  const nodes = (graph && graph.nodes) || [];
  const out = [];
  for (const n of nodes) {
    if (!n || n.id == null) continue;
    if (n.type === "comment") continue; // sticky notes ignored
    const x = Number(n.x);
    const y = Number(n.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      id: String(n.id),
      x,
      y,
      cx: x + NODE_W / 2,
      cy: y + NODE_H / 2,
    });
  }
  return out;
}

/**
 * Axis-aligned overlap depth vs desired gap padding.
 * ox/oy > 0 means too close on that axis; both positive ⇒ collide.
 * @returns {{ ox:number, oy:number, overlap:boolean }}
 */
export function overlapDepth(a, b) {
  const needX = NODE_W + GAP;
  const needY = NODE_H + GAP;
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const ox = needX - Math.abs(dx);
  const oy = needY - Math.abs(dy);
  return { ox, oy, overlap: ox > 0 && oy > 0 };
}

/**
 * Propose gentle neighbor deltas after `newNodeId` was added.
 * Only moves neighbors (never the new node). Clamped + lerped.
 *
 * @param {{ nodes?: any[] }} graph
 * @param {string} newNodeId
 * @param {{ maxNudge?:number, lerp?:number }} [opts]
 * @returns {{ id:string, dx:number, dy:number }[]}
 */
export function proposeTidyDeltas(graph, newNodeId, opts = {}) {
  const maxNudge = opts.maxNudge ?? MAX_NUDGE;
  const lerp = opts.lerp ?? LERP;
  const boxes = boxesFromGraph(graph);
  if (!newNodeId || boxes.length < 2) return [];

  const added = boxes.find((b) => b.id === String(newNodeId));
  if (!added) return [];

  /** @type {{ id:string, dx:number, dy:number }[]} */
  const deltas = [];

  for (const nb of boxes) {
    if (nb.id === added.id) continue;
    const { ox, oy, overlap } = overlapDepth(added, nb);
    if (!overlap) continue;

    let vx = nb.cx - added.cx;
    let vy = nb.cy - added.cy;
    const len = Math.hypot(vx, vy);
    if (len < 1e-6) {
      // Perfect stack — push along a stable diagonal
      vx = 1;
      vy = 0.35;
    } else {
      vx /= len;
      vy /= len;
    }

    const push = Math.min(Math.max(ox, oy) * lerp, maxNudge);
    let dx = vx * push;
    let dy = vy * push;

    const mag = Math.hypot(dx, dy);
    if (mag > maxNudge) {
      dx = (dx / mag) * maxNudge;
      dy = (dy / mag) * maxNudge;
    }
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

    deltas.push({
      id: nb.id,
      dx: Math.round(dx * 10) / 10,
      dy: Math.round(dy * 10) / 10,
    });
  }
  return deltas;
}

/**
 * Apply deltas to a graph snapshot (pure) — returns new absolute positions.
 * @param {{ nodes?: any[] }} graph
 * @param {{ id:string, dx:number, dy:number }[]} deltas
 * @returns {{ id:string, x:number, y:number }[]}
 */
export function applyDeltasAbsolute(graph, deltas) {
  const byId = new Map(
    ((graph && graph.nodes) || []).map((n) => [String(n.id), n])
  );
  const out = [];
  for (const d of deltas || []) {
    const n = byId.get(String(d.id));
    if (!n) continue;
    const x = Number(n.x) + (Number(d.dx) || 0);
    const y = Number(n.y) + (Number(d.dy) || 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ id: String(d.id), x, y });
  }
  return out;
}

/** Convenience alias for toys / editor call sites. */
export function tidyAfterAdd(graph, addedId, opts) {
  return proposeTidyDeltas(graph, addedId, opts);
}

/**
 * Min signed pairwise separation after applying deltas.
 * Negative ⇒ still overlapping AABB+gap; positive ⇒ free air.
 */
export function minPairGap(graph, deltas) {
  const dmap = new Map((deltas || []).map((d) => [String(d.id), d]));
  const boxes = boxesFromGraph(graph).map((b) => {
    const d = dmap.get(b.id);
    const dx = d ? Number(d.dx) || 0 : 0;
    const dy = d ? Number(d.dy) || 0 : 0;
    return { ...b, cx: b.cx + dx, cy: b.cy + dy, x: b.x + dx, y: b.y + dy };
  });
  let best = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const { ox, oy, overlap } = overlapDepth(boxes[i], boxes[j]);
      // When overlapping, signed = -min(ox,oy). When free, signed = -max(ox,oy)
      // (the more-negative axis excess = free space on the separating axis).
      const signed = overlap ? -Math.min(ox, oy) : -Math.max(ox, oy);
      if (signed < best) best = signed;
    }
  }
  return best === Infinity ? 0 : best;
}

export default {
  NODE_W,
  NODE_H,
  GAP,
  MAX_NUDGE,
  LERP,
  boxesFromGraph,
  overlapDepth,
  proposeTidyDeltas,
  tidyAfterAdd,
  applyDeltasAbsolute,
  minPairGap,
};
