#!/usr/bin/env node
// Deploy-time cache-bust. Stamps sw.js's CACHE name with the deploy's commit SHA so every
// release gets a fresh offline cache — no manual "bump this on every release" anymore.
//
// Runs as the wrangler `build.command` during Cloudflare Workers Builds, which sets
// WORKERS_CI_COMMIT_SHA. The stamp lands on the *deployed* asset only; nothing is committed
// back to git, so there's no bot-commit loop. Locally (no CI sha) it's a no-op, so `wrangler
// dev` / a plain `python -m http.server` keep serving the checked-in `nanoodle-vN`.
//
// It must NEVER throw — a deploy must not fail because of a cache stamp. Worst case it's inert.
import { readFileSync, writeFileSync } from "node:fs";

try {
  const sha = process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || "";
  if (!sha) { console.log("[stamp-sw] no CI commit sha present — leaving CACHE as-is (local/dev)"); process.exit(0); }
  const path = new URL("../sw.js", import.meta.url);
  const src = readFileSync(path, "utf8");
  const tag = "nanoodle-" + sha.slice(0, 7);
  const next = src.replace(/const CACHE = "[^"]*";/, `const CACHE = "${tag}";`);
  if (next === src) { console.log("[stamp-sw] CACHE line not found — sw.js unchanged"); process.exit(0); }
  writeFileSync(path, next);
  console.log(`[stamp-sw] CACHE -> ${tag}`);
} catch (e) {
  console.log("[stamp-sw] non-fatal, leaving sw.js as-is:", (e && e.message) || e);
}
process.exit(0);
