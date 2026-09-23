/**
 * Product · 10 — browser load path for next-action-v1.
 * 1) Try smallnet catalog bootstrap + load('next-action-v1') from weightsUrl
 * 2) Fall back to packing fixtures/smoke-weights.json (· 1 behavior)
 * Status: "bin" | "fixture" | "missing"
 */
import { bootstrapSmallnet, packWeights, createSession, ModelNotAvailableError } from "../smallnet/index.js";

const MODEL_ID = "next-action-v1";
const FIXTURE_REL = "fixtures/smoke-weights.json";

/**
 * @param {{
 *   fetch?: typeof fetch,
 *   catalogUrl?: string,
 *   fixtureUrl?: string | URL,
 *   packWeights?: typeof packWeights,
 *   createSession?: typeof createSession,
 *   bootstrapSmallnet?: typeof bootstrapSmallnet,
 * }} [opts]
 * @returns {Promise<{
 *   status: "bin" | "fixture" | "missing",
 *   session: { run: (x: Float32Array) => Float32Array, manifest?: object } | null,
 *   registry: import("../smallnet/registry.js").SmallnetRegistry | null,
 *   error?: string,
 * }>}
 */
export async function loadNextActionExport(opts = {}) {
  const fetchFn = opts.fetch || globalThis.fetch;
  const boot = opts.bootstrapSmallnet || bootstrapSmallnet;
  const pack = opts.packWeights || packWeights;
  const create = opts.createSession || createSession;
  const fixtureUrl =
    opts.fixtureUrl ||
    new URL(FIXTURE_REL, import.meta.url);

  let registry = null;
  try {
    registry = await boot({
      fetch: fetchFn,
      catalogUrl: opts.catalogUrl,
    });
  } catch (e) {
    registry = null;
  }

  if (registry && registry.has(MODEL_ID)) {
    try {
      const session = await registry.load(MODEL_ID, { fetch: fetchFn });
      return { status: "bin", session, registry };
    } catch (e) {
      if (!(e instanceof ModelNotAvailableError)) {
        // Unexpected — still try fixture
        console.warn("[next-action] catalog load failed", e);
      }
    }
  }

  // Fixture fallback (CI / no local .bin)
  try {
    if (!fetchFn) throw new Error("fetch unavailable");
    const res = await fetchFn(fixtureUrl);
    if (!res.ok) throw new Error(`GET fixture → ${res.status}`);
    const fix = await res.json();
    const layers = (fix.layers || []).map((L) => ({
      W: Float32Array.from(L.W),
      b: Float32Array.from(L.b),
    }));
    const manifest = { ...fix.manifest, weightsUrl: null };
    const buf = pack(manifest, layers);
    const session = create(manifest, buf);
    // Optional: install into registry for status/tools if registered
    if (registry && registry.has(MODEL_ID)) {
      try {
        registry.installWeights(MODEL_ID, buf);
      } catch (_) {}
    }
    return { status: "fixture", session, registry };
  } catch (e) {
    return {
      status: "missing",
      session: null,
      registry,
      error: e && e.message ? e.message : String(e),
    };
  }
}

export { MODEL_ID, FIXTURE_REL };
