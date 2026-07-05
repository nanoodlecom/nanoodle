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
  const prelude = `function paintCost(){}\n`;
  const block = prelude
    + sliceConst(src, "COST") + "\n"
    + extractFunction(src, "costFromJson") + "\n"
    + extractFunction(src, "costFromHeaders") + "\n"
    + extractFunction(src, "costWithHeaders") + "\n"
    + extractFunction(src, "bumpCost") + "\n"
    + "this.COST=COST; this.costFromJson=costFromJson; this.costFromHeaders=costFromHeaders; this.costWithHeaders=costWithHeaders; this.bumpCost=bumpCost;";
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
}

checkIndex();
checkPlay();

if(failures.length){
  process.stderr.write("✗ session cost-meter aggregation is broken (a spend total or the exact/~ flag would mislead users):\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ cost-meter aggregation holds in both engines: real cost > pricing > estimate; zero=known-free stays exact; missing flips ~ (sticky); x-remaining-balance header is canonical.\n");
