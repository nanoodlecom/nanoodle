/** Product · 6 — cold-start seeds (empty-canvas twin of · 3 frequency tips). */

/**
 * @typedef {{ next: string, count: number }} FreqRow
 * @typedef {{
 *   unigram?: Record<string, number>,
 *   bigram?: Record<string, Record<string, number>>,
 *   coldStart?: Record<string, number>,
 *   firstNode?: Record<string, number>,
 *   firstTrio?: { actions: string[], count: number }[],
 *   total?: number
 * }} FreqTables
 */

function topFromCounts(counts, k = 3, source = "cold-start") {
  return Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([action, count]) => ({ action, score: count, source }));
}

/**
 * First-node tips when the canvas is empty (numNodes===0).
 * Prefers `firstNode` alias, then `coldStart`.
 * @param {FreqTables} tables
 * @param {{ numNodes?: number }} [sketch]
 * @param {number} [k]
 */
export function recommendColdStart(tables, sketch = {}, k = 3) {
  const empty = !sketch || sketch.numNodes === 0;
  if (!empty) return [];
  const src =
    (tables.firstNode && Object.keys(tables.firstNode).length && tables.firstNode) ||
    tables.coldStart ||
    {};
  return topFromCounts(src, k, "cold-start");
}

/**
 * Ranked opening trios from gallery-synth trajectories.
 * @param {FreqTables} tables
 * @param {number} [k]
 * @returns {{ actions: string[], count: number }[]}
 */
export function topFirstTrios(tables, k = 5) {
  const rows = Array.isArray(tables?.firstTrio) ? tables.firstTrio : [];
  return rows.slice(0, k);
}

export { topFromCounts };
