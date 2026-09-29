#!/usr/bin/env node
// #602 write-back of reasoningEffort must only snap when the catalog list is
// authoritative. The offline fallback (default|low|medium|high) used to treat
// xhigh / none / minimal / max as stale and write "medium". Boot calls
// refreshAllPrices (applyGraphData, OAuth resume then save()) BEFORE the chat
// catalog lands, so a Grok/Muse graph with xhigh became medium, autosave
// persisted it, and the later catalog arrival could not restore xhigh because
// medium is a valid catalog level.
//
// Pins, offline, zero API spend:
//   * catalog miss keeps stored xhigh/none/minimal/max (and high)
//   * a known reasoning model with no reasoningEfforts list also keeps them
//   * a catalogued Solar list still clamps leftover xhigh / default → medium
//   * a catalogued Grok list keeps xhigh
//   * play fillReasonEffortLists ignores a stale catalog callback after a model swap
//
// Lifts the shipped functions from index.html / play.html into node:vm.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

const SOLAR = ["none", "low", "medium", "high"];
const GROK = ["low", "medium", "high", "xhigh"];

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

function optionValues(html) {
  return [...String(html).matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
}
function selectedValue(html) {
  const m = String(html).match(/<option value="([^"]*)"[^>]* selected/);
  return m ? m[1] : null;
}

function loadEditor() {
  const items = {};
  const box = { innerHTML: "", querySelector() { return null; }, querySelectorAll() { return []; } };
  const ctx = {
    console, Math, String, Array, Number,
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
  const fb = IDX.match(/const REASONING_EFFORTS_FALLBACK = (\[[^\]]+\])/);
  if (!fb) throw new Error("REASONING_EFFORTS_FALLBACK not found");
  vm.runInContext([
    "var REASONING_EFFORTS_FALLBACK = " + fb[1] + ";",
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
  const n = refresh("offline-id", { reasoningEffort: "xhigh" }, null);
  if (n.fields.reasoningEffort !== "xhigh")
    fail(`catalog miss must keep stored xhigh (boot / OAuth resume), got ${JSON.stringify(n.fields.reasoningEffort)}`);
  else if (ed.llmOpts(n).reasoning_effort !== "xhigh")
    fail(`catalog-miss send must still POST xhigh, got ${JSON.stringify(ed.llmOpts(n))}`);
  else if (!optionValues(ed.box.innerHTML).includes("xhigh") || selectedValue(ed.box.innerHTML) !== "xhigh")
    fail(`catalog miss must keep xhigh pickable/selected, opts=${JSON.stringify(optionValues(ed.box.innerHTML))} sel=${selectedValue(ed.box.innerHTML)}`);
  else ok("catalog miss keeps stored xhigh (does not write medium)");
}

{
  const kept = [];
  for (const v of ["none", "minimal", "max", "high"]) {
    const n = refresh("offline-id", { reasoningEffort: v }, null);
    if (n.fields.reasoningEffort !== v) kept.push(`${v}→${n.fields.reasoningEffort}`);
  }
  if (kept.length) fail(`catalog miss must keep catalog-only / fallback efforts, drifted: ${kept.join(", ")}`);
  else ok("catalog miss keeps none / minimal / max / high");
}

{
  // Pre-#602 cache (or a reasoning model whose catalog row has no list yet):
  // it.reasoning is true, reasoningEfforts is missing — must not snap via fallback.
  const n = refresh("grok-cached", { reasoningEffort: "xhigh" }, {
    reasoning: true, reasoningEfforts: null, structured_output: false,
  });
  if (n.fields.reasoningEffort !== "xhigh")
    fail(`known reasoning model without a list must keep xhigh, got ${JSON.stringify(n.fields.reasoningEffort)}`);
  else ok("reasoning model with no reasoningEfforts list keeps stored xhigh");
}

{
  const n = refresh("solar", { reasoningEffort: "xhigh" }, {
    reasoning: true, reasoningEfforts: SOLAR, structured_output: false,
  });
  if (n.fields.reasoningEffort !== "medium")
    fail(`catalogued Solar must still clamp leftover xhigh → medium, got ${JSON.stringify(n.fields.reasoningEffort)}`);
  else ok("catalogued Solar still clamps leftover xhigh → medium");
}

{
  const n = refresh("solar", { reasoningEffort: "default" }, {
    reasoning: true, reasoningEfforts: SOLAR, structured_output: false,
  });
  if (n.fields.reasoningEffort !== "medium")
    fail(`catalogued Solar leftover default → medium, got ${JSON.stringify(n.fields.reasoningEffort)}`);
  else ok("catalogued Solar leftover default → medium");
}

{
  const n = refresh("grok", { reasoningEffort: "xhigh" }, {
    reasoning: true, reasoningEfforts: GROK, structured_output: false,
  });
  if (n.fields.reasoningEffort !== "xhigh")
    fail(`catalogued Grok must keep xhigh, got ${JSON.stringify(n.fields.reasoningEffort)}`);
  else if (!optionValues(ed.box.innerHTML).includes("xhigh"))
    fail("catalogued Grok select must list xhigh");
  else ok("catalogued Grok keeps xhigh");
}

{
  const n = refresh("plain", { reasoningEffort: "xhigh", showThinking: true }, {
    reasoning: false, structured_output: false,
  });
  if ("reasoningEffort" in n.fields || "showThinking" in n.fields)
    fail(`known non-reasoning model must drop effort knobs, got ${JSON.stringify(n.fields)}`);
  else ok("known non-reasoning model still drops effort knobs");
}

{
  // Boot sequence: miss (or cache-without-list) then catalog arrival must restore
  // only when we DID NOT write medium. Simulate the two refreshAllPrices sweeps.
  const n = refresh("grok", { reasoningEffort: "xhigh" }, null);
  if (n.fields.reasoningEffort !== "xhigh")
    fail(`first sweep (empty catalog) already clobbered xhigh → ${JSON.stringify(n.fields.reasoningEffort)}`);
  else {
    ed.items.grok = { reasoning: true, reasoningEfforts: GROK, structured_output: false };
    ed.refreshLlmOpts(n);
    if (n.fields.reasoningEffort !== "xhigh")
      fail(`catalog-arrival sweep lost xhigh, got ${JSON.stringify(n.fields.reasoningEffort)}`);
    else ok("empty-catalog sweep + later Grok catalog still leaves xhigh");
  }
}

/* ---- play: stale fillReasonEffortLists callback after a model swap -------- */

function extractRuntimeFn(src, name) {
  const start = src.indexOf("\n  function " + name + "(");
  if (start === -1) throw new Error("function " + name + "() not found in play.html");
  const open = src.indexOf("{", start);
  return src.slice(start + 1, matchBrace(src, open) + 1);
}

async function fillReasonStaleCheck() {
  const el = { tagName: "SELECT", innerHTML: "" };
  let dirty = 0;
  const pending = {};
  const ctx = {
    console,
    STATE: { settings: [] },
    document: { getElementById: (id) => (id === "set_0" ? el : null) },
    esc: (s) => String(s),
    checkDirty: () => { dirty++; },
    rawCatItem: (_kind, id) => new Promise((resolve) => { pending[id] = resolve; }),
  };
  vm.createContext(ctx);
  new vm.Script(
    extractRuntimeFn(PLAY, "fillReasonEffortLists") + "\nglobalThis.__fill = fillReasonEffortLists;",
    { filename: "play.html#fillReasonEffortLists" },
  ).runInContext(ctx);

  const nd = { type: "llm", fields: { model: "grok", reasoningEffort: "xhigh" } };
  ctx.STATE.settings = [{ node: nd, field: "reasoningEffort" }];
  ctx.__fill();
  nd.fields.model = "solar";
  nd.fields.reasoningEffort = "medium";
  ctx.__fill();
  if (!pending.grok || !pending.solar) {
    fail("fillReasonEffortLists did not start catalog fetches for both models");
    return;
  }
  pending.solar({ reasoning_efforts: SOLAR });
  await new Promise((r) => setImmediate(r));
  pending.grok({ reasoning_efforts: GROK }); // late — must not rewrite Solar's node
  await new Promise((r) => setImmediate(r));
  if (nd.fields.model !== "solar")
    fail(`stale-callback test corrupted the model id, got ${nd.fields.model}`);
  else if (nd.fields.reasoningEffort !== "medium")
    fail(`stale Grok catalog must not rewrite Solar's effort, got ${JSON.stringify(nd.fields.reasoningEffort)}`);
  else if (optionValues(el.innerHTML).includes("xhigh"))
    fail("stale Grok catalog must not paint xhigh onto a Solar node");
  else ok("play fillReasonEffortLists ignores a stale catalog callback after a model swap");
}

await fillReasonStaleCheck();

if (failed) {
  console.error("\ncheck-reasoning-effort: " + failed + " failure(s)");
  process.exit(1);
}
console.log("\ncheck-reasoning-effort: OK");
