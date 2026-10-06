#!/usr/bin/env node
// MiniMax H3 LoRA + reference: the node "~$X/clip" chip must track wired refs the
// same way the Run total does ($0.02 × N). Caught live on the #694 Workers preview:
// wiring ref1 moved Run to ~$0.32 but the chip stayed ~$0.25, because livePrice
// hardcoded false refs and connect() never called updateNodePrice / refreshRefInputs.
//
// Offline, no API spend. Pins the wire→chip path in source AND runs the shipped
// livePrice against a stub catalog so a regression fails before another GIF take.
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
function extractFunction(src, name) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}()`);
  const open = src.indexOf("{", m.index);
  let depth = 0;
  const tmpl = [];
  let mode = "code";
  for (let i = open; i < src.length; i++) {
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
        else if (depth === 0) return src.slice(m.index, i + 1);
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
  throw new Error("unbalanced braces for " + name);
}

// ---- source pins (would have failed on b13cbe5) --------------------------------
{
  const pins = [
    ["updateNodePrice passes the node into livePrice",
      /el\.textContent = livePrice\(t\.modelKind, fields, t\.modelFilter, n\)/],
    ["livePrice signature accepts the node",
      /function livePrice\(kind, fields, nodeFilter, n\)\{/],
    ["livePrice counts wired refN ports from the node",
      /refCount = \(n && t && t\.refInputs && modelHasImageRole\(n,"refs"\)\)[\s\S]*?REF_PORT_RE\.test\(l\.to\.port\)\)\.length : 0/],
    ["livePrice forwards refCount (not hardcoded false) to videoUnitUsd",
      /videoUnitUsd\(applyVideoQuotePricing\(fields\.model, it\.pricing\), videoPriceFields\(it\.params, fields\), refCount, videoWired, nodeFilter\)/],
    ["connect refreshes ref ports after a wire",
      /refreshVideoInputs\(tn\|\|\{\}\);[\s\S]*?refreshRefInputs\(tn\|\|\{\}\);/],
    ["connect refreshes the node chip after a wire",
      /refreshRefInputs\(tn\|\|\{\}\);[\s\S]*?updateNodePrice\(tn\);/],
    ["removeLink recompacts + refreshes ref ports",
      /recompactRefLinks\(tn\); refreshRefInputs\(tn\);/],
    ["removeLink refreshes the node chip after an unwire",
      /recompactRefLinks\(tn\); refreshRefInputs\(tn\);[\s\S]*?updateNodePrice\(tn\);/],
  ];
  for (const [label, re] of pins) {
    if (re.test(IDX)) ok("pin: " + label);
    else fail("pin: " + label);
  }
}

// ---- behavioural: livePrice chip text for H3 LoRA + 0/1/2 refs -----------------
// Live 2026-10-06 x402: LoRA 5s 480p $0.25, +1 ref $0.32, +2 $0.34.
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

const pricingBlock = (() => {
  const s = IDX.indexOf("const EST = {");
  const e = IDX.indexOf("function nodeUnitUsd(");
  if (s < 0 || e < 0) throw new Error("pricing block markers missing");
  return IDX.slice(s, e);
})();

const ctx = {
  console, Math,
  graph: { links: [], nodes: [] },
  NODE_TYPES: { tvideo: { modelKind: "video", refInputs: true, modelFilter: "t2v" } },
  REF_PORT_RE: /^ref\d+$/,
  catalogs: {
    video: [{
      id: "minimax-h3",
      pricing: H3_PRICING,
      params: {
        resolution: { options: [{ value: "480p" }], default: "480p" },
        duration: { options: [{ value: "5" }], default: "5" },
      },
    }],
  },
};
vm.createContext(ctx);

// Helpers livePrice needs that sit outside the EST…nodeUnitUsd slice.
const helpers = [
  'function catItem(kind, id){ return (catalogs[kind]||[]).find(function(m){ return m.id===id; }); }',
  'function modelHasImageRole(n, role){ return role==="refs"; }',  // H3 is ref-capable in this harness
  extractFunction(IDX, "livePrice"),
].join("\n");

try {
  vm.runInContext(
    pricingBlock + "\n" + helpers + "\nthis.livePrice=livePrice; this.videoUnitUsd=videoUnitUsd;",
    ctx
  );
} catch (e) {
  fail("could not extract/run livePrice: " + (e && e.message));
  process.exit(1);
}

const node = {
  id: "v1",
  type: "tvideo",
  fields: {
    model: "minimax-h3",
    duration: "5",
    resolution: "480p",
    loras: [{ url: LORA, strength: "1" }],
  },
};
ctx.graph.nodes = [node];

function chipFor(refN) {
  ctx.graph.links = [];
  for (let i = 1; i <= refN; i++) {
    ctx.graph.links.push({
      id: "l" + i,
      from: { node: "img", port: "out" },
      to: { node: "v1", port: "ref" + i },
    });
  }
  return ctx.livePrice("video", node.fields, "t2v", node);
}

const cases = [
  [0, "~$0.25/clip"],
  [1, "~$0.32/clip"],
  [2, "~$0.34/clip"],
];
for (const [n, want] of cases) {
  const got = chipFor(n);
  if (got === want) ok(`chip: LoRA + ${n} ref(s) → ${want}`);
  else fail(`chip: LoRA + ${n} ref(s) → got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// Without the node arg (picker row), refs must stay off even if the graph has wires.
ctx.graph.links = [{ id: "l1", from: { node: "img", port: "out" }, to: { node: "v1", port: "ref1" } }];
{
  const got = ctx.livePrice("video", node.fields, "t2v");  // no n
  if (got === "~$0.25/clip") ok("picker-row: livePrice without n ignores graph refs (stays base)");
  else fail(`picker-row: livePrice without n got ${JSON.stringify(got)}, want "~$0.25/clip"`);
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("✓ check-h3-lora-ref-chip");
