/**
 * Product · 15 — Layout mode particles (pure helpers, no DOM).
 * Explicit aesthetic modes (flow, columns, radial) — fifth beat of the
 * local geometry pack after · 14 facing. Distinct from · 13 cool-layout
 * snap (auto-picks Exemplar flow columns): · 15 lets the user choose a
 * layout mode and snap toward that mode’s particle-style targets.
 * Box-friendly heuristic / table priors (no ParticleGAN train).
 */

/** Approx node card size — keep in sync with · 11–· 14. */
export const NODE_W = 180;
export const NODE_H = 100;
/** Horizontal gap between flow / columns. */
export const COL_GAP = 220;
/** Vertical gap between stacked nodes. */
export const ROW_GAP = 132;
/** Soft lerp factor toward mode targets (0–1). */
export const LERP = 0.7;
/** Max per-node travel this snap (px). */
export const MAX_STEP = 180;
/** Mean distance-to-target below which we treat the graph as already cool. */
export const COOL_EPS = 18;
/** Radial ring radius step (px). */
export const RADIAL_RING = 160;

/** Explicit aesthetic modes the user can pick. */
export const MODES = Object.freeze(["flow", "columns", "radial"]);

/** Fallback type → column bias when links are sparse (flow / columns). */
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
 * Mode-labeled layout heads (particle-ish candidates). Soft priors only.
 * Each head lists preferred type layers for scoring / columns mode.
 */
export const MODE_HEADS = Object.freeze({
  flow: [
    { id: "flow-ltr", layers: [["text", "upload"], ["llm", "join"], ["image", "edit", "music", "tts"]] },
    { id: "flow-media", layers: [["text", "upload", "image"], ["llm", "edit"], ["ivideo", "vedit", "video"]] },
  ],
  columns: [
    { id: "cols-type", layers: [["text", "upload"], ["llm", "join"], ["image", "edit"], ["music", "tts", "ivideo"]] },
    { id: "cols-wide", layers: [["text"], ["upload", "image"], ["llm"], ["edit", "music"]] },
  ],
  radial: [
    { id: "radial-topo", rings: ["source", "middle", "sink"] },
    { id: "radial-type", rings: ["input", "compute", "output"] },
  ],
});

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
 * Topological depth from inbound links (sources = 0).
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
  for (const b of boxes) {
    if (!depth.has(b.id)) {
      const tc = TYPE_COL[b.type];
      depth.set(b.id, Number.isFinite(tc) && tc >= 0 ? tc : 1);
    }
  }
  return depth;
}

/**
 * Normalize / validate mode string.
 * @param {string} mode
 * @returns {"flow"|"columns"|"radial"}
 */
export function normalizeMode(mode) {
  const m = String(mode || "flow").toLowerCase();
  return MODES.includes(m) ? /** @type {"flow"|"columns"|"radial"} */ (m) : "flow";
}

/**
 * Pick a mode head (particle candidate) by type overlap.
 * @param {"flow"|"columns"|"radial"} mode
 * @param {{ type:string }[]} boxes
 */
export function pickModeHead(mode, boxes) {
  const heads = MODE_HEADS[normalizeMode(mode)] || MODE_HEADS.flow;
  if (!boxes.length) return heads[0];
  if (normalizeMode(mode) === "radial") {
    // Prefer topo ring when links exist; type ring otherwise — caller passes
    // a hint via boxes.length + optional _linked flag on first box.
    const linked = boxes.some((b) => b && /** @type {any} */ (b)._linked);
    return linked ? heads[0] : heads[Math.min(1, heads.length - 1)];
  }
  let best = heads[0];
  let bestScore = -1;
  for (const head of heads) {
    const layers = head.layers || [];
    let score = 0;
    for (const b of boxes) {
      for (let col = 0; col < layers.length; col++) {
        if (layers[col].includes(b.type)) {
          score += 2 + (layers.length - col) * 0.1;
          break;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = head;
    }
  }
  return best;
}

function typeColumn(type, head) {
  const layers = head.layers || [];
  for (let col = 0; col < layers.length; col++) {
    if (layers[col].includes(type)) return col;
  }
  const tc = TYPE_COL[type];
  return Number.isFinite(tc) && tc >= 0 ? tc : 1;
}

function recenter(raw, boxes, opts) {
  if (!raw.length || !boxes.length) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of raw) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + NODE_W);
    maxY = Math.max(maxY, p.y + NODE_H);
  }
  let cx = 0, cy = 0;
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
 * Flow mode: LTR columns by max(topo depth, prior layer).
 */
function proposeFlow(boxes, depth, head, opts) {
  const colGap = opts.colGap ?? COL_GAP;
  const rowGap = opts.rowGap ?? ROW_GAP;
  /** @type {Map<number, typeof boxes>} */
  const cols = new Map();
  for (const b of boxes) {
    const d = depth.get(b.id) ?? 0;
    const c = Math.max(d, typeColumn(b.type, head));
    if (!cols.has(c)) cols.set(c, []);
    cols.get(c).push(b);
  }
  const colKeys = [...cols.keys()].sort((a, b) => a - b);
  for (const c of colKeys) {
    cols.get(c).sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
  }
  /** @type {{ id:string, x:number, y:number }[]} */
  const raw = [];
  colKeys.forEach((c, ci) => {
    cols.get(c).forEach((b, ri) => {
      raw.push({ id: b.id, x: ci * colGap, y: ri * rowGap });
    });
  });
  return recenter(raw, boxes, opts);
}

/**
 * Columns mode: hard type-column grouping (ignore topo for x; stack in type buckets).
 */
function proposeColumns(boxes, head, opts) {
  const colGap = opts.colGap ?? COL_GAP;
  const rowGap = opts.rowGap ?? ROW_GAP;
  /** @type {Map<number, typeof boxes>} */
  const cols = new Map();
  for (const b of boxes) {
    const c = typeColumn(b.type, head);
    if (!cols.has(c)) cols.set(c, []);
    cols.get(c).push(b);
  }
  const colKeys = [...cols.keys()].sort((a, b) => a - b);
  for (const c of colKeys) {
    cols.get(c).sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
  }
  /** @type {{ id:string, x:number, y:number }[]} */
  const raw = [];
  colKeys.forEach((c, ci) => {
    // Slightly wider columns feel than flow
    cols.get(c).forEach((b, ri) => {
      raw.push({ id: b.id, x: ci * (colGap + 24), y: ri * rowGap });
    });
  });
  return recenter(raw, boxes, opts);
}

/**
 * Radial mode: place around centroid by topo depth ring (or type ring).
 */
function proposeRadial(boxes, depth, head, opts) {
  const ringStep = opts.radialRing ?? RADIAL_RING;
  /** @type {Map<number, typeof boxes>} */
  const rings = new Map();
  const useType =
    head && head.id === "radial-type";
  for (const b of boxes) {
    let r;
    if (useType) {
      r = typeColumn(b.type, { layers: [["text", "upload", "aupload", "vupload"], ["llm", "join", "edit", "resize"], ["image", "music", "tts", "ivideo", "vedit", "video", "lipsync"]] });
    } else {
      r = depth.get(b.id) ?? 0;
    }
    if (!rings.has(r)) rings.set(r, []);
    rings.get(r).push(b);
  }
  const ringKeys = [...rings.keys()].sort((a, b) => a - b);
  for (const r of ringKeys) {
    rings.get(r).sort((a, b) => a.id.localeCompare(b.id));
  }
  /** @type {{ id:string, x:number, y:number }[]} */
  const raw = [];
  // Local origin at 0,0; recenter later. Innermost ring = sources near center.
  for (const r of ringKeys) {
    const list = rings.get(r);
    const radius = r === ringKeys[0] && list.length === 1 ? 0 : Math.max(40, r * ringStep || ringStep * 0.55);
    list.forEach((b, i) => {
      const ang = (i / Math.max(list.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const cx = Math.cos(ang) * radius;
      const cy = Math.sin(ang) * radius;
      raw.push({
        id: b.id,
        x: cx - NODE_W / 2,
        y: cy - NODE_H / 2,
      });
    });
  }
  return recenter(raw, boxes, opts);
}

/**
 * Propose absolute target positions for a chosen layout mode.
 *
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {string} mode
 * @param {{ ids?: string[], originX?: number, originY?: number, colGap?: number, rowGap?: number, radialRing?: number }} [opts]
 * @returns {{
 *   positions: {id:string, x:number, y:number}[],
 *   mode: string,
 *   headId: string,
 * }}
 */
export function proposeLayoutMode(graph, mode, opts = {}) {
  const m = normalizeMode(mode);
  const all = boxesFromGraph(graph);
  if (!all.length) {
    return { positions: [], mode: m, headId: MODE_HEADS[m][0].id };
  }
  const idFilter = opts.ids && opts.ids.length
    ? new Set(opts.ids.map(String))
    : null;
  const boxes = idFilter ? all.filter((b) => idFilter.has(b.id)) : all;
  if (!boxes.length) {
    return { positions: [], mode: m, headId: MODE_HEADS[m][0].id };
  }
  const depth = topoDepths(graph);
  const linked = ((graph && graph.links) || []).length > 0;
  const scored = boxes.map((b) => ({ ...b, _linked: linked }));
  const head = pickModeHead(m, scored);

  let positions;
  if (m === "columns") {
    positions = proposeColumns(boxes, head, opts);
  } else if (m === "radial") {
    positions = proposeRadial(boxes, depth, head, opts);
  } else {
    positions = proposeFlow(boxes, depth, head, opts);
  }
  return { positions, mode: m, headId: head.id };
}

/**
 * Lerp graph positions toward targets.
 * @param {{ nodes?: any[] }} graph
 * @param {{ id:string, x:number, y:number }[]} targets
 * @param {number} [t]
 * @param {{ maxStep?: number }} [opts]
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

/**
 * Mean Euclidean distance from current positions to targets.
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
 * Apply chosen layout mode: propose + lerp. Near-noop when already cool
 * for that mode (unless force).
 *
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {string} mode
 * @param {{ t?: number, force?: boolean, ids?: string[], maxStep?: number, coolEps?: number }} [opts]
 * @returns {{
 *   positions: {id:string,x:number,y:number,dx?:number,dy?:number}[],
 *   targets: {id:string,x:number,y:number}[],
 *   mode: string,
 *   headId: string,
 *   cool: boolean,
 *   meanErr: number,
 *   movedIds: string[],
 * }}
 */
export function applyLayoutMode(graph, mode, opts = {}) {
  const proposal = proposeLayoutMode(graph, mode, opts);
  const meanErr = meanTargetError(graph, proposal.positions);
  const coolEps = opts.coolEps ?? COOL_EPS;
  const cool =
    proposal.positions.length > 0 && meanErr <= coolEps;

  if (cool && !opts.force) {
    return {
      positions: [],
      targets: proposal.positions,
      mode: proposal.mode,
      headId: proposal.headId,
      cool: true,
      meanErr,
      movedIds: [],
    };
  }

  const positions = lerpToward(
    graph,
    proposal.positions,
    opts.t ?? LERP,
    opts
  );
  return {
    positions,
    targets: proposal.positions,
    mode: proposal.mode,
    headId: proposal.headId,
    cool: false,
    meanErr,
    movedIds: positions.map((p) => p.id),
  };
}

/**
 * Scramble / mess-up positions so Apply has visible work (demo / GIF).
 * Returns absolute scattered positions (caller applies via moveNode).
 *
 * @param {{ nodes?: any[] }} graph
 * @param {{ seed?: number }} [opts]
 * @returns {{ positions: {id:string,x:number,y:number}[], mode: string, movedIds: string[] }}
 */
export function scrambleLayout(graph, opts = {}) {
  const boxes = boxesFromGraph(graph);
  if (!boxes.length) {
    return { positions: [], mode: "scramble", movedIds: [] };
  }
  let cx = 0, cy = 0;
  for (const b of boxes) {
    cx += b.x;
    cy += b.y;
  }
  cx /= boxes.length;
  cy /= boxes.length;
  const seed = Number(opts.seed) || 7;
  const positions = boxes.map((b, i) => {
    const ang = (i / boxes.length) * Math.PI * 2 + seed * 0.17;
    const r = 24 + (i % 4) * 14 + ((seed + i * 3) % 5) * 6;
    return {
      id: b.id,
      x: Math.round((cx + Math.cos(ang) * r) * 10) / 10,
      y: Math.round((cy + Math.sin(ang) * r * 0.65) * 10) / 10,
    };
  });
  return {
    positions,
    mode: "scramble",
    movedIds: positions.map((p) => p.id),
  };
}

/**
 * Human summary for the panel.
 */
export function layoutModeSummary(result) {
  if (!result) return "no result · idle";
  if (!(result.targets || result.positions || []).length && !result.movedIds?.length) {
    return `${result.mode || "?"} · idle`;
  }
  const cool = result.cool ? "cool" : "snap";
  const moved = (result.movedIds || []).length;
  return `${cool} · ${result.mode} · ${result.headId || "—"} · ${moved} move · err ${Math.round(result.meanErr || 0)}px`;
}

export default {
  NODE_W,
  NODE_H,
  COL_GAP,
  ROW_GAP,
  LERP,
  MAX_STEP,
  COOL_EPS,
  RADIAL_RING,
  MODES,
  MODE_HEADS,
  boxesFromGraph,
  topoDepths,
  normalizeMode,
  pickModeHead,
  proposeLayoutMode,
  lerpToward,
  meanTargetError,
  applyLayoutMode,
  scrambleLayout,
  layoutModeSummary,
};
