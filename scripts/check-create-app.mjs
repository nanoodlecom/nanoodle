#!/usr/bin/env node
// Verifies the "✨ Create app" handoff state machine — the editor↔builder contract
// that decides whether clicking Create app makes a NEW app or UPDATES an existing one.
//
// Why a dedicated check: the binding between "the workflow on the canvas" and "the app
// it targets" is invisible, sticky, and split across two same-origin documents
// (index.html's pendingAppId; play.html's CUR_ID + RESUME/handoff intake). A single
// regression there silently re-targets an OLD app, or spawns a DUPLICATE — the exact
// "Create app opened an old app" class of bug. None of the other checkers exercise this
// editor→builder routing.
//
// Technique mirrors check-login-state.mjs: pull the REAL inline <script> out of each
// HTML, run it in a node:vm sandbox with DOM/window stubs and a localStorage/sessionStorage
// that persists across simulated page loads, then drive the actual wiring (button clicks,
// postMessage) and read the observable effects (page title, the hash the editor emits into
// the modal iframe, the app the builder installs).
//
// INVARIANTS ENFORCED
//   Editor (index.html):
//    1. A workflow loaded via #ga=<id> binds to that app: the primary button says
//       "Update <name>", the ▾ caret (which reveals "Save as a new app") appears, and
//       Create app re-emits #ga=<same id>.
//    2. That binding SURVIVES a plain reload (persisted outside noodle_graph), so the
//       next Create app still updates — never duplicates. [the lost-on-reload bug]
//    3. A fresh #g= workflow has NO binding: button says "Create app", the caret is
//       hidden, no #ga=, no persisted binding.
//    4. "Save as a new app" detaches the binding and emits a plain #g= → a brand-new app.
//       [the reported "built something new but it updated my old app" escape hatch]
//    5. __editflow__ applies the graph BEFORE binding the id (never points "Update"
//       at one app while showing another's canvas), and ignores wrong-source messages.
//   Builder (play.html):
//    6. An explicit handoff hash BEATS a stale OAuth resume stash (the reported bug's
//       second mechanism), and the resume stash is consumed either way.
//    7. The builder's resume key is namespaced away from the editor's identical-looking
//       key, so a shared-tab editor stash can't open here as an "old app".
//    8. A legitimate OAuth resume (no hash) still reopens the stashed app — no regression.
//    9. #g=/#j= and #a=/#ga= consume the handoff (clear the URL hash AND the
//       noodle_app_handoff fallback) so a reload restores the SAVED draft, not the
//       original graph, and a later hash-less visit can't reopen a stale workflow.
//   10. updateAppWorkflow(unknownId) installs a fresh draft without throwing.
//   Resume / keep-alive (R*) — closing the modal must not lose your in-progress app:
//   R0. appHandoffSig() (the change-detector) ignores canvas pan/zoom + node positions but
//       flips on node type/fields, links, and the bound app id. [the "pan = lost work" trap]
//   R1. Reopening on the UNCHANGED graph resumes the live builder — emits no new handoff.
//   R2. Closing the modal keeps the iframe loaded (never about:blank). [the lost-state bug]
//   R3. A builder→canvas graph edit (__editflow__) re-hands-off — never a stale resume.
//   R4. Source guards: closeAppModal doesn't blank, openAppModal records the resume state,
//       openCreateApp short-circuits on an unchanged graph, play.html pauses media on hide.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* -------------------------------------------------------------------------- */
/* extract + prepare the real inline script (same approach as check-login-state) */
/* -------------------------------------------------------------------------- */

function extractMainScript(html, needle) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!/\bsrc=/i.test(m[1]) && needle.test(m[2])) return m[2];
  }
  throw new Error("main inline <script> not found");
}

// Pull one `function name(){…}` out of a source blob by brace-matching (same idea as
// check-image-ports / check-editor-ports) so we can unit-test it in isolation.
function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error(`function ${name}() not found`);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`could not brace-match ${name}()`);
}

function prepare(code, kind) {
  code = code.replace(
    /import\s*\{[^}]*\}\s*from\s*["'][^"']*gptdiff-js[^"']*["'];?/,
    "const buildEnvironment=()=>({}),generateDiff=async()=>'',smartapply=async()=>({}),parseDiffPerFile=()=>({}),callLlmForApply=async()=>'',setEnv=()=>{};",
  );
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
    // A STABLE iframe content window (memoized): the editor's message handler compares
    // e.source against $("appmodalframe").contentWindow, so it must be referentially stable.
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
    if (/\/oauth\/register/.test(s)) return json({ client_id: "ngpt_test_client" });
    if (/\/oauth\/token/.test(s)) return json({ access_token: "tok_test", token_type: "Bearer" });
    if (/noodle-graph\.json/.test(s)) return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => "" });
    if (/gallery\.json/.test(s)) return json([]);
    return json({ data: [], models: [] });
  };
}

function loadPage(code, kind, { href, store, session, parentIsSelf = true }) {
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
  ctx.parent = parentIsSelf ? ctx : { postMessage() {}, location: { href: "about:editor" } };
  ctx.frames = ctx;
  ctx.URL.createObjectURL = () => "blob:mock"; ctx.URL.revokeObjectURL = () => {};
  vm.createContext(ctx);
  new vm.Script(code, { filename: kind + ".html#main" }).runInContext(ctx);
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
/* hash packing/unpacking (mirror the pages' own format)                       */
/* -------------------------------------------------------------------------- */

function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s); const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
async function gzipBytes(str) {
  const stream = new Blob([new TextEncoder().encode(str)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzipStr(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new TextDecoder().decode(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function graphHash(graph) { return "#g=" + bytesToB64url(await gzipBytes(JSON.stringify(graph))); }
async function gaHash(spec) { return "#ga=" + bytesToB64url(await gzipBytes(JSON.stringify(spec))); }

// Decode the "play.html#..." string the editor's Create app emits into the iframe.
// Returns {kind:"none"} when no hash was emitted (e.g. a missing button / early return on
// buggy code) so callers fail as a clean assertion rather than a thrown harness error.
async function decodeHandoff(src) {
  const i = String(src).indexOf("#");
  if (i < 0) return { kind: "none", emitted: String(src) };
  const h = String(src).slice(i);
  if (h.startsWith("#ga=")) {
    const tag = h.slice(4);
    const json = tag[0] === "u" ? new TextDecoder().decode(b64urlToBytes(tag.slice(1))) : await gunzipStr(b64urlToBytes(tag));
    return { kind: "ga", spec: JSON.parse(json) };
  }
  if (h.startsWith("#g=")) return { kind: "g", graph: JSON.parse(await gunzipStr(b64urlToBytes(h.slice(3)))) };
  if (h.startsWith("#j=")) return { kind: "j", graph: JSON.parse(new TextDecoder().decode(b64urlToBytes(h.slice(3)))) };
  throw new Error("unrecognized handoff hash: " + h.slice(0, 8));
}

/* -------------------------------------------------------------------------- */
/* fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const PLAY_SRC = prepare(extractMainScript(readFileSync(join(ROOT, "play.html"), "utf8"), /function boot\s*\(/), "play");
const INDEX_SRC = prepare(extractMainScript(readFileSync(join(ROOT, "index.html"), "utf8"), /handleRedirect/), "index");

const mkGraph = (marker) => ({ nodes: [{ id: "n_" + marker, type: "text", x: 10, y: 10, fields: { text: marker } }], links: [] });
const APP_A = mkGraph("AAA"), APP_B = mkGraph("BBB"), NEWG = mkGraph("NEW"), OLDG = mkGraph("OLD");
const FILES = { "index.html": "<!doctype html><title>t</title>" };
const ORIGIN = "https://nanoodle.com";

const el = (ctx, id) => ctx.document.getElementById(id);
const txt = (ctx, id) => String(el(ctx, id).textContent ?? "");
const graphMarker = (g) => (g && g.nodes && g.nodes[0] && g.nodes[0].fields && g.nodes[0].fields.text) || null;
function playStateGraph(store) { try { return JSON.parse(store["noodle_app_state"]).graph; } catch { return null; } }
function playAppShown(ctx) { return el(ctx, "empty").hidden === true; }

async function bootEditor(href, store, session) {
  const ctx = loadPage(INDEX_SRC, "index", { href, store, session });
  await ctx.__BOOT__; await drainAsync(); settleTimers(ctx); await drainAsync();
  return ctx;
}
async function bootPlay(href, store, session) {
  const ctx = loadPage(PLAY_SRC, "play", { href, store, session });
  await ctx.__BOOT__; await drainAsync(); settleTimers(ctx); await drainAsync();
  return ctx;
}
// Click "Create app" (default) or another button, and decode the hash handed to the iframe.
async function emittedHandoff(ctx, buttonFn) {
  el(ctx, "appmodalframe").src = "";          // reset so we read THIS click's value
  await (buttonFn ? buttonFn() : el(ctx, "makeapp").onclick());
  await drainAsync();
  return decodeHandoff(el(ctx, "appmodalframe").src);
}

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail: pass ? "" : detail }); }

/* -------------------------------------------------------------------------- */
/* scenarios                                                                   */
/* -------------------------------------------------------------------------- */

async function run() {
  /* E1: #ga=<id> binds → "Update <name>", caret + "Save as a new app" shown, Create app re-emits #ga=<id>, binding persisted */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await gaHash({ v: 1, graph: APP_A, appId: "app_AAA", title: "My App" })), store, session);
    const out = await emittedHandoff(ctx);
    let persisted = null; try { persisted = JSON.parse(store.noodle_editor_app); } catch {}
    record("E1 #ga= binds + Create app updates same app",
      txt(ctx, "makeapp") === "✨ Update My App" && el(ctx, "appmore").hidden === false && el(ctx, "newapp").hidden === false &&
      out.kind === "ga" && out.spec.appId === "app_AAA" && (persisted && persisted.id === "app_AAA"),
      `btn=${txt(ctx, "makeapp")} caretHidden=${el(ctx, "appmore").hidden} newHidden=${el(ctx, "newapp").hidden} kind=${out.kind} appId=${out.spec && out.spec.appId} persisted=${persisted && persisted.id}`);
  }

  /* E2: binding SURVIVES a plain reload (no hash) → still updates, never duplicates [lost-on-reload bug] */
  {
    const store = {}, session = {};
    await bootEditor(ORIGIN + "/editor" + (await gaHash({ v: 1, graph: APP_A, appId: "app_AAA", title: "My App" })), store, session);
    const ctx2 = await bootEditor(ORIGIN + "/editor", store, session);   // reload: same store, NO hash
    const out = await emittedHandoff(ctx2);
    record("E2 binding survives reload (no duplicate)",
      txt(ctx2, "makeapp") === "✨ Update My App" && out.kind === "ga" && out.spec.appId === "app_AAA",
      `btn=${txt(ctx2, "makeapp")} kind=${out.kind} appId=${out.spec && out.spec.appId}`);
  }

  /* E3: fresh #g= → "Create app", no binding, no #ga= */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await graphHash(APP_B)), store, session);
    const out = await emittedHandoff(ctx);
    record("E3 fresh workflow → new app",
      txt(ctx, "makeapp") === "✨ Create app" && el(ctx, "appmore").hidden === true && el(ctx, "newapp").hidden === true &&
      (out.kind === "g" || out.kind === "j") && !store.noodle_editor_app,
      `btn=${txt(ctx, "makeapp")} caretHidden=${el(ctx, "appmore").hidden} newHidden=${el(ctx, "newapp").hidden} kind=${out.kind} editorApp=${store.noodle_editor_app}`);
  }

  /* E4: "Save as a new app" detaches a live binding and emits a plain #g= → brand-new app [reported-bug escape hatch] */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await gaHash({ v: 1, graph: APP_A, appId: "app_AAA", title: "My App" })), store, session);
    const out = await emittedHandoff(ctx, () => el(ctx, "newapp").onclick());
    record("E4 Save-as-new unlinks → emits #g= (new app)",
      (out.kind === "g" || out.kind === "j") && !store.noodle_editor_app && txt(ctx, "makeapp") === "✨ Create app",
      `kind=${out.kind} editorApp=${store.noodle_editor_app} btn=${txt(ctx, "makeapp")}`);
  }

  /* E5a: __editflow__ from the correct source applies the graph AND binds the id */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await graphHash(APP_B)), store, session);
    const src = el(ctx, "appmodalframe").contentWindow;
    for (const fn of (ctx._listeners.message || [])) fn({ source: src, data: { type: "__editflow__", appId: "app_ZZZ", title: "Z", graph: NEWG } });
    await drainAsync();
    const out = await emittedHandoff(ctx);
    record("E5a __editflow__ applies graph + binds id",
      out.kind === "ga" && out.spec.appId === "app_ZZZ" && graphMarker(out.spec.graph) === "NEW",
      `kind=${out.kind} appId=${out.spec && out.spec.appId} marker=${graphMarker(out.spec && out.spec.graph)}`);
  }

  /* E5b: __editflow__ from a WRONG source is ignored (no rebind) */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await gaHash({ v: 1, graph: APP_A, appId: "app_AAA", title: "My App" })), store, session);
    for (const fn of (ctx._listeners.message || [])) fn({ source: { postMessage() {} }, data: { type: "__editflow__", appId: "app_EVIL", title: "x", graph: NEWG } });
    await drainAsync();
    const out = await emittedHandoff(ctx);
    record("E5b __editflow__ ignores wrong-source message",
      out.kind === "ga" && out.spec.appId === "app_AAA",
      `appId=${out.spec && out.spec.appId} (expected app_AAA)`);
  }

  /* E5c (static): the __editflow__ branch must apply the graph BEFORE binding the id */
  {
    const branch = INDEX_SRC.slice(INDEX_SRC.indexOf('"__editflow__"'));
    const cut = branch.slice(0, branch.indexOf("closeAppModal"));
    const applyAt = cut.indexOf("applyGraphData");
    const bindAt = cut.indexOf("setPendingApp");
    record("E5c graph validated before binding (source order)",
      applyAt >= 0 && bindAt >= 0 && applyAt < bindAt,
      `applyGraphData@${applyAt} setPendingApp@${bindAt} — apply must precede bind`);
  }

  /* E6: "Save as a new app"'s unlink SURVIVES a reload (negative twin of E2). After detaching, a
     plain hash-less reload must NOT resurrect the old binding — else the escape hatch silently
     re-updates the very app the user meant to leave. */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await gaHash({ v: 1, graph: APP_A, appId: "app_AAA", title: "My App" })), store, session);
    await el(ctx, "newapp").onclick();                                   // detach the binding
    const ctx2 = await bootEditor(ORIGIN + "/editor", store, session);   // reload: same store, NO hash
    const out = await emittedHandoff(ctx2);
    record("E6 Save-as-new unlink survives reload (no resurrected binding)",
      txt(ctx2, "makeapp") === "✨ Create app" && (out.kind === "g" || out.kind === "j") && !store.noodle_editor_app,
      `btn=${txt(ctx2, "makeapp")} kind=${out.kind} editorApp=${store.noodle_editor_app}`);
  }

  /* B1: a handoff hash BEATS a stale OAuth resume stash; the stash is consumed [reported bug, 2nd path] */
  {
    const store = {}, session = { noodle_resume_app: JSON.stringify({ graph: OLDG, files: FILES, versions: [{ files: FILES }], v: 1 }) };
    const ctx = await bootPlay(ORIGIN + "/play" + (await graphHash(NEWG)), store, session);
    record("B1 handoff hash beats stale resume",
      playAppShown(ctx) && graphMarker(playStateGraph(store)) === "NEW" && session.noodle_resume_app === undefined,
      `shown=${playAppShown(ctx)} marker=${graphMarker(playStateGraph(store))} resumeLeft=${session.noodle_resume_app}`);
  }

  /* B2: the builder ignores the EDITOR's identically-shaped resume key (namespacing) */
  {
    const store = {}, session = { noodle_resume: JSON.stringify({ graph: OLDG, files: FILES, versions: [{ files: FILES }], v: 1 }) };
    const ctx = await bootPlay(ORIGIN + "/play", store, session);   // no hash, empty library
    record("B2 builder ignores editor's resume key",
      !playAppShown(ctx) && session.noodle_resume !== undefined,
      `shown=${playAppShown(ctx)} (want empty) editorKeyUntouched=${session.noodle_resume !== undefined}`);
  }

  /* B3: a legitimate builder resume (no hash) still reopens the stashed app — no regression */
  {
    const store = {}, session = { noodle_resume_app: JSON.stringify({ graph: OLDG, files: FILES, versions: [{ files: FILES }], v: 1 }) };
    const ctx = await bootPlay(ORIGIN + "/play", store, session);
    record("B3 legit OAuth resume still works",
      playAppShown(ctx) && graphMarker(playStateGraph(store)) === "OLD",
      `shown=${playAppShown(ctx)} marker=${graphMarker(playStateGraph(store))}`);
  }

  /* B4: #g= consumes the handoff — clears the URL hash AND the noodle_app_handoff fallback */
  {
    const store = { noodle_app_handoff: JSON.stringify(OLDG) }, session = {};
    const ctx = await bootPlay(ORIGIN + "/play" + (await graphHash(NEWG)), store, session);
    record("B4 #g= consumes hash + handoff fallback",
      ctx.location.hash === "" && store.noodle_app_handoff === undefined && graphMarker(playStateGraph(store)) === "NEW",
      `hash="${ctx.location.hash}" handoffLeft=${store.noodle_app_handoff} marker=${graphMarker(playStateGraph(store))}`);
  }

  /* B5: #ga= with an unknown/forgotten id installs a fresh draft without throwing */
  {
    const store = {}, session = {};
    let threw = false, ctx;
    try { ctx = await bootPlay(ORIGIN + "/play" + (await gaHash({ v: 1, graph: NEWG, appId: "ghost_missing" })), store, session); }
    catch (e) { threw = true; }
    record("B5 updateAppWorkflow(unknownId) → fresh draft, no crash",
      !threw && ctx && playAppShown(ctx) && graphMarker(playStateGraph(store)) === "NEW",
      `threw=${threw} shown=${ctx && playAppShown(ctx)} marker=${graphMarker(playStateGraph(store))}`);
  }

  /* B6: after a #g= handoff is consumed, a later hash-less RELOAD restores the SAVED draft and
     can't reopen the original workflow (negative twin of B4). The first boot installs+saves NEW
     and consumes the hash + the noodle_app_handoff fallback; the reload must land on the saved
     session with no handoff residue left to re-trigger. */
  {
    const store = {}, session = {};
    await bootPlay(ORIGIN + "/play" + (await graphHash(NEWG)), store, session);   // consume #g=NEW → saves draft
    const ctx2 = await bootPlay(ORIGIN + "/play", store, session);                // reload: same store, NO hash
    record("B6 consumed handoff → reload restores saved draft, no stale residue",
      playAppShown(ctx2) && graphMarker(playStateGraph(store)) === "NEW" && store.noodle_app_handoff === undefined,
      `shown=${playAppShown(ctx2)} marker=${graphMarker(playStateGraph(store))} handoffLeft=${store.noodle_app_handoff}`);
  }

  /* ----------------------------------------------------------------------------
     RESUME / KEEP-ALIVE (R*) — closing the Create-app modal must NOT throw away the
     app you're mid-build on. The editor keeps the builder iframe loaded and only
     re-hands-off when the app-MEANINGFUL graph changed; reopening on the same graph
     just unhides the live builder. Regressing any of these brings back the reported
     "closed the modal, lost my app" bug.
     -------------------------------------------------------------------------- */

  /* R0 (unit): appHandoffSig() is the change-detector. It MUST ignore canvas view
     (pan/zoom) and node positions/sizes — else navigating the canvas reads as an edit
     and the resume never fires — and MUST flip on node type/fields, links, or the bound
     app id. Run the REAL function in isolation over hand-built graphs. */
  {
    const sigFn = extractFn(INDEX_SRC, "appHandoffSig");
    const sctx = { JSON, graph: null, pendingAppId: null };
    vm.createContext(sctx);
    new vm.Script(sigFn, { filename: "appHandoffSig" }).runInContext(sctx);
    const sig = (graph, app = "") => { sctx.graph = graph; sctx.pendingAppId = app; return sctx.appHandoffSig(); };
    const base = () => ({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, w: 120, sizes: { 0: 1 }, fields: { text: "hi" } },
        { id: "b", type: "image", x: 50, y: 60, w: 200, sizes: {}, fields: { model: "m1" } },
      ],
      links: [{ from: { node: "a", port: "text" }, to: { node: "b", port: "prompt" } }],
      view: { panX: 0, panY: 0, scale: 1 },
    });
    const moved = base(); moved.nodes[0].x = 999; moved.nodes[1].y = -42; moved.nodes[0].w = 9;
    moved.nodes[1].sizes = { 9: 9 }; moved.view = { panX: 800, panY: -300, scale: 2.5 };
    const fieldEdit = base(); fieldEdit.nodes[1].fields.model = "m2";
    const typeEdit = base(); typeEdit.nodes[1].type = "video";
    const linkEdit = base(); linkEdit.links.push({ from: { node: "a", port: "text" }, to: { node: "b", port: "neg" } });
    const nameEdit = base(); nameEdit.nodes[0].name = "Headline";           // custom label → shown in the built app
    const wsName = base(); wsName.nodes[0].name = "   ";                     // whitespace-only → trims to "" (no change)
    const b0 = sig(base());
    record("R0 appHandoffSig ignores pan/zoom + node positions (resume fast-path can fire)",
      sig(moved) === b0, `moved sig ${sig(moved) === b0 ? "==" : "!="} base — view/x/y/w/sizes must be excluded`);
    record("R0 appHandoffSig flips on a field edit", sig(fieldEdit) !== b0, "model change must read as a change");
    record("R0 appHandoffSig flips on a node-type change", sig(typeEdit) !== b0, "type change must read as a change");
    record("R0 appHandoffSig flips on a link change", sig(linkEdit) !== b0, "new wire must read as a change");
    record("R0 appHandoffSig flips on a node rename", sig(nameEdit) !== b0, "custom name is the app's step label — must re-hand-off");
    record("R0 appHandoffSig ignores a whitespace-only name", sig(wsName) === b0, "blank name trims to '' — not an edit");
    record("R0 appHandoffSig flips on the bound app id", sig(base(), "app_X") !== b0, "pendingAppId must be folded in");
  }

  /* R1: reopening Create app on the UNCHANGED graph resumes the live builder — it emits
     NO new handoff hash (the fast-path returns early) and re-shows the modal. */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await graphHash(APP_B)), store, session);
    const first = await emittedHandoff(ctx);                    // first open → real handoff
    const second = await emittedHandoff(ctx);                   // same graph → fast-path, no new hash
    record("R1 unchanged reopen resumes (no re-handoff, modal reshown)",
      first.kind === "g" && second.kind === "none" && el(ctx, "appmodal").hidden === false,
      `first=${first.kind} second=${second.kind} shown=${el(ctx, "appmodal").hidden === false}`);
  }

  /* R2: closing the modal keeps the builder LOADED — it must never blank the iframe to
     about:blank (the old teardown that destroyed in-progress app state). */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await graphHash(APP_B)), store, session);
    await el(ctx, "makeapp").onclick(); await drainAsync();
    const opened = String(el(ctx, "appmodalframe").src);
    await el(ctx, "appmodalclose").onclick(); await drainAsync();
    const closed = String(el(ctx, "appmodalframe").src);
    record("R2 close keeps the builder loaded (never about:blank)",
      /play\.html#/.test(opened) && closed === opened && !/about:blank/.test(closed) && el(ctx, "appmodal").hidden === true,
      `opened=${opened.slice(0, 18)} closed=${closed.slice(0, 18)} hidden=${el(ctx, "appmodal").hidden}`);
  }

  /* R3: when the builder hands an edited graph back to the canvas (__editflow__), the next
     Create app must RE-hand-off the new graph — never silently resume the stale builder. */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await graphHash(APP_B)), store, session);
    await emittedHandoff(ctx);                                  // open once → sig recorded for APP_B
    const src = el(ctx, "appmodalframe").contentWindow;
    for (const fn of (ctx._listeners.message || [])) fn({ source: src, data: { type: "__editflow__", appId: "app_ZZZ", title: "Z", graph: NEWG } });
    await drainAsync();
    const out = await emittedHandoff(ctx);                      // changed graph → must re-hand-off
    record("R3 round-trip graph change re-hands-off (no stale resume)",
      out.kind === "ga" && out.spec.appId === "app_ZZZ" && graphMarker(out.spec.graph) === "NEW",
      `kind=${out.kind} appId=${out.spec && out.spec.appId} marker=${graphMarker(out.spec && out.spec.graph)}`);
  }

  /* R4 (static): the editor's closeAppModal must not tear down the iframe, openAppModal must
     record the resume bookkeeping, openCreateApp must carry the same-graph fast-path, and the
     builder must pause its chrome media when hidden. Cheap source guards backing R1–R3. */
  {
    const close = extractFn(INDEX_SRC, "closeAppModal");
    const open = extractFn(INDEX_SRC, "openAppModal");
    const create = extractFn(INDEX_SRC, "openCreateApp");
    record("R4 closeAppModal keeps the iframe (no about:blank)", !/about:blank/.test(close), "closeAppModal must not blank src");
    record("R4 openAppModal records resume bookkeeping",
      /appFrameLoaded\s*=\s*true/.test(open) && /lastHandoffSig\s*=\s*appHandoffSig\(\)/.test(open),
      "openAppModal must set appFrameLoaded + lastHandoffSig");
    record("R4 openCreateApp has the same-graph resume fast-path",
      /appFrameLoaded\s*&&\s*appHandoffSig\(\)\s*===\s*lastHandoffSig/.test(create) && /return/.test(create),
      "openCreateApp must short-circuit on an unchanged graph");
    record("R4 play.html pauses chrome media when hidden",
      /__appmodalhidden__/.test(PLAY_SRC) && /querySelectorAll\((?:"|')audio,\s*video/.test(PLAY_SRC),
      "play.html must pause audio/video on __appmodalhidden__");
  }
}

run().then(() => {
  let bad = 0;
  console.log("\nCreate-app handoff state machine:\n");
  for (const r of results) {
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}` + (r.pass ? "" : `   [${r.detail}]`));
    if (!r.pass) bad++;
  }
  console.log("");
  if (bad) { console.error(`✗ ${bad} Create-app invariant(s) broken — clicking Create app may open/overwrite the wrong app.\n`); process.exit(1); }
  console.log("✓ Create-app routing holds: new stays new, updates stay targeted, bindings survive reload.\n");
}).catch((e) => {
  console.error("harness error:", e && e.stack ? e.stack : e);
  process.exit(2);
});
