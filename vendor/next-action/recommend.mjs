/** Ranked next-action helper: frequency baseline + optional smallnet session. */
import { ACTION_VOCAB, encodeState } from "./encode.mjs";
import { recommendFrequency } from "./frequency.mjs";

/**
 * @param {{
 *   tables: import("./frequency.mjs").FreqTables,
 *   session?: { run: (x: Float32Array) => Float32Array } | null,
 *   blend?: number
 * }} opts
 * @param {string[]} history
 * @param {object} sketch
 * @param {number} [k]
 */
export function recommendNext(opts, history, sketch, k = 3) {
  const freq = recommendFrequency(opts.tables, history, sketch, Math.max(k, ACTION_VOCAB.length));
  const blend = opts.blend == null ? 0.35 : opts.blend;
  const scores = new Map(freq.map((r) => [r.action, r.score]));

  if (opts.session) {
    const x = encodeState(history, sketch);
    const y = opts.session.run(x);
    const netScore = {};
    for (let i = 0; i < ACTION_VOCAB.length; i++) netScore[ACTION_VOCAB[i]] = y[i];
    const fsum = [...scores.values()].reduce((a, b) => a + b, 0) || 1;
    const combined = {};
    for (const a of ACTION_VOCAB) {
      const fp = (scores.get(a) || 0) / fsum;
      const np = netScore[a] || 0;
      combined[a] = blend * fp + (1 - blend) * np;
    }
    return Object.entries(combined)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, k)
      .map(([action, score]) => ({ action, score, source: "blend" }));
  }

  return freq.slice(0, k);
}

export function rankFromLogits(logits, k = 3) {
  const rows = ACTION_VOCAB.map((action, i) => ({ action, score: logits[i], source: "net" }));
  rows.sort((a, b) => b.score - a.score || a.action.localeCompare(b.action));
  return rows.slice(0, k);
}
