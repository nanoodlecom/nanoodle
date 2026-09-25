#!/usr/bin/env node
/**
 * In-list next-action hints. No panel, no ghost, no fabricated wire.
 * A weak distribution must not change a menu; a wire hint carries no ports.
 */
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_VOCAB, NODE_TYPES } from "../vendor/next-action/encode.mjs";
import { recommendFrequency } from "../vendor/next-action/frequency.mjs";
import { recommendNext } from "../vendor/next-action/recommend.mjs";
import { projectHints, chooseHints, liftSuggested, MIN_SHARE, MIN_LEAD, MAX_ADDS } from "../vendor/next-action/hints.mjs";
import { predictorDisabled } from "../vendor/next-action/editor-surface.mjs";
import { packWeights, createSession } from "../vendor/smallnet/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-hints: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const tables = JSON.parse(readFileSync(join(NA, "corpus", "frequency-tables.json"), "utf8"));
const known = new Set(NODE_TYPES);
const fix = JSON.parse(readFileSync(join(NA, "fixtures", "smoke-weights.json"), "utf8"));
const layers = fix.layers.map((L) => ({ W: Float32Array.from(L.W), b: Float32Array.from(L.b) }));
const session = createSession(fix.manifest, packWeights(fix.manifest, layers));

function hintsFor(history, sketch) {
  const frequencyRows = recommendFrequency(tables, history, sketch, ACTION_VOCAB.length);
  const blendRows = recommendNext(
    { tables, session, blend: 0.35 },
    history,
    sketch,
    ACTION_VOCAB.length
  );
  return chooseHints({
    frequencyRows,
    blendRows,
    nodeTypes: known,
    sketch,
    coldStart: history.length === 0,
  });
}

{
  const h = hintsFor([], { numNodes: 0 });
  assert(h.confident, "empty canvas should be confident");
  assert(h.adds[0] && h.adds[0].type === "text", `cold start should suggest text, got ${h.adds.map((a) => a.type).join(",")}`);
  assert(h.adds[0].reason === "common first node", "cold start reason");
  assert(!h.wire, "cold start is not a wire");
}

{
  const h = hintsFor(["add:image"], { numNodes: 1, nodeTypeCounts: { image: 1 } });
  assert(h.confident && h.setModel, "after add:image the model picker should be hinted");
  assert(h.adds.length === 0, "after add:image the add menu should be unchanged");
  assert(!h.wire, "set:model is not a wire");
}

{
  const h = hintsFor(["set:model"], { numNodes: 2, danglingOut: 1 });
  assert(h.confident && h.wire && h.wire.reason === "often wired next", "after set:model, wire is the hint");
  assert(!("from" in h.wire) && !("to" in h.wire) && !h.wire.ports, "wire hint must not invent ports");
  assert(h.adds.length === 0, "a wire hint does not reorder the add menu");
}

{
  const flat = ACTION_VOCAB.map((action) => ({ action, score: 1 }));
  const h = projectHints(flat, { nodeTypes: known });
  assert(!h.confident && h.adds.length === 0 && !h.wire, "a flat distribution leaves lists alone");
}

{
  const h = projectHints(
    [
      { action: "add:not-a-node", score: 9 },
      { action: "add:text", score: 1 },
    ],
    { nodeTypes: known, minShare: 0.05, minLead: 1 }
  );
  assert(h.adds.length === 1 && h.adds[0].type === "text", "unknown node types are dropped");
}

{
  assert(liftSuggested(["llm", "image", "text"], ["text", "image"]).join(",") === "text,image,llm", "lift order");
  assert(liftSuggested(["llm", "image"], ["music"]) === null, "no overlap means no reorder");
  assert(liftSuggested(["a", "b", "c"], []) === null, "empty suggestions");
  assert(liftSuggested(["a", "b", "c"], ["c", "a"]).join(",") === "c,a,b", "leftover relative order is kept");
  assert(liftSuggested(["a", "b"], ["b", "b", "ghost"]).join(",") === "b,a", "duplicate / unknown suggestions are dropped");
}

{
  assert(predictorDisabled("?na=0"), "na=0 disables");
  assert(predictorDisabled("?product=off"), "product=off disables");
  assert(predictorDisabled("?na=false"), "na=false disables");
  assert(!predictorDisabled(""), "no flag does not disable the engine");
  assert(!predictorDisabled("?product=1"), "legacy product flags do not mount a surface or disable hints");
  assert(!predictorDisabled("?product=6"), "product=6 is not a panel flag anymore");
  const prev = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (k === "nano.nextAction" ? "off" : null) };
  try {
    assert(predictorDisabled(null), "localStorage nano.nextAction=off disables when search is omitted");
    assert(!predictorDisabled("?product=1"), "an explicit search string does not consult localStorage");
  } finally {
    if (prev === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prev;
  }
}

{
  assert(!projectHints(null).confident && !projectHints([]).confident, "empty rows stay quiet");
  assert(!projectHints([{ action: "add:text", score: 0 }]).confident, "zero scores stay quiet");
}

{
  // Winner just under MIN_SHARE (equal-ish pile, nobody clears the bar).
  const rows = [
    { action: "add:text", score: 17 },
    { action: "add:image", score: 17 },
    { action: "add:llm", score: 16 },
    { action: "wire", score: 16 },
    { action: "set:model", score: 17 },
    { action: "run", score: 17 },
  ];
  const sum = rows.reduce((a, r) => a + r.score, 0);
  const topShare = Math.max(...rows.map((r) => r.score)) / sum;
  assert(topShare < MIN_SHARE, `fixture top share ${topShare} should be < MIN_SHARE ${MIN_SHARE}`);
  assert(!projectHints(rows).confident, "a winner below MIN_SHARE must leave every menu unmarked");
}

{
  // Near-tie: top clears MIN_SHARE but does not lead by MIN_LEAD.
  const near = projectHints([
    { action: "add:text", score: 40 },
    { action: "add:image", score: 32 },
  ]);
  const topShare = 40 / 72;
  const secondShare = 32 / 72;
  assert(topShare >= MIN_SHARE && topShare < secondShare * MIN_LEAD, "fixture is a near-tie");
  assert(!near.confident, "a near-tie must not mark menus (MIN_LEAD)");
}

{
  const many = projectHints([
    { action: "add:text", score: 40 },
    { action: "add:image", score: 20 },
    { action: "add:llm", score: 20 },
    { action: "add:music", score: 20 },
  ]);
  assert(many.confident && many.adds.length === MAX_ADDS, `cap Suggested at ${MAX_ADDS}`);
  assert(many.adds.map((a) => a.type).join(",") === "text,image,llm", "adds keep rank order up to the cap");
}

{
  const weakBlend = [
    { action: "add:image", score: 1 },
    { action: "add:text", score: 1 },
  ];
  const strongFreq = [
    { action: "add:text", score: 10 },
    { action: "add:image", score: 1 },
  ];
  const fallback = chooseHints({ frequencyRows: strongFreq, blendRows: weakBlend, nodeTypes: known });
  assert(fallback.confident && fallback.adds[0].type === "text", "a flat blend falls back to a confident frequency prior");
  const strongBlend = [
    { action: "add:image", score: 10 },
    { action: "add:text", score: 1 },
  ];
  const blendWins = chooseHints({ frequencyRows: strongFreq, blendRows: strongBlend, nodeTypes: known });
  assert(blendWins.adds[0].type === "image", "a confident blend wins over frequency");
  assert(!chooseHints({}).confident, "no rows → empty");
}

{
  const onlyEx = projectHints([
    { action: "open:examples", score: 10 },
    { action: "add:text", score: 1 },
  ]);
  assert(onlyEx.confident && onlyEx.openExamples && onlyEx.adds.length === 0, "open:examples can be confident without reordering the add menu");
  const emptyType = projectHints([
    { action: "add:", score: 9 },
    { action: "add:text", score: 1 },
  ], { nodeTypes: known, minShare: 0.05, minLead: 1 });
  assert(emptyType.adds.length === 1 && emptyType.adds[0].type === "text", "add: with an empty type is dropped");
}

{
  const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
  const index = readFileSync(join(ROOT, "index.html"), "utf8");
  for (const needle of ["na-panel", "na-ghost", "placeGhost", "applyTip", "na-tip"]) {
    assert(!surface.includes(needle), `editor-surface still has ${needle}`);
    assert(!index.includes(needle), `index.html still has ${needle}`);
  }
  assert(index.includes('classList.add("likely")'), "wire drag can mark one compatible port");
  assert(index.includes('classList.remove("compatible","snap","likely")'), "likely mark is cleared with the drag");
  assert(index.includes("!picker || !picker.nodeType"), "model picker pin requires the node that opened it");
  assert(
    index.includes("map.order.filter(k => cands.some(([ck]) => ck===k))"),
    "wire-drop Suggested only lists types that already fit the port"
  );
  assert(
    index.includes("eh && eh.openExamples && eh.adds") &&
      index.includes("wantEx.has(exFirst(EXAMPLES[a]))?0:1"),
    "Examples rank only when open:examples is confident"
  );
  assert(surface.includes("chooseHints"), "engine publishes list hints");
  assert(!/function applyTip|id="na-panel"|id="na-ghost"/.test(index), "no standalone next-action widget");
}

console.log("✓ next-action-hints: cold-start text, model-after-image, wire-after-model (no ports), flat=quiet, minShare/minLead, blend fallback, flags");
