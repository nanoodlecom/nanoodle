/**
 * Product · 46 — aborted-wire resume pulse (pure helpers).
 *
 * After the user cancels a wire drag (mouseup miss / empty / Esc), decide
 * whether the origin port should soft-pulse so resume is obvious. Reuses
 * gallery outbound/inbound mass (#621). Flat mass stays quiet when priors
 * exist; when tables are missing, callers may still pulse the origin.
 *
 * Distinct from · 22 / · 29 idle nudges, · 33 post-wire continue, · 43
 * post-add, · 44 post-delete — trigger is wire-drag abort only.
 */

import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "./port-suggest.mjs";

/**
 * Max gallery outbound mass for an out port key `type|port`.
 * @param {import("./port-suggest.mjs").PortSuggestTables|null|undefined} tables
 * @param {string} type
 * @param {string} port
 */
export function outMass(tables, type, port) {
  if (!tables?.topTargets || !type || !port) return 0;
  const targets = tables.topTargets[`${type}|${port}`] || {};
  let mass = 0;
  for (const v of Object.values(targets)) {
    const n = Number(v) || 0;
    if (n > mass) mass = n;
  }
  return mass;
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
 * Gallery mass for one origin port (out → outbound mass, in → inbound mass).
 * @param {import("./port-suggest.mjs").PortSuggestTables|null|undefined} tables
 * @param {{ type?: string, port?: string, dir?: string }} origin
 */
export function originPortMass(tables, origin = {}) {
  const type = origin.type || "";
  const port = origin.port || "";
  const dir = origin.dir === "in" ? "in" : "out";
  if (!type || !port) return 0;
  return dir === "in" ? inMass(tables, type, port) : outMass(tables, type, port);
}

/**
 * Decide whether the aborted origin port should pulse.
 *
 * When `tables` has priors: require mass ≥ MIN_PAIR (quiet when flat).
 * When `tables` is missing: return the origin with count 0 so the editor can
 * still pulse (spec: if masses are unreadable, pulse on any real cancel).
 *
 * @param {import("./port-suggest.mjs").PortSuggestTables|null|undefined} tables
 * @param {{ nodeId?: string, port?: string, type?: string, dir?: string }} origin
 * @returns {{ nodeId: string, port: string, type: string, dir: "out"|"in", count: number } | null}
 */
export function pickAbortedWireResumePort(tables, origin = {}) {
  const nodeId = origin.nodeId || origin.id || null;
  const port = origin.port || null;
  const type = origin.type || null;
  const dir = origin.dir === "in" ? "in" : origin.dir === "out" ? "out" : null;
  if (!nodeId || !port || !type || !dir) return null;

  if (!tables?.topTargets) {
    return { nodeId, port, type, dir, count: 0 };
  }

  const count = originPortMass(tables, { type, port, dir });
  if (count < MIN_PAIR) return null;

  return { nodeId, port, type, dir, count };
}

export { MIN_PAIR, MIN_LEAD, MIN_SHARE };
