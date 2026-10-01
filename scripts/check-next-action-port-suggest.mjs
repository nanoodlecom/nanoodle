#!/usr/bin/env node
/**
 * Port priors rank the wire-drop menu and pick the drag ring.
 * They never create a wire.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  recommendPortSuggest,
  buildPortSuggestTables,
  danglingPorts,
  rankDropTypes,
  pickRingTarget,
  pairCount,
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
  (rebuilt.topTargets["text|text"]?.["image|prompt"] || 0) >
    (rebuilt.topTargets["text|text"]?.["llm|prompt"] || 0),
  "text|text should prefer image|prompt over llm|prompt"
);

assert(existsSync(CORPUS), "corpus/port-suggest.json missing");
const tables = JSON.parse(readFileSync(CORPUS, "utf8"));
assert(tables.edgeCount === rebuilt.edgeCount, `corpus edges ${tables.edgeCount} != rebuilt ${rebuilt.edgeCount}`);
assert(tables.graphCount === rebuilt.graphCount, "corpus graphCount drifted");
assert(
  tables.portPair["text.text→image.prompt"] === rebuilt.portPair["text.text→image.prompt"],
  "corpus text.text→image.prompt drifted"
);
assert(tables.portCatalog?.text?.outputs?.includes("text"), "catalog text.outputs");
assert(tables.portCatalog?.llm?.inputs?.includes("prompt"), "catalog llm.inputs");
assert(!tables.weightsUrl, "port corpus must not carry a weightsUrl");

{
  const graph = {
    nodes: [
      { id: "t1", type: "text", x: 100, y: 100 },
      { id: "l1", type: "llm", x: 400, y: 100 },
    ],
    links: [],
    selectedId: "t1",
  };
  const dang = danglingPorts(tables, graph);
  assert(dang.outs.some((o) => o.nodeId === "t1" && o.port === "text"), "dangling text out");
  assert(dang.ins.some((i) => i.nodeId === "l1" && i.port === "prompt"), "dangling llm prompt");
  const rec = recommendPortSuggest(tables, graph, { k: 5 });
  assert(rec.length > 0, "recommend nonempty");
  assert(
    rec.some((r) => r.from.nodeId === "t1" && r.from.port === "text" && r.to?.nodeId === "l1" && r.to?.port === "prompt"),
    `text→llm missing: ${rec.map((r) => r.label).join(" | ")}`
  );
  assert(rec.every((r) => r.score > 0 && r.label.includes("→")), "score and label");
  assert(!("connect" in (rec[0] || {})), "recommendation is not a connect call");
}

{
  const empty = recommendPortSuggest(tables, { nodes: [{ id: "a", type: "text" }], links: [] }, { k: 3 });
  assert(empty.length === 0, "single node stays quiet");
}

{
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "l1", type: "llm" },
    ],
    links: [{ from: { node: "t1", port: "text" }, to: { node: "l1", port: "prompt" } }],
  };
  const dang = danglingPorts(tables, graph);
  assert(
    !dang.outs.some((o) => o.nodeId === "t1" && o.port === "text") &&
      !dang.ins.some((i) => i.nodeId === "l1" && i.port === "prompt"),
    "a real wire clears that dangling pair"
  );
}

{
  const ranked = rankDropTypes(tables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    candidates: [
      { type: "llm", ports: [{ name: "prompt" }] },
      { type: "image", ports: [{ name: "prompt" }] },
      { type: "join", ports: [{ name: "a" }, { name: "b" }] },
      { type: "comment", ports: [] },
    ],
  });
  assert(ranked && ranked.order[0] === "image", `wire-drop should rank image first, got ${ranked && ranked.order}`);
  assert(ranked.byType.image.reason === "often wired next", "reason stays an existing i18n key");
  assert(ranked.byType.image.port === "prompt", "image lands on prompt");
  assert(pairCount(tables, "text", "text", "image", "prompt") >= 2, "image prompt prior is strong");
}

{
  const flat = rankDropTypes(
    { topTargets: { "text|text": { "llm|prompt": 3, "image|prompt": 3 } } },
    {
      dir: "out",
      srcType: "text",
      srcPort: "text",
      candidates: [
        { type: "llm", ports: [{ name: "prompt" }] },
        { type: "image", ports: [{ name: "prompt" }] },
      ],
    }
  );
  assert(flat === null, "a tie must not reorder the wire-drop menu");
}

{
  const weak = rankDropTypes(tables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    candidates: [{ type: "tts", ports: [{ name: "prompt" }] }],
  });
  assert(weak === null, "a single gallery edge is not confident enough to rank");
}

{
  const ring = pickRingTarget(tables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    srcNodeId: "t1",
    targets: [
      { nodeId: "l1", type: "llm", port: "prompt" },
      { nodeId: "l1", type: "llm", port: "model" },
      { nodeId: "i1", type: "image", port: "prompt" },
    ],
  });
  assert(ring && ring.nodeId === "i1" && ring.port === "prompt", `ring should be image.prompt, got ${JSON.stringify(ring)}`);
}

{
  const unsure = pickRingTarget(
    { topTargets: { "text|text": { "llm|prompt": 4, "image|prompt": 4 } } },
    {
      dir: "out",
      srcType: "text",
      srcPort: "text",
      targets: [
        { nodeId: "l1", type: "llm", port: "prompt" },
        { nodeId: "i1", type: "image", port: "prompt" },
      ],
    }
  );
  assert(unsure === null, "a tied ring stays quiet");
}

{
  const mod = readFileSync(join(NA, "port-suggest.mjs"), "utf8");
  const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
  const index = readFileSync(join(ROOT, "index.html"), "utf8");
  assert(!mod.includes("connect("), "port-suggest must not call connect");
  assert(!mod.includes("na-ghost") && !mod.includes("placeGhost"), "no ghost wire");
  assert(surface.includes("rankDropTypes") && surface.includes("pickRingTarget"), "engine exposes port ranking");
  assert(surface.includes("corpus/port-suggest.json"), "engine loads the baked prior");
  assert(!surface.includes("weightsUrl"), "port path must not register a weightsUrl");
  assert(index.includes("na.pickRingTarget"), "wire drag asks the prior which port to ring");
  assert(index.includes("na.rankDropTypes"), "wire-drop menu asks the prior to rank types");
  assert(index.includes('classList.add("likely")'), "a confident port still gets the existing ring");
  assert(index.includes("connect("), "wires are still created through connect()");
}

console.log(`✓ next-action-port-suggest: edges=${tables.edgeCount} graphs=${tables.graphCount} text→image leads the drop menu and the ring`);
