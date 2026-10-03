#!/usr/bin/env node
/**
 * Product · 38 — recent-type recency toys.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  rankRecentTypeRecency,
  applyRecentTypeLift,
  SOURCE,
  REASON,
} from "../vendor/next-action/recent-type-recency.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(ROOT, "vendor/next-action/editor-surface.mjs"), "utf8");
const readme = readFileSync(join(ROOT, "vendor/next-action/README.md"), "utf8");

function fail(msg) {
  console.error(`✗ next-action-recent-type-recency: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}
assert(existsSync(join(ROOT, "vendor/next-action/recent-type-recency.mjs")), "missing helper");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

const known = new Set(["text", "image", "llm", "tts", "join"]);

{
  const hits = rankRecentTypeRecency(["add:tts", "add:tts"], { nodeTypes: known });
  toy("repeated-type-clear", hits.length === 1 && hits[0].type === "tts" && hits[0].reason === REASON, JSON.stringify(hits));
}

{
  const hits = rankRecentTypeRecency(["add:image", "add:tts"], { nodeTypes: known });
  toy("two-singles-tie-quiet", hits.length === 0, JSON.stringify(hits));
}

{
  const hits = rankRecentTypeRecency(["add:image", "add:tts", "add:llm"], { nodeTypes: known });
  toy("three-singles-quiet", hits.length === 0, JSON.stringify(hits));
}

{
  const hits = rankRecentTypeRecency(["add:image", "add:tts", "add:image"], { nodeTypes: known });
  toy("repeated-beats-one", hits.length === 1 && hits[0].type === "image", JSON.stringify(hits));
}

{
  const hits = rankRecentTypeRecency([], { nodeTypes: known });
  toy("empty-quiet", hits.length === 0, "[]");
  toy("disabled-quiet", rankRecentTypeRecency(["add:tts", "add:tts"], { disabled: true }).length === 0, "off");
}

{
  const prior = [{ type: "image", source: "recipe", reason: "from recipe" }];
  const hits = rankRecentTypeRecency(["add:tts", "add:tts"], { nodeTypes: known, priorAdds: prior });
  toy("strong-prior-quiet", hits.length === 0, JSON.stringify(hits));
  const applied = applyRecentTypeLift(prior, [{ type: "tts", action: "add:tts", source: SOURCE, reason: REASON, share: 1 }]);
  toy("strong-apply-unchanged", applied.changed === false && applied.adds[0].source === "recipe", JSON.stringify(applied));
}

{
  const prior = [
    { type: "image", source: "frequency", reason: "often added next" },
    { type: "llm", source: "frequency", reason: "often added next" },
  ];
  const hits = rankRecentTypeRecency(["add:tts", "add:tts"], { nodeTypes: known });
  const applied = applyRecentTypeLift(prior, hits);
  toy(
    "lifts-ahead-of-frequency",
    applied.changed === true && applied.adds[0].type === "tts" && applied.tagged.length === 1 && applied.tagged[0] === "tts",
    JSON.stringify(applied)
  );
  toy("keeps-prior-reasons", applied.adds[1].reason === "often added next", applied.adds[1].reason);
}

{
  const prior = [{ type: "tts", source: "frequency", reason: "often added next" }];
  const hits = rankRecentTypeRecency(["add:tts"], { nodeTypes: known });
  const applied = applyRecentTypeLift(prior, hits);
  toy("already-first-no-retag", applied.changed === false && applied.tagged.length === 0, JSON.stringify(applied));
}

{
  const applied = applyRecentTypeLift([], rankRecentTypeRecency(["add:join"], { nodeTypes: known }));
  toy("empty-prior-inserts-tag", applied.changed === true && applied.adds[0].type === "join", JSON.stringify(applied));
}

toy("surface", /rankRecentTypeRecency\(opts/.test(surface) && /recent-type-recency\.mjs/.test(surface), "surface");
toy("html", index.includes("applyRecentTypeLift") && index.includes("recentTypeMap"), "html");
toy("html-search-untouched", /if\(!q\)\{[\s\S]{0,800}applyRecentTypeLift/.test(index) || /recentTypeMap\(/.test(index), "empty query only");
toy("html-off", /na\.disabled/.test(index), "flag");
toy("readme", /·\s*38/.test(readme) && readme.includes("check-next-action-recent-type-recency.mjs"), "readme");

const failed = toys.filter((t) => !t.ok);
console.log(`\nrecent-type-recency toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) fail(`${failed.length} failed`);
console.log("✓ next-action-recent-type-recency");
