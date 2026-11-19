#!/usr/bin/env node
// Rendering the ⚙️ Model options panel must not mutate a node's fields
// (found 2026-11-18, initial-moment Cycle 1).
//
// refreshModelOpts() used to do `n.fields.modelOpts || (n.fields.modelOpts = {})`
// — merely painting a video node wrote an empty modelOpts object into its
// fields. save() then persisted the blob (shipped gallery graphs carry
// `"modelOpts":{}` for this reason), and the signed-out demo's exact-match
// signature (appHandoffSig over fields) could never match the shipped
// starter again: demoMode() fell through to "shape", so a pristine first
// Run showed the "your edits aren't reflected yet" sample pop to a visitor
// who had edited nothing. Measured: field diff of live canvas vs
// noodle-graph.json under the real catalogs was exactly one field —
// the starter's ivideo node gaining modelOpts:{} at render.
//
// Contract pinned here: render is read-only for fields; the first real knob
// edit materializes fields.modelOpts; clearing a knob on a node that never
// stored options leaves fields untouched; pre-existing options still get
// their stale-knob cleanup.
//
// Offline: extracts the real videoOptDefs/refreshModelOpts from index.html
// and drives them in a node:vm sandbox with a tiny fake DOM (same harness
// as check-model-opts-integer.mjs). No browser, no API spend.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error(name + "() not found in index.html");
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("could not brace-match " + name + "()");
}
const grab = (re, what) => { const m = IDX.match(re); if (!m) throw new Error(what + " not found in index.html"); return m[0]; };

const bundle = [
  grab(/const VIDEO_OPT_NODES = \{[^}]*\};/, "VIDEO_OPT_NODES"),
  grab(/const PRICE_OR_DIM_PARAM = \/.*;/, "PRICE_OR_DIM_PARAM"),
  grab(/const VIDEO_IMG_ROLE_KEYS = \{[^}]*\};/, "VIDEO_IMG_ROLE_KEYS"),
  grab(/const VIDEO_REF_PRICE_KEYS = \[[^\]]*\];/, "VIDEO_REF_PRICE_KEYS"),
  grab(/const videoRefsModePriced = \(p\)=>[\s\S]*?;/, "videoRefsModePriced"),
  grab(/const videoRefsPriced = \(m\)=> \{[^}]*\};/, "videoRefsPriced"),
  extractFn(IDX, "videoFreetextSkip"),
  extractFn(IDX, "videoOptDefs"),
  extractFn(IDX, "refreshModelOpts"),
  "globalThis.__t = { videoOptDefs, refreshModelOpts };",
].join("\n");

// Catalog shape copied from check-model-opts-integer.mjs (live video-models, 2026-11-03).
const CAT = {
  openjutsu: {
    params: {
      swap_type: { type: "select", label: "Edit type", default: "character",
        options: [{ value: "character", label: "Character swap" }, { value: "object", label: "Object or background" }] },
      seed: { type: "integer", label: "Seed", description: "Any negative integer selects a random seed.", default: -1, step: 1 },
    },
    defaults: {},
  },
};

const listeners = [];
const fakeEl = (key) => ({
  dataset: { of: key }, type: "number", value: "",
  addEventListener(ev, fn) { if (ev === "input") listeners.push({ key, el: this, fn }); },
});
let html = "";
const box = {
  set innerHTML(v) { html = v; listeners.length = 0; }, get innerHTML() { return html; },
  querySelectorAll() { return [...html.matchAll(/data-of="([^"]+)"/g)].map((m) => fakeEl(m[1])); },
};
const ctx = {
  NODE_TYPES: { vedit: { modelKind: "video", modelFilter: "v2v", refInputs: true }, ivideo: { modelKind: "video", modelFilter: "i2v", refInputs: true } },
  catItem: (_k, id) => CAT[id] || null,
  esc: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  t: (s) => s, translateTree() {}, nearestDimOption: (v) => v, updateNodePrice() {}, refreshRunEstimate() {}, save() {},
};
vm.createContext(ctx);
new vm.Script(bundle, { filename: "index.html#model-opts-lazy" }).runInContext(ctx);
const T = ctx.__t;

console.log("refreshModelOpts: render must not mutate fields");
{
  const n = { type: "vedit", fields: { model: "openjutsu" }, el: { querySelector: () => box } };
  T.refreshModelOpts(n);
  ok(!("modelOpts" in n.fields), "rendering a node with no stored options does not create fields.modelOpts");
  ok(/data-of="seed"/.test(html), "the knobs still render");

  const L = listeners.find((l) => l.key === "seed");
  ok(!!L, "seed input is wired");
  if (L) {
    L.el.value = ""; L.fn();
    ok(!("modelOpts" in n.fields), "clearing a knob on a node that never stored options leaves fields untouched");
    L.el.value = "42"; L.fn();
    ok(n.fields.modelOpts && n.fields.modelOpts.seed === 42, "first real edit materializes fields.modelOpts and stores the value");
    L.el.value = ""; L.fn();
    ok(n.fields.modelOpts && !("seed" in n.fields.modelOpts), "clearing a stored knob removes the key (model default applies)");
  }
}

console.log("refreshModelOpts: pre-existing options still maintained");
{
  const n = { type: "vedit", fields: { model: "openjutsu", modelOpts: { seed: 7, stale_knob: 1 } }, el: { querySelector: () => box } };
  T.refreshModelOpts(n);
  ok(n.fields.modelOpts.seed === 7, "a stored value survives render");
  ok(!("stale_knob" in n.fields.modelOpts), "stale knobs from another model are still dropped");
}

console.log(fail ? `\n${fail} failure(s)` : "\nall model-opts lazy checks pass");
process.exit(fail ? 1 : 0);
