#!/usr/bin/env node
/**
 * Product · 47 — drop-miss reconnect pulse toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "../vendor/next-action/port-suggest.mjs";
import {
  pickDropMissReconnectPort,
  scoreCandidate,
  directedPairCount,
  typeToTypeCount,
  NEARBY_MAX_DIST,
} from "../vendor/next-action/drop-miss-reconnect.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-drop-miss-reconnect: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "drop-miss-reconnect.mjs")), "missing drop-miss-reconnect.mjs");
assert(existsSync(CORPUS), "missing port-suggest.json");

const tables = JSON.parse(readFileSync(CORPUS, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");
const helper = readFileSync(join(NA, "drop-miss-reconnect.mjs"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  const origin = { nodeId: "t1", port: "text", type: "text", dir: "out" };
  const cands = [
    { nodeId: "img1", port: "prompt", type: "image", dist: 80, wired: false },
    { nodeId: "llm1", port: "prompt", type: "llm", dist: 120, wired: false },
    { nodeId: "join1", port: "b", type: "join", dist: 200, wired: false },
  ];
  const pick = pickDropMissReconnectPort(tables, origin, cands);
  toy("text-out-picks-image-prompt", !!(pick && pick.nodeId === "img1" && pick.port === "prompt"), pick ? `${pick.nodeId}.${pick.port} c=${pick.count}` : "null");
  toy("text-out-dir-is-in", !!(pick && pick.dir === "in"), pick ? pick.dir : "—");
  toy("text-out-meets-min-pair", !!(pick && pick.count >= MIN_PAIR), pick ? `count=${pick.count}` : "—");
  toy(
    "text-image-pair-stronger-than-llm",
    directedPairCount(tables, "out", "text", "text", "image", "prompt") >
      directedPairCount(tables, "out", "text", "text", "llm", "prompt"),
    `img=${directedPairCount(tables, "out", "text", "text", "image", "prompt")} llm=${directedPairCount(tables, "out", "text", "text", "llm", "prompt")}`
  );
}

{
  // Prefer unwired when counts equal
  const tiny = {
    topTargets: {
      "a|out": { "b|in": 6, "c|in": 6 },
    },
    typeToType: { "a→b": 4, "a→c": 4 },
  };
  const origin = { nodeId: "a1", port: "out", type: "a", dir: "out" };
  const pick = pickDropMissReconnectPort(tiny, origin, [
    { nodeId: "b1", port: "in", type: "b", dist: 50, wired: true },
    { nodeId: "c1", port: "in", type: "c", dist: 50, wired: false },
  ]);
  toy("prefer-unwired-on-tie", !!(pick && pick.nodeId === "c1" && pick.wired === false), pick ? `${pick.nodeId} wired=${pick.wired}` : "null");
}

{
  // Equal counts → tied → quiet (nearer is only a sort key after a clear lead)
  const tiny = {
    topTargets: { "a|out": { "b|in": 5, "c|in": 5 } },
    typeToType: {},
  };
  const pick = pickDropMissReconnectPort(tiny, { nodeId: "a1", port: "out", type: "a", dir: "out" }, [
    { nodeId: "b1", port: "in", type: "b", dist: 300, wired: false },
    { nodeId: "c1", port: "in", type: "c", dist: 40, wired: false },
  ]);
  toy("equal-count-nearer-still-quiet", pick === null, pick ? `leaked ${pick.nodeId}` : "null");
}

{
  // Clear lead + within nearby → pick (even if farther than a weak rival)
  const tiny = {
    topTargets: { "a|out": { "b|in": 9, "c|in": 2 } },
    typeToType: {},
  };
  const pick = pickDropMissReconnectPort(
    tiny,
    { nodeId: "a1", port: "out", type: "a", dir: "out" },
    [
      { nodeId: "b1", port: "in", type: "b", dist: 200, wired: false },
      { nodeId: "c1", port: "in", type: "c", dist: 20, wired: false },
    ],
    { maxDist: 420 }
  );
  toy("within-nearby-clear-lead", !!(pick && pick.nodeId === "b1"), pick ? pick.nodeId : "null");
}

{
  // Tied lead → quiet (MIN_LEAD)
  const tiny = {
    topTargets: { "a|out": { "b|in": 4, "c|in": 4 } },
    typeToType: {},
  };
  // wait — prefer-nearer would still pick on equal count. Lead gate: top >= second * MIN_LEAD
  // 4 >= 4 * 1.35? No → quiet. But nearer sort happens before lead check — lead compares counts only.
  const pick = pickDropMissReconnectPort(tiny, { nodeId: "a1", port: "out", type: "a", dir: "out" }, [
    { nodeId: "b1", port: "in", type: "b", dist: 10, wired: false },
    { nodeId: "c1", port: "in", type: "c", dist: 20, wired: false },
  ]);
  toy("tied-count-quiet", pick === null, pick ? `leaked ${pick.nodeId}` : "null");
}

{
  // Never pick origin node
  const pick = pickDropMissReconnectPort(tables, { nodeId: "t1", port: "text", type: "text", dir: "out" }, [
    { nodeId: "t1", port: "text", type: "text", dist: 0, wired: false },
    { nodeId: "img1", port: "prompt", type: "image", dist: 90, wired: false },
  ]);
  toy("skips-origin-node", !!(pick && pick.nodeId !== "t1"), pick ? pick.nodeId : "null");
}

{
  // Beyond nearby → quiet
  const pick = pickDropMissReconnectPort(
    tables,
    { nodeId: "t1", port: "text", type: "text", dir: "out" },
    [{ nodeId: "img1", port: "prompt", type: "image", dist: 9999, wired: false }],
    { maxDist: 100 }
  );
  toy("beyond-nearby-quiet", pick === null, pick ? "leaked" : "null");
}

{
  // Flat / unknown → quiet
  toy(
    "unknown-origin-quiet",
    pickDropMissReconnectPort(tables, { nodeId: "x", port: "nope", type: "zzz", dir: "out" }, [
      { nodeId: "y", port: "a", type: "yyy", dist: 10, wired: false },
    ]) === null,
    "null"
  );
}

{
  toy(
    "missing-nodeId-quiet",
    pickDropMissReconnectPort(tables, { port: "text", type: "text", dir: "out" }, [
      { nodeId: "img1", port: "prompt", type: "image", dist: 10 },
    ]) === null,
    "null"
  );
  toy(
    "missing-port-quiet",
    pickDropMissReconnectPort(tables, { nodeId: "t1", type: "text", dir: "out" }, [
      { nodeId: "img1", port: "prompt", type: "image", dist: 10 },
    ]) === null,
    "null"
  );
  toy(
    "missing-type-quiet",
    pickDropMissReconnectPort(tables, { nodeId: "t1", port: "text", dir: "out" }, [
      { nodeId: "img1", port: "prompt", type: "image", dist: 10 },
    ]) === null,
    "null"
  );
  toy(
    "missing-dir-quiet",
    pickDropMissReconnectPort(tables, { nodeId: "t1", port: "text", type: "text" }, [
      { nodeId: "img1", port: "prompt", type: "image", dist: 10 },
    ]) === null,
    "null"
  );
  toy(
    "empty-candidates-quiet",
    pickDropMissReconnectPort(tables, { nodeId: "t1", port: "text", type: "text", dir: "out" }, []) === null,
    "null"
  );
  toy(
    "null-tables-quiet",
    pickDropMissReconnectPort(null, { nodeId: "t1", port: "text", type: "text", dir: "out" }, [
      { nodeId: "img1", port: "prompt", type: "image", dist: 10 },
    ]) === null,
    "null"
  );
}

{
  // id alias
  const pick = pickDropMissReconnectPort(
    tables,
    { id: "t2", port: "text", type: "text", dir: "out" },
    [{ nodeId: "img1", port: "prompt", type: "image", dist: 50, wired: false }]
  );
  toy("id-alias-origin", !!(pick && pick.nodeId === "img1"), pick ? pick.nodeId : "null");
}

{
  // in-dir: origin input → pick producer out
  const origin = { nodeId: "img1", port: "prompt", type: "image", dir: "in" };
  const cands = [
    { nodeId: "t1", port: "text", type: "text", dist: 60, wired: false },
    { nodeId: "llm1", port: "text", type: "llm", dist: 90, wired: false },
  ];
  const pick = pickDropMissReconnectPort(tables, origin, cands);
  // text→image.prompt is strongest (8)
  toy(
    "image-prompt-in-picks-text-out",
    !!(pick && pick.nodeId === "t1" && pick.port === "text" && pick.dir === "out"),
    pick ? `${pick.nodeId}.${pick.port}/${pick.dir} c=${pick.count}` : "null"
  );
  toy(
    "directed-in-uses-reverse-pair",
    directedPairCount(tables, "in", "image", "prompt", "text", "text") ===
      directedPairCount(tables, "out", "text", "text", "image", "prompt"),
    `n=${directedPairCount(tables, "in", "image", "prompt", "text", "text")}`
  );
}

{
  // Opposite-dir filter via cand.dir
  const tiny = { topTargets: { "a|out": { "b|in": 10 } }, typeToType: { "a→b": 5 } };
  const pick = pickDropMissReconnectPort(tiny, { nodeId: "a1", port: "out", type: "a", dir: "out" }, [
    { nodeId: "b1", port: "in", type: "b", dir: "out", dist: 10, wired: false }, // wrong dir tag
  ]);
  toy("wrong-cand-dir-filtered", pick === null, pick ? "leaked" : "null");
}

{
  // Below MIN_PAIR quiet
  const tiny = { topTargets: { "z|a": { "y|b": 1 } }, typeToType: {} };
  const pick = pickDropMissReconnectPort(tiny, { nodeId: "z1", port: "a", type: "z", dir: "out" }, [
    { nodeId: "y1", port: "b", type: "y", dist: 10, wired: false },
  ]);
  toy("below-min-pair-quiet", pick === null, pick ? `c=${pick.count}` : "null");
  const okTab = { topTargets: { "z|a": { "y|b": MIN_PAIR } }, typeToType: {} };
  const pick2 = pickDropMissReconnectPort(okTab, { nodeId: "z1", port: "a", type: "z", dir: "out" }, [
    { nodeId: "y1", port: "b", type: "y", dist: 10, wired: false },
  ]);
  toy("at-min-pair-picks", !!(pick2 && pick2.count === MIN_PAIR), pick2 ? `c=${pick2.count}` : "null");
}

{
  // typeToType soft fallback when pair missing
  const tiny = {
    topTargets: { "a|out": {} },
    typeToType: { "a→b": 12 },
  };
  const score = scoreCandidate(tiny, { type: "a", port: "out", dir: "out" }, { type: "b", port: "in" });
  toy("typeToType-fallback-score", score >= 1 && score < 12, `score=${score}`);
  const ttt = typeToTypeCount(tiny, "out", "a", "b");
  toy("typeToType-count", ttt === 12, `ttt=${ttt}`);
}

{
  // Clear lead over rival
  const tiny = {
    topTargets: { "a|out": { "b|in": 10, "c|in": 2 } },
    typeToType: {},
  };
  const pick = pickDropMissReconnectPort(tiny, { nodeId: "a1", port: "out", type: "a", dir: "out" }, [
    { nodeId: "b1", port: "in", type: "b", dist: 100, wired: false },
    { nodeId: "c1", port: "in", type: "c", dist: 10, wired: false },
  ]);
  toy("lead-beats-nearer-weak", !!(pick && pick.nodeId === "b1"), pick ? pick.nodeId : "null");
}

{
  toy("nearby-default", NEARBY_MAX_DIST >= 200 && NEARBY_MAX_DIST <= 800, `NEARBY=${NEARBY_MAX_DIST}`);
  toy(
    "gates-exported",
    MIN_PAIR >= 2 && MIN_LEAD > 1 && MIN_SHARE > 0,
    `pair=${MIN_PAIR} lead=${MIN_LEAD} share=${MIN_SHARE}`
  );
  toy("helper-mentions-621", /#621|port-pair|gallery/.test(helper), "gallery/#621");
  toy("helper-mentions-46-distinct", /·\s*46|Product · 46|origin/.test(helper), "distinct from ·46");
}

// Editor wiring pins
{
  toy("html-has-reconnect-css", /\.port\.na-drop-miss-reconnect\s*\{/.test(index), ".port.na-drop-miss-reconnect");
  toy("html-has-keyframes", /@keyframes\s+naDropMissReconnectPulse/.test(index), "naDropMissReconnectPulse");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,200}na-drop-miss-reconnect/.test(index) ||
      /dropMissReconnectReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-clearDropMissReconnect", index.includes("clearDropMissReconnect"), "fn");
  toy("html-applyDropMissReconnect", index.includes("applyDropMissReconnect"), "fn");
  toy("html-scheduleDropMissReconnect", index.includes("scheduleDropMissReconnect"), "fn");
  toy("html-gatherDropMissCandidates", index.includes("gatherDropMissCandidates"), "gather");
  toy("html-pick-call", /pickDropMissReconnectPort\s*\(/.test(index), "call site");
  toy(
    "html-startWire-clears",
    /function startWire[\s\S]{0,280}clearDropMissReconnect/.test(index),
    "startWire clears"
  );
  toy(
    "html-mouseup-miss-schedules",
    /!connected &&[\s\S]{0,80}hypot[\s\S]{0,400}scheduleDropMissReconnect/.test(index) ||
      /scheduleDropMissReconnect\([\s\S]{0,200}clientX/.test(index),
    "mouseup miss schedules"
  );
  toy(
    "html-connect-clears",
    /connect\s*=\s*function[\s\S]{0,320}clearDropMissReconnect/.test(index),
    "connect clears"
  );
  toy(
    "html-select-clears",
    /select\s*=\s*function[\s\S]{0,400}clearDropMissReconnect/.test(index),
    "select clears"
  );
  toy("html-ttl", /DROP_MISS_RECONNECT_TTL_MS\s*=\s*1[0-9]{3}/.test(index), "TTL ~1–1.5s");
  toy(
    "html-geoOn-gate",
    /geoOn\(\)/.test(index) && /applyDropMissReconnect[\s\S]{0,500}geoOn/.test(index),
    "geoOn gate"
  );
  toy(
    "html-compatible-class",
    /na-drop-miss-reconnect[\s\S]{0,200}compatible|compatible[\s\S]{0,80}na-drop-miss-reconnect/.test(
      index
    ),
    "uses .compatible"
  );
  toy(
    "surface-exports-pick",
    /pickDropMissReconnectPort\(origin/.test(surface) &&
      /from "\.\/drop-miss-reconnect\.mjs"/.test(surface),
    "editor-surface"
  );
  toy(
    "readme-mentions-47",
    /·\s*47|Product · 47|drop-miss-reconnect/.test(readme),
    "README · 47"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?47/.test(index) && !/\?product=47/.test(index),
    "no ?product=47"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-47-usage.gif")),
    "product-47-usage.gif"
  );
  toy(
    "distinct-class",
    index.includes("na-drop-miss-reconnect") && !index.includes("na-drop-miss-reconnect-panel"),
    "distinct .na-drop-miss-reconnect"
  );
  toy(
    "not-origin-pulse-class",
    !/\.port\.na-aborted-wire-resume\s*\{/.test(index),
    "no ·46 class on main-based branch (self-contained)"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\ndrop-miss-reconnect toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  fail(failed.map((f) => f.name).join(", "));
}
console.log("✓ next-action-drop-miss-reconnect");
