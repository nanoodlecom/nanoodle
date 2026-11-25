#!/usr/bin/env node
// A blank workspace shows the ways in (UX review 2026-11-25).
//
// Seen live on nanoodle.com: close the starter tab (or pick Blank canvas, or delete
// every node) and the canvas is a dark void. Run only flashes "nothing to run — add a
// node" (invisible on phones), and a returning visitor whose last tab was emptied lands
// on that void every time. #emptycanvas now offers Add a node / Examples / the starter.
//
// Contract (offline):
//  1. #emptycanvas lives inside <main id="editor"> before the main script (boot-time
//     translateTree reaches it) and starts hidden.
//  2. redraw() calls syncEmptyCanvas(); it shows only when the graph has no nodes.
//  3. Its overlay never eats canvas gestures: pointer-events:none except the card.
//  4. The buttons reuse the real paths: #addbtn, #examples, chooseWorkspace("starter").
//  5. Its copy is in every language map.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } else console.log("  ✓ " + m); };
function extractFn(name) {
  const start = IDX.indexOf("function " + name + "(");
  if (start === -1) return "";
  let depth = 0;
  for (let j = IDX.indexOf("{", start); j < IDX.length; j++) {
    if (IDX[j] === "{") depth++; else if (IDX[j] === "}" && --depth === 0) return IDX.slice(start, j + 1);
  }
  return "";
}

const main = IDX.slice(IDX.indexOf('<main id="editor"'), IDX.indexOf("</main>"));
ok(/<div id="emptycanvas" hidden>/.test(main), "#emptycanvas is inside the canvas and starts hidden");
ok(IDX.indexOf('id="emptycanvas"') < IDX.indexOf("I18N-MAPS-BEGIN"), "it sits before the main script (translated at boot)");

ok(/syncFitBtn\(\);[^\n]*\n\s*syncEmptyCanvas\(\);/.test(extractFn("redraw")), "redraw() re-judges the empty state");
ok(/buildNodeEl\(n\);[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*try\{ if\(typeof syncEmptyCanvas==="function"\) syncEmptyCanvas\(\); \}catch\(_\)\{\}/.test(extractFn("addNode")), "addNode() hides the card itself — scripted adds skip redraw()");
const fn = extractFn("syncEmptyCanvas");
const el = { hidden: true, dataset: {} };
const ctx = { $: (id) => (id === "emptycanvas" ? el : null), graph: { nodes: [] } };
vm.createContext(ctx); vm.runInContext(fn, ctx);
ctx.syncEmptyCanvas(); ok(el.hidden === true, "before boot's first graph lands → stays hidden (no flash over the incoming starter)");
el.dataset.ready = "1";
ok(/dataset\.ready = "1"; syncEmptyCanvas\(\)/.test(IDX), "boot marks the canvas ready after finishInitialCanvas");
ctx.syncEmptyCanvas(); ok(el.hidden === false, "no nodes → shown");
ctx.graph.nodes.push({ id: "n1", type: "note" }); ctx.syncEmptyCanvas(); ok(el.hidden === true, "any node (even a note) → hidden");
ctx.graph = null; ctx.syncEmptyCanvas(); ok(el.hidden === false, "no graph yet → shown, no throw");

ok(/#emptycanvas\{[^}]*pointer-events:none/.test(IDX) && /#emptycanvas \.ec-card\{[^}]*pointer-events:auto/.test(IDX), "overlay passes canvas gestures through; only the card takes clicks");

ok(/\$\("ecadd"\)\.onclick = [^\n]*\$\("addbtn"\)\.click\(\)/.test(IDX), "Add a node opens the real add menu");
ok(/\$\("ecexamples"\)\.onclick = [^\n]*\$\("examples"\)\.click\(\)/.test(IDX), "Examples opens the real Examples dialog");
ok(/\$\("ecstarter"\)\.onclick = [^\n]*chooseWorkspace\("starter"\)/.test(IDX), "the starter goes through chooseWorkspace(\"starter\")");

const block = IDX.slice(IDX.indexOf("I18N-MAPS-BEGIN"), IDX.indexOf("I18N-MAPS-END"));
for (const k of ["This workspace is empty", "Start from a node, an example, or the starter sample.", "Try the starter sample", "or describe what you want in the box below ↓", "Add a node", "Examples"]) {
  const n = block.split(JSON.stringify(k) + ":").length - 1;
  ok(n === 5, `"${k}" is translated in all 5 languages (${n})`);
}

if (fail) { console.log(`check-empty-canvas: ${fail} failed`); process.exit(1); }
console.log("✓ a blank workspace shows Add a node / Examples / the starter");
