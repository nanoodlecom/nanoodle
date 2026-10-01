#!/usr/bin/env node
// Offline pins for the 3D catalog normalizer, per-run price labels, and modality gates.
// No network, no API spend. Select defaults must be strings (trellis texture_size default
// is the number 2048 against string options). The card price is pricing.per_run; the picker
// shows $min–$max only when per_run_by_variant actually spans a range.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "index.html"), "utf8");

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

function extractFn(name) {
  const at = SRC.search(new RegExp("function " + name + "\\("));
  if (at < 0) throw new Error(name + "() not found");
  let depth = 0;
  for (let j = SRC.indexOf("{", at); j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) return SRC.slice(at, j + 1);
  }
  throw new Error("could not brace-match " + name);
}
const grab = (re, what) => {
  const m = SRC.match(re);
  if (!m) throw new Error(what + " not found");
  return m[0];
};

const ctx = {
  _num: (x) => (x != null && isFinite(+x)) ? +x : null,
  catalogs: { model3d: [] },
  catItem: (kind, id) => (ctx.catalogs[kind] || []).find((m) => m.id === id) || null,
  NODE_TYPES: {
    model3d: { modelKind: "model3d" },
    tvideo: { modelKind: "video", modelFilter: "t2v", refInputs: true },
  },
};
vm.createContext(ctx);
const bundle = [
  grab(/const MODEL3D_IMAGE_DEFAULT = "[^"]+";/, "MODEL3D_IMAGE_DEFAULT"),
  grab(/const MODEL3D_TEXT_DEFAULT = "[^"]+";/, "MODEL3D_TEXT_DEFAULT"),
  extractFn("fmtUsdPlain"),
  extractFn("model3dPriceLabels"),
  extractFn("norm3d"),
  extractFn("model3dInputMods"),
  grab(/const PRICE_OR_DIM_PARAM = \/[^\n]*;/, "PRICE_OR_DIM_PARAM"),
  grab(/const VIDEO_IMG_ROLE_KEYS = \{[^}]*\};/, "VIDEO_IMG_ROLE_KEYS"),
  grab(/const VIDEO_REF_PRICE_KEYS = \[[^\]]*\];/, "VIDEO_REF_PRICE_KEYS"),
  grab(/const videoRefsModePriced = \(p\)=>[\s\S]*?;/, "videoRefsModePriced"),
  grab(/const videoRefsPriced = \(m\)=> \{[^}]*\};/, "videoRefsPriced"),
  extractFn("videoFreetextSkip"),
  extractFn("videoOptDefs"),
  "globalThis.api = { fmtUsdPlain, model3dPriceLabels, norm3d, model3dInputMods, videoOptDefs, MODEL3D_IMAGE_DEFAULT, MODEL3D_TEXT_DEFAULT };",
].join("\n");
vm.runInContext(bundle, ctx);
const api = ctx.api;

const trellis = api.norm3d({
  id: "wavespeed-ai/trellis-2/image-to-3d",
  name: "TRELLIS.2",
  created: 1,
  architecture: { input_modalities: ["image"] },
  capabilities: {},
  pricing: { per_run: 0.2, per_run_by_variant: { "512": 0.1, "1024": 0.2, "1536": 0.45 } },
  supported_parameters: {
    parameters: {
      resolution: { type: "select", options: [{ value: "512" }, { value: "1024" }], default: "1024" },
      texture_size: { type: "select", options: [{ value: "1024" }, { value: "2048" }, { value: "4096" }], default: 2048 },
      seed: { type: "number", default: -1 },
    },
    defaults: { resolution: "1024", texture_size: 2048, seed: -1 },
  },
});
ok(trellis.params.texture_size.default === "2048", "trellis texture_size default is the string \"2048\", got " + JSON.stringify(trellis.params.texture_size.default));
ok(trellis.params.texture_size.options.every((o) => typeof o.value === "string"), "trellis select option values are strings");
ok(trellis.defaults.texture_size === "2048", "trellis defaults.texture_size stringified");
ok(trellis.defaults.seed === -1, "number defaults stay numbers");
ok(trellis.price === "$0.10–$0.45", "picker spans the variant range, got " + trellis.price);
ok(api.model3dPriceLabels(trellis.pricing).card === "$0.20", "card price is per_run, not the range");
ok(api.model3dPriceLabels(trellis.pricing, { modelOpts: { resolution: "1024" } }, trellis.defaults).card === "$0.20",
  "card stays on per_run while knobs match the catalog default");
ok(api.model3dPriceLabels(trellis.pricing, { modelOpts: { resolution: "1536" } }, trellis.defaults).card === "$0.10–$0.45",
  "card spans the variant range once a knob leaves the default");
ok(api.fmtUsdPlain(2.304) === "2.30" && api.fmtUsdPlain(2.064) === "2.06",
  "amounts at or above $0.10 use two decimals");
ok(JSON.stringify(trellis.modalities) === JSON.stringify(["image"]), "image-only modalities kept");

const tripo = api.norm3d({
  id: "tripo3d/v2.5", name: "Tripo 2.5", created: 1,
  architecture: { input_modalities: ["image", "audio"] },
  pricing: { per_run: 0.3, per_run_by_variant: { default: 0.3 } },
  supported_parameters: { parameters: {} },
});
ok(tripo.price === "$0.30", "single-variant picker is the per-run price, got " + tripo.price);
ok(api.model3dPriceLabels(tripo.pricing).card === tripo.price, "card and picker match when variants do not span");
ok(JSON.stringify(tripo.modalities) === JSON.stringify(["image"]), "non image/text modalities dropped");

const rapid = api.norm3d({
  id: "wavespeed-ai/hunyuan-3d-v3.1-rapid", name: "Hunyuan rapid", created: 2,
  architecture: { input_modalities: ["image", "text"] },
  pricing: { per_run: 0.0225, per_run_by_variant: { default: 0.0225 } },
  supported_parameters: { parameters: {} },
});
ok(rapid.price === "$0.0225", "sub-cent per_run keeps four decimals, got " + rapid.price);
ok(JSON.stringify(rapid.modalities) === JSON.stringify(["image", "text"]), "text+image modalities kept");

const astra = api.model3dPriceLabels({ per_run: 8, per_run_by_variant: { default: 8 } });
ok(astra.card === "$8.00" && astra.picker === "$8.00", "whole-dollar per_run formats with cents");

ok(api.model3dInputMods("tripo3d/v2.5").image === true && api.model3dInputMods("tripo3d/v2.5").text === false,
  "offline fallback: pinned image default is image-only");
ok(api.model3dInputMods("wavespeed-ai/hunyuan-3d-v3.1-rapid").text === true,
  "offline fallback: pinned text default accepts text");
ok(api.model3dInputMods("some-unknown-id").image && api.model3dInputMods("some-unknown-id").text,
  "unknown id shows both ports until the catalog arrives");

ctx.catalogs.model3d = [trellis, tripo, rapid];
ok(api.model3dInputMods(trellis.id).text === false && api.model3dInputMods(rapid.id).text === true,
  "loaded catalog modalities win over the offline fallback");

const defs3d = api.videoOptDefs(trellis.id, "model3d");
ok(defs3d.some((d) => d.key === "resolution"), "3D renderer keeps resolution (a real knob, not a video dim)");
ok(defs3d.some((d) => d.key === "texture_size") && defs3d.find((d) => d.key === "texture_size").def === "2048",
  "3D texture_size knob carries the string default");
ok(defs3d.some((d) => d.key === "seed"), "number knobs such as seed still surface");
ctx.catalogs.video = [{ id: "vid", params: { resolution: { type: "select", options: [{ value: "512", label: "512" }, { value: "1024", label: "1024" }], default: "1024" } }, defaults: { resolution: "1024" } }];
const defsVid = api.videoOptDefs("vid", "tvideo");
ok(!defsVid.some((d) => d.key === "resolution"), "video nodes still hide resolution");

if (fail) { console.error("\n✗ check-3d-catalog: " + fail + " failed"); process.exit(1); }
console.log("\n✓ check-3d-catalog");
