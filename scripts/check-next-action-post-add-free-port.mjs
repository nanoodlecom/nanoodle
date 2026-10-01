#!/usr/bin/env node
/**
 * Product · 43 — post-add free-port pulse toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "../vendor/next-action/port-suggest.mjs";
import { pickPostAddFreePort } from "../vendor/next-action/post-add-free-port.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-post-add-free-port: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "post-add-free-port.mjs")), "missing post-add-free-port.mjs");
assert(existsSync(CORPUS), "missing port-suggest.json");

const tables = JSON.parse(readFileSync(CORPUS, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  // Lone Text on empty canvas → text out is the clear free-port.
  const graph = {
    nodes: [{ id: "t1", type: "text" }],
    links: [],
  };
  const pick = pickPostAddFreePort(tables, graph, { nodeId: "t1" });
  toy("text-add-picks", !!pick, pick ? `${pick.type}.${pick.port} (${pick.dir})` : "null");
  toy(
    "picks-text-out",
    !!(pick && pick.nodeId === "t1" && pick.port === "text" && pick.dir === "out"),
    pick ? `${pick.nodeId}.${pick.port}/${pick.dir}` : "—"
  );
  toy("has-share", !!(pick && pick.share >= MIN_SHARE), pick ? `share=${pick.share.toFixed(3)}` : "—");
  toy("meets-min-pair", !!(pick && pick.count >= MIN_PAIR), pick ? `count=${pick.count}` : "—");
}

{
  // Lone Image: prompt (in) mass 8 beats image (out) mass 3 → pulse prompt.
  const graph = {
    nodes: [{ id: "img1", type: "image" }],
    links: [],
  };
  const pick = pickPostAddFreePort(tables, graph, { nodeId: "img1" });
  toy(
    "image-add-picks-prompt-in",
    !!(pick && pick.nodeId === "img1" && pick.port === "prompt" && pick.dir === "in"),
    pick ? `${pick.nodeId}.${pick.port}/${pick.dir} count=${pick.count}` : "null"
  );
}

{
  // LLM alone: prompt in ~4 vs text out ~3 → near-tied → quiet (MIN_LEAD).
  const graph = {
    nodes: [{ id: "llm1", type: "llm" }],
    links: [],
  };
  const pick = pickPostAddFreePort(tables, graph, { nodeId: "llm1" });
  toy(
    "llm-multi-ambiguous-quiet",
    pick === null,
    pick ? `${pick.nodeId}.${pick.port}/${pick.dir}` : "null"
  );
}

{
  // Scope: only the new node — high-prior dangling elsewhere must not win.
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
  };
  const pick = pickPostAddFreePort(tables, graph, { nodeId: "img1" });
  toy(
    "scope-excludes-other-text",
    !(pick && pick.nodeId === "t1"),
    pick ? `${pick.nodeId}.${pick.port}` : "quiet-or-scoped"
  );
  toy(
    "scope-still-picks-image",
    !!(pick && pick.nodeId === "img1"),
    pick ? `${pick.nodeId}.${pick.port}/${pick.dir}` : "null"
  );
}

{
  // Two scoped candidates with equal mass → multi-ambiguous quiet.
  const tied = {
    topTargets: {
      "join|text": { "llm|prompt": 4 },
      "text|text": { "join|b": 4, "join|a": 4 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      join: { inputs: ["a", "b"], outputs: ["text"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
    },
  };
  // Join alone with a/b in mass 4 and text out mass 4 → all tied → quiet
  const pick = pickPostAddFreePort(
    tied,
    {
      nodes: [{ id: "j1", type: "join" }],
      links: [],
    },
    { nodeId: "j1" }
  );
  toy("tied-candidates-quiet", pick === null, pick ? "leaked" : "null");

  // Lone candidate with mass still pulses (destination-flat is OK).
  const lone = {
    topTargets: {
      "image|image": { "resize|image": 3, "edit|image": 3 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
      resize: { inputs: ["image"], outputs: ["image"] },
      edit: { inputs: ["image"], outputs: ["image"] },
    },
  };
  // Image with only out mass (no inbound in tables) → image out alone.
  const pickLone = pickPostAddFreePort(
    lone,
    {
      nodes: [{ id: "img1", type: "image" }],
      links: [],
    },
    { nodeId: "img1" }
  );
  toy(
    "lone-mass-picks",
    !!(pickLone && pickLone.nodeId === "img1" && pickLone.port === "image" && pickLone.dir === "out"),
    pickLone ? `${pickLone.nodeId}.${pickLone.port}/${pickLone.dir}` : "null"
  );
}

{
  // When out mass clearly leads in mass, prefer the output (priors favor out).
  const outLead = {
    topTargets: {
      "image|image": { "resize|image": 8 },
      "text|text": { "image|prompt": 3 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
      resize: { inputs: ["image"], outputs: ["image"] },
    },
  };
  const pick = pickPostAddFreePort(
    outLead,
    {
      nodes: [{ id: "img1", type: "image" }],
      links: [],
    },
    { nodeId: "img1" }
  );
  toy(
    "out-wins-when-priors-favor",
    !!(pick && pick.port === "image" && pick.dir === "out"),
    pick ? `${pick.port}/${pick.dir} count=${pick.count}` : "null"
  );
}

{
  const weak = {
    topTargets: { "image|image": { "resize|image": 1 } },
    portCatalog: {
      image: { inputs: ["prompt"], outputs: ["image"] },
      resize: { inputs: ["image"], outputs: ["image"] },
    },
  };
  const pick = pickPostAddFreePort(
    weak,
    {
      nodes: [{ id: "img1", type: "image" }],
      links: [],
    },
    { nodeId: "img1" }
  );
  toy("below-min-pair-quiet", pick === null, pick ? "leaked" : "null");
}

{
  toy(
    "missing-nodeId-quiet",
    pickPostAddFreePort(tables, {
      nodes: [{ id: "t1", type: "text" }],
      links: [],
    }) === null,
    "null"
  );
  toy(
    "unknown-node-quiet",
    pickPostAddFreePort(
      tables,
      {
        nodes: [{ id: "t1", type: "text" }],
        links: [],
      },
      { nodeId: "nope" }
    ) === null,
    "null"
  );
  toy(
    "multi-select-quiet",
    pickPostAddFreePort(
      tables,
      {
        nodes: [{ id: "t1", type: "text" }],
        links: [],
        selectedIds: ["t1", "x"],
      },
      { nodeId: "t1" }
    ) === null,
    "null"
  );
  toy(
    "no-tables-quiet",
    pickPostAddFreePort(
      null,
      {
        nodes: [{ id: "t1", type: "text" }],
        links: [],
      },
      { nodeId: "t1" }
    ) === null,
    "null"
  );
}

{
  // Fully wired new node (no dangling) → quiet
  const pick = pickPostAddFreePort(
    tables,
    {
      nodes: [
        { id: "t1", type: "text" },
        { id: "img1", type: "image" },
      ],
      links: [
        { from: { node: "t1", port: "text" }, to: { node: "img1", port: "prompt" } },
        // image out still dangling — so pick node t1 which is fully wired (text out used)
      ],
    },
    { nodeId: "t1" }
  );
  toy("fully-wired-new-node-quiet", pick === null, pick ? `${pick.nodeId}.${pick.port}` : "null");
}

{
  // Comment / no ports → quiet
  const pick = pickPostAddFreePort(
    tables,
    {
      nodes: [{ id: "c1", type: "comment" }],
      links: [],
    },
    { nodeId: "c1" }
  );
  toy("comment-no-ports-quiet", pick === null, pick ? "leaked" : "null");
}

{
  toy(
    "gates-exported",
    MIN_PAIR >= 2 && MIN_LEAD > 1 && MIN_SHARE > 0,
    `pair=${MIN_PAIR} lead=${MIN_LEAD} share=${MIN_SHARE}`
  );
}

// Editor wiring pins
{
  toy("html-has-post-add-css", /\.port\.na-post-add-port\s*\{/.test(index), ".port.na-post-add-port");
  toy("html-has-post-add-keyframes", /@keyframes\s+naPostAddPulse/.test(index), "naPostAddPulse");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,160}na-post-add-port/.test(index) ||
      /na-post-add-port[\s\S]{0,200}prefers-reduced-motion/.test(index) ||
      /postAddFreePortReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-clearPostAddFreePort", index.includes("clearPostAddFreePort"), "fn");
  toy("html-applyPostAddFreePort", index.includes("applyPostAddFreePort"), "fn");
  toy("html-schedulePostAddFreePort", index.includes("schedulePostAddFreePort"), "fn");
  toy("html-pickPostAddFreePort-call", /pickPostAddFreePort\s*\(/.test(index), "call site");
  toy("html-startWire-clears", /function startWire[\s\S]{0,240}clearPostAddFreePort/.test(index), "startWire clears");
  toy(
    "html-addNode-schedules",
    /addNode\s*=\s*function[\s\S]{0,320}schedulePostAddFreePort/.test(index),
    "addNode schedules"
  );
  toy(
    "html-connect-clears",
    /connect\s*=\s*function[\s\S]{0,280}clearPostAddFreePort/.test(index),
    "connect clears"
  );
  toy(
    "html-select-clears",
    /select\s*=\s*function[\s\S]{0,400}clearPostAddFreePort/.test(index),
    "select clears"
  );
  toy("html-ttl", /POST_ADD_FREE_PORT_TTL_MS\s*=\s*2\d{3}/.test(index), "TTL ~2–3s");
  toy(
    "html-geoOn-gate",
    /geoOn\(\)/.test(index) && /applyPostAddFreePort[\s\S]{0,400}geoOn/.test(index),
    "geoOn gate"
  );
  toy(
    "surface-exports-pickPostAddFreePort",
    /pickPostAddFreePort\(query\)/.test(surface) && /from "\.\/post-add-free-port\.mjs"/.test(surface),
    "editor-surface"
  );
  toy(
    "readme-mentions-43",
    /·\s*43|Product · 43|post-add-free-port/.test(readme),
    "README · 43"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?43/.test(index) && !/\?product=43/.test(index),
    "no ?product=43"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-43-usage.gif")),
    "product-43-usage.gif"
  );
  toy(
    "distinct-class",
    index.includes("na-post-add-port") &&
      !/\.port\.na-post-add-port[\s\S]{0,40}na-continue-port/.test(index),
    "distinct .na-post-add-port"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\npost-add-free-port toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  fail(failed.map((f) => f.name).join(", "));
}
console.log("✓ next-action-post-add-free-port");
