/**
 * Product · 18 — Multi-select aesthetic pack (pure helpers, no DOM).
 * Selection → one-key polish: scoped · 12-style de-overlap among selected
 * ids, then compact cool column/row pack (centroid-anchored). Non-selected
 * nodes stay put. Near-noop when already packed / <2 ids unless force.
 * Self-contained — does not import unmerged · 12 / · 13 modules.
 */

/** Fallback node card size when unmeasured. */
export const NODE_W = 220;
export const NODE_H = 240;
/** Desired gap between selected boxes (beyond AABB). */
export const GAP = 28;
/** Max per-node nudge distance per collision pass (px). */
export const MAX_NUDGE = 96;
/** Soft lerp factor for separation half-vector (0–1). */
export const LERP = 0.55;
/** Collision multi-pass cap among selection. */
export const MAX_PASSES = 12;
/** Horizontal gap between pack columns. */
export const COL_GAP = 280;
/** Vertical gap between stacked nodes in a pack column. */
export const ROW_GAP = 300;
/** Soft lerp toward pack targets (0–1). */
export const PACK_LERP = 0.85;
/** Max per-node travel during pack step (px). */
export const MAX_STEP = 180;
/** Mean distance-to-pack below which we treat selection as already packed. */
export const PACK_EPS = 22;
/** Overlap count among selection above which messy=true. */
export const MESSY_OVERLAP = 1;

const TYPE_COL = {
  text: 0,
  upload: 0,
  aupload: 0,
  vupload: 0,
  comment: -1,
  llm: 1,
  join: 1,
  resize: 1,
  edit: 2,
  image: 2,
  inpaint: 2,
  music: 2,
  tts: 2,
  ivideo: 3,
  vedit: 3,
  video: 3,
  lipsync: 3,
  endpoint: 2,
};

/**
 * @param {{ nodes?: Array<{id:string,x?:number,y?:number,type?:string,w?:number,h?:number}> }} graph
 * @param {{ nodeW?:number, nodeH?:number, ids?: string[] }} [opts]
 */
export function boxesFromGraph(graph, opts = {}) {
  const defW = opts.nodeW ?? NODE_W;
  const defH = opts.nodeH ?? NODE_H;
  const idFilter =
    opts.ids && opts.ids.length ? new Set(opts.ids.map(String)) : null;
  const nodes = (graph && graph.nodes) || [];
  const out = [];
  for (const n of nodes) {
    if (!n || n.id == null) continue;
    if (n.type === "comment") continue;
    const id = String(n.id);
    if (idFilter && !idFilter.has(id)) continue;
    const x = Number(n.x);
    const y = Number(n.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const w = Number(n.w);
    const h = Number(n.h);
    const bw = Number.isFinite(w) && w > 0 ? w : defW;
    const bh = Number.isFinite(h) && h > 0 ? h : defH;
    out.push({
      id,
      x,
      y,
      w: bw,
      h: bh,
      cx: x + bw / 2,
      cy: y + bh / 2,
      type: String(n.type || "text"),
    });
  }
  return out;
}

/**
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
 * One all-pairs pass among (optionally filtered) boxes — both may move.
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
        vx = 1;
        vy = 0.35;
      } else {
        vx /= len;
        vy /= len;
      }
      const push = Math.min(Math.max(ox, oy) * lerp, maxNudge);
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
 * Topo depth for column bias (sources = 0). Uses full graph links.
 */
export function topoDepths(graph) {
  const boxes = boxesFromGraph(graph);
  const ids = new Set(boxes.map((b) => b.id));
  /** @type {Map<string, string[]>} */
  const outs = new Map();
  /** @type {Map<string, number>} */
  const indeg = new Map();
  for (const id of ids) {
    outs.set(id, []);
    indeg.set(id, 0);
  }
  for (const l of (graph && graph.links) || []) {
    const from = String(l?.from?.node ?? l?.from ?? "");
    const to = String(l?.to?.node ?? l?.to ?? "");
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    outs.get(from).push(to);
    indeg.set(to, (indeg.get(to) || 0) + 1);
  }
  /** @type {Map<string, number>} */
  const depth = new Map();
  const q = [];
  for (const id of ids) {
    if ((indeg.get(id) || 0) === 0) {
      q.push(id);
      depth.set(id, 0);
    }
  }
  let qi = 0;
  while (qi < q.length) {
    const u = q[qi++];
    const d = depth.get(u) || 0;
    for (const v of outs.get(u) || []) {
      const nd = Math.max(depth.get(v) ?? 0, d + 1);
      depth.set(v, nd);
      indeg.set(v, (indeg.get(v) || 1) - 1);
      if (indeg.get(v) === 0) q.push(v);
    }
  }
  for (const b of boxes) {
    if (!depth.has(b.id)) {
      const tc = TYPE_COL[b.type];
      depth.set(b.id, Number.isFinite(tc) && tc >= 0 ? tc : 1);
    }
  }
  return depth;
}

function columnFor(box, depth) {
  const d = depth.get(box.id) ?? 0;
  const tc = TYPE_COL[box.type];
  const priorCol = Number.isFinite(tc) && tc >= 0 ? tc : d;
  return Math.max(d, priorCol);
}

/**
 * Compact pack targets for selected ids — neat columns, centroid-anchored.
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {{ ids?: string[], colGap?: number, rowGap?: number, originX?: number, originY?: number }} [opts]
 */
export function proposePackPositions(graph, opts = {}) {
  const boxes = boxesFromGraph(graph, opts);
  if (!boxes.length) return [];

  const depth = topoDepths(graph);
  const colGap = opts.colGap ?? COL_GAP;
  const rowGap = opts.rowGap ?? ROW_GAP;

  /** @type {Map<number, typeof boxes>} */
  const cols = new Map();
  for (const b of boxes) {
    const c = columnFor(b, depth);
    if (!cols.has(c)) cols.set(c, []);
    cols.get(c).push(b);
  }
  const colKeys = [...cols.keys()].sort((a, b) => a - b);
  for (const c of colKeys) {
    cols.get(c).sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
  }

  /** @type {{ id:string, x:number, y:number }[]} */
  const raw = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  colKeys.forEach((c, ci) => {
    const list = cols.get(c);
    list.forEach((b, ri) => {
      const x = ci * colGap;
      const y = ri * rowGap;
      raw.push({ id: b.id, x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + (b.w || NODE_W));
      maxY = Math.max(maxY, y + (b.h || NODE_H));
    });
  });

  let cx = 0;
  let cy = 0;
  for (const b of boxes) {
    cx += b.x + (b.w || NODE_W) / 2;
    cy += b.y + (b.h || NODE_H) / 2;
  }
  cx /= boxes.length;
  cy /= boxes.length;

  const layoutCx = (minX + maxX) / 2;
  const layoutCy = (minY + maxY) / 2;
  const ox = Number.isFinite(opts.originX) ? opts.originX : cx - layoutCx;
  const oy = Number.isFinite(opts.originY) ? opts.originY : cy - layoutCy;

  return raw.map((p) => ({
    id: p.id,
    x: Math.round((p.x + ox) * 10) / 10,
    y: Math.round((p.y + oy) * 10) / 10,
  }));
}

export function meanTargetError(graph, targets) {
  const byId = new Map(
    ((graph && graph.nodes) || []).map((n) => [String(n.id), n])
  );
  let sum = 0;
  let n = 0;
  for (const t of targets || []) {
    const node = byId.get(String(t.id));
    if (!node) continue;
    const x = Number(node.x);
    const y = Number(node.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sum += Math.hypot(Number(t.x) - x, Number(t.y) - y);
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * Propose aesthetic pack: de-overlap selection + compact pack targets.
 * Returns absolute positions (final) for selected ids only.
 *
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {{ ids?: string[], force?: boolean, packLerp?: number, maxStep?: number }} [opts]
 */
export function proposeAestheticPack(graph, opts = {}) {
  const ids = (opts.ids || []).map(String).filter(Boolean);
  const idSet = new Set(ids);
  const selOpts = { ...opts, ids };
  const boxes = boxesFromGraph(graph, selOpts);

  if (boxes.length < 2 && !opts.force) {
    return {
      positions: [],
      targets: [],
      overlaps: 0,
      meanErr: 0,
      packed: true,
      movedIds: [],
      reason: boxes.length < 1 ? "empty" : "single",
    };
  }
  if (boxes.length < 1) {
    return {
      positions: [],
      targets: [],
      overlaps: 0,
      meanErr: 0,
      packed: true,
      movedIds: [],
      reason: "empty",
    };
  }

  // Working copy of selected nodes only (non-selected ignored for geometry)
  const workNodes = ((graph && graph.nodes) || [])
    .filter((n) => idSet.has(String(n.id)))
    .map((n) => ({ ...n }));
  let g = { nodes: workNodes, links: (graph && graph.links) || [] };

  const maxPasses = opts.maxPasses ?? MAX_PASSES;
  for (let p = 0; p < maxPasses; p++) {
    if (countOverlaps(g, selOpts) === 0) break;
    const deltas = proposeCollisionDeltas(g, selOpts);
    if (!deltas.length) break;
    const abs = applyDeltasAbsolute(g, deltas);
    const byId = new Map(g.nodes.map((n) => [String(n.id), n]));
    for (const pos of abs) {
      const n = byId.get(pos.id);
      if (!n) continue;
      n.x = pos.x;
      n.y = pos.y;
    }
  }

  const targets = proposePackPositions(g, selOpts);
  const overlaps = countOverlaps(g, selOpts);
  const meanErr = meanTargetError(g, targets);
  const packEps = opts.packEps ?? PACK_EPS;
  const packed =
    boxes.length >= 2 &&
    overlaps < (opts.messyOverlap ?? MESSY_OVERLAP) &&
    meanErr <= packEps;

  if (packed && !opts.force) {
    return {
      positions: [],
      targets,
      overlaps,
      meanErr,
      packed: true,
      movedIds: [],
      reason: "already-packed",
    };
  }

  const full = !!opts.fullPack;
  const tt = full ? 1 : (opts.packLerp ?? PACK_LERP);
  const maxStep = full ? 1e9 : (opts.maxStep ?? MAX_STEP);
  const byId = new Map(g.nodes.map((n) => [String(n.id), n]));
  /** @type {{ id:string, x:number, y:number, dx:number, dy:number }[]} */
  const positions = [];
  for (const tgt of targets) {
    const n = byId.get(String(tgt.id));
    if (!n) continue;
    const x0 = Number(n.x);
    const y0 = Number(n.y);
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue;
    let dx = (Number(tgt.x) - x0) * tt;
    let dy = (Number(tgt.y) - y0) * tt;
    const mag = Math.hypot(dx, dy);
    if (mag > maxStep && mag > 1e-6) {
      dx = (dx / mag) * maxStep;
      dy = (dy / mag) * maxStep;
    }
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    positions.push({
      id: String(tgt.id),
      x: Math.round((x0 + dx) * 10) / 10,
      y: Math.round((y0 + dy) * 10) / 10,
      dx: Math.round(dx * 10) / 10,
      dy: Math.round(dy * 10) / 10,
    });
  }

  return {
    positions,
    targets,
    overlaps,
    meanErr,
    packed: false,
    movedIds: positions.map((p) => p.id),
    reason: positions.length ? "pack" : "no-move",
  };
}

/**
 * Multi-pass planner for animated polish: collision pass snapshots then final pack.
 * Only selected ids move; non-selected never appear in snapshots.
 *
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {{ ids?: string[], force?: boolean, maxPasses?: number }} [opts]
 */
export function planAestheticPasses(graph, opts = {}) {
  const ids = (opts.ids || []).map(String).filter(Boolean);
  const idSet = new Set(ids);
  const selOpts = { ...opts, ids };

  const allNodes = ((graph && graph.nodes) || []).map((n) => ({ ...n }));
  const workNodes = allNodes.filter((n) => idSet.has(String(n.id)));
  let g = { nodes: workNodes, links: (graph && graph.links) || [] };

  /** @type {{ positions: {id:string,x:number,y:number}[], overlaps: number, kind: string }[]} */
  const passSnapshots = [];
  /** @type {Map<string, {id:string,x:number,y:number}>} */
  const final = new Map();

  if (workNodes.length < 2 && !opts.force) {
    return {
      passSnapshots: [],
      positions: [],
      passes: 0,
      cleared: true,
      packed: true,
      movedIds: [],
      reason: workNodes.length < 1 ? "empty" : "single",
    };
  }

  const maxPasses = opts.maxPasses ?? MAX_PASSES;
  let passes = 0;
  for (let p = 0; p < maxPasses; p++) {
    if (countOverlaps(g, selOpts) === 0) break;
    const deltas = proposeCollisionDeltas(g, selOpts);
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
      overlaps: countOverlaps(g, selOpts),
      kind: "deoverlap",
    });
  }

  const proposal = proposeAestheticPack(
    { nodes: g.nodes, links: g.links },
    {
      ...opts,
      ids,
      force: opts.force || passSnapshots.length > 0,
      fullPack: opts.fullPack !== false,
    }
  );

  // Apply pack onto working graph for final snapshot
  if (proposal.positions.length) {
    const byId = new Map(g.nodes.map((n) => [String(n.id), n]));
    for (const pos of proposal.positions) {
      const n = byId.get(pos.id);
      if (!n) continue;
      n.x = pos.x;
      n.y = pos.y;
      final.set(pos.id, { id: pos.id, x: pos.x, y: pos.y });
    }
    passSnapshots.push({
      positions: [...final.values()].map((p) => ({ ...p })),
      overlaps: countOverlaps(g, selOpts),
      kind: "pack",
    });
    passes++;
  }

  const cleared = countOverlaps(g, selOpts) === 0;
  const positions = [...final.values()];
  const meanErr = meanTargetError(g, proposal.targets);
  const packed =
    cleared && meanErr <= (opts.packEps ?? PACK_EPS) && positions.length >= 0;

  return {
    passSnapshots,
    positions,
    passes,
    cleared,
    packed: packed && (proposal.packed || proposal.reason === "pack"),
    movedIds: positions.map((p) => p.id),
    overlaps: countOverlaps(g, selOpts),
    meanErr,
    targets: proposal.targets,
    reason: proposal.reason,
  };
}

/**
 * Resolve to final positions only (no animation snapshots).
 */
export function resolveAestheticPack(graph, opts = {}) {
  const plan = planAestheticPasses(graph, { fullPack: true, ...opts });
  return {
    positions: plan.positions,
    passes: plan.passes,
    cleared: plan.cleared,
    packed: plan.packed,
    movedIds: plan.movedIds,
    overlaps: plan.overlaps,
    meanErr: plan.meanErr,
    reason: plan.reason,
  };
}

/**
 * Soft scatter targets for Mess selection (selected ids only).
 */
export function proposeMessPositions(graph, opts = {}) {
  const boxes = boxesFromGraph(graph, opts);
  if (!boxes.length) return [];
  let cx = 0;
  let cy = 0;
  for (const b of boxes) {
    cx += b.x;
    cy += b.y;
  }
  cx /= boxes.length;
  cy /= boxes.length;
  return boxes.map((b, i) => {
    const ang = (i / boxes.length) * Math.PI * 2;
    const r = 36 + (i % 3) * 18;
    return {
      id: b.id,
      x: Math.round((cx + Math.cos(ang) * r) * 10) / 10,
      y: Math.round((cy + Math.sin(ang) * r * 0.65) * 10) / 10,
    };
  });
}

export default {
  NODE_W,
  NODE_H,
  GAP,
  MAX_NUDGE,
  LERP,
  MAX_PASSES,
  COL_GAP,
  ROW_GAP,
  PACK_LERP,
  MAX_STEP,
  PACK_EPS,
  MESSY_OVERLAP,
  boxesFromGraph,
  overlapDepth,
  countOverlaps,
  proposeCollisionDeltas,
  applyDeltasAbsolute,
  topoDepths,
  proposePackPositions,
  meanTargetError,
  proposeAestheticPack,
  planAestheticPasses,
  resolveAestheticPack,
  proposeMessPositions,
};
