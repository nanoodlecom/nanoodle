/**
 * Product · 17 — dismiss / undo bandit (tip QoS).
 * Learns accept / dismiss / undo of soft tips. Pure client JS; no network.
 * Memory + optional localStorage (`nanoodle.nextAction.bandit.v1`).
 * Default disabled — · 17 editor surface enables the QoS layer.
 */

import { ACTION_VOCAB, schema } from "./encode.mjs";

export const STORAGE_KEY = "nanoodle.nextAction.bandit.v1";
export const ENABLED_KEY = "nanoodle.nextAction.bandit.enabled.v1";
export const OUTCOMES = Object.freeze(["accept", "dismiss", "undo"]);

/** @typedef {{ pulls: number, accepts: number, dismisses: number, undos: number }} ArmStats */
/** @typedef {{ outcome: 'accept'|'dismiss'|'undo', action: string, t: number }} BanditEvent */

/**
 * @param {{
 *   storage?: Storage | null,
 *   now?: () => number,
 *   vocab?: string[],
 * }} [opts]
 */
export function createBandit(opts = {}) {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const now = opts.now || (() => Date.now());
  const vocab = opts.vocab || ACTION_VOCAB;

  /** @type {Map<string, ArmStats>} */
  const arms = new Map();
  /** @type {BanditEvent[]} */
  let events = [];
  /** @type {Set<string>} session-dismissed tips (not persisted) */
  const sessionDismissed = new Set();
  /** @type {BanditEvent | null} */
  let lastOutcome = null;
  let enabled = false;
  let totalPulls = 0;

  function emptyArm() {
    return { pulls: 0, accepts: 0, dismisses: 0, undos: 0 };
  }

  function arm(action) {
    if (!arms.has(action)) arms.set(action, emptyArm());
    return arms.get(action);
  }

  if (storage) {
    try {
      const flag = storage.getItem(ENABLED_KEY);
      enabled = flag === "1" || flag === "true";
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.arms) {
          for (const [k, v] of Object.entries(parsed.arms)) {
            if (!vocab.includes(k)) continue;
            arms.set(k, {
              pulls: Number(v.pulls) || 0,
              accepts: Number(v.accepts) || 0,
              dismisses: Number(v.dismisses) || 0,
              undos: Number(v.undos) || 0,
            });
          }
          totalPulls = Number(parsed.totalPulls) || [...arms.values()].reduce((a, s) => a + s.pulls, 0);
        }
      }
    } catch (_) {
      /* corrupt / private-mode */
    }
  }

  function persist() {
    if (!storage || !enabled) return;
    try {
      /** @type {Record<string, ArmStats>} */
      const dump = {};
      for (const [k, v] of arms) dump[k] = { ...v };
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          schemaVersion: schema.schemaVersion,
          product: 17,
          totalPulls,
          arms: dump,
          savedAt: now(),
        })
      );
      storage.setItem(ENABLED_KEY, "1");
    } catch (_) {
      /* quota / private */
    }
  }

  /**
   * Beta-mean + light UCB exploration over accept vs dismiss.
   * Higher = prefer; dismissed-heavy arms score low.
   */
  function scoreBoost(action) {
    if (!vocab.includes(action)) return 1;
    const s = arms.get(action) || emptyArm();
    const a = s.accepts + 1;
    const b = s.dismisses + 1;
    const mean = a / (a + b);
    const n = Math.max(1, s.pulls);
    const N = Math.max(1, totalPulls);
    const explore = Math.sqrt((2 * Math.log(N + 1)) / n);
    // Map ~[0,1+explore] into multiplicative boost centered at 1
    const raw = mean + 0.35 * explore;
    return Math.max(0.05, Math.min(3, 0.25 + raw * 1.5));
  }

  /**
   * Reweight tip rows: drop session-dismissed, multiply score by bandit boost.
   * @param {Array<{action:string,score:number,source?:string}>} rows
   */
  function reweight(rows) {
    const out = [];
    for (const r of rows || []) {
      if (!r?.action) continue;
      if (sessionDismissed.has(r.action)) continue;
      const boost = enabled ? scoreBoost(r.action) : 1;
      out.push({
        ...r,
        score: Math.max(0.0001, (Number(r.score) || 0) * boost),
        banditBoost: boost,
        source: r.source || "bandit",
      });
    }
    out.sort((a, b) => (b.score || 0) - (a.score || 0));
    return out;
  }

  /**
   * @param {'accept'|'dismiss'|'undo'} outcome
   * @param {string} action
   */
  function record(outcome, action) {
    if (!enabled) return false;
    if (!OUTCOMES.includes(outcome)) return false;
    if (outcome !== "undo" && !vocab.includes(action)) return false;

    if (outcome === "undo") {
      if (!lastOutcome || (lastOutcome.outcome !== "accept" && lastOutcome.outcome !== "dismiss")) {
        return false;
      }
      const prev = lastOutcome;
      const s = arm(prev.action);
      s.undos += 1;
      if (prev.outcome === "dismiss") {
        s.dismisses = Math.max(0, s.dismisses - 1);
        s.pulls = Math.max(0, s.pulls - 1);
        totalPulls = Math.max(0, totalPulls - 1);
        sessionDismissed.delete(prev.action);
      } else if (prev.outcome === "accept") {
        s.accepts = Math.max(0, s.accepts - 1);
        s.pulls = Math.max(0, s.pulls - 1);
        totalPulls = Math.max(0, totalPulls - 1);
      }
      const ev = { outcome: "undo", action: prev.action, t: now(), undid: prev.outcome };
      events = events.concat(ev).slice(-200);
      lastOutcome = ev;
      persist();
      return true;
    }

    const s = arm(action);
    s.pulls += 1;
    totalPulls += 1;
    if (outcome === "accept") {
      s.accepts += 1;
      sessionDismissed.delete(action);
    } else if (outcome === "dismiss") {
      s.dismisses += 1;
      sessionDismissed.add(action);
    }
    const ev = { outcome, action, t: now() };
    events = events.concat(ev).slice(-200);
    lastOutcome = ev;
    persist();
    return true;
  }

  function undoLast() {
    if (!lastOutcome) return { ok: false, reason: "nothing" };
    if (lastOutcome.outcome === "undo") return { ok: false, reason: "already-undone" };
    const action = lastOutcome.action;
    const was = lastOutcome.outcome;
    const ok = record("undo", action);
    return {
      ok,
      action,
      was,
      note:
        was === "dismiss"
          ? `undo · dismissed ${action}`
          : was === "accept"
            ? `undo · accepted ${action}`
            : "undo",
    };
  }

  function totals() {
    let accepts = 0;
    let dismisses = 0;
    let undos = 0;
    for (const s of arms.values()) {
      accepts += s.accepts;
      dismisses += s.dismisses;
      undos += s.undos;
    }
    return { accepts, dismisses, undos, pulls: totalPulls };
  }

  /** Tiny UI note: `bandit · 3✓ 2✗` */
  function note() {
    const t = totals();
    const parts = [`bandit · ${t.accepts}✓ ${t.dismisses}✗`];
    if (t.undos) parts.push(`${t.undos}↶`);
    if (sessionDismissed.size) parts.push(`hide ${sessionDismissed.size}`);
    return parts.join(" · ");
  }

  return {
    isEnabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = !!on;
      if (storage) {
        try {
          storage.setItem(ENABLED_KEY, enabled ? "1" : "0");
        } catch (_) {}
      }
      if (enabled) persist();
      return enabled;
    },
    record,
    reweight,
    scoreBoost,
    undoLast,
    getLastOutcome() {
      return lastOutcome ? { ...lastOutcome } : null;
    },
    isSessionDismissed(action) {
      return sessionDismissed.has(action);
    },
    sessionDismissed() {
      return [...sessionDismissed];
    },
    clearSessionDismissed() {
      sessionDismissed.clear();
    },
    getArm(action) {
      const s = arms.get(action);
      return s ? { ...s } : emptyArm();
    },
    totals,
    note,
    clear() {
      arms.clear();
      events = [];
      sessionDismissed.clear();
      lastOutcome = null;
      totalPulls = 0;
      if (storage) {
        try {
          storage.removeItem(STORAGE_KEY);
        } catch (_) {}
      }
    },
    /**
     * Local dump only — never sends network.
     */
    export() {
      /** @type {Record<string, ArmStats>} */
      const dump = {};
      for (const [k, v] of arms) dump[k] = { ...v };
      return {
        product: "Product · 17",
        label: "dismiss / undo bandit",
        schemaVersion: schema.schemaVersion,
        vocab: vocab.slice(),
        enabled,
        exportedAt: now(),
        totalPulls,
        arms: dump,
        sessionDismissed: [...sessionDismissed],
        lastOutcome: lastOutcome ? { ...lastOutcome } : null,
        events: events.slice(-50),
      };
    },
  };
}

function defaultStorage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch (_) {}
  return null;
}

let _shared = null;
export function sharedBandit(opts) {
  if (!_shared) _shared = createBandit(opts);
  return _shared;
}

export { ACTION_VOCAB, schema };
