/**
 * Partial matches of the live graph against Examples-gallery recipes.
 * A confident match can re-rank the add menu and the Examples shelf, and
 * pin that next type to the top of an existing search hit list.
 * Empty canvases and close disagreements stay quiet. No chips, no extra row.
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
    const count = Number(c) || 0;
    if (count <= 0) continue;
    const have = recipeMs?.[t] || 0;
    if (have < count) return false;
    covered += count;
  }
  return covered >= minCover;
}

/**
 * Remaining recipe types after greedily consuming the current multiset
 * from left to right along the template sequence.
 */
export function remainingSequence(recipeSeq, currentMs) {
  /** @type {Record<string, number>} */
  const need = {};
  for (const [t, c] of Object.entries(currentMs || {})) {
    const n = Number(c) || 0;
    if (n > 0) need[t] = n;
  }
  const remaining = [];
  for (const t of recipeSeq || []) {
    if ((need[t] || 0) > 0) need[t]--;
    else remaining.push(t);
  }
  return remaining;
}

/**
 * Build recipe list from gallery graphs + optional title map (slug → title).
 * @param {Array<{ slug?: string, id?: string, graph: any, title?: string }>} entries
 */
export function buildRecipes(entries = []) {
  const recipes = [];
  for (const e of entries) {
    const slug = e.slug || e.id;
    if (!slug || !e.graph) continue;
    const sequence = sequenceFromGraph(e.graph);
    if (sequence.length < 2) continue;
    recipes.push({
      id: slug,
      slug,
      title: e.title || slug,
      sequence,
      multiset: typeMultiset(sequence),
    });
  }
  recipes.sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    schemaVersion: 1,
    source: "examples-gallery",
    exampleCount: recipes.length,
    recipes,
  };
}

/** Prefer high coverage, then fewer remaining stages, then shorter recipes. */
export function scoreMatch(covered, remainingLen, recipeLen) {
  return covered * 100 - remainingLen * 3 - recipeLen * 0.01;
}

function countsFromSketch(sketchOrNodeTypes) {
  if (Array.isArray(sketchOrNodeTypes)) {
    const currentMs = typeMultiset(sketchOrNodeTypes);
    const numNodes = Object.values(currentMs).reduce((a, b) => a + b, 0);
    return { currentMs, numNodes };
  }
  /** @type {Record<string, number>} */
  const currentMs = {};
  for (const [t, c] of Object.entries(sketchOrNodeTypes?.nodeTypeCounts || {})) {
    const n = Number(c) || 0;
    if (!t || t === "comment" || n <= 0) continue;
    currentMs[t] = n;
  }
  const numNodes =
    sketchOrNodeTypes?.numNodes ??
    Object.values(currentMs).reduce((a, b) => a + b, 0);
  return { currentMs, numNodes };
}

/**
 * Rank recipes the current graph partially matches.
 * Empty canvas → [].
 * @param {{ recipes?: Recipe[] } | Recipe[]} recipesOrCorpus
 * @param {{ nodeTypeCounts?: Record<string, number>, numNodes?: number } | string[]} sketchOrNodeTypes
 * @param {number} [k]
 */
export function recommendRecipes(recipesOrCorpus, sketchOrNodeTypes = {}, k = 3) {
  const recipes = Array.isArray(recipesOrCorpus)
    ? recipesOrCorpus
    : recipesOrCorpus?.recipes || [];
  if (!recipes.length) return [];

  const { currentMs, numNodes } = countsFromSketch(sketchOrNodeTypes);
  if (!numNodes || Object.keys(currentMs).length === 0) return [];

  /** @type {Array<any>} */
  const scored = [];
  for (const r of recipes) {
    if (!isPartialMatch(currentMs, r.multiset, 1)) continue;
    const covered = Object.values(currentMs).reduce((a, b) => a + b, 0);
    const remaining = remainingSequence(r.sequence, currentMs);
    if (!remaining.length) continue;
    const next = remaining.slice(0, 3);
    scored.push({
      id: r.id || r.slug,
      slug: r.slug,
      title: r.title || r.slug,
      score: scoreMatch(covered, remaining.length, r.sequence.length),
      covered,
      remaining,
      actions: next.map((t) => `add:${t}`),
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

/** Rivals this close to the top must agree on the next node, or the match stays quiet. */
export const CLOSE_BAND = 0.95;
export const MIN_COVERED = 2;

/**
 * One next node from a recipe, or null when the canvas is empty, thin, or the
 * nearest recipes disagree.
 * @param {{ recipes?: Recipe[] } | Recipe[]} corpus
 * @param {object | string[]} sketch
 * @param {{ nodeTypes?: Set<string> | null }} [opts]
 * @returns {{ slug: string, title: string, type: string, action: string, reason: string, covered: number, score: number } | null}
 */
export function confidentRecipe(corpus, sketch, opts = {}) {
  const matches = recommendRecipes(corpus, sketch, 8).filter((r) => r.covered >= MIN_COVERED);
  if (!matches.length) return null;
  const known = opts.nodeTypes || null;
  const top = matches[0];
  const nextType = (top.actions[0] || "").slice(4);
  if (!nextType) return null;
  if (known && !known.has(nextType)) return null;
  const floor = top.score * CLOSE_BAND;
  for (const rival of matches.slice(1)) {
    if (rival.score < floor) break;
    const rivalType = (rival.actions[0] || "").slice(4);
    if (rivalType !== nextType) return null;
  }
  return {
    slug: top.slug,
    title: top.title,
    type: nextType,
    action: `add:${nextType}`,
    reason: `from ${top.title} recipe`,
    covered: top.covered,
    score: top.score,
  };
}

/**
 * Put a confident recipe's next node at the front of the add list.
 * A null recipe leaves the hint object untouched.
 */
export function mergeRecipeHint(hint, recipe, maxAdds = 3) {
  if (!recipe) return hint || { confident: false, adds: [], wire: null, setModel: null, openExamples: null };
  const base = hint && hint.confident ? hint : { confident: false, adds: [], wire: null, setModel: null, openExamples: null };
  const adds = [{
    type: recipe.type,
    action: recipe.action,
    share: Math.max(base.adds[0]?.share || 0, 0.5),
    reason: recipe.reason,
    source: "recipe",
  }];
  for (const a of base.adds || []) {
    if (!a || a.type === recipe.type || adds.length >= maxAdds) continue;
    adds.push(a);
  }
  return {
    confident: true,
    adds,
    wire: base.wire || null,
    setModel: base.setModel || null,
    openExamples: base.openExamples || null,
    recipe: {
      slug: recipe.slug,
      title: recipe.title,
      reason: recipe.reason,
      type: recipe.type,
    },
  };
}

/**
 * Move a confident recipe's next type to the front of an existing id list.
 * Null when there is nothing to pin, the type is already first, or it is not
 * already in the list — callers must not insert a row or retag today's order.
 * @param {string[]} ids
 * @param {string | null | undefined} nextType
 * @returns {string[] | null}
 */
export function liftRecipeType(ids, nextType) {
  if (!nextType || typeof nextType !== "string") return null;
  if (!Array.isArray(ids) || ids.length < 2) return null;
  const i = ids.indexOf(nextType);
  if (i <= 0) return null;
  const next = ids.slice();
  next.splice(i, 1);
  next.unshift(nextType);
  return next;
}
