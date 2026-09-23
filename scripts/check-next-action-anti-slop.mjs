#!/usr/bin/env node
/**
 * Product · 9 — anti-slop / soft reject prior toys.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAntiSlop,
  recommendAntiSlop,
  isShallowTextLlm,
  countSlopBigrams,
  nonCommentCounts,
  expandToVocab,
  DEFAULT_PRIORS,
} from "../vendor/next-action/anti-slop.mjs";
import { recommendFrequency } from "../vendor/next-action/frequency.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "anti-slop.json");
const FREQ = join(NA, "corpus", "frequency-tables.json");

function fail(msg) {
  console.error(`✗ next-action-anti-slop: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(CORPUS), `missing ${CORPUS}`);
assert(existsSync(FREQ), `missing ${FREQ}`);
assert(existsSync(join(NA, "anti-slop.mjs")), "missing anti-slop.mjs");

const priors = JSON.parse(readFileSync(CORPUS, "utf8"));
assert(priors.product === 9, "corpus product !== 9");
assert(Array.isArray(priors.slopActions) && priors.slopActions.includes("add:text"), "slopActions");
assert(Array.isArray(priors.richActions) && priors.richActions.includes("add:image"), "richActions");
assert(Array.isArray(priors.rejectBigrams) && priors.rejectBigrams.length >= 2, "rejectBigrams");

const tables = JSON.parse(readFileSync(FREQ, "utf8"));

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  const empty = { numNodes: 0, nodeTypeCounts: {} };
  toy("helper-empty-not-shallow", !isShallowTextLlm(empty, priors), `shallow=${isShallowTextLlm(empty, priors)}`);
  const base = [
    { action: "add:text", score: 10 },
    { action: "add:image", score: 8 },
    { action: "open:examples", score: 6 },
  ];
  const out = applyAntiSlop(base, [], empty, { priors, expand: false });
  toy(
    "empty-canvas-passthrough",
    out.length === 3 && out[0].action === "add:text" && !out.some((r) => r.masked),
    `top=${out.map((r) => r.action).join(",")} masked=${out.filter((r) => r.masked).length}`
  );
}

{
  const sketch = { numNodes: 2, nodeTypeCounts: { text: 1, llm: 1 } };
  toy("helper-shallow-text-llm", isShallowTextLlm(sketch, priors), JSON.stringify(nonCommentCounts(sketch)));
}

{
  const n = countSlopBigrams(["add:text", "add:llm", "add:text", "add:llm"], priors);
  // reject set includes text→llm and llm→text → 3 pairs
  toy("helper-slop-bigram-count", n === 3, `n=${n}`);
}

{
  const sketch = { numNodes: 2, nodeTypeCounts: { text: 1, llm: 1 } };
  const hist = ["add:text", "add:llm"];
  const freq = recommendFrequency(tables, hist, sketch, 18);
  const ranked = applyAntiSlop(freq, hist, sketch, { priors, tables, expand: true });
  const top3 = ranked.slice(0, 3);
  const topActions = top3.map((r) => r.action);
  const slopTop = top3.filter((r) => r.action === "add:text" || r.action === "add:llm");
  const richHit = top3.some((r) => (priors.richActions || []).includes(r.action));
  toy(
    "shallow-top-not-dominated-by-text-llm",
    slopTop.length <= 1 && richHit,
    `top=${topActions.join(",")} slopInTop=${slopTop.length}`
  );
  toy(
    "shallow-masks-slop-actions",
    ranked.some((r) => r.masked && (r.action === "add:text" || r.action === "add:llm")),
    `masked=${ranked.filter((r) => r.masked).map((r) => r.action).slice(0, 4).join(",")}`
  );
  const beforePad = expandToVocab(freq, tables);
  const imgBefore = beforePad.find((r) => r.action === "add:image")?.score || 0;
  const imgAfter = ranked.find((r) => r.action === "add:image")?.score || 0;
  toy(
    "shallow-boosts-rich",
    imgAfter > imgBefore,
    `image before=${imgBefore} after=${imgAfter}`
  );
}

{
  const sketch = { numNodes: 1, nodeTypeCounts: { text: 1 } };
  const hist = ["add:text"];
  const base = [
    { action: "add:llm", score: 20 },
    { action: "add:image", score: 9 },
    { action: "add:music", score: 8 },
    { action: "open:examples", score: 7 },
    { action: "add:text", score: 6 },
  ];
  const top = recommendAntiSlop(base, hist, sketch, 3, { priors, expand: false });
  toy(
    "after-text-demotes-llm-loop",
    top[0].action !== "add:llm" && top.some((r) => r.action === "add:image" || r.action === "add:music"),
    `top=${top.map((r) => r.action).join(",")}`
  );
}

{
  const sketch = {
    numNodes: 5,
    nodeTypeCounts: { text: 1, image: 1, edit: 1, music: 1, tts: 1 },
  };
  const hist = ["add:image", "add:edit", "add:music"];
  const base = [
    { action: "add:lipsync", score: 12 },
    { action: "add:ivideo", score: 10 },
    { action: "wire", score: 9 },
    { action: "add:llm", score: 4 },
    { action: "add:text", score: 3 },
  ];
  const out = applyAntiSlop(base, hist, sketch, { priors, expand: false });
  toy(
    "rich-graph-no-nuke",
    !out.some((r) => r.masked) &&
      out[0].action === "add:lipsync" &&
      out[1].action === "add:ivideo",
    `top=${out.slice(0, 3).map((r) => r.action).join(",")} masked=${out.filter((r) => r.masked).length}`
  );
}

{
  const sketch = { numNodes: 2, nodeTypeCounts: { text: 1, llm: 1 } };
  const base = [
    { action: "add:text", score: 100 },
    { action: "add:llm", score: 90 },
    { action: "add:image", score: 1 },
    { action: "add:music", score: 1 },
    { action: "open:examples", score: 1 },
  ];
  const out = applyAntiSlop(base, ["add:text", "add:llm"], sketch, { priors, expand: false });
  toy(
    "soft-mask-keeps-alternatives",
    out.length >= 3 && out.filter((r) => (Number(r.score) || 0) > 0).length >= 3,
    `n=${out.length} positive=${out.filter((r) => r.score > 0).length}`
  );
}

{
  const sketch = { numNodes: 3, nodeTypeCounts: { comment: 3 } };
  toy(
    "comment-only-not-shallow",
    !isShallowTextLlm(sketch, priors),
    `counts=${JSON.stringify(nonCommentCounts(sketch))}`
  );
}

{
  toy(
    "defaults-match-corpus-slop",
    DEFAULT_PRIORS.slopActions.join(",") === priors.slopActions.join(","),
    `default=${DEFAULT_PRIORS.slopActions.join(",")}`
  );
}

{
  const sketch = { numNodes: 2, nodeTypeCounts: { text: 1, llm: 1 } };
  const freq = recommendFrequency(tables, ["add:text", "add:llm"], sketch, 18);
  const top = recommendAntiSlop(freq, ["add:text", "add:llm"], sketch, 3, {
    priors,
    tables,
    expand: true,
  });
  toy("recommend-k-slice", top.length === 3, `n=${top.length} top=${top.map((r) => r.action).join(",")}`);
}

const failed = toys.filter((t) => !t.ok);
console.log(
  `next-action-anti-slop: ${toys.length - failed.length}/${toys.length} toys ok · priors product=${priors.product}`
);
if (failed.length) fail(`${failed.length} toy(s) failed`);
process.exit(0);
