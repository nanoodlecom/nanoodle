/**
 * Product · 45 — settled-run next-add boost (pure helpers).
 *
 * After a successful settled run, soft-boost Suggested add-node/search rows
 * for types that commonly follow that run's primary output type in gallery
 * recipes (#622). Quiet when flat / no recipe follow-ons / empty modality /
 * prefers-reduced-motion / engine off. Does not stomp stronger Suggested
 * sources (recipe / first-trio / learned / …).
 *
 * Signal: last settled successful run output type + recipe adjacency counts.
 * Surface: Existing Suggested rows only (no tip panel / no twin HTML).
 */

import { MIN_SHARE, MIN_LEAD } from "./hints.mjs";

export const MAX_SETTLED_SUGGEST = 3;
export const SOURCE = "settled-run";
export const REASON = "follows last output";
export const DEFAULT_TTL_MS = 45_000;

/** Sources that already own a stronger Suggested lift — · 45 stays quiet. */
export const STRONG_SOURCES = Object.freeze([
  "first-trio",
  "recipe",
  "post-first",
  "learned",
  "cold-start",
  "first-node",
  "empty-followup",
  "add-search-popular",
  "selected-output-consumer",
  "selected-input-producer",
]);

/**
 * Build type → next-type counts from gallery recipe sequences (#622).
 * @param {{ recipes?: Array<{ sequence?: string[] }> } | Array<{ sequence?: string[] }> | null} recipesOrCorpus
 * @returns {Record<string, Record<string, number>>}
 */
export function buildModalityFollowOns(recipesOrCorpus) {
  const recipes = Array.isArray(recipesOrCorpus)
    ? recipesOrCorpus
    : recipesOrCorpus?.recipes || [];
  /** @type {Record<string, Record<string, number>>} */
  const follow = {};
  for (const r of recipes) {
    const seq = Array.isArray(r?.sequence) ? r.sequence : [];
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i];
      const b = seq[i + 1];
      if (!a || !b || a === "comment" || b === "comment") continue;
      if (!follow[a]) follow[a] = {};
      follow[a][b] = (follow[a][b] || 0) + 1;
    }
  }
  return follow;
}

/**
 * Normalize a settled-run note into a primary output type string, or "".
 * @param {string|{ type?: string, modality?: string, outputType?: string, ok?: boolean }|null|undefined} note
 */
export function normalizeOutputType(note) {
  if (note == null) return "";
  if (typeof note === "string") {
    const t = note.trim();
    if (!t || t === "comment") return "";
    return t.startsWith("add:") ? t.slice(4) : t;
  }
  if (typeof note !== "object") return "";
  if (note.ok === false) return "";
  const raw = note.type || note.outputType || note.modality || "";
  if (typeof raw !== "string") return "";
  const t = raw.trim();
  if (!t || t === "comment") return "";
  return t.startsWith("add:") ? t.slice(4) : t;
}

/**
 * In-memory settled-run state (last successful output type + timestamp).
 * @returns {{
 *   get: () => { type: string, at: number } | null,
 *   note: (note: any, now?: number) => { type: string, at: number } | null,
 *   clear: () => void,
 *   expired: (now?: number, ttlMs?: number) => boolean,
 * }}
 */
export function createSettledRunState() {
  /** @type {{ type: string, at: number } | null} */
  let cur = null;
  return {
    get() {
      return cur ? { type: cur.type, at: cur.at } : null;
    },
    note(note, now = Date.now()) {
      const type = normalizeOutputType(note);
      if (!type) return null;
      if (note && typeof note === "object" && note.ok === false) {
        cur = null;
        return null;
      }
      cur = { type, at: Number(now) || Date.now() };
      return { type: cur.type, at: cur.at };
    },
    clear() {
      cur = null;
    },
    expired(now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
      if (!cur) return true;
      const ttl = Number(ttlMs);
      if (!(ttl > 0)) return false;
      return now - cur.at > ttl;
    },
  };
}

/**
 * Score follow-on types for a settled output type.
 * @param {string} outputType
 * @param {Record<string, Record<string, number>>|null|undefined} followOns
 * @param {{
 *   memory?: { boost?: (action:string)=>number }|null,
 *   nodeTypes?: Set<string>|null,
 * }} [opts]
 * @returns {Array<{action:string, type:string, score:number, source:string, reason:string}>}
 */
export function scoreSettledFollowOns(outputType, followOns, opts = {}) {
  const type = normalizeOutputType(outputType);
  if (!type || !followOns || typeof followOns !== "object") return [];
  const row = followOns[type];
  if (!row || typeof row !== "object") return [];
  const mem = opts.memory || null;
  const known = opts.nodeTypes || null;
  /** @type {Array<{action:string, type:string, score:number, source:string, reason:string}>} */
  const rows = [];
  for (const [next, count] of Object.entries(row)) {
    if (!next || next === "comment") continue;
    if (known && !known.has(next)) continue;
    const base = Number(count) || 0;
    if (!(base > 0)) continue;
    const action = "add:" + next;
    let score = base;
    let reason = REASON;
    if (mem && typeof mem.boost === "function") {
      const b = Number(mem.boost(action)) || 1;
      if (b !== 1) {
        score = base * b;
        if (b > 1.05) reason = "after this run · you often pick";
      }
    }
    if (!(score > 0)) continue;
    rows.push({
      action,
      type: next,
      score,
      source: SOURCE,
      reason,
    });
  }
  rows.sort(
    (a, b) => b.score - a.score || a.action.localeCompare(b.action)
  );
  return rows;
}

/**
 * Confidence gate (share + lead). Flat / thin → [].
 * @param {Array<{action:string, score:number, type?:string, source?:string, reason?:string}>} rows
 * @param {{ minShare?: number, minLead?: number, max?: number }} [opts]
 */
export function gateConfidentSettled(rows, opts = {}) {
  const minShare = opts.minShare ?? MIN_SHARE;
  const minLead = opts.minLead ?? MIN_LEAD;
  const max = opts.max ?? MAX_SETTLED_SUGGEST;
  if (!Array.isArray(rows) || !rows.length) return [];
  const sum = rows.reduce((a, r) => a + Math.max(0, Number(r.score) || 0), 0);
  if (!(sum > 0)) return [];
  const ranked = rows
    .map((r) => ({
      ...r,
      action: String(r.action || ""),
      type: r.type || String(r.action || "").replace(/^add:/, ""),
      score: Math.max(0, Number(r.score) || 0),
      share: Math.max(0, Number(r.score) || 0) / sum,
      source: r.source || SOURCE,
      reason: r.reason || REASON,
    }))
    .filter((r) => r.action)
    .sort((a, b) => b.share - a.share || a.action.localeCompare(b.action));
  if (!ranked.length) return [];
  const top = ranked[0];
  const second = ranked[1];
  const leads =
    !second || second.share <= 0 || top.share >= second.share * minLead;
  if (!leads || top.share < minShare) return [];
  const out = [];
  for (const r of ranked) {
    if (r.share < minShare) continue;
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/** True when prior Suggested already carries a strong-source lift. */
export function priorHasStrongSource(priorAdds) {
  if (!Array.isArray(priorAdds)) return false;
  return priorAdds.some((a) => a && STRONG_SOURCES.includes(a.source));
}

/**
 * Rank settled-run next-add boosts.
 * Returns [] when no modality, no recipe, flat, disabled, reduced-motion,
 * expired, or strong prior.
 *
 * @param {{ type?: string, at?: number } | string | null | undefined} settled
 * @param {Record<string, Record<string, number>>|null|undefined} followOns
 * @param {{
 *   memory?: { boost?: (action:string)=>number }|null,
 *   nodeTypes?: Set<string>|null,
 *   minShare?: number,
 *   minLead?: number,
 *   max?: number,
 *   disabled?: boolean,
 *   prefersReducedMotion?: boolean,
 *   priorAdds?: Array<{source?:string}>,
 *   quietIfStrongPrior?: boolean,
 *   now?: number,
 *   ttlMs?: number,
 * }} [opts]
 */
export function rankSettledRunNextAdd(settled, followOns, opts = {}) {
  if (opts.disabled) return [];
  if (opts.prefersReducedMotion) return [];
  const quietStrong = opts.quietIfStrongPrior !== false;
  if (quietStrong && priorHasStrongSource(opts.priorAdds)) return [];
  if (!followOns || typeof followOns !== "object") return [];

  let type = "";
  let at = 0;
  if (typeof settled === "string") {
    type = normalizeOutputType(settled);
    at = opts.now ?? Date.now();
  } else if (settled && typeof settled === "object") {
    type = normalizeOutputType(settled.type || settled);
    const rawAt = Number(settled.at);
    at = Number.isFinite(rawAt) ? rawAt : (opts.now ?? Date.now());
  }
  if (!type) return [];

  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  if (ttl > 0 && now - at > ttl) return [];

  const scored = scoreSettledFollowOns(type, followOns, {
    memory: opts.memory || null,
    nodeTypes: opts.nodeTypes || null,
  });
  if (!scored.length) return [];
  return gateConfidentSettled(scored, {
    minShare: opts.minShare,
    minLead: opts.minLead,
    max: opts.max ?? MAX_SETTLED_SUGGEST,
  });
}

/**
 * Soft-merge settled-run hits into prior Suggested add rows.
 * Does not stomp stronger sources. Strong prior → prior unchanged (quiet).
 *
 * @param {Array<{type:string, action?:string, reason?:string, source?:string, share?:number}>} priorAdds
 * @param {Array<{type:string, action?:string, reason?:string, source?:string, share?:number}>} settledHits
 * @param {{ max?: number }} [opts]
 */
export function softMergeSettledRun(priorAdds, settledHits, opts = {}) {
  const max = opts.max ?? MAX_SETTLED_SUGGEST;
  const prior = Array.isArray(priorAdds) ? priorAdds : [];
  const hits = Array.isArray(settledHits) ? settledHits : [];
  if (priorHasStrongSource(prior)) return prior.slice(0, max);
  if (!hits.length) return prior.slice(0, max);

  /** @type {Map<string, {type:string, action:string, reason:string, source:string, share:number}>} */
  const by = new Map();
  for (const a of prior) {
    if (!a || !a.type) continue;
    by.set(a.type, {
      type: a.type,
      action: a.action || "add:" + a.type,
      reason: a.reason || "often added next",
      source: a.source || "",
      share: Number(a.share) || 0,
    });
  }
  for (const h of hits) {
    if (!h || !h.type) continue;
    const existing = by.get(h.type);
    if (existing && STRONG_SOURCES.includes(existing.source)) continue;
    if (existing && existing.source && existing.source !== SOURCE) continue;
    by.set(h.type, {
      type: h.type,
      action: h.action || "add:" + h.type,
      reason: h.reason || REASON,
      source: h.source || SOURCE,
      share: Number(h.share) || 0,
    });
  }

  const ordered = [];
  const seen = new Set();
  for (const a of prior) {
    if (!a || !a.type || seen.has(a.type)) continue;
    if (!by.has(a.type)) continue;
    ordered.push(by.get(a.type));
    seen.add(a.type);
  }
  const extras = [...by.values()]
    .filter((r) => !seen.has(r.type))
    .sort((a, b) => b.share - a.share || a.type.localeCompare(b.type));
  for (const r of extras) {
    ordered.push(r);
    seen.add(r.type);
    if (ordered.length >= max) break;
  }
  return ordered.slice(0, max);
}

/**
 * Infer primary output type from a settled run graph snapshot.
 * Prefers seed node types that finished ok; falls back to any ok node with outs.
 *
 * @param {{
 *   nodes?: Array<{ id?: string, type?: string, status?: string, ok?: boolean }>,
 *   seedIds?: string[]|null,
 * }} graph
 * @returns {string}
 */
export function inferSettledOutputType(graph = {}) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  if (!nodes.length) return "";
  const byId = new Map();
  for (const n of nodes) {
    if (n && n.id != null) byId.set(String(n.id), n);
  }
  const ok = (n) =>
    !!n &&
    n.type &&
    n.type !== "comment" &&
    (n.ok === true ||
      n.status === "ok" ||
      n.status === "done" ||
      n.status === "success");

  const seeds = Array.isArray(graph.seedIds) ? graph.seedIds : [];
  let last = "";
  for (const id of seeds) {
    const n = byId.get(String(id));
    if (ok(n)) last = n.type;
  }
  if (last) return last;
  for (const n of nodes) {
    if (ok(n)) last = n.type;
  }
  return last || "";
}

export { MIN_SHARE, MIN_LEAD };
