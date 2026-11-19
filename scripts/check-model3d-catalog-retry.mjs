#!/usr/bin/env node
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const src=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const start=src.indexOf("function ensureModel3dCatalog(");
assert.ok(start>=0);
const end=src.indexOf("\n}",start)+2;
let attempts=0, release, stale=false;
const catalogs={model3d:null}, catalogFetchedAt={model3d:0};
const ctx={catalogs,catalogFetchedAt,catalogIsStale:()=>stale,
  refreshCatalog:()=>{ attempts++; return new Promise(r=>{release=r;}); }};
vm.createContext(ctx);
vm.runInContext(`let _model3dCatP=null; ${src.slice(start,end)} globalThis.ensure=ensureModel3dCatalog;`,ctx);
const first=ctx.ensure();
assert.equal(ctx.ensure(),first,"concurrent 3D surfaces share one request");
release(false); await first;
const retry=ctx.ensure();
assert.equal(attempts,2,"a failed initial catalog load must be retryable without a page reload");
catalogs.model3d=[{id:"model-3d"}]; catalogFetchedAt.model3d=1;
release(true); await retry;
assert.equal((await ctx.ensure())[0].id,"model-3d");
assert.equal(attempts,2,"fresh catalog must not be refetched for every picker");
stale=true;
const next=ctx.ensure(); assert.equal(attempts,3,"a stale 3D catalog can refresh");
release(true); await next;
console.log("✓ 3D catalog coalesces requests, retries initial failure and reuses only fresh success");
