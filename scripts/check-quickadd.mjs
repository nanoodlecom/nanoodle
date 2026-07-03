#!/usr/bin/env node
// Behavioural test for the editor's "drop a wire into empty space → quick-add a node" path.
// The menu must only offer nodes that actually fit the dragged port:
//   - dragging FROM an output  → nodes that CONSUME that type (nodeAcceptsType)
//   - dragging FROM an input   → nodes that PRODUCE that type (nodeProducesType)
// We run the REAL filtering functions + the REAL NODE_TYPES registry (extracted from
// index.html) against a tiny set of stubbed body helpers, and assert the candidate sets.
//
// Why it matters: text wires can target any wirable text field (every textarea grows an
// inline text port), image wires can target the LLM's dynamic image ports, etc. Getting
// this wrong shows irrelevant nodes (or hides relevant ones) in the quick-add menu.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "index.html"), "utf8");

function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error(`function ${name}() not found in index.html`);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`could not brace-match ${name}()`);
}
// Extract a top-level `const NAME = {  …  };` object literal by brace-matching.
function extractObj(src, decl) {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(`${decl} not found in index.html`);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1) + ";";
  }
  throw new Error(`could not brace-match ${decl}`);
}

// ---- a sandbox with just enough stubs for the NODE_TYPES literal to evaluate -------------
// Only body() is ever called (for text-field detection); run()/mount() are referenced but
// never invoked, so they can be inert. esc/optsHTML/SIZES/modelFieldHTML/audioBody must
// produce strings because body() runs. audioBody keeps its real text-field textarea so
// music/tts correctly count as text-accepting.
const ctx = {
  esc: (s) => String(s ?? ""),
  optsHTML: () => "",
  SIZES: [["1024x1024", "square"]],
  modelFieldHTML: () => `<div><label>model</label><button class="modelpick"></button></div>`,
  audioBody: (n, label, ph) =>
    `<div><label>${label}</label><textarea data-f="prompt" placeholder="${ph}"></textarea></div>`,
  audioRun: () => {},
  mountUpload: () => {},
  mountInpaint: () => {},
  mountFileUpload: () => {},
  mountComment: () => {},
  commentBody: () => `<textarea data-f="text"></textarea>`,   // note textarea; nodeAcceptsType short-circuits on t.note so it's never a text sink
  collectImageInputs: () => [],
  setNodeProgress: () => {},
  t: (s) => s,
};
vm.createContext(ctx);

const bundle =
  extractObj(SRC, "const NODE_TYPES = {") + "\n" +
  "const ADD_GROUPS = ['Inputs','Text','Image','Video','Audio'];\n" +
  "const MAX_FRAMES = 12;\n" +
  extractFn(SRC, "framePorts") + "\n" +              // dynamic image ports (vframes)
  extractFn(SRC, "nodeOutputs") + "\n" +             // resolves static-array OR function-valued outputs
  extractFn(SRC, "nodeAcceptsType") + "\n" +
  extractFn(SRC, "bodyHasTextField") + "\n" +
  "const _qaTextField = {};\n" +
  "const nodeProducesType = (k, type) => nodeOutputs(k).some(o => o.type===type);\n" +
  extractFn(SRC, "quickAddCandidates") + "\n" +
  ";globalThis.__qa = { NODE_TYPES, quickAddCandidates, nodeAcceptsType, nodeProducesType };";
new vm.Script(bundle, { filename: "index.html#quickadd" }).runInContext(ctx);

const { quickAddCandidates } = ctx.__qa;
const keys = (dir, type) => quickAddCandidates(dir, type).map(([k]) => k).sort();

// ---- assertions -----------------------------------------------------------
const failures = [];
const eq = (got, want, label) => {
  const a = JSON.stringify(got), b = JSON.stringify([...want].sort());
  if (a !== b) failures.push(`${label}\n      got:  ${a}\n      want: ${b}`);
};
const ok = (c, m) => { if (!c) failures.push(m); };

// dragging FROM an output → consumers of that type
eq(keys("out", "image"), ["edit", "inpaint", "ivideo", "llm", "lipsync", "resize", "vision"],
  "image output → nodes that take an image (incl. LLM's dynamic image ports + Inpaint's image/mask)");
eq(keys("out", "audio"), ["llm", "lipsync", "soundtrack", "transcribe", "trim"],
  "audio output → nodes that take audio (incl. the LLM's audio-input port + Soundtrack's audio port)");
eq(keys("out", "video"), ["combine", "extractaudio", "soundtrack", "vedit", "vframes"],
  "video output → nodes that take video (combine joins clips; soundtrack adds audio; vframes extracts stills; extractaudio peels the soundtrack)");
// transcribe is excluded: its only text field is a plain <input> (language), not a wirable textarea
eq(keys("out", "text"), ["edit", "image", "inpaint", "ivideo", "join", "llm", "lipsync", "music", "tts", "tvideo", "vedit", "vision"],
  "text output → nodes with a text input OR a wirable text field");

// dragging FROM an input → producers of that type
eq(keys("in", "image"), ["edit", "image", "inpaint", "resize", "upload", "vframes"],
  "image input → nodes that produce an image (inpaint repaints; vframes emits frame stills)");
eq(keys("in", "audio"), ["aupload", "extractaudio", "music", "trim", "tts"],
  "audio input → nodes that produce audio (extractaudio emits a WAV from a video)");
eq(keys("in", "video"), ["combine", "ivideo", "lipsync", "soundtrack", "tvideo", "vedit", "vupload"],
  "video input → nodes that produce video (combine joins clips into one; soundtrack outputs the scored video)");
eq(keys("in", "text"), ["choice", "join", "llm", "text", "transcribe", "vision"],
  "text input → nodes that produce text (Choice is a pure text source, like Text)");

// never offer the dragged node's own kind blindly — uploads/text are pure sources, not consumers
const imgConsumers = keys("out", "image");
["upload", "text"].forEach((k) =>
  failures.push(...(imgConsumers.includes(k) ? [`pure source ${k} must not be an image consumer`] : [])));

// ---- 2nd test: quickSpawn() wires the new node with the correct orientation ----------
// Dragging FROM an output → the origin port is the SOURCE; the new node receives.
// Dragging FROM an input  → the origin port is the SINK;  the new node feeds it.
// Run the REAL quickSpawn() against tiny stubs and assert the connect() argument order.
// quickSpawn(typeKey, wx, wy, dir, type, originPort) — drive it with the REAL signature.
// getPorts() is called on every querySelectorAll, so a stubbed ensureModelForInput can mutate
// the returned set (mirroring how upgrading the model enables a previously-disabled socket).
function spawnReal(typeKey, wx, wy, dir, type, originDataset, getPorts, onEnsure) {
  const calls = { added: null, connected: null, ensured: 0 };
  const fakeNew = { id: "new1", el: { querySelectorAll: () => getPorts() } };
  const sctx = {
    addNode: (tk, x, y) => { calls.added = { tk, x, y }; return fakeNew; },
    select: () => {}, redraw: () => {},
    connect: (fn, fp, tn, tp) => { calls.connected = { fn, fp, tn, tp }; },
    ensureModelForInput: () => { calls.ensured++; if (onEnsure) onEnsure(); },
    rememberAdd: () => {},   // wire-drop adds also feed the Add-menu "Recent" tier (localStorage, on-device)
    dismissConnectHint: () => {},   // wire-drop is a manual connect → retires the connect coach line
  };
  vm.createContext(sctx);
  new vm.Script(extractFn(SRC, "quickSpawn") + ";globalThis.__qs = quickSpawn;", { filename: "index.html#quickspawn" }).runInContext(sctx);
  sctx.__qs(typeKey, wx, wy, dir, type, { dataset: originDataset });
  return { ...calls, ctx: sctx };
}
const freePort = (node, port) => ({ dataset: { node, port }, classList: { contains: () => false } });
const fixed = (arr) => () => arr;

// out-drag: text from node "src" → new LLM; should prefer the "prompt" socket and wire src→new
const outCase = spawnReal("llm", 500, 300, "out", "text",
  { node: "src", port: "text", dir: "out", ptype: "text" },
  fixed([freePort("new1", "system"), freePort("new1", "prompt")]));
ok(outCase.added && outCase.added.tk === "llm", "spawn(out): should addNode('llm')");
ok(outCase.added && outCase.added.x === 508, "spawn(out): downstream node placed to the right of the drop (wx+8)");
ok(outCase.connected && outCase.connected.fn === "src" && outCase.connected.fp === "text",
  "spawn(out): origin output must be the link SOURCE");
ok(outCase.connected && outCase.connected.tn === "new1" && outCase.connected.tp === "prompt",
  "spawn(out): should wire into the new node's 'prompt' socket, got " + JSON.stringify(outCase.connected));

// in-drag: image into node "dst" ← new upload; new node is the SOURCE, origin is the SINK
const inCase = spawnReal("upload", 500, 300, "in", "image",
  { node: "dst", port: "image", dir: "in", ptype: "image" },
  fixed([freePort("new1", "image")]));
ok(inCase.added && inCase.added.x === 268, "spawn(in): source node placed to the left of the drop (wx-232)");
ok(inCase.connected && inCase.connected.fn === "new1" && inCase.connected.fp === "image",
  "spawn(in): new node must be the link SOURCE");
ok(inCase.connected && inCase.connected.tn === "dst" && inCase.connected.tp === "image",
  "spawn(in): origin input must be the link SINK, got " + JSON.stringify(inCase.connected));

// out-drag image → an LLM whose default model can't see images: the image socket starts disabled,
// so quickSpawn must upgrade the model (ensureModelForInput) and then wire the now-enabled socket —
// never leave the promised auto-wire dangling. (Regression: Codex P2 review on PR #17.)
let imgDisabled = true;
const imgPort = { dataset: { node: "new1", port: "img1" }, classList: { contains: (c) => (c === "disabled" ? imgDisabled : false) } };
const upgradeCase = spawnReal("llm", 700, 400, "out", "image",
  { node: "src2", port: "image", dir: "out", ptype: "image" },
  () => [imgPort], () => { imgDisabled = false; });   // ensure-stub enables the socket
ok(upgradeCase.ensured === 1, "spawn(out,image): must call ensureModelForInput when the only socket is disabled");
ok(upgradeCase.connected && upgradeCase.connected.fn === "src2" && upgradeCase.connected.tn === "new1" && upgradeCase.connected.tp === "img1",
  "spawn(out,image): after the model upgrade the image must wire into the now-enabled socket, got " + JSON.stringify(upgradeCase.connected));

// sanity: when the socket is already enabled, no needless model upgrade happens
ok(outCase.ensured === 0, "spawn(out,text): an already-enabled socket must NOT trigger a model upgrade");

if (failures.length) {
  process.stderr.write("✗ quick-add candidate filtering is wrong:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ quick-add offers exactly the type-compatible nodes, and wires new nodes with the right orientation.\n");
