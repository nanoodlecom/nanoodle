#!/usr/bin/env node
/* ======================================================================
   Validate a noodle-graph.json the way the nanoodle editor + app builder
   actually treat it. Checks (faithful to index.html NODE_TYPES + play.html
   materialize/runGraph/topoOrder/deriveInputs/deriveOutputs):

   1. every node.type exists in the catalog; ids unique
   2. every link endpoint resolves to a real node
   3. from.port is a DECLARED OUTPUT of the source node (with a type)
   4. to.port is EITHER a declared typed input (types must match) OR an
      inline field port (always type "text" -> the source output MUST be
      text), mirroring runGraph's typed-input vs fieldOverride split
   5. no cycles (topoOrder leaves nothing cyclic)
   6. reports the app-builder INPUT form + OUTPUT sinks it will derive

   Usage: node validate-graph.mjs <graph.json> [<graph.json> ...]
   Exit 0 iff every graph is valid.
   ====================================================================== */
import { readFileSync } from "node:fs";

// Node catalog — ports lifted verbatim from index.html NODE_TYPES (the editor).
// inputs: declared typed ports. textFields: inline field ports (each type "text").
const CATALOG = {
  text:      { in: [],                                         out: { text: "text" },  textFields: ["text"] },
  upload:    { in: [],                                         out: { image: "image" }, textFields: [] },
  aupload:   { in: [],                                         out: { audio: "audio" }, textFields: [] },
  vupload:   { in: [],                                         out: { video: "video" }, textFields: [] },
  join:      { in: { a: "text", b: "text" },                  out: { text: "text" },  textFields: ["sep"] },
  llm:       { in: [],                                         out: { text: "text" },  textFields: ["system", "prompt"] },
  image:     { in: [],                                         out: { image: "image" }, textFields: ["prompt", "size"] },
  edit:      { in: { image: "image" },                        out: { image: "image" }, textFields: ["prompt", "size"] },
  vision:    { in: { image: "image" },                        out: { text: "text" },  textFields: ["q"] },
  tvideo:    { in: [],                                         out: { video: "video" }, textFields: ["prompt", "duration", "aspect"] },
  ivideo:    { in: { image: "image" },                        out: { video: "video" }, textFields: ["prompt", "duration", "aspect"] },
  vedit:     { in: { video: "video" },                        out: { video: "video" }, textFields: ["prompt"] },
  lipsync:   { in: { image: "image", audio: "audio" },        out: { video: "video" }, textFields: ["prompt"] },
  music:     { in: [],                                         out: { audio: "audio" }, textFields: ["prompt", "lyrics"] },
  tts:       { in: [],                                         out: { audio: "audio" }, textFields: ["prompt"] },
  transcribe:{ in: { audio: "audio" },                        out: { text: "text" },  textFields: ["language"] },
};
// app-builder INPUT_SPECS (play.html) — which unfed source fields become form inputs
const INPUT_SPECS = {
  text: [["text", "Text"]], upload: [["image", "Image"]], aupload: [["audio", "Audio"]], vupload: [["video", "Video"]],
  llm: [["prompt", "Prompt"], ["system", "System prompt (optional)"]], image: [["prompt", "Image prompt"]],
  tvideo: [["prompt", "Video prompt"]], music: [["prompt", "Style / prompt"]], tts: [["prompt", "Text to speak"]],
};
const inType = (cat, port) => (Array.isArray(cat.in) ? undefined : cat.in[port]);

function validate(path) {
  const errs = [], warns = [];
  let g;
  try { g = JSON.parse(readFileSync(path, "utf8")); } catch (e) { return { path, errs: ["unparseable JSON: " + e.message], warns: [] }; }
  const nodes = g.nodes || [], links = g.links || [];
  const byId = {}, seen = new Set();
  for (const n of nodes) {
    if (seen.has(n.id)) errs.push(`duplicate node id ${n.id}`);
    seen.add(n.id);
    if (!CATALOG[n.type]) errs.push(`node ${n.id}: unknown type "${n.type}"`);
    byId[n.id] = n;
  }
  for (const l of links) {
    const s = byId[l.from?.node], t = byId[l.to?.node];
    if (!s) { errs.push(`link ${l.id}: from.node ${l.from?.node} missing`); continue; }
    if (!t) { errs.push(`link ${l.id}: to.node ${l.to?.node} missing`); continue; }
    const sc = CATALOG[s.type], tc = CATALOG[t.type];
    if (!sc || !tc) continue;
    const outT = sc.out[l.from.port];
    if (!outT) { errs.push(`link ${l.id}: ${s.type} has no output port "${l.from.port}"`); continue; }
    const declared = inType(tc, l.to.port);
    if (declared !== undefined) {
      if (declared !== outT) errs.push(`link ${l.id}: type mismatch — ${s.type}.${l.from.port}:${outT} -> ${t.type}.${l.to.port}:${declared}`);
    } else {
      // inline field port: always text; the source must emit text
      if (!tc.textFields.includes(l.to.port))
        warns.push(`link ${l.id}: ${t.type}.${l.to.port} is not a declared input nor a known field — treated as a field override`);
      if (outT !== "text") errs.push(`link ${l.id}: inline field port ${t.type}.${l.to.port} accepts only text, got ${outT} from ${s.type}.${l.from.port}`);
    }
  }
  // cycle check (Kahn) — exactly play.html topoOrder
  const indeg = {}, adj = {};
  nodes.forEach(n => { indeg[n.id] = 0; adj[n.id] = []; });
  for (const l of links) if (byId[l.from?.node] && byId[l.to?.node]) { adj[l.from.node].push(l.to.node); indeg[l.to.node]++; }
  const q = nodes.filter(n => indeg[n.id] === 0).map(n => n.id), order = [];
  while (q.length) { const n = q.shift(); order.push(n); for (const m of adj[n]) if (--indeg[m] === 0) q.push(m); }
  if (order.length !== nodes.length) errs.push(`cycle detected (${nodes.length - order.length} node(s) in a cycle)`);

  // derive app-builder form + outputs
  const fedFields = new Set(links.map(l => `${l.to.node}:${l.to.port}`));
  const inputs = [];
  for (const n of nodes) for (const [f, label] of (INPUT_SPECS[n.type] || []))
    if (!fedFields.has(`${n.id}:${f}`)) inputs.push(`${label} (${n.type} ${n.id})`);
  const hasOut = new Set(links.map(l => l.from.node));
  const outputs = nodes.filter(n => CATALOG[n.type] && Object.keys(CATALOG[n.type].out).length && !hasOut.has(n.id))
    .map(n => `${n.type} ${n.id} -> ${Object.values(CATALOG[n.type].out)[0]}`);
  return { path, errs, warns, inputs, outputs, order: order.length };
}

let allOk = true;
for (const path of process.argv.slice(2)) {
  const r = validate(path);
  const ok = r.errs.length === 0;
  allOk = allOk && ok;
  console.log(`\n${ok ? "✅ VALID" : "❌ INVALID"}  ${path}`);
  r.errs.forEach(e => console.log("   ERROR: " + e));
  r.warns.forEach(w => console.log("   note:  " + w));
  if (r.inputs) console.log("   app-builder form inputs: " + (r.inputs.length ? r.inputs.join(" · ") : "(none — Run produces directly)"));
  if (r.outputs) console.log("   app-builder outputs:     " + r.outputs.join(" · "));
}
process.exit(allOk ? 0 : 1);
