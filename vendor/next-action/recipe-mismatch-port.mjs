/**
 * Product · 51 — recipe-mismatch port pulse (pure helpers).
 *
 * After a confident gallery recipe match (#622), if the graph's naive
 * next dangling port (raw gallery outbound mass #621) does not match the
 * recipe-expected frontier out that should wire into the recipe's next
 * type, pick ONE port so the editor can soft-pulse it. Prefer the
 * recipe-expected port so the rewire / continue is obvious.
 *
 * Quiet when: no confident recipe, no expected port, no naive dangling,
 * expected already equals naive (fits), flat / tied priors, multi
 * ambiguous targets. Distinct from · 22 idle dangling, · 45 Suggested
 * boost, · 49 run-fail port, · 50 orphan-output pulse.
 */

import {
  MIN_PAIR,
  MIN_LEAD,
  MIN_SHARE,
  danglingPorts,
  pairCount,
  portsOf,
} from "./port-suggest.mjs";
import { confidentRecipe } from "./recipe.mjs";

export const DEFAULT_TTL_MS = 2600;

function leads(top, second) {
  return !second || second <= 0 || top >= second * MIN_LEAD;
}

/**
 * Last consumed type along the recipe sequence (frontier before remaining).
 * @param {string[]} recipeSeq
 * @param {Record<string, number>} currentMs
 * @returns {string|null}
 */
export function frontierType(recipeSeq, currentMs) {
  /** @type {Record<string, number>} */
  const need = {};
  for (const [t, c] of Object.entries(currentMs || {})) {
    const n = Number(c) || 0;
    if (n > 0) need[t] = n;
  }
  let frontier = null;
  for (const t of recipeSeq || []) {
    if ((need[t] || 0) > 0) {
      need[t]--;
      frontier = t;
    } else {
      // First remaining slot — frontier is whatever we last consumed.
      return frontier;
    }
  }
  return frontier;
}

/**
 * Type multiset from a live graph (non-comment).
 * @param {{ nodes?: Array<{ type?: string }> }} graph
 */
export function graphTypeMultiset(graph = {}) {
  /** @type {Record<string, number>} */
  const m = {};
  for (const n of graph.nodes || []) {
    const t = n?.type;
    if (!t || t === "comment") continue;
    m[t] = (m[t] || 0) + 1;
  }
  return m;
}

/**
 * Outbound mass of a dangling out into a destination type's catalog inputs
 * (max pairCount). Falls back to max topTargets row for that out when no
 * dest inputs are known.
 */
export function outMassIntoType(tables, out, destType) {
  if (!tables?.topTargets || !out?.type || !out.port || !destType) return 0;
  const inputs = portsOf(tables, destType).inputs;
  let best = 0;
  for (const p of inputs) {
    const c = pairCount(tables, out.type, out.port, destType, p);
    if (c > best) best = c;
  }
  if (best > 0) return best;
  const targets = tables.topTargets[`${out.type}|${out.port}`] || {};
  let mass = 0;
  for (const [k, v] of Object.entries(targets)) {
    if (!String(k).startsWith(`${destType}|`)) continue;
    const n = Number(v) || 0;
    if (n > mass) mass = n;
  }
  return mass;
}

/**
 * Raw outbound gallery mass for a source port (max topTargets entry).
 */
export function outMassRaw(tables, out) {
  if (!tables?.topTargets || !out?.type || !out.port) return 0;
  const targets = tables.topTargets[`${out.type}|${out.port}`] || {};
  let mass = 0;
  for (const v of Object.values(targets)) {
    const n = Number(v) || 0;
    if (n > mass) mass = n;
  }
  return mass;
}

/**
 * Pick the clear-winner dangling out among `candidates` by `scoreFn`.
 * @returns {{ nodeId:string, port:string, type:string, dir:"out", count:number, share:number }|null}
 */
function pickClearOut(candidates, scoreFn) {
  /** @type {Array<{ nodeId:string, port:string, type:string, count:number }>} */
  const scored = [];
  for (const o of candidates || []) {
    if (!o?.nodeId || !o.port || !o.type) continue;
    const count = scoreFn(o);
    if (count > 0) scored.push({ nodeId: o.nodeId, port: o.port, type: o.type, count });
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
  const second = scored[1];
  const share = top.count / sum;
  if (top.count < MIN_PAIR) return null;
  if (!leads(top.count, second && second.count)) return null;
  if (share < MIN_SHARE) return null;
  return {
    nodeId: top.nodeId,
    port: top.port,
    type: top.type,
    dir: /** @type {"out"} */ ("out"),
    count: top.count,
    share,
  };
}

/**
 * Recipe-expected dangling out: frontier type's out that best feeds the
 * recipe's next add type.
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {{ type: string, slug?: string }} recipe
 * @param {{ recipes?: Array<{ slug?: string, id?: string, sequence?: string[] }> }} corpus
 */
export function pickRecipeExpectedPort(tables, graph, recipe, corpus) {
  if (!tables?.topTargets || !recipe?.type) return null;
  const recipes = Array.isArray(corpus) ? corpus : corpus?.recipes || [];
  const full = recipes.find((r) => (r.slug || r.id) === recipe.slug) || null;
  const seq = full?.sequence || [];
  const ms = graphTypeMultiset(graph);
  const frontier = frontierType(seq, ms);
  if (!frontier) return null;

  const { outs } = danglingPorts(tables, graph);
  const frontierOuts = outs.filter((o) => o.type === frontier);
  if (!frontierOuts.length) return null;

  const pick = pickClearOut(frontierOuts, (o) => outMassIntoType(tables, o, recipe.type));
  if (!pick) return null;
  return { ...pick, frontier, nextType: recipe.type, role: /** @type {"expected"} */ ("expected") };
}

/**
 * Naive next dangling out by raw gallery outbound mass (ignores recipe).
 */
export function pickNaiveNextDangling(tables, graph) {
  if (!tables?.topTargets) return null;
  const { outs } = danglingPorts(tables, graph);
  const pick = pickClearOut(outs, (o) => outMassRaw(tables, o));
  if (!pick) return null;
  return { ...pick, role: /** @type {"naive"} */ ("naive") };
}

/**
 * Pick one port to soft-pulse when confident recipe + naive dangling disagree.
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} portTables
 * @param {{ recipes?: any[] } | any[]} recipeCorpus
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {{ nodeTypes?: Set<string>|null, sketch?: object }} [opts]
 * @returns {{
 *   nodeId: string, port: string, type: string, dir: "out",
 *   count: number, share: number, frontier: string, nextType: string,
 *   role: "expected", recipeSlug: string, naive: { nodeId:string, port:string, type:string }
 * } | null}
 */
export function pickRecipeMismatchPort(portTables, recipeCorpus, graph = {}, opts = {}) {
  if (!portTables?.topTargets) return null;
  const nodes = graph.nodes || [];
  if (nodes.length < 2) return null;

  const sketch =
    opts.sketch ||
    (() => {
      const ms = graphTypeMultiset(graph);
      const numNodes = Object.values(ms).reduce((a, b) => a + b, 0);
      return { nodeTypeCounts: ms, numNodes };
    })();

  const recipe = confidentRecipe(recipeCorpus, sketch, { nodeTypes: opts.nodeTypes || null });
  if (!recipe) return null;

  const expected = pickRecipeExpectedPort(portTables, graph, recipe, recipeCorpus);
  if (!expected) return null;

  const naive = pickNaiveNextDangling(portTables, graph);
  if (!naive) return null;

  // Fits — naive already is the recipe-expected port.
  if (naive.nodeId === expected.nodeId && naive.port === expected.port) return null;

  return {
    nodeId: expected.nodeId,
    port: expected.port,
    type: expected.type,
    dir: /** @type {"out"} */ ("out"),
    count: expected.count,
    share: expected.share,
    frontier: expected.frontier,
    nextType: expected.nextType,
    role: /** @type {"expected"} */ ("expected"),
    recipeSlug: recipe.slug,
    naive: { nodeId: naive.nodeId, port: naive.port, type: naive.type },
  };
}

export { MIN_PAIR, MIN_LEAD, MIN_SHARE };
