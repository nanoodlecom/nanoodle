#!/usr/bin/env node
// Catalog image knobs: negative prompt, steps, guidance, prompt expansion.
//
// The v1 image catalog advertises these flat under supported_parameters (MOSS Image,
// created 2026-10-18: negative_prompt:true, num_inference_steps {1..100, def 50},
// guidance_scale {0..10, def 3}, enable_prompt_expansion {default:true}). The Image node
// shows them only when the model advertises them, and both engines send them only when set.
//
// Pins, offline (zero network, zero spend):
//   * editor imageKnobSpec reads the MOSS shape and returns null for a bare model
//   * editor imageKnobExtra sends only set keys, clamps to the catalog range, rounds steps
//   * editor imgExtra merges the knobs, never leaks them onto a model that lacks them,
//     and never overrides the AIR negative_prompt path
//   * play RUNTIME image.run posts the same keys from the raw catalog (exports forward them)
//   * the Image node renders the knobs box (data-imgknob) from refreshCivitParams

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadEngine, catalog } from "./play-engine.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function block(src, anchor) {
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error("anchor not found: " + anchor);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced braces for: " + anchor);
}

const MOSS_SP = {
  negative_prompt: true,
  num_inference_steps: { min: 1, max: 100, default: 50 },
  guidance_scale: { min: 0, max: 10, default: 3 },
  enable_prompt_expansion: { default: true },
  resolutions: ["1024x1024", "512x512"],
  max_output_images: 4,
};

const editor = (() => {
  const code = [
    block(IDX, "function imageKnobSpec(sp){"),
    block(IDX, "function imageKnobExtra(fields, spec){"),
    block(IDX, "function imageModelOpts(opts) {"),
    block(IDX, "function imgExtra(n){"),
    "function imageAspectExtra(){ return {}; }",
    "function loraParams(){ return {}; }",
    "function needsCustomCivitai(){ return false; }",
    "function airModelTakesNegative(m){ return /^persona:/.test(String(m||'')); }",
    "var catalogs = { image:[] };",
    "function catItem(kind,id){ return (catalogs[kind]||[]).find(function(m){ return m.id===id; }); }",
  ].join("\n");
  const ctx = { console, Math, isNaN, isFinite, Number, String, Object, JSON };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
})();

{
  const spec = editor.imageKnobSpec(MOSS_SP);
  if (!spec || !spec.negative || !eq(spec.steps, { min: 1, max: 100, def: 50 }) ||
      !eq(spec.guidance, { min: 0, max: 10, def: 3 }) || !spec.expand || spec.expand.def !== true)
    fail("editor imageKnobSpec: MOSS shape misread, got " + JSON.stringify(spec));
  else ok("editor imageKnobSpec: MOSS → negative + steps 1–100 + guidance 0–10 + expansion (on)");
  if (editor.imageKnobSpec({ resolutions: ["1k"] }) !== null || editor.imageKnobSpec(undefined) !== null)
    fail("editor imageKnobSpec: bare model must have no knobs");
  else ok("editor imageKnobSpec: bare / missing catalog → null");
  if (editor.imageKnobSpec({ negative_prompt: false, num_inference_steps: { min: 5, max: 5 } }) !== null)
    fail("editor imageKnobSpec: negative_prompt:false / empty range must not light up");
  else ok("editor imageKnobSpec: negative_prompt:false and a zero-width range stay hidden");
  const off = editor.imageKnobSpec({ enable_prompt_expansion: { default: false } });
  if (!off || off.expand.def !== false) fail("editor imageKnobSpec: expansion default:false not honored");
  else ok("editor imageKnobSpec: expansion default:false paints unchecked");
}

{
  const spec = editor.imageKnobSpec(MOSS_SP);
  const none = editor.imageKnobExtra({}, spec);
  if (Object.keys(none).length) fail("editor imageKnobExtra: untouched node must send nothing, got " + JSON.stringify(none));
  else ok("editor imageKnobExtra: untouched node sends nothing (model defaults apply)");
  const all = editor.imageKnobExtra({ negativePrompt: "  text, watermark ", steps: "28.6", guidance: "4.5", promptExpansion: false }, spec);
  if (!eq(all, { negative_prompt: "text, watermark", num_inference_steps: 29, guidance_scale: 4.5, enable_prompt_expansion: false }))
    fail("editor imageKnobExtra: wrong body, got " + JSON.stringify(all));
  else ok("editor imageKnobExtra: sends trimmed negative, rounded steps, guidance, expansion off");
  const clamp = editor.imageKnobExtra({ steps: "500", guidance: "-3" }, spec);
  if (clamp.num_inference_steps !== 100 || clamp.guidance_scale !== 0)
    fail("editor imageKnobExtra: out-of-range values must clamp, got " + JSON.stringify(clamp));
  else ok("editor imageKnobExtra: out-of-range steps/guidance clamp to the catalog range");
  const junk = editor.imageKnobExtra({ steps: "abc", guidance: " ", negativePrompt: "   " }, spec);
  if (Object.keys(junk).length) fail("editor imageKnobExtra: junk/blank values must be omitted, got " + JSON.stringify(junk));
  else ok("editor imageKnobExtra: non-numeric / blank values are omitted");
  if (Object.keys(editor.imageKnobExtra({ steps: "20", negativePrompt: "x" }, null)).length)
    fail("editor imageKnobExtra: no spec must send nothing");
  else ok("editor imageKnobExtra: no catalog spec → nothing sent");
}

{
  editor.catalogs.image = [
    { id: "moss-image", knobs: editor.imageKnobSpec(MOSS_SP) },
    { id: "recraft-v4", knobs: null },
  ];
  const sent = editor.imgExtra({ fields: { model: "moss-image", seed: "7", negativePrompt: "blur", steps: "30", guidance: "5", promptExpansion: false } });
  if (!eq(sent, { seed: 7, negative_prompt: "blur", num_inference_steps: 30, guidance_scale: 5, enable_prompt_expansion: false }))
    fail("editor imgExtra: MOSS knobs not merged, got " + JSON.stringify(sent));
  else ok("editor imgExtra: MOSS sends seed + negative + steps + guidance + expansion");
  const leak = editor.imgExtra({ fields: { model: "recraft-v4", negativePrompt: "blur", steps: "30", guidance: "5", promptExpansion: false } });
  if (Object.keys(leak).length) fail("editor imgExtra: leftover MOSS knobs leaked onto Recraft V4, got " + JSON.stringify(leak));
  else ok("editor imgExtra: leftover knobs after a model swap never leak");
  editor.catalogs.image.push({ id: "persona:1@2", knobs: { negative: true } });
  const air = editor.imgExtra({ fields: { model: "persona:1@2", negativePrompt: "lowres" } });
  if (!eq(air, { negative_prompt: "lowres" })) fail("editor imgExtra: AIR negative path changed, got " + JSON.stringify(air));
  else ok("editor imgExtra: AIR negative_prompt path unchanged");
}

{
  const body = block(IDX, "function refreshCivitParams(n){");
  if (!/imageKnobsHtml\(n\)/.test(body) || !/wireImageKnobs\(box, n\)/.test(body))
    fail("editor refreshCivitParams no longer renders/wires the image knobs box");
  else ok("editor refreshCivitParams renders + wires the image knobs box");
  if (!/knobs: imageKnobSpec\(m\.supported_parameters\)/.test(IDX))
    fail("editor normImage no longer stamps knobs from supported_parameters");
  else ok("editor normImage stamps knobs from supported_parameters");
}

{
  const spSrc = block(PLAY, "function imageKnobSpec(sp){"), exSrc = block(PLAY, "function imageKnobExtra(fields, spec){");
  const ctx = { Math, isFinite, Number, String, Object };
  vm.createContext(ctx);
  vm.runInContext(spSrc + "\n" + exSrc, ctx);
  const f = { negativePrompt: "blur", steps: "500", guidance: "2.5", promptExpansion: true };
  const a = editor.imageKnobExtra(f, editor.imageKnobSpec(MOSS_SP)), b = ctx.imageKnobExtra(f, ctx.imageKnobSpec(MOSS_SP));
  if (!eq(a, b)) fail("play ↔ editor imageKnobExtra differ: " + JSON.stringify(a) + " vs " + JSON.stringify(b));
  else ok("play ↔ editor imageKnobSpec/imageKnobExtra agree");
}

{
  catalog.image = [{ id: "moss-image", supported_parameters: MOSS_SP }, { id: "recraft-v4", supported_parameters: { resolutions: ["1024x1024"] } }];
  const app = loadEngine();
  let extra = null;
  const ctx = { genImage: (_p, _m, _s, _src, _mask, e) => { extra = e; return ["data:image/png;base64,xx"]; } };
  await app.NODE_TYPES.image.run(
    { id: "i1", type: "image", fields: { model: "moss-image", prompt: "menu board", size: "1024x1024", variations: "1", negativePrompt: "watermark", steps: "40", guidance: "4", promptExpansion: false } },
    {}, ctx, () => {},
  );
  if (!extra || extra.negative_prompt !== "watermark" || extra.num_inference_steps !== 40 || extra.guidance_scale !== 4 || extra.enable_prompt_expansion !== false)
    fail("play image.run: MOSS knobs not posted, got " + JSON.stringify(extra));
  else ok("play image.run: MOSS posts negative + steps + guidance + expansion");
  extra = null;
  await app.NODE_TYPES.image.run(
    { id: "i2", type: "image", fields: { model: "recraft-v4", prompt: "logo", size: "1024x1024", variations: "1", negativePrompt: "watermark", steps: "40" } },
    {}, ctx, () => {},
  );
  if (extra && ("negative_prompt" in extra || "num_inference_steps" in extra))
    fail("play image.run: knobs leaked onto Recraft V4, got " + JSON.stringify(extra));
  else ok("play image.run: Recraft V4 omits the knobs");
}

if (failed) { console.error(`\n${failed} image-knob check(s) failed`); process.exit(1); }
console.log("\n✓ image knobs (negative prompt / steps / guidance / prompt expansion) pinned");
