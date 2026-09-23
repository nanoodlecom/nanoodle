#!/usr/bin/env node
/**
 * Product · 5 — local action ring buffer toys (no network / no weights).
 */
import {
  ACTION_VOCAB,
  RING_CAPACITY,
  STORAGE_KEY,
  ENABLED_KEY,
  createRing,
  schema,
} from "../vendor/next-action/ring.mjs";

function fail(msg) {
  console.error(`✗ next-action-ring: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

/** Minimal localStorage mock */
function mockStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v));
    },
    removeItem: (k) => {
      m.delete(k);
    },
    _map: m,
  };
}

assert(schema.schemaVersion === 1, "schemaVersion");
assert(ACTION_VOCAB.includes("add:text") && ACTION_VOCAB.includes("wire"), "vocab");
assert(RING_CAPACITY >= 32 && RING_CAPACITY <= 64, `capacity in 32–64, got ${RING_CAPACITY}`);

// Disabled by default — record is a no-op, no persist
{
  const store = mockStorage();
  const ring = createRing({ storage: store, capacity: 8 });
  assert(!ring.isEnabled(), "default disabled");
  assert(ring.record("add:text") === false, "disabled skips record");
  assert(ring.size() === 0, "disabled size 0");
  assert(store.getItem(STORAGE_KEY) == null, "disabled skips persist");
}

// Enable → push N tokens, wrap capacity
{
  const store = mockStorage();
  let t = 1000;
  const ring = createRing({ storage: store, capacity: 4, now: () => ++t });
  ring.setEnabled(true);
  assert(ring.isEnabled(), "enabled");
  for (const tok of ["add:text", "add:llm", "wire", "run", "add:image"]) {
    assert(ring.record(tok) === true, `record ${tok}`);
  }
  assert(ring.size() === 4, "wrap capacity");
  const toks = ring.get();
  assert(JSON.stringify(toks) === JSON.stringify(["add:llm", "wire", "run", "add:image"]), "newest-last window");
  assert(store.getItem(STORAGE_KEY), "persisted");
  assert(store.getItem(ENABLED_KEY) === "1", "enabled flag persisted");
}

// Persist round-trip
{
  const store = mockStorage();
  const a = createRing({ storage: store, capacity: 8 });
  a.setEnabled(true);
  a.record("add:text");
  a.record("wire");
  const b = createRing({ storage: store, capacity: 8 });
  assert(b.isEnabled(), "rehydrate enabled");
  assert(JSON.stringify(b.get()) === JSON.stringify(["add:text", "wire"]), "rehydrate tokens");
}

// Export shape matches vocab; unknown tokens rejected
{
  const ring = createRing({ storage: null, capacity: 8 });
  ring.setEnabled(true);
  assert(ring.record("not-a-token") === false, "reject unknown");
  ring.record("open:examples");
  const dump = ring.export();
  assert(dump.product === "Product · 5", "export product");
  assert(dump.schemaVersion === schema.schemaVersion, "export schemaVersion");
  assert(Array.isArray(dump.vocab) && dump.vocab.length === ACTION_VOCAB.length, "export vocab");
  assert(dump.entries.length === 1 && dump.entries[0].token === "open:examples", "export entries");
  assert(typeof dump.exportedAt === "number", "export timestamp");
}

// Disable clears persist writes going forward; clear() empties
{
  const store = mockStorage();
  const ring = createRing({ storage: store, capacity: 8 });
  ring.setEnabled(true);
  ring.record("run");
  ring.clear();
  assert(ring.size() === 0, "cleared");
  assert(store.getItem(STORAGE_KEY) == null, "storage cleared");
  ring.setEnabled(false);
  ring.record("add:text");
  assert(ring.size() === 0, "disabled after clear still skips");
}

console.log(
  `✓ next-action-ring: capacity=${RING_CAPACITY} V=${ACTION_VOCAB.length} schema=${schema.schemaVersion}`
);
