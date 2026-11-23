#!/usr/bin/env node
// Drive the shipped player with recording fetch. Only declared source ports
// may drive inputs, and a declared optional output may be empty for one run.
import assert from "node:assert/strict";
import { calls, loadEngine } from "./play-engine.mjs";

const app = loadEngine();
const node = (id, type, fields = {}) => ({ id, type, fields });
const wire = (from, port, to, input) => ({ from:{node:from, port}, to:{node:to, port:input} });
const target = node("paid", "llm", {model:"fixture-chat", prompt:"stored fallback"});

for (const [type, port] of [["text","obsoletePort"], ["text","constructor"], ["comment","text"],
  ["vframes","frame0"], ["vframes","frame01"], ["vframes","frame49"], ["decide","yes"], ["endpoint","video"]]) {
  const source = node("source", type, {text:"source value"});
  const graph = app.materialize({nodes:[source, target, node("independent","text",{text:"independent value"})],
    links:[wire("source", port, "paid", "prompt")]});
  calls.length = 0;
  for (const seeds of [undefined, ["paid"]]) {
    await assert.rejects(app.runGraph(graph, {seeds, onStart:()=>assert.fail("invalid graph started")}),
      error => error.message.includes(`Node "source" has no output port "${port}"`));
  }
  assert.equal(graph.links[0].from.port, port, "the player keeps the wire for repair or export");
  assert.deepEqual(calls, [], "the invalid wire cannot fall through to a provider request");
  if (type !== "decide") {
    // Decide branch graphs also have a separate whole-graph planner.
    await app.runGraph(graph, {seeds:["independent"]});
    assert.equal(graph.byId("independent").out.text, "independent value");
  }
}

app.NODE_TYPES.render3d.run = async () => ({image:"still-only"});
const optional = app.materialize({nodes:[node("source","render3d",{mode:"image"}), target],
  links:[wire("source","video","paid","video")]});
calls.length = 0;
assert.equal((await app.runGraph(optional)).nodeErrors, 0);
assert.equal(calls.find(call=>call.url.endsWith("/chat/completions")).body.messages.at(-1).content, "stored fallback");

app.NODE_TYPES.vframes.run = async n => {
  assert.equal(n.fields.frames, 48, "a valid wire still raises the authored frame count");
  return {frame48:"frame-value"};
};
app.NODE_TYPES.endpoint.run = async () => ({video:"routed-video"});
app.NODE_TYPES.inpaint.run = async () => ({layers:"layer-value", images:"variation-value"});
app.NODE_TYPES.tts.run = async () => ({audio:"legacy-audio"});
const tests = [
  {source:node("source","vframes",{frames:1}), port:"frame48", out:"frame-value"},
  {source:node("source","endpoint",{mode:"chat", url:"video: https://fixture.invalid/render"}), port:"video", out:"routed-video"},
  {source:node("source","endpoint",{mode:"chat"}), port:"video", out:"routed-video",
    route:wire("route","text","source","url")},
  {source:node("source","inpaint"), port:"layers", out:"layer-value"},
  {source:node("source","inpaint"), port:"images", out:"variation-value"},
  {source:node("source","audio"), port:"audio", out:"legacy-audio"},
];
for (const {source, port, out, route} of tests) {
  const nodes = [source, node("sink","join")];
  const links = [wire("source",port,"sink","a")];
  if (route) {
    nodes.push(node("route","text",{text:"video: /render"}));
    links.push(route);
  }
  const graph = app.materialize({nodes,links});
  assert.equal((await app.runGraph(graph)).nodeErrors, 0);
  assert.equal(graph.byId("sink").out.text, out);
}
console.log("✓ player rejects undeclared source ports and preserves optional, dynamic and legacy outputs");
