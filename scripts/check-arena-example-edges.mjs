#!/usr/bin/env node
// Leftover featured-arena identity after #682 / #684.
// Those PRs already lock shelf membership, arena width, "same brief /
// different models", and capability fixtures. This file pins the leftover
// spend contract those checks never hit: the exact catalog ids and the
// cheap demo knobs. Swapping Grok Lite for the full Grok, or lifting
// 5s/480p to 15s/1080p, would still pass the width/comparison toys while
// the Examples shelf billed a different run. Offline, zero API spend.
// New file so it does not collide with check-example-results.
import { parseExamples } from "./check-example-models.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const examples = parseExamples(readFileSync(join(ROOT, "index.html"), "utf8"));

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

function example(slug) {
  const ex = examples.find((e) => e.slug === slug);
  if (!ex) {
    fail(slug + " missing from EXAMPLES");
    return null;
  }
  return ex;
}

function modelNodes(ex) {
  return (ex.graph.nodes || []).filter((n) => n.fields && n.fields.model);
}

function byModel(ex, id) {
  return modelNodes(ex).find((n) => n.fields.model === id);
}

function sameSet(actual, expected) {
  const a = [...actual].sort();
  const b = [...expected].sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

{
  const ex = example("flux3-seedream-ideogram-arena");
  if (ex) {
    const ids = modelNodes(ex).map((n) => n.fields.model);
    const want = [
      "black-forest-labs/flux-3/text-to-image",
      "bytedance/seedream-v5.0-flash",
      "ideogram/v4.5",
      "recraft-ai/recraft-v4.1-flash/text-to-image",
    ];
    if (!sameSet(ids, want))
      fail("flux3 arena ids drifted: " + ids.join(", "));
    else if (modelNodes(ex).some((n) => n.type !== "image"))
      fail("flux3 arena must stay image-only");
    else if (modelNodes(ex).some((n) => n.fields.size !== "1k" && n.fields.size !== "1024x1024"))
      fail("flux3 arena must stay on the 1k / 1024 poster size");
    else ok("flux3 arena keeps the four poster ids at 1k");
  }
}

{
  const ex = example("grok-heygen-minimax-video-arena");
  if (ex) {
    const ids = modelNodes(ex).map((n) => n.fields.model);
    const want = [
      "grok-imagine-video-1.5-lite",
      "heygen/heygen-video-1",
      "minimax-h3",
    ];
    if (!sameSet(ids, want))
      fail("video arena ids drifted: " + ids.join(", "));
    else if (modelNodes(ex).some((n) => n.type !== "tvideo"))
      fail("video arena must stay text-to-video");
    else ok("video arena keeps Grok Lite / HeyGen / H3");

    const grok = byModel(ex, "grok-imagine-video-1.5-lite");
    const hey = byModel(ex, "heygen/heygen-video-1");
    const h3 = byModel(ex, "minimax-h3");
    if (!grok || grok.fields.duration !== "5" || grok.fields.resolution !== "480p")
      fail("Grok Lite demo must stay 5s 480p, got " + JSON.stringify(grok && grok.fields));
    else if (!hey || hey.fields.duration !== "5" || hey.fields.resolution !== "480p")
      fail("HeyGen demo must stay 5s 480p, got " + JSON.stringify(hey && hey.fields));
    else if (!h3 || h3.fields.duration !== "5")
      fail("H3 demo must stay 5s, got " + JSON.stringify(h3 && h3.fields));
    else ok("video arena keeps the cheap 5s demo knobs");
  }
}

if (failed) {
  console.error("\n✗ check-arena-example-edges: " + failed + " failed");
  process.exit(1);
}
console.log("\n✓ check-arena-example-edges");
