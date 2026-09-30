/**
 * Product · 23 — post-first-node follow-up in Suggested (pure helpers).
 *
 * After the first non-comment node lands (empty→1 / numNodes === 1), rank
 * firstTrio continuations and soft-merge confident recipe next-adds so the
 * second move sits at the top of add-node/search Suggested rows.
 * Complements · 20 first-seat but ships from main without · 20 merged.
 *
 * No tip panel, no ghost overlay, no ?product= surface. When the prior is
 * unsure, callers leave add-node / search lists exactly as they are today.
 */

import { MIN_SHARE, MIN_LEAD } from "./hints.mjs";
import { recommendRecipes } from "./recipe.mjs";

/**
 * @typedef {{
 *   unigram?: Record<string, number>,
 *   coldStart?: Record<string, number>,
 *   firstNode?: Record<string, number>,
 *   firstTrio?: { actions: string[], count: number }[],
 * }} FreqTables
 */

/** True when the canvas has exactly one non-comment node. */
export function isPostFirstPhase(sketch = {}) {
  const n = Number(sketch?.numNodes) || 0;
  return n === 1;
}

/**
 * Placed first-node type from sketch counts / selectedType.
 * @param {{ nodeTypeCounts?: Record<string, number>, selectedType?: string|null, numNodes?: number }} sketch
 * @returns {string|null} bare type (e.g. "text") or null
 */
export function placedFirstType(sketch = {}) {
  if (!isPostFirstPhase(sketch)) return null;
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
 * Next add:* steps from firstTrio rows whose first action matches the placed
 * node type. Takes actions[1]; when history already includes the first add,
 * optionally folds actions[2] for length-2 history prefixes.
 * Quiet on empty / many-node sketches.
 *
 * @param {FreqTables} tables
 * @param {{ numNodes?: number, nodeTypeCounts?: Record<string, number>, selectedType?: string|null }} sketch
 * @param {string[]} [history]
 * @param {number} [k]
 */
export function rankPostFirstFollowups(tables, sketch = {}, history = [], k = 3) {
  if (!isPostFirstPhase(sketch)) return [];
  const type = placedFirstType(sketch);
  if (!type) return [];
  const head = `add:${type}`;
  /** @type {Record<string, number>} */
  const counts = {};
  const hist = Array.isArray(history) ? history : [];
  for (const row of tables.firstTrio || []) {
    const acts = row && row.actions;
    if (!Array.isArray(acts) || acts.length < 2) continue;
    if (acts[0] !== head) continue;
    const next = acts[1];
    if (next && String(next).startsWith("add:")) {
      counts[next] = (counts[next] || 0) + (Number(row.count) || 0);
    }
    // Optional third step when history already recorded the opening add
    // (and optionally the second), matching a length-2 prefix.
    if (
      acts.length >= 3 &&
      hist.length >= 1 &&
      hist.length <= 2 &&
      hist[0] === head &&
      (hist.length === 1 || hist[1] === acts[1])
    ) {
      // When hist length is 1, actions[1] is already counted above as next.
      // When hist length is 2 and matches, surface actions[2].
      if (hist.length === 2) {
        const third = acts[2];
        if (third && String(third).startsWith("add:")) {
          counts[third] = (counts[third] || 0) + (Number(row.count) || 0);
        }
      }
    }
  }
  if (!Object.keys(counts).length) return [];
  return topAddRows(counts, k, "first-trio");
}

/**
 * Soft recipe next-adds for a 1-node sketch (cover ≥ 1). Existing
 * confidentRecipe requires MIN_COVERED=2, so post-first uses recommendRecipes
 * + share/lead gates. Quiet when rivals disagree or the prior is thin.
 *
 * @param {{ recipes?: any[] } | any[]} corpus
 * @param {object} sketch
 * @param {{ nodeTypes?: Set<string>|null, k?: number }} [opts]
 */
export function rankPostFirstRecipes(corpus, sketch = {}, opts = {}) {
  if (!isPostFirstPhase(sketch)) return [];
  const matches = recommendRecipes(corpus, sketch, opts.k ?? 8).filter(
    (r) => (r.covered || 0) >= 1
  );
  if (!matches.length) return [];
  const known = opts.nodeTypes || null;
  /** @type {Record<string, number>} */
  const counts = {};
  for (const m of matches) {
    const action = m.actions && m.actions[0];
    if (!action || !String(action).startsWith("add:")) continue;
    const type = action.slice(4);
    if (!type) continue;
    if (known && !known.has(type)) continue;
    const w = Math.max(1, Number(m.score) || 0);
    counts[action] = (counts[action] || 0) + w;
  }
  if (!Object.keys(counts).length) return [];
  return topAddRows(counts, opts.maxAdds ?? 3, "recipe");
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
  const leads = !second || second.share <= 0 || top.share >= second.share * minLead;
  if (!leads || top.share < minShare) return [];
  return ranked;
}

/**
 * Soft-merge post-first firstTrio + recipe rows into frequency prior rows.
 * Empty merge (wrong phase / unsure) returns `rows` unchanged.
 *
 * @param {Array<{action:string, score:number, source?:string}>} rows
 * @param {FreqTables} tables
 * @param {{ recipes?: any[] } | any[] | null} recipes
 * @param {string[]} history
 * @param {object} sketch
 * @param {{ maxAdds?: number, nodeTypes?: Set<string>|null }} [opts]
 */
export function mergePostFirstRows(
  rows,
  tables,
  recipes,
  history = [],
  sketch = {},
  opts = {}
) {
  const base = Array.isArray(rows) ? rows : [];
  if (!isPostFirstPhase(sketch)) return base;
  const k = opts.maxAdds ?? 3;
  const trio = gateConfidentAdds(
    rankPostFirstFollowups(tables, sketch, history, k)
  );
  const recipeRows = recipes
    ? gateConfidentAdds(
        rankPostFirstRecipes(recipes, sketch, {
          nodeTypes: opts.nodeTypes || null,
          maxAdds: k,
        })
      )
    : [];

  /** Prefer firstTrio; fold recipe when it is also confident. */
  /** @type {Array<{action:string, score:number, source?:string, share?:number}>} */
  let boost = [];
  if (trio.length) {
    boost = trio.map((r) => ({
      action: r.action,
      score: r.score,
      source: r.source || "first-trio",
      share: r.share,
    }));
    if (recipeRows.length) {
      const seen = new Set(boost.map((r) => r.action));
      for (const r of recipeRows) {
        if (seen.has(r.action)) continue;
        if (boost.length >= k) break;
        boost.push({
          action: r.action,
          score: r.score * 0.85,
          source: "recipe",
          share: r.share,
        });
        seen.add(r.action);
      }
    }
  } else if (recipeRows.length) {
    boost = recipeRows.map((r) => ({
      action: r.action,
      score: r.score,
      source: "recipe",
      share: r.share,
    }));
  }
  if (!boost.length) return base;

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
  const ceiling = [...by.values()].reduce((m, r) => Math.max(m, r.score), 0);
  const scale = Math.max(1, ceiling) * 2;
  const boostSum = boost.reduce((a, r) => a + Math.max(0, Number(r.score) || 0), 0) || 1;
  for (const r of boost) {
    const share = Math.max(0, Number(r.score) || 0) / boostSum;
    const prior = by.get(r.action);
    const score = scale * share + (prior ? prior.score : 0);
    by.set(r.action, {
      action: r.action,
      score,
      source: r.source || (prior && prior.source) || "post-first",
    });
  }
  return [...by.values()].sort(
    (a, b) => b.score - a.score || a.action.localeCompare(b.action)
  );
}

export { MIN_SHARE, MIN_LEAD };
