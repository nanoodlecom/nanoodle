/**
 * Product · 41 — hover-port peer dim (pure helpers).
 *
 * While hovering a port, classify live peer ports using gallery typeToType /
 * port-pair priors (#621):
 *   lift — opposite-dir type-compatible peers → .compatible / .likely
 *   dim  — opposite-dir type-incompatible peers → soft .dim
 *
 * Quiet (null) when priors are flat/missing so the editor stays quiet
 * (native :hover only). Never creates a wire. Distinct from · 21 (wire-drag
 * graduated rings on compatible targets): this is hover-only and dims
 * incompatible peers while lifting prior-backed compatible ones.
 *
 * No tip panel / no ?product= twin.
 */

import {
  MIN_PAIR,
  MIN_LEAD,
  MIN_SHARE,
  pairCount,
} from "./port-suggest.mjs";

export { MIN_PAIR, MIN_LEAD, MIN_SHARE };

/**
 * @typedef {{ nodeId: string, port: string, type: string, dir?: string, ptype?: string }} PeerPort
 * @typedef {{ nodeId: string, port: string, type: string, count: number, share: number, tier: "likely"|"compatible" }} LiftItem
 * @typedef {{ items: LiftItem[], dim: Array<{ nodeId: string, port: string }>, dimIncompatible: boolean }} HoverPlan
 */

/** Directed gallery pair count. dir "in" means hover started on an input. */
function directedCount(tables, dir, srcType, srcPort, otherType, otherPort) {
  if (dir === "in") return pairCount(tables, otherType, otherPort, srcType, srcPort);
  return pairCount(tables, srcType, srcPort, otherType, otherPort);
}

/** Soft type→type prior (keys like "text→image"). */
export function typeToTypeCount(tables, dir, srcType, otherType) {
  if (!srcType || !otherType) return 0;
  const ttt = tables?.typeToType || {};
  const key = dir === "in" ? `${otherType}→${srcType}` : `${srcType}→${otherType}`;
  return Number(ttt[key]) || 0;
}

/**
 * Score a peer: port-pair is primary (×100). typeToType is a soft nudge so a
 * missing specific pair still ranks above zero without tying a real port-pair
 * edge (e.g. text→image.prompt=8 must beat text→image.model with only type prior).
 */
export function peerScore(tables, dir, srcType, srcPort, peer) {
  if (!peer?.type || !peer.port) return 0;
  const pair = directedCount(tables, dir, srcType, srcPort, peer.type, peer.port);
  const t2t = typeToTypeCount(tables, dir, srcType, peer.type);
  return pair * 100 + t2t;
}

function leads(top, second) {
  return !second || second <= 0 || top >= second * MIN_LEAD;
}

/**
 * Rank live peers for hover dim / lift.
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{
 *   dir?: "out"|"in",
 *   srcType?: string,
 *   srcPort?: string,
 *   srcNodeId?: string,
 *   srcPtype?: string,
 *   peers?: PeerPort[],
 * }} [query]
 * @returns {HoverPlan | null}
 */
export function rankHoverPeers(tables, query = {}) {
  if (!tables?.topTargets && !tables?.typeToType) return null;
  const dir = query.dir === "in" ? "in" : "out";
  const { srcType, srcPort, srcNodeId, srcPtype } = query;
  const peers = query.peers || [];
  if (!srcType || !srcPort || !srcPtype || !peers.length) return null;

  /** @type {PeerPort[]} */
  const opposite = [];
  for (const p of peers) {
    if (!p?.nodeId || !p.port || !p.type) continue;
    if (srcNodeId && p.nodeId === srcNodeId) continue;
    const pdir = p.dir === "in" ? "in" : p.dir === "out" ? "out" : null;
    if (pdir && pdir === dir) continue; // same-side sockets stay untouched
    opposite.push(p);
  }
  if (!opposite.length) return null;

  /** @type {Array<PeerPort & { count: number, pair: number, t2t: number }>} */
  const compatible = [];
  /** @type {PeerPort[]} */
  const incompatible = [];
  for (const p of opposite) {
    const sameType = !!(p.ptype && srcPtype && p.ptype === srcPtype);
    if (!sameType) {
      incompatible.push(p);
      continue;
    }
    const pair = directedCount(tables, dir, srcType, srcPort, p.type, p.port);
    const t2t = typeToTypeCount(tables, dir, srcType, p.type);
    const count = pair * 100 + t2t;
    compatible.push({ ...p, count, pair, t2t });
  }
  if (!compatible.length) return null;

  // Confidence needs a real port-pair (≥ MIN_PAIR). typeToType alone never activates.
  const withPrior = compatible.filter((c) => c.pair > 0 || c.t2t > 0);
  if (!withPrior.length) return null;

  withPrior.sort(
    (a, b) =>
      b.count - a.count ||
      a.nodeId.localeCompare(b.nodeId) ||
      a.port.localeCompare(b.port)
  );

  const sum = withPrior.reduce((a, r) => a + r.count, 0);
  const top = withPrior[0];
  const rival = withPrior[1];
  if (top.pair < MIN_PAIR) return null;
  // Flat rival mass → quiet (compare scaled scores; same spirit as pickRingTarget).
  if (rival && !leads(top.count, rival.count)) return null;
  const share = top.count / sum;
  if (share < MIN_SHARE && rival) return null;

  /** @type {LiftItem[]} */
  const items = [];
  // Lift every type-compatible peer; prior-backed ones get stronger tiers.
  const sortedCompat = [...compatible].sort(
    (a, b) =>
      b.count - a.count ||
      a.nodeId.localeCompare(b.nodeId) ||
      a.port.localeCompare(b.port)
  );
  for (const c of sortedCompat) {
    const cShare = sum > 0 ? c.count / sum : 0;
    let tier = "compatible";
    if (
      c.nodeId === top.nodeId &&
      c.port === top.port &&
      top.pair >= MIN_PAIR
    ) {
      tier = "likely";
    } else if (c.count <= 0) {
      tier = "compatible";
    } else if (cShare >= MIN_SHARE * 0.5) {
      tier = "compatible";
    }
    items.push({
      nodeId: c.nodeId,
      port: c.port,
      type: c.type,
      count: c.count,
      share: cShare,
      tier,
    });
  }

  if (!items.some((i) => i.tier === "likely")) return null;

  const dim = incompatible.map((p) => ({ nodeId: p.nodeId, port: p.port }));
  return { items, dim, dimIncompatible: true };
}

/**
 * @param {HoverPlan | null} plan
 * @param {string} nodeId
 * @param {string} port
 * @returns {"likely"|"compatible"|null}
 */
export function tierFor(plan, nodeId, port) {
  if (!plan?.items?.length) return null;
  const hit = plan.items.find((i) => i.nodeId === nodeId && i.port === port);
  return hit ? hit.tier : null;
}

/**
 * CSS class names beyond base port chrome.
 * @param {"likely"|"compatible"|null|undefined} tier
 * @returns {string[]}
 */
export function classesForTier(tier) {
  if (tier === "likely") return ["compatible", "likely"];
  if (tier === "compatible") return ["compatible"];
  return [];
}

/**
 * Whether a peer should soft-dim under a plan.
 * @param {HoverPlan | null} plan
 * @param {string} nodeId
 * @param {string} port
 */
export function shouldDim(plan, nodeId, port) {
  if (!plan?.dimIncompatible) return false;
  if (tierFor(plan, nodeId, port) != null) return false;
  return plan.dim.some((d) => d.nodeId === nodeId && d.port === port);
}
