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
import { loadEngine, calls, catalog } from "./play-engine.mjs";

// Seed audio ids before any fetch caches a non-empty catalog. "x" is the remix
// placeholder already in GRAPHS — once audio is non-empty it must be listed too.
catalog.audio.push(
  { id: "x", supported_parameters: {} },
  { id: "mureka-ai/mureka-v9.5/prompt-to-song", supported_parameters: {} },
  { id: "mureka-ai/mureka-v9.5/generate-song", supported_parameters: {} },
  { id: "mureka-ai/mureka-v9.5/generate-bgm", supported_parameters: {} },
);

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

const LORA_A = "https://huggingface.co/x/y/resolve/main/a.safetensors";
const LORA_B = "https://huggingface.co/x/y/resolve/main/b.safetensors";
const LORA_C = "https://huggingface.co/x/y/resolve/main/c.safetensors";
const LORA_STACK3 = [
  { url: LORA_A, strength: "1" },
  { url: LORA_B, strength: "0.8" },
  { url: LORA_C, strength: "0.5" },
];
// Exact billed keys: flag-on === flag-off still passes if BOTH engines regress
// to flux `lora_url`/`lora_strength` and drop slots 2-3, so pin the keys too.
const PIN_NUMBERED3 = {
  must: {
    lora_url_1: LORA_A, lora_scale_1: 1,
    lora_url_2: LORA_B, lora_scale_2: 0.8,
    lora_url_3: LORA_C, lora_scale_3: 0.5,
  },
  forbid: ["lora_url", "lora_strength", "lora_url_4"],
};
const PIN_QWEN21_EDIT2 = {
  must: {
    lora_url_1: LORA_A, lora_scale_1: 1,
    lora_url_2: LORA_B, lora_scale_2: 0.8,
  },
  forbid: ["lora_url", "lora_strength", "lora_url_3"],
};
const PIN_NO_LORA = { forbid: ["lora_url", "lora_url_1", "lora_strength"] };

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
  ["music prompt-to-song (prompt key, not input)", {
    nodes: [node("m1", "music", { model: "mureka-ai/mureka-v9.5/prompt-to-song", prompt: "dreamy synthwave" })],
    links: [],
  }, ["music"]],
  ["music generate-song (prompt + lyrics)", {
    nodes: [node("m1", "music", { model: "mureka-ai/mureka-v9.5/generate-song", prompt: "pop ballad", lyrics: "[Verse]\nhi" })],
    links: [],
  }, ["music"]],
  ["music generate-bgm (prompt key, not input)", {
    nodes: [node("m1", "music", { model: "mureka-ai/mureka-v9.5/generate-bgm", prompt: "lofi cafe rain" })],
    links: [],
  }, ["music"]],
  // Anima / H3 LoRA: catalog advertises lora_url_1..3. The generated njs-engine
  // used to classify *-lora as flux (cap 1) and drop H3 entirely (no "lora" in
  // the id) — default-ON delegation then billed a wrong payload. Pin both
  // engines to the numbered-slot shape, and pin the keys themselves: flag-on
  // === flag-off still passes if BOTH engines regress to flux `lora_url`.
  ["anima image 3-lora (lora_url_1..3)", {
    nodes: [node("i1", "image", { model: "wavespeed-ai/anima/text-to-image-lora", prompt: "a fox", variations: "1", loras: [
      { url: "https://huggingface.co/x/y/resolve/main/a.safetensors", strength: "1" },
      { url: "https://huggingface.co/x/y/resolve/main/b.safetensors", strength: "0.8" },
      { url: "https://huggingface.co/x/y/resolve/main/c.safetensors", strength: "0.5" },
    ] })],
    links: [],
  }, ["image"], PIN_NUMBERED3],
  ["h3 image lora (ids lack 'lora')", {
    nodes: [node("i1", "image", { model: "wavespeed-ai/minimax-h3/text-to-image", prompt: "a fox", variations: "1", loras: [
      { url: "https://huggingface.co/x/y/resolve/main/a.safetensors", strength: "1" },
    ] })],
    links: [],
  }, ["image"]],
  ["anima tvideo 3-lora (lora_url_1..3)", {
    nodes: [node("v1", "tvideo", { model: "wavespeed-ai/anima/image-to-video-lora", prompt: "pan", loras: [
      { url: "https://huggingface.co/x/y/resolve/main/a.safetensors", strength: "1" },
      { url: "https://huggingface.co/x/y/resolve/main/b.safetensors", strength: "0.8" },
      { url: "https://huggingface.co/x/y/resolve/main/c.safetensors", strength: "0.5" },
    ] })],
    links: [],
  }, ["tvideo"]],
  ["h3 video 2-lora", {
    nodes: [node("v1", "tvideo", { model: "minimax-h3", prompt: "pan", loras: [
      { url: "https://huggingface.co/x/y/resolve/main/a.safetensors", strength: "1" },
      { url: "https://huggingface.co/x/y/resolve/main/b.safetensors", strength: "0.8" },
    ] })],
    links: [],
  }, ["tvideo"]],
  // Qwen Image 2.1 LoRA (2026-09-21): catalog advertises lora_url_1..3 on both
  // *-lora ids. Same flux-fallthrough class as Anima — UI slot count (loraCap)
  // and the njs body must agree on numbered slots on every path (t2i + edit).
  ["qwen21 t2i 3-lora (lora_url_1..3)", {
    nodes: [node("i1", "image", { model: "wavespeed-ai/qwen-image-2.1/text-to-image-lora", prompt: "a fox", variations: "1", loras: LORA_STACK3 })],
    links: [],
  }, ["image"], PIN_NUMBERED3],
  ["qwen21 edit 2-lora (lora_url_1..2)", {
    nodes: [node("u1", "upload", { image: IMG }), node("e1", "edit", { model: "wavespeed-ai/qwen-image-2.1/edit-lora", prompt: "restyle", loras: LORA_STACK3.slice(0, 2) })],
    links: [link("u1", "image", "e1", "image")],
  }, ["edit"], PIN_QWEN21_EDIT2],
  ["plain qwen21 text-to-image sends no LoRA", {
    nodes: [node("i1", "image", { model: "wavespeed-ai/qwen-image-2.1/text-to-image", prompt: "a fox", variations: "1", loras: [{ url: LORA_A, strength: "1" }] })],
    links: [],
  }, ["image"], PIN_NO_LORA],
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
// JSON object key order is not part of the request contract.
const canonical = (v) => Array.isArray(v) ? v.map(canonical)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const norm = (c) => JSON.stringify({ url: String(c.url).replace(/^https?:\/\/[^/]+/i, ""), body: canonical(c.body) });

function pinLoraBody(name, reqs, pin) {
  if (!pin) return true;
  if (!reqs.length) {
    failed++;
    console.log(`✗ ${name}: no paid request to pin LoRA body`);
    return false;
  }
  const body = JSON.parse(reqs[0]).body || {};
  for (const [k, v] of Object.entries(pin.must || {})) {
    if (body[k] !== v) {
      failed++;
      console.log(`✗ ${name}: ${k} expected ${JSON.stringify(v)}, got ${JSON.stringify(body[k])}`);
      return false;
    }
  }
  for (const k of pin.forbid || []) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      failed++;
      console.log(`✗ ${name}: forbidden ${k}=${JSON.stringify(body[k])} still posted`);
      return false;
    }
  }
  return true;
}

let failed = 0;
for (const [name, data, expectTypes, pin] of GRAPHS) {
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
  if (!pinLoraBody(name, onReqs, pin)) continue;
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

// leftover size on the DEFAULT (njs) paid path — #414 snapped built-in image.run; library posts raw.
{
  const prevImg = catalog.image.slice();
  const leftoverGraphs = [
    ["leftover 2k → qwen-image-3", {
      nodes: [node("i1", "image", { model: "qwen-image-3", prompt: "a fox", variations: "1", size: "2k" })],
      links: [],
    }, {
      id: "qwen-image-3",
      supported_parameters: { resolutions: ["auto", "1024x1024", "512x512", "768x1024"] },
    }, "2k"],
    ["leftover 1024x1024 → FIBO 1.5", {
      nodes: [node("i1", "image", { model: "bria/fibo-generate-1.5/text-to-image", prompt: "a still", variations: "1", size: "1024x1024" })],
      links: [],
    }, {
      id: "bria/fibo-generate-1.5/text-to-image",
      supported_parameters: { resolutions: ["1mp", "4mp"] },
    }, "1024x1024"],
  ];
  try {
    for (const [name, data, raw, leftover] of leftoverGraphs) {
      catalog.image = [raw];
      const listed = raw.supported_parameters.resolutions;

      calls.length = 0;
      const offApp = flaggedEngine(false, []);
      await offApp.runGraph(offApp.materialize(data), {}).catch(() => {});
      const bodyOf = (c) => (c.body && typeof c.body === "object") ? c.body : (() => { try { return JSON.parse(c.body); } catch { return {}; } })();
      const offPaid = calls.filter(paid);
      const offSizes = offPaid.map((c) => bodyOf(c).size);

      calls.length = 0;
      const spy = [];
      const onApp = flaggedEngine(true, spy);
      await onApp.runGraph(onApp.materialize(data), {}).catch(() => {});
      const onPaid = calls.filter(paid);
      const onSizes = onPaid.map((c) => bodyOf(c).size);

      if (!spy.includes("image")) {
        failed++;
        console.log(`✗ ${name}: delegation did not engage (spy: ${spy.join(", ") || "nothing"})`);
        continue;
      }
      if (!offSizes.length || !onSizes.length) {
        failed++;
        console.log(`✗ ${name}: no image POST (off=${offSizes} on=${onSizes})`);
        continue;
      }
      if (offSizes.includes(leftover) || onSizes.includes(leftover)) {
        failed++;
        console.log(`✗ ${name}: leftover ${leftover} still posted (off=${offSizes} on=${onSizes})`);
        continue;
      }
      if (offSizes.some((s) => !listed.includes(String(s))) || onSizes.some((s) => !listed.includes(String(s)))) {
        failed++;
        console.log(`✗ ${name}: snapped size not in catalog (off=${offSizes} on=${onSizes})`);
        continue;
      }
      if (JSON.stringify(offPaid.map(norm).sort()) !== JSON.stringify(onPaid.map(norm).sort())) {
        failed++;
        console.log(`✗ ${name}: flag-on requests differ from flag-off`);
        continue;
      }
      console.log(`✓ ${name} → ${onSizes[0]} on both engines (leftover ${leftover} not posted)`);
    }
  } finally {
    catalog.image = prevImg;
  }
}

// vision gate on the DEFAULT (njs) paid path: a wired image on a KNOWN text-only model must be
// stripped before the library sees it — live 400 "does not support image inputs" on
// mistralai/mistral-small-24b-instruct-2501 (Choice-wired model). Flag-on must equal flag-off
// (text-only body, no image_url anywhere), and the library runner must still run (strip in the
// shim thunk, not a veto — vision models keep delegating untouched).
{
  const prevChat = catalog.chat.slice();
  const MISTRAL = "mistralai/mistral-small-24b-instruct-2501";
  const data = {
    nodes: [node("u1", "upload", { image: IMG }), node("t1", "text", { text: "Describe" }), node("m1", "llm", { model: MISTRAL, prompt: "hi" })],
    links: [link("u1", "image", "m1", "img1"), link("t1", "text", "m1", "prompt")],
  };
  const imgParts = (c) => (c.body.messages || [])
    .flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === "image_url");
  try {
    catalog.chat = [{ id: MISTRAL, capabilities: {} }];   // present, no vision flag = known text-only (the live shape)
    const bodies = {};
    let ran = true;
    for (const flag of [false, true]) {
      calls.length = 0;
      const spy = [];
      const app = flaggedEngine(flag, spy);
      await app.runGraph(app.materialize(data), {}).catch(() => {});
      const chat = calls.filter(paid);
      if (!chat.length) { failed++; console.log(`✗ llm wired image on text-only (flag ${flag ? "on" : "off"}): no chat POST`); ran = false; break; }
      bodies[flag ? "on" : "off"] = chat.map(norm).sort();
      if (flag && !spy.includes("llm")) { failed++; console.log("✗ llm wired image on text-only: library runner never ran (expected strip-in-shim, not veto)"); ran = false; }
    }
    if (ran) {
      if (JSON.stringify(bodies.off) !== JSON.stringify(bodies.on)) {
        failed++;
        console.log(`✗ llm wired image on text-only: flag-on requests differ from flag-off\n  off: ${bodies.off.join("\n       ")}\n  on:  ${bodies.on.join("\n       ")}`);
      } else if (calls.filter(paid).some((c) => imgParts(c).length)) {
        failed++;
        console.log("✗ llm wired image on text-only: an image_url part was posted to a text-only model");
      } else {
        console.log("✓ llm wired image on text-only → text-only body on both engines (no image_url, still delegated)");
      }
    }
  } finally {
    catalog.chat = prevChat;
  }
}

const total = GRAPHS.length + VETO_GRAPHS.length;

// Classifier lockstep: index.html + play RUNTIME (not the generated njs-engine
// block) must agree on qwen21 family, cap, image gate, and body shape.
// Twin-drift only hashes source lines — deleting qwen21 from BOTH files still
// updates the baseline. These pins name the billed contract.
{
  function extractFn(src, name, deps = []) {
    const grab = (n) => {
      const decl = new RegExp("function\\s+" + n + "\\s*\\(");
      const m = decl.exec(src);
      if (!m) throw new Error(n + "() not found");
      const open = src.indexOf("{", m.index);
      let depth = 0;
      for (let i = open; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}" && --depth === 0) return src.slice(m.index, i + 1);
      }
      throw new Error(n + "(): unbalanced braces");
    };
    return new Function([...deps, name].map(grab).join("\n") + "\nreturn " + name + ";")();
  }
  const playSrc = html.replace(/<!-- NJS-ENGINE:BEGIN[\s\S]*?NJS-ENGINE:END -->/, "");
  const indexSrc = readFileSync(join(ROOT, "index.html"), "utf8");
  const load = (src) => ({
    loraFamily: extractFn(src, "loraFamily"),
    loraCap: extractFn(src, "loraCap", ["loraFamily"]),
    imageTakesLora: extractFn(src, "imageTakesLora"),
    loraBodyFor: extractFn(src, "loraBodyFor", ["loraFamily"]),
  });
  const surfaces = [
    ["play RUNTIME", load(playSrc)],
    ["index.html", load(indexSrc)],
  ];
  const items3 = [
    { url: LORA_A, scale: 1 },
    { url: LORA_B, scale: 0.8 },
    { url: LORA_C, scale: 0.5 },
  ];
  const wantBody3 = {
    lora_url_1: LORA_A, lora_scale_1: 1,
    lora_url_2: LORA_B, lora_scale_2: 0.8,
    lora_url_3: LORA_C, lora_scale_3: 0.5,
  };
  let clfFail = 0;
  for (const [label, fns] of surfaces) {
    const checks = [
      [fns.loraFamily("wavespeed-ai/qwen-image-2.1/text-to-image-lora") === "qwen21", "qwen21 t2i-lora is qwen21, not flux"],
      [fns.loraFamily("wavespeed-ai/qwen-image-2.1/edit-lora") === "qwen21", "qwen21 edit-lora is qwen21, not flux"],
      [fns.loraFamily("qwen-image-2.1/text-to-image-lora") === "qwen21", "v1-form qwen21 t2i-lora is qwen21"],
      [fns.loraFamily("wavespeed-ai/qwen-image-2.1/text-to-image") == null, "plain qwen21 t2i is not a LoRA family"],
      [fns.loraFamily("wavespeed-ai/qwen-image-2.1/edit") == null, "plain qwen21 edit is not a LoRA family"],
      [fns.loraFamily("flux-lora") === "flux", "flux-lora stays flux"],
      [fns.loraCap("wavespeed-ai/qwen-image-2.1/edit-lora") === 3, "qwen21 cap is 3"],
      [fns.loraCap("flux-lora") === 1, "flux-lora cap is 1"],
      [fns.imageTakesLora("wavespeed-ai/qwen-image-2.1/edit-lora") === true, "qwen21 edit-lora shows the LoRA box"],
      [fns.imageTakesLora("wavespeed-ai/qwen-image-2.1/text-to-image") === false, "plain qwen21 t2i hides the LoRA box"],
      [JSON.stringify(fns.loraBodyFor("wavespeed-ai/qwen-image-2.1/text-to-image-lora", items3)) === JSON.stringify(wantBody3), "qwen21 t2i body is lora_url_1..3"],
      [JSON.stringify(fns.loraBodyFor("wavespeed-ai/qwen-image-2.1/edit-lora", items3)) === JSON.stringify(wantBody3), "qwen21 edit body is lora_url_1..3"],
      [JSON.stringify(fns.loraBodyFor("flux-lora", items3.slice(0, 1))) === JSON.stringify({ lora_url: LORA_A, lora_strength: 1 }), "flux-lora body is lora_url/lora_strength"],
    ];
    for (const [ok, msg] of checks) {
      if (!ok) {
        clfFail++;
        console.log(`✗ ${label}: ${msg}`);
      }
    }
  }
  failed += clfFail;
  if (!clfFail) console.log("✓ qwen21 classifier + body shape lockstep (index.html ↔ play RUNTIME)");
}

if (failed) {
  console.log(`\n${failed}/${total} delegation scenarios failed`);
  process.exit(1);
}
console.log(`\n✓ njs-delegation: flag-gated runGraph delegation matches the built-in path (${GRAPHS.length} scenarios + ${VETO_GRAPHS.length} veto scenarios)`);
