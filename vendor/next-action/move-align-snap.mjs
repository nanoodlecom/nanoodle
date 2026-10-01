/**
 * Product · 36 — move-align snap guides (pure helpers, no DOM).
 *
 * While dragging a single node, find the best H/V align targets against
 * nearby node centers/edges and return guide descriptors + a soft snap
 * delta. Units match the rects the caller passes (world px is fine; for
 * ~6–12px *screen* snap, pass snapPx ≈ SNAP_SCREEN_PX / scale).
 *
 * Quiet when multi-select (≥2), reduced-motion, engine off, or no
 * candidate within threshold. No tip panel / no ghost overlay.
 */

/** Default snap threshold in the same units as the rects (typically world px). */
export const SNAP_PX = 10;
/** Documented screen-space target when callers convert via /scale. */
export const SNAP_SCREEN_PX = 10;
/** How far guides extend past the outer AABB of dragged + target (world/units). */
export const GUIDE_PAD = 24;

/**
 * @typedef {{ id?: string, x: number, y: number, w: number, h: number }} NodeRect
 * @typedef {{
 *   axis: "x" | "y",
 *   kind: string,
 *   otherId: string,
 *   target: number,
 *   delta: number,
 *   x1: number, y1: number, x2: number, y2: number
 * }} AlignGuide
 * @typedef {{
 *   active: boolean,
 *   reason?: string,
 *   snapDelta: { dx: number, dy: number },
 *   guides: AlignGuide[],
 *   snapPx: number
 * }} MoveAlignResult
 */

/**
 * Edge / center anchors for a rect.
 * @param {NodeRect} r
 */
export function rectAnchors(r) {
  const w = Number(r.w) > 0 ? Number(r.w) : 220;
  const h = Number(r.h) > 0 ? Number(r.h) : 160;
  const x = Number(r.x) || 0;
  const y = Number(r.y) || 0;
  return {
    left: x,
    right: x + w,
    cx: x + w / 2,
    top: y,
    bottom: y + h,
    cy: y + h / 2,
    w,
    h,
    x,
    y,
  };
}

/**
 * Best single-axis align among center + edges.
 * @param {ReturnType<typeof rectAnchors>} a dragged
 * @param {ReturnType<typeof rectAnchors>} b other
 * @param {"x"|"y"} axis
 * @param {number} snapPx
 * @param {string} otherId
 * @returns {AlignGuide | null}
 */
export function bestAxisAlign(a, b, axis, snapPx, otherId) {
  /** @type {{ kind: string, da: number, db: number }[]} */
  const pairs =
    axis === "x"
      ? [
          { kind: "center", da: a.cx, db: b.cx },
          { kind: "left", da: a.left, db: b.left },
          { kind: "right", da: a.right, db: b.right },
          { kind: "left-right", da: a.left, db: b.right },
          { kind: "right-left", da: a.right, db: b.left },
        ]
      : [
          { kind: "center", da: a.cy, db: b.cy },
          { kind: "top", da: a.top, db: b.top },
          { kind: "bottom", da: a.bottom, db: b.bottom },
          { kind: "top-bottom", da: a.top, db: b.bottom },
          { kind: "bottom-top", da: a.bottom, db: b.top },
        ];

  let best = null;
  for (const p of pairs) {
    const delta = p.db - p.da;
    const ad = Math.abs(delta);
    if (ad > snapPx) continue;
    if (!best || ad < Math.abs(best.delta)) {
      best = { kind: p.kind, delta, target: p.db };
    }
  }
  if (!best) return null;

  const pad = GUIDE_PAD;
  if (axis === "x") {
    const x = best.target;
    const y1 = Math.min(a.top, b.top) - pad;
    const y2 = Math.max(a.bottom, b.bottom) + pad;
    return {
      axis: "x",
      kind: best.kind,
      otherId: String(otherId || ""),
      target: best.target,
      delta: best.delta,
      x1: x,
      y1,
      x2: x,
      y2,
    };
  }
  const y = best.target;
  const x1 = Math.min(a.left, b.left) - pad;
  const x2 = Math.max(a.right, b.right) + pad;
  return {
    axis: "y",
    kind: best.kind,
    otherId: String(otherId || ""),
    target: best.target,
    delta: best.delta,
    x1,
    y1: y,
    x2,
    y2: y,
  };
}

/**
 * Compute H/V align guides + soft snap delta for a single dragged node.
 *
 * @param {{
 *   dragged: NodeRect,
 *   others?: NodeRect[],
 *   snapPx?: number,
 *   selectedCount?: number,
 *   reducedMotion?: boolean,
 *   engineOn?: boolean,
 * }} opts
 * @returns {MoveAlignResult}
 */
export function computeMoveAlign(opts) {
  const snapPx = opts && opts.snapPx != null ? Number(opts.snapPx) : SNAP_PX;
  const selectedCount =
    opts && opts.selectedCount != null ? Number(opts.selectedCount) : 1;
  const reducedMotion = !!(opts && opts.reducedMotion);
  const engineOn = opts && opts.engineOn === false ? false : true;
  const quiet = (reason) => ({
    active: false,
    reason,
    snapDelta: { dx: 0, dy: 0 },
    guides: [],
    snapPx,
  });

  if (!engineOn) return quiet("engine-off");
  if (reducedMotion) return quiet("reduced-motion");
  if (!(selectedCount <= 1)) return quiet("multi-select");
  if (!opts || !opts.dragged) return quiet("no-dragged");

  const others = Array.isArray(opts.others) ? opts.others : [];
  if (!others.length) return quiet("no-others");

  const a = rectAnchors(opts.dragged);
  /** @type {AlignGuide | null} */
  let bestX = null;
  /** @type {AlignGuide | null} */
  let bestY = null;

  for (const o of others) {
    if (!o) continue;
    if (
      opts.dragged.id != null &&
      o.id != null &&
      String(o.id) === String(opts.dragged.id)
    ) {
      continue;
    }
    const b = rectAnchors(o);
    const gx = bestAxisAlign(a, b, "x", snapPx, o.id != null ? String(o.id) : "");
    const gy = bestAxisAlign(a, b, "y", snapPx, o.id != null ? String(o.id) : "");
    if (gx && (!bestX || Math.abs(gx.delta) < Math.abs(bestX.delta))) bestX = gx;
    if (gy && (!bestY || Math.abs(gy.delta) < Math.abs(bestY.delta))) bestY = gy;
  }

  const guides = [];
  let dx = 0;
  let dy = 0;
  if (bestX) {
    guides.push(bestX);
    dx = bestX.delta;
  }
  if (bestY) {
    guides.push(bestY);
    dy = bestY.delta;
  }
  if (!guides.length) return quiet("below-threshold");

  return {
    active: true,
    snapDelta: { dx, dy },
    guides,
    snapPx,
  };
}

/**
 * Apply snapDelta to a position (pure).
 * @param {{ x: number, y: number }} pos
 * @param {{ dx?: number, dy?: number } | null} delta
 */
export function applySnapDelta(pos, delta) {
  if (!pos) return { x: 0, y: 0 };
  if (!delta) return { x: pos.x, y: pos.y };
  return {
    x: (Number(pos.x) || 0) + (Number(delta.dx) || 0),
    y: (Number(pos.y) || 0) + (Number(delta.dy) || 0),
  };
}
