/**
 * Product · 40 — double-click dangling → add+wire (pure helpers).
 *
 * Double-click a high-prior dangling port to spawn the top gallery
 * consumer/producer at a free seat and auto-wire once. Reuses gallery
 * port-pair priors (#621) + free-slot seat geometry (#624 / collision-nudge).
 * Quiet when flat/weak, multi-select, already wired, or no free seat.
 * Canvas chrome only — no tip panel / no ?product= twin.
 */

import {
  MIN_PAIR,
  MIN_LEAD,
  MIN_SHARE,
  portsOf,
  pairCount,
  rankDropTypes,
  danglingPorts,
} from "./port-suggest.mjs";
import {
  NODE_W,
  NODE_H,
  GAP,
  boxesFromGraph,
  overlapDepth,
} from "./collision-nudge.mjs";

export { NODE_W, NODE_H, GAP, MIN_PAIR, MIN_LEAD, MIN_SHARE };

function leads(top, second) {
  return !second || second <= 0 || top >= second * MIN_LEAD;
}

/**
 * Quiet under multi-select (same contract as · 28–· 39 helpers).
 * @param {{ selectedId?: string|null, selectedIds?: string[] }} graph
 */
function isMultiSelect(graph = {}) {
  return Array.isArray(graph.selectedIds) && graph.selectedIds.length > 1;
}

/**
 * Build drop-type candidates from the baked port catalog when the editor
 * does not pass live NODE_TYPES rows.
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {"out"|"in"} dir
 * @param {Set<string>|null} [allowTypes]
 */
export function catalogCandidates(tables, dir, allowTypes = null) {
  const catalog = tables?.portCatalog || {};
  /** @type {Array<{ type: string, ports: string[] }>} */
  const out = [];
  for (const type of Object.keys(catalog)) {
    if (allowTypes && !allowTypes.has(type)) continue;
    const { inputs, outputs } = portsOf(tables, type);
    const ports = dir === "in" ? outputs : inputs;
    if (!ports.length) continue;
    out.push({ type, ports: [...ports] });
  }
  out.sort((a, b) => a.type.localeCompare(b.type));
  return out;
}

/**
 * Pick the top complementary type+port for a dangling source port.
 * dir "out" → consumer input; dir "in" → producer output.
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{ dir?: "out"|"in", srcType?: string, srcPort?: string, candidates?: Array<{type:string, ports?: string[]}> }} query
 * @returns {{ type: string, port: string, count: number, share: number } | null}
 */
export function pickTopComplement(tables, query = {}) {
  if (!tables?.topTargets) return null;
  const dir = query.dir === "in" ? "in" : "out";
  const srcType = query.srcType;
  const srcPort = query.srcPort;
  if (!srcType || !srcPort) return null;

  let candidates = query.candidates;
  if (!Array.isArray(candidates) || !candidates.length) {
    candidates = catalogCandidates(tables, dir);
  }
  if (!candidates.length) return null;

  const ranked = rankDropTypes(tables, {
    dir,
    srcType,
    srcPort,
    candidates,
  });
  if (!ranked?.order?.length) return null;
  const topType = ranked.order[0];
  const info = ranked.byType[topType];
  if (!info || !info.port) return null;
  if (info.count < MIN_PAIR) return null;
  if (info.share < MIN_SHARE) return null;
  return {
    type: topType,
    port: info.port,
    count: info.count,
    share: info.share,
  };
}

/**
 * Candidate seats beside an anchor: right, then below, then left
 * (same order as · 31 recipe-seat / #624 tidy seats).
 * @param {{ x:number, y:number, w?:number, h?:number }} anchor
 * @param {{ nodeW?: number, nodeH?: number, gap?: number }} [opts]
 */
export function candidateSeats(anchor, opts = {}) {
  const aw = Number(anchor.w);
  const ah = Number(anchor.h);
  const aW = Number.isFinite(aw) && aw > 0 ? aw : (opts.nodeW ?? NODE_W);
  const aH = Number.isFinite(ah) && ah > 0 ? ah : (opts.nodeH ?? NODE_H);
  const gW = opts.nodeW ?? NODE_W;
  const gH = opts.nodeH ?? NODE_H;
  const gap = opts.gap ?? GAP;
  const ax = Number(anchor.x);
  const ay = Number(anchor.y);
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) return [];
  // Prefer right for out-dir (consumer downstream); left for in-dir (producer upstream).
  const preferLeft = opts.preferLeft === true;
  const right = { dir: "right", x: ax + aW + gap, y: ay, w: gW, h: gH };
  const below = { dir: "below", x: ax, y: ay + aH + gap, w: gW, h: gH };
  const left = { dir: "left", x: ax - gW - gap, y: ay, w: gW, h: gH };
  return preferLeft ? [left, below, right] : [right, below, left];
}

/**
 * True when seat box overlaps any existing graph box (with gap padding).
 * @param {{ x:number, y:number, w:number, h:number }} seat
 * @param {ReturnType<typeof boxesFromGraph>} boxes
 * @param {number} [gap]
 */
export function seatOverlaps(seat, boxes, gap = GAP) {
  const ghost = {
    id: "__ghost__",
    x: seat.x,
    y: seat.y,
    w: seat.w,
    h: seat.h,
    cx: seat.x + seat.w / 2,
    cy: seat.y + seat.h / 2,
  };
  for (const b of boxes) {
    const { overlap } = overlapDepth(ghost, b, gap);
    if (overlap) return true;
  }
  return false;
}

/**
 * Pick a free seat beside the anchor node, or null when every candidate is blocked.
 *
 * @param {{ nodes?: any[] }} graph
 * @param {{ id?: string, x:number, y:number, w?:number, h?:number }} anchor
 * @param {{ nodeW?: number, nodeH?: number, gap?: number, preferLeft?: boolean }} [opts]
 * @returns {{ x: number, y: number, dir: string, w: number, h: number } | null}
 */
export function pickFreeSeat(graph, anchor, opts = {}) {
  if (!anchor || !Number.isFinite(Number(anchor.x)) || !Number.isFinite(Number(anchor.y))) {
    return null;
  }
  const gap = opts.gap ?? GAP;
  const boxes = boxesFromGraph(graph, {
    nodeW: opts.nodeW ?? NODE_W,
    nodeH: opts.nodeH ?? NODE_H,
  }).filter((b) => !anchor.id || b.id !== String(anchor.id));
  const seats = candidateSeats(anchor, opts);
  for (const seat of seats) {
    if (!Number.isFinite(seat.x) || !Number.isFinite(seat.y)) continue;
    if (seat.y < -40) continue;
    if (seatOverlaps(seat, boxes, gap)) continue;
    return {
      x: Math.round(seat.x),
      y: Math.round(seat.y),
      dir: seat.dir,
      w: seat.w,
      h: seat.h,
    };
  }
  return null;
}

/**
 * True when (nodeId, port, dir) is still dangling on the live graph.
 */
export function isPortDangling(tables, graph, nodeId, port, dir) {
  if (!nodeId || !port) return false;
  const { outs, ins } = danglingPorts(tables, graph);
  const list = dir === "in" ? ins : outs;
  return list.some((p) => p.nodeId === nodeId && p.port === port);
}

/**
 * Main picker: dangling port + confident top complement + free seat.
 *
 * Quiet when:
 * - missing / flat / weak gallery prior
 * - multi-select
 * - port already wired / not dangling
 * - no free seat beside source
 * - missing node geometry
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{ nodes?: any[], links?: any[], selectedId?: string|null, selectedIds?: string[] }} graph
 * @param {{
 *   nodeId?: string,
 *   port?: string,
 *   dir?: "out"|"in",
 *   type?: string,
 *   candidates?: Array<{type:string, ports?: string[]}>,
 *   nodeW?: number,
 *   nodeH?: number,
 *   gap?: number,
 * }} [query]
 * @returns {{
 *   addType: string,
 *   addPort: string,
 *   x: number,
 *   y: number,
 *   seatDir: string,
 *   source: { nodeId: string, port: string, type: string, dir: "out"|"in" },
 *   count: number,
 *   share: number
 * } | null}
 */
export function pickDblclickDanglingAddWire(tables, graph = {}, query = {}) {
  if (!tables?.topTargets) return null;
  if (isMultiSelect(graph)) return null;

  const nodeId = query.nodeId;
  const port = query.port;
  const dir = query.dir === "in" ? "in" : "out";
  if (!nodeId || !port) return null;

  const nodes = graph.nodes || [];
  const src = nodes.find((n) => n && String(n.id) === String(nodeId));
  if (!src || !src.type || src.type === "comment") return null;
  const srcType = query.type || src.type;

  if (!isPortDangling(tables, graph, nodeId, port, dir)) return null;

  const complement = pickTopComplement(tables, {
    dir,
    srcType,
    srcPort: port,
    candidates: query.candidates,
  });
  if (!complement) return null;

  const aw = Number(src.w);
  const ah = Number(src.h);
  const anchor = {
    id: String(src.id),
    x: Number(src.x),
    y: Number(src.y),
    w: Number.isFinite(aw) && aw > 0 ? aw : (query.nodeW ?? NODE_W),
    h: Number.isFinite(ah) && ah > 0 ? ah : (query.nodeH ?? NODE_H),
  };
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return null;

  const seat = pickFreeSeat(graph, anchor, {
    nodeW: query.nodeW ?? NODE_W,
    nodeH: query.nodeH ?? NODE_H,
    gap: query.gap ?? GAP,
    preferLeft: dir === "in",
  });
  if (!seat) return null;

  return {
    addType: complement.type,
    addPort: complement.port,
    x: seat.x,
    y: seat.y,
    seatDir: seat.dir,
    source: { nodeId: String(nodeId), port, type: srcType, dir },
    count: complement.count,
    share: complement.share,
  };
}
