#!/usr/bin/env node
/**
 * Product · 27 — selected output consumer toys.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  rankSelectedOutputConsumers,
  applyConsumerLift,
  REASON,
} from "../vendor/next-action/selected-output-consumer.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const portTables = JSON.parse(readFileSync(join(NA, "corpus", "port-suggest.json"), "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");

function fail(msg) {
  console.error(`✗ next-action-selected-output-consumer: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}
assert(existsSync(join(NA, "selected-output-consumer.mjs")), "missing helper");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

const known = new Set(Object.keys(portTables.portCatalog));

function graph(nodes, links, selectedId, selectedIds) {
  return { nodes, links: links || [], selectedId, selectedIds };
}

{
  const g = graph(
    [{ id: "l", type: "llm" }, { id: "x", type: "text" }],
    [],
    "l"
  );
  const hits = rankSelectedOutputConsumers(portTables, g, { nodeTypes: known });
  toy("llm-output-prefers-join", hits[0] && hits[0].type === "join" && hits[0].reason === REASON, hits.map((h) => h.type).join(","));
}

// A tie for first is never confidence (decided 2026-10-08 with Liquid d1 when
// the gallery briefly tied a selected LLM's text between Join and LLM, 4 / 4).
// Synthetic tables, so the rule stays pinned whatever the live gallery says:
// a tie leaves the Add list unchanged, even when a caller waives the lead.
{
  const tied = {
    topTargets: { "llm|text": { "join|a": 2, "join|b": 2, "llm|prompt": 4, "image|prompt": 1 } },
    portCatalog: portTables.portCatalog,
  };
  const g = graph([{ id: "l", type: "llm" }, { id: "x", type: "text" }], [], "l");
  const hits = rankSelectedOutputConsumers(tied, g, { nodeTypes: known });
  toy("tie-for-first-stays-quiet", hits.length === 0, hits.map((h) => h.type + ":" + h.score).join(","));
  const forced = rankSelectedOutputConsumers(tied, g, { nodeTypes: known, minLead: 1 });
  toy("tie-stays-quiet-even-when-lead-is-waived", forced.length === 0, forced.map((h) => h.type + ":" + h.score).join(","));
  const broken = rankSelectedOutputConsumers(
    { ...tied, topTargets: { "llm|text": { ...tied.topTargets["llm|text"], "join|b": 4 } } }, g, { nodeTypes: known });
  toy("broken-tie-names-the-leader", broken[0] && broken[0].type === "join", broken.map((h) => h.type + ":" + h.score).join(","));
}

{
  const g = graph(
    [{ id: "i", type: "image" }],
    [],
    "i"
  );
  const hits = rankSelectedOutputConsumers(portTables, g, { nodeTypes: known });
  toy("tied-image-consumers-quiet", hits.length === 0, hits.map((h) => h.type + ":" + h.score).join(","));
}

{
  const g = graph(
    [{ id: "t", type: "text" }, { id: "i", type: "image" }],
    [{ from: { node: "t", port: "text" }, to: { node: "i", port: "prompt" } }],
    "t"
  );
  toy("wired-output-quiet", rankSelectedOutputConsumers(portTables, g, { nodeTypes: known }).length === 0, "wired");
}

{
  const g = graph([{ id: "l", type: "llm" }, { id: "t", type: "text" }], [], "l", ["l", "t"]);
  toy("multi-select-quiet", rankSelectedOutputConsumers(portTables, g, { nodeTypes: known }).length === 0, "multi");
  toy("nothing-selected-quiet", rankSelectedOutputConsumers(portTables, graph([{ id: "l", type: "llm" }], [], null), { nodeTypes: known }).length === 0, "none");
}

{
  const prior = [{ type: "image", source: "recipe", reason: "from recipe" }];
  const g = graph([{ id: "l", type: "llm" }], [], "l");
  toy(
    "recipe-blocks",
    rankSelectedOutputConsumers(portTables, g, { nodeTypes: known, priorAdds: prior }).length === 0,
    "blocked"
  );
}

{
  const g = graph([{ id: "l", type: "llm" }], [], "l");
  const hits = rankSelectedOutputConsumers(portTables, g, { nodeTypes: known });
  const prior = [
    { type: "text", source: "frequency", reason: "often added next" },
    { type: "image", source: "frequency", reason: "often added next" },
  ];
  const applied = applyConsumerLift(prior, hits);
  toy(
    "join-moves-up-and-is-tagged",
    applied.changed === true && applied.adds[0].type === "join" && applied.tagged.includes("join") && !applied.tagged.includes("text"),
    JSON.stringify(applied)
  );
}

{
  const hits = [{ type: "image", action: "add:image", source: "selected-output-consumer", reason: REASON, share: 0.5 }];
  const prior = [{ type: "image", source: "frequency", reason: "often added next" }];
  const applied = applyConsumerLift(prior, hits);
  toy("already-first-no-retag", applied.changed === false, JSON.stringify(applied));
}

toy("surface", /rankSelectedOutputConsumers\(graph\)/.test(surface) && /selected-output-consumer\.mjs/.test(surface), "surface");
toy("html", index.includes("consumerTypeMap") && index.includes("applyConsumerLift"), "html");
toy("html-not-quickadd", !/function openQuickAdd[\s\S]{0,1200}consumerTypeMap/.test(index), "add menu only");
toy("readme", /·\s*27/.test(readme) && readme.includes("check-next-action-selected-output-consumer.mjs"), "readme");

const failed = toys.filter((t) => !t.ok);
console.log(`\nselected-output-consumer toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) fail(`${failed.length} failed`);
console.log("✓ next-action-selected-output-consumer");
