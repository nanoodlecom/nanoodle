#!/usr/bin/env node
// Imported-app request pacing (offline, no network, no API spend).
//
// A shared (#a=) app is arbitrary JS in a null-origin sandbox that reaches NanoGPT only through the
// parent's __api__ bridge, borrowing the signed-in viewer's key. The key can never leak, but an
// unmetered app could fire paid generation calls in a loop and quietly spend the viewer's balance. So
// the bridge runs SPEND-INITIATING calls from IMPORTED apps through a token bucket; polling/catalog
// reads and the viewer's own apps are never metered. This pins that contract by lifting the real
// PACE bucket + classifyBridgePath() out of play.html (the block between PACE_GUARD_START/END) and
// exercising it in a node:vm sandbox with a controllable clock. Same offline technique as the sibling
// scripts/check-*.mjs — extract the shipped source, drive it, assert behavior.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = join(ROOT, "play.html");
const html = readFileSync(PLAY, "utf8");

const A = "// PACE_GUARD_START", B = "// PACE_GUARD_END";
const a = html.indexOf(A), b = html.indexOf(B);
if (a < 0 || b < 0) { console.error("✗ import-pacing: PACE_GUARD markers not found in play.html"); process.exit(1); }
const block = html.slice(a + A.length, b);

// Sandbox the real block with a controllable clock (Date.now) and a mutable curImported, plus stubs
// for the DOM-touching notice helpers so the pure logic runs headless.
const preamble =
  "var curImported = false, __now = 0, __noticeShown = 0;\n" +
  "var Date = { now: function(){ return __now; } };\n" +
  "function showPaceNotice(){ __noticeShown++; }\n" +
  "function hidePaceNotice(){}\n";
const epilogue =
  "\nglobalThis.__pace = { PACE: PACE, classify: classifyBridgePath, reset: paceReset, charge: paceChargeCall," +
  " setImported: function(v){ curImported = v; }, advance: function(ms){ __now += ms; }," +
  " notices: function(){ return __noticeShown; }, resetNotices: function(){ __noticeShown = 0; } };\n";

const ctx = { globalThis: null };
ctx.globalThis = ctx;
vm.createContext(ctx);
new vm.Script(preamble + block + epilogue, { filename: "play.html#pace" }).runInContext(ctx);
const P = ctx.__pace;

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log("  ✗ " + msg); } };

// ---- 1. endpoint classification: charge vs free vs blocked ---------------
ok(P.classify("/v1/images/generations") === "charge", "images/generations must be a charge endpoint");
ok(P.classify("/api/v1/chat/completions") === "charge", "chat/completions must be a charge endpoint");
ok(P.classify("/api/generate-video") === "charge", "generate-video must be a charge endpoint");
ok(P.classify("/api/v1/audio/speech") === "charge", "audio/speech must be a charge endpoint");
ok(P.classify("/api/video/status") === "poll", "video/status must be a (free) poll endpoint");
ok(P.classify("/api/video/status?requestId=abc") === "poll", "video/status w/ query must classify by prefix");
ok(P.classify("/api/tts/status?x=1") === "poll", "tts/status must be a (free) poll endpoint");
ok(P.classify("/api/v1/models") === "catalog", "models must be a (free) catalog endpoint");
ok(P.classify("/api/v1/video-models") === "catalog", "video-models must be a (free) catalog endpoint");
ok(P.classify("/api/check-balance") === null, "check-balance must NOT be allowlisted");
ok(P.classify("/api/account") === null, "account must NOT be allowlisted");

// ---- 2. OWN (non-imported) apps are never metered ------------------------
{
  P.setImported(false); P.reset(); P.resetNotices();
  let allowed = 0;
  for (let i = 0; i < P.PACE.cap * 5; i++) if (P.charge()) allowed++;
  ok(allowed === P.PACE.cap * 5, `own app: every charge call must pass unmetered, allowed ${allowed}/${P.PACE.cap * 5}`);
  ok(P.notices() === 0, "own app: the notice must never appear");
}

// ---- 3. a normal wide Run for an IMPORTED app is untouched ---------------
// Worst realistic single press: graph-width x 8 lanes. Even a generous 8 gen nodes x 8 lanes = 64
// bursts through with no hold and no notice (cap sits well above it).
{
  P.setImported(true); P.reset(); P.resetNotices();
  const burst = 8 * 8;   // 64
  let allowed = 0;
  for (let i = 0; i < burst; i++) if (P.charge()) allowed++;
  ok(allowed === burst, `imported wide Run: all ${burst} charge calls must pass, allowed ${allowed}`);
  ok(P.notices() === 0, "imported wide Run: no notice on a legitimate burst");
}

// ---- 4. a runaway loop is BOUNDED then HELD, and surfaces the notice once -
{
  P.setImported(true); P.reset(); P.resetNotices();
  let allowed = 0, held = 0;
  for (let i = 0; i < 10000; i++) { if (P.charge()) allowed++; else held++; }   // no clock advance: a tight loop
  ok(allowed <= P.PACE.cap, `drain loop: at most cap(${P.PACE.cap}) calls may pass before the hold, ${allowed} did`);
  ok(held > 0, "drain loop: once the budget is spent, further charge calls must be held");
  ok(P.notices() === 1, `drain loop: the notice must appear exactly once, appeared ${P.notices()}`);
}

// ---- 5. holding a charge lane never blocks polling/catalog ---------------
// (poll/catalog are classified free and never enter paceChargeCall, so they're structurally exempt —
// pinned via classification above; here we assert the held state doesn't leak into a refusal to poll.)
{
  P.setImported(true); P.reset(); P.resetNotices();
  for (let i = 0; i < 10000; i++) P.charge();   // exhaust + hold
  ok(P.classify("/api/video/status?requestId=z") === "poll", "poll classification must hold even while charges are held");
  ok(P.classify("/api/v1/models") === "catalog", "catalog classification must hold even while charges are held");
}

// ---- 6. refill tops a PARTIALLY-drawn bucket back up over real time -------
// (Stays off the floor the whole time, so it never latches — this is exactly what keeps a legit
// sustained flow from tripping the hold.)
{
  P.setImported(true); P.reset(); P.resetNotices();
  for (let i = 0; i < 60; i++) P.charge();              // draw 60 of cap (never empties)
  P.advance(2000);                                      // 2s later: +2*refill, capped at cap
  let allowed = 0;
  for (let i = 0; i < P.PACE.cap; i++) if (P.charge()) allowed++;
  ok(allowed >= P.PACE.cap - 2, `refill: after 2s a partially-drawn bucket should be back near full, only ${allowed} of ${P.PACE.cap} passed`);
  ok(P.notices() === 0, "refill: staying off the floor must never surface the notice");
}

// ---- 7. a sustained legit keep-generate never trips the notice -----------
// 8 lanes x 8 gen nodes re-firing every ~2s = 32 calls/sec; refill (>=32/s) tops the bucket faster
// than it draws, so a full minute of keep-generate never reaches empty (net positive each second).
{
  P.setImported(true); P.reset(); P.resetNotices();
  ok(P.PACE.refill >= 32, `refill (${P.PACE.refill}/s) must cover the worst sustained legit rate (32/s)`);
  let allowed = 0;
  for (let sec = 0; sec < 60; sec++) { for (let i = 0; i < 32; i++) if (P.charge()) allowed++; P.advance(1000); }
  ok(allowed === 60 * 32, `sustained legit keep-generate: all ${60 * 32} calls must pass, ${allowed} did`);
  ok(P.notices() === 0, "sustained legit keep-generate must never surface the notice");
}

// ---- 7b. a PERSISTENT loop can't keep leaking calls at the refill rate ----
// After the hold latches, even as real time passes (refill), NO further charge call is released until
// the viewer resumes — so an infinite loop is stopped, not throttled to refill/sec.
{
  P.setImported(true); P.reset(); P.resetNotices();
  let allowed = 0;
  for (let sec = 0; sec < 60; sec++) { for (let i = 0; i < 1000; i++) if (P.charge()) allowed++; P.advance(1000); }
  ok(allowed <= P.PACE.cap, `persistent loop: total released must stay <= cap(${P.PACE.cap}) despite 60s of refill, got ${allowed}`);
  ok(P.notices() === 1, `persistent loop: exactly one notice across the whole run, got ${P.notices()}`);
}

// ---- 8. Continue lifts the meter for the rest of the session -------------
// (The notice's Continue button sets PACE.lifted = true; simulate that state.)
{
  P.setImported(true); P.reset(); P.resetNotices();
  for (let i = 0; i < 10000; i++) P.charge();           // drain + hold
  P.PACE.lifted = true;                                 // viewer clicked Continue
  let allowed = 0;
  for (let i = 0; i < 1000; i++) if (P.charge()) allowed++;
  ok(allowed === 1000, `after Continue, charges must flow freely, allowed ${allowed}/1000`);
}

// ---- 9. a fresh mount (reset) restores the full budget + clears state ----
{
  P.setImported(true); P.reset();
  for (let i = 0; i < 10000; i++) P.charge();           // drain, hold, (would show notice)
  P.reset();                                            // renderApp() on the next app
  ok(P.PACE.tokens === P.PACE.cap, "reset must restore a full budget");
  ok(P.PACE.held === false && P.PACE.lifted === false, "reset must clear held/lifted state");
}

if (failed) { console.error(`\n✗ check-import-pacing: ${failed} assertion(s) failed`); process.exit(1); }
console.log(`✓ imported-app request pacing holds (cap ${P.PACE.cap}, refill ${P.PACE.refill}/s; charge/poll/catalog split, own apps unmetered, drain bounded + surfaced once).`);
