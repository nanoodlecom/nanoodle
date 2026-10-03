/**
 * Product · 26 — add-search popular match (pure helpers).
 *
 * While #addsearch has a query, lift one gallery-popular type that is already
 * a real title/id match ahead of weaker matches, and tag it only when that
 * move changes the order. An empty query, a one-letter query, a fuzzy guess,
 * or a tie stays exactly as the search list is today.
 */

import { MIN_SHARE, MIN_LEAD } from "./hints.mjs";

export const SOURCE = "add-search-popular";
export const REASON = "popular match";

export function normalizeQuery(q) {
  return String(q || "").trim().toLowerCase();
}

/** 0 prefix, 1 title/id substring, -1 no match. Title and id only. */
export function matchRank(type, meta, query) {
  const q = normalizeQuery(query);
  if (q.length < 2) return -1;
  const id = String(type || "").toLowerCase();
  const title = String((meta && meta.title) || "").toLowerCase();
  if ((id && id.startsWith(q)) || (title && title.startsWith(q))) return 0;
  if ((id && id.includes(q)) || (title && title.includes(q))) return 1;
  return -1;
}

function popularity(tables) {
  /** @type {Record<string, number>} */
  const out = {};
  const uni = tables && tables.unigram;
  if (!uni || typeof uni !== "object") return out;
  for (const [action, n] of Object.entries(uni)) {
    if (!String(action).startsWith("add:")) continue;
    const c = Number(n) || 0;
    if (c > 0) out[action] = c;
  }
  return out;
}

/**
 * @param {string[]} naturalIds  today's search order, best textual matches first
 * @returns {{ type:string, action:string, reason:string, source:string, share:number } | null}
 */
export function pickSearchLift(query, tables, typeMeta, naturalIds, opts = {}) {
  const q = normalizeQuery(query);
  if (q.length < 2) return null;
  const ids = Array.isArray(naturalIds) ? naturalIds.filter((id) => typeof id === "string" && id && id !== "comment") : [];
  if (!ids.length) return null;
  const metaMap = typeMeta && typeof typeMeta === "object" ? typeMeta : {};
  const counts = popularity(tables || {});
  let bestRank = Infinity;
  for (const type of ids) {
    const rank = matchRank(type, metaMap[type], q);
    if (rank >= 0 && rank < bestRank) bestRank = rank;
  }
  if (!Number.isFinite(bestRank)) return null;

  const tierIds = ids.filter((type) => matchRank(type, metaMap[type], q) === bestRank);
  if (!tierIds.length) return null;

  /** @type {Array<{type:string, score:number}>} */
  const scored = [];
  for (const type of tierIds) {
    const base = Number(counts["add:" + type]) || 0;
    if (!(base > 0)) continue;
    const mult = bestRank === 0 ? 1 : 0.55;
    scored.push({ type, score: base * mult });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));
  const sum = scored.reduce((a, r) => a + r.score, 0);
  const top = scored[0];
  const second = scored[1];
  const minLead = opts.minLead ?? MIN_LEAD;
  const minShare = opts.minShare ?? MIN_SHARE;
  const share = top.score / sum;
  const leads = !second || second.score <= 0 || top.score >= second.score * minLead;
  if (!leads || share < minShare) return null;
  // Already the first row of this match tier — tagging would not change the list.
  if (tierIds[0] === top.type) return null;
  return {
    type: top.type,
    action: "add:" + top.type,
    reason: REASON,
    source: SOURCE,
    share,
  };
}

export { MIN_SHARE, MIN_LEAD };
