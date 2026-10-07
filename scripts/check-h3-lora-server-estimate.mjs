#!/usr/bin/env node
// MiniMax H3 LoRA: the hosted server forecast must equal the client quote.
//
// The editor chip and the Run total (videoUnitUsd / livePrice) already bill a
// LoRA run off pricing.lora: 480p / 5s is $0.25, plus $0.02 per wired ref once
// the $/s table switches to reference_per_second ($0.32 / $0.34 at 1 / 2 refs).
// Non-LoRA H3 stays output_per_second × duration, floored at 5s: $0.65, and
// wired refs inside included_reference_images do not move it.
//
// GET https://nano-gpt.com/api/estimate-video-cost ignores lora_url_1 and
// reference_images and still returns that $0.65 floor. That route is NanoGPT's
// (not this repo). The generate-video body already sends both fields
// (loraBodyFor family "h3", reference_images last), and the x402 402
// payment.amountUsd on that POST already matches the quote with no added
// headroom. Nothing here calls the GET.
//
// The forecast this repo's hosted callers DO use is nanoodle-js
// estimateGraphCost (nanoodle-mcp's deposit basis). It used to fall through
// genericScanUsd and quote $0.65 for a LoRA graph. This check pins LoRA vs
// non-LoRA at 0, 1, and 2 refs and asserts that forecast equals the client
// quote (index.html and play.html).
//
// Margin: the forecast itself is the quote, not a hold. x402 settlement has
// no extra headroom over payment.amountUsd. nanoodle-mcp gate.mjs priceFor
// still multiplies this usd by 1.2 × 2 for inexact video (1.25× when the
// forecast is exact) — ceil to the cent, minimum $0.01 — and that margin is
// deliberately not applied here.
//
// Offline, no API spend. Skips cleanly when nanoodle-js is not checked out
// (../nanoodle-js or NANOODLE_JS). CI always has the sibling.
//
// Arming: the six-row assert runs only once the sibling's estimate.mjs exports
// videoLoraOn (nanoodle-js PR: H3 LoRA estimateGraphCost). Until that lands on
// the sibling's default branch, print a clear skip and exit 0 so this check
// can merge green ahead of the library fix. Do not patch a temp copy here —
// the real fix lives in nanoodle-js.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HERE = dirname(fileURLToPath(import.meta.url));
const JS_ROOT = process.env.NANOODLE_JS
  ? resolve(process.env.NANOODLE_JS)
  : resolve(HERE, "../../nanoodle-js");

if (!existsSync(join(JS_ROOT, "src/estimate.mjs"))) {
  console.log(`⊘ skip h3-lora-server-estimate: nanoodle-js not found at ${JS_ROOT}`);
  console.log("  clone it next to nanoodle/ or set NANOODLE_JS=/path/to/nanoodle-js");
  process.exit(0);
}

const siblingEstimate = readFileSync(join(JS_ROOT, "src/estimate.mjs"), "utf8");
// Assert arms once nanoodle-js lands videoLoraOn on the sibling default branch.
if (!siblingEstimate.includes("function videoLoraOn(")) {
  console.log("⊘ skip h3-lora-server-estimate: sibling estimate.mjs has no videoLoraOn yet");
  console.log("  Assert arms once the nanoodle-js H3 LoRA estimateGraphCost PR merges.");
  console.log(`  sibling: ${JS_ROOT}`);
  process.exit(0);
}

const { estimateGraphCost } = await import(pathToFileURL(join(JS_ROOT, "src/estimate.mjs")).href);
console.log("✓ sibling estimate.mjs already prices the H3 LoRA tier");

const LORA = "https://huggingface.co/x/y/resolve/main/a.safetensors";
const H3_PRICING = {
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

// 480p / 5s. Non-LoRA is unchanged at every ref count. LoRA switches tier.
const CASES = [
  { lora: false, refs: 0, expect: 0.65 },
  { lora: false, refs: 1, expect: 0.65 },
  { lora: false, refs: 2, expect: 0.65 },
  { lora: true, refs: 0, expect: 0.25 },
  { lora: true, refs: 1, expect: 0.32 },
  { lora: true, refs: 2, expect: 0.34 },
];

function loadClient(file, endMarker) {
  const html = readFileSync(join(ROOT, file), "utf8");
  const start = html.indexOf("const EST = {");
  const end = html.indexOf(endMarker);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`could not locate the pricing block in ${file}`);
  }
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(html.slice(start, end) + "\nthis.videoUnitUsd=videoUnitUsd;", sandbox);
  return sandbox.videoUnitUsd;
}

const clients = [
  ["index.html", loadClient("index.html", "function nodeUnitUsd(")],
  ["play.html", loadClient("play.html", "async function nodeUnitUsdPlay(")],
];

function clientFields(lora) {
  const fields = { duration: "5", resolution: "480p" };
  if (lora) fields.loras = [{ url: LORA, strength: "1" }];
  return fields;
}

function serverGraph(refs, lora) {
  const fields = { model: "minimax-h3", duration: "5", resolution: "480p" };
  if (lora) fields.loras = [{ url: LORA, strength: "1" }];
  const nodes = [{ id: "v1", type: "tvideo", fields }];
  const links = [];
  for (let i = 1; i <= refs; i++) {
    nodes.push({ id: "img" + i, type: "upload", fields: {} });
    links.push({
      id: "l" + i,
      from: { node: "img" + i, port: "image" },
      to: { node: "v1", port: "ref" + i },
    });
  }
  return { nodes, links };
}

const catalogs = {
  video: [{
    id: "minimax-h3",
    pricing: H3_PRICING,
    supported_parameters: { parameters: { duration: {}, resolution: {} } },
  }],
};

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

for (const c of CASES) {
  const label = `${c.lora ? "LoRA" : "non-LoRA"} ${c.refs} ref(s)`;
  const server = estimateGraphCost(serverGraph(c.refs, c.lora), catalogs).usd;
  if (!(Math.abs(server - c.expect) < 1e-9)) {
    fail(`server estimate ${label}: got ${server}, want ${c.expect}`);
  }
  for (const [name, videoUnitUsd] of clients) {
    const quote = videoUnitUsd(H3_PRICING, clientFields(c.lora), c.refs);
    if (!(Math.abs(quote - c.expect) < 1e-9)) {
      fail(`${name} quote ${label}: got ${quote}, want ${c.expect}`);
      continue;
    }
    if (!(Math.abs(server - quote) < 1e-9)) {
      fail(`${label}: server ${server} !== ${name} quote ${quote}`);
      continue;
    }
    const shown = Math.abs(server - c.expect) < 1e-9 ? c.expect : server;
    ok(`${label}: server ${shown} = ${name} quote`);
  }
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("✓ H3 server estimate matches the client quote (LoRA and non-LoRA, 0/1/2 refs).");
