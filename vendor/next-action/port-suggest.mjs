/**
 * Product · 7 — connection / port suggest (ghost-wire twin of · 3).
 * Frequency tables from Examples gallery edges; no learned weights.
 */

/**
 * @typedef {{
 *   typeToType: Record<string, number>,
 *   portPair: Record<string, number>,
 *   topTargets: Record<string, Record<string, number>>,
 *   portCatalog: Record<string, { inputs: string[], outputs: string[] }>,
 * }} PortSuggestTables
 */

/** Ports for a node type from baked catalog (inputs / outputs). */
export function portsOf(tables, type) {
  const c = tables?.portCatalog?.[type];
  return {
    inputs: c?.inputs ? [...c.inputs] : [],
    outputs: c?.outputs ? [...c.outputs] : [],
  };
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

/**
 * Rank ghost-wire suggestions for dangling outs (prefer existing dangling-in targets).
 * v0: ghost-wire between existing nodes once ≥2 nodes and a dangling out.
 *
 * @param {PortSuggestTables} tables
 * @param {{ nodes?: any[], links?: any[], selectedId?: string|null }} graph
 * @param {{ k?: number, selectedOnly?: boolean }} [opts]
 * @returns {Array<{
 *   from: { nodeId: string, port: string },
 *   to: { nodeId: string, port: string } | null,
 *   toType: string,
 *   toPort: string,
 *   score: number,
 *   label: string,
 *   source: string
 * }>}
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

    // Prefer live dangling-in that matches a frequent (dstType, dstPort)
    for (const [dstKey, count] of rankedTargets) {
      const [toType, toPort] = dstKey.split("|");
      if (!toType || !toPort) continue;
      const matches = ins.filter(
        (i) =>
          i.type === toType &&
          i.port === toPort &&
          i.nodeId !== src.nodeId
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

    // Fallback: suggest best (toType, toPort) even if no live dangling-in yet
    // (UI may still show tip; apply only wires when `to` is set)
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

/** Rebuild tables from gallery graph.json list (Node bake helper). */
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
      if (!st || !dt) continue;
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
    product: 7,
    graphCount: graphs.length,
    edgeCount,
    typeToType,
    portPair,
    topTargets,
    portCatalog,
  };
}
