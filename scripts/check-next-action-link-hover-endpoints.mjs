#!/usr/bin/env node
/**
 * Product · 42 — link-hover endpoint lift toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveLinkEndpoints,
  findLink,
  endpointsForLinkId,
  liftClasses,
  planLinkHoverLift,
  shouldApplyLinkHover,
} from "../vendor/next-action/link-hover-endpoints.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");

function fail(msg) {
  console.error(`✗ next-action-link-hover-endpoints: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "link-hover-endpoints.mjs")), "missing link-hover-endpoints.mjs");

const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");
const helper = readFileSync(join(NA, "link-hover-endpoints.mjs"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

const sampleLink = {
  id: "l1",
  from: { node: "t1", port: "text" },
  to: { node: "img1", port: "prompt" },
};
const links = [
  sampleLink,
  { id: "l2", from: { node: "t1", port: "text" }, to: { node: "llm1", port: "prompt" } },
];

{
  const ends = resolveLinkEndpoints(sampleLink);
  toy("resolve-both-ends", !!(ends && ends.from && ends.to), ends ? `${ends.from.nodeId}.${ends.from.port}→${ends.to.nodeId}.${ends.to.port}` : "null");
  toy("resolve-dirs", !!(ends && ends.from.dir === "out" && ends.to.dir === "in"), ends ? `${ends.from.dir}/${ends.to.dir}` : "—");
  toy("resolve-null-empty", resolveLinkEndpoints(null) === null && resolveLinkEndpoints({}) === null, "null");
  toy("resolve-null-partial", resolveLinkEndpoints({ from: { node: "a" }, to: {} }) === null, "partial");
}

{
  toy("findLink-hit", !!findLink(links, "l1") && findLink(links, "l1").to.port === "prompt", "l1");
  toy("findLink-miss", findLink(links, "nope") === null, "null");
  toy("findLink-coerces", !!findLink([{ id: 3, from: { node: "a", port: "x" }, to: { node: "b", port: "y" } }], "3"), "num id");
}

{
  const ends = endpointsForLinkId(links, "l2");
  toy(
    "endpointsForLinkId",
    !!(ends && ends.to.nodeId === "llm1" && ends.to.port === "prompt"),
    ends ? `${ends.to.nodeId}.${ends.to.port}` : "null"
  );
  toy("endpointsForLinkId-miss", endpointsForLinkId(links, "zz") === null, "null");
}

{
  const cls = liftClasses();
  toy("liftClasses", cls.includes("compatible") && cls.includes("na-link-hover-end") && cls.length === 2, cls.join(","));
}

{
  const plan = planLinkHoverLift(null, links, "l1");
  toy("plan-both", !!(plan && plan.mode === "both" && plan.ends.length === 2), plan ? `n=${plan.ends.length}` : "null");
  toy(
    "plan-from-out",
    !!(plan && plan.ends[0].dir === "out" && plan.ends[0].nodeId === "t1"),
    plan ? `${plan.ends[0].nodeId}:${plan.ends[0].dir}` : "—"
  );
  toy(
    "plan-to-in",
    !!(plan && plan.ends[1].dir === "in" && plan.ends[1].port === "prompt"),
    plan ? `${plan.ends[1].port}:${plan.ends[1].dir}` : "—"
  );
  toy("plan-miss-quiet", planLinkHoverLift(null, links, "missing") === null, "null");
  toy("plan-empty-links", planLinkHoverLift(null, [], "l1") === null, "null");
}

{
  toy("gate-ok", shouldApplyLinkHover({ linkId: "l1" }) === true, "ok");
  toy("gate-engine-off", shouldApplyLinkHover({ linkId: "l1", engineOff: true }) === false, "off");
  toy("gate-reduced-motion", shouldApplyLinkHover({ linkId: "l1", reducedMotion: true }) === false, "rm");
  toy("gate-wire-dragging", shouldApplyLinkHover({ linkId: "l1", wireDragging: true }) === false, "drag");
  toy("gate-no-link", shouldApplyLinkHover({}) === false, "no id");
}

{
  toy("helper-exports-plan", /export function planLinkHoverLift/.test(helper), "planLinkHoverLift");
  toy("helper-exports-resolve", /export function resolveLinkEndpoints/.test(helper), "resolve");
  toy("helper-exports-classes", /export function liftClasses/.test(helper), "liftClasses");
  toy("helper-exports-gate", /export function shouldApplyLinkHover/.test(helper), "gate");
  toy("helper-mentions-42", /Product · 42|· 42/.test(helper), "· 42");
  toy("helper-no-tip-panel", !/mountTipPanel|next-action-panel/.test(helper), "no tip");
}

// Editor wiring pins
{
  toy("html-has-marker-class", /na-link-hover-end/.test(index), "marker");
  toy(
    "html-reduced-motion",
    /linkHoverEndpointsReducedMotion|prefers-reduced-motion[\s\S]{0,280}na-link-hover-end|na-link-hover-end[\s\S]{0,280}prefers-reduced-motion/.test(index),
    "reduced-motion"
  );
  toy("html-apply", index.includes("applyLinkHoverEndpoints"), "apply fn");
  toy("html-clear", index.includes("clearLinkHoverEndpoints"), "clear fn");
  toy("html-import", /link-hover-endpoints\.mjs/.test(index), "import");
  toy(
    "html-pointerover-bind",
    /addEventListener\(\s*["']pointerover["']/.test(index) && /applyLinkHoverEndpoints/.test(index) && /data-link/.test(index),
    "pointerover"
  );
  toy(
    "html-pointerout-bind",
    /addEventListener\(\s*["']pointerout["']/.test(index) && /clearLinkHoverEndpoints/.test(index),
    "pointerout"
  );
  toy(
    "html-startWire-clears",
    /function startWire[\s\S]{0,260}clearLinkHoverEndpoints/.test(index),
    "startWire clear"
  );
  toy(
    "html-geoOn-gate",
    /function applyLinkHoverEndpoints[\s\S]{0,500}geoOn/.test(index),
    "geoOn"
  );
  toy(
    "html-tempWire-quiet",
    /function applyLinkHoverEndpoints[\s\S]{0,400}tempWire/.test(index),
    "tempWire quiet"
  );
  toy(
    "html-uses-compatible",
    /na-link-hover-end/.test(index) && /classList\.add\(\s*["']compatible["']/.test(index),
    "lift classes"
  );
  toy(
    "html-getGraph-link-ids",
    /links:\s*\(graph\.links\|\|\[\]\)\.map\(\s*l\s*=>\s*\(\s*\{\s*id:\s*l\.id/.test(index),
    "getGraph ids"
  );
  toy(
    "surface-exports-plan",
    /planLinkHoverLift\(linkId\)/.test(surface) && /from "\.\/link-hover-endpoints\.mjs"/.test(surface),
    "editor-surface"
  );
  toy(
    "readme-mentions-42",
    /·\s*42|Product · 42|link-hover-endpoints/.test(readme),
    "README · 42"
  );
  toy(
    "readme-check-script",
    readme.includes("check-next-action-link-hover-endpoints.mjs"),
    "README check"
  );
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?42/.test(index) && !/\?product=42/.test(index),
    "no ?product=42"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-42-usage.gif")),
    "product-42-usage.gif"
  );
}

const failed = toys.filter((t) => !t.ok);
console.log(`\nlink-hover-endpoints toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  const hard = failed.filter((f) => f.name !== "usage-gif-present");
  if (hard.length) fail(hard.map((f) => f.name).join(", "));
  console.warn("⚠ usage gif missing — capture next");
  process.exit(2);
}
console.log("✓ next-action-link-hover-endpoints");
