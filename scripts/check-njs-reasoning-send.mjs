#!/usr/bin/env node
/**
 * Leftover #602 send path on the njs / library engine.
 *
 * Editor + play RUNTIME catalog clamp/send are pinned in the open #618 check.
 * The vendored library still ships a 4-option fallback select (not a failure).
 * The billed POST must still forward catalog levels the UI can store:
 * none / minimal / xhigh / max are truthy and !== "default", so llmOpts must
 * put them on the body. A leftover "default" stays omitted.
 *
 * Offline. Lifts llmOpts from both njs copies (play.html #njs-engine + vendor).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");
const VENDOR = readFileSync(join(ROOT, "vendor", "njs-engine.js"), "utf8");

let failed = 0;
const fail = (m) => {
  console.error("✗ " + m);
  failed++;
};
const ok = (m) => console.log("✓ " + m);

function braceMatch(src, start) {
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced braces from: " + src.slice(start, start + 60));
}
function extractFn(src, name) {
  const at = src.search(new RegExp("(async )?function " + name + "\\s*\\("));
  if (at === -1) throw new Error(name + "() not found");
  return braceMatch(src, at);
}

function njsSrc(label) {
  if (label === "vendor") return VENDOR;
  const block = /<script id="njs-engine"[^>]*>\n([\s\S]*?)\n<\/script>/.exec(PLAY);
  if (!block) throw new Error("play.html is missing the njs-engine script block");
  return block[1];
}

function loadLlmOpts(src) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extractFn(src, "llmOpts"), ctx);
  return ctx.llmOpts;
}

const CASES = [
  ["none", { reasoningEffort: "none" }, "none"],
  ["minimal", { reasoningEffort: "minimal" }, "minimal"],
  ["xhigh", { reasoningEffort: "xhigh" }, "xhigh"],
  ["max", { reasoningEffort: "max" }, "max"],
  ["medium", { reasoningEffort: "medium" }, "medium"],
  ["high", { reasoningEffort: "high" }, "high"],
  ["legacy default omitted", { reasoningEffort: "default" }, undefined],
  ["unset omitted", {}, undefined],
  ["empty omitted", { reasoningEffort: "" }, undefined],
];

for (const label of ["play.html #njs-engine", "vendor/njs-engine.js"]) {
  const src = njsSrc(label === "vendor/njs-engine.js" ? "vendor" : "play");
  let llmOpts;
  try {
    llmOpts = loadLlmOpts(src);
  } catch (e) {
    fail(`${label}: ${e.message}`);
    continue;
  }
  if (!/if \(opts\.reasoning_effort\) body\.reasoning_effort = opts\.reasoning_effort/.test(src)) {
    fail(`${label}: genChat must assign reasoning_effort with a truthy check (so "none" is sent)`);
  } else ok(`${label}: genChat forwards a truthy reasoning_effort (including none)`);

  for (const [name, fields, want] of CASES) {
    const got = llmOpts({ fields }).reasoning_effort;
    if (got !== want) fail(`${label}: ${name} → ${JSON.stringify(got)} (expected ${JSON.stringify(want)})`);
    else ok(`${label}: ${name}`);
  }
}

if (failed) {
  console.error(`\n${failed} njs-reasoning-send check(s) failed`);
  process.exit(1);
}
console.log("✓ njs reasoning send: none/minimal/xhigh/max forward, default/empty omit, both copies");
