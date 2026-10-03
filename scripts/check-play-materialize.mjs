#!/usr/bin/env node
/**
 * Play RUNTIME materialize() leftover migrations.
 *
 * Editor applyGraphData is pinned in check-graph-persistence.mjs. Exported
 * apps use a second copy in play.html RUNTIME. A dropped audio→tts alias,
 * a kept unknown type, a leftover music/tts header "text" port, or a link
 * to a skipped node silently breaks a shared app on first run.
 *
 * Does NOT pin media-placeholder scrub — play RUNTIME still does not scrub
 * (library/njs are pinned in check-media-placeholders.mjs).
 *
 * Offline. Drives the real NoodleApp.materialize via play-engine.mjs.
 */
import { loadEngine } from "./play-engine.mjs";

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
  ],
  links: [
    { id: "l1", from: { node: "n1", port: "text" }, to: { node: "n7", port: "text" } },
    { id: "l2", from: { node: "n1", port: "text" }, to: { node: "n2", port: "text" } },
    { id: "l3", from: { node: "n1", port: "text" }, to: { node: "n5", port: "in" } },
    { id: "l9", from: { node: "n1", port: "text" }, to: { node: "n1", port: "x" } },
  ],
});

const byId = Object.fromEntries((g.nodes || []).map((n) => [n.id, n]));
const links = g.links || [];

if (g.nodes.length !== 4) fail(`expected 4 surviving nodes, got ${g.nodes.length}`);
else ok("unknown type is dropped (audio aliased, comment kept)");

if (byId.n5) fail("unknown NODE_TYPE (bogusType) must be dropped, not loaded");
else ok("bogusType is gone");

if (!byId.n2 || byId.n2.type !== "tts") fail("legacy 'audio' node must alias to tts");
else if (byId.n2.name !== "Speak") fail("audio→tts must keep the display name");
else ok("audio → tts (name kept)");

if (!byId.n8 || byId.n8.type !== "comment") fail("comment nodes must survive materialize");
else ok("comment nodes are kept");

if (links.some((l) => l.id === "l3")) fail("dangling link to a dropped node must be pruned");
else ok("dangling link (l3 → bogusType) is pruned");

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
console.log("✓ play materialize: audio→tts, drop unknown, text→prompt, prune dangling, keep comment");
