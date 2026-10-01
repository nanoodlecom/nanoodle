/**
 * When a newly added node overlaps its neighbours, slide them apart.
 * Neighbours move first (a short tidy). A residual stack is finished by a
 * clamped multi-pass nudge that may also move the new node.
 * No overlap → no positions. Never creates an undo step of its own.
 */
import { proposeTidyDeltas, applyDeltasAbsolute as applyTidy } from "./auto-tidy.mjs";
import { countOverlaps, planCollisionPasses } from "./collision-nudge.mjs";

/**
 * @param {{ nodes?: Array<{id:string,x?:number,y?:number,type?:string,w?:number,h?:number}> }} graph
 * @param {{ addedId?: string, gap?: number, maxPasses?: number, maxNudge?: number }} [opts]
 * @returns {{ positions: {id:string,x:number,y:number}[], passes: number, cleared: boolean, movedIds: string[] }}
 */
export function planDeoverlap(graph, opts = {}) {
  if (countOverlaps(graph, opts) === 0) {
    return { positions: [], passes: 0, cleared: true, movedIds: [] };
  }
  const nodes = (graph.nodes || []).map((n) => ({ ...n }));
  /** @type {Map<string, {id:string,x:number,y:number}>} */
  const moved = new Map();
  if (opts.addedId) {
    const deltas = proposeTidyDeltas({ nodes }, opts.addedId);
    const abs = applyTidy({ nodes }, deltas);
    const byId = new Map(nodes.map((n) => [String(n.id), n]));
    for (const p of abs) {
      const n = byId.get(String(p.id));
      if (!n) continue;
      n.x = p.x;
      n.y = p.y;
      moved.set(String(p.id), { id: String(p.id), x: p.x, y: p.y });
    }
  }
  const collision = planCollisionPasses({ nodes }, opts);
  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  for (const p of collision.positions) {
    const n = byId.get(String(p.id));
    if (n) {
      n.x = p.x;
      n.y = p.y;
    }
    moved.set(String(p.id), { id: String(p.id), x: p.x, y: p.y });
  }
  const positions = [...moved.values()];
  return {
    positions,
    passes: collision.passes,
    cleared: countOverlaps({ nodes }, opts) === 0,
    movedIds: positions.map((p) => p.id),
  };
}

export { countOverlaps, proposeTidyDeltas, planCollisionPasses };
