#!/usr/bin/env node
// Guard: changelog.html + feed.xml must match a fresh gen-changelog.mjs run
// against updates.json.
//
// The public /changelog page and Atom feed are generated artifacts. The in-app
// 📣 panel reads updates.json live. They drifted for weeks because the NanoGPT
// model-sync cron committed updates.json without regenerating the page/feed,
// and CI never compared them. Gallery/product PRs (#430, #433) then burned a
// review cycle the same way: hand-edit updates.json, forget gen-changelog.
//
// Deterministic: gen-changelog.mjs output depends only on updates.json (no
// Date.now()), so this is a byte-identical diff. Writes nothing.
//
//   node scripts/check-changelog.mjs
//   node scripts/gen-changelog.mjs --check    # same check, via the generator
//
// Also pins the hook + CI wiring so the auto-regen cannot silently disappear.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const fail = (msg) => { console.error("✗ check-changelog: " + msg); failed++; };

const hook = (() => {
  try { return readFileSync(join(root, ".githooks", "pre-commit"), "utf8"); }
  catch (e) { fail("cannot read .githooks/pre-commit: " + e.message); return ""; }
})();
const trigger = (hook.match(/touches_updates=.*/) || [""])[0];
if (!trigger) fail("pre-commit has no touches_updates trigger");
else {
  if (!trigger.includes("updates\\.json")) fail("touches_updates must include updates.json");
  if (!trigger.includes("changelog\\.html")) fail("touches_updates must include changelog.html");
  if (!trigger.includes("feed\\.xml")) fail("touches_updates must include feed.xml");
}

const block = (hook.match(/if \[ -n "\$touches_updates" \]; then\n([\s\S]*?)\nfi/) || [])[1] || "";
if (!block) fail("pre-commit has no touches_updates execution block");
else {
  // Must WRITE artifacts (not only --check) and stage them so a hand-edit of
  // updates.json cannot land without changelog.html + feed.xml.
  if (!/node "\$root\/scripts\/gen-changelog\.mjs"/.test(block))
    fail("pre-commit must run gen-changelog.mjs (write) when updates.json is staged");
  if (/gen-changelog\.mjs" --check/.test(block))
    fail("pre-commit must write changelog artifacts, not only --check them");
  if (!/git add -- "\$root\/changelog\.html" "\$root\/feed\.xml"/.test(block))
    fail("pre-commit must git-add changelog.html + feed.xml after regenerating");
}

const post = (() => {
  try { return readFileSync(join(root, ".githooks", "post-commit"), "utf8"); }
  catch (e) { fail("cannot read .githooks/post-commit: " + e.message); return ""; }
})();
const handIdx = post.indexOf("grep -qx 'updates.json'");
if (handIdx < 0) fail("post-commit has no hand-edit updates.json branch");
else if (!post.slice(handIdx, handIdx + 800).includes("gen-changelog.mjs"))
  fail("post-commit hand-edit path must still run gen-changelog.mjs (PRs #430, #433)");

const ci = (() => {
  try { return readFileSync(join(root, ".github", "workflows", "checks.yml"), "utf8"); }
  catch (e) { fail("cannot read .github/workflows/checks.yml: " + e.message); return ""; }
})();
if (!/gen-changelog\.mjs --check/.test(ci))
  fail("checks.yml must run gen-changelog.mjs --check as a named step");

if (failed) process.exit(1);

try {
  execFileSync(process.execPath, [join(root, "scripts", "gen-changelog.mjs"), "--check"], { stdio: "inherit" });
} catch {
  process.exit(1);
}
