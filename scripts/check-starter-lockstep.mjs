#!/usr/bin/env node
// Guard: the three first-visit postcard copies stay one graph, and sample
// pills only land on canned generator outputs.
//
// #474 replaced the ramen 3-node starter with Place + Vibe → Spec → LLM →
// Postcard. That graph now lives in three places that boot independently:
//   • noodle-graph.json          — hosted first visit (loadDefault)
//   • seed()                     — file:// / fetch-fail fallback
//   • EXAMPLES night-market-postcard — Open workflow from 📚 Examples
// Drift means file:// visitors see a different canvas than nanoodle.com,
// or Open workflow no longer matches the cold-open they just ran.
//
// The same PR gated markDemoResult on modelKind. Join/Choice echo Place/Vibe
// — without the gate a signed-out Run labels the visitor's own text as a
// fake sample. Playwright smoke asserts badge count === 2, but that workflow
// is Chromium-optional. This check drives the real helper offline.
//
// #484 restored fable-five-step as text → Choice → Join → Fable 5.1 (not
// the two-node slop #459 dropped). Pin the topology so a "simplify" cannot
// land untested.
//
// Offline. No browser. No API spend.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { parseExamples } from "./check-example-models.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const STARTER = JSON.parse(readFileSync(join(ROOT, "noodle-graph.json"), "utf8"));

let failed = 0;
const fail = (m) => { console.error("✗ check-starter-lockstep: " + m); failed++; };
const ok = (m) => console.log("  ✓ " + m);

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

function nodeKey(n) {
  return n.name || n.id || n.type;
}

function shape(graph) {
  const byId = Object.fromEntries((graph.nodes || []).map((n) => [n.id, n]));
  const nodes = (graph.nodes || []).map((n) => ({
    name: n.name || "",
    type: n.type,
    model: n.fields?.model ?? null,
    size: n.fields?.size ?? null,
    variations: n.fields?.variations ?? null,
    text: n.fields?.text ?? null,
    options: n.fields?.options ?? null,
    selected: n.fields?.selected ?? null,
    sep: n.fields?.sep ?? null,
    system: n.fields?.system ?? null,
    maxTokens: n.fields?.maxTokens ?? null,
    reasoningEffort: n.fields?.reasoningEffort ?? null,
    color: n.fields?.color ?? null,
  })).sort((a, b) => (a.name + a.type).localeCompare(b.name + b.type));
  const links = (graph.links || []).map((l) => ({
    from: `${nodeKey(byId[l.from.node] || { id: l.from.node })}.${l.from.port}`,
    to: `${nodeKey(byId[l.to.node] || { id: l.to.node })}.${l.to.port}`,
  })).sort((a, b) => (a.from + "→" + a.to).localeCompare(b.from + "→" + b.to));
  return { nodes, links };
}

function eqShape(got, want, label) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) { ok(label); return; }
  fail(label);
  const ga = got.nodes.map((n) => n.name + ":" + n.type).join(", ");
  const wa = want.nodes.map((n) => n.name + ":" + n.type).join(", ");
  if (ga !== wa) console.error("    nodes got  " + ga + "\n    nodes want " + wa);
  const gl = got.links.map((l) => l.from + "→" + l.to).join(" | ");
  const wl = want.links.map((l) => l.from + "→" + l.to).join(" | ");
  if (gl !== wl) console.error("    links got  " + gl + "\n    links want " + wl);
  for (let i = 0; i < Math.max(got.nodes.length, want.nodes.length); i++) {
    const gn = JSON.stringify(got.nodes[i]);
    const wn = JSON.stringify(want.nodes[i]);
    if (gn !== wn) console.error("    node[" + i + "] got  " + gn + "\n    node[" + i + "] want " + wn);
  }
}

function runSeed() {
  const nodes = [];
  const links = [];
  let nid = 1;
  const ctx = {
    undoMuted: false,
    addNode(type, x, y, fields) {
      const n = {
        id: "n" + nid++,
        type,
        x,
        y,
        fields: fields || {},
        el: { querySelector() { return { value: "" }; } },
      };
      nodes.push(n);
      return n;
    },
    connect(from, fport, to, tport) {
      links.push({ from: { node: from, port: fport }, to: { node: to, port: tport } });
    },
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(IDX, "seed") + "\nseed();", ctx, { filename: "index.html#seed" });
  return { nodes, links };
}

// ---- seed() / noodle-graph.json / EXAMPLES postcard lockstep --------------
{
  if (!/function loadDefault\(\)/.test(IDX) || !IDX.includes("noodle-graph.json")) {
    fail("loadDefault must fetch noodle-graph.json for hosted first visit");
  } else ok("loadDefault still fetches noodle-graph.json");
  if (!/if\s*\(\s*!restored\s*\)\s*seed\s*\(\s*\)/.test(IDX)) {
    fail("boot must fall back to seed() when noodle-graph.json cannot load");
  } else ok("boot still falls back to seed() on fetch fail / file://");

  const seeded = runSeed();
  const examples = parseExamples(IDX);
  const postcard = examples.find((e) => e.slug === "night-market-postcard");
  if (!postcard) fail("EXAMPLES is missing night-market-postcard");
  else {
    const want = shape(STARTER);
    eqShape(shape(seeded), want, "seed() fallback matches noodle-graph.json (names, fields, wires)");
    eqShape(shape(postcard.graph), want, "EXAMPLES night-market-postcard matches noodle-graph.json");
  }

  const types = STARTER.nodes.map((n) => n.type);
  if (types.join(",") !== "comment,text,choice,join,llm,image") {
    fail("starter must stay Place+Vibe→Spec→LLM→Postcard (got " + types.join(",") + ")");
  } else ok("starter topology is comment + Place + Vibe + Spec + LLM + image");

  const links = shape(STARTER).links.map((l) => l.from + "→" + l.to);
  for (const wire of [
    "Place.text→Spec.a",
    "Vibe.text→Spec.b",
    "Spec.text→Postcard prompt.prompt",
    "Postcard prompt.text→Postcard.prompt",
  ]) {
    if (!links.includes(wire)) fail("starter is missing wire " + wire);
  }
  if (links.includes("Place.text→Postcard prompt.prompt")) {
    fail("starter regresses to the ramen 3-node (Place wired straight into the LLM)");
  }

  const llm = STARTER.nodes.find((n) => n.type === "llm");
  const img = STARTER.nodes.find((n) => n.type === "image");
  if (llm?.fields?.model !== "z-ai/glm-5.3-flash") {
    fail("starter LLM must stay z-ai/glm-5.3-flash (got " + JSON.stringify(llm?.fields?.model) + ")");
  } else ok("starter LLM is glm-5.3-flash");
  if (img?.fields?.model !== "meta/muse-image/text-to-image" || img?.fields?.size !== "3:2") {
    fail("starter image must stay muse-image at 3:2 (got " + JSON.stringify(img?.fields) + ")");
  } else ok("starter image is muse-image 3:2");
}

// ---- canned sample copy + paid-path deny ---------------------------------
{
  const m = IDX.match(/const DEMO_LLM_TEXT = "([^"]*)";/);
  if (!m) fail("DEMO_LLM_TEXT string not found");
  else {
    const text = m[1];
    if (!/Raohe/i.test(text) || !/night market/i.test(text) || !/postcard/i.test(text)) {
      fail("DEMO_LLM_TEXT must describe the Raohe night-market postcard (got " + text.slice(0, 80) + "…)");
    } else ok("DEMO_LLM_TEXT is the Raohe postcard (matches the starter image)");
    if (/ramen/i.test(text)) fail("DEMO_LLM_TEXT still describes the retired ramen starter");
    else ok("DEMO_LLM_TEXT is not the retired ramen prompt");
  }
  if (!/✉️ sample postcard/.test(IDX)) {
    fail("DEMO_IMG_FALLBACK must label itself as a sample postcard");
  } else ok("file:// image fallback is a labeled sample postcard");
  if (/sample image/.test(IDX) && /🍜/.test(IDX)) {
    fail("DEMO_IMG_FALLBACK still uses the ramen sample-image SVG");
  }

  const ctxBlock = IDX.slice(IDX.indexOf("const DEMO_CTX = {"), IDX.indexOf("\n};", IDX.indexOf("const DEMO_CTX = {")) + 3);
  if (!ctxBlock.includes("const DEMO_CTX = {")) fail("DEMO_CTX not found");
  else {
    if (!/genAudio:\s*demoDeny/.test(ctxBlock) || !/transcribe:\s*demoDeny/.test(ctxBlock)) {
      fail("DEMO_CTX must deny audio/transcribe (postcard starter has no canned clip for those)");
    } else ok("DEMO_CTX denies audio + transcribe (no fake music/speech sample)");
    if (!/async genChat\(/.test(ctxBlock) || !/async genImage\(/.test(ctxBlock)) {
      fail("DEMO_CTX must still can genChat + genImage (the two postcard generators)");
    } else ok("DEMO_CTX still cans the postcard LLM + image");
  }
}

// ---- markDemoResult: only modelKind nodes get the sample pill ------------
{
  const src = extractFn(IDX, "markDemoResult");
  if (!/NODE_TYPES\[n\.type\]\.modelKind/.test(src)) {
    fail("markDemoResult must consult NODE_TYPES[n.type].modelKind (Join/Choice must not get the pill)");
  } else ok("markDemoResult consults modelKind before painting the pill");

  const ctx = {
    NODE_TYPES: {
      text: {},
      choice: {},
      join: {},
      comment: {},
      llm: { modelKind: "chat" },
      image: { modelKind: "image" },
      music: { modelKind: "audio" },
    },
    esc: (s) => s,
    t: (s) => s,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "index.html#markDemoResult" });

  function resultEl(show) {
    let badge = null;
    let html = "";
    return {
      classList: { contains: (c) => c === "show" && show },
      querySelector: (sel) => sel === ".demobadge" ? badge : null,
      insertAdjacentHTML(_pos, s) { html += s; badge = { html: s }; },
      get html() { return html; },
    };
  }
  function drive(type, show) {
    const r = resultEl(show);
    ctx.markDemoResult({ type, el: { querySelector: (sel) => sel === ".result" ? r : null } });
    return r.html;
  }

  for (const type of ["text", "choice", "join", "comment"]) {
    const html = drive(type, true);
    if (html) fail("markDemoResult labeled a " + type + " node (visitor text is not a sample)");
  }
  ok("Join / Choice / text / comment stay unlabeled");

  const llm = drive("llm", true);
  const img = drive("image", true);
  if (!/demobadge/.test(llm) || !/sample result/.test(llm)) {
    fail("markDemoResult must badge the postcard LLM output");
  } else ok("LLM canned output is labeled sample result");
  if (!/demobadge/.test(img) || !/sample result/.test(img)) {
    fail("markDemoResult must badge the postcard image output");
  } else ok("image canned output is labeled sample result");

  if (drive("llm", false)) fail("markDemoResult must not badge a result that is not showing");
  else ok("hidden result pane is not labeled");

  const already = resultEl(true);
  already.querySelector = (sel) => sel === ".demobadge" ? { present: true } : null;
  ctx.markDemoResult({ type: "llm", el: { querySelector: (sel) => sel === ".result" ? already : null } });
  if (already.html) fail("markDemoResult must not stack a second pill");
  else ok("existing pill is not duplicated");
}

// ---- fable-five-step stays Choice-shaped (#484, not two-node slop) --------
{
  const examples = parseExamples(IDX);
  const fable = examples.find((e) => e.slug === "fable-five-step");
  if (!fable) fail("EXAMPLES is missing fable-five-step");
  else {
    const types = fable.graph.nodes.map((n) => n.type);
    if (types.filter((t) => t === "llm").length !== 1 || !types.includes("choice") || !types.includes("join") || !types.includes("text")) {
      fail("fable-five-step must stay text → Choice → Join → LLM (got " + types.join(",") + ")");
    } else ok("fable-five-step is Choice-shaped (not two-node slop)");
    const llm = fable.graph.nodes.find((n) => n.type === "llm");
    if (llm?.fields?.model !== "anthropic/claude-fable-5.1") {
      fail("fable-five-step LLM must stay anthropic/claude-fable-5.1");
    } else ok("fable-five-step still pins Claude Fable 5.1");
    const wires = shape(fable.graph).links.map((l) => l.from + "→" + l.to);
    for (const wire of [
      "Messy dump.text→Dump + shape.a",
      "Shape.text→Dump + shape.b",
      "Dump + shape.text→Plan.prompt",
    ]) {
      if (!wires.includes(wire)) fail("fable-five-step is missing wire " + wire);
    }
    if (wires.includes("Messy dump.text→Plan.prompt")) {
      fail("fable-five-step regresses to dump-straight-into-LLM (Choice/Join bypassed)");
    } else ok("fable-five-step Choice + Join actually feed the plan");
    const choice = fable.graph.nodes.find((n) => n.type === "choice");
    if (!choice?.fields?.options?.includes("exactly five numbered steps") ||
        choice?.fields?.selected !== "exactly five numbered steps") {
      fail("fable-five-step Choice must default to exactly five numbered steps");
    } else ok("fable-five-step Choice defaults to five numbered steps");
  }
}

// ---- custom-endpoint teaching card: Choice path onto host-only URL (#475)
{
  const examples = parseExamples(IDX);
  const card = examples.find((e) => e.slug === "custom-endpoint");
  if (!card) fail("EXAMPLES is missing custom-endpoint");
  else {
    const ep = card.graph.nodes.find((n) => n.type === "endpoint");
    const path = card.graph.nodes.find((n) => n.type === "choice");
    if (ep?.fields?.url !== "https://httpbingo.org") {
      fail("custom-endpoint URL must stay the host only (Choice joins /post|/anything); got " +
        JSON.stringify(ep?.fields?.url));
    } else ok("custom-endpoint URL is the host (path comes from Choice)");
    if (ep?.fields?.mode !== "json") fail("custom-endpoint mode must stay json");
    else ok("custom-endpoint mode stays json");
    if (!path?.fields?.options?.includes("/post") || !path.fields.options.includes("/anything") ||
        path.fields.selected !== "/post") {
      fail("custom-endpoint Path must offer /post and /anything, default /post");
    } else ok("custom-endpoint Path offers /post and /anything");
    const wires = shape(card.graph).links.map((l) => l.from + "→" + l.to);
    if (!wires.includes("Path.text→POST.url") || !wires.includes("Path.text→POST.mode")) {
      fail("custom-endpoint Path must wire both endpoint.url and endpoint.mode (got " + wires.join(" | ") + ")");
    } else ok("custom-endpoint Path retargets both url and mode");
  }
}

if (failed) {
  console.error("check-starter-lockstep: FAIL (" + failed + ")");
  process.exit(1);
}
console.log("✓ starter lockstep (seed / noodle-graph.json / postcard + sample pills + fable Choice + endpoint Path)");
