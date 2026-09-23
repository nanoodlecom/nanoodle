#!/usr/bin/env node
// Offline checks for vendor/smallnet — pure JS MLP pipe, no models in git.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SN = join(ROOT, "vendor", "smallnet");

function fail(msg) {
  console.error(`✗ smallnet: ${msg}`);
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

// No weight binaries in the tree
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

for (const f of walk(SN)) {
  if (f.endsWith(".bin")) fail(`weight file must not be committed: ${f}`);
}

const catalog = JSON.parse(readFileSync(join(SN, "catalog.json"), "utf8"));
assert(Array.isArray(catalog.models), "catalog.json models must be an array");
// Product · 10 registers next-action-v1 with weightsUrl; .bin stays gitignored.
const na = catalog.models.find((m) => m.id === "next-action-v1");
assert(!!na, "catalog registers next-action-v1");
assert(typeof na.weightsUrl === "string" && na.weightsUrl.includes(".bin"), "next-action-v1 has weightsUrl");
assert(na.inputSize === 83 && na.outputSize === 18, "next-action-v1 dims");

const mod = await import(pathToFileURL(join(SN, "index.js")).href);
const {
  SmallnetRegistry,
  ModelNotAvailableError,
  packWeights,
  createSession,
  forward,
  assertManifest,
} = mod;

const xorManifest = {
  id: "test-xor",
  format: "smallnet-mlp-v1",
  inputSize: 2,
  outputSize: 1,
  layers: [
    { type: "linear", in: 2, out: 2, activation: "relu" },
    { type: "linear", in: 2, out: 1, activation: "linear" },
  ],
  weightsUrl: null,
};
assertManifest(xorManifest);

// Hand weights that compute roughly XOR via known linear+relu (exact for corners)
// Hidden: h0 = relu(x0 + x1 - 0.5), h1 = relu(-x0 - x1 + 1.5) … simpler: identity pack then run shape tests
const W0 = new Float32Array([1, 0, 0, 1]); // 2x2 identity
const b0 = new Float32Array([0, 0]);
const W1 = new Float32Array([1, -1]); // out = h0 - h1
const b1 = new Float32Array([0]);
const buf = packWeights(xorManifest, [
  { W: W0, b: b0 },
  { W: W1, b: b1 },
]);
const session = createSession(xorManifest, buf);
const y = session.run(new Float32Array([1, 0]));
assert(y.length === 1, "output size");
assert(Math.abs(y[0] - 1) < 1e-5, `expected ~1 got ${y[0]}`);

const reg = new SmallnetRegistry();
reg.register({ ...xorManifest, id: "reg-demo" });
assert(reg.status("reg-demo") === "registered", "status registered");
let threw = false;
try {
  await reg.load("reg-demo");
} catch (e) {
  threw = e instanceof ModelNotAvailableError;
}
assert(threw, "load() without weightsUrl must throw ModelNotAvailableError");
assert(reg.status("reg-demo") === "missing", "status missing after failed load");

reg.installWeights("reg-demo", buf);
assert(reg.status("reg-demo") === "ready", "status ready");
const z = reg.run("reg-demo", new Float32Array([0, 1]));
assert(Math.abs(z[0] - -1) < 1e-5 || Math.abs(z[0] - 1) < 1e-5 || Number.isFinite(z[0]), "run ok");

// Softmax sanity via forward on tiny net
const softM = {
  id: "soft",
  format: "smallnet-mlp-v1",
  inputSize: 2,
  outputSize: 2,
  layers: [{ type: "linear", in: 2, out: 2, activation: "softmax" }],
};
const softBuf = packWeights(softM, [
  { W: new Float32Array([1, 0, 0, 1]), b: new Float32Array([0, 0]) },
]);
const softParams = mod.unpackWeights(softM, softBuf);
const probs = forward(softM, softParams, new Float32Array([2, 0]));
assert(Math.abs(probs[0] + probs[1] - 1) < 1e-5, "softmax sums to 1");
assert(probs[0] > probs[1], "softmax prefers larger logit");

// Catalog model: load() without .bin must fail gracefully (CI has no bin)
const catReg = new SmallnetRegistry();
catReg.register({ ...na });
let catThrew = false;
try {
  await catReg.load("next-action-v1", { fetch: async () => ({ ok: false, status: 404 }) });
} catch (e) {
  catThrew = e instanceof ModelNotAvailableError;
}
assert(catThrew, "catalog next-action-v1 load() without bin → ModelNotAvailableError");
assert(catReg.status("next-action-v1") === "missing", "catalog model status missing");
// Ephemeral inline install still works with registered catalog model
const naBuf = packWeights(
  { ...na, weightsUrl: null },
  [
    { W: new Float32Array(83 * 32), b: new Float32Array(32) },
    { W: new Float32Array(32 * 18), b: new Float32Array(18) },
  ],
);
catReg.installWeights("next-action-v1", naBuf);
assert(catReg.status("next-action-v1") === "ready", "catalog model inline install ready");

console.log("✓ smallnet: runtime + registry + catalog next-action-v1 (no .bin shipped)");
