#!/usr/bin/env node
// Leftover 🔌 Custom endpoint edges after #715 regenerated the njs-engine
// with endpoint. Editor/play helper toys live in check-endpoint.mjs (URL
// allowlist, payload shape, CORS, share auth blanking). This file pins the
// headless runner those toys never hit: NODE_TYPES.endpoint is not a
// NanoGPT network type (no API key required); public http / javascript: /
// embedded credentials are refused BEFORE fetch; localhost http is allowed;
// the POST uses fields.auth only — never x-api-key / a NanoClient bearer.
// Offline, zero API spend. New file so it does not collide with
// check-endpoint.mjs.
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
  if (!E || !E.RUNNERS || !E.NODE_TYPES) throw new Error(label + ": NanoodleEngine incomplete");
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

async function throwsMsg(fn, re) {
  try { await fn(); return false; }
  catch (e) { return re.test(String(e && e.message)); }
}

for (const [label, E] of engines()) {
  console.log(label);
  const spec = E.NODE_TYPES.endpoint;
  check(spec && spec.network !== true && typeof E.RUNNERS.endpoint === "function",
    label + ": endpoint is registered and is not a NanoGPT network type (no API key required)");

  for (const [kind, url] of [
    ["public http", "http://example.com/v1"],
    ["javascript:", "javascript:alert(1)"],
    ["embedded credentials", "http://user:pass@127.0.0.1:9/"],
  ]) {
    let called = false;
    check(await throwsMsg(() => E.RUNNERS.endpoint(
      { fields: { url, mode: "chat", prompt: "hi" } },
      {},
      { fetch: async () => { called = true; return { ok: true, status: 200, text: async () => "{}", headers: { get: () => "application/json" } }; } }
    ), /isn.t allowed|URL required|don.t put credentials/),
      label + ": " + kind + " is refused");
    check(!called, label + ": " + kind + " never reaches fetch");
  }

  let req = null;
  const out = await E.RUNNERS.endpoint(
    { fields: { url: "http://127.0.0.1:8787/v1/chat/completions", mode: "chat", prompt: "hi", auth: "tok" } },
    {},
    {
      fetch: async (url, opts) => {
        req = { url, opts };
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          headers: { get: () => "application/json" },
        };
      },
    }
  );
  check(out && out.text === "ok", label + ": localhost http chat POST is allowed");
  check(req && req.url === "http://127.0.0.1:8787/v1/chat/completions" && req.opts && req.opts.method === "POST",
    label + ": POST goes to the graph URL (not nano-gpt.com)");
  const headers = (req && req.opts && req.opts.headers) || {};
  const headerBlob = JSON.stringify(headers);
  check(headers.Authorization === "Bearer tok" && !/x-api-key/i.test(headerBlob),
    label + ": Authorization is fields.auth only — never x-api-key / a NanoClient bearer");
}

if (failed) { console.error("\n✗ check-njs-endpoint-edges: " + failed + " failure(s)"); process.exit(1); }
console.log("✓ check-njs-endpoint-edges — njs no-key / refuse-before-fetch / auth-only hold");
