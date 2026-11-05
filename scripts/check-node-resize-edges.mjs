#!/usr/bin/env node
// Leftover node-card corner-grip edges after #718.
// That PR shipped a Playwright happy path (text / image / tvideo / Decide
// question grow under mouse + touch at scale=1). This file pins the other
// half those toys never hit: Choice options and Vision q are named
// primaries (the Decide miss was "field not in the list"); a wired
// display:none prompt is skipped so the next visible box (LLM system,
// Decide labels, catalog data-pf) actually moves the card; a 0-rect
// box is treated as hidden; empty/all-hidden returns null; named
// priority keeps prompt ahead of options; prepTextareas refuses to
// store 0 over a real height; the grip's screen-space hit target still
// counter-scales with --invz (smoke always reset scale=1). Offline,
// zero API spend. New file so it does not collide with smoke-first-run
// or open leftover PRs.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "index.html"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

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

function extractFunction(src, name) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error("could not find function " + name + "() in index.html");
  const open = src.indexOf("{", m.index);
  return src.slice(m.index, matchBrace(src, open) + 1);
}

function loadFn(name) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extractFunction(SRC, name) + `\n;globalThis.${name} = ${name};`, ctx);
  return ctx[name];
}

const pick = loadFn("nodeResizeTextarea");

function ta(name, { hidden = false, rects = 1, pf = false } = {}) {
  return {
    dataset: pf ? { pf: name } : { f: name },
    hidden,
    getClientRects: () => Array.from({ length: rects }, () => ({})),
  };
}
const card = (boxes) => ({ querySelectorAll: () => boxes });
const field = (el) => (el && (el.dataset.f || el.dataset.pf)) || null;

{
  const got = field(pick(card([ta("options")])));
  if (got !== "options") fail(`Choice options must be a named primary, got ${got}`);
  else ok("Choice options is a named primary (the Decide-class miss)");
}

{
  const got = field(pick(card([ta("q")])));
  if (got !== "q") fail(`Vision q must stay a named primary, got ${got}`);
  else ok("Vision q is still a named primary");
}

{
  const got = field(pick(card([ta("question"), ta("options")])));
  if (got !== "question") fail(`Decide choose must stretch question ahead of labels, got ${got}`);
  else ok("Decide choose: visible question wins over the labels box");
}

{
  const got = field(pick(card([ta("question", { hidden: true }), ta("options")])));
  if (got !== "options") fail(`hidden question must fall through to options, got ${got}`);
  else ok("hidden Decide question falls through to visible options");
}

{
  const got = field(pick(card([ta("prompt", { hidden: true }), ta("system")])));
  if (got !== "system") fail(`wired prompt must fall through to LLM system, got ${got}`);
  else ok("wired (hidden) prompt falls through to the next visible box (LLM system)");
}

{
  const got = field(pick(card([ta("question", { hidden: true }), ta("levels")])));
  if (got !== "levels") fail(`hidden question + score levels must pick levels, got ${got}`);
  else ok("hidden question falls through to Decide score levels (unnamed first-visible)");
}

{
  const got = field(pick(card([ta("prompt"), ta("options")])));
  if (got !== "prompt") fail(`visible prompt must outrank later options, got ${got}`);
  else ok("named priority: visible prompt wins over later options");
}

{
  const got = field(pick(card([ta("style", { pf: true })])));
  if (got !== "style") fail(`lone data-pf textarea must be first-visible, got ${got}`);
  else ok("catalog data-pf textarea is eligible when no named primary is visible");
}

{
  const got = field(pick(card([ta("prompt", { pf: true })])));
  if (got !== "prompt") fail(`data-pf=prompt must still match the named list, got ${got}`);
  else ok("data-pf=prompt still counts as the named prompt primary");
}

{
  const got = field(pick(card([ta("prompt", { rects: 0 }), ta("system")])));
  if (got !== "system") fail(`0-rect prompt must be skipped like hidden, got ${got}`);
  else ok("getClientRects() empty (display:none without hidden) skips the box");
}

{
  const none = pick(card([]));
  const hid = pick(card([ta("prompt", { hidden: true }), ta("system", { hidden: true })]));
  if (none !== null || hid !== null) fail(`empty/all-hidden must be null, got ${none} / ${hid}`);
  else ok("empty or all-hidden card returns null (width-only drag)");
}

{
  const fn = extractFunction(SRC, "nodeResizeTextarea");
  if (!fn.includes('.body textarea[data-f], .body textarea[data-pf]'))
    fail("nodeResizeTextarea must query .body data-f/data-pf only (header/comment boxes stay out)");
  else ok("picker query stays scoped to .body data-f / data-pf textareas");
}

{
  const start = extractFunction(SRC, "startNodeResize");
  const usesHelper = start.includes("nodeResizeTextarea(el)");
  const writesPf = /ta\.dataset\.f\s*\|\|\s*ta\.dataset\.pf/.test(start)
    && /ta\?\.dataset\.f\s*\|\|\s*ta\?\.dataset\.pf/.test(start);
  if (!usesHelper) fail("startNodeResize must stretch nodeResizeTextarea(el), not the old prompt/text/q selector");
  else if (!writesPf) fail("startNodeResize must key n.sizes by dataset.f || dataset.pf");
  else ok("startNodeResize uses the visible-box helper and stores data-f / data-pf");
}

{
  const prep = extractFunction(SRC, "prepTextareas");
  const observers = [];
  let saved = 0;
  const taEl = { dataset: { f: "prompt" }, hidden: false, offsetHeight: 120, style: { height: "" } };
  const n = { el: { querySelectorAll: () => [taEl] }, sizes: { prompt: 120 } };
  const ctx = {
    n,
    save() { saved++; },
    ResizeObserver: class {
      constructor(cb) { this.cb = cb; }
      observe() { observers.push(this); }
    },
  };
  vm.createContext(ctx);
  vm.runInContext(prep + "\n;prepTextareas(n);", ctx);
  if (observers.length !== 1) fail("prepTextareas must attach one ResizeObserver");
  else {
    taEl.hidden = true;
    taEl.offsetHeight = 0;
    observers[0].cb();
    if (n.sizes.prompt !== 120 || saved !== 0)
      fail(`hidden collapse must not store 0 over a real height, sizes=${n.sizes.prompt} saved=${saved}`);
    else {
      taEl.hidden = false;
      taEl.offsetHeight = 0;
      observers[0].cb();
      if (n.sizes.prompt !== 120 || saved !== 0)
        fail(`h<1 collapse must not store 0 over a real height, sizes=${n.sizes.prompt} saved=${saved}`);
      else ok("prepTextareas skips hidden / h<1 so a wired collapse does not wipe n.sizes");
    }
  }
}

{
  const grip = SRC.match(/\.node \.rgrip\{[\s\S]*?\}/);
  if (!grip) fail("could not find .node .rgrip rule");
  else if (!/width:calc\(16px \* var\(--invz,\s*1\)\)/.test(grip[0])
    || !/height:calc\(16px \* var\(--invz,\s*1\)\)/.test(grip[0]))
    fail("rgrip size must counter-scale with --invz (smoke only dragged at scale=1)");
  else ok("rgrip width/height counter-scale with --invz");
}

{
  const afters = [...SRC.matchAll(/\.node \.rgrip::after\{[\s\S]*?\}/g)].map((m) => m[0]);
  if (afters.length < 2) fail(`expected desktop + coarse rgrip::after, found ${afters.length}`);
  else if (afters.some((r) => !/var\(--invz/.test(r)))
    fail("both rgrip::after rules must keep --invz slop (old inset:-7px died when zoomed out)");
  else if (afters.some((r) => /inset:\s*-7px/.test(r)))
    fail("unscaled inset:-7px slop must not return");
  else ok("desktop + coarse rgrip::after slop stays --invz scaled");
}

{
  if (!/setProperty\?\.\("--invz",\s*1\/scale\)/.test(SRC))
    fail('applyWorld must keep writing --invz = 1/scale or the grip hit target shrinks with zoom');
  else ok("applyWorld still writes --invz from 1/scale");
}

if (failed) process.exit(1);
process.stdout.write("✓ node-card resize leftover edges pinned (Choice / wired prompt / zoom slop).\n");
