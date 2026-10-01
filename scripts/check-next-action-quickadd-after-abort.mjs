#!/usr/bin/env node
/**
 * Product · 48 — quickadd-after-abort origin-fit toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createSuggestionMemory } from "../vendor/next-action/suggestion-memory.mjs";
import {
  pairCount,
  scoreOutConsumers,
  scoreInProducers,
  applyMemoryToOriginFit,
  gateOriginFit,
  rankQuickaddAfterAbort,
  originFitReason,
  SOURCE,
  REASON_OUT,
  REASON_IN,
  MIN_SHARE,
  MIN_LEAD,
  MIN_PAIR,
  MAX_ORIGIN_FIT,
} from "../vendor/next-action/quickadd-after-abort.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-quickadd-after-abort: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const portPath = join(NA, "corpus", "port-suggest.json");
assert(existsSync(portPath), "missing port-suggest.json");
assert(
  existsSync(join(NA, "quickadd-after-abort.mjs")),
  "missing quickadd-after-abort.mjs"
);

const portTables = JSON.parse(readFileSync(portPath, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const helperSrc = readFileSync(join(NA, "quickadd-after-abort.mjs"), "utf8");
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

const producerCands = [
  { type: "text", ports: [{ name: "text" }] },
  { type: "llm", ports: [{ name: "text" }] },
  { type: "join", ports: [{ name: "text" }] },
  { type: "image", ports: [{ name: "image" }] },
  { type: "comment", ports: [] },
];

// 1–3: pairCount
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
  toy("score-out-nonempty", scored.length >= 2, `n=${scored.length}`);
  toy(
    "score-out-prefers-image",
    scored[0]?.type === "image",
    scored.map((s) => s.type + ":" + s.count).join("|")
  );
  toy(
    "score-out-skips-comment",
    !scored.some((s) => s.type === "comment"),
    scored.map((s) => s.type).join(",")
  );
}

// 7–9: out-dir rank happy path
{
  const ranked = rankQuickaddAfterAbort(portTables, {
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
    "out-reason-aborted",
    ranked?.byType?.image?.reason === REASON_OUT &&
      ranked?.byType?.image?.source === SOURCE,
    ranked?.byType?.image?.reason + "/" + ranked?.byType?.image?.source
  );
}

// 10–12: in-dir producer path
{
  const ranked = rankQuickaddAfterAbort(portTables, {
    dir: "in",
    srcType: "image",
    srcPort: "prompt",
    candidates: producerCands,
  });
  toy(
    "in-ranks-producers",
    ranked === null || (ranked.order.length >= 1 && ranked.order.includes("text")),
    ranked?.order?.join(",") || "null(quiet-ok)"
  );
  // Peaked synthetic: text clearly feeds image.prompt
  const peakedIn = {
    topTargets: {
      "text|text": { "image|prompt": 24, "llm|prompt": 2 },
      "llm|text": { "image|prompt": 3 },
      "join|text": { "image|prompt": 2 },
    },
    portCatalog: portTables.portCatalog,
    typeToType: {},
  };
  const inOk = rankQuickaddAfterAbort(peakedIn, {
    dir: "in",
    srcType: "image",
    srcPort: "prompt",
    candidates: producerCands,
  });
  toy(
    "in-peaked-prefers-text",
    inOk?.order?.[0] === "text",
    inOk?.order?.join(",") || "-"
  );
  toy(
    "in-reason-aborted",
    inOk?.byType?.text?.reason === REASON_IN &&
      inOk?.byType?.text?.source === SOURCE,
    inOk?.byType?.text?.reason + "/" + inOk?.byType?.text?.source
  );
}

// 13–15: missing args quiet
{
  toy(
    "missing-src-null",
    rankQuickaddAfterAbort(portTables, {
      dir: "out",
      srcType: "",
      srcPort: "text",
      candidates: textCands,
    }) === null,
    "null"
  );
  toy(
    "empty-cands-null",
    rankQuickaddAfterAbort(portTables, {
      dir: "out",
      srcType: "text",
      srcPort: "text",
      candidates: [],
    }) === null,
    "null"
  );
  toy(
    "null-tables-quiet",
    rankQuickaddAfterAbort(null, {
      dir: "out",
      srcType: "text",
      srcPort: "text",
      candidates: textCands,
    }) === null,
    "null"
  );
}

// 16–18: flat / peaked gates
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
  const flat = rankQuickaddAfterAbort(flatTables, {
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
  const ok = rankQuickaddAfterAbort(peaked, {
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

// 19–21: incompatible / no priors
{
  const noHit = rankQuickaddAfterAbort(portTables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    candidates: [{ type: "resize", ports: [{ name: "image" }] }],
  });
  toy(
    "incompatible-skipped-or-quiet",
    noHit === null || !noHit.order.includes("resize") || (noHit.byType.resize?.count || 0) === 0,
    noHit ? noHit.order.join(",") : "null"
  );
  toy(
    "no-topTargets-quiet",
    rankQuickaddAfterAbort(
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
  const scoredIn = scoreInProducers(portTables, "image", "prompt", producerCands);
  toy(
    "score-in-nonempty-or-quiet",
    Array.isArray(scoredIn),
    `n=${scoredIn.length}`
  );
}

// 22–24: memory reweight
{
  const mem = createSuggestionMemory({ storage: null, enabled: true });
  for (let i = 0; i < 6; i++) mem.noteChoice("add:join", ["add:join", "add:image", "add:llm"]);
  const scored = scoreOutConsumers(portTables, "text", "text", textCands);
  const weighted = applyMemoryToOriginFit(scored, mem, "out");
  const joinW = weighted.find((r) => r.type === "join");
  const joinRaw = scored.find((r) => r.type === "join");
  toy(
    "memory-boosts-join",
    joinW && joinRaw && joinW.score > joinRaw.count,
    `raw=${joinRaw?.count} w=${joinW?.score}`
  );
  const ranked = rankQuickaddAfterAbort(portTables, {
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
  const mem2 = createSuggestionMemory({ storage: null, enabled: true });
  for (let i = 0; i < 8; i++) mem2.noteChoice("add:llm", ["add:image", "add:llm"]);
  const w2 = applyMemoryToOriginFit(scored, mem2, "out");
  const img = w2.find((r) => r.type === "image");
  const llm = w2.find((r) => r.type === "llm");
  toy(
    "memory-ignore-downweights",
    img && llm && (img.score / Math.max(img.count, 1e-9) < llm.score / Math.max(llm.count, 1e-9) * 1.01 ||
      img.score < img.count),
    `img ${img?.count}->${img?.score} llm ${llm?.count}->${llm?.score}`
  );
}

// 25–27: gate helpers + constants + max cap
{
  toy(
    "gates-exported",
    MIN_SHARE > 0 && MIN_LEAD > 1 && MIN_PAIR >= 2 && MAX_ORIGIN_FIT >= 1,
    `share=${MIN_SHARE} lead=${MIN_LEAD} pair=${MIN_PAIR} max=${MAX_ORIGIN_FIT}`
  );
  const gated = gateOriginFit([
    { type: "image", count: 20, port: "prompt", score: 20, reason: REASON_OUT, source: SOURCE },
    { type: "llm", count: 3, port: "prompt", score: 3, reason: REASON_OUT, source: SOURCE },
  ]);
  toy("gate-peaked-ok", gated?.order?.[0] === "image", gated?.order?.join(",") || "-");
  toy(
    "gate-empty-null",
    gateOriginFit([]) === null && gateOriginFit(null) === null,
    "null"
  );
}

// 28–30: image out / max cap / type→type blend
{
  const imgLive = rankQuickaddAfterAbort(portTables, {
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
  const imgRanked = rankQuickaddAfterAbort(imgPeaked, {
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
    !imgRanked || imgRanked.order.length <= MAX_ORIGIN_FIT,
    String(imgRanked?.order?.length)
  );
}

// 31–36: wiring pins
{
  toy(
    "surface-exports-rank",
    surface.includes("rankQuickaddAfterAbort") &&
      surface.includes("quickadd-after-abort.mjs"),
    "editor-surface API"
  );
  toy(
    "index-prefers-origin-fit",
    index.includes("rankQuickaddAfterAbort") &&
      index.includes("wireDropHintMap") &&
      index.includes("fits aborted") === false && // reason lives in helper; index calls API
      index.includes("prefers-reduced-motion"),
    "wireDropHintMap origin-fit path"
  );
  toy(
    "index-keeps-fallback",
    index.includes("rankDropTypes"),
    "fallback rankDropTypes"
  );
  toy(
    "index-guards-disabled",
    index.includes("na.disabled") && index.includes("rankQuickaddAfterAbort"),
    "disabled guard"
  );
  toy(
    "readme-mentions-48",
    readme.includes("quickadd-after-abort.mjs") && /· 48/.test(readme),
    "README row"
  );
  toy(
    "check-script-listed",
    readme.includes("check-next-action-quickadd-after-abort.mjs"),
    "README checks"
  );
}

{
  const forbidden = [
    "na-panel",
    "placeGhost",
    "applyTip",
    'id="na-panel"',
    "product-48.html",
    "?product=48",
  ];
  for (const needle of forbidden) {
    const inHelper = helperSrc.includes(needle);
    const demo =
      existsSync(join(NA, "demo", "product-48.html")) ||
      existsSync(join(ROOT, "product-48.html"));
    toy(
      `no-forbidden-${needle.replace(/[^a-z0-9]+/gi, "-")}`,
      !inHelper && !demo && !surface.includes("demo/product-48"),
      needle
    );
  }
}

{
  toy(
    "source-constant",
    SOURCE === "quickadd-after-abort" &&
      REASON_OUT === "Uses this output" &&
      REASON_IN === "Provides this input",
    SOURCE + "/" + REASON_OUT + "/" + REASON_IN
  );
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
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-48-usage.gif")),
    "product-48-usage.gif"
  );
}

{
  toy("typed-out-reason", originFitReason("out", "text") === "Uses this text" && originFitReason("out", "image") === "Uses this image", "familiar payload names");
  toy("typed-in-reason", originFitReason("in", "text") === "Provides text" && originFitReason("in", "audio") === "Provides audio", "producer direction");
  toy("unknown-payload-reason", originFitReason("out", "unknown") === REASON_OUT && originFitReason("in") === REASON_IN, "safe generic fallback");
  const reasonRows = rankQuickaddAfterAbort(portTables, { dir: "out", srcType: "text", srcPort: "text", ptype: "text", candidates: [{ type: "image", ports: ["prompt"] }] });
  toy("query-keeps-typed-reason", reasonRows?.byType.image.reason === "Uses this text", "reason reaches Suggested row");
  const wireDropSource = index.slice(index.indexOf("function wireDropHintMap("), index.indexOf("function openQuickAdd("));
  toy("reduced-motion-keeps-static-ranking", !wireDropSource.includes("prefers-reduced-motion") && /\bptype\s*,/.test(wireDropSource), "static menu stays available");
  for (const lang of ["es", "fr", "de", "pt", "ja"]) {
    const start = index.indexOf("  " + lang + ":{");
    const map = index.slice(start, index.indexOf("\n  },", start));
    toy("localized-reasons-" + lang, [REASON_OUT, REASON_IN, "Uses this text", "Uses this image", "Uses this video", "Uses this audio", "Uses this 3D model", "Provides text", "Provides an image", "Provides video", "Provides audio", "Provides a 3D model"].every(reason => map.includes(JSON.stringify(reason) + ":")), "all payload reasons translated");
  }
}

// Run the shipped create/place/connect handler: nested structural edits share
// one snapshot, including the legacy geometry-disabled path.
{
  const start = index.indexOf("function quickSpawn(");
  const source = index.slice(start, index.indexOf("// pan (one finger", start));
  function run(geometry, muted = false, throws = false) {
    const ctx = { undoMuted: muted, graph: { nodes: [{ id: "source" }], links: [] }, snapshots: [],
      pushUndo() { if (!ctx.undoMuted) ctx.snapshots.push(JSON.stringify(ctx.graph)); },
      addNode(type) { ctx.pushUndo(); if (throws) throw new Error("render failed"); const n = { id: "new", type, el: { querySelectorAll: () => [{ dataset: { node: "new", port: "prompt" }, classList: { contains: () => false } }] } }; ctx.graph.nodes.push(n); return n; },
      separateOnAdd() {}, rememberAdd() {}, select() {}, geoOn: () => geometry,
      byId: id => ctx.graph.nodes.find(n => n.id === id),
      geoSettleNew(n) { ctx.connect("source", "text", n.id, "prompt"); },
      connect(fromNode, fromPort, toNode, toPort) { ctx.pushUndo(); ctx.graph.links.push({ from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } }); },
      ensureModelForInput() {}, redraw() {}, dismissConnectHint() {},
    };
    vm.createContext(ctx); new vm.Script(source).runInContext(ctx);
    try { ctx.quickSpawn("image", 400, 200, "out", "text", { dataset: { node: "source", port: "text" } }); } catch (e) { if (!throws) throw e; }
    return ctx;
  }
  for (const geometry of [true, false]) {
    const c = run(geometry);
    toy("one-choice-one-undo-" + geometry, c.snapshots.length === 1 && JSON.parse(c.snapshots[0]).nodes.length === 1 && c.graph.nodes.length === 2 && c.graph.links.length === 1 && c.undoMuted === false, "pre-choice snapshot and connected pair");
  }
  const nested = run(true, true);
  toy("keeps-existing-undo-mute", nested.snapshots.length === 0 && nested.undoMuted === true, "programmatic build state preserved");
  const failedRender = run(true, false, true);
  toy("restores-mute-after-error", failedRender.undoMuted === false, "later edits remain undoable");
}

const failed = toys.filter((t) => !t.ok);
if (failed.length) {
  console.error(
    `✗ next-action-quickadd-after-abort: ${failed.length}/${toys.length} toys failed`
  );
  process.exit(1);
}
console.log(
  `✓ next-action-quickadd-after-abort: abort→#quickadd origin-fit; toys=${toys.length}/${toys.length}`
);
