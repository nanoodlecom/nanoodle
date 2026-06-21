#!/usr/bin/env node
// Verifies that the app/graph a user is working on SURVIVES the OAuth login
// round-trip, for every way a user can arrive at the editor or app runner.
//
// Why this exists: the hash (#a=/#g=/#j=) never survives an OAuth redirect, and
// debounced localStorage writes can be lost if the user starts sign-in before
// the timer fires. This harness reproduces the exact sequence WITHOUT a browser:
//
//   1. Pull the inline <script> out of index.html / play.html (the REAL code).
//   2. Run it in a node:vm sandbox with small DOM/window stubs + a persistent
//      localStorage/sessionStorage that survives across "page loads".
//   3. Simulate: open URL -> boot -> user starts sign-in (location.assign) ->
//      OAuth redirect back to ?code= -> boot again. A navigation DROPS pending
//      setTimeout callbacks, exactly like a real page unload — so a debounced
//      write that hasn't fired is lost, just like the bug.
//   4. Assert the user's app/graph is still rendered after the round-trip.
//
// Cheap enough for pre-commit: no browser, no npm. Node 24 supplies real
// crypto.subtle, CompressionStream/DecompressionStream, fetch and Blob, so
// PKCE and gzip/gunzip run for real.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* -------------------------------------------------------------------------- */
/* extract + prepare the real inline script                                    */
/* -------------------------------------------------------------------------- */

function extractMainScript(html, needle) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!/\bsrc=/i.test(m[1]) && needle.test(m[2])) return m[2];
  }
  throw new Error("main inline <script> not found");
}

function prepare(code, kind) {
  // gptdiff-js is only used inside event handlers (never during boot); stub it
  // so the module can run as a classic script (function decls leak to global).
  code = code.replace(
    /import\s*\{[^}]*\}\s*from\s*["'][^"']*gptdiff-js[^"']*["'];?/,
    "const buildEnvironment=()=>({}),generateDiff=async()=>'',smartapply=async()=>({}),parseDiffPerFile=()=>({}),callLlmForApply=async()=>'',setEnv=()=>{};",
  );
  // Capture boot's promise so we can await it, instead of letting it run unobserved.
  if (kind === "play") {
    if (!/\nboot\(\);/.test(code)) throw new Error("play.html: boot() call not found");
    code = code.replace(/\nboot\(\);/, "\nglobalThis.__BOOT__ = boot();");
  } else {
    const anchor = /\(async \(\)=>\{\s*\n\s*buildAddMenu\(\);/;
    if (!anchor.test(code)) throw new Error("index.html: boot IIFE anchor not found");
    code = code.replace(anchor, "globalThis.__BOOT__ = (async ()=>{\n  buildAddMenu();");
  }
  return code;
}

/* -------------------------------------------------------------------------- */
/* DOM / window stubs                                                          */
/* -------------------------------------------------------------------------- */

// A self-returning, callable, coercible proxy that absorbs arbitrary DOM access.
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
    set: () => true,
    has: () => true,
    construct: () => p,
    apply: () => p,
  });
  return p;
}

// A fake element that REMEMBERS properties you set (so installApp/showEmpty's
// hidden/style changes are observable) but absorbs everything else.
function makeEl(id) {
  const store = {
    id,
    style: {},
    dataset: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(x, f) { const on = f === undefined ? !this._s.has(x) : f; on ? this._s.add(x) : this._s.delete(x); return on; },
      contains(x) { return this._s.has(x); },
    },
    children: [],
    childNodes: [],
    appendChild: (c) => c,
    append: () => {},
    prepend: () => {},
    insertBefore: (c) => c,
    removeChild: (c) => c,
    remove: () => {},
    replaceChildren: () => {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, hasAttribute() { return false; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    querySelector() { return inert(); }, querySelectorAll() { return []; },
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getContext: () => inert(),
    focus() {}, blur() {}, click() {}, scrollIntoView() {}, closest() { return null; },
    contains() { return false; }, cloneNode() { return makeEl(id); },
    insertAdjacentHTML() {}, insertAdjacentElement() {},
  };
  const p = new Proxy(store, {
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
  return p;
}

function makeDocument() {
  const els = new Map();
  const get = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const body = makeEl("body");
  const head = makeEl("head");
  const docEl = makeEl("html");
  const store = {
    _els: els,
    getElementById: get,
    createElement: (tag) => makeEl("new:" + tag),
    createElementNS: (ns, tag) => makeEl("new:" + tag),
    createTextNode: (t) => ({ textContent: t, nodeType: 3 }),
    createDocumentFragment: () => makeEl("frag"),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementsByClassName: () => [],
    getElementsByTagName: () => [],
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    body, head, documentElement: docEl,
    title: "", cookie: "", readyState: "complete",
    visibilityState: "visible", hidden: false,
    activeElement: body,
    execCommand: () => true,
  };
  return new Proxy(store, {
    get(t, prop) { if (prop in t) return t[prop]; if (prop === "then") return undefined; return inert(); },
    set(t, prop, v) { t[prop] = v; return true; },
    has: () => true,
  });
}

// In-memory Storage with optional quota cap (to model the silent-write-failure case).
function makeStorage(backing, { quota = Infinity } = {}) {
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => {
      const next = { ...backing, [k]: String(v) };
      const size = Object.entries(next).reduce((n, [kk, vv]) => n + kk.length + vv.length, 0);
      if (size > quota) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
      backing[k] = String(v);
    },
    removeItem: (k) => { delete backing[k]; },
    clear: () => { for (const k of Object.keys(backing)) delete backing[k]; },
    key: (i) => Object.keys(backing)[i] ?? null,
    get length() { return Object.keys(backing).length; },
  };
}

function makeLocation(href, nav) {
  const u = new URL(href);
  const loc = {
    get href() { return u.href; },
    set href(v) { nav.target = new URL(v, u.href).href; },
    get origin() { return u.origin; },
    get protocol() { return u.protocol; },
    get host() { return u.host; },
    get hostname() { return u.hostname; },
    set hostname(v) { u.hostname = v; },
    get pathname() { return u.pathname; },
    get search() { return u.search; },
    get hash() { return u.hash; },
    assign: (v) => { nav.target = new URL(v, u.href).href; },
    replace: (v) => { nav.target = new URL(v, u.href).href; },
    reload: () => {},
    toString: () => u.href,
    _url: u,
  };
  return loc;
}

// Mocked NanoGPT + asset endpoints. Never rejects (so fire-and-forget catalog
// loads don't throw); the OAuth token/register endpoints return fixed values.
function makeFetch() {
  const json = (obj) => Promise.resolve({
    ok: true, status: 200,
    json: async () => obj, text: async () => JSON.stringify(obj),
    blob: async () => new Blob([JSON.stringify(obj)]),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(obj)).buffer,
  });
  return (url) => {
    const s = String(url);
    if (/\/oauth\/register/.test(s)) return json({ client_id: "ngpt_test_client" });
    if (/\/oauth\/token/.test(s)) return json({ access_token: "tok_test_access", token_type: "Bearer", scope: "api.use models.read" });
    if (/noodle-graph\.json/.test(s)) return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => "" });
    return json({ data: [], models: [] }); // model catalogs etc.
  };
}

/* -------------------------------------------------------------------------- */
/* one simulated page load                                                      */
/* -------------------------------------------------------------------------- */

function loadPage(code, kind, { href, store, session, parentIsSelf = true, quota = Infinity }) {
  const nav = { target: null };
  const timers = [];
  let timerId = 1;
  const location = makeLocation(href, nav);

  const ctx = {
    console,
    TextEncoder, TextDecoder, URL, URLSearchParams, btoa, atob, crypto,
    Blob, Response, CompressionStream, DecompressionStream, structuredClone, queueMicrotask, Date,
    setTimeout: (fn, _d) => { const id = timerId++; timers.push({ id, fn, type: "timeout" }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval: (fn, _d) => { const id = timerId++; timers.push({ id, fn, type: "interval" }); return id; },
    clearInterval: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    fetch: makeFetch(),
    document: makeDocument(),
    location,
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
    _listeners: {},
    dispatchEvent() { return true; },
    postMessage() {},
    open: () => ({ closed: false, close() {}, focus() {}, postMessage() {} }),
    close() {},
    name: "",
    _timers: timers, _nav: nav,
  };
  ctx.addEventListener = (type, fn) => { (ctx._listeners[type] ||= []).push(fn); };
  ctx.removeEventListener = (type, fn) => { const a = ctx._listeners[type]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } };
  ctx.localStorage = makeStorage(store, { quota });
  ctx.sessionStorage = makeStorage(session);
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.top = ctx;
  ctx.parent = parentIsSelf ? ctx : { postMessage() {}, location: { href: "about:editor" } };
  ctx.frames = ctx;
  ctx.URL.createObjectURL = () => "blob:mock"; ctx.URL.revokeObjectURL = () => {};

  vm.createContext(ctx);
  new vm.Script(code, { filename: kind + ".html#main" }).runInContext(ctx);
  return ctx;
}

// Run pending timer callbacks (simulating "the user waited"); navigation drops them.
function settleTimers(ctx) {
  const timers = ctx._timers;
  for (let guard = 0; guard < 50 && timers.length; guard++) {
    const batch = timers.splice(0, timers.length);
    for (const t of batch) { try { t.fn(); } catch {} }
  }
}

// Let microtasks + real async (gunzip streams, mocked fetch) flush.
async function drainAsync() {
  for (let i = 0; i < 8; i++) await new Promise((r) => globalThis.setTimeout(r, 0));
}

/* -------------------------------------------------------------------------- */
/* hash builders (mirror the pages' own packing)                               */
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
async function appHash(spec) { return "#a=" + bytesToB64url(await gzipBytes(JSON.stringify(spec))); }
async function graphHash(graph) { return "#g=" + bytesToB64url(await gzipBytes(JSON.stringify(graph))); }

/* -------------------------------------------------------------------------- */
/* scenarios                                                                   */
/* -------------------------------------------------------------------------- */

const PLAY_SRC = prepare(extractMainScript(readFileSync(join(ROOT, "play.html"), "utf8"), /function boot\s*\(/), "play");
const INDEX_SRC = prepare(extractMainScript(readFileSync(join(ROOT, "index.html"), "utf8"), /handleRedirect/), "index");

const MARK_ID = "usermark1";
const MARK_TEXT = "hello world unique-marker-42";
const SAMPLE_GRAPH = { nodes: [{ id: MARK_ID, type: "text", x: 120, y: 90, fields: { text: MARK_TEXT } }], links: [] };
const SAMPLE_FILES = { "index.html": "<!doctype html><title>marked-app</title>" };
// A realistically-large app (accumulated AI-customized versions) used to model the
// quota case: the synchronous writeState silently exceeds a near-full localStorage.
const BIG_FILES = { "index.html": "<!doctype html><title>marked-app</title>" + "<!--pad-->".repeat(180) };

const RETURN = "https://nanoodle.com/play?code=abc123&state=__STATE__";
const RETURN_EDITOR = "https://nanoodle.com/editor?code=abc123&state=__STATE__";

// Pull the state nonce play/index stashed in sessionStorage so the return URL's
// state matches (handleRedirect validates it).
function returnUrlWith(session, base) {
  const pkce = JSON.parse(session.pkce || session.pkce_popup || "null");
  return base.replace("__STATE__", pkce ? pkce.state : "x");
}

async function roundTrip(src, kind, { url, returnBase, action, settle = false, quota = Infinity }) {
  const store = {};
  const session = {};
  // Page A
  let a = loadPage(src, kind, { href: url, store, session, quota });
  await a.__BOOT__;
  await drainAsync();
  if (settle) settleTimers(a);
  // user action (e.g., start sign-in)
  await action(a);
  await drainAsync();
  if (!a._nav.target) throw new Error("expected sign-in to navigate (location.assign) but it did not");
  // Page B: OAuth redirected back with ?code=
  const back = returnUrlWith(session, returnBase);
  let b = loadPage(src, kind, { href: back, store, session, quota });
  await b.__BOOT__;
  await drainAsync();
  // The user now stays on the returned page, so any debounced autosave fires.
  settleTimers(b); await drainAsync();
  return { store, session, a, b };
}

const deepEq = (x, y) => JSON.stringify(x) === JSON.stringify(y);

// Did play.html end up showing the app (vs the empty state)?
function playAppShown(ctx) {
  const empty = ctx.document.getElementById("empty");
  return empty.hidden === true;
}
function playStateGraph(store) {
  try { return JSON.parse(store["noodle_app_state"]).graph; } catch { return null; }
}

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail }); }

async function run() {
  /* S1: /play#a=<fullapp>, signed out, user clicks Run -> full-page OAuth */
  {
    const url = "https://nanoodle.com/play" + (await appHash({ v: 1, graph: SAMPLE_GRAPH, files: SAMPLE_FILES }));
    const { store, b } = await roundTrip(PLAY_SRC, "play", {
      url, returnBase: RETURN, action: async (a) => { await a.signIn(); },
    });
    const g = playStateGraph(store);
    record("S1 /play#a= (signed-out, Run)", playAppShown(b) && deepEq(g, SAMPLE_GRAPH),
      `appShown=${playAppShown(b)} lsGraphMatches=${deepEq(g, SAMPLE_GRAPH)}`);
  }

  /* S3: /play#g=<graph>, signed out, click Sign In (fast — before debounce) */
  {
    const url = "https://nanoodle.com/play" + (await graphHash(SAMPLE_GRAPH));
    const { store, b } = await roundTrip(PLAY_SRC, "play", {
      url, returnBase: RETURN, action: async (a) => { await a.signIn(); }, settle: false,
    });
    const g = playStateGraph(store);
    record("S3 /play#g= (signed-out, fast Sign In)", playAppShown(b) && deepEq(g, SAMPLE_GRAPH),
      `appShown=${playAppShown(b)} lsGraphMatches=${deepEq(g, SAMPLE_GRAPH)}`);
  }

  /* S4: /play, open from My Apps, signed out, sign in */
  {
    // seed an app into the library first
    const url = "https://nanoodle.com/play" + (await appHash({ v: 1, graph: SAMPLE_GRAPH, files: SAMPLE_FILES }));
    const store = {}, session = {};
    let a = loadPage(PLAY_SRC, "play", { href: url, store, session });
    await a.__BOOT__; await drainAsync();           // app imported + saved to library
    const appsLib = JSON.parse(store["noodle_apps"] || "[]");
    const id = appsLib[0] && appsLib[0].id;
    // fresh visit to /play (no hash), open that app, sign in
    let a2 = loadPage(PLAY_SRC, "play", { href: "https://nanoodle.com/play", store, session });
    await a2.__BOOT__; await drainAsync();
    if (id && a2.openApp) a2.openApp(id);
    await drainAsync();
    await a2.signIn(); await drainAsync();
    const back = returnUrlWith(session, RETURN);
    let b = loadPage(PLAY_SRC, "play", { href: back, store, session });
    await b.__BOOT__; await drainAsync(); settleTimers(b); await drainAsync();
    const g = playStateGraph(store);
    record("S4 /play open-from-My-Apps", playAppShown(b) && deepEq(g, SAMPLE_GRAPH),
      `appShown=${playAppShown(b)} lsGraphMatches=${deepEq(g, SAMPLE_GRAPH)}`);
  }

  /* S6: /editor#g=<graph>, signed out, click Sign In (fast) */
  {
    const url = "https://nanoodle.com/editor" + (await graphHash(SAMPLE_GRAPH));
    const { b } = await roundTrip(INDEX_SRC, "index", {
      url, returnBase: RETURN_EDITOR, action: async (a) => { await a.signIn(); }, settle: false,
    });
    const g = b.serializeGraph ? b.serializeGraph() : null;
    const got = g && g.nodes && g.nodes.find((n) => n.id === MARK_ID);
    record("S6 /editor#g= (signed-out, fast Sign In)", !!got && got.fields.text === MARK_TEXT,
      `userNodePresent=${!!got}`);
  }

  /* S7: /editor with locally-saved graph, signed out, sign in */
  {
    const store = { noodle_graph: JSON.stringify(SAMPLE_GRAPH) }, session = {};
    let a = loadPage(INDEX_SRC, "index", { href: "https://nanoodle.com/editor", store, session });
    await a.__BOOT__; await drainAsync();
    await a.signIn(); await drainAsync();
    const back = returnUrlWith(session, RETURN_EDITOR);
    let b = loadPage(INDEX_SRC, "index", { href: back, store, session });
    await b.__BOOT__; await drainAsync(); settleTimers(b); await drainAsync();
    const g = b.serializeGraph ? b.serializeGraph() : null;
    const got = g && g.nodes && g.nodes.find((n) => n.id === MARK_ID);
    record("S7 /editor local graph", !!got && got.fields.text === MARK_TEXT,
      `userNodePresent=${!!got}`);
  }

  /* S8: /play#a=<bigapp> with a near-full localStorage — the synchronous
     writeState silently hits quota, so nothing is in localStorage to restore. */
  {
    const url = "https://nanoodle.com/play" + (await appHash({ v: 1, graph: SAMPLE_GRAPH, files: BIG_FILES }));
    const { b } = await roundTrip(PLAY_SRC, "play", {
      url, returnBase: RETURN, action: async (a) => { await a.signIn(); }, quota: 600,
    });
    record("S8 /play#a= near-full localStorage (quota)", playAppShown(b), `appShown=${playAppShown(b)}`);
  }

  /* R1/R2: sign-in must send OAuth back to the SAME page (a wrong redirect_uri,
     e.g. from the shared ngpt_client cache, lands the user on the other app). */
  {
    const ruri = async (src, kind, href) => {
      const store = {}, session = {};
      const a = loadPage(src, kind, { href, store, session });
      await a.__BOOT__; await drainAsync();
      await a.signIn(); await drainAsync();
      if (!a._nav.target) throw new Error("signIn did not navigate");
      return new URL(a._nav.target).searchParams.get("redirect_uri");
    };
    const got1 = await ruri(PLAY_SRC, "play", "https://nanoodle.com/play" + (await appHash({ v: 1, graph: SAMPLE_GRAPH, files: SAMPLE_FILES })));
    record("R1 /play sign-in returns to /play", got1 === "https://nanoodle.com/play", `redirect_uri=${got1}`);
    const got2 = await ruri(INDEX_SRC, "index", "https://nanoodle.com/editor");
    record("R2 /editor sign-in returns to /editor", got2 === "https://nanoodle.com/editor", `redirect_uri=${got2}`);
  }
}

run().then(() => {
  let bad = 0;
  console.log("\nLogin state-preservation across OAuth round-trip:\n");
  for (const r of results) {
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}` + (r.pass ? "" : `   [${r.detail}]`));
    if (!r.pass) bad++;
  }
  console.log("");
  if (bad) { console.error(`✗ ${bad} login path(s) lose the user's app/graph on sign-in.\n`); process.exit(1); }
  console.log("✓ all login paths preserve the user's app/graph.\n");
}).catch((e) => {
  console.error("harness error:", e && e.stack ? e.stack : e);
  process.exit(2);
});
