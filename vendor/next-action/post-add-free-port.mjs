/**
 * Product · 43 — post-add free-port pulse (pure helpers).
 *
 * After the user adds a node, pick ONE high-prior dangling port on that
 * just-added node so the editor can soft-pulse it inside existing port
 * chrome. Reuses gallery port-pair priors (#621). Trigger is successful
 * add (not idle ·22/·29, not post-wire ·33). Flat / missing / multi-
 * ambiguous priors stay quiet.
 *
 * Scope is the new node only. Out and in compete with the same
 * MIN_PAIR / MIN_LEAD / MIN_SHARE gates as ·33/·22; on a count tie,
 * prefer output (next wire often starts from an out).
 */

import {
  MIN_PAIR,
  MIN_LEAD,
  MIN_SHARE,
  danglingPorts,
  pairCount,
} from "./port-suggest.mjs";

function leads(top, second) {
  return !second || second <= 0 || top >= second * MIN_LEAD;
}

function isMultiSelect(graph = {}) {
  return Array.isArray(graph.selectedIds) && graph.selectedIds.length > 1;
}

/** Max gallery outbound mass for an out port. */
function outMass(tables, out) {
  const targets = tables?.topTargets?.[`${out.type}|${out.port}`] || {};
  let mass = 0;
  for (const v of Object.values(targets)) {
    const n = Number(v) || 0;
    if (n > mass) mass = n;
  }
  return mass;
}

/** Inbound source counts for one destination port (invert topTargets). */
function inboundCounts(tables, inn) {
  const destKey = `${inn.type}|${inn.port}`;
  const out = [];
  const targets = tables?.topTargets;
  if (!targets) return out;
  for (const row of Object.values(targets)) {
    if (!row || typeof row !== "object") continue;
    const n = Number(row[destKey]) || 0;
    if (n > 0) out.push(n);
  }
  return out;
}

/** Max gallery inbound mass for an in port. */
function inMass(tables, inn) {
  let mass = 0;
  for (const n of inboundCounts(tables, inn)) {
    if (n > mass) mass = n;
  }
  return mass;
}

/**
 * Score a dangling out: max pair into any dangling-compatible in, else outbound mass.
 * Requires gallery mass ≥ MIN_PAIR (lead/share gates apply across candidates).
 */
function scoreOut(tables, out, ins) {
  const mass = outMass(tables, out);
  if (mass < MIN_PAIR) return 0;
  let best = 0;
  for (const inn of ins) {
    if (!inn?.nodeId || inn.nodeId === out.nodeId) continue;
    const c = pairCount(tables, out.type, out.port, inn.type, inn.port);
    if (c > best) best = c;
  }
  return best > 0 ? best : mass;
}

/**
 * Score a dangling in: max pair from any dangling-compatible out, else inbound mass.
 */
function scoreIn(tables, inn, outs) {
  const mass = inMass(tables, inn);
  if (mass < MIN_PAIR) return 0;
  let best = 0;
  for (const out of outs) {
    if (!out?.nodeId || out.nodeId === inn.nodeId) continue;
    const c = pairCount(tables, out.type, out.port, inn.type, inn.port);
    if (c > best) best = c;
  }
  return best > 0 ? best : mass;
}

/**
 * Pick one dangling port on the just-added node.
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{ nodes?: any[], links?: any[], selectedId?: string|null, selectedIds?: string[] }} graph
 * @param {{ nodeId?: string }} [opts]
 * @returns {{ nodeId: string, port: string, type: string, dir: "out"|"in", count: number, share: number } | null}
 */
export function pickPostAddFreePort(tables, graph = {}, opts = {}) {
  if (!tables?.topTargets) return null;
  if (isMultiSelect(graph)) return null;
  const nodeId = opts.nodeId || opts.id || null;
  if (!nodeId) return null;

  const nodes = graph.nodes || [];
  if (!nodes.some((n) => n && n.id === nodeId)) return null;

  // Dangling on the full graph (usedIn/usedOut need full links), then filter to new node.
  const { outs: allOuts, ins: allIns } = danglingPorts(tables, graph);
  const outs = allOuts.filter((o) => o.nodeId === nodeId);
  const ins = allIns.filter((i) => i.nodeId === nodeId);
  if (!outs.length && !ins.length) return null;

  /** @type {Array<{nodeId:string,port:string,type:string,dir:"out"|"in",count:number}>} */
  const scored = [];
  for (const o of outs) {
    if (!o?.nodeId || !o.port || !o.type) continue;
    const count = scoreOut(tables, o, allIns);
    if (count > 0) scored.push({ nodeId: o.nodeId, port: o.port, type: o.type, dir: "out", count });
  }
  for (const inn of ins) {
    if (!inn?.nodeId || !inn.port || !inn.type) continue;
    const count = scoreIn(tables, inn, allOuts);
    if (count > 0) scored.push({ nodeId: inn.nodeId, port: inn.port, type: inn.type, dir: "in", count });
  }
  if (!scored.length) return null;

  scored.sort(
    (a, b) =>
      b.count - a.count ||
      // Prefer output on a count tie (next wire often starts from an out).
      (a.dir === "out" ? 0 : 1) - (b.dir === "out" ? 0 : 1) ||
      a.port.localeCompare(b.port)
  );
  const sum = scored.reduce((a, r) => a + r.count, 0);
  const top = scored[0];
  const second = scored[1];
  const share = top.count / sum;
  if (top.count < MIN_PAIR) return null;
  // Multi-ambiguous: two near-tied free ports → quiet. Lone candidate always leads.
  if (!leads(top.count, second && second.count)) return null;
  if (share < MIN_SHARE) return null;

  return {
    nodeId: top.nodeId,
    port: top.port,
    type: top.type,
    dir: top.dir,
    count: top.count,
    share,
  };
}

export { MIN_PAIR, MIN_LEAD, MIN_SHARE };
