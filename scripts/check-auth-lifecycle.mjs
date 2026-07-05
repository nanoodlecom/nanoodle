#!/usr/bin/env node
// Pins the API-key lifecycle & auth-clear state machine in index.html — the
// money/lockout-critical logic that decides when a stored key is wiped and when
// a run error is (mis)read as "out of funds".
//
// Why this needs a guard: two directions of drift both hurt real users.
//   • WIDEN the clear conditions (e.g. also clear on 400/402/429/500/network) and
//     a benign, transient error logs a paying user out mid-run — they re-auth to
//     "fix" a problem that was never their key.  (silent OAuth-error wipe: PR #137)
//   • NARROW key acceptance wrongly and a physically-sendable key is refused, or
//     an UNsendable one is stored so every run throws "failed to fetch".
//     (smart-dash / non-ASCII pasted keys → false "ready ✓": PR #130)
//
// No browser, no network, no key. We lift the SHIPPED functions out of index.html
// as text and drive them against stubs — never re-implementing the logic under test:
//   flagAuth · isLowFundsError · friendlyRunError · cleanKey · keySendable ·
//   probeKey · the #keysave click handler (paste→store gate).
//
// Optional env NANOODLE_ROOT overrides the repo root (used by the self-test to
// point the same extraction+assertions at a mutated copy). Default: script-relative.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.NANOODLE_ROOT
  ? resolve(process.env.NANOODLE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");

const failures = [];
const fail = (msg) => failures.push(msg);
const expect = (cond, msg) => { if (!cond) fail(msg); };

// ---- JS-string/comment/template-aware brace matcher (house pattern, from check-share-link) ----
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

// pull `[async] function <name>(...) { ... }` out as text, preserving a leading async.
function extractFunction(src, name) {
  const sig = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}()`);
  const open = src.indexOf("{", m.index);
  const close = matchBrace(src, open);
  return src.slice(m.index, close + 1);
}

// pull a single-line `const <name> = ...;` statement out as text (keySendable).
function extractConstLine(src, name) {
  const re = new RegExp("const\\s+" + name + "\\s*=[^\\n]*");
  const m = re.exec(src);
  if (!m) throw new Error(`could not find const ${name}`);
  return m[0];
}

// pull the async arrow assigned to $("keysave").onclick as text ('async ()=>{...}').
function extractKeysaveHandler(src) {
  const anchor = '$("keysave").onclick = ';
  const at = src.indexOf(anchor);
  if (at === -1) throw new Error("could not find the #keysave click handler wiring");
  const start = at + anchor.length;
  const open = src.indexOf("{", start);
  const close = matchBrace(src, open);
  return src.slice(start, close + 1);
}

const src = readFileSync(join(ROOT, "index.html"), "utf8");

// ---- assemble one runnable program from the SHIPPED source pieces ----
let build;
try {
  const cleanKeyText        = extractFunction(src, "cleanKey");
  const keySendableText     = extractConstLine(src, "keySendable");
  const flagAuthText        = extractFunction(src, "flagAuth");
  const isLowFundsText      = extractFunction(src, "isLowFundsError");
  const friendlyRunErrText  = extractFunction(src, "friendlyRunError");
  const probeKeyText        = extractFunction(src, "probeKey");
  const keysaveText         = extractKeysaveHandler(src);

  const program =
    `${cleanKeyText}\n` +
    `${keySendableText}\n` +
    `${flagAuthText}\n` +
    `${isLowFundsText}\n` +
    `${friendlyRunErrText}\n` +
    `${probeKeyText}\n` +
    `const keysaveHandler = ${keysaveText};\n` +
    `return { cleanKey, keySendable, flagAuth, isLowFundsError, friendlyRunError, probeKey, keysaveHandler };\n`;

  const factory = new Function(
    "setKey", "flash", "t", "toast", "$", "fetch", "CHAT_ENDPOINT", program
  );
  build = (stubs) => factory(
    stubs.setKey, stubs.flash, stubs.t, stubs.toast, stubs.$, stubs.fetch, stubs.CHAT_ENDPOINT
  );
} catch (e) {
  process.stderr.write("✗ auth-lifecycle: could not lift the shipped functions — the state machine moved or was renamed:\n  " + (e && e.message ? e.message : e) + "\n");
  process.exit(1);
}

// ---- mutable harness state shared with the extracted functions via param wrappers ----
let setKeyCalls = [];         // every setKey(...) argument, in order
let toastCalls = [];          // every toast(msg, kind) call
let currentFetch = async () => { throw new Error("no fetch stub installed"); };
let dom = {};

const el = (extra = {}) => ({
  value: "", textContent: "", disabled: false, hidden: false, focus() {}, select() {}, style: {},
  classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); } },
  ...extra,
});
function freshDom(inputVal = "") {
  dom = { keyinput: el({ value: inputVal }), keysave: el({ textContent: "Save" }), keyrow: el(), status: el() };
}

const api = build({
  setKey: (k) => { setKeyCalls.push(k); },
  flash: () => {},
  t: (s) => s,                                   // identity — we only assert on branch behaviour, not copy
  toast: (msg, kind) => { toastCalls.push({ msg, kind }); },
  $: (id) => dom[id] || (dom[id] = el()),
  fetch: (...a) => currentFetch(...a),           // delegate so probeKey sees per-test responses
  CHAT_ENDPOINT: "https://nano-gpt.com/api/v1/chat/completions",
});

const reset = (inputVal) => { setKeyCalls = []; toastCalls = []; freshDom(inputVal); };

// ======================================================================
// INVARIANT 1 — flagAuth clears the stored key ONLY on HTTP 401/403.
//   A benign/transient failure (400 bad request, 402 low funds, 429 rate-limit,
//   500 server, or a non-HTTP network failure) must NEVER wipe the key.
// ======================================================================
for (const [status, shouldClear] of [
  [401, true], [403, true],
  [400, false], [402, false], [429, false], [500, false],
  [undefined, false],   // non-HTTP failure surfaced as { status: undefined }
]) {
  reset();
  api.flagAuth({ status });
  const cleared = setKeyCalls.length === 1 && setKeyCalls[0] === null;
  if (shouldClear && !cleared)
    fail(`flagAuth(${status}) did NOT clear the key — a rejected key stays stored and every run keeps failing`);
  if (!shouldClear && cleared)
    fail(`flagAuth(${status}) cleared the key — a benign ${status} error would log the user out mid-run`);
}

// ======================================================================
// INVARIANT 2 — isLowFundsError: recognise genuine insufficient-balance shapes,
//   but the STATUS guard must keep an auth error (401/403) from masquerading as
//   a funds problem even when its body says "insufficient …".
// ======================================================================
for (const [status, body, want, why] of [
  [402, "",                        true,  "402 is the canonical payment-required status"],
  [402, "anything at all",         true,  "402 wins regardless of body"],
  [400, "insufficient balance",    true,  "body names a balance shortfall"],
  [429, "not enough funds",        true,  "body names a funds shortfall"],
  [403, "insufficient permissions", false, "403 is auth's territory — must not read as low funds (the PR-comment case)"],
  [401, "insufficient balance",    false, "even a balance-sounding body on a 401 stays auth's territory"],
  [400, "model not found",         false, "no balance keywords → not a funds error"],
  [500, "internal server error",   false, "no balance keywords → not a funds error"],
]) {
  const got = api.isLowFundsError(status, body);
  if (!!got !== want)
    fail(`isLowFundsError(${status}, ${JSON.stringify(body)}) = ${got}, expected ${want} — ${why}`);
}

// ======================================================================
// INVARIANT 3 — friendlyRunError: the TypeError/unsendable-key branch clears a
//   physically-unsendable key, but an API response body that merely echoes
//   "Invalid value" for a GOOD ascii key (thrown by us as a plain Error) must NOT.
// ======================================================================
{
  // 3a: a real header/encoding TypeError → clears the key (it can't ride an HTTP header)
  reset();
  api.friendlyRunError(new TypeError("Failed to set the 'value' property on 'Headers': Invalid value."));
  expect(setKeyCalls.length === 1 && setKeyCalls[0] === null,
    "friendlyRunError did NOT clear a key that throws a header TypeError (Invalid value) — every run would keep failing identically");

  reset();
  api.friendlyRunError(new TypeError("non ISO-8859-1 code point"));
  expect(setKeyCalls.length === 1 && setKeyCalls[0] === null,
    "friendlyRunError did NOT clear a key that throws an ISO-8859-1 TypeError");

  // 3b: our own "400: Invalid value …" Error (NOT a TypeError) must leave a good key alone
  reset();
  api.friendlyRunError(new Error("400: Invalid value for parameter 'model'"));
  expect(setKeyCalls.length === 0,
    "friendlyRunError WIPED a good ascii key because the API body said 'Invalid value' — a server-side param error must not log the user out");

  // 3c: a network TypeError (Failed to fetch) must not clear the key either
  reset();
  api.friendlyRunError(new TypeError("Failed to fetch"));
  expect(setKeyCalls.length === 0,
    "friendlyRunError cleared the key on a 'Failed to fetch' network error — that's transient, not a bad key");

  // 3d: an unrelated Error passes through unchanged, no clear
  reset();
  const passthru = api.friendlyRunError(new Error("some unrelated failure"));
  expect(setKeyCalls.length === 0, "friendlyRunError cleared the key on an unrelated Error");
  expect(passthru === "some unrelated failure", "friendlyRunError altered an unrelated error message");
}

// ======================================================================
// INVARIANT 4 — cleanKey + keySendable normalise/reject before storage; the
//   #keysave handler refuses to store a physically-unsendable key.
// ======================================================================
{
  // smart hyphen (U+2010) → '-', NBSP stripped; result is sendable ascii
  const c1 = api.cleanKey("sk‐nano test123");
  expect(c1 === "sk-nanotest123", `cleanKey did not normalise smart-dash/NBSP: got ${JSON.stringify(c1)}`);
  expect(api.keySendable(c1) === true, "keySendable rejected a normalised ascii key");

  // surrounding whitespace/zero-width stripped
  const c2 = api.cleanKey("  sk-nano-1234​  ");
  expect(c2 === "sk-nano-1234", `cleanKey did not strip surrounding/zero-width whitespace: got ${JSON.stringify(c2)}`);

  // a residual non-ascii char (accented é) survives cleanKey but is NOT sendable
  const c3 = api.cleanKey("sk-nano-ékey");
  expect(api.keySendable(c3) === false, "keySendable ACCEPTED a key with a non-ascii char — it can't ride an HTTP header");

  // plain ascii key is sendable
  expect(api.keySendable("sk-nano-abc123-DEF") === true, "keySendable rejected a plain ascii key");

  // #keysave gate: an unsendable key must NOT be stored (no setKey), user is told
  await (async () => {
    reset("sk-nano-ékey");   // pre-fill #keyinput with the non-ascii key
    await api.keysaveHandler();
    expect(setKeyCalls.length === 0,
      "#keysave STORED a physically-unsendable key — a false 'ready ✓' where every run then fails");
    expect(toastCalls.some(c => c.kind === "err"),
      "#keysave silently swallowed an unsendable key (no error toast)");
  })();

  // #keysave happy path: a good ascii key that probes OK is stored
  await (async () => {
    reset("sk-nano-good-key");
    currentFetch = async () => ({ status: 200 });
    await api.keysaveHandler();
    expect(setKeyCalls.length === 1 && setKeyCalls[0] === "sk-nano-good-key",
      "#keysave did not store a valid, probe-OK ascii key");
  })();

  // #keysave rejects a key the probe reports as bad (401) — storing it would mint a
  // false "ready ✓" that fails every run, the exact regression this guard exists for.
  await (async () => {
    reset("sk-nano-bad-key");
    currentFetch = async () => ({ status: 401 });
    await api.keysaveHandler();
    expect(setKeyCalls.length === 0,
      "#keysave STORED a key the probe rejected (401) — false 'ready ✓', every run then fails");
    expect(toastCalls.some(c => c.kind === "err"),
      "#keysave rejected the bad key but told the user nothing (no error toast)");
  })();

  // #keysave is network-tolerant: when the probe can't reach nano-gpt (throw → "unverified")
  // a correctly-pasted key must STILL be stored, never refused — locking it out on a network
  // blip would strand a paying user offline. (mirror of probeKey's "unverified ≠ bad".)
  await (async () => {
    reset("sk-nano-offline-key");
    currentFetch = async () => { throw new TypeError("Failed to fetch"); };
    await api.keysaveHandler();
    expect(setKeyCalls.length === 1 && setKeyCalls[0] === "sk-nano-offline-key",
      "#keysave REFUSED a good key because nano-gpt was unreachable — an offline user can never save a key");
  })();
}

// ======================================================================
// INVARIANT 5 — probeKey classifies via stubbed fetch:
//   401/403 → "bad"; 200/400 → "ok" (usable); a network throw → "unverified"
//   (unverified ≠ invalid: never lock out a good key when nano-gpt is unreachable).
// ======================================================================
for (const [status, want] of [
  [401, "bad"], [403, "bad"], [200, "ok"], [400, "ok"],
  // ONLY a readable 401/403 is "bad": a transient 500 or a 402 (funds) must stay usable,
  // or a server hiccup at save-time would lock out a perfectly good key.
  [500, "ok"], [402, "ok"], [429, "ok"],
]) {
  currentFetch = async () => ({ status });
  const got = await api.probeKey("sk-nano-x");
  if (got !== want)
    fail(`probeKey with a ${status} response = ${JSON.stringify(got)}, expected ${JSON.stringify(want)} — only a readable 401/403 may be "bad"; a transient/funds status must not lock out a good key`);
}
{
  currentFetch = async () => { throw new TypeError("Failed to fetch"); };
  const got = await api.probeKey("sk-nano-x");
  expect(got === "unverified",
    `probeKey on a network failure = ${JSON.stringify(got)}, expected "unverified" — a good key must not be marked bad when nano-gpt is unreachable`);
}

// ======================================================================
if (failures.length) {
  process.stderr.write(
    "✗ auth-lifecycle: the API-key clear/accept state machine regressed:\n\n- " +
    failures.join("\n- ") + "\n"
  );
  process.exit(1);
}
process.stdout.write(
  "✓ auth-lifecycle: key cleared only on 401/403, low-funds guarded from auth errors, unsendable keys refused, probe network-tolerant.\n"
);
