#!/usr/bin/env node
/**
 * Product · 34 — multi-select tidy suggest toys.
 * The pulse is the existing Tidy control, and only when Arrange would move or unstick.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { suggestMultiTidy, tidyPositions } from "../vendor/next-action/multi-tidy-suggest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const helper = readFileSync(join(ROOT, "vendor/next-action/multi-tidy-suggest.mjs"), "utf8");
const readme = readFileSync(join(ROOT, "vendor/next-action/README.md"), "utf8");

function fail(msg) {
  console.error(`✗ next-action-multi-tidy: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}
assert(existsSync(join(ROOT, "vendor/next-action/multi-tidy-suggest.mjs")), "missing helper");

function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) fail("missing " + name);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  fail("unclosed " + name);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  extractFn(index, "geoRanks") + "\n" + extractFn(index, "geoTidyPositions") + "\n" + extractFn(index, "geoOverlap") + "\n" + extractFn(index, "geoClearPack"),
  sandbox
);

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

const card = (id, x, y) => ({ id, x, y, w: 220, h: 160 });

{
  const nodes = [card("a", 0, 0), card("b", 268, 0)];
  const mine = tidyPositions(nodes, []);
  const live = sandbox.geoTidyPositions(nodes, [], 48, 28);
  toy("matches-editor-row", JSON.stringify(mine) === JSON.stringify(live), JSON.stringify(mine));
  const v = suggestMultiTidy({ selected: nodes, links: [] });
  toy("already-row-quiet", v.suggest === false && v.reason === "already-tidy", JSON.stringify(v));
}

{
  const nodes = [card("a", 40, 80), card("b", 48, 90)];
  const v = suggestMultiTidy({ selected: nodes, links: [] });
  toy("overlap-suggests", v.suggest === true && v.overlaps > 0, JSON.stringify(v));
}

{
  const nodes = [card("a", 0, 0), card("b", 268, 8)];
  const v = suggestMultiTidy({ selected: nodes, links: [] });
  toy("tiny-drift-quiet", v.suggest === false, JSON.stringify(v));
}

{
  const nodes = [card("a", 0, 0), card("b", 0, 400)];
  const links = [{ from: { node: "a" }, to: { node: "b" } }];
  const mine = tidyPositions(nodes, links);
  const live = sandbox.geoTidyPositions(nodes, links, 48, 28);
  toy("matches-editor-flow", JSON.stringify(mine) === JSON.stringify(live), JSON.stringify({ mine, live }));
  const v = suggestMultiTidy({ selected: nodes, links });
  toy("stacked-flow-suggests", v.suggest === true && v.maxDelta >= 20, JSON.stringify(v));
}

{
  const v = suggestMultiTidy({ selected: [card("a", 0, 0)], links: [] });
  toy("one-node-quiet", v.suggest === false, v.reason);
}

{
  const nodes = [card("a", 0, 0), card("b", 268, 0)];
  const obstacle = { id: "z", x: 0, y: 0, w: 220, h: 160 };
  const v = suggestMultiTidy({ selected: nodes, links: [], obstacles: [obstacle] });
  toy("obstacle-shove-suggests", v.suggest === true && v.maxDelta >= 20, JSON.stringify(v));
}

toy("no-node-outline", !/na-multi-tidy-suggest[\s\S]{0,80}\.node/.test(helper) && !index.includes(".node.sel.na-multi-tidy-suggest"), "button only");
toy("html-button", index.includes("#seltidy.na-multi-tidy-suggest") && index.includes("suggestMultiTidy"), "wired");
toy("html-off", /geoOn\(/.test(index) && /refreshMultiTidySuggest/.test(index), "flag");
toy("readme", /·\s*34/.test(readme) && readme.includes("check-next-action-multi-tidy.mjs"), "readme");

const failed = toys.filter((t) => !t.ok);
console.log(`\nmulti-tidy toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) fail(`${failed.length} failed`);
console.log("✓ next-action-multi-tidy");
