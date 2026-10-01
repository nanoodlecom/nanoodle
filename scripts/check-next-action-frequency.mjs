#!/usr/bin/env node
/**
 * Product · 3 — frequency baseline + behavioral toys (no learned weights).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_VOCAB } from "../vendor/next-action/encode.mjs";
import {
  recommendFrequency,
  evaluateFrequency,
  buildFrequencyTables,
} from "../vendor/next-action/frequency.mjs";
import { recommendNext } from "../vendor/next-action/recommend.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-frequency: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const corpusPath = join(NA, "corpus", "gallery-synth.json");
const tablesPath = join(NA, "corpus", "frequency-tables.json");
assert(existsSync(corpusPath), "missing gallery-synth corpus");
assert(existsSync(tablesPath), "missing frequency-tables.json");

const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const tables = JSON.parse(readFileSync(tablesPath, "utf8"));
assert(tables.total === corpus.exampleCount, "frequency total != exampleCount");
const rebuilt = buildFrequencyTables(corpus.examples);
assert(rebuilt.total === tables.total, "rebuild total mismatch");

const freqEval = evaluateFrequency(tables, corpus.examples);
assert(freqEval.top1 > 0.4, `frequency top1 too low: ${freqEval.top1}`);
assert(freqEval.top3 > 0.6, `frequency top3 too low: ${freqEval.top3}`);
assert(freqEval.top1 > (1 / ACTION_VOCAB.length) * 3, "frequency must beat random by 3x");

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
{
  const baseline = recommendNext({ tables }, [], { numNodes: 0 }, 3);
  toy("recommend-baseline-path", baseline.length >= 1 && !!baseline[0].action, `top=${baseline.map((r) => r.action).join(",")}`);
}

const failed = toys.filter((t) => !t.ok);
assert(failed.length === 0, `${failed.length} toy(s) failed`);

console.log(
  `✓ next-action-frequency: n=${freqEval.n} top1=${freqEval.top1.toFixed(3)} top3=${freqEval.top3.toFixed(3)} toys=${toys.length}/${toys.length}`
);
console.log("  (in-list hints: vendor/next-action/hints.mjs + editor-surface.mjs)");
