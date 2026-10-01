/**
 * Product · 49 — run-failure rewire pulse (pure helpers).
 *
 * After a node run fails for a missing / empty required input, pick ONE
 * empty input port so the editor can briefly pulse it, then retain its error
 * state. An explicit error names the fix regardless of gallery popularity;
 * gallery inbound mass (#621) only disambiguates equally matching inputs.
 *
 * Distinct from · 22 / · 29 idle nudges, · 33 post-wire continue, · 43
 * post-add, · 44 post-delete, · 46 aborted-wire resume — trigger is run
 * failure for missing/empty required input only.
 */

import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "./port-suggest.mjs";

function leads(top, second) {
  return !second || second <= 0 || top >= second * MIN_LEAD;
}

/**
 * Max gallery inbound mass for an in port key `type|port` (invert topTargets).
 * @param {import("./port-suggest.mjs").PortSuggestTables|null|undefined} tables
 * @param {string} type
 * @param {string} port
 */
export function inMass(tables, type, port) {
  if (!tables?.topTargets || !type || !port) return 0;
  const destKey = `${type}|${port}`;
  let mass = 0;
  for (const row of Object.values(tables.topTargets)) {
    if (!row || typeof row !== "object") continue;
    const n = Number(row[destKey]) || 0;
    if (n > mass) mass = n;
  }
  return mass;
}

/**
 * Parse a run-failure message into modality / port name hints.
 * Returns lowercase tokens that may match input port names or types.
 *
 * @param {string} errorMessage
 * @returns {{ ports: string[], modalities: string[], wireHint: boolean }}
 */
export function parseMissingInputError(errorMessage) {
  const msg = String(errorMessage || "");
  const ports = [];
  const modalities = [];
  let wireHint = false;

  // "wire an image into the image port" / "wire the mask port"
  const intoPort = msg.match(/into the\s+([a-z0-9_]+)\s+port/i);
  if (intoPort) ports.push(intoPort[1].toLowerCase());
  const thePort = msg.match(/wire(?:\s+the)?\s+([a-z0-9_]+)\s+port/i);
  if (thePort) ports.push(thePort[1].toLowerCase());
  const named = msg.match(/\b(?:port|field)\s+["']?([a-z0-9_]+)["']?/i);
  if (named) ports.push(named[1].toLowerCase());

  if (/\bwire\b/i.test(msg)) wireHint = true;

  // Leading "no X — …" patterns from NODE_TYPES.run preflight throws.
  const noMod = msg.match(
    /\bno\s+(image|images|audio|video|prompt|mask|text|clip|model|options|3d(?:\s+file)?)\b/i
  );
  if (noMod) {
    let m = noMod[1].toLowerCase();
    if (m === "images") m = "image";
    if (m === "3d" || m === "3d file") m = "model";
    if (m === "clip") m = "video";
    modalities.push(m);
    // prompt/text often map to the prompt fieldport
    if (m === "prompt" || m === "text") ports.push("prompt");
    else if (m === "mask") ports.push("mask");
    else if (m === "image" || m === "audio" || m === "video") ports.push(m);
  }

  // "no edit instruction" → prompt fieldport
  if (/\bno edit instruction\b/i.test(msg)) {
    modalities.push("prompt");
    ports.push("prompt");
  }

  // "this model needs N images (role1, role2)" → image ports
  if (/\bneeds\s+\d+\s+images\b/i.test(msg) || /\bwire all of them\b/i.test(msg)) {
    modalities.push("image");
    ports.push("image");
  }

  // Dedup preserve order
  const uniq = (arr) => {
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      if (!x || seen.has(x)) continue;
      seen.add(x);
      out.push(x);
    }
    return out;
  };

  return { ports: uniq(ports), modalities: uniq(modalities), wireHint };
}

/**
 * True when the error looks like a missing/empty required input (not API/network).
 * @param {string} errorMessage
 */
export function isMissingInputFailure(errorMessage) {
  const msg = String(errorMessage || "");
  if (!msg) return false;
  // Abort / stop are not failures
  if (/^AbortError/i.test(msg) || /\baborted\b/i.test(msg)) return false;
  // Network / auth / model drift — not a rewire cue
  if (/Failed to fetch|NetworkError|couldn't reach|API key|invalidModel|missing_custom_model/i.test(msg))
    return false;
  if (/^4\d\d\b/.test(msg) && /model/i.test(msg)) return false;
  if (/^video failed:|^audio failed:/i.test(msg)) return false;
  if (/no \w+ in response/i.test(msg)) return false;
  if (/cycle detected/i.test(msg)) return false;

  const parsed = parseMissingInputError(msg);
  if (parsed.ports.length || parsed.modalities.length) return true;
  if (/\bno\s+[a-z]+\s*[\u2014\-:]/i.test(msg) && /\b(wire|upload|type|describe|brush|drop)\b/i.test(msg))
    return true;
  return false;
}

/**
 * Score how well an input candidate matches the parsed error.
 * Higher = better. 0 = not a candidate.
 *
 * @param {{ name: string, type?: string, wired?: boolean, empty?: boolean, field?: boolean }} input
 * @param {{ ports: string[], modalities: string[], wireHint: boolean }} parsed
 * @param {{ requireMissing?: boolean }} [opts]
 */
export function scoreInputAgainstError(input, parsed, opts = {}) {
  if (!input?.name) return 0;
  const name = String(input.name).toLowerCase();
  const ptype = String(input.type || "").toLowerCase();
  const requireMissing = opts.requireMissing !== false;

  // Only empty / unwired required inputs are fix targets.
  if (requireMissing) {
    const missing = input.wired ? !!input.empty : true;
    // Wired with a non-empty value is not the problem.
    if (input.empty === false) return 0;
    if (!missing && input.empty !== true && input.wired !== false) {
      // If caller omitted wired/empty flags, still allow name match (toy / soft path).
      if (input.wired == null && input.empty == null) {
        /* fall through */
      } else if (!missing) return 0;
    }
  }

  let score = 0;
  if (parsed.ports.includes(name)) score += 100;
  // image2 / img1 etc. when error mentions image
  if (
    parsed.modalities.includes("image") &&
    (name === "image" || /^image\d+$/i.test(name) || /^img\d+$/i.test(name) || /^ref\d+$/i.test(name))
  ) {
    score += name === "image" ? 80 : 60;
  }
  if (parsed.modalities.includes("audio") && (name === "audio" || ptype === "audio")) score += 80;
  if (parsed.modalities.includes("video") && (name === "video" || ptype === "video" || /^vid\d+$/i.test(name)))
    score += 80;
  if (parsed.modalities.includes("prompt") && (name === "prompt" || name === "q" || name === "text" || name === "lyrics"))
    score += name === "prompt" ? 90 : 70;
  if (parsed.modalities.includes("mask") && name === "mask") score += 90;
  if (parsed.modalities.includes("text") && (name === "text" || name === "prompt" || ptype === "text"))
    score += 50;

  // Soft: modality matches port type even without exact name
  if (!score && parsed.modalities.includes(ptype)) score += 40;

  // Prefer unwired over wired-but-empty when both match equally later
  if (score > 0 && input.wired === false) score += 5;
  if (score > 0 && input.field) score += 1;

  return score;
}

/**
 * Collect candidate missing inputs from inputsMeta (+ optional graphSnapshot).
 *
 * inputsMeta items: { name, type?, wired?, empty?, field? }
 * graphSnapshot optional: { links?: [{from,to}], nodes?: [{id,type,out?}] }
 *
 * @param {object} ctx
 * @returns {Array<{ name: string, type: string, wired: boolean, empty: boolean, field: boolean, errScore: number }>}
 */
export function collectMissingInputCandidates(ctx = {}) {
  const parsed = parseMissingInputError(ctx.errorMessage || "");
  if (!isMissingInputFailure(ctx.errorMessage || "")) return [];

  const meta = Array.isArray(ctx.inputsMeta) ? ctx.inputsMeta : [];
  const nodeId = ctx.nodeId || ctx.id || null;
  const links = ctx.graphSnapshot?.links || [];

  /** @type {Array<{ name: string, type: string, wired: boolean, empty: boolean, field: boolean, errScore: number }>} */
  const out = [];
  for (const raw of meta) {
    if (!raw?.name) continue;
    let wired = raw.wired;
    let empty = raw.empty;
    if (wired == null && nodeId && Array.isArray(links)) {
      wired = links.some((l) => l?.to?.node === nodeId && l?.to?.port === raw.name);
    }
    if (empty == null) empty = true; // unknown → treat as potentially empty for scoring
    const cand = {
      name: String(raw.name),
      type: String(raw.type || ""),
      wired: !!wired,
      empty: empty !== false,
      field: !!raw.field,
    };
    // Skip clearly satisfied inputs
    if (cand.empty === false) continue;
    // Unwired OR wired-but-empty
    if (!cand.wired || cand.empty) {
      const errScore = scoreInputAgainstError(cand, parsed);
      if (errScore > 0) out.push({ ...cand, errScore });
    }
  }

  // If caller gave no inputsMeta but error names a port, synthesize a candidate
  // so the no-tables path can still pulse. Do not invent ports when meta was
  // provided and every input was already satisfied.
  if (!meta.length && !out.length && parsed.ports.length) {
    for (const p of parsed.ports) {
      out.push({
        name: p,
        type: parsed.modalities[0] || p,
        wired: false,
        empty: true,
        field: p === "prompt" || p === "text" || p === "q" || p === "lyrics",
        errScore: 100,
      });
    }
  }

  return out;
}

/**
 * Pick ONE missing/empty input port after a run failure.
 *
 * A clear error match wins without an inbound-popularity gate. Priors only
 * break equally matching candidates; unresolved ambiguity stays quiet.
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables|null|undefined} tables
 * @param {{
 *   nodeId?: string,
 *   id?: string,
 *   nodeType?: string,
 *   type?: string,
 *   errorMessage?: string,
 *   inputsMeta?: Array<{ name: string, type?: string, wired?: boolean, empty?: boolean, field?: boolean }>,
 *   graphSnapshot?: { links?: any[], nodes?: any[] }
 * }} ctx
 * @returns {{ nodeId: string, port: string, type: string, dir: "in", count: number } | null}
 */
export function pickRunFailPort(tables, ctx = {}) {
  const nodeId = ctx.nodeId || ctx.id || null;
  const nodeType = ctx.nodeType || ctx.type || null;
  if (!nodeId || !nodeType) return null;
  if (!isMissingInputFailure(ctx.errorMessage || "")) return null;

  const cands = collectMissingInputCandidates(ctx);
  if (!cands.length) return null;

  // Rank by error match, then by gallery inbound mass (when tables present).
  const scored = cands.map((c) => {
    const mass = tables?.topTargets ? inMass(tables, nodeType, c.name) : 0;
    return {
      nodeId,
      port: c.name,
      type: nodeType,
      dir: /** @type {"in"} */ ("in"),
      count: mass,
      errScore: c.errScore,
    };
  });

  scored.sort(
    (a, b) =>
      b.errScore - a.errScore ||
      b.count - a.count ||
      a.port.localeCompare(b.port)
  );

  const top = scored[0];
  const second = scored[1];

  // Multi equally-likely missing inputs → quiet
  if (second && second.errScore === top.errScore) {
    if (tables?.topTargets) {
      // With priors: also quiet when mass is tied / near-tied on same errScore
      if (top.count < MIN_PAIR || !leads(top.count, second.count) || top.count === second.count) return null;
    } else {
      // No tables: equal error match → quiet
      return null;
    }
  }

  if (!tables?.topTargets) {
    // Clear single pick without prior gate
    return { nodeId: top.nodeId, port: top.port, type: top.type, dir: "in", count: 0 };
  }

  return {
    nodeId: top.nodeId,
    port: top.port,
    type: top.type,
    dir: "in",
    count: top.count,
  };
}

export { MIN_PAIR, MIN_LEAD, MIN_SHARE };
