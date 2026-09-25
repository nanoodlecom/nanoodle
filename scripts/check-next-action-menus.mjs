#!/usr/bin/env node
/**
 * #613 leftovers the production PR's check-next-action-hints does not pin.
 *
 * The shipped follow-up commits were: (1) the model picker dropped nodeType so
 * set:model never marked a row; (2) while dragging, the model-id socket won
 * over the prompt. This check lifts the REAL editor helpers out of index.html
 * and runs them in node:vm. No browser, no network, no inference.
 *
 * Invariants:
 *   1. markLikelyPort is quiet without a wire hint / targets / anchor.
 *   2. On one node, prompt ranks above the model-id override.
 *   3. The selected node wins over a newer other node.
 *   4. A target that wouldCycle is skipped; the next preferred port is used.
 *   5. modelHintId requires picker.nodeType (the shipped miss).
 *   6. liftPinnedModel moves the pinned id to the front and no-ops otherwise.
 *   7. addHintMap drops unknown types and de-dupes.
 *   8. renderAddList does not repeat a Suggested type in Recent / Start here / groups.
 */
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
function extractFunction(src, name) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}() in index.html`);
  const open = src.indexOf("{", m.index);
  return src.slice(m.index, matchBrace(src, open) + 1);
}

const failures = [];
const ok = (c, m) => { if (!c) failures.push(m); };

let markLikelyPortFn, portLikelyRankFn, wouldCycleFn;
let modelHintIdFn, liftPinnedModelFn, nextActionHintsFn;
let addHintMapFn, nodeRowFn, renderAddListFn, addMatchRankFn;
try {
  markLikelyPortFn = extractFunction(SRC, "markLikelyPort");
  portLikelyRankFn = extractFunction(SRC, "portLikelyRank");
  wouldCycleFn = extractFunction(SRC, "wouldCycle");
  modelHintIdFn = extractFunction(SRC, "modelHintId");
  liftPinnedModelFn = extractFunction(SRC, "liftPinnedModel");
  nextActionHintsFn = extractFunction(SRC, "nextActionHints");
  addHintMapFn = extractFunction(SRC, "addHintMap");
  nodeRowFn = extractFunction(SRC, "nodeRow");
  renderAddListFn = extractFunction(SRC, "renderAddList");
  addMatchRankFn = extractFunction(SRC, "addMatchRank");
} catch (e) {
  process.stderr.write("✗ check-next-action-menus could not extract: " + e.message + "\n");
  process.exit(1);
}

function portEl(node, name, { disabled = false, dir = "in" } = {}) {
  return {
    dataset: { node, port: name, dir, ptype: "text" },
    classList: { contains: (c) => !!(disabled && c === "disabled") },
  };
}

function likely(opts) {
  const ctx = {
    selected: opts.selectedId ? { id: opts.selectedId } : null,
    graph: {
      nodes: (opts.nodeIds || []).map((id) => ({ id })),
      links: opts.links || [],
    },
    nextActionHints: () => (opts.hints === undefined ? { confident: true, wire: { reason: "often wired next" } } : opts.hints),
  };
  vm.createContext(ctx);
  new vm.Script(
    wouldCycleFn + "\n" + portLikelyRankFn + "\n" + markLikelyPortFn + "\n;globalThis.__fn = markLikelyPort;",
    { filename: "index.html#markLikelyPort" }
  ).runInContext(ctx);
  return ctx.__fn(opts.targets, opts.anchor);
}

const WIRE = { confident: true, wire: { reason: "often wired next" } };
const srcOut = portEl("src", "text", { dir: "out" });

// 1. quiet without a wire hint / targets / anchor
ok(likely({ hints: null, targets: [portEl("a", "prompt")], anchor: srcOut }) === null, "no hints → no likely port");
ok(likely({ hints: { confident: true, setModel: {} }, targets: [portEl("a", "prompt")], anchor: srcOut }) === null, "set:model is not a wire ring");
ok(likely({ hints: WIRE, targets: [], anchor: srcOut }) === null, "empty targets → null");
ok(likely({ hints: WIRE, targets: [portEl("a", "prompt")], anchor: null }) === null, "missing anchor → null");

// 2. prompt over model-id on the same node (shipped #613 follow-up)
{
  const prompt = portEl("img", "prompt");
  const model = portEl("img", "model");
  const extra = portEl("img", "system");
  const hit = likely({
    hints: WIRE,
    nodeIds: ["src", "img"],
    targets: [model, extra, prompt],
    anchor: srcOut,
  });
  ok(hit === prompt, "prompt ranks above model-id (and other text sockets) on the same node");
  const onlyModel = likely({
    hints: WIRE,
    nodeIds: ["src", "img"],
    targets: [model],
    anchor: srcOut,
  });
  ok(onlyModel === model, "a lone model-id socket is still a legal fallback");
}

// 3. selected node beats a newer other node
{
  const oldP = portEl("old", "prompt");
  const selP = portEl("sel", "prompt");
  const newP = portEl("new", "prompt");
  const hit = likely({
    hints: WIRE,
    selectedId: "sel",
    nodeIds: ["old", "sel", "new"],
    targets: [oldP, newP, selP],
    anchor: srcOut,
  });
  ok(hit === selP, "selected node is preferred over the newest other node");
  const newest = likely({
    hints: WIRE,
    nodeIds: ["old", "sel", "new"],
    targets: [oldP, newP, selP],
    anchor: srcOut,
  });
  ok(newest === newP, "with no selection the newest other node is preferred");
}

// 4. cycle skip → next preferred
{
  const selP = portEl("sel", "prompt");
  const newP = portEl("new", "prompt");
  const hit = likely({
    hints: WIRE,
    selectedId: "sel",
    nodeIds: ["src", "sel", "new"],
    links: [{ from: { node: "sel", port: "out" }, to: { node: "src", port: "prompt" } }],
    targets: [selP, newP],
    anchor: srcOut,
  });
  ok(hit === newP, "a cycle-making selected target is skipped for the next preferred port");
}

// disabled ports are not candidates
{
  const dead = portEl("img", "prompt", { disabled: true });
  const live = portEl("other", "prompt");
  const hit = likely({
    hints: WIRE,
    selectedId: "img",
    nodeIds: ["src", "img", "other"],
    targets: [dead, live],
    anchor: srcOut,
  });
  ok(hit === live, "disabled ports are skipped");
}

// 5–6. modelHintId + liftPinnedModel
function pickerHarness(opts) {
  const ctx = {
    picker: opts.picker,
    nextActionHints: () => opts.hints,
    defModelFor: (t) => (opts.def && opts.def[t]) || "",
  };
  vm.createContext(ctx);
  new vm.Script(
    modelHintIdFn + "\n" + liftPinnedModelFn + "\n;globalThis.__id = modelHintId; globalThis.__lift = liftPinnedModel;",
    { filename: "index.html#modelHintId" }
  ).runInContext(ctx);
  return { id: ctx.__id(), lift: ctx.__lift };
}
{
  const set = { confident: true, setModel: { reason: "pick a model next" } };
  ok(pickerHarness({ hints: set, picker: { current: "flux", nodeType: "image" } }).id === "flux", "pin the current model when nodeType is set");
  ok(pickerHarness({ hints: set, picker: { current: "", nodeType: "image" }, def: { image: "flux-default" } }).id === "flux-default", "fall back to defModelFor when current is empty");
  ok(pickerHarness({ hints: set, picker: { current: "flux" } }).id === "", "no nodeType → no pin (the shipped picker miss)");
  ok(pickerHarness({ hints: set, picker: null }).id === "", "closed picker → no pin");
  ok(pickerHarness({ hints: { confident: true, adds: [{ type: "text" }] }, picker: { current: "flux", nodeType: "image" } }).id === "", "without set:model the picker is unmarked");
  const { lift } = pickerHarness({ hints: null, picker: null });
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  ok(lift(list, "b").map((m) => m.id).join(",") === "b,a,c", "liftPinnedModel moves the pin to the front");
  ok(lift(list, "a") === list, "already-first pin is a no-op");
  ok(lift(list, "z") === list, "missing id is a no-op");
}

// nextActionHints: peek throw / not confident → null
{
  const ctx = { window: { __nextAction: { peek: () => { throw new Error("boom"); } } } };
  vm.createContext(ctx);
  new vm.Script(nextActionHintsFn + "\n;globalThis.__h = nextActionHints;", { filename: "index.html#nextActionHints" }).runInContext(ctx);
  ok(ctx.__h() === null, "peek throw must not break menu render");
  ctx.window.__nextAction.peek = () => ({ confident: false, adds: [{ type: "text" }] });
  ok(ctx.__h() === null, "a non-confident cache is treated as no hint");
  const payload = { confident: true, adds: [{ type: "text" }] };
  ctx.window.__nextAction.peek = () => payload;
  ok(ctx.__h() === payload, "a confident cache is passed through");
  ctx.window.__nextAction = null;
  ok(ctx.__h() === null, "missing engine is quiet");
}

// 7–8. addHintMap + renderAddList no-dup
{
  const NODE_TYPES = {
    text: { title: "Text", desc: "words", em: "T", group: "Inputs" },
    llm: { title: "LLM", desc: "chat", em: "L", group: "Text" },
    image: { title: "Image", desc: "draw", em: "I", group: "Image" },
  };
  const addlist = { innerHTML: "", querySelector: () => ({ classList: { add() {} } }) };
  const addhint = { hidden: false };
  const ctx = {
    NODE_TYPES,
    ADD_GROUPS: ["Inputs", "Text", "Image"],
    ADD_STARTERS: ["text", "llm", "image"],
    addRecent: [],
    LANG: "en",
    esc: (s) => String(s ?? ""),
    t: (s) => s,
    translateTree: () => {},
    $: (id) => (id === "addlist" ? addlist : id === "addpop" ? { querySelector: () => addhint } : null),
    nextActionHints: () => ({
      confident: true,
      adds: [
        { type: "text", reason: "common first node" },
        { type: "ghost", reason: "nope" },
        { type: "text", reason: "dup" },
        { type: "image", reason: "often added next" },
      ],
    }),
  };
  vm.createContext(ctx);
  new vm.Script(
    addHintMapFn + "\n" + nodeRowFn + "\n" + addMatchRankFn + "\n" + renderAddListFn +
      "\n;globalThis.__map = addHintMap; globalThis.__render = renderAddList;",
    { filename: "index.html#addHintMap" }
  ).runInContext(ctx);
  const map = ctx.__map();
  ok(map && map.order.join(",") === "text,image", `addHintMap order, got ${map && map.order}`);
  ok(!map.byType.ghost, "unknown editor types are dropped");
  ok(map.byType.text.reason === "common first node", "first occurrence wins on de-dupe");

  ctx.__render("");
  const html = addlist.innerHTML;
  const textHits = html.match(/data-type="text"/g) || [];
  ok(textHits.length === 1, `Suggested text must appear once, got ${textHits.length} in ${html}`);
  ok(/<div class="grp">Suggested<\/div>/.test(html), "Suggested group is painted");
  const afterSuggested = html.split("Suggested")[1] || "";
  ok(!/Start here[\s\S]*data-type="text"/.test(html), "Start here must not repeat a Suggested type");
  ok(!/class="grp">Inputs[\s\S]*data-type="text"/.test(html), "catalog groups must not repeat a Suggested type");
  ok(afterSuggested.includes("data-type=\"image\""), "image stays in Suggested");

  ctx.addRecent = ["text", "llm"];
  ctx.__render("");
  const recentHtml = addlist.innerHTML;
  ok(/<div class="grp">Recent<\/div>/.test(recentHtml), "Recent tier still appears for the leftover type");
  ok((recentHtml.match(/data-type="text"/g) || []).length === 1, "Recent must not duplicate Suggested text");
  ok(recentHtml.includes('data-type="llm"'), "unsuggested recent llm is kept");

  ctx.__render("text");
  ok(addlist.innerHTML.includes("suggested") && addlist.innerHTML.includes('data-type="text"'), "search hits still carry the Suggested mark");
}

if (failures.length) {
  process.stderr.write("✗ next-action menu leftovers regressed:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ next-action-menus: prompt>model, selected-first, cycle-skip, picker.nodeType, add-menu no-dup\n");
