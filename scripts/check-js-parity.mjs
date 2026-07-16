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
import { ROOT, loadEngine, calls, catalog as playCatalog } from "./play-engine.mjs";

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
const { decodePng, encodePngRgba } =
  await import(pathToFileURL(join(JS_ROOT, "src/local-media.mjs")).href);

const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
let _l = 0;
const link = (from, fromPort, to, toPort) => ({
  id: "l" + (++_l),
  from: { node: from, port: fromPort },
  to: { node: to, port: toPort },
});

const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const AUD = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

// ---- inpaint fixtures + headless canvas/Image shim -------------------------
// play's maskToSource composites via <canvas>; the vm context has no DOM, so we
// back Image/canvas with real pixel buffers (same-size composite only — canvas
// resampling is implementation-defined in real browsers, so scaled-mask parity
// is pixel-contract territory the library's own tests cover, not this harness).

// await-wrapped: the sibling's PNG codec is sync today but goes async in the
// browser-safe local-media split (DecompressionStream has no sync form) — await
// keeps this harness working across both versions.
async function pngDataUrl(w, h, rgba) {
  return "data:image/png;base64," + Buffer.from(await encodePngRgba(w, h, rgba)).toString("base64");
}
async function decodePngUrl(u) {
  return decodePng(Buffer.from(String(u).replace(/^data:[^,]*,/, ""), "base64"));
}
function px(w, h, paint) { // paint(x, y) → [r, g, b, a]
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a] = paint(x, y), o = (y * w + x) * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
  }
  return out;
}
const INPAINT_SRC = await pngDataUrl(4, 4, px(4, 4, () => [200, 30, 30, 255]));           // opaque red
const INPAINT_MASK = await pngDataUrl(4, 4, px(4, 4, (x, y) => y < 2 ? [255, 255, 255, 255] : [0, 0, 0, 0])); // brush: top half white, rest transparent

class ImageShim {
  set src(u) {
    decodePngUrl(u).then(
      (p) => {
        this.__px = p;
        this.naturalWidth = p.w;
        this.naturalHeight = p.h;
        this.onload && this.onload();
      },
      (e) => { this.onerror && this.onerror(e); },
    );
  }
}
function makeCanvasShim() {
  const c = {
    width: 0, height: 0, __buf: null,
    getContext() {
      return {
        fillStyle: "",
        fillRect(x, y, w, h) {
          if (x || y || w !== c.width || h !== c.height || !/^#0{3,6}$/.test(this.fillStyle))
            throw new Error("canvas shim: only a full-canvas black fill is supported");
          c.__buf = new Uint8ClampedArray(c.width * c.height * 4);
          for (let i = 3; i < c.__buf.length; i += 4) c.__buf[i] = 255;
        },
        drawImage(img, dx, dy, dw, dh) {
          const p = img && img.__px;
          if (!p) throw new Error("canvas shim: drawImage needs a decoded ImageShim");
          if (dx || dy || dw !== c.width || dh !== c.height || p.w !== c.width || p.h !== c.height)
            throw new Error("canvas shim: only same-size full-canvas drawImage is supported — use same-size fixtures");
          const dst = c.__buf, src = p.rgba;
          for (let i = 0; i < c.width * c.height; i++) {
            const o = i * 4, a = src[o + 3] / 255;   // source-over onto opaque dst
            dst[o] = Math.round(src[o] * a + dst[o] * (1 - a));
            dst[o + 1] = Math.round(src[o + 1] * a + dst[o + 1] * (1 - a));
            dst[o + 2] = Math.round(src[o + 2] * a + dst[o + 2] * (1 - a));
            dst[o + 3] = 255;
          }
        },
      };
    },
    // returns a Promise — play's maskToSource resolve()s it, which flattens fine
    toDataURL() { return pngDataUrl(c.width, c.height, c.__buf); },
  };
  return c;
}
const extendDom = (ctx) => {
  ctx.Image = ImageShim;
  ctx.__createElement = (tag) => (tag === "canvas" ? makeCanvasShim() : null);
};

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
 * No engine-difference allowances: runJs passes { defaults: false } so the
 * library treats graph fields as authoritative, exactly like play RUNTIME_JS
 * (play's UI materializes input defs into node.fields before running — the
 * engine itself never backfills). Parity here is literal.
 */
async function normReq(r) {
  const url = String(r.url).replace(/\/+$/, "");
  const path = url.replace(/^https?:\/\/[^/]+/i, "");
  const body = r.body == null ? null : JSON.parse(JSON.stringify(r.body));
  // maskDataUrl is engine-encoded PNG (canvas toDataURL vs the library's encoder):
  // the API contract is the PIXELS, not the encoder's byte stream — compare decoded.
  if (body && typeof body.maskDataUrl === "string" && body.maskDataUrl.startsWith("data:image/png")) {
    const { w, h, rgba } = await decodePngUrl(body.maskDataUrl);
    body.maskDataUrl = `png-pixels:${w}x${h}:${Buffer.from(rgba).toString("base64")}`;
  }
  return { path, body: canon(body) };
}

function stableKey(req) {
  return req.path + "::" + JSON.stringify(req.body);
}

/** Sort requests so parallel-lane ordering differences don't false-fail. */
async function sortReqs(reqs) {
  const normed = await Promise.all(reqs.map(normReq));
  return normed.sort((a, b) => stableKey(a).localeCompare(stableKey(b)));
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
    // media downloads (fetchMediaDataUrl): same content-type + bytes play-engine's recording
    // fetch serves, so both engines inline the SAME data: URL
    if (!/\/(api|v1)\//.test(String(url))) hdr["content-type"] = "audio/mpeg";
    return {
      ok: true, status: 200,
      headers: { get: (k) => hdr[String(k).toLowerCase()] ?? null },
      json: async () => json,
      text: async () => JSON.stringify(json),
      arrayBuffer: async () => new TextEncoder().encode("fake-audio-bytes").buffer,
    };
  };
}

async function runJs(data, catalog) {
  const bucket = [];
  const fetchFn = recordingFetchFactory(bucket);
  const wf = Workflow.fromJSON(data, { apiKey: "test-key", fetch: fetchFn, quiet: true, catalog });
  try {
    // defaults:false = the play-delegation contract: fields are authoritative,
    // the engine never backfills input defs (play's UI does that itself)
    await wf.run({}, { defaults: false });
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
    name: "LLM audio from an https URL (downloaded + inlined to bytes on both engines)",
    data: {
      nodes: [
        node("u1", "aupload", { audio: "https://cdn.example/song.mp3" }),
        node("t1", "text", { text: "What is being said?" }),
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
  {
    name: "lipsync: image + local audio + dims (happy path, no retry)",
    data: {
      nodes: [
        node("u1", "upload", { image: IMG }),
        node("a1", "aupload", { audio: AUD }),
        node("l1", "lipsync", { model: "x", prompt: "subtle head movement", resolution: "720p" }),
      ],
      links: [link("u1", "image", "l1", "image"), link("a1", "audio", "l1", "audio")],
    },
  },
  {
    name: "inpaint: mask composited onto black @ source size (pixel-level)",
    data: {
      nodes: [node("p1", "inpaint", { model: "x", prompt: "a straw hat", image: INPAINT_SRC, mask: INPAINT_MASK })],
      links: [],
    },
  },
  // ---- catalog-gated scenarios: both engines seeded with the SAME catalog ----
  {
    name: "catalog: llm audio gate — KNOWN text-only model drops input_audio",
    catalog: { chat: [{ id: "text-only", capabilities: {} }] },
    data: {
      nodes: [node("a1", "aupload", { audio: AUD }), node("m1", "llm", { model: "text-only", prompt: "listen", system: "" })],
      links: [link("a1", "audio", "m1", "audio")],
    },
  },
  {
    name: "catalog: llm JSON format stripped for a non-structured_output model",
    catalog: { chat: [{ id: "plain", capabilities: {} }] },
    data: {
      nodes: [node("m1", "llm", { model: "plain", prompt: "hi", system: "", format: "JSON" })],
      links: [],
    },
  },
  {
    name: "catalog: edit refs capped to max_input_images",
    catalog: { image: [{ id: "compositor", supported_parameters: { max_input_images: 2 } }] },
    data: {
      nodes: [
        node("u1", "upload", { image: IMG }), node("u2", "upload", { image: IMG }), node("u3", "upload", { image: IMG }),
        node("e1", "edit", { model: "compositor", prompt: "merge" }),
      ],
      links: [link("u1", "image", "e1", "image"), link("u2", "image", "e1", "image2"), link("u3", "image", "e1", "image3")],
    },
  },
  {
    name: "catalog: image variations clamped to max_output_images",
    catalog: { image: [{ id: "gen", supported_parameters: { max_output_images: 2 } }] },
    data: {
      nodes: [node("i1", "image", { model: "gen", prompt: "a fox", variations: "4" })],
      links: [],
    },
  },
  {
    name: "tvideo refs without catalog → most-common spelling (reference_images, family cap)",
    data: {
      nodes: [
        node("u1", "upload", { image: IMG + "R1" }), node("u2", "upload", { image: IMG + "R2" }),
        node("v1", "tvideo", { model: "seedance-2.0", prompt: "morph" }),
      ],
      links: [link("u1", "image", "v1", "ref1"), link("u2", "image", "v1", "ref2")],
    },
  },
  {
    name: "catalog: tvideo refs ride the model's real key, clamped to its declared max",
    catalog: { video: [{ id: "luma-like", supported_parameters: { parameters: {
      reference_image_urls: { max: 1 },
    } } }] },
    data: {
      nodes: [
        node("u1", "upload", { image: IMG + "R1" }), node("u2", "upload", { image: IMG + "R2" }),
        node("v1", "tvideo", { model: "luma-like", prompt: "morph" }),
      ],
      links: [link("u1", "image", "v1", "ref1"), link("u2", "image", "v1", "ref2")],
    },
  },
  {
    name: "catalog: tvideo refs dropped for a KNOWN no-ref model",
    catalog: { video: [{ id: "plain-t2v", supported_parameters: { parameters: {} } }] },
    data: {
      nodes: [node("u1", "upload", { image: IMG }), node("v1", "tvideo", { model: "plain-t2v", prompt: "pan" })],
      links: [link("u1", "image", "v1", "ref1")],
    },
  },
  {
    name: "catalog: vedit refs ride the model's real key (video-edit family)",
    catalog: { video: [{ id: "seedance-edit", supported_parameters: { parameters: {
      reference_images: { max: 9 },
    } } }] },
    data: {
      nodes: [
        node("s1", "vupload", { video: "https://example/clip.mp4" }),
        node("u1", "upload", { image: IMG }),
        node("v1", "vedit", { model: "seedance-edit", prompt: "swap the character" }),
      ],
      links: [link("s1", "video", "v1", "video"), link("u1", "image", "v1", "ref1")],
    },
  },
  {
    name: "catalog: video dims ride the model's wire names (orientation/seconds) + default backfill",
    catalog: { video: [{ id: "sora-like", supported_parameters: { parameters: {
      orientation: { options: [{ value: "landscape" }, { value: "portrait" }], default: "landscape" },
      seconds: { options: [{ value: "4" }, { value: "8" }], default: "8" },
    } } }] },
    data: {
      nodes: [node("t1", "text", { text: "waves" }), node("v1", "tvideo", { model: "sora-like", aspect: "9:16", duration: "" })],
      links: [link("t1", "text", "v1", "prompt")],
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
  loadEngine(extendDom);

  let failed = 0;
  for (const sc of SCENARIOS) {
    _l = 0;
    calls.length = 0;
    // seed the SAME catalog into both engines (empty arrays = no catalog, permissive)
    for (const k of ["chat", "image", "video", "audio"]) playCatalog[k] = (sc.catalog && sc.catalog[k]) || [];
    const playApp = loadEngine(extendDom);
    const g = playApp.materialize(sc.data);
    await playApp.runGraph(g, {}).catch(() => {});
    // Filter to paid API traffic only (skip catalog GETs if any)
    const playReqs = await sortReqs(calls.filter((c) =>
      /\/(chat\/completions|images\/generations|generate-video|audio\/speech|transcriptions)/.test(c.url)));

    const jsReqs = (await runJs(sc.data, sc.catalog)).filter((r) =>
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
