/**
 * Product · 34 — multi-select tidy suggest (pure helpers, no DOM).
 *
 * With 2+ selected cards, decide whether the existing Tidy selection control
 * should pulse. The seats match the editor's Arrange path (column/row pack
 * plus a shove off obstacles). Quiet when Arrange would barely move anything
 * and nothing is stuck together.
 */

import { countOverlaps } from "./collision-nudge.mjs";

export const MIN_SELECTED = 2;
/** Ignore sub-card jitter. Arrange must actually travel or unstick. */
export const MIN_MOVE_PX = 20;
export const OVERLAP_GAP = 8;
export const TIDY_GAP_X = 48;
export const TIDY_GAP_Y = 28;
export const PACK_GAP = 36;

export function countSelectionOverlaps(boxes, gap = OVERLAP_GAP) {
  if (!Array.isArray(boxes) || boxes.length < 2) return 0;
  return countOverlaps(
    { nodes: boxes.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, type: "text" })) },
    { gap }
  );
}

/** Mirrors index.html geoRanks. */
export function tidyRanks(ids, links) {
  const indeg = Object.create(null);
  const outs = Object.create(null);
  for (let i = 0; i < ids.length; i++) {
    indeg[ids[i]] = 0;
    outs[ids[i]] = [];
  }
  const ls = links || [];
  for (let i = 0; i < ls.length; i++) {
    const a = ls[i].from && ls[i].from.node;
    const b = ls[i].to && ls[i].to.node;
    if (!a || !b || a === b || indeg[a] == null || indeg[b] == null) continue;
    outs[a].push(b);
    indeg[b]++;
  }
  const depth = Object.create(null);
  const q = [];
  const left = Object.assign({}, indeg);
  for (let i = 0; i < ids.length; i++) {
    if (indeg[ids[i]] === 0) {
      depth[ids[i]] = 0;
      q.push(ids[i]);
    }
  }
  let qi = 0;
  while (qi < q.length) {
    const u = q[qi++];
    const d = depth[u] || 0;
    const next = outs[u];
    for (let j = 0; j < next.length; j++) {
      const v = next[j];
      if (depth[v] == null || depth[v] < d + 1) depth[v] = d + 1;
      left[v]--;
      if (left[v] === 0) q.push(v);
    }
  }
  let maxD = 0;
  for (let i = 0; i < ids.length; i++) {
    if (depth[ids[i]] == null) depth[ids[i]] = 0;
    if (depth[ids[i]] > maxD) maxD = depth[ids[i]];
  }
  return { depth, spread: maxD > 0 };
}

/** Mirrors index.html geoTidyPositions. */
export function tidyPositions(nodes, links, gapX = TIDY_GAP_X, gapY = TIDY_GAP_Y) {
  if (!nodes || nodes.length < 2) return [];
  const ids = [];
  for (let i = 0; i < nodes.length; i++) ids.push(nodes[i].id);
  const ranked = tidyRanks(ids, links || []);
  const depth = ranked.depth;
  const cols = Object.create(null);
  const keys = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const c = ranked.spread ? depth[n.id] || 0 : 0;
    if (cols[c] == null) {
      cols[c] = [];
      keys.push(c);
    }
    cols[c].push(n);
  }
  keys.sort((a, b) => a - b);
  const srcY = Object.create(null);
  const ls = links || [];
  const yOf = Object.create(null);
  for (let i = 0; i < nodes.length; i++) yOf[nodes[i].id] = nodes[i].orderY != null ? nodes[i].orderY : nodes[i].y;
  for (let i = 0; i < ls.length; i++) {
    const a = ls[i].from && ls[i].from.node;
    const b = ls[i].to && ls[i].to.node;
    if (a == null || b == null || yOf[a] == null) continue;
    if (srcY[b] == null || yOf[a] < srcY[b]) srcY[b] = yOf[a];
  }
  for (let i = 0; i < keys.length; i++) {
    cols[keys[i]].sort((a, b) => {
      const ay = a.orderY != null ? a.orderY : srcY[a.id] != null ? srcY[a.id] : a.y;
      const by = b.orderY != null ? b.orderY : srcY[b.id] != null ? srcY[b.id] : b.y;
      if (ay !== by) return ay - by;
      if (a.x !== b.x) return a.x - b.x;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
  }
  let minX = Infinity;
  let minY = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].x < minX) minX = nodes[i].x;
    if (nodes[i].y < minY) minY = nodes[i].y;
  }
  const gx = gapX == null ? TIDY_GAP_X : gapX;
  const gy = gapY == null ? TIDY_GAP_Y : gapY;
  const out = [];
  if (!ranked.spread) {
    const row = cols[0].slice().sort((a, b) => a.x - b.x || a.y - b.y || (String(a.id) < String(b.id) ? -1 : 1));
    let x = minX;
    for (let i = 0; i < row.length; i++) {
      out.push({ id: row[i].id, x: Math.round(x), y: Math.round(minY) });
      x += row[i].w + gx;
    }
    return out;
  }
  let x = minX;
  for (let i = 0; i < keys.length; i++) {
    const list = cols[keys[i]];
    let colW = 0;
    for (let j = 0; j < list.length; j++) if (list[j].w > colW) colW = list[j].w;
    let y = minY;
    for (let j = 0; j < list.length; j++) {
      out.push({ id: list[j].id, x: Math.round(x), y: Math.round(y) });
      y += list[j].h + gy;
    }
    x += colW + gx;
  }
  return out;
}

/** Mirrors index.html geoClearPack. */
export function clearPack(positions, sizes, obstacles, gap = PACK_GAP) {
  const g = gap == null ? PACK_GAP : gap;
  if (!positions.length || !obstacles || !obstacles.length) return positions;
  let dx = 0;
  let dy = 0;
  for (let pass = 0; pass < 20; pass++) {
    let hit = null;
    for (let i = 0; i < positions.length && !hit; i++) {
      const s = sizes[positions[i].id];
      if (!s) continue;
      const box = { x: positions[i].x + dx, y: positions[i].y + dy, w: s.w, h: s.h };
      for (let j = 0; j < obstacles.length; j++) {
        const o = obstacles[j];
        if (box.x < o.x + o.w + g && o.x < box.x + box.w + g && box.y < o.y + o.h + g && o.y < box.y + box.h + g) {
          hit = o;
          break;
        }
      }
    }
    if (!hit) break;
    let packLeft = Infinity;
    for (let i = 0; i < positions.length; i++) packLeft = Math.min(packLeft, positions[i].x + dx);
    const push = hit.x + hit.w + g - packLeft;
    if (push > 0) dx += push;
    else dy += hit.h + g;
  }
  if (!dx && !dy) return positions;
  const moved = [];
  for (let i = 0; i < positions.length; i++) {
    moved.push({ id: positions[i].id, x: Math.round(positions[i].x + dx), y: Math.round(positions[i].y + dy) });
  }
  return moved;
}

export function maxTidyDelta(selected, targets) {
  if (!selected?.length || !targets?.length) return 0;
  const byId = new Map(targets.map((t) => [String(t.id), t]));
  let max = 0;
  for (const s of selected) {
    const t = byId.get(String(s.id));
    if (!t) continue;
    const d = Math.hypot(Number(t.x) - Number(s.x), Number(t.y) - Number(s.y));
    if (d > max) max = d;
  }
  return max;
}

/**
 * @returns {{ suggest: boolean, reason: string, score: number, overlaps: number, maxDelta: number }}
 */
export function suggestMultiTidy(input = {}, opts = {}) {
  const selected = Array.isArray(input.selected) ? input.selected.filter((b) => b && b.id != null) : [];
  const quiet = (reason, extra = {}) => ({
    suggest: false,
    reason,
    score: 0,
    overlaps: 0,
    maxDelta: 0,
    ...extra,
  });
  if (selected.length < MIN_SELECTED) return quiet("lt2");
  const minMove = opts.minMove ?? MIN_MOVE_PX;
  const overlaps = countSelectionOverlaps(selected, opts.overlapGap ?? OVERLAP_GAP);
  const seats = tidyPositions(selected, input.links || [], opts.gapX ?? TIDY_GAP_X, opts.gapY ?? TIDY_GAP_Y);
  const sizes = {};
  for (const s of selected) sizes[String(s.id)] = { w: Number(s.w) || 0, h: Number(s.h) || 0 };
  const packed = clearPack(seats, sizes, input.obstacles || [], opts.packGap ?? PACK_GAP);
  const maxDelta = maxTidyDelta(selected, packed);
  const afterBoxes = packed.map((p) => {
    const s = selected.find((b) => String(b.id) === String(p.id));
    return { id: p.id, x: p.x, y: p.y, w: s ? s.w : 0, h: s ? s.h : 0 };
  });
  const overlapsAfter = countSelectionOverlaps(afterBoxes, opts.overlapGap ?? OVERLAP_GAP);
  const unstuck = overlaps > 0 && overlapsAfter < overlaps;
  const moved = maxDelta >= minMove;
  if (!moved && !unstuck) {
    return { suggest: false, reason: "already-tidy", score: maxDelta, overlaps, maxDelta, overlapsAfter };
  }
  return {
    suggest: true,
    reason: unstuck ? "unstick" : "move",
    score: overlaps * 40 + maxDelta,
    overlaps,
    maxDelta,
    overlapsAfter,
  };
}

export default suggestMultiTidy;
