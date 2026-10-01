#!/usr/bin/env node
/**
 * Product · 50 — orphan-output consumer pulse toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "../vendor/next-action/port-suggest.mjs";
import {
  pickOrphanOutPulse,
  priorConfident,
  outMass,
  idSet,
  DEFAULT_TTL_MS,
} from "../vendor/next-action/orphan-out-pulse.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-orphan-out-pulse: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "orphan-out-pulse.mjs")), "missing orphan-out-pulse.mjs");
assert(existsSync(CORPUS), "missing port-suggest.json");

const tables = JSON.parse(readFileSync(CORPUS, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");
const helper = readFileSync(join(NA, "orphan-out-pulse.mjs"), "utf8");

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
  const s = idSet(["a", 2, null, "", "a"]);
  toy("idSet-dedup", s.size === 2 && s.has("a") && s.has("2"), [...s].join(","));
  toy("idSet-empty", idSet(null).size === 0 && idSet([]).size === 0, "empty");
}

// --- priorConfident / outMass ---
{
  const textOut = { nodeId: "t1", port: "text", type: "text" };
  toy("prior-text-confident", priorConfident(tables, textOut), "text|text");
  toy(
    "prior-comment-quiet",
    !priorConfident(tables, { nodeId: "c1", port: "note", type: "comment" }),
    "comment"
  );
  const weak = {
    topTargets: { "text|text": { "image|prompt": 1 } },
    portCatalog: tables.portCatalog,
  };
  toy(
    "prior-below-min-quiet",
    !priorConfident(weak, textOut),
    "weak"
  );
  const flat = {
    topTargets: {
      "text|text": { "llm|prompt": 4, "image|prompt": 4 },
    },
    portCatalog: tables.portCatalog,
  };
  toy("prior-flat-quiet", !priorConfident(flat, textOut), "flat tied");
  const mass = outMass(tables, textOut, [
    { nodeId: "img1", port: "prompt", type: "image" },
  ]);
  toy("outMass-text-image", mass >= MIN_PAIR, `mass=${mass}`);
  toy("outMass-no-prior", outMass(null, textOut, []) === 0, "0");
}

// --- pick: text seed orphan after run (image consumer present but unwired) ---
{
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
  };
  const pick = pickOrphanOutPulse(tables, graph, { seedIds: ["t1"], okIds: ["t1"] });
  toy("seed-text-picks", !!pick, pick ? `${pick.type}.${pick.port}` : "null");
  toy(
    "seed-text-identity",
    !!(pick && pick.nodeId === "t1" && pick.port === "text" && pick.dir === "out"),
    pick ? `${pick.nodeId}.${pick.port}` : "—"
  );
  toy("seed-scope", !!(pick && pick.scope === "seed"), pick ? pick.scope : "—");
  toy("seed-share", !!(pick && pick.share >= MIN_SHARE), pick ? `share=${pick.share.toFixed(3)}` : "—");
  toy("seed-min-pair", !!(pick && pick.count >= MIN_PAIR), pick ? `count=${pick.count}` : "—");
}

// --- prefer seed over other ok ---
{
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
      { id: "llm1", type: "llm" },
    ],
    links: [],
  };
  // Seed is text (confident orphan); llm also ok — must stay on seed
  const pick = pickOrphanOutPulse(tables, graph, {
    seedIds: ["t1"],
    okIds: ["t1", "llm1"],
  });
  toy(
    "prefer-seed-text",
    !!(pick && pick.nodeId === "t1" && pick.port === "text" && pick.scope === "seed"),
    pick ? `${pick.nodeId}.${pick.port} scope=${pick.scope}` : "null"
  );
}

// --- fall back to ok participant when seed has no orphan ---
{
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "llm1", type: "llm" },
      { id: "img1", type: "image" },
    ],
    // Seed text already wired → no orphan on seed; llm text still orphan + confident
    links: [{ from: { node: "t1", port: "text" }, to: { node: "img1", port: "prompt" } }],
  };
  const pick = pickOrphanOutPulse(tables, graph, {
    seedIds: ["t1"],
    okIds: ["t1", "llm1"],
  });
  toy(
    "fallback-ok-llm",
    !!(pick && pick.nodeId === "llm1" && pick.port === "text" && pick.scope === "ok"),
    pick ? `${pick.nodeId}.${pick.port} scope=${pick.scope}` : "null"
  );
}

// --- allowOkFallback false → quiet when seed wired ---
{
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [{ from: { node: "t1", port: "text" }, to: { node: "img1", port: "prompt" } }],
  };
  const pick = pickOrphanOutPulse(tables, graph, {
    seedIds: ["t1"],
    okIds: ["t1", "img1"],
    allowOkFallback: false,
  });
  toy("no-ok-fallback-quiet", pick === null, pick ? "leaked" : "null");
}

// --- never graph-wide idle (no seed/ok) ---
{
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
  };
  toy(
    "no-ids-quiet",
    pickOrphanOutPulse(tables, graph, {}) === null,
    "null"
  );
  toy(
    "empty-seeds-empty-ok-quiet",
    pickOrphanOutPulse(tables, graph, { seedIds: [], okIds: [] }) === null,
    "null"
  );
}

// --- wired seed out not picked ---
{
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [{ from: { node: "t1", port: "text" }, to: { node: "img1", port: "prompt" } }],
  };
  const pick = pickOrphanOutPulse(tables, graph, { seedIds: ["t1"], okIds: ["t1"] });
  toy(
    "wired-seed-no-orphan",
    pick === null,
    pick ? `${pick.nodeId}.${pick.port}` : "null"
  );
}

// --- flat / weak quiet ---
{
  const flat = {
    topTargets: {
      "text|text": { "llm|prompt": 5, "image|prompt": 5 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
    },
  };
  const pick = pickOrphanOutPulse(flat, {
    nodes: [
      { id: "t1", type: "text" },
      { id: "a", type: "llm" },
      { id: "b", type: "image" },
    ],
    links: [],
  }, { seedIds: ["t1"], okIds: ["t1"] });
  toy("flat-quiet", pick === null, pick ? "leaked" : "null");

  const weak = {
    topTargets: { "text|text": { "image|prompt": 1 } },
    portCatalog: flat.portCatalog,
  };
  toy(
    "below-min-pair-quiet",
    pickOrphanOutPulse(weak, {
      nodes: [
        { id: "t1", type: "text" },
        { id: "img1", type: "image" },
      ],
      links: [],
    }, { seedIds: ["t1"], okIds: ["t1"] }) === null,
    "null"
  );
}

// --- no tables / empty graph ---
{
  toy(
    "no-tables-quiet",
    pickOrphanOutPulse(null, {
      nodes: [
        { id: "a", type: "text" },
        { id: "b", type: "image" },
      ],
      links: [],
    }, { seedIds: ["a"], okIds: ["a"] }) === null,
    "null"
  );
  toy(
    "empty-graph-quiet",
    pickOrphanOutPulse(tables, { nodes: [], links: [] }, { seedIds: ["x"], okIds: ["x"] }) === null,
    "null"
  );
}

// --- comment seed ignored by danglingPorts ---
{
  const graph = {
    nodes: [
      { id: "c1", type: "comment" },
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
  };
  const pick = pickOrphanOutPulse(tables, graph, {
    seedIds: ["c1"],
    okIds: ["c1", "t1"],
  });
  // Seed comment has no outs → fall back to ok text
  toy(
    "comment-seed-fallback-text",
    !!(pick && pick.nodeId === "t1" && pick.scope === "ok"),
    pick ? `${pick.nodeId} scope=${pick.scope}` : "null"
  );
}

// --- llm seed orphan text out ---
{
  const graph = {
    nodes: [
      { id: "llm1", type: "llm" },
      { id: "img1", type: "image" },
    ],
    links: [],
  };
  const pick = pickOrphanOutPulse(tables, graph, {
    seedIds: ["llm1"],
    okIds: ["llm1"],
  });
  toy(
    "llm-seed-text-out",
    !!(pick && pick.nodeId === "llm1" && pick.port === "text"),
    pick ? `${pick.nodeId}.${pick.port} count=${pick.count}` : "null"
  );
}

// --- two equal orphan outs on same seed → lead/share gate ---
{
  // Synthetic: two outs with equal mass → quiet
  const synth = {
    topTargets: {
      "dual|a": { "sink|in": 6 },
      "dual|b": { "sink|in": 6 },
    },
    portCatalog: {
      dual: { inputs: [], outputs: ["a", "b"] },
      sink: { inputs: ["in"], outputs: [] },
    },
  };
  const pick = pickOrphanOutPulse(synth, {
    nodes: [
      { id: "d1", type: "dual" },
      { id: "s1", type: "sink" },
    ],
    links: [],
  }, { seedIds: ["d1"], okIds: ["d1"] });
  toy("tied-dual-outs-quiet", pick === null, pick ? "leaked" : "null");
}

// --- clear winner among dual outs ---
{
  const synth = {
    topTargets: {
      "dual|a": { "sink|in": 10 },
      "dual|b": { "sink|in": 2 },
    },
    portCatalog: {
      dual: { inputs: [], outputs: ["a", "b"] },
      sink: { inputs: ["in"], outputs: [] },
    },
  };
  const pick = pickOrphanOutPulse(synth, {
    nodes: [
      { id: "d1", type: "dual" },
      { id: "s1", type: "sink" },
    ],
    links: [],
  }, { seedIds: ["d1"], okIds: ["d1"] });
  toy(
    "dual-clear-winner-a",
    !!(pick && pick.port === "a" && pick.count === 10),
    pick ? `${pick.port} count=${pick.count}` : "null"
  );
}

// --- helper docs / distinctness ---
{
  toy("helper-mentions-50", /Product · 50|orphan-output/.test(helper), "header");
  toy("helper-distinct-22", /Distinct from · 22|· 22/.test(helper), "vs ·22");
  toy("helper-distinct-45", /· 45/.test(helper), "vs ·45");
  toy("helper-uses-danglingPorts", /danglingPorts/.test(helper), "danglingPorts");
  toy("helper-tight-scope", /Never fall back to arbitrary|never graph-wide|Never graph-wide/i.test(helper), "scope");
}

// --- Editor wiring pins ---
{
  toy("html-has-css", /\.port\.na-orphan-out-pulse\s*\{/.test(index), ".port.na-orphan-out-pulse");
  toy("html-has-compatible", /\.port\.na-orphan-out-pulse\.compatible\s*\{/.test(index), ".compatible");
  toy("html-has-keyframes", /@keyframes\s+naOrphanOutPulse/.test(index), "naOrphanOutPulse");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,200}na-orphan-out-pulse/.test(index) ||
      /na-orphan-out-pulse[\s\S]{0,200}prefers-reduced-motion/.test(index) ||
      /orphanOutPulseReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-clearOrphanOutPulse", index.includes("clearOrphanOutPulse"), "fn");
  toy("html-applyOrphanOutPulse", index.includes("applyOrphanOutPulse"), "fn");
  toy("html-scheduleOrphanOutPulse", index.includes("scheduleOrphanOutPulse"), "fn");
  toy("html-pickOrphanOutPulse-call", /pickOrphanOutPulse\s*\(/.test(index), "call site");
  toy("html-startWire-clears", /function startWire[\s\S]{0,220}clearOrphanOutPulse/.test(index), "startWire clears");
  toy("html-run-schedules", /runGroup[\s\S]{0,2500}scheduleOrphanOutPulse/.test(index), "run schedules");
  toy("html-connect-clears", /connect\s*=\s*function[\s\S]{0,350}clearOrphanOutPulse/.test(index), "connect clears");
  toy("html-select-clears", /select\s*=\s*function[\s\S]{0,250}clearOrphanOutPulse/.test(index), "select clears");
  toy("html-add-clears", /addNode\s*=\s*function[\s\S]{0,250}clearOrphanOutPulse/.test(index), "add clears");
  toy(
    "surface-exports-pickOrphanOutPulse",
    /pickOrphanOutPulse\(query\)/.test(surface) && /from "\.\/orphan-out-pulse\.mjs"/.test(surface),
    "editor-surface"
  );
  toy(
    "readme-mentions-50",
    /·\s*50|Product · 50|orphan-out-pulse/.test(readme),
    "README · 50"
  );
  toy(
    "readme-lists-check",
    readme.includes("check-next-action-orphan-out-pulse.mjs"),
    "check listing"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?50/.test(index) && !/\?product=50/.test(index),
    "no ?product=50"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-50-usage.gif")),
    "product-50-usage.gif"
  );
  toy(
    "distinct-class",
    index.includes("na-orphan-out-pulse") && !index.includes("na-orphan-out-pulse-panel"),
    "distinct .na-orphan-out-pulse"
  );
  // Must not depend on dirty ·22–·47 modules
  toy(
    "no-dangling-nudge-import",
    !/dangling-nudge\.mjs/.test(surface) && !/from "\.\/dangling-nudge/.test(helper),
    "self-contained"
  );
  toy(
    "no-settled-run-next-add-import",
    !/settled-run-next-add\.mjs/.test(surface),
    "no ·45 import"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\norphan-out-pulse toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  // Allow GIF missing until capture — fail only if others fail, but we want GIF.
  fail(failed.map((f) => f.name).join(", "));
}
console.log("✓ next-action-orphan-out-pulse");
