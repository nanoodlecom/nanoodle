#!/usr/bin/env node
// Leftover Product · 21 ring-highlight edges after #638.
// That PR shipped happy-path Text-out likely=Image / fit=LLM, flat/weak
// quiet, and cancel/Escape restoring a picked-up wire. This file pins the
// other half: inbound-drag ranking, self-origin skip, missing src quiet,
// maxFit=0 (likely only), and FIT_SHARE dropping a weak runner-up.
// Offline, zero API spend. New file so it does not collide with open leftover PRs.
import {
  rankRingTargets,
  tierFor,
  shouldDim,
  classesForTier,
  MAX_FIT,
  FIT_SHARE,
} from "../vendor/next-action/port-highlight.mjs";

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

{
  const tables = {
    topTargets: {
      "text|text": { "image|prompt": 20 },
      "llm|text": { "image|prompt": 4 },
      "join|text": { "image|prompt": 2 },
    },
  };
  const plan = rankRingTargets(tables, {
    dir: "in",
    srcType: "image",
    srcPort: "prompt",
    srcNodeId: "img1",
    targets: [
      { nodeId: "t1", type: "text", port: "text" },
      { nodeId: "llm1", type: "llm", port: "text" },
      { nodeId: "j1", type: "join", port: "text" },
    ],
  });
  if (!plan || plan.items[0]?.tier !== "likely" || plan.items[0].type !== "text")
    fail(`dir=in likely should be text, got ${JSON.stringify(plan?.items)}`);
  else if (tierFor(plan, "t1", "text") !== "likely")
    fail("tierFor must report likely on the inbound text producer");
  else if (shouldDim(plan, "t1", "text"))
    fail("likely inbound target must not dim");
  else ok("dir=in ranks the strongest producer as likely");
}

{
  const tables = {
    topTargets: { "text|text": { "image|prompt": 12, "llm|prompt": 8 } },
  };
  const plan = rankRingTargets(tables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    srcNodeId: "t1",
    targets: [
      { nodeId: "t1", type: "image", port: "prompt" },
      { nodeId: "img1", type: "image", port: "prompt" },
      { nodeId: "llm1", type: "llm", port: "prompt" },
    ],
  });
  if (!plan || plan.items.some((i) => i.nodeId === "t1"))
    fail(`srcNodeId must skip self, got ${JSON.stringify(plan?.items)}`);
  else if (plan.items[0].nodeId !== "img1")
    fail(`self-skip should leave image likely, got ${JSON.stringify(plan.items)}`);
  else ok("srcNodeId skips the origin card even if its type would win");
}

{
  const tables = { topTargets: { "text|text": { "image|prompt": 12 } } };
  const missingType = rankRingTargets(tables, {
    dir: "out",
    srcPort: "text",
    targets: [{ nodeId: "img1", type: "image", port: "prompt" }],
  });
  const missingPort = rankRingTargets(tables, {
    dir: "out",
    srcType: "text",
    targets: [{ nodeId: "img1", type: "image", port: "prompt" }],
  });
  if (missingType !== null || missingPort !== null)
    fail("missing srcType/srcPort must stay quiet");
  else ok("missing srcType/srcPort stay quiet");
}

{
  const tables = {
    topTargets: { "text|text": { "image|prompt": 20, "llm|prompt": 8, "join|b": 6 } },
  };
  const plan = rankRingTargets(tables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    maxFit: 0,
    targets: [
      { nodeId: "img1", type: "image", port: "prompt" },
      { nodeId: "llm1", type: "llm", port: "prompt" },
      { nodeId: "j1", type: "join", port: "b" },
    ],
  });
  if (!plan || plan.items.length !== 1 || plan.items[0].tier !== "likely")
    fail(`maxFit=0 must keep only likely, got ${JSON.stringify(plan?.items)}`);
  else ok("maxFit=0 keeps the likely ring and drops runners");
}

{
  const tables = {
    topTargets: { "text|text": { "image|prompt": 20, "llm|prompt": 2 } },
  };
  const plan = rankRingTargets(tables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    targets: [
      { nodeId: "img1", type: "image", port: "prompt" },
      { nodeId: "llm1", type: "llm", port: "prompt" },
    ],
  });
  const llmShare = 2 / 22;
  if (!(llmShare < FIT_SHARE))
    fail(`fixture llm share ${llmShare} should be below FIT_SHARE=${FIT_SHARE}`);
  else if (plan?.items.some((i) => i.type === "llm"))
    fail(`weak runner below FIT_SHARE must not be a fit, got ${JSON.stringify(plan?.items)}`);
  else if (!plan || plan.items.length !== 1 || plan.items[0].type !== "image")
    fail(`only image should remain likely, got ${JSON.stringify(plan?.items)}`);
  else ok("FIT_SHARE drops a weak runner-up");
}

{
  if (shouldDim(null, "x", "y") !== false)
    fail("shouldDim(null) must be false");
  else if (classesForTier("nope").length !== 0 || classesForTier(undefined).length !== 0)
    fail("classesForTier unknown is []");
  else if (MAX_FIT < 1)
    fail("MAX_FIT must stay positive");
  else ok("null plan / unknown tier stay inert");
}

if (failed) {
  console.error(`\n${failed} leftover #638 port-highlight pin(s) failed`);
  process.exit(1);
}
console.log("✓ port-highlight leftover pins");
