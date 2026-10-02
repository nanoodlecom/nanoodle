#!/usr/bin/env node
// Leftover next-action weight-load degrade edges after #626.
// Shipped check-next-action-weights pins empty catalog → fixture, a
// registered weightsUrl → bin, and a missing fixture → "missing".
// Open leftover #635 pins catalog throw / bin 404 → fixture and corrupt
// fixture JSON → missing. This file pins the remaining degrade paths that
// must still keep the menus up: a 200 bin that unpacks as garbage falls
// through to the fixture (not a thrown menu crash), a fixture whose JSON
// parses but whose layers/manifest cannot pack stays "missing", and a
// loader with no fetch stays "missing". Offline, zero API spend. New file
// so it does not collide with open leftover PRs.
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SN = join(ROOT, "vendor", "smallnet");
const NA = join(ROOT, "vendor", "next-action");
const FIXTURE = join(NA, "fixtures", "smoke-weights.json");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

const smoke = JSON.parse(readFileSync(FIXTURE, "utf8"));
const catalog = JSON.parse(readFileSync(join(SN, "catalog.json"), "utf8"));
const el = await import(pathToFileURL(join(NA, "export-load.mjs")).href);

function fetchFor({ catalogBody, binBody, fixtureBody, fixtureOk = true }) {
  return async (url) => {
    const u = String(url);
    if (u.includes("catalog.json"))
      return { ok: true, async json() { return catalogBody; } };
    if (u.includes("next-action-v1.bin")) {
      if (!binBody) return { ok: false, status: 404 };
      return { ok: true, async arrayBuffer() { return binBody; } };
    }
    if (u.includes("smoke-weights.json") || u.includes("fixtures/")) {
      if (!fixtureOk) return { ok: false, status: 404 };
      return { ok: true, async json() { return fixtureBody ?? smoke; } };
    }
    return { ok: false, status: 404 };
  };
}

const registered = {
  models: [{ ...smoke.manifest, weightsUrl: "/vendor/next-action/weights/next-action-v1.bin" }],
};

{
  const prevWarn = console.warn;
  console.warn = () => {};
  const loaded = await el.loadNextActionExport({
    fetch: fetchFor({ catalogBody: registered, binBody: new ArrayBuffer(4) }),
  });
  console.warn = prevWarn;
  if (loaded.status !== "fixture" || !loaded.session)
    fail(`a 200 truncated bin must fall through to the fixture (got ${loaded.status})`);
  else if (loaded.session.run(new Float32Array(smoke.manifest.inputSize)).length !== 18)
    fail("fixture session after a corrupt bin must still run");
  else ok("truncated catalog bin falls through to the fixture");
}

{
  const emptyLayers = await el.loadNextActionExport({
    fetch: fetchFor({ catalogBody: catalog, fixtureBody: { ...smoke, layers: [] } }),
  });
  if (emptyLayers.status !== "missing" || emptyLayers.session !== null)
    fail(`empty fixture layers must stay missing (got ${emptyLayers.status})`);
  else ok("fixture JSON with empty layers stays missing");
}

{
  const badManifest = await el.loadNextActionExport({
    fetch: fetchFor({
      catalogBody: catalog,
      fixtureBody: { manifest: { ...smoke.manifest, layers: [] }, layers: [] },
    }),
  });
  if (badManifest.status !== "missing" || badManifest.session !== null)
    fail(`fixture missing manifest.layers must stay missing (got ${badManifest.status})`);
  else ok("fixture JSON with an empty manifest.layers stays missing");
}

{
  const prev = globalThis.fetch;
  globalThis.fetch = undefined;
  let loaded;
  try {
    loaded = await el.loadNextActionExport({});
  } finally {
    globalThis.fetch = prev;
  }
  if (loaded.status !== "missing" || loaded.session !== null)
    fail(`no fetch must stay missing (got ${loaded.status})`);
  else if (!/fetch unavailable/i.test(loaded.error || ""))
    fail(`no-fetch error must name fetch, got ${loaded.error}`);
  else ok("loader with no fetch stays missing");
}

if (failed) {
  console.error(`\n${failed} leftover export-load degrade pin(s) failed`);
  process.exit(1);
}
console.log("✓ export-load degrade leftover pins");
