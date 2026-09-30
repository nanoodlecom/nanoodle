/**
 * Product · 25 — empty-canvas follow-up polish (pure helpers).
 *
 * After cold-start / first-seat, when the canvas is still nearly empty
 * (0–1 non-comment nodes) and a stronger post-first / recipe / learned lift
 * is NOT already confident, soft-merge a short “popular next” trio from
 * firstTrio + cold-start / firstNode into add-node/search Suggested rows.
 *
 * Differentiates from · 23 (`post-first.mjs`): · 23 activates only on
 * numNodes === 1 and lifts type-matched firstTrio/recipe when confident.
 * · 25 is the fallback for near-empty (0 or 1) when that lift is quiet/flat.
 * Quiet when numNodes >= 2 (busy canvas) or when prior rows already carry a
 * confident strong-source Suggested lift.
 *
 * No tip panel, no ghost overlay, no ?product= surface. When unsure, callers
 * leave add-node / search lists exactly as they are today.
 */

import { MIN_SHARE, MIN_LEAD } from "./hints.mjs";

/**
 * @typedef {{
 *   unigram?: Record<string, number>,
 *   coldStart?: Record<string, number>,
 *   firstNode?: Record<string, number>,
 *   firstTrio?: { actions: string[], count: number }[],
 * }} FreqTables
 */

/** Sources that already own a confident Suggested lift — · 25 stays quiet. */
export const STRONG_SOURCES = Object.freeze([
  "first-trio",
  "recipe",
  "post-first",
  "learned",
]);

/** True when the canvas has 0 or 1 non-comment nodes. */
export function isNearEmptySketch(sketch = {}) {
  const n = Number(sketch?.numNodes) || 0;
  return n === 0 || n === 1;
}

/**
 * Placed first-node type when numNodes === 1.
 * @param {{ nodeTypeCounts?: Record<string, number>, selectedType?: string|null, numNodes?: number }} sketch
 * @returns {string|null}
 */
export function placedNearEmptyType(sketch = {}) {
  if ((Number(sketch?.numNodes) || 0) !== 1) return null;
  const counts = sketch.nodeTypeCounts || {};
  const hits = Object.entries(counts).filter(
    ([t, c]) => t && t !== "comment" && (Number(c) || 0) > 0
  );
  if (hits.length === 1) return hits[0][0];
  if (sketch.selectedType && sketch.selectedType !== "comment") {
    return sketch.selectedType;
  }
  if (hits.length) {
    hits.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return hits[0][0];
  }
  return null;
}

function topAddRows(counts, k, source) {
  return Object.entries(counts || {})
    .filter(([a]) => String(a).startsWith("add:"))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([action, count]) => ({ action, score: count, source }));
}

/**
 * Confidence gate matching projectHints (share + lead). Returns [] when thin.
 * @param {Array<{action:string, score:number, source?:string}>} rows
 */
export function gateConfidentAdds(rows, opts = {}) {
  const minShare = opts.minShare ?? MIN_SHARE;
  const minLead = opts.minLead ?? MIN_LEAD;
  if (!Array.isArray(rows) || !rows.length) return [];
  const sum = rows.reduce((a, r) => a + Math.max(0, Number(r.score) || 0), 0);
  if (!(sum > 0)) return [];
  const ranked = rows
    .map((r) => ({
      ...r,
      share: Math.max(0, Number(r.score) || 0) / sum,
    }))
    .sort((a, b) => b.share - a.share || a.action.localeCompare(b.action));
  const top = ranked[0];
  const second = ranked[1];
  const leads =
    !second || second.share <= 0 || top.share >= second.share * minLead;
  if (!leads || top.share < minShare) return [];
  return ranked;
}

/**
 * Up to k `add:*` popular-next rows for a near-empty sketch.
 * - numNodes === 0: firstNode/coldStart + firstTrio early adds (first + soft second)
 * - numNodes === 1: type-matched firstTrio seconds when present; else global
 *   popular seconds + soft cold-start (fallback when · 23 post-first is thin)
 *
 * @param {FreqTables} tables
 * @param {{ numNodes?: number, nodeTypeCounts?: Record<string, number>, selectedType?: string|null }} sketch
 * @param {string[]} [history]
 * @param {{ k?: number }} [opts]
 */
export function rankEmptyFollowups(tables, sketch = {}, history = [], opts = {}) {
  if (!isNearEmptySketch(sketch)) return [];
  const k = opts.k ?? 3;
  const n = Number(sketch.numNodes) || 0;
  /** @type {Record<string, number>} */
  const counts = {};

  if (n === 0) {
    const first =
      (tables.firstNode && Object.keys(tables.firstNode).length && tables.firstNode) ||
      tables.coldStart ||
      {};
    for (const [a, c] of Object.entries(first)) {
      if (String(a).startsWith("add:")) counts[a] = (counts[a] || 0) + (Number(c) || 0);
    }
    for (const row of tables.firstTrio || []) {
      const acts = row && row.actions;
      if (!Array.isArray(acts)) continue;
      const c = Number(row.count) || 0;
      if (acts[0] && String(acts[0]).startsWith("add:")) {
        counts[acts[0]] = (counts[acts[0]] || 0) + c;
      }
      // Soft second-step as “popular early” diversity on empty canvas
      if (acts[1] && String(acts[1]).startsWith("add:")) {
        counts[acts[1]] = (counts[acts[1]] || 0) + c * 0.55;
      }
    }
    return topAddRows(counts, k, "cold-start");
  }

  // numNodes === 1
  const type = placedNearEmptyType(sketch);
  const head = type ? `add:${type}` : null;
  let matched = 0;
  for (const row of tables.firstTrio || []) {
    const acts = row && row.actions;
    if (!Array.isArray(acts) || acts.length < 2) continue;
    const c = Number(row.count) || 0;
    if (head && acts[0] === head && String(acts[1]).startsWith("add:")) {
      counts[acts[1]] = (counts[acts[1]] || 0) + c;
      matched += c;
    }
  }
  if (!(matched > 0)) {
    // · 23-thin fallback: global popular seconds + soft cold-start / firstNode
    for (const row of tables.firstTrio || []) {
      const acts = row && row.actions;
      if (!Array.isArray(acts) || acts.length < 2) continue;
      if (String(acts[1]).startsWith("add:")) {
        counts[acts[1]] =
          (counts[acts[1]] || 0) + (Number(row.count) || 0);
      }
    }
    const soft =
      (tables.coldStart && Object.keys(tables.coldStart).length && tables.coldStart) ||
      tables.firstNode ||
      {};
    for (const [a, c] of Object.entries(soft)) {
      if (String(a).startsWith("add:")) {
        counts[a] = (counts[a] || 0) + (Number(c) || 0) * 0.35;
      }
    }
  } else {
    // Optional third step when history already recorded opening + second
    const hist = Array.isArray(history) ? history : [];
    if (head && hist.length === 2 && hist[0] === head) {
      for (const row of tables.firstTrio || []) {
        const acts = row && row.actions;
        if (!Array.isArray(acts) || acts.length < 3) continue;
        if (acts[0] !== head || acts[1] !== hist[1]) continue;
        if (String(acts[2]).startsWith("add:")) {
          counts[acts[2]] =
            (counts[acts[2]] || 0) + (Number(row.count) || 0) * 0.75;
        }
      }
    }
  }
  return topAddRows(counts, k, matched > 0 ? "first-trio" : "empty-followup");
}

/**
 * False when canvas is busy, or when prior rows already carry a confident
 * strong-source lift (post-first / recipe / first-trio / learned).
 *
 * @param {Array<{action:string, score:number, source?:string}>} priorRows
 * @param {object} sketch
 * @param {{
 *   postFirstConfident?: boolean,
 *   recipeConfident?: boolean,
 *   priorHints?: { confident?: boolean, adds?: { source?: string, reason?: string }[] },
 * }} [opts]
 */
export function shouldApplyEmptyFollowup(priorRows = [], sketch = {}, opts = {}) {
  if (!isNearEmptySketch(sketch)) return false;
  if (opts.postFirstConfident || opts.recipeConfident) return false;
  const hints = opts.priorHints;
  if (hints && hints.confident) {
    const adds = Array.isArray(hints.adds) ? hints.adds : [];
    const strongHit = adds.some(
      (a) =>
        STRONG_SOURCES.includes(a && a.source) ||
        a?.reason === "recipe next" ||
        (a?.source === "first-trio" && a?.reason === "common opening")
    );
    // Only quiet on strong-source confident hints — plain cold-start /
    // frequency confidence does not block · 25 enrichment.
    if (strongHit) return false;
  }
  const prior = Array.isArray(priorRows) ? priorRows : [];
  const strongRows = prior.filter((r) => r && STRONG_SOURCES.includes(r.source));
  if (strongRows.length) {
    const gated = gateConfidentAdds(strongRows);
    if (gated.length) return false;
  }
  return true;
}

/**
 * Soft-merge empty-followup rows into frequency prior rows.
 * Empty merge (busy canvas / strong prior / thin tables) returns `rows` unchanged.
 *
 * @param {Array<{action:string, score:number, source?:string}>} rows
 * @param {FreqTables} tables
 * @param {string[]} history
 * @param {object} sketch
 * @param {{ maxAdds?: number, nodeTypes?: Set<string>|null, postFirstConfident?: boolean, recipeConfident?: boolean, priorHints?: object }} [opts]
 */
export function mergeEmptyFollowupRows(
  rows,
  tables,
  history = [],
  sketch = {},
  opts = {}
) {
  const base = Array.isArray(rows) ? rows : [];
  if (!shouldApplyEmptyFollowup(base, sketch, opts)) return base;
  const k = opts.maxAdds ?? 3;
  const followups = rankEmptyFollowups(tables, sketch, history, { k });
  if (!followups.length) return base;

  // Soft gate: need a usable top; when the trio is flat across many equals,
  // still allow a clear leader. If gate fails entirely, leave lists alone.
  const gated = gateConfidentAdds(followups);
  const boost = gated.length ? gated.slice(0, k) : followups.slice(0, k);
  // Extra quiet: if even the raw followups have no positive scores, bail
  if (!boost.length || !boost.some((r) => (Number(r.score) || 0) > 0)) return base;

  // When prior already has a confident *non-strong* lift with the same top
  // action and >= k add:* rows already dominating, still enrich diversity
  // via soft-merge (cold-start singleton → popular trio).

  /** @type {Map<string, {action:string, score:number, source?:string}>} */
  const by = new Map();
  for (const r of base) {
    if (!r || !r.action) continue;
    by.set(r.action, {
      action: r.action,
      score: Number(r.score) || 0,
      source: r.source,
    });
  }
  // Rank-decayed lift with lead ≥ MIN_LEAD while #2/#3 still clear MIN_SHARE.
  // Dampen other add:* priors so leftover bigram mass doesn't flatten the gate.
  const ceiling = [...by.values()].reduce((m, r) => Math.max(m, r.score), 0);
  const scale = Math.max(10, ceiling) * 6;
  const weights = boost.map((r, i) => {
    const raw = Math.max(0, Number(r.score) || 0);
    if (!(raw > 0)) return 0;
    return Math.pow(0.68, i);
  });
  const wSum = weights.reduce((a, w) => a + w, 0) || 1;
  const boostSet = new Set();
  boost.forEach((r, i) => {
    if (opts.nodeTypes) {
      const type = String(r.action).startsWith("add:")
        ? r.action.slice(4)
        : "";
      if (type && !opts.nodeTypes.has(type)) return;
    }
    const share = weights[i] / wSum;
    const prior = by.get(r.action);
    const score =
      scale * share + (prior ? Math.min(prior.score, scale * 0.03) : 0);
    by.set(r.action, {
      action: r.action,
      score,
      source: r.source || (prior && prior.source) || "empty-followup",
    });
    boostSet.add(r.action);
  });
  for (const [action, row] of by) {
    if (!String(action).startsWith("add:")) continue;
    if (boostSet.has(action)) continue;
    by.set(action, { ...row, score: (Number(row.score) || 0) * 0.12 });
  }
  return [...by.values()].sort(
    (a, b) => b.score - a.score || a.action.localeCompare(b.action)
  );
}

export { MIN_SHARE, MIN_LEAD };
