#!/usr/bin/env node
// Custom-civitai / direct-AIR image extras (PRs #352 / #353).
//
// Three contracts that were added with no assertions:
//   1. normalizeCustomCivitaiAir / isValidCustomAir — refuse a bad paste BEFORE
//      the paid /v1/images/generations call (otherwise the API 400s after charge).
//   2. airTakesNegative — FLUX-family platform AIRs (runware:100/101/103/104/106/
//      107/111/160/400@…) are guidance-distilled; a negative is silently ignored,
//      so we must omit it. Hand-kept family regex, copied in index.html, play.html
//      RUNTIME, and njs-engine. A one-sided edit hides a working knob or ships a
//      dead one.
//   3. imgExtra sends snake_case `negative_prompt` only. camelCase `negativePrompt`
//      is dropped by the API (live-verified 2026-07-18 on persona:376130@2456367).
//
// Predicates are extracted and driven in-process; play RUNTIME is driven through
// the real runGraph() + recording fetch (same harness as check-run-compat.mjs).
// Offline, no network, no API spend.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadEngine, calls, catalog } from "./play-engine.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");
const VENDOR = join(ROOT, "vendor", "njs-engine.js");

let fail = 0;
const ok = (c, m) => {
  if (!c) { fail++; console.log("  ✗ " + m); }
  else console.log("  ✓ " + m);
};

function matchBrace(src, openIdx) {
  let depth = 0;
  const tmpl = [];
  let mode = "code";
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i++; }
      else if (c === "/" && n === "*") { mode = "block"; i++; }
      else if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (tmpl.length && depth === tmpl[tmpl.length - 1]) { tmpl.pop(); mode = "tpl"; }
        else if (depth === 0) return i;
      }
    } else if (mode === "line") { if (c === "\n") mode = "code"; }
    else if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i++; } }
    else if (mode === "sq") { if (c === "\\") i++; else if (c === "'") mode = "code"; }
    else if (mode === "dq") { if (c === "\\") i++; else if (c === '"') mode = "code"; }
    else if (mode === "tpl") {
      if (c === "\\") i++;
      else if (c === "`") mode = "code";
      else if (c === "$" && n === "{") { mode = "code"; tmpl.push(depth); depth++; i++; }
    }
  }
  throw new Error("unbalanced braces from index " + openIdx);
}

function extractAllFns(src, name) {
  const out = [];
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  let from = 0;
  while (from < src.length) {
    const m = re.exec(src.slice(from));
    if (!m) break;
    const start = from + m.index;
    const open = src.indexOf("{", start);
    const close = matchBrace(src, open);
    out.push(src.slice(start, close + 1));
    from = close + 1;
  }
  return out;
}

function loadFn(src, name) {
  const fns = extractAllFns(src, name);
  if (!fns.length) throw new Error(name + "() not found");
  return new Function(fns[0] + "; return " + name + ";")();
}

// ---- twin predicates: every copy must agree on the same ids ----------------
const FLUX_AIRS = [
  "runware:100@1", "runware:101@x", "runware:103@2", "runware:104@1",
  "runware:106@1", "runware:107@krea", "runware:111@srpo", "runware:160@1",
  "runware:400@2", "RUNWARE:100@9",
];
const NON_FLUX_AIRS = [
  "runware:102@1", "runware:108@1", "runware:200@1", "runware:401@1",
  "runware:105@1", "persona:376130@2456367", "civitai:123@456",
];
const TAKES_CASES = [
  ...FLUX_AIRS.map((id) => [id, false]),
  ...NON_FLUX_AIRS.map((id) => [id, true]),
  ["", true],           // empty is not a FLUX AIR — gate stays open
  ["flux-schnell", true],
];
const MODEL_CASES = [
  ["persona:376130@2456367", true],
  ["civitai:123@456", true],
  ["runware:200@1", true],
  ["runware:100@1", false],          // FLUX platform AIR
  ["flux-schnell", false],           // not an AIR-style catalog id
  ["custom-civitai", false],         // wrapper id — gate is on the pasted AIR
  ["", false],
];

const sources = [
  ["index.html", IDX],
  ["play.html", PLAY],
];
if (existsSync(VENDOR)) sources.push(["vendor/njs-engine.js", readFileSync(VENDOR, "utf8")]);

{
  const preds = [];
  for (const [label, src] of sources) {
    const copies = extractAllFns(src, "airTakesNegative");
    ok(copies.length >= 1, `${label}: airTakesNegative exists (${copies.length} cop${copies.length === 1 ? "y" : "ies"})`);
    copies.forEach((fn, i) => preds.push([`${label}#${i + 1}`, new Function(fn + "; return airTakesNegative;")()]));
  }
  ok(preds.length >= 3, `airTakesNegative extracted from editor + play + engine (got ${preds.length})`);
  for (const [id, want] of TAKES_CASES) {
    const got = preds.map(([label, fn]) => [label, fn(id)]);
    const disagree = got.filter(([, v]) => v !== want);
    ok(!disagree.length, `airTakesNegative(${JSON.stringify(id)}) === ${want}` +
      (disagree.length ? ` — drifted: ${disagree.map(([l, v]) => l + "=" + v).join(", ")}` : ""));
  }
}

{
  const preds = [];
  for (const [label, src] of sources) {
    const copies = extractAllFns(src, "airModelTakesNegative");
    if (!copies.length) { ok(false, `${label}: airModelTakesNegative missing`); continue; }
    copies.forEach((fn, i) => {
      const takes = extractAllFns(src, "airTakesNegative")[Math.min(i, extractAllFns(src, "airTakesNegative").length - 1)];
      preds.push([`${label}#${i + 1}`, new Function(takes + ";\n" + fn + "; return airModelTakesNegative;")()]);
    });
  }
  for (const [id, want] of MODEL_CASES) {
    const got = preds.map(([label, fn]) => [label, fn(id)]);
    const disagree = got.filter(([, v]) => v !== want);
    ok(!disagree.length, `airModelTakesNegative(${JSON.stringify(id)}) === ${want}` +
      (disagree.length ? ` — drifted: ${disagree.map(([l, v]) => l + "=" + v).join(", ")}` : ""));
  }
}

// ---- AIR parse / validate (refuse before charge) --------------------------
const NORM_CASES = [
  ["", ""],
  ["  civitai:11@22  ", "civitai:11@22"],
  ["Civitai:11@22", "civitai:11@22"],
  ["persona:376130@2456367", "persona:376130@2456367"],
  ["Persona:1@2", "persona:1@2"],
  ["runware:100@1", "runware:100@1"],
  ["RUNWARE:200@rev", "runware:200@rev"],
  ["11@22", "civitai:11@22"],
  ["https://civitai.com/models/376130?modelVersionId=2456367", "civitai:376130@2456367"],
  ["https://civitai.com/models/9&modelVersionId=8", "civitai:9@8"],
  ["not-an-air", "not-an-air"],          // unknown shapes pass through for isValid to refuse
];
const VALID_CASES = [
  ["civitai:11@22", true],
  ["persona:376130@2456367", true],
  ["runware:100@1", true],
  ["runware:flex@rev", true],
  ["", false],
  ["11@22", false],                      // bare form must be normalized first
  ["not-an-air", false],
  ["civitai:11", false],
  ["runware:100", false],
  ["https://civitai.com/models/1?modelVersionId=2", false],
];

{
  const norms = sources.map(([label, src]) => [label, loadFn(src, "normalizeCustomCivitaiAir")]);
  const valids = sources.map(([label, src]) => [label, loadFn(src, "isValidCustomAir")]);
  for (const [raw, want] of NORM_CASES) {
    const got = norms.map(([label, fn]) => [label, fn(raw)]);
    const disagree = got.filter(([, v]) => v !== want);
    ok(!disagree.length, `normalize(${JSON.stringify(raw)}) === ${JSON.stringify(want)}` +
      (disagree.length ? ` — ${disagree.map(([l, v]) => l + "=" + JSON.stringify(v)).join(", ")}` : ""));
  }
  for (const [raw, want] of VALID_CASES) {
    const got = valids.map(([label, fn]) => [label, fn(raw)]);
    const disagree = got.filter(([, v]) => v !== want);
    ok(!disagree.length, `isValidCustomAir(${JSON.stringify(raw)}) === ${want}` +
      (disagree.length ? ` — ${disagree.map(([l, v]) => l + "=" + v).join(", ")}` : ""));
  }
}

// ---- editor imgExtra (extracted, no DOM) ---------------------------------
{
  const names = [
    "needsCustomCivitai", "normalizeCustomCivitaiAir", "isValidCustomAir",
    "airTakesNegative", "airModelTakesNegative", "imgExtra",
  ];
  const ctx = { loraParams: () => ({}), t: (s) => s };
  vm.createContext(ctx);
  for (const name of names) {
    const fns = extractAllFns(IDX, name);
    if (!fns.length) throw new Error("index.html missing " + name);
    vm.runInContext(fns[0], ctx);
  }
  const extra = (fields) => ctx.imgExtra({ fields });

  const sd = extra({ model: "custom-civitai", customCivitaiAir: "persona:376130@2456367", negativePrompt: "  blurry  " });
  ok(sd.negative_prompt === "blurry", `editor custom-civitai SD AIR sends trimmed snake_case (got ${JSON.stringify(sd.negative_prompt)})`);
  ok(!("negativePrompt" in sd), "editor must not send camelCase negativePrompt (API drops it)");

  const flux = extra({ model: "custom-civitai", customCivitaiAir: "runware:100@1", negativePrompt: "blurry" });
  ok(!("negative_prompt" in flux), "editor FLUX AIR omits negative_prompt");

  const blank = extra({ model: "custom-civitai", customCivitaiAir: "civitai:1@2", negativePrompt: "   " });
  ok(!("negative_prompt" in blank), "editor whitespace-only negative is omitted");

  const direct = extra({ model: "persona:376130@2456367", negativePrompt: "noise" });
  ok(direct.negative_prompt === "noise", "editor direct persona: catalog id sends negative_prompt");

  const fluxDirect = extra({ model: "runware:100@1", negativePrompt: "noise" });
  ok(!("negative_prompt" in fluxDirect), "editor direct FLUX catalog id omits negative_prompt");

  const plain = extra({ model: "flux-schnell", negativePrompt: "noise" });
  ok(!("negative_prompt" in plain), "editor non-AIR model does not attach a leftover negativePrompt field");

  let threw = "";
  try { extra({ model: "custom-civitai", customCivitaiAir: "" }); }
  catch (e) { threw = String(e && e.message || e); }
  ok(/select an AIR|select a CivitAI/i.test(threw), `editor empty AIR throws before send (got ${JSON.stringify(threw)})`);

  threw = "";
  try { extra({ model: "custom-civitai", customCivitaiAir: "not-an-air" }); }
  catch (e) { threw = String(e && e.message || e); }
  ok(/AIR must look like/i.test(threw), `editor invalid AIR throws before send (got ${JSON.stringify(threw)})`);

  const seeded = extra({ model: "custom-civitai", customCivitaiAir: "civitai:1@2", seed: "42", negativePrompt: "x" });
  ok(seeded.seed === 42 && seeded.customCivitaiAir === "civitai:1@2",
    `editor keeps numeric seed + canonical AIR (got seed=${seeded.seed} air=${seeded.customCivitaiAir})`);
}

// ---- play RUNTIME: leftover field must land on the real POST body ---------
catalog.image.push(
  { id: "custom-civitai", supported_parameters: { max_output_images: 1 } },
  { id: "persona:376130@2456367", supported_parameters: { max_output_images: 1 } },
  { id: "runware:100@1", supported_parameters: { max_output_images: 1 } },
  { id: "runware:200@1", supported_parameters: { max_output_images: 1 } },
  { id: "x", supported_parameters: { max_output_images: 1 } },
);

const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
const imgCalls = () => calls.filter((c) => /\/images\/generations/.test(c.url));
const app = loadEngine();

async function runImage(fields) {
  calls.length = 0;
  const g = app.materialize({ nodes: [node("i1", "image", { prompt: "a cat", size: "512x512", ...fields })], links: [] });
  await app.runGraph(g, {});
  return imgCalls();
}

{
  const posts = await runImage({
    model: "custom-civitai",
    customCivitaiAir: "https://civitai.com/models/376130?modelVersionId=2456367",
    negativePrompt: "blurry",
  });
  ok(posts.length === 1, `play custom-civitai URL AIR bills once (got ${posts.length})`);
  const b = posts[0] && posts[0].body || {};
  ok(b.negative_prompt === "blurry", `play sends snake_case negative_prompt (got ${JSON.stringify(b.negative_prompt)})`);
  ok(!("negativePrompt" in b), "play must not send camelCase negativePrompt");
  ok(b.customCivitaiAir === "civitai:376130@2456367", `play normalizes CivitAI URL to AIR (got ${JSON.stringify(b.customCivitaiAir)})`);
}

{
  const posts = await runImage({ model: "custom-civitai", customCivitaiAir: "runware:100@1", negativePrompt: "blurry" });
  const b = posts[0] && posts[0].body || {};
  ok(posts.length === 1, "play FLUX custom-civitai still generates (negative omitted, not blocked)");
  ok(!("negative_prompt" in b), `play FLUX AIR omits negative_prompt (keys=${Object.keys(b)})`);
}

{
  const posts = await runImage({ model: "persona:376130@2456367", negativePrompt: "noise" });
  ok(posts[0] && posts[0].body && posts[0].body.negative_prompt === "noise",
    `play direct persona: id sends negative_prompt (got ${JSON.stringify(posts[0] && posts[0].body && posts[0].body.negative_prompt)})`);
}

{
  const posts = await runImage({ model: "runware:100@1", negativePrompt: "noise" });
  ok(posts[0] && !("negative_prompt" in posts[0].body), "play direct FLUX catalog id omits negative_prompt");
}

{
  const posts = await runImage({ model: "x", negativePrompt: "noise" });
  ok(posts[0] && !("negative_prompt" in posts[0].body), "play non-AIR model does not leak fields.negativePrompt onto the POST");
}

{
  const posts = await runImage({ model: "custom-civitai", customCivitaiAir: "not-an-air", negativePrompt: "x" });
  ok(posts.length === 0, `play invalid AIR must not POST (got ${posts.length})`);
}

{
  const posts = await runImage({ model: "custom-civitai", customCivitaiAir: "", negativePrompt: "x" });
  ok(posts.length === 0, `play empty AIR must not POST (got ${posts.length})`);
}

if (fail) {
  console.error(`\n✗ air-negative: ${fail} assertion(s) failed.`);
  process.exit(1);
}
console.log("\n✓ air-negative: AIR parse/validate + FLUX negative gate agree across engines; play POST uses snake_case only.");
