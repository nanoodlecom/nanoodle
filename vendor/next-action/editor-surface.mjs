/**
 * Headless next-action engine for the real editor.
 *
 * Loads the frequency prior and, when weights load, the learned blend.
 * The loader tries the catalog, then the smoke fixture.
 * The shipped catalog has no models, so the fixture is what runs.
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
import { createSuggestionMemory } from "./suggestion-memory.mjs";
import { applyAntiSlop, isShallowTextLlm, rerankShallowAdds } from "./anti-slop.mjs";
import { pickRingTarget, rankDropTypes } from "./port-suggest.mjs";
import { confidentRecipe, mergeRecipeHint } from "./recipe.mjs";
import { loadNextActionExport } from "./export-load.mjs";
import {
  buildModalityFollowOns,
  createSettledRunState,
  rankSettledRunNextAdd as rankSettledRunNextAddPure,
  inferSettledOutputType,
} from "./settled-run-next-add.mjs";

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
    noteSettledRun() { return null; },
    clearSettledRun() {},
    rankSettledRunNextAdd() { return []; },
    settledRunPeek() { return null; },
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
  let slopPriors = null;
  let portTables = null;
  let recipes = null;
  let session = null;
  let recommendFrequency = null;
  let recommendNext = null;
  const known = api.nodeTypes && api.nodeTypes.length ? new Set(api.nodeTypes) : null;
  const memory = createSuggestionMemory();
  // Product · 45: last settled successful run → recipe follow-on Suggested boost.
  const settledRun = createSettledRunState();
  /** @type {Record<string, Record<string, number>>|null} */
  let modalityFollowOns = null;

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
      let frequencyRows = memory.reweightRows(
        recommendFrequency(tables, history, sketch, ACTION_VOCAB.length)
      );
      let blendRows = null;
      if (session && recommendNext) {
        blendRows = memory.reweightRows(recommendNext(
          { tables, session, blend: 0.35 },
          history,
          sketch,
          ACTION_VOCAB.length
        ));
      }
      const shallow = slopPriors && isShallowTextLlm(sketch, slopPriors);
      if (shallow) {
        const slopOpts = { priors: slopPriors, tables, expand: true };
        frequencyRows = applyAntiSlop(frequencyRows, history, sketch, slopOpts);
        if (blendRows) blendRows = applyAntiSlop(blendRows, history, sketch, slopOpts);
      }
      let hints = chooseHints({ frequencyRows, blendRows, ...opts });
      if (shallow) hints = rerankShallowAdds(hints, frequencyRows, sketch, slopPriors);
      const recipe = recipes ? confidentRecipe(recipes, sketch, { nodeTypes: known }) : null;
      publish(mergeRecipeHint(hints, recipe));
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
    noteChoice(action, shown) {
      if (memory.noteChoice(action, shown)) recompute();
    },
    hasPortPriors() { return !!portTables; },
    rankDropTypes(query) {
      if (!portTables) return null;
      try { return rankDropTypes(portTables, query); }
      catch (_) { return null; }
    },
    pickRingTarget(query) {
      if (!portTables) return null;
      try { return pickRingTarget(portTables, query); }
      catch (_) { return null; }
    },
    // Product · 45: after a successful settled run, soft-boost recipe follow-ons.
    noteSettledRun(note) {
      try {
        const typed = (note && typeof note === "object" && !note.type && !note.outputType && !note.modality)
          ? { ...note, type: inferSettledOutputType(note) }
          : note;
        const out = settledRun.note(typed);
        try { api.onHints && api.onHints(); } catch (_) {}
        return out;
      } catch (_) { return null; }
    },
    clearSettledRun() {
      try { settledRun.clear(); } catch (_) {}
      try { api.onHints && api.onHints(); } catch (_) {}
    },
    settledRunPeek() {
      try { return settledRun.get(); } catch (_) { return null; }
    },
    rankSettledRunNextAdd(opts = {}) {
      try {
        if (settledRun.expired(opts.now, opts.ttlMs)) return [];
        return rankSettledRunNextAddPure(settledRun.get(), modalityFollowOns, {
          memory,
          nodeTypes: known,
          disabled: false,
          prefersReducedMotion: !!opts.prefersReducedMotion,
          priorAdds: opts.priorAdds || [],
          quietIfStrongPrior: opts.quietIfStrongPrior !== false,
          now: opts.now,
          ttlMs: opts.ttlMs,
          max: opts.max,
          minShare: opts.minShare,
          minLead: opts.minLead,
        });
      } catch (_) { return []; }
    },
    hasModalityFollowOns() { return !!modalityFollowOns; },
  };

  try {
    portTables = await loadJSON("corpus/port-suggest.json");
    if (!portTables || !portTables.topTargets) portTables = null;
  } catch (e) {
    console.warn("[next-action] port priors unavailable", e);
    portTables = null;
  }

  try {
    const freqMod = await import("./frequency.mjs");
    const recMod = await import("./recommend.mjs");
    recommendFrequency = freqMod.recommendFrequency;
    recommendNext = recMod.recommendNext;
    tables = await loadJSON("corpus/frequency-tables.json");
    try { slopPriors = await loadJSON("corpus/anti-slop.json"); }
    catch (err) {
      console.warn("[next-action] anti-slop prior unavailable", err);
      slopPriors = null;
    }
    if (!slopPriors || !Array.isArray(slopPriors.slopActions)) slopPriors = null;
    try { recipes = await loadJSON("corpus/recipes.json"); }
    catch (err) {
      console.warn("[next-action] recipe corpus unavailable", err);
      recipes = null;
    }
    if (!recipes || !Array.isArray(recipes.recipes)) recipes = null;
    try {
      modalityFollowOns = recipes ? buildModalityFollowOns(recipes) : null;
      if (modalityFollowOns && !Object.keys(modalityFollowOns).length) modalityFollowOns = null;
    } catch (_) { modalityFollowOns = null; }
  } catch (e) {
    console.warn("[next-action] frequency prior unavailable", e);
    tables = null;
  }

  try {
    const loaded = await loadNextActionExport();
    session = loaded && loaded.session ? loaded.session : null;
  } catch (e) {
    console.warn("[next-action] learned session unavailable", e);
    session = null;
  }

  if (tables && recommendFrequency) recompute();
  else publish(null);
  return window.__nextAction;
}
