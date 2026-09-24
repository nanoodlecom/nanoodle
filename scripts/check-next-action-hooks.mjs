#!/usr/bin/env node
// Pins the Product · 2/· 5 editor patches in index.html. Those wraps sit on
// addNode / connect / runGroup for every visitor (editor-surface defaults to
// product 1). A dropped return or an unwrapped next-action throw would break
// adding nodes, wiring, and paid runs — not just the tip panel.
//
// Source pins, offline, no inference.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");

function fail(msg) {
  console.error(`✗ next-action-hooks: ${msg}`);
  process.exit(1);
}

const start = html.indexOf("function bootNextActionSurface()");
if (start < 0) fail("bootNextActionSurface is missing — add/wire/run are no longer observed, or the wrap moved without the safety pins");
const end = html.indexOf("})();", start);
if (end < 0) fail("bootNextActionSurface IIFE close is missing");
const boot = html.slice(start, end + 5);

if (!/const n = _addNode\(type, x, y, fields\);/.test(boot))
  fail("addNode wrap must call _addNode(type, x, y, fields)");
if (!/return n;/.test(boot))
  fail("addNode wrap must return the original node — dropping it breaks every Add");
if (!/window\.__nextAction\?\.record\?\.\(tok\)/.test(boot))
  fail("addNode wrap must record via optional-call so a missing surface cannot throw");

if (!/const ok = _connect\(fromNode, fromPort, toNode, toPort\);/.test(boot))
  fail("connect wrap must call _connect with the original ports");
if (!/return ok;/.test(boot))
  fail("connect wrap must return the original boolean — dropping it breaks wire success/fail");
if (!/if\s*\(ok\)\s*try\s*\{\s*window\.__nextAction\?\.record\?\.\(["']wire["']\)/.test(boot))
  fail("connect wrap must record 'wire' only after a successful connect, inside try");

if (!/const _runGroup = runGroup;/.test(boot))
  fail("runGroup wrap is missing — Product · 5 run token / paid-path wrap drifted");
if (!/try\s*\{\s*window\.__nextAction\?\.record\?\.\(["']run["']\)\s*;\s*\}\s*catch/.test(boot))
  fail("runGroup wrap must try/catch the next-action record so a tip-panel throw cannot cancel a paid run");
if (!/return _runGroup\.apply\(this,\s*arguments\)/.test(boot))
  fail("runGroup wrap must return _runGroup.apply(...) — dropping apply silently stops every Run");

if (!/import\(["']\.\/vendor\/next-action\/editor-surface\.mjs["']\)/.test(boot))
  fail("bootNextActionSurface must dynamic-import editor-surface.mjs (static import would 404-crash the editor on older branches)");
if (!/\.catch\s*\(/.test(boot))
  fail("editor-surface import must .catch so a missing module cannot abort the editor");

console.log("✓ next-action-hooks: addNode/connect/runGroup wraps still delegate to the originals");
