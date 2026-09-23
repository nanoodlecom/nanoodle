/** Product · 3 frequency baseline — suggest without learned weights. */

/**
 * @typedef {{ next: string, count: number }} FreqRow
 * @typedef {{
 *   unigram: Record<string, number>,
 *   bigram: Record<string, Record<string, number>>,
 *   coldStart: Record<string, number>,
 *   total: number
 * }} FreqTables
 */

/** Build frequency tables from corpus examples [{ history, nextAction }]. */
export function buildFrequencyTables(examples) {
  /** @type {FreqTables} */
  const tables = { unigram: {}, bigram: {}, coldStart: {}, total: 0 };
  for (const ex of examples) {
    const next = ex.nextAction;
    if (!next) continue;
    tables.unigram[next] = (tables.unigram[next] || 0) + 1;
    tables.total++;
    const hist = ex.history || [];
    if (hist.length === 0 || (ex.sketch && ex.sketch.numNodes === 0)) {
      tables.coldStart[next] = (tables.coldStart[next] || 0) + 1;
    }
    const prev = hist.length ? hist[hist.length - 1] : null;
    if (prev) {
      if (!tables.bigram[prev]) tables.bigram[prev] = {};
      tables.bigram[prev][next] = (tables.bigram[prev][next] || 0) + 1;
    }
  }
  return tables;
}

function topFromCounts(counts, k = 3) {
  return Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([action, count]) => ({ action, score: count, source: "frequency" }));
}

/**
 * Rank next actions from frequency tables.
 * @param {FreqTables} tables
 * @param {string[]} history
 * @param {{ numNodes?: number }} [sketch]
 * @param {number} [k]
 */
export function recommendFrequency(tables, history = [], sketch = {}, k = 3) {
  const empty = !history.length || sketch.numNodes === 0;
  if (empty && tables.coldStart && Object.keys(tables.coldStart).length) {
    return topFromCounts(tables.coldStart, k);
  }
  const prev = history.length ? history[history.length - 1] : null;
  if (prev && tables.bigram[prev]) {
    const rows = topFromCounts(tables.bigram[prev], k);
    if (rows.length) return rows;
  }
  return topFromCounts(tables.unigram, k);
}

/** Top-1 / top-3 hit rate of frequency baseline on a list of examples. */
export function evaluateFrequency(tables, examples) {
  let top1 = 0;
  let top3 = 0;
  let n = 0;
  for (const ex of examples) {
    if (!ex.nextAction) continue;
    n++;
    const rec = recommendFrequency(tables, ex.history || [], ex.sketch || {}, 3);
    const actions = rec.map((r) => r.action);
    if (actions[0] === ex.nextAction) top1++;
    if (actions.includes(ex.nextAction)) top3++;
  }
  return {
    n,
    top1: n ? top1 / n : 0,
    top3: n ? top3 / n : 0,
  };
}
