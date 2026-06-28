#!/usr/bin/env node
// Audit NanoGPT's live catalog for LoRA-capable image/video models and check each
// against the loraFamily() classifier the app actually ships (extracted from play.html,
// the single source of truth). Flags any LoRA-capable model the app does NOT handle yet
// — i.e. a new family/shape a human must wire up — and snapshots the set to
// lora-models.json so the in-repo list refreshes.
//
// Build/audit-time ONLY. The app never fetches this at runtime (the classifier is inlined
// in index.html + play.html and bundled into exported apps). Run by hand or monthly via a
// scheduled agent:  node scripts/check-lora-models.mjs
//
// Exit 0 = every LoRA-capable catalog model is handled. Exit 1 = new unhandled model(s)
// found (the scheduled job treats this as "open a PR to add a family rule").
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_URL = "https://nano-gpt.com/api/models";

// Pull a function verbatim out of play.html so this audit can never drift from the app.
// Both loraFamily() (shape mapping) and imageTakesLora() (the IMAGE gate — the v1 image
// catalog hides lora params, so the app allow-lists by id and we verify that allow-list here).
const PLAY_SRC = readFileSync(join(root, "play.html"), "utf8");
function loadFn(name) {
  const start = PLAY_SRC.indexOf("function " + name);
  if (start < 0) throw new Error(name + "() not found in play.html");
  const end = PLAY_SRC.indexOf("\n  }", start) + 4;
  return new Function(PLAY_SRC.slice(start, end) + "\nreturn " + name + ";")();
}

// Deliberately NOT supported (their LoRA mechanism differs from the lora_url/_N shapes the
// app sends). Listed so the monthly audit only alerts on GENUINELY new models. Revisit if
// the app grows these shapes.
const KNOWN_SKIP = {
  "clarity-ai-flux-upscaler": "single lora_link on an upscaler — niche, not a generate/edit/video node",
  "wavespeed-ai/ltx-2.3-spicy/image-to-video-lora": "uses a 'loras' JSON strength-override, not lora_url",
};

// A catalog model is LoRA-capable if any of its param descriptors carries a lora key.
const LORA_KEY = /lora/i;
function loraKeys(model) {
  const keys = new Set();
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (LORA_KEY.test(k)) keys.add(k);
      walk(v);
    }
  };
  walk(model.additionalParams);
  walk(model.supported_parameters);
  return [...keys];
}

const main = async () => {
  let catalog;
  try {
    const r = await fetch(CATALOG_URL, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    catalog = await r.json();
  } catch (e) {
    // Never fail the build on a NanoGPT outage — the committed app keeps working.
    console.error("check-lora-models: catalog fetch failed (" + e.message + ") — skipping audit");
    process.exit(0);
  }

  const loraFamily = loadFn("loraFamily");
  const imageTakesLora = loadFn("imageTakesLora");
  const handled = [], unhandled = [], skipped = [];
  // IMAGE gate drift: the app shows the LoRA box on an image model iff imageTakesLora(id) is
  // true (the v1 catalog can't tell it). Compare against real capability so a false positive
  // (box on a non-lora model → silently ignored adapter) or false negative can't ship.
  const gateFalsePos = [], gateFalseNeg = [];
  for (const kind of ["image", "video"]) {
    const models = (catalog.models && catalog.models[kind]) || {};
    for (const [id, m] of Object.entries(models)) {
      const keys = loraKeys(m);
      const capable = keys.length > 0 && !KNOWN_SKIP[id];   // truly takes a lora_url/_N we can send
      if (kind === "image") {
        const shows = imageTakesLora(id);
        if (shows && !capable) gateFalsePos.push({ id, loraKeys: keys.sort() });
        if (!shows && capable) gateFalseNeg.push({ id, loraKeys: keys.sort() });
      }
      if (!keys.length) continue;                     // not a LoRA model
      if (KNOWN_SKIP[id]) { skipped.push({ id, kind, why: KNOWN_SKIP[id] }); continue; }
      const fam = loraFamily(id);
      (fam ? handled : unhandled).push({ id, kind, family: fam, loraKeys: keys.sort() });
    }
  }
  handled.sort((a, b) => a.id.localeCompare(b.id));
  unhandled.sort((a, b) => a.id.localeCompare(b.id));

  skipped.sort((a, b) => a.id.localeCompare(b.id));
  const snapshot = { generated: new Date().toISOString().slice(0, 10), handled, skipped, unhandled };
  writeFileSync(join(root, "lora-models.json"), JSON.stringify(snapshot, null, 2) + "\n");

  console.log(`LoRA-capable catalog models: ${handled.length} handled, ${skipped.length} known-skipped, ${unhandled.length} new/unhandled.`);
  let fail = false;
  if (unhandled.length) {
    fail = true;
    console.log("\nNEW / UNHANDLED LoRA models — wire a family rule in loraFamily() (both index.html + play.html):");
    for (const u of unhandled) console.log(`  • [${u.kind}] ${u.id}  keys=${u.loraKeys.join(",")}`);
    console.log("\nThen extend loraCap/loraBodyFor for its shape, and (optionally) add a verified LORA_EXAMPLES entry.");
  }
  if (gateFalsePos.length) {
    fail = true;
    console.log("\nIMAGE GATE FALSE POSITIVES — imageTakesLora() shows the LoRA box but these take NO lora_url (adapter silently ignored). Tighten imageTakesLora() in index.html + play.html:");
    for (const g of gateFalsePos) console.log(`  • ${g.id}  catalogLoraKeys=[${g.loraKeys.join(",")}]`);
  }
  if (gateFalseNeg.length) {
    fail = true;
    console.log("\nIMAGE GATE FALSE NEGATIVES — these take a LoRA but imageTakesLora() hides the box. Widen imageTakesLora() in index.html + play.html:");
    for (const g of gateFalseNeg) console.log(`  • ${g.id}  catalogLoraKeys=[${g.loraKeys.join(",")}]`);
  }
  if (fail) process.exit(1);
  console.log("✓ every LoRA-capable model is handled and the image gate matches the catalog. Snapshot → lora-models.json");
};
main();
