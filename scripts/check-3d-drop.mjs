#!/usr/bin/env node
// Offline pins for canvas drop routing, the image-input .glb hint, Create-app blocking,
// the lazy GLB viewer, and the committed sample mesh. No browser, no API spend.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "index.html"), "utf8");
const VIEWER = readFileSync(join(ROOT, "vendor/glb-viewer.js"), "utf8");

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

const ctx = {};
vm.createContext(ctx);
vm.runInContext(extractFn("droppedFileKind") + "\nfunction is3dFile(f){ return droppedFileKind(f)==='model3d'; }\nglobalThis.droppedFileKind = droppedFileKind;", ctx);
const kind = ctx.droppedFileKind;
ok(kind({ name: "cup.glb", type: "" }) === "model3d", ".glb name routes to 3D");
ok(kind({ name: "cup.GLTF", type: "" }) === "gltf", ".gltf is refused rather than treated as a GLB");
ok(kind({ name: "x.bin", type: "model/gltf-binary" }) === "model3d", "gltf-binary mime routes to 3D");
ok(kind({ name: "x.bin", type: "model/gltf+json" }) === "gltf", "gltf+json is refused rather than treated as a GLB");
ok(kind({ name: "shot.png", type: "image/png" }) === "image", "png routes to an image input");
ok(kind({ name: "shot.JPG", type: "" }) === "image", "jpeg extension routes to an image input");
ok(kind({ name: "notes.pdf", type: "application/pdf" }) === "", "other files are rejected");

ok(SRC.includes('addEventListener("dragover"') && SRC.includes('indexOf("Files")') && SRC.includes("e.preventDefault()"),
  "a document dragover preventDefault keeps the browser from navigating");
ok(SRC.includes('addEventListener("drop"') && SRC.includes('dropToast(e.clientX, e.clientY, "drop a .glb or an image")'),
  "a rejected drop toasts at the cursor instead of downloading");
ok(SRC.includes('dropToast(e.clientX, e.clientY, "only .glb for now")'),
  "a .gltf drop says only .glb for now");
ok(SRC.includes("that's a 3D file — drop it on the canvas"),
  "Image input names a .glb instead of a bad image");
ok(SRC.includes("3D nodes stay in the editor for now — Create app doesn’t run them yet"),
  "Create app blocks 3D nodes with a clear message");
ok(SRC.includes("“{id}” is a 3D model — add a 🧊 3D model node"), "picker hint names the 3D model and the node");
ok(SRC.includes("showCreateAppBlock") && SRC.includes('id="appblock"'), "the Create-app block is anchored under the button");
ok(!/NJS_TYPES\s*=\s*\{[^}]*model3d/.test(SRC), "3D stays off the nanoodle-js delegation list");

const viewerRefs = SRC.match(/vendor\/glb-viewer\.js/g) || [];
ok(viewerRefs.length === 1, "viewer JS is referenced once (the lazy loader), got " + viewerRefs.length);
ok(!/<script[^>]+src=["']vendor\/glb-viewer\.js["']/.test(SRC), "no static script tag for the viewer");
ok(SRC.includes("function loadGlbViewer("), "loadGlbViewer is the injection point");
const viewerCode = VIEWER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const rafCount = (viewerCode.match(/requestAnimationFrame/g) || []).length;
ok(rafCount === 1, "viewer schedules one animation frame per burst, got " + rafCount);
{
  const rAt = viewerCode.indexOf("function render()");
  const uAt = viewerCode.indexOf("function upload(");
  ok(rAt > 0 && uAt > rAt && !viewerCode.slice(rAt, uAt).includes("requestAnimationFrame"),
    "the paint callback does not schedule another frame");
}
{
  const fAt = viewerCode.indexOf("function fetchable");
  const aAt = viewerCode.indexOf("function asBytes");
  ok(fAt > 0 && aAt > fAt && !viewerCode.slice(fAt, aAt).includes("data:"), "fetchable does not accept data: URLs");
}
ok(viewerCode.includes("function decodeDataUrl"), "data: GLBs are decoded locally");
ok(VIEWER.includes("IntersectionObserver"), "viewer pauses when offscreen");
ok(VIEWER.includes("NanoodleGlbViewer"), "viewer exposes NanoodleGlbViewer");

const bytes = readFileSync(join(ROOT, "examples/product-shot/sample.glb"));
ok(bytes.readUInt32LE(0) === 0x46546C67 && bytes.readUInt32LE(8) === bytes.length, "sample.glb is a GLB whose length matches the header");
ok(bytes.length <= 1.5 * 1024 * 1024, "sample.glb stays under 1.5 MB, got " + bytes.length);
const parseCtx = { TextDecoder, DataView, Uint8Array, Float32Array, Uint16Array, Uint32Array, ArrayBuffer, bytes: new Uint8Array(bytes) };
parseCtx.globalThis = parseCtx;
vm.createContext(parseCtx);
vm.runInContext(VIEWER + "\nglobalThis.parsed = NanoodleGlbViewer.parseGlb(bytes);", parseCtx);
const parsed = parseCtx.parsed;
ok(parsed && parsed.meshes && parsed.meshes.length === 1,
  "sample.glb parses to one mesh, got " + (parsed && parsed.meshes ? parsed.meshes.length : JSON.stringify(parsed && parsed.error)));
const mesh0 = parsed && parsed.meshes && parsed.meshes[0];
const tris = mesh0 && mesh0.indices ? mesh0.indices.length / 3 : 0;
ok(tris >= 40000 && tris <= 80000, "sample teapot is about 40–80k triangles, got " + tris);
ok(mesh0 && mesh0.image && mesh0.image.bytes && mesh0.image.bytes[0] === 0xff && mesh0.image.bytes[1] === 0xd8,
  "sample mesh carries a jpeg texture");
ok(!/extensionsRequired/.test(Buffer.from(bytes).toString("utf8").slice(0, 8000)) || !/"EXT_meshopt_compression"|"KHR_draco_mesh_compression"|"KHR_mesh_quantization"/.test(Buffer.from(bytes.subarray(0, 12000)).toString("utf8")),
  "sample.glb does not require meshopt, draco, or quantization");

const jpg = readFileSync(join(ROOT, "examples/product-shot/input.jpg"));
ok(jpg[0] === 0xff && jpg[1] === 0xd8 && jpg.length < 40000, "the teapot photo is a small jpeg");
ok(SRC.includes('title:"Teapot → 3D"') && /fields:\{image:"data:image\/jpeg;base64,/.test(SRC),
  "the teapot example inlines the resized photo");

const priv = {};
vm.createContext(priv);
vm.runInContext(
  "const UPLOAD_FIELD = { upload:'image', aupload:'audio', vupload:'video', mupload:'model' };\n" +
  "const SAFE_MEDIA_RE = /^(data:|blob:)/;\n" +
  "const SAMPLE_GLB_RE = /^examples\\/[A-Za-z0-9_./-]+\\.glb$/;\n" +
  extractFn("stripInjectedMedia") + "\n" +
  extractFn("glbPreviewUrl") + "\n" +
  "globalThis.stripInjectedMedia = stripInjectedMedia; globalThis.glbPreviewUrl = glbPreviewUrl;",
  priv);
const beacon = { type: "model3d", fields: { sample: "https://evil/track.glb" } };
priv.stripInjectedMedia(beacon);
ok(!beacon.fields.sample, "a remote sample URL is stripped on import");
const kept = { type: "model3d", fields: { sample: "examples/product-shot/sample.glb" } };
priv.stripInjectedMedia(kept);
ok(kept.fields.sample === "examples/product-shot/sample.glb", "an examples/*.glb sample is kept");
const dot = { type: "model3d", fields: { sample: "examples/../secret.glb" } };
priv.stripInjectedMedia(dot);
ok(!dot.fields.sample, "a sample path with .. is stripped");
ok(priv.glbPreviewUrl("https://cdn.example/a.glb") === "", "https is not previewed from a field");
ok(String(priv.glbPreviewUrl("https://cdn.example/a.glb", { allowRemote: true })).startsWith("https://"),
  "https is previewed only when the caller allows a real result");
ok(SRC.includes('|| s.url') === false || !/function model3dStatusUrl[\s\S]{0,700}\|\| s\.url/.test(SRC),
  "the 3D result URL chain does not take a bare s.url");
{
  const urlCtx = {};
  vm.createContext(urlCtx);
  vm.runInContext(extractFn("model3dStatusUrl") + "\nglobalThis.model3dStatusUrl = model3dStatusUrl;", urlCtx);
  const shape = { data: { status: "COMPLETED", output: {
    video: { url: "https://cdn.example/v.glb" },
    videoUrls: ["https://cdn.example/list.glb"],
    kind: "3d", format: "glb",
    model_url: "https://cdn.example/model.glb"
  } } };
  ok(urlCtx.model3dStatusUrl(shape) === "https://cdn.example/model.glb", "model_url is read before video.url");
  ok(urlCtx.model3dStatusUrl({ data: { output: { model_url: "https://cdn.example/model.glb", video: { url: "https://cdn.example/v.mp4" } } } }) === "",
    "a payload without kind 3d or format glb is ignored");
  ok(urlCtx.model3dStatusUrl({ data: { output: { kind: "3d", model: { url: "https://cdn.example/m.glb" }, video: { url: "https://cdn.example/v.glb" } } } }) === "https://cdn.example/m.glb",
    "model.url is next when model_url is absent");
  ok(urlCtx.model3dStatusUrl({ data: { output: { format: "glb", video: { url: "https://cdn.example/v.glb" }, videoUrls: ["https://cdn.example/list.glb"] } } }) === "https://cdn.example/v.glb",
    "video.url is used when no model url is present");
  ok(urlCtx.model3dStatusUrl({ data: { output: { kind: "3d", videoUrls: [{ url: "https://cdn.example/list.glb" }] } } }) === "https://cdn.example/list.glb",
    "videoUrls[0] is the last resort");
  ok(urlCtx.model3dStatusUrl({ url: "https://cdn.example/bare.glb", data: { output: { kind: "3d", format: "glb" } } }) === "",
    "a bare s.url is not a 3D result");
}
ok(SRC.includes("MODEL3D_STALL_MS = MODEL3D_TYPICAL_MS * 5"), "a 3D job warns at about 5× the typical time");
ok(SRC.includes("MODEL3D_DEADLINE_MS") && SRC.includes("still building after 25 minutes — ▶ Run to check the same job"),
  "a 3D poll has a hard deadline and keeps the job resumable");
ok(/mediaKind==="model3d" && waited >= MODEL3D_DEADLINE_MS[\s\S]{0,240}throw new Error/.test(SRC)
  && !/MODEL3D_DEADLINE_MS[\s\S]{0,180}PENDING_VIDEO\.delete/.test(SRC),
  "the 3D deadline does not drop the pending job id");
ok(SRC.includes('n.w = 440'), "a new 3D model card defaults wider than a thumbnail");
ok(SRC.includes("optional — describe the object"), "an image-wired 3D prompt reads as optional");
ok(SRC.includes("return { model: url }"), "a 3D run keeps the https URL instead of inlining bytes");
ok(!VIEWER.includes("vec3(0.28,0.62,0.12)") && VIEWER.includes("dot(n,V)"),
  "the viewer headlight follows the camera");

if (fail) { console.error("\n✗ check-3d-drop: " + fail + " failed"); process.exit(1); }
console.log("\n✓ check-3d-drop");
