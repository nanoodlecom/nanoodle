#!/usr/bin/env node
// Behavioural test for graph persistence & share-payload integrity in index.html.
//
// The editor's whole memory of "your workflow" is one JSON blob: serializeGraph()
// writes it (to localStorage, to a downloaded file, and packed into a #g=/#a= share
// link) and applyGraphData() reads it back on reload, on a shared link, and on undo.
// If that round-trip drops a node prop, mis-migrates a legacy graph, clobbers the
// autosave on a bad payload, or corrupts a >64KB packed link, the user silently loses
// work they can't get back. None of that is catchable without exercising the real code,
// so we lift the SHIPPED functions out of index.html as text and run them in node:vm
// against DOM stubs — the check breaks the moment the persistence code drifts.
//
// 100% offline: no browser, no network, no API keys. DOM/UI touchpoints are stubbed.
//
// Invariants pinned:
//   1. Round-trip idempotence — applyGraphData(serializeGraph()) reproduces the same
//      modern multi-node graph (node whitelist id,type,x,y,fields,w,sizes,name; links; view).
//   2. Legacy migrations — audio→tts alias; unknown type skipped (no throw); dangling
//      links pruned; music/tts header "text" port → inline "prompt"; nid/lid counters
//      rebuilt above the max existing id (a node added after load can't collide).
//   3. Autosave-wipe protection — a throwing/malformed payload must NOT leave the stored
//      'noodle_graph' overwritten by the empty graph applyGraphData resets to on entry.
//   4. Packing round-trip — a >64KB media-bearing graph survives gzip+bytesToB64url and
//      back byte-exact (the 0x8000 chunking path), and the uncompressed #j= fallback
//      decodes when CompressionStream is absent.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "index.html"), "utf8");

const failures = [];
const fail = (m) => failures.push(m);
const ok = (c, m) => { if (!c) fail(m); };

/* ---- string/template/comment-aware `{ … }` matcher (from check-share-link) ---- */
function matchBrace(src, openIdx) {
  let depth = 0; const tmpl = []; let mode = "code";
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

// pull `[async] function <name>(…) { … }` out as text (keeps the async keyword).
function extractFn(src, name) {
  const re = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) throw new Error(`function ${name}() not found in index.html`);
  const open = src.indexOf("{", m.index);
  return src.slice(m.index, matchBrace(src, open) + 1);
}

// pull a single top-level `const NAME = … ;` line out as text.
function extractConst(src, name) {
  const re = new RegExp("const " + name + " = [^\\n]*;");
  const m = re.exec(src);
  if (!m) throw new Error(`const ${name} not found in index.html`);
  return m[0];
}

// the real set of NODE_TYPES keys (so "unknown type skipped" reflects the shipped registry).
function nodeTypeKeys(src) {
  const start = src.indexOf("const NODE_TYPES = {");
  if (start === -1) throw new Error("NODE_TYPES registry not found");
  const open = src.indexOf("{", start);
  let depth = 0; const tmpl = []; let mode = "code"; const keys = new Set();
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i++; }
      else if (c === "/" && n === "*") { mode = "block"; i++; }
      else if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (tmpl.length && depth === tmpl[tmpl.length - 1]) { tmpl.pop(); mode = "tpl"; } else if (depth === 0) break; }
      else if (depth === 1) { const m = src.slice(i).match(/^\n\s*(\w+):\s*\{/); if (m) keys.add(m[1]); }
    } else if (mode === "line") { if (c === "\n") mode = "code"; }
    else if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i++; } }
    else if (mode === "sq") { if (c === "\\") i++; else if (c === "'") mode = "code"; }
    else if (mode === "dq") { if (c === "\\") i++; else if (c === '"') mode = "code"; }
    else if (mode === "tpl") { if (c === "\\") i++; else if (c === "`") mode = "code"; else if (c === "$" && n === "{") { mode = "code"; tmpl.push(depth); depth++; i++; } }
  }
  return keys;
}

// ---- assemble the shipped persistence code into one runnable bundle ----------
const TYPE_KEYS = nodeTypeKeys(SRC);
// sanity: a broken extraction (empty / missing core types) must fail loudly, not silently pass
ok(TYPE_KEYS.size >= 20, `NODE_TYPES extraction looks broken (only ${TYPE_KEYS.size} keys)`);
for (const t of ["text", "llm", "music", "tts", "image"])
  ok(TYPE_KEYS.has(t), `NODE_TYPES extraction missing core type "${t}"`);
if (failures.length) { emit(); process.exit(1); }

const bundle = [
  extractConst(SRC, "UPLOAD_FIELD"),
  extractConst(SRC, "SAFE_MEDIA_RE"),
  extractFn(SRC, "serializeGraph"),
  extractFn(SRC, "shareableGraph"),
  extractFn(SRC, "stripInjectedMedia"),
  extractFn(SRC, "applyGraphData"),
  "let saveT=null;",
  extractFn(SRC, "save"),
  extractFn(SRC, "load"),
  extractFn(SRC, "loadFromHash"),
  extractFn(SRC, "bytesToB64url"),
  extractFn(SRC, "b64urlToBytes"),
  extractFn(SRC, "gzip"),
  extractFn(SRC, "gunzip"),
  extractFn(SRC, "buildShareUrl"),
  "const byId = (id)=> graph.nodes.find(n=>n.id===id);",
  ";globalThis.__P = { serializeGraph, applyGraphData, save, load, loadFromHash, " +
    "bytesToB64url, b64urlToBytes, gzip, gunzip, buildShareUrl, shareableGraph };",
].join("\n");

// ---- a context: real primitives, stubbed DOM/UI, a Map-backed localStorage ----
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const NODE_TYPES = {};
for (const k of TYPE_KEYS) NODE_TYPES[k] = {};

const ctx = {
  console, JSON, Math, parseInt, String, Object, Set, Array, Uint8Array, Error,
  TextEncoder, TextDecoder, Blob, Response,
  CompressionStream, DecompressionStream, btoa, atob,
  NODE_TYPES, localStorage,
  // graph state (applyGraphData reassigns graph/nid/lid/selected as free vars → ctx props)
  graph: { nodes: [], links: [] }, nid: 1, lid: 1, selected: null,
  panX: 0, panY: 0, scale: 1,
  undoStack: [],
  location: { origin: "https://nanoodle.example", pathname: "/", search: "", hash: "" },
  history: { replaceState() {} },
  window: { resetDescribeVersions() {} },
  pendingAppId: null,
  // DOM / UI touchpoints — no-ops (persistence logic doesn't depend on their effects)
  world: { innerHTML: "", style: { transform: "", setProperty() {} } },
  applyWorld() {}, buildNodeEl() {}, redraw() {}, refreshPortFills() {}, refreshAllPrices() {},
  recompactImageLinks() {}, refreshImageInputs() {}, recompactVideoLinks() {}, refreshVideoInputs() {},
  refreshRunEstimate() {}, syncUndoBtn() {}, flash() {}, toast() {}, appHandoffSig() { return ""; },
  t: (s) => s,
  // save() debounces via setTimeout(…,250); run it synchronously so the write lands before we assert
  setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {},
  setPendingApp(id) { ctx.pendingAppId = id || null; },
};
vm.createContext(ctx);
new vm.Script(bundle, { filename: "index.html#graph-persistence" }).runInContext(ctx);
const P = ctx.__P;

// keep only the persisted node-identity props serializeGraph is contracted to preserve
const WL = ["id", "type", "x", "y", "fields", "w", "sizes", "name"];
const pickNodes = (g) => (g.nodes || []).map((n) => { const o = {}; for (const k of WL) if (k in n) o[k] = n[k]; return o; });
const norm = (g) => JSON.stringify({ nodes: pickNodes(g), links: g.links, view: g.view });

// ===========================================================================
// 1) ROUND-TRIP IDEMPOTENCE
// ===========================================================================
{
  const data1 = {
    v: 1,
    nodes: [
      { id: "n1", type: "text", x: 10, y: 20, fields: { text: "hello" }, w: 200, sizes: {} },
      { id: "n2", type: "llm", x: 100, y: 50, fields: { model: "glm-5.2", prompt: "", system: "be brief" }, w: 260, sizes: { a: 1 }, name: "My LLM" },
      { id: "n3", type: "image", x: 300, y: 80, fields: { model: "nano-banana", prompt: "a cat" }, w: 240, sizes: {} },
    ],
    // two links (distinct order) so the round-trip pins link *ordering*, not just contents —
    // serializeGraph passes graph.links through as-is and applyGraphData's filter is stable,
    // so a reorder is a real regression a single-link fixture can't see.
    links: [
      { id: "l1", from: { node: "n1", port: "text" }, to: { node: "n2", port: "prompt" } },
      { id: "l2", from: { node: "n3", port: "image" }, to: { node: "n2", port: "image" } },
    ],
    nid: 4, lid: 3, view: { panX: 5, panY: 6, scale: 1.5 },
  };
  ctx.graph = { nodes: [], links: [] };
  P.applyGraphData(data1);
  const s2 = P.serializeGraph();
  // first load must preserve the modern graph verbatim (no dropped node/link/view data)
  ok(norm(data1) === norm(s2), "round-trip 1: serializeGraph(applyGraphData(g)) dropped node/link/view data\n    in : " + norm(data1) + "\n    out: " + norm(s2));
  // and it must be stable: applying the serialized form again reproduces it exactly
  P.applyGraphData(s2);
  const s3 = P.serializeGraph();
  ok(norm(s2) === norm(s3), "round-trip 2: not idempotent on the second cycle\n    a: " + norm(s2) + "\n    b: " + norm(s3));
  // n.out is intentionally dropped from the serialized form
  ok(!("out" in (s2.nodes[0] || {})), "serializeGraph must not persist n.out (runtime output)");
}

// ===========================================================================
// 2) LEGACY MIGRATIONS
// ===========================================================================
{
  const legacy = {
    nodes: [
      { id: "n2", type: "audio", x: 0, y: 0, fields: { text: "sing" } },   // ALIAS audio→tts
      { id: "n5", type: "bogusType", x: 0, y: 0, fields: {} },             // unknown → skipped
      { id: "n7", type: "music", x: 0, y: 0, fields: {} },                 // music: header text→prompt
      { id: "n1", type: "text", x: 0, y: 0, fields: { text: "hi" } },
    ],
    links: [
      { id: "l1", from: { node: "n1", port: "text" }, to: { node: "n7", port: "text" } }, // music text→prompt
      { id: "l2", from: { node: "n1", port: "text" }, to: { node: "n2", port: "text" } }, // tts text→prompt
      { id: "l3", from: { node: "n1", port: "text" }, to: { node: "n5", port: "in" } },   // dangling (n5 gone)
      { id: "l9", from: { node: "n1", port: "text" }, to: { node: "n1", port: "x" } },    // both survive → keep
    ],
    nid: 0, lid: 0,
  };
  ctx.graph = { nodes: [], links: [] };
  P.applyGraphData(legacy);
  const g = ctx.graph;
  const byId = (id) => g.nodes.find((n) => n.id === id);

  ok(g.nodes.length === 3, `unknown type not skipped (expected 3 nodes, got ${g.nodes.length})`);
  ok(!byId("n5"), "unknown NODE_TYPE (bogusType) should be skipped, not loaded");
  ok(byId("n2") && byId("n2").type === "tts", "legacy 'audio' node must be aliased to 'tts'");
  ok(!g.links.some((l) => l.id === "l3"), "dangling link (to a skipped node) must be pruned");
  ok(g.links.length === 3, `expected 3 surviving links, got ${g.links.length}`);
  const l1 = g.links.find((l) => l.id === "l1"), l2 = g.links.find((l) => l.id === "l2");
  ok(l1 && l1.to.port === "prompt", "music node's header 'text' link must migrate to the 'prompt' port");
  ok(l2 && l2.to.port === "prompt", "tts (ex-audio) node's 'text' link must migrate to the 'prompt' port");
  // counters must clear the highest EXISTING id so a fresh node/link can't collide
  ok(ctx.nid === 8, `nid must rebuild above max node id (n7 → expected 8, got ${ctx.nid})`);
  ok(ctx.lid === 10, `lid must rebuild above max link id (l9 → expected 10, got ${ctx.lid})`);
}

// ===========================================================================
// 3) AUTOSAVE-WIPE PROTECTION
//    A throwing payload resets graph to empty at applyGraphData's first line; the
//    caller (loadFromHash) must NOT let save() persist that empty graph over the
//    good autosave. Protection = applyGraphData is inside try, save() only on success.
// ===========================================================================
{
  const good = { v: 1, nodes: [{ id: "n1", type: "text", x: 0, y: 0, fields: { text: "keep me" }, w: 200, sizes: {} }], links: [], nid: 2, lid: 1 };
  const goodJson = JSON.stringify(good);
  const b64 = (s) => P.bytesToB64url(new TextEncoder().encode(s));

  // negative: a malformed payload (nodes:5 → for-of throws after graph is wiped)
  store.clear(); store.set("noodle_graph", goodJson);
  ctx.location.hash = "#j=" + b64(JSON.stringify({ nodes: 5 }));
  let ret;
  try { ret = await P.loadFromHash(); } catch (e) { fail("loadFromHash threw instead of returning false on a bad payload: " + e.message); ret = null; }
  ok(ret === false, "loadFromHash must report failure (false) on a malformed payload");
  ok(store.get("noodle_graph") === goodJson, "AUTOSAVE WIPE: a malformed share link overwrote the saved graph with an empty/partial one");

  // positive control: a WELL-FORMED payload DOES run save() (proves the negative test can catch a regression)
  const fresh = { v: 1, nodes: [{ id: "n1", type: "text", x: 1, y: 2, fields: { text: "new" }, w: 200, sizes: {} }, { id: "n2", type: "llm", x: 3, y: 4, fields: {}, w: 260, sizes: {} }], links: [], nid: 3, lid: 1 };
  store.clear(); store.set("noodle_graph", goodJson);
  ctx.location.hash = "#j=" + b64(JSON.stringify(fresh));
  const ret2 = await P.loadFromHash();
  ok(ret2 === true, "loadFromHash must succeed on a valid #j= payload");
  const saved = store.get("noodle_graph");
  ok(saved && saved !== goodJson, "a valid share link must autosave the new graph (save() should have run)");
  try { ok(saved && JSON.parse(saved).nodes.length === 2, "the autosaved graph must be the newly-applied one (2 nodes)"); } catch (_) { fail("autosaved graph is not valid JSON after a share link"); }
}

// ===========================================================================
// 4) PACKING ROUND-TRIP (compressed #g= + uncompressed #j= fallback)
// ===========================================================================
{
  // direct primitive check: >64KB byte array survives the 0x8000-chunked base64 round-trip byte-exact
  const N = 100003;
  const arr = new Uint8Array(N);
  for (let i = 0; i < N; i++) arr[i] = (i * 37 + 11) & 0xff;
  const back = P.b64urlToBytes(P.bytesToB64url(arr));
  let byteExact = back.length === N;
  for (let i = 0; byteExact && i < N; i++) if (back[i] !== arr[i]) byteExact = false;
  ok(byteExact, "bytesToB64url/b64urlToBytes corrupted a >64KB byte array (0x8000 chunk boundary)");

  // a media-bearing graph big enough to exceed 64KB (text field is NOT blanked by shareableGraph)
  const big = "x".repeat(70000);
  ctx.graph = {
    nodes: [
      { id: "n1", type: "text", x: 0, y: 0, fields: { text: big }, w: 200, sizes: {} },
      { id: "n2", type: "upload", x: 0, y: 0, fields: { image: "data:image/png;base64,AAAA" }, w: 200, sizes: {} },
    ],
    links: [],
  };
  ctx.nid = 3; ctx.lid = 1; ctx.pendingAppId = null;
  const want = JSON.stringify(P.shareableGraph());        // exactly what buildShareUrl packs
  ok(want.length > 65536, "fixture is not >64KB — chunking path not exercised");

  // (a) CompressionStream present → #g= (gzipped); decode via gunzip must byte-match
  ctx.CompressionStream = CompressionStream;
  const urlG = await P.buildShareUrl();
  ok(urlG.includes("#g="), "with CompressionStream present, buildShareUrl should emit a gzipped #g= link, got: " + urlG.slice(0, 40));
  const payloadG = urlG.split("#g=")[1];
  const jsonG = await P.gunzip(P.b64urlToBytes(payloadG));
  ok(jsonG === want, "compressed #g= share link did not round-trip byte-exact through gzip/gunzip");

  // (b) CompressionStream absent → gzip() returns null → #j= (uncompressed) fallback
  ctx.CompressionStream = undefined;
  const urlJ = await P.buildShareUrl();
  ok(urlJ.includes("#j="), "with CompressionStream absent, buildShareUrl should fall back to an uncompressed #j= link, got: " + urlJ.slice(0, 40));
  const payloadJ = urlJ.split("#j=")[1];
  const jsonJ = new TextDecoder().decode(P.b64urlToBytes(payloadJ));
  ok(jsonJ === want, "uncompressed #j= fallback did not decode back to the original graph");
  ctx.CompressionStream = CompressionStream;
}

function emit() {
  if (failures.length) process.stderr.write("✗ graph persistence / share-payload integrity broke:\n\n- " + failures.join("\n- ") + "\n");
}
if (failures.length) { emit(); process.exit(1); }
process.stdout.write("✓ graph persistence holds: round-trip idempotent, legacy migrations intact, autosave protected on bad payloads, >64KB pack round-trips (gzip + #j= fallback).\n");
