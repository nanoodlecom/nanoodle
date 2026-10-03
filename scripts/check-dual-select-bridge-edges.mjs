#!/usr/bin/env node
// Leftover Product · 37 dual-select bridge edges after #654.
// That PR shipped 0/1/3-select quiet, Text↔Image happy path, flat/weak
// gates, a wired pair not re-picked, and editor accept/refuse toys.
// This file pins the other half of the selection/dangling contract: a
// selected id with no node is quiet, duplicate selectedIds collapse to
// one, falsy extra ids still leave a valid pair, selectedId alone never
// invents a bridge, a fully wired pair (no dangling ports) is quiet,
// MIN_PAIR+lead with share below MIN_SHARE is quiet, and empty scored
// pairs stay quiet. Offline, zero API spend. New file so it does not
// collide with the shipped check.
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "../vendor/next-action/port-suggest.mjs";
import { pickDualSelectBridge } from "../vendor/next-action/dual-select-bridge.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tables = JSON.parse(
  readFileSync(join(ROOT, "vendor", "next-action", "corpus", "port-suggest.json"), "utf8")
);

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

const pair = {
  nodes: [
    { id: "t1", type: "text" },
    { id: "img1", type: "image" },
  ],
  links: [],
};

{
  const pick = pickDualSelectBridge(tables, {
    nodes: [{ id: "t1", type: "text" }],
    links: [],
    selectedIds: ["t1", "img1"],
  });
  if (pick !== null)
    fail(`selected id with no node must be quiet, got ${JSON.stringify(pick)}`);
  else ok("selectedIds naming a missing node stays quiet");
}

{
  const pick = pickDualSelectBridge(tables, {
    ...pair,
    selectedIds: ["t1", "t1"],
  });
  if (pick !== null)
    fail(`duplicate selectedIds must collapse to one and stay quiet, got ${JSON.stringify(pick)}`);
  else ok("duplicate selectedIds collapse to a single selection");
}

{
  const pick = pickDualSelectBridge(tables, {
    ...pair,
    selectedIds: ["t1", "img1", "", null],
  });
  if (!pick || pick.from.nodeId !== "t1" || pick.to.nodeId !== "img1" || pick.to.port !== "prompt")
    fail(`falsy extra selectedIds must still leave the Text→Image pair, got ${JSON.stringify(pick)}`);
  else ok("falsy extra selectedIds still leave a valid two-node pair");
}

{
  const withEmpty = pickDualSelectBridge(tables, {
    ...pair,
    selectedIds: [],
    selectedId: "t1",
  });
  const onlyId = pickDualSelectBridge(tables, { ...pair, selectedId: "t1" });
  if (withEmpty !== null || onlyId !== null)
    fail("selectedId alone must never invent a dual-select bridge");
  else ok("selectedId alone (no selectedIds pair) stays quiet");
}

{
  const pick = pickDualSelectBridge(tables, {
    ...pair,
    links: [
      { from: { node: "t1", port: "text" }, to: { node: "img1", port: "prompt" } },
      { from: { node: "img1", port: "image" }, to: { node: "t1", port: "in" } },
    ],
    selectedIds: ["t1", "img1"],
  });
  if (pick !== null)
    fail(`a fully wired pair must be quiet, got ${JSON.stringify(pick)}`);
  else ok("fully wired pair (no dangling ports) stays quiet");
}

{
  const ins = [];
  const targets = {};
  for (let i = 1; i <= 9; i++) {
    const port = "p" + i;
    ins.push(port);
    targets["image|" + port] = i === 1 ? 10 : 7;
  }
  const share = 10 / (10 + 7 * 8);
  if (!(share < MIN_SHARE) || !(10 >= MIN_PAIR) || !(10 >= 7 * MIN_LEAD))
    fail(`low-share fixture drifted (share=${share} MIN_SHARE=${MIN_SHARE})`);
  const pick = pickDualSelectBridge(
    {
      topTargets: { "text|text": targets },
      portCatalog: {
        text: { inputs: [], outputs: ["text"] },
        image: { inputs: ins, outputs: ["image"] },
      },
    },
    { ...pair, selectedIds: ["t1", "img1"] }
  );
  if (pick !== null)
    fail(`MIN_PAIR+lead with share ${share} < ${MIN_SHARE} must be quiet, got ${JSON.stringify(pick)}`);
  else ok("MIN_PAIR+lead with share below MIN_SHARE stays quiet");
}

{
  const pick = pickDualSelectBridge(
    { topTargets: {}, portCatalog: tables.portCatalog },
    { ...pair, selectedIds: ["t1", "img1"] }
  );
  if (pick !== null)
    fail(`empty scored pairs must be quiet, got ${JSON.stringify(pick)}`);
  else ok("dangling ports with zero pair counts stay quiet");
}

if (failed) {
  console.error(`\n${failed} leftover dual-select-bridge pin(s) failed`);
  process.exit(1);
}
console.log("✓ dual-select-bridge leftover pins");
