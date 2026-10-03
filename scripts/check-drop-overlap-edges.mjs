#!/usr/bin/env node
// Leftover Product · 39 drop-on-node overlap edges after #656.
// That PR shipped happy-path Text↔Image auto-wire, self/missing/wired
// quiet, overlap area+center, tiny-corner refuse, and editor model-disable
// guards. This file pins the other half: touching edges are not a drop,
// center-inside still counts when ratio is below MIN_OVERLAP_RATIO,
// zero/negative size is skipped, tied overlaps pick the stable id, and
// null/empty inputs stay quiet.
// Offline, zero API spend. New file so it does not collide with open leftover PRs.
import {
  MIN_OVERLAP_RATIO,
  overlapMetrics,
  findDropOverlapTarget,
  pickDropAutoWire,
} from "../vendor/next-action/drop-on-node-auto-wire.mjs";

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

{
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const touch = overlapMetrics(a, { x: 100, y: 0, w: 100, h: 100 });
  if (touch.area !== 0 || touch.ratio !== 0 || touch.centerInB || touch.centerInA)
    fail(`touching edges must be zero overlap, got ${JSON.stringify(touch)}`);
  else if (findDropOverlapTarget({ id: "a", ...a }, [{ id: "b", x: 100, y: 0, w: 100, h: 100 }]) !== null)
    fail("touching edges must not count as a drop target");
  else ok("touching edges are not a drop");
}

{
  // Thin strip vs tall strip: overlap ratio 800/16000 = 0.05 < MIN_OVERLAP_RATIO,
  // but the dragged card's center sits inside the partner.
  const dragged = { id: "a", x: 0, y: 0, w: 1000, h: 20 };
  const other = { id: "b", x: 490, y: 0, w: 40, h: 400 };
  const m = overlapMetrics(dragged, other);
  if (m.ratio >= MIN_OVERLAP_RATIO)
    fail(`fixture ratio ${m.ratio} should stay below MIN_OVERLAP_RATIO=${MIN_OVERLAP_RATIO}`);
  else if (!m.centerInB)
    fail(`dragged center must sit inside the partner, got ${JSON.stringify(m)}`);
  else if (findDropOverlapTarget(dragged, [other])?.targetId !== "b")
    fail("center-inside must still count as a deliberate drop when ratio is low");
  else ok("center-inside counts as a drop even when overlap ratio is below the floor");
}

{
  const a = { id: "a", x: 0, y: 0, w: 100, h: 100 };
  const zero = findDropOverlapTarget(a, [{ id: "z", x: 0, y: 0, w: 0, h: 100 }]);
  const neg = findDropOverlapTarget({ id: "a", x: 0, y: 0, w: -10, h: 100 }, [{ id: "b", x: 0, y: 0, w: 100, h: 100 }]);
  if (zero !== null || neg !== null)
    fail(`zero/negative size must skip, got zero=${JSON.stringify(zero)} neg=${JSON.stringify(neg)}`);
  else ok("zero/negative box size is not a drop target");
}

{
  const dragged = { id: "a", x: 0, y: 0, w: 80, h: 80 };
  const left = { id: "m", x: 20, y: 20, w: 80, h: 80 };
  const right = { id: "z", x: 20, y: 20, w: 80, h: 80 };
  const hit = findDropOverlapTarget(dragged, [right, left]);
  if (!hit || hit.targetId !== "m")
    fail(`tied overlap must pick localeCompare-smaller id, got ${JSON.stringify(hit)}`);
  else ok("tied overlap area+ratio picks the stable smaller id");
}

{
  if (findDropOverlapTarget(null, [{ id: "b", x: 0, y: 0, w: 10, h: 10 }]) !== null)
    fail("null dragged must be quiet");
  else if (findDropOverlapTarget({ id: "a", x: 0, y: 0, w: 10, h: 10 }, []) !== null)
    fail("empty others must be quiet");
  else if (findDropOverlapTarget({ id: "a", x: 0, y: 0, w: 10, h: 10 }, null) !== null)
    fail("null others must be quiet");
  else ok("findDropOverlapTarget null/empty inputs stay quiet");
}

{
  if (pickDropAutoWire({ topTargets: {} }, {
    nodes: [{ id: "t1", type: "text" }, { id: "img1", type: "image" }],
    links: [],
  }, { draggedId: "img1", targetId: "t1" }) !== null)
    fail("empty topTargets must be quiet");
  else ok("pickDropAutoWire empty topTargets is quiet");
}

if (failed) {
  console.error(`\n${failed} leftover #656 drop-overlap pin(s) failed`);
  process.exit(1);
}
console.log("✓ drop-overlap leftover pins");
