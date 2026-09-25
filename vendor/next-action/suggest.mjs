/**
 * Graph-aware next steps for the node that is selected.
 *
 * Rank by that node's open output types (an LLM text output suggests Image,
 * Speech, …), then by what is already in the graph. A wire that already
 * exists, a duplicate unused root (a second Text while one sits unwired),
 * and an action that would not connect anything are dropped.
 *
 * Preference among type-compatible consumers uses the cool-path weights from
 * the anti-slop prior (image / video / speech ahead of another join). The
 * prior's penalty on add:llm after add:text is NOT applied: when Text is
 * selected, LLM is the right next node, and burying it made the list worse.
 *
 * Dismiss is a session set of row keys (`add:image`, `recipe:image-upscale`).
 * No scores, no bandit panel. An empty or unselected graph is not confident
 * — callers leave the menu exactly as it was.
 *
 * Placement is a pure slot search: the new card goes to the right of an
 * anchor, skipping measured rectangles. Existing rectangles are never moved.
 */

/** Roots we will not offer again while one of them has no outgoing wire. */
export const ROOT_TYPES = Object.freeze([
  "text",
  "upload",
  "aupload",
  "vupload",
  "choice",
]);

/**
 * Consumers of an output type, best first.
 * `port` is the input the editor's connect() should land on.
 * Weights are the anti-slop cool-path boosts, scaled so a clear winner leads.
 */
export const CONSUMERS = Object.freeze({
  text: Object.freeze([
    { type: "llm", port: "prompt", weight: 100 },
    { type: "image", port: "prompt", weight: 92 },
    { type: "tts", port: "prompt", weight: 78 },
    { type: "music", port: "prompt", weight: 70 },
    { type: "tvideo", port: "prompt", weight: 66 },
    { type: "join", port: "a", weight: 36 },
  ]),
  image: Object.freeze([
    { type: "ivideo", port: "image", weight: 90 },
    { type: "edit", port: "image", weight: 84 },
    { type: "resize", port: "image", weight: 62 },
    { type: "vision", port: "image", weight: 58 },
    { type: "inpaint", port: "image", weight: 40 },
  ]),
  audio: Object.freeze([
    { type: "transcribe", port: "audio", weight: 82 },
    { type: "remix", port: "audio", weight: 70 },
    { type: "lipsync", port: "audio", weight: 64 },
    { type: "trim", port: "audio", weight: 48 },
  ]),
  video: Object.freeze([
    { type: "vedit", port: "video", weight: 80 },
    { type: "vframes", port: "video", weight: 68 },
    { type: "extractaudio", port: "video", weight: 56 },
    { type: "soundtrack", port: "video", weight: 50 },
  ]),
});

/**
 * One or two short chains whose first input is the selected output.
 * Later steps are wired from the previous new node's output, not from
 * whatever else happens to be on the canvas.
 */
export const RECIPES = Object.freeze({
  text: Object.freeze([
    {
      id: "llm-image",
      label: "LLM then Image",
      steps: Object.freeze([
        { type: "llm", toPort: "prompt" },
        { type: "image", toPort: "prompt", fromStep: 0, fromPort: "text" },
      ]),
    },
    {
      id: "llm-speech",
      label: "LLM then Speech",
      steps: Object.freeze([
        { type: "llm", toPort: "prompt" },
        { type: "tts", toPort: "prompt", fromStep: 0, fromPort: "text" },
      ]),
    },
  ]),
  image: Object.freeze([
    {
      id: "edit-resize",
      label: "Edit then Resize",
      steps: Object.freeze([
        { type: "edit", toPort: "image" },
        { type: "resize", toPort: "image", fromStep: 0, fromPort: "image" },
      ]),
    },
    {
      id: "ivideo-vedit",
      label: "Image→Video then Video edit",
      steps: Object.freeze([
        { type: "ivideo", toPort: "image" },
        { type: "vedit", toPort: "video", fromStep: 0, fromPort: "video" },
      ]),
    },
  ]),
  audio: Object.freeze([
    {
      id: "transcribe-llm",
      label: "Transcribe then LLM",
      steps: Object.freeze([
        { type: "transcribe", toPort: "audio" },
        { type: "llm", toPort: "prompt", fromStep: 0, fromPort: "text" },
      ]),
    },
  ]),
  video: Object.freeze([
    {
      id: "vedit-frames",
      label: "Video edit then Frames",
      steps: Object.freeze([
        { type: "vedit", toPort: "video" },
        { type: "vframes", toPort: "video", fromStep: 0, fromPort: "video" },
      ]),
    },
  ]),
});

/**
 * Text-output chains that start with Image (the selected node already
 * produced the text — an LLM — so Image is the first new node).
 * Separate from RECIPES.text, which is for a raw Text source: those go
 * through LLM first so a new Image is not wired past it.
 */
export const TEXT_PRODUCER_RECIPES = Object.freeze([
  {
    id: "image-upscale",
    label: "Image then Upscale",
    steps: Object.freeze([
      { type: "image", toPort: "prompt" },
      { type: "edit", toPort: "image", fromStep: 0, fromPort: "image" },
    ]),
  },
  {
    id: "image-ivideo",
    label: "Image then Image→Video",
    steps: Object.freeze([
      { type: "image", toPort: "prompt" },
      { type: "ivideo", toPort: "image", fromStep: 0, fromPort: "image" },
    ]),
  },
]);

const NOT_CONFIDENT = Object.freeze({
  confident: false,
  quiet: false,
  adds: Object.freeze([]),
  recipes: Object.freeze([]),
});

const MAX_ADDS = 3;
const MAX_RECIPES = 2;

function nodeById(nodes, id) {
  return (nodes || []).find((n) => n && n.id === id) || null;
}

/** True when this output already feeds a node of `type`. */
export function wireExists(links, nodes, fromId, fromPort, type) {
  return (links || []).some((l) => {
    if (!l || !l.from || !l.to) return false;
    if (l.from.node !== fromId || l.from.port !== fromPort) return false;
    const tgt = nodeById(nodes, l.to.node);
    return !!(tgt && tgt.type === type);
  });
}

/** A root of this type is on the canvas and nothing reads it yet. */
export function unusedRoot(nodes, links, type) {
  if (!ROOT_TYPES.includes(type)) return false;
  return (nodes || []).some(
    (n) => n && n.type === type && !(links || []).some((l) => l && l.from && l.from.node === n.id)
  );
}

function knownType(known, type) {
  if (!known) return true;
  return known.has(type);
}

function recipeListFor(outType, sourceType) {
  if (outType === "text" && sourceType && sourceType !== "text" && sourceType !== "choice") {
    return TEXT_PRODUCER_RECIPES;
  }
  return RECIPES[outType] || [];
}

/**
 * @param {{
 *   nodes?: {id:string,type:string,outputs?:{name:string,type:string}[]}[],
 *   links?: {from:{node:string,port:string},to:{node:string,port:string}}[],
 *   selectedId?: string|null,
 * }} graph
 * @param {{
 *   dismissed?: Iterable<string>,
 *   nodeTypes?: Set<string>|null,
 *   maxAdds?: number,
 *   maxRecipes?: number,
 * }} [opts]
 */
export function suggestNext(graph = {}, opts = {}) {
  const nodes = graph.nodes || [];
  const links = graph.links || [];
  const dismissed = new Set(opts.dismissed || []);
  const known = opts.nodeTypes || null;
  const maxAdds = opts.maxAdds ?? MAX_ADDS;
  const maxRecipes = opts.maxRecipes ?? MAX_RECIPES;
  const sel = graph.selectedId ? nodeById(nodes, graph.selectedId) : null;
  if (!sel || sel.type === "comment") return NOT_CONFIDENT;
  const outputs = (sel.outputs || []).filter((o) => o && o.name && o.type && CONSUMERS[o.type]);
  if (!outputs.length) return NOT_CONFIDENT;

  /** @type {{type:string,action:string,fromId:string,fromPort:string,toPort:string,weight:number,reason:string}[]} */
  const adds = [];
  const seenAdd = new Set();
  let hidden = 0;

  for (const out of outputs) {
    const consumers = CONSUMERS[out.type] || [];
    for (const c of consumers) {
      if (!c || !c.type || seenAdd.has(c.type)) continue;
      if (!knownType(known, c.type)) continue;
      // Another copy of the node you're on (LLM → LLM) is the loop the
      // anti-slop prior downranks. Leave it in the catalog, not in Suggested,
      // so a text output's first row is the next modality (Image, Speech, …).
      if (c.type === sel.type) continue;
      const action = "add:" + c.type;
      if (dismissed.has(action)) {
        hidden++;
        continue;
      }
      if (wireExists(links, nodes, sel.id, out.name, c.type)) continue;
      if (unusedRoot(nodes, links, c.type)) continue;
      if (!c.port) continue;
      seenAdd.add(c.type);
      adds.push({
        type: c.type,
        action,
        fromId: sel.id,
        fromPort: out.name,
        toPort: c.port,
        weight: c.weight || 0,
        reason: "uses this output",
      });
    }
  }
  adds.sort((a, b) => b.weight - a.weight || a.type.localeCompare(b.type));

  /** @type {object[]} */
  const recipes = [];
  const seenRecipe = new Set();
  for (const out of outputs) {
    const list = recipeListFor(out.type, sel.type);
    for (const recipe of list) {
      if (!recipe || seenRecipe.has(recipe.id)) continue;
      const key = "recipe:" + recipe.id;
      if (dismissed.has(key)) {
        hidden++;
        continue;
      }
      const steps = recipe.steps || [];
      if (steps.length < 2) continue;
      if (steps.some((s) => !s || !s.type || !s.toPort || !knownType(known, s.type))) continue;
      if (wireExists(links, nodes, sel.id, out.name, steps[0].type)) continue;
      if (steps.some((s) => unusedRoot(nodes, links, s.type))) continue;
      seenRecipe.add(recipe.id);
      recipes.push({
        id: recipe.id,
        action: key,
        label: recipe.label,
        fromId: sel.id,
        fromPort: out.name,
        outType: out.type,
        steps: steps.map((s) => ({
          type: s.type,
          toPort: s.toPort,
          fromStep: s.fromStep == null ? null : s.fromStep,
          fromPort: s.fromPort || null,
        })),
      });
    }
  }

  const shownAdds = adds.slice(0, maxAdds);
  const shownRecipes = recipes.slice(0, maxRecipes);
  if (!shownAdds.length && !shownRecipes.length) {
    if (hidden > 0) {
      return { confident: true, quiet: true, adds: [], recipes: [] };
    }
    return NOT_CONFIDENT;
  }
  return {
    confident: true,
    quiet: false,
    adds: shownAdds,
    recipes: shownRecipes,
  };
}

/** Axis-aligned overlap, with `pad` px of breathing room added to `a`. */
export function overlaps(a, b, pad = 0) {
  if (!a || !b) return false;
  return (
    a.x < b.x + b.w + pad &&
    a.x + a.w + pad > b.x &&
    a.y < b.y + b.h + pad &&
    a.y + a.h + pad > b.y
  );
}

/**
 * First free slot to the right of `anchor`. `rects` are existing nodes
 * (measured). This never returns a shifted copy of those rects — callers
 * must not move them.
 * @param {{x:number,y:number,w:number,h:number}} anchor
 * @param {{w:number,h:number}} size
 * @param {{x:number,y:number,w:number,h:number}[]} [rects]
 * @param {number} [gap]
 */
export function freeSlot(anchor, size, rects = [], gap = 44) {
  const w = Math.max(1, Number(size && size.w) || 280);
  const h = Math.max(1, Number(size && size.h) || 200);
  const ax = Number(anchor && anchor.x) || 0;
  const ay = Number(anchor && anchor.y) || 0;
  const aw = Math.max(1, Number(anchor && anchor.w) || w);
  const baseX = ax + aw + gap;
  const strideY = Math.max(80, Math.round(Math.min(h, 220) * 0.55));
  const obstacles = (rects || []).filter(
    (r) => r && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h)
  );
  for (let col = 0; col < 8; col++) {
    const x = baseX + col * (w + gap);
    for (let row = 0; row < 12; row++) {
      const y = ay + row * strideY;
      const box = { x, y, w, h };
      if (!obstacles.some((r) => overlaps(box, r, 16))) {
        return { x: Math.round(x), y: Math.round(y) };
      }
    }
  }
  return { x: Math.round(baseX), y: Math.round(ay + obstacles.length * (strideY + gap)) };
}
