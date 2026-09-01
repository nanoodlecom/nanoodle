#!/usr/bin/env node
// Offline guard for the Custom endpoint node: NanoGPT-shaped request bodies,
// mode→output-port wiring, URL required / allow-list, and the NanoGPT key
// must never ride a custom-URL fetch (no getKey / apiFetch / x-api-key).
//
// Lifts the SHIPPED helpers out of index.html and play.html (house extract
// pattern) and runs them in node:vm. No browser, no network, no API spend.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

function matchBrace(src, openIdx) {
  let depth = 0;
  const tmpl = [];
  let mode = "code";
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i++; }
      else if (c === "/" && n === "*") { mode = "block"; i++; }
      else if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (tmpl.length && depth === tmpl[tmpl.length - 1]) { tmpl.pop(); mode = "tpl"; }
        else if (depth === 0) return i;
      }
    } else if (mode === "line") { if (c === "\n") mode = "code"; }
    else if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i++; } }
    else if (mode === "sq") { if (c === "\\") i++; else if (c === "'") mode = "code"; }
    else if (mode === "dq") { if (c === "\\") i++; else if (c === '"') mode = "code"; }
    else if (mode === "tpl") {
      if (c === "\\") i++;
      else if (c === "`") mode = "code";
      else if (c === "$" && n === "{") { mode = "code"; tmpl.push(depth); depth++; i++; }
    }
  }
  throw new Error("unbalanced braces from index " + openIdx);
}

function extractFn(src, name) {
  const sig = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = sig.exec(src);
  if (!m) throw new Error("function " + name + "() not found");
  const open = src.indexOf("{", m.index);
  return src.slice(m.index, matchBrace(src, open) + 1);
}

function extractThrough(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  if (start < 0) throw new Error("start not found: " + startNeedle);
  const end = src.indexOf(endNeedle, start);
  if (end < 0) throw new Error("end not found: " + endNeedle);
  return src.slice(start, end);
}

const HELPERS = extractThrough(
  IDX,
  "var ENDPOINT_DEF_URL",
  "\n/* ======================================================================\n   NODE TYPE REGISTRY",
);

function loadSurface(label, src) {
  const ctx = { URL, fetch() { throw new Error("fetch must be injected"); } };
  vm.createContext(ctx);
  vm.runInContext(HELPERS, ctx, { filename: label + "#endpoint" });
  return ctx;
}

const failures = [];
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { console.error("  ✗ " + m); failures.push(m); } };
const eq = (got, want, m) => ok(JSON.stringify(got) === JSON.stringify(want), m);

console.log("• index.html helpers");
const S = loadSurface("index.html", IDX);

// ---- URL required / allow-list ------------------------------------------------
ok(S.endpointUrlOk("") !== true, "empty URL is refused");
ok(/URL required/.test(S.endpointUrlOk("")), "empty URL names the required field");
ok(S.endpointUrlOk("http://127.0.0.1:8787/v1/chat/completions") === true, "127.0.0.1 http is allowed");
ok(S.endpointUrlOk("http://localhost:3000/v1/chat/completions") === true, "localhost http is allowed");
ok(S.endpointUrlOk("http://192.168.1.9:8787/v1") === true, "LAN http is allowed");
ok(S.endpointUrlOk("http://box.local/v1") === true, ".local http is allowed");
ok(S.endpointUrlOk("https://example.com/v1/chat/completions") === true, "https custom host is allowed");
ok(S.endpointUrlOk("http://example.com/v1") !== true, "public http host is refused");
ok(S.endpointUrlOk("javascript:alert(1)") !== true, "javascript: is refused");
ok(S.endpointUrlOk("http://user:pass@127.0.0.1:9/") !== true, "embedded credentials are refused");

// ---- mode → output port -------------------------------------------------------
eq(S.endpointOutPort({ fields: { mode: "chat" } }), { name: "text", type: "text" }, "chat → text port");
eq(S.endpointOutPort({ fields: { mode: "image" } }), { name: "image", type: "image" }, "image → image port");
eq(S.endpointOutPort({ fields: { mode: "video" } }), { name: "video", type: "video" }, "video → video port");
eq(S.endpointOutPort({ fields: { mode: "audio" } }), { name: "audio", type: "audio" }, "audio → audio port");
eq(S.endpointOutPort({ fields: { mode: "json" } }), { name: "text", type: "text" }, "json → text port");
eq(S.endpointOutPort({ fields: {} }), { name: "text", type: "text" }, "default mode is chat → text");

// ---- request body shapes (NanoGPT keys) --------------------------------------
const n = { fields: { model: "local", prompt: "hello", system: "be brief", size: "1024x1024" } };
const chat = S.endpointRequestBody("chat", n, {});
ok(chat.model === "local" && Array.isArray(chat.messages) && chat.temperature === 0.8,
  "chat body has model + messages + temperature");
ok(chat.messages[0].role === "system" && chat.messages[1].role === "user" && chat.messages[1].content === "hello",
  "chat messages: system then user text");

const chatImg = S.endpointRequestBody("chat", n, { image: "data:image/png;base64,xx" });
ok(Array.isArray(chatImg.messages[1].content) && chatImg.messages[1].content.some((p) => p.type === "image_url"),
  "wired image becomes an image_url part (NanoGPT chat shape)");

const img = S.endpointRequestBody("image", n, {});
ok(img.model === "local" && img.prompt === "hello" && img.size === "1024x1024" && img.response_format === "b64_json" && img.n === 1,
  "image body matches NanoGPT generations keys");

const vid = S.endpointRequestBody("video", n, { image: "data:image/png;base64,xx" });
ok(vid.model === "local" && vid.prompt === "hello" && vid.imageDataUrl === "data:image/png;base64,xx",
  "video body matches NanoGPT generate-video keys");

const aud = S.endpointRequestBody("audio", n, {});
ok(aud.model === "local" && aud.input === "hello", "audio body uses input (speech/music shape)");

const js = S.endpointRequestBody("json", n, { text: "hi", image: "data:x" });
ok(js.text === "hi" && js.image === "data:x" && js.model == null, "json mode POSTs wired inputs only");

// ---- response parse -----------------------------------------------------------
eq(S.endpointParseChat({ choices: [{ message: { content: "ok" } }] }), { text: "ok" }, "chat completions parse");
eq(S.endpointParseImage({ data: [{ b64_json: "abc" }] }), { image: "data:image/png;base64,abc", images: ["data:image/png;base64,abc"] },
  "image generations parse");
eq(S.endpointParseVideo({ url: "https://x/v.mp4" }), { video: "https://x/v.mp4" }, "video {url} parse");
eq(S.endpointParseJsonMode({ text: "hi" }), { text: "hi" }, "json {text} parse");
eq(S.endpointParseJsonMode({ data: { a: 1 } }), { text: "{\"a\":1}" }, "json {data} parse");

// ---- headers: custom auth only, never a NanoGPT key --------------------------
eq(S.endpointHeaders(""), { "Content-Type": "application/json" }, "no auth header when the field is empty");
eq(S.endpointHeaders("tok"), { "Content-Type": "application/json", Authorization: "Bearer tok" },
  "bare token becomes Bearer …");
eq(S.endpointHeaders("Basic abc"), { "Content-Type": "application/json", Authorization: "Basic abc" },
  "a full Authorization value is sent as-is");
ok(!Object.values(S.endpointHeaders("tok")).some((v) => /x-api-key/i.test(String(v))),
  "custom headers never include x-api-key");

// ---- runEndpoint: URL required, fetch mock, key must not leak ----------------
{
  const calls = [];
  S.fetch = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ choices: [{ message: { content: "from-local" } }] }),
      text: async () => "",
    });
  };
  const leaked = [];
  S.getKey = () => { leaked.push("getKey"); return "sk-nano-SECRET"; };
  S.authHeaders = () => { leaked.push("authHeaders"); return { Authorization: "Bearer sk-nano-SECRET", "x-api-key": "sk-nano-SECRET" }; };
  S.apiFetch = () => { leaked.push("apiFetch"); };

  const out = await S.runEndpoint(
    { fields: { url: "http://127.0.0.1:8787/v1/chat/completions", mode: "chat", prompt: "hi", auth: "user-tok" } },
    {},
  );
  ok(out && out.text === "from-local", "runEndpoint returns parsed chat text");
  ok(calls.length === 1 && calls[0].url === "http://127.0.0.1:8787/v1/chat/completions", "fetch goes to the typed URL");
  ok(calls[0].opts.method === "POST", "POST");
  const hdrs = calls[0].opts.headers;
  ok(hdrs.Authorization === "Bearer user-tok", "only the user-typed Authorization is sent");
  ok(!hdrs["x-api-key"], "NanoGPT x-api-key is not attached");
  ok(!String(calls[0].opts.body).includes("sk-nano-SECRET"), "NanoGPT key is not in the body");
  ok(leaked.length === 0, "getKey / authHeaders / apiFetch were never called");

  let refused = "";
  try { await S.runEndpoint({ fields: { url: "", mode: "chat", prompt: "hi" } }, {}); }
  catch (e) { refused = e.message; }
  ok(/URL required/.test(refused), "runEndpoint refuses a missing URL");

  calls.length = 0;
  const fromDef = await S.runEndpoint(
    { fields: { mode: "chat", prompt: "hi" } },
    {},
  );
  ok(fromDef && fromDef.text === "from-local", "runEndpoint uses the default URL when the field is omitted");
  ok(calls[0] && calls[0].url === S.ENDPOINT_DEF_URL, "omitted URL field POSTs to ENDPOINT_DEF_URL");

  S.fetch = () => Promise.reject(Object.assign(new TypeError("Failed to fetch"), { name: "TypeError" }));
  let opaque = "";
  try { await S.runEndpoint({ fields: { url: "http://127.0.0.1:1/v1/chat/completions", mode: "chat", prompt: "hi" } }, {}); }
  catch (e) { opaque = e.message; }
  ok(/CORS/.test(opaque) && /local-network/.test(opaque),
    "runEndpoint TypeError on localhost names CORS and Chrome LNA");

  S.navigator = { permissions: { query: async () => ({ state: "denied" }) } };
  let denied = "";
  try { await S.runEndpoint({ fields: { url: "http://127.0.0.1:1/v1/chat/completions", mode: "chat", prompt: "hi" } }, {}); }
  catch (e) { denied = e.message; }
  ok(/Chrome local-network permission/.test(denied) && !/^blocked by CORS/.test(denied),
    "runEndpoint + denied LNA is the Chrome local-network one-liner");

  S.navigator = { permissions: { query: async () => ({ state: "granted" }) } };
  let granted = "";
  try { await S.runEndpoint({ fields: { url: "http://127.0.0.1:1/v1/chat/completions", mode: "chat", prompt: "hi" } }, {}); }
  catch (e) { granted = e.message; }
  ok(granted === "blocked by CORS — your server needs Access-Control-Allow-Origin",
    "runEndpoint + granted LNA is the CORS one-liner");
  delete S.navigator;
}

// ---- CORS / Chrome LNA error lines -------------------------------------------
ok(S.endpointFetchError({ message: "Failed to fetch" }) === "blocked by CORS — your server needs Access-Control-Allow-Origin",
  "Failed to fetch with no URL becomes the CORS one-liner");
ok(S.endpointFetchError({ message: "Failed to fetch" }, "https://example.com/v1") === "blocked by CORS — your server needs Access-Control-Allow-Origin",
  "Failed to fetch to a public https URL is CORS (LNA does not apply)");
ok(S.endpointFetchError({ message: "Failed to fetch" }, "http://127.0.0.1:8787/v1/chat/completions") ===
  "blocked — CORS (Access-Control-Allow-Origin + OPTIONS) or Chrome local-network permission",
  "localhost Failed to fetch names CORS or Chrome LNA when permission is unknown");
ok(S.endpointFetchError({ message: "TypeError: Failed to fetch" }, "http://localhost:3000/v1") ===
  "blocked — CORS (Access-Control-Allow-Origin + OPTIONS) or Chrome local-network permission",
  "TypeError: Failed to fetch on localhost names both");
ok(S.endpointFetchError({ name: "TypeError", message: "Load failed" }, "http://192.168.1.9:8787/v1") ===
  "blocked — CORS (Access-Control-Allow-Origin + OPTIONS) or Chrome local-network permission",
  "LAN Load failed names CORS or Chrome LNA");
ok(S.endpointFetchError({ message: "Failed to fetch" }, "http://127.0.0.1:9/", "denied") ===
  "blocked by Chrome local-network permission — allow this site to access your local network, then run again",
  "denied LNA is the Chrome local-network one-liner");
ok(S.endpointFetchError({ message: "Failed to fetch" }, "http://127.0.0.1:9/", "granted") ===
  "blocked by CORS — your server needs Access-Control-Allow-Origin",
  "granted LNA + Failed to fetch is CORS");
ok(S.endpointFetchError({ message: "no text in response" }) === "no text in response",
  "non-network errors pass through");
ok(S.endpointUrlIsLocal("http://127.0.0.1:8787/v1") === true, "127.0.0.1 is local");
ok(S.endpointUrlIsLocal("http://localhost:3000/") === true, "localhost is local");
ok(S.endpointUrlIsLocal("http://box.local/v1") === true, ".local is local");
ok(S.endpointUrlIsLocal("https://example.com/v1") === false, "public https is not local");
eq(await S.endpointQueryLocalNetwork("http://127.0.0.1:9/"), "", "no Permissions API → empty LNA state");

// ---- share-card redaction -----------------------------------------------------
{
  const start = IDX.indexOf("function shareableGraph");
  const fn = extractFn(IDX, "shareableGraph");
  const ctx = {
    serializeGraph: () => ({ nodes: [{ type: "endpoint", fields: { url: "http://127.0.0.1:9", auth: "secret-tok", prompt: "hi" } }] }),
    UPLOAD_FIELD: { upload: "image", aupload: "audio", vupload: "video" },
  };
  vm.createContext(ctx);
  vm.runInContext(fn + "\n;this.shareableGraph=shareableGraph;", ctx);
  const g = ctx.shareableGraph();
  ok(g.nodes[0].fields.auth === "", "shareableGraph blanks endpoint auth");
  ok(g.nodes[0].fields.prompt === "hi", "shareableGraph keeps the prompt");
}

// ---- play.html twin: same helpers, same leak rules ---------------------------
console.log("• play.html helpers");
ok(PLAY.includes("function runEndpoint("), "play.html RUNTIME_JS carries runEndpoint");
ok(PLAY.includes('title:"Custom endpoint"') || PLAY.includes("title:\"Custom endpoint\""),
  "play.html NODE_TYPES includes endpoint");
const playHelpers = extractThrough(PLAY, "var ENDPOINT_DEF_URL", "  /* =====================================================================\n     NODE_TYPES run map");
const idxNorm = HELPERS.replace(/^\s+/gm, "").trim();
const playNorm = playHelpers.replace(/^\s+/gm, "").trim();
ok(idxNorm === playNorm, "endpoint helpers are twin-identical after whitespace strip");

ok(!/getKey\s*\(/.test(extractFn(IDX, "runEndpoint")), "index runEndpoint source never calls getKey");
ok(!/apiFetch\s*\(/.test(extractFn(IDX, "runEndpoint")), "index runEndpoint source never calls apiFetch");
ok(!/x-api-key/.test(extractFn(IDX, "runEndpoint") + extractFn(IDX, "endpointHeaders")),
  "index endpoint send path never mentions x-api-key");
ok(!/authHeaders\s*\(/.test(extractFn(IDX, "runEndpoint")), "index runEndpoint source never calls authHeaders");

// ---- live localhost server (zero NanoGPT spend) --------------------------------
console.log("• live localhost chat server");
{
  const seen = [];
  const srv = createServer((req, res) => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type,authorization",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    let b = "";
    req.on("data", (c) => { b += c; });
    req.on("end", () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: b });
      const j = JSON.parse(b || "{}");
      const last = (j.messages || []).at(-1);
      const text = typeof last?.content === "string" ? last.content : "ok";
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "echo: " + text } }] }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const url = `http://127.0.0.1:${port}/v1/chat/completions`;
  S.fetch = fetch;
  const live = await S.runEndpoint(
    { fields: { url, mode: "chat", prompt: "hello local", auth: "user-tok" } },
    {},
  );
  ok(live && live.text === "echo: hello local", "live localhost chat completions lights the text result");
  ok(seen.length === 1 && seen[0].url === "/v1/chat/completions", "POST path is the typed URL path");
  ok(seen[0].auth === "Bearer user-tok", "live request carries only the user Authorization");
  ok(!String(seen[0].body).includes("sk-nano"), "live body has no NanoGPT key");
  srv.close();
}

if (failures.length) {
  console.error("✗ check-endpoint: " + failures.length + " assertion(s) failed.");
  process.exit(1);
}
console.log("✓ custom endpoint node: payload shape, mode→port, URL required, key does not leak");
