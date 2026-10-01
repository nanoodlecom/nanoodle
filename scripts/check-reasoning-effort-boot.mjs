#!/usr/bin/env node
// Leftover #633 boot edges after check-reasoning-effort.mjs.
// That PR already pins catalog-miss keep of xhigh/none/minimal/max on the
// editor helper, the two-sweep restore, Solar still clamping leftover
// xhigh, and play fillReasonEffortLists when a catalog list is present.
// This file pins the other half: leftover "default"/empty must not become
// billed medium before the catalog lands; play catalog-null / thrown fetch
// must keep stored catalog-only efforts; applyGraphData still sweeps
// refreshLlmOpts so a share/#g= / OAuth resume cannot skip the keep.
// Offline, zero API spend. New file so it does not collide with #618.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

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
function extractFn(src, name) {
  const m = new RegExp("(async )?function " + name + "\\s*\\(").exec(src);
  if (!m) throw new Error(name + "() not found");
  const open = src.indexOf("{", m.index);
  return src.slice(m.index, matchBrace(src, open) + 1);
}
function extractFallback() {
  const m = IDX.match(/const REASONING_EFFORTS_FALLBACK = (\[[^\]]+\])/);
  if (!m) throw new Error("REASONING_EFFORTS_FALLBACK not found");
  return "var REASONING_EFFORTS_FALLBACK = " + m[1];
}
function optionValues(html) {
  return [...String(html).matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
}
function extractRuntimeFn(src, name) {
  const start = src.indexOf("\n  function " + name + "(");
  if (start === -1) throw new Error("function " + name + "() not found in play.html");
  const open = src.indexOf("{", start);
  return src.slice(start + 1, matchBrace(src, open) + 1);
}

function loadEditor() {
  const items = {};
  const box = { innerHTML: "", querySelector() { return null; }, querySelectorAll() { return []; } };
  const ctx = {
    console, Math, String, Array, Number,
    EST: { llmInTokens: 1000, llmOutTokens: 500 },
    items,
    box,
    catItem(_kind, id) { return items[id] || null; },
    tempLocked() { return false; },
    esc(s) { return String(s); },
    t(s) { return s; },
    translateTree() {},
    save() {},
    optsHTML(pairs, cur) {
      return pairs.map(([v, l]) =>
        `<option value="${v}"${v === cur ? " selected" : ""}>${l}</option>`).join("");
    },
  };
  vm.createContext(ctx);
  vm.runInContext([
    extractFn(IDX, "normChat"),
    extractFallback(),
    extractFn(IDX, "reasoningEffortOpts"),
    extractFn(IDX, "pickReasoningEffort"),
    extractFn(IDX, "refreshLlmOpts"),
    extractFn(IDX, "llmOpts"),
  ].join("\n"), ctx);
  return ctx;
}

const ed = loadEditor();
function refresh(model, fields, item) {
  for (const k of Object.keys(ed.items)) delete ed.items[k];
  if (item) ed.items[model] = item;
  ed.box.innerHTML = "";
  const n = { type: "llm", fields: { model, ...fields }, el: { querySelector: () => ed.box } };
  ed.refreshLlmOpts(n);
  return n;
}

{
  const n = refresh("offline-id", { reasoningEffort: "default" }, null);
  if (n.fields.reasoningEffort !== "default")
    fail(`catalog-miss leftover default must stay default (not billed medium), got ${JSON.stringify(n.fields.reasoningEffort)}`);
  else if ("reasoning_effort" in ed.llmOpts(n))
    fail(`catalog-miss leftover default must still omit the billed field, got ${JSON.stringify(ed.llmOpts(n))}`);
  else ok("catalog miss keeps leftover default (does not write medium)");
}

{
  const n = refresh("offline-id", {}, null);
  if ("reasoningEffort" in n.fields && n.fields.reasoningEffort != null && n.fields.reasoningEffort !== "")
    fail(`catalog-miss empty field must stay unset, got ${JSON.stringify(n.fields.reasoningEffort)}`);
  else ok("catalog miss does not invent an effort on an empty field");
}

{
  const n = refresh("grok-cached", { reasoningEffort: "xhigh" }, {
    reasoning: true, reasoningEfforts: [], structured_output: false,
  });
  if (n.fields.reasoningEffort !== "xhigh")
    fail(`empty reasoningEfforts list must keep xhigh (not catalogued), got ${JSON.stringify(n.fields.reasoningEffort)}`);
  else if (!optionValues(ed.box.innerHTML).includes("xhigh"))
    fail("empty reasoningEfforts list must still offer stored xhigh");
  else ok("empty reasoningEfforts array keeps stored xhigh (treated as miss)");
}

{
  const n = refresh("note", { reasoningEffort: "xhigh" }, null);
  n.type = "comment";
  const before = JSON.stringify(n.fields);
  ed.refreshLlmOpts(n);
  if (JSON.stringify(n.fields) !== before)
    fail(`non-llm refreshLlmOpts must be a no-op, got ${JSON.stringify(n.fields)}`);
  else ok("refreshLlmOpts ignores a non-llm node");
}

{
  const sweep = IDX.match(/function refreshAllPrices\(\)\{[^}]+\}/);
  if (!sweep || !sweep[0].includes("refreshLlmOpts(n)"))
    fail("refreshAllPrices must still sweep refreshLlmOpts");
  else ok("refreshAllPrices still sweeps refreshLlmOpts");

  const applyAt = IDX.indexOf("function applyGraphData(");
  const applyEnd = applyAt >= 0 ? IDX.indexOf("\nfunction ", applyAt + 10) : -1;
  const apply = applyAt >= 0 ? IDX.slice(applyAt, applyEnd > applyAt ? applyEnd : applyAt + 4000) : "";
  if (!/refreshAllPrices\(\)/.test(apply))
    fail("applyGraphData must still call refreshAllPrices (boot / #g= / OAuth resume)");
  else ok("applyGraphData still calls refreshAllPrices");
}

async function playCatalogMissKeeps() {
  const el = { tagName: "SELECT", innerHTML: '<option value="default">default</option><option value="low">low</option>' };
  const drive = async (model, cur, fetchImpl) => {
    el.innerHTML = '<option value="default">default</option><option value="low">low</option>';
    const nd = { type: "llm", fields: { model, reasoningEffort: cur } };
    const ctx = {
      console,
      STATE: { settings: [{ node: nd, field: "reasoningEffort" }] },
      document: { getElementById: (id) => (id === "set_0" ? el : null) },
      esc: (s) => String(s),
      checkDirty: () => { nd.__dirty = (nd.__dirty || 0) + 1; },
      rawCatItem: fetchImpl,
    };
    vm.createContext(ctx);
    new vm.Script(
      extractRuntimeFn(PLAY, "fillReasonEffortLists") + "\nglobalThis.__fill = fillReasonEffortLists;",
      { filename: "play.html#fillReasonEffortLists" },
    ).runInContext(ctx);
    ctx.__fill();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    return nd;
  };

  const kept = [];
  for (const v of ["xhigh", "none", "minimal", "max"]) {
    const n = await drive("grok", v, async () => null);
    if (n.fields.reasoningEffort !== v) kept.push(`${v}→${n.fields.reasoningEffort}`);
    if (n.__dirty) kept.push(`${v} dirtied`);
  }
  if (kept.length) fail(`play catalog-null must keep stored efforts, drifted: ${kept.join(", ")}`);
  else ok("play fillReasonEffortLists catalog-null keeps xhigh/none/minimal/max");

  const threw = await drive("grok", "xhigh", async () => { throw new Error("catalog down"); });
  if (threw.fields.reasoningEffort !== "xhigh")
    fail(`play catalog throw must keep xhigh, got ${JSON.stringify(threw.fields.reasoningEffort)}`);
  else if (threw.__dirty)
    fail("play catalog throw must not checkDirty");
  else ok("play fillReasonEffortLists catalog throw keeps stored xhigh");

  const renderAt = PLAY.indexOf("fillReasonEffortLists(); // rewrite Reasoning effort");
  if (renderAt < 0) fail("play settings render must still call fillReasonEffortLists");
  else ok("play settings render still calls fillReasonEffortLists");
}

await playCatalogMissKeeps();

if (failed) {
  console.error(`\n${failed} leftover #633 boot pin(s) failed`);
  process.exit(1);
}
console.log("✓ reasoning-effort-boot leftover pins");
