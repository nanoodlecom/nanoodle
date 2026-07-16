#!/usr/bin/env node
// Dual-engine payload parity: play.html RUNTIME_JS (NoodleApp.runGraph) vs
// sibling nanoodle-js (Workflow.run). Same graph + recording fetch → same
// NanoGPT request bodies. This is the safety net before replacing the custom
// browser processor with the package (replace-prep Phase B).
//
// Offline, no API spend. Skips cleanly if nanoodle-js is not checked out next
// to this repo (../nanoodle-js or NANOODLE_JS path).
//
// Known intentional diffs (NOT asserted equal yet — catalog lives only in play):
//   - max_input_images caps / drifted-model preflight
//   - seed skip-cache / demo / locale suffixes (library has none by design)

import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, loadEngine, calls } from "./play-engine.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const JS_ROOT = process.env.NANOODLE_JS
  ? resolve(process.env.NANOODLE_JS)
  : resolve(HERE, "../../nanoodle-js");

if (!existsSync(join(JS_ROOT, "src/index.mjs"))) {
  console.log(`⊘ skip js-engine-parity: nanoodle-js not found at ${JS_ROOT}`);
  console.log("  clone it next to nanoodle/ or set NANOODLE_JS=/path/to/nanoodle-js");
  process.exit(0);
}

const { Workflow } = await import(pathToFileURL(join(JS_ROOT, "src/index.mjs")).href);

const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
let _l = 0;
const link = (from, fromPort, to, toPort) => ({
  id: "l" + (++_l),
  from: { node: from, port: fromPort },
  to: { node: to, port: toPort },
});

const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const AUD = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

const DEFAULT_SYSTEM = "You are a helpful, concise assistant.";

/** Deep-sort object keys so video dim key order etc. doesn't false-fail. */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}

/**
 * Normalize a recorded request for deep equality across engines.
 *
 * Intentional known gap (stripped for compare, not a bug either side):
 * nanoodle-js injects the editor's default system string when fields.system is
 * blank (CLI/graphs that never set it). play RUNTIME_JS only sends a system
 * message when the field is non-empty (editor-saved graphs usually have it).
 * When replacing the browser executor, graphs still carry the prefilled field
 * from the editor, so live traffic matches. Dual-run of minimal fixtures
 * without that field is the only place this shows up.
 */
function normReq(r) {
  const url = String(r.url).replace(/\/+$/, "");
  const path = url.replace(/^https?:\/\/[^/]+/i, "");
  let body = r.body == null ? null : JSON.parse(JSON.stringify(r.body));
  if (body && Array.isArray(body.messages) && body.messages[0]?.role === "system"
      && body.messages[0].content === DEFAULT_SYSTEM) {
    body = { ...body, messages: body.messages.slice(1) };
  }
  return { path, body: canon(body) };
}

function stableKey(req) {
  return req.path + "::" + JSON.stringify(req.body);
}

/** Sort requests so parallel-lane ordering differences don't false-fail. */
function sortReqs(reqs) {
  return reqs.map(normReq).sort((a, b) => stableKey(a).localeCompare(stableKey(b)));
}

function recordingFetchFactory(bucket) {
  return async (url, opts = {}) => {
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = opts.body; }
    // FormData (transcribe) — record a marker; body shape parity is covered in nanoodle-js tests
    if (typeof FormData !== "undefined" && opts.body instanceof FormData) {
      body = { __formData: true };
    }
    bucket.push({ url: String(url), body });
    let json = {};
    if (/\/chat\/completions/.test(url)) {
      json = { choices: [{ message: { content: "CHAT_REPLY", reasoning: "THINK_TRACE" } }], cost: 0 };
    } else if (/\/images\/generations/.test(url)) {
      const cnt = Math.max(1, (body && Number(body.n)) || 1);
      json = { data: Array.from({ length: cnt }, (_, i) => ({ b64_json: "IMG" + i })), cost: 0 };
    } else if (/\/generate-video/.test(url)) {
      json = { runId: "vid-1", cost: 0 };
    } else if (/\/video\/status/.test(url)) {
      json = { status: "COMPLETED", data: { status: "COMPLETED", output: { video: { url: "https://cdn.example/v.mp4" } } } };
    } else if (/\/audio\/speech/.test(url)) {
      json = { url: "https://cdn.example/a.mp3", cost: 0 };
    } else if (/\/models/.test(url)) {
      json = { data: [] };
    }
    const hdr = { "x-remaining-balance": "9.87", "x-cost": "0" };
    return {
      ok: true, status: 200,
      headers: { get: (k) => hdr[String(k).toLowerCase()] ?? null },
      json: async () => json,
      text: async () => JSON.stringify(json),
      arrayBuffer: async () => new TextEncoder().encode("fake-audio-bytes").buffer,
    };
  };
}

async function runJs(data) {
  const bucket = [];
  const fetchFn = recordingFetchFactory(bucket);
  const wf = Workflow.fromJSON(data, { apiKey: "test-key", fetch: fetchFn, quiet: true });
  try {
    await wf.run({});
  } catch {
    // RunError on sink failure is fine — we only compare paid requests
  }
  return sortReqs(bucket);
}

// Scenarios: network-payload shapes both engines must agree on.
// Skip catalog-only behavior (caps, drift preflight) — intentional library gap.
const SCENARIOS = [
  {
    name: "text → LLM (string content)",
    data: {
      nodes: [node("t1", "text", { text: "Hello world" }), node("m1", "llm", { model: "x" })],
      links: [link("t1", "text", "m1", "prompt")],
    },
  },
  {
    name: "LLM system + prompt fields",
    data: {
      nodes: [node("m1", "llm", { model: "x", system: "You are terse.", prompt: "hi" })],
      links: [],
    },
  },
  {
    name: "LLM image input (multimodal array)",
    data: {
      nodes: [
        node("u1", "upload", { image: IMG }),
        node("t1", "text", { text: "Describe this" }),
        node("m1", "llm", { model: "x" }),
      ],
      links: [
        link("u1", "image", "m1", "img1"),
        link("t1", "text", "m1", "prompt"),
      ],
    },
  },
  {
    name: "LLM audio input (input_audio part)",
    data: {
      nodes: [
        node("u1", "aupload", { audio: "data:audio/wav;base64,QUJD" }),
        node("t1", "text", { text: "Transcribe this" }),
        node("m1", "llm", { model: "x" }),
      ],
      links: [
        link("u1", "audio", "m1", "audio"),
        link("t1", "text", "m1", "prompt"),
      ],
    },
  },
  {
    name: "vision node",
    data: {
      nodes: [
        node("u1", "upload", { image: IMG }),
        node("v1", "vision", { model: "x", q: "What is this?" }),
      ],
      links: [link("u1", "image", "v1", "image")],
    },
  },
  {
    name: "text → image",
    data: {
      nodes: [
        node("t1", "text", { text: "a red panda" }),
        node("i1", "image", { model: "x", size: "1024x1024" }),
      ],
      links: [link("t1", "text", "i1", "prompt")],
    },
  },
  {
    name: "edit single source (imageDataUrl string)",
    data: {
      nodes: [
        node("u1", "upload", { image: IMG }),
        node("e1", "edit", { model: "x", prompt: "make it night" }),
      ],
      links: [link("u1", "image", "e1", "image")],
    },
  },
  {
    name: "edit multi source (imageDataUrl array)",
    data: {
      nodes: [
        node("a", "upload", { image: IMG + "A" }),
        node("b", "upload", { image: IMG + "B" }),
        node("e1", "edit", { model: "x", prompt: "compose" }),
      ],
      links: [
        link("a", "image", "e1", "image"),
        link("b", "image", "e1", "image2"),
      ],
    },
  },
  {
    name: "image variations n:2",
    data: {
      nodes: [
        node("t1", "text", { text: "a cat" }),
        node("i1", "image", { model: "x", variations: "2" }),
      ],
      links: [link("t1", "text", "i1", "prompt")],
    },
  },
  {
    name: "LLM JSON format + reasoning effort",
    data: {
      nodes: [node("m1", "llm", {
        model: "x", prompt: "hi", format: "JSON", reasoningEffort: "high", maxTokens: "50",
      })],
      links: [],
    },
  },
  {
    name: "tvideo dims + prompt",
    data: {
      nodes: [node("t1", "tvideo", {
        model: "x", prompt: "drone shot", duration: "5", aspect: "16:9", resolution: "720p",
      })],
      links: [],
    },
  },
  {
    name: "vedit dims (resolution + aspect + duration)",
    data: {
      nodes: [
        node("s1", "vupload", { video: "https://example/clip.mp4" }),
        node("v1", "vedit", { model: "x", resolution: "1080p", aspect: "9:16", duration: "8" }),
      ],
      links: [link("s1", "video", "v1", "video")],
    },
  },
];

function diffReqs(playReqs, jsReqs) {
  if (playReqs.length !== jsReqs.length) {
    return `request count play=${playReqs.length} js=${jsReqs.length}\n  play: ${playReqs.map((r) => r.path).join(", ")}\n  js:   ${jsReqs.map((r) => r.path).join(", ")}`;
  }
  for (let i = 0; i < playReqs.length; i++) {
    const a = playReqs[i], b = jsReqs[i];
    if (a.path !== b.path) return `path mismatch at #${i}: play ${a.path} vs js ${b.path}`;
    const sa = JSON.stringify(a.body), sb = JSON.stringify(b.body);
    if (sa !== sb) {
      return `body mismatch at #${i} ${a.path}:\n  play: ${sa.slice(0, 400)}\n  js:   ${sb.slice(0, 400)}`;
    }
  }
  return null;
}

async function main() {
  // Warm play engine once (uses scripts/play-engine.mjs recordingFetch → calls[])
  loadEngine();

  let failed = 0;
  for (const sc of SCENARIOS) {
    _l = 0;
    calls.length = 0;
    const playApp = loadEngine();
    const g = playApp.materialize(sc.data);
    await playApp.runGraph(g, {}).catch(() => {});
    // Filter to paid API traffic only (skip catalog GETs if any)
    const playReqs = sortReqs(calls.filter((c) =>
      /\/(chat\/completions|images\/generations|generate-video|audio\/speech|transcriptions)/.test(c.url)));

    const jsReqs = (await runJs(sc.data)).filter((r) =>
      /\/(chat\/completions|images\/generations|generate-video|audio\/speech|transcriptions)/.test(r.path));

    const err = diffReqs(playReqs, jsReqs);
    if (err) {
      failed++;
      process.stdout.write(`✗ ${sc.name}\n  ${err.replace(/\n/g, "\n  ")}\n`);
    } else {
      process.stdout.write(`✓ ${sc.name} (${playReqs.length} req)\n`);
    }
  }

  if (failed) {
    process.stdout.write(`\n${failed}/${SCENARIOS.length} scenarios diverged — fix nanoodle-js or document intentional gaps.\n`);
    process.exit(1);
  }
  process.stdout.write(`\n✓ js-engine-parity: ${SCENARIOS.length} scenarios match play RUNTIME_JS ↔ nanoodle-js\n`);
  process.stdout.write(`  (nanoodle-js @ ${JS_ROOT})\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
