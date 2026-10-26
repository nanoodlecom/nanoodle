#!/usr/bin/env node
// Provider-relative content URLs (Grok Imagine returns
// /api/generate-video/content?runId=… which 307s, with the API key, to a private
// presigned file). The editor and play runtimes, and the embedded engine, must
// resolve a readable Location into an absolute file URL the next node can read.
// An opaque browser redirect is not reported as success: the finished job stays
// pending and the user sees an error. Mock fetch only. No network, no API spend.

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "./play-engine.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "test-api-key";
const RELATIVE = "/api/generate-video/content?runId=grok1&model=grok-imagine-video-1.5-lite";
const CONTENT = "https://nano-gpt.com" + RELATIVE;
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

function carriesUserKey(headers) {
  return !!(header(headers, "authorization") || header(headers, "x-api-key"));
}

// A user key must never be sent to nanoodle.com, including any subdomain.
function keyedNanoodle(seen) {
  return (seen || []).filter((r) => {
    let host = "";
    try { host = new URL(r.href || r.url || "").hostname; } catch { return false; }
    if (host !== "nanoodle.com" && !host.endsWith(".nanoodle.com")) return false;
    return carriesUserKey(r.headers);
  });
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
  const fetch = chainFetch(async () => opaqueRedirect());
  const app = loadEngine((ctx) => { ctx.fetch = fetch; });
  const outs = {};
  const errors = [];
  await app.runGraph(app.materialize(chainGraph()), {
    onResult: (n) => { outs[n.id] = n.out; },
    onStatus: (id, kind, msg) => { if (kind === "error") errors.push(id + ": " + msg); },
  });
  ok(errors.length >= 1 && /finished job is saved/.test(errors.join("\n")), "opaque redirect is an error, not a successful output (" + errors.join(" | ") + ")");
  ok(/not a new generation/.test(errors.join("\n")), "the error says a retry is not a new generation");
  const posts = videoPosts(fetch.seen);
  ok(posts.length === 1, "the extend node is not submitted with the content URL (got " + posts.length + " posts)");
  ok(!outs.open || outs.open.video !== CONTENT, "the opening node does not publish the content URL");
  const hits = contentCalls(fetch.seen);
  ok(hits.length === 1, "only the producer fetches the content URL (got " + hits.length + ")");
  ok(hits.every((h) => h.redirect === "manual"), "every content fetch uses redirect:manual");
  ok(hits.every((h) => header(h.headers, "authorization") === "Bearer " + KEY), "every content fetch sends the bearer key");
  ok(hits.every((h) => !header(h.headers, "x-api-key")), "no content fetch sends x-api-key");
  ok(hits.every((h) => h.href === CONTENT && !h.href.includes(KEY)), "content URL is joined onto the NanoGPT base without the key");
  ok(!fetch.seen.some((r) => r.pathname === "/api/resolve-content"), "opaque redirect does not call /api/resolve-content");
  ok(keyedNanoodle(fetch.seen).length === 0, "no request carrying a user key goes to a nanoodle.com origin");
  ok(!fetch.seen.some((r) => r.href.startsWith("https://files.example") || r.href.startsWith("https://cdn.example")), "presigned and CDN hosts are not fetched during the run");
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
  const hit = contentCalls(fetch.seen)[0];
  ok(hit && hit.redirect === "manual" && header(hit.headers, "authorization") === "Bearer " + KEY && !header(hit.headers, "x-api-key"), "a readable content hop is manual and Authorization-only");
  ok(!fetch.seen.some((r) => r.pathname === "/api/resolve-content"), "a readable Location does not call a resolver");
  ok(keyedNanoodle(fetch.seen).length === 0, "a readable Location does not send the key to nanoodle.com");
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
    const fetch = chainFetch(async () => opaqueRedirect());
    const app = loadEngine((ctx) => { ctx.fetch = fetch; });
    const g = app.materialize({ nodes: [node("n", "tvideo", fields)], links: [] });
    const first = await playOnce(app, g);
    ok(first.errors.length === 1 && /finished job is saved/.test(first.errors[0] || ""), "opaque redirect is a node error (" + (first.errors[0] || "") + ")");
    ok(!(first.outs.n && first.outs.n.video), "opaque redirect does not publish a video");
    assertNoSecrets(first.errors.join("\n"));
    ok(videoPosts(fetch.seen).length === 1 && statusCalls(fetch.seen).length === 1, "opaque redirect submitted and polled once");
    ok(contentCalls(fetch.seen).length === 1, "opaque redirect fetches the content URL once");
    const second = await playOnce(app, g);
    ok(second.errors.length === 1 && /finished job is saved/.test(second.errors[0] || ""), "opaque retry is still an error");
    ok(videoPosts(fetch.seen).length === 1, "opaque retry does not submit generate-video again (got " + videoPosts(fetch.seen).length + ")");
    ok(statusCalls(fetch.seen).length === 1, "opaque retry does not re-poll status (got " + statusCalls(fetch.seen).length + ")");
    ok(contentCalls(fetch.seen).length === 2, "opaque retry repeats only the content fetch (got " + contentCalls(fetch.seen).length + ")");
    ok(keyedNanoodle(fetch.seen).length === 0, "opaque redirect sends no user key to nanoodle.com");
  }
}

function audioJobFetch(content) {
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
    const audioContent = "https://nano-gpt.com/v1/audio/content?runId=aud1";
    const fetch = audioJobFetch(async () => opaqueRedirect());
    const app = loadEngine((ctx) => { ctx.fetch = fetch; ctx.URLSearchParams = URLSearchParams; });
    const g = app.materialize(graph());
    const first = await playOnce(app, g);
    ok(first.errors.length === 1 && /finished job is saved/.test(first.errors[0] || ""), "opaque audio redirect is a node error (" + (first.errors[0] || "") + ")");
    ok(!(first.outs.n && first.outs.n.audio), "opaque audio redirect does not publish audio");
    assertNoSecrets(first.errors.join("\n"));
    ok(speechPosts(fetch.seen).length === 1 && ttsPolls(fetch.seen).length === 1, "opaque audio redirect submitted and polled once");
    const second = await playOnce(app, g);
    ok(second.errors.length === 1, "opaque audio retry is still an error");
    ok(speechPosts(fetch.seen).length === 1 && ttsPolls(fetch.seen).length === 1, "opaque audio retry does not resubmit or re-poll");
    ok(keyedNanoodle(fetch.seen).length === 0, "opaque audio redirect sends no user key to nanoodle.com");
  }
}

async function playSyncAudioUrl() {
  console.log("\nplay built-in: a synchronous audio JSON url is kept before the content fetch");
  const direct = "/v1/audio/content?file=clip";
  let fails = 1;
  const fetch = audioJobFetch(async () => {
    if (fails) { fails--; throw new Error("read failed " + KEY + " " + PRESIGNED); }
    return rawRes({ status: 307, headers: { location: PRESIGNED }, body: "" });
  });
  const orig = fetch;
  const wrapped = async (url, init = {}) => {
    const u = new URL(String(url), "https://nano-gpt.com");
    if (u.pathname === "/api/v1/audio/speech") {
      orig.seen.push({
        href: u.href,
        pathname: u.pathname,
        method: String(init.method || "GET").toUpperCase(),
        headers: init.headers || {},
        redirect: init.redirect,
        body: init.body,
      });
      return jsonRes({ url: direct, cost: 0.02 }, 200, { "x-remaining-balance": "9.5", "x-cost": "0.02" });
    }
    return orig(url, init);
  };
  wrapped.seen = orig.seen;
  const app = loadEngine((ctx) => { ctx.fetch = wrapped; ctx.URLSearchParams = URLSearchParams; });
  const g = app.materialize({ nodes: [node("n", "tts", { model: "tts-1", prompt: "hello" })], links: [] });
  const first = await playOnce(app, g);
  ok(first.errors.length === 1, "sync audio resolver failure is a node error (" + (first.errors[0] || first.aborted) + ")");
  assertNoSecrets(first.errors.join("\n"));
  ok(speechPosts(wrapped.seen).length === 1, "sync audio failure submitted once");
  ok(ttsPolls(wrapped.seen).length === 0, "a url with no runId does not poll");
  const second = await playOnce(app, g);
  ok(second.errors.length === 0 && second.outs.n && second.outs.n.audio === PRESIGNED, "sync audio retry returns the presigned URL (" + (second.outs.n && second.outs.n.audio) + ")");
  ok(speechPosts(wrapped.seen).length === 1, "sync audio retry does not submit speech again (got " + speechPosts(wrapped.seen).length + ")");
  ok(ttsPolls(wrapped.seen).length === 0, "sync audio retry still does not poll");
  for (const file of ["index.html", "play.html"]) {
    const src = readFileSync(join(ROOT, file), "utf8");
    ok(src.includes("const audEntry = { sig:bodySig, resultUrl:url };"), file + " persists the completed audio URL before resolving");
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

async function noKeyedNanoodle() {
  console.log("\nno user key is sent to a nanoodle.com origin");
  for (const file of ["index.html", "play.html", "wrangler.jsonc"]) {
    const src = readFileSync(join(ROOT, file), "utf8");
    ok(!src.includes("/api/resolve-content"), file + " has no /api/resolve-content route");
    ok(!src.includes("resolveContentOnParent"), file + " does not resolve content on the parent");
  }
  ok(!existsSync(join(ROOT, "worker")), "the Worker directory is gone");
  const fetch = chainFetch(async () => opaqueRedirect());
  const app = loadEngine((ctx) => { ctx.fetch = fetch; });
  await playOnce(app, app.materialize(chainGraph()));
  const bad = keyedNanoodle(fetch.seen);
  ok(bad.length === 0, "chain sends no Authorization or x-api-key to nanoodle.com (got " + bad.map((r) => r.href).join(", ") + ")");
  ok(!fetch.seen.some((r) => {
    try { return new URL(r.href).hostname === "nanoodle.com" || new URL(r.href).hostname.endsWith(".nanoodle.com"); }
    catch { return false; }
  }), "the chain does not request nanoodle.com at all");
}

async function playStreamCap() {
  console.log("\nplay built-in: a chunked body with no length stops at the cap");
  {
    let pulled = 0;
    let cancelled = false;
    const chunk = 256 * 1024;
    const fetch = chainFetch(async () => {
      const res = rawRes({ status: 200, headers: { "content-type": "video/mp4" }, body: "" });
      res.body = {
        getReader() {
          return {
            async read() {
              if (cancelled || pulled >= 12 * 1024 * 1024) return { done: true, value: undefined };
              pulled += chunk;
              return { done: false, value: new Uint8Array(chunk) };
            },
            async cancel() { cancelled = true; },
            releaseLock() {},
          };
        },
        cancel: async () => { cancelled = true; },
      };
      return res;
    });
    const app = loadEngine((ctx) => { ctx.fetch = fetch; });
    const run = await playOnce(app, app.materialize({ nodes: [node("n", "tvideo", { model: "grok-imagine-video-1.5-lite", prompt: "a boat" })], links: [] }));
    ok(/too large to send inline/.test(run.errors[0] || ""), "a body with no length is refused at the cap (" + (run.errors[0] || "") + ")");
    ok(pulled < 8 * 1024 * 1024, "the unread tail is not buffered (pulled " + pulled + ")");
    ok(cancelled, "the reader is cancelled");
    assertNoSecrets(run.errors.join("\n"));
    ok(keyedNanoodle(fetch.seen).length === 0, "the capped read sends no user key to nanoodle.com");
  }
  {
    const bytes = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
    const fetch = chainFetch(async () => {
      const res = rawRes({ status: 200, headers: { "content-type": "video/mp4" }, body: bytes });
      res.body = {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: bytes };
            },
            async cancel() {},
            releaseLock() {},
          };
        },
      };
      return res;
    });
    const app = loadEngine((ctx) => { ctx.fetch = fetch; });
    const run = await playOnce(app, app.materialize({ nodes: [node("n", "tvideo", { model: "grok-imagine-video-1.5-lite", prompt: "a boat" })], links: [] }));
    ok(run.errors.length === 0 && String(run.outs.n && run.outs.n.video || "").startsWith("data:video/mp4;base64,"), "a short chunked body is still inlined (" + (run.errors[0] || "") + ")");
  }
}

async function parentContentRedirect() {
  console.log("\nplay parent: content reads force redirect:manual and do not forward the key");
  async function drive(label, redirectField) {
    const replies = [];
    const seen = [];
    const frameWin = { postMessage(msg) { replies.push(msg); } };
    let apiListener = null;
    loadEngine((ctx) => {
      const doc = ctx.document;
      ctx.document = new Proxy(doc, {
        get(target, prop, recv) {
          if (prop === "getElementById") {
            return (id) => {
              if (id === "appframe") return { contentWindow: frameWin };
              const fn = doc.getElementById;
              return typeof fn === "function" ? fn.call(doc, id) : undefined;
            };
          }
          const value = Reflect.get(target, prop, recv);
          return typeof value === "function" ? value.bind(doc) : value;
        },
      });
      ctx.addEventListener = (type, fn) => {
        if (type === "message" && String(fn).includes('init.redirect = "manual"')) apiListener = fn;
      };
      ctx.fetch = async (url, init = {}) => {
        const u = new URL(String(url), "https://nanoodle.com");
        const rec = {
          href: u.href,
          pathname: u.pathname,
          method: String(init.method || "GET").toUpperCase(),
          headers: init.headers || {},
          redirect: init.redirect,
        };
        seen.push(rec);
        if (u.hostname === "files.example") throw new Error("file host fetched: " + u.href);
        if (u.pathname === "/api/generate-video/content") return opaqueRedirect();
        return jsonRes({ data: [] });
      };
    });
    ok(typeof apiListener === "function", label + ": captured the trusted iframe bridge");
    const data = { type: "__api__", id: 7, url: "https://nano-gpt.com" + RELATIVE, method: "GET" };
    if (redirectField !== undefined) data.redirect = redirectField;
    await apiListener({ source: frameWin, data });
    const gets = seen.filter((r) => r.pathname === "/api/generate-video/content");
    ok(gets.length === 1 && gets[0].redirect === "manual", label + ": content read is redirect:manual (got " + (gets[0] && gets[0].redirect) + ")");
    ok(gets[0] && header(gets[0].headers, "authorization") === "Bearer " + KEY, label + ": Authorization stays on nano-gpt.com");
    ok(gets[0] && !header(gets[0].headers, "x-api-key"), label + ": content read does not send x-api-key");
    ok(!seen.some((r) => /files\.example/.test(r.href)), label + ": the file host is not fetched");
    ok(!seen.some((r) => r.pathname === "/api/resolve-content"), label + ": the parent does not call /api/resolve-content");
    ok(keyedNanoodle(seen).length === 0, label + ": no user key goes to a nanoodle.com origin");
    const reply = replies[0];
    ok(reply && reply.status === 0 && !(reply.headers && reply.headers.location), label + ": opaque redirect is returned without a synthesized Location");
    ok(reply && !JSON.stringify(reply).includes(KEY) && !JSON.stringify(reply).includes("SUPERSECRET"), label + ": the bridge reply has no key and no presigned query");
  }
  await drive("explicit follow", "follow");
  await drive("omitted redirect", undefined);
  await drive("null redirect", null);
}

async function parentStreamCap() {
  console.log("\nplay parent: a content read stops streaming at the inline cap");
  const replies = [];
  const frameWin = { postMessage(msg) { replies.push(msg); } };
  let apiListener = null;
  let pulled = 0;
  let cancelled = false;
  let reads = 0;
  const chunk = 256 * 1024;
  loadEngine((ctx) => {
    const doc = ctx.document;
    ctx.document = new Proxy(doc, {
      get(target, prop, recv) {
        if (prop === "getElementById") {
          return (id) => {
            if (id === "appframe") return { contentWindow: frameWin };
            const fn = doc.getElementById;
            return typeof fn === "function" ? fn.call(doc, id) : undefined;
          };
        }
        const value = Reflect.get(target, prop, recv);
        return typeof value === "function" ? value.bind(doc) : value;
      },
    });
    ctx.addEventListener = (type, fn) => {
      if (type === "message" && String(fn).includes('init.redirect = "manual"')) apiListener = fn;
    };
    ctx.fetch = async (url, init = {}) => {
      const u = new URL(String(url), "https://nano-gpt.com");
      if (u.pathname !== "/api/generate-video/content") return jsonRes({ data: [] });
      ok(init.redirect === "manual", "capped content read stays redirect:manual");
      ok(header(init.headers, "authorization") === "Bearer " + KEY, "capped content read keeps Authorization");
      ok(!header(init.headers, "x-api-key"), "capped content read does not send x-api-key");
      return {
        ok: true,
        status: 200,
        type: "basic",
        headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "video/mp4" : null) },
        body: {
          getReader() {
            return {
              async read() {
                reads++;
                if (cancelled || pulled >= 12 * 1024 * 1024) return { done: true, value: undefined };
                pulled += chunk;
                return { done: false, value: new Uint8Array(chunk) };
              },
              async cancel() { cancelled = true; },
              releaseLock() {},
            };
          },
          cancel: async () => { cancelled = true; },
        },
      };
    };
  });
  ok(typeof apiListener === "function", "captured the trusted iframe bridge");
  await apiListener({
    source: frameWin,
    data: { type: "__api__", id: 9, url: "https://nano-gpt.com" + RELATIVE, method: "GET" },
  });
  const reply = replies[0] || {};
  ok(/inline cap/.test(reply.error || ""), "the bridge reports the cap instead of the whole file (" + (reply.error || "") + ")");
  ok(pulled < 8 * 1024 * 1024, "the unread tail is not buffered (pulled " + pulled + ")");
  ok(cancelled, "the bridge cancels the reader");
  ok(reads > 1 && reads < 40, "the bridge pulled more than one chunk and then stopped (reads " + reads + ")");
  assertNoSecrets(JSON.stringify(reply));
  ok(!reply.body || reply.body.byteLength === 0, "the over-cap reply does not carry the buffered clip");
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
await playSyncAudioUrl();
await playBodyRead();
await noKeyedNanoodle();
await playStreamCap();
await parentContentRedirect();
await parentStreamCap();
await engineUnits(E);
await engineChain(E);

if (failed) {
  console.error("\n✗ content-url: " + failed + " assertion(s) failed.");
  process.exit(1);
}
console.log("\n✓ content-url: a readable Location becomes a file URL, an opaque redirect stays pending, and secrets stay out of errors.");
