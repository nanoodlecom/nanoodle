#!/usr/bin/env node
// isPaidNanoType is the spend/auth chokepoint on both surfaces:
//   editor runGroup  — signed-out DEMO_CTX vs real CTX (endpoint-only swap)
//   play graphNeedsNanoKey — signed-out Run walls a billed graph, lets a local/endpoint graph through
//
// The two copies are hand-maintained regexes. A new billed node forgotten here is a keyless
// paid send; accidentally listing `endpoint` (or any local type) walls a localhost graph
// behind a NanoGPT key. Play already pins llm vs endpoint; this pins the FULL type set
// against both registries and the njs-engine network/local flags.
//
// Offline node:vm. No browser, no network, no API spend.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

const failures = [];
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { console.error("  ✗ " + m); failures.push(m); } };

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

function extractObjKeys(src, startNeedle) {
  const start = src.indexOf(startNeedle);
  if (start < 0) throw new Error("start not found: " + startNeedle);
  const open = src.indexOf("{", start);
  const block = src.slice(open, matchBrace(src, open) + 1);
  const keys = [...block.matchAll(/^\s{2,4}([a-z]+):\s*\{/gm)].map((m) => m[1]);
  if (!keys.length) throw new Error("parsed 0 keys after " + JSON.stringify(startNeedle));
  return keys;
}

function loadFn(src, name) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extractFn(src, name) + "\nthis." + name + " = " + name + ";", ctx);
  return ctx[name];
}

// Paid = NanoGPT-billed generators. Unpaid = local / input / note / custom-URL.
// A new NODE_TYPES key must land in exactly one set — that is the ratchet.
const PAID = [
  "llm", "vision", "image", "edit", "inpaint",
  "tvideo", "ivideo", "vedit", "lipsync",
  "music", "remix", "tts", "transcribe",
];
const UNPAID = [
  "text", "upload", "aupload", "vupload", "choice", "join",
  "resize", "vframes", "combine", "soundtrack", "trim", "extractaudio",
  "endpoint", "comment",
];

const editorKeys = extractObjKeys(IDX, "const NODE_TYPES = {");
const playKeys = extractObjKeys(PLAY, "NODE_TYPES run map");
const njsKeys = extractObjKeys(PLAY, "flags: local (pure logic");

const editorPaid = loadFn(IDX, "isPaidNanoType");
const playPaid = loadFn(PLAY, "isPaidNanoType");
function loadPlayNeedsKey() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    extractFn(PLAY, "isPaidNanoType") + "\n" +
    extractFn(PLAY, "graphNeedsNanoKey") + "\n" +
    "this.graphNeedsNanoKey = graphNeedsNanoKey;",
    ctx,
  );
  return ctx.graphNeedsNanoKey;
}
const playNeedsKey = loadPlayNeedsKey();

console.log("• type-set lockstep");

ok(
  extractFn(IDX, "isPaidNanoType").replace(/\s+/g, "") ===
    extractFn(PLAY, "isPaidNanoType").replace(/\s+/g, ""),
  "editor and play isPaidNanoType sources match after whitespace strip",
);

const classified = new Set([...PAID, ...UNPAID]);
const overlap = PAID.filter((t) => UNPAID.includes(t));
ok(overlap.length === 0, "PAID and UNPAID pins are disjoint");

for (const t of PAID) {
  ok(editorPaid(t) === true, "editor isPaidNanoType(" + t + ") is true");
  ok(playPaid(t) === true, "play isPaidNanoType(" + t + ") is true");
}
for (const t of UNPAID) {
  ok(editorPaid(t) === false, "editor isPaidNanoType(" + t + ") is false");
  ok(playPaid(t) === false, "play isPaidNanoType(" + t + ") is false");
}

function assertRegistry(label, keys) {
  const unknown = keys.filter((t) => !classified.has(t));
  ok(
    unknown.length === 0,
    label + " NODE_TYPES has no unclassified key (classify in PAID or UNPAID): " +
      (unknown.join(", ") || "—"),
  );
  const missing = [...classified].filter((t) => !keys.includes(t));
  ok(
    missing.length === 0,
    label + " NODE_TYPES still registers every pinned type: " +
      (missing.join(", ") || "—"),
  );
  for (const t of keys) {
    const want = PAID.includes(t);
    ok(editorPaid(t) === want, "editor classifies " + label + " type " + t + " as " + (want ? "paid" : "unpaid"));
    ok(playPaid(t) === want, "play classifies " + label + " type " + t + " as " + (want ? "paid" : "unpaid"));
  }
}

assertRegistry("editor", editorKeys);
assertRegistry("play RUNTIME", playKeys);

console.log("• njs-engine network flags");
{
  const start = PLAY.indexOf("flags: local (pure logic");
  const open = PLAY.indexOf("{", PLAY.indexOf("const NODE_TYPES = {", start));
  const block = PLAY.slice(open, matchBrace(PLAY, open) + 1);
  const flags = {};
  // njs types are one line each; do not span — a trailing `// comment` on a row
  // would let a [\s\S] match swallow the next key (combine sat after vframes).
  for (const line of block.split("\n")) {
    const m = line.match(/^\s{2}([a-z]+):\s*\{/);
    if (!m) continue;
    flags[m[1]] = {
      network: /network:\s*true/.test(line),
      local: /local:\s*true/.test(line),
      note: /note:\s*true/.test(line),
    };
  }
  ok(Object.keys(flags).length === njsKeys.length, "parsed a flag row for every njs NODE_TYPES key");
  for (const t of njsKeys) {
    const f = flags[t] || {};
    if (f.network) {
      ok(playPaid(t) === true, "njs network:true " + t + " is paid");
    } else {
      ok(playPaid(t) === false, "njs local/note " + t + " is unpaid");
    }
  }
  // endpoint is play/editor-only (custom URL, never NanoGPT). njs has no such type.
  ok(!njsKeys.includes("endpoint"), "njs NODE_TYPES does not register endpoint (custom URL stays off the NanoGPT key gate)");
}

console.log("• graphNeedsNanoKey");
ok(playNeedsKey({ nodes: PAID.map((type) => ({ type })) }) === true,
  "a graph of every paid type needs a NanoGPT key");
ok(playNeedsKey({ nodes: UNPAID.map((type) => ({ type })) }) === false,
  "a graph of every unpaid type does not need a NanoGPT key");
ok(playNeedsKey({ nodes: [{ type: "text" }, { type: "image" }, { type: "endpoint" }] }) === true,
  "mixed local + billed + endpoint still needs a key (the billed node)");
ok(playNeedsKey({ nodes: [{ type: "text" }, { type: "endpoint" }, { type: "comment" }] }) === false,
  "text + endpoint + comment stays keyless");
ok(playNeedsKey({ nodes: [] }) === false, "empty graph does not need a key");
ok(playNeedsKey(null) === false, "null graph does not throw / does not need a key");

console.log("• pre-commit trigger");
{
  const hook = readFileSync(join(ROOT, ".githooks", "pre-commit"), "utf8");
  const m = hook.match(/touches_paidtypes=.*/);
  ok(!!m, "pre-commit has touches_paidtypes");
  ok(m && m[0].includes("index\\.html") && m[0].includes("play\\.html"),
    "touches_paidtypes fires on index.html and play.html");
  ok(hook.includes("check-paid-nano-types.mjs"), "pre-commit runs check-paid-nano-types.mjs");
}

if (failures.length) {
  console.error("✗ check-paid-nano-types: " + failures.length + " assertion(s) failed.");
  process.exit(1);
}
console.log("✓ isPaidNanoType lockstep: editor ↔ play ↔ njs network flags, full type set classified");
