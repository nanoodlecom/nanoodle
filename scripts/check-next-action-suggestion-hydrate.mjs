#!/usr/bin/env node
/**
 * Leftover #625 edges: corrupt / hostile localStorage must not throw, only
 * add: rows are reweighted, and accept/ignore boosts stay softly clamped.
 * The production check pins the happy path (ignore sinks, accept rises).
 */
import { createSuggestionMemory, STORAGE_KEY } from "../vendor/next-action/suggestion-memory.mjs";

function fail(msg) {
  console.error(`✗ next-action-suggestion-hydrate: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

function mockStorage(seed) {
  const m = new Map(seed ? Object.entries(seed) : []);
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

{
  const store = mockStorage({ [STORAGE_KEY]: "{not json" });
  let mem;
  try { mem = createSuggestionMemory({ storage: store }); }
  catch (e) { fail(`corrupt JSON must not throw: ${e}`); }
  assert(mem.arm("add:text").accepts === 0 && mem.arm("add:text").ignores === 0, "corrupt JSON hydrates empty");
  assert(mem.noteChoice("add:image", ["add:text"]) === true, "corrupt store still records after a clean start");
}

{
  const store = mockStorage({
    [STORAGE_KEY]: JSON.stringify({
      arms: {
        wire: { accepts: 9, ignores: 0 },
        "set:model": { accepts: 4, ignores: 1 },
        "add:text": { accepts: -4, ignores: "nope" },
        "add:image": 3,
        "add:llm": { accepts: 2, ignores: 1 },
      },
    }),
  });
  const mem = createSuggestionMemory({ storage: store });
  assert(mem.arm("wire").accepts === 0, "non-add keys are not arms");
  assert(mem.arm("add:text").accepts === 0 && mem.arm("add:text").ignores === 0, "negative / NaN counts clamp to 0");
  assert(mem.arm("add:image").accepts === 0, "a non-object arm is dropped");
  assert(mem.arm("add:llm").accepts === 2 && mem.arm("add:llm").ignores === 1, "a well-formed add: arm is kept");
}

{
  const store = {
    getItem() { throw new Error("quota"); },
    setItem() { throw new Error("quota"); },
    removeItem() {},
  };
  let mem;
  try { mem = createSuggestionMemory({ storage: store }); }
  catch (e) { fail(`storage throw on read must not throw: ${e}`); }
  assert(mem.noteChoice("add:text", ["add:text"]) === true, "storage throw on write still records in memory");
  assert(mem.arm("add:text").accepts === 1, "in-memory accept survives a persist failure");
}

{
  const mem = createSuggestionMemory({ storage: null });
  assert(mem.noteChoice("add:text", ["add:text"]) === true, "null storage still records");
  assert(mem.arm("add:text").accepts === 1, "null storage keeps the arm in memory");
}

{
  const mem = createSuggestionMemory({ storage: mockStorage() });
  mem.noteChoice("add:image", ["add:text", "add:text", "add:llm"]);
  assert(mem.arm("add:text").ignores === 1, "a duplicated shown row is one ignore");
  assert(mem.arm("add:llm").ignores === 1, "the other shown row is an ignore");
  mem.noteChoice("add:music", ["add:image"]);
  assert(mem.arm("add:music").accepts === 0, "a pick that was not shown is not an accept");
  assert(mem.arm("add:image").ignores === 1, "the shown row is still an ignore when the pick is off-list");
}

{
  const mem = createSuggestionMemory({ storage: mockStorage() });
  for (let i = 0; i < 8; i++) mem.noteChoice("add:image", ["add:text"]);
  const floor = mem.boost("add:text");
  for (let i = 0; i < 8; i++) mem.noteChoice("add:image", ["add:text"]);
  assert(floor > 0 && mem.boost("add:text") === floor, `ignores clamp to a positive floor, got ${floor} then ${mem.boost("add:text")}`);

  const acc = createSuggestionMemory({ storage: mockStorage() });
  for (let i = 0; i < 12; i++) acc.noteChoice("add:text", ["add:text"]);
  const ceil = acc.boost("add:text");
  for (let i = 0; i < 12; i++) acc.noteChoice("add:text", ["add:text"]);
  assert(ceil > 1 && acc.boost("add:text") === ceil, `accepts clamp, got ${ceil} then ${acc.boost("add:text")}`);
}

{
  const mem = createSuggestionMemory({ storage: mockStorage() });
  for (let i = 0; i < 6; i++) mem.noteChoice("add:image", ["add:text"]);
  const rows = [
    { action: "add:text", score: 10 },
    { action: "wire", score: 10 },
    { action: "set:model", score: 10 },
    { action: "open:examples", score: 10 },
  ];
  const out = mem.reweightRows(rows);
  const text = out.find((r) => r.action === "add:text");
  assert(text && text.score < 10 && text.score > 0, `add:text is softly down-weighted, got ${text && text.score}`);
  assert(out.find((r) => r.action === "wire").score === 10, "wire scores stay put");
  assert(out.find((r) => r.action === "set:model").score === 10, "set:model scores stay put");
  assert(out.find((r) => r.action === "open:examples").score === 10, "open:examples scores stay put");
  assert(mem.reweightRows(null) === null, "null rows pass through");
  assert(mem.reweightRows("x") === "x", "non-array rows pass through");
}

console.log("✓ next-action-suggestion-hydrate: corrupt storage stays quiet, clamps hold, only add: rows move");
