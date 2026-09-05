#!/usr/bin/env node
// Run the real audit with public-catalog fixtures. No network, credentials or model calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const audit = new URL("./check-example-models.mjs", import.meta.url).href;
const editor = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const starter = JSON.parse(readFileSync(new URL("../noodle-graph.json", import.meta.url), "utf8"));
const starterId = starter.nodes.find((n) => n.type === "llm").fields.model;
const ids = [...new Set([
  ...Array.from(editor.matchAll(/\bmodel"?\s*:\s*"([^"]+)"/g), (m) => m[1]),
  ...starter.nodes.map((n) => n.fields?.model).filter(Boolean),
])];

function run(mode) {
  const program = `
    const mode = ${JSON.stringify(mode)};
    const ids = ${JSON.stringify(ids)};
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith("https://nano-gpt.com/api/v1/")) throw new Error("unexpected endpoint");
      if (!(options?.signal instanceof AbortSignal)) throw new Error("catalog fetch has no timeout signal");
      if (mode === "unavailable") throw new Error("fixture catalog outage");
      if (mode === "http-error") return { ok: false, status: 503 };
      let data = ids.filter(id => mode !== "missing-starter" || id !== ${JSON.stringify(starterId)})
        .map(id => ({ id, supported_parameters: { resolutions: ["1mp"] } }));
      if (mode === "empty") data = [];
      if (mode === "malformed") data = {};
      return { ok: true, json: async () => ({ data }) };
    };
    await import(${JSON.stringify(audit)});
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
    encoding: "utf8", timeout: 10000,
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

const good = run("live");
assert.equal(good.status, 0, good.output);
assert.match(good.output, /homepage starter \d+ pins/, "success must include the homepage audit");
console.log("✓ model audit includes starter and gallery with bounded public catalog requests");

const missing = run("missing-starter");
assert.equal(missing.status, 1, missing.output);
assert.match(missing.output, /homepage starter \(noodle-graph\.json\).*gone from the chat catalog/);
console.log("✓ a retired homepage model fails the audit and names the starter file");

for (const mode of ["unavailable", "http-error", "empty", "malformed"]) {
  const result = run(mode);
  assert.equal(result.status, 1, result.output);
  assert.doesNotMatch(result.output, /check-example-models: OK/);
  assert.match(result.output, /INCOMPLETE|refusing to report success/);
  console.log(`✓ ${mode} catalog cannot report a successful audit`);
}
console.log("check-example-models-offline: OK");
