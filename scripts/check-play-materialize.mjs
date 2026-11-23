#!/usr/bin/env node
/**
 * Play RUNTIME materialize() leftover migrations.
 *
 * Exported apps use play.html RUNTIME. Keep the audio→tts alias, migrate
 * legacy music/tts wires, keep unsupported dependencies for run preflight,
 * and prune links whose endpoints are absent.
 *
 * Does NOT pin media-placeholder scrub — play RUNTIME still does not scrub
 * (library/njs are pinned in check-media-placeholders.mjs).
 *
 * Offline. Drives the real NoodleApp.materialize via play-engine.mjs.
 */
import assert from "node:assert/strict";
import { calls, loadEngine } from "./play-engine.mjs";

let failed = 0;
const fail = (m) => {
  console.error("✗ " + m);
  failed++;
};
const ok = (m) => console.log("✓ " + m);

const app = loadEngine();
if (!app || typeof app.materialize !== "function") {
  console.error("✗ play RUNTIME materialize() is missing");
  process.exit(1);
}

const g = app.materialize({
  nodes: [
    { id: "n2", type: "audio", x: 0, y: 0, fields: { text: "sing" }, name: "Speak" },
    { id: "n5", type: "bogusType", x: 0, y: 0, fields: {} },
    { id: "n7", type: "music", x: 0, y: 0, fields: { prompt: "lofi" } },
    { id: "n1", type: "text", x: 0, y: 0, fields: { text: "hi" } },
    { id: "n8", type: "comment", x: 0, y: 0, fields: { text: "note" } },
    { id: "branch", type: "decide-branch", fields: {} },
  ],
  links: [
    { id: "l1", from: { node: "n1", port: "text" }, to: { node: "n7", port: "text" } },
    { id: "l2", from: { node: "n1", port: "text" }, to: { node: "n2", port: "text" } },
    { id: "l3", from: { node: "n1", port: "text" }, to: { node: "n5", port: "in" } },
    { id: "l9", from: { node: "n1", port: "text" }, to: { node: "n1", port: "x" } },
    { id: "l10", from: { node: "absent", port: "text" }, to: { node: "n1", port: "x" } },
  ],
});

const byId = Object.fromEntries((g.nodes || []).map((n) => [n.id, n]));
const links = g.links || [];

if (g.nodes.length !== 6) fail(`expected 6 surviving nodes, got ${g.nodes.length}`);
else ok("every present node is retained");

if (byId.n5?.type !== "bogusType" || byId.n5.unknown !== true) fail("unsupported node must retain its type and be marked unknown");
else ok("bogusType is retained and marked unsupported");

if (!byId.n2 || byId.n2.type !== "tts") fail("legacy 'audio' node must alias to tts");
else if (byId.n2.name !== "Speak") fail("audio→tts must keep the display name");
else ok("audio → tts (name kept)");

if (!byId.n8 || byId.n8.type !== "comment") fail("comment nodes must survive materialize");
else ok("comment nodes are kept");

if (byId.branch?.type !== "decide" || byId.branch.fields.branch !== true) fail("legacy Decide branch node must keep branch routing");
else ok("decide-branch → decide with branch routing");

if (!links.some((l) => l.id === "l3")) fail("a link to a retained unsupported node must be preserved");
else ok("link to unsupported node survives");
if (links.some((l) => l.id === "l10")) fail("a link with an absent endpoint must be pruned");
else ok("dangling link to absent node is pruned");

const l1 = links.find((l) => l.id === "l1");
const l2 = links.find((l) => l.id === "l2");
if (!l1 || l1.to.port !== "prompt") fail("music header 'text' link must migrate to prompt");
else ok("music text → prompt");
if (!l2 || l2.to.port !== "prompt") fail("tts (ex-audio) 'text' link must migrate to prompt");
else ok("tts text → prompt");

if (!links.some((l) => l.id === "l9")) fail("a link whose endpoints both survive must be kept");
else ok("surviving self-link is kept");

if (!byId.n7) fail("music node missing");
else ok("music node survives with the migrated prompt wire");

if (failed) {
  console.error(`\n${failed} play-materialize check(s) failed`);
  process.exit(1);
}
console.log("✓ play materialize: legacy aliases, unsupported dependencies, dangling links and comments");

for (const type of ["future-text-operator", "constructor", "__proto__"]) {
  const graph = app.materialize({
    nodes: [
      { id: "future", type, fields: { note: true } },
      { id: "call", type: "llm", fields: { model: "fixture-model", prompt: "stored fallback" } },
      { id: "independent", type: "text", fields: { text: "independent output" } },
      { id: "note", type: "comment", fields: { text: "an inert annotation" } },
    ],
    links: [{ id: "prompt-wire", from: { node: "future", port: "text" }, to: { node: "call", port: "prompt" } }],
  });
  assert.equal(graph.byId("future").type, type);
  assert.equal(graph.byId("future").unknown, true);
  assert.equal(app.isInputKind(type), false);
  assert.ok(!app.deriveInputs(graph).some(input => input.nodeId === "future" || input.field === "prompt"));
  assert.ok(!app.deriveSettings(graph).some(setting => setting.nodeId === "future"));
  assert.ok(!app.deriveOutputs(graph).some(node => node.id === "future" || node.id === "note"));
  calls.length = 0;
  for (const seeds of [undefined, ["call"]]) {
    await assert.rejects(app.runGraph(graph, { seeds, onStart: () => assert.fail("invalid run started") }),
      error => error.message.includes(`Unsupported node type "${type}" (node future)`));
  }
  assert.deepEqual(calls, [], "the stored prompt never reaches the provider");
  await app.runGraph(graph, { seeds: ["independent", "note"] });
  assert.equal(graph.byId("independent").out.text, "independent output");
  assert.equal(Object.keys(graph.byId("note").out).length, 0);
}
console.log("✓ unsupported upstream nodes stop paid work before the player starts a run");
