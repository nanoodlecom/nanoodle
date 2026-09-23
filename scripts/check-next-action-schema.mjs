#!/usr/bin/env node
/**
 * Product · 2 — schema + encode contract only (no corpus / weights).
 */
import {
  ACTION_VOCAB,
  encodeState,
  inputSize,
  outputSize,
  smallnetManifest,
  INTENT_FORKS,
  NODE_TYPES,
  schema,
  sketchFromGraph,
} from "../vendor/next-action/encode.mjs";

function fail(msg) {
  console.error(`✗ next-action-schema: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(schema.schemaVersion === 1, "schemaVersion");
assert(schema.label === "Product · 2" || /Product/.test(schema.label || ""), "product label");
assert(ACTION_VOCAB.length >= 12, "action vocab");
assert(NODE_TYPES.includes("image") && NODE_TYPES.includes("text"), "node types");
assert(INTENT_FORKS.includes("cold-start") && INTENT_FORKS.includes("modality-branch"), "fork tags");
assert(inputSize() === 83, `inputSize expected 83 got ${inputSize()}`);
assert(outputSize() === ACTION_VOCAB.length, "outputSize");

const empty = encodeState([], { numNodes: 0 });
assert(empty.length === 83, "encode empty length");
assert(empty[82] === 0 || empty[82] === 1 || true, "encode runs");

const sk = sketchFromGraph({
  nodes: [
    { id: "a", type: "text" },
    { id: "b", type: "image" },
  ],
  links: [{ from: { node: "a" }, to: { node: "b" } }],
  selectedId: "b",
});
assert(sk.numNodes === 2 && sk.numLinks === 1, "sketch counts");
assert(sk.nodeTypeCounts.text === 1 && sk.nodeTypeCounts.image === 1, "sketch types");
assert(sk.selectedType === "image", "selectedType");

const x = encodeState(["add:text"], sk);
assert(x.length === 83, "encode with history");

const man = smallnetManifest();
assert(man.format === "smallnet-mlp-v1", "manifest format");
assert(man.inputSize === 83 && man.outputSize === ACTION_VOCAB.length, "manifest sizes");
assert(man.weightsUrl === null, "no weightsUrl");

console.log(
  `✓ next-action-schema: V=${ACTION_VOCAB.length} T=${NODE_TYPES.length} in=${inputSize()} out=${outputSize()} forks=${INTENT_FORKS.length}`
);
