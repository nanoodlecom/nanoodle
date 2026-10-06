#!/usr/bin/env node
// Leftover titleIntent / classifyCard edges after #679.
// That PR shipped the HeyGen + Video Music Remover fixture through the
// full changelog pipeline (not Retired; "New video models: HeyGen Video 1").
// This file pins the leftover noun/verb contract the fixture never hit:
// a product noun "Remover" is a launch, the verb forms still retire,
// "Remover Retired" still retires, body text that says "removes" cannot
// flip a Remover launch, and an isolated Remover card is still New video.
// Offline, zero API spend. New file so it does not collide with
// check-sync-nanogpt-model-updates.
import { classifyCard, titleIntent } from "./lib/nanogpt-updates.mjs";

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

{
  const nouns = [
    "HeyGen Video 1 and Video Music Remover",
    "Video Music Remover",
    "Background Remover",
    "VIDEO MUSIC REMOVER",
  ];
  let bad = 0;
  for (const t of nouns) {
    const intent = titleIntent(t);
    if (intent !== "new") {
      fail("Remover noun must stay new, got " + intent + " for " + JSON.stringify(t));
      bad++;
    }
  }
  if (!bad) ok("product noun Remover is a launch, not a retirement");
}

{
  const verbs = [
    ["Remove unused models", "retired"],
    ["Models removed", "retired"],
    ["Background removal", "retired"],
    ["Removing GPT-4o Image", "retired"],
    ["NanoGPT removes CrofAI", "retired"],
    ["Legacy GPT-4o Image Retired", "retired"],
    ["Video Music Remover Retired", "retired"],
  ];
  let bad = 0;
  for (const [t, want] of verbs) {
    const intent = titleIntent(t);
    if (intent !== want) {
      fail(JSON.stringify(t) + " → " + intent + " (want " + want + ")");
      bad++;
    }
  }
  if (!bad) ok("verb forms and Remover+Retired still classify as retired");
}

{
  if (titleIntent("") !== "new" || titleIntent(null) !== "new")
    fail("empty/null title must stay new, not retired");
  else ok("empty/null title stays new");
}

{
  const info = classifyCard({
    id: "remover-only",
    title: "Video Music Remover",
    text: "[Video Music Remover](https://nano-gpt.com/media?mode=video&model=video-music-remover) removes background music from existing footage.",
    date: "2026-10-01",
    category: "models",
  });
  if (info.intent !== "new")
    fail("isolated Remover launch intent must be new, got " + info.intent);
  else if (info.kind !== "video" || info.skip)
    fail("isolated Remover launch must be New video, got kind=" + info.kind + " skip=" + info.skip);
  else if (info.models.length !== 1 || info.models[0].slug !== "video-music-remover")
    fail("isolated Remover launch must keep its model link, got " + JSON.stringify(info.models));
  else ok("isolated Remover launch is New video even when the body says removes");
}

if (failed) {
  console.error("\n✗ check-title-intent-edges: " + failed + " failed");
  process.exit(1);
}
console.log("\n✓ check-title-intent-edges");
