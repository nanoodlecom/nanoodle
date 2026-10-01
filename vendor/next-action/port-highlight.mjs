/**
 * Product · 21 — wire-drop port highlight polish (pure helpers).
 *
 * Ranks live compatible ports for graduated drag rings using gallery
 * port-pair priors (#621). Never creates a wire. When the prior is flat
 * or missing, returns null so the editor keeps today's compatible-only glow.
 *
 * Tiers:
 *   likely — clear #1 (same confidence gate as pickRingTarget)
 *   fit    — strong runners-up (still prior-backed)
 * dimOthers — soft-dim remaining compatible sockets when ranked
 */

import {
  MIN_PAIR,
  MIN_LEAD,
  MIN_SHARE,
  pairCount,
} from "./port-suggest.mjs";

export const MAX_FIT = 2;
export const FIT_SHARE = MIN_SHARE * 0.75; // runners may be a bit softer than menu share

/**
 * @typedef {{ nodeId: string, port: string, type: string, count: number, share: number, tier: "likely"|"fit" }} RingItem
 * @typedef {{ items: RingItem[], dimOthers: boolean }} RingPlan
 */

function directedCount(tables, dir, srcType, srcPort, otherType, otherPort) {
  if (dir === "in") return pairCount(tables, otherType, otherPort, srcType, srcPort);
  return pairCount(tables, srcType, srcPort, otherType, otherPort);
}

function leads(top, second) {
  return !second || second <= 0 || top >= second * MIN_LEAD;
}

/**
 * Rank compatible live ports for graduated drag highlight.
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{
 *   dir?: "out"|"in",
 *   srcType?: string,
 *   srcPort?: string,
 *   srcNodeId?: string,
 *   targets?: Array<{ nodeId: string, type: string, port: string }>,
 *   maxFit?: number,
 * }} [query]
 * @returns {RingPlan | null}
 */
export function rankRingTargets(tables, query = {}) {
  if (!tables?.topTargets) return null;
  const dir = query.dir === "in" ? "in" : "out";
  const { srcType, srcPort } = query;
  const targets = query.targets || [];
  const maxFit = query.maxFit ?? MAX_FIT;
  if (!srcType || !srcPort || !targets.length) return null;

  /** @type {Array<{ nodeId: string, port: string, type: string, count: number }>} */
  const scored = [];
  for (const t of targets) {
    if (!t?.nodeId || !t.type || !t.port) continue;
    if (query.srcNodeId && t.nodeId === query.srcNodeId) continue;
    const count = directedCount(tables, dir, srcType, srcPort, t.type, t.port);
    if (count > 0) scored.push({ nodeId: t.nodeId, port: t.port, type: t.type, count });
  }
  if (!scored.length) return null;

  scored.sort(
    (a, b) =>
      b.count - a.count ||
      a.nodeId.localeCompare(b.nodeId) ||
      a.port.localeCompare(b.port)
  );

  const sum = scored.reduce((a, r) => a + r.count, 0);
  const top = scored[0];
  const rival = scored[1];
  if (top.count < MIN_PAIR) return null;
  // Same confidence gate as pickRingTarget for the #1 slot — stay quiet when flat.
  if (rival && !leads(top.count, rival.count)) return null;

  /** @type {RingItem[]} */
  const items = [
    {
      nodeId: top.nodeId,
      port: top.port,
      type: top.type,
      count: top.count,
      share: top.count / sum,
      tier: "likely",
    },
  ];

  for (let i = 1; i < scored.length && items.length - 1 < maxFit; i++) {
    const r = scored[i];
    const share = r.count / sum;
    if (r.count < MIN_PAIR) continue;
    if (share < FIT_SHARE) continue;
    items.push({
      nodeId: r.nodeId,
      port: r.port,
      type: r.type,
      count: r.count,
      share,
      tier: "fit",
    });
  }

  return { items, dimOthers: true };
}

/**
 * Look up the tier for a live (nodeId, port) against a plan.
 * @param {RingPlan | null} plan
 * @param {string} nodeId
 * @param {string} port
 * @returns {"likely"|"fit"|null}
 */
export function tierFor(plan, nodeId, port) {
  if (!plan?.items?.length) return null;
  const hit = plan.items.find((i) => i.nodeId === nodeId && i.port === port);
  return hit ? hit.tier : null;
}

/**
 * CSS class names to apply for a ranked hit (beyond base `compatible`).
 * @param {"likely"|"fit"|null|undefined} tier
 * @returns {string[]}
 */
export function classesForTier(tier) {
  if (tier === "likely") return ["likely"];
  if (tier === "fit") return ["fit"];
  return [];
}

/**
 * Whether a non-ranked compatible port should soft-dim.
 * @param {RingPlan | null} plan
 * @param {string} nodeId
 * @param {string} port
 */
export function shouldDim(plan, nodeId, port) {
  if (!plan?.dimOthers) return false;
  return tierFor(plan, nodeId, port) == null;
}
