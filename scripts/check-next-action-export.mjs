#!/usr/bin/env node
/**
 * Product · 10 toys — develop → browser export recipe.
 * Roundtrip pack/unpack, catalog registration, fixture fallback, graceful missing bin.
 * CI must pass WITHOUT a committed .bin.
 */
import { readFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SN = join(ROOT, "vendor", "smallnet");
const NA = join(ROOT, "vendor", "next-action");
const FIXTURE = join(NA, "fixtures", "smoke-weights.json");
const EXPORT_PY = join(ROOT, "scripts", "export-smallnet-weights.py");

let passed = 0;
let failed = 0;

function ok(msg) {
  console.log(`✓ ${msg}`);
  passed++;
}
function fail(msg) {
  console.error(`✗ ${msg}`);
  failed++;
}
function assert(cond, msg) {
  if (cond) ok(msg);
  else fail(msg);
}

const sn = await import(pathToFileURL(join(SN, "index.js")).href);
const {
  SmallnetRegistry,
  ModelNotAvailableError,
  packWeights,
  unpackWeights,
  createSession,
  assertManifest,
} = sn;

// --- 1) Catalog lists next-action-v1 with weightsUrl ---
const catalog = JSON.parse(readFileSync(join(SN, "catalog.json"), "utf8"));
const model = (catalog.models || []).find((m) => m.id === "next-action-v1");
assert(!!model, "catalog lists next-action-v1");
assert(model?.format === "smallnet-mlp-v1", "catalog format smallnet-mlp-v1");
assert(model?.inputSize === 83 && model?.outputSize === 18, "catalog dims 83→18");
assert(
  Array.isArray(model?.layers) &&
    model.layers[0]?.out === 32 &&
    model.layers[1]?.activation === "softmax",
  "catalog layers 83→32 relu → 18 softmax",
);
assert(
  typeof model?.weightsUrl === "string" &&
    model.weightsUrl.includes("next-action-v1.bin"),
  "catalog weightsUrl points at next-action-v1.bin",
);

// No .bin committed under vendor/next-action or vendor/smallnet
{
  const bins = [];
  function walk(d) {
    let names;
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      const pth = join(d, name);
      const st = statSync(pth);
      if (st.isDirectory()) walk(pth);
      else if (pth.endsWith(".bin")) bins.push(pth);
    }
  }
  walk(SN);
  walk(NA);
  assert(bins.length === 0, `no .bin committed under vendor (found ${bins.length})`);
}

// --- 2) Roundtrip pack/unpack via smoke fixture ---
assert(existsSync(FIXTURE), "smoke-weights.json fixture present");
const smoke = JSON.parse(readFileSync(FIXTURE, "utf8"));
const manifest = { ...smoke.manifest, weightsUrl: null };
assertManifest(manifest);
const layerParams = smoke.layers.map((L) => ({
  W: Float32Array.from(L.W),
  b: Float32Array.from(L.b),
}));
const buf = packWeights(manifest, layerParams);
const unpacked = unpackWeights(manifest, buf);
let maxDiff = 0;
for (let i = 0; i < layerParams.length; i++) {
  for (let j = 0; j < layerParams[i].W.length; j++) {
    maxDiff = Math.max(maxDiff, Math.abs(layerParams[i].W[j] - unpacked[i].W[j]));
  }
  for (let j = 0; j < layerParams[i].b.length; j++) {
    maxDiff = Math.max(maxDiff, Math.abs(layerParams[i].b[j] - unpacked[i].b[j]));
  }
}
assert(maxDiff < 1e-5, `JS pack/unpack roundtrip (maxDiff=${maxDiff})`);

// --- 3) Python export recipe roundtrip ---
const tmpDir = join(ROOT, ".tmp-export-check");
mkdirSync(tmpDir, { recursive: true });
const tmpBin = join(tmpDir, "next-action-v1.bin");
const tmpMan = join(tmpDir, "manifest.json");
const py = spawnSync(
  "python3",
  [
    EXPORT_PY,
    "--fixture",
    FIXTURE,
    "--out-bin",
    tmpBin,
    "--out-manifest",
    tmpMan,
    "--roundtrip",
  ],
  { encoding: "utf8" },
);
assert(py.status === 0, `export-smallnet-weights.py exit 0 (got ${py.status})`);
if (py.status !== 0) {
  console.error(py.stdout);
  console.error(py.stderr);
}
assert(existsSync(tmpBin) && existsSync(tmpMan), "python wrote bin + manifest");
const pyBlob = readFileSync(tmpBin);
assert(pyBlob.byteLength === buf.byteLength, "python bin size matches JS pack");
const ab = pyBlob.buffer.slice(pyBlob.byteOffset, pyBlob.byteOffset + pyBlob.byteLength);
const pyUnpacked = unpackWeights(manifest, ab);
let pyDiff = 0;
for (let i = 0; i < layerParams.length; i++) {
  for (let j = 0; j < layerParams[i].W.length; j++) {
    pyDiff = Math.max(pyDiff, Math.abs(layerParams[i].W[j] - pyUnpacked[i].W[j]));
  }
}
assert(pyDiff < 1e-5, `python↔JS float roundtrip (maxDiff=${pyDiff})`);

// --- 4) Registry: registered, load() without bin → ModelNotAvailableError ---
const reg = new SmallnetRegistry();
reg.register({ ...model });
assert(reg.has("next-action-v1"), "registry.has next-action-v1");
assert(reg.status("next-action-v1") === "registered", "status registered");
let threw = false;
try {
  await reg.load("next-action-v1", {
    fetch: async () => ({ ok: false, status: 404 }),
  });
} catch (e) {
  threw = e instanceof ModelNotAvailableError;
}
assert(threw, "load() without bin → ModelNotAvailableError");
assert(reg.status("next-action-v1") === "missing", "status missing after 404");

// Ephemeral inline install still works
reg.installWeights("next-action-v1", buf);
assert(reg.status("next-action-v1") === "ready", "inline installWeights → ready");
const session = createSession(manifest, buf);
const y = session.run(new Float32Array(manifest.inputSize));
assert(y.length === 18 && Math.abs([...y].reduce((a, b) => a + b, 0) - 1) < 1e-4, "softmax session runs");

// --- 5) export-load fixture fallback ---
const elMod = await import(pathToFileURL(join(NA, "export-load.mjs")).href);
const fakeFetch = async (url) => {
  const u = String(url);
  if (u.includes("catalog.json")) {
    return {
      ok: true,
      async json() {
        return catalog;
      },
    };
  }
  if (u.includes("next-action-v1.bin")) {
    return { ok: false, status: 404 };
  }
  if (u.includes("smoke-weights.json") || u.includes("fixtures/")) {
    return {
      ok: true,
      async json() {
        return smoke;
      },
    };
  }
  return { ok: false, status: 404 };
};
const loaded = await elMod.loadNextActionExport({ fetch: fakeFetch });
assert(loaded.status === "fixture", `export-load status fixture (got ${loaded.status})`);
assert(!!loaded.session, "export-load session from fixture");
const y2 = loaded.session.run(new Float32Array(manifest.inputSize));
assert(y2.length === 18, "fixture session output size 18");

// When bin is available via fetch, status should be "bin"
const binFetch = async (url) => {
  const u = String(url);
  if (u.includes("catalog.json")) {
    return {
      ok: true,
      async json() {
        return catalog;
      },
    };
  }
  if (u.includes("next-action-v1.bin")) {
    return {
      ok: true,
      async arrayBuffer() {
        return buf;
      },
    };
  }
  return { ok: false, status: 404 };
};
const loadedBin = await elMod.loadNextActionExport({ fetch: binFetch });
assert(loadedBin.status === "bin", `export-load status bin when weightsUrl ok (got ${loadedBin.status})`);

// Optional: local particlegan-product1-runs bin
const localBin = "/home/box/workspace/particlegan-product1-runs/export/next-action-v1.bin";
const localMan = "/home/box/workspace/particlegan-product1-runs/export/manifest.json";
if (existsSync(localBin) && existsSync(localMan)) {
  const py2 = spawnSync(
    "python3",
    [EXPORT_PY, "--bin", localBin, "--manifest", localMan, "--roundtrip"],
    { encoding: "utf8" },
  );
  assert(py2.status === 0, "optional local ·1 export bin roundtrip");
} else {
  ok("optional local ·1 bin skipped (absent — CI ok)");
}

try {
  unlinkSync(tmpBin);
  unlinkSync(tmpMan);
} catch (_) {}

console.log(`\nProduct · 10 export checks: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
