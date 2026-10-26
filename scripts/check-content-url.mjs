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
import { handleContentResolveRequest, resolveProviderContent } from "../worker/content-resolve.mjs";

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

function opaqueRedirect() {
  return {
    ok: false,
    status: 0,
    type: "opaqueredirect",
    headers: { get: () => null },
    json: async () => { throw new Error("opaque"); },
    text: async () => { throw new Error("opaque"); },
    blob: async () => { throw new Error("opaque"); },
    arrayBuffer: async () => { throw new Error("opaque"); },
    body: { cancel: async () => {} },
  };
}

// Server-side hop walker used by the real /api/resolve-content handler.
// Auth is required on allowlisted NanoGPT content paths and forbidden elsewhere.
function serverHopFetch(hops, location = PRESIGNED) {
  return async (url, init = {}) => {
    const u = new URL(String(url));
    const rec = { href: u.href, pathname: u.pathname, headers: init.headers || {}, redirect: init.redirect };
    hops.push(rec);
    if (u.hostname !== "nano-gpt.com") throw new Error("server fetched " + u.hostname);
    if (header(rec.headers, "authorization") !== "Bearer " + KEY || header(rec.headers, "x-api-key") !== KEY)
      throw new Error("server content hop auth missing or wrong on " + u.pathname);
    if (init.redirect !== "manual") throw new Error("server hop redirect " + init.redirect);
    return rawRes({ status: 307, headers: { location }, body: "" });
  };
}

async function workerResolve(rec, hops, location) {
  if (header(rec.headers, "x-api-key")) throw new Error("resolver POST forwarded x-api-key");
  if (rec.redirect !== "error") throw new Error("resolver POST redirect was " + rec.redirect);
  const req = new Request("https://nanoodle.com/api/resolve-content", {
    method: "POST",
    headers: rec.headers,
    body: typeof rec.body === "string" ? rec.body : JSON.stringify(rec.body || {}),
  });
  return handleContentResolveRequest(req, serverHopFetch(hops, location));
}

// One mock for a Grok → extend chain. `content` answers the content GET.
// File hosts are refused until allowFile() — the run must not download them.
// hooks.resolve answers POST /api/resolve-content (the browser-real opaque path).
function chainFetch(content, hooks = {}) {
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
    if (u.pathname === "/api/resolve-content" && rec.method === "POST") {
      if (header(rec.headers, "x-api-key")) throw new Error("resolver POST forwarded x-api-key");
      if (rec.redirect !== "error") throw new Error("resolver POST redirect was " + rec.redirect);
      if (!hooks.resolve) return jsonRes({ error: "unexpected resolver call" }, 500);
      return hooks.resolve(rec);
    }
    if (u.pathname === "/api/generate-video/content" || u.pathname === "/api/images/content" || u.pathname === "/v1/audio/content" || u.pathname === "/api/v1/audio/content") {
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
  console.log("\nplay built-in: Grok relative URL → extend-video (browser opaqueredirect)");
  const serverHops = [];
  const fetch = chainFetch(async () => opaqueRedirect(), {
    resolve: (rec) => workerResolve(rec, serverHops),
  });
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
  ok(hits.length === 1, "browser content endpoint is fetched once (got " + hits.length + ")");
  if (hits[0]) {
    ok(hits[0].redirect === "manual", "content fetch uses redirect:manual (got " + hits[0].redirect + ")");
    ok(header(hits[0].headers, "authorization") === "Bearer " + KEY, "content fetch sends the bearer key");
    ok(header(hits[0].headers, "x-api-key") === KEY, "content fetch sends x-api-key");
    ok(hits[0].href.startsWith("https://nano-gpt.com/api/generate-video/content?"), "content URL is joined onto the NanoGPT base");
    ok(!hits[0].href.includes(KEY), "content URL does not contain the key");
  }
  const resolvers = fetch.seen.filter((r) => r.pathname === "/api/resolve-content");
  ok(resolvers.length === 1, "one resolver POST (got " + resolvers.length + ")");
  if (resolvers[0]) {
    ok(resolvers[0].redirect === "error", "resolver POST uses redirect:error (got " + resolvers[0].redirect + ")");
    ok(header(resolvers[0].headers, "authorization") === "Bearer " + KEY, "resolver POST sends the bearer key");
    ok(!header(resolvers[0].headers, "x-api-key"), "resolver POST does not send x-api-key");
  }
  ok(serverHops.length === 1, "server walks the content URL once (got " + serverHops.length + ")");
  if (serverHops[0]) {
    ok(serverHops[0].redirect === "manual", "server hop uses redirect:manual");
    ok(header(serverHops[0].headers, "authorization") === "Bearer " + KEY && header(serverHops[0].headers, "x-api-key") === KEY, "server attaches a fresh key pair only on the content hop");
  }
  ok(!fetch.seen.some((r) => r.href.startsWith("https://files.example") || r.href.startsWith("https://cdn.example")), "presigned and CDN hosts are not fetched during the run");
  ok(!serverHops.some((r) => /files\.example|cdn\.example/.test(r.href)), "server does not fetch the file host");
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

function statusCalls(seen) {
  return seen.filter((r) => r.pathname === "/api/video/status");
}
function speechPosts(seen) {
  return seen.filter((r) => r.pathname === "/api/v1/audio/speech" && r.method === "POST");
}
function ttsPolls(seen) {
  return seen.filter((r) => r.pathname === "/api/tts/status");
}

async function playOnce(app, graph) {
  const errors = [];
  const outs = {};
  let aborted = null;
  try {
    await app.runGraph(graph, {
      onResult: (n) => { outs[n.id] = n.out; },
      onStatus: (id, kind, msg) => { if (kind === "error") errors.push(String(msg)); },
    });
  } catch (e) { aborted = e; }
  return { errors, outs, aborted };
}

async function playReadableRedirect() {
  console.log("\nplay built-in: a readable 307 (Node/worker) is used directly");
  const fetch = chainFetch(redirectContent());
  const app = loadEngine((ctx) => { ctx.fetch = fetch; });
  const outs = {};
  const errors = [];
  await app.runGraph(app.materialize(chainGraph()), {
    onResult: (n) => { outs[n.id] = n.out; },
    onStatus: (id, kind, msg) => { if (kind === "error") errors.push(id + ": " + msg); },
  });
  ok(errors.length === 0, "readable-redirect run has no node errors (" + errors.join(" | ") + ")");
  const ext = bodyOf(videoPosts(fetch.seen)[1]);
  ok(!!ext && ext.videoUrl === PRESIGNED, "readable 307 still becomes the extend videoUrl");
  ok(!fetch.seen.some((r) => r.pathname === "/api/resolve-content"), "a readable Location does not call the resolver");
}

async function playVideoRetries() {
  console.log("\nplay built-in: video content failures retry only the fetch");
  const fields = { model: "grok-imagine-video-1.5-lite", prompt: "a boat" };
  {
    let fails = 1;
    const fetch = chainFetch(async () => {
      if (fails) { fails--; throw new Error("read failed " + KEY + " " + PRESIGNED); }
      return rawRes({ status: 307, headers: { location: PRESIGNED }, body: "" });
    });
    const app = loadEngine((ctx) => { ctx.fetch = fetch; });
    const g = app.materialize({ nodes: [node("n", "tvideo", fields)], links: [] });
    const first = await playOnce(app, g);
    ok(first.errors.length === 1, "transient content failure is a node error");
    assertNoSecrets(first.errors.join("\n"));
    ok(videoPosts(fetch.seen).length === 1 && statusCalls(fetch.seen).length === 1, "first failure submitted and polled once");
    const second = await playOnce(app, g);
    ok(second.errors.length === 0 && second.outs.n && second.outs.n.video === PRESIGNED, "retry returns the presigned URL (" + (second.outs.n && second.outs.n.video) + ")");
    ok(videoPosts(fetch.seen).length === 1, "retry does not submit generate-video again (got " + videoPosts(fetch.seen).length + ")");
    ok(statusCalls(fetch.seen).length === 1, "retry does not re-poll status (got " + statusCalls(fetch.seen).length + ")");
  }
  {
    let fails = 1;
    const fetch = chainFetch(async () => {
      if (fails) { fails--; throw new DOMException("aborted", "AbortError"); }
      return rawRes({ status: 307, headers: { location: PRESIGNED }, body: "" });
    });
    const app = loadEngine((ctx) => { ctx.fetch = fetch; });
    const g = app.materialize({ nodes: [node("n", "tvideo", fields)], links: [] });
    const first = await playOnce(app, g);
    ok(first.aborted && first.aborted.name === "AbortError", "content abort propagates (got " + (first.aborted && first.aborted.name) + ")");
    ok(videoPosts(fetch.seen).length === 1 && statusCalls(fetch.seen).length === 1, "aborted fetch still happened after one submit");
    const second = await playOnce(app, g);
    ok(second.errors.length === 0 && second.outs.n && second.outs.n.video === PRESIGNED, "abort retry returns the presigned URL");
    ok(videoPosts(fetch.seen).length === 1, "abort retry does not submit again");
    ok(statusCalls(fetch.seen).length === 1, "abort retry does not re-poll status");
  }
  {
    let fails = 1;
    const serverHops = [];
    const fetch = chainFetch(async () => opaqueRedirect(), {
      resolve: async (rec) => {
        if (fails) { fails--; return jsonRes({ error: "hidden " + KEY + " " + PRESIGNED }, 502); }
        return workerResolve(rec, serverHops);
      },
    });
    const app = loadEngine((ctx) => { ctx.fetch = fetch; });
    const g = app.materialize({ nodes: [node("n", "tvideo", fields)], links: [] });
    const first = await playOnce(app, g);
    ok(first.errors.length === 1 && /redirect target was not exposed/.test(first.errors[0] || ""), "hidden redirect is a node error (" + (first.errors[0] || "") + ")");
    assertNoSecrets(first.errors.join("\n"));
    ok(videoPosts(fetch.seen).length === 1 && statusCalls(fetch.seen).length === 1, "hidden redirect submitted and polled once");
    const second = await playOnce(app, g);
    ok(second.errors.length === 0 && second.outs.n && second.outs.n.video === PRESIGNED, "hidden-redirect retry returns the presigned URL");
    ok(videoPosts(fetch.seen).length === 1, "hidden-redirect retry does not submit again");
    ok(statusCalls(fetch.seen).length === 1, "hidden-redirect retry does not re-poll status");
  }
}

function audioJobFetch(content, hooks = {}) {
  const seen = [];
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
    if (u.hostname === "files.example" || u.hostname === "cdn.example") throw new Error("file host fetched: " + u.origin);
    if (u.pathname === "/api/v1/audio/speech" && rec.method === "POST") {
      return jsonRes({ runId: "aud1", status: "pending", cost: 0.05 }, 200, { "x-remaining-balance": "9.5", "x-cost": "0.05" });
    }
    if (u.pathname === "/api/tts/status") {
      return jsonRes({ status: "completed", audioUrl: "/v1/audio/content?runId=aud1" }, 200, { "x-remaining-balance": "9.5" });
    }
    if (u.pathname === "/v1/audio/content" || u.pathname === "/api/v1/audio/content") return content(u, rec);
    if (u.pathname === "/api/resolve-content" && rec.method === "POST") {
      if (header(rec.headers, "x-api-key")) throw new Error("resolver POST forwarded x-api-key");
      if (!hooks.resolve) return jsonRes({ error: "unexpected resolver" }, 500);
      return hooks.resolve(rec);
    }
    if (/\/models/.test(u.pathname) || u.pathname === "/api/check-balance") return jsonRes({ data: [] });
    return jsonRes({ data: [] });
  };
  fn.seen = seen;
  return fn;
}

async function playAudioRetries() {
  console.log("\nplay built-in: audio content failures retry only the fetch");
  const fields = { model: "minimax/music-3", prompt: "a song" };
  const graph = () => ({ nodes: [node("n", "music", fields)], links: [] });
  {
    let fails = 1;
    const fetch = audioJobFetch(async () => {
      if (fails) { fails--; throw new Error("read failed " + KEY + " " + PRESIGNED); }
      return rawRes({ status: 307, headers: { location: PRESIGNED }, body: "" });
    });
    const app = loadEngine((ctx) => { ctx.fetch = fetch; ctx.URLSearchParams = URLSearchParams; });
    const g = app.materialize(graph());
    const first = await playOnce(app, g);
    ok(first.errors.length === 1, "transient audio fetch is a node error (" + (first.errors[0] || first.aborted) + ")");
    assertNoSecrets(first.errors.join("\n"));
    ok(speechPosts(fetch.seen).length === 1 && ttsPolls(fetch.seen).length === 1, "audio failure submitted and polled once");
    const second = await playOnce(app, g);
    ok(second.errors.length === 0 && second.outs.n && second.outs.n.audio === PRESIGNED, "audio retry returns the presigned URL");
    ok(speechPosts(fetch.seen).length === 1, "audio retry does not submit speech again");
    ok(ttsPolls(fetch.seen).length === 1, "audio retry does not re-poll status");
  }
  {
    let fails = 1;
    const fetch = audioJobFetch(async () => {
      if (fails) { fails--; throw new DOMException("aborted", "AbortError"); }
      return rawRes({ status: 307, headers: { location: PRESIGNED }, body: "" });
    });
    const app = loadEngine((ctx) => { ctx.fetch = fetch; ctx.URLSearchParams = URLSearchParams; });
    const g = app.materialize(graph());
    const first = await playOnce(app, g);
    ok(first.aborted && first.aborted.name === "AbortError", "audio content abort propagates");
    ok(speechPosts(fetch.seen).length === 1 && ttsPolls(fetch.seen).length === 1, "aborted audio fetch followed one submit");
    const second = await playOnce(app, g);
    ok(second.errors.length === 0 && second.outs.n && second.outs.n.audio === PRESIGNED, "audio abort retry returns the presigned URL");
    ok(speechPosts(fetch.seen).length === 1 && ttsPolls(fetch.seen).length === 1, "audio abort retry does not resubmit or re-poll");
  }
  {
    let fails = 1;
    const serverHops = [];
    const fetch = audioJobFetch(async () => opaqueRedirect(), {
      resolve: async (rec) => {
        if (fails) { fails--; return jsonRes({ error: "hidden " + KEY + " " + PRESIGNED }, 502); }
        return workerResolve(rec, serverHops);
      },
    });
    const app = loadEngine((ctx) => { ctx.fetch = fetch; ctx.URLSearchParams = URLSearchParams; });
    const g = app.materialize(graph());
    const first = await playOnce(app, g);
    ok(first.errors.length === 1 && /redirect target was not exposed/.test(first.errors[0] || ""), "hidden audio redirect is a node error (" + (first.errors[0] || "") + ")");
    assertNoSecrets(first.errors.join("\n"));
    ok(speechPosts(fetch.seen).length === 1 && ttsPolls(fetch.seen).length === 1, "hidden audio redirect submitted and polled once");
    const second = await playOnce(app, g);
    ok(second.errors.length === 0 && second.outs.n && second.outs.n.audio === PRESIGNED, "hidden audio retry returns the presigned URL");
    ok(speechPosts(fetch.seen).length === 1 && ttsPolls(fetch.seen).length === 1, "hidden audio retry does not resubmit or re-poll");
    ok(serverHops.length === 1 && serverHops[0].pathname === "/v1/audio/content", "server hop is the audio content URL");
  }
}

async function playBodyRead() {
  console.log("\nplay built-in: a body-read failure is scrubbed and does not resubmit");
  let fails = 1;
  const fetch = chainFetch(async () => {
    const res = rawRes({ status: 200, headers: { "content-type": "video/mp4" }, body: MP4 });
    if (fails) {
      fails--;
      res.arrayBuffer = async () => { throw new Error("read failed " + KEY + " " + PRESIGNED); };
    }
    return res;
  });
  const app = loadEngine((ctx) => { ctx.fetch = fetch; });
  const g = app.materialize({ nodes: [node("n", "tvideo", { model: "grok-imagine-video-1.5-lite", prompt: "a boat" })], links: [] });
  const first = await playOnce(app, g);
  ok(first.errors.length === 1 && /couldn't fetch provider media/.test(first.errors[0] || ""), "body-read failure is a node error (" + (first.errors[0] || "") + ")");
  assertNoSecrets(first.errors.join("\n"));
  const second = await playOnce(app, g);
  ok(second.errors.length === 0 && second.outs.n && String(second.outs.n.video || "").startsWith("data:video/mp4;base64,"), "body-read retry inlines the clip");
  ok(videoPosts(fetch.seen).length === 1, "body-read retry does not submit again");
  ok(statusCalls(fetch.seen).length === 1, "body-read retry does not re-poll status");
}

async function serverUnits() {
  console.log("\nworker: resolve-content walks hops without forwarding the key");
  const abs = "https://nano-gpt.com" + RELATIVE;
  {
    const hops = [];
    const out = await resolveProviderContent(abs, { apiKey: KEY, fetch: serverHopFetch(hops) });
    ok(out.url === PRESIGNED, "307 resolves to the presigned URL");
    ok(hops.length === 1 && hops[0].redirect === "manual", "one manual server hop");
    ok(header(hops[0].headers, "authorization") === "Bearer " + KEY && header(hops[0].headers, "x-api-key") === KEY, "key pair is attached on the content hop");
  }
  {
    const hops = [];
    const out = await resolveProviderContent(abs, {
      apiKey: KEY,
      fetch: async (url, init) => {
        const u = new URL(String(url));
        hops.push({ href: u.href, pathname: u.pathname, headers: init.headers, redirect: init.redirect });
        if (u.hostname !== "nano-gpt.com") throw new Error("downloaded " + u.hostname);
        if (u.pathname === "/api/generate-video/content")
          return rawRes({ status: 307, headers: { location: "/api/images/content?runId=img1" } });
        if (u.pathname === "/api/images/content")
          return rawRes({ status: 307, headers: { location: PRESIGNED } });
        throw new Error("unexpected hop " + u.pathname);
      },
    });
    ok(out.url === PRESIGNED, "a second same-origin content hop is followed, then the file URL is returned");
    ok(hops.length === 2, "two API hops, file host not fetched");
    ok(hops[0].headers !== hops[1].headers, "each hop gets a fresh header object");
    ok(header(hops[1].headers, "x-api-key") === KEY, "the second content hop is authenticated on its own");
  }
  {
    let fetched = false;
    let err = null;
    try {
      await resolveProviderContent("https://files.example/clip.mp4", { apiKey: KEY, fetch: async () => { fetched = true; } });
    } catch (e) { err = e; }
    ok(err && /couldn't fetch provider media/.test(err.message) && !fetched, "a non-content URL is rejected before any fetch");
  }
  {
    let err = null;
    try {
      await resolveProviderContent(abs, {
        apiKey: KEY,
        fetch: async () => {
          const res = rawRes({ status: 500, body: "" });
          res.text = async () => { throw new Error("body " + KEY + " " + PRESIGNED); };
          return res;
        },
      });
    } catch (e) { err = e; }
    ok(err && /couldn't fetch provider media/.test(err.message), "text() failure is reported");
    assertNoSecrets(err && err.message);
  }
  {
    let err = null;
    try {
      await resolveProviderContent(abs, {
        apiKey: KEY,
        fetch: async () => {
          const res = rawRes({ status: 200, headers: { "content-type": "video/mp4" }, body: MP4 });
          res.arrayBuffer = async () => { throw new Error("read failed " + KEY + " " + PRESIGNED); };
          return res;
        },
      });
    } catch (e) { err = e; }
    ok(err && /couldn't fetch provider media/.test(err.message), "arrayBuffer() failure is reported");
    assertNoSecrets(err && err.message);
  }
  {
    const hops = [];
    const req = new Request("https://nanoodle.com/api/resolve-content", {
      method: "POST",
      headers: { authorization: "Bearer " + KEY, "x-api-key": "other-key-value", "content-type": "application/json" },
      body: JSON.stringify({ url: abs }),
    });
    const res = await handleContentResolveRequest(req, serverHopFetch(hops));
    const body = await res.json();
    ok(res.status === 200 && body.url === PRESIGNED, "handler returns the file URL");
    ok(header(hops[0].headers, "x-api-key") === KEY, "hop key comes from the bearer token, not the client's x-api-key");
    const denied = await handleContentResolveRequest(new Request("https://nanoodle.com/api/resolve-content", {
      method: "POST",
      headers: { "x-api-key": KEY, "content-type": "application/json" },
      body: JSON.stringify({ url: abs }),
    }), async () => { throw new Error("should not fetch"); });
    ok(denied.status === 401, "x-api-key alone is not accepted");
  }
}

async function parentOpaque() {
  console.log("\nplay parent: opaque content GET is resolved without x-api-key");
  const hops = [];
  let box = null;
  loadEngine((ctx) => {
    box = ctx;
    ctx.fetch = async (url, init = {}) => {
      const u = new URL(String(url), "https://nanoodle.com");
      if (u.pathname === "/api/resolve-content") {
        return workerResolve({
          headers: init.headers || {},
          redirect: init.redirect,
          body: init.body,
        }, hops);
      }
      return jsonRes({ data: [] });
    };
  });
  ok(typeof box.resolveContentOnParent === "function", "parent exposes resolveContentOnParent");
  const target = await box.resolveContentOnParent("https://nano-gpt.com" + RELATIVE, KEY);
  ok(target === PRESIGNED, "parent resolver returns the presigned URL (got " + target + ")");
  ok(hops.length === 1, "parent asked the worker to walk one hop");
  box.fetch = async () => { throw new Error("down " + KEY + " " + PRESIGNED); };
  let err = null;
  try { await box.resolveContentOnParent("https://nano-gpt.com" + RELATIVE, KEY); }
  catch (e) { err = e; }
  ok(err && /couldn't fetch provider media/.test(err.message), "parent fetch failure is wrapped");
  assertNoSecrets(err && err.message);
}

const E = loadBundle();
await playChain();
await playReadableRedirect();
await playScrub();
await playOverCap();
await playInline();
await playPassthrough();
await playVideoRetries();
await playAudioRetries();
await playBodyRead();
await serverUnits();
await parentOpaque();
await engineUnits(E);
await engineChain(E);

if (failed) {
  console.error("\n✗ content-url: " + failed + " assertion(s) failed.");
  process.exit(1);
}
console.log("\n✓ content-url: relative NanoGPT content URLs chain as absolute readable URLs, and secrets stay out of errors.");
