/**
 * Headless next-action engine for the real editor.
 *
 * Loads the frequency prior and, when the smoke weights load, the learned
 * blend. Publishes a cached hint object that menu renderers read synchronously.
 * List rendering never waits on inference.
 *
 * There is no panel, no ghost, and no ?product= surface. The old "wire" tip
 * only recorded the token — it never called connect() — so a wire suggestion
 * is not an action button. Menus rank add:/set:model/open:examples rows;
 * while a wire drag is active the editor may emphasize one compatible port,
 * and dropping still goes through connect().
 *
 * ?na=0 or ?product=off (or nano.nextAction=off) disables the engine. A failed
 * load leaves the cache empty, so menus stay as they are.
 */
import { ACTION_VOCAB, sketchFromGraph, schema } from "./encode.mjs";
import { chooseHints } from "./hints.mjs";

const BASE = new URL(".", import.meta.url);

export function predictorDisabled(search) {
  const raw = search != null
    ? String(search)
    : (typeof location !== "undefined" ? location.search : "");
  const q = new URLSearchParams(raw.charAt(0) === "?" ? raw.slice(1) : raw);
  const off = (v) => v === "0" || v === "off" || v === "false";
  if (off((q.get("na") || "").toLowerCase())) return true;
  if (off((q.get("product") || "").toLowerCase())) return true;
  if (search == null) {
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem("nano.nextAction") === "off") return true;
    } catch (_) {}
  }
  return false;
}

async function loadJSON(rel) {
  const res = await fetch(new URL(rel, BASE));
  if (!res.ok) throw new Error(`fetch ${rel} ${res.status}`);
  return res.json();
}

function disabledApi() {
  return {
    disabled: true,
    peek() { return null; },
    record() {},
    refresh() {},
  };
}

/**
 * @param {{
 *   getGraph: () => {nodes?:any[], links?:any[], selectedId?:string|null},
 *   nodeTypes?: string[],
 *   onHints?: () => void,
 * }} api
 */
export async function mount(api) {
  if (predictorDisabled()) {
    window.__nextAction = disabledApi();
    return window.__nextAction;
  }

  /** @type {string[]} */
  let history = [];
  /** @type {ReturnType<typeof chooseHints> | null} */
  let cache = null;
  let sig = "";
  let tables = null;
  let session = null;
  let recommendFrequency = null;
  let recommendNext = null;
  const known = api.nodeTypes && api.nodeTypes.length ? new Set(api.nodeTypes) : null;

  function publish(next) {
    const s = next && next.confident ? JSON.stringify(next) : "";
    cache = next && next.confident ? next : null;
    if (s === sig) return;
    sig = s;
    try { api.onHints && api.onHints(); } catch (_) {}
  }

  function recompute() {
    if (!tables || !recommendFrequency) {
      publish(null);
      return;
    }
    let sketch = {};
    try { sketch = sketchFromGraph((api.getGraph && api.getGraph()) || {}); }
    catch (_) { sketch = {}; }
    const opts = { nodeTypes: known, sketch, coldStart: history.length === 0 };
    try {
      const frequencyRows = recommendFrequency(tables, history, sketch, ACTION_VOCAB.length);
      let blendRows = null;
      if (session && recommendNext) {
        blendRows = recommendNext(
          { tables, session, blend: 0.35 },
          history,
          sketch,
          ACTION_VOCAB.length
        );
      }
      publish(chooseHints({ frequencyRows, blendRows, ...opts }));
    } catch (e) {
      console.warn("[next-action] hint recompute failed", e);
      publish(null);
    }
  }

  function record(action) {
    if (!ACTION_VOCAB.includes(action)) return;
    history = history.concat(action).slice(-schema.K * 3);
    recompute();
  }

  window.__nextAction = {
    disabled: false,
    peek() { return cache; },
    record,
    refresh: recompute,
  };

  try {
    const freqMod = await import("./frequency.mjs");
    const recMod = await import("./recommend.mjs");
    recommendFrequency = freqMod.recommendFrequency;
    recommendNext = recMod.recommendNext;
    tables = await loadJSON("corpus/frequency-tables.json");
  } catch (e) {
    console.warn("[next-action] frequency prior unavailable", e);
    tables = null;
  }

  try {
    const sn = await import("../smallnet/index.js");
    const fix = await loadJSON("fixtures/smoke-weights.json");
    const layers = fix.layers.map((L) => ({
      W: Float32Array.from(L.W),
      b: Float32Array.from(L.b),
    }));
    session = sn.createSession(fix.manifest, sn.packWeights(fix.manifest, layers));
  } catch (e) {
    console.warn("[next-action] learned session unavailable", e);
    session = null;
  }

  if (tables && recommendFrequency) recompute();
  else publish(null);
  return window.__nextAction;
}
