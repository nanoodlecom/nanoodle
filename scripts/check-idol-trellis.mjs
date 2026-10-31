#!/usr/bin/env node
// Public catalog + project-note contracts, 2026-10-31. No provider calls/spend.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const src = readFileSync(new URL("index.html", root), "utf8");
const catalog = JSON.parse(readFileSync(new URL("scripts/fixtures/model3d-catalog-20261031.json", root), "utf8"));
function fn(name) {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at >= 0, name);
  let depth = 0;
  for (let j = src.indexOf("{", at); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error(name + " braces");
}
const ctx = vm.createContext({
  _num: x => x != null && Number.isFinite(+x) ? +x : null,
  t: x => x, esc: x => String(x).replace(/[&<>"']/g, ""),
  ArrayBuffer, Uint8Array, Blob,
  NODE_TYPES: { model3d: { modelKind: "model3d", preview: "model3d" } },
  graph: { nodes: [], links: [] },
  effectiveModelFields: n => n.effective || n.fields,
  releaseGlb() {},
});
vm.runInContext(["fmtUsdPlain", "model3dPriceLabels", "norm3d", "model3dStatusUrl", "isSplatOutput", "glbFilename", "glbPreviewUrl", "showResult", "nodeUnitUsd", "workflowCost"].map(fn).join("\n"), ctx);
const trellis = ctx.norm3d(catalog.find(m => m.id.includes("trellis-2")));
ctx.catItem = (_kind, id) => id === trellis.id ? trellis : null;
for (const [resolution, base] of [[512, 0.1], [1024, 0.2], [1536, 0.4]]) {
  for (const texture_size of [1024, 2048, 4096]) {
    const n = { type: "model3d", fields: { model: trellis.id, modelOpts: { resolution, texture_size } } };
    const expected = texture_size === 4096 ? Number((base + 0.05).toFixed(2)) : base;
    assert.equal(ctx.nodeUnitUsd(n), expected);
    assert.equal(ctx.model3dPriceLabels(trellis.pricing, n.fields, trellis.defaults, trellis.params).card, "$" + expected.toFixed(2));
    ctx.graph.nodes = [n];
    assert.equal(ctx.workflowCost().exact, true);
  }
}
assert.equal(ctx.nodeUnitUsd({ type: "model3d", fields: { model: trellis.id } }), 0.2);
ctx.graph.nodes = [{ type: "model3d", fields: { model: trellis.id, modelOpts: { resolution: "future" } } }];
assert.equal(ctx.workflowCost().exact, false);

const plyUrl = "https://cdn.example/output.ply?sig=synthetic";
const output = { kind: "3d", format: "glb", model_url: "https://cdn.example/preview.glb", model_mesh: { url: plyUrl } };
assert.equal(ctx.model3dStatusUrl({ data: { output } }, "speridlabs/idol"), plyUrl);
assert.equal(ctx.model3dStatusUrl({ output }, "tripo3d/v2.5"), output.model_url);
assert.equal(ctx.model3dStatusUrl({ output: { ...output, model_mesh: null } }, "speridlabs/idol"), "");

// Exercise the result-card branch and button actions, not only a source regex.
for (const [url, model, splat, name = "Pumpkin", effective] of [[plyUrl, "speridlabs/idol", true], ["https://cdn.example/signed-result", "speridlabs/idol", true], [plyUrl, trellis.id, true], [output.model_url, "speridlabs/idol", false], [plyUrl, "speridlabs/idol", true, "Pumpkin.ply"], ["https://cdn.example/choice-signed-result", trellis.id, true, "Pumpkin", { model: "speridlabs/idol" }]]) {
  const buttons = { "[data-dl]": {}, "[data-open]": {}, "[data-glb]": {} };
  const result = { innerHTML: "", dataset: {}, classList: { add() {}, remove() {} }, querySelector: s => buttons[s] };
  let mounted = 0, downloaded, opened;
  ctx.mountGlbStage = () => mounted++;
  ctx.downloadUrl = (u, name) => { downloaded = [u, name]; };
  ctx.openUrl = u => { opened = u; };
  const n = { id: "splat", name, effective, type: "model3d", fields: { model }, out: { model: url }, el: { querySelector: () => result } };
  ctx.showResult(n);
  buttons["[data-dl]"].onclick();
  buttons["[data-open]"].onclick();
  assert.equal(mounted, splat ? 0 : 1);
  assert.equal(downloaded[0], url);
  assert.equal(downloaded[1], splat ? "Pumpkin.ply" : "Pumpkin.glb");
  assert.equal(opened, url);
  if (splat) assert.match(result.innerHTML, /Gaussian splat.*3D Gaussian splat viewer/);
}

for (const name of ["play.html", "vendor/njs-engine.js"]) {
  const html = readFileSync(new URL(name, root), "utf8");
  const code = name.endsWith(".html") ? html.match(/<script id="njs-engine"[^>]*>\n([\s\S]*?)\n<\/script>/)[1] : html;
  const window = {};
  new Function("window", code)(window);
  const E = window.NanoodleEngine;
  const client = new E.NanoClient({ apiKey: "synthetic", pollIntervals: { model3d: 1 }, fetch: async () => Response.json({ data: { status: "COMPLETED", output } }) });
  assert.equal(await client.video("speridlabs/idol", "", { mediaKind: "model3d" }, null, { resume: "existing-job" }), plyUrl);
  assert.equal(E.extForMime(E.sniffMime(Buffer.from("ply\nformat binary_little_endian 1.0\n"))), "ply");
}
console.log("✓ Idol PLY result/download and TRELLIS.2 price tiers agree across editor and both generated engines (offline)");
