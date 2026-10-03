#!/usr/bin/env node
// Leftover Product · 49 run-fail-port edges after #666.
// That PR shipped happy-path Resize/Image/LLM/iVideo picks, tied join
// quiet, editor keep-until-corrected, and network/abort/cycle skips.
// This file pins the other half: 3D / edit-instruction / multi-image
// parse, no-meta synthesize, inMass skipping junk rows, numbered-slot
// / lyrics aliases, and auth / 4xx / video-failed classification.
// Offline, zero API spend. New file so it does not collide with open leftover PRs.
import {
  inMass,
  parseMissingInputError,
  isMissingInputFailure,
  scoreInputAgainstError,
  collectMissingInputCandidates,
  pickRunFailPort,
} from "../vendor/next-action/run-fail-port.mjs";

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

{
  const p = parseMissingInputError("no 3d file — wire the model port");
  if (!p.modalities.includes("model") || !p.ports.includes("model"))
    fail(`3d parse → ${JSON.stringify(p)}`);
  else ok("parseMissingInputError maps 'no 3d file' to model");
}

{
  const p = parseMissingInputError("no edit instruction — type what to change");
  if (!p.modalities.includes("prompt") || !p.ports.includes("prompt"))
    fail(`edit-instruction parse → ${JSON.stringify(p)}`);
  else ok("parseMissingInputError maps 'no edit instruction' to prompt");
}

{
  const p = parseMissingInputError("this model needs 4 images (face, garment) — wire all of them");
  if (!p.modalities.includes("image") || !p.ports.includes("image"))
    fail(`needs-N-images parse → ${JSON.stringify(p)}`);
  else ok("parseMissingInputError maps 'needs N images' to image");
}

{
  const empty = parseMissingInputError("");
  const none = parseMissingInputError(null);
  if (empty.ports.length || empty.modalities.length || none.ports.length)
    fail(`empty/null parse leaked: ${JSON.stringify({ empty, none })}`);
  else ok("parseMissingInputError empty/null is quiet");
}

{
  const junk = { topTargets: { a: "not-object", b: null, c: { "resize|image": 3, "edit|image": "x" } } };
  if (inMass(junk, "resize", "image") !== 3)
    fail(`inMass must skip non-object rows, got ${inMass(junk, "resize", "image")}`);
  else if (inMass(junk, "", "image") !== 0 || inMass(null, "resize", "image") !== 0)
    fail("inMass missing type/tables is 0");
  else ok("inMass skips non-object rows and missing args");
}

{
  const parsed = parseMissingInputError("no image — wire an image into the image port");
  const s2 = scoreInputAgainstError({ name: "image2", type: "image", wired: false, empty: true }, parsed);
  const sRef = scoreInputAgainstError({ name: "ref1", type: "image", wired: false, empty: true }, parsed);
  if (!(s2 >= 60) || !(sRef >= 60) || s2 === 0)
    fail(`numbered image slots must score, image2=${s2} ref1=${sRef}`);
  else ok("scoreInputAgainstError matches image2 / ref1 aliases");
}

{
  const parsed = parseMissingInputError("no prompt — type lyrics for the track");
  const s = scoreInputAgainstError({ name: "lyrics", type: "text", wired: false, empty: true, field: true }, parsed);
  if (!(s >= 70))
    fail(`lyrics alias against a prompt error → ${s}`);
  else ok("scoreInputAgainstError matches lyrics as a prompt stand-in");
}

{
  const cands = collectMissingInputCandidates({
    errorMessage: "no image — wire an image into the image port",
  });
  if (cands.length !== 1 || cands[0].name !== "image" || cands[0].errScore < 100)
    fail(`no-meta synthesize → ${JSON.stringify(cands)}`);
  else ok("collectMissingInputCandidates synthesizes a named port when meta is omitted");
}

{
  const filled = collectMissingInputCandidates({
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [{ name: "image", type: "image", wired: true, empty: false }],
  });
  if (filled.length)
    fail(`satisfied meta must not invent a candidate, got ${JSON.stringify(filled)}`);
  else ok("collect does not invent a port when provided meta is already filled");
}

{
  if (isMissingInputFailure("")) fail("empty message is not a missing-input failure");
  else if (isMissingInputFailure("API key missing — paste one in Settings"))
    fail("API key errors must not pulse a port");
  else if (isMissingInputFailure("401 model not found"))
    fail("4xx model errors must not pulse a port");
  else if (isMissingInputFailure("video failed: poll timed out"))
    fail("video failed: is a run error, not a missing input");
  else if (isMissingInputFailure("audio failed: provider 500"))
    fail("audio failed: is a run error, not a missing input");
  else ok("isMissingInputFailure stays quiet for auth / 4xx / media-failed");
}

{
  const pick = pickRunFailPort(null, {
    nodeId: "m1",
    nodeType: "model3d",
    errorMessage: "no 3d file — wire the model port",
    inputsMeta: [{ name: "model", type: "model3d", wired: false, empty: true }],
  });
  if (!pick || pick.port !== "model")
    fail(`3d missing file must pick model, got ${JSON.stringify(pick)}`);
  else ok("pickRunFailPort marks the 3D model port");
}

{
  const pick = pickRunFailPort(null, {
    nodeId: "e1",
    nodeType: "edit",
    errorMessage: "no edit instruction — type what to change",
    inputsMeta: [
      { name: "image", type: "image", wired: true, empty: false },
      { name: "prompt", type: "text", wired: false, empty: true, field: true },
    ],
  });
  if (!pick || pick.port !== "prompt")
    fail(`edit-instruction miss must pick prompt, got ${JSON.stringify(pick)}`);
  else ok("pickRunFailPort marks the edit prompt, not the filled image");
}

if (failed) {
  console.error(`\n${failed} leftover #666 run-fail-port pin(s) failed`);
  process.exit(1);
}
console.log("✓ run-fail-port leftover pins");
