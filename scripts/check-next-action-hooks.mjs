#!/usr/bin/env node
// Next-action wraps run on every editor visit. Exercise the real wrappers:
// adding/wiring/running must delegate and return even when hints throw.
// Offline, no browser, no inference.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const start = html.indexOf("(function bootNextActionHints(){");
assert(start >= 0, "the editor hints boot hook must exist");
const end = html.indexOf("})();", start);
assert(end >= 0, "the editor hints boot hook must close");
const boot = html.slice(start, end + 5);
// Stub only the dynamic import; every installed wrapper is the shipped code.
const executable = boot.replace(/import\(["']\.\/vendor\/next-action\/editor-surface\.mjs["']\)/, "loadSurface()");
assert.notEqual(executable, boot, "boot must dynamically load the browser surface");

async function scenario(surface) {
  const calls = [], records = [];
  const node = { id: "new" }, runResult = Promise.resolve("done"), example = { id: "example" };
  const state = { wireOK: true, mount: null, warns: 0 };
  const ctx = {
    window: { __nextAction: surface(records) },
    graph: { nodes: [], links: [] }, selected: null, NODE_TYPES: { text: {} },
    addNode(...args) { calls.push(["add", ...args]); return node; },
    connect(...args) { calls.push(["connect", ...args]); return state.wireOK; },
    runGroup(...args) { calls.push(["run", this, ...args]); return runResult; },
    select(...args) { calls.push(["select", ...args]); },
    loadExample(...args) { calls.push(["example", ...args]); return example; },
    loadSurface: async () => ({ async mount(opts) { state.mount = opts; } }),
    console: { warn() { state.warns++; } },
    $: () => null, picker: null, renderPicker() {}, renderAddList() {}, translateTree() {},
  };
  vm.runInNewContext(executable, ctx, { filename: "index.html#bootNextActionHints" });
  await new Promise(resolve => setImmediate(resolve));
  const fields = { text: "hello" };
  assert.equal(ctx.addNode("text", 12, 34, fields), node, "Add returns its original node");
  assert.deepEqual(calls.shift(), ["add", "text", 12, 34, fields], "Add preserves arguments");
  assert.equal(ctx.connect("a", "text", "b", "prompt"), true, "wire succeeds");
  assert.deepEqual(calls.shift(), ["connect", "a", "text", "b", "prompt"], "wire preserves endpoints");
  state.wireOK = false;
  assert.equal(ctx.connect("a", "text", "b", "prompt"), false, "failed wire returns false");
  calls.shift();
  const receiver = {}, seeds = ["a"], runContext = {};
  assert.equal(ctx.runGroup.call(receiver, seeds, runContext), runResult, "Run returns the original promise");
  assert.deepEqual(calls.shift(), ["run", receiver, seeds, runContext], "Run preserves receiver and arguments");
  ctx.select(node);
  assert.deepEqual(calls.shift(), ["select", node], "Select still delegates");
  assert.equal(ctx.loadExample(3), example, "example loader returns the original result");
  assert.deepEqual(calls.shift(), ["example", 3], "example loader preserves its index");
  assert(state.mount && typeof state.mount.getGraph === "function", "surface mounts with the graph adapter");
  state.mount.onHints();
  assert.equal(state.warns, 0, "successful surface load remains quiet");
  return records;
}

assert.deepEqual(await scenario(records => ({
  record(token) { records.push(token); },
  refresh() { records.push("refresh"); },
})), ["add:text", "wire", "run", "refresh", "refresh"], "only successful wires record; select/load refresh");
await scenario(() => null);
await scenario(() => ({ record() { throw new Error("hint failed"); }, refresh() { throw new Error("hint failed"); } }));

// Missing browser module must be caught too, so the rest of the editor lives.
let warns = 0;
vm.runInNewContext(executable, {
  addNode() {}, connect() {}, select() {}, loadExample() {},
  console: { warn() { warns++; } },
  loadSurface: async () => { throw new Error("module missing"); },
}, { filename: "index.html#bootNextActionHints-missing" });
await new Promise(resolve => setImmediate(resolve));
assert.equal(warns, 1, "failed surface import is caught");
console.log("✓ next-action-hooks: original add/wire/run return values and arguments survive absent/throwing hints");
