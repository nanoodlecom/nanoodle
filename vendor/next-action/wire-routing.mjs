/**
 * Product · 16 — Wire routing helper (pure helpers, no DOM).
 * Readable edges: direct / elbow / around routes that skirt node AABBs.
 * Box-friendly heuristics — no ParticleGAN train. Does not require · 7.
 */

/** Approx node card size — keep in sync with · 11–· 15. */
export const NODE_W = 180;
export const NODE_H = 100;
/** Padding around obstacles when testing / skirting. */
export const PAD = 14;
/** Extra clearance when bending around a box. */
export const CLEAR = 28;

/** Route classes the user can pick (or auto). */
export const ROUTE_CLASSES = Object.freeze(["direct", "elbow", "around"]);

/**
 * @param {{ nodes?: Array<{id:string,x?:number,y?:number,type?:string}> }} graph
 * @returns {{ id:string, x:number, y:number, w:number, h:number, cx:number, cy:number, type:string }[]}
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
      w: NODE_W,
      h: NODE_H,
      cx: x + NODE_W / 2,
      cy: y + NODE_H / 2,
      type: String(n.type || "text"),
    });
  }
  return out;
}

/**
 * Normalize / validate route class (auto → null meaning pick best).
 * @param {string} cls
 * @returns {"direct"|"elbow"|"around"|null}
 */
export function normalizeRouteClass(cls) {
  const c = String(cls || "auto").toLowerCase();
  if (c === "auto" || c === "") return null;
  return ROUTE_CLASSES.includes(c) ? /** @type {"direct"|"elbow"|"around"} */ (c) : null;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function pathLen(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  }
  return s;
}

/**
 * Segment vs padded AABB intersection (excludes endpoints near ports).
 */
export function segmentHitsBox(x1, y1, x2, y2, box, pad = PAD) {
  const left = box.x - pad;
  const top = box.y - pad;
  const right = box.x + (box.w || NODE_W) + pad;
  const bottom = box.y + (box.h || NODE_H) + pad;
  // Skip if either endpoint is inside / near the box (port on that node)
  const near = (x, y) =>
    x >= left - 2 && x <= right + 2 && y >= top - 2 && y <= bottom + 2;
  if (near(x1, y1) || near(x2, y2)) return false;

  // Liang–Barsky style quick reject + sample
  if (
    Math.max(x1, x2) < left ||
    Math.min(x1, x2) > right ||
    Math.max(y1, y2) < top ||
    Math.min(y1, y2) > bottom
  ) {
    return false;
  }
  const steps = 12;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (x >= left && x <= right && y >= top && y <= bottom) return true;
  }
  return false;
}

/**
 * Count obstacle hits along a polyline (excluding endpoint-owner boxes).
 * @param {number[][]} pts
 * @param {{id:string,x:number,y:number,w?:number,h?:number}[]} obstacles
 * @param {{excludeIds?: Set<string>|string[]}} [opts]
 */
export function countHits(pts, obstacles, opts = {}) {
  const excl = opts.excludeIds
    ? opts.excludeIds instanceof Set
      ? opts.excludeIds
      : new Set(opts.excludeIds)
    : new Set();
  let hits = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    for (const b of obstacles || []) {
      if (excl.has(b.id)) continue;
      if (segmentHitsBox(ax, ay, bx, by, b)) hits += 1;
    }
  }
  return hits;
}

/** Rough segment–segment cross (for other-wire penalty). */
function segmentsCross(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y) {
  const d = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const A = [a1x, a1y],
    B = [a2x, a2y],
    C = [b1x, b1y],
    D = [b2x, b2y];
  const d1 = d(A, B, C),
    d2 = d(A, B, D),
    d3 = d(C, D, A),
    d4 = d(C, D, B);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function countCrossings(pts, otherSegments) {
  if (!otherSegments || !otherSegments.length) return 0;
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    for (const seg of otherSegments) {
      const [cx, cy, dx, dy] = seg;
      // Skip shared endpoints
      if (
        (Math.abs(ax - cx) < 1 && Math.abs(ay - cy) < 1) ||
        (Math.abs(ax - dx) < 1 && Math.abs(ay - dy) < 1) ||
        (Math.abs(bx - cx) < 1 && Math.abs(by - cy) < 1) ||
        (Math.abs(bx - dx) < 1 && Math.abs(by - dy) < 1)
      ) {
        continue;
      }
      if (segmentsCross(ax, ay, bx, by, cx, cy, dx, dy)) n += 1;
    }
  }
  return n;
}

function ptsToDirectCubic(x1, y1, x2, y2) {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return {
    class: "direct",
    controlPoints: [
      [x1, y1],
      [x1 + dx, y1],
      [x2 - dx, y2],
      [x2, y2],
    ],
    d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
  };
}

/** Approximate cubic as polyline for scoring. */
function cubicSamplePts(cps, n = 10) {
  const [p0, p1, p2, p3] = cps;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const x =
      u * u * u * p0[0] +
      3 * u * u * t * p1[0] +
      3 * u * t * t * p2[0] +
      t * t * t * p3[0];
    const y =
      u * u * u * p0[1] +
      3 * u * u * t * p1[1] +
      3 * u * t * t * p2[1] +
      t * t * t * p3[1];
    out.push([x, y]);
  }
  return out;
}

function elbowPath(x1, y1, x2, y2, preferHV = true) {
  // One bend: H→V or V→H
  if (preferHV) {
    const mx = x1 + (x2 - x1) * 0.5;
    const pts = [
      [x1, y1],
      [mx, y1],
      [mx, y2],
      [x2, y2],
    ];
    const d = `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`;
    return { class: "elbow", controlPoints: pts, d, samplePts: pts };
  }
  const my = y1 + (y2 - y1) * 0.5;
  const pts = [
    [x1, y1],
    [x1, my],
    [x2, my],
    [x2, y2],
  ];
  const d = `M ${x1} ${y1} L ${x1} ${my} L ${x2} ${my} L ${x2} ${y2}`;
  return { class: "elbow", controlPoints: pts, d, samplePts: pts };
}

/**
 * Two-bend path that skirts the blocking box(es) between ports.
 */
function aroundPath(x1, y1, x2, y2, obstacles, excludeIds) {
  const excl = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);
  const blockers = (obstacles || []).filter(
    (b) => !excl.has(b.id) && segmentHitsBox(x1, y1, x2, y2, b)
  );

  // Candidate corridors: go above or below the union of blockers, or left/right.
  let top = Infinity,
    bottom = -Infinity,
    left = Infinity,
    right = -Infinity;
  if (blockers.length) {
    for (const b of blockers) {
      top = Math.min(top, b.y - CLEAR);
      bottom = Math.max(bottom, b.y + (b.h || NODE_H) + CLEAR);
      left = Math.min(left, b.x - CLEAR);
      right = Math.max(right, b.x + (b.w || NODE_W) + CLEAR);
    }
  } else {
    // No blocker on direct — mild detour still available
    const midY = (y1 + y2) / 2;
    top = midY - CLEAR * 2;
    bottom = midY + CLEAR * 2;
    left = Math.min(x1, x2) - CLEAR;
    right = Math.max(x1, x2) + CLEAR;
  }

  const candidates = [
    // above then across
    [
      [x1, y1],
      [x1 + Math.sign(x2 - x1 || 1) * 40, y1],
      [x1 + Math.sign(x2 - x1 || 1) * 40, top],
      [x2 - Math.sign(x2 - x1 || 1) * 40, top],
      [x2 - Math.sign(x2 - x1 || 1) * 40, y2],
      [x2, y2],
    ],
    // below
    [
      [x1, y1],
      [x1 + Math.sign(x2 - x1 || 1) * 40, y1],
      [x1 + Math.sign(x2 - x1 || 1) * 40, bottom],
      [x2 - Math.sign(x2 - x1 || 1) * 40, bottom],
      [x2 - Math.sign(x2 - x1 || 1) * 40, y2],
      [x2, y2],
    ],
    // left corridor
    [
      [x1, y1],
      [left, y1],
      [left, y2],
      [x2, y2],
    ],
    // right corridor
    [
      [x1, y1],
      [right, y1],
      [right, y2],
      [x2, y2],
    ],
  ];

  let best = null;
  let bestScore = Infinity;
  for (const pts of candidates) {
    const hits = countHits(pts, obstacles, { excludeIds: excl });
    const len = pathLen(pts);
    const score = hits * 1000 + len;
    if (score < bestScore) {
      bestScore = score;
      best = pts;
    }
  }
  const pts = best || candidates[0];
  const d =
    `M ${pts[0][0]} ${pts[0][1]} ` +
    pts
      .slice(1)
      .map((p) => `L ${p[0]} ${p[1]}`)
      .join(" ");
  return { class: "around", controlPoints: pts, d, samplePts: pts };
}

/**
 * Score a candidate: fewer obstacle hits, shorter length, fewer crossings.
 * Lower is better.
 */
export function scoreRoute(samplePts, obstacles, opts = {}) {
  const hits = countHits(samplePts, obstacles, { excludeIds: opts.excludeIds });
  const len = pathLen(samplePts);
  const crosses = countCrossings(samplePts, opts.otherSegments);
  const bends = Math.max(0, samplePts.length - 2);
  return hits * 1000 + crosses * 80 + len + bends * 12;
}

/**
 * Propose a route between two endpoints.
 * @returns {{ class:string, d:string, score:number, controlPoints:number[][] }}
 */
export function proposeRoute(x1, y1, x2, y2, obstacles, opts = {}) {
  const force = normalizeRouteClass(opts.class || opts.routeClass || "auto");
  const excludeIds = opts.excludeIds
    ? opts.excludeIds instanceof Set
      ? opts.excludeIds
      : new Set(opts.excludeIds)
    : new Set();

  const direct = ptsToDirectCubic(x1, y1, x2, y2);
  const directPts = cubicSamplePts(direct.controlPoints);
  const elbowHV = elbowPath(x1, y1, x2, y2, true);
  const elbowVH = elbowPath(x1, y1, x2, y2, false);
  const around = aroundPath(x1, y1, x2, y2, obstacles, excludeIds);

  const scored = [
    {
      ...direct,
      samplePts: directPts,
      score: scoreRoute(directPts, obstacles, {
        excludeIds,
        otherSegments: opts.otherSegments,
      }),
    },
    {
      ...elbowHV,
      score: scoreRoute(elbowHV.samplePts, obstacles, {
        excludeIds,
        otherSegments: opts.otherSegments,
      }),
    },
    {
      ...elbowVH,
      score: scoreRoute(elbowVH.samplePts, obstacles, {
        excludeIds,
        otherSegments: opts.otherSegments,
      }),
    },
    {
      ...around,
      score: scoreRoute(around.samplePts, obstacles, {
        excludeIds,
        otherSegments: opts.otherSegments,
      }),
    },
  ];

  if (force === "direct") {
    const s = scored[0];
    return { class: s.class, d: s.d, score: s.score, controlPoints: s.controlPoints };
  }
  if (force === "elbow") {
    const bestElbow = scored[1].score <= scored[2].score ? scored[1] : scored[2];
    return {
      class: "elbow",
      d: bestElbow.d,
      score: bestElbow.score,
      controlPoints: bestElbow.controlPoints,
    };
  }
  if (force === "around") {
    const s = scored[3];
    return { class: s.class, d: s.d, score: s.score, controlPoints: s.controlPoints };
  }

  // auto: pick lowest score (prefer direct on ties if hits==0)
  scored.sort((a, b) => a.score - b.score || (a.class === "direct" ? -1 : 1));
  const best = scored[0];
  return {
    class: best.class,
    d: best.d,
    score: best.score,
    controlPoints: best.controlPoints,
  };
}

/**
 * Route a single link given endpoints + boxes.
 * @param {{id?:string, from?:any, to?:any}} link
 * @param {{x1:number,y1:number,x2:number,y2:number, fromId?:string, toId?:string}} endpoints
 */
export function routeLink(link, endpoints, boxes, opts = {}) {
  const x1 = Number(endpoints.x1);
  const y1 = Number(endpoints.y1);
  const x2 = Number(endpoints.x2);
  const y2 = Number(endpoints.y2);
  const exclude = new Set();
  if (endpoints.fromId) exclude.add(String(endpoints.fromId));
  if (endpoints.toId) exclude.add(String(endpoints.toId));
  if (link?.from?.node) exclude.add(String(link.from.node));
  if (link?.to?.node) exclude.add(String(link.to.node));
  const route = proposeRoute(x1, y1, x2, y2, boxes, {
    ...opts,
    excludeIds: exclude,
  });
  return {
    id: link?.id != null ? String(link.id) : `${x1},${y1}->${x2},${y2}`,
    ...route,
  };
}

/**
 * Build endpoint map helper: prefer live port centers when provided.
 * endpointMap: Map|object keyed by link id → {x1,y1,x2,y2,fromId?,toId?}
 * Fallback: approximate from node boxes (right-center → left-center).
 */
export function endpointForLink(link, boxesById, endpointMap) {
  const id = link?.id != null ? String(link.id) : null;
  if (endpointMap) {
    const ep =
      endpointMap instanceof Map
        ? endpointMap.get(id)
        : endpointMap[id] || endpointMap[link?.id];
    if (ep && Number.isFinite(ep.x1) && Number.isFinite(ep.y1)) return ep;
  }
  const fromId = String(link?.from?.node ?? link?.from ?? "");
  const toId = String(link?.to?.node ?? link?.to ?? "");
  const a = boxesById.get(fromId);
  const b = boxesById.get(toId);
  if (!a || !b) return null;
  return {
    x1: a.x + NODE_W,
    y1: a.y + NODE_H / 2,
    x2: b.x,
    y2: b.y + NODE_H / 2,
    fromId,
    toId,
  };
}

/**
 * Route every link in the graph.
 */
export function routeAllLinks(graph, endpointMap, opts = {}) {
  const boxes = boxesFromGraph(graph);
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const links = (graph && graph.links) || [];
  const routes = [];
  const otherSegs = [];

  // First pass: collect baseline direct segments for crossing penalty
  for (const link of links) {
    const ep = endpointForLink(link, byId, endpointMap);
    if (!ep) continue;
    otherSegs.push([ep.x1, ep.y1, ep.x2, ep.y2]);
  }

  let i = 0;
  for (const link of links) {
    const ep = endpointForLink(link, byId, endpointMap);
    if (!ep) {
      i++;
      continue;
    }
    const others = otherSegs.filter((_, j) => j !== i);
    const r = routeLink(link, ep, boxes, { ...opts, otherSegments: others });
    routes.push(r);
    i++;
  }
  return routes;
}

/**
 * Apply wire routing → routes + summary stats.
 */
export function applyWireRouting(graph, endpointMap, opts = {}) {
  const routes = routeAllLinks(graph, endpointMap, opts);
  const byClass = { direct: 0, elbow: 0, around: 0 };
  let totalScore = 0;
  for (const r of routes) {
    if (byClass[r.class] != null) byClass[r.class] += 1;
    totalScore += r.score || 0;
  }
  const dominant =
    routes.length === 0
      ? "—"
      : Object.entries(byClass).sort((a, b) => b[1] - a[1])[0][0];
  return {
    routes,
    summary: {
      n: routes.length,
      byClass,
      dominant,
      totalScore,
      meanScore: routes.length ? totalScore / routes.length : 0,
    },
  };
}

/**
 * Force bad crossed diagonals / overlapping node positions for GIF demos.
 * Returns node positions (caller moveNode) — does not invent fake paths.
 */
export function scrambleWires(graph, opts = {}) {
  const boxes = boxesFromGraph(graph);
  if (!boxes.length) {
    return { positions: [], mode: "scramble", movedIds: [] };
  }
  const seed = Number(opts.seed) || 11;
  // Place nodes so chain wires pierce a middle AABB (readable messy demo).
  // Prefer a left / blocking-middle / right layout with vertical offset.
  const baseX = 80 + (seed % 5) * 4;
  const baseY = 140 + (seed % 3) * 8;
  const positions = boxes.map((b, i) => {
    if (i === 0) {
      return { id: b.id, x: baseX, y: baseY + 40 };
    }
    if (i === 1) {
      // Sit squarely between endpoints so direct cubics hit this box
      return { id: b.id, x: baseX + 200, y: baseY + 20 };
    }
    if (i === 2) {
      return { id: b.id, x: baseX + 420, y: baseY + 60 };
    }
    // Extra nodes: scatter above/below the corridor
    const row = Math.floor(i / 2);
    const side = i % 2 === 0 ? -1 : 1;
    return {
      id: b.id,
      x: baseX + 120 + row * 160,
      y: baseY + side * (110 + (i % 3) * 20),
    };
  });
  return {
    positions,
    mode: "scramble",
    movedIds: positions.map((p) => p.id),
  };
}

/**
 * Human summary for the panel note.
 */
export function wireRoutingSummary(result) {
  if (!result) return "no result · idle";
  const s = result.summary || result;
  const n = s.n ?? (result.routes || []).length;
  if (!n) return "route · 0 wires · idle";
  const dom = s.dominant || "—";
  const parts = [];
  const bc = s.byClass || {};
  for (const k of ROUTE_CLASSES) {
    if (bc[k]) parts.push(`${bc[k]} ${k}`);
  }
  return `route · ${n} wire${n === 1 ? "" : "s"} · ${dom}${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

export default {
  NODE_W,
  NODE_H,
  PAD,
  CLEAR,
  ROUTE_CLASSES,
  boxesFromGraph,
  normalizeRouteClass,
  segmentHitsBox,
  countHits,
  scoreRoute,
  proposeRoute,
  routeLink,
  routeAllLinks,
  applyWireRouting,
  scrambleWires,
  wireRoutingSummary,
  endpointForLink,
};
