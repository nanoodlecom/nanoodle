/**
 * Product · 12 — Collision-aware nudge (pure helpers, no DOM).
 * After tip/recipe adds stack or · 11's one-shot tidy leaves residual overlap,
 * iteratively push ALL colliding node boxes apart until gaps clear (or N passes).
 * Distinct from · 11: multi-pass / all-pairs; may move any colliding node
 * (including the newly added one); still clamped + gentle.
 *
 * Defaults ~ real editor chrome; prefer measured per-node w/h from the DOM
 * when animating in editor-surface (Image/LLM cards are much taller).
 */

/** Fallback node card size when unmeasured (min-width ~210; short text-ish). */
export const NODE_W = 220;
export const NODE_H = 240;
/** Desired gap between node boxes (beyond AABB). */
export const GAP = 28;
/** Max per-node nudge distance per pass (px) — gentle, no wild fling. */
export const MAX_NUDGE = 96;
/** Soft lerp factor applied to the separation half-vector (0–1). */
export const LERP = 0.55;
/** Default multi-pass iteration cap — enough that tip-stacks usually clear. */
export const MAX_PASSES = 14;
/** Mode-12 tip landing offset: intentional half-card overlap (nudge needed, not staged pile). */
export const TIP_OVERLAP_X = 80;
export const TIP_OVERLAP_Y = 40;

/**
 * @param {{ nodes?: Array<{id:string,x?:number,y?:number,type?:string,w?:number,h?:number}> }} graph
 * @param {{ nodeW?:number, nodeH?:number }} [opts]
 * @returns {{ id:string, x:number, y:number, w:number, h:number, cx:number, cy:number }[]}
 */
export function boxesFromGraph(graph, opts = {}) {
  const defW = opts.nodeW ?? NODE_W;
  const defH = opts.nodeH ?? NODE_H;
  const nodes = (graph && graph.nodes) || [];
  const out = [];
  for (const n of nodes) {
    if (!n || n.id == null) continue;
    if (n.type === "comment") continue; // sticky notes ignored
    const x = Number(n.x);
    const y = Number(n.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const w = Number(n.w);
    const h = Number(n.h);
    const bw = Number.isFinite(w) && w > 0 ? w : defW;
    const bh = Number.isFinite(h) && h > 0 ? h : defH;
    out.push({
      id: String(n.id),
      x,
      y,
      w: bw,
      h: bh,
      cx: x + bw / 2,
      cy: y + bh / 2,
    });
  }
  return out;
}

/**
 * Axis-aligned overlap depth vs desired gap padding (supports unequal sizes).
 * ox/oy > 0 means too close on that axis; both positive ⇒ collide.
 * @returns {{ ox:number, oy:number, overlap:boolean }}
 */
export function overlapDepth(a, b, gap = GAP) {
  const aw = a.w ?? NODE_W;
  const ah = a.h ?? NODE_H;
  const bw = b.w ?? NODE_W;
  const bh = b.h ?? NODE_H;
  const needX = (aw + bw) / 2 + gap;
  const needY = (ah + bh) / 2 + gap;
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const ox = needX - Math.abs(dx);
  const oy = needY - Math.abs(dy);
  return { ox, oy, overlap: ox > 0 && oy > 0 };
}

/**
 * One all-pairs pass: accumulate gentle separation deltas for every colliding pair.
 * Both nodes in a pair may move (half push each). Clamped + lerped.
 *
 * @param {{ nodes?: any[] }} graph
 * @param {{ maxNudge?:number, lerp?:number, nodeW?:number, nodeH?:number, gap?:number }} [opts]
 * @returns {{ id:string, dx:number, dy:number }[]}
 */
export function proposeCollisionDeltas(graph, opts = {}) {
  const maxNudge = opts.maxNudge ?? MAX_NUDGE;
  const lerp = opts.lerp ?? LERP;
  const gap = opts.gap ?? GAP;
  const boxes = boxesFromGraph(graph, opts);
  if (boxes.length < 2) return [];

  /** @type {Map<string, {id:string, dx:number, dy:number}>} */
  const acc = new Map();

  function add(id, dx, dy) {
    const prev = acc.get(id) || { id, dx: 0, dy: 0 };
    prev.dx += dx;
    prev.dy += dy;
    acc.set(id, prev);
  }

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const { ox, oy, overlap } = overlapDepth(a, b, gap);
      if (!overlap) continue;

      let vx = b.cx - a.cx;
      let vy = b.cy - a.cy;
      const len = Math.hypot(vx, vy);
      if (len < 1e-6) {
        // Perfect stack — stable diagonal so both move apart
        vx = 1;
        vy = 0.35;
      } else {
        vx /= len;
        vy /= len;
      }

      const push = Math.min(Math.max(ox, oy) * lerp, maxNudge);
      // Split push across both nodes
      const half = push / 2;
      add(a.id, -vx * half, -vy * half);
      add(b.id, vx * half, vy * half);
    }
  }

  /** @type {{ id:string, dx:number, dy:number }[]} */
  const deltas = [];
  for (const d of acc.values()) {
    let dx = d.dx;
    let dy = d.dy;
    const mag = Math.hypot(dx, dy);
    if (mag > maxNudge) {
      dx = (dx / mag) * maxNudge;
      dy = (dy / mag) * maxNudge;
    }
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    deltas.push({
      id: d.id,
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

/**
 * Min signed pairwise separation. Negative ⇒ still overlapping AABB+gap.
 */
export function minPairGap(graph, deltas, opts = {}) {
  const gap = opts.gap ?? GAP;
  const dmap = new Map((deltas || []).map((d) => [String(d.id), d]));
  const boxes = boxesFromGraph(graph, opts).map((b) => {
    const d = dmap.get(b.id);
    const dx = d ? Number(d.dx) || 0 : 0;
    const dy = d ? Number(d.dy) || 0 : 0;
    return { ...b, cx: b.cx + dx, cy: b.cy + dy, x: b.x + dx, y: b.y + dy };
  });
  let best = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const { ox, oy, overlap } = overlapDepth(boxes[i], boxes[j], gap);
      const signed = overlap ? -Math.min(ox, oy) : -Math.max(ox, oy);
      if (signed < best) best = signed;
    }
  }
  return best === Infinity ? 0 : best;
}

/**
 * Count colliding pairs (AABB + gap).
 */
export function countOverlaps(graph, opts = {}) {
  const gap = opts.gap ?? GAP;
  const boxes = boxesFromGraph(graph, opts);
  let n = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlapDepth(boxes[i], boxes[j], gap).overlap) n++;
    }
  }
  return n;
}

/**
 * Multi-pass planner: returns per-pass absolute positions so the editor can
 * animate slide-apart (rAF lerp) instead of teleporting to the final layout.
 *
 * @param {{ nodes?: any[] }} graph
 * @param {{ maxPasses?:number, maxNudge?:number, lerp?:number, nodeW?:number, nodeH?:number, gap?:number }} [opts]
 * @returns {{
 *   passSnapshots: { positions: {id:string,x:number,y:number}[], overlaps: number }[],
 *   positions: {id:string,x:number,y:number}[],
 *   passes: number,
 *   cleared: boolean,
 *   movedIds: string[],
 * }}
 */
export function planCollisionPasses(graph, opts = {}) {
  const maxPasses = opts.maxPasses ?? MAX_PASSES;
  const nodes = ((graph && graph.nodes) || []).map((n) => ({ ...n }));
  let g = { nodes };
  /** @type {Map<string, {id:string, x:number, y:number}>} */
  const final = new Map();
  /** @type {{ positions: {id:string,x:number,y:number}[], overlaps: number }[]} */
  const passSnapshots = [];
  let passes = 0;

  for (let p = 0; p < maxPasses; p++) {
    if (countOverlaps(g, opts) === 0) break;
    const deltas = proposeCollisionDeltas(g, opts);
    if (!deltas.length) break;
    const abs = applyDeltasAbsolute(g, deltas);
    const byId = new Map(g.nodes.map((n) => [String(n.id), n]));
    for (const pos of abs) {
      const n = byId.get(pos.id);
      if (!n) continue;
      n.x = pos.x;
      n.y = pos.y;
      final.set(pos.id, { id: pos.id, x: pos.x, y: pos.y });
    }
    passes++;
    passSnapshots.push({
      positions: [...final.values()].map((p) => ({ ...p })),
      overlaps: countOverlaps(g, opts),
    });
  }

  const cleared = countOverlaps(g, opts) === 0;
  const positions = [...final.values()];
  return {
    passSnapshots,
    positions,
    passes,
    cleared,
    movedIds: positions.map((p) => p.id),
  };
}

/**
 * Multi-pass all-pairs refine until overlaps clear or maxPasses.
 * (Final positions only — use planCollisionPasses for animated resolve.)
 *
 * @param {{ nodes?: any[] }} graph
 * @param {{ maxPasses?:number, maxNudge?:number, lerp?:number, nodeW?:number, nodeH?:number, gap?:number }} [opts]
 * @returns {{
 *   positions: {id:string,x:number,y:number}[],
 *   passes: number,
 *   cleared: boolean,
 *   movedIds: string[],
 * }}
 */
export function resolveCollisions(graph, opts = {}) {
  const plan = planCollisionPasses(graph, opts);
  return {
    positions: plan.positions,
    passes: plan.passes,
    cleared: plan.cleared,
    movedIds: plan.movedIds,
  };
}

export default {
  NODE_W,
  NODE_H,
  GAP,
  MAX_NUDGE,
  LERP,
  MAX_PASSES,
  TIP_OVERLAP_X,
  TIP_OVERLAP_Y,
  boxesFromGraph,
  overlapDepth,
  proposeCollisionDeltas,
  applyDeltasAbsolute,
  minPairGap,
  countOverlaps,
  planCollisionPasses,
  resolveCollisions,
};
