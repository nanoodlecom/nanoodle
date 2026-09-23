#!/usr/bin/env node
/**
 * Product · 17 — dismiss / undo bandit toys (no network).
 */
import {
  ACTION_VOCAB,
  STORAGE_KEY,
  ENABLED_KEY,
  OUTCOMES,
  createBandit,
  schema,
} from "../vendor/next-action/dismiss-bandit.mjs";

function fail(msg) {
  console.error(`✗ next-action-dismiss-bandit: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

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

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok: !!ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

assert(schema.schemaVersion === 1, "schemaVersion");
assert(ACTION_VOCAB.includes("add:text") && ACTION_VOCAB.includes("add:image"), "vocab");
assert(OUTCOMES.includes("accept") && OUTCOMES.includes("dismiss") && OUTCOMES.includes("undo"), "outcomes");

// 1) default disabled — record no-op, no persist
{
  const store = mockStorage();
  const b = createBandit({ storage: store });
  toy("default-disabled", !b.isEnabled(), `enabled=${b.isEnabled()}`);
  toy("disabled-skips-record", b.record("accept", "add:text") === false, `record=${b.record("accept", "add:text")}`);
  toy("disabled-no-persist", store.getItem(STORAGE_KEY) == null, `key=${store.getItem(STORAGE_KEY)}`);
}

// 2) enable + accept raises scoreBoost
{
  const store = mockStorage();
  const b = createBandit({ storage: store });
  b.setEnabled(true);
  const before = b.scoreBoost("add:image");
  b.record("accept", "add:image");
  b.record("accept", "add:image");
  b.record("accept", "add:image");
  const after = b.scoreBoost("add:image");
  toy("accept-raises-score", after > before, `before=${before.toFixed(3)} after=${after.toFixed(3)}`);
  toy("arm-accept-count", b.getArm("add:image").accepts === 3, JSON.stringify(b.getArm("add:image")));
}

// 3) dismiss lowers score vs accept peer
{
  const store = mockStorage();
  const b = createBandit({ storage: store });
  b.setEnabled(true);
  b.record("accept", "add:music");
  b.record("accept", "add:music");
  b.record("dismiss", "add:text");
  b.record("dismiss", "add:text");
  b.record("dismiss", "add:text");
  const music = b.scoreBoost("add:music");
  const text = b.scoreBoost("add:text");
  toy("dismiss-lowers-vs-accept", music > text, `music=${music.toFixed(3)} text=${text.toFixed(3)}`);
  toy("session-dismissed", b.isSessionDismissed("add:text") && !b.isSessionDismissed("add:music"), `dismissed=${b.sessionDismissed().join(",")}`);
}

// 4) reweight drops dismissed + reorders
{
  const store = mockStorage();
  const b = createBandit({ storage: store });
  b.setEnabled(true);
  b.record("dismiss", "add:llm");
  b.record("accept", "add:image");
  b.record("accept", "add:image");
  const rows = [
    { action: "add:llm", score: 10 },
    { action: "add:image", score: 9 },
    { action: "add:text", score: 4 },
  ];
  const out = b.reweight(rows);
  const img = out.find((r) => r.action === "add:image");
  toy(
    "reweight-drops-dismissed",
    !out.some((r) => r.action === "add:llm") && out[0].action === "add:image" && (img?.banditBoost || 0) > 1,
    `out=${out.map((r) => r.action + "@" + (r.banditBoost || 1).toFixed(2)).join(",")}`
  );
}

// 5) undo reverses dismiss
{
  const store = mockStorage();
  const b = createBandit({ storage: store });
  b.setEnabled(true);
  b.record("dismiss", "add:edit");
  assert(b.isSessionDismissed("add:edit"), "pre-undo dismissed");
  const res = b.undoLast();
  toy("undo-dismiss-ok", res.ok === true && res.was === "dismiss", JSON.stringify(res));
  toy("undo-restores-visibility", !b.isSessionDismissed("add:edit"), `dismissed=${b.sessionDismissed().join(",")}`);
  toy("undo-arm-stats", b.getArm("add:edit").dismisses === 0 && b.getArm("add:edit").undos === 1, JSON.stringify(b.getArm("add:edit")));
}

// 6) unknown actions ignored; bad outcomes ignored
{
  const store = mockStorage();
  const b = createBandit({ storage: store });
  b.setEnabled(true);
  toy("unknown-action-ignored", b.record("accept", "add:spaceship") === false, "spaceship");
  toy("bad-outcome-ignored", b.record("yolo", "add:text") === false, "yolo");
}

// 7) storage round-trip
{
  const store = mockStorage();
  const a = createBandit({ storage: store });
  a.setEnabled(true);
  a.record("accept", "add:ivideo");
  a.record("dismiss", "add:comment");
  const b = createBandit({ storage: store });
  toy("storage-roundtrip-enabled", b.isEnabled(), `enabled=${b.isEnabled()}`);
  toy(
    "storage-roundtrip-arms",
    b.getArm("add:ivideo").accepts === 1 && b.getArm("add:comment").dismisses === 1,
    `ivideo=${JSON.stringify(b.getArm("add:ivideo"))} comment=${JSON.stringify(b.getArm("add:comment"))}`
  );
}

// 8) export local dump · no network shape
{
  const store = mockStorage();
  const b = createBandit({ storage: store });
  b.setEnabled(true);
  b.record("accept", "wire");
  const dump = b.export();
  toy(
    "export-local-shape",
    dump.product === "Product · 17" && dump.arms && dump.vocab && Array.isArray(dump.events) && dump.enabled === true,
    `product=${dump.product} arms=${Object.keys(dump.arms).length}`
  );
  toy("note-format", /^bandit · \d+✓ \d+✗/.test(b.note()), `note=${b.note()}`);
}

const failed = toys.filter((t) => !t.ok);
console.log(`\nnext-action-dismiss-bandit: ${toys.length - failed.length}/${toys.length} toys`);
if (failed.length) {
  fail(`${failed.length} toys failed: ${failed.map((t) => t.name).join(", ")}`);
}
console.log("✓ next-action-dismiss-bandit ok");
