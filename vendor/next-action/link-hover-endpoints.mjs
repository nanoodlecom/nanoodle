/**
 * Product · 42 — link-hover endpoint lift (pure helpers).
 *
 * While hovering a wire path, resolve its from/to ports so the editor can
 * soft-lift them inside existing port chrome (`.compatible` / soft pulse).
 * v1 lifts both ends of the hovered wire. Optional multi-fan prior ranking
 * is reserved for a later polish (prefer high-prior gallery ends when a port
 * fans out) — keep v1 simple.
 *
 * Quiet (null / false) when the link is missing so the editor stays quiet.
 * Never creates or removes a wire. Distinct from · 41 (hover-port peer dim)
 * and · 21 (wire-drag graduated rings): this is wire-path hover only.
 *
 * No tip panel / no ?product= twin.
 */

/**
 * @typedef {{ nodeId: string, port: string, dir: "out"|"in" }} LinkEnd
 * @typedef {{ from: LinkEnd, to: LinkEnd }} LinkEnds
 * @typedef {{ ends: LinkEnd[], mode: "both" }} LinkHoverPlan
 */

/**
 * Resolve from/to endpoint descriptors from a graph link.
 * @param {{ id?: string, from?: { node?: string, port?: string }, to?: { node?: string, port?: string } } | null | undefined} link
 * @returns {LinkEnds | null}
 */
export function resolveLinkEndpoints(link) {
  if (!link || !link.from || !link.to) return null;
  const fromNode = link.from.node;
  const fromPort = link.from.port;
  const toNode = link.to.node;
  const toPort = link.to.port;
  if (!fromNode || !fromPort || !toNode || !toPort) return null;
  return {
    from: { nodeId: String(fromNode), port: String(fromPort), dir: "out" },
    to: { nodeId: String(toNode), port: String(toPort), dir: "in" },
  };
}

/**
 * Find a link by id in a links array.
 * @param {Array<{ id?: string }>|null|undefined} links
 * @param {string|number|null|undefined} linkId
 */
export function findLink(links, linkId) {
  if (linkId == null || linkId === "") return null;
  const id = String(linkId);
  if (!Array.isArray(links)) return null;
  return links.find((l) => l && String(l.id) === id) || null;
}

/**
 * @param {Array|null|undefined} links
 * @param {string|number|null|undefined} linkId
 * @returns {LinkEnds | null}
 */
export function endpointsForLinkId(links, linkId) {
  return resolveLinkEndpoints(findLink(links, linkId));
}

/**
 * CSS classes applied to each lifted endpoint (existing port chrome).
 * @returns {string[]}
 */
export function liftClasses() {
  return ["compatible", "na-link-hover-end"];
}

/**
 * Plan which endpoints to soft-lift for a hovered wire.
 * v1: always both ends. `tables` reserved for optional multi-fan prior polish.
 *
 * @param {unknown} [tables] - gallery port priors (unused in v1)
 * @param {Array|null|undefined} links
 * @param {string|number|null|undefined} linkId
 * @returns {LinkHoverPlan | null}
 */
export function planLinkHoverLift(tables, links, linkId) {
  void tables;
  const ends = endpointsForLinkId(links, linkId);
  if (!ends) return null;
  return {
    ends: [ends.from, ends.to],
    mode: "both",
  };
}

/**
 * Runtime gate shared with the editor apply path.
 * @param {{
 *   engineOff?: boolean,
 *   reducedMotion?: boolean,
 *   wireDragging?: boolean,
 *   linkId?: string|number|null,
 * }} [opts]
 */
export function shouldApplyLinkHover(opts = {}) {
  if (opts.engineOff) return false;
  if (opts.reducedMotion) return false;
  if (opts.wireDragging) return false;
  if (opts.linkId == null || opts.linkId === "") return false;
  return true;
}
