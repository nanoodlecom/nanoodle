#!/usr/bin/env node
/**
 * Product · 22 — dangling-port nudge toys.
 * One idle pulse on a confident dangling output that still has a live partner.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickDanglingNudge } from "../vendor/next-action/dangling-nudge.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-dangling-nudge: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "dangling-nudge.mjs")), "missing dangling-nudge.mjs");
const portTables = JSON.parse(readFileSync(join(NA, "corpus", "port-suggest.json"), "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const helper = readFileSync(join(NA, "dangling-nudge.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

const textImage = {
  nodes: [
    { id: "t", type: "text" },
    { id: "i", type: "image" },
  ],
  links: [],
};

{
  const pick = pickDanglingNudge(portTables, textImage);
  toy("text-image-pulses-text-out", pick && pick.nodeId === "t" && pick.port === "text" && pick.dir === "out", JSON.stringify(pick));
}

{
  const pick = pickDanglingNudge(portTables, { nodes: [{ id: "t", type: "text" }], links: [] });
  toy("single-node-quiet", pick == null, String(pick));
}

{
  const pick = pickDanglingNudge(portTables, {
    nodes: [
      { id: "t", type: "text" },
      { id: "i", type: "image" },
    ],
    links: [{ from: { node: "t", port: "text" }, to: { node: "i", port: "prompt" } }],
  });
  toy("wired-pair-no-live-partner-quiet", pick == null, JSON.stringify(pick));
}

{
  const pick = pickDanglingNudge(portTables, {
    nodes: [
      { id: "t1", type: "text" },
      { id: "t2", type: "text" },
      { id: "i", type: "image" },
    ],
    links: [],
  });
  toy("tied-outputs-quiet", pick == null, JSON.stringify(pick));
}

{
  const pick = pickDanglingNudge(portTables, textImage, { dragging: true });
  toy("drag-quiet", pick == null, String(pick));
  const multi = pickDanglingNudge(portTables, { ...textImage, selectedIds: ["t", "i"] });
  toy("multi-select-quiet", multi == null, String(multi));
  toy("disabled-quiet", pickDanglingNudge(portTables, textImage, { disabled: true }) == null, "off");
  toy("no-tables-quiet", pickDanglingNudge(null, textImage) == null, "null");
}

{
  const flat = {
    topTargets: { "text|text": { "image|prompt": 3, "llm|prompt": 3 } },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      image: { inputs: ["prompt"], outputs: ["image"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
    },
  };
  toy(
    "flat-source-prior-quiet",
    pickDanglingNudge(flat, {
      nodes: [
        { id: "t", type: "text" },
        { id: "i", type: "image" },
      ],
      links: [],
    }) == null,
    "tie row"
  );
}

{
  const onlyMass = {
    topTargets: { "text|text": { "image|prompt": 9, "llm|prompt": 2 } },
    portCatalog: {
      text: { inputs: [], outputs: ["text"] },
      llm: { inputs: ["prompt"], outputs: ["text"] },
    },
  };
  toy(
    "no-live-input-quiet",
    pickDanglingNudge(onlyMass, {
      nodes: [
        { id: "t", type: "text" },
        { id: "l", type: "llm" },
      ],
      links: [{ from: { node: "t", port: "text" }, to: { node: "l", port: "prompt" } }],
    }) == null,
    "mass without a free input"
  );
}

toy("helper-no-mass-fallback", !/return mass/.test(helper), "live pairs only");
toy("helper-requires-lead", /MIN_LEAD/.test(helper), "lead");
toy("surface-method", /pickDanglingNudge\(query\)/.test(surface) && /dangling-nudge\.mjs/.test(surface), "editor-surface");
toy("html-class", index.includes("na-dangling-nudge"), "css");
toy("html-reduced-motion", /na-dangling-nudge[\s\S]{0,400}prefers-reduced-motion/.test(index), "reduce");
toy("html-gates-off", /pickDanglingNudge/.test(index) && /na\.disabled/.test(index) && /geoOn\(/.test(index), "flag");
toy("html-no-ghost", !/na-dangling-ghost|ghost wire|NEXT node/.test(index), "no overlay");
toy("readme", /·\s*22/.test(readme) && readme.includes("check-next-action-dangling-nudge.mjs"), "readme");

const failed = toys.filter((t) => !t.ok);
console.log(`\ndangling-nudge toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) fail(`${failed.length} failed`);
console.log("✓ next-action-dangling-nudge");
