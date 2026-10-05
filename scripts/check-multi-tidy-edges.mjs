#!/usr/bin/env node
// Leftover Product · 34 multi-tidy edges after #649 / #674.
// Those pins cover already-row quiet, overlap suggest, tiny-drift quiet,
// stacked-flow suggest, one-node quiet, and an obstacle shove. This file
// pins the leftover planner contract: a foreign / missing-end link does
// not invent a flow column, a two-node cycle does not hang and packs as
// a row, empty/null obstacles are identity, and a missing size is skipped
// rather than shoving or throwing. Offline, zero API spend. New file so
// it does not collide with the shipped check.
import {
  clearPack,
  suggestMultiTidy,
  tidyPositions,
  tidyRanks,
} from "../vendor/next-action/multi-tidy-suggest.mjs";

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

const card = (id, x, y, w = 220, h = 160) => ({ id, x, y, w, h });
const row = [card("a", 0, 0), card("b", 268, 0)];
const sizes = { a: { w: 220, h: 160 }, b: { w: 220, h: 160 } };

{
  const links = [
    { from: { node: "a" }, to: { node: "z" } },
    { from: { node: "z" }, to: { node: "b" } },
    { from: { node: "a" }, to: {} },
    { from: {}, to: { node: "b" } },
  ];
  const ranked = tidyRanks(["a", "b"], links);
  const v = suggestMultiTidy({ selected: row, links });
  if (ranked.spread || ranked.depth.a !== 0 || ranked.depth.b !== 0)
    fail(`foreign / missing-end links must not spread, got ${JSON.stringify(ranked)}`);
  else if (v.suggest !== false || v.reason !== "already-tidy")
    fail(`a foreign-linked tidy row must stay quiet, got ${JSON.stringify(v)}`);
  else ok("foreign and missing-end links do not invent a flow column");
}

{
  const cycle = [
    { from: { node: "a" }, to: { node: "b" } },
    { from: { node: "b" }, to: { node: "a" } },
  ];
  const stacked = [card("a", 0, 0), card("b", 0, 400)];
  const t0 = Date.now();
  const ranked = tidyRanks(["a", "b"], cycle);
  const seats = tidyPositions(stacked, cycle);
  const elapsed = Date.now() - t0;
  if (elapsed > 200)
    fail(`a two-node cycle must not hang (${elapsed}ms)`);
  else if (ranked.spread || ranked.depth.a !== 0 || ranked.depth.b !== 0)
    fail(`a cycle must rank depth 0 / no spread, got ${JSON.stringify(ranked)}`);
  else if (!seats.length || seats[0].y !== seats[1].y)
    fail(`a cycle must pack as a row, got ${JSON.stringify(seats)}`);
  else ok("two-node cycle does not hang and packs as a row");
}

{
  const seats = tidyPositions(row, []);
  const empty = clearPack(seats, sizes, []);
  const missing = clearPack(seats, sizes, null);
  const v = suggestMultiTidy({ selected: row, links: [], obstacles: [] });
  if (empty !== seats || missing !== seats)
    fail("empty/null obstacles must return the same positions array");
  else if (v.suggest !== false || v.reason !== "already-tidy")
    fail(`empty obstacles must not shove a tidy row, got ${JSON.stringify(v)}`);
  else ok("empty/null obstacles are identity and stay quiet");
}

{
  const seats = tidyPositions(row, []);
  const obstacle = [{ id: "z", x: 0, y: 0, w: 220, h: 160 }];
  const none = clearPack(seats, {}, obstacle);
  const partial = clearPack(seats, { a: { w: 220, h: 160 } }, obstacle);
  const v = suggestMultiTidy({ selected: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 268, y: 0 }] });
  if (none !== seats)
    fail(`missing sizes must skip collision, got ${JSON.stringify(none)}`);
  else if (!partial.length || partial === seats)
    fail("a sized card that hits an obstacle must still shove the pack");
  else if (v.suggest !== false)
    fail(`selected cards without w/h must not throw or pulse, got ${JSON.stringify(v)}`);
  else ok("missing size skips collision; a sized sibling can still shove");
}

if (failed) {
  console.error(`\n${failed} leftover multi-tidy pin(s) failed`);
  process.exit(1);
}
console.log("✓ multi-tidy leftover pins");
