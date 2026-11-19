#!/usr/bin/env node
// A returning visitor's model3d catalog is whatever localStorage primed at boot
// (model3d is NOT a boot kind), so a graph painted before the first 3D fetch can
// carry a "model unavailable" badge for a model the fresh catalog has — Idol
// (speridlabs/idol, catalogued 2026-10-31) read exactly that way for anyone whose
// cached list predated it. The boot kinds heal because catalogReady repaints;
// ensureModel3dCatalog must reconcile the same way when its fetch lands, or the
// badge sticks for the whole session. This check pins that repaint.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const src = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = src.indexOf("function ensureModel3dCatalog(");
assert.ok(start >= 0);
const end = src.indexOf("\n}", start) + 2;

// Scenario: primed (stale) catalog WITHOUT the model the graph pins.
const catalogs = { model3d: [{ id: "tripo3d/v2.5" }] };
const catalogFetchedAt = { model3d: 0 };
let repaints = 0;
const ctx = {
  catalogs, catalogFetchedAt,
  catalogIsStale: () => true,
  refreshCatalog: async () => {           // the network lands with the full list
    catalogs.model3d = [{ id: "tripo3d/v2.5" }, { id: "speridlabs/idol" }];
    catalogFetchedAt.model3d = Date.now();
    return true;
  },
  refreshAllPrices: () => { repaints++; },
  redraw: () => {},
  refreshPortFills: () => {},
};
vm.createContext(ctx);
vm.runInContext(`let _model3dCatP = null; ${src.slice(start, end)} globalThis.ensure = ensureModel3dCatalog;`, ctx);

const list = await ctx.ensure();
assert.ok(list.some(m => m.id === "speridlabs/idol"), "fresh catalog resolves with the model");
assert.ok(repaints >= 1, "landing the fresh 3D catalog must repaint, or a stale-cache 'model unavailable' badge never clears");

// A failed fetch must not repaint (nothing changed) and must stay retryable.
catalogFetchedAt.model3d = 0;
ctx.refreshCatalog = async () => false;
await ctx.ensure();
assert.equal(repaints, 1, "a failed 3D catalog fetch does not repaint");
console.log("✓ 3D catalog landing repaints the graph, so stale-cache model badges clear");
