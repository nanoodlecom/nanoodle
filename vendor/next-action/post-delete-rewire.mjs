/**
 * Product · 44 — post-delete rewire pulse (pure helpers).
 *
 * After the user deletes a node, pick ONE high-prior remaining dangling
 * port so the editor can soft-pulse it inside existing port chrome.
 * Prefer ports that lost a neighbor (were wired to the deleted node).
 * Optionally pick a clear orphan out→in pair for a faint best-pair ghost.
 *
 * Reuses gallery port-pair priors (#621). Trigger is successful delete
 * (not idle ·22/·29, not post-wire ·33, not post-add ·43). Flat / missing /
 * multi-ambiguous priors stay quiet. Same MIN_PAIR / MIN_LEAD / MIN_SHARE
 * gates as ·43; on a count tie prefer output.
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
 * Build a set of "orphaned" port keys (nodeId|port|dir) from lostLinks —
 * ports on remaining nodes that were wired to the deleted node.
 *
 * @param {Array<{from?:{node?:string,port?:string}, to?:{node?:string,port?:string}}>} lostLinks
 * @param {string|null} deletedNodeId
 * @returns {Set<string>}
 */
export function orphanKeysFromLostLinks(lostLinks, deletedNodeId) {
  const keys = new Set();
  if (!deletedNodeId || !Array.isArray(lostLinks)) return keys;
  for (const l of lostLinks) {
    if (!l) continue;
    const f = l.from || {};
    const t = l.to || {};
    if (f.node === deletedNodeId && t.node && t.port) {
      keys.add(`${t.node}|${t.port}|in`);
    }
    if (t.node === deletedNodeId && f.node && f.port) {
      keys.add(`${f.node}|${f.port}|out`);
    }
  }
  return keys;
}

/**
 * Pick one remaining dangling port after a delete.
 *
 * Prefer ports that lost a neighbor (orphaned by the delete) when they
 * clear the gates; otherwise fall back to any high-prior dangling port
 * left on the graph (high-prior orphans left behind).
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{ nodes?: any[], links?: any[], selectedId?: string|null, selectedIds?: string[] }} graph
 * @param {{ deletedNodeId?: string, lostLinks?: any[], orphanKeys?: Set<string>|string[] }} [opts]
 * @returns {{ nodeId: string, port: string, type: string, dir: "out"|"in", count: number, share: number, orphan: boolean } | null}
 */
export function pickPostDeleteRewirePort(tables, graph = {}, opts = {}) {
  if (!tables?.topTargets) return null;
  if (isMultiSelect(graph)) return null;
  const deletedNodeId = opts.deletedNodeId || opts.nodeId || null;
  if (!deletedNodeId) return null;

  const nodes = graph.nodes || [];
  // Deleted node must be gone; need at least one remaining node with ports.
  if (!nodes.length) return null;
  if (nodes.some((n) => n && n.id === deletedNodeId)) return null;

  const orphanKeys =
    opts.orphanKeys instanceof Set
      ? opts.orphanKeys
      : Array.isArray(opts.orphanKeys)
        ? new Set(opts.orphanKeys)
        : orphanKeysFromLostLinks(opts.lostLinks || [], deletedNodeId);

  const { outs: allOuts, ins: allIns } = danglingPorts(tables, graph);
  if (!allOuts.length && !allIns.length) return null;

  /** @type {Array<{nodeId:string,port:string,type:string,dir:"out"|"in",count:number,orphan:boolean}>} */
  const scored = [];
  for (const o of allOuts) {
    if (!o?.nodeId || !o.port || !o.type) continue;
    const count = scoreOut(tables, o, allIns);
    if (count > 0) {
      scored.push({
        nodeId: o.nodeId,
        port: o.port,
        type: o.type,
        dir: "out",
        count,
        orphan: orphanKeys.has(`${o.nodeId}|${o.port}|out`),
      });
    }
  }
  for (const inn of allIns) {
    if (!inn?.nodeId || !inn.port || !inn.type) continue;
    const count = scoreIn(tables, inn, allOuts);
    if (count > 0) {
      scored.push({
        nodeId: inn.nodeId,
        port: inn.port,
        type: inn.type,
        dir: "in",
        count,
        orphan: orphanKeys.has(`${inn.nodeId}|${inn.port}|in`),
      });
    }
  }
  if (!scored.length) return null;

  // Prefer orphaned ports when any clear the gates among themselves.
  const orphaned = scored.filter((r) => r.orphan);
  const pool = orphaned.length ? orphaned : scored;

  pool.sort(
    (a, b) =>
      b.count - a.count ||
      // Prefer output on a count tie (next wire often starts from an out).
      (a.dir === "out" ? 0 : 1) - (b.dir === "out" ? 0 : 1) ||
      a.nodeId.localeCompare(b.nodeId) ||
      a.port.localeCompare(b.port)
  );
  const sum = pool.reduce((a, r) => a + r.count, 0);
  const top = pool[0];
  const second = pool[1];
  const share = top.count / sum;
  if (top.count < MIN_PAIR) return null;
  // Multi-ambiguous: two near-tied rewire targets → quiet. Lone candidate always leads.
  if (!leads(top.count, second && second.count)) return null;
  if (share < MIN_SHARE) return null;

  return {
    nodeId: top.nodeId,
    port: top.port,
    type: top.type,
    dir: top.dir,
    count: top.count,
    share,
    orphan: !!top.orphan,
  };
}

/**
 * Optional polish: pick a single high-prior dangling out→in pair that is
 * the clear orphan bridge after delete (at least one endpoint orphaned).
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables} tables
 * @param {{ nodes?: any[], links?: any[], selectedId?: string|null, selectedIds?: string[] }} graph
 * @param {{ deletedNodeId?: string, lostLinks?: any[], orphanKeys?: Set<string>|string[] }} [opts]
 * @returns {{
 *   from: { nodeId: string, port: string, type: string },
 *   to: { nodeId: string, port: string, type: string },
 *   count: number,
 *   share: number
 * } | null}
 */
export function pickPostDeleteBestPair(tables, graph = {}, opts = {}) {
  if (!tables?.topTargets) return null;
  if (isMultiSelect(graph)) return null;
  const deletedNodeId = opts.deletedNodeId || opts.nodeId || null;
  if (!deletedNodeId) return null;

  const nodes = graph.nodes || [];
  if (nodes.length < 2) return null;
  if (nodes.some((n) => n && n.id === deletedNodeId)) return null;

  const orphanKeys =
    opts.orphanKeys instanceof Set
      ? opts.orphanKeys
      : Array.isArray(opts.orphanKeys)
        ? new Set(opts.orphanKeys)
        : orphanKeysFromLostLinks(opts.lostLinks || [], deletedNodeId);

  const { outs, ins } = danglingPorts(tables, graph);
  if (!outs.length || !ins.length) return null;

  /** @type {Array<{ from: {nodeId:string,port:string,type:string}, to: {nodeId:string,port:string,type:string}, count: number, orphanTouch: boolean }>} */
  const scored = [];
  for (const out of outs) {
    if (!out?.nodeId || !out.port || !out.type) continue;
    for (const inn of ins) {
      if (!inn?.nodeId || !inn.port || !inn.type) continue;
      if (inn.nodeId === out.nodeId) continue;
      const count = pairCount(tables, out.type, out.port, inn.type, inn.port);
      if (count <= 0) continue;
      const orphanTouch =
        orphanKeys.has(`${out.nodeId}|${out.port}|out`) ||
        orphanKeys.has(`${inn.nodeId}|${inn.port}|in`);
      // Prefer pairs that touch an orphaned endpoint; skip unrelated bridges
      // when we know orphans exist.
      if (orphanKeys.size && !orphanTouch) continue;
      scored.push({
        from: { nodeId: out.nodeId, port: out.port, type: out.type },
        to: { nodeId: inn.nodeId, port: inn.port, type: inn.type },
        count,
        orphanTouch,
      });
    }
  }
  if (!scored.length) return null;

  scored.sort(
    (a, b) =>
      b.count - a.count ||
      a.from.nodeId.localeCompare(b.from.nodeId) ||
      a.from.port.localeCompare(b.from.port) ||
      a.to.nodeId.localeCompare(b.to.nodeId) ||
      a.to.port.localeCompare(b.to.port)
  );
  const sum = scored.reduce((a, r) => a + r.count, 0);
  const top = scored[0];
  const second = scored[1];
  const share = top.count / sum;
  if (top.count < MIN_PAIR) return null;
  if (!leads(top.count, second && second.count)) return null;
  if (share < MIN_SHARE) return null;

  return {
    from: top.from,
    to: top.to,
    count: top.count,
    share,
  };
}

export { MIN_PAIR, MIN_LEAD, MIN_SHARE };
