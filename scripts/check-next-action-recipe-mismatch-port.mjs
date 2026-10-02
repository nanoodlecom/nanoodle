#!/usr/bin/env node
/**
 * Product · 51 — recipe-mismatch port pulse toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "../vendor/next-action/port-suggest.mjs";
import {
  pickRecipeMismatchPort,
  pickRecipeExpectedPort,
  pickNaiveNextDangling,
  frontierType,
  graphTypeMultiset,
  outMassIntoType,
  outMassRaw,
  DEFAULT_TTL_MS,
} from "../vendor/next-action/recipe-mismatch-port.mjs";
import { confidentRecipe } from "../vendor/next-action/recipe.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");
const RECIPES = join(NA, "corpus", "recipes.json");

function fail(msg) {
  console.error(`✗ next-action-recipe-mismatch-port: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "recipe-mismatch-port.mjs")), "missing recipe-mismatch-port.mjs");
assert(existsSync(CORPUS), "missing port-suggest.json");
assert(existsSync(RECIPES), "missing recipes.json");

const tables = JSON.parse(readFileSync(CORPUS, "utf8"));
const recipes = JSON.parse(readFileSync(RECIPES, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");
const helper = readFileSync(join(NA, "recipe-mismatch-port.mjs"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

// --- gates / utils ---
{
  toy("gates-exported", MIN_PAIR >= 2 && MIN_LEAD > 1 && MIN_SHARE > 0, `pair=${MIN_PAIR} lead=${MIN_LEAD} share=${MIN_SHARE}`);
  toy("ttl-default", DEFAULT_TTL_MS >= 2000 && DEFAULT_TTL_MS <= 5000, `ttl=${DEFAULT_TTL_MS}`);
  const ms = graphTypeMultiset({
    nodes: [
      { id: "a", type: "text" },
      { id: "b", type: "llm" },
      { id: "c", type: "comment" },
    ],
  });
  toy("multiset-skips-comment", ms.text === 1 && ms.llm === 1 && !ms.comment, JSON.stringify(ms));
  toy(
    "frontier-text-llm",
    frontierType(["text", "llm", "image", "resize"], { text: 1, llm: 1 }) === "llm",
    "llm"
  );
  toy(
    "frontier-empty",
    frontierType(["text", "llm"], {}) === null,
    "null"
  );
}

// --- masses ---
{
  const textOut = { nodeId: "t1", port: "text", type: "text" };
  const llmOut = { nodeId: "l1", port: "text", type: "llm" };
  const tMass = outMassIntoType(tables, textOut, "image");
  const lMass = outMassIntoType(tables, llmOut, "image");
  toy("mass-text-into-image", tMass >= MIN_PAIR, `text→image=${tMass}`);
  toy("mass-llm-into-image", lMass >= MIN_PAIR, `llm→image=${lMass}`);
  toy("mass-text-beats-llm", tMass > lMass, `${tMass}>${lMass}`);
  toy("raw-text-mass", outMassRaw(tables, textOut) >= MIN_PAIR, `raw=${outMassRaw(tables, textOut)}`);
  toy("mass-null-tables", outMassIntoType(null, textOut, "image") === 0, "0");
}

// --- core mismatch: text+llm unwired, recipe next=image ---
{
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "l1", type: "llm" },
    ],
    links: [],
  };
  const recipe = confidentRecipe(recipes, { nodeTypeCounts: { text: 1, llm: 1 }, numNodes: 2 });
  toy("recipe-confident", !!(recipe && recipe.type === "image"), recipe ? `${recipe.slug}→${recipe.type}` : "null");

  const expected = pickRecipeExpectedPort(tables, graph, recipe, recipes);
  toy(
    "expected-llm-text",
    !!(expected && expected.nodeId === "l1" && expected.port === "text" && expected.frontier === "llm"),
    expected ? `${expected.nodeId}.${expected.port} frontier=${expected.frontier}` : "null"
  );

  const naive = pickNaiveNextDangling(tables, graph);
  toy(
    "naive-text-text",
    !!(naive && naive.nodeId === "t1" && naive.port === "text"),
    naive ? `${naive.nodeId}.${naive.port} count=${naive.count}` : "null"
  );

  const pick = pickRecipeMismatchPort(tables, recipes, graph);
  toy("mismatch-picks", !!pick, pick ? `${pick.nodeId}.${pick.port}` : "null");
  toy(
    "mismatch-pulses-expected",
    !!(pick && pick.nodeId === "l1" && pick.port === "text" && pick.dir === "out"),
    pick ? `${pick.nodeId}.${pick.port}` : "—"
  );
  toy(
    "mismatch-reports-naive",
    !!(pick && pick.naive && pick.naive.nodeId === "t1" && pick.naive.port === "text"),
    pick?.naive ? `${pick.naive.nodeId}.${pick.naive.port}` : "—"
  );
  toy("mismatch-recipe-slug", !!(pick && pick.recipeSlug), pick ? pick.recipeSlug : "—");
  toy("mismatch-next-type", !!(pick && pick.nextType === "image"), pick ? pick.nextType : "—");
  toy("mismatch-share", !!(pick && pick.share >= MIN_SHARE), pick ? `share=${pick.share.toFixed(3)}` : "—");
}

// --- wired text→llm fits (naive == expected) → quiet ---
{
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "l1", type: "llm" },
    ],
    links: [{ from: { node: "t1", port: "text" }, to: { node: "l1", port: "prompt" } }],
  };
  const pick = pickRecipeMismatchPort(tables, recipes, graph);
  // Only llm.text dangling among outs with mass → naive == expected → quiet
  toy("wired-fits-quiet", pick === null, pick ? `${pick.nodeId}.${pick.port}` : "null");
}

// --- no recipe (single text) → quiet ---
{
  const graph = {
    nodes: [{ id: "t1", type: "text" }],
    links: [],
  };
  toy(
    "thin-cover-quiet",
    pickRecipeMismatchPort(tables, recipes, graph) === null,
    "null"
  );
}

// --- empty / no tables ---
{
  toy(
    "no-tables-quiet",
    pickRecipeMismatchPort(null, recipes, {
      nodes: [
        { id: "t1", type: "text" },
        { id: "l1", type: "llm" },
      ],
      links: [],
    }) === null,
    "null"
  );
  toy(
    "empty-graph-quiet",
    pickRecipeMismatchPort(tables, recipes, { nodes: [], links: [] }) === null,
    "null"
  );
  toy(
    "no-recipes-quiet",
    pickRecipeMismatchPort(tables, { recipes: [] }, {
      nodes: [
        { id: "t1", type: "text" },
        { id: "l1", type: "llm" },
      ],
      links: [],
    }) === null,
    "null"
  );
}

// --- flat / tied expected outs → quiet ---
{
  const synthPort = {
    topTargets: {
      "dual|a": { "image|prompt": 6 },
      "dual|b": { "image|prompt": 6 },
      "text|text": { "image|prompt": 10 },
    },
    portCatalog: {
      dual: { inputs: [], outputs: ["a", "b"] },
      text: { inputs: [], outputs: ["text"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
    },
  };
  // Force frontier=dual with a synthetic recipe corpus
  const synthRecipes = {
    recipes: [
      {
        id: "synth",
        slug: "synth",
        title: "Synth",
        sequence: ["text", "dual", "image"],
        multiset: { text: 1, dual: 1, image: 1 },
      },
    ],
  };
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "d1", type: "dual" },
    ],
    links: [],
  };
  const expected = pickRecipeExpectedPort(synthPort, graph, { type: "image", slug: "synth" }, synthRecipes);
  toy("tied-frontier-outs-quiet", expected === null, expected ? "leaked" : "null");
}

// --- clear winner among frontier outs ---
{
  const synthPort = {
    topTargets: {
      "dual|a": { "image|prompt": 10 },
      "dual|b": { "image|prompt": 2 },
      "text|text": { "image|prompt": 20 },
    },
    portCatalog: {
      dual: { inputs: [], outputs: ["a", "b"] },
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
    },
  };
  const synthRecipes = {
    recipes: [
      {
        id: "synth2",
        slug: "synth2",
        title: "Synth2",
        sequence: ["text", "dual", "image"],
        multiset: { text: 1, dual: 1, image: 1 },
      },
    ],
  };
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "d1", type: "dual" },
    ],
    links: [],
  };
  const expected = pickRecipeExpectedPort(synthPort, graph, { type: "image", slug: "synth2" }, synthRecipes);
  toy(
    "frontier-clear-winner-a",
    !!(expected && expected.port === "a" && expected.count === 10),
    expected ? `${expected.port} count=${expected.count}` : "null"
  );
  const pick = pickRecipeMismatchPort(synthPort, synthRecipes, graph);
  toy(
    "synth-mismatch-pulses-a",
    !!(pick && pick.port === "a" && pick.naive && pick.naive.type === "text"),
    pick ? `${pick.nodeId}.${pick.port} vs ${pick.naive?.type}.${pick.naive?.port}` : "null"
  );
}

// --- helper docs / distinctness ---
{
  toy("helper-mentions-51", /Product · 51|recipe-mismatch/.test(helper), "header");
  toy("helper-distinct-22", /· 22/.test(helper), "vs ·22");
  toy("helper-distinct-45", /· 45/.test(helper), "vs ·45");
  toy("helper-distinct-49", /· 49/.test(helper), "vs ·49");
  toy("helper-distinct-50", /· 50/.test(helper), "vs ·50");
  toy("helper-uses-confidentRecipe", /confidentRecipe/.test(helper), "confidentRecipe");
  toy("helper-uses-danglingPorts", /danglingPorts/.test(helper), "danglingPorts");
}

// --- Editor wiring pins ---
{
  toy("html-has-css", /\.port\.na-recipe-mismatch-port\s*\{/.test(index), ".port.na-recipe-mismatch-port");
  toy("html-has-compatible", /\.port\.na-recipe-mismatch-port\.compatible\s*\{/.test(index), ".compatible");
  toy("html-has-keyframes", /@keyframes\s+naRecipeMismatchPort/.test(index), "naRecipeMismatchPort");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,200}na-recipe-mismatch-port/.test(index) ||
      /na-recipe-mismatch-port[\s\S]{0,200}prefers-reduced-motion/.test(index) ||
      /recipeMismatchReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-clearRecipeMismatchPort", index.includes("clearRecipeMismatchPort"), "fn");
  toy("html-applyRecipeMismatchPort", index.includes("applyRecipeMismatchPort"), "fn");
  toy("html-scheduleRecipeMismatchPort", index.includes("scheduleRecipeMismatchPort"), "fn");
  toy("html-pickRecipeMismatchPort-call", /pickRecipeMismatchPort\s*\(/.test(index), "call site");
  toy("html-startWire-clears", /function startWire[\s\S]{0,220}clearRecipeMismatchPort/.test(index), "startWire clears");
  toy("html-add-schedules", /addNode\s*=\s*function[\s\S]{0,450}scheduleRecipeMismatchPort/.test(index), "add schedules");
  toy("html-connect-schedules", /connect\s*=\s*function[\s\S]{0,450}scheduleRecipeMismatchPort/.test(index), "connect schedules");
  toy("html-select-clears", /select\s*=\s*function[\s\S]{0,250}clearRecipeMismatchPort/.test(index), "select clears");
  toy(
    "surface-exports-pickRecipeMismatchPort",
    /pickRecipeMismatchPort\(query\)/.test(surface) && /from "\.\/recipe-mismatch-port\.mjs"/.test(surface),
    "editor-surface"
  );
  toy("surface-hasRecipes", /hasRecipes\s*\(/.test(surface), "hasRecipes");
  toy(
    "readme-mentions-51",
    /·\s*51|Product · 51|recipe-mismatch-port/.test(readme),
    "README · 51"
  );
  toy(
    "readme-lists-check",
    readme.includes("check-next-action-recipe-mismatch-port.mjs"),
    "check listing"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?51/.test(index) && !/\?product=51/.test(index),
    "no ?product=51"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-51-usage.gif")),
    "product-51-usage.gif"
  );
  toy(
    "distinct-class",
    index.includes("na-recipe-mismatch-port") && !index.includes("na-recipe-mismatch-port-panel"),
    "distinct .na-recipe-mismatch-port"
  );
  toy(
    "no-orphan-import",
    !/orphan-out-pulse\.mjs/.test(surface) && !/from "\.\/orphan-out-pulse/.test(helper),
    "self-contained (no ·50)"
  );
  toy(
    "no-dangling-nudge-import",
    !/dangling-nudge\.mjs/.test(surface) && !/from "\.\/dangling-nudge/.test(helper),
    "self-contained (no ·22)"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\nrecipe-mismatch-port toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  fail(failed.map((f) => f.name).join(", "));
}
console.log("✓ next-action-recipe-mismatch-port");
