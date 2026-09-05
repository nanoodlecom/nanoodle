#!/usr/bin/env node
// Pins the library share-link salvage path (nanoodle-js share.mjs, shipped as
// vendor/njs-engine.js and the play.html njs-engine block).
//
// check-linkerr.mjs covers the play.html UI banner when a #a= payload is garbage.
// check-graph-persistence.mjs covers well-formed editor #g=/#j= round-trips and
// the autosave-wipe guard on a payload that cannot be recovered. Neither drives
// salvageGraph / decodeShareFragment — the best-effort recoverer Workflow.load
// uses when a messenger truncates or CRC-corrupts a link.
//
// A regression here is user-visible data loss: a recoverable #j= / #g= / #a=
// payload throws "link may be truncated" and the graph is gone, or #ga= (an
// unstable editor handoff) is silently accepted as a share. Cosmetic editor
// state (view, nid/lid, app files) is supposed to be dropped; nodes + links
// must survive.
//
// Offline. Loads the REAL shipped NanoodleEngine (no reimplementation). Zero
// network, zero API spend.

import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(ROOT, "vendor", "njs-engine.js");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

if (!existsSync(VENDOR)) {
  console.log("⊘ skip share-salvage: vendor/njs-engine.js missing (run scripts/gen-js-engine.mjs)");
  process.exit(0);
}

const failures = [];
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { console.error("  ✗ " + m); failures.push(m); } };

const w = {};
new Function("window", readFileSync(VENDOR, "utf8"))(w);
const ENGINE = w.NanoodleEngine;
if (!ENGINE || typeof ENGINE.decodeShareFragment !== "function") {
  console.error("✗ check-share-salvage: NanoodleEngine.decodeShareFragment is not exported");
  process.exit(1);
}

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const jFrag = (text) => "#j=" + b64url(Buffer.from(text, "utf8"));
const gFrag = (text) => "#g=" + b64url(gzipSync(Buffer.from(text, "utf8")));
const aFragU = (text) => "#a=u" + b64url(Buffer.from(text, "utf8"));

const GRAPH = {
  nodes: [{ id: "n1", type: "text", fields: { text: 'hello "links": [] world' } }],
  links: [{ id: "l1", from: { node: "n1", port: "text" }, to: { node: "x", port: "prompt" } }],
};

async function dec(frag) {
  return ENGINE.decodeShareFragment(frag);
}

async function throws(fn, re, m) {
  let err = "";
  try { await fn(); } catch (e) { err = e && e.message ? e.message : String(e); }
  ok(re.test(err), m + (err ? "" : " (did not throw)"));
  return err;
}

// ---- wire-in: salvage still sits on the shipped surfaces ----------------------
ok(/function salvageGraph\(/.test(readFileSync(VENDOR, "utf8")),
  "vendor/njs-engine.js still defines salvageGraph");
ok(/function decodeShareFragment\(/.test(readFileSync(VENDOR, "utf8")),
  "vendor/njs-engine.js still defines decodeShareFragment");
const njsBlock = /<script id="njs-engine"[^>]*>\n([\s\S]*?)\n<\/script>/.exec(PLAY);
ok(!!njsBlock, "play.html still embeds the njs-engine block");
ok(njsBlock && /function salvageGraph\(/.test(njsBlock[1]),
  "play.html njs-engine block still defines salvageGraph");
ok(/decodeShareUrl\(src/.test(readFileSync(VENDOR, "utf8")),
  "Workflow.load still routes share refs through decodeShareUrl");

console.log("• valid fragments (no salvage)");
{
  const r = await dec(jFrag(JSON.stringify(GRAPH)));
  ok(r.kind === "j" && r.recovered !== true, "valid #j= is not marked recovered");
  ok(r.graph && r.graph.nodes[0].id === "n1" && r.graph.nodes[0].fields.text.includes("links"),
    "valid #j= keeps the node, including a quotes-and-brackets prompt");
  ok(r.graph.links[0].id === "l1", "valid #j= keeps the link");
}

{
  const payload = { v: 1, name: "Demo", lang: "es", files: { "index.html": "<html>" }, graph: GRAPH };
  const r = await dec(aFragU(JSON.stringify(payload)));
  ok(r.kind === "a" && r.recovered !== true, "valid #a=u is not marked recovered");
  ok(r.graph && r.graph.nodes[0].id === "n1", "valid #a=u returns the nested graph");
  ok(r.app && r.app.name === "Demo" && r.app.lang === "es" && r.app.hasFiles === true,
    "valid #a=u keeps name/lang/hasFiles");
}

{
  const r = await dec(gFrag(JSON.stringify(GRAPH)));
  ok(r.kind === "g" && r.recovered !== true, "valid #g= is not marked recovered");
  ok(r.graph && r.graph.nodes[0].id === "n1", "valid #g= gunzips to the graph");
}

console.log("• damaged-but-salvageable fragments");
{
  // Trailing junk after a complete nodes/links object — JSON.parse fails,
  // extractJsonValue still pulls the two arrays. The prompt contains the
  // characters `"links": []` so a non-string-aware scanner would close early.
  const damaged = JSON.stringify(GRAPH) + ",CORRUPT";
  const r = await dec(jFrag(damaged));
  ok(r.recovered === true && r.kind === "j", "trailing-junk #j= is recovered");
  ok(r.graph.nodes[0].id === "n1" && r.graph.nodes[0].fields.text.includes("links"),
    "salvage keeps the node whose prompt contains a fake \"links\" key");
  ok(r.graph.links.length === 1 && r.graph.links[0].id === "l1",
    "salvage keeps the real links array, not the one inside the prompt string");
  ok(r.graph.v === 1, "salvaged graph is tagged v:1");
}

{
  const damaged = JSON.stringify(GRAPH) + "\n\"view\":";
  const r = await dec(gFrag(damaged));
  ok(r.recovered === true && r.kind === "g", "gzip-ok / JSON-broken #g= is recovered");
  ok(r.graph.nodes[0].id === "n1" && r.graph.links[0].id === "l1",
    "recovered #g= still has nodes + links");
}

{
  const payload = { v: 1, name: "Demo", lang: "es", files: { "index.html": "<html>" }, graph: GRAPH };
  const r = await dec(aFragU(JSON.stringify(payload) + " TRAILING"));
  ok(r.recovered === true && r.kind === "a", "damaged #a=u with an intact nested graph is recovered");
  ok(r.graph.nodes[0].id === "n1", "recovered #a= prefers the nested graph object");
  ok(r.app && r.app.hasFiles === false, "salvaged #a= drops files (hasFiles false)");
  ok(!r.app.name && !r.app.lang, "salvaged #a= drops cosmetic name/lang");
}

{
  // Nested "graph" object does not parse — fall through to sibling nodes/links.
  const text = '{"graph":{"nodes":[NOTJSON],"files":true},"nodes":'
    + JSON.stringify(GRAPH.nodes) + ',"links":' + JSON.stringify(GRAPH.links) + ",CORRUPT";
  const r = await dec(aFragU(text));
  ok(r.recovered === true && r.graph && r.graph.nodes[0].id === "n1",
    "damaged nested graph still salvages sibling nodes/links when they parse");
}

console.log("• unrecoverable / refused fragments");
await throws(() => dec("#ga=abc"), /handoff|internal|#ga=/i,
  "#ga= is refused as the editor↔app-builder handoff");
await throws(() => dec(jFrag('{"nodes":[],"links":[]} CORRUPT')), /JSON|truncated|not valid/i,
  "empty nodes array is not salvageable — strict error is rethrown");
await throws(() => dec(jFrag('{"nodes":[{"id":"n1"}],"links":[]} CORRUPT')), /JSON|truncated|not valid/i,
  "nodes missing type are not salvageable");
await throws(() => dec(jFrag("not-json-at-all")), /JSON|truncated|not valid|base64/i,
  "total garbage #j= still throws");
await throws(() => dec("#x=nope"), /no #g=\/#j=\/#a=/i,
  "a fragment that is not #g=/#j=/#a= is refused");

{
  const loaded = await ENGINE.Workflow.load(jFrag(JSON.stringify(GRAPH) + ",CORRUPT"), { quiet: true });
  ok(loaded && loaded.graph && loaded.graph.nodes[0].id === "n1",
    "Workflow.load salvages a damaged #j= into a runnable Workflow");
}

if (failures.length) {
  console.error("✗ check-share-salvage: " + failures.length + " assertion(s) failed.");
  process.exit(1);
}
console.log("✓ share salvage: damaged #g=/#j=/#a= recover nodes+links; #ga= and empty/untyped nodes still fail.");
