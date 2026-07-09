#!/usr/bin/env node
// Capability gating for the exported-app LLM node (play.html RUNTIME_JS twin of index.html's editor gates).
// Two engine-drift bugs let an exported app send a paid request the chosen model can't honor:
//   1. a JSON output-format baked into the graph → response_format:json_object on a model WITHOUT
//      structured_output returns empty content (finish_reason tool_calls) yet still bills.
//   2. a wired audio clip → an input_audio part on a text-only model, which can't hear it but is still
//      billed the (large, ~32k-token) audio part.
// The editor gates both by the live catalog (refreshLlmOpts structured_output / modelSupportsAudio); this
// locks the same PAYLOAD-level gating into play.html's runGraph so a baked knob / post-authoring model swap
// can't silently burn money. Offline: a seeded catalog stands in for /api/v1/models (no network).
//
// Same node:vm engine harness as check-run-compat.mjs — drive the REAL runGraph() with a recording fetch.

import { loadEngine, calls, catalog } from "./play-engine.mjs";

// ---- graph builders (mirror check-run-compat) -----------------------------
const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
let _l = 0;
const link = (from, fromPort, to, toPort) => ({ id: "l" + (++_l), from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
const WAV = "data:audio/wav;base64,QUJD";
const chatCalls = () => calls.filter((c) => /\/chat\/completions/.test(c.url));
const userMsg = (call) => (call.body.messages || []).find((m) => m.role === "user");
const audioPart = (call) => {
  const u = userMsg(call);
  return Array.isArray(u.content) ? u.content.find((p) => p.type === "input_audio") : null;
};

// A catalog covering every capability combo the scenarios drive. Ids are synthetic so they never collide
// with a real model in another checker's graphs.
catalog.chat = [
  { id: "struct-yes", capabilities: { structured_output: true } },
  { id: "struct-no",  capabilities: {} },
  { id: "audio-yes",  capabilities: { audio_input: true } },
  { id: "audio-no",   capabilities: {} },
];

const SCENARIOS = [
  {
    name: "structured_output=false model DROPS response_format even with format:JSON baked",
    data: { nodes: [node("m1", "llm", { model: "struct-no", prompt: "hi", format: "JSON" })], links: [] },
    check(g, fail) {
      const b = chatCalls()[0].body;
      if ("response_format" in b) fail(`a model without structured_output must NOT send response_format, got ${JSON.stringify(b.response_format)}`);
    },
  },
  {
    name: "structured_output=true model KEEPS response_format json_object",
    data: { nodes: [node("m1", "llm", { model: "struct-yes", prompt: "hi", format: "JSON" })], links: [] },
    check(g, fail) {
      const rf = chatCalls()[0].body.response_format;
      if (!rf || rf.type !== "json_object") fail(`a structured_output model must still send response_format json_object, got ${JSON.stringify(rf)}`);
    },
  },
  {
    // Drift preflight (assertModelAvailable) supersedes the old permissive-keep for a catalog-MISSING
    // model: a saved/shared graph naming a renamed/retired id is blocked before any send (no opaque
    // 4xx, no charge on a dead id). The capability-STRIP path above is unaffected — it gates on
    // catalogued models whose flags are known. (Twin pinned in check-drifted-model.mjs.)
    name: "catalog-missing (drifted) model is blocked before any send — no chat call",
    data: { nodes: [node("m1", "llm", { model: "not-in-catalog", prompt: "hi", format: "JSON" })], links: [] },
    check(g, fail) {
      if (chatCalls().length) fail("a catalog-missing model must be blocked before any paid chat send");
    },
  },
  {
    name: "audio_input=false model DROPS the wired input_audio part (and warns)",
    data: { nodes: [node("u1", "aupload", { audio: WAV }), node("t1", "text", { text: "Transcribe" }), node("m1", "llm", { model: "audio-no" })],
            links: [link("u1", "audio", "m1", "audio"), link("t1", "text", "m1", "prompt")] },
    check(g, fail, notes) {
      const a = audioPart(chatCalls()[0]);
      if (a) fail(`a text-only model must NOT be sent an input_audio part, got ${JSON.stringify(a).slice(0, 80)}`);
      if (!notes.some((m) => /audio ignored/i.test(m))) fail(`dropping audio must surface a note; statuses seen: ${JSON.stringify(notes)}`);
    },
  },
  {
    name: "audio_input=true model KEEPS the wired input_audio part",
    data: { nodes: [node("u1", "aupload", { audio: WAV }), node("t1", "text", { text: "Transcribe" }), node("m1", "llm", { model: "audio-yes" })],
            links: [link("u1", "audio", "m1", "audio"), link("t1", "text", "m1", "prompt")] },
    check(g, fail) {
      const a = audioPart(chatCalls()[0]);
      if (!a) return fail("an audio-input model must still receive the wired input_audio part");
      if (a.input_audio.data !== "QUJD") fail(`audio data must be the bare base64, got ${JSON.stringify(a.input_audio.data)}`);
    },
  },
  {
    // Same drift preflight for a wired-audio graph: a catalog-missing model never reaches the sender.
    name: "catalog-missing (drifted) model with wired audio is blocked before any send — no chat call",
    data: { nodes: [node("u1", "aupload", { audio: WAV }), node("t1", "text", { text: "Transcribe" }), node("m1", "llm", { model: "not-in-catalog" })],
            links: [link("u1", "audio", "m1", "audio"), link("t1", "text", "m1", "prompt")] },
    check(g, fail) {
      if (chatCalls().length) fail("a catalog-missing model must be blocked before any paid chat send");
    },
  },
];

const failures = [];
const app = (() => { try { return loadEngine(); } catch (e) { failures.push("could not load engine: " + (e && e.stack || e)); return null; } })();

if (app) {
  for (const s of SCENARIOS) {
    calls.length = 0;
    const notes = [];
    const fails0 = failures.length;
    const fail = (m) => failures.push(`"${s.name}": ${m}`);
    try {
      const g = app.materialize(s.data);
      await app.runGraph(g, { onStatus: (id, kind, msg) => notes.push(msg) });
      s.check(g, fail, notes);
    } catch (e) {
      fail("threw: " + (e && e.message || e));
    }
    if (failures.length === fails0) process.stdout.write(`  ✓ ${s.name}\n`);
  }
}

// ---- Editor twin: refreshLlmOpts must not wipe knobs on catalog miss --------
// Was: `const it = catItem(...) || {}` then `if(!it.structured_output) delete f.format`
// treated an empty/offline catalog as "no capability" and permanently stripped
// format/reasoningEffort/showThinking (save() then persisted the stripped graph).
// Must only strip when catItem returns a known model without the flag.
{
  const { readFileSync } = await import("node:fs");
  const { resolve, dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const IDX = readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "index.html"), "utf8");
  // Non-greedy match stops at the first top-level `}` of the function — enough to see the strip logic.
  const m = IDX.match(/function\s+refreshLlmOpts\s*\([\s\S]*?\n\}/);
  if (!m) failures.push("editor: could not find refreshLlmOpts() in index.html");
  else {
    const fn = m[0];
    // The bad pattern is an assignment that coerces a miss to {} then deletes knobs on falsy flags.
    if (/const\s+it\s*=\s*catItem\s*\(\s*["']chat["'][^)]*\)\s*\|\|\s*\{\s*\}/.test(fn))
      failures.push("editor refreshLlmOpts: `catItem(...) || {}` treats catalog miss as no-capability (wipes JSON mode on cold boot)");
    if (!/if\s*\(\s*it\s*\)\s*\{/.test(fn) || !/delete\s+f\.format/.test(fn))
      failures.push("editor refreshLlmOpts: must only strip format/reasoning knobs inside `if(it){...}` (known model)");
    else process.stdout.write("  ✓ editor refreshLlmOpts only strips knobs when catItem returns a known model\n");
  }

  // -- Editor REQUEST-time gate (play.html runGraph twin) ---------------------
  // The UI strip above is permissive on catalog miss BY DESIGN (#311), so a knob kept during a
  // miss reaches Run time — the editor must gate the PAYLOAD like play.html does, or a shared
  // #g= graph with format:JSON on an incapable model bills an empty response ("no text in response").
  // 1. chatModelCan must exist and be permissive on catalog miss (`!m || !!m[flag]`) — the
  //    same semantics as play.html's chatModelCan (only a KNOWN-incapable model strips).
  const cmc = IDX.match(/function\s+chatModelCan\s*\([\s\S]*?\n\}/);
  if (!cmc) failures.push("editor: request-time gate needs chatModelCan() in index.html (play.html twin)");
  else if (!/return\s+!m\s*\|\|\s*!!m\[flag\]/.test(cmc[0]))
    failures.push("editor chatModelCan: must stay permissive on catalog miss (`return !m || !!m[flag]`) — never block a typed-in/offline id");
  else process.stdout.write("  ✓ editor chatModelCan exists and is permissive on catalog miss\n");
  // 2. The llm node's run() must strip response_format from the OUTGOING opts (never n.fields)
  //    when the model is known to lack structured_output, and send those gated opts to genChat.
  const run = IDX.match(/llm:\s*\{[\s\S]*?async run\(n, inp, ctx\)\{[\s\S]*?\n    \}\n  \},/);
  if (!run) failures.push("editor: could not find the llm node's run() in index.html");
  else {
    const fn = run[0];
    if (!/if\s*\(\s*opts\.response_format\s*&&\s*!chatModelCan\(\s*mdl\(n\)\s*,\s*["']structured_output["']\s*\)\s*\)\s*delete\s+opts\.response_format/.test(fn))
      failures.push("editor llm run(): must delete opts.response_format for a KNOWN non-structured_output model before genChat (request-time gate, play.html parity)");
    else if (!/ctx\.genChat\(messages,\s*mdl\(n\),\s*opts\)/.test(fn))
      failures.push("editor llm run(): genChat must receive the GATED opts object, not a fresh llmOpts(n)");
    else if (/delete\s+(f|n\.fields)\.format/.test(fn))
      failures.push("editor llm run(): the request-time gate must strip the PAYLOAD only — never delete the node's stored format field");
    else process.stdout.write("  ✓ editor llm run() strips response_format from the request for a known-incapable model\n");
  }
  // 3. The catalog-arrival sweep must reconcile the UI: a knob kept during a catalog miss stays
  //    stale forever unless refreshAllPrices re-runs refreshLlmOpts once real flags exist.
  const rap = IDX.match(/function\s+refreshAllPrices\s*\(\)[^\n]*/);
  if (!rap) failures.push("editor: could not find refreshAllPrices() in index.html");
  else if (!/refreshLlmOpts\(n\)/.test(rap[0]))
    failures.push("editor refreshAllPrices: catalog-arrival sweep must include refreshLlmOpts(n) so knobs kept during a catalog miss reconcile when flags arrive");
  else process.stdout.write("  ✓ editor refreshAllPrices reconciles LLM knobs on catalog arrival\n");
}

if (failures.length) {
  process.stderr.write("\n✗ llm-capability-gates: exported LLM node would send an ungated paid request:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write(`\n✓ llm-capability-gates: ${SCENARIOS.length} scenarios — response_format & input_audio gated by model capability.\n`);
