#!/usr/bin/env node
// Leftover 🧊 3D / 📦 mupload edges after #715 regenerated the njs-engine
// with model3d + mupload. Editor stash/serialize/drop/status-url toys live
// in check-3d-*.mjs and open #697 (stash URL). This file pins the headless
// send/scrub those toys never hit: fields.model is media ONLY on mupload
// (an llm/image/model3d model id must not be blanked); mupload missing
// throws locally; blank model3d → tripo3d/v2.5 and image-only refuses
// without an image; catalog-miss accepts either; empty/non-image-text
// modalities fall through (do not invent "neither"); mediaKind model3d;
// empty 3D prompt is omitted from the POST (video still sends "");
// default 3D poll cap is 25 min; a completed video-shaped payload is
// not a GLB. Offline, zero API spend. New file so it does not collide
// with check-3d-edges / check-media-placeholders / #697.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");
const VENDOR = join(ROOT, "vendor", "njs-engine.js");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);
const check = (c, m) => { if (c) ok(m); else fail(m); };

function loadEngine(src, label) {
  const w = {};
  new Function("window", src)(w);
  const E = w.NanoodleEngine;
  if (!E || !E.RUNNERS || !E.materialize || !E.NanoClient || !E.NODE_TYPES) {
    throw new Error(label + ": NanoodleEngine incomplete");
  }
  return E;
}

function engines() {
  const out = [];
  const block = /<script id="njs-engine"[^>]*>\n([\s\S]*?)\n<\/script>/.exec(PLAY);
  if (block) out.push(["play.html #njs-engine", loadEngine(block[1], "play.html #njs-engine")]);
  else fail("play.html is missing the njs-engine script block");
  if (existsSync(VENDOR)) out.push(["vendor/njs-engine.js", loadEngine(readFileSync(VENDOR, "utf8"), "vendor/njs-engine.js")]);
  else fail("vendor/njs-engine.js is missing");
  return out;
}

const GLB = "data:model/gltf-binary;base64,AAAA";
const HTTPS_GLB = "https://cdn.example/cup.glb";
const IMG = "https://cdn.example/still.png";
const TINY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function jsonResp(j) {
  return {
    ok: true, status: 200,
    json: async () => j,
    text: async () => JSON.stringify(j),
    headers: { get: () => null },
  };
}

async function throwsMsg(fn, re) {
  try { await fn(); return false; }
  catch (e) { return re.test(String(e && e.message)); }
}

for (const [label, E] of engines()) {
  console.log(label);

  check(E.NODE_TYPES.model3d && E.NODE_TYPES.model3d.network === true && typeof E.RUNNERS.model3d === "function",
    label + ": model3d is a registered paid runner");
  check(E.NODE_TYPES.mupload && E.NODE_TYPES.mupload.local === true && typeof E.RUNNERS.mupload === "function",
    label + ": mupload is a registered local runner");

  console.log("  materialize scrub");
  const g = E.materialize({
    nodes: [
      { id: "mu1", type: "mupload", fields: { model: "[glb will be provided]" } },
      { id: "mu2", type: "mupload", fields: { model: "/tmp/cup.glb" } },
      { id: "mu3", type: "mupload", fields: { model: "blob:null/preview" } },
      { id: "mu4", type: "mupload", fields: { model: GLB } },
      { id: "mu5", type: "mupload", fields: { model: HTTPS_GLB } },
      { id: "llm", type: "llm", fields: { model: "openai/gpt-6.1-sol", prompt: "hi" } },
      { id: "img", type: "image", fields: { model: "flux-schnell", prompt: "a fox" } },
      { id: "m3", type: "model3d", fields: { model: "tripo3d/v2.5", prompt: "a cup" } },
    ],
    links: [],
  });
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  const warn = (id, field) => (g.warnings || []).some((w) => w.includes("node " + id) && w.includes("fields." + field));
  check(byId.mu1.fields.model === "" && warn("mu1", "model"),
    label + ": mupload prose placeholder is blanked + warned");
  check(byId.mu2.fields.model === "" && warn("mu2", "model"),
    label + ": mupload file path is blanked + warned");
  check(byId.mu3.fields.model === "" && warn("mu3", "model"),
    label + ": mupload blob: is blanked + warned");
  check(byId.mu4.fields.model === GLB && !warn("mu4", "model"),
    label + ": mupload data: GLB is kept");
  check(byId.mu5.fields.model === HTTPS_GLB && !warn("mu5", "model"),
    label + ": mupload https GLB is kept");
  check(byId.llm.fields.model === "openai/gpt-6.1-sol" && !warn("llm", "model"),
    label + ": llm fields.model is an AI id — not scrubbed as media");
  check(byId.img.fields.model === "flux-schnell" && !warn("img", "model"),
    label + ": image fields.model is an AI id — not scrubbed as media");
  check(byId.m3.fields.model === "tripo3d/v2.5" && !warn("m3", "model"),
    label + ": model3d fields.model is an AI id — not scrubbed as media");

  console.log("  mupload runner");
  check(await throwsMsg(() => E.RUNNERS.mupload({ fields: {} }), /no 3D file/),
    label + ": missing GLB throws locally (does not invent a network call)");
  const opt = await E.RUNNERS.mupload({ fields: { optional: true } });
  check(opt && opt.model === "",
    label + ": optional empty mupload returns a blank model port");
  const got = await E.RUNNERS.mupload({ fields: { model: HTTPS_GLB } });
  check(got && got.model === HTTPS_GLB,
    label + ": mupload returns fields.model as-is (no NanoGPT hop)");

  console.log("  model3d runner");
  check(await throwsMsg(() => E.RUNNERS.model3d({ fields: {} }, {}, { catalog: {}, video: async () => "u" }), /Connect an image first/),
    label + ": blank model is tripo3d/v2.5 (image-only) and refuses without an image");
  check(await throwsMsg(() => E.RUNNERS.model3d({ fields: { model: "unknown/id" } }, {}, { catalog: { model3d: [] }, video: async () => "u" }), /prompt or connect an image/),
    label + ": catalog-miss unknown id accepts either — empty still refuses");

  let sent = null;
  const notes = [];
  const ran = await E.RUNNERS.model3d(
    { fields: { model: "  " } },
    { image: IMG },
    {
      catalog: {},
      fitImage: async (u) => u,
      progress: (m) => notes.push(m),
      video: async (model, prompt, opts, image) => { sent = { model, prompt, opts, image }; return HTTPS_GLB; },
    }
  );
  check(ran && ran.model === HTTPS_GLB,
    label + ": runner returns the GLB on the model port");
  check(sent && sent.model === "tripo3d/v2.5" && sent.opts && sent.opts.mediaKind === "model3d",
    label + ": whitespace model → tripo3d/v2.5 with mediaKind model3d");
  check(sent && sent.prompt === "" && sent.image === IMG,
    label + ": image-only send keeps the image and a blank prompt (client omits the key)");

  const audioMods = { model3d: [{ id: "tripo3d/v2.5", modalities: ["audio", "video"] }] };
  check(await throwsMsg(() => E.RUNNERS.model3d({ fields: { model: "tripo3d/v2.5" } }, {}, { catalog: audioMods, video: async () => "u" }), /Connect an image first/),
    label + ": modalities without image/text fall through to the tripo image-only default (do not invent neither)");

  let textSent = null;
  const textNotes = [];
  await E.RUNNERS.model3d(
    { fields: { model: "text-only", prompt: "a cup" } },
    { image: IMG },
    {
      catalog: { model3d: [{ id: "text-only", architecture: { input_modalities: ["text"] } }] },
      fitImage: async (u) => u,
      progress: (m) => textNotes.push(m),
      video: async (model, prompt, opts, image) => { textSent = { model, prompt, image }; return HTTPS_GLB; },
    }
  );
  check(textSent && textSent.prompt === "a cup" && !textSent.image,
    label + ": architecture.input_modalities:['text'] ignores a wired image");
  check(textNotes.some((m) => /text only/i.test(m)),
    label + ": text-only model warns that the image wire is ignored");

  console.log("  NanoClient 3D POST / poll");
  check(new E.NanoClient({ apiKey: "k" }).timeouts.model3d === 25 * 60 * 1000,
    label + ": default 3D poll cap is 25 minutes");

  const posts = [];
  const client = new E.NanoClient({
    apiKey: "k",
    pollIntervals: { video: 1, model3d: 1 },
    fetch: async (url, opts) => {
      const path = String(url);
      if (/\/api\/generate-video/.test(path) && opts && opts.method === "POST") {
        posts.push(JSON.parse(opts.body));
        return jsonResp({ runId: "r1" });
      }
      if (/\/api\/video\/status/.test(path)) {
        return jsonResp({
          data: { status: "COMPLETED", output: { kind: "3d", format: "glb", model_url: HTTPS_GLB } },
        });
      }
      throw new Error("unexpected fetch " + path);
    },
  });
  const url3d = await client.video("tripo3d/v2.5", "   ", { mediaKind: "model3d" }, TINY);
  check(url3d === HTTPS_GLB, label + ": 3D poll returns model_url");
  check(posts[0] && posts[0].model === "tripo3d/v2.5" && !Object.prototype.hasOwnProperty.call(posts[0], "prompt"),
    label + ": empty/whitespace 3D prompt is omitted from the POST (image-only models 400 on \"\")");

  posts.length = 0;
  const vidClient = new E.NanoClient({
    apiKey: "k",
    pollIntervals: { video: 1 },
    fetch: async (url, opts) => {
      const path = String(url);
      if (/\/api\/generate-video/.test(path) && opts && opts.method === "POST") {
        posts.push(JSON.parse(opts.body));
        return jsonResp({ runId: "v1" });
      }
      if (/\/api\/video\/status/.test(path)) {
        return jsonResp({ data: { status: "COMPLETED", output: { video: { url: "https://cdn.example/v.mp4" } } } });
      }
      throw new Error("unexpected fetch " + path);
    },
  });
  await vidClient.video("x", "", {});
  check(posts[0] && posts[0].prompt === "",
    label + ": a video job still posts a blank prompt (the 3D omit must not leak)");

  const noUrl = new E.NanoClient({
    apiKey: "k",
    pollIntervals: { model3d: 1 },
    fetch: async (url, opts) => {
      const path = String(url);
      if (/\/api\/generate-video/.test(path) && opts && opts.method === "POST") return jsonResp({ runId: "r2" });
      if (/\/api\/video\/status/.test(path)) {
        return jsonResp({
          data: { status: "COMPLETED", output: { video: { url: "https://cdn.example/clip.glb" } } },
        });
      }
      throw new Error("unexpected fetch " + path);
    },
  });
  check(await throwsMsg(() => noUrl.video("tripo3d/v2.5", "", { mediaKind: "model3d" }, TINY), /completed but no model url/),
    label + ": a completed video-shaped payload (no kind 3d / format glb) is not a GLB");
}

if (failed) { console.error("\n✗ check-njs-3d-run-edges: " + failed + " failure(s)"); process.exit(1); }
console.log("✓ check-njs-3d-run-edges — njs mupload scrub / 3D gates / empty-prompt omit hold");
