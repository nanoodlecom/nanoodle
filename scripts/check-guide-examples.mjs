#!/usr/bin/env node
// Guard: guide/examples/*.html stay generated from samples.json, and the
// hub is discoverable from the guide index, sitemap, and llms.txt.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const fail = (msg) => { console.error("✗ check-guide-examples: " + msg); process.exit(1); };

execFileSync(process.execPath, [join(ROOT, "scripts", "sync-guide-examples.mjs"), "--check"], {
  stdio: "inherit",
});

const samples = JSON.parse(readFileSync(join(ROOT, "examples", "gallery", "samples.json"), "utf8"));
const slugs = ["iron-verdict", ...samples.map((s) => s.slug)];
const paths = ["/guide/examples/", ...slugs.map((s) => `/guide/examples/${s}`)];

const sitemap = readFileSync(join(ROOT, "sitemap.xml"), "utf8");
for (const p of paths) {
  if (!sitemap.includes(`https://nanoodle.com${p}`)) fail(`sitemap.xml is missing ${p}`);
}

const guide = readFileSync(join(ROOT, "guide", "index.html"), "utf8");
if (!guide.includes('href="/guide/examples/"') && !guide.includes('href="/guide/examples"')) {
  fail("guide/index.html does not link to /guide/examples/");
}

const llms = readFileSync(join(ROOT, "llms.txt"), "utf8");
if (!llms.includes("https://nanoodle.com/guide/examples/")) {
  fail("llms.txt does not mention https://nanoodle.com/guide/examples/");
}

const cinematic = readFileSync(join(ROOT, "guide", "examples", "cinematic-character-still.html"), "utf8");
if (/piano tuner/i.test(cinematic)) {
  fail("cinematic how-to still names the piano tuner");
}
if (!cinematic.includes("cinematic-character-still/Still.png")) {
  fail("cinematic how-to should hero the reviewed courier still");
}
const hub = readFileSync(join(ROOT, "guide", "examples", "index.html"), "utf8");
if (/piano tuner/i.test(hub)) {
  fail("hub still names the piano tuner");
}
if (!hub.includes("cinematic-character-still/preview.webp")) {
  fail("hub should thumb the courier preview");
}
if (hub.includes("Spoken workshop introduction")) {
  fail("hub still titles the talking-avatar card as a workshop intro");
}
const singHowTo = readFileSync(join(ROOT, "guide", "examples", "sing.html"), "utf8");
if (/last repair|squeaky wheel|gentle acoustic folk|repair-shop game/i.test(singHowTo)) {
  fail("sing how-to still uses the cozy repair-shop first-click");
}
if (!singHowTo.includes("rooftop getaway") && !singHowTo.includes("last leap")) {
  fail("sing how-to should pitch the rooftop getaway");
}
if (hub.includes("The song after the last repair")) {
  fail("hub still titles sing as the last repair");
}
const omniHowTo = readFileSync(join(ROOT, "guide", "examples", "omni-flash-turntable.html"), "utf8");
if (/Open this noodle — is the earlier water-bottle/i.test(omniHowTo) || /and Open this noodle — is the earlier water-bottle/i.test(omniHowTo)) {
  fail("omni-flash how-to still says Open this noodle is the bottle run");
}
if (!omniHowTo.includes("chrome motorcycle helmet")) {
  fail("omni-flash how-to should name the chrome helmet first-click");
}
for (const slug of slugs) {
  const page = readFileSync(join(ROOT, "guide", "examples", slug === "iron-verdict" ? "iron-verdict.html" : `${slug}.html`), "utf8");
  if (page.includes("how to use this noodle")) {
    fail(`${slug} still uses workshop-doc page title phrasing`);
  }
}

const openUrl = join(ROOT, "scripts", "fixtures", "iron-verdict-open-url.txt");
if (!existsSync(openUrl)) fail("missing scripts/fixtures/iron-verdict-open-url.txt");
const url = readFileSync(openUrl, "utf8").trim();
if (!url.startsWith("https://nanoodle.com/#g=")) fail("Iron Verdict open URL is not a nanoodle #g= share link");

console.log(`✓ check-guide-examples: ${slugs.length} how-to slugs, hub listed in guide/sitemap/llms.txt`);
