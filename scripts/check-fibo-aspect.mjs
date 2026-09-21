#!/usr/bin/env node
// Image aspect_ratio knob.
//
// v1 image-models lists aspect_ratio as a string array beside resolutions. When those
// ratios are not already the size list, both engines send aspect_ratio (Qwen Image 2.1,
// Anima, Qwen Image 3, FIBO Generate 1.5, …). A list that only repeats resolutions
// (FIBO Edit 1.5) stays on size. FIBO Generate's offline id map remains for a catalog miss:
// size tiers are 1mp/4mp, and marketing /api/models additionalParams.aspect_ratio is the
// 9-option select (1:1…16:9). Without the knob every such run is stuck at the API default.
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
import { loadEngine, catalog } from "./play-engine.mjs";

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
    block(IDX, "function aspectFromParams(sp){"),
    block(IDX, "function imageAspectSpec(model){"),
    block(IDX, "function imageAspectExtra(model, aspect){"),
    block(IDX, "function dimDefs(type, model){"),
    block(IDX, "function imgExtra(n){"),
    "function loraParams(){ return {}; }",
    "function needsCustomCivitai(){ return false; }",
    "function airModelTakesNegative(){ return false; }",
    "function t(s){ return s; }",
    "var catalogs = { image:[] };",
    "function catItem(kind,id){ return (catalogs[kind]||[]).find(function(m){ return m.id===id; }); }",
  ].join("\n");
  const ctx = { console, Math, isNaN, Number, String };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

function loadPlayHelpers() {
  const code = [
    block(PLAY, "function aspectFromParams(sp){"),
    block(PLAY, "function imageAspectSpec(model){"),
    block(PLAY, "function imageAspectFor(model, raw){"),
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

// v1 aspect_ratio arrays that are NOT already the size list (live shape, 2026-09-21).
const QWEN21 = "qwen-image-2.1/text-to-image";
const QWEN21_EDIT = "qwen-image-2.1/edit";
const ANIMA = "anima/text-to-image";
const QWEN21_RATIOS = ["1:1", "2:3", "3:2", "9:16", "16:9"];
{
  const spec = editor.aspectFromParams({
    resolutions: ["1k", "1.5k", "2k"],
    aspect_ratio: QWEN21_RATIOS,
  });
  if (!spec || spec.def !== "1:1" || !spec.options.some((o) => o[0] === "16:9"))
    fail("editor aspectFromParams: Qwen 2.1 ratios missing, got " + JSON.stringify(spec));
  else ok("editor aspectFromParams: Qwen 2.1 size tiers keep a separate aspect knob");
  const edit = editor.aspectFromParams({
    resolutions: ["1k", "2k"],
    aspect_ratio: ["auto", "1:1", "16:9"],
  });
  if (!edit || edit.def !== "auto") fail("editor aspectFromParams: edit default must be auto, got " + JSON.stringify(edit));
  else ok("editor aspectFromParams: edit models default to auto");
  const redundant = editor.aspectFromParams({
    resolutions: ["auto", "1:1", "16:9"],
    aspect_ratio: ["", "auto", "1:1", "16:9"],
  });
  if (redundant) fail("editor aspectFromParams: ratio-sized model must not grow a second knob");
  else ok("editor aspectFromParams: FIBO-edit-style ratios stay on size");
  const playSpec = play.aspectFromParams({
    resolutions: ["1k", "1.5k"],
    aspect_ratio: QWEN21_RATIOS,
  });
  if (!playSpec || JSON.stringify(playSpec) !== JSON.stringify(spec))
    fail("play aspectFromParams drifted from editor: " + JSON.stringify(playSpec));
  else ok("play aspectFromParams matches the Qwen 2.1 list");
}

{
  editor.catalogs.image = [{
    id: QWEN21,
    resolutions: ["1k", "1.5k", "2k"],
    aspect: { options: QWEN21_RATIOS.map((v) => [v, v]), def: "1:1" },
  }, {
    id: ANIMA,
    resolutions: ["1k", "1.5k"],
    aspect: { options: QWEN21_RATIOS.map((v) => [v, v]), def: "1:1" },
  }, {
    id: "bria/fibo-edit-1.5/edit",
    resolutions: ["auto", "1:1", "16:9"],
    aspect: null,
  }];
  const defs = editor.dimDefs("image", QWEN21);
  const asp = defs.find((d) => d.f === "aspect");
  if (!asp || asp.wire !== "aspect_ratio" || asp.def !== "1:1")
    fail("editor dimDefs: Qwen 2.1 aspect knob missing, got " + JSON.stringify(asp));
  else ok("editor dimDefs: Qwen 2.1 aspect wire is aspect_ratio");
  const sent = editor.imgExtra({ fields: { model: QWEN21, aspect: "16:9", seed: "" } });
  if (sent.aspect_ratio !== "16:9") fail("editor imgExtra: Qwen 2.1 16:9 not sent, got " + JSON.stringify(sent));
  else ok("editor imgExtra: Qwen 2.1 sends aspect_ratio 16:9");
  const def = editor.imgExtra({ fields: { model: ANIMA, seed: "" } });
  if (def.aspect_ratio !== "1:1") fail("editor imgExtra: empty Anima aspect must default to 1:1, got " + JSON.stringify(def));
  else ok("editor imgExtra: empty Anima aspect defaults to 1:1");
  const edit = editor.imgExtra({ fields: { model: "bria/fibo-edit-1.5/edit", aspect: "16:9", size: "16:9" } });
  if (edit.aspect_ratio) fail("editor imgExtra: redundant aspect leaked, got " + JSON.stringify(edit));
  else ok("editor imgExtra: ratio-sized edit model omits aspect_ratio");
  editor.catalogs.image = [];
}

{
  const pack = play.dimOptionsFromItem("image", {
    id: QWEN21,
    supported_parameters: { resolutions: ["1k", "1.5k", "2k"], aspect_ratio: QWEN21_RATIOS },
  });
  const listed = (pack.aspect || []).map((o) => String(o[0]));
  if (pack.def.aspect !== "1:1" || !listed.includes("16:9"))
    fail("play dimOptionsFromItem: Qwen 2.1 aspect missing, got " + JSON.stringify(pack.aspect));
  else ok("play dimOptionsFromItem: Qwen 2.1 lists aspect " + listed.join("/"));
  const hide = play.dimOptionsFromItem("edit", {
    id: "bria/fibo-edit-1.5/edit",
    supported_parameters: { resolutions: ["auto", "1:1", "16:9"], aspect_ratio: ["", "auto", "1:1", "16:9"] },
  });
  if (hide.aspect) fail("play dimOptionsFromItem: redundant aspect leaked onto FIBO edit");
  else ok("play dimOptionsFromItem: FIBO edit has no separate aspect knob");
}

{
  const prev = catalog.image.slice();
  catalog.image = [{
    id: QWEN21,
    supported_parameters: { resolutions: ["1k", "1.5k", "2k"], aspect_ratio: QWEN21_RATIOS, max_output_images: 1 },
  }, {
    id: QWEN21_EDIT,
    supported_parameters: { resolutions: ["1k", "2k"], aspect_ratio: ["auto", "1:1", "16:9"], max_input_images: 10, max_output_images: 1 },
  }, {
    id: ANIMA,
    supported_parameters: { resolutions: ["1k", "1.5k"], aspect_ratio: QWEN21_RATIOS, max_input_images: 1, max_output_images: 1 },
  }];
  try {
    const app = loadEngine();
    let extra = null;
    const ctx = {
      genImage: (_prompt, _model, _size, _src, _mask, e) => { extra = e; return ["data:image/png;base64,xx"]; },
    };
    await app.NODE_TYPES.image.run(
      { id: "i1", type: "image", fields: { model: QWEN21, prompt: "a fox", size: "1k", aspect: "16:9", variations: "1" } },
      {}, ctx, () => {},
    );
    if (!extra || extra.aspect_ratio !== "16:9")
      fail("play image.run: Qwen 2.1 aspect_ratio not 16:9, got " + JSON.stringify(extra));
    else ok("play image.run: Qwen 2.1 posts aspect_ratio 16:9");

    extra = null;
    await app.NODE_TYPES.image.run(
      { id: "i2", type: "image", fields: { model: ANIMA, prompt: "a fox", size: "1k", variations: "1" } },
      {}, ctx, () => {},
    );
    if (!extra || extra.aspect_ratio !== "1:1")
      fail("play image.run: empty Anima aspect must default to 1:1, got " + JSON.stringify(extra));
    else ok("play image.run: empty Anima aspect defaults to 1:1");

    extra = null;
    await app.NODE_TYPES.edit.run(
      { id: "e1", type: "edit", fields: { model: QWEN21_EDIT, prompt: "restyle", size: "1k" } },
      { image: "data:image/png;base64,xx" }, ctx, () => {},
    );
    if (!extra || extra.aspect_ratio !== "auto")
      fail("play edit.run: Qwen 2.1 edit must default aspect_ratio to auto, got " + JSON.stringify(extra));
    else ok("play edit.run: Qwen 2.1 edit posts aspect_ratio auto");
  } finally {
    catalog.image = prev;
  }
}

// Play settings paint: fillDimLists shows the knob only when imageAspectFor returns a spec,
// and writes the catalog default into an empty field so the select matches the wire.
{
  const rows = [];
  const els = [];
  function makeEl(){
    const row = { hidden: false };
    const el = { tagName: "SELECT", innerHTML: "", closest(){ return row; }, row };
    rows.push(row); els.push(el);
    return el;
  }
  const nodes = [
    { type: "image", fields: { model: QWEN21, aspect: "" } },
    { type: "edit", fields: { model: "bria/fibo-edit-1.5/edit", aspect: "16:9" } },
    { type: "image", fields: { model: FIBO, aspect: "" } },
  ];
  nodes.forEach(() => makeEl());
  const cat = {
    [QWEN21]: { id: QWEN21, supported_parameters: { resolutions: ["1k", "1.5k", "2k"], aspect_ratio: QWEN21_RATIOS } },
    "bria/fibo-edit-1.5/edit": { id: "bria/fibo-edit-1.5/edit", supported_parameters: { resolutions: ["auto", "1:1", "16:9"], aspect_ratio: ["", "auto", "1:1", "16:9"] } },
  };
  const code = [
    "function rawCatItem(kind, id){ return Promise.resolve(CAT[id] || null); }",
    "function esc(s){ return String(s); }",
    "function checkDirty(){}",
    "function refreshRunCost(){}",
    "function nearestDimOption(cur, options, def){ return def; }",
    block(PLAY, "function aspectFromParams(sp){"),
    block(PLAY, "function imageAspectSpec(model){"),
    block(PLAY, "function imageAspectFor(model, raw){"),
    block(PLAY, "function fillDimLists(){"),
  ].join("\n");
  const ctx = {
    CAT: cat,
    STATE: { settings: nodes.map((node) => ({ node, field: "aspect" })) },
    document: { getElementById(id){ return els[Number(String(id).slice(4))]; } },
    console, Math, Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  ctx.fillDimLists();
  await new Promise((r) => setTimeout(r, 0));
  if (rows[0].hidden || nodes[0].fields.aspect !== "1:1" || !els[0].innerHTML.includes("16:9"))
    fail("play fillDimLists: Qwen 2.1 aspect row missing or default not 1:1, html=" + els[0].innerHTML + " aspect=" + nodes[0].fields.aspect);
  else ok("play fillDimLists: Qwen 2.1 aspect row shows and defaults to 1:1");
  if (!rows[1].hidden)
    fail("play fillDimLists: FIBO edit aspect row stayed visible");
  else if (nodes[1].fields.aspect !== "16:9")
    fail("play fillDimLists: hiding the row rewrote the leftover aspect");
  else ok("play fillDimLists: ratio-sized edit hides the aspect row");
  if (rows[2].hidden || nodes[2].fields.aspect !== "1:1")
    fail("play fillDimLists: FIBO catalog miss did not fall back to the id map");
  else ok("play fillDimLists: FIBO catalog miss still shows the offline aspect map");
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
    const aspect = sp.aspect_ratio || (sp.parameters && sp.parameters.aspect_ratio);
    if (aspect) {
      const options = (Array.isArray(aspect) ? aspect : aspect.options || []).map(o => String(typeof o === "object" ? o.value : o));
      if (WANT.some(v => !options.includes(v))) fail("live v1 aspect_ratio differs from the shipped FIBO knob: " + options.join(","));
      else ok("live v1 aspect_ratio agrees with the shipped FIBO knob");
    }
    else ok("live /api/v1/image-models: FIBO still has no aspect_ratio (gap map still needed)");
  }
} catch (e) {
  console.log("⊘ skip live catalog pin: " + (e && e.message ? e.message : e));
}

if (failed) process.exit(1);
console.log("FIBO aspect_ratio knob checks passed.");
