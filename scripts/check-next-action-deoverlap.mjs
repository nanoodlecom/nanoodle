#!/usr/bin/env node
/**
 * Adding a node that lands on top of another slides them apart.
 * A clear landing does not move anything. The slide shares the add's undo.
 */
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { proposeTidyDeltas, minPairGap as tidyGap } from "../vendor/next-action/auto-tidy.mjs";
import { countOverlaps, resolveCollisions } from "../vendor/next-action/collision-nudge.mjs";
import { planDeoverlap } from "../vendor/next-action/deoverlap.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`✗ next-action-deoverlap: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

// Read complete shipped functions, without a character window that changes
// when an add path grows. Ignore braces in comments, strings and templates.
function extractFunction(src, name) {
  const match = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{").exec(src);
  assert(match, "missing editor function " + name);
  const open = src.indexOf("{", match.index);
  let depth = 0, mode = "code";
  const templates = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i++; }
      else if (c === "/" && n === "*") { mode = "block"; i++; }
      else if (c === "'") mode = "single";
      else if (c === '"') mode = "double";
      else if (c === "`") mode = "template";
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (templates.length && depth === templates.at(-1)) { templates.pop(); mode = "template"; }
        else if (depth === 0) return src.slice(match.index, i + 1);
      }
    } else if (mode === "line") { if (c === "\n") mode = "code"; }
    else if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i++; } }
    else if (mode === "single" || mode === "double") {
      if (c === "\\") i++;
      else if (c === (mode === "single" ? "'" : '"')) mode = "code";
    } else if (mode === "template") {
      if (c === "\\") i++;
      else if (c === "`") mode = "code";
      else if (c === "$" && n === "{") { mode = "code"; templates.push(depth); depth++; i++; }
    }
  }
  fail("unbalanced editor function " + name);
}

// Drive the real separator and both add handlers. addNode's stub snapshots as
// the real helper does, so this supports both plain adds and grouped menu edits.
function editorHarness(functions, overlapping = false) {
  const events = [], snapshots = [];
  const node = (id, type = "text") => ({ id, type, x:100, y:100, w:220, h:160,
    el:{ offsetWidth:220, offsetHeight:160, style:{}, querySelectorAll:() => [] } });
  const ctx = {
    graph:{ nodes:overlapping ? [node("a"), node("b")] : [node("a")], links:[] },
    undoMuted:false, selected:null, scale:1, panX:0, panY:0, spawnN:0, deoverlapFrame:0,
    editor:{ clientWidth:1200, clientHeight:900 }, planDeoverlap,
    pushUndo() { if (!ctx.undoMuted) snapshots.push(ctx.graph.nodes.map(n => ({ id:n.id, x:n.x, y:n.y }))); },
    addNode(type) { ctx.pushUndo(); events.push("add"); const n = node("new", type); ctx.graph.nodes.push(n); return n; },
    byId:id => ctx.graph.nodes.find(n => n.id === id),
    geoOn:() => false, spawnFirstSeat:() => null, matchMedia:() => ({ matches:true }),
    save() {}, redraw() {}, select() {}, dismissHint() {}, rememberAdd() {},
  };
  vm.createContext(ctx);
  new vm.Script(functions.join("\n"), { filename:"index.html#deoverlap" }).runInContext(ctx);
  const separate = ctx.separateOnAdd;
  ctx.separateOnAdd = n => { events.push("separate"); separate(n); };
  return { ctx, events, snapshots };
}

{
  const graph = {
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, w: 220, h: 160 },
      { id: "b", type: "llm", x: 800, y: 600, w: 220, h: 200 },
    ],
  };
  assert(countOverlaps(graph) === 0, "distant nodes are not an overlap");
  const plan = planDeoverlap(graph, { addedId: "b" });
  assert(plan.positions.length === 0 && plan.movedIds.length === 0, "no overlap means nothing moves");
}

{
  const graph = {
    nodes: [
      { id: "a", type: "text", x: 100, y: 100 },
      { id: "b", type: "image", x: 100, y: 100 },
    ],
  };
  const deltas = proposeTidyDeltas(graph, "b");
  assert(deltas.length === 1 && deltas[0].id === "a", "tidy moves the neighbour, not the new node");
  assert(Math.hypot(deltas[0].dx, deltas[0].dy) <= 96, "tidy nudge is clamped");
  assert(tidyGap(graph, deltas) > tidyGap(graph, []), "tidy opens air between the pair");
}

{
  const graph = {
    nodes: [
      { id: "a", type: "text", x: 40, y: 40, w: 240, h: 180 },
      { id: "b", type: "llm", x: 70, y: 60, w: 260, h: 220 },
    ],
  };
  assert(countOverlaps(graph) > 0, "stacked cards overlap");
  const resolved = resolveCollisions(graph, { maxPasses: 14 });
  assert(resolved.positions.length > 0, "collision nudge proposes a slide");
  assert(resolved.cleared, "multi-pass nudge clears the stack");
  const plan = planDeoverlap(graph, { addedId: "b" });
  assert(plan.positions.length > 0, "deoverlap moves a stacked add");
  assert(!plan.positions.some((p) => !graph.nodes.find((n) => n.id === p.id)), "only existing nodes move");
  const after = {
    nodes: graph.nodes.map((n) => {
      const p = plan.positions.find((q) => q.id === n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
  };
  assert(countOverlaps(after) === 0, "the combined plan clears measured overlap");
}

{
  const index = readFileSync(join(ROOT, "index.html"), "utf8");
  const tidy = readFileSync(join(ROOT, "vendor/next-action/auto-tidy.mjs"), "utf8");
  const nudge = readFileSync(join(ROOT, "vendor/next-action/collision-nudge.mjs"), "utf8");
  const functions = ["separateOnAdd", "spawnCenter", "quickSpawn"].map(name => extractFunction(index, name));
  const slide = editorHarness(functions, true);
  slide.ctx.separateOnAdd(slide.ctx.graph.nodes[1]);
  assert(countOverlaps(slide.ctx.graph) === 0, "the shipped separator clears measured overlap");
  assert(slide.snapshots.length === 0, "the slide does not open its own undo step");
  const clear = editorHarness(functions, true);
  clear.ctx.graph.nodes[1].x = 800; clear.ctx.graph.nodes[1].y = 600;
  const before = clear.ctx.graph.nodes.map(n => [n.x, n.y]);
  clear.ctx.separateOnAdd(clear.ctx.graph.nodes[1]);
  assert(JSON.stringify(clear.ctx.graph.nodes.map(n => [n.x, n.y])) === JSON.stringify(before) && clear.snapshots.length === 0, "the shipped separator leaves a clear landing untouched");
  for (const path of ["spawnCenter", "quickSpawn"]) {
    const h = editorHarness(functions);
    if (path === "spawnCenter") h.ctx.spawnCenter("image");
    else h.ctx.quickSpawn("image", 400, 300, "out", "text", { dataset:{ node:"a", port:"text" } });
    assert(h.events.join(",") === "add,separate", path + " separates after creating the node");
    assert(countOverlaps(h.ctx.graph) === 0, path + " clears the overlapping add");
    assert(h.snapshots.length === 1 && h.snapshots[0].length === 1, path + " shares one pre-add snapshot with the slide");
    assert(h.ctx.undoMuted === false, path + " restores normal undo recording");
  }
  assert(!tidy.includes("na-panel") && !nudge.includes("placeGhost"), "no panel or ghost");
  assert(!index.includes("Mess up") && !index.includes("Scramble"), "no demo scramble button");
}

console.log("✓ next-action-deoverlap: overlap slides apart, a clear landing stays put, undo stays with the add");
