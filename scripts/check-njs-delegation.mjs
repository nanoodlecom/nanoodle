#!/usr/bin/env node
// End-to-end delegation check (replace-prep Phase E): play.html's runGraph with
// the njs_engine flag ON must route NETWORK nodes through the embedded
// window.NanoodleEngine bundle and produce byte-identical NanoGPT request
// bodies to the flag-OFF (built-in runner) path.
//
// This is one level above check-js-parity.mjs: parity drives Workflow.run and
// NoodleApp.runGraph separately; this drives ONE runGraph twice and flips only
// the flag, so it exercises njsRunFor/njsCtx — the real delegation shim.
//
// Offline; skips cleanly when the njs-engine block is absent.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { loadEngine, calls } from "./play-engine.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "play.html"), "utf8");

const m = /<script id="njs-engine"[^>]*>\n([\s\S]*?)\n<\/script>/.exec(html);
if (!m) {
  console.log("⊘ skip njs-delegation: no njs-engine block in play.html (run scripts/gen-js-engine.mjs)");
  process.exit(0);
}

// Materialize the bundle with a plain object standing in for window.
const w = {};
new Function("window", m[1])(w);
const ENGINE = w.NanoodleEngine;
assert.ok(ENGINE && ENGINE.RUNNERS && ENGINE.NanoClient, "bundle exposes RUNNERS + NanoClient");

const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
let _l = 0;
const link = (from, fromPort, to, toPort) =>
  ({ id: "l" + (++_l), from: { node: from, port: fromPort }, to: { node: to, port: toPort } });

const GRAPHS = [
  ["llm chat", {
    nodes: [node("t1", "text", { text: "Hello" }), node("m1", "llm", { model: "x", system: "You are terse." })],
    links: [link("t1", "text", "m1", "prompt")],
  }, ["llm"]],
  ["edit multi-ref", {
    nodes: [node("u1", "upload", { image: IMG }), node("u2", "upload", { image: IMG }), node("e1", "edit", { model: "x", prompt: "merge" })],
    links: [link("u1", "image", "e1", "image"), link("u2", "image", "e1", "image2")],
  }, ["edit"]],
  ["image variations", {
    nodes: [node("i1", "image", { model: "x", prompt: "a fox", variations: "2" })],
    links: [],
  }, ["image"]],
];

function flaggedEngine(on, spy) {
  let captured;
  const app = loadEngine((ctx) => {
    captured = ctx;
    ctx.URLSearchParams = URLSearchParams; // njsOn() parses location.search
    ctx.localStorage = ctx.sessionStorage = {
      getItem: (k) => (k === "ngpt_key" ? "test-api-key" : k === "njs_engine" ? (on ? "1" : null) : null),
      setItem() {}, removeItem() {},
    };
  });
  if (on) {
    // hand the vm the REAL bundle, with each runner wrapped so we can prove delegation ran
    const wrapped = { ...ENGINE, RUNNERS: {} };
    for (const [k, fn] of Object.entries(ENGINE.RUNNERS)) {
      wrapped.RUNNERS[k] = (...a) => { spy.push(k); return fn(...a); };
    }
    captured.NanoodleEngine = wrapped;
  }
  return app;
}

const paid = (c) => /\/(chat\/completions|images\/generations|generate-video|audio\/speech|transcriptions)/.test(c.url);
const norm = (c) => JSON.stringify({ url: String(c.url).replace(/^https?:\/\/[^/]+/i, ""), body: c.body });

let failed = 0;
for (const [name, data, expectTypes] of GRAPHS) {
  calls.length = 0;
  const offApp = flaggedEngine(false, []);
  await offApp.runGraph(offApp.materialize(data), {}).catch(() => {});
  const offReqs = calls.filter(paid).map(norm).sort();

  calls.length = 0;
  const spy = [];
  const onApp = flaggedEngine(true, spy);
  await onApp.runGraph(onApp.materialize(data), {}).catch(() => {});
  const onReqs = calls.filter(paid).map(norm).sort();

  const missing = expectTypes.filter((t) => !spy.includes(t));
  if (missing.length) {
    failed++;
    console.log(`✗ ${name}: delegation did not engage for ${missing.join(", ")} (spy saw: ${spy.join(", ") || "nothing"})`);
    continue;
  }
  if (JSON.stringify(offReqs) !== JSON.stringify(onReqs)) {
    failed++;
    console.log(`✗ ${name}: flag-on requests differ from flag-off\n  off: ${offReqs.join("\n       ")}\n  on:  ${onReqs.join("\n       ")}`);
    continue;
  }
  console.log(`✓ ${name} (${onReqs.length} req, delegated: ${[...new Set(spy)].join(", ")})`);
}

if (failed) {
  console.log(`\n${failed}/${GRAPHS.length} delegation scenarios failed`);
  process.exit(1);
}
console.log(`\n✓ njs-delegation: flag-gated runGraph delegation matches the built-in path (${GRAPHS.length} scenarios)`);
