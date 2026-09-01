#!/usr/bin/env node
// LoRA paid-call gates copied across index.html, play.html RUNTIME, and vendor/njs-engine.js.
// Twin-drift only proves the source lines exist; check-lora-models.mjs is a live catalog audit
// (network, not pre-commit). Nothing drove the BEHAVIOR:
//
//   • normalizeLoraUrl — CivitAI / bare HF repo / HF file-page URLs must THROW before any
//     /images/generations POST (NanoGPT pulls the URL server-side; a signed CivitAI link is a
//     charged 422). HF /blob/ must rewrite to /resolve/ so the server gets the raw file.
//   • loraFamily / loraCap / imageTakesLora — ordered classifier (klein before flux-2, spicy
//     excluded). A one-sided family edit ships the wrong param shape (lora_url vs lora_url_N
//     vs lora_weights) or the old krea cap of 1 (stacks 2–3 silently dropped).
//   • loraParams — civitai URL on a real image.run must not POST; a good HF blob URL must
//     land rewritten on the body.
//
// Offline: extract the shipped helpers into node:vm; drive play runGraph via play-engine.mjs.
// No browser, no API spend.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadEngine, calls, catalog } from "./play-engine.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");
const VENDOR = join(ROOT, "vendor", "njs-engine.js");
const NJS = existsSync(VENDOR) ? readFileSync(VENDOR, "utf8") : "";

let fail = 0;
const ok = (c, m) => {
  if (!c) { fail++; console.log("  ✗ " + m); }
  else console.log("  ✓ " + m);
};

function extractAllFns(src, name) {
  const out = [];
  const needle = "function " + name + "(";
  let from = 0;
  while (from < src.length) {
    const start = src.indexOf(needle, from);
    if (start === -1) break;
    let depth = 0;
    for (let j = src.indexOf("{", start); j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}" && --depth === 0) {
        out.push(src.slice(start, j + 1));
        from = j + 1;
        break;
      }
    }
  }
  return out;
}

const LORA_FNS = [
  "normalizeLoraUrl", "loraFamily", "loraKind", "imageTakesLora",
  "modelTakesLora", "loraCap", "nodeLoras", "loraBodyFor", "loraParams",
];

function loadLora(label, src, which) {
  const ctx = {
    NanoodleError: class NanoodleError extends Error {},
    catItem: () => null,   // editor modelTakesLora: catalog-miss → imageTakesLora / video-true
  };
  vm.createContext(ctx);
  const parts = [];
  for (const name of LORA_FNS) {
    const fns = extractAllFns(src, name);
    if (!fns.length) throw new Error(label + ": " + name + "() not found");
    parts.push(which === "first" ? fns[0] : fns[fns.length - 1]);
  }
  vm.runInContext(parts.join("\n"), ctx, { filename: label + "#lora" });
  return ctx;
}

const SURFACES = [
  { label: "index.html", ctx: loadLora("index.html", IDX, "last") },
  { label: "play.html RUNTIME", ctx: loadLora("play.html", PLAY, "last") },
];
if (NJS) SURFACES.push({ label: "vendor/njs-engine.js", ctx: loadLora("njs-engine.js", NJS, "last") });

ok(extractAllFns(PLAY, "normalizeLoraUrl").length >= 2,
  "play.html carries normalizeLoraUrl in both the njs bundle and RUNTIME");
ok(!!NJS, "vendor/njs-engine.js is present");

// ---- A. normalizeLoraUrl: refuse before the paid pull -------------------------
console.log("• normalizeLoraUrl");
const HF_BLOB = "https://huggingface.co/user/style/blob/main/ghibsky.safetensors";
const HF_RESOLVE = "https://huggingface.co/user/style/resolve/main/ghibsky.safetensors";
const HF_RESOLVE_QS = HF_RESOLVE + "?download=true";
const DIRECT = "https://cdn.example.com/adapters/style.safetensors";

function threw(fn, re) {
  try { fn(); return null; }
  catch (e) { return re.test(String(e && e.message || e)) ? String(e.message) : "OTHER:" + e; }
}

for (const { label, ctx } of SURFACES) {
  const n = ctx.normalizeLoraUrl;
  ok(n("") === "" && n("   ") === "", `${label}: empty / whitespace → ""`);
  ok(n(HF_BLOB) === HF_RESOLVE, `${label}: HF /blob/ rewrites to /resolve/`);
  ok(n(HF_RESOLVE) === HF_RESOLVE, `${label}: HF /resolve/ .safetensors kept`);
  ok(n(HF_RESOLVE_QS) === HF_RESOLVE_QS, `${label}: HF /resolve/ with query kept`);
  ok(n(DIRECT) === DIRECT, `${label}: direct https .safetensors kept`);
  ok(n("http://127.0.0.1/x.safetensors") === "http://127.0.0.1/x.safetensors",
    `${label}: non-HF http(s) host is forwarded (NanoGPT pulls it)`);

  ok(threw(() => n("https://civitai.com/models/123"), /CivitAI/),
    `${label}: civitai.com throws before send`);
  ok(threw(() => n("https://civitai.red/models/1"), /CivitAI/),
    `${label}: civitai.red throws`);
  ok(threw(() => n("https://civit.ai/models/1"), /CivitAI/),
    `${label}: civit.ai throws`);
  ok(threw(() => n("https://huggingface.co/user/style"), /safetensors/),
    `${label}: HF repo page (no .safetensors) throws`);
  ok(threw(() => n("https://huggingface.co/user/style/blob/main/README.md"), /safetensors/),
    `${label}: HF /blob/ of a non-weight file throws after rewrite`);
  ok(threw(() => n("user/cool-lora"), /repo id|HuggingFace repo/i),
    `${label}: bare HF repo id throws`);
  ok(threw(() => n("not-a-url"), /direct https URL/i),
    `${label}: non-URL string throws`);
}

// ---- B. family / cap / image gate (ordered classifier) -----------------------
console.log("• loraFamily / loraCap / imageTakesLora");
const FAMILY = [
  { id: "flux-2-klein-9b", family: "flux2klein", cap: 3 },          // klein BEFORE flux-2
  { id: "flux-2-klein-4b", family: "flux2klein", cap: 3 },
  { id: "flux-2-dev-lora", family: "flux2dev", cap: 4 },
  { id: "flux-2-dev-lora-image-to-image", family: "flux2dev", cap: 4 },
  { id: "z-image-turbo-lora", family: "zimage", cap: 3 },
  { id: "ltx-2-19b", family: "ltx", cap: 3 },
  { id: "ltx-2.3-quality", family: "ltx", cap: 3 },
  { id: "wavespeed-ai/krea-v2/turbo-lora", family: "krea", cap: 3 }, // recent cap=3, not 1
  { id: "flux-lora", family: "flux", cap: 1 },
  { id: "pruna-ai/p-image/edit-lora", family: "pimage", cap: 1 },
  { id: "pruna-ai/p-image/text-to-image-lora", family: "pimage", cap: 1 },
  { id: "wavespeed-ai/ltx-2.3-spicy/image-to-video-lora", family: null, cap: 1 }, // spicy uses a loras override we don't send
  { id: "nano-banana", family: null, cap: 1 },
  { id: "", family: null, cap: 1 },
];

for (const { label, ctx } of SURFACES) {
  for (const row of FAMILY) {
    ok(ctx.loraFamily(row.id) === row.family,
      `${label}: loraFamily(${JSON.stringify(row.id)}) === ${JSON.stringify(row.family)}`);
    ok(ctx.loraCap(row.id) === row.cap,
      `${label}: loraCap(${JSON.stringify(row.id)}) === ${row.cap}`);
  }
  ok(ctx.imageTakesLora("flux-lora") === true, `${label}: imageTakesLora(flux-lora)`);
  ok(ctx.imageTakesLora("flux-2-klein-9b") === true, `${label}: imageTakesLora(klein) even without 'lora' in the id`);
  ok(ctx.imageTakesLora("pruna-ai/p-image/edit-lora") === true, `${label}: imageTakesLora(p-image/*-lora)`);
  ok(ctx.imageTakesLora("flux-lora/inpainting") === false,
    `${label}: imageTakesLora hides inpaint ids (no lora_url on those)`);
  ok(ctx.imageTakesLora("nano-banana") === false, `${label}: imageTakesLora(nano-banana) is false`);
  ok(ctx.loraKind("image") === "image" && ctx.loraKind("edit") === "image" && ctx.loraKind("inpaint") === "image",
    `${label}: loraKind image/edit/inpaint → image`);
  ok(ctx.loraKind("tvideo") === "video" && ctx.loraKind("ivideo") === "video",
    `${label}: loraKind video nodes → video`);
}

// ---- C. loraBodyFor / loraParams payload keys --------------------------------
console.log("• loraBodyFor / loraParams");
const ITEM = { url: DIRECT, scale: 0.8 };
const ITEMS3 = [
  { url: DIRECT, scale: 0.5 },
  { url: DIRECT + "2", scale: 0.6 },
  { url: DIRECT + "3", scale: 0.7 },
];

for (const { label, ctx } of SURFACES) {
  const pimage = ctx.loraBodyFor("pruna-ai/p-image/edit-lora", [ITEM]);
  ok(pimage.lora_weights === DIRECT && pimage.lora_scale === 0.8 && !("lora_url" in pimage),
    `${label}: pimage body is lora_weights + lora_scale (not lora_url)`);

  const flux = ctx.loraBodyFor("flux-lora", [ITEM]);
  ok(flux.lora_url === DIRECT && flux.lora_strength === 0.8,
    `${label}: flux-lora single slot is lora_url + lora_strength`);

  const krea = ctx.loraBodyFor("wavespeed-ai/krea-v2/turbo-lora", ITEMS3);
  ok(krea.lora_url_1 === DIRECT && krea.lora_url_3 === DIRECT + "3" && krea.lora_scale_3 === 0.7 && !("lora_url_4" in krea),
    `${label}: krea stacked body is lora_url_1..3`);

  const klein = ctx.loraBodyFor("flux-2-klein-9b", ITEMS3);
  ok(klein.lora_url_1 && klein.lora_url_3 && !("lora_url" in klein),
    `${label}: klein stacked body uses lora_url_N (not the single lora_url)`);

  // cap slice: 4 authored rows on a cap-3 family must drop the 4th (the old krea-cap-1 bug class)
  const four = {
    type: "image",
    fields: {
      model: "wavespeed-ai/krea-v2/turbo-lora",
      loras: [
        { url: DIRECT, strength: "0.4" },
        { url: DIRECT + "2", strength: "0.5" },
        { url: DIRECT + "3", strength: "0.6" },
        { url: DIRECT + "4", strength: "0.7" },
      ],
    },
  };
  const sliced = ctx.loraParams(four);
  ok(sliced.lora_url_1 === DIRECT && sliced.lora_url_3 === DIRECT + "3" && !("lora_url_4" in sliced),
    `${label}: krea loraParams slices to cap 3 (4th row dropped)`);

  // spicy: family null → no LoRA keys even when a URL is authored (wrong shape would still bill)
  const spicy = ctx.loraParams({
    type: "ivideo",
    fields: { model: "wavespeed-ai/ltx-2.3-spicy/image-to-video-lora", loraUrl: DIRECT },
  });
  ok(Object.keys(spicy).length === 0,
    `${label}: spicy loraParams is {} (we don't send its loras override)`);

  // empty rows → {}
  ok(Object.keys(ctx.loraParams({ type: "image", fields: { model: "flux-lora" } })).length === 0,
    `${label}: no LoRA URL → loraParams {}`);

  // default strength when the field is blank
  const defS = ctx.loraParams({
    type: "image",
    fields: { model: "flux-lora", loraUrl: DIRECT, loraStrength: "" },
  });
  ok(defS.lora_url === DIRECT && defS.lora_strength === 1,
    `${label}: blank strength defaults to 1`);

  // civitai URL throws from loraParams (same gate imgExtra / video opts close over)
  ok(threw(() => ctx.loraParams({
    type: "image",
    fields: { model: "flux-lora", loraUrl: "https://civitai.com/models/99" },
  }), /CivitAI/), `${label}: loraParams throws on CivitAI (imgExtra never reaches genImage)`);
}

// ---- D. play runGraph: CivitAI must not POST; HF blob rewrites on the wire ----
console.log("• play runGraph");
catalog.image.push(
  { id: "flux-lora", supported_parameters: { max_output_images: 1 } },
);

const app = loadEngine();
const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
const graph = (nodes, links) => ({ nodes, links: links || [] });
const imgCalls = () => calls.filter((c) => /\/images\/generations/.test(c.url));

{
  calls.length = 0;
  const statuses = [];
  const g = app.materialize(graph([
    node("i1", "image", {
      model: "flux-lora",
      prompt: "a cat",
      loraUrl: "https://civitai.com/models/123/download",
    }),
  ]));
  await app.runGraph(g, { onStatus: (id, kind, msg) => statuses.push({ id, kind, msg }) });
  ok(imgCalls().length === 0,
    `CivitAI LoRA URL must not POST /images/generations (POSTs=${imgCalls().length})`);
  ok(statuses.some((s) => s.id === "i1" && s.kind === "error" && /CivitAI/i.test(String(s.msg || ""))),
    `CivitAI LoRA surfaces as a node error, not a billed 422 (statuses=${JSON.stringify(statuses)})`);
}

{
  calls.length = 0;
  const g = app.materialize(graph([
    node("i1", "image", {
      model: "flux-lora",
      prompt: "a cat",
      loraUrl: HF_BLOB,
      loraStrength: "0.75",
    }),
  ]));
  await app.runGraph(g);
  ok(imgCalls().length === 1, `good HF LoRA still POSTs once (POSTs=${imgCalls().length})`);
  const body = imgCalls()[0] && imgCalls()[0].body;
  ok(body && body.lora_url === HF_RESOLVE,
    `POST lora_url is the rewritten /resolve/ file (got ${JSON.stringify(body && body.lora_url)})`);
  ok(body && body.lora_strength === 0.75,
    `POST lora_strength is the authored scale (got ${JSON.stringify(body && body.lora_strength)})`);
  ok(body && body.prompt === "a cat" && body.model === "flux-lora",
    "POST still carries the prompt + model");
}

if (fail) {
  console.error("✗ check-lora-url-gates: " + fail + " assertion(s) failed.");
  process.exit(1);
}
console.log("✓ lora-url-gates: CivitAI/repo/HF-page URLs throw before send; family/cap/body lockstep; play runGraph never bills a bad LoRA URL.");
