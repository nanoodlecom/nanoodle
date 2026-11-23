#!/usr/bin/env node
// Drive the shipped player with recording fetch. Only declared source ports
// and target ports may be wired, and a declared optional output can be empty.
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

for (const [link, selected, expected] of [
  [wire("absent", "text", "paid", "prompt"), "paid", 'missing source node "absent"'],
  [wire("source", "text", "absent", "prompt"), "source", 'missing target node "absent"'],
  [wire("source", "text", "paid", "promtp"), "paid", 'no input port "promtp"'],
  [wire("source", "text", "paid", "__proto__"), "paid", 'no input port "__proto__"'],
  [{ to:{node:"paid", port:"prompt"} }, "paid", 'missing source node "(missing)"'],
  [{ from:{node:"source", port:"text"} }, "source", 'missing target node "(missing)"'],
  [{}, null, 'missing source node "(missing)"'],
]) {
  const source = node("source", "text", {text:"wired prompt"});
  const paid = node("paid", "llm", {...target.fields, promtp:"also stored"});
  const independent = node("independent", "text", {text:"independent value"});
  const graph = app.materialize({nodes:[source, paid, independent], links:[link]});
  assert.equal(graph.links.length, 1, "malformed link remains available for repair and export");
  calls.length = 0;
  const check = opts => assert.rejects(app.runGraph(graph, opts), error => error.message.includes(expected));
  await check({onStart:()=>assert.fail("malformed workflow began to run")});
  if (selected) await check({seeds:[selected]});
  assert.deepEqual(calls, [], "a malformed link stops provider work before submission");
  await app.runGraph(graph, {seeds:["independent"]});
  assert.equal(graph.byId("independent").out.text, "independent value");
}

const repaired = app.materialize({nodes:[node("source", "text", {text:"wired prompt"}), target],
  links:[wire("source", "text", "paid", "prompt")]});
calls.length = 0;
await app.runGraph(repaired);
assert.equal(calls.find(call=>call.url.endsWith("/chat/completions")).body.messages.at(-1).content, "wired prompt");

app.NODE_TYPES.vframes.run = async n => {
  assert.equal(n.fields.stride, "3");
  return {frame1:"frame-value"};
};
const wiredStride = app.materialize({nodes:[node("source", "text", {text:"3"}), node("frames", "vframes")],
  links:[wire("source", "text", "frames", "stride")]});
assert.equal((await app.runGraph(wiredStride)).nodeErrors, 0);
assert.equal(wiredStride.byId("frames").out.frame1, "frame-value");
console.log("✓ player preserves malformed endpoints, diagnoses bad inputs, and still executes valid wired overrides");
