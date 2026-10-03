#!/usr/bin/env node
/**
 * Product · 33 — post-wire continue-port toys.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickContinuePort } from "../vendor/next-action/continue-port.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-continue-port: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "continue-port.mjs")), "missing continue-port.mjs");
const portTables = JSON.parse(readFileSync(join(NA, "corpus", "port-suggest.json"), "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const helper = readFileSync(join(NA, "continue-port.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

const wire = { from: { node: "t", port: "text" }, to: { node: "i", port: "prompt" } };

{
  const pick = pickContinuePort(portTables, {
    nodes: [
      { id: "t", type: "text" },
      { id: "i", type: "image" },
    ],
    links: [wire],
  }, { fromNodeId: "t", toNodeId: "i" });
  toy("fully-wired-pair-quiet", pick == null, JSON.stringify(pick));
}

{
  const pick = pickContinuePort(portTables, {
    nodes: [
      { id: "t", type: "text" },
      { id: "i", type: "image" },
      { id: "v", type: "ivideo" },
    ],
    links: [wire],
  }, { fromNodeId: "t", toNodeId: "i" });
  toy(
    "remaining-image-out",
    pick && pick.nodeId === "i" && pick.port === "image" && pick.dir === "out",
    JSON.stringify(pick)
  );
}

{
  const pick = pickContinuePort(portTables, {
    nodes: [
      { id: "t", type: "text" },
      { id: "i", type: "image" },
      { id: "v", type: "ivideo" },
    ],
    links: [],
  }, { fromNodeId: "t", toNodeId: "i" });
  toy("pre-wire-tie-quiet", pick == null, JSON.stringify(pick));
}

{
  toy("missing-ends-quiet", pickContinuePort(portTables, { nodes: [{ id: "t", type: "text" }, { id: "i", type: "image" }], links: [] }, {}) == null, "no ends");
  toy("same-node-quiet", pickContinuePort(portTables, { nodes: [{ id: "t", type: "text" }, { id: "i", type: "image" }], links: [] }, { fromNodeId: "t", toNodeId: "t" }) == null, "loop");
  toy(
    "multi-select-quiet",
    pickContinuePort(portTables, {
      nodes: [{ id: "t", type: "text" }, { id: "i", type: "image" }, { id: "v", type: "ivideo" }],
      links: [wire],
      selectedIds: ["t", "i"],
    }, { fromNodeId: "t", toNodeId: "i" }) == null,
    "multi"
  );
}

{
  const tied = {
    topTargets: {
      "a|out2": { "c|in": 5 },
      "b|out": { "c|in": 5 },
    },
    portCatalog: {
      a: { inputs: ["in"], outputs: ["out", "out2"] },
      b: { inputs: ["in"], outputs: ["out"] },
      c: { inputs: ["in"], outputs: [] },
    },
  };
  const pick = pickContinuePort(tied, {
    nodes: [
      { id: "a", type: "a" },
      { id: "b", type: "b" },
      { id: "c", type: "c" },
    ],
    links: [{ from: { node: "a", port: "out" }, to: { node: "b", port: "in" } }],
  }, { fromNodeId: "a", toNodeId: "b" });
  toy("tied-leftovers-quiet", pick == null, JSON.stringify(pick));
}

{
  const lone = {
    topTargets: { "b|out": { "c|in": 4 } },
    portCatalog: {
      a: { inputs: [], outputs: ["out"] },
      b: { inputs: ["in"], outputs: ["out"] },
      c: { inputs: ["in"], outputs: [] },
    },
  };
  const pick = pickContinuePort(lone, {
    nodes: [
      { id: "a", type: "a" },
      { id: "b", type: "b" },
      { id: "c", type: "c" },
    ],
    links: [{ from: { node: "a", port: "out" }, to: { node: "b", port: "in" } }],
  }, { fromNodeId: "a", toNodeId: "b" });
  toy("lone-leftover-pulses", pick && pick.nodeId === "b" && pick.port === "out" && pick.dir === "out", JSON.stringify(pick));
}

toy("no-mass-only", !/return mass/.test(helper), "live partner required");
toy("surface", /pickContinuePort\(query\)/.test(surface) && /continue-port\.mjs/.test(surface), "surface");
toy("html", index.includes("na-continue-port") && /pickContinuePort/.test(index) && /prefers-reduced-motion/.test(index), "html");
toy("html-off", /na\.disabled/.test(index) && /geoOn\(/.test(index), "flag");
toy("readme", /·\s*33/.test(readme) && readme.includes("check-next-action-continue-port.mjs"), "readme");

const failed = toys.filter((t) => !t.ok);
console.log(`\ncontinue-port toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) fail(`${failed.length} failed`);
console.log("✓ next-action-continue-port");
