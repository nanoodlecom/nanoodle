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
if (/last repair|squeaky wheel|gentle acoustic folk|repair-shop game|cozy-repair-shop|acoustic guitar|170-second/i.test(singHowTo)) {
  fail("sing how-to still uses the cozy repair-shop first-click");
}
if (!singHowTo.includes("rooftop getaway") && !singHowTo.includes("last leap")) {
  fail("sing how-to should pitch the rooftop getaway");
}
if (!singHowTo.includes("I made it out, but the city wants me back")) {
  fail("sing how-to should quote the rooftop chorus");
}
if (hub.includes("The song after the last repair")) {
  fail("hub still titles sing as the last repair");
}
const omniHowTo = readFileSync(join(ROOT, "guide", "examples", "omni-flash-turntable.html"), "utf8");
if (/Open this noodle — is the earlier water-bottle/i.test(omniHowTo) || /and Open this noodle — is the earlier water-bottle/i.test(omniHowTo) || /water-bottle|earlier bottle|saved clip is the earlier/i.test(omniHowTo)) {
  fail("omni-flash how-to still says Open this noodle is the bottle run");
}
if (!omniHowTo.includes("chrome motorcycle helmet")) {
  fail("omni-flash how-to should name the chrome helmet first-click");
}
const omniSample = samples.find((s) => s.slug === "omni-flash-turntable");
if (!omniSample) fail("samples.json missing omni-flash-turntable");
if (/water-bottle|earlier water-bottle/i.test(omniSample.note)) {
  fail("omni-flash sample note still describes the water-bottle draft");
}
if (!/chrome motorcycle helmet/i.test(omniSample.note) || !/charcoal/i.test(omniSample.note)) {
  fail("omni-flash sample note should describe the chrome helmet on charcoal plinth");
}
const singSample = samples.find((s) => s.slug === "sing");
if (!singSample) fail("samples.json missing sing");
if (/acoustic guitar|170-second generated song from the earlier cozy/i.test(singSample.note)) {
  fail("sing sample note still describes the cozy-repair-shop run as the saved track");
}
if (!singSample.note.includes("I made it out, but the city wants me back")) {
  fail("sing sample note should quote the rooftop chorus");
}
const faviconHowTo = readFileSync(join(ROOT, "guide", "examples", "favicon.html"), "utf8");
if (/Lumen|weather radio|lighthouse|navy-and-gold/i.test(faviconHowTo)) {
  fail("favicon how-to still uses the Lumen weather-radio first-click");
}
if (!faviconHowTo.includes("Volt") || !/lightning|cyan/i.test(faviconHowTo)) {
  fail("favicon how-to should pitch Volt lightning-cyan");
}
if (hub.includes("A mark that reads at 16px") && !hub.includes("A bolt that reads at 16px")) {
  fail("hub still titles favicon as a generic mark");
}
const faviconSample = samples.find((s) => s.slug === "favicon");
if (!faviconSample) fail("samples.json missing favicon");
if (/Lumen|weather radio|lighthouse|navy-and-gold/i.test(faviconSample.note + JSON.stringify(faviconSample.inputs))) {
  fail("favicon sample still uses the Lumen weather-radio brief");
}
if (!/electric-cyan lightning chevron/i.test(faviconSample.note)) {
  fail("favicon sample note should describe the charcoal + cyan lightning chevron");
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
