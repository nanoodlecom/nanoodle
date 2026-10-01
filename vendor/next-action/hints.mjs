/** Turn ranked next-action scores into marks for menus that already exist.
 *  Pure data — no DOM, no overlay. A flat or weak distribution is not confident,
 *  and callers must leave the list exactly as it was.
 */

export const MIN_SHARE = 0.18;
export const MIN_LEAD = 1.35;
export const MAX_ADDS = 3;

const EMPTY = Object.freeze({
  confident: false,
  adds: Object.freeze([]),
  wire: null,
  setModel: null,
  openExamples: null,
});

function reasonForAdd(coldStart, sketch) {
  if (coldStart || !sketch || !sketch.numNodes) return "common first node";
  return "often added next";
}

/**
 * @param {Array<{action:string, score:number, source?:string}>} rows
 * @param {{
 *   minShare?: number,
 *   minLead?: number,
 *   maxAdds?: number,
 *   nodeTypes?: Set<string> | null,
 *   sketch?: { numNodes?: number },
 *   coldStart?: boolean,
 * }} [opts]
 */
export function projectHints(rows, opts = {}) {
  const minShare = opts.minShare ?? MIN_SHARE;
  const minLead = opts.minLead ?? MIN_LEAD;
  const maxAdds = opts.maxAdds ?? MAX_ADDS;
  const known = opts.nodeTypes || null;
  const sketch = opts.sketch || {};
  if (!Array.isArray(rows) || !rows.length) return EMPTY;

  const sum = rows.reduce((a, r) => a + Math.max(0, Number(r && r.score) || 0), 0);
  if (!(sum > 0)) return EMPTY;

  const ranked = rows
    .map((r) => ({
      action: String((r && r.action) || ""),
      share: Math.max(0, Number(r && r.score) || 0) / sum,
    }))
    .filter((r) => r.action)
    .sort((a, b) => b.share - a.share || a.action.localeCompare(b.action));
  if (!ranked.length) return EMPTY;

  const top = ranked[0];
  const second = ranked[1];
  const leads = !second || second.share <= 0 || top.share >= second.share * minLead;
  if (!leads || top.share < minShare) return EMPTY;

  const adds = [];
  for (const r of ranked) {
    if (!r.action.startsWith("add:")) continue;
    if (r.share < minShare) continue;
    const type = r.action.slice(4);
    if (!type) continue;
    if (known && !known.has(type)) continue;
    adds.push({
      type,
      action: r.action,
      share: r.share,
      reason: reasonForAdd(!!opts.coldStart, sketch),
    });
    if (adds.length >= maxAdds) break;
  }

  const wireRow = ranked.find((r) => r.action === "wire" && r.share >= minShare);
  const modelRow = ranked.find((r) => r.action === "set:model" && r.share >= minShare);
  const exRow = ranked.find((r) => r.action === "open:examples" && r.share >= minShare);
  // A wire hint names the action only. It never carries ports — a real wire is
  // drawn by the editor's connect() when the user drops on a compatible port.
  const wire = wireRow ? { share: wireRow.share, reason: "often wired next" } : null;
  const setModel = modelRow ? { share: modelRow.share, reason: "pick a model next" } : null;
  const openExamples = exRow ? { share: exRow.share, reason: "often opened next" } : null;
  if (!adds.length && !wire && !setModel && !openExamples) return EMPTY;
  return { confident: true, adds, wire, setModel, openExamples };
}

/** Prefer a confident learned blend; otherwise a confident frequency prior. */
export function chooseHints({ frequencyRows, blendRows, ...opts }) {
  if (blendRows) {
    const blend = projectHints(blendRows, opts);
    if (blend.confident) return blend;
  }
  if (frequencyRows) return projectHints(frequencyRows, opts);
  return EMPTY;
}

/**
 * Move suggested ids to the front. Relative order of everything else is kept.
 * Returns null when none of the suggestions are in the list — the caller
 * renders the original order with no marks.
 * @param {string[]} ids
 * @param {string[]} suggested
 * @returns {string[] | null}
 */
export function liftSuggested(ids, suggested) {
  const want = [];
  const seen = new Set();
  for (const id of suggested || []) {
    if (seen.has(id) || !ids.includes(id)) continue;
    seen.add(id);
    want.push(id);
  }
  if (!want.length) return null;
  return want.concat(ids.filter((id) => !seen.has(id)));
}
