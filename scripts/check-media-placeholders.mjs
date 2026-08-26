#!/usr/bin/env node
// Media fields that aren't a data: or http(s) URL (prose placeholders, file
// paths, objects) look filled — inspect prints a default, run() skips the
// required-input check — then POST garbage to NanoGPT. PR #364 added
// scrubMediaPlaceholders() on library load (njs-engine / play.html's embedded
// bundle): blank the field and warn. This drives the REAL materialize() from
// vendor/njs-engine.js and pins the same predicate text in play.html's bundle.
//
// Offline, no network, no API spend. play.html RUNTIME materialize() still
// does not scrub (browser applyGraphData twin) — that divergence is noted,
// not pinned; this check covers the library contract that shipped in #364.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(ROOT, "vendor", "njs-engine.js");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

if (!existsSync(VENDOR)) {
  console.log("⊘ skip media-placeholders: vendor/njs-engine.js missing (run scripts/gen-js-engine.mjs)");
  process.exit(0);
}

let fail = 0;
const ok = (c, m) => {
  if (!c) { fail++; console.log("  ✗ " + m); }
  else console.log("  ✓ " + m);
};

const w = {};
new Function("window", readFileSync(VENDOR, "utf8"))(w);
const { materialize } = w.NanoodleEngine;
if (typeof materialize !== "function") {
  console.error("✗ media-placeholders: NanoodleEngine.materialize is not exported");
  process.exit(1);
}

const DATA = "data:image/png;base64,QUJD";
const HTTPS = "https://example.com/cat.png";
const HTTP = "http://example.com/cat.png";

function node(type, fields) {
  return { id: type + "1", type, x: 0, y: 0, fields: { ...fields } };
}

function fieldsOf(graph, id) {
  const n = graph.nodes.find((x) => x.id === id);
  return n && n.fields;
}

function warnFor(graph, key) {
  return graph.warnings.filter((w) => w.includes("fields." + key));
}

{
  const g = materialize({
    nodes: [
      node("upload", { image: "[image will be provided at run time]" }),
      node("aupload", { audio: "./voice.wav" }),
      node("vupload", { video: "C:\\clips\\in.mp4" }),
      node("inpaint", { image: "please upload", mask: { w: 1 } }),
    ],
    links: [],
  });
  const u = fieldsOf(g, "upload1");
  const a = fieldsOf(g, "aupload1");
  const v = fieldsOf(g, "vupload1");
  const p = fieldsOf(g, "inpaint1");
  ok(u && u.image === "", `prose placeholder image is blanked (got ${JSON.stringify(u && u.image)})`);
  ok(a && a.audio === "", `file-path audio is blanked (got ${JSON.stringify(a && a.audio)})`);
  ok(v && v.video === "", `Windows path video is blanked (got ${JSON.stringify(v && v.video)})`);
  ok(p && p.image === "" && p.mask === "", `object mask + prose image are blanked (image=${JSON.stringify(p && p.image)} mask=${JSON.stringify(p && p.mask)})`);
  ok(warnFor(g, "image").length >= 2, `each scrubbed media field warns (image warnings=${warnFor(g, "image").length})`);
  ok(warnFor(g, "audio").length === 1 && /not a data: or http/.test(warnFor(g, "audio")[0]),
    "audio warning names the empty-at-run-time contract");
}

{
  const g = materialize({
    nodes: [
      node("upload", { image: DATA }),
      node("aupload", { audio: "  " + HTTPS + "  " }),
      node("vupload", { video: HTTP }),
      node("inpaint", { image: "", mask: null }),
    ],
    links: [],
  });
  const u = fieldsOf(g, "upload1");
  const a = fieldsOf(g, "aupload1");
  const v = fieldsOf(g, "vupload1");
  const p = fieldsOf(g, "inpaint1");
  ok(u && u.image === DATA, "data: URL image is kept");
  ok(a && a.audio === "  " + HTTPS + "  ", "whitespace-padded https URL is kept (trimmed only for the test)");
  ok(v && v.video === HTTP, "http URL video is kept");
  ok(p && p.image === "" && p.mask == null, "empty string and null stay empty (no warning)");
  ok(g.warnings.length === 0, `valid / empty media must not warn (got ${JSON.stringify(g.warnings)})`);
}

{
  const g = materialize({
    nodes: [node("text", { text: "[image will be provided at run time]", image: "not-a-url" })],
    links: [],
  });
  const t = fieldsOf(g, "text1");
  ok(t && t.text === "[image will be provided at run time]", "non-media fields are not scrubbed");
  ok(t && t.image === "", "a stray fields.image on a text node is still a media key and is blanked");
}

{
  const g = materialize({
    nodes: [{ id: "mystery", type: "not-a-type", fields: { image: "placeholder.png" } }],
    links: [],
  });
  const n = g.nodes.find((x) => x.id === "mystery");
  ok(n && n.unknown === true, "unknown node types are kept (library materialize) so the author can see them");
  ok(n && n.fields.image === "placeholder.png", "unknown types are not scrubbed (run will fail-fast on the type, not the media)");
}

// play.html's embedded bundle is the same generator output — pin the call site
// so a future extract that drops the scrub from materialize fails here, not in prod.
{
  const block = /<script id="njs-engine"[\s\S]*?<\/script>/.exec(PLAY);
  ok(!!block, "play.html still embeds the njs-engine bundle");
  if (block) {
    ok(/function scrubMediaPlaceholders\s*\(/.test(block[0]), "play.html njs-engine still defines scrubMediaPlaceholders");
    ok(/scrubMediaPlaceholders\(\s*n\s*,\s*warnings\s*\)/.test(block[0]), "play.html library materialize still calls scrubMediaPlaceholders");
    ok(/const MEDIA_URL_RE = \/\^\(data:\|https\?:\)\/i/.test(block[0]), "play.html MEDIA_URL_RE still accepts only data: / http(s)");
  }
}

if (fail) {
  console.error(`\n✗ media-placeholders: ${fail} assertion(s) failed.`);
  process.exit(1);
}
console.log("\n✓ media-placeholders: library materialize blanks non-URL media and warns; real URLs and empty fields stay.");
