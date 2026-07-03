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
    name: "unknown/typed-in model is permissive — keeps a baked format:JSON (authored behavior preserved)",
    data: { nodes: [node("m1", "llm", { model: "not-in-catalog", prompt: "hi", format: "JSON" })], links: [] },
    check(g, fail) {
      const rf = chatCalls()[0].body.response_format;
      if (!rf || rf.type !== "json_object") fail(`a catalog-absent model must keep the authored response_format (permissive), got ${JSON.stringify(rf)}`);
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
    name: "unknown/typed-in model is permissive — keeps wired audio (authored behavior preserved)",
    data: { nodes: [node("u1", "aupload", { audio: WAV }), node("t1", "text", { text: "Transcribe" }), node("m1", "llm", { model: "not-in-catalog" })],
            links: [link("u1", "audio", "m1", "audio"), link("t1", "text", "m1", "prompt")] },
    check(g, fail) {
      if (!audioPart(chatCalls()[0])) fail("a catalog-absent model must keep the wired audio part (permissive)");
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

if (failures.length) {
  process.stderr.write("\n✗ llm-capability-gates: exported LLM node would send an ungated paid request:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write(`\n✓ llm-capability-gates: ${SCENARIOS.length} scenarios — response_format & input_audio gated by model capability.\n`);
