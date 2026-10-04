#!/usr/bin/env node
// Leftover Product · 22 dangling-nudge edges after #639 / #674.
// Those pins cover Text→Image pulse, single-node / wired / tied / drag /
// multi-select / disabled / flat-prior / no-live-input quiet. This file
// pins the leftover count and share contract: a comment or typeless
// sibling does not make a lone node eligible, selectedIds of length 1
// still pulses, MIN_PAIR+lead with share below MIN_SHARE stays quiet,
// and the editor source stays quiet while a continue-port pulse is up
// (and refuses a dir=in pick). Offline, zero API spend. New file so it
// does not collide with the shipped check.
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE, pickDanglingNudge } from "../vendor/next-action/dangling-nudge.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portTables = JSON.parse(
  readFileSync(join(ROOT, "vendor", "next-action", "corpus", "port-suggest.json"), "utf8")
);
const index = readFileSync(join(ROOT, "index.html"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

const textImage = {
  nodes: [
    { id: "t", type: "text" },
    { id: "i", type: "image" },
  ],
  links: [],
};

{
  const withComment = pickDanglingNudge(portTables, {
    nodes: [
      { id: "t", type: "text" },
      { id: "n", type: "comment" },
    ],
    links: [],
  });
  const withTypeless = pickDanglingNudge(portTables, {
    nodes: [
      { id: "t", type: "text" },
      { id: "x" },
    ],
    links: [],
  });
  if (withComment !== null)
    fail(`a comment sibling must not make a lone node eligible, got ${JSON.stringify(withComment)}`);
  else if (withTypeless !== null)
    fail(`a typeless sibling must not make a lone node eligible, got ${JSON.stringify(withTypeless)}`);
  else ok("comment / typeless siblings do not count toward the two-node floor");
}

{
  const pick = pickDanglingNudge(portTables, { ...textImage, selectedIds: ["t"] });
  if (!pick || pick.nodeId !== "t" || pick.port !== "text" || pick.dir !== "out")
    fail(`selectedIds of length 1 must still pulse text-out, got ${JSON.stringify(pick)}`);
  else ok("a single selectedId still leaves the dangling nudge live");
}

{
  const targets = {};
  const catalog = { sink: { inputs: ["in"], outputs: [] } };
  const nodes = [{ id: "sink", type: "sink" }];
  const nWeak = 8;
  for (let i = 1; i <= 1 + nWeak; i++) {
    const type = "src" + i;
    catalog[type] = { inputs: [], outputs: ["out"] };
    nodes.push({ id: type, type });
    targets[type + "|out"] = { "sink|in": i === 1 ? 3 : 2 };
  }
  const share = 3 / (3 + 2 * nWeak);
  if (!(share < MIN_SHARE) || !(3 >= MIN_PAIR) || !(3 >= 2 * MIN_LEAD))
    fail(`low-share fixture drifted (share=${share} MIN_SHARE=${MIN_SHARE})`);
  const pick = pickDanglingNudge(
    { topTargets: targets, portCatalog: catalog },
    { nodes, links: [] }
  );
  if (pick !== null)
    fail(`MIN_PAIR+lead with share ${share} < ${MIN_SHARE} must be quiet, got ${JSON.stringify(pick)}`);
  else ok("MIN_PAIR+lead with share below MIN_SHARE stays quiet");
}

{
  const start = index.indexOf("function applyDanglingNudge()");
  const next = index.indexOf("function armDanglingNudge()", start);
  const apply = start >= 0 && next > start ? index.slice(start, next) : "";
  if (!apply)
    fail("applyDanglingNudge source block not found");
  else if (!apply.includes('.port.na-continue-port'))
    fail("applyDanglingNudge must stay quiet while a continue-port pulse is showing");
  else if (!apply.includes('pick.dir==="in"'))
    fail("applyDanglingNudge must refuse a dir=in pick");
  else ok("editor stays quiet while continue-port is up and refuses dir=in");
}

if (failed) {
  console.error(`\n${failed} leftover dangling-nudge pin(s) failed`);
  process.exit(1);
}
console.log("✓ dangling-nudge leftover pins");
