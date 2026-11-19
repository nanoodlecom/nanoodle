#!/usr/bin/env node
// Pins the 🧲 UX drop-nudge section of index.html — the deterministic drop
// solver wire-drag creation uses to settle a new node: the card lands
// near where the user let go, bystanders budge the minimum, and nothing
// overlaps. The section is lifted out of index.html as text and run in a
// vm sandbox, exercising the exact shipped code.
//
// Invariants pinned:
//   1. FREE DROP — a drop on open canvas lands within ~25px of the drop
//      point, zero overlaps, bystanders perfectly still.
//   2. HOSTILE DROP — a drop straight onto a card: the new node ends up
//      adjacent (not on top), zero overlaps, total bystander push small.
//   3. CLUSTER DROP — a drop into a dense cluster still ends with zero
//      overlaps and the new node within the solver's search radius.
//   4. DEGENERATE — empty canvas / missing added id returns null (the
//      caller falls back), never throws.
//   5. DETERMINISM — same input, same answer, twice.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function liftSection(src) {
  const a = src.indexOf("/* UX-NUDGE-BEGIN */");
  const b = src.indexOf("/* UX-NUDGE-END */");
  if (a < 0 || b < 0 || b <= a) throw new Error("UX-NUDGE markers not found in index.html");
  return src.slice(a, b);
}

function overlaps(boxes, pos) {
  let n = 0;
  const placed = boxes.map((b) => ({ ...b, x: pos[b.id][0], y: pos[b.id][1] }));
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], c = placed[j];
    const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
    const oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
    if (ox > 0 && oy > 0) n++;
  }
  return n;
}

function bystanderPush(boxes, pos, addedId) {
  let total = 0;
  for (const b of boxes) {
    if (b.id === addedId) continue;
    total += Math.hypot(pos[b.id][0] - b.x, pos[b.id][1] - b.y);
  }
  return total;
}

async function run() {
  const failures = [];
  const src = readFileSync(join(ROOT, "index.html"), "utf8");
  const section = liftSection(src);
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(section, sandbox);
  const settle = sandbox.window.nudgeSettle;
  if (typeof settle !== "function") failures.push("window.nudgeSettle missing after section load");

  const card = (id, x, y) => ({ id, x, y, w: 280, h: 180 });

  // 1: free drop near a neighbour.
  {
    const boxes = [card("a", 0, 0), card("b", 400, 0), { id: "new", x: 420, y: 300, w: 280, h: 180 }];
    const pos = settle(boxes, "new", [420, 300]);
    if (!pos) failures.push("free drop: solver returned null");
    else {
      const d = Math.hypot(pos.new[0] - 420, pos.new[1] - 300);
      if (d > 25) failures.push(`free drop: new node landed ${d.toFixed(0)}px from the drop point`);
      if (overlaps(boxes, pos)) failures.push("free drop: overlaps remain");
      if (bystanderPush(boxes, pos, "new") > 0.5) failures.push("free drop: bystanders moved on an open-canvas drop");
    }
  }

  // 2a: edge drop — the classic nudge. Drop overlapping a card's right
  // edge by a bit: the new node slides a few px, bystanders barely move.
  {
    const boxes = [card("a", 100, 100), card("b", 700, 100), { id: "new", x: 360, y: 110, w: 280, h: 180 }];
    const pos = settle(boxes, "new", [360, 110]);
    if (!pos) failures.push("edge drop: solver returned null");
    else {
      if (overlaps(boxes, pos)) failures.push("edge drop: overlaps remain");
      const d = Math.hypot(pos.new[0] - 360, pos.new[1] - 110);
      if (d > 70) failures.push(`edge drop: new node slid ${d.toFixed(0)}px for a 20px overlap (want a nudge)`);
      const push = bystanderPush(boxes, pos, "new");
      if (push > 70) failures.push(`edge drop: bystanders pushed ${push.toFixed(0)}px in total`);
    }
  }

  // 2b: dead-centre drop onto a card — no nudge can fix a full overlap;
  // the new node (still "in the user's hand") slides to the nearest free
  // slot instead of shoving an existing card across the canvas.
  {
    const boxes = [card("a", 100, 100), card("b", 500, 100), { id: "new", x: 110, y: 110, w: 280, h: 180 }];
    const pos = settle(boxes, "new", [110, 110]);
    if (!pos) failures.push("hostile drop: solver returned null");
    else {
      if (overlaps(boxes, pos)) failures.push("hostile drop: overlaps remain");
      const d = Math.hypot(pos.new[0] - 110, pos.new[1] - 110);
      if (d > 240) failures.push(`hostile drop: new node teleported ${d.toFixed(0)}px from the drop`);
      const push = bystanderPush(boxes, pos, "new");
      if (push > 90) failures.push(`hostile drop: bystanders pushed ${push.toFixed(0)}px in total (want a nudge, not a shove)`);
    }
  }

  // 3: cluster drop.
  {
    const boxes = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) boxes.push(card(`c${r}${c}`, c * 300, r * 200));
    boxes.push({ id: "new", x: 310, y: 210, w: 280, h: 180 });
    const pos = settle(boxes, "new", [310, 210]);
    if (!pos) failures.push("cluster drop: solver returned null");
    else {
      if (overlaps(boxes, pos)) failures.push("cluster drop: overlaps remain");
      const d = Math.hypot(pos.new[0] - 310, pos.new[1] - 210);
      if (d > 560) failures.push(`cluster drop: new node ended ${d.toFixed(0)}px from the drop (outside search radius)`);
    }
  }

  // 4: degenerate inputs fall back (null), never throw.
  {
    if (settle([], "new", [0, 0]) !== null) failures.push("empty boxes: should return null");
    if (settle([card("a", 0, 0)], "nope", [0, 0]) !== null) failures.push("missing added id: should return null");
    const solo = settle([{ id: "new", x: 5, y: 6, w: 280, h: 180 }], "new", [5, 6]);
    if (!solo || solo.new[0] !== 5 || solo.new[1] !== 6) failures.push("solo node: should stay exactly at the drop");
  }

  // 5: determinism.
  {
    const boxes = [card("a", 100, 100), card("b", 500, 100), { id: "new", x: 110, y: 110, w: 280, h: 180 }];
    const p1 = JSON.stringify(settle(boxes, "new", [110, 110]));
    const p2 = JSON.stringify(settle(boxes, "new", [110, 110]));
    if (p1 !== p2) failures.push("solver is not deterministic");
  }

  return failures;
}

run().then((failures) => {
  if (failures.length) {
    process.stderr.write("✗ the UX drop-nudge hook is broken:\n\n- " + failures.join("\n- ") + "\n");
    process.exit(1);
  }
  process.stdout.write("✓ UX drop-nudge holds (free drop honoured, hostile drop nudged, cluster resolved, degenerate fallback, determinism).\n");
}).catch((e) => {
  process.stderr.write("✗ check-drop-nudge harness error: " + (e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
