#!/usr/bin/env node
// MiniMax H3's resolution knob is LoRA-only. The catalog labels it "LoRA / Edit / Extend
// Resolution" and says "Generation without LoRAs remains 2K". The video arena graph has no
// LoRA, so the node showed "480p" over a 2560×1440 clip. A Text/Image → Video node now hides
// that knob until a LoRA row has a URL. It stays on the wire, like a hidden fixed duration,
// and NanoGPT ignores it without a LoRA. Video Edit/Extend keep it because they use it.
//
// Offline, no API spend. Extracts the editor's real dimDefs/videoDimParams/videoLoraOn.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

function block(src, anchor) {
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error("anchor not found: " + anchor);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced braces for: " + anchor);
}

const opts = (vals) => ({ type: "select", options: vals.map((value) => ({ value, label: value })) });
// Live minimax-h3 params (2026-10-06), trimmed to the dims.
const H3 = { id: "minimax-h3", params: {
  resolution: { ...opts(["480p", "540p", "768p", "1080p"]), default: "480p", label: "LoRA / Edit / Extend Resolution",
    description: "LoRA generation supports all listed resolutions; edit/extend support 480p and 768p. Generation without LoRAs remains 2K." },
  aspect_ratio: { ...opts(["auto", "16:9", "9:16", "1:1"]), default: "auto", label: "Aspect Ratio" },
  duration: { ...opts(["3", "4", "5", "6", "10", "15"]), default: "5", label: "Duration (seconds)" },
} };
const GROK = { id: "grok-imagine-video-1.5-lite", params: {
  resolution: { ...opts(["480p", "720p", "1080p"]), default: "720p", label: "Resolution" },
  aspect_ratio: { ...opts(["16:9", "9:16"]), default: "16:9" },
  duration: { ...opts(["5", "6"]), default: "6" },
} };

const code = [
  "var ASPECT_FALLBACK = [['16:9','16:9'],['9:16','9:16'],['1:1','1:1']];",
  "var DURATION_FALLBACK = [['5','5 sec'],['10','10 sec']];",
  "var SIZE_FALLBACK = [['1024x1024','square']];",
  block(IDX, "function selOpts(param){"),
  block(IDX, "function paramDef(param, opts){"),
  block(IDX, "function rangeDurOpts(param){"),
  block(IDX, "const DIM_TIER_PX = {").replace(/^const\s/, "var "),
  block(IDX, "function dimShape(v){"),
  (() => { const i = IDX.search(/(const|function)\s+dimNum\b/); return IDX.slice(i, IDX.indexOf("\n", i)).replace(/^const\s/, "var "); })(),
  block(IDX, "function nearestDimOption(cur, options, def){"),
  block(IDX, "function applyDimFields(fields, defs){"),
  "var IMAGE_ASPECT = {};",
  block(IDX, "function imageAspectSpec(model){"),
  block(IDX, "function videoLoraOn(fields){"),
  block(IDX, "function dimDefs(type, model, fields){"),
  block(IDX, "function videoDimParams(n){"),
  `var catalogs = { image:[], video:${JSON.stringify([H3, GROK])} };`,
  "function catItem(kind,id){ return (catalogs[kind]||[]).find(function(m){ return m.id===id; }); }",
].join("\n");
const E = { console, Math };
vm.createContext(E);
vm.runInContext(code, E);

const resDef = (type, model, fields) => E.dimDefs(type, model, fields).find((d) => d.f === "resolution");
const LORA = "https://huggingface.co/x/y/resolve/main/a.safetensors";
const cases = [
  ["tvideo H3, no loras field (the arena graph)", "tvideo", "minimax-h3", { duration: "5", aspect: "16:9" }, true],
  ["tvideo H3, empty loras array", "tvideo", "minimax-h3", { loras: [] }, true],
  ["tvideo H3, one blank LoRA row (what the node renders)", "tvideo", "minimax-h3", { loras: [{ url: "", strength: "" }] }, true],
  ["tvideo H3, whitespace-only LoRA URL", "tvideo", "minimax-h3", { loras: [{ url: "   " }] }, true],
  ["tvideo H3, LoRA URL set", "tvideo", "minimax-h3", { loras: [{ url: LORA, strength: "1" }] }, false],
  ["tvideo H3, second row has the URL", "tvideo", "minimax-h3", { loras: [{ url: "" }, { url: LORA }] }, false],
  ["tvideo H3, legacy loraUrl field", "tvideo", "minimax-h3", { loraUrl: LORA }, false],
  ["ivideo H3, no LoRA (image-to-video is also 2K)", "ivideo", "minimax-h3", {}, true],
  ["vedit H3, no LoRA (edit/extend use the knob)", "vedit", "minimax-h3", {}, false],
  ["tvideo Grok Lite (plain Resolution label) stays visible", "tvideo", "grok-imagine-video-1.5-lite", {}, false],
];
let bad = 0;
for (const [what, type, model, fields, wantHidden] of cases) {
  const d = resDef(type, model, fields);
  if (!d) { fail(`${what}: resolution def missing (it must stay for the wire)`); bad++; continue; }
  if (!!d.hidden !== wantHidden) { fail(`${what}: hidden=${!!d.hidden}, want ${wantHidden}`); bad++; }
}
if (!bad) ok(`LoRA-only resolution knob: ${cases.length} visibility cases (hidden on H3 generate nodes until a LoRA URL is set)`);

// Aspect + duration stay visible on the arena node, so the dims row still renders.
{
  const shown = E.dimDefs("tvideo", "minimax-h3", { duration: "5", aspect: "16:9" }).filter((d) => !d.hidden).map((d) => d.f);
  if (shown.join(",") !== "aspect,duration") fail(`arena H3 node should show aspect,duration only, got ${shown.join(",")}`);
  else ok("arena H3 node shows aspect + duration, no 480p");
}

// The wire is unchanged: videoDimParams still sends the def.
{
  const n = { type: "tvideo", fields: { model: "minimax-h3", duration: "5", aspect: "16:9" } };
  const wire = E.videoDimParams(n);
  if (wire.resolution !== "480p" || wire.duration !== "5" || wire.aspect_ratio !== "16:9")
    fail(`videoDimParams changed the H3 wire: ${JSON.stringify(wire)}`);
  else ok("send path unchanged (hidden knob still rides the wire)");
}

// Live wiring: refreshDims passes the node fields, and LoRA edits re-render dims and price.
{
  const rd = block(IDX, "function refreshDims(n){");
  if (!/dimDefs\(n\.type, n\.fields\.model, n\.fields\)/.test(rd)) fail("refreshDims must pass n.fields to dimDefs");
  else ok("refreshDims passes n.fields");
  const lp = block(IDX, "function refreshLoraParams(n){");
  if (!/videoLoraOn\(n\.fields\)[\s\S]*refreshDims\(n\)[\s\S]*updateNodePrice\(n\)/.test(lp))
    fail("LoRA URL input must refreshDims when the LoRA state flips and updateNodePrice otherwise");
  else ok("LoRA URL edits refresh the knob and the price chip");
  if (!/rows\.splice\(i,1\); save\(\); refreshLoraParams\(n\); refreshDims\(n\);/.test(lp)) fail("removing a LoRA row must refreshDims");
  else ok("removing a LoRA row refreshes the knob");
}

// The editor and play share one videoLoraOn body, so the estimate agrees in both engines.
{
  const norm = (s) => s.replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim();
  const a = norm(block(IDX, "function videoLoraOn(fields){"));
  const b = norm(block(PLAY, "function videoLoraOn(fields){"));
  if (a !== b) fail("videoLoraOn drifted between index.html and play.html");
  else ok("videoLoraOn identical in editor and play");
}

if (failed) { console.error(`\n✗ check-h3-lora-resolution: ${failed} failure(s)`); process.exit(1); }
console.log("✓ check-h3-lora-resolution: H3's LoRA-only resolution stays out of sight until a LoRA is set; the wire and the twins are unchanged.");
