#!/usr/bin/env node
/**
 * Leftover encode / sketch edges after #590 (Product · 2).
 *
 * check-next-action-schema.mjs pins the happy-path length + one two-node
 * sketch. A notes-only canvas, an unknown type, a missing selectedId, or a
 * history token the vocab dropped must not throw or flip emptyCanvas — those
 * poison every in-list hint (productMode defaults to 1).
 *
 * Offline. No browser, no network, no weights.
 */
import {
  ACTION_VOCAB,
  K,
  NODE_TYPES,
  encodeState,
  inputSize,
  schema,
  sketchFromGraph,
} from "../vendor/next-action/encode.mjs";

function fail(msg) {
  console.error(`✗ next-action-sketch: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const cap = schema.encode.countNormCap || 8;
const V = ACTION_VOCAB.length;
const T = NODE_TYPES.length;
const emptyCanvasAt = K * V + T + 4; // after numNodes, numLinks, danglingOut, danglingIn
const selectedAt = K * V + T + 5;

assert(NODE_TYPES.includes("comment"), "comment is a sketch type");
assert(K === 3, `K must stay 3, got ${K}`);
assert(inputSize() === K * V + T + 5 + T, "inputSize formula");

{
  const sk = sketchFromGraph({
    nodes: [
      { id: "c1", type: "comment" },
      { id: "c2", type: "comment" },
    ],
    links: [],
    selectedId: "c1",
  });
  assert(sk.numNodes === 0, `notes-only canvas must be empty (numNodes), got ${sk.numNodes}`);
  assert(sk.danglingOut === 0 && sk.danglingIn === 0, "comments must not count as dangling");
  assert(sk.nodeTypeCounts.comment === 2, "comment counts still record the notes");
  assert(sk.selectedType === "comment", "selecting a comment sets selectedType");
  const x = encodeState([], sk);
  assert(x[emptyCanvasAt] === 1, "notes-only canvas must still set emptyCanvas (cold-start tips)");
}

{
  const sk = sketchFromGraph({
    nodes: [
      { id: "t1", type: "text" },
      { id: "z1", type: "frobnicate" },
    ],
    links: [],
  });
  assert(sk.numNodes === 2, "unknown types still count as nodes (not comments)");
  assert(sk.nodeTypeCounts.frobnicate == null, "unknown type is not a vocab bucket");
  assert(sk.nodeTypeCounts.text === 1, "known type still counted");
  assert(sk.danglingOut === 2 && sk.danglingIn === 2, "unknown nodes participate in dangling");
}

{
  const sk = sketchFromGraph({
    nodes: [{ id: "t1", type: "text" }],
    links: [],
    selectedId: "gone",
  });
  assert(sk.selectedType === null, "missing selectedId must not invent a type");
  const x = encodeState([], sk);
  let selSum = 0;
  for (let i = 0; i < T; i++) selSum += x[selectedAt + i];
  assert(selSum === 0, "no selected one-hot when the id is gone");
}

{
  const sk = sketchFromGraph({
    nodes: [
      { id: "a", type: "text" },
      { id: "b", type: "image" },
      { id: "c", type: "comment" },
    ],
    links: [
      { from: { node: "a" }, to: { node: "b" } },
      { from: {}, to: { node: "b" } },
      { from: { node: "a" }, to: {} },
    ],
  });
  assert(sk.numLinks === 3, "sketch counts raw links (broken ones still occupy a slot)");
  // text→image is one-way: image has no out, text has no in. The comment must
  // not add a second dangling of either kind, and a link missing from/to.node
  // must not throw.
  assert(sk.danglingOut === 1, `image is the only danglingOut, got ${sk.danglingOut}`);
  assert(sk.danglingIn === 1, `text is the only danglingIn, got ${sk.danglingIn}`);
}

{
  const long = ["add:text", "add:image", "set:model", "wire", "run"];
  const x = encodeState(long, { numNodes: 3 });
  assert(x.length === inputSize(), "over-K history still encodes to inputSize");
  const want = long.slice(-K);
  for (let s = 0; s < K; s++) {
    const tok = want[s];
    const ai = ACTION_VOCAB.indexOf(tok);
    let ones = 0;
    let hit = -1;
    for (let i = 0; i < V; i++) {
      if (x[s * V + i] === 1) {
        ones++;
        hit = i;
      }
    }
    assert(ones === 1 && hit === ai, `slot ${s} must be one-hot ${tok}`);
  }
}

{
  const x = encodeState(["not-a-token", "add:text"], { numNodes: 1 });
  // K=3, hist length 2 → one leading pad slot, then unknown, then add:text.
  let padOnes = 0;
  let unkOnes = 0;
  for (let i = 0; i < V; i++) {
    padOnes += x[i];
    unkOnes += x[V + i];
  }
  assert(padOnes === 0, "leading pad slot is zeros");
  assert(unkOnes === 0, "unknown history token must pad (no throw, no one-hot)");
  const textAt = ACTION_VOCAB.indexOf("add:text");
  assert(x[2 * V + textAt] === 1, "known token after an unknown still encodes in the last slot");
}

{
  const x = encodeState([], {
    numNodes: 20,
    numLinks: 20,
    nodeTypeCounts: { text: 20 },
  });
  const countsAt = K * V;
  const textI = NODE_TYPES.indexOf("text");
  assert(x[countsAt + textI] === 1, "type count must cap at countNormCap");
  assert(x[countsAt + T] === 1, "numNodes must cap at countNormCap");
  assert(x[countsAt + T + 1] === 1, "numLinks must cap at countNormCap");
  assert(x[emptyCanvasAt] === 0, "non-empty canvas clears emptyCanvas");
}

console.log(
  `✓ next-action-sketch: notes-only emptyCanvas, unknown-type dangling, missing selectedId, K-slice, unknown-hist pad, cap=${cap}`
);
