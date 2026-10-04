#!/usr/bin/env node
// Leftover Product · 27 selected-output-consumer edges after #644 / #674.
// Those pins cover LLM→join, tied image quiet, wired / multi / none
// selected, recipe block, join lift+tag, and already-first no-retag.
// This file pins the leftover ranking contract: a comment or missing
// selectedId stays quiet, first-node/learned/first-trio also block,
// disabled / unknown nodeTypes drop the list, an empty prior inserts
// the consumer hits while a first-node prior stays put, and the empty
// Add list lets a confident consumer silence recency even when the
// order did not change. Offline, zero API spend. New file so it does
// not collide with the shipped check.
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  rankSelectedOutputConsumers,
  applyConsumerLift,
  STRONG_SOURCES,
} from "../vendor/next-action/selected-output-consumer.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portTables = JSON.parse(
  readFileSync(join(ROOT, "vendor", "next-action", "corpus", "port-suggest.json"), "utf8")
);
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const known = new Set(Object.keys(portTables.portCatalog));

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

function graph(nodes, links, selectedId, selectedIds) {
  return { nodes, links: links || [], selectedId, selectedIds };
}

{
  const comment = rankSelectedOutputConsumers(
    portTables,
    graph([{ id: "n", type: "comment" }, { id: "l", type: "llm" }], [], "n"),
    { nodeTypes: known }
  );
  const missing = rankSelectedOutputConsumers(
    portTables,
    graph([{ id: "l", type: "llm" }], [], "ghost"),
    { nodeTypes: known }
  );
  if (comment.length)
    fail(`a selected comment must stay quiet, got ${JSON.stringify(comment)}`);
  else if (missing.length)
    fail(`a selectedId with no node must stay quiet, got ${JSON.stringify(missing)}`);
  else ok("comment / missing selectedId stay quiet");
}

{
  const g = graph([{ id: "l", type: "llm" }], [], "l");
  const blockers = ["first-node", "learned", "first-trio"].filter((src) => STRONG_SOURCES.includes(src));
  if (blockers.length !== 3)
    fail(`STRONG_SOURCES drifted, missing ${["first-node", "learned", "first-trio"].filter((s) => !STRONG_SOURCES.includes(s))}`);
  else {
    const quiet = blockers.every((source) => {
      const hits = rankSelectedOutputConsumers(portTables, g, {
        nodeTypes: known,
        priorAdds: [{ type: "image", source, reason: "prior" }],
      });
      return hits.length === 0;
    });
    if (!quiet)
      fail("first-node / learned / first-trio must also block consumer ranking");
    else ok("first-node / learned / first-trio block like recipe");
  }
}

{
  const g = graph([{ id: "l", type: "llm" }], [], "l");
  const off = rankSelectedOutputConsumers(portTables, g, { nodeTypes: known, disabled: true });
  const filtered = rankSelectedOutputConsumers(portTables, g, { nodeTypes: new Set(["text"]) });
  if (off.length)
    fail(`disabled must return [], got ${JSON.stringify(off)}`);
  else if (filtered.some((h) => h.type === "join") || filtered.length)
    fail(`nodeTypes must drop unknown consumers, got ${JSON.stringify(filtered)}`);
  else ok("disabled and unknown nodeTypes drop the consumer list");
}

{
  const hits = rankSelectedOutputConsumers(
    portTables,
    graph([{ id: "l", type: "llm" }], [], "l"),
    { nodeTypes: known }
  );
  const empty = applyConsumerLift(null, hits);
  const blocked = applyConsumerLift(
    [{ type: "image", source: "first-node", reason: "first" }],
    hits
  );
  if (!empty.changed || empty.adds[0]?.type !== "join" || !empty.tagged.includes("join"))
    fail(`an empty prior must insert the consumer hits, got ${JSON.stringify(empty)}`);
  else if (blocked.changed !== false || blocked.adds[0]?.source !== "first-node")
    fail(`applyConsumerLift must keep a first-node prior, got ${JSON.stringify(blocked)}`);
  else ok("empty prior inserts consumers; a first-node prior stays put");
}

{
  const start = index.indexOf("function selectedConsumerConfident(");
  const next = index.indexOf("function recentTypeMap(", start);
  const confident = start >= 0 && next > start ? index.slice(start, next) : "";
  if (!index.includes("if(!selectedConsumerConfident(map))"))
    fail("empty Add list must gate recency on selectedConsumerConfident");
  else if (!confident.includes("return !!(hits && hits.length)"))
    fail("selectedConsumerConfident must key off hits.length, not applyConsumerLift.changed");
  else ok("a confident consumer silences recency even when the order did not change");
}

if (failed) {
  console.error(`\n${failed} leftover selected-output-consumer pin(s) failed`);
  process.exit(1);
}
console.log("✓ selected-output-consumer leftover pins");
