#!/usr/bin/env node
// Leftover featured-gallery spend identity after #722 / #723.
// Those PRs already lock shelf membership, guide pages, samples provenance,
// and capability fixtures. This file pins the leftover spend contract those
// checks never hit: the exact catalog ids and the cheap demo knobs. Swapping
// TRELLIS.2 for a pricier 3D id, lifting Seedance to 1080p / audio-on, or
// replacing GLM Flash would still pass the slug-list toys while the Examples
// shelf billed a different run. Offline, zero API spend. New file so it does
// not collide with check-example-results / check-arena-example-edges.
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

function byType(ex, type) {
  return (ex.graph.nodes || []).filter((n) => n.type === type);
}

{
  const ex = example("idea-to-3d-model");
  if (ex) {
    const llm = byType(ex, "llm");
    const image = byType(ex, "image");
    const mesh = byType(ex, "model3d");
    const ids = (ex.graph.nodes || []).map((n) => n.fields && n.fields.model).filter(Boolean);
    if (llm.length !== 1 || llm[0].fields.model !== "z-ai/glm-5.3-flash")
      fail("idea-to-3d-model must keep one GLM 5.3 Flash writer, got " + JSON.stringify(llm.map((n) => n.fields && n.fields.model)));
    else if (image.length !== 1 || image[0].fields.model !== "meta/muse-image/text-to-image" || image[0].fields.size !== "1:1")
      fail("idea-to-3d-model concept must stay Muse T2I at 1:1, got " + JSON.stringify(image[0] && image[0].fields));
    else if (mesh.length !== 1 || mesh[0].fields.model !== "wavespeed-ai/trellis-2/image-to-3d")
      fail("idea-to-3d-model must stay TRELLIS.2, got " + JSON.stringify(mesh[0] && mesh[0].fields));
    else if (
      !mesh[0].fields.modelOpts ||
      String(mesh[0].fields.modelOpts.resolution) !== "1024" ||
      String(mesh[0].fields.modelOpts.texture_size) !== "1024" ||
      Number(mesh[0].fields.modelOpts.target_face_count) !== 80000
    )
      fail("TRELLIS.2 demo must stay 1024 geom / 1024 tex / 80k faces, got " + JSON.stringify(mesh[0].fields.modelOpts));
    else if (ids.length !== 3)
      fail("idea-to-3d-model must stay a three-paid-call graph, got " + ids.join(", "));
    else ok("idea-to-3d-model keeps GLM Flash → Muse 1:1 → TRELLIS.2 1024/80k");
  }
}

{
  const ex = example("blockout-to-shot");
  if (ex) {
    const llms = byType(ex, "llm");
    const still = byType(ex, "image");
    const look = byType(ex, "edit");
    const shot = byType(ex, "ivideo");
    if (llms.length !== 3 || llms.some((n) => n.fields.model !== "z-ai/glm-5.3-flash"))
      fail("blockout-to-shot must keep three GLM 5.3 Flash writers, got " + JSON.stringify(llms.map((n) => n.fields && n.fields.model)));
    else if (still.length !== 1 || still[0].fields.model !== "meta/muse-image/text-to-image" || still[0].fields.size !== "16:9")
      fail("blockout still must stay Muse T2I at 16:9, got " + JSON.stringify(still[0] && still[0].fields));
    else if (look.length !== 1 || look[0].fields.model !== "meta/muse-image/edit" || look[0].fields.size !== "16:9")
      fail("finished look must stay Muse Edit at 16:9, got " + JSON.stringify(look[0] && look[0].fields));
    else if (
      shot.length !== 1 ||
      shot[0].fields.model !== "bytedance-seedance-v1.5-pro" ||
      shot[0].fields.duration !== "5" ||
      shot[0].fields.resolution !== "720p" ||
      !shot[0].fields.modelOpts ||
      shot[0].fields.modelOpts.generateAudio !== false
    )
      fail("shot must stay Seedance 1.5 Pro 720p 5s silent, got " + JSON.stringify(shot[0] && shot[0].fields));
    else ok("blockout-to-shot keeps GLM Flash ×3 → Muse 16:9 → Muse Edit → Seedance 720p 5s silent");
  }
}

if (failed) {
  console.error("\n✗ check-gallery-spend-edges: " + failed + " failed");
  process.exit(1);
}
console.log("\n✓ check-gallery-spend-edges");
