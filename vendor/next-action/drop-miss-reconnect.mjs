/**
 * Product · 47 — drop-miss reconnect pulse (pure helpers).
 *
 * After a wire drop misses (empty canvas / incompatible target), pick ONE
 * best alternate compatible port on a nearby OTHER node (not the origin —
 * that's · 46) so reconnect is obvious. Reuses gallery port-pair / typeToType
 * priors (#621). Prefer unwired. Quiet when none / flat / tied.
 *
 * Distinct from · 46 (origin resume pulse), · 22 / · 29 idle nudges, · 33
 * post-wire continue — trigger is wire-drag miss only; visual is the
 * alternate nearby port.
 */

import { MIN_PAIR, MIN_LEAD, MIN_SHARE, pairCount } from "./port-suggest.mjs";

/** Default nearby radius (editor/canvas px) when callers omit maxDist. */
export const NEARBY_MAX_DIST = 420;

function leads(top, second) {
  return !second || second <= 0 || top >= second * MIN_LEAD;
}

/**
 * Directed gallery port-pair count.
 * dir "in" means the drag started on an input, so the candidate produces the wire.
 * @param {import("./port-suggest.mjs").PortSuggestTables|null|undefined} tables
 * @param {"out"|"in"} dir
 * @param {string} srcType
 * @param {string} srcPort
 * @param {string} otherType
 * @param {string} otherPort
 */
export function directedPairCount(tables, dir, srcType, srcPort, otherType, otherPort) {
  if (dir === "in") return pairCount(tables, otherType, otherPort, srcType, srcPort);
  return pairCount(tables, srcType, srcPort, otherType, otherPort);
}

/**
 * Gallery type→type mass for origin↔candidate (direction-aware).
 * @param {import("./port-suggest.mjs").PortSuggestTables|null|undefined} tables
 * @param {"out"|"in"} dir
 * @param {string} srcType
 * @param {string} otherType
 */
export function typeToTypeCount(tables, dir, srcType, otherType) {
  if (!tables?.typeToType || !srcType || !otherType) return 0;
  const key = dir === "in" ? `${otherType}→${srcType}` : `${srcType}→${otherType}`;
  return Number(tables.typeToType[key]) || 0;
}

/**
 * Score one candidate against the aborted origin.
 * Primary: port-pair. Soft fallback: typeToType (scaled) when pair is 0.
 * @returns {number}
 */
export function scoreCandidate(tables, origin, cand) {
  if (!tables?.topTargets || !origin?.type || !origin?.port || !cand?.type || !cand?.port) return 0;
  const dir = origin.dir === "in" ? "in" : "out";
  const pair = directedPairCount(tables, dir, origin.type, origin.port, cand.type, cand.port);
  if (pair > 0) return pair;
  const ttt = typeToTypeCount(tables, dir, origin.type, cand.type);
  if (ttt <= 0) return 0;
  // Weak type→type hint — never invent a strong lead from type mass alone.
  return Math.max(1, Math.floor(ttt * 0.35));
}

/**
 * Pick the best alternate reconnect port after a drop miss.
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables|null|undefined} tables
 * @param {{ nodeId?: string, id?: string, port?: string, type?: string, dir?: string }} origin
 * @param {Array<{ nodeId: string, port: string, type: string, dir?: string, wired?: boolean, dist?: number }>} candidates
 * @param {{ maxDist?: number }} [opts]
 * @returns {{ nodeId: string, port: string, type: string, dir: "out"|"in", count: number, share: number, wired: boolean } | null}
 */
export function pickDropMissReconnectPort(tables, origin = {}, candidates = [], opts = {}) {
  if (!tables?.topTargets) return null;
  const nodeId = origin.nodeId || origin.id || null;
  const port = origin.port || null;
  const type = origin.type || null;
  const dir = origin.dir === "in" ? "in" : origin.dir === "out" ? "out" : null;
  if (!nodeId || !port || !type || !dir) return null;
  if (!Array.isArray(candidates) || !candidates.length) return null;

  const maxDist =
    opts.maxDist != null && Number.isFinite(Number(opts.maxDist))
      ? Number(opts.maxDist)
      : NEARBY_MAX_DIST;
  const wantDir = dir === "out" ? "in" : "out";

  /** @type {Array<{ nodeId: string, port: string, type: string, dir: "out"|"in", count: number, wired: boolean, dist: number }>} */
  const scored = [];
  for (const c of candidates) {
    if (!c?.nodeId || !c.port || !c.type) continue;
    if (c.nodeId === nodeId) continue; // never the origin node (· 46's job)
    if (c.dir && c.dir !== wantDir) continue;
    const dist = c.dist != null && Number.isFinite(Number(c.dist)) ? Number(c.dist) : 0;
    if (dist > maxDist) continue;
    const count = scoreCandidate(tables, { type, port, dir }, c);
    if (count <= 0) continue;
    scored.push({
      nodeId: c.nodeId,
      port: c.port,
      type: c.type,
      dir: wantDir,
      count,
      wired: !!c.wired,
      dist,
    });
  }
  if (!scored.length) return null;

  // Prefer unwired: when any unwired candidate meets MIN_PAIR, rank only those.
  const strongUnwired = scored.filter((s) => !s.wired && s.count >= MIN_PAIR);
  const pool = strongUnwired.length ? strongUnwired : scored;

  // Prefer higher gallery mass, then nearer, then stable ids.
  pool.sort(
    (a, b) =>
      b.count - a.count ||
      a.dist - b.dist ||
      a.nodeId.localeCompare(b.nodeId) ||
      a.port.localeCompare(b.port)
  );

  const sum = pool.reduce((a, r) => a + r.count, 0);
  const top = pool[0];
  const second = pool[1];
  const share = sum > 0 ? top.count / sum : 0;
  if (top.count < MIN_PAIR) return null;
  if (!leads(top.count, second && second.count)) return null;
  // Flat pool (many near-equal) → quiet. Lone clear winner keeps share 1.
  if (pool.length > 1 && share < MIN_SHARE) return null;

  return {
    nodeId: top.nodeId,
    port: top.port,
    type: top.type,
    dir: top.dir,
    count: top.count,
    share,
    wired: top.wired,
  };
}

export { MIN_PAIR, MIN_LEAD, MIN_SHARE };
