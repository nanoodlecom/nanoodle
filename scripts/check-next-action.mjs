#!/usr/bin/env node
/**
 * Product · 1 checks: schema, frequency baseline, behavioral toys, smallnet
 * inline-weight integration. No .bin in git — loads fixtures/smoke-weights.json.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ACTION_VOCAB,
  encodeState,
  inputSize,
  outputSize,
  smallnetManifest,
  INTENT_FORKS,
  NODE_TYPES,
  schema,
} from "../vendor/next-action/encode.mjs";
import {
  recommendFrequency,
  evaluateFrequency,
  buildFrequencyTables,
} from "../vendor/next-action/frequency.mjs";
import { recommendNext, rankFromLogits } from "../vendor/next-action/recommend.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const SN = join(ROOT, "vendor", "smallnet");

function fail(msg) {
  console.error(`✗ next-action: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// --- no weight binaries committed ---
for (const f of walk(NA)) {
  if (f.endsWith(".bin")) fail(`weight file must not be committed: ${f}`);
}

// --- schema contract ---
assert(schema.schemaVersion === 1, "schemaVersion");
assert(ACTION_VOCAB.length >= 12, "action vocab");
assert(NODE_TYPES.includes("image") && NODE_TYPES.includes("text"), "node types");
assert(INTENT_FORKS.includes("cold-start") && INTENT_FORKS.includes("modality-branch"), "fork tags");
assert(inputSize() === 83, `inputSize expected 83 got ${inputSize()}`);
assert(outputSize() === ACTION_VOCAB.length, "outputSize");

const corpusPath = join(NA, "corpus", "gallery-synth.json");
const tablesPath = join(NA, "corpus", "frequency-tables.json");
assert(existsSync(corpusPath), "missing gallery-synth corpus — run bake-next-action.mjs");
assert(existsSync(tablesPath), "missing frequency-tables.json");

const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const tables = JSON.parse(readFileSync(tablesPath, "utf8"));
assert(corpus.exampleCount >= 100, `corpus too small: ${corpus.exampleCount}`);
assert(tables.total === corpus.exampleCount, "frequency total != exampleCount");

// Recompute tables matches
const rebuilt = buildFrequencyTables(corpus.examples);
assert(rebuilt.total === tables.total, "rebuild total mismatch");

const freqEval = evaluateFrequency(tables, corpus.examples);
assert(freqEval.top1 > 0.4, `frequency top1 too low: ${freqEval.top1}`);
assert(freqEval.top3 > 0.6, `frequency top3 too low: ${freqEval.top3}`);
const randomTop1 = 1 / ACTION_VOCAB.length;
assert(freqEval.top1 > randomTop1 * 3, "frequency must beat random by 3x");

// --- behavioral toys (frequency) ---
const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  const rec = recommendFrequency(tables, [], { numNodes: 0 }, 3);
  const actions = rec.map((r) => r.action);
  toy(
    "cold-start-first-node",
    actions.includes("add:text") || actions.includes("add:image"),
    `top=${actions.join(",")}`
  );
}
{
  const rec = recommendFrequency(tables, ["add:text"], { numNodes: 1, nodeTypeCounts: { text: 1 } }, 3);
  const actions = rec.map((r) => r.action);
  toy(
    "after-add-text",
    actions.some((a) => ["add:image", "add:llm", "add:text", "add:join", "add:tts"].includes(a)),
    `top=${actions.join(",")}`
  );
}
{
  const rec = recommendFrequency(
    tables,
    ["add:text", "add:image"],
    { numNodes: 2, nodeTypeCounts: { text: 1, image: 1 }, danglingOut: 1 },
    5
  );
  const actions = rec.map((r) => r.action);
  toy(
    "after-image-modality-branch",
    actions.some((a) => ["add:edit", "add:ivideo", "wire", "set:model", "add:resize"].includes(a)),
    `top=${actions.join(",")}`
  );
}
{
  const rec = recommendFrequency(tables, ["add:llm"], { numNodes: 2, nodeTypeCounts: { text: 1, llm: 1 } }, 3);
  toy("after-llm-set-model", rec[0]?.action === "set:model", `top=${rec.map((r) => r.action).join(",")}`);
}

// --- smallnet inline weights ---
const fixturePath = join(NA, "fixtures", "smoke-weights.json");
assert(existsSync(fixturePath), "missing fixtures/smoke-weights.json — run train-next-action.py");
const smoke = JSON.parse(readFileSync(fixturePath, "utf8"));
assert(smoke.manifest && smoke.layers?.length === 2, "smoke fixture shape");
assert(smoke.metrics?.holdout?.top1 >= 0.35, `holdout top1 gate: ${smoke.metrics?.holdout?.top1}`);
assert(smoke.metrics?.holdout?.top3 >= 0.55, `holdout top3 gate: ${smoke.metrics?.holdout?.top3}`);

const sn = await import(pathToFileURL(join(SN, "index.js")).href);
const { packWeights, createSession, assertManifest } = sn;
const manifest = { ...smoke.manifest, weightsUrl: null };
assertManifest(manifest);
assert(manifest.format === "smallnet-mlp-v1", "format");
assert(manifest.inputSize === inputSize(), "manifest inputSize");
assert(manifest.outputSize === outputSize(), "manifest outputSize");

const layerParams = smoke.layers.map((L) => ({
  W: Float32Array.from(L.W),
  b: Float32Array.from(L.b),
}));
const buf = packWeights(manifest, layerParams);
const session = createSession(manifest, buf);

// shape smoke
{
  const x = encodeState([], { numNodes: 0 });
  const y = session.run(x);
  assert(y.length === ACTION_VOCAB.length, "session output size");
  let sum = 0;
  for (let i = 0; i < y.length; i++) sum += y[i];
  assert(Math.abs(sum - 1) < 1e-3, `softmax sum ${sum}`);
}

// learned toys
{
  const x = encodeState([], { numNodes: 0 });
  const y = session.run(x);
  const ranked = rankFromLogits(y, 3).map((r) => r.action);
  toy(
    "net-cold-start",
    ranked.includes("add:text") || ranked.includes("add:image") || ranked.includes("add:comment"),
    `top=${ranked.join(",")}`
  );
}
{
  const x = encodeState(["add:text"], { numNodes: 1, nodeTypeCounts: { text: 1 } });
  const ranked = rankFromLogits(session.run(x), 3).map((r) => r.action);
  toy(
    "net-after-text",
    ranked.some((a) => ["add:image", "add:llm", "add:text", "wire", "add:join"].includes(a)),
    `top=${ranked.join(",")}`
  );
}
{
  const x = encodeState(["add:text", "add:image", "set:model"], {
    numNodes: 2,
    nodeTypeCounts: { text: 1, image: 1 },
    danglingOut: 1,
  });
  const ranked = rankFromLogits(session.run(x), 5).map((r) => r.action);
  toy(
    "net-modality-branch",
    ranked.some((a) => ["add:edit", "add:ivideo", "wire", "add:resize", "run"].includes(a)),
    `top=${ranked.join(",")}`
  );
}
{
  // blend path
  const blended = recommendNext({ tables, session, blend: 0.3 }, [], { numNodes: 0 }, 3);
  toy("blend-cold-start", blended.length === 3 && blended[0].action, `top=${blended.map((r) => r.action).join(",")}`);
}

const failedToys = toys.filter((t) => !t.ok);
assert(failedToys.length === 0, `${failedToys.length} behavioral toy(s) failed`);

// catalog still empty (smallnet check owns this; soft assert here)
const catalog = JSON.parse(readFileSync(join(SN, "catalog.json"), "utf8"));
assert(Array.isArray(catalog.models) && catalog.models.length === 0, "catalog must stay empty");

console.log(
  `✓ next-action: schema+corpus(${corpus.exampleCount}) freq(top1=${freqEval.top1.toFixed(3)},top3=${freqEval.top3.toFixed(3)}) holdout(top1=${smoke.metrics.holdout.top1.toFixed(3)},top3=${smoke.metrics.holdout.top3.toFixed(3)}) toys=${toys.length}/${toys.length}`
);
