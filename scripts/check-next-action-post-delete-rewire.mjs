#!/usr/bin/env node
/**
 * Product · 44 — post-delete rewire pulse toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "../vendor/next-action/port-suggest.mjs";
import {
  pickPostDeleteRewirePort,
  pickPostDeleteBestPair,
  orphanKeysFromLostLinks,
} from "../vendor/next-action/post-delete-rewire.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-post-delete-rewire: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "post-delete-rewire.mjs")), "missing post-delete-rewire.mjs");
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
  // text → image wired; delete image → text.out is orphaned with high mass.
  const lostLinks = [
    { from: { node: "t1", port: "text" }, to: { node: "img1", port: "prompt" } },
  ];
  const graph = {
    nodes: [{ id: "t1", type: "text" }],
    links: [],
  };
  const pick = pickPostDeleteRewirePort(tables, graph, {
    deletedNodeId: "img1",
    lostLinks,
  });
  toy("delete-image-picks", !!pick, pick ? `${pick.type}.${pick.port} (${pick.dir})` : "null");
  toy(
    "picks-orphaned-text-out",
    !!(pick && pick.nodeId === "t1" && pick.port === "text" && pick.dir === "out" && pick.orphan),
    pick ? `${pick.nodeId}.${pick.port}/${pick.dir} orphan=${pick.orphan}` : "—"
  );
  toy("has-share", !!(pick && pick.share >= MIN_SHARE), pick ? `share=${pick.share.toFixed(3)}` : "—");
  toy("meets-min-pair", !!(pick && pick.count >= MIN_PAIR), pick ? `count=${pick.count}` : "—");
}

{
  // text → image wired; delete text → image.prompt orphaned (inbound mass 8).
  const lostLinks = [
    { from: { node: "t1", port: "text" }, to: { node: "img1", port: "prompt" } },
  ];
  const graph = {
    nodes: [{ id: "img1", type: "image" }],
    links: [],
  };
  const pick = pickPostDeleteRewirePort(tables, graph, {
    deletedNodeId: "t1",
    lostLinks,
  });
  toy(
    "delete-text-picks-image-prompt",
    !!(pick && pick.nodeId === "img1" && pick.port === "prompt" && pick.dir === "in" && pick.orphan),
    pick ? `${pick.nodeId}.${pick.port}/${pick.dir} count=${pick.count}` : "null"
  );
}

{
  // Prefer orphan over unrelated high-prior dangling elsewhere.
  // After deleting mid (llm): text.out orphaned; image.prompt also dangling (never wired).
  // text.out mass 8 (to image|prompt) vs image.prompt inbound 8 — but orphan prefer should pick text.
  const lostLinks = [
    { from: { node: "t1", port: "text" }, to: { node: "llm1", port: "prompt" } },
  ];
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
  };
  const pick = pickPostDeleteRewirePort(tables, graph, {
    deletedNodeId: "llm1",
    lostLinks,
  });
  toy(
    "prefers-orphan-over-unrelated",
    !!(pick && pick.nodeId === "t1" && pick.orphan),
    pick ? `${pick.nodeId}.${pick.port}/${pick.dir} orphan=${pick.orphan}` : "null"
  );
}

{
  // No lost links / no orphans: still may pick a high-prior dangling left behind.
  const graph = {
    nodes: [{ id: "t1", type: "text" }],
    links: [],
  };
  const pick = pickPostDeleteRewirePort(tables, graph, {
    deletedNodeId: "gone",
    lostLinks: [],
  });
  toy(
    "fallback-dangling-without-orphan-info",
    !!(pick && pick.nodeId === "t1" && pick.port === "text" && pick.dir === "out"),
    pick ? `${pick.nodeId}.${pick.port}/${pick.dir}` : "null"
  );
}

{
  // Two orphaned candidates with equal mass → multi-ambiguous quiet.
  const tied = {
    topTargets: {
      "text|text": { "join|a": 4, "join|b": 4 },
      "join|text": { "llm|prompt": 4 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      join: { inputs: ["a", "b"], outputs: ["text"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
    },
  };
  // Delete join that was fed by two texts on a and b — both text outs orphaned with mass 4.
  const lostLinks = [
    { from: { node: "t1", port: "text" }, to: { node: "j1", port: "a" } },
    { from: { node: "t2", port: "text" }, to: { node: "j1", port: "b" } },
  ];
  const pick = pickPostDeleteRewirePort(
    tied,
    {
      nodes: [
        { id: "t1", type: "text" },
        { id: "t2", type: "text" },
      ],
      links: [],
    },
    { deletedNodeId: "j1", lostLinks }
  );
  toy("tied-orphans-quiet", pick === null, pick ? "leaked" : "null");
}

{
  // Lone orphan with mass still pulses.
  const lone = {
    topTargets: {
      "image|image": { "resize|image": 3, "edit|image": 3 },
    },
    portCatalog: {
      image: { inputs: ["prompt"], outputs: ["image"] },
      resize: { inputs: ["image"], outputs: ["image"] },
      edit: { inputs: ["image"], outputs: ["image"] },
    },
  };
  const lostLinks = [
    { from: { node: "img1", port: "image" }, to: { node: "r1", port: "image" } },
  ];
  const pick = pickPostDeleteRewirePort(
    lone,
    {
      nodes: [{ id: "img1", type: "image" }],
      links: [],
    },
    { deletedNodeId: "r1", lostLinks }
  );
  toy(
    "lone-orphan-mass-picks",
    !!(pick && pick.nodeId === "img1" && pick.port === "image" && pick.dir === "out" && pick.orphan),
    pick ? `${pick.nodeId}.${pick.port}/${pick.dir}` : "null"
  );
}

{
  // When out mass clearly leads in mass among orphans, prefer the output.
  // (Exact count ties are near-tied → quiet via MIN_LEAD; sort still prefers out.)
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
  const pick = pickPostDeleteRewirePort(
    outLead,
    {
      nodes: [{ id: "img1", type: "image" }],
      links: [],
    },
    {
      deletedNodeId: "gone",
      orphanKeys: ["img1|image|out", "img1|prompt|in"],
    }
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
  const pick = pickPostDeleteRewirePort(
    weak,
    {
      nodes: [{ id: "img1", type: "image" }],
      links: [],
    },
    {
      deletedNodeId: "r1",
      lostLinks: [{ from: { node: "img1", port: "image" }, to: { node: "r1", port: "image" } }],
    }
  );
  toy("below-min-pair-quiet", pick === null, pick ? "leaked" : "null");
}

{
  toy(
    "missing-deletedNodeId-quiet",
    pickPostDeleteRewirePort(tables, {
      nodes: [{ id: "t1", type: "text" }],
      links: [],
    }) === null,
    "null"
  );
  toy(
    "deleted-still-present-quiet",
    pickPostDeleteRewirePort(
      tables,
      {
        nodes: [
          { id: "t1", type: "text" },
          { id: "img1", type: "image" },
        ],
        links: [],
      },
      { deletedNodeId: "img1", lostLinks: [] }
    ) === null,
    "null"
  );
  toy(
    "multi-select-quiet",
    pickPostDeleteRewirePort(
      tables,
      {
        nodes: [{ id: "t1", type: "text" }],
        links: [],
        selectedIds: ["t1", "x"],
      },
      { deletedNodeId: "gone", lostLinks: [] }
    ) === null,
    "null"
  );
  toy(
    "no-tables-quiet",
    pickPostDeleteRewirePort(
      null,
      {
        nodes: [{ id: "t1", type: "text" }],
        links: [],
      },
      { deletedNodeId: "gone" }
    ) === null,
    "null"
  );
  toy(
    "empty-graph-quiet",
    pickPostDeleteRewirePort(
      tables,
      { nodes: [], links: [] },
      { deletedNodeId: "gone", lostLinks: [] }
    ) === null,
    "null"
  );
}

{
  // Fully wired remaining graph (no dangling) → quiet
  // text→image.prompt, image→resize.image; resize has no outputs in catalog.
  const pick = pickPostDeleteRewirePort(
    tables,
    {
      nodes: [
        { id: "t1", type: "text" },
        { id: "img1", type: "image" },
        { id: "r1", type: "resize" },
      ],
      links: [
        { from: { node: "t1", port: "text" }, to: { node: "img1", port: "prompt" } },
        { from: { node: "img1", port: "image" }, to: { node: "r1", port: "image" } },
      ],
    },
    {
      deletedNodeId: "extra",
      lostLinks: [{ from: { node: "extra", port: "text" }, to: { node: "img1", port: "prompt" } }],
    }
  );
  toy("no-dangling-quiet", pick === null, pick ? `${pick.nodeId}.${pick.port}` : "null");
}

{
  const pick = pickPostDeleteRewirePort(
    tables,
    {
      nodes: [{ id: "c1", type: "comment" }],
      links: [],
    },
    { deletedNodeId: "gone", lostLinks: [] }
  );
  toy("comment-no-ports-quiet", pick === null, pick ? "leaked" : "null");
}

{
  // orphanKeysFromLostLinks helper
  const keys = orphanKeysFromLostLinks(
    [
      { from: { node: "t1", port: "text" }, to: { node: "img1", port: "prompt" } },
      { from: { node: "img1", port: "image" }, to: { node: "r1", port: "image" } },
    ],
    "img1"
  );
  toy(
    "orphan-keys-both-sides",
    keys.has("t1|text|out") && keys.has("r1|image|in") && !keys.has("img1|image|out"),
    [...keys].join(",")
  );
}

{
  // Best-pair: text and image both dangling after deleting a mid join/bridge —
  // clear text→image.prompt pair (count 8).
  const lostLinks = [
    { from: { node: "t1", port: "text" }, to: { node: "mid", port: "a" } },
    { from: { node: "mid", port: "text" }, to: { node: "img1", port: "prompt" } },
  ];
  const graph = {
    nodes: [
      { id: "t1", type: "text" },
      { id: "img1", type: "image" },
    ],
    links: [],
  };
  const pair = pickPostDeleteBestPair(tables, graph, {
    deletedNodeId: "mid",
    lostLinks,
  });
  toy(
    "best-pair-text-to-image",
    !!(
      pair &&
      pair.from.nodeId === "t1" &&
      pair.from.port === "text" &&
      pair.to.nodeId === "img1" &&
      pair.to.port === "prompt"
    ),
    pair ? `${pair.from.nodeId}.${pair.from.port}→${pair.to.nodeId}.${pair.to.port} c=${pair.count}` : "null"
  );
}

{
  // Best-pair quiet when flat / tied
  const tied = {
    topTargets: {
      "text|text": { "join|a": 4, "join|b": 4 },
    },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      join: { inputs: ["a", "b"], outputs: ["text"] },
    },
  };
  const pair = pickPostDeleteBestPair(
    tied,
    {
      nodes: [
        { id: "t1", type: "text" },
        { id: "j1", type: "join" },
      ],
      links: [],
    },
    {
      deletedNodeId: "gone",
      orphanKeys: ["t1|text|out", "j1|a|in", "j1|b|in"],
    }
  );
  toy("best-pair-tied-quiet", pair === null, pair ? "leaked" : "null");
}

{
  toy(
    "best-pair-no-deleted-quiet",
    pickPostDeleteBestPair(tables, {
      nodes: [
        { id: "t1", type: "text" },
        { id: "img1", type: "image" },
      ],
      links: [],
    }) === null,
    "null"
  );
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
  toy("html-has-post-delete-css", /\.port\.na-post-delete-rewire\s*\{/.test(index), ".port.na-post-delete-rewire");
  toy("html-has-post-delete-keyframes", /@keyframes\s+naPostDeleteRewirePulse/.test(index), "naPostDeleteRewirePulse");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,200}na-post-delete-rewire/.test(index) ||
      /na-post-delete-rewire[\s\S]{0,200}prefers-reduced-motion/.test(index) ||
      /postDeleteRewireReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-clearPostDeleteRewire", index.includes("clearPostDeleteRewire"), "fn");
  toy("html-applyPostDeleteRewire", index.includes("applyPostDeleteRewire"), "fn");
  toy("html-schedulePostDeleteRewire", index.includes("schedulePostDeleteRewire"), "fn");
  toy("html-pickPostDeleteRewirePort-call", /pickPostDeleteRewirePort\s*\(/.test(index), "call site");
  toy("html-startWire-clears", /function startWire[\s\S]{0,280}clearPostDeleteRewire/.test(index), "startWire clears");
  toy(
    "html-removeNode-schedules",
    /removeNode\s*=\s*function[\s\S]{0,500}schedulePostDeleteRewire|function removeNode[\s\S]{0,900}schedulePostDeleteRewire/.test(index) ||
      /_removeNode[\s\S]{0,400}schedulePostDeleteRewire/.test(index) ||
      /schedulePostDeleteRewire\(/.test(index) && /removeNode/.test(index),
    "removeNode schedules"
  );
  toy(
    "html-connect-clears",
    /connect\s*=\s*function[\s\S]{0,280}clearPostDeleteRewire/.test(index),
    "connect clears"
  );
  toy(
    "html-select-clears",
    /select\s*=\s*function[\s\S]{0,400}clearPostDeleteRewire/.test(index),
    "select clears"
  );
  toy("html-ttl", /POST_DELETE_REWIRE_TTL_MS\s*=\s*2\d{3}/.test(index), "TTL ~2–3s");
  toy(
    "html-geoOn-gate",
    /geoOn\(\)/.test(index) && /applyPostDeleteRewire[\s\S]{0,400}geoOn/.test(index),
    "geoOn gate"
  );
  toy(
    "html-best-pair-optional",
    /na-post-delete-best-pair/.test(index) && /pickPostDeleteBestPair/.test(index),
    "optional best-pair ghost"
  );
  toy(
    "surface-exports-pickPostDeleteRewirePort",
    /pickPostDeleteRewirePort\(query\)/.test(surface) && /from "\.\/post-delete-rewire\.mjs"/.test(surface),
    "editor-surface port"
  );
  toy(
    "surface-exports-pickPostDeleteBestPair",
    /pickPostDeleteBestPair\(query\)/.test(surface),
    "editor-surface pair"
  );
  toy(
    "readme-mentions-44",
    /·\s*44|Product · 44|post-delete-rewire/.test(readme),
    "README · 44"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?44/.test(index) && !/\?product=44/.test(index),
    "no ?product=44"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-44-usage.gif")),
    "product-44-usage.gif"
  );
  toy(
    "distinct-class",
    index.includes("na-post-delete-rewire") &&
      !/\.port\.na-post-delete-rewire[\s\S]{0,40}na-continue-port/.test(index),
    "distinct .na-post-delete-rewire"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\npost-delete-rewire toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  fail(failed.map((f) => f.name).join(", "));
}
console.log("✓ next-action-post-delete-rewire");
