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
//   * play/editor/njs omit leftover resolution when the catalog does not advertise it
//     (Omni v1 has duration+aspect only; leftover 4k from v1.1 must not POST)
//   * editor videoDimParams SEND path snaps leftover 8s without a prior applyDimFields
//   * editor image/edit/inpaint SEND path snaps leftover 2k (dimDefs includes inpaint)
//   * play image.run / snapImageSize SEND path snaps leftover 2k (fillDimLists is async)
//   * njsRunFor (default paid path) snaps leftover size before the library posts fields.size raw
//   * play dimOptionsFromItem treats inpaint like image/edit
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
const OMNI_DUR_OPTS = [3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
  value: String(n),
  label: n + " seconds",
}));
const OMNI_V1 = {
  id: "google/gemini-omni-flash",
  params: {
    duration: { type: "select", default: "8", options: OMNI_DUR_OPTS },
    aspect_ratio: { type: "select", default: "16:9", options: [{ value: "16:9" }, { value: "9:16" }] },
  },
};
const OMNI_11 = {
  id: "google/gemini-omni-flash/v1.1",
  params: {
    duration: { type: "select", default: "8", options: OMNI_DUR_OPTS },
    resolution: { type: "select", default: "720p", options: [
      { value: "360p", label: "360p" },
      { value: "720p", label: "720p" },
      { value: "1080p", label: "1080p" },
      { value: "4k", label: "4K" },
    ] },
    aspect_ratio: { type: "select", default: "16:9", options: [{ value: "16:9" }, { value: "9:16" }] },
  },
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
    block(IDX, "const IMAGE_ASPECT = {").replace(/^const\s/, "var "),
    block(IDX, "function imageAspectSpec(model){"),
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
    block(PLAY, "function applyDimFields(fields, defs){"),
    block(PLAY, "function imageAspectSpec(model){"),
    block(PLAY, "function dimOptionsFromItem(type, m){"),
    block(PLAY, "function snapImageSize(n, raw){"),
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
editor.catalogs.video = [WAN_PRIME, MINIMAX_H3, OMNI_V1, OMNI_11];
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
  const fields = { model: "google/gemini-omni-flash/v1.1" };
  const defs = editor.dimDefs("tvideo", fields.model);
  const dur = defs.find((d) => d.f === "duration");
  const res = defs.find((d) => d.f === "resolution");
  if (!dur) fail("editor: Omni 1.1 tvideo has no duration def");
  else {
    const listed = dur.options.map((o) => String(o[0]));
    const want = ["3", "4", "5", "6", "7", "8", "9", "10"];
    if (want.some((v) => !listed.includes(v))) fail("editor: Omni 1.1 duration list is " + listed.join(",") + " (want 3–10)");
    else if (listed.includes("15")) fail("editor: Omni 1.1 duration list leaked a leftover 15");
    else ok("editor: Omni 1.1 duration options are 3–10 (not the 5/10 fallback)");
    if (String(dur.def) !== "8") fail("editor: Omni 1.1 duration default is " + dur.def + " (want 8)");
    else ok("editor: Omni 1.1 duration default is 8");
  }
  if (!res) fail("editor: Omni 1.1 tvideo has no resolution def");
  else {
    const listed = res.options.map((o) => String(o[0]));
    if (!["360p", "720p", "1080p", "4k"].every((v) => listed.includes(v))) {
      fail("editor: Omni 1.1 resolution list is " + listed.join(",") + " (want 360p/720p/1080p/4k)");
    } else if (String(res.def) !== "720p") fail("editor: Omni 1.1 resolution default is " + res.def + " (want 720p)");
    else ok("editor: Omni 1.1 resolution options include 4k, default 720p");
  }
  editor.applyDimFields(fields, defs);
  if (String(fields.duration) !== "8") fail("editor: fresh Omni 1.1 seeded duration " + fields.duration + " (want 8)");
  else ok("editor: fresh Omni 1.1 seeds duration 8");
}

{
  const fields = { model: "google/gemini-omni-flash/v1.1", duration: "5" };
  editor.applyDimFields(fields, editor.dimDefs("tvideo", fields.model));
  if (String(fields.duration) !== "5") fail("editor: still-valid 5s on Omni 1.1 was reset to " + fields.duration);
  else ok("editor: still-valid 5s on Omni 1.1 is kept (listed, not leftover-only)");
}

{
  const fields = { model: "google/gemini-omni-flash", duration: "8" };
  const defs = editor.dimDefs("tvideo", fields.model);
  const res = defs.find((d) => d.f === "resolution");
  if (res) fail("editor: Omni v1 must not grow a resolution knob (catalog has none)");
  else ok("editor: Omni v1 has no resolution knob");
  editor.applyDimFields(fields, defs);
  if (String(fields.duration) !== "8") fail("editor: still-valid 8s on Omni v1 was reset to " + fields.duration);
  else ok("editor: still-valid 8s on Omni v1 is kept");
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
  // SEND path must clamp even when refreshDims never ran (n.el missing / catalog raced Run).
  const n = { type: "tvideo", fields: { model: "alibaba/wan-3.0-prime", duration: "8" } };
  const wire = editor.videoDimParams(n);
  if (String(wire.duration) === "8") fail("editor send: videoDimParams still packs leftover 8s on Wan Prime");
  else if (wire.duration == null || wire.duration === "") fail("editor send: videoDimParams dropped duration");
  else if (String(n.fields.duration) === "8") fail("editor send: videoDimParams left fields.duration=8");
  else ok("editor send: videoDimParams clamps leftover 8s on Wan Prime to " + wire.duration + " (no prior applyDimFields)");
}

{
  const n = { type: "tvideo", fields: { model: "google/gemini-omni-flash", duration: "8", aspect: "16:9", resolution: "4k" } };
  const wire = editor.videoDimParams(n);
  if (wire.resolution != null && wire.resolution !== "") {
    fail("editor send: Omni v1 posted leftover resolution " + JSON.stringify(wire.resolution));
  } else if (String(wire.duration) !== "8") {
    fail("editor send: Omni v1 duration was dropped/clamped, got " + JSON.stringify(wire.duration));
  } else if (wire.aspect_ratio !== "16:9") {
    fail("editor send: Omni v1 aspect_ratio was dropped, got " + JSON.stringify(wire.aspect_ratio));
  } else ok("editor send: Omni v1 omits leftover 4k resolution (catalog has none)");
}

{
  const n = { type: "tvideo", fields: { model: "google/gemini-omni-flash/v1.1", duration: "8", aspect: "16:9", resolution: "4k" } };
  const wire = editor.videoDimParams(n);
  if (String(wire.resolution) !== "4k") fail("editor send: Omni 1.1 dropped listed 4k, got " + JSON.stringify(wire.resolution));
  else ok("editor send: Omni 1.1 still posts listed 4k resolution");
}

{
  const fields = { model: "qwen-image-3", size: "2k" };
  const n = { type: "image", fields };
  editor.applyDimFields(fields, editor.dimDefs(n.type, n.fields.model));
  if (String(fields.size) === "2k") fail("editor send: leftover 2k survived dimDefs+applyDimFields on qwen-image-3");
  else ok("editor send: leftover 2k on qwen-image-3 snaps to " + fields.size);
}

{
  const fields = { model: "qwen-image-3", size: "2k" };
  const defs = editor.dimDefs("inpaint", fields.model);
  const size = defs.find((d) => d.f === "size");
  if (!size) fail("editor: dimDefs(inpaint) has no size def");
  else {
    editor.applyDimFields(fields, defs);
    const listed = (size.options || []).map((o) => String(o[0]));
    if (String(fields.size) === "2k") fail("editor: leftover 2k survived on inpaint/qwen-image-3");
    else if (!listed.includes(String(fields.size))) fail("editor: inpaint clamp \"" + fields.size + "\" is not in qwen-image-3's list");
    else if (size.options.some((o) => String(o[0]) === "2k")) fail("editor: inpaint applyDimFields injected 2k as a fake option");
    else ok("editor: leftover 2k on inpaint/qwen-image-3 snaps to " + fields.size);
  }
}

{
  // FIBO 1.5: size is 1mp/4mp in the v1 catalog; aspect_ratio is a separate marketing-catalog select.
  const defs = editor.dimDefs("image", "bria/fibo-generate-1.5/text-to-image");
  const asp = defs.find((d) => d.f === "aspect");
  const listed = (asp && asp.options || []).map((o) => String(o[0]));
  if (!asp) fail("editor: FIBO 1.5 Image node must grow an aspect knob");
  else if (asp.wire !== "aspect_ratio") fail("editor: FIBO aspect wire must be aspect_ratio, got " + asp.wire);
  else if (!listed.includes("16:9") || !listed.includes("9:16") || !listed.includes("1:1"))
    fail("editor: FIBO aspect list missing 1:1/16:9/9:16, got " + listed.join(","));
  else ok("editor: FIBO 1.5 Image node shows aspect_ratio " + listed.join("/"));
  const recraft = editor.dimDefs("image", "recraft-v4");
  if (recraft.some((d) => d.f === "aspect")) fail("editor: Recraft V4 must not grow an aspect knob (not in IMAGE_ASPECT)");
  else ok("editor: Recraft V4 has no aspect knob");
}

{
  const pack = play.dimOptionsFromItem("image", {
    id: "bria/fibo-generate-1.5/text-to-image",
    supported_parameters: { resolutions: ["1mp", "4mp"] },
  });
  const listed = (pack.aspect || []).map((o) => String(o[0]));
  if (!pack.aspect || !listed.includes("16:9")) fail("play: dimOptionsFromItem missed FIBO aspect, got " + JSON.stringify(pack.aspect));
  else ok("play: dimOptionsFromItem lists FIBO aspect " + listed.join("/"));
  const none = play.dimOptionsFromItem("image", { id: "recraft-v4", supported_parameters: { resolutions: ["1024x1024"] } });
  if (none.aspect) fail("play: Recraft V4 dimOptionsFromItem must not list aspect");
  else ok("play: Recraft V4 dimOptionsFromItem has no aspect");
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
  const omniRaw = {
    supported_parameters: {
      parameters: {
        duration: { type: "select", default: "8", options: OMNI_DUR_OPTS },
        resolution: { type: "select", default: "720p", options: [
          { value: "360p" }, { value: "720p" }, { value: "1080p" }, { value: "4k" },
        ] },
        aspect_ratio: { type: "select", default: "16:9", options: [{ value: "16:9" }, { value: "9:16" }] },
      },
    },
  };
  const pack = play.dimOptionsFromItem("tvideo", omniRaw);
  const listed = (pack.duration || []).map((o) => String(o[0]));
  if (!["3", "4", "5", "6", "7", "8", "9", "10"].every((v) => listed.includes(v))) {
    fail("play: Omni 1.1 duration list is " + listed.join(",") + " (want 3–10)");
  } else if (String(pack.def.duration) !== "8") fail("play: Omni 1.1 duration default is " + pack.def.duration + " (want 8)");
  else ok("play: Omni 1.1 duration options are 3–10, default 8");
  const resListed = (pack.resolution || []).map((o) => String(o[0]));
  if (!["360p", "720p", "1080p", "4k"].every((v) => resListed.includes(v))) {
    fail("play: Omni 1.1 resolution list is " + resListed.join(",") + " (want 360p–4k)");
  } else ok("play: Omni 1.1 resolution options include 4k");
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

{
  const qwenRaw = { supported_parameters: { resolutions: ["auto", "1024x1024", "512x512", "768x1024"] } };
  const pack = play.dimOptionsFromItem("inpaint", qwenRaw);
  const listed = (pack.size || []).map((o) => String(o[0]));
  if (!listed.length) fail("play: dimOptionsFromItem(inpaint) produced no size list");
  else if (listed.includes("2k")) fail("play: inpaint/qwen size list leaked 2k");
  else ok("play: dimOptionsFromItem(inpaint) lists qwen sizes " + listed.join("/"));
}

{
  const qwenRaw = { supported_parameters: { resolutions: ["auto", "1024x1024", "512x512", "768x1024"] } };
  const n = { type: "image", fields: { model: "qwen-image-3", size: "2k" } };
  const got = play.snapImageSize(n, qwenRaw);
  if (String(got) === "2k") fail("play: snapImageSize kept leftover 2k on qwen");
  else if (String(n.fields.size) === "2k") fail("play: snapImageSize left fields.size=2k");
  else ok("play: snapImageSize leftover 2k → qwen snaps to " + got);
}

{
  const bananaRaw = { supported_parameters: { resolutions: ["1k", "2k", "4k"] } };
  const n = { type: "image", fields: { model: "nano-banana-2", size: "2k" } };
  const got = play.snapImageSize(n, bananaRaw);
  if (String(got) !== "2k") fail("play: snapImageSize reset still-valid 2k on banana to " + got);
  else ok("play: snapImageSize keeps still-valid 2k on banana");
}

{
  const n = { type: "image", fields: { model: "missing", size: "2k" } };
  const got = play.snapImageSize(n, null);
  if (String(got) !== "2k") fail("play: snapImageSize catalog-miss clobbered 2k to " + got);
  else ok("play: snapImageSize catalog-miss keeps stored 2k (no false clamp)");
}

{
  if (typeof play.applyDimFields !== "function") fail("play: applyDimFields is not in the extracted RUNTIME_JS");
  else {
    const fields = { size: "2k" };
    const defs = [{ f: "size", options: [["auto", "auto"], ["1024x1024", "1024x1024"]], def: "auto", known: true }];
    play.applyDimFields(fields, defs);
    if (String(fields.size) === "2k") fail("play: applyDimFields kept leftover 2k on a WxH list");
    else ok("play: applyDimFields leftover 2k → " + fields.size + " (extracted twin, not a dangling name)");
  }
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

  const evdp = block(IDX, "function videoDimParams(n){");
  if (!/applyDimFields\(n\.fields, defs\)/.test(evdp)) fail("editor: videoDimParams no longer clamps via applyDimFields on send");
  else ok("editor: videoDimParams clamps through applyDimFields on the paid send path");

  if (!/inpaint:1/.test(IDX.slice(IDX.indexOf("const DIM_NODES"), IDX.indexOf("const DIM_NODES") + 140))) {
    fail("editor: DIM_NODES no longer includes inpaint (load-path refreshDims would skip it)");
  } else ok("editor: DIM_NODES includes inpaint (load-path refreshDims)");

  if (/t==="inpaint" && f\.size!=null && typeof SIZES/.test(IDX)) {
    fail("editor: sanitizeFields still strips inpaint size against SIZES (would delete 1mp/2k after dimDefs accepted them)");
  } else ok("editor: sanitizeFields does not strip inpaint size against SIZES");

  if (!/type==="image" \|\| type==="edit" \|\| type==="inpaint"/.test(block(IDX, "function dimDefs(type, model){"))) {
    fail("editor: dimDefs no longer treats inpaint as an image-size node");
  } else ok("editor: dimDefs treats inpaint like image/edit");

  if (!/type==="image" \|\| type==="edit" \|\| type==="inpaint"/.test(block(PLAY, "function dimOptionsFromItem(type, m){"))) {
    fail("play: dimOptionsFromItem no longer treats inpaint as an image-size node");
  } else ok("play: dimOptionsFromItem treats inpaint like image/edit");

  const playNT = PLAY.slice(PLAY.lastIndexOf("const NODE_TYPES = {"));
  const idxNT = IDX.slice(IDX.indexOf("const NODE_TYPES = {"));
  for (const kind of ["image", "edit", "inpaint"]) {
    const run = block(playNT, kind + ": {");
    if (!/snapImageSize\(n/.test(run)) fail("play: " + kind + ".run no longer calls snapImageSize");
    else ok("play: " + kind + ".run snaps size through snapImageSize");
  }
  for (const kind of ["image", "edit", "inpaint"]) {
    const run = block(idxNT, kind + ": {");
    if (!/applyDimFields\(n\.fields, dimDefs\(n\.type, n\.fields\.model\)\)/.test(run)) {
      fail("editor: " + kind + ".run no longer clamps size via applyDimFields on send");
    } else ok("editor: " + kind + ".run clamps size through applyDimFields on send");
  }

  const njsIdx = block(IDX, "function njsRunFor(type, rn, inp, n){");
  if (!/type==="image" \|\| type==="edit" \|\| type==="inpaint"/.test(njsIdx) || !/applyDimFields\(rn\.fields, dimDefs\(rn\.type, rn\.fields\.model\)\)/.test(njsIdx)) {
    fail("editor: njsRunFor no longer snaps leftover image/edit/inpaint size before the library send");
  } else ok("editor: njsRunFor snaps leftover size on the default (njs) paid path");

  const njsPlay = block(PLAY, "function njsRunFor(type, rn, inp, runKey){");
  if (!/type==="image" \|\| type==="edit" \|\| type==="inpaint"/.test(njsPlay) || !/snapImageSize\(rn, await rawCatItem\("image", mdl\(rn\)\)\)/.test(njsPlay)) {
    fail("play: njsRunFor no longer snaps leftover image/edit/inpaint size before the library send");
  } else ok("play: njsRunFor snaps leftover size on the default (njs) paid path");
}

catalog.image = [
  {
    id: "qwen-image-3",
    supported_parameters: { resolutions: ["auto", "1024x1024", "512x512", "768x1024"] },
  },
  {
    id: "nano-banana-2",
    supported_parameters: { resolutions: ["1k", "2k", "4k"] },
  },
  {
    id: "bria/fibo-generate-1.5/text-to-image",
    supported_parameters: { resolutions: ["1mp", "4mp"] },
  },
];
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
  {
    id: "google/gemini-omni-flash",
    supported_parameters: { parameters: {
      duration: { type: "select", default: "8", options: OMNI_DUR_OPTS },
      aspect_ratio: { type: "select", default: "16:9", options: [{ value: "16:9" }, { value: "9:16" }] },
    } },
  },
  {
    id: "google/gemini-omni-flash/v1.1",
    supported_parameters: { parameters: {
      duration: { type: "select", default: "8", options: OMNI_DUR_OPTS },
      resolution: { type: "select", default: "720p", options: [
        { value: "360p" }, { value: "720p" }, { value: "1080p" }, { value: "4k" },
      ] },
      aspect_ratio: { type: "select", default: "16:9", options: [{ value: "16:9" }, { value: "9:16" }] },
    } },
  },
  {
    id: "no-aspect-vedit",
    supported_parameters: { parameters: {
      resolution: { options: [{ value: "720p" }, { value: "1080p" }], default: "720p" },
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

{
  const sent = await spyTvideo({ model: "google/gemini-omni-flash", duration: "8", aspect: "16:9", resolution: "4k" });
  const dims = (sent && sent.opts && sent.opts.dims) || {};
  if (dims.resolution != null && dims.resolution !== "") {
    fail("play send: Omni v1 posted leftover resolution " + JSON.stringify(dims.resolution));
  } else if (String(dims.duration) !== "8") {
    fail("play send: Omni v1 duration was dropped/clamped, got " + JSON.stringify(dims.duration));
  } else if (dims.aspect_ratio !== "16:9") {
    fail("play send: Omni v1 aspect_ratio was dropped, got " + JSON.stringify(dims.aspect_ratio));
  } else ok("play send: Omni v1 omits leftover 4k resolution (catalog has none)");
}

{
  const sent = await spyTvideo({ model: "google/gemini-omni-flash/v1.1", duration: "8", aspect: "16:9", resolution: "4k" });
  const dims = (sent && sent.opts && sent.opts.dims) || {};
  if (String(dims.resolution) !== "4k") fail("play send: Omni 1.1 dropped listed 4k, got " + JSON.stringify(dims.resolution));
  else ok("play send: Omni 1.1 still posts listed 4k resolution");
}

{
  const sent = await spyTvideo({ model: "google/gemini-omni-flash/v1.1", duration: "8", aspect: "16:9", resolution: "768p" });
  const dims = (sent && sent.opts && sent.opts.dims) || {};
  if (String(dims.resolution) === "768p") fail("play send: leftover 768p survived on Omni 1.1");
  else if (!["360p", "720p", "1080p", "4k"].includes(String(dims.resolution))) {
    fail("play send: Omni 1.1 768p snap is not a listed res, got " + JSON.stringify(dims.resolution));
  } else ok("play send: leftover 768p on Omni 1.1 snaps to " + dims.resolution);
}

async function spyVedit(fields) {
  let sent = null;
  await app.NODE_TYPES.vedit.run(
    { id: "e1", type: "vedit", fields: { prompt: "restyle", ...fields } },
    { video: "https://cdn.example/in.mp4" },
    { genVideo: (model, prompt, opts) => { sent = { model, prompt, opts }; return "https://cdn.example/v.mp4"; } },
    () => {},
  );
  return sent;
}

{
  const sent = await spyVedit({ model: "no-aspect-vedit", resolution: "1080p", aspect: "9:16", duration: "8" });
  const dims = (sent && sent.opts && sent.opts.dims) || {};
  if (dims.aspect_ratio != null) fail("play send: vedit posted leftover aspect_ratio on a no-aspect model");
  else if (dims.duration != null) fail("play send: vedit posted leftover duration on a no-duration model");
  else if (String(dims.resolution) !== "1080p") fail("play send: vedit dropped listed 1080p, got " + JSON.stringify(dims.resolution));
  else ok("play send: vedit omits leftover aspect/duration when the catalog does not list them");
}

{
  const vdp = block(PLAY, "async function videoDimParams(n){");
  if (!/pack\.resolution && res!=null/.test(vdp)) fail("play: videoDimParams no longer gates resolution on catalog advertisement");
  else ok("play: videoDimParams only posts resolution when the catalog lists it");
}

// njs videoDims (exported / editor-delegated path) — same Omni v1 leftover-resolution gate
{
  const njsSrc = readFileSync(join(ROOT, "vendor", "njs-engine.js"), "utf8");
  const start = njsSrc.indexOf("function videoDims(n, ctx) {");
  if (start === -1) fail("njs: videoDims() not found");
  else {
    let depth = 0, end = -1;
    for (let j = njsSrc.indexOf("{", start); j < njsSrc.length; j++) {
      if (njsSrc[j] === "{") depth++;
      else if (njsSrc[j] === "}" && --depth === 0) { end = j + 1; break; }
    }
    const ctx = {
      console,
      catItem: (catalog, kind, id) => (catalog && catalog[kind] || []).find((m) => m && m.id === id) || null,
    };
    vm.createContext(ctx);
    vm.runInContext(njsSrc.slice(start, end), ctx);
    const cat = {
      video: [
        {
          id: "google/gemini-omni-flash",
          supported_parameters: { parameters: {
            duration: { type: "select", default: "8", options: OMNI_DUR_OPTS },
            aspect_ratio: { type: "select", default: "16:9", options: [{ value: "16:9" }, { value: "9:16" }] },
          } },
        },
        {
          id: "google/gemini-omni-flash/v1.1",
          supported_parameters: { parameters: {
            duration: { type: "select", default: "8", options: OMNI_DUR_OPTS },
            resolution: { type: "select", default: "720p", options: [{ value: "720p" }, { value: "4k" }] },
            aspect_ratio: { type: "select", default: "16:9", options: [{ value: "16:9" }, { value: "9:16" }] },
          } },
        },
      ],
    };
    const v1 = ctx.videoDims(
      { type: "tvideo", fields: { model: "google/gemini-omni-flash", duration: "8", aspect: "16:9", resolution: "4k" } },
      { catalog: cat },
    );
    if (v1.resolution != null) fail("njs send: Omni v1 posted leftover resolution " + JSON.stringify(v1.resolution));
    else if (String(v1.duration) !== "8" || v1.aspect_ratio !== "16:9") {
      fail("njs send: Omni v1 dropped duration/aspect, got " + JSON.stringify(v1));
    } else ok("njs send: Omni v1 omits leftover 4k resolution (catalog has none)");

    const v11 = ctx.videoDims(
      { type: "tvideo", fields: { model: "google/gemini-omni-flash/v1.1", duration: "8", aspect: "16:9", resolution: "4k" } },
      { catalog: cat },
    );
    if (String(v11.resolution) !== "4k") fail("njs send: Omni 1.1 dropped listed 4k, got " + JSON.stringify(v11.resolution));
    else ok("njs send: Omni 1.1 still posts listed 4k resolution");

    const ved = ctx.videoDims(
      { type: "vedit", fields: { model: "google/gemini-omni-flash", duration: "8", aspect: "9:16", resolution: "4k" } },
      { catalog: cat },
    );
    if (ved.resolution != null) fail("njs send: Omni v1 vedit posted leftover resolution");
    else if (ved.aspect_ratio !== "9:16") fail("njs send: Omni v1 vedit dropped advertised aspect");
    else ok("njs send: vedit omits leftover resolution when the catalog does not list it");
  }
}

async function spyImage(fields) {
  let sent = null;
  await app.NODE_TYPES.image.run(
    { id: "i1", type: "image", fields: { prompt: "a cat", variations: "1", ...fields } },
    {},
    { genImage: (prompt, model, size) => { sent = { prompt, model, size }; return ["https://cdn.example/i.png"]; } },
  );
  return sent;
}

{
  const sent = await spyImage({ model: "qwen-image-3", size: "2k" });
  const size = sent && sent.size;
  if (String(size) === "2k") fail("play send: leftover 2k on qwen-image-3 was still posted");
  else if (size == null || size === "") fail("play send: qwen-image-3 generate dropped size");
  else ok("play send: leftover 2k → qwen-image-3 posts size " + size);
}

{
  const sent = await spyImage({ model: "nano-banana-2", size: "2k" });
  if (String(sent && sent.size) !== "2k") fail("play send: still-valid 2k on banana was reset to " + (sent && sent.size));
  else ok("play send: still-valid 2k on nano-banana-2 is posted");
}

{
  const sent = await spyImage({ model: "bria/fibo-generate-1.5/text-to-image", size: "1mp" });
  if (String(sent && sent.size) !== "1mp") fail("play send: FIBO pin 1mp was rewritten to " + (sent && sent.size));
  else ok("play send: FIBO 1mp stays 1mp (still listed)");
}

{
  const sent = await spyImage({ model: "not-in-catalog", size: "2k" });
  if (String(sent && sent.size) !== "2k") fail("play send: catalog-missing image clobbered stored 2k (got " + (sent && sent.size) + ")");
  else ok("play send: catalog-missing image still posts stored 2k (no false clamp)");
}

if (failed) { console.error("\ncheck-model-knob-clamp: " + failed + " failure(s)"); process.exit(1); }
console.log("\ncheck-model-knob-clamp: OK");
