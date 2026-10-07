#!/usr/bin/env node
// Leftover MiniMax H3 LoRA+reference surcharge edges after #686 / #694 / #696.
// Those PRs shipped the happy-path quote (LoRA 5s 480p $0.25, +1/+2/+3 refs
// $0.32/$0.34/$0.36, 1080p+1 $1.37), the chip text, picker-without-n, and
// the server estimate lockstep. This file pins the leftover GATE those
// fixtures never hit: without a LoRA URL the $0.02
// lora.reference_image_or_audio surcharge must not apply (included_reference_images
// already cover ordinary refs), a blank/whitespace LoRA row is not a LoRA,
// a missing surcharge key does not invent $0.02, boolean refWired still
// counts as 1 once a LoRA is on, and negative/NaN ref counts add nothing.
// Both engines. Offline, zero API spend. New file so it does not collide
// with check-h3-lora-ref-chip / check-pricing / check-h3-lora-server-estimate.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDX = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const PLAY = fs.readFileSync(path.join(ROOT, "play.html"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);
const close = (a, b) => a != null && isFinite(a) && Math.abs(a - b) < 1e-9;

function loadResolver(src, end) {
  const s = src.indexOf("const EST = {"), e = src.indexOf(end);
  if (s < 0 || e < 0) throw new Error("pricing block not found");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.slice(s, e) + "\nthis.videoUnitUsd=videoUnitUsd; this.videoLoraOn=videoLoraOn;", ctx);
  return ctx;
}

const LORA = "https://huggingface.co/x/y/resolve/main/a.safetensors";
const H3 = {
  currency: "USD",
  output_per_second: 0.13,
  reference_video_input_per_second: 0.13,
  extra_reference_image: 0.04,
  included_reference_images: 5,
  default_duration: 5,
  min_duration: 5,
  max_duration: 15,
  supported_durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  lora: {
    text_or_image_per_second: { "480p": 0.05, "540p": 0.075, "768p": 0.1, "1080p": 0.2 },
    reference_per_second: { "480p": 0.06, "540p": 0.09, "768p": 0.135, "1080p": 0.27 },
    reference_image_or_audio: 0.02,
    min_duration: 3,
    max_duration: 15,
  },
};
const ENGINES = [
  ["editor", IDX, "function nodeUnitUsd("],
  ["play", PLAY, "async function nodeUnitUsdPlay("],
];

for (const [name, src, end] of ENGINES) {
  const R = loadResolver(src, end);

  const noLora = [
    [{ duration: "5", resolution: "480p" }, 1, 0.65, "no LoRA + 1 ref stays the 2K floor"],
    [{ duration: "5", resolution: "480p" }, 2, 0.65, "no LoRA + 2 refs stays the 2K floor"],
    [{ duration: "5", resolution: "480p" }, true, 0.65, "no LoRA + boolean refWired stays the 2K floor"],
    [{ duration: "5", resolution: "480p", loras: [] }, 1, 0.65, "empty loras + 1 ref stays the 2K floor"],
    [{ duration: "5", resolution: "768p", loras: [{ url: "", strength: "" }] }, 1, 0.65, "blank LoRA row + 1 ref is not a LoRA"],
    [{ duration: "5", resolution: "768p", loras: [{ url: "   " }] }, 1, 0.65, "whitespace LoRA URL + 1 ref is not a LoRA"],
  ];
  let bad = 0;
  for (const [fields, refs, want, label] of noLora) {
    const got = R.videoUnitUsd(H3, fields, refs);
    if (!close(got, want)) {
      fail(`${name}: ${label} quoted ${got}, want ${want}`);
      bad++;
    }
  }
  if (!bad) ok(`${name}: no-LoRA / blank-LoRA refs never add the $0.02 surcharge`);

  const loraFields = { duration: "5", resolution: "480p", loras: [{ url: LORA, strength: "1" }] };
  const loraCases = [
    [true, 0.32, "boolean refWired counts as 1 once a LoRA is on"],
    [-3, 0.25, "negative ref count adds no surcharge"],
    [NaN, 0.25, "NaN ref count adds no surcharge"],
    [0, 0.25, "zero refs stay on the LoRA text table"],
  ];
  bad = 0;
  for (const [refs, want, label] of loraCases) {
    const got = R.videoUnitUsd(H3, loraFields, refs);
    if (!close(got, want)) {
      fail(`${name}: ${label} quoted ${got}, want ${want}`);
      bad++;
    }
  }
  if (!bad) ok(`${name}: LoRA refCount coerce (boolean=1, negative/NaN=0)`);

  const noSurcharge = JSON.parse(JSON.stringify(H3));
  delete noSurcharge.lora.reference_image_or_audio;
  {
    const got = R.videoUnitUsd(noSurcharge, loraFields, 2);
    // reference_per_second 0.06 × 5 = $0.30; missing key must not invent $0.02 × 2.
    if (!close(got, 0.3)) fail(`${name}: missing reference_image_or_audio invented a surcharge (got ${got})`);
    else ok(`${name}: missing reference_image_or_audio does not invent $0.02`);
  }

  if (R.videoLoraOn(null) !== false || R.videoLoraOn(undefined) !== false || R.videoLoraOn({}) !== false)
    fail(`${name}: videoLoraOn(null/empty) must be false`);
  else if (R.videoLoraOn({ loras: "https://x" }) !== false)
    fail(`${name}: videoLoraOn must ignore a non-array loras field`);
  else ok(`${name}: videoLoraOn stays false for null / empty / non-array loras`);
}

if (failed) {
  console.error(`\n✗ check-h3-lora-ref-edges: ${failed} failure(s)`);
  process.exit(1);
}
console.log("✓ check-h3-lora-ref-edges: no-LoRA refs stay on the 2K floor; blank/missing surcharge keys do not invent $0.02.");
