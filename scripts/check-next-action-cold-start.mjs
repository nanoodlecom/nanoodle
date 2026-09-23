#!/usr/bin/env node
/**
 * Product · 6 — cold-start seeds toys (empty-graph tips + firstTrio + rebuild).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFrequencyTables } from "../vendor/next-action/frequency.mjs";
import {
  recommendColdStart,
  topFirstTrios,
} from "../vendor/next-action/cold-start.mjs";
import { recommendFrequency } from "../vendor/next-action/frequency.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-cold-start: ${msg}`);
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
const rebuilt = buildFrequencyTables(corpus.examples);

assert(tables.total === corpus.exampleCount, "frequency total != exampleCount");
assert(rebuilt.total === tables.total, "rebuild total mismatch");
assert(
  JSON.stringify(rebuilt.coldStart) === JSON.stringify(tables.coldStart),
  "rebuild coldStart mismatch"
);
assert(
  JSON.stringify(rebuilt.firstNode) === JSON.stringify(tables.firstNode),
  "rebuild firstNode mismatch"
);
assert(
  JSON.stringify(rebuilt.firstTrio) === JSON.stringify(tables.firstTrio),
  "rebuild firstTrio mismatch"
);
assert(
  tables.firstNode && Object.keys(tables.firstNode).length > 0,
  "firstNode empty"
);
assert(Array.isArray(tables.firstTrio) && tables.firstTrio.length > 0, "firstTrio empty");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  const rec = recommendColdStart(tables, { numNodes: 0 }, 3);
  const actions = rec.map((r) => r.action);
  toy(
    "empty-graph-first-node",
    actions.includes("add:text") || actions.includes("add:image"),
    `top=${actions.join(",")}`
  );
  toy("cold-start-nonempty", rec.length >= 1, `n=${rec.length}`);
}
{
  const trios = topFirstTrios(tables, 5);
  toy("firstTrio-nonempty", trios.length >= 1 && trios[0].actions?.length === 3, `n=${trios.length} top=${trios[0]?.actions?.join("→")}`);
}
{
  // Applying recommend shouldn't throw
  let threw = false;
  try {
    recommendColdStart(tables, { numNodes: 0 }, 3);
    recommendFrequency(tables, ["add:text"], { numNodes: 1 }, 3);
    topFirstTrios(tables, 3);
  } catch (e) {
    threw = true;
    console.error(e);
  }
  toy("recommend-no-throw", !threw, threw ? "threw" : "ok");
}
{
  // Non-empty graph: cold-start returns []; frequency still works (· 3 fallback path)
  const emptyish = recommendColdStart(tables, { numNodes: 2 }, 3);
  const freq = recommendFrequency(tables, ["add:text"], { numNodes: 1 }, 3);
  toy(
    "nonempty-falls-through",
    emptyish.length === 0 && freq.length >= 1,
    `cold=${emptyish.length} freq=${freq.map((r) => r.action).join(",")}`
  );
}

const failed = toys.filter((t) => !t.ok);
assert(failed.length === 0, `${failed.length} toy(s) failed`);

console.log(
  `✓ next-action-cold-start: firstTrio=${tables.firstTrio.length} coldStartKeys=${Object.keys(tables.coldStart).length} toys=${toys.length}/${toys.length}`
);
