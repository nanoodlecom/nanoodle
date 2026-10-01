/**
 * Local accept / ignore memory for suggested add rows.
 * A suggestion the user keeps passing over is down-weighted. Picking it
 * gives a small boost. Stored in localStorage only. No network.
 * When disabled, nothing is recorded and scores are left alone.
 */

export const STORAGE_KEY = "nanoodle.nextAction.suggestions.v1";
const ACCEPT_STEP = 0.12;
const IGNORE_STEP = 0.22;
const MIN_BOOST = 0.15;
const MAX_BOOST = 1.8;

function defaultStorage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch (_) {}
  return null;
}

/**
 * @param {{ storage?: Storage | null, enabled?: boolean }} [opts]
 */
export function createSuggestionMemory(opts = {}) {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const enabled = opts.enabled !== false;
  /** @type {Map<string, {accepts:number, ignores:number}>} */
  const arms = new Map();

  if (enabled && storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const saved = parsed && parsed.arms;
        if (saved && typeof saved === "object") {
          for (const [k, v] of Object.entries(saved)) {
            if (!k.startsWith("add:") || !v || typeof v !== "object") continue;
            arms.set(k, {
              accepts: Math.max(0, Number(v.accepts) || 0),
              ignores: Math.max(0, Number(v.ignores) || 0),
            });
          }
        }
      }
    } catch (_) {}
  }

  function persist() {
    if (!enabled || !storage) return;
    try {
      /** @type {Record<string, {accepts:number, ignores:number}>} */
      const dump = {};
      for (const [k, v] of arms) dump[k] = { accepts: v.accepts, ignores: v.ignores };
      storage.setItem(STORAGE_KEY, JSON.stringify({ arms: dump }));
    } catch (_) {}
  }

  function boost(action) {
    if (!enabled) return 1;
    const s = arms.get(action);
    if (!s) return 1;
    const raw = 1 + ACCEPT_STEP * s.accepts - IGNORE_STEP * s.ignores;
    return Math.max(MIN_BOOST, Math.min(MAX_BOOST, raw));
  }

  /**
   * The suggested add rows that were on screen, and the add the user picked.
   * The pick is an accept. Every other shown suggestion is an ignore.
   * @param {string} action
   * @param {string[]} shown
   */
  function noteChoice(action, shown) {
    if (!enabled) return false;
    const list = [];
    for (const a of shown || []) {
      if (typeof a !== "string" || !a.startsWith("add:") || list.includes(a)) continue;
      list.push(a);
    }
    if (!list.length) return false;
    const picked = typeof action === "string" ? action : "";
    for (const a of list) {
      const s = arms.get(a) || { accepts: 0, ignores: 0 };
      if (a === picked) s.accepts += 1;
      else s.ignores += 1;
      arms.set(a, s);
    }
    persist();
    return true;
  }

  /**
   * Multiply add: scores. Other actions (wire, set:model) stay put.
   * @param {Array<{action?:string, score?:number}> | null} rows
   */
  function reweightRows(rows) {
    if (!enabled || !Array.isArray(rows)) return rows;
    let changed = false;
    const out = rows.map((r) => {
      if (!r || typeof r.action !== "string" || !r.action.startsWith("add:")) return r;
      const b = boost(r.action);
      if (b === 1) return r;
      changed = true;
      const score = Math.max(0, Number(r.score) || 0) * b;
      return { ...r, score };
    });
    return changed ? out : rows;
  }

  return {
    enabled,
    boost,
    noteChoice,
    reweightRows,
    arm(action) {
      const s = arms.get(action);
      return s ? { accepts: s.accepts, ignores: s.ignores } : { accepts: 0, ignores: 0 };
    },
  };
}
