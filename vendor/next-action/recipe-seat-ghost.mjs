/**
 * Product · 31 — recipe next-seat ghost (pure helpers).
 *
 * When a confident gallery recipe match predicts the next add and a clear
 * free seat sits beside the last/selected node, return that seat so the
 * editor can draw a faint ghost node silhouette. Click places the real node.
 * Quiet when flat / no recipe / multi-select / empty / no free seat.
 *
 * Canvas node chrome only — not a tip panel / next-action overlay.
 */

import { confidentRecipe, typeMultiset } from "./recipe.mjs";
import {
  NODE_W,
  NODE_H,
  GAP,
  boxesFromGraph,
  overlapDepth,
} from "./collision-nudge.mjs";

export { NODE_W, NODE_H, GAP };

/**
 * Quiet under multi-select (same contract as · 28–· 30 helpers).
 * @param {{ selectedId?: string|null, selectedIds?: string[] }} graph
 */
function isMultiSelect(graph = {}) {
  return Array.isArray(graph.selectedIds) && graph.selectedIds.length > 1;
}

/**
 * Build a sketch object for confidentRecipe from live graph nodes.
 * @param {{ nodes?: Array<{type?: string}> }} graph
 */
export function sketchFromNodes(graph = {}) {
  const types = (graph.nodes || [])
    .map((n) => n?.type)
    .filter((t) => t && t !== "comment");
  const nodeTypeCounts = typeMultiset(types);
  const numNodes = Object.values(nodeTypeCounts).reduce((a, b) => a + b, 0);
  return { nodeTypeCounts, numNodes };
}

/**
 * Anchor: prefer selected node, else last-added non-comment, else rightmost.
 * @param {{ nodes?: any[], selectedId?: string|null }} graph
 * @returns {any | null}
 */
export function pickAnchorNode(graph = {}) {
  const nodes = (graph.nodes || []).filter((n) => n && n.id != null && n.type && n.type !== "comment");
  if (!nodes.length) return null;
  if (graph.selectedId) {
    const sel = nodes.find((n) => String(n.id) === String(graph.selectedId));
    if (sel && Number.isFinite(Number(sel.x)) && Number.isFinite(Number(sel.y))) return sel;
  }
  // Last-added: array order (editor pushes on add).
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (Number.isFinite(Number(n.x)) && Number.isFinite(Number(n.y))) return n;
  }
  // Rightmost fallback
  let best = null;
  let bestRight = -Infinity;
  for (const n of nodes) {
    const x = Number(n.x);
    const y = Number(n.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const w = Number(n.w);
    const right = x + (Number.isFinite(w) && w > 0 ? w : NODE_W);
    if (right > bestRight) {
      bestRight = right;
      best = n;
    }
  }
  return best;
}

/**
 * Candidate seats beside an anchor: right, then below, then left.
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
  return [
    { dir: "right", x: ax + aW + gap, y: ay, w: gW, h: gH },
    { dir: "below", x: ax, y: ay + aH + gap, w: gW, h: gH },
    { dir: "left", x: ax - gW - gap, y: ay, w: gW, h: gH },
  ];
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
 * Pick a free seat for the confident recipe next type, or null.
 *
 * Quiet when:
 * - no confident recipe next type (flat / thin / disagree)
 * - multi-select
 * - empty / no usable anchor
 * - no clear free seat beside anchor (right → below → left)
 *
 * @param {{ recipes?: any[] } | any[]} recipes
 * @param {{ nodes?: any[], links?: any[], selectedId?: string|null, selectedIds?: string[] }} graph
 * @param {{ nodeTypes?: Set<string>|null, nodeW?: number, nodeH?: number, gap?: number, preferSelected?: boolean }} [opts]
 * @returns {{ type: string, x: number, y: number, reason: string, slug: string, title: string, dir: string, covered: number, score: number } | null}
 */
export function pickRecipeNextSeatGhost(recipes, graph = {}, opts = {}) {
  if (!recipes) return null;
  if (isMultiSelect(graph)) return null;
  const nodes = graph.nodes || [];
  if (!nodes.length) return null;

  const sketch = sketchFromNodes(graph);
  if (!sketch.numNodes) return null;

  const recipe = confidentRecipe(recipes, sketch, { nodeTypes: opts.nodeTypes || null });
  if (!recipe || !recipe.type) return null;

  const anchor = pickAnchorNode(graph);
  if (!anchor) return null;

  const boxes = boxesFromGraph(graph, {
    nodeW: opts.nodeW ?? NODE_W,
    nodeH: opts.nodeH ?? NODE_H,
  });
  const gap = opts.gap ?? GAP;
  const seats = candidateSeats(anchor, {
    nodeW: opts.nodeW ?? NODE_W,
    nodeH: opts.nodeH ?? NODE_H,
    gap,
  });

  for (const seat of seats) {
    // Keep seats on-canvas-ish; left of origin is fine if still mostly visible
    if (!Number.isFinite(seat.x) || !Number.isFinite(seat.y)) continue;
    if (seat.y < -40) continue;
    if (seatOverlaps(seat, boxes, gap)) continue;
    return {
      type: recipe.type,
      x: Math.round(seat.x),
      y: Math.round(seat.y),
      reason: recipe.reason || `from ${recipe.title} recipe`,
      slug: recipe.slug,
      title: recipe.title,
      dir: seat.dir,
      covered: recipe.covered,
      score: recipe.score,
    };
  }
  return null;
}
