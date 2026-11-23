#!/usr/bin/env node
// Returning-visitor re-entry to the starter sample (initial-moment Cycle 5,
// 2026-11-22).
//
// The shipped starter (noodle-graph.json, "Sketch → story") is the only graph
// a signed-out visitor can free-sample, but once any workspace existed there
// was no way back to it: the New workspace menu offered only Blank canvas /
// Text to image / Ask a model / Browse Examples, the starter is not among
// the Examples, and the sign-in wall pop said "the sample only covers the
// starter" while offering no way to reach the thing it named. Measured live
// in Cycles 3–5: returning signed-out time-to-wow in-editor = never.
//
// Contract pinned here (source-level, offline — no browser, no spend):
//  1. The + New workspace chooser offers the starter (data-ws="starter").
//  2. The workspace dropdown menu offers it too (fillDropMenu list).
//  3. chooseWorkspace routes "starter" to openStarterWorkspace.
//  4. openStarterWorkspace loads the canonical starter via starterGraphData,
//     deep-copies it (the cache feeds demoMode's baseline signatures), and
//     opens it via openWorkspaceWithGraph under the name "Sketch → story".
//  5. Already on the starter (demoMode non-null) it acknowledges instead of
//     piling up duplicate starter tabs; a saved starter tab (shape-sig match)
//     is switched to, not duplicated.
//  6. The wall pop (#demopop) carries a "Back to the starter sample" action
//     that openDemoPop shows only at the wall (mode null) and whose click
//     routes through chooseWorkspace("starter").

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

// 1. Chooser entry
const chooser = IDX.slice(IDX.indexOf('id="wschooser"'), IDX.indexOf('id="wsdropmenu"'));
ok(/data-ws="starter"/.test(chooser), "wschooser offers the starter (data-ws=\"starter\")");
ok(chooser.indexOf('data-ws="starter"') !== -1 && chooser.indexOf('data-ws="starter"') < chooser.indexOf('data-ws="blank"'),
   "starter is the first chooser entry, above Blank canvas");

const grabFn = (name) => { try { return extractFn(IDX, name); } catch (_) { return ""; } };

// 2. Dropdown menu entry
const fill = grabFn("fillDropMenu");
ok(fill.includes('"starter"'), "fillDropMenu lists the starter kind");

// 3 + 4 + 5. Routing and opener behaviour
const choose = grabFn("chooseWorkspace");
ok(choose.includes('kind==="starter"') && choose.includes("openStarterWorkspace()"),
   "chooseWorkspace routes \"starter\" to openStarterWorkspace");
const opener = grabFn("openStarterWorkspace");
ok(opener.includes("starterGraphData()"), "opener loads the canonical starter via starterGraphData");
ok(opener.includes("JSON.parse(JSON.stringify(data))"),
   "opener deep-copies the starter (cached baseline stays pristine)");
ok(opener.includes("openWorkspaceWithGraph(") && opener.includes("Sketch → story"),
   "opener opens the starter as a \"Sketch → story\" workspace");
ok(opener.includes("demoMode()") && opener.includes("Starter sample is this tab."),
   "opener acknowledges instead of duplicating when already on the starter");
ok(opener.includes("demoShapeSig(") && opener.includes("switchWorkspace("),
   "opener switches to an existing saved starter tab instead of duplicating it");

// 6. Wall-pop way back
ok(IDX.includes('id="demostarter"'), "#demopop carries the demostarter action");
const pop = grabFn("openDemoPop");
ok(pop.includes("demostarter") && pop.includes("!!mode"),
   "openDemoPop shows the way back only at the wall (mode null)");
ok(IDX.includes('$("demostarter").onclick') && IDX.includes('chooseWorkspace("starter")'),
   "demostarter click routes through chooseWorkspace(\"starter\")");

if (fail) { console.log("check-starter-reentry: " + fail + " FAILED"); process.exit(1); }
console.log("check-starter-reentry: all passed");
