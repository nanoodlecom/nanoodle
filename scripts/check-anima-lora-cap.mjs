#!/usr/bin/env node
// Anima LoRA (#548): catalog advertises lora_url_1..3 / lora_scale_1..3, but the
// generic `*-lora` → flux rule (cap 1, lora_url + lora_strength) used to win first.
// Three stacked adapters then either dropped (cap 1) or POSTed a flux/fal shape
// Anima rejects (paid 400). Pins the anima family, cap, body, picker gate, and
// the 3-row loraParams send on both engines. Offline; no network.
//
// njs-engine.js is generated from nanoodle-js and still lacks anima/h3 families.
// That lag is not pinned as a failure here (same as other sibling-lag notes).

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8").replace(
  /<!-- NJS-ENGINE:BEGIN[\s\S]*?NJS-ENGINE:END -->/,
  "",
);
const SNAP = JSON.parse(readFileSync(join(ROOT, "lora-models.json"), "utf8"));

const ANIMA_LORA = "wavespeed-ai/anima/text-to-image-lora";
const ANIMA_PLAIN = "anima/text-to-image";
const FLUX_LORA = "flux-lora";
const KREA_LORA = "wavespeed-ai/krea-v2/turbo-lora";
const HF = (name) => `https://huggingface.co/example/lora/resolve/main/${name}.safetensors`;

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

function braceMatch(src, start) {
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced braces from: " + src.slice(start, start + 40));
}
function extractFn(src, name) {
  const at = src.search(new RegExp("(async )?function " + name + "\\("));
  if (at === -1) throw new Error(name + "() not found");
  return braceMatch(src, at);
}

const HELPERS = [
  "normalizeLoraUrl", "loraFamily", "loraKind", "imageTakesLora",
  "modelTakesLora", "loraCap", "nodeLoras", "loraBodyFor", "loraParams",
];

function loadSurface(src, label) {
  const code = [
    "function catItem(){ return null; }",
    ...HELPERS.map((n) => extractFn(src, n)),
  ].join("\n");
  const ctx = { console, Math, isNaN, Number, String, RegExp };
  vm.createContext(ctx);
  try { vm.runInContext(code, ctx); }
  catch (e) { throw new Error(label + " extract failed: " + e.message); }
  return ctx;
}

const editor = loadSurface(IDX, "index.html");
const play = loadSurface(PLAY, "play.html");

function same(a, b, label) {
  const left = JSON.stringify(a), right = JSON.stringify(b);
  if (left !== right) fail(label + " drifted: editor=" + left + " play=" + right);
  else ok(label);
}

{
  for (const [label, ctx] of [["editor", editor], ["play", play]]) {
    if (ctx.loraFamily(ANIMA_LORA) !== "anima")
      fail(label + ": loraFamily(Anima LoRA) must be anima, got " + ctx.loraFamily(ANIMA_LORA));
    else ok(label + ": Anima LoRA family is anima (not flux)");
    if (ctx.loraFamily(ANIMA_PLAIN) != null)
      fail(label + ": plain anima/text-to-image must not be a LoRA family, got " + ctx.loraFamily(ANIMA_PLAIN));
    else ok(label + ": plain Anima is not a LoRA family");
    if (ctx.loraFamily(FLUX_LORA) !== "flux")
      fail(label + ": flux-lora family drifted to " + ctx.loraFamily(FLUX_LORA));
    else ok(label + ": flux-lora stays flux");
    if (ctx.loraFamily(KREA_LORA) !== "krea")
      fail(label + ": krea LoRA family drifted to " + ctx.loraFamily(KREA_LORA));
    else ok(label + ": krea LoRA stays krea");
    if (ctx.loraCap(ANIMA_LORA) !== 3)
      fail(label + ": Anima LoRA cap must be 3, got " + ctx.loraCap(ANIMA_LORA));
    else ok(label + ": Anima LoRA cap is 3");
    if (ctx.loraCap(FLUX_LORA) !== 1)
      fail(label + ": flux-lora cap must stay 1, got " + ctx.loraCap(FLUX_LORA));
    else ok(label + ": flux-lora cap stays 1");
    if (!ctx.imageTakesLora(ANIMA_LORA))
      fail(label + ": imageTakesLora must show the LoRA box on Anima LoRA");
    else ok(label + ": Anima LoRA shows the LoRA box");
    if (ctx.imageTakesLora(ANIMA_PLAIN))
      fail(label + ": imageTakesLora must hide the LoRA box on plain Anima");
    else ok(label + ": plain Anima hides the LoRA box");
  }
}

{
  const three = [
    { url: HF("one"), scale: 0.8 },
    { url: HF("two"), scale: 1.2 },
    { url: HF("three"), scale: 1 },
  ];
  const want = {
    lora_url_1: HF("one"), lora_scale_1: 0.8,
    lora_url_2: HF("two"), lora_scale_2: 1.2,
    lora_url_3: HF("three"), lora_scale_3: 1,
  };
  for (const [label, ctx] of [["editor", editor], ["play", play]]) {
    const body = ctx.loraBodyFor(ANIMA_LORA, three);
    if (JSON.stringify(body) !== JSON.stringify(want))
      fail(label + ": Anima LoRA body must be lora_url_1..3 / lora_scale_1..3, got " + JSON.stringify(body));
    else ok(label + ": Anima LoRA body is lora_url_N / lora_scale_N");
    if ("lora_url" in body || "lora_strength" in body || "loras" in body)
      fail(label + ": Anima LoRA must not emit the flux/fal shape");
    const fluxOne = ctx.loraBodyFor(FLUX_LORA, [three[0]]);
    if (fluxOne.lora_url !== three[0].url || fluxOne.lora_strength !== 0.8)
      fail(label + ": flux-lora single-slot shape drifted: " + JSON.stringify(fluxOne));
    else ok(label + ": flux-lora still sends lora_url / lora_strength");
  }
}

{
  const node = {
    type: "image",
    fields: {
      model: ANIMA_LORA,
      loras: [
        { url: HF("one"), strength: "0.8" },
        { url: HF("two"), strength: "1.2" },
        { url: HF("three"), strength: "" },
        { url: HF("four"), strength: "0.5" },
      ],
    },
  };
  const want = {
    lora_url_1: HF("one"), lora_scale_1: 0.8,
    lora_url_2: HF("two"), lora_scale_2: 1.2,
    lora_url_3: HF("three"), lora_scale_3: 1,
  };
  for (const [label, ctx] of [["editor", editor], ["play", play]]) {
    let body;
    try { body = ctx.loraParams(node); }
    catch (e) { fail(label + ": loraParams(Anima LoRA ×4) threw: " + e.message); continue; }
    if (JSON.stringify(body) !== JSON.stringify(want))
      fail(label + ": 4 stacked Anima LoRAs must send the first 3 as lora_url_1..3, got " + JSON.stringify(body));
    else ok(label + ": Anima LoRA send keeps 3 adapters and drops the fourth");
    const empty = ctx.loraParams({ type: "image", fields: { model: ANIMA_PLAIN, loras: node.fields.loras } });
    if (JSON.stringify(empty) !== "{}")
      fail(label + ": plain Anima must not send LoRA keys, got " + JSON.stringify(empty));
    else ok(label + ": plain Anima send omits LoRA keys");
  }
}

{
  same(editor.loraFamily(ANIMA_LORA), play.loraFamily(ANIMA_LORA), "family lockstep");
  same(editor.loraCap(ANIMA_LORA), play.loraCap(ANIMA_LORA), "cap lockstep");
  const items = [{ url: HF("one"), scale: 0.7 }, { url: HF("two"), scale: 1 }];
  same(editor.loraBodyFor(ANIMA_LORA, items), play.loraBodyFor(ANIMA_LORA, items), "body lockstep");
}

{
  const row = SNAP.handled.find((h) => h.id === ANIMA_LORA);
  if (!row) fail("lora-models.json is missing " + ANIMA_LORA);
  else if (row.family !== "anima") fail("lora-models.json family for Anima LoRA is " + row.family);
  else {
    const keys = new Set(row.loraKeys);
    const need = ["lora_url_1", "lora_url_2", "lora_url_3", "lora_scale_1", "lora_scale_2", "lora_scale_3"];
    if (need.some((k) => !keys.has(k)) || keys.has("lora_url") || keys.has("lora_strength"))
      fail("lora-models.json Anima keys drifted: " + row.loraKeys.join(","));
    else ok("lora-models.json snapshots Anima as anima / lora_url_1..3");
  }
}

if (failed) {
  console.error("check-anima-lora-cap: FAIL (" + failed + ")");
  process.exit(1);
}
console.log("check-anima-lora-cap: OK");
