#!/usr/bin/env node
/**
 * Leftover #621 edges: dragging FROM an input ranks producers (dir=in),
 * a self target is skipped, a missing query stays quiet, and the menu
 * never lists more than three types. The editor pin follows the ring on
 * main: portHighlightQuery forwards the socket dir into rankRingTargets,
 * and the wire-drop query forwards the origin dir into rankDropTypes.
 */
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  rankDropTypes,
  pickRingTarget,
  danglingPorts,
  MAX_TYPES,
} from "../vendor/next-action/port-suggest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`✗ next-action-port-dir: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const tables = {
  topTargets: {
    "text|text": { "llm|prompt": 8, "image|prompt": 2 },
    "image|image": { "llm|img1": 5, "edit|image": 2 },
    "llm|text": { "image|prompt": 3 },
  },
  portCatalog: {
    text: { inputs: [], outputs: ["text"] },
    llm: { inputs: ["prompt", "img1"], outputs: ["text"] },
    image: { inputs: ["prompt"], outputs: ["image"] },
    edit: { inputs: ["image"], outputs: ["image"] },
    comment: { inputs: ["text"], outputs: ["text"] },
  },
};

{
  const ranked = rankDropTypes(tables, {
    dir: "in",
    srcType: "llm",
    srcPort: "prompt",
    candidates: [
      { type: "text", ports: [{ name: "text" }] },
      { type: "image", ports: [{ name: "image" }] },
    ],
  });
  assert(ranked && ranked.order[0] === "text", `dir=in on llm.prompt should rank text first, got ${ranked && ranked.order}`);
  assert(ranked.byType.text.port === "text", "the producer port is text.out");
}

{
  const ring = pickRingTarget(tables, {
    dir: "in",
    srcType: "llm",
    srcPort: "prompt",
    srcNodeId: "l1",
    targets: [
      { nodeId: "l1", type: "text", port: "text" },
      { nodeId: "t1", type: "text", port: "text" },
      { nodeId: "i1", type: "image", port: "image" },
    ],
  });
  assert(ring && ring.nodeId === "t1" && ring.port === "text", `ring dir=in should skip self and pick text, got ${JSON.stringify(ring)}`);
}

{
  assert(rankDropTypes(null, { dir: "out", srcType: "text", srcPort: "text", candidates: [{ type: "llm", ports: [{ name: "prompt" }] }] }) === null, "missing tables stay quiet");
  assert(rankDropTypes({}, { dir: "out", srcType: "text", srcPort: "text", candidates: [{ type: "llm", ports: [{ name: "prompt" }] }] }) === null, "tables without topTargets stay quiet");
  assert(rankDropTypes(tables, {}) === null, "an empty query stays quiet");
  assert(rankDropTypes(tables, { dir: "out", srcType: "text", candidates: [{ type: "llm", ports: [{ name: "prompt" }] }] }) === null, "missing srcPort stays quiet");
  assert(pickRingTarget(tables, { dir: "out", srcType: "text", srcPort: "text", targets: [] }) === null, "no ring targets stays quiet");
}

{
  const many = {
    topTargets: {
      "text|text": {
        "image|prompt": 135,
        "llm|prompt": 100,
        "join|a": 100,
        "ivideo|prompt": 100,
        "music|prompt": 100,
      },
    },
  };
  const ranked = rankDropTypes(many, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    candidates: [
      { type: "image", ports: [{ name: "prompt" }] },
      { type: "llm", ports: [{ name: "prompt" }] },
      { type: "join", ports: [{ name: "a" }] },
      { type: "ivideo", ports: [{ name: "prompt" }] },
      { type: "music", ports: [{ name: "prompt" }] },
    ],
  });
  assert(ranked && ranked.order[0] === "image", `capped list should still lead with image, got ${ranked && ranked.order}`);
  assert(ranked.order.length === MAX_TYPES && MAX_TYPES === 3, `wire-drop lists at most 3 types, got ${ranked.order}`);
}

{
  const graph = {
    nodes: [
      { id: "c1", type: "comment" },
      { id: "t1", type: "text" },
    ],
    links: [],
  };
  const dang = danglingPorts(tables, graph);
  assert(!dang.outs.some((o) => o.nodeId === "c1") && !dang.ins.some((i) => i.nodeId === "c1"), "comments are not dangling ports");
  assert(dang.outs.some((o) => o.nodeId === "t1" && o.port === "text"), "a real text out is still dangling");
}

function sliceBetween(source, startMark, endMark) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark, start < 0 ? 0 : start + startMark.length);
  assert(start >= 0 && end > start, `missing ${startMark} … ${endMark}`);
  return source.slice(start, end);
}

{
  const index = readFileSync(join(ROOT, "index.html"), "utf8");
  // Product · 21: the drag ring is portHighlightQuery → na.rankRingTargets.
  // dir is the live socket direction, in or out.
  const ringQuery = sliceBetween(index, "function portHighlightQuery(", "function portWouldCycle(");
  const ringCall = sliceBetween(index, "function applyPortHighlight(", "function markLikelyPort(");
  assert(
    ringQuery.includes("dir: anchor.dataset.dir") &&
      ringCall.includes("na.rankRingTargets(portHighlightQuery(targets, anchor))"),
    "the drag ring forwards the socket dir (in or out)"
  );
  const drop = sliceBetween(index, "function wireDropHintMap(", "function openQuickAdd(");
  const queryAt = drop.indexOf("const query = {");
  const queryLit = queryAt < 0 ? "" : drop.slice(queryAt, queryAt + 80);
  assert(
    drop.includes("const dir = originPort.dataset.dir") &&
      queryLit.includes("dir,") &&
      drop.includes("na.rankDropTypes(query)"),
    "the wire-drop menu forwards the origin dir"
  );
}

console.log("✓ next-action-port-dir: inbound ranks producers, self is skipped, a missing query stays quiet");
