#!/usr/bin/env node
// Leftover Product · 38 recent-type edges after #652 / #674.
// Those pins cover a repeated type, two/three-single ties, empty/disabled,
// a strong prior quiet + apply unchanged, lift-ahead-of-frequency, already
// first no-retag, and an empty prior insert. This file pins the leftover
// token/window contract: wire:/set: are not adds, {token} objects hydrate
// the same as strings, k keeps only the newest add:* window, and
// quietIfStrongPrior:false still ranks under a recipe prior. Offline,
// zero API spend. New file so it does not collide with the shipped check.
import {
  extractRecentAdds,
  normalizeRingTokens,
  rankRecentTypeRecency,
  SOURCE,
} from "../vendor/next-action/recent-type-recency.mjs";

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

const known = new Set(["text", "image", "llm", "tts", "join"]);

{
  const tokens = normalizeRingTokens([
    { token: "add:x" },
    "add:y",
    { token: "" },
    { foo: "add:tts" },
    { token: 123 },
    null,
    { token: "add:z" },
  ]);
  if (JSON.stringify(tokens) !== JSON.stringify(["add:x", "add:y", "add:z"]))
    fail(`{token} objects must hydrate string tokens only, got ${JSON.stringify(tokens)}`);
  else ok("{token} objects hydrate; empty / non-string / missing token drop out");
}

{
  const mixed = extractRecentAdds(
    ["wire:a|b", "set:model", { token: "add:tts" }, "add:tts", "wire:c|d"],
    8
  );
  const none = extractRecentAdds(["wire:a|b", "set:model", "open:examples"], 8);
  if (JSON.stringify(mixed) !== JSON.stringify(["add:tts", "add:tts"]))
    fail(`wire:/set: must not count as recent adds, got ${JSON.stringify(mixed)}`);
  else if (none.length)
    fail(`a wire:/set:-only ring must be empty, got ${JSON.stringify(none)}`);
  else ok("extractRecentAdds skips wire: / set: and keeps add:*");
}

{
  const hits = rankRecentTypeRecency(
    ["wire:a|b", "set:model", "add:tts", "add:tts"],
    { nodeTypes: known }
  );
  const quiet = rankRecentTypeRecency(["wire:a|b", "set:model"], { nodeTypes: known });
  if (hits.length !== 1 || hits[0].type !== "tts" || hits[0].source !== SOURCE)
    fail(`wire:/set: noise must not hide a clear recent add, got ${JSON.stringify(hits)}`);
  else if (quiet.length)
    fail(`wire:/set: only must stay quiet, got ${JSON.stringify(quiet)}`);
  else ok("wire:/set: tokens do not invent or hide a recent-type hit");
}

{
  const objects = rankRecentTypeRecency(
    [{ token: "add:tts" }, { token: "add:tts" }],
    { nodeTypes: known }
  );
  const junk = rankRecentTypeRecency(
    [{ token: "" }, { foo: "add:tts" }, { token: 123 }, null, { token: "add:tts" }, { token: "add:tts" }],
    { nodeTypes: known }
  );
  if (objects.length !== 1 || objects[0].type !== "tts")
    fail(`{token} entries must rank like strings, got ${JSON.stringify(objects)}`);
  else if (junk.length !== 1 || junk[0].type !== "tts" || junk[0].count !== 2)
    fail(`junk objects must not count as adds, got ${JSON.stringify(junk)}`);
  else ok("{token} ring entries rank the same as add:* strings");
}

{
  const ring = [
    "add:image",
    "add:image",
    "add:image",
    "add:image",
    "add:image",
    "add:tts",
    "add:tts",
    "add:tts",
  ];
  const windowed = extractRecentAdds(ring, 3);
  const short = rankRecentTypeRecency(ring, { nodeTypes: known, k: 3 });
  const full = rankRecentTypeRecency(ring, { nodeTypes: known, k: 8 });
  if (JSON.stringify(windowed) !== JSON.stringify(["add:tts", "add:tts", "add:tts"]))
    fail(`k=3 must keep the newest three adds, got ${JSON.stringify(windowed)}`);
  else if (short.length !== 1 || short[0].type !== "tts")
    fail(`k=3 must make the newest type clear, got ${JSON.stringify(short)}`);
  else if (full.length)
    fail(`default-width k must not invent a majority from the short window, got ${JSON.stringify(full)}`);
  else ok("k window keeps only the newest add:* tokens");
}

{
  const prior = [{ type: "image", source: "recipe", reason: "from recipe" }];
  const def = rankRecentTypeRecency(["add:tts", "add:tts"], { nodeTypes: known, priorAdds: prior });
  const forced = rankRecentTypeRecency(["add:tts", "add:tts"], {
    nodeTypes: known,
    priorAdds: prior,
    quietIfStrongPrior: false,
  });
  const explicit = rankRecentTypeRecency(["add:tts", "add:tts"], {
    nodeTypes: known,
    priorAdds: prior,
    quietIfStrongPrior: true,
  });
  if (def.length)
    fail(`a recipe prior must stay quiet by default, got ${JSON.stringify(def)}`);
  else if (explicit.length)
    fail(`quietIfStrongPrior:true must stay quiet, got ${JSON.stringify(explicit)}`);
  else if (forced.length !== 1 || forced[0].type !== "tts")
    fail(`quietIfStrongPrior:false must still rank, got ${JSON.stringify(forced)}`);
  else ok("quietIfStrongPrior:false ranks under a strong prior; default stays quiet");
}

if (failed) {
  console.error(`\n${failed} leftover recent-type pin(s) failed`);
  process.exit(1);
}
console.log("✓ recent-type leftover pins");
