#!/usr/bin/env node
// Provider-relative content URLs (Grok Imagine returns
// /api/generate-video/content?runId=… which 307s, with the API key, to a private
// presigned file). The editor and play runtimes, and the embedded engine, must
// resolve that path at the node boundary into an absolute URL the next node can
// read — without downloading the file, and without leaking the key or the
// presigned query into errors. Mock fetch only. No network, no API spend.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "./play-engine.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "test-api-key";
const RELATIVE = "/api/generate-video/content?runId=grok1&model=grok-imagine-video-1.5-lite";
const PRESIGNED = "https://files.example/clip.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE&X-Amz-Signature=SUPERSECRET";
const EXT_URL = "https://cdn.example/ext.mp4";
const MP4 = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) { failed++; console.log("  ✗ " + msg); }
  else console.log("  ✓ " + msg);
};

function assertNoSecrets(text, extra = []) {
  const s = String(text);
  ok(!s.includes(KEY), "API key must not appear in: " + s.slice(0, 180));
  ok(!/SUPERSECRET/i.test(s), "presigned signature must not appear in: " + s.slice(0, 180));
  ok(!/X-Amz-/i.test(s), "presigned query must not appear in: " + s.slice(0, 180));
  for (const bit of extra) ok(!s.includes(bit), bit + " must not appear in: " + s.slice(0, 180));
}

function header(headers, name) {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  if (typeof headers.get === "function") return headers.get(name);
  for (const k of Object.keys(headers)) if (k.toLowerCase() === want) return headers[k];
  return undefined;
}

function jsonRes(obj, status = 200, extra = {}) {
  const text = JSON.stringify(obj);
  const bag = Object.assign({ "content-type": "application/json" }, extra);
  return {
    ok: status >= 200 && status < 300,
    status,
    type: "basic",
    headers: { get: (k) => bag[String(k).toLowerCase()] ?? null },
    json: async () => obj,
    text: async () => text,
    blob: async () => new Blob([text]),
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    body: { cancel: async () => {} },
  };
}

function rawRes({ status = 200, headers = {}, body = new Uint8Array() } = {}) {
  const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(String(body));
  const bag = {};
  for (const k of Object.keys(headers)) bag[k.toLowerCase()] = headers[k];
  return {
    ok: status >= 200 && status < 300,
    status,
    type: "basic",
    headers: { get: (k) => bag[String(k).toLowerCase()] ?? null },
    json: async () => { throw new Error("not json"); },
    text: async () => new TextDecoder().decode(bytes),
    blob: async () => new Blob([bytes]),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    body: { cancel: async () => {} },
  };
}

// One mock for a Grok → extend chain. `content` answers the content GET.
// File hosts are refused until allowFile() — the run must not download them.
function chainFetch(content) {
  const seen = [];
  let allowFile = false;
  const statuses = [
    { data: { status: "COMPLETED", output: { video: { url: RELATIVE } } } },
    { data: { status: "COMPLETED", output: { video: { url: EXT_URL } } } },
    { data: { status: "COMPLETED", output: { video: { url: "https://cdn.example/ext2.mp4" } } } },
  ];
  let posts = 0;
  const fn = async (url, init = {}) => {
    const u = new URL(String(url), "https://nano-gpt.com");
    const rec = {
      href: u.href,
      pathname: u.pathname,
      method: String(init.method || "GET").toUpperCase(),
      headers: init.headers || {},
      redirect: init.redirect,
      body: init.body,
    };
    seen.push(rec);
    if (u.hostname === "files.example" || u.hostname === "cdn.example") {
      if (!allowFile) throw new Error("file host fetched during the run: " + u.origin + u.pathname);
      if (header(rec.headers, "authorization") || header(rec.headers, "x-api-key"))
        throw new Error("API key was sent to the file host");
      return rawRes({ headers: { "content-type": "video/mp4" }, body: MP4 });
    }
    if (u.pathname === "/api/generate-video" && rec.method === "POST") {
      posts++;
      const id = posts === 1 ? "grok1" : "ext" + (posts - 1);
      return jsonRes({ runId: id, cost: 0.1 }, 200, { "x-remaining-balance": "9.5", "x-cost": "0.1" });
    }
    if (u.pathname === "/api/video/status") {
      return jsonRes(statuses.shift() || { data: { status: "COMPLETED", output: { url: EXT_URL } } }, 200, { "x-remaining-balance": "9.5" });
    }
    if (u.pathname === "/api/generate-video/content" || u.pathname === "/api/images/content" || u.pathname === "/v1/audio/content") {
      return content(u, rec);
    }
    if (/\/models/.test(u.pathname) || u.pathname === "/api/check-balance") return jsonRes({ data: [] });
    return jsonRes({});
  };
  fn.seen = seen;
  fn.allowFile = () => { allowFile = true; };
  return fn;
}

function redirectContent() {
  return async () => rawRes({ status: 307, headers: { location: PRESIGNED }, body: "" });
}

const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
const link = (from, fp, to, tp) => ({ id: from + "-" + to, from: { node: from, port: fp }, to: { node: to, port: tp } });

function chainGraph() {
  return {
    nodes: [
      node("open", "tvideo", { model: "grok-imagine-video-1.5-lite", prompt: "a boat" }),
      node("ext1", "vedit", { model: "minimax/h3-max-turbo/extend-video", prompt: "keep sailing", modelOpts: { output: "extended" } }),
    ],
    links: [link("open", "video", "ext1", "video")],
  };
}

function contentCalls(seen) {
  return seen.filter((r) => r.pathname === "/api/generate-video/content");
}
function videoPosts(seen) {
  return seen.filter((r) => r.pathname === "/api/generate-video" && r.method === "POST");
}
function bodyOf(rec) {
  const raw = rec && rec.body;
  if (raw && typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

async function playChain() {
  console.log("\nplay built-in: Grok relative URL → extend-video");
  const fetch = chainFetch(redirectContent());
  const app = loadEngine((ctx) => { ctx.fetch = fetch; });
  const outs = {};
  const errors = [];
  await app.runGraph(app.materialize(chainGraph()), {
    onResult: (n) => { outs[n.id] = n.out; },
    onStatus: (id, kind, msg) => { if (kind === "error") errors.push(id + ": " + msg); },
  });
  ok(errors.length === 0, "run has no node errors (" + errors.join(" | ") + ")");
  const posts = videoPosts(fetch.seen);
  ok(posts.length === 2, "two generate-video submits (got " + posts.length + ")");
  const ext = bodyOf(posts[1]);
  ok(!!ext && ext.model === "minimax/h3-max-turbo/extend-video", "extend model is H3 extend-video");
  ok(!!ext && ext.output === "extended", "extend sends modelOpts.output");
  ok(!!ext && ext.videoUrl === PRESIGNED, "extend videoUrl is the absolute presigned URL (got " + (ext && ext.videoUrl) + ")");
  ok(!!ext && !("videoDataUrl" in ext), "extend does not inline the clip");
  ok(!!ext && !String(ext.videoUrl || "").includes(RELATIVE), "extend body does not carry the relative path");
  ok(!!ext && !String(ext.videoUrl || "").includes(KEY), "extend videoUrl does not contain the key");
  ok(outs.open && outs.open.video === PRESIGNED, "opening node output is the absolute URL");
  const hits = contentCalls(fetch.seen);
  ok(hits.length === 1, "content endpoint is fetched once (got " + hits.length + ")");
  if (hits[0]) {
    ok(hits[0].redirect === "manual", "content fetch uses redirect:manual (got " + hits[0].redirect + ")");
    ok(header(hits[0].headers, "authorization") === "Bearer " + KEY, "content fetch sends the bearer key");
    ok(header(hits[0].headers, "x-api-key") === KEY, "content fetch sends x-api-key");
    ok(hits[0].href.startsWith("https://nano-gpt.com/api/generate-video/content?"), "content URL is joined onto the NanoGPT base");
    ok(!hits[0].href.includes(KEY), "content URL does not contain the key");
  }
  ok(!fetch.seen.some((r) => r.href.startsWith("https://files.example") || r.href.startsWith("https://cdn.example")), "presigned and CDN hosts are not fetched during the run");
  fetch.allowFile();
  const got = await fetch(PRESIGNED);
  const bytes = new Uint8Array(await got.arrayBuffer());
  ok(got.status === 200 && bytes.length === MP4.length && bytes[4] === 0x66, "presigned URL is readable without the API key");
  assertNoSecrets(errors.join("\n"));
}

async function playScrub() {
  console.log("\nplay built-in: content errors scrub the key and the presigned query");
  const fetch = chainFetch(async () => rawRes({
    status: 500,
    body: "bad " + KEY + " Bearer " + KEY + " see " + PRESIGNED,
  }));
  const app = loadEngine((ctx) => { ctx.fetch = fetch; });
  const errors = [];
  await app.runGraph(app.materialize({ nodes: [node("open", "tvideo", { model: "grok-imagine-video-1.5-lite", prompt: "a boat" })], links: [] }), {
    onStatus: (id, kind, msg) => { if (kind === "error") errors.push(String(msg)); },
  });
  ok(errors.length === 1, "the failed content fetch surfaces as a node error (got " + errors.length + ")");
  ok(/HTTP 500/.test(errors[0] || ""), "error names the HTTP status");
  assertNoSecrets(errors.join("\n"), ["grok1", "grok-imagine"]);
}

async function playOverCap() {
  console.log("\nplay built-in: an over-cap body with no redirect is refused locally");
  let pulled = false;
  const fetch = chainFetch(async () => {
    const res = rawRes({ status: 200, headers: { "content-type": "video/mp4", "content-length": "4900000" }, body: "not-inlined" });
    const real = res.arrayBuffer;
    res.arrayBuffer = async () => { pulled = true; return real(); };
    return res;
  });
  const app = loadEngine((ctx) => { ctx.fetch = fetch; });
  const errors = [];
  await app.runGraph(app.materialize({ nodes: [node("open", "tvideo", { model: "grok-imagine-video-1.5-lite", prompt: "a boat" })], links: [] }), {
    onStatus: (id, kind, msg) => { if (kind === "error") errors.push(String(msg)); },
  });
  ok(/too large to send inline/.test(errors[0] || "") && /did not redirect/.test(errors[0] || ""), "over-cap content is refused (" + (errors[0] || "") + ")");
  ok(!pulled, "the over-cap body is not downloaded");
  assertNoSecrets(errors.join("\n"), ["grok1", "not-inlined"]);
}

async function playInline() {
  console.log("\nplay built-in: a small 200 is inlined and extend receives videoDataUrl");
  const fetch = chainFetch(async () => rawRes({ status: 200, headers: { "content-type": "video/mp4" }, body: MP4 }));
  const app = loadEngine((ctx) => { ctx.fetch = fetch; });
  const outs = {};
  const errors = [];
  await app.runGraph(app.materialize(chainGraph()), {
    onResult: (n) => { outs[n.id] = n.out; },
    onStatus: (id, kind, msg) => { if (kind === "error") errors.push(id + ": " + msg); },
  });
  ok(errors.length === 0, "inline run has no node errors (" + errors.join(" | ") + ")");
  const ext = bodyOf(videoPosts(fetch.seen)[1]);
  ok(!!ext && typeof ext.videoDataUrl === "string" && ext.videoDataUrl.startsWith("data:video/mp4;base64,"), "extend inlines a video/mp4 data URL");
  ok(!!ext && !("videoUrl" in ext), "inline extend does not also send videoUrl");
  ok(outs.open && outs.open.video === (ext && ext.videoDataUrl), "opening output is that same data URL");
  assertNoSecrets(JSON.stringify(ext || {}) + errors.join("\n"));
}

async function playPassthrough() {
  console.log("\nplay built-in: an ordinary https video URL is not fetched");
  const cdn = "https://cdn.example/plain.mp4";
  const fetch = chainFetch(redirectContent());
  fetch.seen.length = 0;
  // Replace the first status with a CDN url by using a one-node graph and a custom content that should never run.
  const statuses = [{ data: { status: "COMPLETED", output: { video: { url: cdn } } } }];
  const wrapped = async (url, init) => {
    const u = new URL(String(url), "https://nano-gpt.com");
    if (u.pathname === "/api/video/status") return jsonRes(statuses.shift() || { data: { status: "FAILED" } }, 200, { "x-remaining-balance": "9.5" });
    return fetch(url, init);
  };
  const seen = [];
  const app = loadEngine((ctx) => {
    ctx.fetch = async (url, init) => {
      seen.push(String(url));
      return wrapped(url, init);
    };
  });
  const outs = {};
  const errors = [];
  await app.runGraph(app.materialize({ nodes: [node("open", "tvideo", { model: "veo", prompt: "a boat" })], links: [] }), {
    onResult: (n) => { outs[n.id] = n.out; },
    onStatus: (id, kind, msg) => { if (kind === "error") errors.push(String(msg)); },
  });
  ok(errors.length === 0, "cdn run has no node errors (" + errors.join(" | ") + ")");
  ok(outs.open && outs.open.video === cdn, "ordinary https URL is returned unchanged");
  ok(!seen.some((u) => u.startsWith(cdn)), "the CDN url is not fetched");
}

function loadBundle() {
  const vendor = readFileSync(join(ROOT, "vendor/njs-engine.js"), "utf8");
  const m = /^\/\* data-hash=([0-9a-f]{16}) \*\/\n([\s\S]*)\n$/.exec(vendor);
  if (!m) throw new Error("vendor/njs-engine.js has no data-hash header");
  const play = readFileSync(join(ROOT, "play.html"), "utf8");
  const pm = /<script id="njs-engine" data-hash="([0-9a-f]{16})">/.exec(play);
  if (!pm || pm[1] !== m[1]) throw new Error("play.html engine hash does not match vendor");
  const w = {};
  new Function("window", m[2])(w);
  return w.NanoodleEngine;
}

async function engineUnits(E) {
  console.log("\nengine: resolveContentUrl matrix");
  const client = (fetch) => new E.NanoClient({ apiKey: KEY, baseUrl: "https://nano-gpt.com", fetch, pollIntervals: { video: 0, audio: 0 } });

  {
    const seen = [];
    const out = await client(async (url, init) => {
      seen.push({ url: String(url), headers: init.headers, redirect: init.redirect });
      return rawRes({ status: 307, headers: { location: PRESIGNED } });
    }).resolveContentUrl(RELATIVE);
    ok(out === PRESIGNED, "relative content URL resolves to the presigned absolute URL");
    ok(seen.length === 1 && seen[0].redirect === "manual", "one manual redirect fetch");
    ok(seen[0] && seen[0].headers.Authorization === "Bearer " + KEY && seen[0].headers["x-api-key"] === KEY, "key is sent only on the content request");
    ok(seen[0] && seen[0].url.startsWith("https://nano-gpt.com/api/generate-video/content?runId=grok1"), "path is joined onto the base");
  }
  {
    const out = await client(async () => rawRes({
      status: 307,
      headers: { location: PRESIGNED, "content-length": "4900000", "content-type": "video/mp4" },
    })).resolveContentUrl(RELATIVE);
    ok(out === PRESIGNED && !out.startsWith("data:"), "a 4.9 MB redirect is returned, not inlined");
  }
  {
    const out = await client(async (url) => {
      if (!String(url).startsWith("https://nano-gpt.com/api/")) throw new Error("followed a non-API hop");
      return rawRes({ status: 302, headers: { location: "/files/clip.mp4?X-Amz-Signature=SUPERSECRET" } });
    }).resolveContentUrl(RELATIVE);
    ok(out === "https://nano-gpt.com/files/clip.mp4?X-Amz-Signature=SUPERSECRET", "relative Location is joined and not downloaded");
  }
  {
    const small = await client(async () => rawRes({ status: 200, headers: { "content-type": "video/mp4" }, body: MP4 })).resolveContentUrl(RELATIVE);
    ok(small.startsWith("data:video/mp4;base64,"), "a small 200 is a video/mp4 data URL");
    const bytes = E.dataUrlBytes(small).bytes;
    ok(bytes.length === MP4.length && bytes[4] === 0x66, "inlined bytes round-trip");
  }
  {
    let err = null;
    try {
      await client(async () => rawRes({ status: 200, headers: { "content-type": "video/mp4", "content-length": "4900000" }, body: "not-inlined" })).resolveContentUrl(RELATIVE);
    } catch (e) { err = e; }
    ok(err && /too large to send inline/.test(err.message) && /did not redirect/.test(err.message), "over-cap 200 throws");
    assertNoSecrets(err && err.message, ["grok1", "not-inlined"]);
  }
  {
    let err = null;
    try {
      await client(async () => rawRes({ status: 500, body: "bad " + KEY + " Bearer " + KEY + " see " + PRESIGNED })).resolveContentUrl(RELATIVE);
    } catch (e) { err = e; }
    ok(err && /HTTP 500/.test(err.message), "HTTP 500 is reported");
    assertNoSecrets(err && err.message, ["grok1", "grok-imagine"]);
  }
  {
    const c = client(async () => { throw new Error("should not fetch " + KEY + " " + PRESIGNED); });
    ok(await c.resolveContentUrl("https://cdn.example/ok.mp4") === "https://cdn.example/ok.mp4", "ordinary https is not fetched");
    ok(await c.resolveContentUrl("data:video/mp4;base64,AAAA") === "data:video/mp4;base64,AAAA", "data: is not fetched");
    ok(await c.resolveContentUrl("/files/clip.mp4") === "https://nano-gpt.com/files/clip.mp4", "a public relative file becomes absolute without a fetch");
  }
  {
    let err = null;
    const ref = new E.MediaRef(PRESIGNED + "&x-api-key=" + KEY, { fetch: async () => ({ ok: false, status: 403, headers: { get: () => null } }) });
    try { await ref.bytes(); } catch (e) { err = e; }
    ok(err && /403/.test(err.message) && /https:\/\/files\.example\/clip\.mp4/.test(err.message), "download errors keep origin and path");
    assertNoSecrets(err && err.message);
  }
}

async function engineChain(E) {
  console.log("\nengine Workflow: Grok relative URL → extend-video");
  const fetch = chainFetch(redirectContent());
  const wf = E.Workflow.fromJSON(chainGraph(), {
    apiKey: KEY,
    baseUrl: "https://nano-gpt.com",
    fetch,
    pollIntervals: { video: 0, audio: 0 },
  });
  let result;
  try { result = await wf.run({}); }
  catch (e) {
    ok(false, "workflow run threw: " + (e && e.message));
    if (e && e.result) console.log("  result errors", JSON.stringify(e.result.errors));
    return;
  }
  const posts = videoPosts(fetch.seen);
  const ext = bodyOf(posts[1]);
  ok(posts.length === 2, "engine submits twice (got " + posts.length + ")");
  ok(!!ext && ext.videoUrl === PRESIGNED, "engine extend videoUrl is the presigned URL (got " + (ext && ext.videoUrl) + ")");
  ok(!!ext && ext.output === "extended" && !("videoDataUrl" in ext), "engine extend sends output and no videoDataUrl");
  ok(result.nodes.open.out.video === PRESIGNED, "engine opening output is the absolute URL");
  ok(contentCalls(fetch.seen).length === 1, "engine fetches the content endpoint once");
  ok(!fetch.seen.some((r) => /files\.example|cdn\.example/.test(r.href)), "engine does not download the file during the run");
  const fileHits = fetch.seen.filter((r) => r.pathname.startsWith("/files/"));
  ok(fileHits.every((r) => !header(r.headers, "authorization") && !header(r.headers, "x-api-key")), "no /files/ request carries the key");
  fetch.allowFile();
  const got = await fetch(PRESIGNED);
  const bytes = new Uint8Array(await got.arrayBuffer());
  ok(bytes.length === MP4.length && bytes[4] === 0x66, "engine's absolute URL is readable without the key");
  assertNoSecrets(JSON.stringify(result.errors || []));
}

const E = loadBundle();
await playChain();
await playScrub();
await playOverCap();
await playInline();
await playPassthrough();
await engineUnits(E);
await engineChain(E);

if (failed) {
  console.error("\n✗ content-url: " + failed + " assertion(s) failed.");
  process.exit(1);
}
console.log("\n✓ content-url: relative NanoGPT content URLs chain as absolute readable URLs, and secrets stay out of errors.");
