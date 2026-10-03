#!/usr/bin/env node
// Leftover Product · 20 first-node ranking edges after #636 / #667.
// Those pins cover seat pan/zoom, NaN/missing view, firstNodeCounts
// skipping non-add / folding trio heads, a 2-step firstTrio prefix,
// empty/NaN merge identity, and helpersOff. This file pins the other
// half of the count source: an empty firstNode object must fall through
// to coldStart, a populated firstNode must replace (not merge) coldStart,
// and a flat firstNode table below MIN_SHARE must leave frequency rows
// untouched. Offline, zero API spend. New file so it does not collide
// with open leftover PRs.
import { MIN_SHARE } from "../vendor/next-action/hints.mjs";
import {
  firstNodeCounts,
  rankFirstNodes,
  mergeFirstNodeRows,
} from "../vendor/next-action/first-node.mjs";

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

{
  const counts = firstNodeCounts({
    firstNode: {},
    coldStart: { "add:text": 5, "add:image": 2, "wire:x": 9 },
  });
  if (counts["add:text"] !== 5 || counts["add:image"] !== 2)
    fail(`empty firstNode must fall through to coldStart, got ${JSON.stringify(counts)}`);
  else if (counts["wire:x"])
    fail(`coldStart fallback must still skip non-add, got ${JSON.stringify(counts)}`);
  else ok("empty firstNode object falls through to coldStart");
}

{
  const counts = firstNodeCounts({
    firstNode: { "add:image": 1 },
    coldStart: { "add:text": 99, "add:image": 50 },
    firstTrio: [],
  });
  if (counts["add:text"])
    fail(`populated firstNode must not merge coldStart, got ${JSON.stringify(counts)}`);
  else if (counts["add:image"] !== 1)
    fail(`populated firstNode add:image should stay 1, got ${counts["add:image"]}`);
  else ok("populated firstNode replaces coldStart (does not merge)");
}

{
  const ranked = rankFirstNodes(
    { firstNode: {}, coldStart: { "add:text": 8, "add:image": 1 } },
    { numNodes: 0 },
    [],
    3,
  );
  if (ranked.length < 1 || ranked[0].action !== "add:text" || ranked[0].source !== "first-node")
    fail(`coldStart fallback must still rank first nodes, got ${JSON.stringify(ranked)}`);
  else ok("rankFirstNodes uses coldStart when firstNode is empty");
}

{
  const rows = [{ action: "add:join", score: 9, source: "frequency" }];
  const firstNode = {};
  for (let i = 0; i < 10; i++) firstNode["add:t" + i] = 1;
  const merged = mergeFirstNodeRows(rows, { firstNode, firstTrio: [] }, [], { numNodes: 0 });
  const topShare = 1 / 10;
  if (!(topShare < MIN_SHARE))
    fail(`flat firstNode fixture drifted (share=${topShare} MIN_SHARE=${MIN_SHARE})`);
  else if (merged !== rows)
    fail(`flat firstNode below MIN_SHARE must return the same rows, got ${JSON.stringify(merged)}`);
  else ok("flat firstNode below MIN_SHARE leaves frequency rows untouched");
}

if (failed) {
  console.error(`\n${failed} leftover #636 first-node fallback pin(s) failed`);
  process.exit(1);
}
console.log("✓ first-node fallback leftover pins");
