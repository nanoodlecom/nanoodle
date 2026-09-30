#!/usr/bin/env node
// Leftover next-action weight-load edges after #626.
// That PR shipped: empty catalog → fixture, a registered weightsUrl → bin,
// missing fixture → status "missing", catalog.models stays empty, no .bin
// committed. This file pins the failure paths that must still fall through
// instead of taking the menus down: catalog fetch throw, registered bin 404,
// corrupt fixture JSON, and a missing session leaving blendRows unset.
// Offline, zero API spend. New file so it does not collide with open leftover PRs.
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SN = join(ROOT, "vendor", "smallnet");
const NA = join(ROOT, "vendor", "next-action");
const FIXTURE = join(NA, "fixtures", "smoke-weights.json");

function fail(msg) {
  console.error(`✗ next-action-load-fallback: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const smoke = JSON.parse(readFileSync(FIXTURE, "utf8"));
const catalog = JSON.parse(readFileSync(join(SN, "catalog.json"), "utf8"));
const el = await import(pathToFileURL(join(NA, "export-load.mjs")).href);

function fetchFor({ catalogBody, catalogThrow, binBody, fixtureOk, fixtureThrow }) {
  return async (url) => {
    const u = String(url);
    if (u.includes("catalog.json")) {
      if (catalogThrow) throw new Error("catalog network");
      return { ok: true, async json() { return catalogBody; } };
    }
    if (u.includes("next-action-v1.bin")) {
      if (!binBody) return { ok: false, status: 404 };
      return { ok: true, async arrayBuffer() { return binBody; } };
    }
    if (u.includes("smoke-weights.json") || u.includes("fixtures/")) {
      if (fixtureThrow) return { ok: true, async json() { throw new Error("bad json"); } };
      if (!fixtureOk) return { ok: false, status: 404 };
      return { ok: true, async json() { return smoke; } };
    }
    return { ok: false, status: 404 };
  };
}

const catalogDown = await el.loadNextActionExport({
  fetch: fetchFor({ catalogBody: catalog, catalogThrow: true, fixtureOk: true }),
});
assert(catalogDown.status === "fixture" && catalogDown.session,
  `catalog fetch throw falls back to the fixture (got ${catalogDown.status})`);
assert(catalogDown.session.run(new Float32Array(smoke.manifest.inputSize)).length === 18,
  "fixture session after a catalog throw still runs");

const registered = {
  models: [{ ...smoke.manifest, weightsUrl: "/vendor/next-action/weights/next-action-v1.bin" }],
};
const binMissing = await el.loadNextActionExport({
  fetch: fetchFor({ catalogBody: registered, binBody: null, fixtureOk: true }),
});
assert(binMissing.status === "fixture" && binMissing.session,
  `a registered weightsUrl that 404s falls back to the fixture (got ${binMissing.status})`);

const badFixture = await el.loadNextActionExport({
  fetch: fetchFor({ catalogBody: catalog, fixtureOk: true, fixtureThrow: true }),
});
assert(badFixture.status === "missing" && badFixture.session == null,
  `corrupt fixture JSON stays quiet (got ${badFixture.status})`);

const bothDown = await el.loadNextActionExport({
  fetch: fetchFor({ catalogBody: catalog, catalogThrow: true, fixtureOk: false }),
});
assert(bothDown.status === "missing" && bothDown.session == null,
  "catalog throw + missing fixture stays missing");

const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
assert(/session = loaded && loaded\.session \? loaded\.session : null/.test(surface),
  "the editor treats a missing session as null");
assert(/catch \(e\) \{\s*console\.warn\("\[next-action\] learned session unavailable"/.test(surface)
  || surface.includes("[next-action] learned session unavailable"),
  "a throwing loader leaves the learned session unset");
assert(surface.includes("if (session && recommendNext)") && surface.includes("blendRows = null"),
  "without a session the editor keeps frequency-only rows (menus stay up)");

console.log("✓ next-action-load-fallback: catalog throw / bin 404 → fixture; corrupt fixture stays missing");
