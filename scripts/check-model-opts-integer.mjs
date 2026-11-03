#!/usr/bin/env node
// "integer" catalog params as ⚙️ Model options knobs (found 2026-11-02 on OpenJutsu, see #784).
//
// /api/v1/video-models describes OpenJutsu's seed as {type:"integer", default:-1, step:1}.
// videoOptDefs() only surfaced text/string/number free-text knobs, so the seed never showed up
// and couldn't be set. Now "integer" renders as a number box (step 1 unless the catalog says
// otherwise) and a typed value is rounded to a whole number before it goes into modelOpts.
// Node-owned dims stay hidden even when the catalog types them "integer" (H3/Kling/Vidu
// duration, P-Video Upscale fps), because PRICE_OR_DIM_PARAM runs first.
//
// Offline: extracts the real videoOptDefs/refreshModelOpts from index.html and drives them in a
// node:vm sandbox with a tiny fake DOM. No browser, no API spend.

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
  grab(/const PRICE_OR_DIM_PARAM = \/[^\n]*;/, "PRICE_OR_DIM_PARAM"),
  grab(/const VIDEO_IMG_ROLE_KEYS = \{[^}]*\};/, "VIDEO_IMG_ROLE_KEYS"),
  grab(/const VIDEO_REF_PRICE_KEYS = \[[^\]]*\];/, "VIDEO_REF_PRICE_KEYS"),
  grab(/const videoRefsModePriced = \(p\)=>[\s\S]*?;/, "videoRefsModePriced"),
  grab(/const videoRefsPriced = \(m\)=> \{[^}]*\};/, "videoRefsPriced"),
  extractFn(IDX, "videoFreetextSkip"),
  extractFn(IDX, "videoOptDefs"),
  extractFn(IDX, "refreshModelOpts"),
  "globalThis.__t = { videoOptDefs, refreshModelOpts };",
].join("\n");

// Catalog shapes copied from the live /api/v1/video-models on 2026-11-03.
const CAT = {
  openjutsu: {
    params: {
      swap_type: { type: "select", label: "Edit type", default: "character",
        options: [{ value: "character", label: "Character swap" }, { value: "object", label: "Object or background" }] },
      seed: { type: "integer", label: "Seed", description: "Any negative integer selects a random seed.", default: -1, step: 1 },
    },
    defaults: {},
  },
  "minimax/h3-lite": { params: { duration: { type: "integer", default: 6, min: 6, max: 10 } }, defaults: {} },
  "pruna-ai/p-video/upscale": { params: { fps: { type: "integer", default: 30 } }, defaults: {} },
  "int-no-step": { params: { steps: { type: "integer", label: "Steps", min: 1, max: 50 } }, defaults: {} },
  "num-model": { params: { cfg_scale: { type: "number", label: "CFG", min: 0, max: 10 } }, defaults: {} },
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
  NODE_TYPES: { vedit: { modelKind: "video", modelFilter: "v2v", refInputs: true }, tvideo: { modelKind: "video", modelFilter: "t2v", refInputs: true } },
  catItem: (_k, id) => CAT[id] || null,
  esc: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  t: (s) => s, translateTree() {}, nearestDimOption: (v) => v, updateNodePrice() {}, refreshRunEstimate() {}, save() {},
};
vm.createContext(ctx);
new vm.Script(bundle, { filename: "index.html#model-opts-integer" }).runInContext(ctx);
const T = ctx.__t;

console.log("videoOptDefs: integer params");
{
  const seed = T.videoOptDefs("openjutsu", "vedit").find((d) => d.key === "seed");
  ok(!!seed, "OpenJutsu seed (type integer) is surfaced as a knob");
  ok(seed && seed.type === "number", "it renders as a number box");
  ok(seed && seed.int === true, "it is flagged as an integer");
  ok(seed && seed.step === 1 && seed.def === -1, "catalog step 1 and default -1 carry over");
  const steps = T.videoOptDefs("int-no-step", "tvideo").find((d) => d.key === "steps");
  ok(steps && steps.step === 1 && steps.min === 1 && steps.max === 50, "an integer with no catalog step steps by 1 and keeps min/max");
  const cfg = T.videoOptDefs("num-model", "tvideo").find((d) => d.key === "cfg_scale");
  ok(cfg && cfg.step === undefined && !cfg.int, "plain number params are unchanged (no forced step, no int flag)");
  ok(!T.videoOptDefs("minimax/h3-lite", "tvideo").some((d) => d.key === "duration"), "integer duration stays node-owned (not a knob)");
  ok(!T.videoOptDefs("pruna-ai/p-video/upscale", "vedit").some((d) => d.key === "fps"), "integer fps stays node-owned (not a knob)");
}

console.log("refreshModelOpts: rendering + stored value");
{
  const n = { type: "vedit", fields: { model: "openjutsu", modelOpts: {} }, el: { querySelector: () => box } };
  T.refreshModelOpts(n);
  ok(/<input type="number" data-of="seed" step="1"/.test(html), "seed renders as <input type=number step=1>");
  ok(/placeholder="-1"/.test(html), "the catalog default shows as the placeholder");
  const L = listeners.find((l) => l.key === "seed");
  ok(!!L, "seed input is wired");
  if (L) {
  L.el.value = "42"; L.fn();
  ok(n.fields.modelOpts.seed === 42, "typing 42 stores the number 42");
  L.el.value = "7.6"; L.fn();
  ok(n.fields.modelOpts.seed === 8, "a fractional entry is rounded to a whole number (7.6 → 8)");
  L.el.value = "-1"; L.fn();
  ok(n.fields.modelOpts.seed === -1, "-1 (random) is kept");
  L.el.value = ""; L.fn();
  ok(!("seed" in n.fields.modelOpts), "clearing the box omits seed so the model's own default applies");
  }
}

console.log(fail ? `\n${fail} failure(s)` : "\nall model-opts integer checks pass");
process.exit(fail ? 1 : 0);
