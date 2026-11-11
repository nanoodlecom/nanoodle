#!/usr/bin/env node
// Zero-spend default Play regression: exercise runGraph -> njsRunFor -> shipped
// SDK -> NanoClient payload, not the opt-out ?engine=play fallback.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadEngine, calls, catalog, ROOT } from "./play-engine.mjs";

const html = readFileSync(ROOT + "/play.html", "utf8");
const block = /<script id="njs-engine"[^>]*>\n([\s\S]*?)\n<\/script>/.exec(html);
assert.ok(block, "Play embedded SDK must exist");
const model = "google/gemini-omni-flash/v1.2";
// PR catalog shape: mode capability only; no reference_images param/pricing.
const item = { id: model, pricing: { type: "refundable_reservation", reservation_usd: 15 },
  supported_parameters: { parameters: { mode: { type: "select", default: "auto", options:
    ["auto", "reference", "edit", "extend"].map(value => ({ value })) } } } };
const refs = Array.from({ length: 6 }, (_, i) => `https://cdn.example/ref${i + 1}.png`);
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
for (const [label, source] of [["Play embedded", block[1]],
  ["vendor", readFileSync(ROOT + "/vendor/njs-engine.js", "utf8")]]) {
  const w = {};
  new Function("window", source)(w);
  const E = w.NanoodleEngine;
  for (const withCatalog of [true, false]) for (const type of ["tvideo", "vedit"]) {
    catalog.video = withCatalog ? [item] : [];
    let captured;
    const app = loadEngine(ctx => {
      captured = ctx;
      ctx.URLSearchParams = URLSearchParams;
      // NO njs_engine preference: this is the default-on path.
      ctx.localStorage = ctx.sessionStorage = {
        getItem: key => key === "ngpt_key" ? "test-api-key" : null,
        setItem() {}, removeItem() {},
      };
    });
    const seen = [];
    captured.NanoodleEngine = { ...E, RUNNERS: { ...E.RUNNERS,
      [type]: (n, inp, ctx) => {
        const video = ctx.video;
        return E.RUNNERS[type](n, inp, { ...ctx, video: (...args) => {
          seen.push(args[2]); return video(...args);
        } });
      },
    } };
    const nodes = refs.map((image, i) => ({ id: "u" + i, type: "upload", fields: { image } }));
    nodes.push({ id: "v", type, fields: { model, prompt: "slow pan", modelOpts: { mode: "reference" } } });
    const links = refs.map((_, i) => ({ id: "r" + i, from: { node: "u" + i, port: "image" },
      to: { node: "v", port: "ref" + (i + 1) } }));
    if (type === "vedit") {
      nodes.push({ id: "src", type: "vupload", fields: { video: "https://cdn.example/src.mp4" } });
      links.push({ id: "src", from: { node: "src", port: "video" }, to: { node: "v", port: "video" } });
    }
    calls.length = 0;
    await app.runGraph(app.materialize({ nodes, links }), {});
    assert.equal(seen.length, 1, "default Play must delegate exactly once");
    assert.deepEqual(plain(seen[0].refImages), refs, "SDK opts retain six refs in order");
    assert.equal(seen[0].refKey, "reference_images");
    const submits = calls.filter(c => /\/api\/generate-video$/.test(c.url));
    assert.equal(submits.length, 1, "one mock submission, no duplicate job");
    assert.equal(submits[0].body.mode, "reference");
    assert.deepEqual(plain(submits[0].body.reference_images), refs, "all six refs reach the wire");
    console.log(`✓ ${label} default Play ${type}, ${withCatalog ? "PR catalog" : "no catalog"}: six refs + refKey + payload`);
  }
}
