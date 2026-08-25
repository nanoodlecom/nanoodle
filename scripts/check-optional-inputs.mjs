#!/usr/bin/env node
// Author-set required/optional on input nodes (fields.optional).
//
// Builders tick "optional input" on Text / Image / Audio / Video so an app or agent
// may leave that slot empty. The flag rides normal fields serialization (saves, share
// links, exports, nanoodle-js, MCP). A regression here is a paid-path bug:
//   • required empty media proceeds → NanoGPT gets a blank/garbage body (or a confusing 4xx)
//   • optional empty media throws → a graph the author marked skippable dead-ends
//   • HTML/JSON often persist the checkbox as the string "true", so a boolean-only
//     check would silently treat every exported optional input as required
//
// Three copies must agree: editor optNode (index.html), play RUNTIME optNode, and
// the library optionalNode() inside play.html's njs-engine block. This drives the
// REAL play NODE_TYPES / deriveInputs (play-engine.mjs) and extracts the predicates
// so a one-sided edit fails. Offline, no network, no API spend.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "./play-engine.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

const failures = [];
const fail = (m) => failures.push(m);
const ok = (m) => process.stdout.write("  ✓ " + m + "\n");

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

function extractFn(src, name, where) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = sig.exec(src);
  if (!m) throw new Error(`${where}: function ${name}() not found`);
  const open = src.indexOf("{", m.index);
  const close = matchBrace(src, open);
  return src.slice(m.index, close + 1);
}

function loadPred(src, kind, where) {
  if (kind === "arrow") {
    const m = src.match(/const optNode = \(n\)=>[^;]+;/);
    if (!m) throw new Error(`${where}: const optNode arrow not found`);
    return new Function(m[0] + "\nreturn optNode;")();
  }
  const fn = extractFn(src, kind === "optionalNode" ? "optionalNode" : "optNode", where);
  return new Function(fn + "\nreturn " + (kind === "optionalNode" ? "optionalNode" : "optNode") + ";")();
}

// ---- 1. predicates: editor / play RUNTIME / njs-engine agree on the persist contract
const preds = {
  "index.html optNode": loadPred(IDX, "arrow", "index.html"),
  "play.html RUNTIME optNode": loadPred(PLAY, "fn", "play.html RUNTIME"),
  "play.html njs optionalNode": loadPred(PLAY, "optionalNode", "play.html njs"),
};

// HTML checkboxes and JSON round-trips persist the string "true". Everything else
// (including "TRUE" / 1 / "yes") must stay required — a loose truthy check would
// let a typo or a leftover "optional":"yes" skip a slot the author meant to require.
const CASES = [
  [true, true, "boolean true"],
  ["true", true, "string \"true\" (share/export persist)"],
  [false, false, "boolean false"],
  ["false", false, "string \"false\""],
  [undefined, false, "missing field"],
  [null, false, "null"],
  [1, false, "number 1"],
  ["yes", false, "string \"yes\""],
  ["TRUE", false, "string \"TRUE\" (case-sensitive)"],
  ["", false, "empty string"],
];

for (const [val, want, desc] of CASES) {
  const node = { id: "n1", fields: { optional: val } };
  const got = Object.entries(preds).map(([name, fn]) => [name, !!fn(node)]);
  const bad = got.filter(([, g]) => g !== want);
  if (bad.length) fail(`optional predicate @ ${desc}: want ${want}, drifted: ${bad.map(([n, g]) => `${n}=${g}`).join(", ")}`);
  else ok(`optional predicate: ${desc} → ${want} (3 twins)`);
}

// ---- 2. editor + play run() bodies still consult optNode before throwing
for (const file of ["index.html", "play.html"]) {
  const src = file === "index.html" ? IDX : PLAY;
  for (const media of ["image", "audio", "video"]) {
    const re = new RegExp("if\\(!n\\.fields\\." + media + "\\)\\{\\s*if\\(optNode\\(n\\)\\) return \\{ " + media + ":\"\" \\}");
    if (!re.test(src)) fail(`${file}: ${media} input run() must return empty via optNode(n) before throwing`);
    else ok(`${file}: empty ${media} input is skippable only when optNode(n)`);
  }
}
if (!/if \(optionalNode\(n\)\) return \{ image: "" \}/.test(PLAY))
  fail("play.html njs upload runner must skip via optionalNode(n)");
else ok("play.html njs upload runner skips via optionalNode(n)");

// ---- 3. drive the REAL play engine: deriveInputs + NODE_TYPES.run
const app = (() => {
  try { return loadEngine(); }
  catch (e) { fail("could not load play engine: " + (e && e.stack || e)); return null; }
})();

if (app) {
  const graph = (nodes, links = []) => ({ nodes, links });
  const upload = (id, fields = {}, name) => ({ id, type: "upload", name, x: 0, y: 0, fields });
  const text = (id, fields = {}) => ({ id, type: "text", x: 0, y: 0, fields });
  const llm = (id, fields = {}) => ({ id, type: "llm", x: 0, y: 0, fields: { model: "x", ...fields } });

  const flag = (g, field) => {
    const ins = app.deriveInputs(g);
    const it = ins.find((i) => i.field === field) || ins[0];
    return { ins, it };
  };

  {
    const { it } = flag(graph([upload("u1")]));
    if (!it || it.optional) fail("deriveInputs: a plain Image input must be required");
    else ok("deriveInputs: plain Image input is required");
  }
  {
    const { it } = flag(graph([upload("u1", { optional: true })]));
    if (!it || !it.optional) fail("deriveInputs: fields.optional:true must mark the Image input optional");
    else ok("deriveInputs: fields.optional:true → Image is optional");
  }
  {
    const { it } = flag(graph([upload("u1", { optional: "true" })]));
    if (!it || !it.optional) fail("deriveInputs: fields.optional:\"true\" must mark the Image input optional (export persist)");
    else ok("deriveInputs: fields.optional:\"true\" → Image is optional");
  }
  {
    const { it } = flag(graph([text("t1", { optional: true })]));
    if (!it || !it.optional) fail("deriveInputs: author-optional Text must be optional");
    else ok("deriveInputs: author-optional Text is optional");
  }
  {
    const { ins } = flag(graph([llm("m1")]));
    const prompt = ins.find((i) => i.field === "prompt");
    const system = ins.find((i) => i.field === "system");
    if (!prompt || prompt.optional) fail("deriveInputs: LLM prompt stays required when the node is not author-optional");
    else if (!system || !system.optional) fail("deriveInputs: LLM system prompt is spec-optional even without fields.optional");
    else ok("deriveInputs: LLM prompt required, system prompt optional (spec)");
  }
  {
    const { ins } = flag(graph([llm("m1", { optional: true })]));
    const prompt = ins.find((i) => i.field === "prompt");
    if (!prompt || !prompt.optional) fail("deriveInputs: author-optional LLM node must make its prompt skippable");
    else ok("deriveInputs: author-optional LLM node makes the prompt skippable");
  }
  {
    const { it } = flag(graph([upload("u1", { optional: true }, "Style reference")]));
    if (!it || it.title !== "Style reference")
      fail(`deriveInputs: a renamed optional upload must keep its name as the input title, got ${JSON.stringify(it && it.title)}`);
    else ok("deriveInputs: renamed optional upload keeps its custom name as the title");
  }

  async function expectThrow(run, re, label) {
    try {
      await run();
      fail(`${label}: expected throw matching ${re}`);
    } catch (e) {
      if (!re.test(String(e && e.message || e))) fail(`${label}: threw ${JSON.stringify(e && e.message)} (want ${re})`);
      else ok(label);
    }
  }
  async function expectEmpty(run, port, label) {
    try {
      const out = await run();
      if (!out || out[port] !== "") fail(`${label}: want {${port}:\"\"}, got ${JSON.stringify(out)}`);
      else ok(label);
    } catch (e) {
      fail(`${label}: threw ${e && e.message || e}`);
    }
  }

  const NT = app.NODE_TYPES;
  await expectThrow(() => NT.upload.run({ id: "u1", fields: {} }), /no image/i,
    "NODE_TYPES.upload.run: empty required image throws");
  await expectEmpty(() => NT.upload.run({ id: "u1", fields: { optional: true } }), "image",
    "NODE_TYPES.upload.run: empty optional image yields \"\"");
  await expectEmpty(() => NT.upload.run({ id: "u1", fields: { optional: "true" } }), "image",
    "NODE_TYPES.upload.run: empty optional:\"true\" image yields \"\"");
  await expectThrow(() => NT.aupload.run({ id: "a1", fields: {} }), /no audio/i,
    "NODE_TYPES.aupload.run: empty required audio throws");
  await expectEmpty(() => NT.aupload.run({ id: "a1", fields: { optional: true } }), "audio",
    "NODE_TYPES.aupload.run: empty optional audio yields \"\"");
  await expectThrow(() => NT.vupload.run({ id: "v1", fields: {} }), /no video/i,
    "NODE_TYPES.vupload.run: empty required video throws");
  await expectEmpty(() => NT.vupload.run({ id: "v1", fields: { optional: true } }), "video",
    "NODE_TYPES.vupload.run: empty optional video yields \"\"");
}

if (failures.length) {
  process.stderr.write("\n✗ optional-inputs: author-set optional/required drifted:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("\n✓ optional-inputs: predicate twins, deriveInputs, and empty media run() agree.\n");
