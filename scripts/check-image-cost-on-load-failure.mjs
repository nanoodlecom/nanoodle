#!/usr/bin/env node
// A paid image request must be billed even when loading its content fails.
//
// /v1/images/generations can return a relative content URL that is read in a
// second step. That read can fail (opaque redirect, network, 5xx). Cost used to
// be recorded only AFTER the content resolved, so a failed load dropped the
// charge from the meter. This drives each image call site with a mocked request
// that succeeds and a content load that fails, and asserts the cost was recorded:
//   1. editor CTX.genImage (index.html)      — accrue() is called
//   2. play built-in genImage (play.html)    — the run's cost meter counts it
//   3. njs engine NanoClient.image (vendor)  — onCost fires before content work
//
// Offline, no API spend. House pattern: play-engine.mjs sandbox + node:vm.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import { loadEngine, ROOT } from "./play-engine.mjs";

let failed = 0;
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { failed++; console.error("  ✗ " + m); } };

function jsonRes(obj, status = 200) {
  const text = JSON.stringify(obj);
  const bag = { "content-type": "application/json" };
  return {
    ok: status >= 200 && status < 300, status, type: "basic",
    headers: { get: (k) => bag[String(k).toLowerCase()] ?? null },
    json: async () => obj, text: async () => text,
    blob: async () => new Blob([text]),
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    body: { cancel: async () => {} },
  };
}
function opaqueRedirect() {
  const no = async () => { throw new Error("opaque"); };
  return { ok: false, status: 0, type: "opaqueredirect", headers: { get: () => null },
    json: no, text: no, blob: no, arrayBuffer: no, body: { cancel: async () => {} } };
}
const IMG_OK = { data: [{ url: "/api/images/content?runId=img1" }], cost: 0.04 };

// ── 1. editor CTX.genImage ────────────────────────────────────────────────
async function editor() {
  console.log("\neditor CTX.genImage: request succeeds, content load fails");
  const src = readFileSync(join(ROOT, "index.html"), "utf8");
  const at = src.indexOf("  async genImage(prompt, model, size, imageDataUrl, maskDataUrl, extra, opts){");
  if (at < 0) { ok(false, "CTX.genImage not found in index.html"); return; }
  let i = src.indexOf("{", src.indexOf(")", at)), depth = 0, end = -1;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { end = i + 1; break; }
  }
  const method = src.slice(at, end);
  const accrued = [];
  let posts = 0;
  const sb = {
    IMG_ENDPOINT: "https://nano-gpt.com/v1/images/generations",
    authHeaders: () => ({}), runSignal: () => undefined,
    throwHttp: async (r) => { throw new Error("http " + r.status); },
    b64ImageMime: () => "image/png", imageModelOpts: () => ({}),
    imageUnitUsd: () => 0.04,
    accrue: (j, est, r) => { accrued.push({ j, est }); },
    fetch: async (url, init = {}) => { if (String(init.method).toUpperCase() === "POST") posts++; return jsonRes(IMG_OK); },
    resolveContentMedia: async () => { throw new Error("content load failed"); },
    opaqueContentError: (e) => e,
  };
  createContext(sb);
  const CTX = new Script("({" + method + "})").runInContext(sb);
  let threw = null;
  try { await CTX.genImage("a boat", "flux", "1024x1024"); } catch (e) { threw = e; }
  ok(posts === 1, "one paid POST (" + posts + ")");
  ok(threw && /content load failed/.test(threw.message), "the content failure surfaces");
  ok(accrued.length === 1 && accrued[0].est === 0.04, "accrue() recorded the paid request (" + JSON.stringify(accrued.map((a) => a.est)) + ")");
}

// ── 2. play built-in genImage ─────────────────────────────────────────────
async function play() {
  console.log("\nplay built-in genImage: request succeeds, content load fails");
  let ctxRef = null, posts = 0;
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url), "https://nano-gpt.com");
    const m = String(init.method || "GET").toUpperCase();
    if (u.pathname === "/v1/images/generations" && m === "POST") { posts++; return jsonRes(IMG_OK); }
    if (u.pathname === "/api/images/content") return opaqueRedirect();
    return jsonRes({ data: [] });
  };
  const app = loadEngine((ctx) => { ctx.fetch = fetch; ctxRef = ctx; });
  // bumpCost() → notifyParentCost() posts the meter to a parent frame. Attach a
  // spy parent only now, after load, so EMBEDDED stays false for the run itself.
  const meter = [];
  ctxRef.parent = { postMessage: (msg) => { if (msg && msg.type === "__cost__") meter.push(msg); } };
  const g = app.materialize({ nodes: [{ id: "n", type: "image", x: 0, y: 0, fields: { model: "flux", prompt: "a boat", size: "1024x1024" } }], links: [] });
  const errors = [];
  try {
    await app.runGraph(g, { onStatus: (id, kind, msg) => { if (kind === "error") errors.push(String(msg)); } });
  } catch (e) { errors.push(String(e && e.message)); }
  ok(posts === 1, "one paid POST (" + posts + ")");
  ok(errors.length >= 1, "the content failure surfaces (" + (errors[0] || "none") + ")");
  const last = meter[meter.length - 1];
  ok(!!last && last.count >= 1 && Math.abs(last.total - 0.04) < 1e-9, "cost meter recorded the paid request (" + JSON.stringify(last || null) + ")");
}

// ── 3. njs engine NanoClient.image ────────────────────────────────────────
async function engine() {
  console.log("\nnjs engine NanoClient.image: onCost fires before content is resolved");
  const vendor = readFileSync(join(ROOT, "vendor/njs-engine.js"), "utf8");
  const m = /^\/\* data-hash=[0-9a-f]{16} \*\/\n([\s\S]*)\n$/.exec(vendor);
  if (!m) { ok(false, "vendor/njs-engine.js has no data-hash header"); return; }
  const w = {};
  new Function("window", m[1])(w);
  const E = w.NanoodleEngine;
  if (!E || !E.NanoClient) { ok(false, "NanoClient not exported"); return; }
  const costs = [];
  let contentReads = 0;
  const client = new E.NanoClient({ apiKey: "k", fetch: async (url, init = {}) => {
    if (/\/api\/images\/content/.test(String(url))) { contentReads++; return opaqueRedirect(); }
    return jsonRes(IMG_OK);
  } });
  let res = null, threw = null;
  try { res = await client.image({ prompt: "a boat", model: "flux", size: "1024x1024" }, { onCost: (c) => costs.push(c) }); }
  catch (e) { threw = e; }
  ok(costs.length === 1, "onCost fired once (" + costs.length + (threw ? ", threw " + threw.message : "") + ")");
  ok(contentReads === 0, "image() does not read content itself (resolution happens later, after billing)");
}

await editor();
await play();
await engine();
if (failed) { console.error("\n✗ image-cost-on-load-failure: " + failed + " assertion(s) failed."); process.exit(1); }
console.log("\n✓ image-cost-on-load-failure: a paid image is billed even when its content load fails.");
