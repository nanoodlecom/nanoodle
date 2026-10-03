#!/usr/bin/env node
// Leftover Product · 49 run-fail collect edges after #666 / #667.
// Those pins cover parse aliases (3D / edit instruction / needs N),
// empty/null parse, no-meta synth, filled meta no-invent, and
// auth/4xx/video/audio quiet. This file pins the remaining
// collectMissingInputCandidates contract: omitted wired/empty flags
// infer occupancy from graphSnapshot.links (wrong-port links stay
// unwired), unknown empty is treated as empty, and a wired-but-empty
// inferred port still pulses. Offline, zero API spend. New file so
// it does not collide with open leftover PRs.
import {
  collectMissingInputCandidates,
  pickRunFailPort,
} from "../vendor/next-action/run-fail-port.mjs";

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

const err = "no image — wire an image into the image port";

{
  const cands = collectMissingInputCandidates({
    nodeId: "r1",
    errorMessage: err,
    inputsMeta: [{ name: "image", type: "image" }],
    graphSnapshot: { links: [{ to: { node: "r1", port: "image" } }] },
  });
  if (cands.length !== 1 || cands[0].name !== "image" || cands[0].wired !== true || cands[0].empty !== true)
    fail(`omitted flags + matching link must infer wired-but-empty, got ${JSON.stringify(cands)}`);
  else ok("omitted wired/empty + matching link infers wired-but-empty");
}

{
  const cands = collectMissingInputCandidates({
    nodeId: "r1",
    errorMessage: err,
    inputsMeta: [{ name: "image", type: "image" }],
    graphSnapshot: { links: [{ to: { node: "r1", port: "other" } }] },
  });
  if (cands.length !== 1 || cands[0].wired !== false || cands[0].empty !== true)
    fail(`a wrong-port link must stay unwired, got ${JSON.stringify(cands)}`);
  else ok("wrong-port link does not mark the named input wired");
}

{
  const cands = collectMissingInputCandidates({
    nodeId: "r1",
    errorMessage: err,
    inputsMeta: [{ name: "image", type: "image", wired: true, empty: null }],
  });
  if (cands.length !== 1 || cands[0].empty !== true || !(cands[0].errScore > 0))
    fail(`empty:null on a wired port must still be a candidate, got ${JSON.stringify(cands)}`);
  else ok("wired + empty:null is still treated as missing");
}

{
  const pick = pickRunFailPort(null, {
    nodeId: "r1",
    nodeType: "resize",
    errorMessage: err,
    inputsMeta: [{ name: "image", type: "image" }],
    graphSnapshot: { links: [{ to: { node: "r1", port: "image" } }] },
  });
  if (!pick || pick.port !== "image" || pick.count !== 0)
    fail(`inferred wired-but-empty must still pick without tables, got ${JSON.stringify(pick)}`);
  else ok("inferred wired-but-empty still picks the named port (no tables)");
}

if (failed) {
  console.error(`\n${failed} leftover run-fail link pin(s) failed`);
  process.exit(1);
}
console.log("✓ run-fail link leftover pins");
