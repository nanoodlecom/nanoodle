#!/usr/bin/env node
/**
 * Product · 46 — aborted-wire resume pulse toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "../vendor/next-action/port-suggest.mjs";
import {
  pickAbortedWireResumePort,
  originPortMass,
  outMass,
  inMass,
} from "../vendor/next-action/aborted-wire-resume.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-aborted-wire-resume: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "aborted-wire-resume.mjs")), "missing aborted-wire-resume.mjs");
assert(existsSync(CORPUS), "missing port-suggest.json");

const tables = JSON.parse(readFileSync(CORPUS, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");
const helper = readFileSync(join(NA, "aborted-wire-resume.mjs"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  const origin = { nodeId: "t1", port: "text", type: "text", dir: "out" };
  const pick = pickAbortedWireResumePort(tables, origin);
  toy("text-out-picks", !!pick, pick ? `${pick.type}.${pick.port}` : "null");
  toy(
    "text-out-identity",
    !!(pick && pick.nodeId === "t1" && pick.port === "text" && pick.dir === "out"),
    pick ? `${pick.nodeId}.${pick.port}/${pick.dir}` : "—"
  );
  toy("text-out-meets-min-pair", !!(pick && pick.count >= MIN_PAIR), pick ? `count=${pick.count}` : "—");
  toy(
    "text-out-mass-matches",
    originPortMass(tables, origin) === outMass(tables, "text", "text"),
    `mass=${originPortMass(tables, origin)}`
  );
}

{
  const origin = { nodeId: "img1", port: "prompt", type: "image", dir: "in" };
  const pick = pickAbortedWireResumePort(tables, origin);
  toy(
    "image-prompt-in-picks",
    !!(pick && pick.nodeId === "img1" && pick.port === "prompt" && pick.dir === "in"),
    pick ? `${pick.nodeId}.${pick.port}/${pick.dir} count=${pick.count}` : "null"
  );
  toy(
    "image-prompt-in-mass",
    inMass(tables, "image", "prompt") >= MIN_PAIR,
    `mass=${inMass(tables, "image", "prompt")}`
  );
}

{
  const origin = { nodeId: "img1", port: "image", type: "image", dir: "out" };
  const pick = pickAbortedWireResumePort(tables, origin);
  toy(
    "image-out-picks",
    !!(pick && pick.port === "image" && pick.dir === "out" && pick.count >= MIN_PAIR),
    pick ? `count=${pick.count}` : "null"
  );
}

{
  // Unknown / empty type mass → flat → quiet
  const pick = pickAbortedWireResumePort(tables, {
    nodeId: "x1",
    port: "nope",
    type: "not_a_real_type_zz",
    dir: "out",
  });
  toy("unknown-type-flat-quiet", pick === null, pick ? "leaked" : "null");
}

{
  const pick = pickAbortedWireResumePort(tables, {
    nodeId: "x1",
    port: "ghost",
    type: "text",
    dir: "out",
  });
  // text|ghost has no row → mass 0 → quiet
  toy("unknown-port-flat-quiet", pick === null, pick ? `count=${pick.count}` : "null");
}

{
  toy(
    "missing-nodeId-quiet",
    pickAbortedWireResumePort(tables, { port: "text", type: "text", dir: "out" }) === null,
    "null"
  );
  toy(
    "missing-port-quiet",
    pickAbortedWireResumePort(tables, { nodeId: "t1", type: "text", dir: "out" }) === null,
    "null"
  );
  toy(
    "missing-type-quiet",
    pickAbortedWireResumePort(tables, { nodeId: "t1", port: "text", dir: "out" }) === null,
    "null"
  );
  toy(
    "missing-dir-quiet",
    pickAbortedWireResumePort(tables, { nodeId: "t1", port: "text", type: "text" }) === null,
    "null"
  );
}

{
  // No tables → still returns origin (editor may pulse without prior gate)
  const pick = pickAbortedWireResumePort(null, {
    nodeId: "t1",
    port: "text",
    type: "text",
    dir: "out",
  });
  toy(
    "no-tables-allows-origin",
    !!(pick && pick.nodeId === "t1" && pick.count === 0),
    pick ? `count=${pick.count}` : "null"
  );
  toy(
    "empty-tables-allows-origin",
    !!(
      pickAbortedWireResumePort({}, { nodeId: "t1", port: "text", type: "text", dir: "out" }) &&
      pickAbortedWireResumePort({}, { nodeId: "t1", port: "text", type: "text", dir: "out" }).count === 0
    ),
    "count=0"
  );
}

{
  // id alias
  const pick = pickAbortedWireResumePort(tables, {
    id: "t2",
    port: "text",
    type: "text",
    dir: "out",
  });
  toy("id-alias", !!(pick && pick.nodeId === "t2"), pick ? pick.nodeId : "null");
}

{
  // dir normalization
  const pick = pickAbortedWireResumePort(tables, {
    nodeId: "t1",
    port: "text",
    type: "text",
    dir: "OUT",
  });
  // invalid dir string that's not in/out → null (we only accept exact in/out)
  toy("invalid-dir-quiet", pick === null, pick ? pick.dir : "null");
  const pick2 = pickAbortedWireResumePort(tables, {
    nodeId: "t1",
    port: "text",
    type: "text",
    dir: "out",
  });
  toy("valid-dir-out", !!(pick2 && pick2.dir === "out"), pick2 ? pick2.dir : "null");
}

{
  const mOut = outMass(tables, "llm", "text");
  const mIn = inMass(tables, "llm", "prompt");
  toy("llm-text-out-mass", mOut >= MIN_PAIR, `mass=${mOut}`);
  toy("llm-prompt-in-mass", mIn >= MIN_PAIR, `mass=${mIn}`);
  const pOut = pickAbortedWireResumePort(tables, {
    nodeId: "llm1",
    port: "text",
    type: "llm",
    dir: "out",
  });
  const pIn = pickAbortedWireResumePort(tables, {
    nodeId: "llm1",
    port: "prompt",
    type: "llm",
    dir: "in",
  });
  toy("llm-out-picks", !!(pOut && pOut.count === mOut), pOut ? `count=${pOut.count}` : "null");
  toy("llm-in-picks", !!(pIn && pIn.count === mIn), pIn ? `count=${pIn.count}` : "null");
}

{
  // Below MIN_PAIR synthetic tables
  const tiny = { topTargets: { "z|a": { "y|b": 1 } } };
  const pick = pickAbortedWireResumePort(tiny, {
    nodeId: "z1",
    port: "a",
    type: "z",
    dir: "out",
  });
  toy("below-min-pair-quiet", pick === null, pick ? `count=${pick.count}` : "null");
  const okTab = { topTargets: { "z|a": { "y|b": MIN_PAIR } } };
  const pick2 = pickAbortedWireResumePort(okTab, {
    nodeId: "z1",
    port: "a",
    type: "z",
    dir: "out",
  });
  toy(
    "at-min-pair-picks",
    !!(pick2 && pick2.count === MIN_PAIR),
    pick2 ? `count=${pick2.count}` : "null"
  );
}

{
  toy(
    "gates-exported",
    MIN_PAIR >= 2 && MIN_LEAD > 1 && MIN_SHARE > 0,
    `pair=${MIN_PAIR} lead=${MIN_LEAD} share=${MIN_SHARE}`
  );
  toy(
    "helper-mentions-621",
    /#621|port-pair|gallery/.test(helper),
    "gallery/#621"
  );
}

// Editor wiring pins
{
  toy("html-has-resume-css", /\.port\.na-aborted-wire-resume\s*\{/.test(index), ".port.na-aborted-wire-resume");
  toy("html-has-keyframes", /@keyframes\s+naAbortedWireResumePulse/.test(index), "naAbortedWireResumePulse");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,200}na-aborted-wire-resume/.test(index) ||
      /abortedWireResumeReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-clearAbortedWireResume", index.includes("clearAbortedWireResume"), "fn");
  toy("html-applyAbortedWireResume", index.includes("applyAbortedWireResume"), "fn");
  toy("html-scheduleAbortedWireResume", index.includes("scheduleAbortedWireResume"), "fn");
  toy("html-pick-call", /pickAbortedWireResumePort\s*\(/.test(index), "call site");
  toy(
    "html-startWire-clears",
    /function startWire[\s\S]{0,280}clearAbortedWireResume/.test(index),
    "startWire clears"
  );
  toy(
    "html-esc-cancel",
    /keydown[\s\S]{0,80}onEsc|onEsc[\s\S]{0,200}Escape/.test(index) &&
      /Escape[\s\S]{0,400}scheduleAbortedWireResume/.test(index),
    "Esc schedules pulse"
  );
  toy(
    "html-mouseup-abort-schedules",
    /!connected && dragged[\s\S]{0,280}scheduleAbortedWireResume/.test(index) ||
      /dragged[\s\S]{0,200}scheduleAbortedWireResume/.test(index),
    "mouseup abort schedules"
  );
  toy(
    "html-connect-clears",
    /connect\s*=\s*function[\s\S]{0,320}clearAbortedWireResume/.test(index),
    "connect clears"
  );
  toy(
    "html-select-clears",
    /select\s*=\s*function[\s\S]{0,400}clearAbortedWireResume/.test(index),
    "select clears"
  );
  toy("html-ttl", /ABORTED_WIRE_RESUME_TTL_MS\s*=\s*1[0-9]{3}/.test(index), "TTL ~1–1.5s");
  toy(
    "html-geoOn-gate",
    /geoOn\(\)/.test(index) && /applyAbortedWireResume[\s\S]{0,500}geoOn/.test(index),
    "geoOn gate"
  );
  toy(
    "html-compatible-class",
    /na-aborted-wire-resume[\s\S]{0,200}compatible|compatible[\s\S]{0,80}na-aborted-wire-resume/.test(
      index
    ),
    "uses .compatible"
  );
  toy(
    "surface-exports-pick",
    /pickAbortedWireResumePort\(origin\)/.test(surface) &&
      /from "\.\/aborted-wire-resume\.mjs"/.test(surface),
    "editor-surface"
  );
  toy(
    "readme-mentions-46",
    /·\s*46|Product · 46|aborted-wire-resume/.test(readme),
    "README · 46"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?46/.test(index) && !/\?product=46/.test(index),
    "no ?product=46"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-46-usage.gif")),
    "product-46-usage.gif"
  );
  toy(
    "distinct-class",
    index.includes("na-aborted-wire-resume") && !index.includes("na-aborted-wire-resume-panel"),
    "distinct .na-aborted-wire-resume"
  );
  toy(
    "esc-does-not-open-quickadd",
    /onEsc[\s\S]{0,500}scheduleAbortedWireResume/.test(index) &&
      !/onEsc[\s\S]{0,500}openQuickAdd/.test(index),
    "Esc: no quickadd"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\naborted-wire-resume toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  fail(failed.map((f) => f.name).join(", "));
}
console.log("✓ next-action-aborted-wire-resume");
