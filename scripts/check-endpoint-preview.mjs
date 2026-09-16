#!/usr/bin/env node
// Offline guard for the Custom endpoint LIVE preview (the "POST <dest>" line +
// the request-body contract under it): it must follow wires the same way the
// paid call does.
//
// Two bugs lived here (both editor-only — play.html has no endpoint preview):
//   1. MODEL STALENESS — a Choice/Text wire into the optional model field drove
//      the paid body (runGroup fieldOverrides → endpointModel) but the preview
//      still showed the TYPED model id (refreshEndpointUI built liveN from
//      url/mode only).
//   2. WIRE-CHANGE STALENESS — connect()/removeLink()/removeNode() never
//      repainted the preview, so drawing or pulling a url/mode/model wire left
//      dest/req showing the pre-wire target until an unrelated edit happened
//      to refresh it.
//
// Lifts the SHIPPED functions out of index.html and runs them in node:vm
// against a tiny fake DOM. No browser, no network, no API spend.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "index.html"), "utf8");

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
function extractFn(src, name) {
  const sig = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = sig.exec(src);
  if (!m) throw new Error("function " + name + "() not found in index.html");
  return src.slice(m.index, matchBrace(src, src.indexOf("{", m.index)) + 1);
}
function extractThrough(src, startNeedle, endNeedle) {
  const s = src.indexOf(startNeedle);
  if (s < 0) throw new Error("start not found: " + startNeedle);
  const e = src.indexOf(endNeedle, s);
  if (e < 0) throw new Error("end not found: " + endNeedle);
  return src.slice(s, e);
}
const grab = (re, what) => {
  const m = SRC.match(re);
  if (!m) throw new Error(what + " declaration not found in index.html");
  return m[0];
};

const HELPERS = extractThrough(
  SRC,
  "var ENDPOINT_DEF_URL",
  "\n/* ======================================================================\n   NODE TYPE REGISTRY");

// ---- fake DOM: enough for refreshPortFills + refreshEndpointUI ----------------
// refreshPortFills only ever touches document-level port/chip selectors (all
// absent here → null/[] no-ops); the endpoint preview reads its own el's
// [data-ep-*] slots, which persist per node.
const document = {
  querySelectorAll: () => [],
  querySelector: () => null,
};
function fakeEndpointEl() {
  const slots = {};
  return {
    _slots: slots,
    querySelectorAll: (sel) => (sel === ".col.in .prow" ? [] : []),
    querySelector: (sel) => {
      if (!slots[sel]) slots[sel] = { hidden: false, textContent: "" };
      return slots[sel];
    },
    remove: () => {},
  };
}

const failures = [];
const ok = (c, m) => { if (!c) failures.push(m); };

// ---- vm context: REAL wire/preview functions, stubbed surroundings -----------
const ctx = {
  URL, document, console,
  selected: null,
  graph: { nodes: [], links: [] },
  esc: (s) => String(s == null ? "" : s),
  NODE_TYPES: {
    choice: { title: "Choice" },
    text: { title: "Text" },
    endpoint: { title: "Custom endpoint" },
  },
  pushUndo: () => {}, redraw: () => {}, save: () => {},
  toast: () => {},
  refreshImageInputs: () => {}, refreshVideoInputs: () => {},
  recompactImageLinks: () => {}, recompactVideoLinks: () => {},
  rerenderNode: () => {}, updateDelBtn: () => {},
  refreshPromptCaps: () => {}, refreshFramePorts: () => {},
};
ctx.byId = (id) => ctx.graph.nodes.find((n) => n.id === id);
vm.createContext(ctx);
vm.runInContext(HELPERS, ctx, { filename: "index.html#endpoint" });
vm.runInContext(
  [
    grab(/const IMG_PORT_RE = \/[^\n]*;/, "IMG_PORT_RE"),
    grab(/const EDIT_IMG_RE = \/[^\n]*;/, "EDIT_IMG_RE"),
    grab(/const VID_PORT_RE = \/[^\n]*;/, "VID_PORT_RE"),
    "let lid = 500;",
    extractFn(SRC, "endpointWiredField"),
    extractFn(SRC, "endpointWantedInputs"),
    extractFn(SRC, "refreshEndpointUI"),
    extractFn(SRC, "refreshPortFills"),
    extractFn(SRC, "wouldCycle"),
    extractFn(SRC, "connect"),
    extractFn(SRC, "removeLink"),
    extractFn(SRC, "removeNode"),
    "globalThis.__t = { refreshEndpointUI, connect, removeLink, removeNode };",
  ].join("\n"),
  ctx, { filename: "index.html#endpoint-preview" });
const { refreshEndpointUI, connect, removeLink, removeNode } = ctx.__t;

// ---- scenario setup -----------------------------------------------------------
const epEl = fakeEndpointEl();
ctx.graph.nodes = [
  { id: "n5", type: "endpoint", el: epEl,
    fields: { url: "https://httpbingo.org", mode: "json", model: "typed-model", prompt: "hi" } },
  { id: "n3", type: "choice", el: fakeEndpointEl(), fields: { selected: "/post" } },
];
ctx.graph.links = [];
const dest = () => epEl._slots["[data-ep-dest]"].textContent;
const reqBody = () => JSON.parse(epEl._slots["[data-ep-req]"].textContent);

// ---- 1. an unwired preview shows the typed target ------------------------------
refreshEndpointUI(ctx.byId("n5"));
ok(dest() === "json · https://httpbingo.org",
  `unwired preview dest shows the typed target, got ${JSON.stringify(dest())}`);

// ---- 2. drawing a Choice→url wire repaints the preview (path join) -------------
const wired = connect("n3", "text", "n5", "url");
ok(wired !== false, "connect(Choice→endpoint url) must succeed");
ok(dest() === "json · https://httpbingo.org/post",
  `after wiring /post the preview must show the JOINED url, got ${JSON.stringify(dest())}`);

// ---- 3. detaching the wire repaints back to the typed host ----------------------
removeLink(ctx.graph.links[0].id);
ok(ctx.graph.links.length === 0, "removeLink should drop the wire");
ok(dest() === "json · https://httpbingo.org",
  `after detaching, the preview must fall back to the typed host, got ${JSON.stringify(dest())}`);

// ---- 4. deleting the source node repaints too ------------------------------------
connect("n3", "text", "n5", "url");
ok(dest() === "json · https://httpbingo.org/post", "rewired preview shows the joined url");
removeNode("n3");
ok(ctx.graph.links.length === 0, "removeNode should drop the wire");
ok(dest() === "json · https://httpbingo.org",
  `after deleting Choice, the preview must fall back to the typed host, got ${JSON.stringify(dest())}`);

// ---- 5. a Choice→model wire drives the preview body, like the paid call ---------
ctx.graph.nodes.push({ id: "n4", type: "choice", el: fakeEndpointEl(), fields: { selected: "wired-model" } });
ctx.byId("n5").fields.mode = "chat";   // model rides the chat body (json mode carries no model)
connect("n4", "text", "n5", "model");
const previewModel = reqBody().model;
// runGroup's fieldOverrides path: the SAME wire value lands in fields before runEndpoint.
const v = ctx.byId("n4").fields.selected;
const runModel = ctx.endpointRequestBody("chat",
  { ...ctx.byId("n5"), fields: { ...ctx.byId("n5").fields, model: v } }, {}).model;
ok(previewModel === "wired-model",
  `a wired model must reach the preview body, got ${JSON.stringify(previewModel)}`);
ok(previewModel === runModel,
  `preview model ${JSON.stringify(previewModel)} must match the paid-call model ${JSON.stringify(runModel)}`);

// ---- 6. no model wire → the typed model still previews ---------------------------
removeLink(ctx.graph.links.find((l) => l.to.port === "model").id);
ok(reqBody().model === "typed-model",
  `unwired preview keeps the typed model, got ${JSON.stringify(reqBody().model)}`);

if (failures.length) {
  process.stderr.write("✗ endpoint live preview ignores wires:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ endpoint live preview follows url/model wires across connect, detach and node delete.\n");
