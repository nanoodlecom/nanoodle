#!/usr/bin/env node
// Leftover Product · 20 first-node edges after #636.
// That PR shipped happy-path empty-canvas Text, complementary Image
// follow-up, generic-seed bury, and identity first-seat (pan=0 scale=1).
// This file pins the other half: seat math with pan/zoom, default/NaN
// view, firstNodeCounts skipping non-add / folding trio heads, a 2-step
// firstTrio prefix, and merge identity when the prior is quiet.
// Offline, zero API spend. New file so it does not collide with #619.
import {
  isEmptyCanvas,
  firstNodeCounts,
  rankFirstNodes,
  rankFirstTrioFollowups,
  mergeFirstNodeRows,
  firstNodeSeat,
  shouldSeatFirstNode,
} from "../vendor/next-action/first-node.mjs";

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

{
  const seat = firstNodeSeat({
    viewW: 1000,
    viewH: 800,
    panX: 100,
    panY: 50,
    scale: 2,
    nodeW: 210,
    nodeH: 120,
  });
  if (seat.x !== 95 || seat.y !== 115)
    fail(`firstNodeSeat pan/scale → ${JSON.stringify(seat)} (want {x:95,y:115})`);
  else ok("firstNodeSeat applies pan and scale (not view-center identity)");
}

{
  const zero = firstNodeSeat({ viewW: 1000, viewH: 800, scale: 0, panX: 0, panY: 0, nodeW: 210, nodeH: 120 });
  const neg = firstNodeSeat({ viewW: 1000, viewH: 800, scale: -2, panX: 0, panY: 0, nodeW: 210, nodeH: 120 });
  const ident = firstNodeSeat({ viewW: 1000, viewH: 800, scale: 1, panX: 0, panY: 0, nodeW: 210, nodeH: 120 });
  if (zero.x !== ident.x || zero.y !== ident.y || neg.x !== ident.x || neg.y !== ident.y)
    fail(`scale<=0 must fall back to 1, got zero=${JSON.stringify(zero)} neg=${JSON.stringify(neg)}`);
  else ok("firstNodeSeat scale<=0 falls back to 1");
}

{
  const nan = firstNodeSeat({ viewW: 1000, viewH: 800, panX: Number.NaN, panY: "x", scale: 1, nodeW: 210, nodeH: 120 });
  const ident = firstNodeSeat({ viewW: 1000, viewH: 800, panX: 0, panY: 0, scale: 1, nodeW: 210, nodeH: 120 });
  if (nan.x !== ident.x || nan.y !== ident.y)
    fail(`NaN/invalid pan must be 0, got ${JSON.stringify(nan)}`);
  else ok("firstNodeSeat NaN pan is treated as 0");
}

{
  const d = firstNodeSeat({});
  if (d.x !== 295 || d.y !== 240)
    fail(`missing view defaults → ${JSON.stringify(d)} (want {x:295,y:240} from 800×600)`);
  else ok("firstNodeSeat missing view uses 800×600 defaults");
}

{
  const counts = firstNodeCounts({
    firstNode: { "add:text": 3, "wire:x": 99, "set:model": 5, "add:image": "nope" },
    firstTrio: [
      { actions: ["add:image", "add:llm"], count: 2 },
      { actions: ["wire:a", "add:text"], count: 10 },
      { actions: ["add:text"], count: 1 },
      { actions: null, count: 8 },
    ],
  });
  if (counts["wire:x"] || counts["set:model"] || counts["wire:a"])
    fail(`firstNodeCounts leaked non-add keys: ${JSON.stringify(counts)}`);
  else if (counts["add:text"] !== 4)
    fail(`firstNodeCounts add:text should be 3+1, got ${counts["add:text"]}`);
  else if (counts["add:image"] !== 2)
    fail(`firstNodeCounts add:image should fold trio head 2, got ${counts["add:image"]}`);
  else ok("firstNodeCounts skips non-add and folds firstTrio heads");
}

{
  const ranked = rankFirstTrioFollowups(
    { firstTrio: [{ actions: ["add:text", "add:image", "add:llm"], count: 5 }] },
    ["add:text", "add:image"],
    { numNodes: 2 },
    3,
  );
  if (ranked.length !== 1 || ranked[0].action !== "add:llm" || ranked[0].source !== "first-trio")
    fail(`2-step firstTrio prefix → ${JSON.stringify(ranked)}`);
  else ok("rankFirstTrioFollowups matches a 2-step opening prefix");
}

{
  const rows = [{ action: "add:join", score: 9, source: "frequency" }];
  const empty = mergeFirstNodeRows(rows, { firstNode: {}, firstTrio: [] }, [], { numNodes: 2 });
  if (empty !== rows)
    fail("quiet merge must return the same rows reference");
  else if (mergeFirstNodeRows(null, {}, [], { numNodes: 0 }).length !== 0)
    fail("null rows + empty boost must be []");
  else if (mergeFirstNodeRows("nope", {}, [], { numNodes: 0 }).length !== 0)
    fail("non-array rows + empty boost must be []");
  else ok("mergeFirstNodeRows empty boost is identity (or [] for non-arrays)");
}

{
  const nanOnly = mergeFirstNodeRows(
    [{ action: "add:join", score: 4, source: "frequency" }],
    { firstNode: { "add:text": "nope" } },
    [],
    { numNodes: 0 },
  );
  if (!Array.isArray(nanOnly) || nanOnly[0]?.action !== "add:join")
    fail(`NaN firstNode counts must not bury frequency rows, got ${JSON.stringify(nanOnly)}`);
  else ok("NaN firstNode counts stay quiet at merge");
}

{
  if (!isEmptyCanvas({ numNodes: 0 }, null))
    fail("history=null must ignore history and treat numNodes=0 as empty");
  else if (isEmptyCanvas({ numNodes: 0 }, ["add:text"]))
    fail("history array still blocks empty-canvas");
  else if (!shouldSeatFirstNode(undefined, true))
    fail("undefined sketch still seats the first node");
  else if (shouldSeatFirstNode({ numNodes: 0 }, 0))
    fail("helpersOff must not seat");
  else ok("isEmptyCanvas / shouldSeatFirstNode treat null history and undefined sketch");
}

if (failed) {
  console.error(`\n${failed} leftover #636 first-node pin(s) failed`);
  process.exit(1);
}
console.log("✓ first-node leftover pins");
