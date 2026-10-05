#!/usr/bin/env node
/**
 * Product · 52 — intent-mode spread toys.
 *
 * Pure helpers + the shipped MoG head (vendor/next-action/intent-spread/weights.json).
 * Row 1 and recipe rows never move; quiet when there is no single selected
 * branch-point node, no Suggested group, one dominant/live mode, or the rows
 * already cover the live modes. Engine off (?na=0) leaves Add untouched.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  MODES,
  MODE_OF_TYPE,
  CONSUMERS_BY_PORT,
  IN_DIM,
  SOURCE,
  featurize,
  modeMixture,
  validWeights,
  anchorContext,
  liveModes,
  spreadIntentRows,
  rowMode,
} from "../vendor/next-action/intent-spread.mjs";
import { predictorDisabled } from "../vendor/next-action/editor-surface.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEIGHTS = join(ROOT, "vendor/next-action/intent-spread/weights.json");
const METRICS = join(ROOT, "vendor/next-action/intent-spread/metrics.json");
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(ROOT, "vendor/next-action/editor-surface.mjs"), "utf8");
const helper = readFileSync(join(ROOT, "vendor/next-action/intent-spread.mjs"), "utf8");
const readme = readFileSync(join(ROOT, "vendor/next-action/README.md"), "utf8");

function fail(msg) {
  console.error(`✗ next-action-intent-spread: ${msg}`);
  process.exit(1);
}
if (!existsSync(WEIGHTS)) fail("missing intent-spread/weights.json");
const w = JSON.parse(readFileSync(WEIGHTS, "utf8"));

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok: !!ok });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

const row = (type, source = "blend", reason = "often added next") => ({ type, action: "add:" + type, reason, source, share: 0.3 });
const imageSel = (extra = {}) => ({
  nodes: [{ id: "t", type: "text" }, { id: "i", type: "image" }],
  links: [{ from: { node: "t", port: "text" }, to: { node: "i", port: "prompt" } }],
  selectedId: "i",
  selectedIds: [],
  ...extra,
});
const types = (r) => r.adds.map((a) => a.type);

// --- weights / head ---
toy("weights-valid", validWeights(w), `format=${w.format} in=${w.inDim} H=${w.hidden} D=${w.zDim}`);
const bytes = statSync(WEIGHTS).size;
toy("weights-tiny", bytes < 40_000, `${bytes} bytes`);
toy("weights-trainer", /ParticleGAN/.test(w.trainer || "") && w.train && w.train.steps > 0 && !w.holdoutGraph, JSON.stringify(w.train || {}).slice(0, 120));
toy("featurize-dim", featurize({ producerType: "image", portType: "image" }).length === IN_DIM, `IN_DIM=${IN_DIM}`);
toy("invalid-weights-null", modeMixture({ format: "nope" }, { producerType: "image", portType: "image" }) === null, "null");

const mixImage = modeMixture(w, { producerType: "image", portType: "image", usedModes: [], contextCounts: { text: 1, image: 1 } });
const piSum = Object.values(mixImage.pi).reduce((a, b) => a + b, 0);
toy("pi-normalized", Math.abs(piSum - 1) < 1e-6, piSum.toFixed(6));
toy("pi-port-modes-only", !("picture" in mixImage.pi) && !("sound" in mixImage.pi) && "refine" in mixImage.pi && "animate" in mixImage.pi, JSON.stringify(mixImage.pi));
const liveImg = liveModes(mixImage);
toy("image-is-branch-point", liveImg.length >= 2 && Math.max(...Object.values(mixImage.pi)) < 0.7, `live=${liveImg.join(",")}`);
const mixText = modeMixture(w, { producerType: "text", portType: "text", usedModes: [], contextCounts: { text: 1 } });
toy("text-has-modes", Object.keys(mixText.pi).length >= 4, JSON.stringify(mixText.pi));
toy("no-consumers-null", modeMixture(w, { producerType: "mupload", portType: "model3d" }) === null, "model3d has no consumers");

// --- anchor ---
{
  const a = anchorContext(imageSel());
  toy("anchor-image", a && a.producerType === "image" && a.portType === "image" && a.usedModes.length === 0, JSON.stringify(a));
  const b = anchorContext(imageSel({
    nodes: [{ id: "t", type: "text" }, { id: "i", type: "image" }, { id: "e", type: "edit" }],
    links: [{ from: { node: "t", port: "text" }, to: { node: "i", port: "prompt" } }, { from: { node: "i", port: "image" }, to: { node: "e", port: "image" } }],
  }));
  toy("anchor-used-modes", b && b.usedModes.join() === "refine" && b.consumerTypes.join() === "edit", JSON.stringify(b && b.usedModes));
  toy("anchor-none", anchorContext(imageSel({ selectedId: null })) === null, "no selection");
  toy("anchor-multi", anchorContext(imageSel({ selectedIds: ["t", "i"] })) === null, "multi-select");
  toy("anchor-comment", anchorContext({ nodes: [{ id: "c", type: "comment" }], selectedId: "c" }) === null, "comment");
}

// --- spread ---
{
  const prior = [row("resize"), row("edit"), row("inpaint")];
  const r = spreadIntentRows(w, imageSel(), prior);
  const modes = types(r).map((t) => rowMode(t, "image"));
  toy("one-intent-spreads", r.changed && new Set(modes).size >= Math.min(3, liveImg.length), `${types(r).join(",")} modes=${modes.join(",")}`);
  toy("row1-stays", r.adds[0].type === "resize" && r.adds[0] === prior[0], r.adds[0].type);
  toy("lifted-tag", r.tagged.length >= 1 && r.tagged.every((t) => {
    const a = r.adds.find((x) => x.type === t);
    return a && a.source === SOURCE && /^another direction · /.test(a.reason);
  }), JSON.stringify(r.adds.map((a) => a.reason)));
  toy("lifted-fit-port", r.adds.every((a) => CONSUMERS_BY_PORT.image.includes(a.type)), types(r).join(","));
  toy("max-three-no-dupes", r.adds.length <= 3 && new Set(types(r)).size === r.adds.length, types(r).join(","));
}
{
  const prior = [row("ivideo"), row("lipsync")];
  const r = spreadIntentRows(w, imageSel(), prior);
  toy("two-animate-spreads", r.changed && r.adds[0].type === "ivideo" && rowMode(r.adds[1].type, "image") !== "animate", types(r).join(","));
}
{
  const prior = [row("image", "recipe", "from Game character kit recipe"), row("edit"), row("resize")];
  const r = spreadIntentRows(w, imageSel(), prior);
  toy("recipe-first-stays", r.adds[0].type === "image" && r.adds[0].source === "recipe", types(r).join(","));
}
{
  const prior = [row("edit"), row("resize"), row("vision", "recipe", "from X recipe")];
  const r = spreadIntentRows(w, imageSel(), prior);
  toy("recipe-row-never-dropped", types(r).includes("vision"), types(r).join(","));
}
{
  const spreadPrior = [row("edit"), row("ivideo"), row("vision")];
  const r = spreadIntentRows(w, imageSel(), spreadPrior);
  toy("already-spread-quiet", !r.changed && r.adds === r.adds && types(r).join() === "edit,ivideo,vision", r.why);
}
toy("empty-suggested-quiet", spreadIntentRows(w, imageSel(), []).changed === false, spreadIntentRows(w, imageSel(), []).why);
toy("no-selection-quiet", !spreadIntentRows(w, imageSel({ selectedId: null }), [row("edit"), row("resize")]).changed, "no anchor");
toy("disabled-quiet", !spreadIntentRows(w, imageSel(), [row("edit"), row("resize")], { disabled: true }).changed, "disabled");
toy("no-head-quiet", !spreadIntentRows(null, imageSel(), [row("edit"), row("resize")]).changed, "no weights");
{
  const top = Math.max(...Object.values(mixImage.pi));
  const r = spreadIntentRows(w, imageSel(), [row("edit"), row("resize")], { dominant: top - 1e-9 });
  toy("dominant-quiet", !r.changed && r.why === "dominant", r.why);
}
{
  const known = new Set(["text", "image", "edit", "resize", "inpaint"]);
  const r = spreadIntentRows(w, imageSel(), [row("edit"), row("resize")], { nodeTypes: known });
  toy("single-known-mode-quiet", !r.changed && r.why === "single-mode", r.why);
}
{
  const r = spreadIntentRows(w, imageSel(), [row("image", "first-trio", "common opening"), row("llm", "first-trio", "common opening")]);
  toy("opening-rows-quiet", !r.changed && r.why === "opening", r.why);
}
{
  const r = spreadIntentRows(w, imageSel(), [row("join"), row("image")]);
  toy("off-branch-rows-make-room", r.changed && r.adds[0].type === "join" && r.adds.slice(1).every((a) => rowMode(a.type, "image")), types(r).join(","));
}
{
  // Image already feeds Edit: the head knows refine is taken.
  const g = imageSel({
    nodes: [{ id: "t", type: "text" }, { id: "i", type: "image" }, { id: "e", type: "edit" }],
    links: [{ from: { node: "t", port: "text" }, to: { node: "i", port: "prompt" } }, { from: { node: "i", port: "image" }, to: { node: "e", port: "image" } }],
  });
  const a = anchorContext(g);
  const covered = spreadIntentRows(w, g, [row("llm", "recipe", "from Game character kit recipe"), row("resize"), row("join")]);
  toy("wired-already-covers-quiet", !covered.changed && covered.why === "already-spread", `${covered.why} used=${a.usedModes}`);
  const r = spreadIntentRows(w, g, [row("llm", "recipe", "from Game character kit recipe"), row("join"), row("text")]);
  const live = liveModes(modeMixture(w, a));
  toy("wired-branch-point-spreads", r.changed && r.adds[0].type === "llm" && types(r).some((t) => rowMode(t, "image") && rowMode(t, "image") !== "describe" && live.includes(rowMode(t, "image"))), `${types(r).join(",")} live=${live}`);
}
{
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) spreadIntentRows(w, imageSel(), [row("resize"), row("edit"), row("inpaint")]);
  const ms = performance.now() - t0;
  toy("cheap-per-render", ms < 500, `${(ms / 2000).toFixed(3)} ms/render`);
}

// --- held-out metrics ---
if (existsSync(METRICS)) {
  const m = JSON.parse(readFileSync(METRICS, "utf8"));
  const s = m.summary || {};
  const sp = s.spread?.multi, bh = s["baseline-head"]?.multi, bc = s["baseline-count"]?.multi;
  toy("heldout-metrics", sp && bh && bc && sp.n >= 5, `multi-mode forks n=${sp && sp.n}`);
  toy("heldout-spread-covers", sp && sp.modeCoverage3 >= bh.modeCoverage3 && sp.modeCoverage3 >= bc.modeCoverage3,
    `spread ${sp && sp.modeCoverage3} vs head ${bh && bh.modeCoverage3} vs count ${bc && bc.modeCoverage3}`);
} else toy("heldout-metrics", false, "missing metrics.json");

// --- corpus / wiring ---
try {
  execFileSync(process.execPath, [join(ROOT, "scripts/bake-intent-forks.mjs"), "--check"], { stdio: "pipe" });
  toy("corpus-current", true, "intent-forks.json");
} catch (e) { toy("corpus-current", false, String(e.stdout || e.message)); }
toy("tags-cover-consumers", Object.values(CONSUMERS_BY_PORT).flat().every((t) => MODES.includes(MODE_OF_TYPE[t])), "every consumer tagged");
toy("helper-no-dom", !/document\.|window\.|innerHTML|classList/.test(helper), "pure");
toy("surface", /intent-spread\/weights\.json/.test(surface) && /spreadIntentRows\(graph, priorAdds\)/.test(surface), "surface loads head");
toy("surface-disabled-api", !/spreadIntentRows/.test(surface.slice(surface.indexOf("function disabledApi"), surface.indexOf("export async function mount"))), "disabled api has no spread");
toy("engine-off", predictorDisabled("?na=0") && predictorDisabled("?product=off"), "?na=0 / ?product=off");
const fn = index.slice(index.indexOf("function intentSpreadMap"), index.indexOf("function nodeRow"));
toy("html-fn", fn.includes("na.disabled") && fn.includes("spreadIntentRows") && fn.includes("return base"), "intentSpreadMap");
toy("html-empty-query-only", /if\(!q\)\{[\s\S]{0,600}intentSpreadMap\(map\)/.test(index) && (index.match(/intentSpreadMap\(/g) || []).length === 2, "Add list empty query only");
toy("html-no-new-ui", !/ghost|pulse|classList|createElement|innerHTML/.test(fn) && !/na-intent/.test(index), "no ghost/pulse/new UI");
toy("no-product-panel", !/\?product=/.test(fn), "no tip panel");
toy("readme", /·\s*52/.test(readme) && readme.includes("check-next-action-intent-spread.mjs"), "readme");

const failed = toys.filter((t) => !t.ok);
console.log(`\nintent-spread toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) fail(`${failed.length} failed`);
console.log("✓ next-action-intent-spread");
