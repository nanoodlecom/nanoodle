#!/usr/bin/env node
/**
 * Product · 36 — move-align snap guides toys.
 * Pure geometry + editor wiring pins. No tip panel, no ?product= twin.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SNAP_PX,
  SNAP_SCREEN_PX,
  GUIDE_PAD,
  rectAnchors,
  bestAxisAlign,
  computeMoveAlign,
  applySnapDelta,
} from "../vendor/next-action/move-align-snap.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-move-align-snap: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "move-align-snap.mjs")), "missing move-align-snap.mjs");

const index = readFileSync(join(ROOT, "index.html"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");
const helper = readFileSync(join(NA, "move-align-snap.mjs"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

// --- constants ---
toy("snap-px", SNAP_PX >= 6 && SNAP_PX <= 16, `SNAP_PX=${SNAP_PX}`);
toy(
  "snap-screen-px",
  SNAP_SCREEN_PX >= 6 && SNAP_SCREEN_PX <= 16,
  `SNAP_SCREEN_PX=${SNAP_SCREEN_PX}`
);
toy("guide-pad", GUIDE_PAD >= 8 && GUIDE_PAD <= 64, `GUIDE_PAD=${GUIDE_PAD}`);
toy("helper-docs-screen", helper.includes("screen"), "mentions screen units");

// --- anchors ---
{
  const a = rectAnchors({ x: 100, y: 200, w: 220, h: 160 });
  toy(
    "anchors-center",
    Math.abs(a.cx - 210) < 1e-9 && Math.abs(a.cy - 280) < 1e-9,
    `cx=${a.cx} cy=${a.cy}`
  );
  toy(
    "anchors-edges",
    a.left === 100 && a.right === 320 && a.top === 200 && a.bottom === 360,
    JSON.stringify(a)
  );
}

// --- center-x align ---
{
  const dragged = { id: "a", x: 105, y: 40, w: 220, h: 160 };
  const other = { id: "b", x: 100, y: 300, w: 220, h: 160 };
  // centers: a.cx=215, b.cx=210 → delta -5
  const r = computeMoveAlign({
    dragged,
    others: [other],
    snapPx: 10,
    selectedCount: 1,
  });
  toy("center-x-active", r.active === true, `active=${r.active} reason=${r.reason}`);
  toy(
    "center-x-delta",
    r.active && Math.abs(r.snapDelta.dx - (210 - 215)) < 1e-6,
    `dx=${r.snapDelta.dx}`
  );
  toy(
    "center-x-guide",
    r.guides.some((g) => g.axis === "x" && g.kind === "center"),
    r.guides.map((g) => `${g.axis}:${g.kind}`).join(",")
  );
}

// --- center-y align ---
{
  const dragged = { id: "a", x: 400, y: 205, w: 220, h: 160 };
  const other = { id: "b", x: 100, y: 200, w: 220, h: 160 };
  // a.cy=285, b.cy=280 → dy=-5
  const r = computeMoveAlign({
    dragged,
    others: [other],
    snapPx: 10,
    selectedCount: 1,
  });
  toy("center-y-active", r.active === true, `active=${r.active}`);
  toy(
    "center-y-delta",
    r.active && Math.abs(r.snapDelta.dy - (280 - 285)) < 1e-6,
    `dy=${r.snapDelta.dy}`
  );
  toy(
    "center-y-guide",
    r.guides.some((g) => g.axis === "y" && g.kind === "center"),
    r.guides.map((g) => `${g.axis}:${g.kind}`).join(",")
  );
}

// --- edge align (left edges) ---
{
  const dragged = { id: "a", x: 108, y: 40, w: 200, h: 120 };
  const other = { id: "b", x: 100, y: 300, w: 240, h: 140 };
  const r = computeMoveAlign({
    dragged,
    others: [other],
    snapPx: 10,
    selectedCount: 1,
  });
  toy("edge-left-active", r.active === true, `active=${r.active}`);
  toy(
    "edge-left-delta",
    r.active && Math.abs(r.snapDelta.dx - (100 - 108)) < 1e-6,
    `dx=${r.snapDelta.dx} kinds=${r.guides.map((g) => g.kind).join(",")}`
  );
}

// --- both axes near ---
{
  const dragged = { id: "a", x: 104, y: 196, w: 220, h: 160 };
  const other = { id: "b", x: 100, y: 200, w: 220, h: 160 };
  const r = computeMoveAlign({
    dragged,
    others: [other],
    snapPx: 10,
    selectedCount: 1,
  });
  toy(
    "both-axes",
    r.active && r.guides.length === 2,
    `guides=${r.guides.length} dx=${r.snapDelta.dx} dy=${r.snapDelta.dy}`
  );
  const snapped = applySnapDelta({ x: dragged.x, y: dragged.y }, r.snapDelta);
  toy(
    "apply-snap",
    Math.abs(snapped.x - 100) < 1e-6 && Math.abs(snapped.y - 200) < 1e-6,
    JSON.stringify(snapped)
  );
}

// --- below threshold ---
{
  const r = computeMoveAlign({
    dragged: { id: "a", x: 0, y: 0, w: 220, h: 160 },
    others: [{ id: "b", x: 400, y: 400, w: 220, h: 160 }],
    snapPx: 10,
    selectedCount: 1,
  });
  toy(
    "below-threshold-quiet",
    r.active === false && r.reason === "below-threshold",
    JSON.stringify(r)
  );
}

// --- multi-select quiet ---
{
  const r = computeMoveAlign({
    dragged: { id: "a", x: 100, y: 40, w: 220, h: 160 },
    others: [{ id: "b", x: 100, y: 300, w: 220, h: 160 }],
    snapPx: 10,
    selectedCount: 2,
  });
  toy(
    "multi-select-quiet",
    r.active === false && r.reason === "multi-select",
    JSON.stringify(r)
  );
}

// --- reduced-motion quiet ---
{
  const r = computeMoveAlign({
    dragged: { id: "a", x: 100, y: 40, w: 220, h: 160 },
    others: [{ id: "b", x: 100, y: 300, w: 220, h: 160 }],
    snapPx: 10,
    selectedCount: 1,
    reducedMotion: true,
  });
  toy(
    "reduced-motion-quiet",
    r.active === false && r.reason === "reduced-motion",
    JSON.stringify(r)
  );
}

// --- engine off ---
{
  const r = computeMoveAlign({
    dragged: { id: "a", x: 100, y: 40, w: 220, h: 160 },
    others: [{ id: "b", x: 100, y: 300, w: 220, h: 160 }],
    snapPx: 10,
    engineOn: false,
  });
  toy(
    "engine-off-quiet",
    r.active === false && r.reason === "engine-off",
    JSON.stringify(r)
  );
}

// --- skip self id ---
{
  const r = computeMoveAlign({
    dragged: { id: "a", x: 100, y: 40, w: 220, h: 160 },
    others: [{ id: "a", x: 100, y: 40, w: 220, h: 160 }],
    snapPx: 10,
  });
  toy(
    "skip-self",
    r.active === false && r.reason === "below-threshold",
    JSON.stringify(r)
  );
}

// --- bestAxisAlign unit (different widths → left closer than center) ---
{
  const a = rectAnchors({ x: 0, y: 0, w: 100, h: 100 });
  const b = rectAnchors({ x: 3, y: 50, w: 180, h: 100 });
  // left delta=3; centers: a.cx=50, b.cx=93 → delta=43 (out of snap)
  const g = bestAxisAlign(a, b, "x", 10, "b");
  toy(
    "best-axis-left",
    g && g.kind === "left" && Math.abs(g.delta - 3) < 1e-9,
    g ? `${g.kind}:${g.delta}` : "null"
  );
}

// --- wiring pins in index.html ---
toy(
  "index-imports-helper",
  index.includes('import("./vendor/next-action/move-align-snap.mjs")'),
  "dynamic import"
);
toy(
  "index-guide-class",
  index.includes("na-move-align-guide"),
  "guide CSS/class"
);
toy(
  "index-startNodeDrag-hook",
  index.includes("refreshMoveAlignGuides") &&
    index.includes("applyMoveAlignSnap") &&
    index.includes("clearMoveAlignGuides"),
  "drag hooks"
);
toy(
  "index-geoOn-gate",
  index.includes("refreshMoveAlignGuides") &&
    /function refreshMoveAlignGuides[\s\S]{0,400}geoOn/.test(index),
  "geoOn gate in refresh"
);
toy(
  "index-reduced-motion-css",
  index.includes("prefers-reduced-motion") &&
    index.includes("na-move-align-guide"),
  "reduced-motion CSS"
);
toy(
  "index-no-tip-panel",
  !/next-action-panel|ghost-overlay|product-36\.html/.test(index),
  "no tip/ghost/product twin in index"
);

// --- no product-36 twin demo ---
toy(
  "no-product-36-html",
  !existsSync(join(NA, "demo", "product-36.html")) &&
    !existsSync(join(ROOT, "product-36.html")) &&
    !existsSync(join(NA, "product-36.html")),
  "no product-36.html twin"
);

// --- README ---
toy(
  "readme-lists-36",
  /·\s*36|Product · 36|move-align/.test(readme),
  "README mentions ·36 / move-align"
);
toy(
  "readme-check-listed",
  readme.includes("check-next-action-move-align-snap.mjs"),
  "check listed in README"
);

const passed = toys.filter((t) => t.ok).length;
const failed = toys.filter((t) => !t.ok);
console.log(`\nmove-align-snap toys: ${passed}/${toys.length}`);
if (failed.length) {
  for (const f of failed) console.error(`  FAIL ${f.name}: ${f.detail}`);
  process.exit(1);
}
