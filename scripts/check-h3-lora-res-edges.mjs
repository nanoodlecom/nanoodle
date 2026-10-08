#!/usr/bin/env node
// Leftover H3 LoRA-only resolution-hide edges after #686.
// That PR shipped the tvideo/ivideo hide-until-URL, vedit keep, Grok
// "Resolution" stay-visible, blank/whitespace/legacy URL, arena
// aspect+duration, and the hidden knob still riding the wire.
// This file pins the leftover type/label contract those cases never
// hit: lipsync uses the same hide (it is not vedit), a plain
// "Resolution" label stays visible without a LoRA, "LoRA" in the
// description alone does not hide, and null/undefined fields still
// hide (videoLoraOn treats them as off). Catalog label only — no
// model-name list. Offline, zero API spend. New file so it does not
// collide with check-h3-lora-resolution / check-h3-lora-ref-edges.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");

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
const H3 = { id: "minimax-h3", params: {
  resolution: { ...opts(["480p", "540p", "768p", "1080p"]), default: "480p", label: "LoRA / Edit / Extend Resolution",
    description: "LoRA generation supports all listed resolutions; edit/extend support 480p and 768p. Generation without LoRAs remains 2K." },
  aspect_ratio: { ...opts(["auto", "16:9", "9:16", "1:1"]), default: "auto", label: "Aspect Ratio" },
  duration: { ...opts(["3", "4", "5", "6", "10", "15"]), default: "5", label: "Duration (seconds)" },
} };
const PLAIN = { id: "plain-res", params: {
  resolution: { ...opts(["480p", "720p"]), default: "480p", label: "Resolution" },
  aspect_ratio: { ...opts(["16:9"]), default: "16:9" },
  duration: { ...opts(["5"]), default: "5" },
} };
const DESC = { id: "desc-lora", params: {
  resolution: { ...opts(["480p"]), default: "480p", label: "Resolution",
    description: "LoRA generation supports 480p" },
  aspect_ratio: { ...opts(["16:9"]), default: "16:9" },
  duration: { ...opts(["5"]), default: "5" },
} };
const LORA = "https://huggingface.co/x/y/resolve/main/a.safetensors";

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
  `var catalogs = { image:[], video:${JSON.stringify([H3, PLAIN, DESC])} };`,
  "function catItem(kind,id){ return (catalogs[kind]||[]).find(function(m){ return m.id===id; }); }",
].join("\n");
const E = { console, Math };
vm.createContext(E);
vm.runInContext(code, E);

const resDef = (type, model, fields) => E.dimDefs(type, model, fields).find((d) => d.f === "resolution");

{
  const off = resDef("lipsync", "minimax-h3", {});
  const on = resDef("lipsync", "minimax-h3", { loras: [{ url: LORA, strength: "1" }] });
  if (!off || !off.hidden)
    fail("lipsync H3 with no LoRA must hide the LoRA-only resolution, got " + JSON.stringify(off));
  else if (!on || on.hidden)
    fail("lipsync H3 with a LoRA URL must show the resolution knob, got " + JSON.stringify(on));
  else ok("lipsync uses the same hide-until-URL as generate (it is not vedit)");
}

{
  const plain = resDef("tvideo", "plain-res", {});
  if (!plain)
    fail("plain Resolution label must still ship a resolution def");
  else if (plain.hidden)
    fail("plain Resolution label must stay visible without a LoRA (catalog label only)");
  else ok("plain Resolution label stays visible without a LoRA");
}

{
  const desc = resDef("tvideo", "desc-lora", {});
  if (!desc)
    fail("description-only LoRA mention must still ship a resolution def");
  else if (desc.hidden)
    fail("LoRA in the description must not hide — only the catalog label is consulted");
  else ok("LoRA in the description alone does not hide the knob");
}

{
  const nul = resDef("tvideo", "minimax-h3", null);
  const und = resDef("tvideo", "minimax-h3", undefined);
  if (!nul || !nul.hidden || !und || !und.hidden)
    fail("null/undefined fields must still hide H3's LoRA-only resolution");
  else ok("null/undefined fields still hide (videoLoraOn treats them as off)");
}

{
  const comment = E.dimDefs("comment", "minimax-h3", {});
  if (comment && comment.some((d) => d.f === "resolution"))
    fail("comment is not a video dim node and must not invent a resolution def");
  else ok("comment type does not invent a resolution def");
}

if (failed) {
  console.error("\n✗ check-h3-lora-res-edges: " + failed + " failed");
  process.exit(1);
}
console.log("\n✓ check-h3-lora-res-edges");
