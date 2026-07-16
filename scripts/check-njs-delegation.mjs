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
  ["image single", {
    nodes: [node("i1", "image", { model: "x", prompt: "a fox", variations: "1" })],
    links: [],
  }, ["image"]],
  // play (unlike the editor) delegates wired video refs: built-in and library are BOTH
  // permissive-ON on a catalog miss, so bodies agree in every catalog state
  ["tvideo wired refs", {
    nodes: [node("u1", "upload", { image: IMG }), node("v1", "tvideo", { model: "x", prompt: "pan" })],
    links: [link("u1", "image", "v1", "ref1")],
  }, ["tvideo"]],
  ["vedit with wired ref", {
    nodes: [node("s1", "vupload", { video: IMG }), node("u1", "upload", { image: IMG }), node("v1", "vedit", { model: "x", prompt: "restyle" })],
    links: [link("s1", "video", "v1", "video"), link("u1", "image", "v1", "ref1")],
  }, ["vedit"]],
  // blob: media delegates too: the shim materializes page-local object URLs into data: URLs with
  // the same urlToDataUrl the built-in senders use, so bodies stay identical
  ["remix from a blob: source (Trim output)", {
    nodes: [node("a1", "aupload", { audio: "blob:null/trimmed" }), node("r1", "remix", { model: "x", prompt: "lo-fi cover" })],
    links: [link("a1", "audio", "r1", "audio")],
  }, ["remix"]],
  ["llm hears a blob: clip (inlined to bytes on both paths)", {
    nodes: [node("a1", "aupload", { audio: "blob:null/clip" }), node("t1", "text", { text: "what is said?" }), node("m1", "llm", { model: "x", system: "" })],
    links: [link("a1", "audio", "m1", "audio"), link("t1", "text", "m1", "prompt")],
  }, ["llm"]],
  ["lipsync happy path (library ladder submits as-is first)", {
    nodes: [node("u1", "upload", { image: IMG }), node("a1", "aupload", { audio: IMG }), node("l1", "lipsync", { model: "x" })],
    links: [link("u1", "image", "l1", "image"), link("a1", "audio", "l1", "audio")],
  }, ["lipsync"]],
];

// Veto shapes (mirrors check-njs-editor-delegation.mjs): the library doesn't yet match the
// built-in for these, so the shim must fall back — the spy must NOT see the type, and the
// flag-on request set must still equal flag-off (both ran the built-in runner).
const VETO_GRAPHS = [
  ["image variations>1 vetoed (gallery clamp)", {
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
      getItem: (k) => (k === "ngpt_key" ? "test-api-key" : k === "njs_engine" ? (on ? "1" : "0") : null),   // flag defaults ON, so "off" is the explicit "0" opt-out
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

for (const [name, data, vetoTypes] of VETO_GRAPHS) {
  calls.length = 0;
  const offApp = flaggedEngine(false, []);
  await offApp.runGraph(offApp.materialize(data), {}).catch(() => {});
  const offReqs = calls.filter(paid).map(norm).sort();

  calls.length = 0;
  const spy = [];
  const onApp = flaggedEngine(true, spy);
  await onApp.runGraph(onApp.materialize(data), {}).catch(() => {});
  const onReqs = calls.filter(paid).map(norm).sort();

  const leaked = vetoTypes.filter((t) => spy.includes(t));
  if (leaked.length) {
    failed++;
    console.log(`✗ ${name}: delegation engaged for ${leaked.join(", ")} — the veto did not hold`);
    continue;
  }
  if (JSON.stringify(offReqs) !== JSON.stringify(onReqs)) {
    failed++;
    console.log(`✗ ${name}: flag-on requests differ from flag-off\n  off: ${offReqs.join("\n       ")}\n  on:  ${onReqs.join("\n       ")}`);
    continue;
  }
  console.log(`✓ ${name} (built-in path, ${onReqs.length} req identical)`);
}

// Direct veto matrix on the REAL shim (NoodleApp.__njs), including the pending-job guard the
// graph scenarios can't reach — twin of check-njs-editor-delegation.mjs's veto block.
{
  const spy = [];
  const app = flaggedEngine(true, spy);
  const { runFor, PENDING_VIDEO, PENDING_AUDIO } = app.__njs;
  const rn = (type, fields) => ({ id: "n1", type, fields: fields || {} });
  assert.equal(runFor("image", rn("image", { model: "x", prompt: "p", variations: "2" }), {}, "n1"), null, "image variations>1 must not delegate");
  assert.notEqual(runFor("image", rn("image", { model: "x", prompt: "p", variations: "1" }), {}, "n1"), null, "image variations=1 still delegates");
  assert.notEqual(runFor("tvideo", rn("tvideo", { model: "x", prompt: "p" }), { ref1: IMG }, "n1"), null, "tvideo with wired refs delegates on play (both engines permissive-ON)");
  assert.notEqual(runFor("vedit", rn("vedit", { model: "x", prompt: "p" }), { video: IMG, ref1: IMG }, "n1"), null, "vedit with wired refs delegates on play");
  assert.notEqual(runFor("remix", rn("remix", { model: "x", prompt: "p" }), { audio: "blob:null/abc" }, "n1"), null, "blob: media delegates (the shim materializes it to a data: URL)");
  assert.notEqual(runFor("lipsync", rn("lipsync", { model: "x" }), {}, "n1"), null, "lipsync delegates (library ladder + ctx.trimAudio landed)");
  PENDING_VIDEO.set("n1", { sig: 1, runId: "r1" });   // a BUILT-IN engine's pending job (no njs tag)
  assert.equal(runFor("ivideo", rn("ivideo", { model: "x", prompt: "p" }), { image: IMG }, "n1"), null, "a built-in pending video job keeps the node on the built-in engine");
  PENDING_VIDEO.set("n1", { sig: 1, runId: "r1", njs: true });
  assert.notEqual(runFor("ivideo", rn("ivideo", { model: "x", prompt: "p" }), { image: IMG }, "n1"), null, "an njs-tagged pending video job still delegates");
  PENDING_VIDEO.delete("n1");
  PENDING_AUDIO.set("n1", { sig: 1, job: { runId: "r1" } });
  assert.equal(runFor("music", rn("music", { model: "x", prompt: "p" }), {}, "n1"), null, "a built-in pending audio job keeps the node on the built-in engine");
  PENDING_AUDIO.set("n1", { sig: 1, job: { runId: "r1" }, njs: true });
  assert.notEqual(runFor("music", rn("music", { model: "x", prompt: "p" }), {}, "n1"), null, "an njs-tagged pending audio job still delegates");
  PENDING_AUDIO.delete("n1");
  console.log("✓ vetoes: gallery clamp / foreign pending jobs fall back to built-in (wired video refs, blob: media and lipsync delegate)");
}

const total = GRAPHS.length + VETO_GRAPHS.length;
if (failed) {
  console.log(`\n${failed}/${total} delegation scenarios failed`);
  process.exit(1);
}
console.log(`\n✓ njs-delegation: flag-gated runGraph delegation matches the built-in path (${GRAPHS.length} scenarios + ${VETO_GRAPHS.length} veto scenarios)`);
