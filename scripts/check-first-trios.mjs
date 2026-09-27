#!/usr/bin/env node
/**
 * Leftover firstTrio parsing after #595 (Product · 6).
 *
 * The shipped toys pin rebuild-lockstep and "some trio exists". The incident
 * class is a polluted opening: set:model rows without @step leak into #misc
 * and must not become a trio, and a two-step trajectory must not invent a
 * third action. Step order wins over a messy history when @0/@1/@2 exist.
 *
 * Offline. Synthetic examples only — does not snapshot live gallery-synth rows.
 */
import { buildFirstTrios, buildFrequencyTables } from "../vendor/next-action/frequency.mjs";

function fail(msg) {
  console.error(`✗ first-trios: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

function trioKey(actions) {
  return JSON.stringify(actions);
}

{
  const rows = buildFirstTrios([
    { exampleId: "gallery/sing#0", source: "gallery/sing", history: [], nextAction: "add:text" },
    { exampleId: "gallery/sing#0", source: "gallery/sing", history: ["add:text"], nextAction: "add:llm" },
    { exampleId: "gallery/sing#0", source: "gallery/sing", history: ["add:text", "add:llm"], nextAction: "set:model" },
    { exampleId: "gallery/sing#0", source: "gallery/sing", nextAction: "set:model" },
  ]);
  assert(rows.length === 0, "rows without @step are #misc and must not become a trio");
}

{
  const rows = buildFirstTrios([
    { exampleId: "gallery/sing#0@0", history: [], nextAction: "add:text" },
    { exampleId: "gallery/sing#0@1", history: ["add:text"], nextAction: "add:llm" },
  ]);
  assert(rows.length === 0, "a two-step trajectory must not invent a third action");
}

{
  const rows = buildFirstTrios([
    { exampleId: "gallery/x#1@2", history: ["wire"], nextAction: "run" },
    { exampleId: "gallery/x#1@0", history: ["move"], nextAction: "add:image" },
    { exampleId: "gallery/x#1@1", history: ["arrange"], nextAction: "set:model" },
  ]);
  assert(rows.length === 1, "one trajectory → one trio");
  assert(
    trioKey(rows[0].actions) === trioKey(["add:image", "set:model", "run"]),
    `step order must win over messy history, got ${rows[0].actions.join("→")}`
  );
  assert(rows[0].count === 1, "single trajectory counts as 1");
}

{
  const rows = buildFirstTrios([
    { exampleId: "a#0@0", history: [], nextAction: "add:text" },
    { exampleId: "a#0@1", history: ["add:text"], nextAction: "add:llm" },
    { exampleId: "a#0@2", history: ["add:text", "add:llm"], nextAction: "set:model" },
    { exampleId: "b#0@0", history: [], nextAction: "add:text" },
    { exampleId: "b#0@1", history: ["add:text"], nextAction: "add:llm" },
    { exampleId: "b#0@2", history: ["add:text", "add:llm"], nextAction: "set:model" },
    { exampleId: "c#0@0", history: [], nextAction: "add:image" },
    { exampleId: "c#0@1", history: ["add:image"], nextAction: "set:model" },
    { exampleId: "c#0@2", history: ["add:image", "set:model"], nextAction: "wire" },
  ]);
  assert(rows[0].actions[0] === "add:text" && rows[0].count === 2, "duplicate openings increment count and sort first");
  assert(rows[1].actions[0] === "add:image" && rows[1].count === 1, "the other opening stays");
}

{
  const tables = buildFrequencyTables([
    { exampleId: "a#0@0", history: [], nextAction: "add:text", sketch: { numNodes: 0 } },
    { exampleId: "a#0@1", history: ["add:text"], nextAction: "add:llm" },
    { exampleId: "a#0@2", history: ["add:text", "add:llm"], nextAction: "set:model" },
    { exampleId: "misc", source: "gallery/z", nextAction: "set:model" },
  ]);
  assert(tables.firstTrio.length === 1, "buildFrequencyTables firstTrio uses the same skip rules");
  assert(tables.firstNode["add:text"] === 1, "firstNode alias still copies coldStart");
  assert(tables.unigram["set:model"] === 2, "misc set:model still counts in unigram");
}

console.log("✓ first-trios: #misc skip, incomplete skip, @step order, count+sort, tables.lockstep");
