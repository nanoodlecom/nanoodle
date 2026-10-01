#!/usr/bin/env node
/**
 * Product · 45 — settled-run next-add boost toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_TYPES } from "../vendor/next-action/encode.mjs";
import { createSuggestionMemory } from "../vendor/next-action/suggestion-memory.mjs";
import {
  buildModalityFollowOns,
  normalizeOutputType,
  createSettledRunState,
  scoreSettledFollowOns,
  gateConfidentSettled,
  rankSettledRunNextAdd,
  softMergeSettledRun,
  priorHasStrongSource,
  inferSettledOutputType,
  SOURCE,
  REASON,
  STRONG_SOURCES,
  MAX_SETTLED_SUGGEST,
  DEFAULT_TTL_MS,
  MIN_SHARE,
  MIN_LEAD,
} from "../vendor/next-action/settled-run-next-add.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-settled-run-next-add: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(
  existsSync(join(NA, "settled-run-next-add.mjs")),
  "missing settled-run-next-add.mjs"
);

const known = new Set(NODE_TYPES);
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const helperSrc = readFileSync(join(NA, "settled-run-next-add.mjs"), "utf8");
const hintsSrc = readFileSync(join(NA, "hints.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");
const recipes = JSON.parse(
  readFileSync(join(NA, "corpus", "recipes.json"), "utf8")
);

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

// --- normalize / state ---
{
  toy(
    "normalize-string",
    normalizeOutputType("image") === "image" &&
      normalizeOutputType("add:llm") === "llm",
    "image/llm"
  );
  toy(
    "normalize-object",
    normalizeOutputType({ type: "ivideo", ok: true }) === "ivideo" &&
      normalizeOutputType({ ok: false, type: "image" }) === "",
    "obj"
  );
  toy(
    "normalize-empty",
    normalizeOutputType("") === "" &&
      normalizeOutputType("comment") === "" &&
      normalizeOutputType(null) === "",
    "empty"
  );
  const st = createSettledRunState();
  toy("state-empty", st.get() === null, "null");
  st.note({ type: "image", ok: true }, 1000);
  toy(
    "state-notes",
    st.get()?.type === "image" && st.get()?.at === 1000,
    JSON.stringify(st.get())
  );
  toy("state-not-expired", st.expired(2000, 5000) === false, "alive");
  toy("state-expired", st.expired(10_000, 5000) === true, "ttl");
  st.clear();
  toy("state-clear", st.get() === null, "cleared");
}

// --- follow-ons from recipes ---
{
  const follow = buildModalityFollowOns(recipes);
  toy(
    "followons-built",
    follow && typeof follow === "object" && Object.keys(follow).length >= 3,
    `keys=${Object.keys(follow).length}`
  );
  toy(
    "followons-image-has-next",
    !!(follow.image && Object.keys(follow.image).length),
    JSON.stringify(follow.image || {})
  );
  toy(
    "followons-empty-corpus",
    Object.keys(buildModalityFollowOns({ recipes: [] })).length === 0,
    "[]"
  );
  toy(
    "followons-from-array",
    buildModalityFollowOns([
      { sequence: ["text", "image", "ivideo"] },
    ]).image?.ivideo === 1,
    "array form"
  );
}

// --- quiet gates ---
{
  const follow = buildModalityFollowOns(recipes);
  toy(
    "no-modality-quiet",
    rankSettledRunNextAdd(null, follow, { nodeTypes: known }).length === 0,
    "[]"
  );
  toy(
    "no-recipe-quiet",
    rankSettledRunNextAdd({ type: "image", at: Date.now() }, null, {
      nodeTypes: known,
    }).length === 0,
    "[]"
  );
  toy(
    "disabled-quiet",
    rankSettledRunNextAdd({ type: "image", at: Date.now() }, follow, {
      nodeTypes: known,
      disabled: true,
    }).length === 0,
    "[]"
  );
  toy(
    "reduced-motion-quiet",
    rankSettledRunNextAdd({ type: "image", at: Date.now() }, follow, {
      nodeTypes: known,
      prefersReducedMotion: true,
    }).length === 0,
    "[]"
  );
  toy(
    "strong-prior-quiet",
    rankSettledRunNextAdd({ type: "image", at: Date.now() }, follow, {
      nodeTypes: known,
      priorAdds: [
        {
          type: "llm",
          action: "add:llm",
          source: "recipe",
          reason: "from recipe",
        },
      ],
    }).length === 0,
    "[]"
  );
  toy(
    "ttl-expired-quiet",
    rankSettledRunNextAdd(
      { type: "image", at: 0 },
      follow,
      { nodeTypes: known, now: DEFAULT_TTL_MS + 1000, ttlMs: DEFAULT_TTL_MS }
    ).length === 0,
    "[]"
  );
  toy(
    "unknown-type-quiet",
    rankSettledRunNextAdd({ type: "not-a-real-type", at: Date.now() }, follow, {
      nodeTypes: known,
    }).length === 0,
    "[]"
  );
}

// --- confident boost ---
{
  const follow = buildModalityFollowOns(recipes);
  const hits = rankSettledRunNextAdd(
    { type: "image", at: Date.now() },
    follow,
    { nodeTypes: known }
  );
  toy(
    "image-settle-boosts",
    hits.length >= 1 && hits[0].source === SOURCE,
    `top=${hits.map((h) => h.type + "@" + (h.share || 0).toFixed(2)).join("|")}`
  );
  toy(
    "image-settle-reason",
    hits.length >= 1 &&
      (hits[0].reason === REASON || hits[0].reason.includes("last output")),
    hits[0]?.reason || "-"
  );
  toy(
    "image-settle-includes-followon",
    hits.some((h) => ["image", "ivideo", "resize", "llm", "join"].includes(h.type)),
    hits.map((h) => h.type).join(",")
  );
}

// --- flat scores quiet ---
{
  const flat = [
    { action: "add:text", type: "text", score: 4, source: SOURCE, reason: REASON },
    { action: "add:image", type: "image", score: 4, source: SOURCE, reason: REASON },
    { action: "add:llm", type: "llm", score: 4, source: SOURCE, reason: REASON },
    { action: "add:edit", type: "edit", score: 4, source: SOURCE, reason: REASON },
  ];
  const gated = gateConfidentSettled(flat);
  toy("flat-scores-quiet", gated.length === 0, `gated=${gated.length}`);

  const peakedFollow = { image: { ivideo: 10, edit: 1, resize: 1 } };
  const scored = scoreSettledFollowOns("image", peakedFollow, {
    nodeTypes: known,
  });
  const ok = gateConfidentSettled(scored);
  toy(
    "peaked-followon-passes",
    ok.length >= 1 && ok[0].type === "ivideo",
    `top=${ok.map((h) => h.type).join(",")}`
  );
}

// --- memory ---
{
  const follow = { image: { join: 3, edit: 2 } };
  const mem = createSuggestionMemory({ storage: null, enabled: true });
  mem.noteChoice("add:join", ["add:join", "add:edit"]);
  mem.noteChoice("add:join", ["add:join", "add:edit"]);
  const hits = rankSettledRunNextAdd(
    { type: "image", at: Date.now() },
    follow,
    { nodeTypes: known, memory: mem }
  );
  toy(
    "memory-reweight-applies",
    Array.isArray(hits) && hits.length >= 1,
    `n=${hits.length} top=${hits.map((h) => h.type + ":" + h.reason).join("|")}`
  );
}

// --- soft-merge ---
{
  const follow = { image: { ivideo: 8, edit: 1 } };
  const prior = [
    {
      type: "llm",
      action: "add:llm",
      reason: "often added next",
      source: "",
      share: 0.4,
    },
  ];
  const hits = rankSettledRunNextAdd(
    { type: "image", at: Date.now() },
    follow,
    { nodeTypes: known, quietIfStrongPrior: false }
  );
  const merged = softMergeSettledRun(prior, hits);
  toy(
    "soft-merge-keeps-prior",
    merged.some((a) => a.type === "llm"),
    merged.map((a) => a.type + ":" + (a.source || "-")).join("|")
  );
  toy(
    "soft-merge-adds-settled",
    merged.some((a) => a.source === SOURCE && a.type === "ivideo"),
    merged.map((a) => a.type + ":" + a.source).join("|")
  );
  const strongPrior = [
    {
      type: "llm",
      action: "add:llm",
      reason: "from recipe",
      source: "recipe",
      share: 0.6,
    },
  ];
  toy(
    "soft-merge-strong-prior-quiet",
    softMergeSettledRun(strongPrior, hits).length === 1 &&
      softMergeSettledRun(strongPrior, hits)[0].source === "recipe",
    softMergeSettledRun(strongPrior, hits)
      .map((a) => a.type + ":" + a.source)
      .join("|")
  );
  toy(
    "soft-merge-no-stomp-strong-type",
    softMergeSettledRun(
      [
        {
          type: "ivideo",
          action: "add:ivideo",
          reason: "from recipe",
          source: "recipe",
          share: 0.7,
        },
      ],
      hits
    ).find((a) => a.type === "ivideo")?.source === "recipe",
    "kept recipe"
  );
  toy(
    "soft-merge-upgrades-empty-source",
    softMergeSettledRun(
      [
        {
          type: "ivideo",
          action: "add:ivideo",
          reason: "common first node",
          source: "",
          share: 0.5,
        },
      ],
      hits
    ).find((a) => a.type === "ivideo")?.source === SOURCE,
    "upgraded"
  );
  toy(
    "soft-merge-empty-unchanged",
    softMergeSettledRun(prior, []).length === 1 &&
      softMergeSettledRun(prior, [])[0].type === "llm",
    "unchanged"
  );
  toy(
    "prior-has-strong",
    priorHasStrongSource(strongPrior) === true &&
      priorHasStrongSource(prior) === false,
    "ok"
  );
}

// --- infer output type ---
{
  toy(
    "infer-from-seeds",
    inferSettledOutputType({
      seedIds: ["a", "b"],
      nodes: [
        { id: "a", type: "text", status: "ok" },
        { id: "b", type: "image", status: "ok" },
        { id: "c", type: "llm", status: "error" },
      ],
    }) === "image",
    "image"
  );
  toy(
    "infer-fallback-any-ok",
    inferSettledOutputType({
      seedIds: ["x"],
      nodes: [
        { id: "x", type: "text", status: "error" },
        { id: "y", type: "ivideo", ok: true },
      ],
    }) === "ivideo",
    "ivideo"
  );
  toy(
    "infer-empty",
    inferSettledOutputType({ nodes: [] }) === "",
    "empty"
  );
}

// --- wiring pins ---
{
  toy(
    "surface-imports-helper",
    surface.includes("settled-run-next-add.mjs") &&
      surface.includes("rankSettledRunNextAdd") &&
      surface.includes("noteSettledRun") &&
      surface.includes("buildModalityFollowOns"),
    "editor-surface API"
  );
  toy(
    "surface-builds-followons",
    surface.includes("modalityFollowOns") &&
      surface.includes("createSettledRunState"),
    "state + tables"
  );
  toy(
    "hints-settled-reason",
    hintsSrc.includes('source === "settled-run"') &&
      hintsSrc.includes("follows last output"),
    "reason tag"
  );
  toy(
    "index-hooks-addhint",
    index.includes("rankSettledRunNextAdd") &&
      index.includes("settled-run") &&
      index.includes("follows last output") &&
      index.includes("noteSettledRun"),
    "addHintMap + settle path"
  );
  toy(
    "index-clears-on-add",
    index.includes("clearSettledRun"),
    "clearSettledRun"
  );
  toy(
    "readme-mentions-45",
    readme.includes("settled-run-next-add.mjs") && /· 45/.test(readme),
    "README row"
  );
  toy(
    "check-script-listed",
    readme.includes("check-next-action-settled-run-next-add.mjs"),
    "README checks"
  );
  toy(
    "no-tip-panel",
    !helperSrc.includes("na-tip") &&
      !helperSrc.includes("tip-panel") &&
      !existsSync(join(NA, "demo", "product-45.html")) &&
      !existsSync(join(ROOT, "vendor", "next-action", "product-45.html")),
    "no tip / no twin"
  );
  toy(
    "no-product-query-twin",
    !index.includes("?product=45") && !helperSrc.includes("product=45"),
    "no ?product=45"
  );
  toy(
    "strong-sources-listed",
    STRONG_SOURCES.includes("recipe") &&
      STRONG_SOURCES.includes("first-trio") &&
      STRONG_SOURCES.includes("learned"),
    STRONG_SOURCES.join(",")
  );
  toy(
    "constants-sane",
    MAX_SETTLED_SUGGEST === 3 &&
      DEFAULT_TTL_MS >= 10_000 &&
      MIN_SHARE > 0 &&
      MIN_LEAD > 1,
    `max=${MAX_SETTLED_SUGGEST} ttl=${DEFAULT_TTL_MS}`
  );
  toy(
    "source-constant",
    SOURCE === "settled-run" && REASON === "follows last output",
    SOURCE + "/" + REASON
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-45-usage.gif")),
    "product-45-usage.gif"
  );
}

const passed = toys.filter((t) => t.ok).length;
const total = toys.length;
console.log(`\nsettled-run-next-add toys: ${passed}/${total} ok`);
if (passed !== total) {
  fail(`${total - passed} toy(s) failed`);
}
