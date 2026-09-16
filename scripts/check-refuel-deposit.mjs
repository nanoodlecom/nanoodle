#!/usr/bin/env node
// Pins parseNanoDepositAddress + fetchBalanceInfo + offerRefuel in index.html.
// The bal chip opens the refuel QR from /api/check-balance; a too-strict regex,
// a renamed JSON field, or a silent manual miss makes signed-in top-up look broken
// even when usd_balance paints fine. Auto-open on a failed run must stay silent
// (no tab spam); a chip click must toast AND open nano-gpt.com.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "index.html"), "utf8");

function extractFn(name) {
  const re = new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) throw new Error(`${name} not found`);
  const brace = src.indexOf("{", m.index + m[0].length - 1);
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

const parseSrc = extractFn("parseNanoDepositAddress");
const fetchSrc = extractFn("fetchBalanceInfo");
const offerSrc = extractFn("offerRefuel");
const pollSrc = extractFn("refuelPoll");

const good = "nano_1gx385nnj7rw67hsksa3pyxwnfr48zu13t35ncjmtnqb9zdebtjhh7ahks34";
let fails = 0;
function ok(cond, msg) {
  if (cond) console.log(`✓ ${msg}`);
  else { console.error(`✗ ${msg}`); fails++; }
}

const parseNanoDepositAddress = new vm.Script(parseSrc + "\nparseNanoDepositAddress;").runInNewContext({});

const cases = [
  [good, good],
  ["  " + good + "  ", good],
  ["nano:" + good, good],
  ["NANO:" + good.toUpperCase(), good],
  ["NANO_" + good.slice(5).toUpperCase(), good],
  ["xrb_" + good.slice(5), good],
  ["", null],
  [null, null],
  [12, null],
  ["nano_short", null],
  ["nano_" + "1".repeat(59), null], // 64 chars
  ["nano_" + "1".repeat(61), null], // 66 chars
  ["nano_000000000000000000000000000000000000000000000000000000000000", null], // 0 not in alphabet
];

for (const [input, want] of cases) {
  const got = parseNanoDepositAddress(input);
  ok(got === want, `parseNanoDepositAddress(${JSON.stringify(input)?.slice(0, 28) ?? input})`);
  if (got !== want) console.error(`   got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

function freshSandbox() {
  const sandbox = {
    NANOGPT: "https://nano-gpt.com",
    authHeaders() { return { Authorization: "Bearer test-key" }; },
    fetch(...args) { return sandbox.__fetch(...args); },
    getKey() { return sandbox.__key; },
    $(id) { return sandbox.__els[id]; },
    toast(msg, kind) { sandbox.__toasts.push({ msg, kind }); },
    window: { open(url, target, feats) { sandbox.__opens.push({ url, target, feats }); } },
    t: (s) => s,
    renderNanoQr(payload, el) {
      sandbox.__qr.push(payload);
      if (el) el.innerHTML = "<svg></svg>";
    },
    refuelPoll(baseline, key) { sandbox.__polls.push({ baseline, key }); },
    refuelSawBalance(usd) { sandbox.__saw.push(usd); },
    Date,
    _refuelClosedAt: 0,
    __key: "test-key",
    __els: {},
    __toasts: [],
    __opens: [],
    __qr: [],
    __polls: [],
    __saw: [],
    __fetch: async () => { throw new Error("fetch not stubbed"); },
  };
  vm.createContext(sandbox);
  new vm.Script(parseSrc + "\n" + fetchSrc + "\n" + offerSrc, { filename: "index.html#refuel" })
    .runInContext(sandbox);
  return sandbox;
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

function resetModal(sandbox) {
  sandbox.__els = {
    refuelmodal: { hidden: true },
    refueltitle: { textContent: "" },
    refuelhint: { textContent: "" },
    refueladdr: { value: "" },
    refuelcopy: { textContent: "", classList: { remove() {}, add() {} } },
    refuelqr: { innerHTML: "" },
    refuelwait: { hidden: true },
    refuelok: { hidden: true },
  };
  sandbox.__toasts = [];
  sandbox.__opens = [];
  sandbox.__qr = [];
  sandbox.__polls = [];
  sandbox.__saw = [];
  sandbox._refuelClosedAt = 0;
  sandbox.__key = "test-key";
}

{
  const S = freshSandbox();
  S.__fetch = async () => jsonResponse({ usd_balance: "1.25", nanoDepositAddress: good });
  const info = await S.fetchBalanceInfo();
  ok(info.usd === 1.25 && info.addr === good, "fetchBalanceInfo reads camelCase nanoDepositAddress");
}

{
  const S = freshSandbox();
  S.__fetch = async () => jsonResponse({ usd_balance: "2", nano_deposit_address: "  " + good + "  " });
  const info = await S.fetchBalanceInfo();
  ok(info.usd === 2 && info.addr === good, "fetchBalanceInfo reads snake_case nano_deposit_address");
}

{
  const S = freshSandbox();
  S.__fetch = async () => jsonResponse({ usd_balance: "3", depositAddress: "xrb_" + good.slice(5) });
  const info = await S.fetchBalanceInfo();
  ok(info.usd === 3 && info.addr === good, "fetchBalanceInfo reads depositAddress and normalizes xrb_");
}

{
  const S = freshSandbox();
  S.__fetch = async () => jsonResponse({ usd_balance: "4", nanoDepositAddress: "nano:" + good });
  const info = await S.fetchBalanceInfo();
  ok(info.addr === good, "fetchBalanceInfo strips a nano: URI prefix");
}

{
  const S = freshSandbox();
  S.__fetch = async () => jsonResponse({ usd_balance: "5.5" });
  const info = await S.fetchBalanceInfo();
  ok(info.usd === 5.5 && info.addr === null, "fetchBalanceInfo keeps usd when the address is absent");
}

{
  const S = freshSandbox();
  S.__fetch = async () => jsonResponse({ error: "nope" }, { ok: false, status: 401 });
  let threw = false;
  try { await S.fetchBalanceInfo(); } catch { threw = true; }
  ok(threw, "fetchBalanceInfo throws on a non-OK check-balance");
}

{
  const S = freshSandbox();
  resetModal(S);
  S.__fetch = async () => jsonResponse({ usd_balance: "1" }); // no address
  await S.offerRefuel(true);
  ok(S.__toasts.length === 1 && /deposit address/i.test(S.__toasts[0].msg),
    "offerRefuel(manual) toasts when the address is missing");
  ok(S.__opens.length === 1 && S.__opens[0].url === "https://nano-gpt.com" && S.__opens[0].feats === "noopener",
    "offerRefuel(manual) opens nano-gpt.com on an address miss");
  ok(S.__els.refuelmodal.hidden === true && S.__polls.length === 0,
    "offerRefuel(manual) miss does not open the QR panel");
}

{
  const S = freshSandbox();
  resetModal(S);
  S.__fetch = async () => jsonResponse({ usd_balance: "1" });
  await S.offerRefuel(); // auto, from a low-funds run error
  ok(S.__toasts.length === 0 && S.__opens.length === 0,
    "offerRefuel(auto) stays silent on an address miss (no toast, no tab)");
  ok(S.__els.refuelmodal.hidden === true, "offerRefuel(auto) miss leaves the panel closed");
}

{
  const S = freshSandbox();
  resetModal(S);
  S.__fetch = async () => jsonResponse({ usd_balance: "4.2", nano_deposit_address: "XRB_" + good.slice(5).toUpperCase() });
  await S.offerRefuel(true);
  ok(S.__opens.length === 0 && S.__toasts.length === 0, "offerRefuel(manual) success does not fall back to nano-gpt.com");
  ok(S.__els.refueladdr.value === good, "offerRefuel writes the normalized nano_ address");
  ok(S.__qr[0] === "nano:" + good, "offerRefuel QR payload is nano:<normalized address>");
  ok(S.__els.refuelmodal.hidden === false, "offerRefuel success shows the panel");
  ok(S.__polls.length === 1 && S.__polls[0].baseline === 4.2 && S.__polls[0].key === "test-key",
    "offerRefuel starts the poll with the opening balance");
  ok(S.__saw[0] === 4.2, "offerRefuel paints the freshly polled balance");
}

{
  const S = freshSandbox();
  resetModal(S);
  S.__key = "";
  S.__fetch = async () => { throw new Error("must not fetch while signed out"); };
  await S.offerRefuel(true);
  ok(S.__opens.length === 0 && S.__toasts.length === 0, "offerRefuel is a no-op while signed out");
}

const cond = pollSrc.match(/info\.usd > baseline && \(\!\(priced && need>0\) \|\| info\.usd >= need\)/);
ok(!!cond, "refuelPoll requires a deposit (usd > baseline), not merely usd >= estimate");
if (cond) {
  const enough = new vm.Script(`(function(info, baseline, priced, need){ return ${cond[0]}; })`).runInNewContext({});
  const rows = [
    [{ usd: 1 }, 1, true, 1, false, "balance already at the estimate is not success"],
    [{ usd: 1.5 }, 1, true, 2, false, "a deposit that is still short of the estimate is not success"],
    [{ usd: 2 }, 1, true, 2, true, "a deposit that covers the estimate is success"],
    [{ usd: 1.5 }, 1, false, 0, true, "an unpriced graph succeeds on any deposit"],
    [{ usd: 1.5 }, 1, true, 0, true, "priced-but-zero estimate succeeds on any deposit"],
    [{ usd: 1 }, 1, false, 0, false, "no rise and no estimate is not success"],
  ];
  for (const [info, baseline, priced, need, want, label] of rows) {
    ok(enough(info, baseline, priced, need) === want, `refuelPoll: ${label}`);
  }
}

if (fails) {
  console.error(`check-refuel-deposit: FAIL (${fails})`);
  process.exit(1);
}
console.log("check-refuel-deposit: OK");
