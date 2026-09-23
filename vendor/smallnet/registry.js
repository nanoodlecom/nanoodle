import { assertManifest, createSession } from "./runtime.js";

export class ModelNotAvailableError extends Error {
  /** @param {string} id @param {string} reason */
  constructor(id, reason) {
    super(`smallnet: model "${id}" not available — ${reason}`);
    this.name = "ModelNotAvailableError";
    this.modelId = id;
    this.reason = reason;
  }
}

/**
 * Registry of manifests. Weights are loaded on demand from same-origin URLs
 * (or installed inline for tests). Shipping this module does **not** ship models.
 */
export class SmallnetRegistry {
  constructor() {
    /** @type {Map<string, { manifest: import("./runtime.js").SmallnetManifest, session: ReturnType<typeof createSession> | null, status: "registered" | "ready" | "missing" }>} */
    this._models = new Map();
  }

  /** @param {import("./runtime.js").SmallnetManifest} manifest */
  register(manifest) {
    assertManifest(manifest);
    if (this._models.has(manifest.id)) {
      throw new Error(`smallnet: model "${manifest.id}" already registered`);
    }
    this._models.set(manifest.id, {
      manifest: Object.freeze({ ...manifest, layers: manifest.layers.map((l) => Object.freeze({ ...l })) }),
      session: null,
      status: "registered",
    });
    return this;
  }

  /** @param {string} id */
  has(id) {
    return this._models.has(id);
  }

  /** @param {string} id */
  status(id) {
    const e = this._models.get(id);
    if (!e) return "unknown";
    if (e.session) return "ready";
    return e.status;
  }

  list() {
    return [...this._models.keys()];
  }

  /**
   * Install weights from an ArrayBuffer (tests / local tooling).
   * @param {string} id
   * @param {ArrayBuffer} buf
   */
  installWeights(id, buf) {
    const e = this._models.get(id);
    if (!e) throw new Error(`smallnet: unknown model "${id}"`);
    e.session = createSession(e.manifest, buf);
    e.status = "ready";
    return this;
  }

  /**
   * Fetch weightsUrl if set. Leaves status "missing" when url is null/404.
   * @param {string} id
   * @param {{ fetch?: typeof fetch }} [opts]
   */
  async load(id, opts = {}) {
    const e = this._models.get(id);
    if (!e) throw new Error(`smallnet: unknown model "${id}"`);
    if (e.session) return e.session;
    const url = e.manifest.weightsUrl;
    if (!url) {
      e.status = "missing";
      throw new ModelNotAvailableError(id, "no weightsUrl in manifest (no models shipped yet)");
    }
    const fetchFn = opts.fetch || globalThis.fetch;
    if (!fetchFn) throw new ModelNotAvailableError(id, "fetch unavailable");
    const res = await fetchFn(url);
    if (!res.ok) {
      e.status = "missing";
      throw new ModelNotAvailableError(id, `GET ${url} → ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    e.session = createSession(e.manifest, buf);
    e.status = "ready";
    return e.session;
  }

  /**
   * @param {string} id
   * @param {Float32Array} input
   */
  run(id, input) {
    const e = this._models.get(id);
    if (!e) throw new Error(`smallnet: unknown model "${id}"`);
    if (!e.session) {
      throw new ModelNotAvailableError(
        id,
        e.status === "missing"
          ? "weights missing — not distributed in this build"
          : "call load() or installWeights() first",
      );
    }
    return e.session.run(input);
  }
}
