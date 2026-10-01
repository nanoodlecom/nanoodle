/**
 * Gallery-baked (srcType, srcPort) → (dstType, dstPort) priors.
 * Ranks wire-drop menu types and picks one compatible port for the drag ring.
 * Never creates a wire. The editor draws every link itself.
 */

export const MIN_PAIR = 2;
export const MIN_LEAD = 1.35;
export const MIN_SHARE = 0.18;
export const MAX_TYPES = 3;

/**
 * @typedef {{
 *   typeToType: Record<string, number>,
 *   portPair: Record<string, number>,
 *   topTargets: Record<string, Record<string, number>>,
 *   portCatalog: Record<string, { inputs: string[], outputs: string[] }>,
 * }} PortSuggestTables
 */

/** Ports for a node type from the baked catalog (inputs / outputs). */
export function portsOf(tables, type) {
  const c = tables?.portCatalog?.[type];
  return {
    inputs: c?.inputs ? [...c.inputs] : [],
    outputs: c?.outputs ? [...c.outputs] : [],
  };
}

/** Count of gallery edges from (fromType, fromPort) into (toType, toPort). */
export function pairCount(tables, fromType, fromPort, toType, toPort) {
  if (!fromType || !fromPort || !toType || !toPort) return 0;
  const n = tables?.topTargets?.[`${fromType}|${fromPort}`]?.[`${toType}|${toPort}`];
  return Number(n) || 0;
}

/**
 * Dangling output / input slots on the live graph.
 * @returns {{ outs: Array<{nodeId:string,port:string,type:string}>, ins: Array<{nodeId:string,port:string,type:string}> }}
 */
export function danglingPorts(tables, graph = {}) {
  const nodes = graph.nodes || [];
  const links = graph.links || [];
  const usedOut = new Set();
  const usedIn = new Set();
  for (const L of links) {
    if (L.from?.node && L.from?.port) usedOut.add(`${L.from.node}|${L.from.port}`);
    if (L.to?.node && L.to?.port) usedIn.add(`${L.to.node}|${L.to.port}`);
  }
  const outs = [];
  const ins = [];
  for (const n of nodes) {
    if (!n?.id || !n?.type || n.type === "comment") continue;
    const { inputs, outputs } = portsOf(tables, n.type);
    for (const p of outputs) {
      if (!usedOut.has(`${n.id}|${p}`)) outs.push({ nodeId: n.id, port: p, type: n.type });
    }
    for (const p of inputs) {
      if (!usedIn.has(`${n.id}|${p}`)) ins.push({ nodeId: n.id, port: p, type: n.type });
    }
  }
  return { outs, ins };
}

function labelWire(fromType, fromPort, toType, toPort) {
  return `${fromType}.${fromPort} → ${toType}.${toPort}`;
}

function portNames(ports) {
  const names = [];
  for (const p of ports || []) {
    const name = typeof p === "string" ? p : p && p.name;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Directed count. dir "in" means the drag started on an input, so the candidate produces the wire. */
function directedCount(tables, dir, srcType, srcPort, otherType, otherPort) {
  if (dir === "in") return pairCount(tables, otherType, otherPort, srcType, srcPort);
  return pairCount(tables, srcType, srcPort, otherType, otherPort);
}

function leads(top, second) {
  return !second || second <= 0 || top >= second * MIN_LEAD;
}

/**
 * Rank node types for the wire-drop menu.
 * Returns null when the prior is missing or too flat to reorder the menu.
 *
 * @param {PortSuggestTables} tables
 * @param {{
 *   dir?: "out"|"in",
 *   srcType?: string,
 *   srcPort?: string,
 *   candidates?: Array<{ type: string, ports?: Array<{ name?: string }|string> }>
 * }} [query]
 * @returns {{ order: string[], byType: Record<string, { type: string, count: number, share: number, port: string, reason: string }> } | null}
 */
export function rankDropTypes(tables, query = {}) {
  if (!tables?.topTargets) return null;
  const dir = query.dir === "in" ? "in" : "out";
  const { srcType, srcPort } = query;
  const candidates = query.candidates || [];
  if (!srcType || !srcPort || !candidates.length) return null;

  /** @type {Array<{ type: string, count: number, port: string }>} */
  const scored = [];
  for (const c of candidates) {
    if (!c?.type) continue;
    const names = portNames(c.ports);
    const fallback = dir === "in" ? portsOf(tables, c.type).outputs : portsOf(tables, c.type).inputs;
    const use = names.length ? names : fallback;
    let best = 0;
    let bestPort = "";
    for (const name of use) {
      const count = directedCount(tables, dir, srcType, srcPort, c.type, name);
      if (count > best || (count === best && count > 0 && name < bestPort)) {
        best = count;
        bestPort = name;
      }
    }
    if (best > 0) scored.push({ type: c.type, count: best, port: bestPort });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  const sum = scored.reduce((a, r) => a + r.count, 0);
  const top = scored[0];
  const second = scored[1];
  const share = top.count / sum;
  if (top.count < MIN_PAIR || !leads(top.count, second && second.count) || share < MIN_SHARE) return null;

  const order = [];
  const byType = {};
  for (const r of scored) {
    if (r.count / sum < MIN_SHARE) continue;
    order.push(r.type);
    byType[r.type] = {
      type: r.type,
      count: r.count,
      share: r.count / sum,
      port: r.port,
      reason: "often wired next",
    };
    if (order.length >= MAX_TYPES) break;
  }
  return order.length ? { order, byType } : null;
}

/**
 * Pick one compatible port for the drag ring.
 * Returns null when no pair is clearly ahead.
 *
 * @param {PortSuggestTables} tables
 * @param {{
 *   dir?: "out"|"in",
 *   srcType?: string,
 *   srcPort?: string,
 *   srcNodeId?: string,
 *   targets?: Array<{ nodeId: string, type: string, port: string }>
 * }} [query]
 * @returns {{ nodeId: string, port: string, type: string, count: number } | null}
 */
export function pickRingTarget(tables, query = {}) {
  if (!tables?.topTargets) return null;
  const dir = query.dir === "in" ? "in" : "out";
  const { srcType, srcPort } = query;
  const targets = query.targets || [];
  if (!srcType || !srcPort || !targets.length) return null;

  /** @type {Array<{ nodeId: string, port: string, type: string, count: number }>} */
  const scored = [];
  for (const t of targets) {
    if (!t?.nodeId || !t.type || !t.port) continue;
    if (query.srcNodeId && t.nodeId === query.srcNodeId) continue;
    const count = directedCount(tables, dir, srcType, srcPort, t.type, t.port);
    if (count > 0) scored.push({ nodeId: t.nodeId, port: t.port, type: t.type, count });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.count - a.count || a.nodeId.localeCompare(b.nodeId) || a.port.localeCompare(b.port));
  const top = scored[0];
  const rival = scored[1];
  if (top.count < MIN_PAIR) return null;
  if (rival && !leads(top.count, rival.count)) return null;
  return { nodeId: top.nodeId, port: top.port, type: top.type, count: top.count };
}

/**
 * Rank live dangling pairs. Used by the check toys; the editor does not draw these.
 * @param {PortSuggestTables} tables
 * @param {{ nodes?: any[], links?: any[], selectedId?: string|null }} graph
 * @param {{ k?: number, selectedOnly?: boolean }} [opts]
 */
export function recommendPortSuggest(tables, graph = {}, opts = {}) {
  const k = opts.k ?? 3;
  const nodes = graph.nodes || [];
  if (nodes.length < 2) return [];

  const { outs, ins } = danglingPorts(tables, graph);
  if (!outs.length) return [];

  let candidateOuts = outs;
  if (opts.selectedOnly && graph.selectedId) {
    const sel = outs.filter((o) => o.nodeId === graph.selectedId);
    if (sel.length) candidateOuts = sel;
  }

  /** @type {Array<any>} */
  const scored = [];
  const seen = new Set();

  for (const src of candidateOuts) {
    const srcKey = `${src.type}|${src.port}`;
    const targets = tables.topTargets?.[srcKey] || {};
    const rankedTargets = Object.entries(targets).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );

    for (const [dstKey, count] of rankedTargets) {
      const [toType, toPort] = dstKey.split("|");
      if (!toType || !toPort) continue;
      const matches = ins.filter(
        (i) => i.type === toType && i.port === toPort && i.nodeId !== src.nodeId
      );
      for (const m of matches) {
        const id = `${src.nodeId}|${src.port}->${m.nodeId}|${m.port}`;
        if (seen.has(id)) continue;
        seen.add(id);
        scored.push({
          from: { nodeId: src.nodeId, port: src.port },
          to: { nodeId: m.nodeId, port: m.port },
          toType,
          toPort,
          score: count,
          label: labelWire(src.type, src.port, toType, toPort),
          source: "port-suggest",
        });
      }
    }

    if (!rankedTargets.length) continue;
    const [bestKey, bestCount] = rankedTargets[0];
    const [toType, toPort] = bestKey.split("|");
    const already = scored.some(
      (r) =>
        r.from.nodeId === src.nodeId &&
        r.from.port === src.port &&
        r.toType === toType &&
        r.toPort === toPort
    );
    if (!already && toType && toPort) {
      scored.push({
        from: { nodeId: src.nodeId, port: src.port },
        to: null,
        toType,
        toPort,
        score: bestCount * 0.25,
        label: labelWire(src.type, src.port, toType, toPort),
        source: "port-suggest-hint",
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return scored.slice(0, k);
}

/** Rebuild tables from gallery graph.json list. */
export function buildPortSuggestTables(graphs) {
  const typeToType = {};
  const portPair = {};
  const topTargets = {};
  const portsSeen = {};

  function ensure(t) {
    if (!portsSeen[t]) portsSeen[t] = { inputs: new Set(), outputs: new Set() };
  }

  let edgeCount = 0;
  for (const g of graphs) {
    const nodes = Object.fromEntries((g.nodes || []).map((n) => [n.id, n]));
    for (const L of g.links || g.edges || []) {
      const fn = L.from?.node,
        fp = L.from?.port;
      const tn = L.to?.node,
        tp = L.to?.port;
      if (!fn || !tn || !nodes[fn] || !nodes[tn] || !fp || !tp) continue;
      const st = nodes[fn].type,
        dt = nodes[tn].type;
      if (!st || !dt || st === "comment" || dt === "comment") continue;
      edgeCount++;
      typeToType[`${st}→${dt}`] = (typeToType[`${st}→${dt}`] || 0) + 1;
      portPair[`${st}.${fp}→${dt}.${tp}`] = (portPair[`${st}.${fp}→${dt}.${tp}`] || 0) + 1;
      const sk = `${st}|${fp}`,
        dk = `${dt}|${tp}`;
      if (!topTargets[sk]) topTargets[sk] = {};
      topTargets[sk][dk] = (topTargets[sk][dk] || 0) + 1;
      ensure(st);
      ensure(dt);
      portsSeen[st].outputs.add(fp);
      portsSeen[dt].inputs.add(tp);
    }
  }

  const SEED = {
    text: { inputs: [], outputs: ["text"] },
    llm: { inputs: ["prompt"], outputs: ["text"] },
    image: { inputs: ["prompt"], outputs: ["image"] },
    join: { inputs: ["a", "b"], outputs: ["text"] },
  };
  for (const [t, p] of Object.entries(SEED)) {
    ensure(t);
    for (const i of p.inputs) portsSeen[t].inputs.add(i);
    for (const o of p.outputs) portsSeen[t].outputs.add(o);
  }

  const portCatalog = {};
  for (const [t, p] of Object.entries(portsSeen)) {
    portCatalog[t] = { inputs: [...p.inputs].sort(), outputs: [...p.outputs].sort() };
  }

  return {
    schemaVersion: 1,
    source: "examples-gallery",
    graphCount: graphs.length,
    edgeCount,
    typeToType,
    portPair,
    topTargets,
    portCatalog,
  };
}
