#!/usr/bin/env node
// Drives the shipped editor and app builder in separate VM contexts. Check
// that requests select the correct app, saves bind only their source workspace,
// and the standalone player still accepts legacy links and OAuth resumes.

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
    /import\s*\{[^}]*\}\s*from\s*["'][^"']*patchling[^"']*["'];?/,
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

// These handoff cases model a healthy browser with an empty overflow database;
// their small fixtures remain in legacy localStorage. API absence is a recovery
// failure now, covered separately by check-workspaces and the real browser suite.
function emptyWorkspaceDatabase() {
  return {open() {
    const request={};
    queueMicrotask(()=>{
      request.result={close(){},transaction(){return {objectStore(){return {get(){
        const read={result:undefined};queueMicrotask(()=>read.onsuccess?.());return read;
      }}}};}};
      request.onsuccess?.();
    });
    return request;
  }};
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
    indexedDB:emptyWorkspaceDatabase(),
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
async function gzipBytes(str) {
  const stream = new Blob([new TextEncoder().encode(str)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function graphHash(graph) { return "#g=" + bytesToB64url(await gzipBytes(JSON.stringify(graph))); }
async function gaHash(spec) { return "#ga=" + bytesToB64url(await gzipBytes(JSON.stringify(spec))); }

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
const txt = (ctx, id) => el(ctx, id).textContent;
const graphMarker = (g) => (g && g.nodes && g.nodes[0] && g.nodes[0].fields && g.nodes[0].fields.text) || null;
function playStateGraph(store) { try { return JSON.parse(store["noodle_app_state"]).graph; } catch { return null; } }
function playAppShown(ctx) { return el(ctx, "empty").hidden === true; }

async function bootEditor(href, store, session) {
  const ctx = loadPage(INDEX_SRC, "index", { href, store, session });
  await ctx.__BOOT__; await drainAsync(); settleTimers(ctx); await drainAsync();
  return ctx;
}
async function bootPlay(href, store, session, opts) {
  const ctx = loadPage(PLAY_SRC, "play", { href, store, session, ...(opts || {}) });
  await ctx.__BOOT__; await drainAsync(); settleTimers(ctx); await drainAsync();
  return ctx;
}
// Drive the editor-side request boundary without loading the actual iframe.
function frameMessage(ctx, data){
  const source = el(ctx, "appmodalframe").contentWindow;
  for(const listener of ctx._listeners.message || []) listener({source, data});
}
async function emittedHandoff(ctx, buttonFn) {
  const frame = el(ctx, "appmodalframe");
  const posted = [];
  frame.contentWindow.postMessage = msg=>posted.push(msg);
  await (buttonFn ? buttonFn() : el(ctx, "makeapp").onclick());
  await drainAsync();
  if(String(frame.src)==="play.html?editor=1") frameMessage(ctx, {type:"__appready__"});
  const action = posted.find(msg=>msg.type==="__appaction__");
  if(!action) return {kind:"none"};
  const kind = action.kind==="open" ? "open" : action.appId ? "ga" : "g";
  return {kind, spec:action, graph:action.graph, live:true};
}
function fixtureApp(graph=OLDG, id="app_AAA", title="My App"){
  return { id, title, graph, files:FILES, versions:[{files:FILES}], curVer:0 };
}
function acknowledgeSave(ctx, action, store, appId, title, graph){
  const apps = JSON.parse(store.noodle_apps || "[]").filter(app=>app.id!==appId);
  store.noodle_apps = JSON.stringify([...apps, fixtureApp(graph, appId, title)]);
  frameMessage(ctx, {type:"__appactionresult__", serial:action.serial, ok:true, appId, title});
}

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail: pass ? "" : detail }); }

/* -------------------------------------------------------------------------- */
/* scenarios                                                                   */
/* -------------------------------------------------------------------------- */

async function run() {
  /* E1: #ga=<id> binds → "Update <name>", "Save as a new app" shown, Create app re-emits #ga=<id>, binding persisted */
  {
    const store = { noodle_apps:JSON.stringify([fixtureApp()]) }, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await gaHash({ v: 1, graph: APP_A, appId: "app_AAA", title: "My App" })), store, session);
    const workspace = txt(ctx, "wsapplabel"), share = txt(ctx, "makeapp"), newHidden = el(ctx, "newapp").hidden;
    const out = await emittedHandoff(ctx, () => el(ctx, "wsmakeapp").onclick());
    let persisted = null; try { persisted = JSON.parse(store.noodle_editor_app); } catch {}
    record("E1 #ga= binds and Update app targets the same app",
      workspace === "Update app" && share === "Update My App" && !newHidden && txt(ctx,"wsapplabel")==="Updating app…" &&
      out.kind === "ga" && out.spec.appId === "app_AAA" && (persisted && persisted.id === "app_AAA"),
      `workspace=${workspace} share=${share} newHidden=${newHidden} pending=${txt(ctx,"wsapplabel")} kind=${out.kind} appId=${out.spec && out.spec.appId} persisted=${persisted && persisted.id}`);
  }

  /* E2: binding SURVIVES a plain reload (no hash) → still updates, never duplicates [lost-on-reload bug] */
  {
    const store = { noodle_apps:JSON.stringify([fixtureApp()]) }, session = {};
    await bootEditor(ORIGIN + "/editor" + (await gaHash({ v: 1, graph: APP_A, appId: "app_AAA", title: "My App" })), store, session);
    const ctx2 = await bootEditor(ORIGIN + "/editor", store, session);   // reload: same store, NO hash
    const share = txt(ctx2, "makeapp");
    const out = await emittedHandoff(ctx2);
    record("E2 binding survives reload (no duplicate)",
      share === "Update My App" && out.kind === "ga" && out.spec.appId === "app_AAA",
      `btn=${share} kind=${out.kind} appId=${out.spec && out.spec.appId}`);
  }

  /* E3: fresh #g= → "Create app", no binding, no #ga= */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await graphHash(APP_B)), store, session);
    const share = txt(ctx, "makeapp");
    const out = await emittedHandoff(ctx);
    record("E3 fresh workflow → new app",
      share === "Create app" && txt(ctx,"wsapplabel")==="Creating app…" && el(ctx, "openapps").hidden === true && el(ctx, "newapp").hidden === true &&
      (out.kind === "g" || out.kind === "j") && !store.noodle_editor_app,
      `btn=${share} pending=${txt(ctx,"wsapplabel")} newHidden=${el(ctx, "newapp").hidden} kind=${out.kind} editorApp=${store.noodle_editor_app}`);
  }

  /* E4: a copy uses a new app ID while the current binding waits for a successful save. */
  {
    const store = { noodle_apps:JSON.stringify([fixtureApp()]) }, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await gaHash({ v: 1, graph: APP_A, appId: "app_AAA", title: "My App" })), store, session);
    const out = await emittedHandoff(ctx, () => el(ctx, "newapp").onclick());
    record("E4 Copy targets a new app and retains the previous binding while saving",
      out.spec?.kind==="copy" && !out.spec.appId && JSON.parse(store.noodle_editor_app).id==="app_AAA",
      `kind=${out.kind} editorApp=${store.noodle_editor_app} btn=${txt(ctx, "makeapp")}`);
  }

  /* E5a: __editflow__ from the correct source applies the graph AND binds the id */
  {
    const store = {noodle_apps:JSON.stringify([fixtureApp(OLDG,"app_ZZZ","Z")])}, session = {};
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
    const store = { noodle_apps:JSON.stringify([fixtureApp()]) }, session = {};
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

  /* E6: a successful copy binds the replacement and survives a reload. */
  {
    const store = {noodle_apps:JSON.stringify([fixtureApp()])}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await gaHash({v:1, graph:APP_A, appId:"app_AAA", title:"My App"})), store, session);
    const copy = await emittedHandoff(ctx, () => el(ctx, "newapp").onclick());
    acknowledgeSave(ctx, copy.spec, store, "app_NEW", "New app", ctx.serializeGraph());
    const restored = await bootEditor(ORIGIN + "/editor", store, session);
    const out = await emittedHandoff(restored);
    record("E6 Successful copy binds the new app on reload",
      out.kind==="open" && out.spec.appId==="app_NEW" && JSON.parse(store.noodle_apps).length===2,
      `action=${JSON.stringify(out)} binding=${store.noodle_editor_app}`);
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

  /* R0 (unit): appHandoffSig() is the CONTENT change-detector (demo-starter baseline +
     share-divergence warning). It MUST ignore canvas view (pan/zoom) and node
     positions/sizes — else a signed-out visitor who nudges a node loses the canned demo —
     and MUST flip on node type/fields, links, or the bound app id. Run the REAL function
     in isolation over hand-built graphs. */
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
    record("R0 appHandoffSig ignores pan/zoom + node positions (demo survives a nudge)",
      sig(moved) === b0, `moved sig ${sig(moved) === b0 ? "==" : "!="} base — view/x/y/w/sizes must be excluded`);
    record("R0 appHandoffSig flips on a field edit", sig(fieldEdit) !== b0, "model change must read as a change");
    record("R0 appHandoffSig flips on a node-type change", sig(typeEdit) !== b0, "type change must read as a change");
    record("R0 appHandoffSig flips on a link change", sig(linkEdit) !== b0, "new wire must read as a change");
    record("R0 appHandoffSig flips on a node rename", sig(nameEdit) !== b0, "custom name is the app's step label — must re-hand-off");
    record("R0 appHandoffSig ignores a whitespace-only name", sig(wsName) === b0, "blank name trims to '' — not an edit");
    record("R0 appHandoffSig flips on the bound app id", sig(base(), "app_X") !== b0, "pendingAppId must be folded in");

    /* R0b (unit): appSyncSig() gates the ✨ Open↔Update label + the re-handoff fast path.
       It MUST flip on node x/y/w — a rearranged canvas is an update the app hasn't received,
       and the fast path swallowing it loses the layout on the next Customize-workflow round
       trip (the "always says Open" bug) — and MUST ignore pan/zoom (camera) and n.sizes
       (stamped by a ResizeObserver on any reflow, so signing them flaps the label). */
    new vm.Script(extractFn(INDEX_SRC, "appSyncSig"), { filename: "appSyncSig" }).runInContext(sctx);
    const ssig = (graph, app = "") => { sctx.graph = graph; sctx.pendingAppId = app; return sctx.appSyncSig(); };
    const s0 = ssig(base());
    const nodeMoved = base(); nodeMoved.nodes[0].x = 999; nodeMoved.nodes[1].y = -42;
    const cardResized = base(); cardResized.nodes[0].w = 480;
    const cameraOnly = base(); cameraOnly.view = { panX: 800, panY: -300, scale: 2.5 };
    const taStretch = base(); taStretch.nodes[1].sizes = { 9: 9 };
    record("R0b appSyncSig flips on a node move (x/y)", ssig(nodeMoved) !== s0, "a dragged node is pending work — Open would lie and the fast path would drop the move");
    record("R0b appSyncSig flips on a card resize (w)", ssig(cardResized) !== s0, "a resized card is pending work");
    record("R0b appSyncSig ignores pan/zoom", ssig(cameraOnly) === s0, "the camera isn't the workflow — looking around must not flip the button");
    record("R0b appSyncSig ignores textarea sizes", ssig(taStretch) === s0, "n.sizes is ResizeObserver-stamped on any reflow — signing it flaps the label");
    record("R0b appSyncSig flips on a field edit (content flows through)", ssig(fieldEdit) !== s0, "content changes must reach the sync sig via appHandoffSig");
  }

  /* R1: reopening a saved, unchanged workflow asks for its exact app ID. */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await graphHash(APP_B)), store, session);
    const first = await emittedHandoff(ctx);
    acknowledgeSave(ctx, first.spec, store, "app_SAVED", "App", ctx.serializeGraph());
    const second = await emittedHandoff(ctx);
    record("R1 unchanged reopen selects the saved app by ID",
      first.kind==="g" && second.kind==="open" && second.spec.appId==="app_SAVED" && !second.graph,
      `first=${first.kind} second=${JSON.stringify(second)}`);
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
      opened==="play.html?editor=1" && closed === opened && !/about:blank/.test(closed) && el(ctx, "appmodal").hidden === true,
      `opened=${opened.slice(0, 18)} closed=${closed.slice(0, 18)} hidden=${el(ctx, "appmodal").hidden}`);
  }

  /* R3: edits send the current graph with the existing app identity. */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await graphHash(APP_B)), store, session);
    const first = await emittedHandoff(ctx);
    acknowledgeSave(ctx, first.spec, store, "app_SAVED", "App", ctx.serializeGraph());
    ctx.applyGraphData(NEWG);
    const out = await emittedHandoff(ctx);
    record("R3 edited workspace requests an update to its saved app",
      out.spec?.kind==="update" && out.spec.appId==="app_SAVED" && graphMarker(out.graph)==="NEW",
      `action=${JSON.stringify(out)}`);
  }

  /* ----------------------------------------------------------------------------
     LIVE HANDOFF + BIND-ON-CREATE (H*) — "Create app" must actually create (a durable
     "My apps" entry), the editor must find out (__appsaved__ → button flips to
     "✨ Update <name>"), and a LIVE builder must accept a changed graph over
     postMessage (__handoff__) since a fragment-only src write never reloads it.
     -------------------------------------------------------------------------- */

  /* H1: fresh #g= boot COMMITS (bind-on-create), and a null-appId __handoff__ into the
     live builder mints a SEPARATE new app (the "✨ New app" fork) + notifies the editor. */
  {
    const store = {}, session = {};
    const ctx = await bootPlay(ORIGIN + "/play" + (await graphHash(OLDG)), store, session, { parentIsSelf: false });
    const apps0 = JSON.parse(store.noodle_apps || "[]");
    const saved = [];
    ctx.parent.postMessage = (msg) => saved.push(msg);
    for (const fn of (ctx._listeners.message || [])) fn({ source: ctx.parent, data: { type: "__handoff__", graph: NEWG, appId: null } });
    await drainAsync(); settleTimers(ctx); await drainAsync();
    const apps = JSON.parse(store.noodle_apps || "[]");
    const note = saved.find((m) => m && m.type === "__appsaved__");
    record("H1 fresh handoffs commit — Create creates; null-id __handoff__ mints a NEW app + __appsaved__",
      apps0.length === 1 && apps.length === 2 && graphMarker(playStateGraph(store)) === "NEW" &&
      note && note.appId && note.appId !== apps0[0].id,
      `bootApps=${apps0.length} apps=${apps.length} marker=${graphMarker(playStateGraph(store))} appsaved=${JSON.stringify(note)}`);
  }

  /* H2: a bound __handoff__ (appId set) re-targets THAT app in place — same id, new graph,
     no duplicate entry. This is the within-session "edit graph → reopen modal" fix. */
  {
    const store = {}, session = {};
    const ctx = await bootPlay(ORIGIN + "/play" + (await graphHash(OLDG)), store, session, { parentIsSelf: false });
    const apps0 = JSON.parse(store.noodle_apps || "[]");
    const id = apps0[0] && apps0[0].id;
    for (const fn of (ctx._listeners.message || [])) fn({ source: ctx.parent, data: { type: "__handoff__", graph: NEWG, appId: id } });
    await drainAsync(); settleTimers(ctx); await drainAsync();
    const apps = JSON.parse(store.noodle_apps || "[]");
    record("H2 bound __handoff__ updates the app in place (no duplicate)",
      apps0.length === 1 && apps.length === 1 && apps[0].id === id && graphMarker(apps[0].graph) === "NEW",
      `bootApps=${apps0.length} apps=${apps.length} id=${apps[0] && apps[0].id}→${id} marker=${graphMarker(apps[0] && apps[0].graph)}`);
  }

  /* H3: only the matching successful result promotes the workspace to Open app. */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await graphHash(APP_B)), store, session);
    const first = await emittedHandoff(ctx);
    frameMessage(ctx, {type:"__appactionresult__", serial:first.spec.serial+1, ok:true, appId:"wrong"});
    const ignored = !store.noodle_editor_app;
    acknowledgeSave(ctx, first.spec, store, "app_NEW1", "Neon Ramen", ctx.serializeGraph());
    const persisted = JSON.parse(store.noodle_editor_app);
    const workspace = txt(ctx,"wsapplabel"), share = txt(ctx,"makeapp");
    const second = await emittedHandoff(ctx);
    record("H3 matching result binds and labels both app actions",
      ignored && workspace==="Open app" && share==="Open Neon Ramen" && txt(ctx,"wsapplabel")==="Opening app…" && persisted.id==="app_NEW1" && second.kind==="open",
      `workspace=${workspace} share=${share} pending=${txt(ctx,"wsapplabel")} persisted=${persisted.id} second=${second.kind}`);
  }

  /* H4: __editflow__ must leave the replaced canvas ONE undo away (it used to destroy an
     unbound in-progress noodle unrecoverably). */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await graphHash(APP_B)), store, session);
    const undoBefore = el(ctx, "undo").disabled;                // nothing to undo yet
    const src = el(ctx, "appmodalframe").contentWindow;
    for (const fn of (ctx._listeners.message || [])) fn({ source: src, data: { type: "__editflow__", appId: "app_Z", title: "Z", graph: NEWG } });
    await drainAsync();
    record("H4 __editflow__ pushes an undo snapshot (old canvas recoverable)",
      undoBefore === true && el(ctx, "undo").disabled === false,
      `undoBefore=${undoBefore} undoAfter=${el(ctx, "undo").disabled}`);
  }

  /* H5: a #ga= boot with an existing noodle_graph opens the handoff in a NEW workspace.
     The previous graph bytes move to that workspace's own key, untouched. Undo stays
     idle — the old workflow is the other tab, not an undo snapshot. */
  {
    const oldJson = JSON.stringify(OLDG);
    const store = { noodle_graph: oldJson }, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await gaHash({ v: 1, graph: NEWG, appId: "app_AAA", title: "My App" })), store, session);
    const undoIdle = el(ctx, "undo").disabled === true;
    const overwrote = graphMarker(JSON.parse(store.noodle_graph)) === "NEW";
    const shelved = Object.entries(store).filter(([k]) => k.startsWith("noodle_ws_")).map(([, v]) => v);
    let idx = null;
    try { idx = JSON.parse(store.noodle_workspaces); } catch {}
    const active = idx && idx.tabs && idx.tabs.find((t) => t.id === idx.active);
    record("H5 #ga= boot opens a new workspace and keeps the previous graph byte-for-byte",
      undoIdle && overwrote && shelved.includes(oldJson) && idx && idx.tabs.length === 2 && active && active.app && active.app.id === "app_AAA",
      `undoIdle=${undoIdle} overwrote=${overwrote} shelved=${shelved.includes(oldJson)} tabs=${idx && idx.tabs && idx.tabs.length} app=${active && active.app && active.app.id}`);
  }

  /* H6: queue a single request while booting and bind a closed-preview save to the origin. */
  {
    const store = {}, session = {};
    const ctx = await bootEditor(ORIGIN + "/editor" + (await graphHash(APP_B)), store, session);
    const frame = el(ctx, "appmodalframe");
    const posted = [];
    frame.contentWindow.postMessage = m=>posted.push(m);
    await el(ctx, "makeapp").onclick();
    await el(ctx, "wsmakeapp").onclick();
    const firstLoad = frame.src==="play.html?editor=1";
    const postedEarly = posted.filter(m=>m.type==="__appaction__").length;
    const original = ctx.readWorkspaces().active;
    el(ctx, "appmodalclose").onclick();
    ctx.openWorkspaceWithGraph(NEWG, "Other workspace");
    frameMessage(ctx, {type:"__appready__"});
    frameMessage(ctx, {type:"__appready__"});
    const requests = posted.filter(m=>m.type==="__appaction__");
    const action = requests[0];
    acknowledgeSave(ctx, action, store, "app_BACKGROUND", "Saved app", action.graph);
    const current = ctx.readWorkspaces();
    record("H6 single request boots and save binds only its original workspace",
      firstLoad && postedEarly===0 && requests.length===1 && graphMarker(action.graph)==="BBB"
      && current.active!==original && !store.noodle_editor_app && current.tabs.find(tab=>tab.id===original)?.app?.id==="app_BACKGROUND",
      `firstLoad=${firstLoad} early=${postedEarly} current=${JSON.stringify(current)}`);
  }

  /* H7: opening an UNRELATED app from the builder's "My apps" drawer must NOT post
     __appsaved__ — its graph was never on the canvas, so binding the editor to it would
     make the next "Update" overwrite that app's workflow with the canvas graph. */
  {
    const store = {}, session = {};
    const ctx = await bootPlay(ORIGIN + "/play" + (await graphHash(OLDG)), store, session, { parentIsSelf: false });
    // a second, unrelated app already in the library (made in some earlier session)
    const apps = JSON.parse(store.noodle_apps || "[]");
    apps.unshift({ id: "app_OTHER", title: "Other", graph: APP_B, files: FILES, versions: [{ files: FILES }], curVer: 0 });
    store.noodle_apps = JSON.stringify(apps);
    const saved = [];
    ctx.parent.postMessage = (msg) => saved.push(msg);
    ctx.openApp("app_OTHER");                                        // browse it in the drawer
    await drainAsync(); settleTimers(ctx); await drainAsync();
    ctx.commit();                                                    // e.g. a rename of the browsed app
    await drainAsync();
    const notes = saved.filter((m) => m && m.type === "__appsaved__");
    record("H7 drawer browsing never rebinds the editor (no __appsaved__ for foreign apps)",
      graphMarker(playStateGraph(store)) === "BBB" && notes.length === 0,
      `opened=${graphMarker(playStateGraph(store))} appsavedPosts=${JSON.stringify(notes)}`);
  }

  {
    const close = extractFn(INDEX_SRC, "closeAppModal");
    record("R4 dismissing preserves the builder and pauses media",
      !/about:blank/.test(close) && close.includes("__appmodalhidden__")
      && /querySelectorAll\((?:"|')audio,\s*video/.test(PLAY_SRC),
      "The editor should keep the iframe and pause hidden builder media.");
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
