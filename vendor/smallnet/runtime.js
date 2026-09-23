/** @typedef {"linear"|"relu"|"tanh"|"sigmoid"|"softmax"} Act */

/**
 * @typedef {{ type: "linear", in: number, out: number, activation?: Act }} LinearLayer
 * @typedef {{
 *   id: string,
 *   version?: string,
 *   format: "smallnet-mlp-v1",
 *   inputSize: number,
 *   outputSize: number,
 *   layers: LinearLayer[],
 *   weightsUrl?: string | null,
 * }} SmallnetManifest
 */

const MAGIC = 0x314d4e53; // 'SNM1' LE

/** @param {Act|undefined} act @param {Float32Array} x */
export function activate(act, x) {
  const a = act || "linear";
  if (a === "linear") return x;
  const out = new Float32Array(x.length);
  if (a === "relu") {
    for (let i = 0; i < x.length; i++) out[i] = x[i] > 0 ? x[i] : 0;
    return out;
  }
  if (a === "tanh") {
    for (let i = 0; i < x.length; i++) out[i] = Math.tanh(x[i]);
    return out;
  }
  if (a === "sigmoid") {
    for (let i = 0; i < x.length; i++) out[i] = 1 / (1 + Math.exp(-x[i]));
    return out;
  }
  if (a === "softmax") {
    let m = -Infinity;
    for (let i = 0; i < x.length; i++) if (x[i] > m) m = x[i];
    let s = 0;
    for (let i = 0; i < x.length; i++) {
      out[i] = Math.exp(x[i] - m);
      s += out[i];
    }
    for (let i = 0; i < x.length; i++) out[i] /= s || 1;
    return out;
  }
  throw new Error(`smallnet: unknown activation ${a}`);
}

/** Validate manifest shape; throws on bad input. */
export function assertManifest(m) {
  if (!m || typeof m !== "object") throw new Error("smallnet: manifest required");
  if (!m.id || typeof m.id !== "string") throw new Error("smallnet: manifest.id required");
  if (m.format !== "smallnet-mlp-v1") throw new Error(`smallnet: unsupported format ${m.format}`);
  if (!Number.isInteger(m.inputSize) || m.inputSize < 1) throw new Error("smallnet: bad inputSize");
  if (!Number.isInteger(m.outputSize) || m.outputSize < 1) throw new Error("smallnet: bad outputSize");
  if (!Array.isArray(m.layers) || !m.layers.length) throw new Error("smallnet: layers required");
  let prev = m.inputSize;
  for (let i = 0; i < m.layers.length; i++) {
    const L = m.layers[i];
    if (L.type !== "linear") throw new Error(`smallnet: layer ${i} must be linear`);
    if (L.in !== prev) throw new Error(`smallnet: layer ${i} in=${L.in} != prev out ${prev}`);
    if (!Number.isInteger(L.out) || L.out < 1) throw new Error(`smallnet: layer ${i} bad out`);
    prev = L.out;
  }
  if (prev !== m.outputSize) throw new Error("smallnet: last layer out != outputSize");
}

/**
 * Pack layer weight arrays into an ArrayBuffer (SNM1).
 * @param {SmallnetManifest} manifest
 * @param {{ W: Float32Array, b: Float32Array }[]} layerParams
 */
export function packWeights(manifest, layerParams) {
  assertManifest(manifest);
  if (layerParams.length !== manifest.layers.length) {
    throw new Error("smallnet: layerParams length mismatch");
  }
  let nFloats = 0;
  for (let i = 0; i < manifest.layers.length; i++) {
    const L = manifest.layers[i];
    const needW = L.out * L.in;
    const needB = L.out;
    if (layerParams[i].W.length !== needW || layerParams[i].b.length !== needB) {
      throw new Error(`smallnet: layer ${i} weight shape mismatch`);
    }
    nFloats += needW + needB;
  }
  const buf = new ArrayBuffer(8 + nFloats * 4);
  const view = new DataView(buf);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 1, true);
  let o = 8;
  for (const { W, b } of layerParams) {
    for (let i = 0; i < W.length; i++, o += 4) view.setFloat32(o, W[i], true);
    for (let i = 0; i < b.length; i++, o += 4) view.setFloat32(o, b[i], true);
  }
  return buf;
}

/**
 * @param {SmallnetManifest} manifest
 * @param {ArrayBuffer} buf
 * @returns {{ W: Float32Array, b: Float32Array }[]}
 */
export function unpackWeights(manifest, buf) {
  assertManifest(manifest);
  const view = new DataView(buf);
  if (view.byteLength < 8) throw new Error("smallnet: weights too short");
  if (view.getUint32(0, true) !== MAGIC) throw new Error("smallnet: bad magic");
  if (view.getUint32(4, true) !== 1) throw new Error("smallnet: bad weights version");
  let o = 8;
  const out = [];
  for (let i = 0; i < manifest.layers.length; i++) {
    const L = manifest.layers[i];
    const nW = L.out * L.in;
    const nB = L.out;
    const need = (nW + nB) * 4;
    if (o + need > view.byteLength) throw new Error(`smallnet: truncated weights at layer ${i}`);
    const W = new Float32Array(nW);
    const b = new Float32Array(nB);
    for (let j = 0; j < nW; j++, o += 4) W[j] = view.getFloat32(o, true);
    for (let j = 0; j < nB; j++, o += 4) b[j] = view.getFloat32(o, true);
    out.push({ W, b });
  }
  if (o !== view.byteLength) throw new Error("smallnet: trailing bytes in weights");
  return out;
}

/**
 * @param {SmallnetManifest} manifest
 * @param {{ W: Float32Array, b: Float32Array }[]} params
 * @param {Float32Array} input
 */
export function forward(manifest, params, input) {
  assertManifest(manifest);
  if (!(input instanceof Float32Array) || input.length !== manifest.inputSize) {
    throw new Error(`smallnet: input length ${input && input.length} != ${manifest.inputSize}`);
  }
  let x = input;
  for (let li = 0; li < manifest.layers.length; li++) {
    const L = manifest.layers[li];
    const { W, b } = params[li];
    const y = new Float32Array(L.out);
    for (let o = 0; o < L.out; o++) {
      let s = b[o];
      const row = o * L.in;
      for (let i = 0; i < L.in; i++) s += W[row + i] * x[i];
      y[o] = s;
    }
    x = activate(L.activation, y);
  }
  return x;
}

/**
 * @param {SmallnetManifest} manifest
 * @param {ArrayBuffer} weightBuf
 */
export function createSession(manifest, weightBuf) {
  const params = unpackWeights(manifest, weightBuf);
  return {
    manifest,
    /** @param {Float32Array} input */
    run(input) {
      return forward(manifest, params, input);
    },
  };
}
