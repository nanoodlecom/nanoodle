#!/usr/bin/env node
// Offline pins for point-cloud GLB support in the GLB viewer: POINTS
// primitives parse (positions + normalized COLOR_0), the Idol Y-down flip,
// mixed mesh+points files, and the real Idol splat sample in the gallery.
// Parse-level only — no browser, no API spend.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VIEWER = readFileSync(join(ROOT, "vendor/glb-viewer.js"), "utf8");

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

function buildGlb(json, bin) {
  const jtxt = Buffer.from(JSON.stringify(json), "utf8");
  const jpad = (4 - (jtxt.length % 4)) % 4;
  const bpad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jtxt.length + jpad + 8 + bin.length + bpad;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  let o = 12;
  out.writeUInt32LE(jtxt.length + jpad, o); out.writeUInt32LE(0x4E4F534A, o + 4);
  jtxt.copy(out, o + 8); out.fill(0x20, o + 8 + jtxt.length, o + 8 + jtxt.length + jpad);
  o += 8 + jtxt.length + jpad;
  out.writeUInt32LE(bin.length + bpad, o); out.writeUInt32LE(0x004E4942, o + 4);
  bin.copy(out, o + 8);
  return new Uint8Array(out);
}

function parse(bytes, opts) {
  const ctx = { TextDecoder, DataView, Uint8Array, Float32Array, Uint16Array, Uint32Array, ArrayBuffer, bytes, opts };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(VIEWER + "\nglobalThis.parsed = NanoodleGlbViewer.parseGlb(bytes, opts);", ctx);
  return ctx.parsed;
}

// --- points-only GLB: 4 points, ubyte VEC4 colors ---
{
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const col = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 64, 32, 255]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(col.buffer)]);
  const json = {
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ mode: 0, attributes: { POSITION: 0, COLOR_0: 1 } }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 1, componentType: 5121, count: 4, type: "VEC4" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48 },
      { buffer: 0, byteOffset: 48, byteLength: 16 }
    ],
    buffers: [{ byteLength: bin.length }]
  };
  const glb = buildGlb(json, bin);
  const p = parse(glb);
  ok(p && !p.error, "points-only GLB parses without error, got " + (p && p.error));
  ok(p && p.meshes.length === 0 && p.points.length === 1, "points-only GLB yields 0 meshes and 1 point set");
  ok(p && p.points[0].count === 4, "point count is 4, got " + (p && p.points[0].count));
  ok(p && Math.abs(p.points[0].positions[3] - 1) < 1e-6 && Math.abs(p.points[0].positions[7] - 1) < 1e-6,
    "positions pass through");
  ok(p && Math.abs(p.points[0].colors[0] - 1) < 1e-6 && Math.abs(p.points[0].colors[9] - 128 / 255) < 1e-3,
    "ubyte COLOR_0 is normalized to 0..1");
  const f = parse(glb, { flipPoints: true });
  ok(f && Math.abs(f.points[0].positions[7] + 1) < 1e-6 && Math.abs(f.points[0].positions[11] + 1) < 1e-6
    && Math.abs(f.points[0].positions[3] - 1) < 1e-6,
    "flipPoints rotates 180° about X (y,z negated, x kept)");
}

// --- mixed GLB: one triangle primitive + one points primitive ---
{
  const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const idx = new Uint16Array([0, 1, 2]);
  const pts = new Float32Array([0.5, 0.5, 0.5, -0.5, -0.5, -0.5]);
  const pcol = new Float32Array([1, 0.5, 0.25, 0.1, 0.2, 0.3]);
  const bin = Buffer.concat([Buffer.from(tri.buffer), Buffer.from(idx.buffer), Buffer.alloc(2), Buffer.from(pts.buffer), Buffer.from(pcol.buffer)]);
  const json = {
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [
      { mode: 4, attributes: { POSITION: 0 }, indices: 1 },
      { mode: 0, attributes: { POSITION: 2, COLOR_0: 3 } }
    ] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 2, componentType: 5126, count: 2, type: "VEC3" },
      { bufferView: 3, componentType: 5126, count: 2, type: "VEC3" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
      { buffer: 0, byteOffset: 44, byteLength: 24 },
      { buffer: 0, byteOffset: 68, byteLength: 24 }
    ],
    buffers: [{ byteLength: bin.length }]
  };
  const p = parse(buildGlb(json, bin));
  ok(p && !p.error && p.meshes.length === 1 && p.points.length === 1 && p.points[0].count === 2,
    "mixed GLB yields 1 mesh and 1 point set");
  ok(p && Math.abs(p.points[0].colors[1] - 0.5) < 1e-6, "float COLOR_0 passes through unnormalized");
}

// --- no geometry at all still errors with the existing message ---
{
  const json = {
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ mode: 1, attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: "VEC3" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 24 }],
    buffers: [{ byteLength: 24 }]
  };
  const p = parse(buildGlb(json, Buffer.alloc(24)));
  ok(p && p.error === "no triangles in this model", "a lines-only GLB keeps the existing error, got " + (p && p.error));
}

// --- the real Idol splat sample shipped in the gallery ---
{
  const bytes = new Uint8Array(readFileSync(join(ROOT, "examples/gallery/photo-to-3d-splat/model.glb")));
  const p = parse(bytes, { flipPoints: true });
  ok(p && !p.error, "the Idol gallery sample parses without error, got " + (p && p.error));
  ok(p && p.meshes.length === 0 && p.points.length === 1, "the Idol sample is a single point set");
  ok(p && p.points[0].count === 245428, "the Idol sample has 245,428 points, got " + (p && p.points[0].count));
  let cmax = 0;
  if (p && p.points[0]) for (let i = 0; i < p.points[0].colors.length; i++) if (p.points[0].colors[i] > cmax) cmax = p.points[0].colors[i];
  ok(cmax > 0.9 && cmax <= 1.0, "the Idol sample colors are normalized (max " + cmax.toFixed(3) + ")");
}

// --- render path pins ---
ok(VIEWER.includes("gl.POINTS"), "the viewer draws gl.POINTS");
ok(VIEWER.includes("gl_PointSize"), "the point size is set in the vertex shader");
ok(VIEWER.includes("flipPoints"), "the viewer exposes the flipPoints option");

if (fail) { console.error("\n✗ check-3d-points: " + fail + " failed"); process.exit(1); }
console.log("\n✓ check-3d-points");
