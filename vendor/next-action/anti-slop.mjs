/**
 * Product · 9 — anti-slop / soft reject prior.
 * Downweights boring Text→LLM loops on ranked next-action tips.
 * Pure module; no network / no · 5 ring required.
 */

import { ACTION_VOCAB } from "./encode.mjs";

/** Default synth priors (mirrored in corpus/anti-slop.json). */
export const DEFAULT_PRIORS = {
  schemaVersion: 1,
  product: 9,
  slopActions: ["add:text", "add:llm"],
  richActions: [
    "add:image",
    "add:edit",
    "add:ivideo",
    "add:vedit",
    "add:music",
    "add:tts",
    "add:lipsync",
    "add:join",
    "add:resize",
    "open:examples",
    "arrange",
  ],
  rejectBigrams: [
    ["add:text", "add:llm"],
    ["add:llm", "add:text"],
    ["add:text", "add:text"],
    ["add:llm", "add:llm"],
  ],
  coolPathBoosts: {
    "add:image": 1.85,
    "add:edit": 1.7,
    "add:ivideo": 1.75,
    "add:vedit": 1.55,
    "add:music": 1.8,
    "add:tts": 1.65,
    "add:lipsync": 1.6,
    "add:join": 1.35,
    "add:resize": 1.4,
    "open:examples": 1.5,
    arrange: 1.25,
  },
  slopPenalty: 0.12,
  textLlmBigramPenalty: 0.08,
  shallowMaxNodes: 4,
  minKeep: 3,
};

/**
 * Non-comment type counts from a sketch.
 * @param {{ nodeTypeCounts?: Record<string, number>, numNodes?: number }} sketch
 */
export function nonCommentCounts(sketch = {}) {
  /** @type {Record<string, number>} */
  const out = {};
  let n = 0;
  for (const [t, c] of Object.entries(sketch.nodeTypeCounts || {})) {
    if (!t || t === "comment") continue;
    const v = Number(c) || 0;
    if (v <= 0) continue;
    out[t] = v;
    n += v;
  }
  return { counts: out, n: n || 0 };
}

/**
 * True when the graph is a shallow Text+LLM (optional comment) starter loop.
 */
export function isShallowTextLlm(sketch = {}, priors = DEFAULT_PRIORS) {
  const { counts, n } = nonCommentCounts(sketch);
  const types = Object.keys(counts);
  if (!types.length) return false;
  if (!types.every((t) => t === "text" || t === "llm")) return false;
  if ((counts.text || 0) < 1 || (counts.llm || 0) < 1) return false;
  const max = Number(priors.shallowMaxNodes) || 4;
  return n <= max;
}

/**
 * Count identical add:text → add:llm (and reverse / repeats) bigrams in history.
 */
export function countSlopBigrams(history = [], priors = DEFAULT_PRIORS) {
  const rejects = new Set(
    (priors.rejectBigrams || []).map(([a, b]) => `${a}\0${b}`)
  );
  let n = 0;
  for (let i = 0; i < (history || []).length - 1; i++) {
    const key = `${history[i]}\0${history[i + 1]}`;
    if (rejects.has(key)) n++;
  }
  return n;
}

/**
 * Expand a (possibly narrow) frequency ranking to the full action vocab so
 * soft-mask can promote rich alternatives that bigram tables omitted.
 * @param {Array<{action:string,score:number,source?:string}>} rankedRows
 * @param {{ unigram?: Record<string, number> }} [tables]
 */
export function expandToVocab(rankedRows = [], tables = null) {
  const map = new Map();
  for (const r of rankedRows || []) {
    if (!r?.action) continue;
    map.set(r.action, {
      action: r.action,
      score: Number(r.score) || 0,
      source: r.source || "frequency",
    });
  }
  const uni = tables?.unigram || {};
  for (const a of ACTION_VOCAB) {
    if (map.has(a)) continue;
    const u = Number(uni[a]) || 0;
    map.set(a, {
      action: a,
      score: u > 0 ? u * 0.05 : 0.001,
      source: "frequency-pad",
    });
  }
  return [...map.values()].sort(
    (a, b) => b.score - a.score || a.action.localeCompare(b.action)
  );
}

/**
 * Soft-mask ranked rows: downweight slop, boost cool-path alternatives.
 * Never hard-deletes everything — keeps at least minKeep alternatives ranked.
 *
 * @param {Array<{ action: string, score: number, source?: string, masked?: boolean, maskReason?: string }>} rankedRows
 * @param {string[]} history
 * @param {object} sketch
 * @param {{ priors?: object, k?: number, tables?: object, expand?: boolean }} [opts]
 * @returns {typeof rankedRows}
 */
export function applyAntiSlop(rankedRows, history = [], sketch = {}, opts = {}) {
  const priors = { ...DEFAULT_PRIORS, ...(opts.priors || {}) };
  let rowsIn = Array.isArray(rankedRows) ? rankedRows : [];
  if (opts.expand !== false && (opts.tables || opts.expand === true)) {
    rowsIn = expandToVocab(rowsIn, opts.tables || null);
  }
  if (!rowsIn.length) return [];

  const { counts, n: nodeN } = nonCommentCounts(sketch);
  const shallow = isShallowTextLlm(sketch, priors);
  const empty = nodeN === 0;
  const textOnly = nodeN > 0 && Object.keys(counts).every((t) => t === "text") && (counts.text || 0) >= 1;
  const slopBigrams = countSlopBigrams(history, priors);
  const last = history.length ? history[history.length - 1] : null;
  const slopSet = new Set(priors.slopActions || []);
  const richSet = new Set(priors.richActions || []);
  const boosts = priors.coolPathBoosts || {};
  const penalty = Number(priors.slopPenalty);
  const bigramPen = Number(priors.textLlmBigramPenalty);
  const p = Number.isFinite(penalty) ? penalty : 0.12;
  const bp = Number.isFinite(bigramPen) ? bigramPen : 0.08;

  // Cold / empty canvas: pass through — · 6 owns empty seeds; don't break them.
  if (empty && !slopBigrams) {
    return rowsIn.map((r) => ({ ...r, masked: false }));
  }

  const closingLoop =
    last === "add:text" && (shallow || textOnly || slopBigrams > 0);
  const active = shallow || slopBigrams > 0 || closingLoop || textOnly;

  if (!active) {
    // Rich / non-slop graphs: light touch — do not nuke legitimate tips.
    return rowsIn.map((r) => ({ ...r, masked: false }));
  }

  const out = rowsIn.map((r) => {
    const action = r.action;
    let score = Number(r.score) || 0;
    let masked = false;
    let maskReason = undefined;

    const isSlopTip = slopSet.has(action);
    const wouldCloseTextLlm = last === "add:text" && action === "add:llm";

    if (shallow && isSlopTip) {
      score *= p;
      masked = true;
      maskReason = "shallow-text-llm";
    } else if (wouldCloseTextLlm) {
      score *= Math.min(p, bp * 1.5);
      masked = true;
      maskReason = "text-llm-bigram";
    } else if (slopBigrams > 0 && isSlopTip) {
      score *= Math.max(bp, p * 0.5);
      masked = true;
      maskReason = "repeat-slop-bigram";
    } else if (textOnly && action === "add:llm") {
      // Soft: demote closing into the boring two-node starter; don't wipe other tips.
      score *= Math.min(0.35, p * 2);
      masked = true;
      maskReason = "text-only-close-llm";
    }

    if ((shallow || textOnly || closingLoop || slopBigrams > 0) && richSet.has(action)) {
      const b = Number(boosts[action]) || 1.4;
      score *= b;
    }

    return {
      ...r,
      score,
      masked,
      maskReason,
      source: masked ? "anti-slop" : r.source || "frequency",
    };
  });

  out.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.masked) - Number(b.masked) ||
      a.action.localeCompare(b.action)
  );

  const minKeep = Number(priors.minKeep) || 3;
  const positive = out.filter((r) => (Number(r.score) || 0) > 0);
  if (positive.length < minKeep) {
    for (const r of out) {
      if ((Number(r.score) || 0) <= 0) r.score = 1e-6;
    }
    out.sort(
      (a, b) =>
        b.score - a.score ||
        Number(a.masked) - Number(b.masked) ||
        a.action.localeCompare(b.action)
    );
  }

  const k = opts.k;
  if (k != null && Number.isFinite(k) && k > 0) return out.slice(0, k);
  return out;
}

/**
 * Convenience: top-k after anti-slop, preferring non-masked when scores tie.
 */
export function recommendAntiSlop(rankedRows, history, sketch, k = 3, opts = {}) {
  return applyAntiSlop(rankedRows, history, sketch, { ...opts, k });
}
