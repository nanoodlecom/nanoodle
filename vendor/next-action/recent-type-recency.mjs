/**
 * Product · 38 — recent-type recency boost (pure helpers).
 *
 * When recipe / first-node / first-trio are quiet, one clear recent add:*
 * lifts to the front of Suggested with “you just used this”. A tie between
 * recent types stays in the ordinary Recent group, unmarked. The tag is
 * applied only when that lift actually changes the Suggested order.
 */

import { MIN_SHARE, MIN_LEAD } from "./hints.mjs";

export const SOURCE = "recent-type";
export const REASON = "you just used this";
export const MAX_RECENCY_SUGGEST = 3;

/** Contextual Suggested owners. Frequency and the learned blend are not these. */
export const STRONG_SOURCES = Object.freeze([
  "first-trio",
  "recipe",
  "post-first",
  "learned",
  "cold-start",
  "first-node",
  "empty-followup",
]);

export function normalizeRingTokens(ringTokensOrEntries) {
  if (!Array.isArray(ringTokensOrEntries)) return [];
  const out = [];
  for (const e of ringTokensOrEntries) {
    if (typeof e === "string" && e) out.push(e);
    else if (e && typeof e.token === "string" && e.token) out.push(e.token);
  }
  return out;
}

/** Last K add:* tokens, oldest → newest. */
export function extractRecentAdds(ringTokensOrEntries, k = 8) {
  const tokens = normalizeRingTokens(ringTokensOrEntries);
  const adds = [];
  for (let i = tokens.length - 1; i >= 0 && adds.length < k; i--) {
    const t = tokens[i];
    if (typeof t === "string" && t.startsWith("add:") && t.length > 4) adds.push(t);
  }
  return adds.reverse();
}

export function priorHasStrongSource(priorAdds) {
  if (!Array.isArray(priorAdds)) return false;
  return priorAdds.some((a) => a && STRONG_SOURCES.includes(a.source));
}

/**
 * One clear recent type, or [].
 * A single distinct type is clear. Several types are a tie unless one was
 * repeated and holds a real majority of the newest-weighted mass.
 */
export function rankRecentTypeRecency(ringTokensOrEntries, opts = {}) {
  if (opts.disabled) return [];
  if (opts.quietIfStrongPrior !== false && priorHasStrongSource(opts.priorAdds)) return [];
  const recent = extractRecentAdds(ringTokensOrEntries, opts.k ?? 8);
  if (!recent.length) return [];
  const known = opts.nodeTypes || null;
  /** @type {Record<string, {weight:number, count:number}>} */
  const raw = {};
  recent.forEach((action, i) => {
    const type = action.slice(4);
    if (!type || type === "comment") return;
    if (known && !known.has(type)) return;
    const row = raw[action] || { weight: 0, count: 0 };
    row.weight += i + 1;
    row.count += 1;
    raw[action] = row;
  });
  const rows = Object.entries(raw).map(([action, row]) => ({
    action,
    type: action.slice(4),
    score: row.weight,
    count: row.count,
    source: SOURCE,
    reason: REASON,
  }));
  if (!rows.length) return [];
  rows.sort((a, b) => b.score - a.score || a.action.localeCompare(b.action));
  const sum = rows.reduce((a, r) => a + r.score, 0);
  const top = rows[0];
  const second = rows[1];
  top.share = top.score / sum;
  if (second) second.share = second.score / sum;
  const distinct = rows.length;
  if (distinct > 1) {
    const lead = !second || second.score <= 0 || top.score >= second.score * Math.max(MIN_LEAD, 2);
    const majority = top.share >= Math.max(MIN_SHARE, 0.6);
    if (top.count < 2 || !lead || !majority) return [];
  }
  return [{ ...top, share: top.score / sum, source: SOURCE, reason: REASON }];
}

/**
 * Lift the clear recent type to the front. Returns the prior list unchanged
 * when a strong source owns it, there is no hit, or that type is already first
 * (no new suggested tag).
 */
export function applyRecentTypeLift(priorAdds, hits, opts = {}) {
  const max = opts.max ?? MAX_RECENCY_SUGGEST;
  const prior = (Array.isArray(priorAdds) ? priorAdds : []).filter((a) => a && a.type).slice(0, max);
  if (priorHasStrongSource(prior) || !hits || !hits.length) {
    return { adds: prior, changed: false, tagged: [] };
  }
  const hit = hits[0];
  if (!hit || !hit.type) return { adds: prior, changed: false, tagged: [] };
  const priorTypes = prior.map((a) => a.type);
  if (priorTypes[0] === hit.type) return { adds: prior, changed: false, tagged: [] };
  const nextTypes = [hit.type];
  for (const t of priorTypes) {
    if (nextTypes.length >= max) break;
    if (!nextTypes.includes(t)) nextTypes.push(t);
  }
  const by = new Map(prior.map((a) => [a.type, a]));
  by.set(hit.type, {
    type: hit.type,
    action: hit.action || "add:" + hit.type,
    reason: hit.reason || REASON,
    source: SOURCE,
    share: Number(hit.share) || 0,
  });
  const adds = nextTypes.map((t) => by.get(t)).filter(Boolean);
  return { adds, changed: true, tagged: [hit.type] };
}

export { MIN_SHARE, MIN_LEAD };
