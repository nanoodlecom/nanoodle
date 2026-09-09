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

const headless = readFileSync(join(ROOT, "guide", "run-headless.html"), "utf8");
if (/<pre>[\s\S]*?(?:npm|pip) install nanoodle-(?:js|py)/.test(headless)) {
  fail("run-headless must not put npm/pip install nanoodle-js (or nanoodle-py) in a copy-paste snippet — the package is nanoodle");
}
if (!headless.includes("npx nanoodle inspect") || !headless.includes("pip install nanoodle")) {
  fail("run-headless should show npx nanoodle inspect and pip install nanoodle");
}
if (!headless.includes("Workflow.load") || !headless.includes("https://nanoodle.com/#g=")) {
  fail("run-headless should load a share URL with Workflow.load");
}
if (!llms.includes("https://nanoodle.com/guide/run-headless")) {
  fail("llms.txt does not mention https://nanoodle.com/guide/run-headless");
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
if (/Open this noodle — is the earlier water-bottle/i.test(omniHowTo) || /and Open this noodle — is the earlier water-bottle/i.test(omniHowTo) || /water-bottle|earlier bottle/i.test(omniHowTo)) {
  fail("omni-flash how-to still says Open this noodle is the bottle run");
}
if (/Orbit the chrome|Keep the chrome honest/i.test(omniHowTo)) {
  fail("omni-flash how-to still uses the chrome-helmet first-click title");
}
if (/The reviewed clip matches/i.test(omniHowTo) || /saved clip is the chrome helmet on a charcoal plinth; the open graph matches/i.test(omniHowTo)) {
  fail("omni-flash how-to still says the saved clip matches the first-click");
}
if (!/Volt/i.test(omniHowTo) || !/charcoal/i.test(omniHowTo) || !/cyan/i.test(omniHowTo)) {
  fail("omni-flash how-to should pitch the Volt charcoal + cyan radio");
}
if (!/historical|helmet|not regenerated/i.test(omniHowTo)) {
  fail("omni-flash how-to should say the saved MP4 is the earlier helmet sample");
}
if (!omniHowTo.includes("omni-flash-turntable/preview.webp")) {
  fail("omni-flash how-to should show the Volt radio cover still");
}
const omniSample = samples.find((s) => s.slug === "omni-flash-turntable");
if (!omniSample) fail("samples.json missing omni-flash-turntable");
if (omniSample.preview !== "omni-flash-turntable/preview.webp") {
  fail("omni-flash sample preview should be omni-flash-turntable/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "omni-flash-turntable", "preview.webp"))) {
  fail("examples/gallery/omni-flash-turntable/preview.webp is missing");
}
if (/water-bottle|earlier water-bottle/i.test(omniSample.note)) {
  fail("omni-flash sample note still describes the water-bottle draft");
}
if (/chrome motorcycle helmet/i.test(JSON.stringify(omniSample.inputs))) {
  fail("omni-flash sample inputs still use the chrome helmet first-click");
}
if (!/Volt|night-ride radio|charcoal stone plinth|electric-cyan/i.test(JSON.stringify(omniSample.inputs))) {
  fail("omni-flash sample inputs should pitch the Volt night-ride radio on a charcoal plinth");
}
if (!/helmet|historical|does not match|later regen|not regenerated/i.test(omniSample.note)) {
  fail("omni-flash sample note should say the saved MP4 is the earlier helmet sample");
}
if (!/cover still/i.test(omniSample.note) || !/Volt|night-ride radio/i.test(omniSample.note) || !/charcoal/i.test(omniSample.note)) {
  fail("omni-flash sample note should name the Volt night-ride cover still");
}
if (!hub.includes("omni-flash-turntable/preview.webp")) {
  fail("hub should thumb the omni-flash-turntable Volt radio cover");
}
if (hub.includes("Orbit the chrome")) {
  fail("hub still titles omni-flash-turntable as Orbit the chrome");
}
if (!hub.includes("Orbit the charcoal radio")) {
  fail("hub should title omni-flash-turntable as Orbit the charcoal radio");
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
if (/slug:"omni-flash-turntable"[\s\S]{0,80}desc:"five seconds of a chrome helmet under hard light"/.test(examplesSrc)) {
  fail("EXAMPLES omni-flash-turntable desc still uses the chrome helmet line");
}
if (!/slug:"omni-flash-turntable"[\s\S]{0,80}desc:"quarter-orbit, cyan rim on a night-ride radio"/.test(examplesSrc)) {
  fail("EXAMPLES omni-flash-turntable desc should pitch quarter-orbit cyan rim on a night-ride radio");
}
if (!/slug:"omni-flash-turntable"[\s\S]{0,200}thumb:"examples\/gallery\/omni-flash-turntable\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES omni-flash-turntable thumb should be examples/gallery/omni-flash-turntable/preview.webp");
}
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
const editSample = samples.find((s) => s.slug === "edit-a-photo");
if (!editSample) fail("samples.json missing edit-a-photo");
if (editSample.preview !== "edit-a-photo/preview.webp") {
  fail("edit-a-photo sample preview should be edit-a-photo/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "edit-a-photo", "preview.webp"))) {
  fail("examples/gallery/edit-a-photo/preview.webp is missing");
}
if (/warm-white|soft even studio|clean warm-white seamless/i.test(JSON.stringify(editSample.inputs))) {
  fail("edit-a-photo sample inputs still use the warm-white studio first-click");
}
if (!/cool night-ride catalog|matte charcoal seamless|electric-cyan rim/i.test(JSON.stringify(editSample.inputs))) {
  fail("edit-a-photo sample inputs should pitch the cool night-ride catalog cleanup");
}
if (!/warm-white|amber-bottle|does not match|later regen|not regenerated/i.test(editSample.note)) {
  fail("edit-a-photo sample note should say the saved bottle edit is the earlier warm-white sample");
}
if (!/cover still/i.test(editSample.note) || !/charcoal/i.test(editSample.note) || !/cyan/i.test(editSample.note)) {
  fail("edit-a-photo sample note should name the charcoal + cyan cover still");
}
if (!hub.includes("edit-a-photo/preview.webp")) {
  fail("hub should thumb the edit-a-photo cool-catalog cover");
}
if (hub.includes("Catalog-clean. Same product.") && !hub.includes("Cool catalog. Same product.")) {
  fail("hub still titles edit-a-photo as Catalog-clean. Same product.");
}
if (!hub.includes("Cool catalog. Same product.")) {
  fail("hub should title edit-a-photo as Cool catalog. Same product.");
}
const editHowTo = readFileSync(join(ROOT, "guide", "examples", "edit-a-photo.html"), "utf8");
if (/soft even studio|clean warm-white seamless|Catalog-clean\. Same product/i.test(editHowTo)) {
  fail("edit-a-photo how-to still uses the warm-white studio first-click");
}
if (!/night-ride catalog|charcoal/i.test(editHowTo) || !/cyan/i.test(editHowTo)) {
  fail("edit-a-photo how-to should pitch the cool night-ride catalog cleanup");
}
if (!/historical|warm-white|amber-bottle|not regenerated/i.test(editHowTo)) {
  fail("edit-a-photo how-to should say the saved bottle edit is the earlier warm-white sample");
}
if (!/slug:"edit-a-photo"[\s\S]{0,200}thumb:"examples\/gallery\/edit-a-photo\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES edit-a-photo thumb should be examples/gallery/edit-a-photo/preview.webp");
}
if (/slug:"edit-a-photo"[\s\S]{0,80}desc:"same bottle, clean paper, catalog-ready"/.test(examplesSrc)) {
  fail("EXAMPLES edit-a-photo desc still uses the warm-white bottle line");
}
if (!/slug:"edit-a-photo"[\s\S]{0,80}desc:"matte charcoal, cyan rim — same product, night-ride ready"/.test(examplesSrc)) {
  fail("EXAMPLES edit-a-photo desc should pitch matte charcoal and cyan rim");
}
const cutoutSample = samples.find((s) => s.slug === "product-cutout");
if (!cutoutSample) fail("samples.json missing product-cutout");
if (cutoutSample.preview !== "product-cutout/preview.webp") {
  fail("product-cutout sample preview should be product-cutout/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "product-cutout", "preview.webp"))) {
  fail("examples/gallery/product-cutout/preview.webp is missing");
}
if (!existsSync(join(ROOT, "examples", "gallery", "product-cutout", "product-input.png"))) {
  fail("examples/gallery/product-cutout/product-input.png is missing");
}
if (/workshop|warm-white|soft even studio|SAM 3|fal-ai\/birefnet/i.test(JSON.stringify(cutoutSample.inputs) + cutoutSample.note)) {
  fail("product-cutout sample still uses workshop, SAM 3, or fal-ai/birefnet language");
}
if (!/birefnet\/v2/.test(JSON.stringify(cutoutSample.models))) {
  fail("product-cutout sample should pin birefnet/v2");
}
if (cutoutSample.models.includes("fal-ai/birefnet/v2")) {
  fail("product-cutout sample must not pin fal-ai/birefnet/v2");
}
if (!/cover still/i.test(cutoutSample.note) || !/no paid|not a paid/i.test(cutoutSample.note)) {
  fail("product-cutout sample note should say it is a cover still, not a paid BiRefNet QC cutout");
}
if (/card art/i.test(cutoutSample.note)) {
  fail("product-cutout cover should be the reused Volt still, not generated card art");
}
if (!/pending/i.test(cutoutSample.note) || !/compositing|background cutout/i.test(cutoutSample.note)) {
  fail("product-cutout sample note should say cover is a reused still pending BiRefNet QC, job is compositing cutout");
}
if (!/Volt|night-ride radio|cyan/i.test(cutoutSample.note)) {
  fail("product-cutout sample note should pitch the Volt night-ride radio");
}
if (!/reused|FIBO/i.test(cutoutSample.note + JSON.stringify(cutoutSample.inputs))) {
  fail("product-cutout sample should say the product still is a reused FIBO Volt plate");
}
if (!/Clean product photo|relight|backdrop/i.test(cutoutSample.note)) {
  fail("product-cutout sample note should distinguish Clean product photo");
}
if (!hub.includes("product-cutout/preview.webp")) {
  fail("hub should thumb the product-cutout cover");
}
if (hub.includes("Spoken workshop introduction") || /soft studio workshop|bike-shop cutout/i.test(hub)) {
  fail("hub still uses workshop language for product-cutout");
}
if (!hub.includes("Knock the slate out")) {
  fail("hub should title product-cutout as Knock the slate out");
}
const cutoutHowTo = readFileSync(join(ROOT, "guide", "examples", "product-cutout.html"), "utf8");
if (/workshop|warm-white|soft even studio|fal-ai\/birefnet|Catalog-clean\. Same product/i.test(cutoutHowTo)) {
  fail("product-cutout how-to still uses workshop, fal-ai/birefnet, or Clean product photo first-click");
}
if (/SAM 3/i.test(cutoutHowTo) && !/not SAM 3/i.test(cutoutHowTo)) {
  fail("product-cutout how-to treats SAM 3 as the cutout method");
}
if (!/Volt/i.test(cutoutHowTo) || !/cyan/i.test(cutoutHowTo) || !/charcoal/i.test(cutoutHowTo)) {
  fail("product-cutout how-to should pitch the Volt charcoal + cyan radio");
}
if (!/birefnet\/v2/.test(cutoutHowTo)) {
  fail("product-cutout how-to should name birefnet/v2");
}
if (!/cover still|no paid|not a paid|pending/i.test(cutoutHowTo)) {
  fail("product-cutout how-to should say the cover is a reused still pending BiRefNet QC");
}
if (/card art/i.test(cutoutHowTo)) {
  fail("product-cutout how-to should not call the reused Volt still card art");
}
if (!/reused|FIBO/i.test(cutoutHowTo)) {
  fail("product-cutout how-to should say the cover uses the reused FIBO Volt plate");
}
if (!cutoutHowTo.includes("product-cutout/preview.webp")) {
  fail("product-cutout how-to should show the cover still");
}
if (!/slug:"product-cutout"[\s\S]{0,200}thumb:"examples\/gallery\/product-cutout\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES product-cutout thumb should be examples/gallery/product-cutout/preview.webp");
}
if (!/slug:"product-cutout"[\s\S]{0,80}desc:"cyan lightning radio, background gone"/.test(examplesSrc)) {
  fail("EXAMPLES product-cutout desc should pitch cyan lightning radio, background gone");
}
const cutoutCard = examplesSrc.match(/slug:"product-cutout"[\s\S]{0,1800}/)?.[0] || "";
if (/fal-ai\/birefnet|workshop cutout|soft studio/i.test(cutoutCard)) {
  fail("EXAMPLES product-cutout first-click still uses fal-ai/birefnet or workshop language");
}
if (/SAM 3/i.test(cutoutCard) && !/not text-selected SAM 3|not SAM 3/i.test(cutoutCard)) {
  fail("EXAMPLES product-cutout first-click treats SAM 3 as the cutout method");
}
if (!/birefnet\/v2/.test(examplesSrc.match(/slug:"product-cutout"[\s\S]{0,1800}/)?.[0] || "")) {
  fail("EXAMPLES product-cutout graph should pin birefnet/v2");
}
if (!/LOCAL_ONLY_EXAMPLE_SLUGS = new Set\(\["custom-endpoint"\]\)/.test(examplesSrc)) {
  fail("custom-endpoint must stay the only LOCAL_ONLY teaching card");
}
const combineSample = samples.find((s) => s.slug === "combine-images");
if (!combineSample) fail("samples.json missing combine-images");
if (combineSample.preview !== "combine-images/preview.webp") {
  fail("combine-images sample preview should be combine-images/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "combine-images", "preview.webp"))) {
  fail("examples/gallery/combine-images/preview.webp is missing");
}
if (/Place the product from image 1 naturally into the setting from image 2|Remove neither structural elements nor existing furniture|warm-white|soft even studio/i.test(JSON.stringify(combineSample.inputs))) {
  fail("combine-images sample inputs still use the generic product-in-setting first-click");
}
if (!/Volt pocket night-ride radio|wet night alley|neon wet-asphalt|electric-cyan lightning/i.test(JSON.stringify(combineSample.inputs))) {
  fail("combine-images sample inputs should pitch Volt night-ride placement in a wet neon alley");
}
if (!/amber-bottle|tea-desk|does not match|later regen|not regenerated/i.test(combineSample.note)) {
  fail("combine-images sample note should say the saved bottle/desk composite is the earlier sample");
}
if (!/cover still/i.test(combineSample.note) || !/wet neon alley/i.test(combineSample.note) || !/cyan/i.test(combineSample.note)) {
  fail("combine-images sample note should name the wet neon alley cover still");
}
if (!hub.includes("combine-images/preview.webp")) {
  fail("hub should thumb the combine-images night-ride cover");
}
if (hub.includes("Drop it in the room") && !hub.includes("Drop it in the alley")) {
  fail("hub still titles combine-images as Drop it in the room");
}
if (!hub.includes("Drop it in the alley")) {
  fail("hub should title combine-images as Drop it in the alley");
}
const combineHowTo = readFileSync(join(ROOT, "guide", "examples", "combine-images.html"), "utf8");
if (/Drop it in the room|Preview the bottle on the desk|book the studio|default rules are wrong for your pair/i.test(combineHowTo)) {
  fail("combine-images how-to still uses the generic desk / room first-click");
}
if (!/wet neon alley|Volt radio/i.test(combineHowTo) || !/cyan/i.test(combineHowTo)) {
  fail("combine-images how-to should pitch Volt night-ride placement in a wet neon alley");
}
if (!/historical|amber-bottle|tea-desk|not regenerated/i.test(combineHowTo)) {
  fail("combine-images how-to should say the saved bottle/desk composite is the earlier sample");
}
if (!/slug:"combine-images"[\s\S]{0,200}thumb:"examples\/gallery\/combine-images\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES combine-images thumb should be examples/gallery/combine-images/preview.webp");
}
if (/slug:"combine-images"[\s\S]{0,80}desc:"drop your product onto someone else's table"/.test(examplesSrc)) {
  fail("EXAMPLES combine-images desc still uses the generic table line");
}
if (!/slug:"combine-images"[\s\S]{0,80}desc:"Volt radio on wet neon asphalt"/.test(examplesSrc)) {
  fail("EXAMPLES combine-images desc should pitch Volt radio on wet neon asphalt");
}
if (/Place the product from image 1 naturally into the setting from image 2|Remove neither structural elements nor existing furniture/i.test(examplesSrc.match(/slug:"combine-images"[\s\S]{0,1800}/)?.[0] || "")) {
  fail("EXAMPLES combine-images first-click still uses the generic product-in-setting brief");
}
const arenaSample = samples.find((s) => s.slug === "image-model-arena");
if (!arenaSample) fail("samples.json missing image-model-arena");
if (arenaSample.preview !== "image-model-arena/preview.webp") {
  fail("image-model-arena sample preview should be image-model-arena/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "image-model-arena", "preview.webp"))) {
  fail("examples/gallery/image-model-arena/preview.webp is missing");
}
if (/FIX A FLAT|SATURDAY 10 AM|bicycle repair|cream background|navy and red|tire lever/i.test(JSON.stringify(arenaSample.inputs))) {
  fail("image-model-arena sample inputs still use the FIX A FLAT / cream workshop first-click");
}
if (!/NIGHT RIDE|TUE 9 SEP|matte-charcoal pocket night-ride radio|electric-cyan lightning/i.test(JSON.stringify(arenaSample.inputs))) {
  fail("image-model-arena sample inputs should pitch the Volt night-ride poster");
}
if (!/FIX A FLAT|tire-lever|historical|does not match|later regen|not regenerated/i.test(arenaSample.note)) {
  fail("image-model-arena sample note should say the saved contenders are the earlier FIX A FLAT sample");
}
if (!/cover still/i.test(arenaSample.note) || !/NIGHT RIDE/i.test(arenaSample.note) || !/cyan/i.test(arenaSample.note)) {
  fail("image-model-arena sample note should name the Volt night-ride cover still");
}
if (!hub.includes("image-model-arena/preview.webp")) {
  fail("hub should thumb the image-model-arena night-ride cover");
}
const arenaHowTo = readFileSync(join(ROOT, "guide", "examples", "image-model-arena.html"), "utf8");
if (/SATURDAY 10 AM|bicycle repair|cream background|navy and red|polish is not the same as a tire lever|two hooked plastic tire levers/i.test(arenaHowTo)) {
  fail("image-model-arena how-to still uses the FIX A FLAT / cream workshop first-click");
}
if (!/NIGHT RIDE/i.test(arenaHowTo) || !/Volt/i.test(arenaHowTo) || !/cyan/i.test(arenaHowTo)) {
  fail("image-model-arena how-to should pitch the Volt night-ride poster");
}
if (!/historical|FIX A FLAT|tire-lever|not regenerated/i.test(arenaHowTo)) {
  fail("image-model-arena how-to should say the saved contenders are the earlier FIX A FLAT sample");
}
if (!/slug:"image-model-arena"[\s\S]{0,200}thumb:"examples\/gallery\/image-model-arena\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES image-model-arena thumb should be examples/gallery/image-model-arena/preview.webp");
}
if (/slug:"image-model-arena"[\s\S]{0,80}desc:"four models, one poster — type, wheel, tire levers"/.test(examplesSrc)) {
  fail("EXAMPLES image-model-arena desc still uses the tire-lever line");
}
if (!/slug:"image-model-arena"[\s\S]{0,80}desc:"four models, one Volt night-ride poster — exact NIGHT RIDE type"/.test(examplesSrc)) {
  fail("EXAMPLES image-model-arena desc should pitch the Volt night-ride poster");
}
if (/workshop-poster brief|FIX A FLAT|SATURDAY 10 AM|tire levers|cream background/i.test(examplesSrc.match(/slug:"image-model-arena"[\s\S]{0,1200}/)?.[0] || "")) {
  fail("EXAMPLES image-model-arena first-click still uses the FIX A FLAT / cream workshop brief");
}
const arenaCard = examplesSrc.match(/slug:"image-model-arena"[\s\S]{0,1800}/)?.[0] || "";
if (!/openai\/gpt-image-2\.5\/flare\/text-to-image/.test(arenaCard)) {
  fail("EXAMPLES image-model-arena Contender 2 should pin openai/gpt-image-2.5/flare/text-to-image");
}
if (/krea-v2\/turbo/.test(arenaCard)) {
  fail("EXAMPLES image-model-arena Contender 2 still pins Krea 2 Turbo");
}
if ((arenaCard.match(/type:"image"/g) || []).length !== 4) {
  fail("EXAMPLES image-model-arena must stay four image nodes");
}
if (!/Exact heading: NIGHT RIDE\. Exact footer: TUE 9 SEP\./.test(arenaCard)) {
  fail("EXAMPLES image-model-arena first-click must keep exact NIGHT RIDE / TUE 9 SEP");
}
const arenaWorkflow = readFileSync(join(ROOT, "examples", "gallery", "image-model-arena", "workflow.json"), "utf8");
if (!/"openai\/gpt-image-2\.5\/flare\/text-to-image"/.test(arenaWorkflow)) {
  fail("image-model-arena Open workflow should pin openai/gpt-image-2.5/flare/text-to-image");
}
if (/krea-v2\/turbo/.test(arenaWorkflow)) {
  fail("image-model-arena Open workflow still pins Krea 2 Turbo");
}
if ((JSON.parse(arenaWorkflow).nodes.filter((n) => n.type === "image").length) !== 4) {
  fail("image-model-arena Open workflow must stay four image nodes");
}
const arenaGraph = JSON.parse(readFileSync(join(ROOT, "examples", "gallery", "image-model-arena", "graph.json"), "utf8"));
if (!arenaGraph.nodes.some((n) => n.name === "Contender 2" && n.fields?.model === "wavespeed-ai/krea-v2/turbo")) {
  fail("image-model-arena sampled graph should keep historical Krea Contender 2");
}
if (!arenaSample.outputs.some((o) => /Krea 2 Turbo/i.test(o.label) && /Contender_2/.test(o.src))) {
  fail("image-model-arena Contender 2 sample should stay labeled as historical Krea 2 Turbo");
}
if (!/Flare/i.test(arenaSample.note)) {
  fail("image-model-arena sample note should say Open workflow pins GPT Image 2.5 Flare");
}
if (!/Flare/i.test(arenaHowTo)) {
  fail("image-model-arena how-to should name GPT Image 2.5 Flare");
}
const radioSample = samples.find((s) => s.slug === "infinitetalk-radio-take");
if (!radioSample) fail("samples.json missing infinitetalk-radio-take");
if (radioSample.preview !== "infinitetalk-radio-take/preview.webp") {
  fail("infinitetalk-radio-take sample preview should be infinitetalk-radio-take/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "infinitetalk-radio-take", "preview.webp"))) {
  fail("examples/gallery/infinitetalk-radio-take/preview.webp is missing");
}
if (!/cover still/i.test(radioSample.note) || !/no paid|not a paid|pending/i.test(radioSample.note)) {
  fail("infinitetalk-radio-take sample note should say it is a cover still, sample video QC pending");
}
if (!/infinitetalk/.test(JSON.stringify(radioSample.models))) {
  fail("infinitetalk-radio-take sample should pin infinitetalk");
}
if (radioSample.models.includes("longcat-avatar-1.5") || radioSample.models.includes("wavespeed-ai/longcat-avatar-1.5")) {
  fail("infinitetalk-radio-take sample must not pin LongCat");
}
if (!/talking-avatar|LongCat|Muse → MiniMax Speech/i.test(radioSample.note)) {
  fail("infinitetalk-radio-take sample note should distinguish talking-avatar / LongCat");
}
if (!/single|480p/.test(radioSample.note)) {
  fail("infinitetalk-radio-take sample note should name people=single / 480p");
}
if (!/mid-shot|pocket radio|rooftop/i.test(JSON.stringify(radioSample.inputs))) {
  fail("infinitetalk-radio-take sample inputs should pitch the mid-shot courier + pocket radio");
}
if (/Volt is live on the night board|keep the cyan channel clear/i.test(JSON.stringify(radioSample.inputs))) {
  fail("infinitetalk-radio-take sample inputs still use the talking-avatar dispatcher script");
}
if (!hub.includes("infinitetalk-radio-take/preview.webp")) {
  fail("hub should thumb the infinitetalk-radio-take cover");
}
if (hub.includes("Look at camera. Follow the take.")) {
  fail("hub still titles infinitetalk-radio-take like talking-avatar");
}
if (!hub.includes("Hold the radio. Follow the take.")) {
  fail("hub should title infinitetalk-radio-take as Hold the radio. Follow the take.");
}
const radioHowTo = readFileSync(join(ROOT, "guide", "examples", "infinitetalk-radio-take.html"), "utf8");
const radioHowToBody = radioHowTo.split('<nav class="next">')[0];
if (/Look at camera\. Clear the channel|Volt is live on the night board|Spoken workshop introduction/i.test(radioHowToBody)) {
  fail("infinitetalk-radio-take how-to still uses talking-avatar first-click copy");
}
if (!/InfiniteTalk|infinitetalk/.test(radioHowTo) || !/480p/.test(radioHowTo) || !/single/.test(radioHowTo)) {
  fail("infinitetalk-radio-take how-to should name infinitetalk at single / 480p");
}
if (!/LongCat|talking-avatar|Night-courier spoken intro/i.test(radioHowTo)) {
  fail("infinitetalk-radio-take how-to should distinguish talking-avatar / LongCat");
}
if (!/cover still|no paid|not a paid|pending/i.test(radioHowTo)) {
  fail("infinitetalk-radio-take how-to should say the cover is card art, sample video QC pending");
}
if (!radioHowTo.includes("infinitetalk-radio-take/preview.webp")) {
  fail("infinitetalk-radio-take how-to should show the cover still");
}
if (!/slug:"infinitetalk-radio-take"[\s\S]{0,200}thumb:"examples\/gallery\/infinitetalk-radio-take\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES infinitetalk-radio-take thumb should be examples/gallery/infinitetalk-radio-take/preview.webp");
}
if (!/slug:"infinitetalk-radio-take"[\s\S]{0,80}desc:"still \+ audio — lips and body follow the radio take"/.test(examplesSrc)) {
  fail("EXAMPLES infinitetalk-radio-take desc should pitch still + audio lips and body");
}
if (!/slug:"infinitetalk-radio-take"[\s\S]{0,80}title:"night-ride radio take"/.test(examplesSrc)) {
  fail("EXAMPLES infinitetalk-radio-take title should be night-ride radio take");
}
const radioCard = examplesSrc.match(/slug:"infinitetalk-radio-take"[\s\S]{0,4000}/)?.[0] || "";
if (/longcat-avatar|Volt is live on the night board|keep the cyan channel clear/i.test(radioCard)) {
  fail("EXAMPLES infinitetalk-radio-take first-click still uses talking-avatar / LongCat");
}
if (!/infinitetalk/.test(radioCard) || !/"?people"?:"single"/.test(radioCard) || !/resolution:"480p"/.test(radioCard)) {
  fail("EXAMPLES infinitetalk-radio-take graph should pin infinitetalk at people=single / 480p");
}
if (/slug:"talking-avatar"[\s\S]{0,1800}infinitetalk/.test(examplesSrc)) {
  fail("EXAMPLES talking-avatar must stay on LongCat, not infinitetalk");
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
