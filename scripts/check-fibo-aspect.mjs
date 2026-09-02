#!/usr/bin/env node
// FIBO Generate 1.5 aspect_ratio knob (catalog gap).
//
// /api/v1/image-models lists only 1mp/4mp for bria/fibo-generate-1.5/text-to-image.
// Marketing /api/models additionalParams.aspect_ratio is a 9-option select (1:1…16:9).
// Nanoodle's Image size control is those megapixel tiers — without this knob every
// FIBO run is stuck at the API default 1:1.
//
// Pins, offline (live catalog GET is optional and skipped on network failure):
//   * IMAGE_ASPECT / imageAspectSpec option lists match in index.html and play.html
//   * editor dimDefs grows aspect (wire aspect_ratio) for FIBO, not Recraft/Muse
//   * editor imgExtra sends aspect_ratio for FIBO (chosen or default 1:1) and
//     omits it for Recraft V4 (leftover fields.aspect must not leak)
//   * play RUNTIME imgExtra + image.run POST the same key
//   * live /api/models additionalParams.aspect_ratio still matches the shipped list
//
// Zero paid generation. Catalog GET is free.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadEngine } from "./play-engine.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

const FIBO = "bria/fibo-generate-1.5/text-to-image";
const WANT = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9"];

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

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

function loadEditor() {
  const code = [
    "var SIZES = [['1024x1024','square']];",
    "var SIZE_FALLBACK = SIZES;",
    "var ASPECT_FALLBACK = [['16:9','16:9']];",
    "var DURATION_FALLBACK = [['5','5 sec']];",
    block(IDX, "function selOpts(param){"),
    block(IDX, "function paramDef(param, opts){"),
    block(IDX, "const IMAGE_ASPECT = {").replace(/^const\s/, "var "),
    block(IDX, "function imageAspectSpec(model){"),
    block(IDX, "function dimDefs(type, model){"),
    block(IDX, "function imgExtra(n){"),
    "function loraParams(){ return {}; }",
    "function needsCustomCivitai(){ return false; }",
    "function airModelTakesNegative(){ return false; }",
    "function t(s){ return s; }",
    "var catalogs = { image:[] };",
    "function catItem(){ return null; }",
  ].join("\n");
  const ctx = { console, Math, isNaN, Number, String };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

function loadPlayHelpers() {
  const code = [
    block(PLAY, "function imageAspectSpec(model){"),
    block(PLAY, "function dimOptionsFromItem(type, m){"),
  ].join("\n");
  const ctx = { console, Math };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

const editor = loadEditor();
const play = loadPlayHelpers();

{
  const spec = editor.imageAspectSpec(FIBO);
  const listed = (spec && spec.options || []).map((o) => String(Array.isArray(o) ? o[0] : o));
  if (!spec) fail("editor: imageAspectSpec(FIBO) is null");
  else if (WANT.some((v) => !listed.includes(v)) || listed.length !== WANT.length)
    fail("editor: IMAGE_ASPECT options drifted, got " + listed.join(","));
  else ok("editor: IMAGE_ASPECT lists " + listed.join("/"));
  if (editor.imageAspectSpec("recraft-v4") || editor.imageAspectSpec("meta/muse-image/text-to-image"))
    fail("editor: imageAspectSpec leaked onto Recraft/Muse");
  else ok("editor: imageAspectSpec is FIBO-only");
}

{
  const p = play.imageAspectSpec(FIBO);
  const listed = (p && p.options || []).map((o) => String(o[0]));
  const e = (editor.imageAspectSpec(FIBO).options || []).map((o) => String(o[0]));
  if (listed.join("|") !== e.join("|")) fail("play ↔ editor IMAGE_ASPECT option lists differ");
  else ok("play ↔ editor IMAGE_ASPECT option lists match");
}

{
  const defs = editor.dimDefs("image", FIBO);
  const asp = defs.find((d) => d.f === "aspect");
  if (!asp || asp.wire !== "aspect_ratio") fail("editor dimDefs: FIBO aspect missing or wrong wire");
  else ok("editor dimDefs: FIBO aspect wire is aspect_ratio");
  if (editor.dimDefs("image", "recraft-v4").some((d) => d.f === "aspect"))
    fail("editor dimDefs: Recraft V4 grew an aspect knob");
  else ok("editor dimDefs: Recraft V4 has no aspect knob");
}

{
  const sent = editor.imgExtra({ fields: { model: FIBO, aspect: "16:9", seed: "" } });
  if (sent.aspect_ratio !== "16:9") fail("editor imgExtra: FIBO 16:9 not sent, got " + JSON.stringify(sent));
  else ok("editor imgExtra: FIBO sends aspect_ratio 16:9");
  const def = editor.imgExtra({ fields: { model: FIBO } });
  if (def.aspect_ratio !== "1:1") fail("editor imgExtra: empty aspect must default to 1:1, got " + JSON.stringify(def));
  else ok("editor imgExtra: empty FIBO aspect defaults to 1:1");
  const leak = editor.imgExtra({ fields: { model: "recraft-v4", aspect: "16:9" } });
  if (leak.aspect_ratio) fail("editor imgExtra: leftover aspect leaked onto Recraft V4");
  else ok("editor imgExtra: Recraft V4 omits aspect_ratio");
}

{
  const pack = play.dimOptionsFromItem("image", {
    id: FIBO,
    supported_parameters: { resolutions: ["1mp", "4mp"] },
  });
  if (!(pack.aspect && pack.aspect.some((o) => o[0] === "9:16")))
    fail("play dimOptionsFromItem: FIBO aspect missing 9:16");
  else ok("play dimOptionsFromItem: FIBO aspect includes 9:16");
}

{
  const app = loadEngine();
  let extra = null;
  const ctx = {
    // RUNTIME image.run calls ctx.genImage(prompt, model, size, src, mask, extra, opts)
    genImage: (_prompt, _model, _size, _src, _mask, e) => { extra = e; return ["data:image/png;base64,xx"]; },
  };
  await app.NODE_TYPES.image.run(
    { id: "i1", type: "image", fields: { model: FIBO, prompt: "studio still", size: "1mp", aspect: "9:16", variations: "1" } },
    {},
    ctx,
    () => {},
  );
  if (!extra || extra.aspect_ratio !== "9:16")
    fail("play image.run: FIBO extra.aspect_ratio not 9:16, got " + JSON.stringify(extra));
  else ok("play image.run: FIBO posts extra.aspect_ratio 9:16");

  extra = null;
  await app.NODE_TYPES.image.run(
    { id: "i2", type: "image", fields: { model: "recraft-v4", prompt: "logo", size: "1024x1024", aspect: "9:16", variations: "1" } },
    {},
    ctx,
    () => {},
  );
  if (extra && extra.aspect_ratio)
    fail("play image.run: leftover aspect leaked onto Recraft V4, got " + JSON.stringify(extra));
  else ok("play image.run: Recraft V4 omits aspect_ratio");
}

// Live pin — marketing catalog is the only machine-readable source for this field.
// Skip (do not fail) when offline so pre-commit stays usable without egress.
try {
  const r = await fetch("https://nano-gpt.com/api/models", { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const m = j && j.models && j.models.image && j.models.image[FIBO];
  const ar = m && m.additionalParams && m.additionalParams.aspect_ratio;
  const vals = ((ar && ar.options) || []).map((o) => String(o.value));
  if (!m) fail("live /api/models: FIBO 1.5 missing from marketing catalog");
  else if (!ar) fail("live /api/models: FIBO 1.5 additionalParams.aspect_ratio gone — drop IMAGE_ASPECT if v1 now lists it");
  else if (WANT.some((v) => !vals.includes(v)))
    fail("live /api/models: FIBO aspect options drifted, got " + vals.join(","));
  else ok("live /api/models: FIBO additionalParams.aspect_ratio still " + vals.join("/"));

  const v1 = await fetch("https://nano-gpt.com/api/v1/image-models", { signal: AbortSignal.timeout(12000) });
  if (v1.ok) {
    const cat = await v1.json();
    const row = (cat.data || []).find((x) => x.id === FIBO);
    const sp = (row && row.supported_parameters) || {};
    if (sp.aspect_ratio || (sp.parameters && sp.parameters.aspect_ratio))
      fail("live /api/v1/image-models now lists aspect_ratio — drop the IMAGE_ASPECT gap map");
    else ok("live /api/v1/image-models: FIBO still has no aspect_ratio (gap map still needed)");
  }
} catch (e) {
  console.log("⊘ skip live catalog pin: " + (e && e.message ? e.message : e));
}

if (failed) process.exit(1);
console.log("FIBO aspect_ratio knob checks passed.");
