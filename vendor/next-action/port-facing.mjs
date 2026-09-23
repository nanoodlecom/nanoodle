/**
 * Product · 14 — Port facing helper (pure helpers, no DOM).
 * Discrete preferred left / right / up / down per node from cool Examples
 * flow idioms. Fourth beat of the local geometry pack (with · 11 tidy +
 * · 12 collision + · 13 cool-layout). Distinct from · 7 (which ports to
 * wire): · 14 is which *side of the node* faces the flow.
 * Box-friendly heuristic / table-driven priors (no ParticleGAN train).
 */

/** Approx node card size — keep in sync with · 11 / · 12 / · 13. */
export const NODE_W = 180;
export const NODE_H = 100;
/** Soft layout nudge so outbound wires leave the preferred side (px). */
export const NUDGE = 36;
/** Max per-node travel this apply (px). */
export const MAX_NUDGE = 72;
/** Facings agree with cool prior → near-noop unless force. */
export const COOL_MATCH_EPS = 0.85;

/** Discrete facing classes. */
export const FACINGS = Object.freeze(["left", "right", "up", "down"]);

/**
 * Baked facing priors from cool Examples layouts.
 * LTR flow → sources face right, sinks face left; vertical stacks → up/down.
 */
export const FACING_PRIORS = Object.freeze([
  {
    id: "ltr-flow",
    axis: "x",
    source: "right",
    sink: "left",
    middle: "right",
    types: ["text", "upload", "llm", "join", "image", "edit", "music", "tts", "ivideo", "vedit", "video", "lipsync"],
  },
  {
    id: "vertical-stack",
    axis: "y",
    source: "down",
    sink: "up",
    middle: "down",
    types: ["text", "llm", "image", "edit"],
  },
  {
    id: "image-edit-chain",
    axis: "x",
    source: "right",
    sink: "left",
    middle: "right",
    types: ["image", "upload", "edit", "inpaint", "ivideo"],
  },
  {
    id: "text-music",
    axis: "x",
    source: "right",
    sink: "left",
    middle: "right",
    types: ["text", "llm", "join", "music", "tts"],
  },
]);

/** Source-biased types (often start of a cool chain). */
const SOURCE_TYPES = new Set(["text", "upload", "aupload", "vupload"]);
/** Sink-biased types (often end of a cool chain). */
const SINK_TYPES = new Set(["image", "ivideo", "vedit", "video", "music", "tts", "lipsync"]);

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
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @returns {{ outs: Map<string,string[]>, ins: Map<string,string[]> }}
 */
export function adjacency(graph) {
  const boxes = boxesFromGraph(graph);
  const ids = new Set(boxes.map((b) => b.id));
  /** @type {Map<string, string[]>} */
  const outs = new Map();
  /** @type {Map<string, string[]>} */
  const ins = new Map();
  for (const id of ids) {
    outs.set(id, []);
    ins.set(id, []);
  }
  for (const l of (graph && graph.links) || []) {
    const from = String(l?.from?.node ?? l?.from ?? "");
    const to = String(l?.to?.node ?? l?.to ?? "");
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    outs.get(from).push(to);
    ins.get(to).push(from);
  }
  return { outs, ins };
}

/**
 * Role from link degree + type bias.
 * @returns {"source"|"sink"|"middle"|"orphan"}
 */
export function nodeRole(id, outs, ins, type) {
  const o = (outs.get(id) || []).length;
  const i = (ins.get(id) || []).length;
  if (o === 0 && i === 0) {
    if (SOURCE_TYPES.has(type)) return "source";
    if (SINK_TYPES.has(type)) return "sink";
    return "orphan";
  }
  if (o > 0 && i === 0) return "source";
  if (i > 0 && o === 0) return "sink";
  return "middle";
}

/**
 * Pick prior by type overlap + geometric axis (wider → LTR, taller → vertical).
 * @param {{ id:string, type:string, x:number, y:number }[]} boxes
 */
export function pickFacingPrior(boxes) {
  if (!boxes.length) return FACING_PRIORS[0];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    maxX = Math.max(maxX, b.x);
    minY = Math.min(minY, b.y);
    maxY = Math.max(maxY, b.y);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const preferVertical = spanY > spanX * 1.15 && boxes.length >= 2;

  let best = preferVertical
    ? FACING_PRIORS.find((p) => p.axis === "y") || FACING_PRIORS[0]
    : FACING_PRIORS[0];
  let bestScore = -1;
  for (const prior of FACING_PRIORS) {
    if (preferVertical && prior.axis !== "y") continue;
    if (!preferVertical && prior.axis === "y") continue;
    let score = 0;
    for (const b of boxes) {
      if (prior.types.includes(b.type)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = prior;
    }
  }
  // If vertical filter emptied scores, fall back to best overall
  if (bestScore < 0) {
    for (const prior of FACING_PRIORS) {
      let score = 0;
      for (const b of boxes) {
        if (prior.types.includes(b.type)) score += 2;
      }
      if (score > bestScore) {
        bestScore = score;
        best = prior;
      }
    }
  }
  return best;
}

/**
 * Facing from neighbor geometry (stronger than prior when linked).
 * @returns {string|null}
 */
function facingFromNeighbors(box, neighborIds, byId) {
  if (!neighborIds.length) return null;
  let sx = 0, sy = 0, n = 0;
  for (const nid of neighborIds) {
    const nb = byId.get(nid);
    if (!nb) continue;
    sx += nb.cx - box.cx;
    sy += nb.cy - box.cy;
    n++;
  }
  if (!n) return null;
  const dx = sx / n;
  const dy = sy / n;
  if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}

/**
 * Propose discrete facing class per node.
 *
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {{ ids?: string[] }} [opts]
 * @returns {{
 *   facings: {id:string, facing:string, role:string, confidence:number}[],
 *   priorId: string,
 *   axis: string,
 *   counts: Record<string, number>,
 * }}
 */
export function proposeFacing(graph, opts = {}) {
  const all = boxesFromGraph(graph);
  if (!all.length) {
    return {
      facings: [],
      priorId: FACING_PRIORS[0].id,
      axis: FACING_PRIORS[0].axis,
      counts: { left: 0, right: 0, up: 0, down: 0 },
    };
  }
  const idFilter = opts.ids && opts.ids.length
    ? new Set(opts.ids.map(String))
    : null;
  const boxes = idFilter ? all.filter((b) => idFilter.has(b.id)) : all;
  const { outs, ins } = adjacency(graph);
  const prior = pickFacingPrior(boxes);
  const byId = new Map(all.map((b) => [b.id, b]));

  /** @type {{id:string, facing:string, role:string, confidence:number}[]} */
  const facings = [];
  const counts = { left: 0, right: 0, up: 0, down: 0 };

  for (const b of boxes) {
    const role = nodeRole(b.id, outs, ins, b.type);
    let facing = prior.middle;
    let confidence = 0.55;

    if (role === "source") {
      facing = prior.source;
      confidence = 0.8;
      const geo = facingFromNeighbors(b, outs.get(b.id) || [], byId);
      if (geo) {
        facing = geo;
        confidence = 0.92;
      }
    } else if (role === "sink") {
      // Sink faces the inbound side (where flow arrives)
      facing = prior.sink;
      confidence = 0.8;
      const geo = facingFromNeighbors(b, ins.get(b.id) || [], byId);
      if (geo) {
        facing = geo;
        confidence = 0.92;
      }
    } else if (role === "middle") {
      facing = prior.middle;
      confidence = 0.7;
      const geoOut = facingFromNeighbors(b, outs.get(b.id) || [], byId);
      if (geoOut) {
        facing = geoOut;
        confidence = 0.88;
      }
    } else {
      // orphan — type prior
      if (SOURCE_TYPES.has(b.type)) facing = prior.source;
      else if (SINK_TYPES.has(b.type)) facing = prior.sink;
      else facing = prior.middle;
      confidence = 0.45;
    }

    if (!FACINGS.includes(facing)) facing = "right";
    counts[facing] = (counts[facing] || 0) + 1;
    facings.push({
      id: b.id,
      facing,
      role,
      confidence: Math.round(confidence * 100) / 100,
    });
  }

  return {
    facings,
    priorId: prior.id,
    axis: prior.axis,
    counts,
  };
}

/**
 * Soft position nudge so neighbors sit on the preferred output/input side.
 *
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {{id:string, facing:string, role:string}[]} facings
 * @param {{ nudge?: number, maxNudge?: number }} [opts]
 * @returns {{ id:string, x:number, y:number, dx:number, dy:number }[]}
 */
export function softNudgeForFacing(graph, facings, opts = {}) {
  const nudge = opts.nudge ?? NUDGE;
  const maxNudge = opts.maxNudge ?? MAX_NUDGE;
  const boxes = boxesFromGraph(graph);
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const faceById = new Map((facings || []).map((f) => [f.id, f]));
  const { outs, ins } = adjacency(graph);

  /** @type {Map<string, {dx:number, dy:number}>} */
  const delta = new Map();
  const add = (id, dx, dy) => {
    const cur = delta.get(id) || { dx: 0, dy: 0 };
    cur.dx += dx;
    cur.dy += dy;
    delta.set(id, cur);
  };

  for (const f of facings || []) {
    const box = byId.get(f.id);
    if (!box) continue;
    // Sources / middles: push outbound neighbors toward preferred exit side
    if (f.role === "source" || f.role === "middle") {
      for (const nid of outs.get(f.id) || []) {
        const nb = byId.get(nid);
        if (!nb) continue;
        let wantX = nb.x;
        let wantY = nb.y;
        if (f.facing === "right") wantX = box.x + NODE_W + nudge;
        else if (f.facing === "left") wantX = box.x - NODE_W - nudge;
        else if (f.facing === "down") wantY = box.y + NODE_H + nudge;
        else if (f.facing === "up") wantY = box.y - NODE_H - nudge;
        add(nid, (wantX - nb.x) * 0.45, (wantY - nb.y) * 0.45);
      }
    }
    // Sinks: pull themselves slightly so inbound arrives on preferred side
    if (f.role === "sink") {
      const preds = ins.get(f.id) || [];
      if (!preds.length) continue;
      let sx = 0, sy = 0;
      for (const pid of preds) {
        const p = byId.get(pid);
        if (!p) continue;
        sx += p.cx;
        sy += p.cy;
      }
      sx /= preds.length;
      sy /= preds.length;
      let wantX = box.x;
      let wantY = box.y;
      if (f.facing === "left") wantX = sx + NODE_W / 2 + nudge - NODE_W / 2;
      else if (f.facing === "right") wantX = sx - NODE_W / 2 - nudge - NODE_W / 2;
      else if (f.facing === "up") wantY = sy + NODE_H / 2 + nudge - NODE_H / 2;
      else if (f.facing === "down") wantY = sy - NODE_H / 2 - nudge - NODE_H / 2;
      add(f.id, (wantX - box.x) * 0.35, (wantY - box.y) * 0.35);
    }
  }

  /** @type {{ id:string, x:number, y:number, dx:number, dy:number }[]} */
  const out = [];
  for (const [id, d] of delta) {
    const box = byId.get(id);
    if (!box) continue;
    let dx = d.dx;
    let dy = d.dy;
    const mag = Math.hypot(dx, dy);
    if (mag > maxNudge && mag > 1e-6) {
      dx = (dx / mag) * maxNudge;
      dy = (dy / mag) * maxNudge;
    }
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    out.push({
      id,
      x: Math.round((box.x + dx) * 10) / 10,
      y: Math.round((box.y + dy) * 10) / 10,
      dx: Math.round(dx * 10) / 10,
      dy: Math.round(dy * 10) / 10,
    });
  }
  return out;
}

/**
 * Fraction of nodes whose current geo-facing already matches the proposal.
 * Uses outbound (or inbound for sinks) neighbor direction vs proposed facing.
 */
export function facingMatchRatio(graph, facings) {
  const boxes = boxesFromGraph(graph);
  if (!boxes.length || !(facings || []).length) return 1;
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const { outs, ins } = adjacency(graph);
  let ok = 0;
  let n = 0;
  for (const f of facings) {
    const box = byId.get(f.id);
    if (!box) continue;
    const neigh =
      f.role === "sink" ? ins.get(f.id) || [] : outs.get(f.id) || [];
    if (!neigh.length) {
      // orphans / unlinked — count as match (nothing to correct)
      ok++;
      n++;
      continue;
    }
    const geo = facingFromNeighbors(box, neigh, byId);
    n++;
    if (geo === f.facing) ok++;
  }
  return n ? ok / n : 1;
}

/**
 * Apply facing hints: propose + optional soft nudge.
 * Near-noop when already cool (unless force).
 *
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {{ force?: boolean, ids?: string[], nudge?: boolean }} [opts]
 * @returns {{
 *   facings: {id:string, facing:string, role:string, confidence:number}[],
 *   positions: {id:string, x:number, y:number, dx?:number, dy?:number}[],
 *   priorId: string,
 *   axis: string,
 *   counts: Record<string, number>,
 *   matchRatio: number,
 *   cool: boolean,
 *   movedIds: string[],
 * }}
 */
export function applyFacingHints(graph, opts = {}) {
  const proposal = proposeFacing(graph, opts);
  const matchRatio = facingMatchRatio(graph, proposal.facings);
  const cool = matchRatio >= COOL_MATCH_EPS && proposal.facings.length > 0;
  const doNudge = opts.nudge !== false;

  if (cool && !opts.force) {
    return {
      ...proposal,
      positions: [],
      matchRatio,
      cool: true,
      movedIds: [],
    };
  }

  const positions = doNudge
    ? softNudgeForFacing(graph, proposal.facings, opts)
    : [];

  return {
    ...proposal,
    positions,
    matchRatio,
    cool: false,
    movedIds: positions.map((p) => p.id),
  };
}

/**
 * Scramble facings (demo / GIF) — random discrete class per node; no positions.
 * @param {{ nodes?: any[] }} graph
 */
export function scrambleFacing(graph) {
  const boxes = boxesFromGraph(graph);
  const facings = boxes.map((b, i) => ({
    id: b.id,
    facing: FACINGS[i % FACINGS.length],
    role: "orphan",
    confidence: 0.2,
  }));
  const counts = { left: 0, right: 0, up: 0, down: 0 };
  for (const f of facings) counts[f.facing]++;
  return {
    facings,
    priorId: "scramble",
    axis: "x",
    counts,
    positions: [],
    matchRatio: 0,
    cool: false,
    movedIds: [],
  };
}

/**
 * Human summary for the panel.
 */
export function facingSummary(result) {
  if (!result || !(result.facings || []).length) return "no nodes · idle";
  const c = result.counts || {};
  const parts = FACINGS.filter((f) => c[f]).map((f) => `${c[f]}${f[0]}`);
  const cool = result.cool ? "cool" : "apply";
  return `${cool} · ${result.priorId} · ${parts.join(" ") || "—"} · match ${Math.round((result.matchRatio || 0) * 100)}%`;
}

export default {
  NODE_W,
  NODE_H,
  NUDGE,
  MAX_NUDGE,
  COOL_MATCH_EPS,
  FACINGS,
  FACING_PRIORS,
  boxesFromGraph,
  adjacency,
  nodeRole,
  pickFacingPrior,
  proposeFacing,
  softNudgeForFacing,
  facingMatchRatio,
  applyFacingHints,
  scrambleFacing,
  facingSummary,
};
