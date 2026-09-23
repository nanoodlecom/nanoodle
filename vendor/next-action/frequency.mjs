/** Product · 3 frequency baseline — suggest without learned weights.
 *  Product · 6 extends tables with firstTrio + firstNode alias.
 */

/**
 * @typedef {{ next: string, count: number }} FreqRow
 * @typedef {{
 *   unigram: Record<string, number>,
 *   bigram: Record<string, Record<string, number>>,
 *   coldStart: Record<string, number>,
 *   firstNode: Record<string, number>,
 *   firstTrio: { actions: string[], count: number }[],
 *   total: number
 * }} FreqTables
 */

/** Trajectory key from exampleId (`path#order@step` → `path#order`). */
function trajKey(ex) {
  const eid = ex.exampleId || "";
  if (eid.includes("@")) {
    const at = eid.lastIndexOf("@");
    const step = eid.slice(at + 1);
    if (/^\d+$/.test(step)) return eid.slice(0, at);
  }
  // Fall back: group misc set:model rows by source so they don't pollute trios
  return (ex.source || "unknown") + "#misc";
}

/**
 * Opening trios from gallery-synth trajectories.
 * Prefer step-ordered first three nextActions (@0,@1,@2). When steps are
 * missing, fall back to hist=[]→a0, hist=[a0]→a1, hist=[a0,a1]→a2.
 * @param {Array<{history?: string[], nextAction?: string, exampleId?: string, source?: string}>} examples
 */
export function buildFirstTrios(examples) {
  /** @type {Map<string, { byHist: Map<string, string>, byStep: Map<number, string> }>} */
  const byTraj = new Map();
  for (const ex of examples) {
    if (!ex.nextAction) continue;
    const key = trajKey(ex);
    if (key.endsWith("#misc")) continue;
    if (!byTraj.has(key)) byTraj.set(key, { byHist: new Map(), byStep: new Map() });
    const slot = byTraj.get(key);
    slot.byHist.set(JSON.stringify(ex.history || []), ex.nextAction);
    const eid = ex.exampleId || "";
    if (eid.includes("@")) {
      const step = eid.slice(eid.lastIndexOf("@") + 1);
      if (/^\d+$/.test(step)) slot.byStep.set(Number(step), ex.nextAction);
    }
  }
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const { byHist, byStep } of byTraj.values()) {
    let trio = null;
    if (byStep.size >= 3) {
      const steps = [...byStep.keys()].sort((a, b) => a - b);
      const acts = steps.slice(0, 3).map((s) => byStep.get(s));
      if (acts.length === 3 && acts.every(Boolean)) trio = acts;
    }
    if (!trio) {
      const a0 = byHist.get("[]");
      if (!a0) continue;
      const a1 = byHist.get(JSON.stringify([a0]));
      if (!a1) continue;
      const a2 = byHist.get(JSON.stringify([a0, a1]));
      if (!a2) continue;
      trio = [a0, a1, a2];
    }
    const tk = JSON.stringify(trio);
    counts.set(tk, (counts.get(tk) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([k, count]) => ({ actions: JSON.parse(k), count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.actions.join("\0").localeCompare(b.actions.join("\0"))
    );
}

/** Build frequency tables from corpus examples [{ history, nextAction }]. */
export function buildFrequencyTables(examples) {
  /** @type {FreqTables} */
  const tables = {
    unigram: {},
    bigram: {},
    coldStart: {},
    firstNode: {},
    firstTrio: [],
    total: 0,
  };
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
  // · 6: firstNode alias (copy of coldStart) + ranked firstTrio openings
  tables.firstNode = { ...tables.coldStart };
  tables.firstTrio = buildFirstTrios(examples);
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
