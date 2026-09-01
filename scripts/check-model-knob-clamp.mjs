#!/usr/bin/env node
// When the model on an image/video node changes — or a saved graph is opened
// against the live catalog — a size / duration / quality / mode value that the
// NEW model does not list must snap to a real option. Both engines used to keep
// the old value and inject it as a fake <option>, so switching MiniMax H3 (8s
// is listed) → Wan Prime (UI list is 5/10; catalog duration is a number range
// with default 5) still showed 8s and Play would send it.
//
// Pins, offline, zero API spend:
//   * 8s → Wan Prime clamps; 8s on MiniMax H3 stays
//   * image size 2k clamps off qwen-image-3; stays on nano-banana-2
//   * editor ↔ play nearestDimOption parity
//   * refreshDims / fillDimLists never inject a fake option once the catalog is known
//   * load path (refreshAllPrices / fillDimLists) clamps, not only the picker
//   * play tvideo.run / videoDimParams SEND path snaps (the original "Play sent 8s" bug)
//   * fps / frames_per_second wire-name remap + unlisted fps snap
//   * unlisted 9:16 on an orientation model snaps (not forwarded as aspect_ratio)
//
// Extraction technique mirrors check-drifted-model / check-video-mode-gate.
// Send-path cases drive play NODE_TYPES.tvideo.run via play-engine.mjs (spy genVideo).
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
function dimNumLine(src) {
  const i = src.search(/(const|function)\s+dimNum\b/);
  if (i === -1) throw new Error("dimNum not found");
  return src.slice(i, src.indexOf("\n", i)).replace(/^const\s/, "var ");
}

const H3_DUR_OPTS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((n) => ({
  value: String(n),
  label: n + " seconds",
}));
const WAN_PRIME = {
  id: "alibaba/wan-3.0-prime",
  params: { duration: { type: "number", min: 2, max: 30, step: 1, default: 5 } },
};
const MINIMAX_H3 = {
  id: "minimax-h3",
  params: { duration: { type: "select", default: "5", options: H3_DUR_OPTS } },
};
const BANANA = { id: "nano-banana-2", resolutions: ["1k", "2k", "4k"] };
const QWEN = { id: "qwen-image-3", resolutions: ["auto", "1024x1024", "512x512", "768x1024"] };

function loadEditor() {
  const code = [
    "var SIZES = [['1024x1024','square'],['1024x1536','portrait'],['1536x1024','landscape'],['auto','auto']];",
    "var SIZE_FALLBACK = SIZES;",
    "var ASPECT_FALLBACK = [['16:9','16:9'],['9:16','9:16'],['1:1','1:1']];",
    "var DURATION_FALLBACK = [['5','5 sec'],['10','10 sec']];",
    block(IDX, "function selOpts(param){"),
    block(IDX, "function paramDef(param, opts){"),
    block(IDX, "const DIM_TIER_PX = {").replace(/^const\s/, "var "),
    block(IDX, "function dimShape(v){"),
    dimNumLine(IDX),
    block(IDX, "function nearestDimOption(cur, options, def){"),
    block(IDX, "function applyDimFields(fields, defs){"),
    block(IDX, "function dimDefs(type, model){"),
    block(IDX, "function videoDimParams(n){"),
    "var catalogs = { image:[], video:[] };",
    "function catItem(kind,id){ return (catalogs[kind]||[]).find(function(m){ return m.id===id; }); }",
  ].join("\n");
  const ctx = { console, Math };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

function loadPlay() {
  const code = [
    "var DURATIONS = [['5','5 sec'],['10','10 sec']];",
    block(PLAY, "var DIM_TIER_PX = {"),
    block(PLAY, "function dimShape(v){"),
    dimNumLine(PLAY),
    block(PLAY, "function nearestDimOption(cur, options, def){"),
    block(PLAY, "function dimOptionsFromItem(type, m){"),
  ].join("\n");
  const ctx = { console, Math };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

const editor = loadEditor();
const play = loadPlay();

// ---- 1. helper: keep / default / nearest / first --------------------------
{
  const opts = (...vals) => vals.map((v) => [v, v]);
  const cases = [
    ["keep a still-valid duration", "8", opts("5", "6", "7", "8", "9", "10"), "5", "8"],
    ["8s → Wan Prime fallback (catalog default 5)", "8", opts("5", "10"), "5", "5"],
    ["empty takes the default", "", opts("5", "10"), "5", "5"],
    ["keep a still-valid size", "2k", opts("1k", "2k", "4k"), "1k", "2k"],
    ["2k off a WxH list → catalog default", "2k", opts("auto", "1024x1024", "512x512"), "auto", "auto"],
    ["mode ultra → catalog default", "ultra", opts("draft", "full"), "full", "full"],
    ["unparseable → first option when default missing", "cinematic", opts("landscape", "portrait"), "", "landscape"],
  ];
  let bad = 0;
  for (const [what, cur, options, def, want] of cases) {
    const got = editor.nearestDimOption(cur, options, def);
    if (String(got) !== String(want)) {
      fail(`editor helper: ${what} — "${cur}" → "${got}" (want "${want}")`);
      bad++;
    }
  }
  if (!bad) ok(`editor nearestDimOption: ${cases.length} keep/default/nearest cases`);
}

// editor ↔ play helper parity
{
  const opts = (...vals) => vals.map((v) => [v, v]);
  const cases = [
    ["8", opts("5", "10"), "5"],
    ["8", opts("5", "6", "7", "8"), "5"],
    ["2k", opts("auto", "1024x1024"), "auto"],
    ["1024x1024", opts("1k", "2k", "4k"), "1k"],
    ["", opts("5", "10"), "5"],
  ];
  let bad = 0;
  for (const [cur, options, def] of cases) {
    const a = String(editor.nearestDimOption(cur, options, def));
    const b = String(play.nearestDimOption(cur, options, def));
    if (a !== b) { fail(`parity: "${cur}" editor "${a}" vs play "${b}"`); bad++; }
  }
  if (!bad) ok("editor ↔ play nearestDimOption agree");
}

// ---- 2. editor dimDefs + applyDimFields (the Wan Prime repro) -------------
editor.catalogs.video = [WAN_PRIME, MINIMAX_H3];
editor.catalogs.image = [BANANA, QWEN];

{
  const fields = { model: "alibaba/wan-3.0-prime", duration: "8" };
  const defs = editor.dimDefs("tvideo", fields.model);
  const dur = defs.find((d) => d.f === "duration");
  if (!dur) fail("editor: Wan Prime tvideo has no duration def");
  else {
    const listed = dur.options.map((o) => String(o[0]));
    if (listed.includes("8")) fail("editor: Wan Prime duration list must not include 8 (got " + listed.join(",") + ")");
    else ok("editor: Wan Prime duration options are " + listed.join("/"));
    if (!dur.known) fail("editor: Wan Prime duration def should be known (catalogued number-range → fallback list)");
    editor.applyDimFields(fields, defs);
    if (String(fields.duration) === "8") fail("editor: 8s survived a swap/load onto Wan Prime");
    else if (!listed.includes(String(fields.duration))) {
      fail("editor: clamped duration \"" + fields.duration + "\" is not in Wan Prime's list");
    } else if (dur.options.some((o) => String(o[0]) === "8")) {
      fail("editor: applyDimFields injected 8 as a fake option");
    } else ok("editor: H3 8s → Wan Prime clamps duration to " + fields.duration);
  }
}

{
  const fields = { model: "minimax-h3", duration: "8" };
  const defs = editor.dimDefs("tvideo", fields.model);
  editor.applyDimFields(fields, defs);
  if (String(fields.duration) !== "8") fail("editor: still-valid 8s on MiniMax H3 was reset to " + fields.duration);
  else ok("editor: still-valid 8s on MiniMax H3 is kept");
}

{
  const fields = { model: "qwen-image-3", size: "2k" };
  const defs = editor.dimDefs("image", fields.model);
  const size = defs.find((d) => d.f === "size");
  editor.applyDimFields(fields, defs);
  const listed = (size && size.options || []).map((o) => String(o[0]));
  if (String(fields.size) === "2k") fail("editor: 2k survived on qwen-image-3");
  else if (!listed.includes(String(fields.size))) fail("editor: clamped size \"" + fields.size + "\" is not in qwen-image-3's list");
  else if (size.options.some((o) => String(o[0]) === "2k")) fail("editor: applyDimFields injected 2k as a fake option");
  else ok("editor: 2k → qwen-image-3 clamps size to " + fields.size);
}

{
  const fields = { model: "nano-banana-2", size: "2k" };
  editor.applyDimFields(fields, editor.dimDefs("image", fields.model));
  if (String(fields.size) !== "2k") fail("editor: still-valid 2k on nano-banana-2 was reset to " + fields.size);
  else ok("editor: still-valid 2k on nano-banana-2 is kept");
}

{
  // editor send helper reads the clamped fields (refreshDims → applyDimFields → videoDimParams)
  const fields = { model: "alibaba/wan-3.0-prime", duration: "8" };
  editor.applyDimFields(fields, editor.dimDefs("tvideo", fields.model));
  const wire = editor.videoDimParams({ type: "tvideo", fields });
  if (String(wire.duration) === "8") fail("editor: videoDimParams still packs 8s after the Wan Prime clamp");
  else if (wire.duration == null || wire.duration === "") fail("editor: videoDimParams dropped duration after clamp");
  else ok("editor: videoDimParams packs clamped Wan Prime duration " + wire.duration);
}

{
  const fpsModel = {
    id: "fps-model",
    params: { fps: { options: [{ value: "24" }, { value: "30" }], default: "24" } },
  };
  const fps2Model = {
    id: "fps2-model",
    params: { frames_per_second: { options: [{ value: "24" }, { value: "30" }], default: "24" } },
  };
  editor.catalogs.video = [WAN_PRIME, MINIMAX_H3, fpsModel, fps2Model];
  const defs = editor.dimDefs("tvideo", "fps-model");
  const fps = defs.find((d) => d.f === "fps");
  if (!fps) fail("editor: fps-model has no fps dim def");
  else if (fps.wire !== "fps") fail("editor: fps-model wire must be fps, got " + fps.wire);
  else ok("editor: catalog fps param wires as fps");
  const fields = { model: "fps-model", fps: "60" };
  editor.applyDimFields(fields, defs);
  if (String(fields.fps) === "60") fail("editor: 60 fps survived on a 24/30 list");
  else if (!(fps.options || []).some((o) => String(o[0]) === String(fields.fps))) {
    fail("editor: clamped fps \"" + fields.fps + "\" is not in fps-model's list");
  } else ok("editor: 60 fps → fps-model clamps to " + fields.fps);

  const defs2 = editor.dimDefs("tvideo", "fps2-model");
  const fps2 = defs2.find((d) => d.f === "fps");
  if (!fps2) fail("editor: fps2-model has no fps dim def");
  else if (fps2.wire !== "frames_per_second") {
    fail("editor: frames_per_second must wire as frames_per_second, got " + fps2.wire);
  } else ok("editor: catalog frames_per_second param wires as frames_per_second");
  editor.catalogs.video = [WAN_PRIME, MINIMAX_H3];
}

{
  // offline / uncatalogued: don't invent a clamp — keep the stored value pickable
  editor.catalogs.video = [];
  const fields = { model: "not-in-catalog", duration: "8" };
  const defs = editor.dimDefs("tvideo", fields.model);
  editor.applyDimFields(fields, defs);
  const dur = defs.find((d) => d.f === "duration");
  if (String(fields.duration) !== "8") fail("editor: empty catalog clobbered a stored 8s (offline regression)");
  else if (!dur.options.some((o) => String(o[0]) === "8")) fail("editor: empty catalog dropped the stored 8s from the dropdown");
  else ok("editor: empty catalog keeps a stored 8s pickable (no false clamp)");
  editor.catalogs.video = [WAN_PRIME, MINIMAX_H3];
}

// ---- 3. play dimOptionsFromItem (same catalog shapes, raw) ----------------
{
  const wanRaw = {
    supported_parameters: { parameters: { duration: { type: "number", min: 2, max: 30, default: 5 } } },
  };
  const pack = play.dimOptionsFromItem("tvideo", wanRaw);
  const listed = (pack.duration || []).map((o) => String(o[0]));
  if (!listed.length) fail("play: Wan Prime number-range duration produced no options");
  else if (listed.includes("8")) fail("play: Wan Prime duration list must not include 8");
  else {
    const next = play.nearestDimOption("8", pack.duration, pack.def.duration);
    if (String(next) === "8") fail("play: 8s survived Wan Prime clamp");
    else if (!listed.includes(String(next))) fail("play: clamped \"" + next + "\" is not in Wan Prime's list");
    else ok("play: H3 8s → Wan Prime clamps duration to " + next);
  }
}

{
  const h3Raw = {
    supported_parameters: {
      parameters: { duration: { type: "select", default: "5", options: H3_DUR_OPTS } },
    },
  };
  const pack = play.dimOptionsFromItem("tvideo", h3Raw);
  const next = play.nearestDimOption("8", pack.duration, pack.def.duration);
  if (String(next) !== "8") fail("play: still-valid 8s on MiniMax H3 was reset to " + next);
  else ok("play: still-valid 8s on MiniMax H3 is kept");
}

{
  const qwenRaw = { supported_parameters: { resolutions: ["auto", "1024x1024", "512x512", "768x1024"] } };
  const pack = play.dimOptionsFromItem("image", qwenRaw);
  const next = play.nearestDimOption("2k", pack.size, pack.def.size);
  const listed = (pack.size || []).map((o) => String(o[0]));
  if (String(next) === "2k") fail("play: 2k survived on qwen-image-3");
  else if (!listed.includes(String(next))) fail("play: clamped size \"" + next + "\" is not in qwen-image-3's list");
  else ok("play: 2k → qwen-image-3 clamps size to " + next);
}

{
  const bananaRaw = { supported_parameters: { resolutions: ["1k", "2k", "4k"] } };
  const pack = play.dimOptionsFromItem("image", bananaRaw);
  const next = play.nearestDimOption("2k", pack.size, pack.def.size);
  if (String(next) !== "2k") fail("play: still-valid 2k on nano-banana-2 was reset to " + next);
  else ok("play: still-valid 2k on nano-banana-2 is kept");
}

// ---- 4. wiring: one clamp path, on swap AND on load -----------------------
{
  if (!/applyDimFields\(n\.fields, defs\)/.test(IDX)) fail("editor: refreshDims no longer calls applyDimFields");
  else ok("editor: refreshDims clamps through applyDimFields");

  const refresh = block(IDX, "function refreshDims(n){");
  if (/d\.options = \[\[String\(cur\)/.test(refresh)) fail("editor: refreshDims still injects an invalid value as a fake option");
  else ok("editor: refreshDims does not inject a fake option");

  const allPrices = IDX.slice(IDX.indexOf("function refreshAllPrices()"), IDX.indexOf("function refreshAllPrices()") + 500);
  if (!/refreshDims\(n\)/.test(allPrices)) fail("editor: catalog arrival / graph load no longer rebuilds dims (old graphs would keep 8s)");
  else ok("editor: refreshAllPrices rebuilds dims (load clamp)");

  const pick = IDX.slice(IDX.indexOf("openPicker(t.modelKind"), IDX.indexOf("openPicker(t.modelKind") + 700);
  if (!/refreshDims\(n\)/.test(pick)) fail("editor: the model picker no longer rebuilds dims");
  else ok("editor: the model picker rebuilds dims on pick");

  const optsBody = block(IDX, "function refreshModelOpts(n){");
  if (!/nearestDimOption\(/.test(optsBody)) fail("editor: refreshModelOpts no longer clamps quality/mode selects");
  else ok("editor: refreshModelOpts clamps catalog selects (quality/mode)");
}

{
  const fill = block(PLAY, "function fillDimLists(){");
  if (/\[\[String\(cur\),String\(cur\)\]/.test(fill) || /\[\[String\(cur\), String\(cur\)\]/.test(fill)) {
    fail("play: fillDimLists still injects an invalid value as a fake option");
  } else ok("play: fillDimLists does not inject a fake option");
  if (!/nearestDimOption\(/.test(fill)) fail("play: fillDimLists no longer snaps invalid values");
  else ok("play: fillDimLists snaps invalid values (swap AND first render / load)");

  if (!/else if\(dP\)\{ out\.duration = DURATIONS/.test(PLAY) && !/else if\(dP\)\{ out.duration = DURATIONS/.test(PLAY)) {
    // the number-range fallback is the Wan Prime path
    if (!/out\.duration = DURATIONS/.test(PLAY)) fail("play: Wan Prime number-range duration no longer falls back to 5/10");
    else ok("play: catalogued number-range duration uses the 5/10 fallback");
  } else ok("play: catalogued number-range duration uses the 5/10 fallback");
}

// ---- 5. play SEND path (the original bug: Play posted 8s) ------------------
{
  const vdp = block(PLAY, "async function videoDimParams(n){");
  if (!/snapField\("duration"/.test(vdp) || !/snapField\("aspect"/.test(vdp) || !/snapField\("fps"/.test(vdp)) {
    fail("play: videoDimParams no longer snaps duration/aspect/fps on send");
  } else ok("play: videoDimParams snaps duration/aspect/fps on the paid send path");
  for (const kind of ["tvideo", "ivideo", "vedit"]) {
    const run = block(PLAY, kind + ": {");
    if (!/videoDimParams\(n\)/.test(run)) fail("play: " + kind + ".run no longer calls videoDimParams");
    else ok("play: " + kind + ".run packs dims through videoDimParams");
  }
  if (!/videoDimParams\(n\);      \/\/ resolution the avatar model supports/.test(PLAY)) {
    fail("play: lipsync.run no longer calls videoDimParams");
  } else ok("play: lipsync.run packs dims through videoDimParams");
}

catalog.video = [
  {
    id: "alibaba/wan-3.0-prime",
    supported_parameters: { parameters: { duration: { type: "number", min: 2, max: 30, default: 5 } } },
  },
  {
    id: "minimax-h3",
    supported_parameters: { parameters: { duration: { type: "select", default: "5", options: H3_DUR_OPTS } } },
  },
  {
    id: "sora-like",
    supported_parameters: { parameters: {
      orientation: { options: [{ value: "landscape" }, { value: "portrait" }], default: "landscape" },
      seconds: { options: [{ value: "4" }, { value: "8" }], default: "8" },
    } },
  },
  {
    id: "fps-model",
    supported_parameters: { parameters: {
      fps: { options: [{ value: "24" }, { value: "30" }], default: "24" },
    } },
  },
  {
    id: "fps2-model",
    supported_parameters: { parameters: {
      frames_per_second: { options: [{ value: "24" }, { value: "30" }], default: "24" },
    } },
  },
];

const app = loadEngine();

async function spyTvideo(fields) {
  let sent = null;
  await app.NODE_TYPES.tvideo.run(
    { id: "v1", type: "tvideo", fields: { prompt: "waves", ...fields } },
    {},
    { genVideo: (model, prompt, opts) => { sent = { model, prompt, opts }; return "https://cdn.example/v.mp4"; } },
    () => {},
  );
  return sent;
}

{
  const sent = await spyTvideo({ model: "alibaba/wan-3.0-prime", duration: "8" });
  const dur = sent && sent.opts && sent.opts.dims && sent.opts.dims.duration;
  if (String(dur) === "8") fail("play send: Wan Prime generate-video still posted duration 8");
  else if (dur == null || dur === "") fail("play send: Wan Prime generate-video dropped duration");
  else ok("play send: H3 8s → Wan Prime generate-video posts duration " + dur);
}

{
  const sent = await spyTvideo({ model: "minimax-h3", duration: "8" });
  const dur = sent && sent.opts && sent.opts.dims && sent.opts.dims.duration;
  if (String(dur) !== "8") fail("play send: still-valid 8s on MiniMax H3 was reset to " + dur);
  else ok("play send: still-valid 8s on MiniMax H3 is posted");
}

{
  const sent = await spyTvideo({ model: "sora-like", aspect: "9:16", duration: "" });
  const dims = (sent && sent.opts && sent.opts.dims) || {};
  if (dims.aspect_ratio != null) fail("play send: 9:16 on an orientation model forwarded as aspect_ratio");
  else if (String(dims.orientation) === "9:16") fail("play send: 9:16 survived on a landscape/portrait list");
  else if (dims.orientation !== "landscape") {
    fail("play send: 9:16 must snap to the orientation default landscape, got " + JSON.stringify(dims.orientation));
  } else if (String(dims.seconds) !== "8") {
    fail("play send: empty duration must backfill seconds=8, got " + JSON.stringify(dims.seconds));
  } else ok("play send: 9:16 snaps to orientation landscape; empty duration backfills seconds=8");
}

{
  const sent = await spyTvideo({ model: "sora-like", aspect: "portrait", duration: "" });
  const dims = (sent && sent.opts && sent.opts.dims) || {};
  if (dims.orientation !== "portrait") fail("play send: listed portrait was remapped, got " + JSON.stringify(dims.orientation));
  else if (String(dims.seconds) !== "8") fail("play send: empty duration must still backfill seconds=8");
  else ok("play send: listed portrait + empty duration → orientation/seconds wire names");
}

{
  const sent = await spyTvideo({ model: "fps-model", fps: "60" });
  const dims = (sent && sent.opts && sent.opts.dims) || {};
  if (String(dims.fps) === "60") fail("play send: 60 fps survived on a 24/30 list");
  else if (dims.frames_per_second != null) fail("play send: fps-model must not also send frames_per_second");
  else if (!["24", "30"].includes(String(dims.fps))) fail("play send: clamped fps \"" + dims.fps + "\" is not in fps-model's list");
  else ok("play send: 60 fps → fps-model posts fps " + dims.fps);
}

{
  const sent = await spyTvideo({ model: "fps-model", fps: "30" });
  const dims = (sent && sent.opts && sent.opts.dims) || {};
  if (String(dims.fps) !== "30") fail("play send: still-valid 30 fps was reset to " + dims.fps);
  else ok("play send: still-valid 30 fps is posted as fps");
}

{
  const sent = await spyTvideo({ model: "fps2-model", fps: "30" });
  const dims = (sent && sent.opts && sent.opts.dims) || {};
  if (dims.fps != null) fail("play send: frames_per_second model must not also send fps");
  else if (String(dims.frames_per_second) !== "30") {
    fail("play send: fps2-model must post frames_per_second=30, got " + JSON.stringify(dims.frames_per_second));
  } else ok("play send: frames_per_second model remaps the fps field onto the wire");
}

{
  const sent = await spyTvideo({ model: "not-in-catalog", duration: "8" });
  const dur = sent && sent.opts && sent.opts.dims && sent.opts.dims.duration;
  if (String(dur) !== "8") fail("play send: catalog-missing model clobbered a stored 8s (got " + dur + ")");
  else ok("play send: catalog-missing model still posts the stored 8s (no false clamp)");
}

if (failed) { console.error("\ncheck-model-knob-clamp: " + failed + " failure(s)"); process.exit(1); }
console.log("\ncheck-model-knob-clamp: OK");
