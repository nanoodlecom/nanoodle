#!/usr/bin/env node
// Pins the 🧩 UX auto-layout section of index.html — the deterministic
// layered engine (Sugiyama-style barycenter ordering + feasibility
// projection) that Describe changes runs over the applied graph before it
// lands on the canvas. Chosen by a fresh-Jev exam on held-out graphs
// (layered 0.582 vs editor tidy 0.555 vs originals 0.435); the trained
// GNN/picker variants never beat it by a real margin, so the engine is
// weight-free — no fetch, nothing to go stale.
//
// The section is lifted out of index.html as text and run in a vm sandbox,
// so we exercise the exact shipped code — no browser, no network.
//
// Invariants pinned:
//   1. UNPILE — a piled-up chain comes back arranged: zero card overlaps and
//      every wire flowing left → right.
//   2. STABLE — arranging an already-arranged graph keeps it valid
//      (zero overlaps, left → right flow).
//   3. DEGENERATE — <2 nodes and >600 nodes are no-ops; the hook never throws.
//   4. DETERMINISM — the same graph gives the same positions twice.
//   5. FINITE — every written position is a finite number.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function liftSection(src) {
  const a = src.indexOf("/* UX-LAYOUT-BEGIN */");
  const b = src.indexOf("/* UX-LAYOUT-END */");
  if (a < 0 || b < 0 || b <= a) throw new Error("UX-LAYOUT markers not found in index.html");
  return src.slice(a, b);
}

function buildSandbox() {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function messyChain() {
  const types = ["text", "llm", "image", "vision", "edit", "join", "tts", "decide", "music", "endpoint"];
  const nodes = [], links = [];
  let prev = null;
  for (let i = 0; i < 10; i++) {
    const id = "n" + (i + 1);
    nodes.push({ id, type: types[i], x: 500 + ((i * 137) % 80) - 40, y: 300 + ((i * 89) % 70) - 35,
                 fields: { prompt: "x".repeat(40) } });
    if (prev) links.push({ id: "l" + i, from: { node: prev, port: "out" }, to: { node: id, port: "in" } });
    prev = id;
  }
  return { v: 1, nodes, links };
}

function assertArranged(sandbox, g, label, failures) {
  const lg = sandbox.window.__uxToLayoutGraph(g);
  let overlaps = 0;
  for (let i = 0; i < lg.nodes.length; i++) for (let j = i + 1; j < lg.nodes.length; j++) {
    const a = lg.nodes[i], b = lg.nodes[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox > 0 && oy > 0) overlaps++;
  }
  if (overlaps) failures.push(`${label}: ${overlaps} overlapping card pairs after arrange`);
  const byId = Object.fromEntries(lg.nodes.map((n) => [n.id, n]));
  for (const l of lg.links) {
    const a = byId[l.from], b = byId[l.to];
    if (!(b.x + b.w / 2 > a.x + a.w / 2)) failures.push(`${label}: wire ${l.from}→${l.to} does not flow right`);
  }
  for (const n of g.nodes) {
    if (!isFinite(n.x) || !isFinite(n.y)) failures.push(`${label}: non-finite position on ${n.id}`);
  }
}

async function run() {
  const failures = [];
  const src = readFileSync(join(ROOT, "index.html"), "utf8");
  const section = liftSection(src);

  // 1 + 4 + 5: unpile, determinism, finite.
  const runs = [];
  for (let k = 0; k < 2; k++) {
    const sandbox = buildSandbox();
    vm.runInContext(section, sandbox);
    const g = messyChain();
    const ok = await sandbox.window.arrangeUxLayout(g);
    if (ok !== true) failures.push(`run ${k}: arrangeUxLayout did not arrange a messy chain`);
    assertArranged(sandbox, g, `run ${k}`, failures);
    runs.push(JSON.stringify(g.nodes.map((n) => [n.id, n.x, n.y])));
  }
  if (runs[0] !== runs[1]) failures.push("arrange is not deterministic across runs");

  // 2: stability — a second arrange of the arranged graph stays valid.
  {
    const sandbox = buildSandbox();
    vm.runInContext(section, sandbox);
    const g = messyChain();
    await sandbox.window.arrangeUxLayout(g);
    const ok = await sandbox.window.arrangeUxLayout(g);
    if (ok !== true) failures.push("second arrange: should still arrange");
    assertArranged(sandbox, g, "second arrange", failures);
  }

  // 3: degenerate graphs are no-ops and never throw.
  {
    const sandbox = buildSandbox();
    vm.runInContext(section, sandbox);
    const one = { v: 1, nodes: [{ id: "a", type: "text", x: 5, y: 6, fields: {} }], links: [] };
    if (await sandbox.window.arrangeUxLayout(one) !== false) failures.push("single node: should be a no-op");
    if (one.nodes[0].x !== 5 || one.nodes[0].y !== 6) failures.push("single node: position changed");
    if (await sandbox.window.arrangeUxLayout(null) !== false) failures.push("null graph: should be a no-op");
    if (await sandbox.window.arrangeUxLayout({}) !== false) failures.push("empty graph: should be a no-op");
    const big = { v: 1, nodes: [], links: [] };
    for (let i = 0; i < 601; i++) big.nodes.push({ id: "b" + i, type: "text", x: i, y: i, fields: {} });
    if (await sandbox.window.arrangeUxLayout(big) !== false) failures.push("601 nodes: should be a no-op (cap)");
  }

  return failures;
}

run().then((failures) => {
  if (failures.length) {
    process.stderr.write("✗ the UX auto-layout hook is broken:\n\n- " + failures.join("\n- ") + "\n");
    process.exit(1);
  }
  process.stdout.write("✓ UX auto-layout holds (unpile, left→right flow, stability, degenerate, determinism, finite).\n");
}).catch((e) => {
  process.stderr.write("✗ check-ux-layout harness error: " + (e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
