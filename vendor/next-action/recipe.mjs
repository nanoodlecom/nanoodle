/**
 * Product · 8 — recipe / subgraph completer (Examples gallery templates).
 * Frequency / multiset match only; no learned weights.
 */

/**
 * @typedef {{
 *   id: string,
 *   slug: string,
 *   title: string,
 *   sequence: string[],
 *   multiset: Record<string, number>,
 * }} Recipe
 */

/** Count non-comment node types. */
export function typeMultiset(types = []) {
  /** @type {Record<string, number>} */
  const m = {};
  for (const t of types) {
    if (!t || t === "comment") continue;
    m[t] = (m[t] || 0) + 1;
  }
  return m;
}

/** Ordered non-comment types from a gallery graph (file order). */
export function sequenceFromGraph(graph = {}) {
  return (graph.nodes || [])
    .map((n) => n?.type)
    .filter((t) => t && t !== "comment");
}

/**
 * True when every current type-count fits inside the recipe multiset
 * and at least `minCover` nodes are covered.
 */
export function isPartialMatch(currentMs, recipeMs, minCover = 1) {
  let covered = 0;
  for (const [t, c] of Object.entries(currentMs || {})) {
    const have = recipeMs?.[t] || 0;
    if (have < c) return false;
    covered += c;
  }
  return covered >= minCover;
}

/**
 * Remaining recipe types after greedily consuming the current multiset
 * from left to right along the template sequence.
 */
export function remainingSequence(recipeSeq, currentMs) {
  /** @type {Record<string, number>} */
  const need = { ...(currentMs || {}) };
  const remaining = [];
  for (const t of recipeSeq || []) {
    if ((need[t] || 0) > 0) {
      need[t]--;
    } else {
      remaining.push(t);
    }
  }
  return remaining;
}

/**
 * Build recipe list from gallery graphs + optional title map (slug → title).
 * @param {Array<{ slug?: string, id?: string, graph: any, title?: string }>} entries
 * @returns {{ recipes: Recipe[], exampleCount: number, bakedAt: string }}
 */
export function buildRecipes(entries = []) {
  const recipes = [];
  for (const e of entries) {
    const slug = e.slug || e.id;
    if (!slug || !e.graph) continue;
    const sequence = sequenceFromGraph(e.graph);
    if (sequence.length < 2) continue;
    const multiset = typeMultiset(sequence);
    recipes.push({
      id: slug,
      slug,
      title: e.title || slug,
      sequence,
      multiset,
    });
  }
  recipes.sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    schemaVersion: 1,
    product: 8,
    exampleCount: recipes.length,
    bakedAt: new Date().toISOString(),
    recipes,
  };
}

/**
 * Score: prefer high coverage, then fewer remaining stages, then shorter recipes.
 */
function scoreMatch(covered, remainingLen, recipeLen) {
  return covered * 100 - remainingLen * 3 - recipeLen * 0.01;
}

/**
 * Rank recipes that the current graph partially matches; return chips with
 * the next 2–3 missing `add:type` actions (not the whole remainder if huge).
 *
 * Empty canvas / no matching types → [] (cold-start stays · 6's job).
 *
 * @param {{ recipes?: Recipe[] } | Recipe[]} recipesOrCorpus
 * @param {{ nodeTypeCounts?: Record<string, number>, numNodes?: number } | string[]} sketchOrNodeTypes
 * @param {number} [k]
 * @returns {Array<{
 *   id: string,
 *   slug: string,
 *   title: string,
 *   score: number,
 *   covered: number,
 *   remaining: string[],
 *   actions: string[],
 *   source: string
 * }>}
 */
export function recommendRecipes(recipesOrCorpus, sketchOrNodeTypes = {}, k = 3) {
  const recipes = Array.isArray(recipesOrCorpus)
    ? recipesOrCorpus
    : recipesOrCorpus?.recipes || [];
  if (!recipes.length) return [];

  /** @type {Record<string, number>} */
  let currentMs;
  let numNodes = 0;
  if (Array.isArray(sketchOrNodeTypes)) {
    currentMs = typeMultiset(sketchOrNodeTypes);
    numNodes = Object.values(currentMs).reduce((a, b) => a + b, 0);
  } else {
    currentMs = { ...(sketchOrNodeTypes?.nodeTypeCounts || {}) };
    delete currentMs.comment;
    numNodes =
      sketchOrNodeTypes?.numNodes ??
      Object.values(currentMs).reduce((a, b) => a + b, 0);
  }

  if (!numNodes || Object.keys(currentMs).length === 0) return [];

  /** @type {Array<any>} */
  const scored = [];
  for (const r of recipes) {
    if (!isPartialMatch(currentMs, r.multiset, 1)) continue;
    const covered = Object.values(currentMs).reduce((a, b) => a + b, 0);
    const remaining = remainingSequence(r.sequence, currentMs);
    if (!remaining.length) continue; // already complete
    const next = remaining.slice(0, 3);
    const actions = next.map((t) => `add:${t}`);
    scored.push({
      id: r.id || r.slug,
      slug: r.slug,
      title: r.title || r.slug,
      score: scoreMatch(covered, remaining.length, r.sequence.length),
      covered,
      remaining,
      actions,
      source: "recipe",
    });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.remaining.length - b.remaining.length ||
      a.slug.localeCompare(b.slug)
  );
  return scored.slice(0, k);
}

export { scoreMatch };
