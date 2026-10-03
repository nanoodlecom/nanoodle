#!/usr/bin/env node
// Leftover next-action weight-load shape edges after #626 / #635 / #670.
// Those pins cover empty catalog → fixture, bin 404 / truncated bin →
// fixture, empty layers / empty manifest.layers / no fetch → missing, and
// corrupt JSON → missing. This file pins the remaining degrade: a fixture
// that parses as JSON but whose non-empty manifest/weights cannot pack
// (drifted inputSize vs layer.in, truncated W, unsupported format, missing
// manifest.id) must stay "missing" so Suggested menus keep the frequency
// path instead of throwing. Offline, zero API spend. New file so it does
// not collide with open leftover PRs.
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

function fetchFor(fixtureBody) {
  return async (url) => {
    const u = String(url);
    if (u.includes("catalog.json"))
      return { ok: true, async json() { return catalog; } };
    if (u.includes("smoke-weights.json") || u.includes("fixtures/"))
      return { ok: true, async json() { return fixtureBody; } };
    return { ok: false, status: 404 };
  };
}

async function load(fixtureBody) {
  return el.loadNextActionExport({ fetch: fetchFor(fixtureBody) });
}

function mustMissing(loaded, label) {
  if (loaded.status !== "missing" || loaded.session !== null)
    fail(`${label} must stay missing (got ${loaded.status})`);
  else ok(label);
}

{
  const drifted = structuredClone(smoke);
  drifted.manifest.inputSize = 42;
  mustMissing(await load(drifted), "fixture inputSize drifted from layer.in stays missing");
}

{
  const truncated = structuredClone(smoke);
  truncated.layers[0].W = truncated.layers[0].W.slice(0, 10);
  mustMissing(await load(truncated), "fixture with truncated layer W stays missing");
}

{
  const badFmt = structuredClone(smoke);
  badFmt.manifest.format = "smallnet-mlp-v2";
  mustMissing(await load(badFmt), "fixture with an unsupported format stays missing");
}

{
  const noId = { layers: smoke.layers, manifest: { ...smoke.manifest } };
  delete noId.manifest.id;
  mustMissing(await load(noId), "fixture missing manifest.id stays missing");
}

{
  const shipped = await load(smoke);
  if (shipped.status !== "fixture" || !shipped.session)
    fail(`control smoke fixture must still load (got ${shipped.status})`);
  else ok("control smoke fixture still loads as fixture");
}

if (failed) {
  console.error(`\n${failed} leftover export-load shape pin(s) failed`);
  process.exit(1);
}
console.log("✓ export-load shape leftover pins");
