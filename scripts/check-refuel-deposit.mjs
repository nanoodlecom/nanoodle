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

// ---- runtime: a dead key (readable 401/403 from check-balance) is an AUTH failure,
// not a missing deposit address. Drive the SHIPPED functions against stubs (no browser,
// no network): offerRefuel must route it through flagAuth (key cleared, key-rejected
// message, no stray top-up tab); refuelPoll must stop instead of retrying forever. ----
function extractAsyncFn(name) {
  const re = new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) throw new Error(`${name} not found`);
  const brace = src.indexOf("{", m.index);
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
    else if (mode === "'" || mode === '"') { if (c === "\\") p++; else if (c === mode) mode = "code"; }
    else if (mode === "tmpl") { if (c === "\\") p++; else if (c === "`") mode = "code"; }
  }
  if (end < 0) throw new Error(`could not extract ${name}`);
  return src.slice(m.index, end + 1);
}

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function runRefuelAuthCases() {
  const buildOffer = (fetchStub) => {
    let storedKey = "sk-nano-dead-key";
    const toasts = [], opened = [], flashes = [];
    const els = { refuelmodal: { hidden: true } };
    const parts = [
      extractAsyncFn("parseNanoDepositAddress"),
      extractAsyncFn("authHeaders"),
      extractAsyncFn("flagAuth"),
      extractAsyncFn("fetchBalanceInfo"),
      extractAsyncFn("offerRefuel"),
    ];
    const factory = new Function(
      "$", "getKey", "setKey", "fetch", "NANOGPT", "toast", "t",
      "window", "refuelSawBalance", "renderNanoQr", "refuelPoll", "_refuelClosedAt", "flash",
      parts.join("\n") + "\nreturn { offerRefuel, fetchBalanceInfo };"
    );
    const api = factory(
      (id) => els[id] || (els[id] = { hidden: false, textContent: "", value: "" }),
      () => storedKey, (k) => { storedKey = k; }, fetchStub, "https://nano-gpt.com",
      (msg, kind) => toasts.push({ msg, kind }), (s) => s,
      { open: (u) => { opened.push(u); return null; } },
      () => {}, () => {}, () => {}, 0, (m) => flashes.push(m)
    );
    return { api, state: () => ({ storedKey, toasts, opened, flashes, els }) };
  };
  const fail401 = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const fail500 = async () => ({ ok: false, status: 500, json: async () => ({}) });

  // fetchBalanceInfo must propagate the HTTP status so callers can tell auth from transient
  {
    const { api } = buildOffer(fail401);
    let status = null;
    try { await api.fetchBalanceInfo(); } catch (e) { status = e && e.status; }
    if (status !== 401) {
      console.error(`✗ fetchBalanceInfo must carry .status on HTTP failures (got ${JSON.stringify(status)})`);
      fails++;
    } else {
      console.log("✓ fetchBalanceInfo carries .status on HTTP failures");
    }
  }

  // manual chip click with a dead key: key cleared, truthful auth error, no top-up tab
  {
    const { api, state } = buildOffer(fail401);
    await api.offerRefuel(true);
    const s = state();
    if (s.storedKey !== null) {
      console.error("✗ offerRefuel(manual) on 401 kept the dead key — the chip still reads 'ready ✓' with no working account");
      fails++;
    } else if (s.toasts.some((t) => /deposit address/i.test(t.msg))) {
      console.error("✗ offerRefuel(manual) on 401 blamed the deposit address — the key is dead, not the address");
      fails++;
    } else if (!s.toasts.some((t) => /reject/i.test(t.msg) && t.kind === "err")) {
      console.error("✗ offerRefuel(manual) on 401 told the user nothing actionable about the rejected key");
      fails++;
    } else if (s.opened.length !== 0) {
      console.error("✗ offerRefuel(manual) on 401 opened a top-up tab for a dead session — re-auth comes first");
      fails++;
    } else {
      console.log("✓ offerRefuel(manual) on 401 clears the key with a key-rejected error (no deposit lie, no stray tab)");
    }
  }

  // auto (low-funds) path with a dead key: clear + flash, still no toast/popup
  {
    const { api, state } = buildOffer(fail401);
    await api.offerRefuel(false);
    const s = state();
    if (s.storedKey !== null) {
      console.error("✗ offerRefuel(auto) on 401 kept the dead key");
      fails++;
    } else if (s.toasts.length !== 0 || s.opened.length !== 0) {
      console.error("✗ offerRefuel(auto) on 401 must stay silent (flash only) — no toast, no popup");
      fails++;
    } else {
      console.log("✓ offerRefuel(auto) on 401 clears the key silently (flash only)");
    }
  }

  // transient (500) behaviour is unchanged: manual still gets the deposit toast + top-up tab
  {
    const { api, state } = buildOffer(fail500);
    await api.offerRefuel(true);
    const s = state();
    if (s.storedKey !== "sk-nano-dead-key") {
      console.error("✗ offerRefuel(manual) on 500 cleared the key — a transient failure must never log the user out");
      fails++;
    } else if (!s.toasts.some((t) => /deposit address/i.test(t.msg))) {
      console.error("✗ offerRefuel(manual) on 500 lost the deposit-address fallback toast");
      fails++;
    } else if (s.opened.length !== 1) {
      console.error("✗ offerRefuel(manual) on 500 must still open the nano-gpt.com top-up page");
      fails++;
    } else {
      console.log("✓ offerRefuel(manual) on 500 keeps the key with the deposit fallback + top-up tab");
    }
  }

  // refuelPoll with a persistently-dead key: one lookup, then drop the panel (no retry loop).
  // (The sleep stub hides the modal past a tick budget so a regressed infinite-retry fails
  // fast instead of hanging the harness — a fixed poll exits on its first tick.)
  {
    let storedKey = "sk-nano-dead-key", fetchCalls = 0, ticks = 0;
    const flashes = [];
    const els = { refuelmodal: { hidden: false }, refuelwait: { hidden: false }, refuelok: { hidden: true } };
    const factory = new Function(
      "$", "getKey", "setKey", "sleep", "document", "fetchBalanceInfo",
      "refuelSawBalance", "workflowCost", "refreshRunEstimate", "flash",
      ["let _refuelToken = 0;", extractAsyncFn("flagAuth"), extractAsyncFn("refuelPoll")].join("\n") +
      "\nreturn { refuelPoll };"
    );
    const api = factory(
      (id) => els[id], () => storedKey, (k) => { storedKey = k; },
      async () => { if (++ticks > 5) els.refuelmodal.hidden = true; }, { hidden: false },
      async () => { fetchCalls++; const e = new Error("check-balance 401"); e.status = 401; throw e; },
      () => {}, () => ({ usd: 5, priced: false }), () => {}, (m) => flashes.push(m)
    );
    api.refuelPoll(1.0, "sk-nano-dead-key");
    await settle();
    els.refuelmodal.hidden = true; // stop any runaway loop before asserting
    await settle(10);
    if (fetchCalls !== 1) {
      console.error(`✗ refuelPoll on persistent 401 retried ${fetchCalls}x — a dead key can never succeed, stop after one lookup`);
      fails++;
    } else if (storedKey !== null || els.refuelmodal.hidden !== true) {
      console.error("✗ refuelPoll on 401 must clear the dead key and drop its (wrong-account) panel");
      fails++;
    } else {
      console.log("✓ refuelPoll on 401 stops after one lookup, clears the key, drops the panel");
    }
  }

  // refuelPoll happy path still flips to success when a deposit lands
  {
    let storedKey = "sk-nano-key", ticks = 0;
    const els = { refuelmodal: { hidden: false }, refuelwait: { hidden: false }, refuelok: { hidden: true } };
    const factory = new Function(
      "$", "getKey", "setKey", "sleep", "document", "fetchBalanceInfo",
      "refuelSawBalance", "workflowCost", "refreshRunEstimate", "flash",
      ["let _refuelToken = 0;", extractAsyncFn("flagAuth"), extractAsyncFn("refuelPoll")].join("\n") +
      "\nreturn { refuelPoll };"
    );
    const api = factory(
      (id) => els[id], () => storedKey, (k) => { storedKey = k; },
      async () => { if (++ticks > 5) els.refuelmodal.hidden = true; }, { hidden: false },
      async () => ({ usd: 5.0, addr: "nano_x" }),
      () => {}, () => ({ usd: 4.0, priced: true }), () => {}, () => {}
    );
    api.refuelPoll(1.0, "sk-nano-key");
    await settle();
    els.refuelmodal.hidden = true;
    if (els.refuelok.hidden !== false || storedKey !== "sk-nano-key") {
      console.error("✗ refuelPoll no longer flips to success when a deposit lands");
      fails++;
    } else {
      console.log("✓ refuelPoll still flips to success when a deposit lands");
    }
  }
}

await runRefuelAuthCases();

if (fails) {
  console.error(`check-refuel-deposit: FAIL (${fails})`);
  process.exit(1);
}
console.log("check-refuel-deposit: OK");
