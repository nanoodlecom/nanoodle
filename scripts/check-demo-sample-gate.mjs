#!/usr/bin/env node
// Guard: signed-out first visit may free-sample ONLY the postcard starter
// (exact / same-shape field edits) plus ONE covered extension — an Image→Video
// node hung off the starter image output. Everything else is the sign-in wall.
//
// #474 grew the starter from a 3-node ramen to Place+Vibe→Spec→LLM→Postcard.
// demoVideoNode() is structural on purpose (the appended node's id is not
// stable). A too-loose gate serves demo-sample.mp4 as "your" clip on a random
// ivideo graph; a too-tight gate turns the first-visit wow into the wall.
//
// demoClip() must also refuse a 200 SPA HTML fallback (static hosts answer a
// missing mp4 with index.html). A text/html "video" is a broken player, not a
// sample.
//
// Offline node:vm. No browser. No API spend. Complements check-starter-lockstep
// (graph copies + sample pills) and check-stale-input-charge (stubbed demoMode).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const STARTER = JSON.parse(readFileSync(join(ROOT, "noodle-graph.json"), "utf8"));

let failed = 0;
const fail = (m) => { console.error("✗ check-demo-sample-gate: " + m); failed++; };
const ok = (m) => console.log("  ✓ " + m);

function matchBrace(src, openIdx) {
  let depth = 0;
  const tmpl = [];
  let mode = "code";
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i++; }
      else if (c === "/" && n === "*") { mode = "block"; i++; }
      else if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (tmpl.length && depth === tmpl[tmpl.length - 1]) { tmpl.pop(); mode = "tpl"; }
        else if (depth === 0) return i;
      }
    } else if (mode === "line") { if (c === "\n") mode = "code"; }
    else if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i++; } }
    else if (mode === "sq") { if (c === "\\") i++; else if (c === "'") mode = "code"; }
    else if (mode === "dq") { if (c === "\\") i++; else if (c === '"') mode = "code"; }
    else if (mode === "tpl") {
      if (c === "\\") i++;
      else if (c === "`") mode = "code";
      else if (c === "$" && n === "{") { mode = "code"; tmpl.push(depth); depth++; i++; }
    }
  }
  throw new Error("unbalanced braces from index " + openIdx);
}

function extractFn(src, name) {
  const sig = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = sig.exec(src);
  if (!m) throw new Error("function " + name + "() not found");
  const open = src.indexOf("{", m.index);
  return src.slice(m.index, matchBrace(src, open) + 1);
}

function extractDemoGenVideo() {
  const demoStart = srcIndex("const DEMO_CTX = {");
  const gv = IDX.indexOf("async genVideo(model, prompt, opts, imageDataUrl, onProgress){", demoStart);
  if (gv < 0) throw new Error("DEMO_CTX.genVideo not found");
  const open = IDX.indexOf("{", gv);
  return "async function genVideo(model, prompt, opts, imageDataUrl, onProgress)" +
    IDX.slice(open, matchBrace(IDX, open) + 1);
}

function srcIndex(needle) {
  const i = IDX.indexOf(needle);
  if (i < 0) throw new Error(needle + " not found");
  return i;
}

function clone(g) {
  return JSON.parse(JSON.stringify(g));
}

function imageNodeId(g) {
  const n = (g.nodes || []).find((x) => x.type === "image");
  return n && n.id;
}

function withVideo(g, opts = {}) {
  const out = clone(g);
  const v = { id: opts.id || "v1", type: opts.type || "ivideo", fields: {} };
  out.nodes.push(v);
  out.links.push({
    id: "lv",
    from: { node: opts.from || imageNodeId(out), port: opts.fromPort || "image" },
    to: { node: v.id, port: opts.toPort || "image" },
  });
  if (opts.endframe) {
    out.links.push({
      id: "le",
      from: { node: imageNodeId(out), port: "image" },
      to: { node: v.id, port: "endframe" },
    });
  }
  if (opts.downstream) {
    out.nodes.push({ id: "d1", type: "comment", fields: {} });
    out.links.push({
      id: "ld",
      from: { node: v.id, port: "video" },
      to: { node: "d1", port: "text" },
    });
  }
  if (opts.secondIvideo) {
    out.nodes.push({ id: "v2", type: "ivideo", fields: {} });
  }
  if (opts.dropNode) {
    out.nodes = out.nodes.filter((n) => n.id !== opts.dropNode);
    out.links = out.links.filter((l) => l.from.node !== opts.dropNode && l.to.node !== opts.dropNode);
  }
  if (opts.addType) {
    out.nodes.push({ id: "x1", type: opts.addType, fields: {} });
  }
  return out;
}

function loadGate() {
  const ctx = {
    graph: clone(STARTER),
    demoStarterShape: null,
    demoStarterSig: "CANONICAL",
    handoff: "CANONICAL",
    appHandoffSig() { return ctx.handoff; },
  };
  vm.createContext(ctx);
  vm.runInContext(
    [extractFn(IDX, "demoShapeSig"), extractFn(IDX, "demoVideoNode"), extractFn(IDX, "demoMode")].join("\n"),
    ctx,
    { filename: "index.html#demo-sample-gate" },
  );
  ctx.demoStarterShape = ctx.demoShapeSig(STARTER);
  return ctx;
}

// ---- source pins: the three helpers still exist and stay structural --------
{
  if (!/function demoShapeSig\(/.test(IDX) || !/function demoVideoNode\(/.test(IDX) || !/function demoMode\(/.test(IDX)) {
    fail("demoShapeSig / demoVideoNode / demoMode must stay in index.html");
  } else ok("demoMode trio still lives in the editor");
  const videoFn = extractFn(IDX, "demoVideoNode");
  if (!/n\.type === "ivideo"/.test(videoFn) || !/to\.port !== "image"/.test(videoFn)) {
    fail("demoVideoNode must stay an ivideo-on-image-port structural check");
  } else ok("demoVideoNode is still structural (ivideo into image, not an id list)");
  if (!/src\.type !== "image"/.test(videoFn) || !/from\.port !== "image"/.test(videoFn)) {
    fail("demoVideoNode must require the starter image node's image output");
  } else ok("demoVideoNode still requires the starter image output");
  if (!/links\.some\(l=> l\.from\.node === v\.id\)/.test(videoFn)) {
    fail("demoVideoNode must refuse an ivideo that already feeds something else");
  } else ok("demoVideoNode still refuses a downstream ivideo");
  const clipFn = extractFn(IDX, "demoClip");
  if (!/blob\.type/.test(clipFn) || !/not a clip/.test(clipFn)) {
    fail("demoClip must reject a non-video Content-Type (SPA HTML 200 is not a clip)");
  } else ok("demoClip still guards Content-Type as video/*");
  if (!/if\s*\(\s*!r\.ok\s*\)/.test(clipFn)) {
    fail("demoClip must refuse a non-OK fetch");
  } else ok("demoClip still refuses a missing / failed clip fetch");
}

// ---- starter still has an image node the ivideo extension can hang off ----
{
  const img = STARTER.nodes.find((n) => n.type === "image");
  if (!img) fail("noodle-graph.json has no image node — demoVideoNode can never match");
  else if (img.id !== "n6") fail("starter image id drifted (demo comments pin n1…n6); got " + img.id);
  else ok("postcard starter still has image n6 for the covered ivideo extension");
  const types = STARTER.nodes.map((n) => n.type);
  if (types.filter((t) => t === "ivideo").length) {
    fail("shipped starter must not already include an ivideo (the extension is visitor-appended)");
  } else ok("shipped starter has no ivideo of its own");
}

// ---- demoMode: exact / shape / video / wall --------------------------------
{
  const T = loadGate();

  T.graph = clone(STARTER);
  T.handoff = "CANONICAL";
  if (T.demoMode() !== "exact") fail("pristine starter must be demoMode exact, got " + T.demoMode());
  else ok("pristine postcard starter is exact");

  T.handoff = "EDITED-FIELDS";
  if (T.demoMode() !== "shape") fail("same topology with field tweaks must be demoMode shape, got " + T.demoMode());
  else ok("field-only edit on the postcard is shape (canned results, warned)");

  const videoG = withVideo(STARTER);
  T.graph = videoG;
  T.handoff = "EDITED-FIELDS";
  if (T.demoMode() !== "video") fail("starter + one ivideo on the postcard must be demoMode video, got " + T.demoMode());
  else ok("postcard + Image→Video is the covered video sample");
  const v = T.demoVideoNode();
  if (!v || v.id !== "v1") fail("demoVideoNode must return the appended ivideo (got " + JSON.stringify(v) + ")");
  else ok("demoVideoNode returns the appended ivideo");

  T.graph = withVideo(STARTER, { addType: "music" });
  if (T.demoMode() != null || T.demoVideoNode()) {
    fail("starter + ivideo + a music node must hit the sign-in wall (rest is no longer the starter)");
  } else ok("extra node besides the covered ivideo is the wall");

  const plusMusic = clone(STARTER);
  plusMusic.nodes.push({ id: "x1", type: "music", fields: {} });
  T.graph = plusMusic;
  if (T.demoMode() != null) fail("starter + music must be the wall, got " + T.demoMode());
  else ok("a non-starter topology is the sign-in wall");

  const empty = loadGate();
  empty.demoStarterShape = null;
  empty.graph = clone(STARTER);
  if (empty.demoMode() != null) fail("demoMode must be null before the starter signature is captured");
  else ok("unsigned boot without a starter signature cannot free-sample");
}

// ---- demoVideoNode: only the one covered hang-off --------------------------
{
  const T = loadGate();
  const cases = [
    ["tvideo instead of ivideo", withVideo(STARTER, { type: "tvideo" }), null],
    ["vedit instead of ivideo", withVideo(STARTER, { type: "vedit" }), null],
    ["second ivideo on the canvas", withVideo(STARTER, { secondIvideo: true }), null],
    ["end-frame morph wire", withVideo(STARTER, { endframe: true }), null],
    ["ivideo already feeds a downstream node", withVideo(STARTER, { downstream: true }), null],
    ["ivideo fed by the LLM, not the image", withVideo(STARTER, { from: "n5", fromPort: "text" }), null],
    ["ivideo into a non-image port", withVideo(STARTER, { toPort: "endframe" }), null],
    ["rest of canvas is not the starter (dropped Place)", withVideo(STARTER, { dropNode: "n2" }), null],
  ];
  for (const [label, g, want] of cases) {
    T.graph = g;
    const got = T.demoVideoNode();
    if (want == null && got) fail("demoVideoNode accepted " + label + " (got id " + got.id + ")");
    else if (want != null && (!got || got.id !== want)) fail("demoVideoNode rejected " + label);
    else ok("refuses " + label);
  }

  T.graph = clone(STARTER);
  if (T.demoVideoNode()) fail("bare starter must not look like the video extension");
  else ok("bare starter is not the video extension");
}

// ---- DEMO_CTX.genVideo only serves the covered ivideo ----------------------
{
  let covered = { id: "v1" };
  const ctx = {
    demoVideoNode: () => covered,
    demoDeny: async () => { throw new Error("the sample doesn't cover this node — sign in to run it for real"); },
    demoClip: async () => "data:video/mp4;base64,CLIP",
    demoPause: async () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(extractDemoGenVideo(), ctx, { filename: "index.html#DEMO_CTX.genVideo" });

  const served = await ctx.genVideo("minimax-h3", "rain", { runKey: "v1" }, "img");
  if (served !== "data:video/mp4;base64,CLIP") {
    fail("covered ivideo must receive the canned clip, got " + JSON.stringify(served));
  } else ok("covered ivideo receives demo-sample.mp4");

  let denied = "";
  try { await ctx.genVideo("minimax-h3", "rain", { runKey: "other" }, "img"); }
  catch (e) { denied = e.message; }
  if (!/doesn't cover this node/.test(denied)) {
    fail("mismatched runKey must demoDeny (got " + denied + ")");
  } else ok("a second / wrong video node is demoDeny, not a fake clip");

  denied = "";
  try { await ctx.genVideo("minimax-h3", "rain", null, "img"); }
  catch (e) { denied = e.message; }
  if (!/doesn't cover this node/.test(denied)) fail("missing opts must demoDeny");
  else ok("genVideo without opts (tvideo leftover) is demoDeny");

  covered = null;
  denied = "";
  try { await ctx.genVideo("x", "rain", { runKey: "v1" }, "img"); }
  catch (e) { denied = e.message; }
  if (!/doesn't cover this node/.test(denied)) {
    fail("no covered ivideo must demoDeny even with a runKey");
  } else ok("Text→Video / Video-edit on a non-covered canvas is demoDeny");
}

// ---- demoClip: SPA HTML 200 must not become a "video" ----------------------
{
  function loadClip(fetchImpl) {
    const ctx = {
      fetch: fetchImpl,
      FileReader: class {
        constructor() { this.result = ""; this.onload = null; this.onerror = null; }
        readAsDataURL() {
          this.result = "data:video/mp4;base64,AAAA";
          queueMicrotask(() => this.onload && this.onload());
        }
      },
    };
    vm.createContext(ctx);
    vm.runInContext("var _demoClipUrl;\n" + extractFn(IDX, "demoClip"), ctx, {
      filename: "index.html#demoClip",
    });
    return ctx;
  }

  const good = loadClip(async () => ({
    ok: true,
    blob: async () => ({ size: 2048, type: "video/mp4" }),
  }));
  const clip = await good.demoClip();
  if (clip !== "data:video/mp4;base64,AAAA") fail("a real mp4 must become a data URL, got " + clip);
  else ok("video/mp4 200 becomes the canned data URL");

  const spa = loadClip(async () => ({
    ok: true,
    blob: async () => ({ size: 1800, type: "text/html" }),
  }));
  const fake = await spa.demoClip();
  if (fake != null) fail("SPA HTML 200 must not become a clip, got " + fake);
  else ok("SPA index.html 200 is not a sample clip");

  const missing = loadClip(async () => ({
    ok: false,
    status: 404,
    blob: async () => ({ size: 0, type: "text/html" }),
  }));
  if (await missing.demoClip() != null) fail("a failed fetch must resolve to null");
  else ok("missing demo-sample.mp4 resolves to null (caller hits the wall)");

  const empty = loadClip(async () => ({
    ok: true,
    blob: async () => ({ size: 0, type: "video/mp4" }),
  }));
  if (await empty.demoClip() != null) fail("an empty video body must not be treated as a clip");
  else ok("empty mp4 body is not a sample clip");
}

if (failed) {
  console.error("check-demo-sample-gate: FAIL (" + failed + ")");
  process.exit(1);
}
console.log("✓ demo sample gate (exact/shape/video/wall + ivideo hang-off + clip MIME)");
