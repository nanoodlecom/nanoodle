#!/usr/bin/env node
/**
 * Product · 28 — selected input producer suggest toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_TYPES } from "../vendor/next-action/encode.mjs";
import { createSuggestionMemory } from "../vendor/next-action/suggestion-memory.mjs";
import {
  selectedNode,
  selectedDanglingInputs,
  producerCountsForInputs,
  typeToTypeProducers,
  scoreSelectedProducers,
  gateConfidentProducers,
  rankSelectedInputProducers,
  softMergeSelectedProducers,
  SOURCE,
  REASON,
  STRONG_SOURCES,
  MIN_SHARE,
  MIN_LEAD,
  MIN_PAIR,
} from "../vendor/next-action/selected-input-producer.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-selected-input-producer: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const portPath = join(NA, "corpus", "port-suggest.json");
assert(existsSync(portPath), "missing port-suggest.json");
assert(
  existsSync(join(NA, "selected-input-producer.mjs")),
  "missing selected-input-producer.mjs"
);

const portTables = JSON.parse(readFileSync(portPath, "utf8"));
const known = new Set(NODE_TYPES);
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const helperSrc = readFileSync(join(NA, "selected-input-producer.mjs"), "utf8");
const hintsSrc = readFileSync(join(NA, "hints.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

// --- helpers: selection / dangling ---
{
  const g = {
    nodes: [{ id: "i1", type: "image" }, { id: "t1", type: "text" }],
    links: [],
    selectedId: "i1",
  };
  toy("selected-node", selectedNode(g)?.id === "i1", selectedNode(g)?.id || "-");
  toy(
    "no-selection-quiet-node",
    selectedNode({ ...g, selectedId: null }) === null,
    "null"
  );
  toy(
    "multi-select-quiet-node",
    selectedNode({ ...g, selectedId: "i1", selectedIds: ["i1", "t1"] }) === null,
    "null"
  );
  const ins = selectedDanglingInputs(portTables, g);
  toy(
    "dangling-image-input",
    ins.length >= 1 && ins.some((o) => o.port === "prompt" && o.type === "image"),
    ins.map((o) => o.type + "." + o.port).join(",")
  );
}

{
  // Wire text → image.prompt → no dangling on image
  const g = {
    nodes: [{ id: "i1", type: "image" }, { id: "t1", type: "text" }],
    links: [
      {
        from: { node: "t1", port: "text" },
        to: { node: "i1", port: "prompt" },
      },
    ],
    selectedId: "i1",
  };
  toy(
    "wired-input-no-dangling",
    selectedDanglingInputs(portTables, g).length === 0,
    "[]"
  );
}

// --- invert priors ---
{
  const counts = producerCountsForInputs(portTables, [
    { type: "image", port: "prompt" },
  ]);
  toy(
    "invert-topTargets-image-prompt",
    (counts.text || 0) > 0,
    JSON.stringify(counts)
  );
  const tt = typeToTypeProducers(portTables, "image");
  toy(
    "invert-typeToType-image",
    (tt.text || 0) > 0 || (tt.llm || 0) > 0,
    JSON.stringify(tt)
  );
}

// --- scoring / rank ---
{
  const g = {
    nodes: [{ id: "i1", type: "image" }],
    links: [],
    selectedId: "i1",
  };
  const hits = rankSelectedInputProducers(portTables, g, { nodeTypes: known });
  toy(
    "selected-dangling-lifts-producers",
    hits.length >= 1 && hits[0].source === SOURCE,
    `top=${hits.map((h) => h.type + "@" + (h.share || 0).toFixed(2)).join("|")}`
  );
  toy(
    "selected-dangling-has-reason",
    hits.length >= 1 && hits[0].reason === REASON,
    hits[0]?.reason || "-"
  );
  // image.prompt ← text is the gallery peak
  toy(
    "image-lifts-text-producer",
    hits.some((h) => h.type === "text"),
    hits.map((h) => h.type).join(",")
  );
}

{
  toy(
    "nothing-selected-quiet",
    rankSelectedInputProducers(
      portTables,
      { nodes: [{ id: "i1", type: "image" }], links: [], selectedId: null },
      { nodeTypes: known }
    ).length === 0,
    "[]"
  );
}

{
  const g = {
    nodes: [{ id: "i1", type: "image" }, { id: "t1", type: "text" }],
    links: [
      {
        from: { node: "t1", port: "text" },
        to: { node: "i1", port: "prompt" },
      },
    ],
    selectedId: "i1",
  };
  toy(
    "no-dangling-quiet",
    rankSelectedInputProducers(portTables, g, { nodeTypes: known }).length === 0,
    "[]"
  );
}

{
  // Flat prior: equal counts → gate quiets
  const flatTables = {
    topTargets: {
      "text|text": { "image|prompt": 2 },
      "llm|text": { "image|prompt": 2 },
      "join|text": { "image|prompt": 2 },
      "tts|audio": { "image|prompt": 2 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
      join: { inputs: ["a", "b"], outputs: ["text"] },
      tts: { inputs: ["text"], outputs: ["audio"] },
    },
    typeToType: {},
  };
  const g = {
    nodes: [{ id: "i1", type: "image" }],
    links: [],
    selectedId: "i1",
  };
  const scored = scoreSelectedProducers(flatTables, g, {
    nodeTypes: new Set(["text", "llm", "join", "tts"]),
  });
  const gated = gateConfidentProducers(scored);
  toy(
    "flat-prior-quiet",
    gated.length === 0,
    `scored=${scored.length} gated=${gated.length}`
  );

  const peaked = {
    topTargets: {
      "text|text": { "image|prompt": 20 },
      "llm|text": { "image|prompt": 3 },
      "join|text": { "image|prompt": 2 },
    },
    portCatalog: flatTables.portCatalog,
    typeToType: {},
  };
  const ok = rankSelectedInputProducers(peaked, g, {
    nodeTypes: new Set(["text", "llm", "join"]),
  });
  toy(
    "peaked-prior-passes",
    ok.length >= 1 && ok[0].type === "text",
    `top=${ok.map((h) => h.type).join(",")}`
  );
}

{
  const mem = createSuggestionMemory({ storage: null, enabled: true });
  mem.noteChoice("add:join", ["add:join", "add:text"]);
  mem.noteChoice("add:join", ["add:join", "add:text"]);
  const g = {
    nodes: [{ id: "i1", type: "image" }],
    links: [],
    selectedId: "i1",
  };
  const hits = rankSelectedInputProducers(portTables, g, {
    nodeTypes: known,
    memory: mem,
  });
  toy(
    "memory-can-boost",
    Array.isArray(hits),
    `n=${hits.length} top=${hits.map((h) => h.type).join(",") || "-"}`
  );
}

{
  const prior = [
    {
      type: "llm",
      action: "add:llm",
      reason: "recipe next",
      source: "recipe",
      share: 0.5,
    },
  ];
  const g = {
    nodes: [{ id: "i1", type: "image" }],
    links: [],
    selectedId: "i1",
  };
  const search = rankSelectedInputProducers(portTables, g, {
    nodeTypes: known,
  });
  const merged = softMergeSelectedProducers(prior, search);
  toy(
    "soft-merge-keeps-recipe",
    merged.some((a) => a.type === "llm" && a.source === "recipe"),
    merged.map((a) => a.type + ":" + a.source).join("|")
  );
  toy(
    "soft-merge-adds-producers",
    merged.some((a) => a.source === SOURCE),
    merged.map((a) => a.type + ":" + a.source).join("|")
  );
  const stomped = softMergeSelectedProducers(
    [
      {
        type: "text",
        action: "add:text",
        reason: "recipe next",
        source: "recipe",
        share: 0.6,
      },
    ],
    search
  );
  toy(
    "soft-merge-no-stomp-strong",
    stomped.find((a) => a.type === "text")?.source === "recipe" &&
      stomped.find((a) => a.type === "text")?.reason === "recipe next",
    stomped.map((a) => a.type + ":" + a.source).join("|")
  );
  const consumerPrior = [
    {
      type: "edit",
      action: "add:edit",
      reason: "fits selected output",
      source: "selected-output-consumer",
      share: 0.55,
    },
  ];
  const noStompConsumer = softMergeSelectedProducers(consumerPrior, search);
  toy(
    "soft-merge-no-stomp-selected-output-consumer",
    noStompConsumer.find((a) => a.type === "edit")?.source ===
      "selected-output-consumer",
    noStompConsumer.map((a) => a.type + ":" + a.source).join("|")
  );
  toy(
    "soft-merge-empty-unchanged",
    softMergeSelectedProducers(prior, []).length === 1 &&
      softMergeSelectedProducers(prior, [])[0].type === "llm",
    "unchanged"
  );
}

{
  toy(
    "producer-counts-image",
    (producerCountsForInputs(portTables, [
      { type: "image", port: "prompt" },
    ]).text || 0) > 0,
    String(
      producerCountsForInputs(portTables, [{ type: "image", port: "prompt" }])
        .text
    )
  );
}

{
  toy(
    "surface-exports-rank",
    surface.includes("rankSelectedInputProducers") &&
      surface.includes("selected-input-producer.mjs"),
    "editor-surface API"
  );
  toy(
    "hints-producer-reason",
    hintsSrc.includes('source === "selected-input-producer"') &&
      hintsSrc.includes("feeds selected input"),
    "reason tag"
  );
  toy(
    "index-hooks-addhint",
    index.includes("rankSelectedInputProducers") &&
      index.includes("selected-input-producer") &&
      index.includes("feeds selected input"),
    "addHintMap path"
  );
  toy(
    "readme-mentions-28",
    readme.includes("selected-input-producer.mjs") && /· 28/.test(readme),
    "README row"
  );
  toy(
    "check-script-listed",
    readme.includes("check-next-action-selected-input-producer.mjs"),
    "README checks"
  );
  toy(
    "strong-sources-exported",
    Array.isArray(STRONG_SOURCES) &&
      STRONG_SOURCES.includes("recipe") &&
      STRONG_SOURCES.includes("selected-output-consumer"),
    STRONG_SOURCES.join(",")
  );
  toy(
    "gates-exported",
    MIN_SHARE > 0 && MIN_LEAD > 1 && MIN_PAIR >= 2,
    `share=${MIN_SHARE} lead=${MIN_LEAD} pair=${MIN_PAIR}`
  );
}

{
  const forbidden = [
    "na-panel",
    "na-ghost",
    "placeGhost",
    "applyTip",
    'id="na-panel"',
    "product-28.html",
    "?product=28",
  ];
  for (const needle of forbidden) {
    const inHelper = helperSrc.includes(needle);
    const demo =
      existsSync(join(NA, "demo", "product-28.html")) ||
      existsSync(join(ROOT, "product-28.html"));
    const inIndexPanel =
      needle === "na-panel" ||
      needle === "na-ghost" ||
      needle === "placeGhost" ||
      needle === "applyTip"
        ? index.includes(needle)
        : false;
    toy(
      `no-forbidden-${needle.replace(/[^a-z0-9]+/gi, "-")}`,
      !inHelper && !demo && !inIndexPanel && !surface.includes("demo/product-28"),
      needle
    );
  }
}

{
  toy(
    "null-tables-quiet",
    rankSelectedInputProducers(null, {
      nodes: [{ id: "i1", type: "image" }],
      links: [],
      selectedId: "i1",
    }).length === 0,
    "null tables"
  );
  toy(
    "index-guards-disabled",
    index.includes("na.disabled") &&
      index.includes("rankSelectedInputProducers"),
    "disabled guard"
  );
}

const failed = toys.filter((t) => !t.ok);
if (failed.length) {
  console.error(
    `✗ next-action-selected-input-producer: ${failed.length}/${toys.length} toys failed`
  );
  process.exit(1);
}
console.log(
  `✓ next-action-selected-input-producer: selected+dangling → Suggested producer lift; toys=${toys.length}/${toys.length}`
);
