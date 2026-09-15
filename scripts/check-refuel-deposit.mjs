#!/usr/bin/env node
// Pins parseNanoDepositAddress + fetchBalanceInfo address extraction in index.html.
// The bal chip opens the refuel QR from /api/check-balance; a too-strict regex or a
// renamed JSON field makes a signed-in click toast "Couldn't load your Nano deposit
// address" even when usd_balance paints fine.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "index.html"), "utf8");

function extractFn(name) {
  const re = new RegExp(`function ${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) throw new Error(`${name} not found`);
  let i = m.index + m[0].length - 1; // at '('
  // find opening brace after params
  const brace = src.indexOf("{", i);
  let depth = 0, mode = "code", end = -1;
  for (let p = brace; p < src.length; p++) {
    const c = src[p], n = src[p + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; p++; continue; }
      if (c === "/" && n === "*") { mode = "block"; p++; continue; }
      if (c === "'" || c === '"') { mode = c; continue; }
      if (c === "`") { mode = "tmpl"; continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = p; break; } }
    } else if (mode === "line") { if (c === "\n") mode = "code"; }
    else if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; p++; } }
    else if (mode === "'" || mode === '"') { if (c === "\\" ) p++; else if (c === mode) mode = "code"; }
    else if (mode === "tmpl") { if (c === "\\" ) p++; else if (c === "`") mode = "code"; }
  }
  if (end < 0) throw new Error(`could not extract ${name}`);
  return src.slice(m.index, end + 1);
}

const parseSrc = extractFn("parseNanoDepositAddress");
const parse = new Script(`(${parseSrc.replace(/^function parseNanoDepositAddress/, "function")})`).runInNewContext({});
// Simpler: eval as function body
const parseNanoDepositAddress = new Script(parseSrc + "\nparseNanoDepositAddress;").runInNewContext({});

const good = "nano_1gx385nnj7rw67hsksa3pyxwnfr48zu13t35ncjmtnqb9zdebtjhh7ahks34";
const cases = [
  [good, good],
  ["  " + good + "  ", good],
  ["nano:" + good, good],
  ["NANO_" + good.slice(5).toUpperCase(), good],
  ["xrb_" + good.slice(5), good],
  ["", null],
  [null, null],
  ["nano_short", null],
  ["nano_000000000000000000000000000000000000000000000000000000000000", null], // 0 not in alphabet
];

let fails = 0;
for (const [input, want] of cases) {
  const got = parseNanoDepositAddress(input);
  if (got !== want) {
    console.error(`✗ parseNanoDepositAddress(${JSON.stringify(input)}) → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    fails++;
  } else {
    console.log(`✓ parseNanoDepositAddress(${JSON.stringify(input)?.slice(0, 24) ?? input})`);
  }
}

// fetchBalanceInfo must read camelCase + snake_case aliases
const fetchSrc = extractFn("fetchBalanceInfo");
if (!/nano_deposit_address/.test(fetchSrc) || !/depositAddress/.test(fetchSrc)) {
  console.error("✗ fetchBalanceInfo must read nano_deposit_address and depositAddress aliases");
  fails++;
} else {
  console.log("✓ fetchBalanceInfo reads nanoDepositAddress aliases");
}
if (!/parseNanoDepositAddress/.test(fetchSrc)) {
  console.error("✗ fetchBalanceInfo must use parseNanoDepositAddress");
  fails++;
} else {
  console.log("✓ fetchBalanceInfo uses parseNanoDepositAddress");
}

// Manual chip failure must open nano-gpt.com (not a dead toast)
const offer = src.slice(src.indexOf("async function offerRefuel"), src.indexOf("function refuelPoll"));
if (!/window\.open\(\s*"https:\/\/nano-gpt\.com"/.test(offer)) {
  console.error("✗ offerRefuel(manual) must window.open nano-gpt.com when address lookup fails");
  fails++;
} else {
  console.log("✓ offerRefuel opens nano-gpt.com on manual address miss");
}

if (fails) {
  console.error(`check-refuel-deposit: FAIL (${fails})`);
  process.exit(1);
}
console.log("check-refuel-deposit: OK");
