/**
 * Product · 19 — Paired 2D transport for layout deltas (pure helpers, no DOM).
 * Match current graph → nearest messy exemplar, pull paired cool layout,
 * emit per-node delta field (cool − messy), soft-apply with LERP / MAX_STEP.
 * Distinct from · 11 tidy / · 12 collision / · 13 cool-layout snap / · 18 aesthetic pack:
 * · 19 is paired-example transport of a delta field, not snap-to-prior or de-overlap.
 * Box-friendly heuristic / table-driven pairs (no ParticleGAN train this tick).
 * Structure allows a later develop paired-error weight file to plug in via
 * PAIRED_EXEMPLARS / optional corpus JSON.
 */

/** Approx node card size (editor chrome) — keep in sync with · 11–· 13. */
export const NODE_W = 180;
export const NODE_H = 100;
/** Soft lerp factor along transport deltas (0–1). */
export const LERP = 0.6;
/** Max per-node travel this apply (px). */
export const MAX_STEP = 140;
/** Mean |Δ| below which we treat graph as already cool / near-noop. */
export const COOL_EPS = 16;
/** Horizontal gap in baked cool LTR columns. */
export const COL_GAP = 220;
/** Vertical gap in baked cool stacks. */
export const ROW_GAP = 132;
/** Mess scramble radius base. */
export const MESS_R = 40;

/**
 * Baked paired (messy → cool) layout exemplars — type-aware LTR flow.
 * Positions are absolute within each pair's local frame (origin ≈ first cool).
 * A later develop paired-error weight file can replace / extend this table.
 * Optional JSON twin: vendor/next-action/corpus/paired-exemplars.json
 *
 * @type {{ id:string, types:string[], messy:{x:number,y:number}[], cool:{x:number,y:number}[] }[]}
 */
export const PAIRED_EXEMPLARS = bakePairedExemplars();

/**
 * Bake table-driven paired exemplars (type-aware LTR).
 * Exported so toys / callers can rebuild; also seeds PAIRED_EXEMPLARS.
 */
export function bakePairedExemplars() {
  /** @type {{ id:string, types:string[], messy:{x:number,y:number}[], cool:{x:number,y:number}[] }[]} */
  const pairs = [];

  function coolLTR(types) {
    return types.map((_, i) => ({
      x: i * COL_GAP,
      y: 0,
    }));
  }

  function messyStack(types, seed = 1) {
    // Overlapping pile near centroid — classic spaghetti
    const cx = ((types.length - 1) * COL_GAP) / 2;
    return types.map((_, i) => {
      const ang = (i / Math.max(types.length, 1)) * Math.PI * 2 + seed * 0.37;
      const r = 12 + (i % 3) * 8;
      return {
        x: Math.round((cx + Math.cos(ang) * r) * 10) / 10,
        y: Math.round((40 + Math.sin(ang) * r * 0.7 + (i % 2) * 6) * 10) / 10,
      };
    });
  }

  function messyJitter(types, seed = 2) {
    // Cool LTR with big vertical / horizontal jitter
    return types.map((_, i) => {
      const jx = ((i * 47 + seed * 13) % 90) - 45;
      const jy = ((i * 73 + seed * 29) % 160) - 80;
      return {
        x: Math.round((i * COL_GAP + jx) * 10) / 10,
        y: Math.round(jy * 10) / 10,
      };
    });
  }

  const recipes = [
    { id: "text-llm-image", types: ["text", "llm", "image"], mess: messyStack },
    { id: "text-llm-video", types: ["text", "llm", "ivideo"], mess: messyJitter },
    { id: "text-music", types: ["text", "llm", "music"], mess: messyStack },
    { id: "image-edit-chain", types: ["image", "edit", "ivideo"], mess: messyJitter },
    { id: "upload-llm-tts", types: ["upload", "llm", "tts"], mess: messyStack },
    { id: "text-llm-image-music", types: ["text", "llm", "image", "music"], mess: messyJitter },
    { id: "dual-source", types: ["text", "upload", "join", "image"], mess: messyStack },
    { id: "flow-ltr-5", types: ["text", "llm", "edit", "image", "ivideo"], mess: messyJitter },
  ];

  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i];
    pairs.push({
      id: r.id,
      types: r.types.slice(),
      messy: r.mess(r.types, i + 1),
      cool: coolLTR(r.types),
    });
  }
  return pairs;
}

/**
 * @param {{ nodes?: Array<{id:string,x?:number,y?:number,type?:string}> }} graph
 * @returns {{ id:string, x:number, y:number, cx:number, cy:number, type:string }[]}
 */
export function boxesFromGraph(graph) {
  const nodes = (graph && graph.nodes) || [];
  const out = [];
  for (const n of nodes) {
    if (!n || n.id == null) continue;
    if (n.type === "comment") continue;
    const x = Number(n.x);
    const y = Number(n.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      id: String(n.id),
      x,
      y,
      cx: x + NODE_W / 2,
      cy: y + NODE_H / 2,
      type: String(n.type || "text"),
    });
  }
  return out;
}

/** Stable type multiset key for matching. */
export function typeMultisetKey(types) {
  return [...types].map(String).sort().join("|");
}

/**
 * Greedy type+order matching (Hungarian-lite): group by type, match in
 * y-then-id order within each type to exemplar slot order of that type.
 *
 * @param {{ id:string, type:string, x:number, y:number }[]} boxes
 * @param {string[]} exemplarTypes
 * @returns {{ boxIndex:number, slot:number }[]} matches (box → exemplar slot)
 */
export function matchTypeOrder(boxes, exemplarTypes) {
  /** @type {Map<string, number[]>} */
  const slotsByType = new Map();
  exemplarTypes.forEach((t, i) => {
    const k = String(t);
    if (!slotsByType.has(k)) slotsByType.set(k, []);
    slotsByType.get(k).push(i);
  });

  /** @type {Map<string, number[]>} */
  const boxesByType = new Map();
  boxes.forEach((b, i) => {
    const k = String(b.type);
    if (!boxesByType.has(k)) boxesByType.set(k, []);
    boxesByType.get(k).push(i);
  });

  /** @type {{ boxIndex:number, slot:number }[]} */
  const matches = [];
  for (const [type, boxIdxs] of boxesByType) {
    const slots = (slotsByType.get(type) || []).slice();
    const ordered = boxIdxs
      .slice()
      .sort((a, b) => boxes[a].y - boxes[b].y || boxes[a].id.localeCompare(boxes[b].id));
    const n = Math.min(ordered.length, slots.length);
    for (let i = 0; i < n; i++) {
      matches.push({ boxIndex: ordered[i], slot: slots[i] });
    }
  }
  return matches;
}

/**
 * Score how well a pair matches the current type multiset / order.
 * Higher = better.
 */
export function scorePair(boxes, pair) {
  if (!boxes.length || !pair?.types?.length) return -1;
  const keyA = typeMultisetKey(boxes.map((b) => b.type));
  const keyB = typeMultisetKey(pair.types);
  let score = 0;
  if (keyA === keyB) score += 100;
  // Type overlap count
  const counts = new Map();
  for (const t of pair.types) counts.set(t, (counts.get(t) || 0) + 1);
  for (const b of boxes) {
    const c = counts.get(b.type) || 0;
    if (c > 0) {
      score += 10;
      counts.set(b.type, c - 1);
    }
  }
  // Prefer similar length
  score -= Math.abs(boxes.length - pair.types.length) * 3;
  // Prefer exact ordered type sequence when lengths match
  if (boxes.length === pair.types.length) {
    const ordered = boxes
      .slice()
      .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));
    let seq = 0;
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].type === pair.types[i]) seq++;
    }
    score += seq * 2;
  }
  return score;
}

/**
 * Match current graph to nearest messy exemplar.
 * @returns {{ pair: typeof PAIRED_EXEMPLARS[0] | null, score: number, matches: {boxIndex:number,slot:number}[] }}
 */
export function matchPair(graph, opts = {}) {
  const boxes = boxesFromGraph(graph);
  const catalog = opts.exemplars || PAIRED_EXEMPLARS;
  if (!boxes.length || !catalog.length) {
    return { pair: null, score: -1, matches: [] };
  }
  let best = null;
  let bestScore = -Infinity;
  for (const pair of catalog) {
    const s = scorePair(boxes, pair);
    if (s > bestScore) {
      bestScore = s;
      best = pair;
    }
  }
  if (!best || bestScore < 0) {
    return { pair: null, score: bestScore, matches: [] };
  }
  const matches = matchTypeOrder(boxes, best.types);
  return { pair: best, score: bestScore, matches };
}

/**
 * Propose per-node transport deltas adapted onto current node ids.
 * Delta = cool − messy (from paired exemplar), mapped via type+order match,
 * then translated so the field sits on the current graph centroid.
 *
 * @returns {{
 *   deltas: {id:string, dx:number, dy:number, fromX:number, fromY:number, toX:number, toY:number}[],
 *   pairId: string|null,
 *   meanNorm: number,
 *   boxes: ReturnType<typeof boxesFromGraph>,
 * }}
 */
export function proposeTransportDeltas(graph, opts = {}) {
  const boxes = boxesFromGraph(graph);
  if (!boxes.length) {
    return { deltas: [], pairId: null, meanNorm: 0, boxes };
  }
  const { pair, matches } = matchPair(graph, opts);
  if (!pair || !matches.length) {
    return { deltas: [], pairId: null, meanNorm: 0, boxes };
  }

  // Exemplar messy / cool centroids (matched slots only)
  let mcx = 0;
  let mcy = 0;
  let ccx = 0;
  let ccy = 0;
  let n = 0;
  for (const m of matches) {
    const ms = pair.messy[m.slot];
    const cs = pair.cool[m.slot];
    if (!ms || !cs) continue;
    mcx += ms.x;
    mcy += ms.y;
    ccx += cs.x;
    ccy += cs.y;
    n++;
  }
  if (!n) return { deltas: [], pairId: pair.id, meanNorm: 0, boxes };
  mcx /= n;
  mcy /= n;
  ccx /= n;
  ccy /= n;

  // Current matched boxes centroid
  let gcx = 0;
  let gcy = 0;
  for (const m of matches) {
    const b = boxes[m.boxIndex];
    gcx += b.x;
    gcy += b.y;
  }
  gcx /= matches.length;
  gcy /= matches.length;

  /** @type {{id:string, dx:number, dy:number, fromX:number, fromY:number, toX:number, toY:number}[]} */
  const deltas = [];
  let sumNorm = 0;
  for (const m of matches) {
    const b = boxes[m.boxIndex];
    const ms = pair.messy[m.slot];
    const cs = pair.cool[m.slot];
    if (!ms || !cs) continue;
    // Raw exemplar delta
    const edx = cs.x - ms.x;
    const edy = cs.y - ms.y;
    // Target = current + exemplar delta (field transport)
    // Also nudge toward cool relative placement vs current centroid
    const coolRelX = cs.x - ccx;
    const coolRelY = cs.y - ccy;
    const targetX = gcx + coolRelX;
    const targetY = gcy + coolRelY;
    const dx = targetX - b.x;
    const dy = targetY - b.y;
    // Blend: prefer absolute cool-relative target; keep edx/edy available for debug
    void edx;
    void edy;
    const norm = Math.hypot(dx, dy);
    sumNorm += norm;
    deltas.push({
      id: b.id,
      dx: Math.round(dx * 10) / 10,
      dy: Math.round(dy * 10) / 10,
      fromX: b.x,
      fromY: b.y,
      toX: Math.round(targetX * 10) / 10,
      toY: Math.round(targetY * 10) / 10,
    });
  }
  return {
    deltas,
    pairId: pair.id,
    meanNorm: deltas.length ? sumNorm / deltas.length : 0,
    boxes,
  };
}

export function meanDeltaNorm(deltas) {
  if (!deltas || !deltas.length) return 0;
  let s = 0;
  for (const d of deltas) s += Math.hypot(Number(d.dx) || 0, Number(d.dy) || 0);
  return s / deltas.length;
}

/**
 * Soft-apply transport: lerp along deltas with caps.
 * @returns {{ id:string, x:number, y:number, dx:number, dy:number }[]}
 */
export function applyTransport(graph, deltas, opts = {}) {
  const t = Math.max(0, Math.min(1, Number(opts.t ?? LERP) || 0));
  const maxStep = opts.maxStep ?? MAX_STEP;
  const byId = new Map(
    ((graph && graph.nodes) || []).map((n) => [String(n.id), n])
  );
  /** @type {{ id:string, x:number, y:number, dx:number, dy:number }[]} */
  const out = [];
  for (const d of deltas || []) {
    const n = byId.get(String(d.id));
    if (!n) continue;
    const x0 = Number(n.x);
    const y0 = Number(n.y);
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue;
    let dx = (Number(d.dx) || 0) * t;
    let dy = (Number(d.dy) || 0) * t;
    // Prefer absolute target if provided
    if (Number.isFinite(d.toX) && Number.isFinite(d.toY)) {
      dx = (Number(d.toX) - x0) * t;
      dy = (Number(d.toY) - y0) * t;
    }
    const mag = Math.hypot(dx, dy);
    if (mag > maxStep && mag > 1e-6) {
      dx = (dx / mag) * maxStep;
      dy = (dy / mag) * maxStep;
    }
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    out.push({
      id: String(d.id),
      x: Math.round((x0 + dx) * 10) / 10,
      y: Math.round((y0 + dy) * 10) / 10,
      dx: Math.round(dx * 10) / 10,
      dy: Math.round(dy * 10) / 10,
    });
  }
  return out;
}

/**
 * Detect whether the graph is messy vs its paired cool target.
 */
export function detectMessy(graph, opts = {}) {
  const prop = proposeTransportDeltas(graph, opts);
  const coolEps = opts.coolEps ?? COOL_EPS;
  const messy =
    prop.boxes.length >= 2 &&
    prop.deltas.length >= 1 &&
    prop.meanNorm > coolEps;
  return {
    messy,
    meanNorm: prop.meanNorm,
    pairId: prop.pairId,
    deltas: prop.deltas,
    arrowCount: prop.deltas.filter(
      (d) => Math.hypot(d.dx, d.dy) > coolEps * 0.5
    ).length,
  };
}

/**
 * One-shot: propose deltas + soft apply. Near-noop when already cool (unless force).
 */
export function transportLayout(graph, opts = {}) {
  const info = detectMessy(graph, opts);
  if (!info.messy && !opts.force) {
    return {
      positions: [],
      deltas: info.deltas,
      messy: false,
      meanNorm: info.meanNorm,
      pairId: info.pairId,
      movedIds: [],
      arrowCount: info.arrowCount,
    };
  }
  const positions = applyTransport(graph, info.deltas, opts);
  return {
    positions,
    deltas: info.deltas,
    messy: info.messy,
    meanNorm: info.meanNorm,
    pairId: info.pairId,
    movedIds: positions.map((p) => p.id),
    arrowCount: info.arrowCount,
  };
}

/**
 * Scramble positions into a messy pile (demo / GIF / Mess up button).
 */
export function proposeMessPositions(graph, opts = {}) {
  const boxes = boxesFromGraph(graph);
  if (!boxes.length) return [];
  let cx = 0;
  let cy = 0;
  for (const b of boxes) {
    cx += b.x;
    cy += b.y;
  }
  cx /= boxes.length;
  cy /= boxes.length;
  const r0 = opts.radius ?? MESS_R;
  return boxes.map((b, i) => {
    const ang = (i / boxes.length) * Math.PI * 2;
    const r = r0 + (i % 3) * 14;
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
  LERP,
  MAX_STEP,
  COOL_EPS,
  COL_GAP,
  ROW_GAP,
  MESS_R,
  PAIRED_EXEMPLARS,
  bakePairedExemplars,
  boxesFromGraph,
  typeMultisetKey,
  matchTypeOrder,
  scorePair,
  matchPair,
  proposeTransportDeltas,
  meanDeltaNorm,
  applyTransport,
  detectMessy,
  transportLayout,
  proposeMessPositions,
};
