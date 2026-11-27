#!/usr/bin/env node
// Sample-pop timing (initial-moment Cycle 9, 2026-11-27).
//
// In every measured cycle (1, 2, 6, 7) the sign-in pop fired at +0.10 s —
// the moment Run was pressed, before the first result landed — so the
// relay's first second was spent reading a pitch instead of watching the
// sketch get read. The pop's honesty job is already carried per-result by
// the "sample result" badges, which land WITH each result. The pop now
// follows the wow: it opens when the painting (the image result, the
// measured time-to-first-wow) lands, or when the run group settles if no
// painting lands. The WALL pop (non-starter graph, mode null) never
// defers: nothing runs behind it, so waiting would be a silent no-op.
//
// Contract pinned here (source-level, offline — no browser, no spend):
//  1. runGroup opens the pop immediately ONLY at the wall (mode null),
//     and defers via deferDemoPop (typeof-guarded) for sample modes.
//  2. deferDemoPop only stashes the mode; flushDemoPop opens it exactly
//     once (clears before opening) and drops it if a key appeared.
//  3. markDemoResult flushes when an image-kind result lands.
//  4. runGroup flushes any remainder after the group settles.
//  5. openDemoPop itself is unchanged in contract: the way-back action
//     still shows only at the wall.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error(name + "() not found in index.html");
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("could not brace-match " + name + "()");
}
const grab = (name) => { try { return extractFn(IDX, name); } catch (_) { return ""; } };

const runGroup = grab("runGroup");
ok(runGroup.length > 0, "runGroup exists");

// 1. Wall immediate, sample deferred.
ok(/if\(!mode\)\{\s*openDemoPop\(mode\);\s*return;\s*\}/.test(runGroup),
   "wall mode (null) still opens the pop immediately and returns");
ok(/typeof deferDemoPop === "function"\) deferDemoPop\(mode\); else openDemoPop\(mode\);/.test(runGroup),
   "sample modes defer via deferDemoPop (typeof-guarded, immediate fallback)");
ok(!/openDemoPop\(mode\);\s*if\(!mode\) return;/.test(runGroup),
   "the old fire-at-Run pattern is gone");

// 2. Defer/flush helpers.
const defer = grab("deferDemoPop");
ok(defer.includes("pendingDemoPopMode = mode") && !defer.includes("openDemoPop"),
   "deferDemoPop stashes the mode without opening the pop");
const flush = grab("flushDemoPop");
ok(flush.includes("pendingDemoPopMode === undefined") && flush.includes("openDemoPop(mode)"),
   "flushDemoPop opens the stashed pop");
ok(flush.indexOf("pendingDemoPopMode = undefined") < flush.indexOf("openDemoPop(mode)"),
   "flushDemoPop clears before opening (fires exactly once)");
ok(flush.includes("getKey()"), "flushDemoPop drops the pitch if a key appeared mid-deferral");

// 3. Painting landing flushes.
const mark = grab("markDemoResult");
ok(mark.includes("flushDemoPop()") && /modelKind === "image"/.test(mark),
   "markDemoResult flushes the pop when an image result (the painting) lands");

// 4. Group settle flushes any remainder.
ok(runGroup.includes("flushDemoPop()") && runGroup.indexOf("flushDemoPop()") > runGroup.indexOf("Promise.all(order.map"),
   "runGroup flushes any pending pop after the group settles");

// 5. Wall-pop contract intact.
const pop = grab("openDemoPop");
ok(pop.includes("demostarter") && pop.includes("!!mode"),
   "openDemoPop still shows the way back only at the wall");

console.log(fail ? `check-demo-pop-timing: ${fail} FAILED` : "check-demo-pop-timing: all passed");
process.exit(fail ? 1 : 0);
