#!/usr/bin/env node
// Audio "newest" must reverse the API's oldest-first family order when created ties,
// and keep version-DESC within a family. Source + behavioral fixture.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const idx = readFileSync(join(ROOT, "index.html"), "utf8");
const play = readFileSync(join(ROOT, "play.html"), "utf8");

assert.match(idx, /kind==="audio"\s*\?\s*nat\.get\(famSig\(b\.id\)\)\s*-\s*nat\.get\(famSig\(a\.id\)\)/);
assert.match(idx, /picker\.kind==="audio"/);
assert.match(idx, /\(b\._ord\|\|0\)-\(a\._ord\|\|0\)/);
assert.match(play, /kind==="audio"\s*\?\s*nat\.get\(famSig\(b\.id\)\)\s*-\s*nat\.get\(famSig\(a\.id\)\)/);
assert.match(play, /raw\.forEach\(\(m,i\)=>/);

const VER_RE = /\d+(?:\.\d+)*/g;
const famSig = (id) => id.toLowerCase().replace(VER_RE, "#");
const verParts = (id) => (id.match(VER_RE) || []).join(".").split(".").map(Number);
function verDesc(a, b) {
  const va = verParts(a), vb = verParts(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] || 0) - (va[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Fixture mirrors live audio catalog shape: uniform created, oldest-first native order.
const created = 1789137649;
const native = [
  "elevenlabs/music",
  "Minimax-Music-02",
  "Minimax-Music-2.5",
  "Minimax-Music-2.6",
  "minimax/music-3",
  "mureka-ai/mureka-v7.6/generate-song",
  "mureka-ai/mureka-v9/generate-song",
  "mureka-ai/mureka-v9.5/generate-song",
].map((id, i) => ({ id, created, _ord: i }));

const nat = new Map();
native.forEach((m, i) => {
  const s = famSig(m.id);
  if (!nat.has(s)) nat.set(s, i);
});
const famTie = (a, b) => nat.get(famSig(b.id)) - nat.get(famSig(a.id));
const sorted = native.slice().sort(
  (a, b) => (b.created || 0) - (a.created || 0) || famTie(a, b) || verDesc(a.id, b.id),
);
const ids = sorted.map((m) => m.id);
assert.deepEqual(ids.slice(0, 3), [
  "mureka-ai/mureka-v9.5/generate-song",
  "mureka-ai/mureka-v9/generate-song",
  "mureka-ai/mureka-v7.6/generate-song",
], "Mureka family should lead, version-DESC");
assert.ok(ids.indexOf("minimax/music-3") < ids.indexOf("Minimax-Music-2.6"), "Music 3 before Music 2.6 family");
assert.ok(ids.indexOf("Minimax-Music-2.6") < ids.indexOf("Minimax-Music-02"), "2.6 before 02 within family");
assert.equal(ids.at(-1), "elevenlabs/music", "earliest native line sinks under newest");

console.log("✓ audio newest sort: reverse-family + version-DESC when created ties (editor + play source)");
