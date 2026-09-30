#!/usr/bin/env node
/**
 * Product · 32 — wire-drag consumer quick-add polish toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSuggestionMemory } from "../vendor/next-action/suggestion-memory.mjs";
import {
  pairCount,
  scoreOutConsumers,
  applyMemoryToConsumers,
  gateWireDragConsumers,
  rankWireDragConsumers,
  SOURCE,
  REASON,
  MIN_SHARE,
  MIN_LEAD,
  MIN_PAIR,
  MAX_CONSUMER_SUGGEST,
} from "../vendor/next-action/wire-drag-consumer.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-wire-drag-consumer: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const portPath = join(NA, "corpus", "port-suggest.json");
assert(existsSync(portPath), "missing port-suggest.json");
assert(
  existsSync(join(NA, "wire-drag-consumer.mjs")),
  "missing wire-drag-consumer.mjs"
);

const portTables = JSON.parse(readFileSync(portPath, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const helperSrc = readFileSync(join(NA, "wire-drag-consumer.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

const textCands = [
  { type: "image", ports: [{ name: "prompt" }] },
  { type: "llm", ports: [{ name: "prompt" }] },
  { type: "join", ports: [{ name: "a" }, { name: "b" }] },
  { type: "tts", ports: [{ name: "prompt" }, { name: "text" }] },
  { type: "ivideo", ports: [{ name: "prompt" }] },
  { type: "comment", ports: [] },
];

// 1–3: pairCount / scoring basics
{
  const n = pairCount(portTables, "text", "text", "image", "prompt");
  toy("pair-text-image", n > 0, String(n));
  toy(
    "pair-missing-zero",
    pairCount(portTables, "text", "text", "nope", "x") === 0,
    "0"
  );
  toy("pair-null-tables", pairCount(null, "text", "text", "image", "prompt") === 0, "0");
}

// 4–6: scoreOutConsumers
{
  const scored = scoreOutConsumers(portTables, "text", "text", textCands);
  toy("score-nonempty", scored.length >= 2, `n=${scored.length}`);
  toy(
    "score-prefers-image",
    scored[0]?.type === "image",
    scored.map((s) => s.type + ":" + s.count).join("|")
  );
  toy(
    "score-skips-comment",
    !scored.some((s) => s.type === "comment"),
    scored.map((s) => s.type).join(",")
  );
}

// 7–9: rankWireDragConsumers happy path
{
  const ranked = rankWireDragConsumers(portTables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    candidates: textCands,
  });
  toy("out-ranks-consumers", !!ranked && ranked.order.length >= 1, ranked?.order?.join(",") || "-");
  toy(
    "out-top-is-image",
    ranked?.order?.[0] === "image",
    ranked?.order?.join(",") || "-"
  );
  toy(
    "out-reason-fits",
    ranked?.byType?.image?.reason === REASON &&
      ranked?.byType?.image?.source === SOURCE,
    ranked?.byType?.image?.reason + "/" + ranked?.byType?.image?.source
  );
}

// 10–12: in-dir ignored; missing args quiet
{
  toy(
    "in-dir-null",
    rankWireDragConsumers(portTables, {
      dir: "in",
      srcType: "llm",
      srcPort: "prompt",
      candidates: [{ type: "text", ports: [{ name: "text" }] }],
    }) === null,
    "null"
  );
  toy(
    "missing-src-null",
    rankWireDragConsumers(portTables, {
      dir: "out",
      srcType: "",
      srcPort: "text",
      candidates: textCands,
    }) === null,
    "null"
  );
  toy(
    "empty-cands-null",
    rankWireDragConsumers(portTables, {
      dir: "out",
      srcType: "text",
      srcPort: "text",
      candidates: [],
    }) === null,
    "null"
  );
}

// 13–15: flat / peaked gates
{
  const flatTables = {
    topTargets: {
      "text|text": {
        "image|prompt": 2,
        "llm|prompt": 2,
        "join|a": 2,
        "tts|text": 2,
      },
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
  const flat = rankWireDragConsumers(flatTables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    candidates: textCands,
  });
  toy("flat-prior-quiet", flat === null, String(flat));

  const peaked = {
    topTargets: {
      "text|text": {
        "image|prompt": 20,
        "llm|prompt": 3,
        "join|a": 2,
      },
    },
    portCatalog: flatTables.portCatalog,
    typeToType: {},
  };
  const ok = rankWireDragConsumers(peaked, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    candidates: textCands,
  });
  toy(
    "peaked-prior-passes",
    ok?.order?.[0] === "image",
    ok?.order?.join(",") || "-"
  );
  toy(
    "peaked-share-gate",
    ok && ok.byType.image.share >= MIN_SHARE,
    String(ok?.byType?.image?.share)
  );
}

// 16–18: incompatible / no priors / null tables
{
  const noHit = rankWireDragConsumers(portTables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    candidates: [{ type: "resize", ports: [{ name: "image" }] }],
  });
  // resize takes image, not text — may be null or quiet
  toy(
    "incompatible-skipped-or-quiet",
    noHit === null || !noHit.order.includes("resize") || (noHit.byType.resize?.count || 0) === 0,
    noHit ? noHit.order.join(",") : "null"
  );
  toy(
    "null-tables-quiet",
    rankWireDragConsumers(null, {
      dir: "out",
      srcType: "text",
      srcPort: "text",
      candidates: textCands,
    }) === null,
    "null"
  );
  toy(
    "no-topTargets-quiet",
    rankWireDragConsumers(
      { portCatalog: {} },
      {
        dir: "out",
        srcType: "text",
        srcPort: "text",
        candidates: textCands,
      }
    ) === null,
    "null"
  );
}

// 19–21: memory reweight
{
  const mem = createSuggestionMemory({ storage: null, enabled: true });
  // Boost join heavily so it can compete / reorder when close
  for (let i = 0; i < 6; i++) mem.noteChoice("add:join", ["add:join", "add:image", "add:llm"]);
  const scored = scoreOutConsumers(portTables, "text", "text", textCands);
  const weighted = applyMemoryToConsumers(scored, mem);
  const joinW = weighted.find((r) => r.type === "join");
  const joinRaw = scored.find((r) => r.type === "join");
  toy(
    "memory-boosts-join",
    joinW && joinRaw && joinW.score > joinRaw.count,
    `raw=${joinRaw?.count} w=${joinW?.score}`
  );
  const ranked = rankWireDragConsumers(portTables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    candidates: textCands,
    memory: mem,
  });
  toy(
    "memory-rank-still-array-or-null",
    ranked === null || (Array.isArray(ranked.order) && ranked.order.length >= 1),
    ranked?.order?.join(",") || "null"
  );
  // Ignore path: downweight image
  const mem2 = createSuggestionMemory({ storage: null, enabled: true });
  for (let i = 0; i < 8; i++) mem2.noteChoice("add:llm", ["add:image", "add:llm"]);
  const w2 = applyMemoryToConsumers(scored, mem2);
  const img = w2.find((r) => r.type === "image");
  const llm = w2.find((r) => r.type === "llm");
  toy(
    "memory-ignore-downweights",
    img && llm && img.score / Math.max(img.count, 1e-9) < llm.score / Math.max(llm.count, 1e-9) * 1.01 ||
      (img && img.score < img.count),
    `img ${img?.count}->${img?.score} llm ${llm?.count}->${llm?.score}`
  );
}

// 22–24: gate helpers + constants
{
  toy(
    "gates-exported",
    MIN_SHARE > 0 && MIN_LEAD > 1 && MIN_PAIR >= 2 && MAX_CONSUMER_SUGGEST >= 1,
    `share=${MIN_SHARE} lead=${MIN_LEAD} pair=${MIN_PAIR} max=${MAX_CONSUMER_SUGGEST}`
  );
  const gated = gateWireDragConsumers([
    { type: "image", count: 20, port: "prompt", score: 20, reason: REASON, source: SOURCE },
    { type: "llm", count: 3, port: "prompt", score: 3, reason: REASON, source: SOURCE },
  ]);
  toy("gate-peaked-ok", gated?.order?.[0] === "image", gated?.order?.join(",") || "-");
  toy(
    "gate-empty-null",
    gateWireDragConsumers([]) === null && gateWireDragConsumers(null) === null,
    "null"
  );
}

// 25–27: llm out consumers; image out consumers
{
  const llmRanked = rankWireDragConsumers(portTables, {
    dir: "out",
    srcType: "llm",
    srcPort: "text",
    candidates: [
      { type: "join", ports: [{ name: "a" }, { name: "b" }] },
      { type: "image", ports: [{ name: "prompt" }] },
      { type: "ivideo", ports: [{ name: "prompt" }] },
      { type: "music", ports: [{ name: "lyrics" }] },
    ],
  });
  toy(
    "llm-out-ranks",
    llmRanked === null || llmRanked.order.length >= 1,
    llmRanked?.order?.join(",") || "null(quiet-ok)"
  );
  // Live gallery image|image has tied resize/ivideo (3/3) → gate quiets (correct).
  const imgLive = rankWireDragConsumers(portTables, {
    dir: "out",
    srcType: "image",
    srcPort: "image",
    candidates: [
      { type: "resize", ports: [{ name: "image" }] },
      { type: "edit", ports: [{ name: "image" }, { name: "image2" }] },
      { type: "ivideo", ports: [{ name: "image" }] },
      { type: "llm", ports: [{ name: "img1" }] },
      { type: "text", ports: [] },
    ],
  });
  toy(
    "image-out-live-quiet-when-tied",
    imgLive === null,
    imgLive?.order?.join(",") || "null"
  );
  const imgPeaked = {
    topTargets: {
      "image|image": {
        "resize|image": 12,
        "edit|image": 3,
        "ivideo|image": 2,
        "llm|img1": 1,
      },
    },
    portCatalog: portTables.portCatalog,
    typeToType: {},
  };
  const imgRanked = rankWireDragConsumers(imgPeaked, {
    dir: "out",
    srcType: "image",
    srcPort: "image",
    candidates: [
      { type: "resize", ports: [{ name: "image" }] },
      { type: "edit", ports: [{ name: "image" }, { name: "image2" }] },
      { type: "ivideo", ports: [{ name: "image" }] },
      { type: "llm", ports: [{ name: "img1" }] },
      { type: "text", ports: [] },
    ],
  });
  toy(
    "image-out-ranks-sinks",
    !!imgRanked && imgRanked.order[0] === "resize" && !imgRanked.order.includes("text"),
    imgRanked?.order?.join(",") || "-"
  );
  toy(
    "max-caps-order",
    !imgRanked || imgRanked.order.length <= MAX_CONSUMER_SUGGEST,
    String(imgRanked?.order?.length)
  );
}

// 28–32: wiring pins (surface, index, readme, no forbidden)
{
  toy(
    "surface-exports-rank",
    surface.includes("rankWireDragConsumers") &&
      surface.includes("wire-drag-consumer.mjs"),
    "editor-surface API"
  );
  toy(
    "index-prefers-polish",
    index.includes("rankWireDragConsumers") &&
      index.includes('dir==="out"') &&
      index.includes("wireDropHintMap"),
    "wireDropHintMap polish path"
  );
  toy(
    "index-keeps-fallback",
    index.includes("rankDropTypes") &&
      index.includes("Fallback") || index.includes("rankDropTypes"),
    "fallback rankDropTypes"
  );
  toy(
    "readme-mentions-32",
    readme.includes("wire-drag-consumer.mjs") && /· 32/.test(readme),
    "README row"
  );
  toy(
    "check-script-listed",
    readme.includes("check-next-action-wire-drag-consumer.mjs"),
    "README checks"
  );
}

{
  const forbidden = [
    "na-panel",
    "placeGhost",
    "applyTip",
    'id="na-panel"',
    "product-32.html",
    "?product=32",
  ];
  for (const needle of forbidden) {
    const inHelper = helperSrc.includes(needle);
    const demo =
      existsSync(join(NA, "demo", "product-32.html")) ||
      existsSync(join(ROOT, "product-32.html"));
    toy(
      `no-forbidden-${needle.replace(/[^a-z0-9]+/gi, "-")}`,
      !inHelper && !demo && !surface.includes("demo/product-32"),
      needle
    );
  }
}

{
  toy(
    "index-guards-disabled",
    index.includes("na.disabled") && index.includes("rankWireDragConsumers"),
    "disabled guard"
  );
  toy(
    "source-constant",
    SOURCE === "wire-drag-consumer" && REASON === "fits this output",
    SOURCE + "/" + REASON
  );
  // type→type soft blend when port pairs thin
  const thin = {
    topTargets: { "text|text": {} },
    typeToType: { "text→image": 10, "text→llm": 2 },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
    },
  };
  const blended = scoreOutConsumers(thin, "text", "text", [
    { type: "image", ports: [{ name: "prompt" }] },
    { type: "llm", ports: [{ name: "prompt" }] },
  ]);
  toy(
    "type-to-type-blend",
    blended.some((r) => r.type === "image" && r.count > 0),
    blended.map((r) => r.type + ":" + r.count).join("|")
  );
}

const failed = toys.filter((t) => !t.ok);
if (failed.length) {
  console.error(
    `✗ next-action-wire-drag-consumer: ${failed.length}/${toys.length} toys failed`
  );
  process.exit(1);
}
console.log(
  `✓ next-action-wire-drag-consumer: out-drag → Suggested consumer polish; toys=${toys.length}/${toys.length}`
);
