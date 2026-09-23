#!/usr/bin/env node
/**
 * Product · 7 — connection / port suggest toys (gallery edge freq + recommend).
 */
import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  recommendPortSuggest,
  buildPortSuggestTables,
  danglingPorts,
} from "../vendor/next-action/port-suggest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-port-suggest: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const galleryRoot = join(ROOT, "examples", "gallery");
const dirs = readdirSync(galleryRoot).filter((d) =>
  existsSync(join(galleryRoot, d, "graph.json"))
);
assert(dirs.length >= 4, `need gallery graphs, got ${dirs.length}`);
const graphs = dirs.map((d) =>
  JSON.parse(readFileSync(join(galleryRoot, d, "graph.json"), "utf8"))
);
const rebuilt = buildPortSuggestTables(graphs);
assert(rebuilt.edgeCount > 10, `too few edges: ${rebuilt.edgeCount}`);
assert(
  (rebuilt.portPair["text.text→image.prompt"] || 0) > 0,
  "missing text.text→image.prompt in rebuilt tables"
);
assert(
  (rebuilt.topTargets["text|text"]?.["llm|prompt"] || 0) > 0 ||
    (rebuilt.topTargets["text|text"]?.["image|prompt"] || 0) > 0,
  "text|text should target llm|prompt or image|prompt"
);

if (!existsSync(CORPUS)) {
  writeFileSync(CORPUS, JSON.stringify(rebuilt, null, 2) + "\n");
  console.log("  baked missing corpus →", CORPUS);
}
const tables = JSON.parse(readFileSync(CORPUS, "utf8"));
assert(tables.edgeCount > 0, "corpus edgeCount empty");
assert(
  (tables.portPair["text.text→image.prompt"] || 0) > 0,
  "corpus missing text.text→image.prompt"
);
assert(tables.portCatalog?.text?.outputs?.includes("text"), "catalog text.outputs");
assert(tables.portCatalog?.llm?.inputs?.includes("prompt"), "catalog llm.inputs");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  const top = Object.entries(tables.portPair || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, c]) => `${k}×${c}`);
  toy("top-port-pairs-nonempty", top.length >= 3, top.join(", "));
}

{
  // Tiny fixture: Text + LLM, no links → dangling text.out + llm.prompt in
  const graph = {
    nodes: [
      { id: "t1", type: "text", x: 100, y: 100 },
      { id: "l1", type: "llm", x: 400, y: 100 },
    ],
    links: [],
    selectedId: "t1",
  };
  const dang = danglingPorts(tables, graph);
  toy(
    "dangling-text-out",
    dang.outs.some((o) => o.nodeId === "t1" && o.port === "text"),
    `outs=${dang.outs.map((o) => o.type + "." + o.port).join(",")}`
  );
  toy(
    "dangling-llm-prompt-in",
    dang.ins.some((i) => i.nodeId === "l1" && i.port === "prompt"),
    `ins=${dang.ins.map((i) => i.type + "." + i.port).join(",")}`
  );
  const rec = recommendPortSuggest(tables, graph, { k: 5 });
  toy("recommend-ranked-nonempty", rec.length > 0, `n=${rec.length} top=${rec[0]?.label}`);
  toy(
    "recommend-text-to-llm",
    rec.some(
      (r) =>
        r.from.nodeId === "t1" &&
        r.from.port === "text" &&
        r.to?.nodeId === "l1" &&
        r.to?.port === "prompt"
    ),
    `labels=${rec.map((r) => r.label).join(" | ")}`
  );
  toy(
    "recommend-has-score-label",
    rec.every((r) => r.score > 0 && r.label.includes("→")),
    `sample=${JSON.stringify(rec[0])}`
  );
}

{
  const empty = recommendPortSuggest(tables, { nodes: [{ id: "a", type: "text" }], links: [] }, { k: 3 });
  toy("single-node-no-suggest", empty.length === 0, `n=${empty.length}`);
}

{
  // After wire, no text→llm tip for that pair
  const graph = {
    nodes: [
      { id: "t1", type: "text", x: 100, y: 100 },
      { id: "l1", type: "llm", x: 400, y: 100 },
    ],
    links: [{ from: { node: "t1", port: "text" }, to: { node: "l1", port: "prompt" } }],
  };
  const dang = danglingPorts(tables, graph);
  toy(
    "wired-clears-dangling",
    !dang.outs.some((o) => o.nodeId === "t1" && o.port === "text") &&
      !dang.ins.some((i) => i.nodeId === "l1" && i.port === "prompt"),
    `outs=${dang.outs.length} ins=${dang.ins.length}`
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(
  `next-action-port-suggest: ${toys.length - failed.length}/${toys.length} toys ok · edges=${tables.edgeCount} graphs=${tables.graphCount}`
);
if (failed.length) fail(`${failed.length} toy(s) failed`);
process.exit(0);
