#!/usr/bin/env node
// Verifies the service worker serves the RIGHT shell per route, especially when
// the network misses (offline / a blip on the OAuth return navigation).
//
// The bug this guards: the fetch handler used to fall back to caches.match("/")
// — the editor — for anything it couldn't fetch. So a /play navigation that
// missed the network silently rendered the node-graph editor at a /play URL
// (e.g. signing in on the app runner and landing in the editor).
//
// Cheap: runs sw.js's real fetch handler in a node:vm with mocked caches/fetch.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://nanoodle.com";

// A tagged stand-in for a cached Response, so we can tell which shell was served.
const tag = (name) => ({ tag: name, clone() { return this; } });

function loadSw() {
  const code = readFileSync(join(ROOT, "sw.js"), "utf8");
  const listeners = {};
  const ctx = {
    self: {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting() {}, clients: { claim() {} },
    },
    caches: {
      open: async () => ({ put: async () => {}, addAll: async () => {} }),
      match: async (k) => {
        const key = typeof k === "string" ? k : k.url;
        if (key === "/") return tag("EDITOR");        // index.html shell
        if (key === "/play") return tag("RUNNER");    // play.html shell
        return null;                                  // exact-request cache miss
      },
      keys: async () => [], delete: async () => true,
    },
    location: { origin: ORIGIN },
    URL, console,
    Response: { error: () => ({ tag: "NETERR" }) },
    fetch: () => Promise.reject(new Error("default: offline")),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  new vm.Script(code, { filename: "sw.js" }).runInContext(ctx);
  if (typeof listeners.fetch !== "function") throw new Error("sw.js registered no fetch handler");
  return { ctx, fetchHandler: listeners.fetch };
}

// Drive the fetch handler for one request; returns the served Response's tag.
async function serve({ url, mode = "navigate", offline = true }) {
  const { ctx, fetchHandler } = loadSw();
  ctx.fetch = offline
    ? () => Promise.reject(new Error("offline"))
    : async (req) => tag("NET:" + (typeof req === "string" ? req : req.url));
  let captured;
  const event = { request: { url, method: "GET", mode }, respondWith: (p) => { captured = p; } };
  fetchHandler(event);
  if (captured === undefined) return "PASSTHROUGH"; // handler declined (e.g. cross-origin)
  const res = await captured;
  return res ? res.tag : "NULL";
}

const checks = [
  // The actual bug: offline /play navigation must NOT serve the editor.
  { name: "offline /play?code= navigation -> runner shell (not editor)", url: `${ORIGIN}/play?code=x&state=y`, expect: "RUNNER" },
  { name: "offline /play navigation -> runner shell", url: `${ORIGIN}/play`, expect: "RUNNER" },
  { name: "offline / navigation -> editor shell", url: `${ORIGIN}/`, expect: "EDITOR" },
  { name: "offline /app navigation -> editor shell", url: `${ORIGIN}/app`, expect: "EDITOR" },
  { name: "offline /editor navigation -> editor shell", url: `${ORIGIN}/editor`, expect: "EDITOR" },
  // A failed sub-resource (not a navigation) must error, not get handed index.html.
  { name: "offline non-navigation GET miss -> error (not a shell)", url: `${ORIGIN}/some.json`, mode: "cors", expect: "NETERR" },
  // Online: network-first wins.
  { name: "online /play navigation -> network response", url: `${ORIGIN}/play`, offline: false, expect: "NET:" + `${ORIGIN}/play` },
];

const failures = [];
for (const c of checks) {
  const got = await serve(c);
  if (got !== c.expect) failures.push(`${c.name}\n      expected ${c.expect}, got ${got}`);
}

console.log("\nService-worker route correctness:\n");
for (const c of checks) console.log(`  - ${c.name}`);
console.log("");
if (failures.length) {
  console.error("✗ service worker serves the wrong shell:\n\n  - " + failures.join("\n  - ") + "\n");
  process.exit(1);
}
console.log("✓ service worker serves the route-correct shell, even offline.\n");
