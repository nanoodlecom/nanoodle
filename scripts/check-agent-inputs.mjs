#!/usr/bin/env node
// Pins the library's --input / run({ … }) name resolution: deriveInputs keys,
// resolveInputKey, resolveSettingKey, and the choice-node default.
//
// Workflow.run resolves every user key BEFORE any paid send. A regression that
// maps "Hero" onto the wrong upload, accepts a wired port as an override, or
// treats a stale Choice as "missing required" either posts the wrong media /
// prompt (charged) or dead-ends a graph the play page would have submitted.
//
// check-app-settings.mjs already pins the play-page settings surface (which
// knobs appear, none leak into ioSignature). It never drives resolveInputKey
// or the wired-port refusal. This file drives the REAL NanoodleEngine
// Workflow — the same object CLI / agents call.
//
// Offline. Local-only graphs actually run (text / choice). Network graphs are
// only used for the upfront resolver, which throws before fetch. Zero API spend.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(ROOT, "vendor", "njs-engine.js");

if (!existsSync(VENDOR)) {
  console.log("⊘ skip agent-inputs: vendor/njs-engine.js missing (run scripts/gen-js-engine.mjs)");
  process.exit(0);
}

const failures = [];
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { console.error("  ✗ " + m); failures.push(m); } };

const w = {};
new Function("window", readFileSync(VENDOR, "utf8"))(w);
const ENGINE = w.NanoodleEngine;
if (!ENGINE || typeof ENGINE.Workflow !== "function") {
  console.error("✗ check-agent-inputs: NanoodleEngine.Workflow is not exported");
  process.exit(1);
}

const SRC = readFileSync(VENDOR, "utf8");
ok(/resolveInputKey\(graph, this\.inputs, key\)/.test(SRC),
  "Workflow.run still resolves every input key via resolveInputKey before spending");
ok(/resolveSettingKey\(graph, this\.settings, key\)/.test(SRC),
  "Workflow.run still resolves every setting key via resolveSettingKey before spending");

const wf = (data) => new ENGINE.Workflow(data, { quiet: true, fetch() { throw new Error("fetch must not run"); } });

async function throws(fn, re, m) {
  let err = "";
  try { await fn(); } catch (e) { err = e && e.message ? e.message : String(e); }
  ok(re.test(err), m + (err ? "" : " (did not throw)"));
  return err;
}

console.log("• deriveInputs keys");
{
  const two = wf({
    nodes: [
      { id: "u1", type: "upload", fields: {} },
      { id: "u2", type: "upload", fields: {} },
    ],
    links: [],
  });
  const keys = two.inputs.map((i) => i.key);
  ok(keys.includes("Image") && keys.includes("Image 2"),
    "two untitled uploads dedupe to Image / Image 2, got " + JSON.stringify(keys));
}

{
  const named = wf({
    nodes: [{ id: "u1", type: "upload", name: "Hero", fields: {} }],
    links: [],
  });
  ok(named.inputs.length === 1 && named.inputs[0].key === "Hero",
    "a renamed upload with one required input uses the custom name as the key");
}

{
  const llm = wf({
    nodes: [{ id: "m1", type: "llm", fields: { model: "x" } }],
    links: [],
  });
  const keys = llm.inputs.map((i) => i.key);
  ok(keys.includes("Prompt") && keys.includes("System prompt"),
    "llm surfaces Prompt + optional System prompt");
  ok(llm.inputs.find((i) => i.field === "system")?.optional === true,
    "llm System prompt is optional");
}

{
  const paint = wf({
    nodes: [{ id: "p1", type: "inpaint", fields: { model: "x" } }],
    links: [],
  });
  const fields = paint.inputs.map((i) => i.field).sort();
  ok(fields.includes("image") && fields.includes("mask") && fields.includes("prompt"),
    "unwired inpaint surfaces prompt + image + mask (dropping mask would make the graph un-runnable)");
}

{
  const fed = wf({
    nodes: [
      { id: "t1", type: "text", fields: { text: "x" } },
      { id: "m1", type: "llm", fields: { model: "x" } },
    ],
    links: [{ from: { node: "t1", port: "text" }, to: { node: "m1", port: "prompt" } }],
  });
  ok(!fed.inputs.some((i) => i.nodeId === "m1" && i.field === "prompt"),
    "a wired llm prompt is not offered as an input");
}

console.log("• resolveInputKey via Workflow.run (local text — no network)");
{
  const hero = wf({
    nodes: [{ id: "t1", type: "text", name: "Hero", fields: {} }],
    links: [],
  });
  const byName = await hero.run({ Hero: "hello" });
  ok(byName.get("Hero") === "hello", "custom name Hero resolves and runs");

  const byCase = await hero.run({ hero: "cased" });
  ok(byCase.get("Hero") === "cased", "input keys are case-insensitive");

  const byDot = await hero.run({ "t1.text": "dotted" });
  ok(byDot.get("Hero") === "dotted", "nodeId.field form resolves");
}

{
  const two = wf({
    nodes: [
      { id: "t1", type: "text", name: "Alpha", fields: {} },
      { id: "t2", type: "text", name: "Beta", fields: {} },
    ],
    links: [],
  });
  ok(two.inputs.map((i) => i.key).join(",") === "Alpha,Beta",
    "two renamed text nodes keep their custom names as keys");
  await throws(() => two.run({ text: "x" }), /ambiguous/i,
    "bare field name that matches two nodes is ambiguous — must use nodeId.field");
  await throws(() => two.run({ nope: "x" }), /unknown input/i,
    "an unknown input names the available keys");
}

{
  const wired = wf({
    nodes: [
      { id: "t1", type: "text", fields: { text: "upstream" } },
      { id: "m1", type: "llm", fields: { model: "x" } },
    ],
    links: [{ from: { node: "t1", port: "text" }, to: { node: "m1", port: "prompt" } }],
  });
  const err = await throws(() => wired.run({ "m1.prompt": "override" }), /wired/i,
    "a wired port cannot be supplied as an input (refused before any fetch)");
  ok(/can't be supplied|cannot be supplied|wired/i.test(err),
    "wired-port error names the refusal");
}

console.log("• choice default (stale / empty selected → first option, not missing-required)");
{
  const choice = wf({
    nodes: [{ id: "c1", type: "choice", fields: { options: "alpha\nbeta\ngamma", selected: "" } }],
    links: [],
  });
  const entry = choice.inputs.find((i) => i.field === "selected");
  ok(entry && entry.def === "alpha",
    "empty selected defaults to the first option (play <select> always holds a value)");
  const out = await choice.run({});
  ok(out.get("c1") === "alpha", "run() with no Choice input submits the first option, not missing-required");
}

{
  const stale = wf({
    nodes: [{ id: "c1", type: "choice", fields: { options: "alpha\nbeta", selected: "stale" } }],
    links: [],
  });
  const entry = stale.inputs.find((i) => i.field === "selected");
  ok(entry && entry.def === "alpha",
    "a selected value that is not in options is treated as unset → first option");
}

console.log("• resolveSettingKey via Workflow.run (upfront, no fetch)");
{
  const wired = wf({
    nodes: [
      { id: "t1", type: "text", fields: { text: "motion" } },
      { id: "u1", type: "upload", fields: { image: "data:image/png;base64,AA" } },
      { id: "v1", type: "ivideo", fields: { model: "x" } },
    ],
    links: [
      { from: { node: "t1", port: "text" }, to: { node: "v1", port: "prompt" } },
      { from: { node: "u1", port: "image" }, to: { node: "v1", port: "image" } },
    ],
  });
  ok(!wired.settings.some((s) => s.field === "prompt"),
    "a wired ivideo prompt is not offered as a setting");
  await throws(() => wired.run({}, { settings: { "v1.prompt": "nope" } }), /wired|overridden/i,
    "a wired setting cannot be overridden (refused before any fetch)");
}

{
  const img = wf({
    nodes: [{ id: "i1", type: "image", name: "Poster", fields: { model: "x", prompt: "a cat" } }],
    links: [],
  });
  await throws(() => img.run({}, { settings: { "Poster.size": "1024x1024" } }), /API key|no API key|fetch must not run/i,
    "customName.field settings key resolves (gets past the resolver into the paid-path key check)");
  await throws(() => img.run({}, { settings: { nope: "x" } }), /unknown setting/i,
    "an unknown setting names the available keys");
}

if (failures.length) {
  console.error("✗ check-agent-inputs: " + failures.length + " assertion(s) failed.");
  process.exit(1);
}
console.log("✓ agent inputs: friendly keys, nodeId.field, wired-port refusal, choice default, setting overrides.");
