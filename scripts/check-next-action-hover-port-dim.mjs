#!/usr/bin/env node
/**
 * Product · 41 — hover-port peer dim toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIN_PAIR,
  MIN_LEAD,
  MIN_SHARE,
  rankHoverPeers,
  tierFor,
  classesForTier,
  shouldDim,
  peerScore,
  typeToTypeCount,
} from "../vendor/next-action/hover-port-dim.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-hover-port-dim: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "hover-port-dim.mjs")), "missing hover-port-dim.mjs");
assert(existsSync(CORPUS), "missing port-suggest.json");

const tables = JSON.parse(readFileSync(CORPUS, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");
const helper = readFileSync(join(NA, "hover-port-dim.mjs"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  toy("gates-exported", MIN_PAIR >= 2 && MIN_LEAD > 1 && MIN_SHARE > 0, `pair=${MIN_PAIR} lead=${MIN_LEAD} share=${MIN_SHARE}`);
  toy(
    "typeToType-text-image",
    typeToTypeCount(tables, "out", "text", "image") >= MIN_PAIR,
    `n=${typeToTypeCount(tables, "out", "text", "image")}`
  );
  const promptScore = peerScore(tables, "out", "text", "text", { type: "image", port: "prompt" });
  const modelScore = peerScore(tables, "out", "text", "text", { type: "image", port: "model" });
  toy(
    "peerScore-text-to-image-prompt",
    promptScore >= MIN_PAIR * 100,
    `score=${promptScore}`
  );
  toy(
    "peerScore-prompt-beats-model-type-only",
    promptScore > modelScore,
    `prompt=${promptScore} model=${modelScore}`
  );
}

{
  // text.text → image.prompt (8) leads llm.prompt (3)
  const plan = rankHoverPeers(tables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    srcNodeId: "t1",
    srcPtype: "text",
    peers: [
      { nodeId: "img1", type: "image", port: "prompt", dir: "in", ptype: "text" },
      { nodeId: "llm1", type: "llm", port: "prompt", dir: "in", ptype: "text" },
      { nodeId: "vid1", type: "ivideo", port: "image", dir: "in", ptype: "image" },
      { nodeId: "aud1", type: "audio", port: "audio", dir: "in", ptype: "audio" },
      { nodeId: "t2", type: "text", port: "text", dir: "out", ptype: "text" }, // same-dir ignored
    ],
  });
  toy("confident-plan", !!plan && plan.items.length >= 1, plan ? `n=${plan.items.length}` : "null");
  toy(
    "likely-is-image-prompt",
    !!(plan && plan.items[0].tier === "likely" && plan.items[0].type === "image" && plan.items[0].port === "prompt"),
    plan ? `${plan.items[0].type}.${plan.items[0].port}:${plan.items[0].tier}` : "—"
  );
  toy("lifts-compatible-llm", !!(plan && plan.items.some((i) => i.type === "llm" && i.tier === "compatible")), "llm lifted");
  toy("dimIncompatible", !!(plan && plan.dimIncompatible), String(!!(plan && plan.dimIncompatible)));
  toy(
    "dims-image-ptype-peer",
    !!(plan && plan.dim.some((d) => d.nodeId === "vid1" && d.port === "image")),
    "vid dimmed"
  );
  toy(
    "dims-audio-peer",
    !!(plan && plan.dim.some((d) => d.nodeId === "aud1")),
    "audio dimmed"
  );
  toy(
    "same-dir-not-dimmed",
    !!(plan && !plan.dim.some((d) => d.nodeId === "t2")),
    "same-dir skipped"
  );
  toy("tierFor-likely", tierFor(plan, "img1", "prompt") === "likely", String(tierFor(plan, "img1", "prompt")));
  toy("shouldDim-incompatible", shouldDim(plan, "vid1", "image") === true, "vid");
  toy("shouldDim-lifted-false", shouldDim(plan, "img1", "prompt") === false, "lifted");
  toy(
    "classesForTier",
    classesForTier("likely").join() === "compatible,likely" &&
      classesForTier("compatible").join() === "compatible" &&
      classesForTier(null).length === 0,
    "class map"
  );
}

{
  const flatTables = {
    topTargets: {
      "text|text": { "llm|prompt": 3, "image|prompt": 3 },
    },
    typeToType: { "text→llm": 3, "text→image": 3 },
  };
  const plan = rankHoverPeers(flatTables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    srcPtype: "text",
    peers: [
      { nodeId: "a", type: "llm", port: "prompt", dir: "in", ptype: "text" },
      { nodeId: "b", type: "image", port: "prompt", dir: "in", ptype: "text" },
    ],
  });
  toy("flat-quiet", plan === null, plan ? "leaked" : "null");
}

{
  const plan = rankHoverPeers(tables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    srcPtype: "text",
    peers: [],
  });
  toy("empty-peers-quiet", plan === null, "null");
}

{
  const plan = rankHoverPeers(null, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    srcPtype: "text",
    peers: [{ nodeId: "a", type: "image", port: "prompt", dir: "in", ptype: "text" }],
  });
  toy("no-tables-quiet", plan === null, "null");
}

{
  const weak = {
    topTargets: { "text|text": { "image|prompt": 1 } },
    typeToType: { "text→image": 1 },
  };
  const plan = rankHoverPeers(weak, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    srcPtype: "text",
    peers: [{ nodeId: "a", type: "image", port: "prompt", dir: "in", ptype: "text" }],
  });
  toy("below-min-pair-quiet", plan === null, plan ? "leaked" : "null");
}

{
  // Only incompatible peers → quiet (nothing to lift)
  const plan = rankHoverPeers(tables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    srcPtype: "text",
    peers: [
      { nodeId: "v1", type: "ivideo", port: "image", dir: "in", ptype: "image" },
    ],
  });
  toy("no-compatible-quiet", plan === null, plan ? "leaked" : "null");
}

{
  // Inbound hover: image.prompt ← text.text
  const plan = rankHoverPeers(tables, {
    dir: "in",
    srcType: "image",
    srcPort: "prompt",
    srcNodeId: "img1",
    srcPtype: "text",
    peers: [
      { nodeId: "t1", type: "text", port: "text", dir: "out", ptype: "text" },
      { nodeId: "llm1", type: "llm", port: "text", dir: "out", ptype: "text" },
      { nodeId: "r1", type: "resize", port: "image", dir: "out", ptype: "image" },
    ],
  });
  toy("inbound-plan", !!plan && plan.items.some((i) => i.tier === "likely"), plan ? plan.items.map((i) => i.type + "." + i.port + ":" + i.tier).join(",") : "null");
  toy(
    "inbound-dims-image-out",
    !!(plan && plan.dim.some((d) => d.nodeId === "r1")),
    "resize dimmed"
  );
}

{
  toy("helper-exports-rank", /export function rankHoverPeers/.test(helper), "rankHoverPeers");
  toy("helper-uses-pairCount", /pairCount/.test(helper), "pairCount");
  toy("helper-uses-typeToType", /typeToType/.test(helper), "typeToType");
  toy("helper-uses-gates", /MIN_PAIR/.test(helper) && /MIN_LEAD/.test(helper) && /MIN_SHARE/.test(helper), "gates");
}

// Editor wiring pins
{
  toy("html-has-dim-css", /\.port\.dim\s*\{/.test(index), ".port.dim");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,280}\.port\.dim|\.port\.dim[\s\S]{0,280}prefers-reduced-motion|hoverPortDimReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-applyHoverPortDim", index.includes("applyHoverPortDim"), "apply fn");
  toy("html-clearHoverPortDim", index.includes("clearHoverPortDim"), "clear fn");
  toy("html-rankHoverPeers-call", /rankHoverPeers\s*\(/.test(index), "call site");
  toy("html-import", /hover-port-dim\.mjs/.test(index), "import");
  toy(
    "html-pointerover-bind",
    /addEventListener\(\s*["']pointerover["']/.test(index) && /applyHoverPortDim/.test(index),
    "pointerover"
  );
  toy(
    "html-pointerout-bind",
    /addEventListener\(\s*["']pointerout["']/.test(index) && /clearHoverPortDim/.test(index),
    "pointerout"
  );
  toy(
    "html-startWire-clears",
    /function startWire[\s\S]{0,260}clearHoverPortDim/.test(index),
    "startWire clear"
  );
  toy(
    "html-geoOn-gate",
    /function applyHoverPortDim[\s\S]{0,500}geoOn/.test(index),
    "geoOn"
  );
  toy(
    "html-tempWire-quiet",
    /function applyHoverPortDim[\s\S]{0,400}tempWire/.test(index),
    "tempWire quiet"
  );
  toy(
    "html-uses-compatible-likely",
    /na-hover-lift/.test(index) && /classList\.add\(["']compatible["']/.test(index),
    "lift classes"
  );
  toy(
    "surface-exports-rankHoverPeers",
    /rankHoverPeers\(query\)/.test(surface) && /from "\.\/hover-port-dim\.mjs"/.test(surface),
    "editor-surface"
  );
  toy(
    "readme-mentions-41",
    /·\s*41|Product · 41|hover-port-dim/.test(readme),
    "README · 41"
  );
  toy(
    "readme-check-script",
    readme.includes("check-next-action-hover-port-dim.mjs"),
    "README check"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?41/.test(index) && !/\?product=41/.test(index),
    "no ?product=41"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-41-usage.gif")),
    "product-41-usage.gif"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\nhover-port-dim toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  const hard = failed.filter((f) => f.name !== "usage-gif-present");
  if (hard.length) fail(hard.map((f) => f.name).join(", "));
  console.warn("⚠ usage gif missing — capture next");
  process.exit(2);
}
console.log("✓ next-action-hover-port-dim");
