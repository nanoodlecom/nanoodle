/**
 * Product · 50 — orphan-output consumer pulse (pure helpers).
 *
 * After a successful settled run leaves a high-prior unwired output unused,
 * pick ONE orphan output so the editor can soft-pulse it. Reuses gallery
 * outbound mass (#621). Prefer outs on the run seed node(s); fall back only
 * to other nodes that finished ok in the same run. Never graph-wide idle
 * (that is · 22). Flat / missing / tied priors stay quiet.
 *
 * Distinct from · 22 (idle OR settled dangling-out nudge) and · 45
 * (Suggested next-add boost). Trigger: successful settled run only.
 * Surface: port pulse — not Suggested rows.
 */

import {
  MIN_PAIR,
  MIN_LEAD,
  MIN_SHARE,
  danglingPorts,
  pairCount,
} from "./port-suggest.mjs";

export const DEFAULT_TTL_MS = 2600;

function leads(top, second) {
  return !second || second <= 0 || top >= second * MIN_LEAD;
}

/**
 * Source-port prior must itself be confident (same gates as rankDropTypes),
 * so a flat topTargets row never pulses a lone orphan out.
 */
export function priorConfident(tables, out) {
  const targets = tables?.topTargets?.[`${out.type}|${out.port}`] || {};
  const ranked = Object.values(targets)
    .map((v) => Number(v) || 0)
    .filter((n) => n > 0)
    .sort((a, b) => b - a);
  if (!ranked.length) return false;
  const sum = ranked.reduce((a, b) => a + b, 0);
  const top = ranked[0];
  const second = ranked[1];
  if (top < MIN_PAIR) return false;
  if (!leads(top, second)) return false;
  if (top / sum < MIN_SHARE) return false;
  return true;
}

/**
 * Outbound gallery mass for a source port (max topTargets entry, or best
 * pair into a dangling-compatible in when present).
 */
export function outMass(tables, out, ins) {
  if (!priorConfident(tables, out)) return 0;
  let best = 0;
  for (const inn of ins || []) {
    if (!inn?.nodeId || inn.nodeId === out.nodeId) continue;
    const c = pairCount(tables, out.type, out.port, inn.type, inn.port);
    if (c > best) best = c;
  }
  if (best > 0) return best;
  const targets = tables?.topTargets?.[`${out.type}|${out.port}`] || {};
  let mass = 0;
  for (const v of Object.values(targets)) {
    const n = Number(v) || 0;
    if (n > mass) mass = n;
  }
  return mass;
}

/**
 * Normalize id lists from editor / toys.
 * @param {string[]|Set<string>|null|undefined} ids
 * @returns {Set<string>}
 */
export function idSet(ids) {
  const s = new Set();
  if (!ids) return s;
  const arr = ids instanceof Set ? [...ids] : Array.isArray(ids) ? ids : [];
  for (const id of arr) {
    if (id == null || id === "") continue;
    s.add(String(id));
  }
  return s;
}

/**
 * Pick one orphan (unwired) output after a successful settled run.
 *
 * Scope (tight, documented):
 *  1. Prefer dangling outs on `seedIds` (nodes the user Played).
 *  2. Else outs on `okIds` (other nodes that finished ok in the same run).
 *  3. Never fall back to arbitrary idle graph nodes (· 22 owns that).
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{ nodes?: any[], links?: any[] }} graph
 * @param {{
 *   seedIds?: string[]|Set<string>|null,
 *   okIds?: string[]|Set<string>|null,
 *   allowOkFallback?: boolean,
 * }} [opts]
 * @returns {{ nodeId: string, port: string, type: string, dir: "out", count: number, share: number, scope: "seed"|"ok" } | null}
 */
export function pickOrphanOutPulse(tables, graph = {}, opts = {}) {
  if (!tables?.topTargets) return null;
  const nodes = graph.nodes || [];
  if (!nodes.length) return null;

  const seeds = idSet(opts.seedIds);
  const oks = idSet(opts.okIds);
  // Seeds that finished ok should be in okIds; still prefer seed list first.
  if (!seeds.size && !oks.size) return null;

  const { outs, ins } = danglingPorts(tables, graph);
  if (!outs.length) return null;

  /**
   * @param {Array<{nodeId:string,port:string,type:string}>} candidateOuts
   * @param {"seed"|"ok"} scope
   */
  function pickFrom(candidateOuts, scope) {
    /** @type {Array<{nodeId:string,port:string,type:string,count:number}>} */
    const scored = [];
    for (const o of candidateOuts) {
      if (!o?.nodeId || !o.port || !o.type) continue;
      const count = outMass(tables, o, ins);
      if (count > 0) scored.push({ nodeId: o.nodeId, port: o.port, type: o.type, count });
    }
    if (!scored.length) return null;
    scored.sort(
      (a, b) =>
        b.count - a.count ||
        a.nodeId.localeCompare(b.nodeId) ||
        a.port.localeCompare(b.port)
    );
    const sum = scored.reduce((a, r) => a + r.count, 0);
    const top = scored[0];
    const second = scored[1];
    const share = top.count / sum;
    if (top.count < MIN_PAIR) return null;
    if (!leads(top.count, second && second.count)) return null;
    if (share < MIN_SHARE) return null;
    return {
      nodeId: top.nodeId,
      port: top.port,
      type: top.type,
      dir: /** @type {"out"} */ ("out"),
      count: top.count,
      share,
      scope,
    };
  }

  if (seeds.size) {
    const seedOuts = outs.filter((o) => seeds.has(String(o.nodeId)));
    const picked = pickFrom(seedOuts, "seed");
    if (picked) return picked;
  }

  const allowOk = opts.allowOkFallback !== false;
  if (allowOk && oks.size) {
    // Exclude seeds already tried; only other ok run participants.
    const okOuts = outs.filter(
      (o) => oks.has(String(o.nodeId)) && !seeds.has(String(o.nodeId))
    );
    const picked = pickFrom(okOuts, "ok");
    if (picked) return picked;
  }

  return null;
}

export { MIN_PAIR, MIN_LEAD, MIN_SHARE };
