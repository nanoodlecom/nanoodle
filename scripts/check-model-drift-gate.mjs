#!/usr/bin/env node
// The "model unavailable" badge must only speak for a catalog that has actually
// been revalidated this session. Catalogs prime from localStorage at boot, and a
// prime written before a model's launch day does not contain it — Idol Max Turbo
// (speridlabs/idol/max/turbo, catalogued 2026-11-18) flashed exactly that badge,
// with its one-click "use default" swap, for gallery visitors whose cached 3D
// list predated the launch, until ensureModel3dCatalog's fetch landed and the
// #824 repaint cleared it. modelDrifted already stayed permissive for an empty
// catalog; this check pins the same permissiveness for a primed-but-unfetched
// one, and pins that the badge still fires once a revalidated catalog really
// lacks the model.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const src = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = src.indexOf("function modelDrifted(");
assert.ok(start >= 0);
const end = src.indexOf("\n}", start) + 2;

const catalogs = { model3d: [{ id: "tripo3d/v2.5" }] };   // stale prime: no idol/max/turbo
const catalogFetchedAt = { model3d: 0 };                    // never revalidated this session
const ctx = {
  catalogs, catalogFetchedAt,
  NODE_TYPES: { model3d: { modelKind: "model3d" } },
  catItem: (kind, id) => (catalogs[kind] || []).find(m => m.id === id) || null,
  catalogIsStale: () => true,
  decideModelId: (x) => x,
};
vm.createContext(ctx);
vm.runInContext(`${src.slice(start, end)} globalThis.drifted = modelDrifted;`, ctx);

const node = { type: "model3d", fields: { model: "speridlabs/idol/max/turbo" } };
assert.equal(ctx.drifted(node), false, "a primed-but-unrevalidated catalog must not badge a model it predates");

catalogFetchedAt.model3d = Date.now();                      // the fresh list lands — still without the model
assert.equal(ctx.drifted(node), true, "once revalidated, a catalog that really lacks the model must badge it");

catalogs.model3d = [{ id: "tripo3d/v2.5" }, { id: "speridlabs/idol/max/turbo" }];
assert.equal(ctx.drifted(node), false, "a revalidated catalog containing the model must not badge it");

catalogs.model3d = [];
catalogFetchedAt.model3d = 0;
assert.equal(ctx.drifted(node), false, "an empty catalog stays permissive");
console.log("✓ model-drift badge waits for a revalidated catalog — no stale-prime false unavailable");
