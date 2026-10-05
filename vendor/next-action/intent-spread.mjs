/**
 * Product · 52 — intent-mode spread in the Add list (pure helpers).
 *
 * After a branch-point node (an output that forks into different intents,
 * e.g. Image → Refine / Animate / Describe / 3D), the top Suggested rows can
 * all come from one intent. A tiny MoG head (ParticleGAN `develop`, trained
 * on gallery walkbacks with intent-fork tags) gives a mixture over intent
 * modes for the selected node. When two or more modes are live and the
 * current top three Suggested rows miss one of them, rows 2–3 are re-ordered
 * so each live mode gets one row. Row 1 never moves, and a recipe row is
 * never displaced. One dominant mode, a single live mode, an empty
 * Suggested group, or an already-spread list stays quiet.
 *
 * No DOM, no panel, no ghost, no pulse. Inference is one 68→16→8 pass.
 */

/** Intent modes, in head order. Labels show only in the row tooltip. */
export const MODES = Object.freeze(["refine", "animate", "describe", "picture", "sound", "3d", "split"]);
export const MODE_LABEL = Object.freeze({
  refine: "Refine",
  animate: "Animate",
  describe: "Describe",
  picture: "Picture",
  sound: "Sound",
  "3d": "3D",
  split: "Frames",
});

/** Intent-fork tag per consumer node type (the supervision for the head). */
export const MODE_OF_TYPE = Object.freeze({
  edit: "refine", inpaint: "refine", resize: "refine", vedit: "refine", trim: "refine", combine: "refine",
  ivideo: "animate", tvideo: "animate", lipsync: "animate",
  vision: "describe", llm: "describe", transcribe: "describe", join: "describe",
  image: "picture",
  tts: "sound", music: "sound", soundtrack: "sound", remix: "sound", extractaudio: "sound",
  model3d: "3d",
  vframes: "split",
});

/** Feature vocabulary for the head (fixed order; must match training). */
export const TYPES = Object.freeze([
  "text", "upload", "aupload", "vupload", "mupload", "choice", "join", "llm", "image", "edit",
  "inpaint", "resize", "vision", "tvideo", "ivideo", "model3d", "vedit", "vframes", "combine",
  "soundtrack", "lipsync", "music", "remix", "tts", "trim", "extractaudio", "transcribe", "endpoint",
]);
export const PORT_TYPES = Object.freeze(["text", "image", "video", "audio", "model3d"]);

/** Main output port type per node type (live editor ports, 2026-10-05). */
export const OUT_PORT = Object.freeze({
  text: "text", upload: "image", aupload: "audio", vupload: "video", mupload: "model3d", choice: "text",
  join: "text", llm: "text", image: "image", edit: "image", inpaint: "image", resize: "image",
  vision: "text", tvideo: "video", ivideo: "video", model3d: "model3d", vedit: "video", vframes: "image",
  combine: "video", soundtrack: "video", lipsync: "video", music: "audio", remix: "audio", tts: "audio",
  trim: "audio", extractaudio: "audio", transcribe: "text",
});

/** Node types with an input that accepts each port type (endpoint/model ports left out). */
export const CONSUMERS_BY_PORT = Object.freeze({
  text: Object.freeze(["join", "llm", "image", "edit", "inpaint", "vision", "tvideo", "ivideo", "vedit", "lipsync", "music", "remix", "tts"]),
  image: Object.freeze(["edit", "inpaint", "resize", "vision", "ivideo", "model3d", "lipsync", "llm"]),
  video: Object.freeze(["vedit", "vframes", "combine", "soundtrack", "extractaudio"]),
  audio: Object.freeze(["soundtrack", "lipsync", "remix", "trim", "transcribe"]),
  model3d: Object.freeze([]),
});

export const IN_DIM = TYPES.length + PORT_TYPES.length + MODES.length + TYPES.length;
export const MODE_MIN = 0.12;     // a mode below this share is not a live fork
export const DOMINANT = 0.7;      // one mode at or above this share → quiet
export const MAX_ROWS = 3;
export const SOURCE = "intent-spread";
export const STRONG_KEEP = Object.freeze(["recipe"]);
/** Opening helpers (· 20 first node / first trio, cold start) own those moments — stay quiet. */
export const OPENING_SOURCES = Object.freeze(["first-trio", "first-node", "cold-start", "post-first", "empty-followup"]);

export function reasonFor(mode) {
  return `another direction · ${MODE_LABEL[mode] || mode}`;
}

/** Mode of a row type relative to the anchor's output port, or null (off-branch). */
export function rowMode(type, portType) {
  const consumers = CONSUMERS_BY_PORT[portType] || [];
  if (!consumers.includes(type)) return null;
  return MODE_OF_TYPE[type] || null;
}

/** Modes that have at least one consumer for the port type. */
export function modesForPort(portType) {
  const out = new Set();
  for (const t of CONSUMERS_BY_PORT[portType] || []) if (MODE_OF_TYPE[t]) out.add(MODE_OF_TYPE[t]);
  return MODES.filter((m) => out.has(m));
}

/**
 * Feature vector shared by training (scripts/train-intent-spread.py) and the editor.
 * @param {{ producerType: string, portType: string, usedModes?: string[], contextCounts?: Record<string, number> }} ctx
 */
export function featurize(ctx = {}) {
  const x = new Array(IN_DIM).fill(0);
  const ti = TYPES.indexOf(ctx.producerType);
  if (ti >= 0) x[ti] = 1;
  const pi = PORT_TYPES.indexOf(ctx.portType);
  if (pi >= 0) x[TYPES.length + pi] = 1;
  const off = TYPES.length + PORT_TYPES.length;
  for (const m of ctx.usedModes || []) {
    const mi = MODES.indexOf(m);
    if (mi >= 0) x[off + mi] = 1;
  }
  const off2 = off + MODES.length;
  for (const [t, c] of Object.entries(ctx.contextCounts || {})) {
    const i = TYPES.indexOf(t);
    if (i < 0) continue;
    x[off2 + i] = Math.min(3, Math.max(0, Number(c) || 0)) / 3;
  }
  return x;
}

function softmaxMasked(logits, mask) {
  let mx = -Infinity;
  for (let i = 0; i < logits.length; i++) if (mask[i] && logits[i] > mx) mx = logits[i];
  const out = new Array(logits.length).fill(0);
  if (mx === -Infinity) return out;
  let s = 0;
  for (let i = 0; i < logits.length; i++) {
    if (!mask[i]) continue;
    out[i] = Math.exp(logits[i] - mx);
    s += out[i];
  }
  for (let i = 0; i < out.length; i++) out[i] = s > 0 ? out[i] / s : 0;
  return out;
}

/** True when a weights.json object has the expected shapes. */
export function validWeights(w) {
  if (!w || w.format !== "intent-spread-mog-v1") return false;
  const H = w.hidden, D = w.zDim, K = w.modes?.length, C = w.candidates?.length;
  if (!(H > 0 && D > 0 && K === MODES.length && C > 0)) return false;
  if (w.inDim !== IN_DIM) return false;
  if (!Array.isArray(w.W1) || w.W1.length !== H || w.W1[0]?.length !== IN_DIM) return false;
  if (!Array.isArray(w.b1) || w.b1.length !== H) return false;
  if (!Array.isArray(w.W2) || w.W2.length !== D || w.W2[0]?.length !== H) return false;
  if (!Array.isArray(w.b2) || w.b2.length !== D) return false;
  if (!Array.isArray(w.means) || w.means.length !== K || w.means[0]?.length !== D) return false;
  if (!Array.isArray(w.modeBias) || w.modeBias.length !== K) return false;
  if (!Array.isArray(w.typeEmb) || w.typeEmb.length !== C || w.typeEmb[0]?.length !== D) return false;
  if (!Array.isArray(w.typeBias) || w.typeBias.length !== C) return false;
  for (let k = 0; k < K; k++) if (w.modes[k] !== MODES[k]) return false;
  return true;
}

/**
 * MoG head forward pass.
 * @returns {{ pi: Record<string, number>, typeScore: Record<string, Record<string, number>>, marginal: Record<string, number> } | null}
 */
export function modeMixture(w, ctx) {
  if (!validWeights(w)) return null;
  const port = ctx && ctx.portType;
  const consumers = CONSUMERS_BY_PORT[port] || [];
  if (!consumers.length) return null;
  const x = featurize(ctx);
  const H = w.hidden, D = w.zDim, K = MODES.length, C = w.candidates.length;
  const h = new Array(H);
  for (let i = 0; i < H; i++) {
    let s = w.b1[i];
    const row = w.W1[i];
    for (let j = 0; j < x.length; j++) if (x[j]) s += row[j] * x[j];
    h[i] = s > 0 ? s : 0;
  }
  const q = new Array(D);
  for (let i = 0; i < D; i++) {
    let s = w.b2[i];
    const row = w.W2[i];
    for (let j = 0; j < H; j++) s += row[j] * h[j];
    q[i] = s;
  }
  const scale = 1 / Math.sqrt(D);
  const portModes = new Set(modesForPort(port));
  const modeMask = MODES.map((m) => portModes.has(m));
  const modeLogits = MODES.map((_, k) => {
    let s = w.modeBias[k];
    for (let d = 0; d < D; d++) s += q[d] * w.means[k][d] * scale;
    return s;
  });
  const piArr = softmaxMasked(modeLogits, modeMask);
  const typeMask = w.candidates.map((t) => consumers.includes(t));
  /** @type {Record<string, Record<string, number>>} */
  const typeScore = {};
  /** @type {Record<string, number>} */
  const marginal = {};
  for (let k = 0; k < K; k++) {
    if (!modeMask[k]) continue;
    const logits = new Array(C);
    for (let c = 0; c < C; c++) {
      let s = w.typeBias[c];
      for (let d = 0; d < D; d++) s += w.typeEmb[c][d] * w.means[k][d];
      logits[c] = s;
    }
    const p = softmaxMasked(logits, typeMask);
    typeScore[MODES[k]] = {};
    for (let c = 0; c < C; c++) {
      if (!typeMask[c]) continue;
      typeScore[MODES[k]][w.candidates[c]] = p[c];
      marginal[w.candidates[c]] = (marginal[w.candidates[c]] || 0) + piArr[k] * p[c];
    }
  }
  /** @type {Record<string, number>} */
  const pi = {};
  MODES.forEach((m, k) => { if (modeMask[k]) pi[m] = piArr[k]; });
  return { pi, typeScore, marginal };
}

/** Best type for one mode: tagged with that mode, compatible, known, not excluded. */
export function bestTypeForMode(mix, mode, portType, opts = {}) {
  const known = opts.nodeTypes || null;
  const exclude = opts.exclude || new Set();
  const scores = (mix && mix.typeScore && mix.typeScore[mode]) || {};
  let best = null, bestScore = -1;
  for (const t of CONSUMERS_BY_PORT[portType] || []) {
    if (MODE_OF_TYPE[t] !== mode) continue;
    if (exclude.has(t)) continue;
    if (known && !known.has(t)) continue;
    const s = Number(scores[t]) || 0;
    if (s > bestScore || (s === bestScore && best && t < best)) { best = t; bestScore = s; }
  }
  return best;
}

/** Live modes (share ≥ MODE_MIN), highest share first. */
export function liveModes(mix, opts = {}) {
  const min = opts.modeMin ?? MODE_MIN;
  return Object.entries((mix && mix.pi) || {})
    .filter(([, p]) => p >= min)
    .sort((a, b) => b[1] - a[1] || MODES.indexOf(a[0]) - MODES.indexOf(b[0]))
    .map(([m]) => m);
}

/**
 * Anchor context for the selected node, or null when there is no single
 * selected non-comment node with an output.
 * @param {{ nodes?: Array<{id:string,type:string}>, links?: Array<{from:any,to:any}>, selectedId?: string|null, selectedIds?: string[] }} graph
 */
export function anchorContext(graph = {}) {
  if (Array.isArray(graph.selectedIds) && graph.selectedIds.length > 1) return null;
  const id = graph.selectedId;
  if (!id) return null;
  const nodes = graph.nodes || [];
  const node = nodes.find((n) => n && n.id === id);
  if (!node || !node.type || node.type === "comment") return null;
  const portType = OUT_PORT[node.type];
  if (!portType || !(CONSUMERS_BY_PORT[portType] || []).length) return null;
  const byId = new Map(nodes.map((n) => [n && n.id, n && n.type]));
  const usedModes = [];
  const consumerTypes = [];
  for (const l of graph.links || []) {
    const from = l && l.from && (l.from.node ?? l.from);
    const to = l && l.to && (l.to.node ?? l.to);
    if (from !== id) continue;
    const t = byId.get(to);
    if (!t) continue;
    consumerTypes.push(t);
    const m = rowMode(t, portType);
    if (m && !usedModes.includes(m)) usedModes.push(m);
  }
  /** @type {Record<string, number>} */
  const contextCounts = {};
  for (const n of nodes) {
    if (!n || !n.type || n.type === "comment") continue;
    contextCounts[n.type] = (contextCounts[n.type] || 0) + 1;
  }
  return { anchorId: id, producerType: node.type, portType, usedModes, consumerTypes, contextCounts };
}

/**
 * Re-order the existing Suggested rows so the top three cover distinct live
 * intent modes. Returns { adds, changed, tagged, modes } — unchanged when quiet.
 * @param {object} weights
 * @param {object} graph   editor graph sketch (nodes/links/selectedId)
 * @param {Array<{type:string, action?:string, reason?:string, source?:string, share?:number}>} priorAdds
 * @param {{ nodeTypes?: Set<string>|null, disabled?: boolean, modeMin?: number, dominant?: number }} [opts]
 */
export function spreadIntentRows(weights, graph, priorAdds, opts = {}) {
  const prior = (Array.isArray(priorAdds) ? priorAdds : []).filter((a) => a && a.type).slice(0, MAX_ROWS);
  const quiet = (why) => ({ adds: prior, changed: false, tagged: [], modes: [], why });
  if (opts.disabled) return quiet("disabled");
  if (!prior.length) return quiet("no-suggested");
  if (prior.some((a) => OPENING_SOURCES.includes(a.source))) return quiet("opening");
  const ctx = anchorContext(graph);
  if (!ctx) return quiet("no-anchor");
  const mix = modeMixture(weights, ctx);
  if (!mix) return quiet("no-head");
  const dominant = opts.dominant ?? DOMINANT;
  const topShare = Math.max(0, ...Object.values(mix.pi));
  if (topShare >= dominant) return quiet("dominant");
  const known = opts.nodeTypes || null;
  const live = liveModes(mix, opts).filter((m) => bestTypeForMode(mix, m, ctx.portType, { nodeTypes: known }));
  if (live.length < 2) return quiet("single-mode");

  const liveSet = new Set(live);
  const modeOf = (t) => rowMode(t, ctx.portType);
  const priorLive = new Set(prior.map((a) => modeOf(a.type)).filter((m) => m && liveSet.has(m)));
  const want = Math.min(MAX_ROWS, live.length);
  if (priorLive.size >= want) return quiet("already-spread");

  // Row 1 and any recipe row are pinned in place.
  const pinned = prior.filter((a, i) => i === 0 || STRONG_KEEP.includes(a.source));
  const out = pinned.slice();
  const used = new Set(out.map((a) => a.type));
  const covered = new Set(out.map((a) => modeOf(a.type)).filter(Boolean));
  // Pass 1: keep existing rows that bring a new live mode, in their order.
  for (const a of prior) {
    if (out.length >= MAX_ROWS) break;
    if (used.has(a.type)) continue;
    const m = modeOf(a.type);
    if (!m || !liveSet.has(m) || covered.has(m)) continue;
    out.push(a); used.add(a.type); covered.add(m);
  }
  // Pass 2: lift one Add-list row for each uncovered live mode, highest share first.
  const tagged = [];
  for (const m of live) {
    if (out.length >= MAX_ROWS) break;
    if (covered.has(m)) continue;
    const t = bestTypeForMode(mix, m, ctx.portType, { nodeTypes: known, exclude: used });
    if (!t) continue;
    out.push({ type: t, action: "add:" + t, reason: reasonFor(m), source: SOURCE, share: mix.pi[m] });
    used.add(t); covered.add(m); tagged.push(t);
  }
  // Pass 3: fill with the remaining prior rows, in order.
  for (const a of prior) {
    if (out.length >= MAX_ROWS) break;
    if (used.has(a.type)) continue;
    out.push(a); used.add(a.type);
  }
  const before = prior.map((a) => a.type).join(",");
  const after = out.map((a) => a.type).join(",");
  const outLive = new Set(out.map((a) => modeOf(a.type)).filter((m) => m && liveSet.has(m)));
  if (before === after || outLive.size <= priorLive.size) return quiet("no-gain");
  return { adds: out, changed: true, tagged, modes: live, pi: mix.pi, why: "spread" };
}
