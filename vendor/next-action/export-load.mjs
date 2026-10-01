/**
 * Load next-action-v1 for the editor.
 * Try the smallnet catalog when a weightsUrl is registered, then fall back
 * to fixtures/smoke-weights.json. The shipped catalog has no models, so the
 * fixture is the path that actually runs. Status: "bin" | "fixture" | "missing".
 */
import { bootstrapSmallnet, packWeights, createSession, ModelNotAvailableError } from "../smallnet/index.js";

const MODEL_ID = "next-action-v1";
const FIXTURE_REL = "fixtures/smoke-weights.json";

/**
 * @param {{
 *   fetch?: typeof fetch,
 *   catalogUrl?: string,
 *   fixtureUrl?: string | URL,
 * }} [opts]
 */
export async function loadNextActionExport(opts = {}) {
  const fetchFn = opts.fetch || globalThis.fetch;
  const fixtureUrl = opts.fixtureUrl || new URL(FIXTURE_REL, import.meta.url);

  let registry = null;
  try {
    registry = await bootstrapSmallnet({
      fetch: fetchFn,
      catalogUrl: opts.catalogUrl,
    });
  } catch (_) {
    registry = null;
  }

  if (registry && registry.has(MODEL_ID)) {
    try {
      const session = await registry.load(MODEL_ID, { fetch: fetchFn });
      return { status: "bin", session, registry };
    } catch (e) {
      if (!(e instanceof ModelNotAvailableError)) {
        console.warn("[next-action] catalog load failed", e);
      }
    }
  }

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
    const session = createSession(manifest, packWeights(manifest, layers));
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
