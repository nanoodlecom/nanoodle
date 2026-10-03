/**
 * Product · 24 — model-list suggest polish (pure helpers).
 *
 * When the model picker is on its default newest order and the search box
 * is empty, lift gallery-common models that clear the confidence gate.
 * The suggested tag is applied only to models that actually moved up.
 * A flat prior, a search query, or a model that is already first leaves
 * today's order unmarked.
 */

import { MIN_SHARE, MIN_LEAD } from "./hints.mjs";

export const MAX_MODEL_SUGGEST = 3;

export function countsForScope(priors, nodeType, kind) {
  if (!priors || typeof priors !== "object") return {};
  const t = String(nodeType || "").trim();
  const k = String(kind || "").trim();
  if (t && priors.byNodeType && priors.byNodeType[t] && typeof priors.byNodeType[t] === "object") {
    return priors.byNodeType[t];
  }
  const mapped = t && priors.typeToKind ? priors.typeToKind[t] : "";
  const kindKey = k || mapped || "";
  if (kindKey && priors.byKind && priors.byKind[kindKey] && typeof priors.byKind[kindKey] === "object") {
    return priors.byKind[kindKey];
  }
  return {};
}

export function rankModelSuggestions(nodeType, catalogIds, priors, opts = {}) {
  if (opts.searching || opts.customSort) return [];
  const ids = Array.isArray(catalogIds) ? catalogIds.filter((id) => typeof id === "string" && id) : [];
  if (!ids.length) return [];
  const counts = countsForScope(priors, nodeType, opts.kind);
  const rows = [];
  for (const id of ids) {
    const score = Math.max(0, Number(counts[id]) || 0);
    if (!(score > 0)) continue;
    rows.push({ id, score, reason: "common in gallery", source: "gallery" });
  }
  if (!rows.length) return [];
  const sum = rows.reduce((a, r) => a + r.score, 0);
  rows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const minShare = opts.minShare ?? MIN_SHARE;
  const minLead = opts.minLead ?? MIN_LEAD;
  const max = opts.max ?? MAX_MODEL_SUGGEST;
  const top = rows[0];
  const second = rows[1];
  const share = top.score / sum;
  const leads = !second || second.score <= 0 || top.score >= second.score * minLead;
  if (!leads || share < minShare) return [];
  const out = [];
  for (const r of rows) {
    const s = r.score / sum;
    if (s < minShare) continue;
    out.push({ ...r, share: s });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Lift confident models. Null when none of them move up, so the caller
 * keeps today's order and its existing marks.
 * @param {Array<{id:string}>} list
 * @param {Array<{id:string}>} suggestions
 * @returns {{ list: Array<{id:string}>, tagged: string[] } | null}
 */
export function liftChangedModels(list, suggestions) {
  if (!Array.isArray(list) || !list.length || !Array.isArray(suggestions) || !suggestions.length) return null;
  const ids = list.map((m) => m && m.id).filter(Boolean);
  const want = [];
  const seen = new Set();
  for (const row of suggestions) {
    const id = row && row.id;
    if (!id || seen.has(id) || !ids.includes(id)) continue;
    seen.add(id);
    want.push(id);
  }
  if (!want.length) return null;
  const nextIds = want.concat(ids.filter((id) => !seen.has(id)));
  const tagged = [];
  for (const id of want) {
    const old = ids.indexOf(id);
    const neu = nextIds.indexOf(id);
    if (old < 0 || old > neu) tagged.push(id);
  }
  if (!tagged.length) return null;
  const by = new Map(list.map((m) => [m.id, m]));
  return { list: nextIds.map((id) => by.get(id)).filter(Boolean), tagged };
}

export { MIN_SHARE, MIN_LEAD };
