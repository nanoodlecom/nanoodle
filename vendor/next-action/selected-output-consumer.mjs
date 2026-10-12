/**
 * Product · 27 — selected output consumer suggest (pure helpers).
 *
 * One selected node with a free output ranks gallery consumers of that
 * output first in Add. A flat prior or a tie for first leaves the list alone. The
 * suggested tag is added only for types that actually moved up. Recipe,
 * first-node, and first-trio rows are left untouched.
 */

import { MIN_SHARE, MIN_LEAD } from "./hints.mjs";
import { danglingPorts } from "./port-suggest.mjs";

export const MAX_CONSUMER_SUGGEST = 3;
export const SOURCE = "selected-output-consumer";
export const REASON = "fits selected output";
export const MIN_PAIR = 2;

export const STRONG_SOURCES = Object.freeze([
  "first-trio",
  "recipe",
  "post-first",
  "learned",
  "cold-start",
  "first-node",
  "empty-followup",
]);

export function selectedNode(graph = {}) {
  if (Array.isArray(graph.selectedIds) && graph.selectedIds.length > 1) return null;
  const id = graph && graph.selectedId;
  if (!id) return null;
  const n = (graph.nodes || []).find((x) => x && x.id === id);
  if (!n || !n.type || n.type === "comment") return null;
  return n;
}

export function selectedDanglingOutputs(portTables, graph = {}) {
  const sel = selectedNode(graph);
  if (!sel || !portTables) return [];
  const { outs } = danglingPorts(portTables, graph);
  return outs.filter((o) => o.nodeId === sel.id);
}

export function consumerCountsForOutputs(portTables, outs) {
  /** @type {Record<string, number>} */
  const counts = {};
  if (!portTables?.topTargets || !Array.isArray(outs)) return counts;
  for (const o of outs) {
    if (!o?.type || !o?.port) continue;
    const targets = portTables.topTargets[`${o.type}|${o.port}`] || {};
    for (const [dstKey, n] of Object.entries(targets)) {
      const toType = String(dstKey).split("|")[0];
      if (!toType || toType === "comment") continue;
      const c = Number(n) || 0;
      if (!(c > 0)) continue;
      counts[toType] = (counts[toType] || 0) + c;
    }
  }
  return counts;
}

export function priorHasStrongSource(priorAdds) {
  return Array.isArray(priorAdds) && priorAdds.some((a) => a && STRONG_SOURCES.includes(a.source));
}

export function rankSelectedOutputConsumers(portTables, graph = {}, opts = {}) {
  if (opts.disabled) return [];
  if (!portTables?.topTargets) return [];
  if (priorHasStrongSource(opts.priorAdds)) return [];
  const outs = selectedDanglingOutputs(portTables, graph);
  if (!outs.length) return [];
  const counts = consumerCountsForOutputs(portTables, outs);
  const known = opts.nodeTypes || null;
  const rows = [];
  for (const [type, score] of Object.entries(counts)) {
    if (!type || type === "comment") continue;
    if (known && !known.has(type)) continue;
    if (!(score > 0)) continue;
    rows.push({ action: "add:" + type, type, score, source: SOURCE, reason: REASON });
  }
  if (!rows.length) return [];
  const sum = rows.reduce((a, r) => a + r.score, 0);
  rows.sort((a, b) => b.score - a.score || a.action.localeCompare(b.action));
  const minShare = opts.minShare ?? MIN_SHARE;
  const minLead = opts.minLead ?? MIN_LEAD;
  const minPair = opts.minPair ?? MIN_PAIR;
  const max = opts.max ?? MAX_CONSUMER_SUGGEST;
  const top = rows[0];
  const second = rows[1];
  const topShare = top.score / sum;
  // An exact tie at the top is never confidence, whatever minLead a caller
  // passes: two equally common consumers name no single next node, so the Add
  // list stays exactly as it is. Decided 2026-10-08 when the gallery tied a
  // selected LLM's text between Join and LLM (4 / 4); see README · 27.
  const tied = !!second && second.score === top.score;
  const leads = !second || second.score <= 0 || top.score >= second.score * minLead;
  if (tied || !leads || topShare < minShare || top.score < minPair) return [];
  const out = [];
  for (const r of rows) {
    const share = r.score / sum;
    if (share < minShare) continue;
    out.push({ ...r, share });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Put confident consumers first. Unchanged when the order already starts
 * that way, so an existing tag is not rewritten.
 */
export function applyConsumerLift(priorAdds, hits, opts = {}) {
  const max = opts.max ?? MAX_CONSUMER_SUGGEST;
  const prior = (Array.isArray(priorAdds) ? priorAdds : []).filter((a) => a && a.type).slice(0, max);
  if (priorHasStrongSource(prior) || !hits || !hits.length) {
    return { adds: prior, changed: false, tagged: [] };
  }
  const priorTypes = prior.map((a) => a.type);
  const nextTypes = [];
  for (const h of hits) {
    if (!h || !h.type || nextTypes.includes(h.type)) continue;
    nextTypes.push(h.type);
    if (nextTypes.length >= max) break;
  }
  for (const t of priorTypes) {
    if (nextTypes.length >= max) break;
    if (!nextTypes.includes(t)) nextTypes.push(t);
  }
  const tagged = [];
  for (const h of hits) {
    if (!h || !h.type || !nextTypes.includes(h.type)) continue;
    const old = priorTypes.indexOf(h.type);
    const neu = nextTypes.indexOf(h.type);
    if (old < 0 || old > neu) tagged.push(h.type);
  }
  if (!tagged.length) return { adds: prior, changed: false, tagged: [] };
  const by = new Map(prior.map((a) => [a.type, a]));
  for (const h of hits) {
    if (!tagged.includes(h.type)) continue;
    by.set(h.type, {
      type: h.type,
      action: h.action || "add:" + h.type,
      reason: h.reason || REASON,
      source: SOURCE,
      share: Number(h.share) || 0,
    });
  }
  return { adds: nextTypes.map((t) => by.get(t)).filter(Boolean), changed: true, tagged };
}

export { MIN_SHARE, MIN_LEAD };
