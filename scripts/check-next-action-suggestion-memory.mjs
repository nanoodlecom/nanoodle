#!/usr/bin/env node
/**
 * Suggested adds the user keeps passing over sink. Accepted ones rise a little.
 * Local storage only. Disabled hints do not record or reweight.
 */
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_VOCAB, NODE_TYPES } from "../vendor/next-action/encode.mjs";
import { recommendFrequency } from "../vendor/next-action/frequency.mjs";
import { recommendNext } from "../vendor/next-action/recommend.mjs";
import { chooseHints } from "../vendor/next-action/hints.mjs";
import { createSuggestionMemory, STORAGE_KEY } from "../vendor/next-action/suggestion-memory.mjs";
import { packWeights, createSession } from "../vendor/smallnet/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-suggestion-memory: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

function mockStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

const tables = JSON.parse(readFileSync(join(NA, "corpus", "frequency-tables.json"), "utf8"));
const fix = JSON.parse(readFileSync(join(NA, "fixtures", "smoke-weights.json"), "utf8"));
const layers = fix.layers.map((L) => ({ W: Float32Array.from(L.W), b: Float32Array.from(L.b) }));
const session = createSession(fix.manifest, packWeights(fix.manifest, layers));
const known = new Set(NODE_TYPES);
const sketch = { numNodes: 1, nodeTypeCounts: { text: 1 } };
const history = ["add:text"];

function ranked(memory) {
  const frequencyRows = memory.reweightRows(
    recommendFrequency(tables, history, sketch, ACTION_VOCAB.length)
  );
  const blendRows = memory.reweightRows(
    recommendNext({ tables, session, blend: 0.35 }, history, sketch, ACTION_VOCAB.length)
  );
  return chooseHints({
    frequencyRows,
    blendRows,
    nodeTypes: known,
    sketch,
    coldStart: false,
  });
}

{
  const store = mockStorage();
  const off = createSuggestionMemory({ storage: store, enabled: false });
  assert(off.noteChoice("add:image", ["add:text"]) === false, "disabled choice is not recorded");
  assert(store.getItem(STORAGE_KEY) == null, "disabled memory does not write storage");
  const rows = [{ action: "add:text", score: 10 }, { action: "add:image", score: 4 }];
  assert(off.reweightRows(rows) === rows, "disabled memory does not reweight");
  assert(off.boost("add:text") === 1, "disabled boost is 1");
}

{
  const store = mockStorage();
  const mem = createSuggestionMemory({ storage: store });
  const before = ranked(mem);
  assert(before.confident && before.adds[0] && before.adds[0].type === "text", "a fresh memory still suggests text after a text node");
  assert(mem.noteChoice("add:llm", ["add:text"]) === true, "passing over the suggestion records");
  assert(mem.arm("add:text").ignores === 1 && mem.arm("add:text").accepts === 0, "the passed-over row is an ignore");
  assert(mem.noteChoice("wire", []) === false, "a menu with no suggestion records nothing");
  for (let i = 0; i < 3; i++) mem.noteChoice("add:image", ["add:text"]);
  assert(mem.arm("add:text").ignores === 4, "repeated passes accumulate");
  const after = ranked(mem);
  assert(after.confident && after.adds[0] && after.adds[0].type === "image", `ignored text sinks below image, got ${after.adds.map((a) => a.type).join(",")}`);
  assert(after.adds[0].reason === "often added next", "the reason stays the existing add reason");
  const again = createSuggestionMemory({ storage: store });
  assert(again.arm("add:text").ignores === 4, "ignores survive a reload");
  const beforeAccept = again.boost("add:image");
  again.noteChoice("add:image", ["add:image", "add:text"]);
  assert(again.arm("add:image").accepts === 1, "picking the suggested row is an accept");
  assert(again.arm("add:text").ignores === 5, "the other shown suggestion is still an ignore");
  assert(again.boost("add:image") > beforeAccept, "an accept raises that row");
}

{
  const src = readFileSync(join(NA, "suggestion-memory.mjs"), "utf8");
  const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
  const index = readFileSync(join(ROOT, "index.html"), "utf8");
  assert(!src.includes("fetch(") && !src.includes("http://") && !src.includes("https://"), "memory makes no network call");
  assert(surface.includes("reweightRows"), "the engine reweights before it publishes");
  assert(surface.includes("noteChoice"), "the engine exposes the choice hook");
  assert(surface.includes("predictorDisabled"), "disable flags still gate the engine");
  const addClick = index.slice(index.indexOf("$(\"addlist\").addEventListener(\"click\""), index.indexOf("$(\"addlist\").addEventListener(\"click\"") + 400);
  const quick = index.slice(index.indexOf("pop.querySelectorAll(\"button\")"), index.indexOf("pop.querySelectorAll(\"button\")") + 500);
  assert(addClick.includes("noteChoice"), "the add menu records the pick");
  assert(quick.includes("noteChoice"), "wire-drop quick-add records the pick");
  assert(!index.includes("bandit") && !index.includes("na-panel") && !index.includes("Mess up"), "no bandit chrome");
}

console.log("✓ next-action-suggestion-memory: ignored suggestions sink, accepted ones rise, disabled stays quiet");
