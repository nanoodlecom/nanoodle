#!/usr/bin/env node
// Keep the small example catalog honest: generated pages, reachable results,
// current share graphs, local assets and no credentials or tracking requests.
// Offline; no model calls.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import vm from "node:vm";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GALLERY = join(ROOT, "examples", "gallery");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const fail = (message) => { throw new Error("check-guide-examples: " + message); };
const check = (condition, message) => { if (!condition) fail(message); };
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const decode = (value) => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const sameSet = (actual, expected) => actual.length === expected.length
  && new Set(actual).size === actual.length && actual.every((value) => expected.includes(value));
const savedSlugs = ["character-sprites", "image-model-arena", "photo-to-video", "sing", "talking-avatar"];
const guideSlugs = ["iron-verdict", ...savedSlugs];

for (const script of ["sync-gallery-samples.mjs", "sync-guide-examples.mjs"]) {
  execFileSync(process.execPath, [join(ROOT, "scripts", script), "--check"], { stdio: "inherit" });
}

const samples = JSON.parse(read("examples/gallery/samples.json"));
check(sameSet(samples.map((sample) => sample.slug), savedSlugs), "expected five saved gallery runs plus the separate playable Iron Verdict guide");
check(sameSet(readdirSync(join(ROOT, "guide/examples")).filter((name) => name.endsWith(".html")),
  ["index.html", ...guideSlugs.map((slug) => slug + ".html")]), "unexpected or missing generated guide page");

const index = read("index.html");
const examplesSource = index.match(/const EXAMPLES = \[[\s\S]*?\n\];/)?.[0];
check(examplesSource, "homepage EXAMPLES array is missing");
const examples = vm.runInNewContext(examplesSource + "\nEXAMPLES;", {}, { timeout: 1000 });
check(sameSet(examples.map((example) => example.slug), savedSlugs), "homepage EXAMPLES must match the five saved gallery workflows");

const hub = read("guide/examples/index.html");
const cards = [...hub.matchAll(/class="howto-card" href="\/guide\/examples\/([^"]+)"/g)].map((match) => match[1]);
check(sameSet(cards, guideSlugs), "hub cards do not match the guide set");
const sitemapPaths = [...read("sitemap.xml").matchAll(/<loc>https:\/\/nanoodle.com(\/guide\/examples\/[^<]*)<\/loc>/g)].map((match) => match[1]);
check(sameSet(sitemapPaths, ["/guide/examples/", ...guideSlugs.map((slug) => "/guide/examples/" + slug)]), "sitemap has missing or retired example URLs");
check(/href="\/guide\/examples\/?"/.test(read("guide/index.html")), "guide index must link the example hub");
check(read("llms.txt").includes("https://nanoodle.com/guide/examples/"), "llms.txt must link the example hub");

function localAsset(file) {
  check(typeof file === "string" && /^[\w/-]+\.[\w]+$/.test(file) && !file.includes(".."), "invalid gallery asset path");
  const path = join(GALLERY, file);
  check(existsSync(path) && statSync(path).isFile() && statSync(path).size > 0, "missing or empty asset: " + file);
  return readFileSync(path);
}

function graphIsPortable(graph, label) {
  check(graph.v === 1 && Array.isArray(graph.nodes) && Array.isArray(graph.links), label + " is not a graph");
  const ids = new Set(graph.nodes.map((node) => node.id));
  check(ids.size === graph.nodes.length, label + " has duplicate node IDs");
  check(graph.links.every((link) => ids.has(link.from?.node) && ids.has(link.to?.node)), label + " has a dangling connection");
  const inspect = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)$/i.test(key)) {
        check(child === "" || child === null, label + " contains credentials");
      }
      if (typeof child === "string") check(!/\bsk-nano-[A-Za-z0-9_-]{12,}/.test(child), label + " contains an API key");
      else inspect(child);
    }
  };
  inspect(graph);
}

function graphFromPage(page, label) {
  const links = [...page.matchAll(/<a\b[^>]*href="(https:\/\/nanoodle.com\/#g=[A-Za-z0-9_-]+)"/g)];
  check(links.length === 1, label + " must have one Open workflow share link");
  const bytes = gunzipSync(Buffer.from(links[0][1].split("#g=")[1], "base64url"));
  const graph = JSON.parse(bytes);
  graphIsPortable(graph, label);
  return { bytes, graph };
}

function checkPageLinks(page, route) {
  check(!/<(?:script|iframe|form)\b|\son\w+\s*=|\sping\s*=/i.test(page), route + " must remain a static page without tracking or key collection");
  for (const match of page.matchAll(/\b(href|src|poster)="([^"]+)"/g)) {
    const [, attr, raw] = match;
    const url = new URL(decode(raw), "https://nanoodle.com" + route);
    check(!["javascript:", "data:"].includes(url.protocol), route + " contains an executable URL");
    if (attr !== "href") check(url.origin === "https://nanoodle.com", route + " loads remote media");
    if (url.origin !== "https://nanoodle.com") continue;
    const target = resolve(ROOT, "." + decodeURIComponent(url.pathname));
    check(target === ROOT || target.startsWith(ROOT + "/"), route + " links outside the site");
    const candidates = [target, target + ".html", join(target, "index.html")];
    const file = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    check(file, route + " has a broken local link: " + url.pathname);
    if (url.pathname === "/examples/gallery/" && url.hash) {
      check(readFileSync(file, "utf8").includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), route + " links a missing gallery result");
    }
  }
}

checkPageLinks(hub, "/guide/examples/");
checkPageLinks(read("guide/index.html"), "/guide/");
checkPageLinks(read("guide/run-headless.html"), "/guide/run-headless");
for (const sample of samples) {
  const page = read(`guide/examples/${sample.slug}.html`);
  const route = "/guide/examples/" + sample.slug;
  checkPageLinks(page, route);
  check(page.includes(`<link rel="canonical" href="https://nanoodle.com${route}"`), sample.slug + " has the wrong canonical URL");
  check(page.includes('class="input-list"') && page.includes("Make it yours"), sample.slug + " needs run instructions");
  check(page.includes("NanoGPT key") && page.includes("Reported saved run:"), sample.slug + " must explain BYO-key and saved costs");
  check(page.includes(esc(sample.note)), sample.slug + " omits the saved review note");
  if (sample.workflowNote) check(page.includes(esc(sample.workflowNote)), sample.slug + " omits the difference between current and sampled workflows");
  check(sample.review && !/cover still|not reviewed|pending/i.test(sample.review), sample.slug + " is a placeholder instead of a saved run");
  check(!sample.proof, sample.slug + " must not present detector scores as proof");
  check(Array.isArray(sample.outputs) && sample.outputs.length > 0, sample.slug + " has no saved outputs");
  for (const output of sample.outputs) {
    check(["image", "video", "audio", "text"].includes(output.kind), sample.slug + " has an unknown output type");
    const bytes = localAsset(output.src);
    check(!/NOTE\.txt$/i.test(output.src), sample.slug + " lists a note as an output");
    if (output.kind === "text") check(bytes.toString("utf8").trim() !== sample.note.trim(), sample.slug + " repeats its note as an output");
    check(page.includes('/examples/gallery/' + esc(output.src)), sample.slug + " hides a saved output");
  }
  if (sample.preview) localAsset(sample.preview);
  if (sample.audioReview?.src) localAsset(sample.audioReview.src);
  const graphBytes = localAsset(sample.slug + "/graph.json");
  const workflowBytes = localAsset(sample.workflow);
  check(createHash("sha256").update(graphBytes).digest("hex") === sample.graphSha256, sample.slug + " original graph hash changed");
  check(createHash("sha256").update(workflowBytes).digest("hex") === sample.workflowSha256, sample.slug + " current workflow hash changed");
  graphIsPortable(JSON.parse(graphBytes), sample.slug + " original");
  const { bytes, graph } = graphFromPage(page, sample.slug);
  check(bytes.equals(workflowBytes), sample.slug + " share link differs from Download workflow");
  check(page.includes(`href="/examples/gallery/${sample.slug}/graph.json"`), sample.slug + " must retain its original sampled graph");
  check(page.includes(`href="/examples/gallery/#${sample.slug}"`), sample.slug + " must link its saved result");
  for (const input of sample.inputs) {
    if (input.src) localAsset(input.src);
    if (input.text) {
      check(graph.nodes.some((node) => node.name === input.label && node.fields?.text === input.text), sample.slug + " saved input no longer matches its current workflow");
      check(page.includes(`<em>${esc(input.label)}</em>`), sample.slug + " instructions omit input " + input.label);
    }
  }
}

const iron = read("guide/examples/iron-verdict.html");
checkPageLinks(iron, "/guide/examples/iron-verdict");
const ironUrl = read("scripts/fixtures/iron-verdict-open-url.txt").trim();
check(iron.includes(`href="${ironUrl}"`), "Iron Verdict share link drifted from its fixture");
const { graph: character } = graphFromPage(iron, "character-sprites");
check(character.nodes.some((node) => node.name === "Character"), "character-sprites must open the artwork workflow");
check(iron.includes("Node.js") && iron.includes("ffmpeg") && iron.includes("companion skill"), "Iron Verdict must explain local animation baking");
check(iron.includes('href="https://nanoodle.com/examples/iron-verdict/"') && iron.includes('href="/examples/iron-verdict/iron-verdict.zip"'), "Iron Verdict needs the playable result and downloadable source");
check(iron.includes("selected source images") && iron.includes("separate coding work"), "Iron Verdict must distinguish artwork cost and game coding");

console.log(`✓ check-guide-examples: ${guideSlugs.length} workflows, reachable results and current share graphs; all assets local`);
