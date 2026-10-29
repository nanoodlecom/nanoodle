// Offline regressions for Vector convert, safe image knobs and honest SVG MIME.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { ROOT, loadEngine, recordingFetch } from "./play-engine.mjs";

const editor = readFileSync(ROOT + "/index.html", "utf8");
const play = readFileSync(ROOT + "/play.html", "utf8");
const IMG = "data:image/png;base64,iVBORw0KGgo=";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
const opts = JSON.parse('{"vector_operation":"convert","mode":"default","seed":9,"model":"wrong","prompt":"wrong","n":99,"size":"wrong","response_format":"url","imageDataUrl":"wrong","maskDataUrl":"wrong","api_key":"wrong","headers":{},"endpoint":"https://wrong.example","__proto__":{"polluted":true}}');

function balanced(src, start) {
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unclosed function");
}
function fn(src, name) { return balanced(src, src.indexOf("function " + name + "(")); }
const editAt = editor.indexOf("\n  edit: {", editor.indexOf("const NODE_TYPES = {"));
const editRun = balanced(editor, editor.indexOf("async run(", editAt));
const editorCtx = vm.createContext({
  atob, loraParams: () => ({}), imageAspectExtra: () => ({}), imageKnobExtra: () => ({}),
  needsCustomCivitai: () => false, airModelTakesNegative: () => false, catItem: () => null,
  collectImageInputs: (inp) => Object.entries(inp).filter(([k]) => /^image\d*$/.test(k)).map(([, v]) => v),
  guardInputRoles() {}, imgSpec: () => ({ cap: Infinity }), toast() {}, t: (s) => s,
  mdl: (n) => n.fields.model, applyDimFields() {}, dimDefs: () => [], SIZES: [["1024x1024"]],
  MEDIA_INLINE_MAX: 4.4 * 1024 * 1024,
});
vm.runInContext(fn(editor, "imageModelOpts") + "\n" + fn(editor, "imgExtra") + "\n" + fn(editor, "b64ImageMime") +
  "\nvar runEdit = ({ " + editRun + " }).run;", editorCtx);
const app = loadEngine();
for (const [surface, run] of [["editor", editorCtx.runEdit], ["play/export", app.NODE_TYPES.edit.run]]) {
  const calls = [];
  const ctx = { genImage: async (...args) => { calls.push(args); return IMG; } };
  const node = (model, modelOpts) => ({ id: "e", type: "edit", fields: { model, modelOpts, seed: 42, prompt: " " } });
  await run(node("ideogram/vector", opts), { image: IMG }, ctx);
  assert.equal(calls[0][0], "", surface);
  assert.equal(calls[0][5].vector_operation, "convert", surface);
  assert.equal(calls[0][5].mode, "default", surface);
  assert.equal(calls[0][5].seed, 42, surface);
  for (const key of ["model", "prompt", "n", "size", "response_format", "imageDataUrl", "maskDataUrl", "api_key", "headers", "endpoint", "__proto__"]) {
    assert.equal(Object.hasOwn(calls[0][5], key), false, surface + ": " + key);
  }
  for (const [model, modelOpts] of [["ideogram/vector", {}], ["ideogram/vector", { vector_operation: "generate" }],
    ["other/vector", opts], ["ideogram/vector-other", opts]]) {
    await assert.rejects(run(node(model, modelOpts), { image: IMG }, ctx), /no edit instruction/, surface);
  }
  await assert.rejects(run(node("ideogram/vector", opts), {}, ctx), /no image/, surface);
  assert.equal(calls.length, 1, surface + ": rejected runs must not call image API");
  await run(node("upscaler", {}), { image: IMG }, ctx);
}

// Exercise the real built-in request boundary and SVG result on the export path.
const paid = [];
const realApp = loadEngine((ctx) => {
  ctx.fetch = async (url, init) => {
    if (!String(url).includes("/images/generations")) return recordingFetch(url, init);
    paid.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ data: [{ b64_json: Buffer.from(SVG).toString("base64") }], cost: 0.02 }) };
  };
});
const result = await realApp.CTX.genImage("", "ideogram/vector", "1024x1024", IMG, undefined, opts);
assert.match(result, /^data:image\/svg\+xml;base64,/);
assert.equal(paid[0].body.model, "ideogram/vector");
assert.equal(paid[0].body.n, 1);
assert.equal(paid[0].body.imageDataUrl, IMG);
assert.equal(paid[0].body.response_format, "b64_json");
assert.equal(Object.hasOwn(paid[0].body, "prompt"), false);

for (const src of [editor, play.slice(play.indexOf("const RUNTIME_JS"))]) {
  const sniff = vm.runInNewContext("(" + fn(src, "b64ImageMime") + ")", { atob });
  assert.equal(sniff(Buffer.from("<svg/>").toString("base64")), "image/svg+xml");
  for (const prefix of ["", " \n", '<?xml version="1.0"?>\n', '\ufeff <?xml version="1.0"?>\n<!-- icon -->\n']) {
    assert.equal(sniff(Buffer.from(prefix + SVG).toString("base64")), "image/svg+xml");
  }
  assert.equal(sniff(Buffer.from("<html><svg/></html>").toString("base64")), "image/png");
  assert.equal(sniff("%%%bad%%%"), "image/png");
}
console.log("✓ vector-image: convert-only prompts, protected options, SVG results across editor and play/export");
