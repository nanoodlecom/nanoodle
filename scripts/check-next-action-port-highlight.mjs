#!/usr/bin/env node
/**
 * Product · 21 — wire-drop port highlight polish toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { pickRingTarget } from "../vendor/next-action/port-suggest.mjs";
import {
  rankRingTargets,
  tierFor,
  classesForTier,
  shouldDim,
  MAX_FIT,
  FIT_SHARE,
} from "../vendor/next-action/port-highlight.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-port-highlight: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "port-highlight.mjs")), "missing port-highlight.mjs");
assert(existsSync(CORPUS), "missing port-suggest.json");

const tables = JSON.parse(readFileSync(CORPUS, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

{
  // text|text → image.prompt (8) leads llm.prompt (3) — confident likely
  const plan = rankRingTargets(tables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    srcNodeId: "t1",
    targets: [
      { nodeId: "img1", type: "image", port: "prompt" },
      { nodeId: "llm1", type: "llm", port: "prompt" },
      { nodeId: "join1", type: "join", port: "b" },
    ],
  });
  toy("confident-plan", !!plan && plan.items.length >= 1, plan ? `n=${plan.items.length}` : "null");
  toy(
    "likely-is-image-prompt",
    plan && plan.items[0].tier === "likely" && plan.items[0].type === "image" && plan.items[0].port === "prompt",
    plan ? `${plan.items[0].type}.${plan.items[0].port}` : "—"
  );
  toy("dimOthers", !!(plan && plan.dimOthers), String(!!(plan && plan.dimOthers)));
  const fits = (plan && plan.items.filter((i) => i.tier === "fit")) || [];
  toy("has-fit-runners", fits.length >= 1, `fits=${fits.map((f) => f.type + "." + f.port).join(",")}`);
  toy("max-fit-cap", fits.length <= MAX_FIT, `fits=${fits.length} max=${MAX_FIT}`);
  toy(
    "aligns-pickRingTarget",
    (() => {
      const one = pickRingTarget(tables, {
        dir: "out",
        srcType: "text",
        srcPort: "text",
        srcNodeId: "t1",
        targets: [
          { nodeId: "img1", type: "image", port: "prompt" },
          { nodeId: "llm1", type: "llm", port: "prompt" },
          { nodeId: "join1", type: "join", port: "b" },
        ],
      });
      return !!(one && plan && one.nodeId === plan.items[0].nodeId && one.port === plan.items[0].port);
    })(),
    "likely matches pickRingTarget"
  );
  toy(
    "tierFor-likely",
    tierFor(plan, "img1", "prompt") === "likely",
    String(tierFor(plan, "img1", "prompt"))
  );
  toy(
    "shouldDim-unranked",
    shouldDim(plan, "other", "prompt") === true,
    "unranked dims"
  );
  toy(
    "shouldDim-ranked-false",
    shouldDim(plan, "img1", "prompt") === false,
    "ranked not dimmed"
  );
  toy(
    "classesForTier",
    classesForTier("likely").join() === "likely" &&
      classesForTier("fit").join() === "fit" &&
      classesForTier(null).length === 0,
    "class map"
  );
}

{
  // Flat rivals → quiet (same as pickRingTarget)
  const flatTables = {
    topTargets: {
      "text|text": { "llm|prompt": 3, "image|prompt": 3 },
    },
  };
  const plan = rankRingTargets(flatTables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    targets: [
      { nodeId: "a", type: "llm", port: "prompt" },
      { nodeId: "b", type: "image", port: "prompt" },
    ],
  });
  toy("flat-quiet", plan === null, plan ? "leaked" : "null");
}

{
  const plan = rankRingTargets(tables, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    targets: [],
  });
  toy("empty-targets-quiet", plan === null, "null");
}

{
  const plan = rankRingTargets(null, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    targets: [{ nodeId: "a", type: "image", port: "prompt" }],
  });
  toy("no-tables-quiet", plan === null, "null");
}

{
  // Low counts below MIN_PAIR stay quiet
  const weak = {
    topTargets: { "text|text": { "image|prompt": 1 } },
  };
  const plan = rankRingTargets(weak, {
    dir: "out",
    srcType: "text",
    srcPort: "text",
    targets: [{ nodeId: "a", type: "image", port: "prompt" }],
  });
  toy("below-min-pair-quiet", plan === null, plan ? "leaked" : "null");
}

{
  toy("fit-share-positive", FIT_SHARE > 0 && FIT_SHARE < 1, `FIT_SHARE=${FIT_SHARE}`);
}

// Editor wiring pins
{
  toy("html-has-fit-css", /\.port\.fit\s*\{/.test(index), ".port.fit");
  toy("html-has-dim-css", /\.port\.compatible\.dim\s*\{/.test(index), ".port.compatible.dim");
  toy("html-applyPortHighlight", index.includes("applyPortHighlight"), "fn");
  toy("html-rankRingTargets-call", /rankRingTargets\s*\(/.test(index), "call site");
  toy(
    "html-cleanup-fit-dim",
    /classList\.remove\([^)]*fit[^)]*dim/.test(index) ||
      /classList\.remove\("compatible","snap","likely","fit","dim"\)/.test(index),
    "cleanup"
  );
  toy("html-startWire-uses-apply", /applyPortHighlight\(\s*targets\s*,\s*anchor\s*\)/.test(index), "startWire");
  toy(
    "surface-exports-rankRingTargets",
    /rankRingTargets\(query\)/.test(surface) && /from "\.\/port-highlight\.mjs"/.test(surface),
    "editor-surface"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?21/.test(index) && !/\?product=21/.test(index),
    "no ?product=21"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-21-usage.gif")),
    "product-21-usage.gif"
  );
}

// Exercise the shipped gesture handler, including canceled pickup of an existing wire.
{
  const wireSource = index.slice(index.indexOf("function startWire(port, e){"), index.indexOf("// Rebuild a node's DOM", index.indexOf("function startWire(port, e){")));
  function harness(pickup = false) {
    const listeners = new Map();
    function port(node, dir, name) {
      const classes = new Set(), attrs = new Map();
      return { dataset: { node, dir, port: name, ptype: "text" },
        classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), contains: x => classes.has(x) },
        getAttribute: k => attrs.get(k), removeAttribute: k => attrs.delete(k),
        set title(v) { attrs.set("title", v); } };
    }
    const source = port("source", "out", "text"), target = port("target", "in", "prompt"), alternate = port("alternate", "in", "prompt");
    const links = pickup ? [{ id: "old", from: { node: "source", port: "text" }, to: { node: "target", port: "prompt" } }] : [];
    let fills = 0, quickAdds = 0;
    const ctx = { graph: { links }, tempWire: null, draggingLinkId: null,
      window: { addEventListener: (k, f) => listeners.set(k, f), removeEventListener: (k, f) => { if (listeners.get(k) === f) listeners.delete(k); } },
      document: { querySelector: () => source, elementFromPoint: () => alternate },
      editor: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      closeQuickAdd() {}, redraw() {}, refreshPortFills() { fills++; },
      portCenter: () => ({ x: 20, y: 20 }), compatiblePorts: () => [target, alternate],
      applyPortHighlight() { target.classList.add("likely"); alternate.classList.add("dim"); target.title = "suggested"; target.dataset.sugTitle = "1"; },
      nearestPort: () => null, connect: (node, port, toNode, toPort) => { ctx.graph.links.push({ id: "new", from: { node, port }, to: { node: toNode, port: toPort } }); return true; },
      removeLink: id => { ctx.graph.links = ctx.graph.links.filter(l => l.id !== id); }, dismissConnectHint() {}, openQuickAdd() { quickAdds++; },
    };
    alternate.closest = () => alternate;
    vm.createContext(ctx); new vm.Script(wireSource).runInContext(ctx);
    const event = { pointerId: 7, clientX: 20, clientY: 20, preventDefault() {}, stopPropagation() {} };
    ctx.startWire(pickup ? target : source, event);
    return { ctx, target, alternate, listeners, event, fills: () => fills, quickAdds: () => quickAdds };
  }
  const h = harness(true), before = JSON.stringify(h.ctx.graph.links);
  h.listeners.get("pointercancel")({ pointerId: 99 });
  toy("other-pointer-cancel-ignored", h.ctx.tempWire !== null, "active drag retained");
  h.listeners.get("pointercancel")({ pointerId: 7 });
  toy("cancel-restores-pickup", JSON.stringify(h.ctx.graph.links) === before && h.ctx.draggingLinkId === null && h.fills() >= 2, "original wire restored");
  toy("cancel-clears-gesture", h.listeners.size === 0 && h.ctx.tempWire === null && !h.target.classList.contains("likely") && !h.alternate.classList.contains("dim") && !h.target.getAttribute("title") && h.quickAdds() === 0, "no rings, listeners or menu");
  const esc = harness(true);
  esc.listeners.get("keydown")({ key: "Escape", preventDefault() {} });
  toy("escape-restores-pickup", esc.ctx.graph.links.length === 1 && esc.ctx.tempWire === null && esc.listeners.size === 0 && esc.quickAdds() === 0, "keyboard cancellation retains link");
  const chosen = harness();
  chosen.listeners.get("pointerup")({ ...chosen.event, clientX: 40 });
  toy("dim-target-still-connects", chosen.ctx.graph.links[0]?.to.node === "alternate" && chosen.listeners.size === 0, "all valid targets selectable");
}

const failed = toys.filter((t) => !t.ok);
console.log(`\nport-highlight toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  fail(failed.map((f) => f.name).join(", "));
}
console.log("✓ next-action-port-highlight");
