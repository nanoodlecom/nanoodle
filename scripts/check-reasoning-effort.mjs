#!/usr/bin/env node
// #602: LLM reasoning-effort options come from the NanoGPT catalog
// (reasoning_efforts), not a hardcoded default|low|medium|high list.
// Solar Mini 4 Thinking is none|low|medium|high (defaults to medium);
// Grok adds xhigh. Legacy stored "default" is Nanoodle's omit-sentinel —
// catalogs never list it — and must seed/clamp like applyDimFields, then
// write the field so the billed POST matches the select.
//
// Pins, offline, zero API spend:
//   * normChat passes reasoning_efforts through (or null)
//   * pickReasoningEffort keeps a still-valid value; else medium, else first
//   * leftover "default" is unset when the list has no "default"
//   * refreshLlmOpts writes the clamp and paints catalog options (no fake default)
//   * llmOpts / play runGraph send none|xhigh|max|medium; omit "default"
//   * play fillReasonEffortLists rewrites the select and the graph field
//
// njs/library SETTING_SPECS still ship the old 4-option fallback. Not pinned
// as a failure (same class as other njs leftovers): play RUNTIME + fillReasonEffortLists
// are the exported-app surface.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadEngine, calls } from "./play-engine.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

const SOLAR = ["none", "low", "medium", "high"];
const GROK = ["low", "medium", "high", "xhigh"];
const NO_MED = ["none", "low"];

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

// Template/string-aware (refreshLlmOpts paints <option> via a template literal).
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
function selectedValue(html) {
  const m = String(html).match(/<option value="([^"]*)"[^>]* selected/);
  return m ? m[1] : null;
}

/* ---- editor helpers: pick / opts / normChat / llmOpts / refreshLlmOpts ---- */

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
  const code = [
    extractFn(IDX, "normChat"),
    extractFallback(),
    extractFn(IDX, "reasoningEffortOpts"),
    extractFn(IDX, "pickReasoningEffort"),
    extractFn(IDX, "refreshLlmOpts"),
    extractFn(IDX, "llmOpts"),
  ].join("\n");
  vm.runInContext(code, ctx);
  return ctx;
}

const ed = loadEditor();

{
  const n = ed.normChat({
    id: "upstage/solar-mini-4-thinking",
    name: "Solar Mini 4 Thinking",
    capabilities: { reasoning: true },
    pricing: { prompt: 1, completion: 2 },
    reasoning_efforts: SOLAR,
  });
  if (!n.reasoning) fail("normChat: Solar Mini 4 Thinking must keep reasoning=true");
  else if (JSON.stringify(n.reasoningEfforts) !== JSON.stringify(SOLAR))
    fail(`normChat: must pass reasoning_efforts through, got ${JSON.stringify(n.reasoningEfforts)}`);
  else ok("normChat passes Solar Mini 4 Thinking reasoning_efforts through");
}

{
  const miss = ed.normChat({ id: "plain", capabilities: {}, pricing: {} });
  const empty = ed.normChat({ id: "empty", capabilities: { reasoning: true }, reasoning_efforts: [] });
  const bad = ed.normChat({ id: "bad", capabilities: { reasoning: true }, reasoning_efforts: "high" });
  if (miss.reasoningEfforts != null) fail(`normChat: omitted list must be null, got ${JSON.stringify(miss.reasoningEfforts)}`);
  else if (empty.reasoningEfforts != null) fail(`normChat: empty list must be null, got ${JSON.stringify(empty.reasoningEfforts)}`);
  else if (bad.reasoningEfforts != null) fail(`normChat: non-array list must be null, got ${JSON.stringify(bad.reasoningEfforts)}`);
  else ok("normChat: missing/empty/non-array reasoning_efforts → null");
}

{
  const pick = ed.pickReasoningEffort;
  const cases = [
    [SOLAR, null, "medium", "unset → medium when offered"],
    [SOLAR, "", "medium", "empty → medium when offered"],
    [SOLAR, "default", "medium", "legacy default → medium (catalog has no default)"],
    [SOLAR, "low", "low", "still-valid low stays"],
    [SOLAR, "high", "high", "still-valid high stays"],
    [SOLAR, "xhigh", "medium", "stale xhigh clamps to medium"],
    [GROK, "xhigh", "xhigh", "Grok xhigh stays"],
    [GROK, "default", "medium", "Grok leftover default → medium"],
    [NO_MED, "high", "none", "no medium + stale high → first catalog level"],
    [NO_MED, "low", "low", "no medium + valid low stays"],
    [ed.REASONING_EFFORTS_FALLBACK, "default", "default", "offline fallback keeps default (omit-at-send)"],
    [ed.REASONING_EFFORTS_FALLBACK, null, "medium", "offline unset still prefers medium"],
  ];
  let bad = 0;
  for (const [efforts, cur, want, label] of cases) {
    const got = pick(efforts, cur);
    if (got !== want) { fail(`pickReasoningEffort ${label}: expected ${want}, got ${JSON.stringify(got)}`); bad++; }
  }
  if (!bad) ok("pickReasoningEffort: keep / medium / first / leftover-default");
}

{
  if (JSON.stringify(ed.reasoningEffortOpts({ reasoningEfforts: SOLAR })) !== JSON.stringify(SOLAR))
    fail("reasoningEffortOpts: catalog list must win");
  else if (JSON.stringify(ed.reasoningEffortOpts({ reasoningEfforts: [] })) !== JSON.stringify(ed.REASONING_EFFORTS_FALLBACK))
    fail("reasoningEffortOpts: empty catalog list must fall back");
  else if (JSON.stringify(ed.reasoningEffortOpts(null)) !== JSON.stringify(ed.REASONING_EFFORTS_FALLBACK))
    fail("reasoningEffortOpts: catalog miss must fall back");
  else if (!ed.REASONING_EFFORTS_FALLBACK.includes("default") || ed.REASONING_EFFORTS_FALLBACK[0] !== "default")
    fail(`REASONING_EFFORTS_FALLBACK must start with default, got ${JSON.stringify(ed.REASONING_EFFORTS_FALLBACK)}`);
  else ok("reasoningEffortOpts uses catalog list or default|low|medium|high fallback");
}

function refresh(model, fields, item) {
  for (const k of Object.keys(ed.items)) delete ed.items[k];
  if (item) ed.items[model] = item;
  ed.box.innerHTML = "";
  const n = { type: "llm", fields: { model, ...fields }, el: { querySelector: () => ed.box } };
  ed.refreshLlmOpts(n);
  return n;
}

{
  const n = refresh("solar", { reasoningEffort: "default" }, {
    reasoning: true, reasoningEfforts: SOLAR, structured_output: false,
  });
  if (n.fields.reasoningEffort !== "medium")
    fail(`refreshLlmOpts must write leftover default → medium, got ${JSON.stringify(n.fields.reasoningEffort)}`);
  const opts = optionValues(ed.box.innerHTML);
  if (JSON.stringify(opts) !== JSON.stringify(SOLAR))
    fail(`refreshLlmOpts Solar select must be ${SOLAR}, got ${JSON.stringify(opts)}`);
  else if (opts.includes("default"))
    fail("refreshLlmOpts Solar select must not offer a fake default");
  else if (selectedValue(ed.box.innerHTML) !== "medium")
    fail(`refreshLlmOpts Solar select must mark medium selected, got ${selectedValue(ed.box.innerHTML)}`);
  else ok("refreshLlmOpts: Solar leftover default → medium, catalog options only");
}

{
  const n = refresh("solar", { reasoningEffort: "low" }, {
    reasoning: true, reasoningEfforts: SOLAR, structured_output: false,
  });
  if (n.fields.reasoningEffort !== "low")
    fail(`refreshLlmOpts must keep a still-valid low, got ${JSON.stringify(n.fields.reasoningEffort)}`);
  else if (selectedValue(ed.box.innerHTML) !== "low")
    fail(`refreshLlmOpts must select stored low, got ${selectedValue(ed.box.innerHTML)}`);
  else ok("refreshLlmOpts keeps a still-valid stored effort");
}

{
  const n = refresh("grok", { reasoningEffort: "xhigh" }, {
    reasoning: true, reasoningEfforts: GROK, structured_output: false,
  });
  if (n.fields.reasoningEffort !== "xhigh")
    fail(`refreshLlmOpts must keep Grok xhigh, got ${JSON.stringify(n.fields.reasoningEffort)}`);
  const opts = optionValues(ed.box.innerHTML);
  if (!opts.includes("xhigh") || opts.includes("default") || opts.includes("none"))
    fail(`refreshLlmOpts Grok select must be catalog levels, got ${JSON.stringify(opts)}`);
  else ok("refreshLlmOpts: Grok xhigh stays and is an option");
}

{
  const n = refresh("plain", { reasoningEffort: "high", showThinking: true }, {
    reasoning: false, structured_output: false,
  });
  if ("reasoningEffort" in n.fields || "showThinking" in n.fields)
    fail(`known non-reasoning model must drop effort knobs, got ${JSON.stringify(n.fields)}`);
  else if (/reasoning effort/i.test(ed.box.innerHTML))
    fail("known non-reasoning model must not paint the effort select");
  else ok("refreshLlmOpts strips effort knobs on a known non-reasoning model");
}

{
  const n = refresh("offline-id", { reasoningEffort: "high" }, null);
  if (n.fields.reasoningEffort !== "high")
    fail(`catalog miss must keep a stored effort (permissive), got ${JSON.stringify(n.fields.reasoningEffort)}`);
  const opts = optionValues(ed.box.innerHTML);
  if (JSON.stringify(opts) !== JSON.stringify(ed.REASONING_EFFORTS_FALLBACK))
    fail(`catalog miss must paint the fallback list, got ${JSON.stringify(opts)}`);
  else ok("refreshLlmOpts: catalog miss keeps stored high + fallback options");
}

{
  const send = (effort) => ed.llmOpts({ fields: { reasoningEffort: effort } });
  if (send("none").reasoning_effort !== "none")
    fail(`llmOpts must send "none" (truthy, not the omit-sentinel), got ${JSON.stringify(send("none"))}`);
  else if (send("xhigh").reasoning_effort !== "xhigh")
    fail(`llmOpts must send "xhigh", got ${JSON.stringify(send("xhigh"))}`);
  else if (send("max").reasoning_effort !== "max")
    fail(`llmOpts must send "max", got ${JSON.stringify(send("max"))}`);
  else if (send("medium").reasoning_effort !== "medium")
    fail(`llmOpts must send "medium", got ${JSON.stringify(send("medium"))}`);
  else if ("reasoning_effort" in send("default"))
    fail(`llmOpts must omit legacy default, got ${JSON.stringify(send("default"))}`);
  else if ("reasoning_effort" in send(""))
    fail(`llmOpts must omit empty effort, got ${JSON.stringify(send(""))}`);
  else ok("llmOpts sends catalog levels; omits default / empty");
}

{
  const n = refresh("solar", { reasoningEffort: "default" }, {
    reasoning: true, reasoningEfforts: SOLAR, structured_output: false,
  });
  const o = ed.llmOpts(n);
  if (o.reasoning_effort !== "medium")
    fail(`clamp-then-send must POST medium (not omit leftover default), got ${JSON.stringify(o)}`);
  else ok("refreshLlmOpts + llmOpts: leftover default becomes a billed medium");
}

/* ---- play fillReasonEffortLists (exported-app settings rewrite) ---------- */

function extractRuntimeFn(src, name) {
  const start = src.indexOf("\n  function " + name + "(");
  if (start === -1) throw new Error("function " + name + "() not found in play.html");
  const open = src.indexOf("{", start);
  return src.slice(start + 1, matchBrace(src, open) + 1);
}

async function fillReasonEffortCheck() {
  const el = { tagName: "SELECT", innerHTML: '<option value="default">default</option>' };
  let dirty = 0;
  const CAT = {
    solar: { reasoning_efforts: SOLAR },
    grok: { reasoning_efforts: GROK },
    nmed: { reasoning_efforts: NO_MED },
    plain: { capabilities: { reasoning: true } },
  };
  const ctx = {
    console,
    STATE: { settings: [] },
    document: { getElementById: (id) => (id === "set_0" ? el : null) },
    esc: (s) => String(s),
    checkDirty: () => { dirty++; },
    rawCatItem: async (_kind, id) => CAT[id] || null,
  };
  vm.createContext(ctx);
  new vm.Script(
    extractRuntimeFn(PLAY, "fillReasonEffortLists") + "\nglobalThis.__fill = fillReasonEffortLists;",
    { filename: "play.html#fillReasonEffortLists" },
  ).runInContext(ctx);

  const drive = async (model, cur) => {
    dirty = 0;
    el.innerHTML = '<option value="default">default</option><option value="low">low</option>';
    const nd = { type: "llm", fields: { model, reasoningEffort: cur } };
    ctx.STATE.settings = [{ node: nd, field: "reasoningEffort" }];
    ctx.__fill();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    return nd;
  };

  const solarDef = await drive("solar", "default");
  if (solarDef.fields.reasoningEffort !== "medium")
    fail(`fillReasonEffortLists leftover default → medium, got ${JSON.stringify(solarDef.fields.reasoningEffort)}`);
  const solarOpts = optionValues(el.innerHTML);
  if (JSON.stringify(solarOpts) !== JSON.stringify(SOLAR))
    fail(`fillReasonEffortLists Solar options must be catalog, got ${JSON.stringify(solarOpts)}`);
  else if (selectedValue(el.innerHTML) !== "medium")
    fail(`fillReasonEffortLists Solar must select medium, got ${selectedValue(el.innerHTML)}`);
  else if (dirty < 1)
    fail("fillReasonEffortLists must checkDirty when it rewrites leftover default");
  else ok("fillReasonEffortLists: Solar leftover default → medium + catalog options");

  const solarLow = await drive("solar", "low");
  if (solarLow.fields.reasoningEffort !== "low")
    fail(`fillReasonEffortLists must keep stored low, got ${JSON.stringify(solarLow.fields.reasoningEffort)}`);
  else ok("fillReasonEffortLists keeps a still-valid stored effort");

  const grok = await drive("grok", "xhigh");
  if (grok.fields.reasoningEffort !== "xhigh")
    fail(`fillReasonEffortLists must keep Grok xhigh, got ${JSON.stringify(grok.fields.reasoningEffort)}`);
  else if (!optionValues(el.innerHTML).includes("xhigh"))
    fail(`fillReasonEffortLists Grok options missing xhigh: ${el.innerHTML}`);
  else ok("fillReasonEffortLists: Grok xhigh stays");

  const nmed = await drive("nmed", "high");
  if (nmed.fields.reasoningEffort !== "none")
    fail(`fillReasonEffortLists no-medium stale high → first, got ${JSON.stringify(nmed.fields.reasoningEffort)}`);
  else ok("fillReasonEffortLists: stale high on none|low → none");

  el.innerHTML = '<option value="default">default</option><option value="low">low</option>';
  const plain = await drive("plain", "default");
  if (plain.fields.reasoningEffort !== "default")
    fail(`catalog without reasoning_efforts must keep fallback default, got ${JSON.stringify(plain.fields.reasoningEffort)}`);
  else if (!/value="default"/.test(el.innerHTML))
    fail("catalog without reasoning_efforts must leave the fallback select alone");
  else ok("fillReasonEffortLists: catalog miss / no list keeps fallback options");

  const before = el.innerHTML;
  const nd = { type: "image", fields: { model: "solar", reasoningEffort: "default" } };
  ctx.STATE.settings = [{ node: nd, field: "reasoningEffort" }];
  ctx.__fill();
  await new Promise((r) => setImmediate(r));
  if (nd.fields.reasoningEffort !== "default" || el.innerHTML !== before)
    fail("fillReasonEffortLists must ignore non-llm settings rows");
  else ok("fillReasonEffortLists ignores non-llm rows");
}

await fillReasonEffortCheck();

/* ---- play SETTING_SPECS fallback includes catalog levels ---------------- */

{
  const at = PLAY.indexOf("fillReasonEffortLists rewrites from catalog reasoning_efforts");
  if (at < 0) fail("play SETTING_SPECS fallback comment for fillReasonEffortLists is gone");
  else {
    const window = PLAY.slice(Math.max(0, at - 400), at + 200);
    const need = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "default"];
    const missing = need.filter((k) => !window.includes(`["${k}","${k}"]`));
    if (missing.length) fail(`play SETTING_SPECS fallback missing ${missing.join(", ")}`);
    else ok("play SETTING_SPECS fallback lists none…max (catalog-miss options)");
  }
}

/* ---- play runGraph send path (billed chat POST) -------------------------- */

const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
const chatCalls = () => calls.filter((c) => /\/chat\/completions/.test(c.url));

const app = (() => {
  try { return loadEngine(); }
  catch (e) { fail("could not load play engine: " + (e && e.stack || e)); return null; }
})();

async function playSend(effort) {
  calls.length = 0;
  const g = app.materialize({
    nodes: [node("m1", "llm", { model: "x", prompt: "hi", ...(effort != null ? { reasoningEffort: effort } : {}) })],
    links: [],
  });
  await app.runGraph(g, {});
  const b = chatCalls()[0] && chatCalls()[0].body;
  if (!b) throw new Error("no chat POST");
  return b;
}

if (app) {
  try {
    const none = await playSend("none");
    if (none.reasoning_effort !== "none")
      fail(`play runGraph must send reasoning_effort:"none", got ${JSON.stringify(none.reasoning_effort)}`);
    else ok('play runGraph forwards reasoning_effort "none"');

    const xhigh = await playSend("xhigh");
    if (xhigh.reasoning_effort !== "xhigh")
      fail(`play runGraph must send reasoning_effort:"xhigh", got ${JSON.stringify(xhigh.reasoning_effort)}`);
    else ok('play runGraph forwards reasoning_effort "xhigh"');

    const max = await playSend("max");
    if (max.reasoning_effort !== "max")
      fail(`play runGraph must send reasoning_effort:"max", got ${JSON.stringify(max.reasoning_effort)}`);
    else ok('play runGraph forwards reasoning_effort "max"');

    const med = await playSend("medium");
    if (med.reasoning_effort !== "medium")
      fail(`play runGraph must send reasoning_effort:"medium", got ${JSON.stringify(med.reasoning_effort)}`);
    else ok('play runGraph forwards reasoning_effort "medium"');

    const def = await playSend("default");
    if ("reasoning_effort" in def)
      fail(`play runGraph must omit leftover default, got ${JSON.stringify(def.reasoning_effort)}`);
    else ok("play runGraph omits leftover reasoningEffort:default");
  } catch (e) {
    fail("play runGraph send-path threw: " + (e && e.message || e));
  }
}

if (failed) {
  process.stderr.write(`\n✗ reasoning-effort: ${failed} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\n✓ reasoning-effort: catalog clamp + send path pinned on editor and play.\n");
