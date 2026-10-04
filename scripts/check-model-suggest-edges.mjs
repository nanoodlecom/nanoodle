#!/usr/bin/env node
// Leftover Product · 24 model-suggest edges after #641 / #674.
// Those pins cover GLM / Muse happy-path lift, already-first no-tag,
// flat prior, search/custom-sort quiet. This file pins the leftover
// scope contract: byNodeType wins over byKind, typeToKind falls back
// when the node type has no own table, an unknown type with no kind
// stays empty, MAX_MODEL_SUGGEST caps the tagged list, and
// liftChangedModels skips ids that are not on today's picker.
// Offline, zero API spend. New file so it does not collide with the
// shipped check.
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_MODEL_SUGGEST,
  countsForScope,
  rankModelSuggestions,
  liftChangedModels,
} from "../vendor/next-action/model-suggest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const priors = JSON.parse(
  readFileSync(join(ROOT, "vendor", "next-action", "corpus", "model-suggest.json"), "utf8")
);

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

{
  const mixed = {
    byNodeType: { llm: { "node/own": 4 } },
    byKind: { chat: { "kind/other": 99 } },
    typeToKind: { llm: "chat" },
  };
  const scoped = countsForScope(mixed, "llm");
  if (scoped["node/own"] !== 4 || scoped["kind/other"])
    fail(`byNodeType must win over byKind, got ${JSON.stringify(scoped)}`);
  else ok("byNodeType wins over byKind for the same node type");
}

{
  const scoped = countsForScope(priors, "vlm");
  const chat = priors.byKind && priors.byKind.chat;
  if (!chat || scoped["z-ai/glm-5.3-flash"] !== chat["z-ai/glm-5.3-flash"])
    fail(`vlm must fall through typeToKind→chat, got ${JSON.stringify(scoped)}`);
  else if (countsForScope(priors, "llm")["z-ai/glm-5.3-flash"] !== priors.byNodeType.llm["z-ai/glm-5.3-flash"])
    fail("llm must still read byNodeType, not the chat kind table");
  else ok("typeToKind falls back when the node type has no own table");
}

{
  const empty = countsForScope(priors, "unknown-type");
  const hits = rankModelSuggestions("unknown-type", ["z-ai/glm-5.3-flash"], priors);
  if (Object.keys(empty).length !== 0)
    fail(`unknown type with no kind must be {}, got ${JSON.stringify(empty)}`);
  else if (hits.length)
    fail(`unknown type must rank nothing, got ${JSON.stringify(hits)}`);
  else ok("unknown node type with no kind stays empty");
}

{
  if (MAX_MODEL_SUGGEST !== 3)
    fail(`MAX_MODEL_SUGGEST drifted, got ${MAX_MODEL_SUGGEST}`);
  // Four types clear MIN_SHARE; the 4th must still be dropped by the cap.
  const fat = {
    byNodeType: {
      llm: { m0: 100, m1: 60, m2: 55, m3: 50, m4: 5 },
    },
  };
  const hits = rankModelSuggestions("llm", ["m0", "m1", "m2", "m3", "m4"], fat);
  if (hits.length !== 3 || hits[0].id !== "m0" || hits[2].id !== "m2" || hits.some((h) => h.id === "m3"))
    fail(`MAX_MODEL_SUGGEST must cap at 3, got ${JSON.stringify(hits)}`);
  else ok("MAX_MODEL_SUGGEST caps the ranked list at 3");
}

{
  const hits = rankModelSuggestions("llm", ["z-ai/glm-5.3-flash", "rare/new"], priors);
  const skipped = liftChangedModels([{ id: "rare/new" }, { id: "other/quiet" }], hits);
  const empty = liftChangedModels([], hits);
  if (skipped !== null)
    fail(`a suggestion id not on today's picker must not lift, got ${JSON.stringify(skipped)}`);
  else if (empty !== null)
    fail(`an empty picker list must stay null, got ${JSON.stringify(empty)}`);
  else ok("liftChangedModels skips ids that are not on today's picker");
}

if (failed) {
  console.error(`\n${failed} leftover model-suggest pin(s) failed`);
  process.exit(1);
}
console.log("✓ model-suggest leftover pins");
