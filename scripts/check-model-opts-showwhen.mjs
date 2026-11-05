#!/usr/bin/env node
// Catalog `showWhen` gating in ⚙️ Model options (found live 2026-11-02 on the Video edit node with
// OpenJutsu). NanoGPT's video catalog marks dependent params with showWhen:{otherKey: value|[values]}:
// OpenJutsu's mode/target/change_to apply only when swap_type is "object", role_1..role_4 only when
// it is "character". The editor used to render all 8 knobs whatever "Edit type" said, and a value
// typed into a knob that doesn't apply was still sent to the API.
//
// Pins, offline (node:vm, fake DOM box), zero API spend:
//   * videoOptDefs carries the descriptor's showWhen on each def (sw)
//   * showWhenOK: scalar + array allowed values, stored value > catalog default > first option,
//     controller the catalog doesn't describe never hides anything
//   * refreshModelOpts renders only the knobs that apply (OpenJutsu default = character → 4 roles)
//     and the summary count follows the visible set
//   * flipping the controlling select re-renders immediately (object → mode/target/change_to)
//   * a hidden knob's stored value is pruned from fields.modelOpts (what every send path forwards)
//   * array-valued showWhen (P-Video 2 Pro generation_mode) and PixVerse effectType default
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");

let failed = 0;
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { failed++; console.log("  ✗ " + m); } };

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
const grab = (re, what) => {
  const m = IDX.match(re);
  if (!m) throw new Error(what + " not found in index.html");
  return m[0];
};

const bundle = [
  grab(/const esc = \(s\)=>[^\n]*;/, "esc"),
  grab(/const VIDEO_OPT_NODES = \{[^}]*\};/, "VIDEO_OPT_NODES"),
  grab(/const PRICE_OR_DIM_PARAM = \/[^\n]*;/, "PRICE_OR_DIM_PARAM"),
  grab(/const VIDEO_IMG_ROLE_KEYS = \{[^}]*\};/, "VIDEO_IMG_ROLE_KEYS"),
  grab(/const VIDEO_REF_PRICE_KEYS = \[[^\]]*\];/, "VIDEO_REF_PRICE_KEYS"),
  grab(/const videoRefsModePriced = \(p\)=>[\s\S]*?;/, "videoRefsModePriced"),
  grab(/const videoRefsPriced = \(m\)=> \{[^}]*\};/, "videoRefsPriced"),
  extractFn(IDX, "videoFreetextSkip"),
  extractFn(IDX, "videoOptDefs"),
  extractFn(IDX, "showWhenOK"),
  extractFn(IDX, "refreshModelOpts"),
  "globalThis.__t = { videoOptDefs, showWhenOK, refreshModelOpts };",
].join("\n");

// Live catalog shapes (GET /api/v1/video-models, 2026-11-02), trimmed to the gated params.
const txt = (label, sw) => ({ type: "text", label, default: "", ...(sw ? { showWhen: sw } : {}) });
const OBJ = { swap_type: "object" }, CHR = { swap_type: "character" };
const OPENJUTSU = {
  params: {
    swap_type: { type: "select", label: "Edit type", default: "character",
      options: [{ value: "character", label: "Character swap" }, { value: "object", label: "Object or background" }] },
    mode: { type: "select", label: "Object edit", default: "change", showWhen: OBJ,
      options: [{ value: "change" }, { value: "background" }] },
    target: txt("Target", OBJ),
    change_to: txt("New appearance", OBJ),
    role_1: txt("Person to replace with image 1", CHR),
    role_2: txt("Person to replace with image 2", CHR),
    role_3: txt("Person to replace with image 3", CHR),
    role_4: txt("Person to replace with image 4", CHR),
    resolution: { type: "select", default: "768p", options: [{ value: "480p" }, { value: "768p" }] },
  },
  defaults: { swap_type: "character", mode: "change", resolution: "768p" },
};
const GM = ["auto", "text-to-video", "image-to-video", "reference-to-video"];
const PVIDEO = {
  params: {
    generation_mode: { type: "select", default: "auto",
      options: [...GM, "talking-avatar"].map((value) => ({ value })) },
    prompt_upsampler: { type: "select", default: "turbo", showWhen: { generation_mode: GM },
      options: [{ value: "off" }, { value: "turbo" }, { value: "max" }] },
    keep_audio: { type: "boolean", default: false, showWhen: { generation_mode: GM } },
    audio: { type: "text", default: "", showWhen: { generation_mode: ["talking-avatar"] } },
  },
  defaults: { generation_mode: "auto" },
};
const PIXVERSE = {
  params: {
    effectType: { type: "select", options: [{ value: "none" }, { value: "effect" }, { value: "cameraMovement" }] },
    effect: { type: "select", showWhen: { effectType: "effect" }, options: [{ value: "none" }, { value: "jiggle jiggle" }] },
    cameraMovement: { type: "select", showWhen: { effectType: "cameraMovement" }, options: [{ value: "zoom_in" }, { value: "zoom_out" }] },
    motionMode: { type: "select", options: [{ value: "normal" }, { value: "fast" }] },
  },
  defaults: { effectType: "none", effect: "none", cameraMovement: "zoom_in" },
};
const CAT = { openjutsu: OPENJUTSU, "pvideo-2-pro": PVIDEO, "pixverse-v45": PIXVERSE };

// Minimal DOM: the box keeps its innerHTML and hands back one fake control per data-of attribute.
function fakeBox() {
  const box = { _html: "", _els: [] };
  Object.defineProperty(box, "innerHTML", {
    get() { return this._html; },
    set(h) {
      this._html = h;
      this._els = [...h.matchAll(/<(select|textarea|input)([^>]*?)data-of="([^"]+)"([^>]*)>/g)].map((m) => {
        const tm = (m[2] + m[4]).match(/type="([^"]+)"/);
        return { tag: m[1], type: m[1] === "select" ? "select-one" : m[1] === "textarea" ? "textarea" : (tm ? tm[1] : "text"),
          dataset: { of: m[3] }, value: "", checked: false, _l: {},
          addEventListener(ev, fn) { this._l[ev] = fn; } };
      });
    },
  });
  box.querySelectorAll = () => box._els;
  return box;
}
function fakeNode(model) {
  const box = fakeBox();
  return { type: "vedit", fields: { model, modelOpts: {} }, el: { querySelector: () => box }, box };
}
const keys = (n) => n.box._els.map((e) => e.dataset.of);
const fire = (n, key, value) => {
  const el = n.box._els.find((e) => e.dataset.of === key);
  if (!el) throw new Error("no control for " + key);
  if (el.type === "checkbox") el.checked = value; else el.value = value;
  el._l[el.type === "checkbox" ? "change" : "input"]();
};

let saves = 0;
const ctx = {
  NODE_TYPES: {
    tvideo: { modelKind: "video", modelFilter: "t2v", refInputs: true },
    ivideo: { modelKind: "video", modelFilter: "i2v", endFrame: true },
    vedit: { modelKind: "video", modelFilter: "v2v", refInputs: true },
  },
  catItem: (_kind, id) => CAT[id] || null,
  nearestDimOption: (v, pairs, dflt) => dflt,
  t: (s) => s, translateTree: () => {},
  updateNodePrice: () => {}, refreshRunEstimate: () => {}, save: () => { saves++; },
};
vm.createContext(ctx);
new vm.Script(bundle, { filename: "index.html#model-opts-showwhen" }).runInContext(ctx);
const T = ctx.__t;

console.log("videoOptDefs carries showWhen");
const defs = T.videoOptDefs("openjutsu", "vedit");
ok(defs.length === 8, `all 8 OpenJutsu knobs still described (resolution is node-owned) (${defs.length})`);
ok(JSON.stringify(defs.find((d) => d.key === "target").sw) === JSON.stringify(OBJ), "target.sw = {swap_type:'object'}");
ok(defs.find((d) => d.key === "swap_type").sw === undefined, "swap_type itself is ungated");

console.log("showWhenOK");
ok(T.showWhenOK(undefined, {}, OPENJUTSU), "no showWhen → shown");
ok(T.showWhenOK(CHR, {}, OPENJUTSU), "untouched swap_type → catalog default 'character' matches");
ok(!T.showWhenOK(OBJ, {}, OPENJUTSU), "untouched swap_type → object-only knob hidden");
ok(T.showWhenOK(OBJ, { swap_type: "object" }, OPENJUTSU), "stored value wins over default");
ok(T.showWhenOK({ generation_mode: GM }, {}, PVIDEO), "array allowed values: default 'auto' is listed");
ok(!T.showWhenOK({ generation_mode: GM }, { generation_mode: "talking-avatar" }, PVIDEO), "array allowed values: unlisted value hides");
ok(T.showWhenOK({ nope: "x" }, {}, OPENJUTSU), "controller the catalog doesn't describe → permissive");
ok(T.showWhenOK({ swap_type: "object" }, {}, { params: { swap_type: { type: "select", options: [{ value: "object" }, { value: "character" }] } } }),
  "no default → a select's first option is the current value");
ok(T.showWhenOK({ swap_type: "object", resolution: "768p" }, { swap_type: "object" }, OPENJUTSU)
  && !T.showWhenOK({ swap_type: "object", resolution: "480p" }, { swap_type: "object" }, OPENJUTSU), "every key must match");

console.log("refreshModelOpts — OpenJutsu Edit type");
const n = fakeNode("openjutsu");
T.refreshModelOpts(n);
ok(JSON.stringify(keys(n)) === JSON.stringify(["swap_type", "role_1", "role_2", "role_3", "role_4"]),
  `default (character) renders swap_type + role_1..4 (${keys(n).join(",")})`);
ok(/Model options · 5</.test(n.box.innerHTML), "summary count follows the visible set (· 5, not · 8)");
fire(n, "role_1", "the man in red");
ok(n.fields.modelOpts.role_1 === "the man in red", "typing a role stores it");
fire(n, "swap_type", "object");
ok(JSON.stringify(keys(n)) === JSON.stringify(["swap_type", "mode", "target", "change_to"]),
  `flip to object re-renders immediately (${keys(n).join(",")})`);
ok(!("role_1" in n.fields.modelOpts), "hidden role_1 pruned from modelOpts — never sent");
fire(n, "target", "the car");
fire(n, "change_to", "a red bicycle");
ok(n.fields.modelOpts.target === "the car" && n.fields.modelOpts.swap_type === "object", "object knobs store normally");
const before = n.box.innerHTML;
fire(n, "mode", "background");
ok(n.box.innerHTML === before, "a non-controller change does not re-render (no focus loss)");
ok(n.fields.modelOpts.mode === "background", "object-edit mode stored");
fire(n, "swap_type", "character");
ok(!("target" in n.fields.modelOpts) && !("change_to" in n.fields.modelOpts) && !("mode" in n.fields.modelOpts),
  "back to character prunes target/change_to/mode");
ok(keys(n).includes("role_4") && !keys(n).includes("target"), "role knobs back, object knobs gone");

console.log("refreshModelOpts — saved graph with a stale hidden value");
const s = fakeNode("openjutsu");
s.fields.modelOpts = { target: "leftover", role_2: "kept" };
T.refreshModelOpts(s);
ok(!("target" in s.fields.modelOpts) && s.fields.modelOpts.role_2 === "kept", "load path prunes the object-only value, keeps the role");

console.log("refreshModelOpts — other catalogs");
const pv = fakeNode("pvideo-2-pro");
T.refreshModelOpts(pv);
ok(keys(pv).includes("prompt_upsampler") && keys(pv).includes("keep_audio") && !keys(pv).includes("audio"),
  `P-Video 2 Pro auto: array-gated knobs shown, talking-avatar audio hidden (${keys(pv).join(",")})`);
fire(pv, "generation_mode", "talking-avatar");
ok(!keys(pv).includes("prompt_upsampler") && !keys(pv).includes("keep_audio"), `talking-avatar hides the generation-only knobs (${keys(pv).join(",")})`);
const px = fakeNode("pixverse-v45");
T.refreshModelOpts(px);
ok(!keys(px).includes("effect") && !keys(px).includes("cameraMovement"), "PixVerse effectType none → effect/cameraMovement hidden");
fire(px, "effectType", "cameraMovement");
ok(keys(px).includes("cameraMovement") && !keys(px).includes("effect"), "effectType cameraMovement → only cameraMovement");

const missing = fakeNode("not-in-catalog");
missing.fields.modelOpts = { target: "x" };
T.refreshModelOpts(missing);
ok(missing.fields.modelOpts.target === "x", "catalog miss → nothing pruned (permissive, like the other knob gates)");

console.log(failed ? `\n✗ ${failed} model-opts showWhen check(s) failed` : "\n✓ model-opts showWhen gating ok");
process.exit(failed ? 1 : 0);
