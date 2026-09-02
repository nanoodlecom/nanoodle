#!/usr/bin/env node
// Guard the SESSION COST-METER AGGREGATION in BOTH engines (index.html editor + play.html runtime).
//
// check-pricing.mjs already guards the per-unit USD *estimators* (videoUnitUsd/chatUnitUsd/…).
// NOTHING guarded the *aggregation* — the code that folds each NanoGPT response into the number the
// user reads as "what I actually spent this session" and the live balance chip. That aggregation is a
// separate, subtle contract (live-probed, recorded in project memory):
//   • Real cost wins: a top-level j.cost>0 beats x_nanogpt_pricing.{costUsd|cost} beats the local estimate.
//   • ZERO ≠ MISSING: a present-but-zero price is KNOWN-FREE (subscription-included) → it accrues $0 and
//     the meter stays EXACT. A genuinely absent price falls back to the estimate and flips the session
//     to approximate ("~"), so a paid run never silently reads $0.
//   • Balance: the x-remaining-balance response HEADER is NanoGPT's canonical post-charge figure and
//     overrides any body balance; the cached balance round-trips through localStorage.
//   • Accumulation: multiple runs sum; the exact→approximate flag is STICKY (never flips back).
// index.html and play.html carry SEPARATE aggregators (accrue vs costFromJson/costWithHeaders/bumpCost)
// — dual-engine drift is the classic miss here (PRs #74/#64/#88). This pins both so they can't silently
// disagree, and pins each engine's zero-vs-missing + precedence + balance semantics against fixtures.
//
// Fully offline (no API spend, no browser). House pattern (see check-share-link.mjs / check-pricing.mjs):
// we LIFT the real shipped functions out of the HTML as text and run them in node:vm against stubs —
// never re-implementing the logic under test. Response fixtures below are the exact shapes NanoGPT
// returns (JSON body ± x-remaining-balance / x-cost headers), captured from live probing.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// ROOT is resolved from the script's own location so the check is relocatable (the self-test runs a
// copy of this script + the two HTML files from a sandbox directory and mutates the copies).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---- JS-string/comment/template-aware brace matcher + function extractor ----
   Copied verbatim from the house pattern (check-share-link.mjs) so we pull the SHIPPED
   source out as text rather than re-implementing it. */
function matchBrace(src, openIdx){
  let depth = 0; const tmpl = []; let mode = "code";
  for(let i = openIdx; i < src.length; i++){
    const c = src[i], n = src[i+1];
    if(mode === "code"){
      if(c === "/" && n === "/"){ mode = "line"; i++; }
      else if(c === "/" && n === "*"){ mode = "block"; i++; }
      else if(c === "'") mode = "sq";
      else if(c === '"') mode = "dq";
      else if(c === "`") mode = "tpl";
      else if(c === "{") depth++;
      else if(c === "}"){ depth--; if(tmpl.length && depth === tmpl[tmpl.length-1]){ tmpl.pop(); mode = "tpl"; } else if(depth === 0) return i; }
    } else if(mode === "line"){ if(c === "\n") mode = "code"; }
    else if(mode === "block"){ if(c === "*" && n === "/"){ mode = "code"; i++; } }
    else if(mode === "sq"){ if(c === "\\") i++; else if(c === "'") mode = "code"; }
    else if(mode === "dq"){ if(c === "\\") i++; else if(c === '"') mode = "code"; }
    else if(mode === "tpl"){ if(c === "\\") i++; else if(c === "`") mode = "code"; else if(c === "$" && n === "{"){ mode = "code"; tmpl.push(depth); depth++; i++; } }
  }
  throw new Error("unbalanced braces from index " + openIdx);
}
function extractFunction(src, name){
  const sig = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if(!m) throw new Error(`could not find function ${name}() — if it was renamed, update scripts/check-cost-accrue.mjs`);
  const open = src.indexOf("{", m.index);
  return src.slice(m.index, matchBrace(src, open) + 1);
}
// Slice a single-line `const NAME = { … };` state declaration out as text (the meter's initial state).
function sliceConst(src, name){
  const m = new RegExp("const\\s+" + name + "\\s*=\\s*[^;]*;").exec(src);
  if(!m) throw new Error(`could not find \`const ${name} = …;\` — if it moved, update scripts/check-cost-accrue.mjs`);
  return m[0];
}

const failures = [];
const fail = (where, msg) => failures.push(`[${where}] ${msg}`);
const near = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-9;
// A fake fetch Response exposing only headers.get(exactKey) — the aggregators read exact header names.
const fakeR = (h) => ({ headers: { get: (k) => (h && Object.prototype.hasOwnProperty.call(h, k)) ? h[k] : null } });

/* ====================================================================
   ENGINE 1 — index.html editor: accrue(j, estUsd, r) + cacheBalance/restoreCachedBalance
   ==================================================================== */
function loadIndex(){
  const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const prelude = `
    var __store = new Map();
    var localStorage = { getItem(k){ return __store.has(k) ? __store.get(k) : null; }, setItem(k,v){ __store.set(k, String(v)); }, removeItem(k){ __store.delete(k); } };
    var __hasKey = true;
    function getKey(){ return __hasKey ? "sk-test" : ""; }
    function paintCost(){}
    function layoutBar(){}
    function refreshBalance(){}
    function $(){ return { innerHTML:"" }; }
  `;
  const block = prelude + "\n"
    + sliceConst(src, "stats") + "\n"
    + sliceConst(src, "BAL_CACHE_KEY") + "\n"
    + extractFunction(src, "cacheBalance") + "\n"
    + extractFunction(src, "restoreCachedBalance") + "\n"
    + extractFunction(src, "accrue") + "\n"
    + "this.stats=stats; this.accrue=accrue; this.cacheBalance=cacheBalance; this.restoreCachedBalance=restoreCachedBalance; this.setHasKey=(v)=>{__hasKey=v;}; this.store=__store;";
  const s = {}; vm.createContext(s); vm.runInContext(block, s);
  return s;
}

function checkIndex(){
  let S;
  try { S = loadIndex(); }
  catch(e){ fail("index", e.message); return; }
  const reset = () => Object.assign(S.stats, { count:0, cost:0, exact:true, balance:null });

  // 1. PRECEDENCE — real cost (j.cost>0) beats x_nanogpt_pricing, which beats the local estimate.
  reset();
  S.accrue({ cost:0.5, x_nanogpt_pricing:{ costUsd:0.9 } }, 1.0);
  if(!near(S.stats.cost, 0.5)) fail("index", `precedence: real j.cost should win → expected 0.5, got ${S.stats.cost}`);
  if(!S.stats.exact) fail("index", `precedence: a real metered cost must keep the meter EXACT`);
  reset();
  S.accrue({ x_nanogpt_pricing:{ costUsd:0.3 } }, 1.0);   // no top-level cost → pricing wins over the estimate
  if(!near(S.stats.cost, 0.3)) fail("index", `precedence: x_nanogpt_pricing.costUsd should beat the estimate → expected 0.3, got ${S.stats.cost}`);
  if(!S.stats.exact) fail("index", `precedence: a metered pricing figure must keep the meter EXACT (got approximate)`);
  reset();
  S.accrue({ x_nanogpt_pricing:{ cost:0.2 } }, 1.0);      // pricing.cost is the fallback field name
  if(!near(S.stats.cost, 0.2)) fail("index", `precedence: x_nanogpt_pricing.cost should be read → expected 0.2, got ${S.stats.cost}`);

  // 2. ZERO ≠ MISSING — a present-but-zero price is known-free (accrue $0, stay exact); a genuinely
  //    missing price falls back to the estimate and flips the session approximate.
  reset();
  S.accrue({ cost:0 });                                   // subscription/router run: real $0
  if(!near(S.stats.cost, 0)) fail("index", `zero: a present-but-zero j.cost must accrue $0, got ${S.stats.cost}`);
  if(!S.stats.exact) fail("index", `zero: a present-but-zero j.cost is KNOWN-FREE and must keep the meter EXACT (it flipped to ~)`);
  reset();
  S.accrue({ x_nanogpt_pricing:{ costUsd:0 } });          // subscription run priced via pricing block
  if(!near(S.stats.cost, 0)) fail("index", `zero: x_nanogpt_pricing.costUsd:0 must accrue $0, got ${S.stats.cost}`);
  if(!S.stats.exact) fail("index", `zero: x_nanogpt_pricing.costUsd:0 is KNOWN-FREE and must keep the meter EXACT`);
  reset();
  S.accrue({}, 0.7);                                      // genuinely missing price → estimate fires
  if(!near(S.stats.cost, 0.7)) fail("index", `missing: an absent price must fall back to the estimate (0.7), got ${S.stats.cost}`);
  if(S.stats.exact) fail("index", `missing: using the estimate must flip the session APPROXIMATE (~)`);
  reset();
  S.accrue({});                                           // missing price, no estimate available
  if(!near(S.stats.cost, 0)) fail("index", `missing/no-est: nothing should be added, got ${S.stats.cost}`);
  if(S.stats.exact) fail("index", `missing/no-est: an unpriced run must flip the session APPROXIMATE (total is a lower bound)`);

  // 3. BALANCE — the x-remaining-balance HEADER is canonical and overrides any body balance;
  //    the balance then round-trips through the localStorage cache.
  reset();
  S.accrue({ remainingBalance:99 }, undefined, fakeR({ "x-remaining-balance":"5.00" }));
  if(!near(S.stats.balance, 5)) fail("index", `balance: the x-remaining-balance header must override the body balance → expected 5, got ${S.stats.balance}`);
  reset();
  S.accrue({ remainingBalance:42 });                      // no header → body balance is the fallback
  if(!near(S.stats.balance, 42)) fail("index", `balance: body remainingBalance must be used when no header → expected 42, got ${S.stats.balance}`);
  reset();
  S.accrue({ x_nanogpt_pricing:{ remainingBalance:7 } }); // last-resort: balance inside the pricing block
  if(!near(S.stats.balance, 7)) fail("index", `balance: x_nanogpt_pricing.remainingBalance must be used as the last fallback → expected 7, got ${S.stats.balance}`);
  // cache round-trip: seed a balance, cache it, wipe live state, restore from cache.
  reset();
  S.stats.balance = 12.34; S.cacheBalance();
  S.stats.balance = null; S.setHasKey(true); S.restoreCachedBalance();
  if(!near(S.stats.balance, 12.34)) fail("index", `balance cache: restoreCachedBalance() should round-trip 12.34, got ${S.stats.balance}`);

  // 4. ACCUMULATION — runs sum; the approximate flag is STICKY once tripped.
  reset();
  S.accrue({ cost:0.10 });          // exact real cost
  S.accrue({}, 0.20);               // estimate → flips approximate
  S.accrue({ cost:0.05 });          // later real cost must NOT restore exactness
  if(!near(S.stats.cost, 0.35)) fail("index", `accumulation: 0.10+0.20+0.05 should total 0.35, got ${S.stats.cost}`);
  if(S.stats.exact) fail("index", `accumulation: the approximate (~) flag must be STICKY — a later exact run must not clear it`);
  if(S.stats.count !== 3) fail("index", `accumulation: count should be 3, got ${S.stats.count}`);
}

/* ====================================================================
   ENGINE 2 — play.html runtime (exported app): costFromJson / costFromHeaders /
   costWithHeaders / bumpCost. Same zero-vs-missing + precedence + balance semantics.
   ==================================================================== */
function loadPlay(){
  const src = fs.readFileSync(path.join(ROOT, "play.html"), "utf8");
  const prelude = `
    function paintCost(){}
    var __refreshed = 0; function refreshPlayBalance(){ __refreshed++; }
  `;
  const block = prelude
    + sliceConst(src, "COST") + "\n"
    + extractFunction(src, "costFromJson") + "\n"
    + extractFunction(src, "costFromHeaders") + "\n"
    + extractFunction(src, "costWithHeaders") + "\n"
    + extractFunction(src, "bumpCost") + "\n"
    + "this.COST=COST; this.costFromJson=costFromJson; this.costFromHeaders=costFromHeaders; this.costWithHeaders=costWithHeaders; this.bumpCost=bumpCost; this.refreshed=()=>__refreshed;";
  const s = {}; vm.createContext(s); vm.runInContext(block, s);
  return s;
}

function checkPlay(){
  let S;
  try { S = loadPlay(); }
  catch(e){ fail("play", e.message); return; }
  const reset = () => Object.assign(S.COST, { total:0, count:0, balance:null, exact:true, estUsd:null });

  // 5a. PRECEDENCE (play twin) — same order as the editor; play also reads metadata.cost (the editor
  //     folds that in at the transcription call site instead — see FINDINGS).
  reset();
  S.bumpCost(S.costFromJson({ cost:0.5, x_nanogpt_pricing:{ costUsd:0.9 } }));
  if(!near(S.COST.total, 0.5)) fail("play", `precedence: real j.cost should win → expected 0.5, got ${S.COST.total}`);
  if(!S.COST.exact) fail("play", `precedence: a real metered cost must keep the meter EXACT`);
  reset();
  S.bumpCost(S.costFromJson({ x_nanogpt_pricing:{ costUsd:0.3 } }));
  if(!near(S.COST.total, 0.3)) fail("play", `precedence: x_nanogpt_pricing.costUsd should be read → expected 0.3, got ${S.COST.total}`);
  reset();
  S.bumpCost(S.costFromJson({ metadata:{ cost:0.15 } }));   // transcription endpoint prices here
  if(!near(S.COST.total, 0.15)) fail("play", `precedence: metadata.cost should be read → expected 0.15, got ${S.COST.total}`);

  // 5b. ZERO ≠ MISSING (play twin).
  reset();
  S.bumpCost(S.costFromJson({ cost:0 }));                   // known-free
  if(!near(S.COST.total, 0)) fail("play", `zero: a present-but-zero j.cost must accrue $0, got ${S.COST.total}`);
  if(!S.COST.exact) fail("play", `zero: a present-but-zero j.cost is KNOWN-FREE and must keep the meter EXACT (it flipped to ~)`);
  reset();
  S.bumpCost(S.costFromJson({}));                           // genuinely missing → unknown, floor
  if(!near(S.COST.total, 0)) fail("play", `missing: nothing should be added, got ${S.COST.total}`);
  if(S.COST.exact) fail("play", `missing: an unpriced run must flip the session APPROXIMATE (total is a lower bound)`);
  reset();
  S.bumpCost({ usd:0.42, estimate:true });                  // catalog estimate (image/TTS path) → counts but flags ~
  if(!near(S.COST.total, 0.42)) fail("play", `estimate: an estimate must count toward the total (0.42), got ${S.COST.total}`);
  if(S.COST.exact) fail("play", `estimate: an estimate must flip the session APPROXIMATE (~)`);

  // 5c. BALANCE (play twin) — the x-remaining-balance HEADER overrides the body balance; a lone
  //     x-cost header fills in the cost only when the body carried none; x-cost:0 = known-free.
  reset();
  let c = S.costWithHeaders({ remainingBalance:99 }, fakeR({ "x-remaining-balance":"5.00" }));
  S.bumpCost(c);
  if(!near(S.COST.balance, 5)) fail("play", `balance: the x-remaining-balance header must override the body balance → expected 5, got ${S.COST.balance}`);
  reset();
  c = S.costWithHeaders({}, fakeR({ "x-cost":"0.40", "x-remaining-balance":"3.00" }));
  S.bumpCost(c);
  if(!near(S.COST.total, 0.40)) fail("play", `balance/x-cost: a lone x-cost header must fill the missing body cost → expected 0.40, got ${S.COST.total}`);
  if(!near(S.COST.balance, 3)) fail("play", `balance/x-cost: x-remaining-balance header must set the balance → expected 3, got ${S.COST.balance}`);
  reset();
  c = S.costWithHeaders({}, fakeR({ "x-cost":"0" }));       // known-free binary run (subscription)
  S.bumpCost(c);
  if(!near(S.COST.total, 0)) fail("play", `x-cost:0 must accrue $0, got ${S.COST.total}`);
  if(!S.COST.exact) fail("play", `x-cost:0 is KNOWN-FREE and must keep the meter EXACT`);
  reset();
  // x-cost only FILLS a missing body price — it must never OVERWRITE a real body cost. A chat run
  // reports its metered price in x_nanogpt_pricing AND carries an x-cost header; the body figure is
  // authoritative, so header 0.99 must not clobber the real 0.30 (else the session total drifts).
  c = S.costWithHeaders({ x_nanogpt_pricing:{ costUsd:0.30 } }, fakeR({ "x-cost":"0.99", "x-remaining-balance":"3.00" }));
  S.bumpCost(c);
  if(!near(S.COST.total, 0.30)) fail("play", `balance/x-cost: a present body cost must WIN over the x-cost header (fill-only) → expected 0.30, got ${S.COST.total}`);
  if(!near(S.COST.balance, 3)) fail("play", `balance/x-cost: x-remaining-balance header must still set the balance → expected 3, got ${S.COST.balance}`);

  // 5d. ACCUMULATION + sticky approximate (play twin).
  reset();
  S.bumpCost(S.costFromJson({ cost:0.10 }));
  S.bumpCost({ usd:0.20, estimate:true });   // estimate flips ~
  S.bumpCost(S.costFromJson({ cost:0.05 })); // later exact run must not restore exactness
  if(!near(S.COST.total, 0.35)) fail("play", `accumulation: 0.10+0.20+0.05 should total 0.35, got ${S.COST.total}`);
  if(S.COST.exact) fail("play", `accumulation: the approximate (~) flag must be STICKY`);
  if(S.COST.count !== 3) fail("play", `accumulation: count should be 3, got ${S.COST.count}`);

  // 5e. AUDIO-GAP TWIN of index accrue(): paid step with cost but no remaining-balance
  //     (TTS binary / generate-bgm JSON) requests one check-balance. Do not locally
  //     subtract (that would be ~approx); known-free $0 does not refresh.
  reset();
  const before = S.refreshed();
  S.bumpCost({ usd:0.15 });                      // real cost, no header/body balance
  if(S.refreshed() <= before) fail("play", "balance-gap: a charged step with no remaining-balance should request one check-balance");
  if(S.COST.balance != null) fail("play", "balance-gap: missing remaining-balance must not invent a locally subtracted chip figure");
  const afterPaid = S.refreshed();
  S.bumpCost({ usd:0.22, estimate:true });       // catalog TTS estimate, still no header
  if(S.refreshed() <= afterPaid) fail("play", "balance-gap: an estimated paid TTS step with no remaining-balance should still check-balance (exact remaining credit)");
  const afterEst = S.refreshed();
  S.bumpCost(S.costFromJson({ cost:0 }));        // known-free
  if(S.refreshed() !== afterEst) fail("play", "balance-gap: known-free $0 must not check-balance");
  S.bumpCost(S.costWithHeaders({ remainingBalance:9.5, cost:0.10 }, fakeR({ "x-remaining-balance":"9.40" })));
  if(S.refreshed() !== afterEst) fail("play", "balance-gap: a step that already carries remaining-balance must not check-balance");
  if(!near(S.COST.balance, 9.40)) fail("play", `balance-gap: header remaining-balance should still win → expected 9.40, got ${S.COST.balance}`);
}

/* ====================================================================
   ENGINE 1b — live chip UX: delta flash, session spend, reduced-motion,
   header-driven paint after accrue. Lifts the shipped helpers + paintCost.
   ==================================================================== */
function makeCostEl(){
  const el = {
    _html: "",
    attributes: {},
    tabIndex: -1,
    get innerHTML(){ return this._html; },
    set innerHTML(v){
      this._html = String(v);
      const bal = /class="costbal">([^<]*)/.exec(this._html);
      const spend = /class="costspend">([^<]*)/.exec(this._html);
      this._balEl = bal ? { textContent: bal[1] } : null;
      this._spendEl = spend ? { textContent: spend[1] } : null;
      this._deltaEl = /class="costdelta"/.test(this._html)
        ? { textContent:"", classList:{ _s:new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, has(c){ return this._s.has(c); } } }
        : null;
    },
    querySelector(sel){
      if(sel === ".costbal") return this._balEl;
      if(sel === ".costspend") return this._spendEl;
      if(sel === ".costdelta") return this._deltaEl;
      return null;
    },
    setAttribute(k, v){ this.attributes[k] = v; if(k === "tabindex" || k === "tabIndex") this.tabIndex = v; },
    removeAttribute(k){ delete this.attributes[k]; },
    get offsetWidth(){ return 1; },
  };
  return el;
}
function loadIndexUi(reduceMotion){
  const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const prelude = `
    var __store = new Map();
    var localStorage = { getItem(k){ return __store.has(k) ? __store.get(k) : null; }, setItem(k,v){ __store.set(k, String(v)); }, removeItem(k){ __store.delete(k); } };
    var __hasKey = true;
    function getKey(){ return __hasKey ? "sk-test" : ""; }
    var __laid = 0; function layoutBar(){ __laid++; }
    function t(s){ return s; }
    var __refreshed = 0; function refreshBalance(){ __refreshed++; }
    var __costEl = (${makeCostEl.toString()})();
    function $(id){ return id==="cost" ? __costEl : { innerHTML:"" }; }
    var matchMedia = function(q){ return { matches: ${reduceMotion ? "true" : "false"} && /prefers-reduced-motion/.test(String(q)) }; };
    var window = { matchMedia: matchMedia };
    var _rafQ = [];
    var requestAnimationFrame = function(fn){ _rafQ.push(fn); return _rafQ.length; };
    var cancelAnimationFrame = function(){ _rafQ = []; };
    var setTimeout = function(){ return 1; };
    var clearTimeout = function(){};
    var performance = { now: function(){ return 0; } };
    var _costPainted = "";
    var _costShownBal = null;
    var _costTween = 0;
    var _costDeltaT = 0;
    var _costStep = null;
  `;
  const block = prelude + "\n"
    + sliceConst(src, "stats") + "\n"
    + sliceConst(src, "BAL_CACHE_KEY") + "\n"
    + extractFunction(src, "cacheBalance") + "\n"
    + extractFunction(src, "restoreCachedBalance") + "\n"
    + extractFunction(src, "costChipDeltaUsd") + "\n"
    + extractFunction(src, "costChipSpendLabel") + "\n"
    + extractFunction(src, "costChipReduceMotion") + "\n"
    + extractFunction(src, "costChipFmtDelta") + "\n"
    + extractFunction(src, "noteCostStep") + "\n"
    + extractFunction(src, "tweenCostBal") + "\n"
    + extractFunction(src, "paintCost") + "\n"
    + extractFunction(src, "accrue") + "\n"
    + extractFunction(src, "applyPollSettlement") + "\n"
    + "this.stats=stats; this.accrue=accrue; this.paintCost=paintCost; this.applyPollSettlement=applyPollSettlement;"
    + "this.costChipDeltaUsd=costChipDeltaUsd; this.costChipSpendLabel=costChipSpendLabel; this.costChipFmtDelta=costChipFmtDelta;"
    + "this.el=__costEl; this.raf=()=>_rafQ; this.refreshed=()=>__refreshed;";
  const s = {}; vm.createContext(s); vm.runInContext(block, s);
  return s;
}

function checkChip(){
  let S;
  try { S = loadIndexUi(false); }
  catch(e){ fail("chip", e.message); return; }
  const reset = () => { Object.assign(S.stats, { count:0, cost:0, exact:true, balance:null }); S.el.innerHTML = ""; };

  // helpers: known-free never flashes; a balance drop is the delta; missing header uses step usd.
  if(S.costChipDeltaUsd(10, 10, 0) !== 0) fail("chip", "delta: known-free $0 must not flash");
  if(!near(S.costChipDeltaUsd(10, 9.78, 0.22), 0.22)) fail("chip", "delta: balance drop should be the flashed amount");
  if(!near(S.costChipDeltaUsd(null, 9.78, 0.22), 0.22)) fail("chip", "delta: missing prior balance should fall back to the step usd");
  if(S.costChipDeltaUsd(10, 10.5, 0.22) !== 0.22) fail("chip", "delta: a rise (top-up) with a positive step still reports the step — paintCost only flashes when the helper returns >0 AND we call it after a charge; top-up paintCost has no step");
  if(S.costChipSpendLabel(0.45, true) !== "$0.45") fail("chip", `spend label exact: expected $0.45, got ${S.costChipSpendLabel(0.45, true)}`);
  if(S.costChipSpendLabel(0.45, false) !== "~$0.45") fail("chip", `spend label inexact: expected ~$0.45, got ${S.costChipSpendLabel(0.45, false)}`);
  if(S.costChipFmtDelta(0.22) !== "−$0.22") fail("chip", `fmt delta: expected −$0.22, got ${S.costChipFmtDelta(0.22)}`);
  if(S.costChipFmtDelta(0) !== "") fail("chip", "fmt delta: $0 must be empty (no scary flash)");

  // accrue + header → chip shows new balance AND session spend; + top-up stays; delta flashes.
  reset();
  S.stats.balance = 10;
  S.paintCost();
  S.accrue({ cost:0.22 }, undefined, fakeR({ "x-remaining-balance":"9.78" }));
  if(!near(S.stats.balance, 9.78)) fail("chip", `header balance after accrue: expected 9.78, got ${S.stats.balance}`);
  if(!/9\.78/.test(S.el.innerHTML)) fail("chip", `paint: balance 9.78 missing from chip HTML: ${S.el.innerHTML}`);
  if(!/\$0\.22/.test(S.el.innerHTML)) fail("chip", `paint: session spend $0.22 missing from chip HTML: ${S.el.innerHTML}`);
  if(!/costadd/.test(S.el.innerHTML)) fail("chip", "paint: + top-up affordance missing from chip HTML");
  if(!S.el._deltaEl || !S.el._deltaEl.classList.has("on") || S.el._deltaEl.textContent !== "−$0.22")
    fail("chip", `paint: charged step should flash −$0.22 (got ${S.el._deltaEl && S.el._deltaEl.textContent})`);
  if(!(S.raf().length > 0)) fail("chip", "paint: a charged step should queue a balance tween when motion is allowed");

  // known-free: no delta flash.
  reset();
  S.stats.balance = 10;
  S.paintCost();
  S.accrue({ cost:0 }, undefined, fakeR({ "x-remaining-balance":"10.00" }));
  if(S.el._deltaEl && S.el._deltaEl.classList.has("on"))
    fail("chip", "paint: known-free $0 must not flash a spend delta");

  // cost but no balance header → one corrective check-balance (not every node thereafter: _balPending is the live guard).
  reset();
  S.accrue({ cost:0.15 });
  if(S.refreshed() < 1) fail("chip", "paint: a charged step with no remaining-balance should request one check-balance");

  // poll settlement updates balance without accruing spend; refund without a figure refreshes.
  reset();
  S.stats.balance = 8;
  S.stats.cost = 0.40;
  S.applyPollSettlement({ remainingBalance:8.40 }, fakeR({}), true);
  if(!near(S.stats.balance, 8.40)) fail("chip", `poll settlement: body remainingBalance should apply → expected 8.40, got ${S.stats.balance}`);
  if(!near(S.stats.cost, 0.40)) fail("chip", `poll settlement: must not re-accrue spend, cost stayed ${S.stats.cost}`);
  const before = S.refreshed();
  S.applyPollSettlement({ status:"error" }, fakeR({}), true);
  if(S.refreshed() <= before) fail("chip", "poll settlement: refund without a new remaining-balance should check-balance once");

  // reduced-motion: instant number + delta text, no tween frames.
  let R;
  try { R = loadIndexUi(true); }
  catch(e){ fail("chip", "reduced-motion load: " + e.message); return; }
  Object.assign(R.stats, { count:0, cost:0, exact:true, balance:10 });
  R.paintCost();
  R.accrue({ cost:0.10 }, undefined, fakeR({ "x-remaining-balance":"9.90" }));
  if(!/9\.90/.test(R.el.innerHTML)) fail("chip", "reduced-motion: balance should update instantly");
  if(!R.el._deltaEl || R.el._deltaEl.textContent !== "−$0.10")
    fail("chip", "reduced-motion: delta text must still appear");
  if(R.raf().length > 0) fail("chip", "reduced-motion: must not queue a balance tween");

  // twins: the chip helpers must stay character-identical (after trim) in play.html.
  const idx = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const ply = fs.readFileSync(path.join(ROOT, "play.html"), "utf8");
  const norm = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  for(const name of ["costChipDeltaUsd", "costChipSpendLabel", "costChipReduceMotion", "costChipFmtDelta"]){
    try{
      const a = norm(extractFunction(idx, name));
      const b = norm(extractFunction(ply, name));
      if(a !== b) fail("chip", `twin: ${name}() drifted between index.html and play.html`);
    }catch(e){ fail("chip", `twin: ${e.message}`); }
  }
}

checkIndex();
checkPlay();
checkChip();

if(failures.length){
  process.stderr.write("✗ session cost-meter aggregation is broken (a spend total or the exact/~ flag would mislead users):\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ cost-meter aggregation holds in both engines: real cost > pricing > estimate; zero=known-free stays exact; missing flips ~ (sticky); x-remaining-balance header is canonical; live chip delta/session/reduced-motion stay wired.\n");
