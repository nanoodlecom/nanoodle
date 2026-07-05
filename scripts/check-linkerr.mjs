#!/usr/bin/env node
// Verifies the MALFORMED / LEGACY share-link path in play.html — the "someone pasted me a
// broken #a= link" first-impression moment.
//
// A shared app arrives as a #a=<payload> fragment. Messenger apps truncate long URLs all the
// time, so a large chunk of real inbound links land here HALF-DELIVERED. When that happens the
// recipient must see the friendly "#linkerr" banner ("this link looks incomplete… ask for a
// fresh one"), NEVER a silent blank page, and — critically — the broken import must not touch
// the recipient's OWN saved apps or consume the hash (so a corrected reload can retry).
//
// This banner has broken twice in shipped code:
//   • it rendered as an empty brown bar (showLinkError's text-set was skipped), and
//   • it showed on EVERY load — an author `#linkerr{ display:flex }` rule (id specificity) beat
//     the UA `[hidden]{display:none}`, so the `hidden` attribute stopped hiding it
//     (commits d172480 / 6e7f1ed).
// So we pin both the RUNTIME routing (drive the real boot()/loadFromHash in a node:vm) AND the
// STATIC CSS contract (the show rule must be written `#linkerr:not([hidden])` so `hidden` wins).
//
// 100% offline. House pattern (mirrors check-create-app.mjs): lift the REAL inline <script> out
// of play.html as text, run it in a node:vm with DOM/window/localStorage stubs, drive the real
// boot() over crafted location.hash values, and read the observable effects (banner shown? app
// installed? hash consumed? library byte-intact?). We never re-implement the logic under test.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* -------------------------------------------------------------------------- */
/* extract + prepare the real inline script (same approach as check-create-app) */
/* -------------------------------------------------------------------------- */

function extractMainScript(html, needle) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!/\bsrc=/i.test(m[1]) && needle.test(m[2])) return m[2];
  }
  throw new Error("main inline <script> not found");
}

function prepare(code) {
  code = code.replace(
    /import\s*\{[^}]*\}\s*from\s*["'][^"']*gptdiff-js[^"']*["'];?/,
    "const buildEnvironment=()=>({}),generateDiff=async()=>'',smartapply=async()=>({}),parseDiffPerFile=()=>({}),callLlmForApply=async()=>'',setEnv=()=>{};",
  );
  if (!/\nboot\(\);/.test(code)) throw new Error("play.html: boot() call not found");
  return code.replace(/\nboot\(\);/, "\nglobalThis.__BOOT__ = boot();");
}

/* -------------------------------------------------------------------------- */
/* DOM / window stubs (trimmed from check-create-app.mjs)                       */
/* -------------------------------------------------------------------------- */

function inert() {
  const fn = () => p;
  const p = new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === Symbol.iterator) return function* () {};
      if (prop === "then") return undefined;
      if (prop === "length") return 0;
      return p;
    },
    set: () => true, has: () => true, construct: () => p, apply: () => p,
  });
  return p;
}

function makeEl(id) {
  const store = {
    id, style: {}, dataset: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(x, f) { const on = f === undefined ? !this._s.has(x) : f; on ? this._s.add(x) : this._s.delete(x); return on; },
      contains(x) { return this._s.has(x); },
    },
    children: [], childNodes: [],
    appendChild: (c) => c, append: () => {}, prepend: () => {}, insertBefore: (c) => c,
    removeChild: (c) => c, remove: () => {}, replaceChildren: () => {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, hasAttribute() { return false; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getContext: () => inert(),
    focus() {}, blur() {}, click() {}, scrollIntoView() {}, closest() { return null; },
    contains() { return false; }, cloneNode() { return makeEl(id); },
    insertAdjacentHTML() {}, insertAdjacentElement() {},
    get contentWindow() { return this.__cw || (this.__cw = { postMessage() {}, name: "" }); },
  };
  return new Proxy(store, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === Symbol.iterator) return function* () {};
      if (prop === "then") return undefined;
      return inert();
    },
    set(t, prop, v) { t[prop] = v; return true; },
    has: () => true,
  });
}

function makeDocument() {
  const els = new Map();
  const get = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const body = makeEl("body"), head = makeEl("head"), docEl = makeEl("html");
  const store = {
    _els: els, getElementById: get,
    createElement: (tag) => makeEl("new:" + tag),
    createElementNS: (ns, tag) => makeEl("new:" + tag),
    createTextNode: (t) => ({ textContent: t, nodeType: 3 }),
    createDocumentFragment: () => makeEl("frag"),
    querySelector: () => null, querySelectorAll: () => [],
    getElementsByClassName: () => [], getElementsByTagName: () => [],
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    body, head, documentElement: docEl,
    title: "", cookie: "", readyState: "complete",
    visibilityState: "visible", hidden: false, activeElement: body, execCommand: () => true,
  };
  return new Proxy(store, {
    get(t, prop) { if (prop in t) return t[prop]; if (prop === "then") return undefined; return inert(); },
    set(t, prop, v) { t[prop] = v; return true; },
    has: () => true,
  });
}

function makeStorage(backing) {
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: (k) => { delete backing[k]; },
    clear: () => { for (const k of Object.keys(backing)) delete backing[k]; },
    key: (i) => Object.keys(backing)[i] ?? null,
    get length() { return Object.keys(backing).length; },
  };
}

function makeLocation(href, nav) {
  const u = new URL(href);
  return {
    get href() { return u.href; }, set href(v) { nav.target = new URL(v, u.href).href; },
    get origin() { return u.origin; }, get protocol() { return u.protocol; },
    get host() { return u.host; }, get hostname() { return u.hostname; }, set hostname(v) { u.hostname = v; },
    get pathname() { return u.pathname; }, get search() { return u.search; }, get hash() { return u.hash; },
    assign: (v) => { nav.target = new URL(v, u.href).href; },
    replace: (v) => { nav.target = new URL(v, u.href).href; },
    reload: () => {}, toString: () => u.href, _url: u,
  };
}

function makeFetch() {
  const json = (obj) => Promise.resolve({
    ok: true, status: 200,
    json: async () => obj, text: async () => JSON.stringify(obj),
    blob: async () => new Blob([JSON.stringify(obj)]),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(obj)).buffer,
  });
  return (url) => {
    const s = String(url);
    if (/gallery\.json/.test(s)) return json([]);
    return json({ data: [], models: [] });
  };
}

function loadPage(code, { href, store, session }) {
  const nav = { target: null };
  const timers = [];
  let timerId = 1;
  const location = makeLocation(href, nav);
  const ctx = {
    console,
    TextEncoder, TextDecoder, URL, URLSearchParams, btoa, atob, crypto,
    Blob, Response, CompressionStream, DecompressionStream, structuredClone, queueMicrotask, Date,
    setTimeout: (fn) => { const id = timerId++; timers.push({ id, fn }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    fetch: makeFetch(), document: makeDocument(), location,
    history: {
      state: null, length: 1,
      replaceState(_s, _t, url) { if (url != null) { try { location._url.href = new URL(url, location._url.href).href; } catch {} } },
      pushState(_s, _t, url) { this.replaceState(_s, _t, url); },
      back() {}, forward() {}, go() {},
    },
    navigator: { clipboard: { writeText: async () => {} }, userAgent: "node", language: "en", onLine: true },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    alert() {}, confirm: () => true, prompt: () => null,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    Image: class { set src(_v) {} },
    _listeners: {}, dispatchEvent() { return true; }, postMessage() {},
    open: () => ({ closed: false, close() {}, focus() {}, postMessage() {} }),
    close() {}, name: "", _timers: timers, _nav: nav,
  };
  ctx.addEventListener = (type, fn) => { (ctx._listeners[type] ||= []).push(fn); };
  ctx.removeEventListener = (type, fn) => { const a = ctx._listeners[type]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } };
  ctx.localStorage = makeStorage(store);
  ctx.sessionStorage = makeStorage(session);
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; ctx.top = ctx;
  ctx.parent = ctx;                                  // standalone visit (a share link opened directly), never embedded
  ctx.frames = ctx;
  ctx.URL.createObjectURL = () => "blob:mock"; ctx.URL.revokeObjectURL = () => {};
  vm.createContext(ctx);
  new vm.Script(code, { filename: "play.html#main" }).runInContext(ctx);
  return ctx;
}

function settleTimers(ctx) {
  const timers = ctx._timers;
  for (let guard = 0; guard < 50 && timers.length; guard++) {
    const batch = timers.splice(0, timers.length);
    for (const t of batch) { try { t.fn(); } catch {} }
  }
}
async function drainAsync() { for (let i = 0; i < 10; i++) await new Promise((r) => globalThis.setTimeout(r, 0)); }

/* -------------------------------------------------------------------------- */
/* payload packing (mirror play.html's own #a= format)                         */
/* -------------------------------------------------------------------------- */

function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function gzipBytes(str) {
  const stream = new Blob([new TextEncoder().encode(str)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function aHashGz(spec) { return "#a=" + bytesToB64url(await gzipBytes(JSON.stringify(spec))); }
function aHashLegacyU(spec) { return "#a=u" + bytesToB64url(new TextEncoder().encode(JSON.stringify(spec))); }

/* -------------------------------------------------------------------------- */
/* fixtures                                                                     */
/* -------------------------------------------------------------------------- */

const PLAY_HTML = readFileSync(join(ROOT, "play.html"), "utf8");
const PLAY_SRC = prepare(extractMainScript(PLAY_HTML, /function boot\s*\(/));

const ORIGIN = "https://nanoodle.com";
const SPEC = {
  v: 1,
  graph: { nodes: [{ id: "n_hi", type: "text", x: 10, y: 10, fields: { text: "hello" } }], links: [] },
  files: { "index.html": "<!doctype html><title>Shared</title><body>hi</body>" },
};
// a pre-seeded library entry standing in for the recipient's OWN saved apps — a broken import
// must leave this byte-for-byte intact.
const OWN_APPS = JSON.stringify([{
  id: "app_mine", title: "My Own App", imported: false,
  graph: { nodes: [{ id: "m", type: "text", x: 0, y: 0, fields: { text: "mine" } }], links: [] },
  files: { "index.html": "<!doctype html><title>Mine</title>" },
  versions: [{ files: { "index.html": "<!doctype html><title>Mine</title>", "app.css": "" } }],
  curVer: 0, updated: 1,
}]);

const el = (ctx, id) => ctx.document.getElementById(id);
const bannerShown = (ctx) => el(ctx, "linkerr").hidden === false;
const appShown = (ctx) => el(ctx, "empty").hidden === true;
function appCount(store) { try { return JSON.parse(store.noodle_apps || "[]").length; } catch { return -1; } }

async function bootPlay(hash, store, session) {
  const ctx = loadPage(PLAY_SRC, { href: ORIGIN + "/play" + (hash || ""), store, session: session || {} });
  await ctx.__BOOT__; await drainAsync(); settleTimers(ctx); await drainAsync();
  return ctx;
}

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail: pass ? "" : detail }); }

/* -------------------------------------------------------------------------- */
/* static CSS contract — the show rule must be guarded so `hidden` wins         */
/* -------------------------------------------------------------------------- */

function styleText(html) {
  let out = ""; const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi; let m;
  while ((m = re.exec(html))) out += m[1] + "\n";
  return out.replace(/\/\*[\s\S]*?\*\//g, " ");   // drop CSS comments so a rule's preceding note isn't mistaken for its selector

}
// Scan every CSS rule that sets `display` on the #linkerr ELEMENT itself (not a descendant like
// `#linkerr .le-x`). Each such rule MUST be guarded by :not([hidden]) (or be a `[hidden]` rule),
// or the `hidden` attribute stops hiding the banner and it shows on every load.
function linkerrDisplayGuard(css) {
  const re = /([^{}]*)\{([^}]*)\}/g;
  let m, guardedShow = false;
  const offenders = [];
  while ((m = re.exec(css))) {
    const selGroup = m[1], body = m[2];
    if (!/#linkerr/.test(selGroup) || !/\bdisplay\s*:/.test(body)) continue;
    for (let sel of selGroup.split(",")) {
      sel = sel.trim();
      const idx = sel.indexOf("#linkerr");
      if (idx < 0) continue;
      const rest = sel.slice(idx + "#linkerr".length);       // what qualifies #linkerr on the same element
      // Same-element qualifiers only (pseudo `:`, attribute `[`, class `.`) — a class like
      // `#linkerr.shown{display:…}` outweighs `[hidden]` too, so it's the same always-show bug.
      // A combinator (space / > / + / ~) targets a descendant and can't set the banner's own display.
      const elementLevel = rest === "" || rest[0] === ":" || rest[0] === "[" || rest[0] === ".";
      if (!elementLevel) continue;
      if (/:not\(\[hidden\]\)/.test(rest)) { guardedShow = true; continue; }
      if (/^\[hidden\]/.test(rest)) continue;                 // an explicit #linkerr[hidden]{display:none} guard is fine
      offenders.push(sel);
    }
  }
  return { guardedShow, offenders };
}

/* -------------------------------------------------------------------------- */
/* scenarios                                                                    */
/* -------------------------------------------------------------------------- */

async function run() {
  /* 1. GARBAGE #a= — undecodable payload lands in the broken path: no app installed, the hash is
     PRESERVED (a corrected reload can retry — consumeHandoff must NOT have fired), and the
     recipient's own saved library is byte-for-byte intact. */
  {
    const store = { noodle_apps: OWN_APPS }, session = {};
    const ctx = await bootPlay("#a=@@@garbage", store, session);
    record("1 garbage #a= → broken path, hash kept, library untouched, no app installed",
      bannerShown(ctx) && !appShown(ctx) && ctx.location.hash === "#a=@@@garbage" && store.noodle_apps === OWN_APPS,
      `banner=${bannerShown(ctx)} appShown=${appShown(ctx)} hash="${ctx.location.hash}" libIntact=${store.noodle_apps === OWN_APPS}`);
  }

  /* 2. BANNER VISIBLE (static CSS contract, the twice-broken one): the show rule must be written
     so the `hidden` attribute wins — a bare `#linkerr{display:…}` (id specificity) defeats the
     UA `[hidden]{display:none}` and pins the banner open on every load. */
  {
    const { guardedShow, offenders } = linkerrDisplayGuard(styleText(PLAY_HTML));
    record("2 #linkerr show rule is :not([hidden])-guarded (hidden attribute wins)",
      guardedShow && offenders.length === 0,
      `guardedShow=${guardedShow} unguardedDisplayRules=${JSON.stringify(offenders)} — must use "#linkerr:not([hidden]){display:…}"`);
  }

  /* 3. TRUNCATED-VALID #a= — a real, valid payload cut off mid-base64 (the messenger link-wrap
     case) must ALSO reach the broken path, not half-install a partial app. */
  {
    const full = await aHashGz(SPEC);
    const truncated = full.slice(0, 3 + Math.floor((full.length - 3) * 0.6));   // keep "#a=", chop the tail
    const store = { noodle_apps: OWN_APPS }, session = {};
    const ctx = await bootPlay(truncated, store, session);
    record("3 truncated-valid #a= → broken path (no half-installed app)",
      bannerShown(ctx) && !appShown(ctx) && ctx.location.hash === truncated && store.noodle_apps === OWN_APPS,
      `banner=${bannerShown(ctx)} appShown=${appShown(ctx)} hashKept=${ctx.location.hash === truncated} libIntact=${store.noodle_apps === OWN_APPS}`);
  }

  /* 4. LEGACY 'u' FALLBACK — an uncompressed 'u'-prefixed #a= link (pre-gzip share links) still
     decodes, installs, shows the app, and consumes the hash. No banner. */
  {
    const store = {}, session = {};
    const ctx = await bootPlay(aHashLegacyU(SPEC), store, session);
    record("4 legacy 'u'-prefix #a= still decodes + installs (no banner, hash consumed)",
      appShown(ctx) && !bannerShown(ctx) && ctx.location.hash === "" && appCount(store) === 1,
      `appShown=${appShown(ctx)} banner=${bannerShown(ctx)} hash="${ctx.location.hash}" apps=${appCount(store)}`);
  }

  /* 5. NO FALSE POSITIVE — an empty/absent hash boots the normal empty state with the banner
     hidden (the regression that shipped once: the banner shown with no broken link). */
  {
    const store = {}, session = {};
    const ctx = await bootPlay("", store, session);
    record("5 empty hash → normal empty state, NO banner (no false positive)",
      !bannerShown(ctx) && !appShown(ctx),
      `banner=${bannerShown(ctx)} appShown=${appShown(ctx)} (expected banner hidden, empty state)`);
  }
}

run().then(() => {
  let bad = 0;
  console.log("\nMalformed / legacy share-link path (play.html #linkerr):\n");
  for (const r of results) {
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}` + (r.pass ? "" : `   [${r.detail}]`));
    if (!r.pass) bad++;
  }
  console.log("");
  if (bad) { console.error(`✗ ${bad} broken-share-link invariant(s) failed — a truncated #a= link may blank the page or damage the recipient's saved apps.\n`); process.exit(1); }
  console.log("✓ Broken share links surface the banner and leave saved apps intact; legacy links still open.\n");
}).catch((e) => {
  console.error("harness error:", e && e.stack ? e.stack : e);
  process.exit(2);
});
