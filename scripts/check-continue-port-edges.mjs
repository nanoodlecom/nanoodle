#!/usr/bin/env node
// Leftover Product · 33 continue-port edges after #650 / #674.
// Those pins cover a fully wired pair, remaining image-out, a pre-wire
// tie, missing/same-node ends, multi-select, tied leftovers, and a lone
// leftover pulse. This file pins the leftover scope/alias contract:
// fromId/toId still name the just-landed pair, a leftover on a third
// node stays quiet, both ends missing from the canvas stay quiet, a
// leftover input (dir=in) still pulses, and a comment does not count
// toward the two-node floor. Offline, zero API spend. New file so it
// does not collide with the shipped check.
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickContinuePort } from "../vendor/next-action/continue-port.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portTables = JSON.parse(
  readFileSync(join(ROOT, "vendor", "next-action", "corpus", "port-suggest.json"), "utf8")
);

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

const wire = { from: { node: "t", port: "text" }, to: { node: "i", port: "prompt" } };
const trio = {
  nodes: [
    { id: "t", type: "text" },
    { id: "i", type: "image" },
    { id: "v", type: "ivideo" },
  ],
  links: [wire],
};

{
  const pick = pickContinuePort(portTables, trio, { fromId: "t", toId: "i" });
  if (!pick || pick.nodeId !== "i" || pick.port !== "image" || pick.dir !== "out")
    fail(`fromId/toId aliases must still pick image-out, got ${JSON.stringify(pick)}`);
  else ok("fromId/toId aliases still name the just-landed pair");
}

{
  const tables = {
    topTargets: {
      "a|out": { "b|in": 8 },
      "c|out": { "d|in": 9 },
    },
    portCatalog: {
      a: { inputs: [], outputs: ["out"] },
      b: { inputs: ["in"], outputs: [] },
      c: { inputs: [], outputs: ["out"] },
      d: { inputs: ["in"], outputs: [] },
    },
  };
  const pick = pickContinuePort(tables, {
    nodes: [
      { id: "a", type: "a" },
      { id: "b", type: "b" },
      { id: "c", type: "c" },
      { id: "d", type: "d" },
    ],
    links: [{ from: { node: "a", port: "out" }, to: { node: "b", port: "in" } }],
  }, { fromNodeId: "a", toNodeId: "b" });
  if (pick !== null)
    fail(`a leftover on a third node must stay out of scope, got ${JSON.stringify(pick)}`);
  else ok("leftover on an unscoped third node stays quiet");
}

{
  const pick = pickContinuePort(portTables, {
    nodes: [
      { id: "t", type: "text" },
      { id: "i", type: "image" },
    ],
    links: [],
  }, { fromNodeId: "ghost", toNodeId: "missing" });
  if (pick !== null)
    fail(`both ends missing from the canvas must stay quiet, got ${JSON.stringify(pick)}`);
  else ok("both wire ends missing from the canvas stay quiet");
}

{
  const tables = {
    topTargets: {
      "a|out": { "b|in": 8 },
      "c|out": { "b|in2": 5 },
    },
    portCatalog: {
      a: { inputs: [], outputs: ["out"] },
      b: { inputs: ["in", "in2"], outputs: [] },
      c: { inputs: [], outputs: ["out"] },
    },
  };
  const pick = pickContinuePort(tables, {
    nodes: [
      { id: "a", type: "a" },
      { id: "b", type: "b" },
      { id: "c", type: "c" },
    ],
    links: [{ from: { node: "a", port: "out" }, to: { node: "b", port: "in" } }],
  }, { fromNodeId: "a", toNodeId: "b" });
  if (!pick || pick.nodeId !== "b" || pick.port !== "in2" || pick.dir !== "in")
    fail(`a leftover input on the landed pair must pulse dir=in, got ${JSON.stringify(pick)}`);
  else ok("leftover input on the landed pair pulses dir=in");
}

{
  const onlyComment = pickContinuePort(portTables, {
    nodes: [
      { id: "t", type: "text" },
      { id: "n", type: "comment" },
    ],
    links: [],
  }, { fromNodeId: "t", toNodeId: "n" });
  const stillTrio = pickContinuePort(portTables, {
    nodes: [
      ...trio.nodes,
      { id: "n", type: "comment" },
    ],
    links: [wire],
  }, { fromNodeId: "t", toNodeId: "i" });
  if (onlyComment !== null)
    fail(`a comment must not count toward the two-node floor, got ${JSON.stringify(onlyComment)}`);
  else if (!stillTrio || stillTrio.nodeId !== "i" || stillTrio.port !== "image")
    fail(`a comment must not hide a real leftover, got ${JSON.stringify(stillTrio)}`);
  else ok("comments are not nodes for the two-node floor or leftover scope");
}

if (failed) {
  console.error(`\n${failed} leftover continue-port pin(s) failed`);
  process.exit(1);
}
console.log("✓ continue-port leftover pins");
