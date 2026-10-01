#!/usr/bin/env node
/**
 * Weights load path. The catalog stays empty: no weightsUrl is registered
 * and no .bin is committed. The loader falls back to the smoke fixture.
 * A caller that does supply a catalog weightsUrl can still load a bin.
 */
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SN = join(ROOT, "vendor", "smallnet");
const NA = join(ROOT, "vendor", "next-action");
const FIXTURE = join(NA, "fixtures", "smoke-weights.json");
const EXPORT_PY = join(ROOT, "scripts", "export-smallnet-weights.py");

function fail(msg) {
  console.error(`✗ next-action-weights: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

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

const catalog = JSON.parse(readFileSync(join(SN, "catalog.json"), "utf8"));
assert(Array.isArray(catalog.models) && catalog.models.length === 0, "catalog.models stays empty");
assert(!JSON.stringify(catalog.models).includes("weightsUrl"), "no weightsUrl is registered");
const bins = walk(SN).concat(walk(NA)).filter((p) => p.endsWith(".bin"));
assert(bins.length === 0, `no .bin committed (found ${bins.length})`);

const smoke = JSON.parse(readFileSync(FIXTURE, "utf8"));
const sn = await import(pathToFileURL(join(SN, "index.js")).href);
const manifest = { ...smoke.manifest, weightsUrl: null };
sn.assertManifest(manifest);
const layerParams = smoke.layers.map((L) => ({
  W: Float32Array.from(L.W),
  b: Float32Array.from(L.b),
}));
const buf = sn.packWeights(manifest, layerParams);

const tmp = mkdtempSync(join(tmpdir(), "na-weights-"));
const tmpBin = join(tmp, "next-action-v1.bin");
const tmpMan = join(tmp, "manifest.json");
const py = spawnSync("python3", [
  EXPORT_PY, "--fixture", FIXTURE, "--out-bin", tmpBin, "--out-manifest", tmpMan, "--roundtrip",
], { encoding: "utf8" });
assert(py.status === 0, `export script exit 0 (got ${py.status} ${py.stderr || ""})`);
assert(existsSync(tmpBin), "export script wrote a temp bin");
const again = JSON.parse(readFileSync(join(SN, "catalog.json"), "utf8"));
assert(again.models.length === 0, "export script does not register a catalog model");

const pyBlob = readFileSync(tmpBin);
const ab = pyBlob.buffer.slice(pyBlob.byteOffset, pyBlob.byteOffset + pyBlob.byteLength);
const unpacked = sn.unpackWeights(manifest, ab);
let maxDiff = 0;
for (let i = 0; i < layerParams.length; i++) {
  for (let j = 0; j < layerParams[i].W.length; j++) {
    maxDiff = Math.max(maxDiff, Math.abs(layerParams[i].W[j] - unpacked[i].W[j]));
  }
}
assert(maxDiff < 1e-5, `python bin matches the fixture (maxDiff=${maxDiff})`);

const el = await import(pathToFileURL(join(NA, "export-load.mjs")).href);

function fetchFor(catalogBody, binBody, fixtureOk) {
  return async (url) => {
    const u = String(url);
    if (u.includes("catalog.json")) {
      return { ok: true, async json() { return catalogBody; } };
    }
    if (u.includes("next-action-v1.bin")) {
      if (!binBody) return { ok: false, status: 404 };
      return { ok: true, async arrayBuffer() { return binBody; } };
    }
    if (u.includes("smoke-weights.json") || u.includes("fixtures/")) {
      if (!fixtureOk) return { ok: false, status: 404 };
      return { ok: true, async json() { return smoke; } };
    }
    return { ok: false, status: 404 };
  };
}

const shipped = await el.loadNextActionExport({
  fetch: fetchFor(catalog, null, true),
});
assert(shipped.status === "fixture", `empty catalog falls back to the fixture (got ${shipped.status})`);
const y = shipped.session.run(new Float32Array(manifest.inputSize));
assert(y.length === 18, "fixture session output is 18");

const withBin = {
  models: [{ ...smoke.manifest, weightsUrl: "/vendor/next-action/weights/next-action-v1.bin" }],
};
const fromBin = await el.loadNextActionExport({
  fetch: fetchFor(withBin, buf, false),
});
assert(fromBin.status === "bin", `a registered weightsUrl loads the bin (got ${fromBin.status})`);

const missing = await el.loadNextActionExport({
  fetch: fetchFor(catalog, null, false),
});
assert(missing.status === "missing" && missing.session == null, "a missing fixture stays quiet");

const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
assert(surface.includes("loadNextActionExport"), "the editor loads weights through the fallback path");
assert(!surface.includes("weightsUrl:"), "the editor does not invent a weightsUrl");

console.log("✓ next-action-weights: catalog stays empty, fixture fallback runs, export roundtrips");
