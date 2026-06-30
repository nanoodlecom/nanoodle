#!/usr/bin/env node
// Unit-tests the editor's dynamic image-input port logic by extracting the REAL
// functions from index.html and running them in a node:vm sandbox with tiny
// stubs for the globals they touch (graph, NODE_TYPES, catItem). No browser.
//
// Covers:
//   • imageInputDefs   — grows one empty trailing slot on vision models; a single
//                        disabled stub on text-only models; permissive on unknown ids.
//   • recompactImageLinks — renumbers surviving image links so removing the source
//                        of a middle port (img2) leaves NO hole (the reported bug).
//   • collectImageInputs — pulls wired image ports out of a run in index order.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "index.html"), "utf8");

// Slice a top-level `function name(...) { ... }` out of the source by brace-matching.
function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error(`function ${name}() not found in index.html`);
  let i = src.indexOf("{", start), depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") { if (--depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`could not brace-match ${name}()`);
}

// The verbatim const lines the extracted functions close over (regex + index helper + edit family).
const grab = (re, what) => { const m = SRC.match(re); if (!m) throw new Error(what + " declaration not found in index.html"); return m[0]; };
const reLine      = grab(/const IMG_PORT_RE = \/[^\n]*;/, "IMG_PORT_RE");
const editReLine  = grab(/const EDIT_IMG_RE = \/[^\n]*;/, "EDIT_IMG_RE");
const portIdxLine = grab(/const portIdx = [^\n]*;/, "portIdx");

const bundle =
  reLine + "\n" + editReLine + "\n" + portIdxLine + "\n" +
  ["modelSupportsImages", "imgSpec", "imageInputDefs", "collectImageInputs", "recompactImageLinks"]
    .map((n) => extractFn(SRC, n)).join("\n") + "\n" +
  "globalThis.__t = { imageInputDefs, collectImageInputs, recompactImageLinks, modelSupportsImages, imgSpec };";

// ---- stubs for the globals the extracted code closes over -----------------
// vision flag for the llm family; maxIn (max_input_images) for the edit family. Unknown id → undefined.
const MODELS = { vmodel: { vision: true }, tmodel: { vision: false }, emodel: { maxIn: 4 }, e1model: { maxIn: 1 } };
const ctx = {
  console,
  graph: { links: [] },
  NODE_TYPES: { llm: { imageInputs: "vision", modelKind: "chat" }, edit: { imageInputs: { multi: true }, modelKind: "image" }, text: {}, upload: {} },
  catItem: (_kind, id) => MODELS[id],
};
vm.createContext(ctx);
new vm.Script(bundle, { filename: "index.html#image-ports" }).runInContext(ctx);
const T = ctx.__t;

// ---- helpers --------------------------------------------------------------
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };
const llm = (model) => ({ id: "m1", type: "llm", fields: { model } });
const setLinks = (...pairs) => { ctx.graph.links = pairs.map(([from, port], i) => ({ id: "l" + i, from: { node: from, port: "image" }, to: { node: "m1", port } })); };
const names = (n) => T.imageInputDefs(n).map((d) => d.name);
const disabledNames = (n) => T.imageInputDefs(n).filter((d) => d.disabled).map((d) => d.name);
const imgLinks = () => ctx.graph.links.filter((l) => l.to.node === "m1" && /^img\d+$/.test(l.to.port)).map((l) => l.from.node + "->" + l.to.port).sort();

// ---- A. growth on a vision model ------------------------------------------
const v = llm("vmodel");
setLinks(); ok(JSON.stringify(names(v)) === '["img1"]', `vision/no-wire: want [img1], got ${JSON.stringify(names(v))}`);
setLinks(["u1", "img1"]); ok(JSON.stringify(names(v)) === '["img1","img2"]', `one wired: want [img1,img2], got ${JSON.stringify(names(v))}`);
setLinks(["u1", "img1"], ["u2", "img2"]); ok(JSON.stringify(names(v)) === '["img1","img2","img3"]', `two wired: want 3 slots, got ${JSON.stringify(names(v))}`);

// ---- B. disabled stub on a text-only model --------------------------------
const t = llm("tmodel");
setLinks(); ok(JSON.stringify(disabledNames(t)) === '["img1"]', `text model: want one disabled stub, got defs ${JSON.stringify(T.imageInputDefs(t))}`);
ok(T.modelSupportsImages(llm("unknown-id")) === true, "unknown/typed-in model id should be permissive (supported)");
ok(T.modelSupportsImages(t) === false, "a known text-only model must report unsupported");

// ---- C. THE BUG: removing a middle source must leave no hole ---------------
// img1 + img3 wired (img2's source was removed). Without compaction, imageInputDefs
// reports [img1,img2,img3,img4] — a hole at img2 and an extra slot.
setLinks(["u1", "img1"], ["u3", "img3"]);
ok(JSON.stringify(names(v)) === '["img1","img2","img3","img4"]', `pre-compaction (documents the hole): got ${JSON.stringify(names(v))}`);
T.recompactImageLinks(v);
ok(JSON.stringify(imgLinks()) === '["u1->img1","u3->img2"]', `recompact must renumber to contiguous & keep order, got ${JSON.stringify(imgLinks())}`);
ok(JSON.stringify(names(v)) === '["img1","img2","img3"]', `after compaction: want img1,img2 wired + img3 empty, got ${JSON.stringify(names(v))}`);

// multiple holes collapse too (img1,img4 → img1,img2)
setLinks(["u1", "img1"], ["u9", "img4"]);
T.recompactImageLinks(v);
ok(JSON.stringify(imgLinks()) === '["u1->img1","u9->img2"]', `multi-hole compaction failed, got ${JSON.stringify(imgLinks())}`);

// recompaction must not touch other nodes' links, and no-op on non-image nodes
ctx.graph.links = [
  { id: "x", from: { node: "u1", port: "image" }, to: { node: "m1", port: "img3" } },
  { id: "y", from: { node: "u2", port: "image" }, to: { node: "other", port: "img2" } },
];
T.recompactImageLinks(v);
ok(ctx.graph.links.find((l) => l.id === "x").to.port === "img1", "single surviving image link should become img1");
ok(ctx.graph.links.find((l) => l.id === "y").to.port === "img2", "recompaction must not touch a different node's links");
T.recompactImageLinks({ id: "n", type: "text", fields: {} }); // must not throw / mutate

// ---- D. collectImageInputs order ------------------------------------------
ok(JSON.stringify(T.collectImageInputs({ img2: "B", prompt: "x", img1: "A", img10: "J" })) === '["A","B","J"]',
  "collectImageInputs must return images in numeric port order");

// ---- E. edit node: max_input_images-gated multi-reference ports -----------
// ports keep the legacy name "image" for slot 1 (so already-wired graphs load), then image2,image3,…
const edit = (model) => ({ id: "e1", type: "edit", fields: { model } });
const editLinks = (...ports) => { ctx.graph.links = ports.map((port, i) => ({ id: "e" + i, from: { node: "u" + i, port: "image" }, to: { node: "e1", port } })); };
const editWires = () => ctx.graph.links.filter((l) => l.to.node === "e1" && /^image\d*$/.test(l.to.port)).map((l) => l.from.node + "->" + l.to.port).sort();

const e4 = edit("emodel");   // a model that composites up to 4 references
editLinks(); ok(JSON.stringify(names(e4)) === '["image"]', `edit/no-wire: want [image], got ${JSON.stringify(names(e4))}`);
editLinks("image"); ok(JSON.stringify(names(e4)) === '["image","image2"]', `edit one wired: want [image,image2], got ${JSON.stringify(names(e4))}`);
editLinks("image", "image2", "image3", "image4");
ok(JSON.stringify(names(e4)) === '["image","image2","image3","image4"]', `edit must STOP at maxIn=4 (no trailing slot), got ${JSON.stringify(names(e4))}`);

// a single-image model keeps exactly one port even when wired — identical to the old static behavior
const e1 = edit("e1model");
editLinks("image"); ok(JSON.stringify(names(e1)) === '["image"]', `edit maxIn=1: want single [image], got ${JSON.stringify(names(e1))}`);

// recompaction renumbers to image,image2 (slot 1 keeps the bare "image" name)
editLinks("image", "image3"); T.recompactImageLinks(e4);
ok(JSON.stringify(editWires()) === '["u0->image","u1->image2"]', `edit recompact must renumber to image,image2, got ${JSON.stringify(editWires())}`);

// collectImageInputs over the edit family pulls image,image2,… in order
ok(JSON.stringify(T.collectImageInputs({ image2: "B", prompt: "x", image: "A", image10: "J" }, e4)) === '["A","B","J"]',
  "collectImageInputs(edit) must return images in port order image,image2,…");

// ---- report ---------------------------------------------------------------
if (failures.length) {
  process.stderr.write("✗ image-port logic is wrong:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ image-input port logic holds (growth, disabled stub, hole-free compaction, order).\n");
