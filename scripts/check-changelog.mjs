#!/usr/bin/env node
// Guard: changelog.html + feed.xml must match a fresh gen-changelog.mjs run
// against updates.json.
//
// The public /changelog page and Atom feed are generated artifacts. The in-app
// 📣 panel reads updates.json live. They drifted for weeks because the NanoGPT
// model-sync cron committed updates.json without regenerating the page/feed,
// and CI never compared them.
//
// Deterministic: gen-changelog.mjs output depends only on updates.json (no
// Date.now()), so this is a byte-identical diff. Writes nothing.
//
//   node scripts/check-changelog.mjs
//   node scripts/gen-changelog.mjs --check    # same check, via the generator
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  execFileSync(process.execPath, [join(root, "scripts", "gen-changelog.mjs"), "--check"], { stdio: "inherit" });
} catch {
  process.exit(1);
}
