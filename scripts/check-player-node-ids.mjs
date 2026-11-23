#!/usr/bin/env node
import assert from "node:assert/strict";
import { loadEngine } from "./play-engine.mjs";

const app = loadEngine();
const node = (id, type, fields = {}) => ({ id, type, fields });
const link = (from, to, port, fromPort = "text") => ({
  from: { node: from, port: fromPort }, to: { node: to, port },
});
const roundTrip = (data) => app.materialize(JSON.parse(JSON.stringify(data)));

{
  const duplicate = {
    nodes: [node("same", "text", { text: "first" }), node("same", "text", { text: "second" })],
    links: [],
  };
  const diagnostic = /duplicate node id "same" — every node must have a unique id/;
  assert.throws(() => roundTrip(duplicate), diagnostic);
  assert.throws(() => roundTrip({
    ...duplicate,
    nodes: [node("same", "text"), node("same", "future-node-type")],
  }), diagnostic);
  assert.throws(() => roundTrip({
    ...duplicate,
    nodes: [node(42, "text"), node("42", "text")],
  }), /duplicate node id "42"/);

  // runGraph also accepts a materialized graph from callers. A repeated node
  // inserted after materialization still has to fail before any run callbacks.
  const graph = roundTrip({ ...duplicate, nodes: duplicate.nodes.slice(0, 1) });
  graph.nodes.push({ ...duplicate.nodes[1], out: {} });
  await assert.rejects(app.runGraph(graph, {
    onStart: () => assert.fail("ambiguous graph started running"),
  }), diagnostic);
}

{
  const graph = roundTrip({ nodes: [node("__proto__", "text", { text: "standalone" })], links: [] });
  const statuses = [];
  const result = await app.runGraph(graph, { onStatus: (id, kind) => statuses.push([id, kind]) });
  assert.equal(result.nodeErrors, 0);
  assert.equal(graph.byId("__proto__").out.text, "standalone");
  assert.deepEqual(statuses, [["__proto__", "run"], ["__proto__", "done"]]);
}

{
  const graph = roundTrip({
    nodes: [
      node("__proto__", "text", { text: "left" }),
      node("constructor", "text", { text: "right" }),
      node("hasOwnProperty", "join", { sep: "/" }),
      node("toString", "join"),
      node("valueOf", "comment", { text: "annotation" }),
    ],
    links: [
      link("__proto__", "hasOwnProperty", "a"),
      link("constructor", "hasOwnProperty", "b"),
      link("hasOwnProperty", "toString", "a"),
      link("__proto__", "toString", "b", "constructor"),
    ],
  });
  const completed = [];
  const result = await app.runGraph(graph, { onResult: (n) => completed.push(n.id) });
  assert.equal(result.nodeErrors, 0);
  assert.equal(graph.byId("toString").out.text, "left/right");
  assert.deepEqual(new Set(completed), new Set(["__proto__", "constructor", "hasOwnProperty", "toString"]));
  assert.equal(graph.byId("valueOf").type, "comment");
}

{
  const graph = roundTrip({
    nodes: [
      node("__proto__", "join"),
      node("constructor", "join"),
      node("independent", "text", { text: "still runs" }),
    ],
    links: [link("__proto__", "constructor", "a"), link("constructor", "__proto__", "a")],
  });
  const cycles = [];
  const errors = [];
  const result = await app.runGraph(graph, {
    onStart: (_, cyclic) => cycles.push(...cyclic),
    onStatus: (id, kind, message) => { if (kind === "error") errors.push([id, message]); },
  });
  assert.equal(result.nodeErrors, 2);
  assert.deepEqual(cycles, ["__proto__", "constructor"]);
  assert.deepEqual(errors, [["__proto__", "cycle detected"], ["constructor", "cycle detected"]]);
  assert.equal(graph.byId("independent").out.text, "still runs");
}

console.log("✓ Player rejects duplicate IDs, runs prototype-like IDs, and reports real cycles.");
