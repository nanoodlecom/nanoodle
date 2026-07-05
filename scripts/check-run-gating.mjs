#!/usr/bin/env node
// Keyless / signed-out spend gating in play.html (offline, no network, no API spend).
//
// This is the first-dollar-safety layer shipped as PRs #216-#219: a fresh recipient of a
// shared/exported app must NOT be one click from an 8x or infinite-loop spend, and a signed-out
// press of the big ▶ Run button must never fire a paid API call. That layer had zero test coverage.
//
// No browser, no network, no inference. Same offline technique as the sibling scripts/check-*.mjs:
// lift the REAL shipped functions out of play.html as text (brace-matched, comment/template aware)
// and drive them in a node:vm sandbox against minimal DOM/auth stubs — never re-implement the logic.
//
// Invariants pinned:
//   1. KEYLESS GATE   — with no key, applyRunGating() forces RUNS_N=1 & KEEP=false and hides the
//      Runs multiplier + Keep-generating controls, so a stale 8x/checked state can't ride into the
//      first authed run; with a key, both controls are revealed.
//   2. COST-CHIP MATH — paintRunCost() shows usd * RUNS_N (a $1 step at 8x reads "$8.00" + an "8x"
//      marker); exact→no "~", estimate→leading "~"; nothing priced → chip hidden, never "$0".
//   3. SIGNED-OUT RUN — run() with no auth routes into the preflight path and fires ZERO fetch; the
//      http/embedded branch shows the preflight, the file:// branch reveals the paste-key row.
//   4. RESUME STASH   — stashRunInputs() writes the typed input values to the single-use resume key
//      (so the full-page OAuth redirect doesn't eat what the user typed).
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = join(ROOT, "play.html");
const html = readFileSync(PLAY, "utf8");

// ---- JS-aware brace matcher (string/template/comment aware) — same as check-share-link.mjs -----
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

// pull `[async] function <name>(...) { ... }` out as text (keeps a leading `async` so run() stays async)
function extractFn(src, name) {
  const sig = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}() in play.html`);
  const open = src.indexOf("{", m.index);
  const close = matchBrace(src, open);
  return src.slice(m.index, close + 1);
}

// pull a one-line `const <name> = …;` out as text (RUN_CHOICES / RUN_RESUME_KEY / hasAuth)
function extractConst(src, re, label) {
  const m = re.exec(src);
  if (!m) throw new Error(`could not find ${label} in play.html`);
  return m[0];
}

let lift;
try {
  lift = {
    fmtUsd: extractFn(html, "fmtUsd"),
    paintRunCost: extractFn(html, "paintRunCost"),
    renderCount: extractFn(html, "renderCount"),
    renderLoop: extractFn(html, "renderLoop"),
    applyRunGating: extractFn(html, "applyRunGating"),
    stashRunInputs: extractFn(html, "stashRunInputs"),
    run: extractFn(html, "run"),
    RUN_CHOICES: extractConst(html, /const\s+RUN_CHOICES\s*=\s*\[[^\]]*\]\s*;/, "const RUN_CHOICES"),
    RUN_RESUME_KEY: extractConst(html, /const\s+RUN_RESUME_KEY\s*=\s*"[^"]*"\s*;/, "const RUN_RESUME_KEY"),
    hasAuth: extractConst(html, /const\s+hasAuth\s*=\s*\(\)\s*=>[^;]*;/, "const hasAuth"),
  };
} catch (e) {
  console.error("✗ check-run-gating: " + e.message);
  process.exit(1);
}

// ---- minimal DOM + auth + storage stubs; the lifted code closes over these free names -----------
const preamble = `
  // module-level state the lifted functions read/write (mirrors play.html's let-scoped vars)
  let RUNS_N = 1, KEEP = false, _runCost = null, running = false;
  let parentAuthed = false, EMBEDDED = false, __getKeyRet = null;
  let STATE = null, location = { protocol: "https:", origin: "https://x", pathname: "/" };

  function getKey(){ return __getKeyRet; }                 // stand-in for play.html's localStorage getter
  function t(s){ return s; }                               // identity — we assert markers/money, not translations

  // spies: counters so "zero fetch / routed to preflight" is a measurable assertion, not an absence of a throw
  let __spies = { fetch: 0, preflight: 0, statusLine: 0, flashAuth: 0, renderAuth: 0 };
  function fetch(){ __spies.fetch++; return Promise.resolve({ ok: true, json: () => ({}), text: () => "" }); }
  function showRunPreflight(){ __spies.preflight++; }      // real one is DOM-only + never fetches; spy pins the routing
  function statusLine(){ __spies.statusLine++; }
  function flashAuth(){ __spies.flashAuth++; }
  function renderAuth(){ __spies.renderAuth++; }

  // fake element registry so we can inspect app-loop / app-count / app-runcost after a call
  function mkEl(){
    return {
      hidden: false, innerHTML: "", title: "", value: "", className: "",
      querySelector(){ return { addEventListener(){}, focus(){} }; },
      querySelectorAll(){ return []; },
      addEventListener(){}, appendChild(){}, insertBefore(){},
      classList: { add(){}, remove(){}, toggle(){} },
      closest(){ return null; }, focus(){}, setAttribute(){},
    };
  }
  const __els = {};
  function $(id){ if(!__els[id]) __els[id] = mkEl(); return __els[id]; }
  const document = { createElement: mkEl, querySelector: () => null, head: mkEl(), documentElement: mkEl() };
  function ensureRunCostEl(){ return $("app-runcost"); }   // DOM helper stub; paintRunCost's MATH is the code under test

  // single-use resume stash
  const __session = {};
  const sessionStorage = {
    setItem(k, v){ __session[k] = String(v); },
    getItem(k){ return k in __session ? __session[k] : null; },
    removeItem(k){ delete __session[k]; },
  };
`;

const epilogue = `
  globalThis.__T = {
    setKey(v){ __getKeyRet = v; }, setEmbedded(v){ EMBEDDED = v; }, setParentAuthed(v){ parentAuthed = v; },
    setRunsN(v){ RUNS_N = v; }, getRunsN(){ return RUNS_N; },
    setKeep(v){ KEEP = v; }, getKeep(){ return KEEP; },
    setRunCost(v){ _runCost = v; }, setLocation(v){ location = v; }, setSTATE(v){ STATE = v; },
    RESUME_KEY: RUN_RESUME_KEY, RUN_CHOICES: RUN_CHOICES,
    applyRunGating, paintRunCost, run, stashRunInputs,
    el(id){ return __els[id]; }, spies(){ return __spies; },
    resetSpies(){ __spies = { fetch: 0, preflight: 0, statusLine: 0, flashAuth: 0, renderAuth: 0 }; },
    session(){ return __session; },
  };
`;

const program =
  preamble + "\n" +
  lift.RUN_CHOICES + "\n" + lift.RUN_RESUME_KEY + "\n" + lift.hasAuth + "\n" +
  lift.fmtUsd + "\n" + lift.paintRunCost + "\n" + lift.renderCount + "\n" +
  lift.renderLoop + "\n" + lift.applyRunGating + "\n" + lift.stashRunInputs + "\n" +
  lift.run + "\n" + epilogue;

const ctx = { globalThis: null };
ctx.globalThis = ctx;
vm.createContext(ctx);
try {
  new vm.Script(program, { filename: "play.html#run-gating" }).runInContext(ctx);
} catch (e) {
  console.error("✗ check-run-gating: lifted play.html source failed to load in the sandbox: " + e.message);
  process.exit(1);
}
const T = ctx.__T;

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log("  ✗ " + msg); } };

// ---- 1. KEYLESS GATE: no key forces 1x / KEEP off and hides both spend controls ----------------
{
  T.setEmbedded(false); T.setKey(null);
  T.setRunsN(8); T.setKeep(true);              // stale 8x + keep-generating from a prior authed session
  T.applyRunGating();
  ok(T.getRunsN() === 1, `keyless gate: a stale RUNS_N must be forced to 1, got ${T.getRunsN()}`);
  ok(T.getKeep() === false, "keyless gate: a stale KEEP=true must be forced off");
  ok(T.el("app-count").hidden === true, "keyless gate: the Runs multiplier must be hidden with no key");
  ok(T.el("app-loop").hidden === true, "keyless gate: the Keep-generating control must be hidden with no key");
}
// with a key, the controls are revealed (and a real pick is NOT stomped back to 1)
{
  T.setEmbedded(false); T.setKey("sk-real-key");
  T.setRunsN(4); T.setKeep(true);
  T.applyRunGating();
  ok(T.el("app-count").hidden === false, "authed: the Runs multiplier must be revealed with a key");
  ok(T.el("app-loop").hidden === false, "authed: the Keep-generating control must be revealed with a key");
  ok(T.getRunsN() === 4, `authed: a real RUNS_N pick must survive gating, got ${T.getRunsN()}`);
  ok(T.getKeep() === true, "authed: a real KEEP=true must survive gating");
}
// embedded: gating tracks the parent's signed-in flag, not a local key
{
  T.setEmbedded(true); T.setKey(null); T.setParentAuthed(false);
  T.setRunsN(8); T.setKeep(true);
  T.applyRunGating();
  ok(T.getRunsN() === 1 && T.getKeep() === false, "embedded signed-out: controls reset to 1x / off");
  ok(T.el("app-count").hidden === true, "embedded signed-out: multiplier hidden");
  T.setParentAuthed(true); T.applyRunGating();
  ok(T.el("app-count").hidden === false, "embedded signed-in: multiplier revealed via parentAuthed");
}

// ---- 2. COST-CHIP MATH: usd x RUNS_N, ~-prefix rules, and $0 is never shown ---------------------
{
  T.setRunCost({ usd: 1, priced: 1, unpriced: 0, exact: true }); T.setRunsN(8);
  T.paintRunCost();
  const chip = T.el("app-runcost");
  ok(chip.hidden === false, "cost chip: a priced forecast must show the chip");
  ok(chip.innerHTML.includes("$8.00"), `cost chip: $1 step x 8 must read $8.00, got ${JSON.stringify(chip.innerHTML)}`);
  ok(chip.innerHTML.includes("8×"), "cost chip: an 8x press must carry the 8× multiplier marker");
  ok(!chip.innerHTML.includes("~"), "cost chip: an EXACT forecast must have no ~ prefix");
}
{
  T.setRunCost({ usd: 1, priced: 2, unpriced: 0, exact: false }); T.setRunsN(2);
  T.paintRunCost();
  const chip = T.el("app-runcost");
  ok(chip.innerHTML.includes("~$2.00"), `cost chip: an ESTIMATE at 2x must read ~$2.00, got ${JSON.stringify(chip.innerHTML)}`);
}
{
  T.setRunCost({ usd: 1, priced: 1, unpriced: 0, exact: true }); T.setRunsN(1);
  T.paintRunCost();
  const chip = T.el("app-runcost");
  ok(chip.innerHTML.includes("$1.00") && !chip.innerHTML.includes("×"), "cost chip: at 1x there is no multiplier marker");
}
{
  // nothing priced → chip hidden entirely, never a "$0"
  T.setRunCost({ usd: 0, priced: 0, unpriced: 3, exact: true }); T.setRunsN(8);
  T.el("app-runcost").hidden = false; T.el("app-runcost").innerHTML = "STALE";
  T.paintRunCost();
  const chip = T.el("app-runcost");
  ok(chip.hidden === true, "cost chip: with nothing priced the chip must be hidden");
  ok(!chip.innerHTML.includes("$0"), "cost chip: an unpriced forecast must never render a $0");
}

// ---- 3. SIGNED-OUT RUN = ZERO SPEND ------------------------------------------------------------
// http/embedded: no auth → preflight shown, ZERO fetch.
{
  T.setEmbedded(false); T.setKey(null); T.setParentAuthed(false);
  T.setLocation({ protocol: "https:", origin: "https://x", pathname: "/" });
  T.resetSpies();
  await T.run();
  const s = T.spies();
  ok(s.fetch === 0, `signed-out run (http): must fire ZERO fetch, fired ${s.fetch}`);
  ok(s.preflight === 1, `signed-out run (http): must route into the preflight exactly once, got ${s.preflight}`);
}
// file:// (no OAuth possible): reveals the paste-key row, still ZERO fetch, no preflight.
{
  T.setEmbedded(false); T.setKey(null); T.setParentAuthed(false);
  T.setLocation({ protocol: "file:", origin: "null", pathname: "/app.html" });
  T.resetSpies();
  await T.run();
  const s = T.spies();
  ok(s.fetch === 0, `signed-out run (file://): must fire ZERO fetch, fired ${s.fetch}`);
  ok(s.renderAuth === 1, "signed-out run (file://): must reveal the paste-key row (renderAuth)");
  ok(s.preflight === 0, "signed-out run (file://): the OAuth preflight must NOT show where OAuth is impossible");
}
// sanity: an AUTHED run does NOT route into the preflight (it would proceed past the gate)
{
  T.setEmbedded(false); T.setKey("sk-real-key");
  T.setLocation({ protocol: "https:", origin: "https://x", pathname: "/" });
  T.setSTATE(null);   // no graph → run()'s machinery no-ops harmlessly past the auth gate
  T.resetSpies();
  try { await T.run(); } catch (_) { /* downstream run machinery is stubbed away; the gate is what we pin */ }
  ok(T.spies().preflight === 0, "authed run: must NOT show the signed-out preflight");
}

// ---- 4. RESUME STASH: typed inputs are written to the single-use resume key ---------------------
{
  T.setSTATE({ inputs: [
    { nodeId: "n1", field: "prompt", node: { fields: { prompt: "a red bird" } } },
    { nodeId: "n2", field: "text", node: { fields: { text: "hello" } } },
  ] });
  T.stashRunInputs();
  const raw = T.session()[T.RESUME_KEY];
  ok(raw != null, `resume stash: stashRunInputs must write under ${JSON.stringify(T.RESUME_KEY)}`);
  let parsed = null; try { parsed = JSON.parse(raw); } catch (_) {}
  ok(Array.isArray(parsed) && parsed.length === 2, "resume stash: writes one entry per live input");
  ok(parsed && parsed[0] && parsed[0].nodeId === "n1" && parsed[0].field === "prompt" && parsed[0].value === "a red bird",
    `resume stash: entry shape must be {nodeId,field,value}, got ${JSON.stringify(parsed && parsed[0])}`);
  ok(parsed && parsed[1] && parsed[1].value === "hello", "resume stash: second input's typed value is preserved");
}

if (failed) { console.error(`\n✗ check-run-gating: ${failed} assertion(s) failed`); process.exit(1); }
console.log("✓ keyless/signed-out spend gating holds (keyless forces 1×/KEEP-off + hides multipliers; chip = usd×RUNS_N, never $0; signed-out Run = zero fetch → preflight; typed inputs stashed for OAuth resume).");
