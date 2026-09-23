/**
 * Product · 13 — Cool-layout snap (pure helpers, no DOM).
 * Whole-graph / selection snap toward known-good flow layouts on Arrange
 * or drag-end, with gentle lerp. Distinct from · 11 (one-shot neighbor tidy)
 * and · 12 (multi-pass all-pairs de-overlap): · 13 proposes cool Exemplar
 * targets and lerps the graph toward them — not just clearing overlaps.
 * Box-friendly heuristic / table-driven priors (no ParticleGAN train).
 */

/** Approx node card size (editor chrome) — keep in sync with · 11 / · 12. */
export const NODE_W = 180;
export const NODE_H = 100;
/** Horizontal gap between flow columns. */
export const COL_GAP = 220;
/** Vertical gap between stacked nodes in a column. */
export const ROW_GAP = 132;
/** Soft lerp factor toward cool targets (0–1). */
export const LERP = 0.55;
/** Max per-node travel this snap (px). */
export const MAX_STEP = 160;
/** Mean distance-to-target below which we treat the graph as already cool. */
export const COOL_EPS = 18;
/** Overlap (AABB+pad) count above which messy=true regardless of mean err. */
export const MESSY_OVERLAP = 1;
/** Desired AABB pad for overlap scoring (matches · 12 spirit). */
export const GAP = 32;

/**
 * Baked cool-layout priors (Examples-derived flow idioms).
 * Each prior: ordered type layers L→R (columns). Used as a soft bias when
 * topo depth is flat / unlinked — not a hard template match.
 */
export const COOL_PRIORS = [
  { id: "text-llm-image", layers: [["text", "upload"], ["llm", "join"], ["image", "edit"]] },
  { id: "text-llm-video", layers: [["text", "upload"], ["llm", "join"], ["ivideo", "vedit", "video"]] },
  { id: "text-music", layers: [["text"], ["llm", "join"], ["music", "tts"]] },
  { id: "image-edit-chain", layers: [["image", "upload"], ["edit"], ["ivideo", "vedit"]] },
  { id: "flow-ltr", layers: [["text", "upload", "image"], ["llm", "join", "edit"], ["image", "music", "tts", "ivideo", "lipsync"]] },
];

/** Fallback type → column bias when links are sparse. */
const TYPE_COL = {
  text: 0,
  upload: 0,
  aupload: 0,
  vupload: 0,
  comment: -1, // ignored via boxesFromGraph
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

/**
 * Topological depth from inbound links (sources = 0). Cycles → type bias.
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @returns {Map<string, number>}
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
  // Unvisited (cycle / orphan) — type column bias
  for (const b of boxes) {
    if (!depth.has(b.id)) {
      const tc = TYPE_COL[b.type];
      depth.set(b.id, Number.isFinite(tc) && tc >= 0 ? tc : 1);
    }
  }
  return depth;
}

/**
 * Pick best prior by type overlap score (soft bias only).
 * @param {{ id:string, type:string }[]} boxes
 */
export function pickCoolPrior(boxes) {
  if (!boxes.length) return COOL_PRIORS[COOL_PRIORS.length - 1];
  let best = COOL_PRIORS[COOL_PRIORS.length - 1];
  let bestScore = -1;
  for (const prior of COOL_PRIORS) {
    let score = 0;
    for (const b of boxes) {
      for (let col = 0; col < prior.layers.length; col++) {
        if (prior.layers[col].includes(b.type)) {
          score += 2 + (prior.layers.length - col) * 0.1;
          break;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = prior;
    }
  }
  return best;
}

/**
 * Column index for a node: max(topo depth, prior layer match).
 */
function columnFor(box, depth, prior) {
  const d = depth.get(box.id) ?? 0;
  let priorCol = -1;
  for (let col = 0; col < prior.layers.length; col++) {
    if (prior.layers[col].includes(box.type)) {
      priorCol = col;
      break;
    }
  }
  if (priorCol < 0) {
    const tc = TYPE_COL[box.type];
    priorCol = Number.isFinite(tc) && tc >= 0 ? tc : d;
  }
  return Math.max(d, priorCol);
}

/**
 * Propose absolute cool target positions. Preserves graph centroid so the
 * canvas doesn't jump; optional `ids` limits to a selection.
 *
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {{ ids?: string[], originX?: number, originY?: number, colGap?: number, rowGap?: number }} [opts]
 * @returns {{ id:string, x:number, y:number }[]}
 */
export function proposeCoolLayoutPositions(graph, opts = {}) {
  const all = boxesFromGraph(graph);
  if (!all.length) return [];
  const idFilter = opts.ids && opts.ids.length
    ? new Set(opts.ids.map(String))
    : null;
  const boxes = idFilter ? all.filter((b) => idFilter.has(b.id)) : all;
  if (!boxes.length) return [];

  const depth = topoDepths(graph);
  const prior = pickCoolPrior(boxes);
  const colGap = opts.colGap ?? COL_GAP;
  const rowGap = opts.rowGap ?? ROW_GAP;

  /** @type {Map<number, typeof boxes>} */
  const cols = new Map();
  for (const b of boxes) {
    const c = columnFor(b, depth, prior);
    if (!cols.has(c)) cols.set(c, []);
    cols.get(c).push(b);
  }
  const colKeys = [...cols.keys()].sort((a, b) => a - b);

  // Stable order within column: prior y, then id
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
      maxX = Math.max(maxX, x + NODE_W);
      maxY = Math.max(maxY, y + NODE_H);
    });
  });

  // Current centroid of selected boxes
  let cx = 0;
  let cy = 0;
  for (const b of boxes) {
    cx += b.x + NODE_W / 2;
    cy += b.y + NODE_H / 2;
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

/**
 * Lerp graph positions toward targets. Returns absolute positions (clamped step).
 *
 * @param {{ nodes?: any[] }} graph
 * @param {{ id:string, x:number, y:number }[]} targets
 * @param {number} [t] lerp 0–1
 * @param {{ maxStep?: number }} [opts]
 * @returns {{ id:string, x:number, y:number, dx:number, dy:number }[]}
 */
export function lerpToward(graph, targets, t = LERP, opts = {}) {
  const maxStep = opts.maxStep ?? MAX_STEP;
  const tt = Math.max(0, Math.min(1, Number(t) || 0));
  const byId = new Map(
    ((graph && graph.nodes) || []).map((n) => [String(n.id), n])
  );
  /** @type {{ id:string, x:number, y:number, dx:number, dy:number }[]} */
  const out = [];
  for (const tgt of targets || []) {
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
    out.push({
      id: String(tgt.id),
      x: Math.round((x0 + dx) * 10) / 10,
      y: Math.round((y0 + dy) * 10) / 10,
      dx: Math.round(dx * 10) / 10,
      dy: Math.round(dy * 10) / 10,
    });
  }
  return out;
}

function overlapDepth(a, b) {
  const needX = NODE_W + GAP;
  const needY = NODE_H + GAP;
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const ox = needX - Math.abs(dx);
  const oy = needY - Math.abs(dy);
  return { ox, oy, overlap: ox > 0 && oy > 0 };
}

/**
 * Count colliding pairs (AABB + gap).
 */
export function countOverlaps(graph) {
  const boxes = boxesFromGraph(graph);
  let n = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlapDepth(boxes[i], boxes[j]).overlap) n++;
    }
  }
  return n;
}

/**
 * Mean Euclidean distance from current positions to cool targets.
 */
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
 * Messy = high overlap OR far from cool prior. Already-cool → near-noop.
 *
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {{ ids?: string[], coolEps?: number, messyOverlap?: number }} [opts]
 * @returns {{ messy: boolean, overlaps: number, meanErr: number, targets: {id:string,x:number,y:number}[], priorId: string }}
 */
export function detectMessy(graph, opts = {}) {
  const targets = proposeCoolLayoutPositions(graph, opts);
  const overlaps = countOverlaps(graph);
  const meanErr = meanTargetError(graph, targets);
  const coolEps = opts.coolEps ?? COOL_EPS;
  const messyOverlap = opts.messyOverlap ?? MESSY_OVERLAP;
  const boxes = boxesFromGraph(graph);
  const prior = pickCoolPrior(boxes);
  const messy =
    boxes.length >= 2 &&
    (overlaps >= messyOverlap || meanErr > coolEps);
  return { messy, overlaps, meanErr, targets, priorId: prior.id };
}

/**
 * One-shot cool snap: propose + lerp. Near-noop when already cool (unless force).
 *
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {{ t?: number, force?: boolean, ids?: string[], maxStep?: number }} [opts]
 * @returns {{
 *   positions: {id:string,x:number,y:number,dx?:number,dy?:number}[],
 *   targets: {id:string,x:number,y:number}[],
 *   messy: boolean,
 *   overlaps: number,
 *   meanErr: number,
 *   priorId: string,
 *   movedIds: string[],
 * }}
 */
export function snapCoolLayout(graph, opts = {}) {
  const info = detectMessy(graph, opts);
  if (!info.messy && !opts.force) {
    return {
      positions: [],
      targets: info.targets,
      messy: false,
      overlaps: info.overlaps,
      meanErr: info.meanErr,
      priorId: info.priorId,
      movedIds: [],
    };
  }
  const positions = lerpToward(graph, info.targets, opts.t ?? LERP, opts);
  return {
    positions,
    targets: info.targets,
    messy: info.messy,
    overlaps: info.overlaps,
    meanErr: info.meanErr,
    priorId: info.priorId,
    movedIds: positions.map((p) => p.id),
  };
}

export default {
  NODE_W,
  NODE_H,
  COL_GAP,
  ROW_GAP,
  LERP,
  MAX_STEP,
  COOL_EPS,
  MESSY_OVERLAP,
  GAP,
  COOL_PRIORS,
  boxesFromGraph,
  topoDepths,
  pickCoolPrior,
  proposeCoolLayoutPositions,
  lerpToward,
  countOverlaps,
  meanTargetError,
  detectMessy,
  snapCoolLayout,
};
