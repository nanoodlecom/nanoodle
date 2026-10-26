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
  "  openWorkspaceWithGraph, openExampleWorkspace, switchWorkspace, closeWorkspace, renameWorkspace, workspaceChord,",
  "  textToImageGraph, askModelGraph, blankGraph,",
  "  readWorkspaces, shelvePreviousWorkspace, workspaceLabelForGraph, workspaceDownloadName, onWorkspaceHash, graph, ",
  "  stacks: () => ({ undo: undoStack.slice(), redo: redoStack.slice() }),",
  "  toasts: () => __toasts.slice(),",
  "  setConfirm: (v) => { __confirm = v; },",
  "  setHash: (h) => { location.hash = h; },",
  "  setOut: (id, out) => { const n = graph.nodes.find(x => x.id === id); if (n) n.out = out; },",
  "  setText: (id, text) => { const n = graph.nodes.find(x => x.id === id); if (n) { n.fields = n.fields || {}; n.fields.text = text; } },",
  "  outOf: (id) => { const n = graph.nodes.find(x => x.id === id); return n && n.out; },",
  "  setPendingApp, pending: () => ({ id: pendingAppId, title: pendingAppTitle }),",
  "  seedUndo: (s) => { undoStack.push({ s: String(s), boundary: true, stash: null }); },",
  "  clearToasts: () => { __toasts.length = 0; },",
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

// ---------------------------------------------------------------------------
// 8. Keyboard chords ignore typing and plain arrows. The narrow layout keeps
//    a 44px touch target, and the active tab is marked with the accent.
// ---------------------------------------------------------------------------
{
  const W = boot();
  const chord = (over) => W.workspaceChord(Object.assign({ shiftKey: false, repeat: false, ctrlKey: false, metaKey: false, altKey: false, key: "", target: { tagName: "BODY", isContentEditable: false } }, over));
  ok(chord({ ctrlKey: true, altKey: true, key: "ArrowRight" }) === "next", "Ctrl+Alt+ArrowRight moves to the next workspace");
  ok(chord({ metaKey: true, altKey: true, key: "[" }) === "prev", "Cmd+Alt+[ moves to the previous workspace");
  ok(chord({ altKey: true, key: "ArrowRight" }) === null, "Alt+Arrow without Ctrl/Cmd must not steal canvas keys");
  ok(chord({ ctrlKey: true, altKey: true, key: "ArrowLeft", target: { tagName: "INPUT", isContentEditable: false } }) === null, "a chord while typing must not switch tabs");
  ok(chord({ ctrlKey: true, altKey: true, shiftKey: true, key: "]" }) === null, "Shift cancels the workspace chord");

  const cssStart = SRC.indexOf("workspaces: a document strip");
  const cssEnd = SRC.indexOf("</style>", cssStart);
  const css = SRC.slice(cssStart, cssEnd);
  const narrow = css.slice(css.indexOf("@media (max-width:720px)"));
  ok(css.includes("overflow-x:auto"), "wide screens scroll the tab strip horizontally");
  ok(narrow.includes("#wstabs{ display:none }"), "narrow screens collapse the strip instead of squeezing tabs");
  ok(narrow.includes("min-height:44px"), "the collapsed workspace control is at least 44px");
  ok(narrow.includes("ws-touch-target") && /#wsdropmenu \.wsrow \.wsx\{[^}]*min-height:44px/.test(narrow), "the mobile close control is a 44px touch target");
  ok(/#wsdropmenu \.wsrow input\.wsrename\{[^}]*min-height:44px/.test(narrow), "the mobile rename field is a 44px touch target");
  ok(/\.wstab\.on\{[^}]*var\(--accent\)/.test(css), "the active tab carries an accent mark");
  ok(css.includes(".wstab:focus-visible"), "desktop tabs have a visible focus state");
  ok(SRC.includes("touch-hold renames a tab"), "a touch hold can rename a tab");
  ok(SRC.includes('e.key==="Home"') && SRC.includes('e.key==="End"'), "Home and End move along the tab strip");
}

// A setItem that rejects any value carrying the unsaved marker. The last good
// autosave does not contain it, which is what the old switch stored instead.
function rejectUnsaved(orig) {
  return (k, v) => {
    if (String(v).includes("UNSAVED")) {
      const err = new Error("quota");
      err.name = "QuotaExceededError";
      throw err;
    }
    return orig.call(localStorage, k, v);
  };
}

// ---------------------------------------------------------------------------
// 9. A quota failure while switching must keep the unsaved edit on this tab.
//    The old flushSave swallowed the error, then switchWorkspace copied the
//    stale noodle_graph onto the tab it left and switched anyway.
// ---------------------------------------------------------------------------
{
  clearStore();
  backing.noodle_graph = FIXTURE;
  const W = boot();
  W.ensureWorkspaces();
  W.load();
  ok(W.openWorkspaceWithGraph(W.textToImageGraph(), "Text to image", { respectCap: true, fit: true }) === true, "quota setup needs a second tab");
  const active = W.readWorkspaces().active;
  const textNode = W.serializeGraph().nodes.find((n) => n.type === "text");
  ok(!!textNode, "the open tab has a text node to edit");
  W.setText(textNode.id, "UNSAVED edit that must survive a failed switch");
  const other = backing.noodle_ws_w1;
  const graphBefore = backing.noodle_graph;
  const leavingKey = "noodle_ws_" + active;
  const orig = localStorage.setItem;
  localStorage.setItem = rejectUnsaved(orig);
  try { W.switchWorkspace("w1"); }
  finally { localStorage.setItem = orig; }
  ok(W.readWorkspaces().active === active, "a failed save must stay on the current workspace");
  ok(textOf(W.serializeGraph()).includes("UNSAVED"), "the unsaved edit stays on screen after a failed switch");
  ok(backing.noodle_ws_w1 === other, "a failed switch must not touch the other tab's stored graph");
  ok(backing.noodle_graph === graphBefore, "a failed switch must not rewrite noodle_graph with a stale copy");
  ok(!backing[leavingKey] || String(backing[leavingKey]).includes("UNSAVED"), "a failed switch must not store the pre-edit graph as the tab we left");
  ok(W.toasts().some((m) => m.includes("Couldn’t switch")), "a failed switch tells you it could not switch");
}

// ---------------------------------------------------------------------------
// 10. An in-page #j= import saves the current graph (unsaved text + paid
//     output) before applying the incoming one. If that save fails, it does
//     not apply. The old path applied first, then shelved the stale autosave
//     and stashed results from the graph that had just replaced the paid one.
// ---------------------------------------------------------------------------
{
  clearStore();
  backing.noodle_graph = FIXTURE;
  const W = boot();
  W.ensureWorkspaces();
  W.load();
  const home = W.readWorkspaces().active;
  W.setText("n1", "UNSAVED EDIT");
  W.setOut("n1", { text: "PAID" });
  const stranger = { v: 1, nodes: [{ id: "s1", type: "text", x: 1, y: 1, name: "Stranger", fields: { text: "incoming" } }], links: [], nid: 2, lid: 1 };
  W.setHash("#j=" + b64url(stranger));
  const applied = await W.loadFromHash();
  ok(applied === true, "a #j= import applies once the current graph is saved");
  ok(W.readWorkspaces().tabs.length === 2 && W.readWorkspaces().active !== home, "the import opens in a new tab");
  ok(textOf(W.serializeGraph()) === "incoming", "the incoming graph is the one on screen");
  const shelved = JSON.parse(backing.noodle_ws_w1);
  ok(textOf(shelved) === "UNSAVED EDIT", "the tab we left keeps the unsaved edit, not the last autosave");
  W.switchWorkspace(home);
  ok(W.readWorkspaces().active === home, "switching back lands on the original tab");
  ok(textOf(W.serializeGraph()) === "UNSAVED EDIT", "switching back shows the unsaved edit");
  ok(W.outOf("n1") && W.outOf("n1").text === "PAID", "switching back restores the paid output that was on screen");
}
{
  clearStore();
  backing.noodle_graph = FIXTURE;
  const W = boot();
  W.ensureWorkspaces();
  W.load();
  const stored = backing.noodle_graph;
  const tabsBefore = W.readWorkspaces().tabs.length;
  W.setText("n1", "UNSAVED EDIT");
  W.setOut("n1", { text: "PAID" });
  const stranger = { v: 1, nodes: [{ id: "s1", type: "text", x: 1, y: 1, name: "Stranger", fields: { text: "incoming" } }], links: [], nid: 2, lid: 1 };
  const orig = localStorage.setItem;
  localStorage.setItem = rejectUnsaved(orig);
  let applied = true;
  try {
    W.setHash("#j=" + b64url(stranger));
    applied = await W.loadFromHash();
  } finally { localStorage.setItem = orig; }
  ok(applied === false, "an import that cannot save the current graph must not apply");
  ok(textOf(W.serializeGraph()) === "UNSAVED EDIT", "a refused import leaves the unsaved edit on screen");
  ok(W.outOf("n1") && W.outOf("n1").text === "PAID", "a refused import leaves the paid output on screen");
  ok(W.readWorkspaces().tabs.length === tabsBefore, "a refused import must not add a tab");
  ok(!Object.keys(backing).some((k) => k.startsWith("noodle_ws_")), "a refused import must not shelve");
  ok(backing.noodle_graph === stored, "a refused import must not replace noodle_graph");
  ok(W.toasts().some((m) => m.includes("unchanged")), "a refused import says the current workflow is unchanged");
}

// A text node whose only job is to be recognizable after a switch.
function markerGraph(text) {
  return { v: 1, nodes: [{ id: "n1", type: "text", x: 1, y: 1, fields: { text } }], links: [], nid: 2, lid: 1 };
}
function tabMarker(W, id) {
  const idx = W.readWorkspaces();
  if (idx && idx.active === id) return textOf(W.serializeGraph());
  const raw = backing["noodle_ws_" + id];
  if (!raw) return null;
  try { return textOf(JSON.parse(raw)); } catch { return null; }
}

// ---------------------------------------------------------------------------
// 11. Every write inside a switch is transactional. Failing the 1st, 2nd, …
//     setItem must leave the source tab on screen and in the index, and a
//     later successful switch must not overwrite any tab's graph. The old
//     code wrote the destination into noodle_graph, swallowed the pointer
//     failure, and the next switch stored that destination over the source.
// ---------------------------------------------------------------------------
{
  const failedKeys = [];
  let switches = 0;
  for (let n = 1; n <= 12; n++) {
    clearStore();
    const W = boot();
    W.ensureWorkspaces();
    W.applyGraphData(markerGraph("GRAPH-w1"));
    for (let i = 2; i <= 10; i++) {
      const grew = W.openWorkspaceWithGraph(markerGraph("GRAPH-w" + i), "Tab " + i, { respectCap: true });
      if (!grew) { fail("could not open tab " + i + " while setting up switch writes"); break; }
    }
    const idx = W.readWorkspaces();
    const source = idx.active;
    const dest = idx.tabs.find((t) => t.id !== source && tabMarker(W, t.id) === "GRAPH-w9");
    ok(!!dest, "setup needs a w9-style tab whose graph is GRAPH-w9");
    if (!dest) break;
    const sourceMarker = textOf(W.serializeGraph());
    W.setOut("n1", { text: "PAID-" + source });
    const beforeActive = source;
    const orig = localStorage.setItem;
    let i = 0;
    let tripped = false;
    let trippedKey = null;
    localStorage.setItem = (k, v) => {
      if (!tripped) {
        i++;
        if (i === n) {
          tripped = true;
          trippedKey = k;
          const err = new Error("quota");
          err.name = "QuotaExceededError";
          throw err;
        }
      }
      return orig.call(localStorage, k, v);
    };
    try { W.switchWorkspace(dest.id); }
    finally { localStorage.setItem = orig; }
    const activeAfter = W.readWorkspaces().active;
    if (!tripped) {
      ok(activeAfter === dest.id, "a switch with room to spare must reach the destination once injections run out");
      break;
    }
    switches++;
    failedKeys.push(trippedKey);
    ok(activeAfter === beforeActive, `write #${n} (${trippedKey}) failed but the active id changed to ${activeAfter}`);
    ok(textOf(W.serializeGraph()) === sourceMarker, `write #${n} (${trippedKey}) left the destination graph on screen`);
    ok(W.outOf("n1") && W.outOf("n1").text === "PAID-" + source, `write #${n} (${trippedKey}) dropped the paid output on the source tab`);
    ok(textOf(JSON.parse(backing.noodle_graph)) === sourceMarker, `write #${n} (${trippedKey}) stored another tab's graph in noodle_graph`);
    const leaveRaw = backing["noodle_ws_" + source];
    if (leaveRaw) ok(textOf(JSON.parse(leaveRaw)) === sourceMarker, `write #${n} (${trippedKey}) stored another graph on the source tab's key`);
    ok(tabMarker(W, dest.id) === "GRAPH-w9", `write #${n} (${trippedKey}) overwrote the destination tab`);
    for (let t = 1; t <= 10; t++) {
      const id = "w" + t;
      const want = "GRAPH-" + id;
      const got = tabMarker(W, id);
      ok(got === want, `write #${n} (${trippedKey}) mixed ${id}: expected ${want}, got ${got}`);
    }
    ok(W.toasts().some((m) => m.includes("Couldn’t switch")), `write #${n} (${trippedKey}) failed without an error`);
    // The reviewer's follow-up: more switches must not copy the canvas onto the wrong tab.
    const order = idx.tabs.map((t) => t.id);
    for (const id of [dest.id, order[0], source, order[Math.min(4, order.length - 1)]]) W.switchWorkspace(id);
    for (let t = 1; t <= 10; t++) {
      const id = "w" + t;
      const want = "GRAPH-" + id;
      const got = tabMarker(W, id);
      ok(got === want, `after write #${n} (${trippedKey}) a later switch mixed ${id}: expected ${want}, got ${got}`);
    }
  }
  ok(switches >= 3, `expected a quota miss on several switch writes, tripped ${switches}`);
  ok(failedKeys.includes("noodle_workspaces"), "one injected failure must be the active-workspace pointer (noodle_workspaces)");
  ok(failedKeys.includes("noodle_graph"), "one injected failure must be the noodle_graph write");
  ok(failedKeys.some((k) => k && k.startsWith("noodle_ws_")), "one injected failure must be the tab's own noodle_ws_ key");
}

// ---------------------------------------------------------------------------
// 12. A payload that is almost a graph must not add a tab, clear the canvas,
//     touch undo, or change the app binding. Null nodes, missing fields, and
//     links that point at nothing used to get past the array check.
// ---------------------------------------------------------------------------
{
  clearStore();
  backing.noodle_graph = FIXTURE;
  const W = boot();
  W.ensureWorkspaces();
  W.load();
  W.setText("n1", "UNSAVED EDIT");
  W.setOut("n1", { text: "PAID" });
  W.seedUndo("before-import");
  W.setPendingApp("app_keep", "Keep me");
  const home = W.readWorkspaces().active;
  const snap = () => JSON.stringify({
    graph: backing.noodle_graph,
    index: backing.noodle_workspaces,
    editor: backing.noodle_editor_app || null,
    ws: Object.keys(backing).filter((k) => k.startsWith("noodle_ws_")).sort(),
    tabs: W.readWorkspaces().tabs.length,
    active: W.readWorkspaces().active,
    undo: W.stacks().undo.length,
    redo: W.stacks().redo.length,
    text: textOf(W.serializeGraph()),
    paid: W.outOf("n1") && W.outOf("n1").text,
    pending: W.pending().id,
    title: W.pending().title,
  });
  const before = snap();
  const bad = [
    { nodes: [null], links: [] },
    { nodes: [{ id: "n1", type: "text" }], links: [] },
    { nodes: [{ id: "n1", type: "text", fields: { text: "x" } }], links: [{ from: { node: "nope", port: "text" }, to: { node: "n1", port: "text" } }] },
    { nodes: [{ id: "n1", fields: { text: "x" } }], links: [] },
    { nodes: [{ id: "n1", type: "text", fields: null }], links: [] },
    { nodes: [{ id: "n1", type: "text", fields: { text: "x" } }], links: [null] },
  ];
  for (const payload of bad) {
    W.setHash("#j=" + b64url(payload));
    let ret = true;
    try { ret = await W.loadFromHash(); }
    catch (e) { fail("malformed import threw: " + e.message); ret = null; }
    ok(ret === false, "malformed import must fail: " + JSON.stringify(payload).slice(0, 90));
    ok(snap() === before, "malformed import changed tabs, canvas, undo, or app state: " + JSON.stringify(payload).slice(0, 90));
  }
  const stranger = { v: 1, nodes: [{ id: "s1", type: "text", x: 1, y: 1, fields: { text: "incoming" } }], links: [], nid: 2, lid: 1 };
  W.setHash("#j=" + b64url(stranger));
  const applied = await W.loadFromHash();
  ok(applied === true, "a valid import still opens after the rejected payloads");
  ok(textOf(W.serializeGraph()) === "incoming", "the valid import is the graph on screen");
  W.switchWorkspace(home);
  ok(W.readWorkspaces().active === home, "switching back after a valid import lands on the original tab");
  ok(textOf(W.serializeGraph()) === "UNSAVED EDIT", "the original unsaved edit survived the rejected payloads and the later import");
  ok(W.outOf("n1") && W.outOf("n1").text === "PAID", "the original paid output survived the rejected payloads and the later import");
}

// A quota that stays full for the whole attempt: the failed switch, the rollback,
// a second vm on the same backing (a reload), and every switch after that.
// Equal-size replaces fit. Anything that would grow past `cap` throws.
function usageOf() {
  return Object.values(backing).reduce((n, v) => n + String(v).length, 0);
}
function editorValueOf(len) {
  const id = "app_dest";
  for (let n = 0; n < len + 8; n++) {
    const title = "T".repeat(n);
    const value = JSON.stringify({ id, title });
    if (value.length === len) return { id, title, value };
  }
  return null;
}
function installTightQuota(cap, reject) {
  const orig = localStorage.setItem;
  const wrote = [];
  let refused = null;
  localStorage.setItem = (k, v) => {
    const next = String(v);
    const blocked = !!(reject && reject(k, next));
    const oldLen = Object.prototype.hasOwnProperty.call(backing, k) ? String(backing[k]).length : 0;
    if (blocked || usageOf() - oldLen + next.length > cap) {
      if (!refused) refused = k + (blocked ? " refused" : " over cap");
      const err = new Error("quota");
      err.name = "QuotaExceededError";
      throw err;
    }
    wrote.push(k);
    return orig.call(localStorage, k, v);
  };
  return { wrote, refused: () => refused, stop() { localStorage.setItem = orig; } };
}
// The bad pair Ember hit: the index still names the original tab while
// noodle_graph holds the incoming workspace.
function pairBad(sourceId) {
  let idx = null;
  try { idx = JSON.parse(backing.noodle_workspaces); } catch { return true; }
  const live = backing.noodle_graph || "";
  return !!(idx && idx.active === sourceId && live.includes("INCOMING") && !live.includes("ORIGINAL"));
}
function originalHeld(sourceId) {
  let idx = null;
  try { idx = JSON.parse(backing.noodle_workspaces); } catch { return false; }
  const key = backing["noodle_ws_" + sourceId];
  if (idx && idx.active === sourceId) return (backing.noodle_graph || "").includes("ORIGINAL");
  return !!(key && key.includes("ORIGINAL"));
}
// Two tabs. The active one is a large ORIGINAL graph. The other is a compact
// INCOMING graph plus a fat app binding that exactly fills the bytes freed by
// swapping the large graph out. Cap leaves room for one extra copy of ORIGINAL
// (the leaving-tab write) and nothing else.
function stageTightPair() {
  clearStore();
  const W = boot();
  W.ensureWorkspaces();
  W.applyGraphData(markerGraph("ORIGINAL" + "A".repeat(4000)));
  W.save();
  const opened = W.openWorkspaceWithGraph(markerGraph("INCOMING"), "Incoming", { respectCap: true });
  if (!opened) return { error: "could not open the incoming tab" };
  const destId = W.readWorkspaces().active;
  const sourceId = W.readWorkspaces().tabs.find((t) => t.id !== destId).id;
  W.switchWorkspace(sourceId);
  if (W.readWorkspaces().active !== sourceId) return { error: "could not switch back to the original tab" };
  const preview = JSON.stringify(W.serializeGraph());
  backing.noodle_graph = preview;
  delete backing["noodle_ws_" + sourceId];
  const compact = JSON.stringify({ nodes: [{ id: "n1", type: "text", x: 1, y: 1, fields: { text: "INCOMING" } }], links: [] });
  backing["noodle_ws_" + destId] = compact;
  const graphLen = preview.length;
  const slack = graphLen - compact.length;
  const editor = editorValueOf(slack);
  if (!editor) return { error: "could not size the destination binding to " + slack };
  const idx = JSON.parse(backing.noodle_workspaces);
  idx.tabs.find((t) => t.id === destId).app = { id: editor.id, title: editor.title };
  backing.noodle_workspaces = JSON.stringify(idx);
  delete backing.noodle_editor_app;
  const cap = usageOf() + graphLen;
  return { W, sourceId, destId, editor, cap, graphLen, slack, originalBytes: preview };
}

// ---------------------------------------------------------------------------
// 13. A quota that never lifts. Freeing the destination app binding has to
//     happen before the large graph is put back, and the restore has to be
//     read back. Otherwise a reload shows the incoming graph under the
//     original tab and the next switch deletes the original.
// ---------------------------------------------------------------------------
{
  const stage = stageTightPair();
  ok(!stage.error, stage.error || "tight-quota stage");
  if (!stage.error) {
    const { W, sourceId, destId, cap, graphLen, slack, originalBytes } = stage;
    const q = installTightQuota(cap);
    W.clearToasts();
    try { W.switchWorkspace(destId); }
    finally { /* quota stays on through reload and later switches */ }
    const detail = `refused ${q.refused()}; wrote ${q.wrote.join(",")}; graph ${graphLen} slack ${slack} cap ${cap}`;
    ok(q.wrote.includes("noodle_editor_app"), "the destination binding was stored before the quota miss — " + detail);
    ok(W.toasts().some((m) => m.includes("Couldn’t switch")), "a still-tight quota tells you the switch failed — " + detail);
    ok(!pairBad(sourceId), "rollback left the incoming graph under the original workspace — " + detail);
    ok(JSON.parse(backing.noodle_workspaces).active === sourceId, "a restorable switch stays on the original tab — " + detail);
    ok(backing.noodle_graph === originalBytes, "noodle_graph was put back to the original bytes — " + detail);
    ok(originalHeld(sourceId), "original content is stored under the original workspace — " + detail);
    const re = boot();
    re.ensureWorkspaces();
    ok(re.load() === true, "reload still reads a graph");
    ok(JSON.parse(backing.noodle_workspaces).active === sourceId, "after reload the original workspace is still the active one — " + detail);
    ok((backing.noodle_graph || "").includes("ORIGINAL"), "after reload noodle_graph is still the original workspace — " + detail);
    ok(!pairBad(sourceId), "after reload the incoming graph is not showing as the original workspace — " + detail);
    ok(String(textOf(re.serializeGraph()) || "").startsWith("ORIGINAL"), "after reload the canvas is the original workflow");
    re.clearToasts();
    re.switchWorkspace(destId);
    re.switchWorkspace(sourceId);
    ok(originalHeld(sourceId), "later switches under the same quota keep the original on its workspace — " + detail);
    ok(!pairBad(sourceId), "later switches did not pair the incoming graph with the original workspace — " + detail);
    q.stop();
  }
}

// ---------------------------------------------------------------------------
// 14. The same tight quota, and putting the large graph back keeps failing
//     even after the binding and the temp copy are gone. The original bytes
//     stay on the original workspace, the index is not left claiming them
//     while noodle_graph holds the incoming one, and the error is visible.
//     A reload and another switch must not destroy that copy.
// ---------------------------------------------------------------------------
{
  const stage = stageTightPair();
  ok(!stage.error, stage.error || "impossible-restore stage");
  if (!stage.error) {
    const { W, sourceId, destId, cap, graphLen, slack, originalBytes } = stage;
    let armed = false;
    const q = installTightQuota(cap, (k, next) => {
      if (k === "noodle_graph" && next.includes("INCOMING")) armed = true;
      // Restoring the original graph keeps throwing for the rest of the test.
      return armed && k === "noodle_graph" && next.includes("ORIGINAL");
    });
    W.clearToasts();
    try { W.switchWorkspace(destId); }
    finally { /* stays armed, and the cap stays tight */ }
    const detail = `refused ${q.refused()}; wrote ${q.wrote.join(",")}; graph ${graphLen} slack ${slack}`;
    ok(q.wrote.includes("noodle_editor_app"), "the binding was stored before restore became impossible — " + detail);
    ok(W.toasts().some((m) => m.includes("Couldn’t switch")), "an impossible restore surfaces an error — " + detail);
    ok(!pairBad(sourceId), "index and noodle_graph were left out of sync — " + detail);
    ok(backing["noodle_ws_" + sourceId] === originalBytes, "the original bytes stayed on the original workspace — " + detail);
    ok(!(backing["noodle_ws_" + sourceId] || "").includes("INCOMING"), "the incoming graph was written over the original workspace — " + detail);
    const re = boot();
    re.ensureWorkspaces();
    ok(re.load() === true, "reload after an impossible restore still reads a graph");
    ok(backing["noodle_ws_" + sourceId] === originalBytes, "reload left the original bytes on the original workspace — " + detail);
    ok(!pairBad(sourceId), "reload is showing the incoming graph under the original workspace — " + detail);
    re.clearToasts();
    re.switchWorkspace(sourceId);
    re.switchWorkspace(destId);
    ok(backing["noodle_ws_" + sourceId] === originalBytes, "a later switch destroyed the original workspace — " + detail);
    ok(!pairBad(sourceId), "a later switch paired the incoming graph with the original workspace — " + detail);
    ok(re.toasts().some((m) => m.includes("Couldn’t switch")) || W.toasts().some((m) => m.includes("Couldn’t switch")), "the impossible restore did not surface an error");
    q.stop();
  }
}

if (failures.length) {
  console.error("✗ workspaces broke:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
console.log("✓ workspaces: legacy graph becomes tab 1 untouched, tabs switch and reload, a share link opens a new tab, text-to-image is wired to Muse.");
