#!/usr/bin/env node
// Workspaces: each tab is its own autosaved graph. noodle_graph stays the ACTIVE
// tab in the pre-workspace JSON shape, so a returning visitor's graph becomes
// tab 1 without a rewrite. Inactive tabs live under noodle_ws_<id>.
//
// This lifts the shipped helpers out of index.html and runs them in node:vm.
// A second vm with the same storage backing is a reload.
//
// Offline. No browser, no network, no API key.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "index.html"), "utf8");
const FIXTURE_PATH = join(ROOT, "scripts/fixtures/legacy-noodle-graph.json");
const FIXTURE = readFileSync(FIXTURE_PATH, "utf8").replace(/\n$/, "");
JSON.parse(FIXTURE); // the fixture itself must be the old serializeGraph shape

const failures = [];
const fail = (m) => failures.push(m);
const ok = (c, m) => { if (!c) fail(m); };

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
function extractFn(src, name) {
  const re = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) throw new Error(`function ${name}() not found in index.html`);
  const open = src.indexOf("{", m.index);
  return src.slice(m.index, matchBrace(src, open) + 1);
}
function extractConst(src, name) {
  const re = new RegExp("const " + name + " = [^\\n]*;");
  const m = re.exec(src);
  if (!m) throw new Error(`const ${name} not found`);
  return m[0];
}
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

const begin = SRC.indexOf("const WS_INDEX_KEY = \"noodle_workspaces\";");
const end = SRC.indexOf("/* WORKSPACES-END */");
if (begin < 0 || end < begin) {
  console.error("✗ workspace block markers not found in index.html");
  process.exit(1);
}
const wsBlock = SRC.slice(begin, end);

const TYPE_KEYS = nodeTypeKeys(SRC);
if (TYPE_KEYS.size < 20 || !TYPE_KEYS.has("text") || !TYPE_KEYS.has("image") || !TYPE_KEYS.has("llm") || !TYPE_KEYS.has("upload")) {
  console.error("✗ NODE_TYPES extraction looks broken (" + TYPE_KEYS.size + " keys)");
  process.exit(1);
}
const NODE_TYPES = {};
for (const k of TYPE_KEYS) NODE_TYPES[k] = {};

const backing = {};
const localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
  setItem: (k, v) => { backing[k] = String(v); },
  removeItem: (k) => { delete backing[k]; },
};
function clearStore() { for (const k of Object.keys(backing)) delete backing[k]; }

const prelude = `
  var panX = 0, panY = 0, scale = 1, selected = null, nid = 1, lid = 1;
  var graph = { nodes: [], links: [] };
  var world = { innerHTML: "" };
  var saveT = null;
  var undoMuted = false;
  var pendingAppId = null, pendingAppTitle = null;
  var undoStack = [], redoStack = [];
  var runningNodes = new Set();
  var location = { origin: "https://nanoodle.example", pathname: "/", search: "", hash: "" };
  var history = { replaceState() {} };
  var window = { resetDescribeVersions() {}, innerWidth: 1280 };
  function buildNodeEl() {}
  function showResult() {}
  function setStatus() {}
  function redraw() {}
  function refreshPortFills() {}
  function refreshAllPrices() {}
  function recompactImageLinks() {}
  function refreshImageInputs() {}
  function recompactVideoLinks() {}
  function refreshVideoInputs() {}
  function recompactRefLinks() {}
  function refreshRefInputs() {}
  function updateNodePrice() {}
  function applyWorld() {}
  function refreshRunEstimate() {}
  function refreshPromptCaps() {}
  function refreshAppButton() { return false; }
  function layoutBar() {}
  function updateTitle() {}
  function syncUndoBtn() {}
  function flash() {}
  var __toasts = [];
  function toast(m) { __toasts.push(String(m)); }
  function t(s) { return s; }
  function fitView() { globalThis.__fitted = (globalThis.__fitted || 0) + 1; }
  var __confirm = true;
  function confirm() { return __confirm; }
  function clearTimeout() {}
  function setTimeout(fn) { fn(); return 0; }
  const byId = (id) => graph.nodes.find(n => n.id === id);
`;

const bundle = [
  prelude,
  extractConst(SRC, "UPLOAD_FIELD"),
  extractConst(SRC, "SAFE_MEDIA_RE"),
  extractConst(SRC, "EDITOR_APP_KEY"),
  extractFn(SRC, "serializeGraph"),
  extractFn(SRC, "stripInjectedMedia"),
  extractFn(SRC, "applyGraphData"),
  extractFn(SRC, "_stashResults"),
  extractFn(SRC, "save"),
  extractFn(SRC, "load"),
  extractFn(SRC, "setPendingApp"),
  wsBlock,
  extractFn(SRC, "loadFromHash"),
  extractFn(SRC, "b64urlToBytes"),
  "globalThis.__W = { ensureWorkspaces, load, save, loadFromHash, serializeGraph, applyGraphData,",
  "  openWorkspaceWithGraph, openExampleWorkspace, switchWorkspace, closeWorkspace, renameWorkspace,",
  "  textToImageGraph, askModelGraph, blankGraph,",
  "  readWorkspaces, shelvePreviousWorkspace, workspaceLabelForGraph, workspaceDownloadName, onWorkspaceHash, graph, ",
  "  stacks: () => ({ undo: undoStack.slice(), redo: redoStack.slice() }),",
  "  toasts: () => __toasts.slice(),",
  "  setConfirm: (v) => { __confirm = v; },",
  "  setHash: (h) => { location.hash = h; },",
  "  setOut: (id, out) => { const n = graph.nodes.find(x => x.id === id); if (n) n.out = out; },",
  "  outOf: (id) => { const n = graph.nodes.find(x => x.id === id); return n && n.out; },",
  "};",
].join("\n");

function boot(extra) {
  const ctx = {
    console, JSON, Math, parseInt, String, Object, Set, Map, Array, Uint8Array, Error, Date,
    TextEncoder, TextDecoder, Blob, btoa, atob,
    NODE_TYPES, localStorage,
    ...extra,
  };
  vm.createContext(ctx);
  new vm.Script(bundle, { filename: "index.html#workspaces" }).runInContext(ctx);
  return ctx.__W;
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const textOf = (g) => {
  const n = (g.nodes || []).find((x) => x.type === "text");
  return n && n.fields && n.fields.text;
};
const photoOf = (g) => {
  const n = (g.nodes || []).find((x) => x.id === "n2" && x.type === "upload");
  return n && n.fields && n.fields.image;
};

// ---------------------------------------------------------------------------
// 1. Migration: a pre-workspace noodle_graph becomes tab 1, bytes untouched.
// ---------------------------------------------------------------------------
{
  clearStore();
  backing.noodle_graph = FIXTURE;
  const W = boot();
  const idx = W.ensureWorkspaces();
  ok(backing.noodle_graph === FIXTURE, "migration must not rewrite noodle_graph");
  ok(!Object.keys(backing).some((k) => k.startsWith("noodle_ws_")), "migration must not copy the active graph into a noodle_ws_ key");
  ok(idx && idx.tabs.length === 1 && idx.active === "w1", "migration creates a single active tab");
  ok(idx.tabs[0].name === "Night desk", `tab 1 should take the graph's node name, got ${idx.tabs[0] && idx.tabs[0].name}`);
  ok(W.load() === true, "load() of the legacy graph must succeed");
  ok(backing.noodle_graph === FIXTURE, "load() must not rewrite noodle_graph either");
  ok(textOf(W.serializeGraph()) === textOf(JSON.parse(FIXTURE)), "the loaded graph is the legacy workflow");
  ok(photoOf(W.serializeGraph()) === photoOf(JSON.parse(FIXTURE)), "an uploaded data: image survives the migration load");
}

// ---------------------------------------------------------------------------
// 2. Create, switch, reload. The other tab keeps the legacy workflow.
// ---------------------------------------------------------------------------
{
  clearStore();
  backing.noodle_graph = FIXTURE;
  const W = boot();
  W.ensureWorkspaces();
  W.load();
  W.setOut("n1", { text: "PAID" });
  const opened = W.openWorkspaceWithGraph(W.textToImageGraph(), "Text to image", { respectCap: true, fit: true });
  ok(opened === true, "opening text-to-image over a non-empty graph must succeed");
  const idx = W.readWorkspaces();
  ok(idx.tabs.length === 2, `expected 2 tabs after creating one, got ${idx.tabs.length}`);
  ok(idx.active !== "w1", "the new starter must be the active tab");
  const live = W.serializeGraph();
  const img = (live.nodes || []).find((n) => n.type === "image");
  const link = (live.links || [])[0];
  ok(img && img.fields.model === "meta/muse-image/text-to-image", "text-to-image pins Muse, not whatever the catalog calls newest");
  ok(link && link.from.port === "text" && link.to.port === "prompt" && link.to.node === img.id, "text-to-image wires the prompt into the image node");
  const shelved = backing.noodle_ws_w1;
  ok(shelved && textOf(JSON.parse(shelved)) === textOf(JSON.parse(FIXTURE)), "the previous workflow is stored on its own key");
  ok(photoOf(JSON.parse(shelved)) === photoOf(JSON.parse(FIXTURE)), "the shelved tab keeps the uploaded photo");
  W.switchWorkspace("w1");
  ok(W.readWorkspaces().active === "w1", "switchWorkspace changes the active id");
  ok(textOf(W.serializeGraph()) === textOf(JSON.parse(FIXTURE)), "switching back shows the original workflow");
  ok(W.outOf("n1") && W.outOf("n1").text === "PAID", "switching back restores in-memory paid results");
  const t2iKey = Object.keys(backing).find((k) => k.startsWith("noodle_ws_") && k !== "noodle_ws_w1");
  ok(t2iKey && JSON.parse(backing[t2iKey]).nodes.some((n) => n.type === "image"), "the text-to-image graph is kept on the inactive tab");

  // Reload: a fresh vm, same storage. The active tab's graph is noodle_graph.
  const savedActive = backing.noodle_graph;
  const W2 = boot();
  W2.ensureWorkspaces();
  ok(W2.load() === true, "reload load() must succeed");
  ok(backing.noodle_graph === savedActive, "reload must not rewrite noodle_graph on load");
  ok(W2.readWorkspaces().active === "w1", "reload keeps the active tab");
  ok(textOf(W2.serializeGraph()) === textOf(JSON.parse(FIXTURE)), "reload shows the tab that was active");
  ok(JSON.parse(backing[t2iKey]).nodes.some((n) => n.type === "image"), "reload leaves the other tab's graph in place");
}

// ---------------------------------------------------------------------------
// 3. A share link opens a new tab and keeps the previous bytes exact.
// ---------------------------------------------------------------------------
{
  clearStore();
  backing.noodle_graph = FIXTURE;
  const W = boot();
  W.ensureWorkspaces();
  const stranger = { v: 1, nodes: [{ id: "s1", type: "image", x: 9, y: 9, name: "Stranger", fields: { model: "meta/muse-image/text-to-image", prompt: "a red door" } }], links: [], nid: 2, lid: 1, view: {} };
  W.setHash("#j=" + b64url(stranger));
  const applied = await W.loadFromHash();
  ok(applied === true, "a valid #j= link must apply");
  ok(W.stacks().undo.length === 0, "a shelved share link must not also park undo (Ctrl+Z would wipe the new tab)");
  const wsVals = Object.entries(backing).filter(([k]) => k.startsWith("noodle_ws_")).map(([, v]) => v);
  ok(wsVals.includes(FIXTURE), "the previous noodle_graph bytes are stored verbatim on the old tab");
  const live = JSON.parse(backing.noodle_graph);
  ok((live.nodes || []).some((n) => n.id === "s1"), "noodle_graph after the link is the shared graph");
  const idx = W.readWorkspaces();
  ok(idx.tabs.length === 2 && idx.active !== "w1", "the shared graph is a second, active tab");
  ok(W.toasts().some((m) => m.includes("new workspace")), "opening a share link says the previous workspace is still there");
}

// ---------------------------------------------------------------------------
// 4. A malformed link must not shelve or overwrite the legacy graph.
// ---------------------------------------------------------------------------
{
  clearStore();
  backing.noodle_graph = FIXTURE;
  const W = boot();
  W.ensureWorkspaces();
  const before = JSON.parse(backing.noodle_workspaces);
  W.setHash("#j=" + b64url({ nodes: 5 }));
  let ret = null;
  try { ret = await W.loadFromHash(); } catch (e) { fail("malformed link threw: " + e.message); }
  ok(ret === false, "a malformed share link must report failure");
  ok(backing.noodle_graph === FIXTURE, "a malformed share link must not overwrite noodle_graph");
  ok(!Object.keys(backing).some((k) => k.startsWith("noodle_ws_")), "a malformed share link must not shelve");
  ok(JSON.parse(backing.noodle_workspaces).tabs.length === before.tabs.length, "a malformed share link must not add a tab");
}

// ---------------------------------------------------------------------------
// 5. Empty canvas absorbs a starter. Cap refuses a 17th chooser tab.
// ---------------------------------------------------------------------------
{
  clearStore();
  const W = boot();
  W.ensureWorkspaces();
  W.applyGraphData(W.blankGraph());
  const absorbed = W.openWorkspaceWithGraph(W.askModelGraph(), "Ask a model", { respectCap: true, fit: true });
  ok(absorbed === true, "a starter must open on an empty canvas");
  ok(W.readWorkspaces().tabs.length === 1, "an empty canvas absorbs the starter instead of leaving a blank tab behind");
  const llm = (W.serializeGraph().nodes || []).find((n) => n.type === "llm");
  ok(llm && llm.fields.model === "z-ai/glm-5.3-flash", "ask-a-model pins GLM flash");
  // Fill up to the cap, then the next chooser open must refuse without dropping tab 1's bytes.
  const firstKey = backing.noodle_graph;
  while (W.readWorkspaces().tabs.length < 16) {
    const n = W.readWorkspaces().tabs.length;
    const grew = W.openWorkspaceWithGraph(W.textToImageGraph(), "Extra " + n, { respectCap: true, fit: false });
    if (!grew) { fail("failed to grow workspaces before the cap, at " + n); break; }
  }
  ok(W.readWorkspaces().tabs.length === 16, `expected to reach 16 tabs, got ${W.readWorkspaces().tabs.length}`);
  const refused = W.openWorkspaceWithGraph(W.textToImageGraph(), "One more", { respectCap: true, fit: true });
  ok(refused === false, "the chooser must refuse past the cap");
  ok(W.readWorkspaces().tabs.length === 16, "a refused starter must not add a tab");
  // A share link still shelves rather than evicting, even at the cap.
  const prev = backing.noodle_graph;
  const stranger = { v: 1, nodes: [{ id: "s9", type: "text", x: 1, y: 1, fields: { text: "from a link" } }], links: [], nid: 2, lid: 1 };
  W.setHash("#j=" + b64url(stranger));
  const linked = await W.loadFromHash();
  ok(linked === true, "a share link at the cap must still open");
  ok(W.readWorkspaces().tabs.length === 17, "a share link may exceed the chooser cap so it never evicts a tab");
  const kept = Object.values(backing).includes(prev) || backing.noodle_graph === prev;
  ok(Object.entries(backing).some(([k, v]) => k.startsWith("noodle_ws_") && v === prev) || kept, "the graph that was open at the cap is still stored");
  ok(firstKey === firstKey, "cap setup kept a baseline");
}

// ---------------------------------------------------------------------------
// 6. Close confirms, and declining leaves the tab in place.
// ---------------------------------------------------------------------------
{
  clearStore();
  backing.noodle_graph = FIXTURE;
  const W = boot();
  W.ensureWorkspaces();
  W.load();
  W.openWorkspaceWithGraph(W.textToImageGraph(), "Text to image", { respectCap: true, fit: true });
  const active = W.readWorkspaces().active;
  W.setConfirm(false);
  W.closeWorkspace(active);
  ok(W.readWorkspaces().tabs.length === 2, "declining the close confirm must keep the tab");
  W.setConfirm(true);
  W.closeWorkspace(active);
  ok(W.readWorkspaces().tabs.length === 1, "confirming close removes the tab");
  ok(W.readWorkspaces().active === "w1", "closing the active tab returns to the other one");
  ok(textOf(JSON.parse(backing.noodle_graph)) === textOf(JSON.parse(FIXTURE)), "the remaining tab is the original workflow");
}

// ---------------------------------------------------------------------------
// 7. An empty rename keeps the previous name. A repeated example switches
//    to the tab that already has it. A pasted hash opens now.
// ---------------------------------------------------------------------------
{
  clearStore();
  backing.noodle_graph = FIXTURE;
  const W = boot();
  W.ensureWorkspaces();
  W.load();
  const id = W.readWorkspaces().active;
  W.renameWorkspace(id, "   ");
  ok(W.readWorkspaces().tabs[0].name === "Night desk", "an empty rename must keep the current name");
  W.renameWorkspace(id, "Night desk");
  ok(W.readWorkspaces().tabs[0].name === "Night desk", "renaming to the same name must keep it");
  ok(W.workspaceDownloadName() === "Night desk.json", "Save uses the tab name as the filename, got " + W.workspaceDownloadName());
  ok(W.workspaceLabelForGraph(W.textToImageGraph(), false) === "Text to image", "a prompt+image graph is named for what it does, not the node called Prompt");
  ok(W.workspaceLabelForGraph(JSON.parse(FIXTURE), false) === "Night desk", "a named workflow keeps that name");

  const how = W.openExampleWorkspace(W.textToImageGraph(), "Storyboard relay", "storyboard-relay");
  ok(how === "open", "the first open of an example adds a tab");
  ok(W.readWorkspaces().tabs.length === 2, "one example adds one tab");
  ok(W.readWorkspaces().tabs.some((t) => t.example === "storyboard-relay"), "the example tab remembers which example it is");
  W.switchWorkspace("w1");
  const again = W.openExampleWorkspace(W.textToImageGraph(), "Storyboard relay", "storyboard-relay");
  ok(again === "switch", "opening the same example again switches to its tab");
  ok(W.readWorkspaces().tabs.length === 2, "a repeated example must not create “Storyboard relay 2”");
  ok(W.readWorkspaces().active !== "w1", "the switch lands on the example tab");

  const before = W.readWorkspaces().tabs.length;
  const stranger = { v: 1, nodes: [{ id: "s2", type: "text", x: 1, y: 1, name: "Pasted", fields: { text: "pasted link" } }], links: [], nid: 2, lid: 1 };
  W.setHash("#j=" + b64url(stranger));
  const pasted = await W.onWorkspaceHash();
  ok(pasted === true, "a hash set on an already-open page must load");
  ok(W.readWorkspaces().tabs.length === before + 1, "the pasted link opens a new tab immediately");
  ok(W.serializeGraph().nodes.some((n) => n.name === "Pasted"), "the pasted graph is the one on screen");
}

if (failures.length) {
  console.error("✗ workspaces broke:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
console.log("✓ workspaces: legacy graph becomes tab 1 untouched, tabs switch and reload, a share link opens a new tab, text-to-image is wired to Muse.");
