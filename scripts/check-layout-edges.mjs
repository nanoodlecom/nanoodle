#!/usr/bin/env node
// Leftover layout-engine edges after #614.
// That PR shipped free-slot happy path, tidy row/columns, one-port auto-wire,
// product=off / Shift+T / menu pins. This file pins the other half: tidy on
// 0–1 nodes, rank skip/self-loop/cycle (must not hang), touching-edge overlap,
// exhausted free-slot fallback, clearPack identity, geoOn throws stay on, and
// disabled ports stay out of auto-wire. Offline, zero API spend. New file so
// it does not collide with open leftover PRs.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "index.html"), "utf8");

const failures = [];
const fail = (m) => failures.push(m);
const ok = (c, m) => { if (!c) fail(m); };

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
function extractFunction(src, name) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error("could not find function " + name + "() in index.html");
  const open = src.indexOf("{", m.index);
  return src.slice(m.index, matchBrace(src, open) + 1);
}

const names = ["geoOn", "geoOverlap", "geoFreeSlot", "geoRanks", "geoTidyPositions", "geoClearPack", "geoFitInputs"];
const ctx = { location: { search: "" }, localStorage: { getItem: () => null }, URLSearchParams };
vm.createContext(ctx);
vm.runInContext(names.map((n) => extractFunction(SRC, n)).join("\n") + "\n;globalThis.__geo = { geoOn, geoOverlap, geoFreeSlot, geoRanks, geoTidyPositions, geoClearPack, geoFitInputs };", ctx);
const G = ctx.__geo;
const box = (id, x, y, w, h) => ({ id, x, y, w, h });

ok(G.geoTidyPositions([], [], 48, 28).length === 0, "tidy of an empty selection is []");
ok(G.geoTidyPositions([box("a", 0, 0, 100, 40)], [], 48, 28).length === 0, "tidy of a single node is [] (no invented move)");
ok(G.geoTidyPositions(null, [], 48, 28).length === 0, "tidy of null nodes is []");

{
  const ranked = G.geoRanks(["a", "b"], [
    { from: { node: "a" }, to: { node: "a" } },
    { from: { node: "z" }, to: { node: "a" } },
    { from: {}, to: { node: "b" } },
    { from: { node: "a" }, to: {} },
  ]);
  ok(ranked.depth.a === 0 && ranked.depth.b === 0 && ranked.spread === false,
    "self-loop / foreign / missing ends are skipped, got " + JSON.stringify(ranked));
}

{
  const t0 = Date.now();
  const ranked = G.geoRanks(["a", "b"], [
    { from: { node: "a" }, to: { node: "b" } },
    { from: { node: "b" }, to: { node: "a" } },
  ]);
  ok(Date.now() - t0 < 200, "a two-node cycle must not hang");
  ok(ranked.depth.a === 0 && ranked.depth.b === 0 && ranked.spread === false,
    "a cycle still returns depth 0 rather than leaving nodes unranked, got " + JSON.stringify(ranked));
}

{
  const a = box("a", 0, 0, 10, 10), b = box("b", 10, 0, 10, 10);
  ok(G.geoOverlap(a, b, 0) === false, "touching edges without a gap is not an overlap");
  ok(G.geoOverlap(a, b, 1) === true, "a 1px gap treats touching cards as overlapping");
  ok(G.geoOverlap(a, a, 0) === true, "a box overlaps itself");
}

{
  const anchor = box("a", 0, 0, 10, 10);
  const size = { w: 10, h: 10 };
  const gap = 0;
  const dir = 1;
  const baseX = anchor.x + anchor.w + gap, baseY = anchor.y;
  const stepX = size.w + gap, stepY = size.h + gap;
  const obstacles = [anchor];
  for (let col = 0; col < 14; col++) {
    const x = Math.round(baseX + dir * col * stepX);
    for (let row = 0; row < 10; row++) {
      const yOff = row === 0 ? 0 : (row % 2 ? (row + 1) / 2 : -(row / 2));
      obstacles.push({ x, y: Math.round(baseY + yOff * stepY), w: size.w, h: size.h });
    }
  }
  const slot = G.geoFreeSlot(anchor, size, obstacles, gap, 1);
  ok(slot.x === Math.round(baseX) && slot.y === Math.round(baseY),
    "a full 14×10 grid falls back to the first cell, got " + JSON.stringify(slot));
}

{
  const positions = [{ id: "a", x: 4, y: 8 }];
  ok(G.geoClearPack(positions, { a: { w: 10, h: 10 } }, [], 36) === positions,
    "clearPack with no obstacles returns the same array");
  ok(G.geoClearPack(positions, { a: { w: 10, h: 10 } }, null, 36) === positions,
    "clearPack with null obstacles returns the same array");
  const empty = G.geoClearPack([], { a: { w: 10, h: 10 } }, [box("z", 0, 0, 10, 10)], 36);
  ok(Array.isArray(empty) && empty.length === 0, "clearPack of an empty pack is []");
  const skipped = G.geoClearPack([{ id: "ghost", x: 0, y: 0 }], {}, [box("z", 0, 0, 10, 10)], 36);
  ok(skipped[0].x === 0 && skipped[0].y === 0, "a position with no size is skipped rather than thrown");
}

{
  const live = G.geoFitInputs([
    { name: "prompt", field: true, disabled: true },
    { name: "system", field: true },
  ]);
  ok(live.length === 1 && live[0].name === "system",
    "a disabled prompt is not the auto-wire target, got " + JSON.stringify(live));
  const none = G.geoFitInputs(null);
  ok(Array.isArray(none) && none.length === 0, "geoFitInputs(null) is []");
}

{
  ctx.location = { get search() { throw new Error("no search"); } };
  ctx.localStorage.getItem = () => null;
  ok(G.geoOn() === true, "a throwing location.search keeps layout on");
  ctx.location = { search: "" };
  ctx.localStorage.getItem = () => { throw new Error("no storage"); };
  ok(G.geoOn() === true, "a throwing localStorage keeps layout on");
  ctx.localStorage.getItem = () => null;
}

if (failures.length) {
  console.error("✗ layout-edges: " + failures.length + " failure(s)\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log("✓ layout-edges: tidy empty/single, cycle, overlap gap, full-grid fallback, geoOn throws");
