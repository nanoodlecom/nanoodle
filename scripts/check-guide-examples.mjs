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
if (hub.includes("Look at camera. Say the line.") && !hub.includes("Look at camera. Clear the channel.")) {
  fail("hub still titles talking-avatar as Look at camera. Say the line.");
}
if (!hub.includes("Look at camera. Clear the channel.")) {
  fail("hub should title talking-avatar as Look at camera. Clear the channel.");
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
if (singSample.preview !== "sing/preview.webp") {
  fail("sing sample preview should be sing/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "sing", "preview.webp"))) {
  fail("examples/gallery/sing/preview.webp is missing");
}
if (!hub.includes("sing/preview.webp")) {
  fail("hub should thumb the sing rooftop cover");
}
if (!singHowTo.includes("sing/preview.webp")) {
  fail("sing how-to should show the rooftop cover still");
}
if (/No preview image was saved|No still preview/i.test(singHowTo)) {
  fail("sing how-to still says no preview / no still preview");
}
const examplesSrc = readFileSync(join(ROOT, "index.html"), "utf8");
if (!/slug:"sing"[\s\S]{0,200}thumb:"examples\/gallery\/sing\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES sing thumb should be examples/gallery/sing/preview.webp");
}
if (/slug==="sing"\s*\n\s*\? '<blockquote class="ex-quote"/.test(examplesSrc)) {
  fail("EXAMPLES sing card still uses the lyrics-quote fallback instead of the cover still");
}
const deslopSample = samples.find((s) => s.slug === "deslop");
if (!deslopSample) fail("samples.json missing deslop");
if (deslopSample.preview !== "deslop/preview.webp") {
  fail("deslop sample preview should be deslop/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "deslop", "preview.webp"))) {
  fail("examples/gallery/deslop/preview.webp is missing");
}
if (!hub.includes("deslop/preview.webp")) {
  fail("hub should thumb the deslop night-raid cover");
}
const deslopHowTo = readFileSync(join(ROOT, "guide", "examples", "deslop.html"), "utf8");
if (!deslopHowTo.includes("deslop/preview.webp")) {
  fail("deslop how-to should show the night-raid cover still");
}
if (/No preview image was saved/i.test(deslopHowTo)) {
  fail("deslop how-to still says no preview image was saved");
}
if (!/slug:"deslop"[\s\S]{0,200}thumb:"examples\/gallery\/deslop\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES deslop thumb should be examples/gallery/deslop/preview.webp");
}
if (/slug==="deslop"\s*\n\s*\? '<blockquote class="ex-quote"/.test(examplesSrc)) {
  fail("EXAMPLES deslop card still uses the quote fallback instead of the cover still");
}
const fableSample = samples.find((s) => s.slug === "fable-five-step");
if (!fableSample) fail("samples.json missing fable-five-step");
if (fableSample.preview !== "fable-five-step/preview.webp") {
  fail("fable-five-step sample preview should be fable-five-step/preview.webp");
}
if (/Sample pending/i.test(fableSample.review + fableSample.note)) {
  fail("fable-five-step sample still says Sample pending");
}
if (!/cover still/i.test(fableSample.note) || !/not a paid|no paid/i.test(fableSample.note)) {
  fail("fable-five-step sample note should say it is a cover still, not a paid Fable QC transcript");
}
if (!existsSync(join(ROOT, "examples", "gallery", "fable-five-step", "preview.webp"))) {
  fail("examples/gallery/fable-five-step/preview.webp is missing");
}
if (!hub.includes("fable-five-step/preview.webp")) {
  fail("hub should thumb the fable-five-step cover");
}
const fableHowTo = readFileSync(join(ROOT, "guide", "examples", "fable-five-step.html"), "utf8");
if (!fableHowTo.includes("fable-five-step/preview.webp")) {
  fail("fable-five-step how-to should show the cover still");
}
if (/No preview image was saved|Reviewed plan incoming|Sample pending/i.test(fableHowTo)) {
  fail("fable-five-step how-to still says pending / no preview");
}
if (!/slug:"fable-five-step"[\s\S]{0,200}thumb:"examples\/gallery\/fable-five-step\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES fable-five-step thumb should be examples/gallery/fable-five-step/preview.webp");
}
const p2vSample = samples.find((s) => s.slug === "photo-to-video");
if (!p2vSample) fail("samples.json missing photo-to-video");
if (p2vSample.preview !== "photo-to-video/preview.webp") {
  fail("photo-to-video sample preview should be photo-to-video/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "photo-to-video", "preview.webp"))) {
  fail("examples/gallery/photo-to-video/preview.webp is missing");
}
if (/ceramic mug|hot tea|oak desk|wisp of steam|window light/i.test(JSON.stringify(p2vSample.inputs))) {
  fail("photo-to-video sample inputs still use the cozy tea-mug first-click");
}
if (!/Volt|night-ride radio|rain-slick/i.test(JSON.stringify(p2vSample.inputs))) {
  fail("photo-to-video sample inputs should pitch the Volt night-ride radio");
}
if (!/tea-mug|historical|does not match|not regenerated/i.test(p2vSample.note)) {
  fail("photo-to-video sample note should say the saved MP4 is the earlier tea-mug sample");
}
if (!/cover still/i.test(p2vSample.note) || !/night-ride radio/i.test(p2vSample.note)) {
  fail("photo-to-video sample note should name the Volt night-ride cover still");
}
if (!hub.includes("photo-to-video/preview.webp")) {
  fail("hub should thumb the photo-to-video night-ride cover");
}
if (/A mug that starts breathing/i.test(hub)) {
  fail("hub lede still says a mug that starts breathing");
}
if (hub.includes("A still that starts breathing")) {
  fail("hub still titles photo-to-video as a still that starts breathing");
}
const p2vHowTo = readFileSync(join(ROOT, "guide", "examples", "photo-to-video.html"), "utf8");
if (/ceramic mug|hot tea|oak desk|A still that starts breathing/i.test(p2vHowTo)) {
  fail("photo-to-video how-to still uses the cozy tea-mug first-click");
}
if (!/night-ride radio/i.test(p2vHowTo) || !/Volt/i.test(p2vHowTo)) {
  fail("photo-to-video how-to should pitch the Volt night-ride radio");
}
if (!p2vHowTo.includes("photo-to-video/preview.webp")) {
  fail("photo-to-video how-to should show the night-ride cover still");
}
if (!/historical|tea-mug|not regenerated/i.test(p2vHowTo)) {
  fail("photo-to-video how-to should say the saved MP4 is the earlier tea-mug sample");
}
if (!/slug:"photo-to-video"[\s\S]{0,200}thumb:"examples\/gallery\/photo-to-video\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES photo-to-video thumb should be examples/gallery/photo-to-video/preview.webp");
}
if (/slug:"photo-to-video"[\s\S]{0,80}desc:"locked camera, one thin wisp of steam"/.test(examplesSrc)) {
  fail("EXAMPLES photo-to-video desc still uses the tea-mug steam line");
}
if (!/slug:"photo-to-video"[\s\S]{0,80}desc:"locked camera, rain on a night-ride radio"/.test(examplesSrc)) {
  fail("EXAMPLES photo-to-video desc should pitch rain on a night-ride radio");
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
const fiboHowTo = readFileSync(join(ROOT, "guide", "examples", "fibo-studio-still.html"), "utf8");
if (/amber glass|hand-soap|limestone|backlit translucent glass|Light a product that doesn/i.test(fiboHowTo)) {
  fail("fibo-studio-still how-to still uses the amber soap-bottle first-click");
}
if (!/Volt/i.test(fiboHowTo) || !/charcoal/i.test(fiboHowTo) || !/cyan/i.test(fiboHowTo)) {
  fail("fibo-studio-still how-to should pitch the Volt charcoal + cyan radio");
}
if (hub.includes("Light a product that doesn't exist")) {
  fail("hub still titles fibo-studio-still as a generic product light");
}
if (!hub.includes("A radio on dark slate")) {
  fail("hub should title fibo-studio-still as a radio on dark slate");
}
const fiboSample = samples.find((s) => s.slug === "fibo-studio-still");
if (!fiboSample) fail("samples.json missing fibo-studio-still");
if (/amber glass|hand-soap|limestone|black pump|backlit translucent glass/i.test(fiboSample.note + JSON.stringify(fiboSample.inputs))) {
  fail("fibo-studio-still sample still uses the amber soap-bottle brief");
}
if (!/Volt|night-ride radio/i.test(JSON.stringify(fiboSample.inputs))) {
  fail("fibo-studio-still sample inputs should pitch the Volt night-ride radio");
}
if (!/matte-charcoal|charcoal/i.test(fiboSample.note) || !/electric-cyan lightning chevron/i.test(fiboSample.note)) {
  fail("fibo-studio-still sample note should describe the charcoal + cyan lightning radio");
}
if (!/slug:"fibo-studio-still"[\s\S]{0,80}desc:"charcoal radio, cyan rim — lighting you can actually pick"/.test(examplesSrc)) {
  fail("EXAMPLES fibo-studio-still desc should pitch charcoal radio, cyan rim");
}
if (/slug:"fibo-studio-still"[\s\S]{0,80}desc:"amber glass on limestone/.test(examplesSrc)) {
  fail("EXAMPLES fibo-studio-still desc still uses the amber soap line");
}
const mockupHowTo = readFileSync(join(ROOT, "guide", "examples", "render-a-mockup.html"), "utf8");
if (/repair shop|forest-green|Brake adjustment|New appointment|Maya Chen|Warm white background|Today, Repairs, Customers/i.test(mockupHowTo)) {
  fail("render-a-mockup how-to still uses the repair-shop first-click");
}
if (!/Volt/i.test(mockupHowTo) || !/charcoal/i.test(mockupHowTo) || !/cyan/i.test(mockupHowTo)) {
  fail("render-a-mockup how-to should pitch the Volt charcoal + cyan dispatch");
}
if (hub.includes("A screen you can argue about") && !hub.includes("A dispatch screen you can argue about")) {
  fail("hub still titles render-a-mockup as a generic screen");
}
if (!hub.includes("A dispatch screen you can argue about")) {
  fail("hub should title render-a-mockup as a dispatch screen you can argue about");
}
const mockupSample = samples.find((s) => s.slug === "render-a-mockup");
if (!mockupSample) fail("samples.json missing render-a-mockup");
if (/repair shop|forest-green|Brake adjustment|New appointment|Maya Chen|Warm white background|Today, Repairs, Customers/i.test(mockupSample.note + JSON.stringify(mockupSample.inputs))) {
  fail("render-a-mockup sample still uses the repair-shop / forest-green brief");
}
if (!/Volt|Tonight|Couriers|Radios|New dispatch/i.test(JSON.stringify(mockupSample.inputs))) {
  fail("render-a-mockup sample inputs should pitch the Volt courier-dispatch board");
}
if (!/charcoal/i.test(mockupSample.note) || !/cyan/i.test(mockupSample.note) || !/New dispatch/i.test(mockupSample.note)) {
  fail("render-a-mockup sample note should describe the charcoal + cyan Volt dispatch board");
}
if (/slug:"render-a-mockup"[\s\S]{0,80}desc:"a repair-shop dashboard worth arguing over"/.test(examplesSrc)) {
  fail("EXAMPLES render-a-mockup desc still uses the repair-shop line");
}
if (!/slug:"render-a-mockup"[\s\S]{0,80}desc:"charcoal \+ cyan Volt dispatch — Tonight, Couriers, Radios"/.test(examplesSrc)) {
  fail("EXAMPLES render-a-mockup desc should pitch charcoal + cyan Volt dispatch");
}
const avatarSample = samples.find((s) => s.slug === "talking-avatar");
if (!avatarSample) fail("samples.json missing talking-avatar");
if (avatarSample.preview !== "talking-avatar/preview.webp") {
  fail("talking-avatar sample preview should be talking-avatar/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "talking-avatar", "preview.webp"))) {
  fail("examples/gallery/talking-avatar/preview.webp is missing");
}
if (/museum guide|navy shirt|blue tray|bike-shop|seized pedal|kettle boils|Welcome to the workshop/i.test(JSON.stringify(avatarSample.inputs))) {
  fail("talking-avatar sample inputs still use the museum-guide or bike-shop first-click");
}
if (!/night-courier dispatcher|Volt is live on the night board|cyan channel/i.test(JSON.stringify(avatarSample.inputs))) {
  fail("talking-avatar sample inputs should pitch the Volt night-courier dispatcher");
}
if (!/workshop|museum-guide|does not match|later regen|not regenerated/i.test(avatarSample.note)) {
  fail("talking-avatar sample note should say the saved MP4 is the earlier workshop sample");
}
if (!/cover still/i.test(avatarSample.note) || !/night-courier/i.test(avatarSample.note)) {
  fail("talking-avatar sample note should name the Volt night-courier cover still");
}
if (!hub.includes("talking-avatar/preview.webp")) {
  fail("hub should thumb the talking-avatar night-courier cover");
}
const avatarHowTo = readFileSync(join(ROOT, "guide", "examples", "talking-avatar.html"), "utf8");
if (/Welcome to the workshop|bike-shop|seized pedal|kettle boils|Spoken workshop introduction|Look at camera\. Say the line/i.test(avatarHowTo)) {
  fail("talking-avatar how-to still uses the workshop or bike-shop first-click");
}
if (!/night-courier|Volt/i.test(avatarHowTo) || !/cyan/i.test(avatarHowTo)) {
  fail("talking-avatar how-to should pitch the Volt night-courier dispatcher");
}
if (!avatarHowTo.includes("talking-avatar/preview.webp")) {
  fail("talking-avatar how-to should show the night-courier cover still");
}
if (!/historical|workshop|museum-guide|not regenerated/i.test(avatarHowTo)) {
  fail("talking-avatar how-to should say the saved MP4 is the earlier workshop sample");
}
if (!/slug:"talking-avatar"[\s\S]{0,200}thumb:"examples\/gallery\/talking-avatar\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES talking-avatar thumb should be examples/gallery/talking-avatar/preview.webp");
}
if (/slug:"talking-avatar"[\s\S]{0,80}desc:"the bike-shop lead looks at camera/.test(examplesSrc)) {
  fail("EXAMPLES talking-avatar desc still uses the bike-shop line");
}
if (!/slug:"talking-avatar"[\s\S]{0,80}desc:"the night dispatcher looks at camera and keeps the cyan channel clear"/.test(examplesSrc)) {
  fail("EXAMPLES talking-avatar desc should pitch the night dispatcher and cyan channel");
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
