/**
 * Product · 5 — local action ring buffer (flagged).
 * Same · 2 ACTION_VOCAB tokens. Memory + optional localStorage.
 * Never uploads; export() is a local dump only (no fetch/XHR).
 *
 * Capacity: RING_CAPACITY=48 (telemetry window). Encode K=3 stays in
 * schema.json for the recommender; the ring keeps a longer recent trail
 * so later opt-in dumps have useful trajectories without bloating encode.
 */
import { ACTION_VOCAB, schema } from "./encode.mjs";

export const RING_CAPACITY = 48;
export const STORAGE_KEY = "nanoodle.nextAction.ring.v1";
export const ENABLED_KEY = "nanoodle.nextAction.ring.enabled.v1";

/** @typedef {{ token: string, t: number }} RingEntry */

/**
 * @param {{
 *   capacity?: number,
 *   storage?: Storage | null,
 *   now?: () => number,
 * }} [opts]
 */
export function createRing(opts = {}) {
  const capacity = Math.max(1, opts.capacity ?? RING_CAPACITY);
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const now = opts.now || (() => Date.now());

  /** @type {RingEntry[]} */
  let buf = [];
  let enabled = false;

  if (storage) {
    try {
      const flag = storage.getItem(ENABLED_KEY);
      enabled = flag === "1" || flag === "true";
      if (enabled) {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed?.entries)) {
            buf = parsed.entries
              .filter((e) => e && typeof e.token === "string" && ACTION_VOCAB.includes(e.token))
              .slice(-capacity)
              .map((e) => ({ token: e.token, t: Number(e.t) || 0 }));
          }
        }
      }
    } catch (_) {
      /* ignore corrupt / private-mode */
    }
  }

  function persist() {
    if (!storage || !enabled) return;
    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          schemaVersion: schema.schemaVersion,
          capacity,
          entries: buf,
        })
      );
      storage.setItem(ENABLED_KEY, "1");
    } catch (_) {
      /* quota / private */
    }
  }

  function clearPersist() {
    if (!storage) return;
    try {
      storage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  return {
    capacity,
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
      else clearPersist();
      return enabled;
    },
    /** Push a · 2 vocab token when enabled. Unknown tokens ignored. */
    record(token) {
      if (!enabled) return false;
      if (!ACTION_VOCAB.includes(token)) return false;
      buf = buf.concat({ token, t: now() }).slice(-capacity);
      persist();
      return true;
    },
    /** Newest-last token strings (or full entries if {entries:true}). */
    get(opts2 = {}) {
      if (opts2.entries) return buf.slice();
      return buf.map((e) => e.token);
    },
    clear() {
      buf = [];
      clearPersist();
    },
    /**
     * Local dump only — shape for later opt-in export.
     * Never sends network.
     */
    export() {
      return {
        product: "Product · 5",
        label: "local action ring",
        schemaVersion: schema.schemaVersion,
        vocab: ACTION_VOCAB.slice(),
        capacity,
        enabled,
        exportedAt: now(),
        entries: buf.map((e) => ({ token: e.token, t: e.t })),
      };
    },
    size() {
      return buf.length;
    },
  };
}

function defaultStorage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch (_) {}
  return null;
}

/** Singleton for the editor surface (browser). */
let _shared = null;
export function sharedRing(opts) {
  if (!_shared) _shared = createRing(opts);
  return _shared;
}

export { ACTION_VOCAB, schema };
