#!/usr/bin/env node
// Editor Custom-endpoint contract preview after #465.
//
// runEndpoint already follows a Choice wire into inp.url / inp.mode. The
// editor preview (refreshEndpointUI) is a different path: it reads the live
// graph through endpointWiredField, which must prefer Choice.selected over a
// stale last-run .out. Dropping that preference makes the request card show
// leftover httpbingo/json while the next Run follows the picker.
//
// Lifts the shipped helpers + preview functions out of index.html and runs
// them in node:vm. Offline, no network, no API spend.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");

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
  if (!m) throw new Error("function " + name + "() not found");
  const open = src.indexOf("{", m.index);
  return src.slice(m.index, matchBrace(src, open) + 1);
}

function extractThrough(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  if (start < 0) throw new Error("start not found: " + startNeedle);
  const end = src.indexOf(endNeedle, start);
  if (end < 0) throw new Error("end not found: " + endNeedle);
  return src.slice(start, end);
}

const HELPERS = extractThrough(
  IDX,
  "var ENDPOINT_DEF_URL",
  "\n/* ======================================================================\n   NODE TYPE REGISTRY",
);

const PREVIEW = [
  extractFn(IDX, "endpointWantedInputs"),
  extractFn(IDX, "endpointWiredField"),
  extractFn(IDX, "refreshEndpointUI"),
].join("\n");

const LOCAL_CHAT = "chat · http://127.0.0.1:8787/v1/chat/completions (localhost mock)";
const BINGO_JSON = "json · https://httpbingo.org/post ($0 public echo)";

function loadPreview(nodes, links) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const ctx = {
    URL,
    fetch() { throw new Error("fetch must not run in the preview check"); },
    graph: { nodes, links },
    byId: (id) => byId[id] || null,
    refreshFramePorts() {},
  };
  vm.createContext(ctx);
  vm.runInContext(HELPERS + "\n" + PREVIEW, ctx, { filename: "index.html#endpoint-preview" });
  return ctx;
}

function epEl() {
  const dest = { textContent: "" };
  const req = { textContent: "" };
  const res = { textContent: "" };
  return {
    dest, req, res,
    querySelectorAll: () => [],
    querySelector(sel) {
      if (sel === "[data-ep-dest]") return dest;
      if (sel === "[data-ep-req]") return req;
      if (sel === "[data-ep-res]") return res;
      return { hidden: false };
    },
  };
}

const failures = [];
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { console.error("  ✗ " + m); failures.push(m); } };

console.log("• endpointWiredField prefers live Choice.selected");
{
  const choice = {
    id: "route",
    type: "choice",
    fields: { selected: LOCAL_CHAT, options: LOCAL_CHAT + "\n" + BINGO_JSON },
    out: { text: BINGO_JSON },
  };
  const ep = { id: "ep", type: "endpoint", fields: { url: "https://httpbingo.org/post", mode: "json" } };
  const S = loadPreview([choice, ep], [
    { from: { node: "route", port: "text" }, to: { node: "ep", port: "url" } },
    { from: { node: "route", port: "text" }, to: { node: "ep", port: "mode" } },
  ]);

  ok(S.endpointWiredField(ep, "url") === LOCAL_CHAT,
    "wired url reads Choice.selected, not leftover .out");
  ok(S.endpointWiredField(ep, "mode") === LOCAL_CHAT,
    "wired mode reads the same live selected route");
  ok(S.endpointWiredField(ep, "prompt") == null, "unwired port is null");

  choice.fields.selected = "   ";
  ok(S.endpointWiredField(ep, "url") === BINGO_JSON,
    "whitespace selected falls back to last-run .out");

  choice.fields.selected = "";
  delete choice.out;
  choice.fields.text = "https://example.local/v1";
  ok(S.endpointWiredField(ep, "url") === "https://example.local/v1",
    "text-node fields.text is used when selected is empty");

  delete choice.fields.text;
  choice.out = { text: BINGO_JSON };
  ok(S.endpointWiredField(ep, "url") === BINGO_JSON,
    "stale .out is used only when no live field is set");

  const missing = loadPreview([ep], [
    { from: { node: "gone", port: "text" }, to: { node: "ep", port: "url" } },
  ]);
  ok(missing.endpointWiredField(ep, "url") === "<wired url>",
    "wired-but-missing source stays a placeholder");
}

console.log("• refreshEndpointUI dest follows the live picker");
{
  const choice = {
    id: "route",
    type: "choice",
    fields: { selected: LOCAL_CHAT },
    out: { text: BINGO_JSON },
  };
  const el = epEl();
  const ep = {
    id: "ep",
    type: "endpoint",
    fields: { url: "https://httpbingo.org/post", mode: "json", prompt: "hi" },
    el,
  };
  const S = loadPreview([choice, ep], [
    { from: { node: "route", port: "text" }, to: { node: "ep", port: "url" } },
    { from: { node: "route", port: "text" }, to: { node: "ep", port: "mode" } },
  ]);
  S.refreshEndpointUI(ep);
  ok(el.dest.textContent === "chat · http://127.0.0.1:8787/v1/chat/completions",
    "dest shows parsed localhost chat, not leftover httpbingo json");
  ok(!/httpbingo/i.test(el.dest.textContent + el.req.textContent),
    "preview request card does not name the leftover httpbingo URL");
  ok(/"messages"/.test(el.req.textContent) && !/"text": "hi"/.test(el.req.textContent),
    "preview body is chat messages, not a json-mode echo");
}

if (failures.length) {
  console.error("\ncheck-endpoint-preview: " + failures.length + " failure(s)");
  process.exit(1);
}
console.log("check-endpoint-preview: ok");
