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
if (!deslopSample.proof || !Array.isArray(deslopSample.proof.images)) {
  fail("deslop sample should carry ZeroGPT detector proof images");
}
for (const img of deslopSample.proof.images) {
  if (!existsSync(join(ROOT, "examples", "gallery", img.src))) {
    fail("deslop proof image missing: " + img.src);
  }
}
if (!/20\.9%/.test(deslopSample.note) || !/0%/.test(deslopSample.note) || !/ZeroGPT/i.test(deslopSample.note)) {
  fail("deslop sample note should mention measured ZeroGPT 20.9% → 0%");
}
if (deslopSample.note.length > 120) {
  fail("deslop sample note should stay a short punch, not a block of text");
}
if (!deslopSample.models.includes("venice-uncensored")) {
  fail("deslop sample models should include venice-uncensored");
}
if (deslopSample.models.includes("openai/gpt-4o-mini")) {
  fail("deslop sample models must not claim openai/gpt-4o-mini");
}
if (!deslopHowTo.includes("Detector proof") || !deslopHowTo.includes("zerogpt-draft.png") || !deslopHowTo.includes("zerogpt-clean.png")) {
  fail("deslop how-to should show Detector proof with both ZeroGPT screenshots");
}
if (!deslopHowTo.includes("20.9%") || !deslopHowTo.includes("0%")) {
  fail("deslop how-to should state the 20.9% → 0% ZeroGPT numbers");
}
if (!deslopHowTo.includes("venice-uncensored") || !deslopHowTo.includes("CLEAN_v10")) {
  fail("deslop how-to should cite venice-uncensored and CLEAN_v10");
}
if (deslopHowTo.includes("openai/gpt-4o-mini") || /Grok drafts/.test(deslopHowTo)) {
  fail("deslop how-to must not claim gpt-4o-mini or that Grok drafts");
}
const deslopNotice = readFileSync(join(ROOT, "examples", "gallery", "deslop", "LLM.txt"), "utf8").trim();
if (!deslopNotice.startsWith("Drop begins 8 September at 00:01 JST.") || !deslopNotice.includes("Cancel by emailing drop@example.com")) {
  fail("deslop LLM.txt should be the CLEAN_v10 venice notice");
}
const deslopCard = /\{ em:"[^"]*", slug:"deslop"[\s\S]*?\n \{ em:/.exec(examplesSrc)?.[0] || "";
const deslopN2 = /\{id:"n2",type:"llm"[\s\S]*?fields:\{model:"([^"]+)"/.exec(deslopCard);
if (!deslopN2 || deslopN2[1] !== "venice-uncensored") {
  fail("EXAMPLES deslop First rewrite (n2) must pin venice-uncensored");
}
if (deslopN2[1] === "openai/gpt-4o-mini" || deslopN2[1] === "x-ai/grok-4.5") {
  fail("EXAMPLES deslop First rewrite (n2) must not leave Grok or gpt-4o-mini");
}
if (/\bGPTZero\b/i.test(deslopHowTo) && !/not measured/i.test(deslopHowTo)) {
  fail("deslop how-to must not invent a GPTZero score");
}
if (!existsSync(join(ROOT, "examples", "gallery", "deslop", "gg-writers-badge.png"))) {
  fail("examples/gallery/deslop/gg-writers-badge.png is missing");
}
if (deslopSample.proof.badge !== "deslop/gg-writers-badge.png") {
  fail("deslop proof should use the wide gg-writers-badge.png as primary ad art");
}
if (!/gg writers/i.test(deslopSample.tag || "") || !/gg writers/i.test(deslopSample.note)) {
  fail("deslop sample should wear the gg writers tag and say it in the note");
}
if (!deslopHowTo.includes("gg-writers-badge.png") || !deslopHowTo.includes("gg writers") || !deslopHowTo.includes("20.9% → 0% AI · ZeroGPT") || !deslopHowTo.includes("one free checker. the slop cried.")) {
  fail("deslop how-to should advertise gg writers with the Volt badge and three short punches");
}
if (/That midnight drop email|uncensored burstiness|not a guarantee on every detector|GPTZero was not measured/i.test(deslopHowTo)) {
  fail("deslop how-to still carries the detector essay / text wall");
}
if (deslopHowTo.includes('class="callout"')) {
  fail("deslop how-to should not restack a callout brick under The look");
}
const deslopProof = deslopHowTo.split("Detector proof")[1]?.split("Make it yours")[0] || "";
const deslopProofLines = [...deslopProof.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);
if (deslopProofLines.length > 3) {
  fail("deslop Detector proof should keep ≤3 short lines, not a paragraph stack");
}
if (deslopProofLines.some((line) => line.length > 80)) {
  fail("deslop Detector proof lines should stay punches, not an essay");
}
if ((deslopSample.proof.note || "").length > 80) {
  fail("deslop proof.note should stay a short punch");
}
const galleryPage = readFileSync(join(ROOT, "examples", "gallery", "index.html"), "utf8");
const galleryDeslop = galleryPage.split('id="deslop"')[1]?.split("<section")[0] || "";
if (/kept every real number|uncensored burstiness|not a guarantee on every detector|GPTZero was not measured/i.test(galleryDeslop)) {
  fail("gallery deslop still carries the detector essay / text wall");
}
if (!galleryDeslop.includes("gg-writers-badge.png") || !galleryDeslop.includes("20.9% → 0% AI · ZeroGPT") || !galleryDeslop.includes("one free checker. the slop cried.")) {
  fail("gallery deslop Detector proof should keep the Volt badge and three short punches");
}
if (!hub.includes("gg writers") || !hub.includes("tag gg")) {
  fail("hub deslop card should overlay a gg writers tag");
}
if (!/slug==="deslop"[\s\S]{0,500}gg writers/.test(examplesSrc) || !examplesSrc.includes('class="tag gg"')) {
  fail("EXAMPLES deslop card should overlay a gg writers tag");
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
const isolateSample = samples.find((s) => s.slug === "sam3-isolate");
if (!isolateSample) fail("samples.json missing sam3-isolate");
if (isolateSample.preview !== "sam3-isolate/preview.webp") {
  fail("sam3-isolate sample preview should be sam3-isolate/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "sam3-isolate", "preview.webp"))) {
  fail("examples/gallery/sam3-isolate/preview.webp is missing");
}
if (!existsSync(join(ROOT, "examples", "gallery", "sam3-isolate", "scene-input.webp"))) {
  fail("examples/gallery/sam3-isolate/scene-input.webp is missing");
}
if (!/sam3-image/.test(JSON.stringify(isolateSample.models))) {
  fail("sam3-isolate sample should pin sam3-image");
}
if (isolateSample.models.includes("wavespeed-ai/sam3-image")) {
  fail("sam3-isolate sample must not pin wavespeed-ai/sam3-image");
}
if (!/cover|reused Volt card art/i.test(isolateSample.note) || !/no paid|pending/i.test(isolateSample.note)) {
  fail("sam3-isolate sample note should say cover is reused Volt card art and SAM QC is pending");
}
if (!/text-selected isolate|name a region/i.test(isolateSample.note)) {
  fail("sam3-isolate sample note should say the job is text-selected isolate");
}
if (!/Product cutout|BiRefNet/i.test(isolateSample.note)) {
  fail("sam3-isolate sample note should distinguish Product cutout / BiRefNet");
}
if (!/Volt|night-ride radio|cyan/i.test(isolateSample.note)) {
  fail("sam3-isolate sample note should pitch the Volt night-ride radio");
}
if (!hub.includes("sam3-isolate/preview.webp")) {
  fail("hub should thumb the sam3-isolate cover");
}
if (!hub.includes("Name it. Lift it.")) {
  fail("hub should title sam3-isolate as Name it. Lift it.");
}
const isolateHowTo = readFileSync(join(ROOT, "guide", "examples", "sam3-isolate.html"), "utf8");
if (!/sam3-image/.test(isolateHowTo)) {
  fail("sam3-isolate how-to should name sam3-image");
}
if (/wavespeed-ai\/sam3-image/.test(isolateHowTo)) {
  fail("sam3-isolate how-to must not pin wavespeed-ai/sam3-image");
}
if (!/Volt/i.test(isolateHowTo) || !/cyan/i.test(isolateHowTo) || !/charcoal/i.test(isolateHowTo)) {
  fail("sam3-isolate how-to should pitch the Volt charcoal + cyan radio");
}
if (!/text-selected isolate|name the object|name a region/i.test(isolateHowTo)) {
  fail("sam3-isolate how-to should say this is text-selected isolate");
}
if (!/Product cutout|BiRefNet/i.test(isolateHowTo)) {
  fail("sam3-isolate how-to should distinguish Product cutout / BiRefNet");
}
if (!/reused Volt card art|no paid|pending/i.test(isolateHowTo)) {
  fail("sam3-isolate how-to should say the cover is reused Volt card art and SAM QC is pending");
}
if (!isolateHowTo.includes("sam3-isolate/preview.webp")) {
  fail("sam3-isolate how-to should show the cover still");
}
if (!/slug:"sam3-isolate"[\s\S]{0,200}thumb:"examples\/gallery\/sam3-isolate\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES sam3-isolate thumb should be examples/gallery/sam3-isolate/preview.webp");
}
if (!/slug:"sam3-isolate"[\s\S]{0,80}desc:"name the cyan lightning radio — isolate that, not the alley"/.test(examplesSrc)) {
  fail("EXAMPLES sam3-isolate desc should pitch name the cyan lightning radio — isolate that, not the alley");
}
const isolateCard = examplesSrc.match(/slug:"sam3-isolate"[\s\S]{0,2200}/)?.[0] || "";
if (/wavespeed-ai\/sam3-image/.test(isolateCard)) {
  fail("EXAMPLES sam3-isolate first-click must not pin wavespeed-ai/sam3-image");
}
if (!/sam3-image/.test(isolateCard)) {
  fail("EXAMPLES sam3-isolate graph should pin sam3-image");
}
const upscaleSample = samples.find((s) => s.slug === "p-image-upscale");
if (!upscaleSample) fail("samples.json missing p-image-upscale");
if (upscaleSample.preview !== "p-image-upscale/preview.webp") {
  fail("p-image-upscale sample preview should be p-image-upscale/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "p-image-upscale", "preview.webp"))) {
  fail("examples/gallery/p-image-upscale/preview.webp is missing");
}
if (!existsSync(join(ROOT, "examples", "gallery", "p-image-upscale", "product-input.png"))) {
  fail("examples/gallery/p-image-upscale/product-input.png is missing");
}
if (!/pruna-ai\/p-image\/upscale/.test(JSON.stringify(upscaleSample.models))) {
  fail("p-image-upscale sample should pin pruna-ai/p-image/upscale");
}
if (!/cover|reused Volt card art/i.test(upscaleSample.note) || !/no paid|pending/i.test(upscaleSample.note)) {
  fail("p-image-upscale sample note should say cover is reused Volt card art and upscale QC is pending");
}
if (!/2×|2x|resolution upscale|twice the pixels/i.test(upscaleSample.note)) {
  fail("p-image-upscale sample note should say the job is 2× resolution upscale");
}
if (!/Muse Edit|Clean product photo/i.test(upscaleSample.note)) {
  fail("p-image-upscale sample note should distinguish Clean product photo / Muse Edit");
}
if (!/Product cutout|BiRefNet/i.test(upscaleSample.note)) {
  fail("p-image-upscale sample note should distinguish Product cutout / BiRefNet");
}
if (!/SAM 3|text-selected isolate/i.test(upscaleSample.note)) {
  fail("p-image-upscale sample note should distinguish Text-selected isolate / SAM 3");
}
if (!/Volt|night-ride radio|cyan/i.test(upscaleSample.note)) {
  fail("p-image-upscale sample note should pitch the Volt night-ride radio");
}
if (!hub.includes("p-image-upscale/preview.webp")) {
  fail("hub should thumb the p-image-upscale cover");
}
if (!hub.includes("Same radio. Twice the pixels.")) {
  fail("hub should title p-image-upscale as Same radio. Twice the pixels.");
}
const upscaleHowTo = readFileSync(join(ROOT, "guide", "examples", "p-image-upscale.html"), "utf8");
if (!/pruna-ai\/p-image\/upscale/.test(upscaleHowTo)) {
  fail("p-image-upscale how-to should name pruna-ai/p-image/upscale");
}
if (!/Volt/i.test(upscaleHowTo) || !/cyan/i.test(upscaleHowTo) || !/charcoal/i.test(upscaleHowTo)) {
  fail("p-image-upscale how-to should pitch the Volt charcoal + cyan radio");
}
if (!/2×|2x|resolution upscale|twice the pixels/i.test(upscaleHowTo)) {
  fail("p-image-upscale how-to should say this is 2× resolution upscale");
}
if (!/Muse Edit|Clean product photo/i.test(upscaleHowTo)) {
  fail("p-image-upscale how-to should distinguish Clean product photo / Muse Edit");
}
if (!/Product cutout|BiRefNet/i.test(upscaleHowTo)) {
  fail("p-image-upscale how-to should distinguish Product cutout / BiRefNet");
}
if (!/SAM 3|text-selected isolate/i.test(upscaleHowTo)) {
  fail("p-image-upscale how-to should distinguish Text-selected isolate / SAM 3");
}
if (!/reused Volt card art|no paid|pending/i.test(upscaleHowTo)) {
  fail("p-image-upscale how-to should say the cover is reused Volt card art and upscale QC is pending");
}
if (!upscaleHowTo.includes("p-image-upscale/preview.webp")) {
  fail("p-image-upscale how-to should show the cover still");
}
if (!/slug:"p-image-upscale"[\s\S]{0,200}thumb:"examples\/gallery\/p-image-upscale\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES p-image-upscale thumb should be examples/gallery/p-image-upscale/preview.webp");
}
if (!/slug:"p-image-upscale"[\s\S]{0,80}desc:"same cyan lightning radio, twice the pixels"/.test(examplesSrc)) {
  fail("EXAMPLES p-image-upscale desc should pitch same cyan lightning radio, twice the pixels");
}
const upscaleCard = examplesSrc.match(/slug:"p-image-upscale"[\s\S]{0,2200}/)?.[0] || "";
if (!/pruna-ai\/p-image\/upscale/.test(upscaleCard)) {
  fail("EXAMPLES p-image-upscale graph should pin pruna-ai/p-image/upscale");
}
if (!/size:"2"/.test(upscaleCard)) {
  fail("EXAMPLES p-image-upscale graph should pin size \"2\"");
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
const orbitSample = samples.find((s) => s.slug === "h3-max-multi-angle");
if (!orbitSample) fail("samples.json missing h3-max-multi-angle");
if (orbitSample.preview !== "h3-max-multi-angle/preview.webp") {
  fail("h3-max-multi-angle sample preview should be h3-max-multi-angle/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "h3-max-multi-angle", "preview.webp"))) {
  fail("examples/gallery/h3-max-multi-angle/preview.webp is missing");
}
if (!existsSync(join(ROOT, "examples", "gallery", "h3-max-multi-angle", "product-input.png"))) {
  fail("examples/gallery/h3-max-multi-angle/product-input.png is missing");
}
if (!/minimax\/h3-max\/multi-angle\/image-to-video/.test(JSON.stringify(orbitSample.models))) {
  fail("h3-max-multi-angle sample should pin minimax/h3-max/multi-angle/image-to-video");
}
if (!/cover|reused Volt card art/i.test(orbitSample.note) || !/no paid|pending/i.test(orbitSample.note)) {
  fail("h3-max-multi-angle sample note should say cover is reused Volt card art and orbit QC is pending");
}
if (!/orbit-right|camera orbit|product-reveal/i.test(orbitSample.note)) {
  fail("h3-max-multi-angle sample note should say the job is a camera orbit");
}
if (!/photo-to-video|H3 Spicy|locked-camera/i.test(orbitSample.note)) {
  fail("h3-max-multi-angle sample note should distinguish photo-to-video / MiniMax H3 Spicy");
}
if (!/omni-flash-turntable|Omni Flash/i.test(orbitSample.note)) {
  fail("h3-max-multi-angle sample note should distinguish omni-flash-turntable / Omni Flash");
}
if (!/Volt|night-ride radio|cyan/i.test(orbitSample.note)) {
  fail("h3-max-multi-angle sample note should pitch the Volt night-ride radio");
}
if (!hub.includes("h3-max-multi-angle/preview.webp")) {
  fail("hub should thumb the h3-max-multi-angle cover");
}
if (!hub.includes("Orbit the uploaded radio")) {
  fail("hub should title h3-max-multi-angle as Orbit the uploaded radio");
}
const orbitHowTo = readFileSync(join(ROOT, "guide", "examples", "h3-max-multi-angle.html"), "utf8");
if (!/minimax\/h3-max\/multi-angle\/image-to-video/.test(orbitHowTo)) {
  fail("h3-max-multi-angle how-to should name minimax/h3-max/multi-angle/image-to-video");
}
if (!/Volt/i.test(orbitHowTo) || !/cyan/i.test(orbitHowTo) || !/charcoal/i.test(orbitHowTo)) {
  fail("h3-max-multi-angle how-to should pitch the Volt charcoal + cyan radio");
}
if (!/orbit-right|camera orbit|Orbit clip/i.test(orbitHowTo)) {
  fail("h3-max-multi-angle how-to should say this is an orbit-right camera move");
}
if (!/photo-to-video|H3 Spicy|locked-camera/i.test(orbitHowTo)) {
  fail("h3-max-multi-angle how-to should distinguish photo-to-video / MiniMax H3 Spicy");
}
if (!/omni-flash-turntable|Omni Flash/i.test(orbitHowTo)) {
  fail("h3-max-multi-angle how-to should distinguish omni-flash-turntable / Omni Flash");
}
if (!/reused Volt card art|no paid|pending/i.test(orbitHowTo)) {
  fail("h3-max-multi-angle how-to should say the cover is reused Volt card art and orbit QC is pending");
}
if (!orbitHowTo.includes("h3-max-multi-angle/preview.webp")) {
  fail("h3-max-multi-angle how-to should show the cover still");
}
if (!/slug:"h3-max-multi-angle"[\s\S]{0,200}thumb:"examples\/gallery\/h3-max-multi-angle\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES h3-max-multi-angle thumb should be examples/gallery/h3-max-multi-angle/preview.webp");
}
if (!/slug:"h3-max-multi-angle"[\s\S]{0,80}desc:"upload a still — orbit-right around the radio"/.test(examplesSrc)) {
  fail("EXAMPLES h3-max-multi-angle desc should pitch upload a still — orbit-right around the radio");
}
if (!/slug:"h3-max-multi-angle"[\s\S]{0,80}title:"night-ride radio orbit"/.test(examplesSrc)) {
  fail("EXAMPLES h3-max-multi-angle title should be night-ride radio orbit");
}
const orbitCard = examplesSrc.match(/slug:"h3-max-multi-angle"[\s\S]{0,2800}/)?.[0] || "";
if (!/minimax\/h3-max\/multi-angle\/image-to-video/.test(orbitCard)) {
  fail("EXAMPLES h3-max-multi-angle graph should pin minimax/h3-max/multi-angle/image-to-video");
}
if (!/resolution:"480p"/.test(orbitCard) || !/duration:"5"/.test(orbitCard)) {
  fail("EXAMPLES h3-max-multi-angle graph should pin 480p / 5s");
}
if (!/"camera_motion":"orbit-right"/.test(orbitCard)) {
  fail("EXAMPLES h3-max-multi-angle graph should pin camera_motion=orbit-right");
}
if (/minimax-h3\/image-to-video-spicy/.test(orbitCard)) {
  fail("EXAMPLES h3-max-multi-angle must not pin MiniMax H3 Spicy");
}
if (/google\/gemini-omni-flash/.test(orbitCard)) {
  fail("EXAMPLES h3-max-multi-angle must not pin Omni Flash");
}
const crystalSample = samples.find((s) => s.slug === "crystal-video-upscale");
if (!crystalSample) fail("samples.json missing crystal-video-upscale");
if (crystalSample.preview !== "crystal-video-upscale/preview.webp") {
  fail("crystal-video-upscale sample preview should be crystal-video-upscale/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "crystal-video-upscale", "preview.webp"))) {
  fail("examples/gallery/crystal-video-upscale/preview.webp is missing");
}
if (!/clarity-ai\/crystal-video-upscaler/.test(JSON.stringify(crystalSample.models))) {
  fail("crystal-video-upscale sample should pin clarity-ai/crystal-video-upscaler");
}
if (!/cover|reused Volt card art/i.test(crystalSample.note) || !/no paid|pending/i.test(crystalSample.note)) {
  fail("crystal-video-upscale sample note should say cover is reused Volt card art and Crystal QC is pending");
}
if (!/target.megapixel|1 MP|target_megapixels/i.test(crystalSample.note)) {
  fail("crystal-video-upscale sample note should say the job is video target-megapixel upscale");
}
if (!/P-Image Upscale|still/i.test(crystalSample.note)) {
  fail("crystal-video-upscale sample note should distinguish P-Image Upscale");
}
if (!/Night-ride radio orbit|Omni Flash|h3-max-multi-angle/i.test(crystalSample.note)) {
  fail("crystal-video-upscale sample note should distinguish Night-ride radio orbit / Omni Flash");
}
if (!/Volt|night-ride radio|cyan/i.test(crystalSample.note)) {
  fail("crystal-video-upscale sample note should pitch the Volt night-ride radio");
}
if (!hub.includes("crystal-video-upscale/preview.webp")) {
  fail("hub should thumb the crystal-video-upscale cover");
}
if (!hub.includes("Same clip. More pixels.")) {
  fail("hub should title crystal-video-upscale as Same clip. More pixels.");
}
const crystalHowTo = readFileSync(join(ROOT, "guide", "examples", "crystal-video-upscale.html"), "utf8");
if (!/clarity-ai\/crystal-video-upscaler/.test(crystalHowTo)) {
  fail("crystal-video-upscale how-to should name clarity-ai/crystal-video-upscaler");
}
if (!/Volt/i.test(crystalHowTo) || !/cyan/i.test(crystalHowTo) || !/charcoal/i.test(crystalHowTo)) {
  fail("crystal-video-upscale how-to should pitch the Volt charcoal + cyan radio");
}
if (!/1 MP|target_megapixels|target megapixel/i.test(crystalHowTo)) {
  fail("crystal-video-upscale how-to should say this is 1 MP Crystal upscale");
}
if (!/P-Image Upscale/i.test(crystalHowTo)) {
  fail("crystal-video-upscale how-to should distinguish P-Image Upscale");
}
if (!/Night-ride radio orbit|Omni Flash/i.test(crystalHowTo)) {
  fail("crystal-video-upscale how-to should distinguish Night-ride radio orbit / Omni Flash");
}
if (!/reused Volt card art|no paid|pending/i.test(crystalHowTo)) {
  fail("crystal-video-upscale how-to should say the cover is reused Volt card art and Crystal QC is pending");
}
if (!crystalHowTo.includes("crystal-video-upscale/preview.webp")) {
  fail("crystal-video-upscale how-to should show the cover still");
}
if (!/slug:"crystal-video-upscale"[\s\S]{0,200}thumb:"examples\/gallery\/crystal-video-upscale\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES crystal-video-upscale thumb should be examples/gallery/crystal-video-upscale/preview.webp");
}
if (!/slug:"crystal-video-upscale"[\s\S]{0,80}desc:"upload a clip — sharper, 1 MP Crystal"/.test(examplesSrc)) {
  fail("EXAMPLES crystal-video-upscale desc should pitch upload a clip — sharper, 1 MP Crystal");
}
if (!/slug:"crystal-video-upscale"[\s\S]{0,80}title:"crystal video upscale"/.test(examplesSrc)) {
  fail("EXAMPLES crystal-video-upscale title should be crystal video upscale");
}
const crystalCard = examplesSrc.match(/slug:"crystal-video-upscale"[\s\S]{0,2800}/)?.[0] || "";
if (!/clarity-ai\/crystal-video-upscaler/.test(crystalCard)) {
  fail("EXAMPLES crystal-video-upscale graph should pin clarity-ai/crystal-video-upscaler");
}
if (!/"target_megapixels":1/.test(crystalCard)) {
  fail("EXAMPLES crystal-video-upscale graph should pin target_megapixels=1");
}
if (!/type:"vupload"/.test(crystalCard) || !/type:"vedit"/.test(crystalCard)) {
  fail("EXAMPLES crystal-video-upscale should be vupload Product clip → vedit Upscaled clip");
}
if (/pruna-ai\/p-image\/upscale/.test(crystalCard)) {
  fail("EXAMPLES crystal-video-upscale must not pin P-Image Upscale");
}
if (/minimax\/h3-max\/multi-angle\/image-to-video/.test(crystalCard)) {
  fail("EXAMPLES crystal-video-upscale must not pin H3 Max Multi Angle");
}
if (/google\/gemini-omni-flash/.test(crystalCard)) {
  fail("EXAMPLES crystal-video-upscale must not pin Omni Flash");
}
if (/ideogram-v4/.test(crystalCard)) {
  fail("EXAMPLES crystal-video-upscale must not touch Ideogram V4 Instant");
}
const voltSample = samples.find((s) => s.slug === "volt-dispatch-infographic");
if (!voltSample) fail("samples.json missing volt-dispatch-infographic");
if (voltSample.preview !== "volt-dispatch-infographic/preview.webp") {
  fail("volt-dispatch-infographic sample preview should be volt-dispatch-infographic/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "volt-dispatch-infographic", "preview.webp"))) {
  fail("examples/gallery/volt-dispatch-infographic/preview.webp is missing");
}
if (!/sensenova-u1-infographic/.test(JSON.stringify(voltSample.models))) {
  fail("volt-dispatch-infographic sample should pin sensenova-u1-infographic");
}
if (!/reused Volt|pending/.test(voltSample.note) || !/SenseNova|sensenova/.test(voltSample.note)) {
  fail("volt-dispatch-infographic sample note should say cover is reused Volt poster art and SenseNova QC is pending");
}
if (!/dispatch card|DROP|ZONE|ETA/.test(voltSample.note)) {
  fail("volt-dispatch-infographic sample note should say the job is a Volt dispatch card with DROP / ZONE / ETA");
}
if (!/no text walls|Short labels/.test(voltSample.note)) {
  fail("volt-dispatch-infographic sample note should say short labels, no text walls");
}
if (!/render-a-mockup|UI mockup/.test(voltSample.note)) {
  fail("volt-dispatch-infographic sample note should distinguish UI mockup / render-a-mockup");
}
if (!/postcard/.test(voltSample.note)) {
  fail("volt-dispatch-infographic sample note should distinguish travel postcard");
}
if (!hub.includes("volt-dispatch-infographic/preview.webp")) {
  fail("hub should thumb the volt-dispatch-infographic cover");
}
if (!hub.includes("DROP. ZONE. ETA.")) {
  fail("hub should title volt-dispatch-infographic as DROP. ZONE. ETA.");
}
const voltHowTo = readFileSync(join(ROOT, "guide", "examples", "volt-dispatch-infographic.html"), "utf8");
if (!/sensenova-u1-infographic/.test(voltHowTo)) {
  fail("volt-dispatch-infographic how-to should name sensenova-u1-infographic");
}
if (!/Volt|charcoal|cyan/.test(voltHowTo)) {
  fail("volt-dispatch-infographic how-to should pitch the Volt charcoal + cyan dispatch card");
}
if (!/DROP|ZONE|ETA/.test(voltHowTo)) {
  fail("volt-dispatch-infographic how-to should pitch DROP / ZONE / ETA");
}
if (!/UI mockup|not a postcard/.test(voltHowTo)) {
  fail("volt-dispatch-infographic how-to should distinguish UI mockup and postcard");
}
if (!/reused Volt poster|pending SenseNova QC|no paid run/.test(voltHowTo)) {
  fail("volt-dispatch-infographic how-to should say the cover is reused Volt poster art and SenseNova QC is pending");
}
if (!voltHowTo.includes("volt-dispatch-infographic/preview.webp")) {
  fail("volt-dispatch-infographic how-to should show the cover still");
}
if (!/slug:"volt-dispatch-infographic"[\s\S]{0,200}thumb:"examples\/gallery\/volt-dispatch-infographic\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES volt-dispatch-infographic thumb should be examples/gallery/volt-dispatch-infographic/preview.webp");
}
if (!/slug:"volt-dispatch-infographic"[\s\S]{0,80}desc:"DROP \/ ZONE \/ ETA — charcoal SenseNova infographic"/.test(examplesSrc)) {
  fail("EXAMPLES volt-dispatch-infographic desc should pitch DROP / ZONE / ETA — charcoal SenseNova infographic");
}
if (!/slug:"volt-dispatch-infographic"[\s\S]{0,80}title:"volt dispatch card"/.test(examplesSrc)) {
  fail("EXAMPLES volt-dispatch-infographic title should be volt dispatch card");
}
const voltCard = examplesSrc.match(/slug:"volt-dispatch-infographic"[\s\S]{0,2800}/)?.[0] || "";
if (!/sensenova-u1-infographic/.test(voltCard)) {
  fail("EXAMPLES volt-dispatch-infographic graph should pin sensenova-u1-infographic");
}
if (!/size:"16:9"/.test(voltCard)) {
  fail("EXAMPLES volt-dispatch-infographic graph should pin size 16:9");
}
if (!/name:"Dispatch brief"/.test(voltCard) || !/name:"Infographic"/.test(voltCard)) {
  fail("EXAMPLES volt-dispatch-infographic should be Dispatch brief → Infographic");
}
const voltImage = voltCard.match(/\{id:"n2",type:"image"[\s\S]*?name:"Infographic"\}/)?.[0] || "";
if (!voltImage) {
  fail("EXAMPLES volt-dispatch-infographic should have image node n2 Infographic");
}
if (!/model:"sensenova-u1-infographic"/.test(voltImage) || !/size:"16:9"/.test(voltImage)) {
  fail("EXAMPLES volt-dispatch-infographic image node should pin sensenova-u1-infographic at 16:9");
}
if (/qwen-image-3-pro|render-a-mockup/.test(voltImage)) {
  fail("EXAMPLES volt-dispatch-infographic must not pin Qwen UI mockup");
}
if (/type:"llm"/.test(voltCard) || /type:"upload"/.test(voltCard)) {
  fail("EXAMPLES volt-dispatch-infographic must stay text Dispatch brief → image Infographic (no LLM, no upload)");
}
if (/clarity-ai\/crystal-video-upscaler/.test(voltCard)) {
  fail("EXAMPLES volt-dispatch-infographic must not redo Crystal");
}
if (/h3-identity-restyle|minimax\/h3.*identity/.test(voltCard)) {
  fail("EXAMPLES volt-dispatch-infographic must not redo identity restyle");
}
if (/ideogram-v4/.test(voltCard)) {
  fail("EXAMPLES volt-dispatch-infographic must not redo Ideogram V4 Instant");
}
const spritesSample = samples.find((s) => s.slug === "character-sprites");
if (!spritesSample) fail("samples.json missing character-sprites");
if (spritesSample.preview !== "character-sprites/preview.webp") {
  fail("character-sprites sample preview should be character-sprites/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "character-sprites", "preview.webp"))) {
  fail("examples/gallery/character-sprites/preview.webp is missing");
}
if (!/z-ai\/glm-5\.3-flash/.test(JSON.stringify(spritesSample.models))) {
  fail("character-sprites sample should pin z-ai/glm-5.3-flash");
}
if (!/meta\/muse-image\/text-to-image/.test(JSON.stringify(spritesSample.models))) {
  fail("character-sprites sample should pin meta/muse-image/text-to-image");
}
if (!/meta\/muse-image\/edit/.test(JSON.stringify(spritesSample.models))) {
  fail("character-sprites sample should pin meta/muse-image/edit");
}
if (!/Iron Verdict|card\/game art|screenshot\.png/i.test(spritesSample.note) || !/no paid|pending/i.test(spritesSample.note)) {
  fail("character-sprites sample note should say cover is Iron Verdict card/game art and Muse QC is pending");
}
if (!/furnace knight|parts sheet/i.test(spritesSample.note)) {
  fail("character-sprites sample note should say the job is a furnace-knight reference + parts sheet");
}
if (!/cinematic-character-still|hero key-art/i.test(spritesSample.note)) {
  fail("character-sprites sample note should distinguish cinematic-character-still");
}
if (!/character-sprites skill|Iron Verdict/i.test(spritesSample.note)) {
  fail("character-sprites sample note should name the character-sprites skill and Iron Verdict");
}
if (/Volt|night-ride radio/i.test(spritesSample.note + JSON.stringify(spritesSample.inputs))) {
  fail("character-sprites must not be Volt-retargeted");
}
if (!/cracked ivory helmet|amber visor|navy armor|rust-red scarf|brass gauntlets/i.test(JSON.stringify(spritesSample.inputs))) {
  fail("character-sprites sample inputs should keep the furnace knight brief");
}
if (!hub.includes("character-sprites/preview.webp")) {
  fail("hub should thumb the character-sprites cover");
}
if (!hub.includes("A furnace knight you can rig")) {
  fail("hub should title character-sprites as A furnace knight you can rig");
}
const spritesHowTo = readFileSync(join(ROOT, "guide", "examples", "character-sprites.html"), "utf8");
if (!/z-ai\/glm-5\.3-flash/.test(spritesHowTo) || !/meta\/muse-image\/text-to-image/.test(spritesHowTo) || !/meta\/muse-image\/edit/.test(spritesHowTo)) {
  fail("character-sprites how-to should name GLM Flash, Muse t2i, and Muse edit");
}
if (!/furnace knight/i.test(spritesHowTo) || !/parts sheet/i.test(spritesHowTo)) {
  fail("character-sprites how-to should pitch the furnace-knight reference + parts sheet");
}
if (!/cinematic-character-still|hero key-art/i.test(spritesHowTo)) {
  fail("character-sprites how-to should distinguish cinematic-character-still");
}
if (!/Iron Verdict/i.test(spritesHowTo) || !/no paid|pending/i.test(spritesHowTo)) {
  fail("character-sprites how-to should say the cover is Iron Verdict art and Muse QC is pending");
}
if (/Volt|night-ride radio/i.test(spritesHowTo.split('<nav class="next">')[0])) {
  fail("character-sprites how-to must not be Volt-retargeted");
}
if (!spritesHowTo.includes("character-sprites/preview.webp")) {
  fail("character-sprites how-to should show the cover still");
}
if (!/slug:"character-sprites"[\s\S]*?model:"z-ai\/glm-5\.3-flash"/.test(examplesSrc)) {
  fail("EXAMPLES character-sprites graph should pin z-ai/glm-5.3-flash");
}
if (!/slug:"character-sprites"[\s\S]*?model:"meta\/muse-image\/text-to-image"/.test(examplesSrc)) {
  fail("EXAMPLES character-sprites graph should pin meta/muse-image/text-to-image");
}
if (!/slug:"character-sprites"[\s\S]*?model:"meta\/muse-image\/edit"/.test(examplesSrc)) {
  fail("EXAMPLES character-sprites graph should pin meta/muse-image/edit");
}
const stickerSample = samples.find((s) => s.slug === "transparent-brand-sticker");
if (!stickerSample) fail("samples.json missing transparent-brand-sticker");
if (stickerSample.preview !== "transparent-brand-sticker/preview.webp") {
  fail("transparent-brand-sticker sample preview should be transparent-brand-sticker/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "transparent-brand-sticker", "preview.webp"))) {
  fail("examples/gallery/transparent-brand-sticker/preview.webp is missing");
}
if (!/ideogram-v3-generate-transparent/.test(JSON.stringify(stickerSample.models))) {
  fail("transparent-brand-sticker sample should pin ideogram-v3-generate-transparent");
}
if (!/cover|reused Volt bolt card art|favicon/i.test(stickerSample.note) || !/no paid|pending/i.test(stickerSample.note)) {
  fail("transparent-brand-sticker sample note should say cover is reused Volt bolt art and Ideogram QC is pending");
}
if (!/clean alpha|transparent|sticker/i.test(stickerSample.note)) {
  fail("transparent-brand-sticker sample note should say the job is a transparent brand sticker");
}
if (!/Favicon|opaque square glyph|GLM/i.test(stickerSample.note)) {
  fail("transparent-brand-sticker sample note should distinguish Favicon / GLM+Muse");
}
if (!/Product cutout|BiRefNet/i.test(stickerSample.note)) {
  fail("transparent-brand-sticker sample note should distinguish Product cutout / BiRefNet");
}
if (!/Volt|night-ride radio|cyan/i.test(stickerSample.note)) {
  fail("transparent-brand-sticker sample note should pitch the Volt night-ride radio chevron");
}
if (!/rendering_speed|modelOpts/i.test(stickerSample.note)) {
  fail("transparent-brand-sticker sample note should say the image node does not forward rendering_speed");
}
if (!hub.includes("transparent-brand-sticker/preview.webp")) {
  fail("hub should thumb the transparent-brand-sticker cover");
}
if (!hub.includes("One cyan bolt. Clean alpha.")) {
  fail("hub should title transparent-brand-sticker as One cyan bolt. Clean alpha.");
}
const stickerHowTo = readFileSync(join(ROOT, "guide", "examples", "transparent-brand-sticker.html"), "utf8");
if (!/ideogram-v3-generate-transparent/.test(stickerHowTo)) {
  fail("transparent-brand-sticker how-to should name ideogram-v3-generate-transparent");
}
if (!/Volt/i.test(stickerHowTo) || !/cyan/i.test(stickerHowTo) || !/charcoal/i.test(stickerHowTo)) {
  fail("transparent-brand-sticker how-to should pitch the Volt charcoal + cyan chevron");
}
if (!/clean alpha|transparent/i.test(stickerHowTo)) {
  fail("transparent-brand-sticker how-to should say this is a clean-alpha sticker");
}
if (!/Favicon|opaque square glyph|GLM/i.test(stickerHowTo)) {
  fail("transparent-brand-sticker how-to should distinguish Favicon / GLM+Muse");
}
if (!/Product cutout|BiRefNet/i.test(stickerHowTo)) {
  fail("transparent-brand-sticker how-to should distinguish Product cutout / BiRefNet");
}
if (!/reused Volt bolt card art|no paid|pending/i.test(stickerHowTo)) {
  fail("transparent-brand-sticker how-to should say the cover is reused Volt bolt art and Ideogram QC is pending");
}
if (!/rendering_speed|modelOpts/i.test(stickerHowTo)) {
  fail("transparent-brand-sticker how-to should say the image node does not forward rendering_speed");
}
if (!stickerHowTo.includes("transparent-brand-sticker/preview.webp")) {
  fail("transparent-brand-sticker how-to should show the cover still");
}
if (!/slug:"transparent-brand-sticker"[\s\S]{0,200}thumb:"examples\/gallery\/transparent-brand-sticker\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES transparent-brand-sticker thumb should be examples/gallery/transparent-brand-sticker/preview.webp");
}
if (!/slug:"transparent-brand-sticker"[\s\S]{0,80}desc:"cyan lightning chevron sticker — clean alpha, no letters"/.test(examplesSrc)) {
  fail("EXAMPLES transparent-brand-sticker desc should pitch cyan lightning chevron sticker — clean alpha, no letters");
}
if (!/slug:"transparent-brand-sticker"[\s\S]{0,80}title:"transparent brand sticker"/.test(examplesSrc)) {
  fail("EXAMPLES transparent-brand-sticker title should be transparent brand sticker");
}
const stickerCard = examplesSrc.match(/slug:"transparent-brand-sticker"[\s\S]{0,2800}/)?.[0] || "";
if (!/ideogram-v3-generate-transparent/.test(stickerCard)) {
  fail("EXAMPLES transparent-brand-sticker graph should pin ideogram-v3-generate-transparent");
}
if (!/size:"1:1"/.test(stickerCard)) {
  fail("EXAMPLES transparent-brand-sticker graph should pin size 1:1");
}
const stickerImage = stickerCard.match(/\{id:"n2",type:"image"[\s\S]*?name:"Sticker"\}/)?.[0] || "";
if (!stickerImage) {
  fail("EXAMPLES transparent-brand-sticker should have image node n2 Sticker");
}
if (/modelOpts|rendering_speed/.test(stickerImage)) {
  fail("EXAMPLES transparent-brand-sticker image node must not forward rendering_speed modelOpts");
}
if (/z-ai\/glm-5\.3-flash|meta\/muse-image/.test(stickerCard)) {
  fail("EXAMPLES transparent-brand-sticker must not pin GLM or Muse");
}
if (/birefnet|sam3-image|pruna-ai\/p-image/.test(stickerCard)) {
  fail("EXAMPLES transparent-brand-sticker must not pin BiRefNet, SAM 3, or P-Image Upscale");
}
if (/type:"llm"|type:"upload"/.test(stickerCard)) {
  fail("EXAMPLES transparent-brand-sticker must stay text Brand brief → image Sticker (no LLM, no upload)");
}
const packSample = samples.find((s) => s.slug === "remove-packaging-text");
if (!packSample) fail("samples.json missing remove-packaging-text");
if (packSample.preview !== "remove-packaging-text/preview.webp") {
  fail("remove-packaging-text sample preview should be remove-packaging-text/preview.webp");
}
if (!existsSync(join(ROOT, "examples", "gallery", "remove-packaging-text", "preview.webp"))) {
  fail("examples/gallery/remove-packaging-text/preview.webp is missing");
}
if (!existsSync(join(ROOT, "examples", "gallery", "remove-packaging-text", "packaging-input.webp"))) {
  fail("examples/gallery/remove-packaging-text/packaging-input.webp is missing");
}
if (!/ideogram-v3-remove-text/.test(JSON.stringify(packSample.models))) {
  fail("remove-packaging-text sample should pin ideogram-v3-remove-text");
}
if (!/cover|reused Volt night-ride poster|image-model-arena/i.test(packSample.note) || !/no paid|pending/i.test(packSample.note)) {
  fail("remove-packaging-text sample note should say cover is reused Volt poster art and Ideogram QC is pending");
}
if (!/lettering|packaging|promo/i.test(packSample.note)) {
  fail("remove-packaging-text sample note should say the job is lettering cleanup");
}
if (!/Muse Edit|BiRefNet|SAM 3|P-Image|transparent sticker/i.test(packSample.note)) {
  fail("remove-packaging-text sample note should distinguish Muse Edit, BiRefNet, SAM 3, P-Image Upscale, and transparent sticker");
}
if (!/runner instruction|image-only/i.test(packSample.note)) {
  fail("remove-packaging-text sample note should say the edit prompt is a runner instruction");
}
if (!hub.includes("remove-packaging-text/preview.webp")) {
  fail("hub should thumb the remove-packaging-text cover");
}
if (!hub.includes("Letters off the card")) {
  fail("hub should title remove-packaging-text as Letters off the card");
}
const packHowTo = readFileSync(join(ROOT, "guide", "examples", "remove-packaging-text.html"), "utf8");
if (!/ideogram-v3-remove-text/.test(packHowTo)) {
  fail("remove-packaging-text how-to should name ideogram-v3-remove-text");
}
if (!/Volt/i.test(packHowTo) || !/cyan/i.test(packHowTo) || !/charcoal/i.test(packHowTo)) {
  fail("remove-packaging-text how-to should pitch the Volt charcoal + cyan promo card");
}
if (!/lettering|letters/i.test(packHowTo)) {
  fail("remove-packaging-text how-to should say this strips lettering");
}
if (!/Muse Edit|BiRefNet|SAM 3|P-Image|transparent sticker/i.test(packHowTo)) {
  fail("remove-packaging-text how-to should distinguish Muse Edit, BiRefNet, SAM 3, P-Image Upscale, and transparent sticker");
}
if (!/reused Volt promo-card art|no paid|pending/i.test(packHowTo)) {
  fail("remove-packaging-text how-to should say the cover is reused Volt promo-card art and Ideogram QC is pending");
}
if (!/runner instruction|image-only/i.test(packHowTo)) {
  fail("remove-packaging-text how-to should say the edit prompt is a runner instruction");
}
if (!packHowTo.includes("remove-packaging-text/preview.webp")) {
  fail("remove-packaging-text how-to should show the cover still");
}
if (!/slug:"remove-packaging-text"[\s\S]{0,200}thumb:"examples\/gallery\/remove-packaging-text\/preview\.webp"/.test(examplesSrc)) {
  fail("EXAMPLES remove-packaging-text thumb should be examples/gallery/remove-packaging-text/preview.webp");
}
if (!/slug:"remove-packaging-text"[\s\S]{0,80}desc:"Volt promo card — letters gone"/.test(examplesSrc)) {
  fail("EXAMPLES remove-packaging-text desc should pitch Volt promo card — letters gone");
}
if (!/slug:"remove-packaging-text"[\s\S]{0,80}title:"remove packaging text"/.test(examplesSrc)) {
  fail("EXAMPLES remove-packaging-text title should be remove packaging text");
}
const packCard = examplesSrc.match(/slug:"remove-packaging-text"[\s\S]{0,2800}/)?.[0] || "";
if (!/ideogram-v3-remove-text/.test(packCard)) {
  fail("EXAMPLES remove-packaging-text graph should pin ideogram-v3-remove-text");
}
if (!/size:"auto"/.test(packCard)) {
  fail("EXAMPLES remove-packaging-text graph should pin size auto");
}
if (!/name:"Packaging still"/.test(packCard) || !/name:"Remove lettering"/.test(packCard) || !/name:"Export preview"/.test(packCard)) {
  fail("EXAMPLES remove-packaging-text should be Packaging still → Remove lettering → Export preview");
}
const packEdit = packCard.match(/\{id:"n2",type:"edit"[\s\S]*?name:"Remove lettering"\}/)?.[0] || "";
if (!packEdit) {
  fail("EXAMPLES remove-packaging-text should have edit node n2 Remove lettering");
}
if (!/model:"ideogram-v3-remove-text"/.test(packEdit) || !/size:"auto"/.test(packEdit)) {
  fail("EXAMPLES remove-packaging-text edit node should pin ideogram-v3-remove-text at auto");
}
if (/birefnet|sam3-image|pruna-ai\/p-image|ideogram-v3-generate-transparent|meta\/muse-image/.test(packEdit)) {
  fail("EXAMPLES remove-packaging-text edit node must not pin Muse Edit, BiRefNet, SAM 3, P-Image Upscale, or transparent sticker");
}
if (/type:"llm"/.test(packCard)) {
  fail("EXAMPLES remove-packaging-text must stay upload → edit → resize (no LLM)");
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
