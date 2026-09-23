#!/usr/bin/env node
/**
 * Product · 4 — gallery-synth corpus present and schema-aligned.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_VOCAB } from "../vendor/next-action/encode.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corpusPath = join(ROOT, "vendor", "next-action", "corpus", "gallery-synth.json");

function fail(msg) {
  console.error(`✗ next-action-bake: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(corpusPath), "missing gallery-synth.json — run bake-next-action.mjs");
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
assert(corpus.schemaVersion === 1, "schemaVersion");
assert(corpus.exampleCount >= 100, `corpus too small: ${corpus.exampleCount}`);
assert(Array.isArray(corpus.examples) && corpus.examples.length === corpus.exampleCount, "examples length");
const sample = corpus.examples[0];
assert(sample && ACTION_VOCAB.includes(sample.nextAction), "sample nextAction in vocab");
assert(Array.isArray(sample.history), "sample history");
assert(sample.sketch && typeof sample.sketch.numNodes === "number", "sample sketch");
let bad = 0;
for (const ex of corpus.examples) {
  if (!ACTION_VOCAB.includes(ex.nextAction)) bad++;
}
assert(bad === 0, `${bad} examples with unknown nextAction`);

console.log(
  `✓ next-action-bake: examples=${corpus.exampleCount} graphs=${corpus.graphCount} label=${corpus.label}`
);
