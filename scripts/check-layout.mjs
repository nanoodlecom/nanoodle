#!/usr/bin/env node
// Layout engine: free slot on add, tidy on a multi-selection.
// Pure geometry is lifted out of index.html and run here. No browser, no network.
// Also pins the editor hooks: real connect() path, the existing context menu,
// Shift+T, and the ?product=off kill switch. No debug panel, no Mess/Scramble.

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
const srcFns = names.map((n) => extractFunction(SRC, n)).join("\n");
const ctx = { location: { search: "" }, localStorage: { getItem: () => null }, URLSearchParams };
vm.createContext(ctx);
vm.runInContext(srcFns + "\n;globalThis.__geo = { geoOn, geoOverlap, geoFreeSlot, geoRanks, geoTidyPositions, geoClearPack, geoFitInputs };", ctx);
const G = ctx.__geo;

const box = (id, x, y, w, h) => ({ id, x, y, w, h });
const overlapAny = (rect, list, gap) => list.some((o) => G.geoOverlap(rect, o, gap));

// --- free slot: immediately to the right when that cell is empty ---
{
  const anchor = box("a", 0, 10, 200, 120);
  const size = { w: 180, h: 100 };
  const slot = G.geoFreeSlot(anchor, size, [anchor], 36, 1);
  ok(slot.x === 200 + 36 && slot.y === 10, "free slot sits just right of the anchor, got " + JSON.stringify(slot));
  ok(!G.geoOverlap({ ...slot, w: size.w, h: size.h }, anchor, 36), "free slot must not overlap the anchor");
}

// --- free slot: the near cell is taken, so the next cell to the right is used ---
{
  const anchor = box("a", 0, 0, 200, 100);
  const size = { w: 200, h: 100 };
  const blocker = box("b", 236, 0, 200, 100);
  const slot = G.geoFreeSlot(anchor, size, [anchor, blocker], 36, 1);
  const rect = { ...slot, w: size.w, h: size.h };
  ok(!overlapAny(rect, [anchor, blocker], 36), "blocked near-slot must resolve to a non-overlapping cell, got " + JSON.stringify(slot));
  ok(slot.x > anchor.x, "resolved slot stays to the right of the anchor");
}

// --- free slot to the left when the new node is the source ---
{
  const anchor = box("t", 400, 40, 220, 140);
  const size = { w: 200, h: 100 };
  const slot = G.geoFreeSlot(anchor, size, [anchor], 36, -1);
  ok(slot.x + size.w + 36 <= anchor.x + 0.5, "upstream slot sits left of the anchor, got " + JSON.stringify(slot));
  ok(!G.geoOverlap({ ...slot, w: size.w, h: size.h }, anchor, 36), "left slot must not overlap");
}

// --- tidy: a piled chain becomes a top-aligned left-to-right row, source left of target ---
{
  const nodes = [
    box("t", 40, 40, 200, 80),
    box("l", 48, 50, 220, 140),
    box("i", 30, 36, 200, 120),
  ];
  const links = [
    { from: { node: "t", port: "text" }, to: { node: "l", port: "prompt" } },
    { from: { node: "l", port: "text" }, to: { node: "i", port: "prompt" } },
  ];
  const pos = G.geoTidyPositions(nodes, links, 48, 28);
  const by = Object.fromEntries(pos.map((p) => [p.id, p]));
  ok(pos.length === 3, "tidy returns every selected node");
  ok(by.t.x < by.l.x && by.l.x < by.i.x, "data flow runs left to right, got " + JSON.stringify(pos));
  ok(by.t.y === by.l.y && by.l.y === by.i.y, "a single chain is one top-aligned row");
  const gap1 = by.l.x - (by.t.x + 200);
  const gap2 = by.i.x - (by.l.x + 220);
  ok(gap1 === 48 && gap2 === 48, "row gaps are even, got " + gap1 + " and " + gap2);
  const sized = pos.map((p) => ({ ...p, w: nodes.find((n) => n.id === p.id).w, h: nodes.find((n) => n.id === p.id).h }));
  let hit = false;
  for (let i = 0; i < sized.length; i++) for (let j = i + 1; j < sized.length; j++) if (G.geoOverlap(sized[i], sized[j], 0)) hit = true;
  ok(!hit, "tidy row does not overlap itself");
}

// --- tidy: a branch stacks in the target column, sorted by upstream order ---
{
  const nodes = [
    { ...box("s", 0, 0, 100, 40), orderY: 0 },
    { ...box("a", 10, 200, 100, 40), orderY: 80 },
    { ...box("b", 12, 10, 100, 40), orderY: 20 },
  ];
  const links = [
    { from: { node: "s" }, to: { node: "a" } },
    { from: { node: "s" }, to: { node: "b" } },
  ];
  const pos = G.geoTidyPositions(nodes, links, 40, 16);
  const by = Object.fromEntries(pos.map((p) => [p.id, p]));
  ok(by.s.x < by.a.x && by.s.x < by.b.x, "source stays left of both targets");
  ok(by.a.x === by.b.x, "siblings share a column");
  ok(by.b.y < by.a.y, "column sorts by the source order key (b's orderY is above a)");
}

// --- tidy: an unwired pile becomes one row, and non-selected ids are absent ---
{
  const nodes = [box("a", 5, 5, 80, 40), box("b", 8, 9, 80, 40), box("c", 6, 7, 90, 40)];
  const pos = G.geoTidyPositions(nodes, [], 20, 10);
  ok(pos.length === 3 && pos.every((p, i) => i === 0 || p.x > pos[i - 1].x), "unwired pile becomes a left-to-right row");
  ok(pos.every((p) => p.y === pos[0].y), "unwired row is top-aligned");
  ok(!pos.some((p) => p.id === "z"), "tidy does not invent nodes");
}

// --- clear pack shifts off an obstacle without moving the obstacle ---
{
  const positions = [{ id: "a", x: 0, y: 0 }];
  const sizes = { a: { w: 100, h: 40 } };
  const obstacles = [box("z", 0, 0, 100, 40)];
  const moved = G.geoClearPack(positions, sizes, obstacles, 36);
  ok(moved[0].x !== 0 || moved[0].y !== 0, "pack leaves an occupied cell");
  ok(!G.geoOverlap({ x: moved[0].x, y: moved[0].y, w: 100, h: 40 }, obstacles[0], 36), "cleared pack does not overlap the obstacle");
  ok(obstacles[0].x === 0 && obstacles[0].y === 0, "clearing the pack does not move the obstacle");
}

// --- exactly one compatible port: prompt wins over an optional companion field ---
{
  const llm = G.geoFitInputs([
    { name: "system", field: true },
    { name: "prompt", field: true },
  ]);
  ok(llm.length === 1 && llm[0].name === "prompt", "LLM text fits only the prompt port, got " + JSON.stringify(llm));
  const join = G.geoFitInputs([
    { name: "a", field: false },
    { name: "b", field: false },
  ]);
  ok(join.length === 2, "two static inputs are not auto-picked");
  const taken = G.geoFitInputs([{ name: "prompt", field: true, filled: true }]);
  ok(taken.length === 0, "a filled prompt does not fit");
}

// --- product=off / na=0 disables the engine ---
{
  ctx.location.search = "?product=off";
  ok(G.geoOn() === false, "product=off disables layout");
  ctx.location.search = "?na=0";
  ok(G.geoOn() === false, "na=0 disables layout");
  ctx.location.search = "";
  ctx.localStorage.getItem = (k) => (k === "nano.nextAction" ? "off" : null);
  ok(G.geoOn() === false, "nano.nextAction=off disables layout");
  ctx.localStorage.getItem = () => null;
  ctx.location.search = "";
  ok(G.geoOn() === true, "layout is on by default");
}

// --- editor surface pins (the real menus, not a panel) ---
ok(SRC.includes('id="selmenu"') && SRC.includes(">Tidy selection<"), "tidy lives in the selection context menu");
ok(SRC.includes('e.code==="KeyT"') && SRC.includes("geoTidySelection()"), "Shift+T tidies the selection");
ok(SRC.includes("geoSettleNew(n, { dir:dir, type:type, originPort:originPort"), "wire-drop add uses the layout slot");
ok(SRC.includes('geoSettleNew(n, { dir:"out", anchor:placeAnchor })'), "Add-node menu uses the layout slot");
ok(SRC.includes("connect(origin.dataset.node, origin.dataset.port, target.el.dataset.node, target.el.dataset.port)"), "auto-wire goes through connect()");
ok(!/Mess selection|Mess up|Scramble/.test(SRC), "no Mess/Scramble controls");
ok(!SRC.includes('id="na-panel"') && !SRC.includes("na-ghost"), "no next-action debug panel or ghost");
ok(SRC.includes("requestAnimationFrame(step)") && !/setInterval\(/.test(SRC.slice(SRC.indexOf("function geoEnter"), SRC.indexOf("function geoSettleNew"))), "entrance animation is a bounded rAF, not an interval");

if (failures.length) {
  console.error("✗ layout: " + failures.length + " failure(s)\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log("✓ layout: free slot, tidy row/columns, one-port wire, product=off, menu + Shift+T");
