#!/usr/bin/env node
/* ======================================================================
   Headless executor for a noodle-graph.json — runs the SAME node
   semantics as nanoodle's runtime (index.html NODE_TYPES.run / play.html
   runGraph): topological order, typed inputs + inline field overrides,
   real NanoGPT calls. Proves a "buildable" workflow actually produces the
   example's output end to end.

   Supports the nodes the buildable graphs use: text, join, llm, vision,
   image, edit, upload. (audio/video nodes poll async jobs; omitted here.)

   Usage: NANOGPT_API_KEY=... node run-graph.mjs <graph.json> <out-dir>
   ====================================================================== */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const NANOGPT = "https://nano-gpt.com";
const KEY = process.env.NANOGPT_API_KEY;
if (!KEY) { console.error("NANOGPT_API_KEY not set"); process.exit(1); }
const H = { Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
let COST = 0;
const noteCost = (j) => { const p = j?.x_nanogpt_pricing || {}; const u = p.costUsd ?? p.cost ?? j?.cost; if (u != null) COST += Number(u); };

async function genChat(messages, model) {
  const r = await fetch(NANOGPT + "/api/v1/chat/completions", { method: "POST", headers: H, body: JSON.stringify({ model, messages }) });
  if (!r.ok) throw new Error("chat " + r.status + ": " + (await r.text()).slice(0, 200));
  const j = await r.json(); noteCost(j);
  return j.choices?.[0]?.message?.content ?? "";
}
async function genImage(prompt, model, size, imageDataUrl) {
  const body = { model, prompt, size: size || "1024x1024", n: 1, response_format: "b64_json" };
  if (imageDataUrl) body.imageDataUrl = imageDataUrl;
  const r = await fetch(NANOGPT + "/v1/images/generations", { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("image " + r.status + ": " + (await r.text()).slice(0, 200));
  const j = await r.json(); noteCost(j);
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error("no image bytes returned: " + JSON.stringify(j).slice(0, 200));
  return "data:image/png;base64," + b64;
}

const RUN = {
  text: (n) => ({ text: n.fields.text || "" }),
  join: (n, inp) => ({ text: [inp.a, inp.b].filter(v => v != null && v !== "").join((n.fields.sep ?? " ").replace(/\\n/g, "\n")) }),
  llm: async (n, inp) => {
    const prompt = (inp.prompt ?? n.fields.prompt ?? "").trim();
    if (!prompt) throw new Error("no prompt");
    const messages = [];
    if ((n.fields.system || "").trim()) messages.push({ role: "system", content: n.fields.system.trim() });
    messages.push({ role: "user", content: prompt });
    return { text: await genChat(messages, n.fields.model) };
  },
  vision: async (n, inp) => {
    if (!inp.image) throw new Error("no image");
    const q = (n.fields.q || "Describe this image.").trim();
    return { text: await genChat([{ role: "user", content: [{ type: "text", text: q }, { type: "image_url", image_url: { url: inp.image } }] }], n.fields.model) };
  },
  image: async (n, inp) => ({ image: await genImage((inp.prompt ?? n.fields.prompt ?? "").trim(), n.fields.model, n.fields.size) }),
  edit: async (n, inp) => {
    if (!inp.image) throw new Error("no image input");
    return { image: await genImage((inp.prompt ?? n.fields.prompt ?? "").trim(), n.fields.model, n.fields.size, inp.image) };
  },
  upload: (n) => { if (!n.fields.image) throw new Error("no image — set fields.image to a data URL"); return { image: n.fields.image }; },
};
const DECLARED = { join: ["a", "b"], edit: ["image"], vision: ["image"], ivideo: ["image"], transcribe: ["audio"], lipsync: ["image", "audio"], vedit: ["video"] };

const [graphPath, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const g = JSON.parse(readFileSync(graphPath, "utf8"));
const byId = Object.fromEntries(g.nodes.map(n => [n.id, n]));
// topo order
const indeg = {}, adj = {};
g.nodes.forEach(n => { indeg[n.id] = 0; adj[n.id] = []; });
for (const l of g.links) { adj[l.from.node].push(l.to.node); indeg[l.to.node]++; }
const q = g.nodes.filter(n => indeg[n.id] === 0).map(n => n.id), order = [];
while (q.length) { const id = q.shift(); order.push(id); for (const m of adj[id]) if (--indeg[m] === 0) q.push(m); }
if (order.length !== g.nodes.length) { console.error("cycle detected"); process.exit(1); }

const out = {};
for (const id of order) {
  const n = byId[id];
  const declared = DECLARED[n.type] || [];
  const inp = {};
  for (const l of g.links.filter(l => l.to.node === id)) {
    const v = out[l.from.node]?.[l.from.port];
    if (declared.includes(l.to.port)) inp[l.to.port] = v;        // typed input
    else if (v != null) inp[l.to.port] = v;                       // inline field override
  }
  process.stdout.write(`  ▶ ${n.type} ${id} … `);
  const t0 = Date.now();
  out[id] = await RUN[n.type](n, inp);
  const prod = out[id].text != null ? `text(${String(out[id].text).length} chars)` : out[id].image ? "image" : Object.keys(out[id])[0];
  console.log(`${prod} (${((Date.now() - t0) / 1000).toFixed(1)}s, $${COST.toFixed(4)})`);
}

// save sink outputs
const hasOut = new Set(g.links.map(l => l.from.node));
const sinks = g.nodes.filter(n => !hasOut.has(n.id));
let i = 0;
for (const n of sinks) {
  const o = out[n.id];
  if (o.text != null) writeFileSync(join(outDir, `out-${n.id}-${n.type}.txt`), o.text);
  if (o.image && o.image.startsWith("data:image")) writeFileSync(join(outDir, `out-${n.id}-${n.type}.png`), Buffer.from(o.image.split(",")[1], "base64"));
  i++;
}
// also dump any intermediate composed text (llm/join) for inspection
for (const id of order) { const o = out[id]; if (o.text != null) writeFileSync(join(outDir, `step-${id}-${byId[id].type}.txt`), o.text); }
console.log(`\nDONE. ${order.length} nodes, ${sinks.length} sink output(s), total $${COST.toFixed(4)}. Artifacts in ${outDir}`);
