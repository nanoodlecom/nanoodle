#!/usr/bin/env node
/**
 * Product · 49 — run-failure rewire pulse toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "../vendor/next-action/port-suggest.mjs";
import {
  pickRunFailPort,
  inMass,
  parseMissingInputError,
  isMissingInputFailure,
  scoreInputAgainstError,
  collectMissingInputCandidates,
} from "../vendor/next-action/run-fail-port.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-run-fail-port: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "run-fail-port.mjs")), "missing run-fail-port.mjs");
assert(existsSync(CORPUS), "missing port-suggest.json");

const tables = JSON.parse(readFileSync(CORPUS, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");
const helper = readFileSync(join(NA, "run-fail-port.mjs"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

// --- parse / classify ---
{
  const p = parseMissingInputError("no image — wire an image into the image port");
  toy("parse-image-wire", p.ports.includes("image") && p.modalities.includes("image") && p.wireHint, JSON.stringify(p));
  const p2 = parseMissingInputError("no prompt — describe the image to generate");
  toy("parse-prompt", p2.ports.includes("prompt") && p2.modalities.includes("prompt"), JSON.stringify(p2));
  const p3 = parseMissingInputError("no audio — wire an audio clip into the audio port");
  toy("parse-audio", p3.ports.includes("audio") && p3.modalities.includes("audio"), JSON.stringify(p3));
  const p4 = parseMissingInputError("no mask — brush the area to repaint (white), or wire the mask port");
  toy("parse-mask", p4.ports.includes("mask"), JSON.stringify(p4));
  const p5 = parseMissingInputError("no video — wire a video into the video port");
  toy("parse-video", p5.ports.includes("video"), JSON.stringify(p5));
  toy(
    "is-missing-image",
    isMissingInputFailure("no image — wire an image into the image port"),
    "true"
  );
  toy(
    "not-network",
    !isMissingInputFailure("couldn't reach nano-gpt.com — an ad-blocker"),
    "false"
  );
  toy("not-abort", !isMissingInputFailure("AbortError: signal is aborted"), "false");
  toy("not-response", !isMissingInputFailure("no image in response — return { url }"), "false");
  toy("not-cycle", !isMissingInputFailure("cycle detected"), "false");
}

// --- score ---
{
  const parsed = parseMissingInputError("no image — wire an image into the image port");
  const sImg = scoreInputAgainstError({ name: "image", type: "image", wired: false, empty: true }, parsed);
  const sPrompt = scoreInputAgainstError({ name: "prompt", type: "text", wired: false, empty: true }, parsed);
  toy("score-image-wins", sImg > sPrompt && sImg > 0, `img=${sImg} prompt=${sPrompt}`);
  const sFilled = scoreInputAgainstError({ name: "image", type: "image", wired: true, empty: false }, parsed);
  toy("score-filled-zero", sFilled === 0, `s=${sFilled}`);
}

// --- pick: resize missing image (gallery mass ≥ MIN_PAIR) ---
{
  const ctx = {
    nodeId: "r1",
    nodeType: "resize",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [{ name: "image", type: "image", wired: false, empty: true }],
  };
  const pick = pickRunFailPort(tables, ctx);
  toy("resize-image-picks", !!(pick && pick.port === "image" && pick.dir === "in"), pick ? `${pick.port} count=${pick.count}` : "null");
  toy("resize-image-identity", !!(pick && pick.nodeId === "r1" && pick.type === "resize"), pick ? pick.nodeId : "—");
  toy("resize-image-meets-min", !!(pick && pick.count >= MIN_PAIR), pick ? `count=${pick.count}` : "—");
  toy(
    "resize-mass-matches",
    inMass(tables, "resize", "image") === (pick ? pick.count : -1),
    `mass=${inMass(tables, "resize", "image")}`
  );
}

// --- pick: image empty prompt (fieldport, high inbound mass) ---
{
  const ctx = {
    nodeId: "img1",
    nodeType: "image",
    errorMessage: "no prompt — describe the image to generate",
    inputsMeta: [{ name: "prompt", type: "text", wired: false, empty: true, field: true }],
  };
  const pick = pickRunFailPort(tables, ctx);
  toy(
    "image-prompt-picks",
    !!(pick && pick.port === "prompt" && pick.dir === "in" && pick.count >= MIN_PAIR),
    pick ? `count=${pick.count}` : "null"
  );
}

// --- pick: edit missing image ---
{
  const ctx = {
    nodeId: "e1",
    nodeType: "edit",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [
      { name: "image", type: "image", wired: false, empty: true },
      { name: "prompt", type: "text", wired: false, empty: true, field: true },
    ],
  };
  const pick = pickRunFailPort(tables, ctx);
  toy(
    "edit-prefers-image",
    !!(pick && pick.port === "image"),
    pick ? pick.port : "null"
  );
}

// --- pick: wired-but-empty upstream ---
{
  const ctx = {
    nodeId: "v1",
    nodeType: "vision",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [{ name: "image", type: "image", wired: true, empty: true }],
  };
  // vision.image has mass 0 in corpus → flat → quiet when tables present
  const pick = pickRunFailPort(tables, ctx);
  toy("vision-flat-quiet", pick === null, pick ? `count=${pick.count}` : "null");
  // same with no tables → allow
  const pick2 = pickRunFailPort(null, ctx);
  toy(
    "vision-no-tables-allows",
    !!(pick2 && pick2.port === "image" && pick2.count === 0),
    pick2 ? `count=${pick2.count}` : "null"
  );
}

// --- multi equally-likely → quiet ---
{
  const ctx = {
    nodeId: "ls1",
    nodeType: "lipsync",
    errorMessage: "no image — wire an image into the image port", // only mentions image
    inputsMeta: [
      { name: "image", type: "image", wired: false, empty: true },
      { name: "audio", type: "audio", wired: false, empty: true },
    ],
  };
  const pick = pickRunFailPort(tables, ctx);
  // error only names image → should pick image if mass ok, or quiet if flat
  const mass = inMass(tables, "lipsync", "image");
  if (mass >= MIN_PAIR) {
    toy("lipsync-image-only-err", !!(pick && pick.port === "image"), pick ? pick.port : "null");
  } else {
    toy("lipsync-image-flat-quiet", pick === null, pick ? `count=${pick.count}` : "null");
  }

  // Ambiguous: error mentions both somehow via generic dual missing — synthesize equal scores
  const amb = {
    nodeId: "ls2",
    nodeType: "join",
    errorMessage: "no text — type something", // weak; both a and b are text
    inputsMeta: [
      { name: "a", type: "text", wired: false, empty: true },
      { name: "b", type: "text", wired: false, empty: true },
    ],
  };
  // Force equal by using an error that doesn't distinguish — collect may still score both via modality text
  const ambPick = pickRunFailPort(tables, {
    ...amb,
    errorMessage: "no text — wire something",
  });
  // join a/b both text with equal errScore → quiet
  toy("join-multi-tied-quiet", ambPick === null, ambPick ? ambPick.port : "null");
}

// --- llm prompt ---
{
  const ctx = {
    nodeId: "llm1",
    nodeType: "llm",
    errorMessage: "no prompt — type what to ask in the prompt field",
    inputsMeta: [{ name: "prompt", type: "text", wired: false, empty: true, field: true }],
  };
  const pick = pickRunFailPort(tables, ctx);
  toy(
    "llm-prompt-picks",
    !!(pick && pick.port === "prompt" && pick.count >= MIN_PAIR),
    pick ? `count=${pick.count}` : "null"
  );
}

// --- ivideo missing image ---
{
  const ctx = {
    nodeId: "iv1",
    nodeType: "ivideo",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [
      { name: "image", type: "image", wired: false, empty: true },
      { name: "prompt", type: "text", wired: false, empty: false, field: true },
    ],
  };
  const pick = pickRunFailPort(tables, ctx);
  toy(
    "ivideo-image-picks",
    !!(pick && pick.port === "image" && pick.count >= MIN_PAIR),
    pick ? `count=${pick.count}` : "null"
  );
}

// --- gates / identity ---
{
  toy(
    "missing-nodeId-quiet",
    pickRunFailPort(tables, {
      nodeType: "resize",
      errorMessage: "no image — wire an image into the image port",
      inputsMeta: [{ name: "image", type: "image", wired: false, empty: true }],
    }) === null,
    "null"
  );
  toy(
    "missing-nodeType-quiet",
    pickRunFailPort(tables, {
      nodeId: "r1",
      errorMessage: "no image — wire an image into the image port",
      inputsMeta: [{ name: "image", type: "image", wired: false, empty: true }],
    }) === null,
    "null"
  );
  toy(
    "non-missing-err-quiet",
    pickRunFailPort(tables, {
      nodeId: "r1",
      nodeType: "resize",
      errorMessage: "resized image is still over the ~4 MB inline limit",
      inputsMeta: [{ name: "image", type: "image", wired: true, empty: false }],
    }) === null,
    "null"
  );
  toy(
    "id-alias",
    !!(
      pickRunFailPort(tables, {
        id: "r9",
        type: "resize",
        errorMessage: "no image — wire an image into the image port",
        inputsMeta: [{ name: "image", type: "image", wired: false, empty: true }],
      })?.nodeId === "r9"
    ),
    "r9"
  );
}

// --- no / empty tables ---
{
  const ctx = {
    nodeId: "r1",
    nodeType: "resize",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [{ name: "image", type: "image", wired: false, empty: true }],
  };
  const pick = pickRunFailPort(null, ctx);
  toy("no-tables-allows", !!(pick && pick.count === 0 && pick.port === "image"), pick ? `count=${pick.count}` : "null");
  const pick2 = pickRunFailPort({}, ctx);
  toy("empty-tables-allows", !!(pick2 && pick2.count === 0), pick2 ? `count=${pick2.count}` : "null");
}

// --- below MIN_PAIR synthetic ---
{
  const tiny = { topTargets: { "z|out": { "resize|image": 1 } } };
  const pick = pickRunFailPort(tiny, {
    nodeId: "r1",
    nodeType: "resize",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [{ name: "image", type: "image", wired: false, empty: true }],
  });
  toy("below-min-pair-quiet", pick === null, pick ? `count=${pick.count}` : "null");
  const okTab = { topTargets: { "z|out": { "resize|image": MIN_PAIR } } };
  const pick2 = pickRunFailPort(okTab, {
    nodeId: "r1",
    nodeType: "resize",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [{ name: "image", type: "image", wired: false, empty: true }],
  });
  toy("at-min-pair-picks", !!(pick2 && pick2.count === MIN_PAIR), pick2 ? `count=${pick2.count}` : "null");
}

// --- collect candidates ---
{
  const cands = collectMissingInputCandidates({
    nodeId: "e1",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [
      { name: "image", type: "image", wired: false, empty: true },
      { name: "prompt", type: "text", wired: false, empty: true, field: true },
    ],
  });
  toy("collect-has-image", cands.some((c) => c.name === "image" && c.errScore > 0), `n=${cands.length}`);
  toy(
    "collect-skips-filled",
    !collectMissingInputCandidates({
      errorMessage: "no image — wire an image into the image port",
      inputsMeta: [{ name: "image", type: "image", wired: true, empty: false }],
    }).length,
    "empty"
  );
}

// --- exports / docs ---
{
  toy("gates-exported", MIN_PAIR >= 2 && MIN_LEAD > 1 && MIN_SHARE > 0, `pair=${MIN_PAIR}`);
  toy("helper-mentions-621", /#621|gallery inbound|inbound mass/.test(helper), "gallery/#621");
  toy("helper-distinct-46", /·\s*46|aborted-wire/.test(helper), "distinct ·46");
  toy("helper-distinct-44", /·\s*44|post-delete/.test(helper), "distinct ·44");
}

// --- editor wiring pins ---
{
  toy("html-has-css", /\.port\.na-run-fail-port\s*\{/.test(index), ".port.na-run-fail-port");
  toy("html-has-keyframes", /@keyframes\s+naRunFailPortPulse/.test(index), "naRunFailPortPulse");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,200}na-run-fail-port/.test(index) ||
      /runFailPortReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-clearRunFailPort", index.includes("clearRunFailPort"), "fn");
  toy("html-applyRunFailPort", index.includes("applyRunFailPort"), "fn");
  toy("html-scheduleRunFailPort", index.includes("scheduleRunFailPort"), "fn");
  toy("html-pick-call", /pickRunFailPort\s*\(/.test(index), "call site");
  toy(
    "html-startWire-clears",
    /function startWire[\s\S]{0,280}clearRunFailPort/.test(index),
    "startWire clears"
  );
  toy(
    "html-catch-schedules",
    /setStatus\(n,\s*"error",\s*friendlyRunError[\s\S]{0,280}scheduleRunFailPort/.test(index),
    "catch schedules"
  );
  toy(
    "html-connect-clears",
    /connect\s*=\s*function[\s\S]{0,320}clearRunFailPort/.test(index),
    "connect clears"
  );
  toy(
    "html-select-clears",
    /select\s*=\s*function[\s\S]{0,400}clearRunFailPort/.test(index),
    "select clears"
  );
  toy(
    "html-run-clears",
    /runGroup\s*=\s*function[\s\S]{0,280}clearRunFailPort/.test(index),
    "new run clears"
  );
  toy("html-ttl", /RUN_FAIL_PORT_TTL_MS\s*=\s*1[0-9]{3}/.test(index), "TTL ~1–1.5s");
  toy(
    "html-geoOn-gate",
    /applyRunFailPort[\s\S]{0,500}geoOn/.test(index),
    "geoOn gate"
  );
  toy(
    "html-compatible-class",
    /na-run-fail-port[\s\S]{0,200}compatible|compatible[\s\S]{0,80}na-run-fail-port/.test(index),
    "uses .compatible"
  );
  toy(
    "surface-exports-pick",
    /pickRunFailPort\(ctx\)/.test(surface) && /from "\.\/run-fail-port\.mjs"/.test(surface),
    "editor-surface"
  );
  toy("readme-mentions-49", /·\s*49|Product · 49|run-fail-port/.test(readme), "README · 49");
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?49/.test(index) && !/\?product=49/.test(index),
    "no ?product=49"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-49-usage.gif")),
    "product-49-usage.gif"
  );
  toy(
    "distinct-class",
    index.includes("na-run-fail-port") && !index.includes("na-run-fail-port-panel"),
    "distinct .na-run-fail-port"
  );
  toy(
    "build-inputs-meta",
    index.includes("buildRunFailInputsMeta"),
    "buildRunFailInputsMeta"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\nrun-fail-port toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  fail(failed.map((f) => f.name).join(", "));
}
console.log("✓ next-action-run-fail-port");
