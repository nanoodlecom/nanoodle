#!/usr/bin/env node
// Library / njs-engine materialize() must blank media fields that are not a
// data: or http(s) URL. Agents leave prose placeholders ("[image will be
// provided at run time]") or bare file paths; those LOOK filled (inspect prints
// a default, run() skips the required-input check) but POST garbage.
//
// Pins the shipped scrubMediaPlaceholders path on both copies of the engine
// (play.html #njs-engine and vendor/njs-engine.js). Does NOT pin play RUNTIME
// materialize — that copy still does not scrub.
//
// Offline. No browser, no network, no API spend.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");
const VENDOR = join(ROOT, "vendor", "njs-engine.js");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

function loadEngine(src, label) {
  const w = {};
  try {
    new Function("window", src)(w);
  } catch (e) {
    throw new Error(`${label}: engine failed to load: ${e && e.message || e}`);
  }
  const E = w.NanoodleEngine;
  if (!E || typeof E.materialize !== "function") {
    throw new Error(`${label}: NanoodleEngine.materialize() is missing`);
  }
  return E;
}

function engines() {
  const out = [];
  const block = /<script id="njs-engine"[^>]*>\n([\s\S]*?)\n<\/script>/.exec(PLAY);
  if (block) out.push(["play.html #njs-engine", loadEngine(block[1], "play.html #njs-engine")]);
  else fail("play.html is missing the njs-engine script block");
  if (existsSync(VENDOR)) out.push(["vendor/njs-engine.js", loadEngine(readFileSync(VENDOR, "utf8"), "vendor/njs-engine.js")]);
  else fail("vendor/njs-engine.js is missing");
  return out;
}

if (!/function scrubMediaPlaceholders\(n, warnings\)/.test(PLAY)) {
  fail("play.html library copy must define scrubMediaPlaceholders");
} else ok("play.html library copy defines scrubMediaPlaceholders");

const DATA = "data:image/png;base64,AAAA";
const HTTPS = "https://cdn.example/still.png";
const HTTP = "http://127.0.0.1:9/clip.mp4";
const PROSE = "[image will be provided at run time]";
const PATH = "/tmp/still.png";

for (const [label, E] of engines()) {
  const g = E.materialize({
    nodes: [
      { id: "u1", type: "upload", fields: { image: PROSE } },
      { id: "u2", type: "upload", fields: { image: PATH } },
      { id: "u3", type: "upload", fields: { image: DATA } },
      { id: "u4", type: "upload", fields: { image: "  " + HTTPS + "  " } },
      { id: "u5", type: "upload", fields: { image: "" } },
      { id: "p1", type: "inpaint", fields: { image: DATA, mask: "mask.png" } },
      { id: "a1", type: "aupload", fields: { audio: "voice-note.wav" } },
      { id: "v1", type: "vupload", fields: { video: HTTP } },
      { id: "v2", type: "vupload", fields: { video: "blob:null/preview" } },
    ],
    links: [],
  });
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  const warn = (id, field) => (g.warnings || []).some((w) => w.includes(`node ${id}`) && w.includes(`fields.${field}`));

  if (byId.u1.fields.image !== "")
    fail(`${label}: prose placeholder must be blanked, got ${JSON.stringify(byId.u1.fields.image)}`);
  else if (!warn("u1", "image"))
    fail(`${label}: prose placeholder must warn on fields.image`);
  else ok(`${label}: prose placeholder is treated as empty`);

  if (byId.u2.fields.image !== "")
    fail(`${label}: file path must be blanked, got ${JSON.stringify(byId.u2.fields.image)}`);
  else if (!warn("u2", "image"))
    fail(`${label}: file path must warn on fields.image`);
  else ok(`${label}: file path is treated as empty`);

  if (byId.u3.fields.image !== DATA)
    fail(`${label}: data: URL must stay, got ${JSON.stringify(byId.u3.fields.image)}`);
  else if (warn("u3", "image"))
    fail(`${label}: data: URL must not warn`);
  else ok(`${label}: data: URL is kept`);

  if (byId.u4.fields.image !== "  " + HTTPS + "  ")
    fail(`${label}: padded https URL must stay (trim is only for the test), got ${JSON.stringify(byId.u4.fields.image)}`);
  else if (warn("u4", "image"))
    fail(`${label}: https URL must not warn`);
  else ok(`${label}: https URL is kept`);

  if (byId.u5.fields.image !== "")
    fail(`${label}: already-empty image must stay empty`);
  else if (warn("u5", "image"))
    fail(`${label}: empty image must not warn`);
  else ok(`${label}: empty image stays quiet`);

  if (byId.p1.fields.image !== DATA)
    fail(`${label}: inpaint source data: URL must stay`);
  else if (byId.p1.fields.mask !== "")
    fail(`${label}: inpaint mask file name must be blanked, got ${JSON.stringify(byId.p1.fields.mask)}`);
  else if (!warn("p1", "mask"))
    fail(`${label}: inpaint mask file name must warn`);
  else ok(`${label}: inpaint blanks a non-URL mask and keeps a data: source`);

  if (byId.a1.fields.audio !== "")
    fail(`${label}: audio file name must be blanked, got ${JSON.stringify(byId.a1.fields.audio)}`);
  else if (!warn("a1", "audio"))
    fail(`${label}: audio file name must warn`);
  else ok(`${label}: audio file name is treated as empty`);

  if (byId.v1.fields.video !== HTTP)
    fail(`${label}: http video URL must stay, got ${JSON.stringify(byId.v1.fields.video)}`);
  else if (warn("v1", "video"))
    fail(`${label}: http video URL must not warn`);
  else ok(`${label}: http video URL is kept`);

  if (byId.v2.fields.video !== "")
    fail(`${label}: blob: video must be blanked (not portable), got ${JSON.stringify(byId.v2.fields.video)}`);
  else if (!warn("v2", "video"))
    fail(`${label}: blob: video must warn`);
  else ok(`${label}: blob: video is treated as empty`);
}

if (failed) {
  console.error(`\n${failed} media-placeholder check(s) failed`);
  process.exit(1);
}
console.log("\n✓ media placeholders: library/njs materialize blanks prose/paths, keeps data:/http(s)");
