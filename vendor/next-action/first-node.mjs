/**
 * Product · 20 — first-node empty-canvas onboarding (pure helpers).
 *
 * Ranks first-node candidates and firstTrio follow-ups for existing menus.
 * No tip panel, no ghost overlay, no ?product= surface. When the prior is
 * unsure, callers leave add-node / search lists exactly as they are today.
 */

import { MIN_SHARE, MIN_LEAD } from "./hints.mjs";

/**
 * @typedef {{ next: string, count: number }} FreqRow
 * @typedef {{
 *   unigram?: Record<string, number>,
 *   coldStart?: Record<string, number>,
 *   firstNode?: Record<string, number>,
 *   firstTrio?: { actions: string[], count: number }[],
 * }} FreqTables
 */

/** True when the canvas has no non-comment nodes (and optional history is cold). */
export function isEmptyCanvas(sketch = {}, history = null) {
  const emptyNodes = !sketch || !sketch.numNodes;
  if (history == null) return emptyNodes;
  return emptyNodes && (!history || !history.length);
}

/**
 * Aggregate first-node counts: prefer `firstNode`, fall back to `coldStart`,
 * and fold in firstTrio opening heads (weighted by trio count).
 * @param {FreqTables} tables
 * @returns {Record<string, number>}
 */
export function firstNodeCounts(tables = {}) {
  /** @type {Record<string, number>} */
  const out = {};
  const base =
    (tables.firstNode && Object.keys(tables.firstNode).length && tables.firstNode) ||
    tables.coldStart ||
    {};
  for (const [a, c] of Object.entries(base)) {
    if (!String(a).startsWith("add:")) continue;
    out[a] = (out[a] || 0) + (Number(c) || 0);
  }
  for (const row of tables.firstTrio || []) {
    const head = row && row.actions && row.actions[0];
    if (!head || !String(head).startsWith("add:")) continue;
    out[head] = (out[head] || 0) + (Number(row.count) || 0);
  }
  return out;
}

function topAddRows(counts, k, source) {
  return Object.entries(counts || {})
    .filter(([a]) => String(a).startsWith("add:"))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([action, count]) => ({ action, score: count, source }));
}

/**
 * Ranked first-node add rows for an empty canvas, or [] when not empty / thin.
 * @param {FreqTables} tables
 * @param {{ numNodes?: number }} [sketch]
 * @param {string[]} [history]
 * @param {number} [k]
 */
export function rankFirstNodes(tables, sketch = {}, history = [], k = 3) {
  if (!isEmptyCanvas(sketch, history)) return [];
  const counts = firstNodeCounts(tables);
  if (!Object.keys(counts).length) return [];
  return topAddRows(counts, k, "first-node");
}

/**
 * Next add: steps from firstTrio rows whose prefix matches `history`.
 * Only when the canvas is non-empty and history is a short opening prefix.
 * @param {FreqTables} tables
 * @param {string[]} history
 * @param {{ numNodes?: number }} [sketch]
 * @param {number} [k]
 */
export function rankFirstTrioFollowups(tables, history = [], sketch = {}, k = 3) {
  if (!sketch || !sketch.numNodes) return [];
  if (!Array.isArray(history) || history.length < 1 || history.length > 2) return [];
  /** @type {Record<string, number>} */
  const counts = {};
  for (const row of tables.firstTrio || []) {
    const acts = row && row.actions;
    if (!Array.isArray(acts) || acts.length < history.length + 1) continue;
    let ok = true;
    for (let i = 0; i < history.length; i++) {
      if (acts[i] !== history[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const next = acts[history.length];
    if (!next || !String(next).startsWith("add:")) continue;
    // Once a first card is placed, suggest a complementary next type. A
    // repeated source is still available in the normal Add groups.
    if (sketch.numNodes === 1 && history.length === 1 && next === history[0]) continue;
    counts[next] = (counts[next] || 0) + (Number(row.count) || 0);
  }
  if (!Object.keys(counts).length) return [];
  return topAddRows(counts, k, "first-trio");
}

/**
 * Soft-merge first-node / firstTrio rows into frequency prior rows.
 * Empty merge (unsure / wrong phase) returns `rows` unchanged.
 * @param {Array<{action:string, score:number, source?:string}>} rows
 * @param {FreqTables} tables
 * @param {string[]} history
 * @param {{ numNodes?: number }} sketch
 * @param {{ maxAdds?: number }} [opts]
 */
export function mergeFirstNodeRows(rows, tables, history = [], sketch = {}, opts = {}) {
  const k = opts.maxAdds ?? 3;
  const empty = isEmptyCanvas(sketch, history);
  const boost = empty
    ? rankFirstNodes(tables, sketch, history, k)
    : rankFirstTrioFollowups(tables, history, sketch, k);
  if (!boost.length) return Array.isArray(rows) ? rows : [];

  // Confidence: top boost must lead like projectHints (share + lead).
  const sum = boost.reduce((a, r) => a + Math.max(0, Number(r.score) || 0), 0);
  if (!(sum > 0)) return Array.isArray(rows) ? rows : [];
  const ranked = boost
    .map((r) => ({ ...r, share: Math.max(0, Number(r.score) || 0) / sum }))
    .sort((a, b) => b.share - a.share || a.action.localeCompare(b.action));
  const top = ranked[0];
  const second = ranked[1];
  const leads = !second || second.share <= 0 || top.share >= second.share * MIN_LEAD;
  if (!leads || top.share < MIN_SHARE) return Array.isArray(rows) ? rows : [];

  const firstFollowup = sketch.numNodes === 1 && history.length === 1;

  /** @type {Map<string, {action:string, score:number, source?:string}>} */
  const by = new Map();
  for (const r of rows || []) {
    if (!r || !r.action) continue;
    if (firstFollowup && r.action === history[0]) continue;
    by.set(r.action, { action: r.action, score: Number(r.score) || 0, source: r.source });
  }
  // Lift confident boost rows: scale so they sit above the prior ceiling.
  const ceiling = [...by.values()].reduce((m, r) => Math.max(m, r.score), 0);
  const scale = Math.max(1, ceiling) * (firstFollowup ? 4 : 2);
  for (const r of ranked) {
    const prior = by.get(r.action);
    const score = scale * r.share + (!firstFollowup && prior ? prior.score : 0);
    by.set(r.action, {
      action: r.action,
      score,
      source: r.source || (prior && prior.source) || "first-node",
    });
  }
  return [...by.values()].sort(
    (a, b) => b.score - a.score || a.action.localeCompare(b.action)
  );
}

/**
 * Stable viewport-center seat for the first node (world coords).
 * Ignores cascade jitter so the empty-canvas add feels intentional.
 * @param {{
 *   viewW: number, viewH: number,
 *   panX?: number, panY?: number, scale?: number,
 *   nodeW?: number, nodeH?: number,
 * }} view
 * @returns {{ x: number, y: number }}
 */
export function firstNodeSeat(view = {}) {
  const scale = view.scale > 0 ? view.scale : 1;
  const panX = Number(view.panX) || 0;
  const panY = Number(view.panY) || 0;
  const viewW = Math.max(1, Number(view.viewW) || 800);
  const viewH = Math.max(1, Number(view.viewH) || 600);
  const nodeW = view.nodeW == null ? 210 : Number(view.nodeW);
  const nodeH = view.nodeH == null ? 120 : Number(view.nodeH);
  const x = Math.round((viewW / 2 - panX) / scale - nodeW / 2);
  const y = Math.round((viewH / 2 - panY) / scale - nodeH / 2);
  return { x, y };
}

/** Whether spawn should use the first-node seat (empty canvas, helpers on). */
export function shouldSeatFirstNode(sketchBeforeAdd, helpersOn = true) {
  return !!helpersOn && isEmptyCanvas(sketchBeforeAdd || { numNodes: 0 });
}

export { MIN_SHARE, MIN_LEAD };
