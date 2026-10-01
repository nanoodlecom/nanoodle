#!/usr/bin/env node
/**
 * Product · 35 — wire-drag producer quick-add polish toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSuggestionMemory } from "../vendor/next-action/suggestion-memory.mjs";
import {
  pairCount,
  scoreInProducers,
  applyMemoryToProducers,
  gateWireDragProducers,
  rankWireDragProducers,
  SOURCE,
  REASON,
  MIN_SHARE,
  MIN_LEAD,
  MIN_PAIR,
  MAX_PRODUCER_SUGGEST,
} from "../vendor/next-action/wire-drag-producer.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-wire-drag-producer: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const portPath = join(NA, "corpus", "port-suggest.json");
assert(existsSync(portPath), "missing port-suggest.json");
assert(
  existsSync(join(NA, "wire-drag-producer.mjs")),
  "missing wire-drag-producer.mjs"
);

const portTables = JSON.parse(readFileSync(portPath, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const helperSrc = readFileSync(join(NA, "wire-drag-producer.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

const imageCands = [
  { type: "text", ports: [{ name: "text" }] },
  { type: "llm", ports: [{ name: "text" }] },
  { type: "join", ports: [{ name: "text" }] },
  { type: "prompt", ports: [{ name: "text" }] },
  { type: "comment", ports: [] },
];

// 1–3: pairCount / scoring basics
{
  const n = pairCount(portTables, "text", "text", "image", "prompt");
  toy("pair-text-image", n > 0, String(n));
  toy(
    "pair-missing-zero",
    pairCount(portTables, "nope", "x", "image", "prompt") === 0,
    "0"
  );
  toy("pair-null-tables", pairCount(null, "text", "text", "image", "prompt") === 0, "0");
}

// 4–6: scoreInProducers
{
  const scored = scoreInProducers(portTables, "image", "prompt", imageCands);
  toy("score-nonempty", scored.length >= 1, `n=${scored.length}`);
  toy(
    "score-prefers-text",
    scored[0]?.type === "text",
    scored.map((s) => s.type + ":" + s.count).join("|")
  );
  toy(
    "score-skips-comment",
    !scored.some((s) => s.type === "comment"),
    scored.map((s) => s.type).join(",")
  );
}

// 7–9: rankWireDragProducers happy path
{
  const ranked = rankWireDragProducers(portTables, {
    dir: "in",
    srcType: "image",
    srcPort: "prompt",
    candidates: imageCands,
  });
  toy("in-ranks-producers", !!ranked && ranked.order.length >= 1, ranked?.order?.join(",") || "-");
  toy(
    "in-top-is-text",
    ranked?.order?.[0] === "text",
    ranked?.order?.join(",") || "-"
  );
  toy(
    "in-reason-feeds",
    ranked?.byType?.text?.reason === REASON &&
      ranked?.byType?.text?.source === SOURCE,
    ranked?.byType?.text?.reason + "/" + ranked?.byType?.text?.source
  );
}

// 10–12: out-dir ignored; missing args quiet
{
  toy(
    "out-dir-null",
    rankWireDragProducers(portTables, {
      dir: "out",
      srcType: "text",
      srcPort: "text",
      candidates: [{ type: "image", ports: [{ name: "prompt" }] }],
    }) === null,
    "null"
  );
  toy(
    "missing-src-null",
    rankWireDragProducers(portTables, {
      dir: "in",
      srcType: "",
      srcPort: "prompt",
      candidates: imageCands,
    }) === null,
    "null"
  );
  toy(
    "empty-cands-null",
    rankWireDragProducers(portTables, {
      dir: "in",
      srcType: "image",
      srcPort: "prompt",
      candidates: [],
    }) === null,
    "null"
  );
}

// 13–15: flat / peaked gates
{
  const flatTables = {
    topTargets: {
      "text|text": { "image|prompt": 2 },
      "llm|text": { "image|prompt": 2 },
      "join|text": { "image|prompt": 2 },
      "prompt|text": { "image|prompt": 2 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
      join: { inputs: ["a", "b"], outputs: ["text"] },
      prompt: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
    },
    typeToType: {},
  };
  const flat = rankWireDragProducers(flatTables, {
    dir: "in",
    srcType: "image",
    srcPort: "prompt",
    candidates: imageCands,
  });
  toy("flat-prior-quiet", flat === null, String(flat));

  const peaked = {
    topTargets: {
      "text|text": { "image|prompt": 20 },
      "llm|text": { "image|prompt": 3 },
      "join|text": { "image|prompt": 2 },
    },
    portCatalog: flatTables.portCatalog,
    typeToType: {},
  };
  const ok = rankWireDragProducers(peaked, {
    dir: "in",
    srcType: "image",
    srcPort: "prompt",
    candidates: imageCands,
  });
  toy(
    "peaked-prior-passes",
    ok?.order?.[0] === "text",
    ok?.order?.join(",") || "-"
  );
  toy(
    "peaked-share-gate",
    ok && ok.byType.text.share >= MIN_SHARE,
    String(ok?.byType?.text?.share)
  );
}

// 16–18: incompatible / no priors / null tables
{
  const noHit = rankWireDragProducers(portTables, {
    dir: "in",
    srcType: "image",
    srcPort: "prompt",
    candidates: [{ type: "resize", ports: [{ name: "image" }] }],
  });
  // resize outputs image, not text — should be quiet / not suggested as text producer
  toy(
    "incompatible-skipped-or-quiet",
    noHit === null || !noHit.order.includes("resize") || (noHit.byType.resize?.count || 0) === 0,
    noHit ? noHit.order.join(",") : "null"
  );
  toy(
    "null-tables-quiet",
    rankWireDragProducers(null, {
      dir: "in",
      srcType: "image",
      srcPort: "prompt",
      candidates: imageCands,
    }) === null,
    "null"
  );
  toy(
    "no-topTargets-quiet",
    rankWireDragProducers(
      { portCatalog: {} },
      {
        dir: "in",
        srcType: "image",
        srcPort: "prompt",
        candidates: imageCands,
      }
    ) === null,
    "null"
  );
}

// 19–21: memory reweight
{
  const mem = createSuggestionMemory({ storage: null, enabled: true });
  for (let i = 0; i < 6; i++) mem.noteChoice("add:llm", ["add:llm", "add:text", "add:join"]);
  const scored = scoreInProducers(portTables, "image", "prompt", imageCands);
  const weighted = applyMemoryToProducers(scored, mem);
  const llmW = weighted.find((r) => r.type === "llm");
  const llmRaw = scored.find((r) => r.type === "llm");
  toy(
    "memory-boosts-llm",
    !llmRaw || (llmW && llmW.score > llmRaw.count) || !llmW,
    `raw=${llmRaw?.count} w=${llmW?.score}`
  );
  // If llm has gallery mass, boost should lift score; if absent, skip is OK
  if (llmRaw) {
    toys[toys.length - 1].ok = llmW && llmW.score > llmRaw.count;
  } else {
    toys[toys.length - 1].ok = true;
    toys[toys.length - 1].detail = "no llm gallery mass (skip)";
  }
  const ranked = rankWireDragProducers(portTables, {
    dir: "in",
    srcType: "image",
    srcPort: "prompt",
    candidates: imageCands,
    memory: mem,
  });
  toy(
    "memory-rank-still-array-or-null",
    ranked === null || (Array.isArray(ranked.order) && ranked.order.length >= 1),
    ranked?.order?.join(",") || "null"
  );
  const mem2 = createSuggestionMemory({ storage: null, enabled: true });
  for (let i = 0; i < 8; i++) mem2.noteChoice("add:llm", ["add:text", "add:llm"]);
  const w2 = applyMemoryToProducers(scored, mem2);
  const txt = w2.find((r) => r.type === "text");
  const llm = w2.find((r) => r.type === "llm");
  toy(
    "memory-ignore-downweights",
    !txt ||
      !llm ||
      txt.score / Math.max(txt.count, 1e-9) < llm.score / Math.max(llm.count || 1, 1e-9) * 1.01 ||
      txt.score < txt.count,
    `text ${txt?.count}->${txt?.score} llm ${llm?.count}->${llm?.score}`
  );
}

// 22–24: gate helpers + constants
{
  toy(
    "gates-exported",
    MIN_SHARE > 0 && MIN_LEAD > 1 && MIN_PAIR >= 2 && MAX_PRODUCER_SUGGEST >= 1,
    `share=${MIN_SHARE} lead=${MIN_LEAD} pair=${MIN_PAIR} max=${MAX_PRODUCER_SUGGEST}`
  );
  const gated = gateWireDragProducers([
    { type: "text", count: 20, port: "text", score: 20, reason: REASON, source: SOURCE },
    { type: "llm", count: 3, port: "text", score: 3, reason: REASON, source: SOURCE },
  ]);
  toy("gate-peaked-ok", gated?.order?.[0] === "text", gated?.order?.join(",") || "-");
  toy(
    "gate-empty-null",
    gateWireDragProducers([]) === null && gateWireDragProducers(null) === null,
    "null"
  );
}

// 25–27: llm in producers; image in live quiet-when-tied + peaked
{
  const llmRanked = rankWireDragProducers(portTables, {
    dir: "in",
    srcType: "llm",
    srcPort: "prompt",
    candidates: [
      { type: "text", ports: [{ name: "text" }] },
      { type: "join", ports: [{ name: "text" }] },
      { type: "llm", ports: [{ name: "text" }] },
      { type: "image", ports: [{ name: "image" }] },
    ],
  });
  toy(
    "llm-in-ranks",
    llmRanked === null || llmRanked.order.length >= 1,
    llmRanked?.order?.join(",") || "null(quiet-ok)"
  );
  // Live gallery image|prompt: text=8, llm=2 → should prefer text
  const imgLive = rankWireDragProducers(portTables, {
    dir: "in",
    srcType: "image",
    srcPort: "prompt",
    candidates: imageCands,
  });
  toy(
    "image-in-live-prefers-text",
    !!imgLive && imgLive.order[0] === "text",
    imgLive?.order?.join(",") || "null"
  );
  const imgPeaked = {
    topTargets: {
      "text|text": { "image|prompt": 12 },
      "llm|text": { "image|prompt": 3 },
      "join|text": { "image|prompt": 2 },
    },
    portCatalog: portTables.portCatalog,
    typeToType: {},
  };
  const imgRanked = rankWireDragProducers(imgPeaked, {
    dir: "in",
    srcType: "image",
    srcPort: "prompt",
    candidates: [
      { type: "text", ports: [{ name: "text" }] },
      { type: "llm", ports: [{ name: "text" }] },
      { type: "join", ports: [{ name: "text" }] },
      { type: "resize", ports: [{ name: "image" }] },
    ],
  });
  toy(
    "image-in-ranks-sources",
    !!imgRanked && imgRanked.order[0] === "text" && !imgRanked.order.includes("resize"),
    imgRanked?.order?.join(",") || "-"
  );
  toy(
    "max-caps-order",
    !imgRanked || imgRanked.order.length <= MAX_PRODUCER_SUGGEST,
    String(imgRanked?.order?.length)
  );
}

// 28–32: wiring pins (surface, index, readme, no forbidden)
{
  toy(
    "surface-exports-rank",
    surface.includes("rankWireDragProducers") &&
      surface.includes("wire-drag-producer.mjs"),
    "editor-surface API"
  );
  toy(
    "index-prefers-polish",
    index.includes("rankWireDragProducers") &&
      index.includes('dir==="in"') &&
      index.includes("wireDropHintMap"),
    "wireDropHintMap polish path"
  );
  toy(
    "index-keeps-fallback",
    index.includes("rankDropTypes"),
    "fallback rankDropTypes"
  );
  toy(
    "readme-mentions-35",
    readme.includes("wire-drag-producer.mjs") && /· 35/.test(readme),
    "README row"
  );
  toy(
    "check-script-listed",
    readme.includes("check-next-action-wire-drag-producer.mjs"),
    "README checks"
  );
}

{
  const forbidden = [
    "na-panel",
    "placeGhost",
    "applyTip",
    'id="na-panel"',
    "product-35.html",
    "?product=35",
  ];
  for (const needle of forbidden) {
    const inHelper = helperSrc.includes(needle);
    const demo =
      existsSync(join(NA, "demo", "product-35.html")) ||
      existsSync(join(ROOT, "product-35.html"));
    toy(
      `no-forbidden-${needle.replace(/[^a-z0-9]+/gi, "-")}`,
      !inHelper && !demo && !surface.includes("demo/product-35"),
      needle
    );
  }
}

{
  toy(
    "index-guards-disabled",
    index.includes("na.disabled") && index.includes("rankWireDragProducers"),
    "disabled guard"
  );
  toy(
    "source-constant",
    SOURCE === "wire-drag-producer" && REASON === "feeds this input",
    SOURCE + "/" + REASON
  );
  // type→type soft blend when port pairs thin
  const thin = {
    topTargets: { "text|text": {} },
    typeToType: { "text→image": 10, "llm→image": 2 },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
    },
  };
  const blended = scoreInProducers(thin, "image", "prompt", [
    { type: "text", ports: [{ name: "text" }] },
    { type: "llm", ports: [{ name: "text" }] },
  ]);
  toy(
    "type-to-type-blend",
    blended.some((r) => r.type === "text" && r.count > 0),
    blended.map((r) => r.type + ":" + r.count).join("|")
  );
  // Leave out-dir / ·32 path alone on main
  toy(
    "index-leaves-out-alone",
    !index.includes("rankWireDragConsumers"),
    "no ·32 consumer hook (self-contained)"
  );
}

const failed = toys.filter((t) => !t.ok);
if (failed.length) {
  console.error(
    `✗ next-action-wire-drag-producer: ${failed.length}/${toys.length} toys failed`
  );
  process.exit(1);
}
console.log(
  `✓ next-action-wire-drag-producer: in-drag → Suggested producer polish; toys=${toys.length}/${toys.length}`
);
