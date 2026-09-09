#!/usr/bin/env node
// Render the static how-to hub + one page per reviewed gallery sample
// (plus Iron Verdict). No network or model calls. Share links are rebuilt
// from each sample's current workflow.json — the same bytes the gallery
// "Open workflow" buttons use.
//
//   node scripts/sync-guide-examples.mjs            # write guide/examples/*.html
//   node scripts/sync-guide-examples.mjs --check    # compare committed files
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY = join(ROOT, "examples", "gallery");
const OUT = join(ROOT, "guide", "examples");
const SAMPLES = JSON.parse(readFileSync(join(GALLERY, "samples.json"), "utf8"));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

const local = (file) => {
  if (!/^[\w/-]+\.[\w]+$/.test(file) || file.includes("..") || !existsSync(join(GALLERY, file))) {
    throw new Error("Missing/invalid sample asset: " + file);
  }
  return file;
};

const formatCost = (usd, exact = true) =>
  `${exact ? "" : "at least "}$${Number(Number(usd).toFixed(5))}`;

const shareLink = (workflowBytes) =>
  "https://nanoodle.com/#g=" + gzipSync(workflowBytes).toString("base64url");

// How-to copy is grounded in samples.json notes, EXAMPLES comment nodes, and
// the awesome-noodles README / CURATION.md. Do not invent costs or model ids.
const HOWTO = {
  "fable-five-step": {
    headline: "Messy dump → plan",
    job: "Pick a shape. Get a plan.",
    purpose: "A messy coding dump and a Choice — five numbered steps, a GitHub PR body, or failing-test first. Claude Fable 5.1 writes that shape. One text call. The invoices crime scene is filled so first-click has something to chew; swap the dump.",
    edit: "Paste your dump into <em>Messy dump</em>. Pick a <em>Shape</em>. Leave Fable 5.1 unless you mean to change models.",
    inspect: "Cover still is card art for the Choice→Fable first-click — messy invoices dump becoming a five-step plan, not a paid Fable QC transcript. Open the graph and hit Run with your key. The plan should follow the selected shape, name files and functions, and stay under 180 words.",
    costHow: "Listed at about $0.02 for one Fable 5.1 call at reasoning low / 512 tokens. Prices and results vary. This page has no reviewed first-party run yet.",
  },
  deslop: {
    headline: "Kill the AI voice",
    job: "Kill the AI voice. Keep every fact.",
    purpose: "That midnight drop email sounds like a brand that asked a chatbot to sound expensive. This noodle rewrites it like a person, then a second model checks every date, price, and caveat against the source before the last pass.",
    edit: "Paste the slop into <em>Your draft</em>. Leave the three LLM nodes unless you mean to change models: Grok drafts, Terra fact-checks, Grok applies the review.",
    inspect: "Every supplied fact has to survive — the saved run keeps 8 September at 00:01 JST, the $280 price, the 120-jacket limit, one-per-customer, no restock, Friday–Saturday Shibuya pickup hours, the confirmation QR, and drop@example.com. Empty hype should vanish. The review checks writing and facts. It does not detect authorship. Cover still is the midnight night-raid jacket drop — card art, not the generated notice.",
    costHow: "The reviewed run reported $0.0079 across three paid text calls. Token use and model prices move; check the editor estimate before you hit Run.",
  },
  favicon: {
    headline: "A bolt that reads at 16px",
    job: "One cyan bolt. Readable at 16 pixels.",
    purpose: "A courier-night brand sentence becomes a glyph you'd actually put on a tab. First-click is Volt — lightning chevron, charcoal field, electric cyan. Flat, bold, no tiny detail that dies when the favicon shrinks.",
    edit: "Rewrite <em>Brand</em> — name, symbol, colors. GLM Flash condenses it; Muse paints one square.",
    inspect: "Squint at 16 pixels. One glyph, the palette you asked for, a silhouette that still reads. This is a raster concept — export real favicon sizes as a separate step. The saved brief has no letters.",
    costHow: "The reviewed run reported $0.01. The image step is listed at $0.01, plus a small text call. Prices and results vary.",
  },
  "fibo-studio-still": {
    headline: "A radio on dark slate",
    job: "Volt night-ride radio. Pick the light.",
    purpose: "Describe the object, pick a light, get an editorial still of a product that doesn't exist yet. First-click is Volt — matte charcoal chassis, electric-cyan lightning chevron, dark slate. Distinct from the rain-asphalt photo→video clip and the favicon glyph: this is the radio itself, in studio light. When you already have a real product photo, start with the catalog-clean edit instead.",
    edit: "Rewrite <em>Product</em> (shape, materials, count) and pick a <em>Light</em>. GLM Flash structures the brief; Bria FIBO renders at 1MP.",
    inspect: "Count, material, color, and the light you picked should match. No invented packaging or logos. The saved still is a fictional charcoal-and-cyan radio — not a photograph of merchandise.",
    costHow: "The reviewed run reported $0.04. The image step is listed at $0.04, plus a small text call. Prices and results vary.",
  },
  "cinematic-character-still": {
    headline: "Neon courier key-art",
    job: "Neon courier. One rider, one city, one frame.",
    purpose:
      "Three knobs: who they are, how the light hits, how the frame is cut. MiniMax H3 Image paints the brief directly — no prompt-writing call. The reviewed still is a motorcycle courier in a night alley: magenta rim, cyan bounce, red helmet under one arm. One frame that could open a short.",
    edit: "Change <em>Person</em>, <em>Light</em>, and <em>Frame</em>. Those three inputs are the whole brief. Type the rider, the neon, the crop.",
    inspect:
      "One person. Magenta and cyan if you kept that light. Helmet readable. No extra people, no readable text. Generated key-art, not a photograph of a real person.",
    costHow: "The reviewed run reported $0.02 ($0.02/image at 1K). Prices and results vary.",
  },
  "edit-a-photo": {
    headline: "Cool catalog. Same product.",
    job: "Charcoal paper. Cyan rim.",
    purpose: "Keep the object. Lose the clutter. Start here when you already have a shot — or a generated still — of the thing. First-click is a cool night-ride catalog: matte charcoal seamless, hard electric-cyan rim, soft magenta bounce.",
    edit: "Drop your photo on <em>Product photo</em>. Tighten <em>Edit request</em> if the default cool-catalog brief is wrong. Muse Edit uses both.",
    inspect: "Shape, color, materials, markings, visible text — compare them to the source. Check real product marks before you publish a generated edit. Cover still is a Volt night-ride radio on charcoal. The saved Clean_product_photo.webp and product-input.png are the earlier 5 September warm-white amber-bottle sample — historical, not regenerated.",
    costHow: "The reviewed warm-white bottle run reported $0.01 ($0.01/image). Cover still is card art. Prices and results vary.",
  },
  "product-cutout": {
    headline: "Knock the slate out",
    job: "Volt radio. Transparent. Ready to drop.",
    purpose: "Upload a product still. BiRefNet V2 knocks the background and keeps the fine edges — a transparent cutout for compositing, not a relit catalog. First-click is Volt — matte charcoal pocket night-ride radio, electric-cyan lightning chevron, dark slate / hard cyan rim. Distinct from Clean product photo, which relights and replaces the backdrop. Not SAM 3.",
    edit: "Drop your still on <em>Product still</em>. Leave <em>Transparent cutout</em> on <code>birefnet/v2</code> unless you mean to change models. <em>Export preview</em> is a local 1024 fit.",
    inspect: "Cover still is the reused FIBO Volt plate, pending a true BiRefNet V2 QC cutout — no paid birefnet/v2 run this PR, not a fabricated cutout. Open the graph and hit Run with your key after you upload a still. Inspect the native cutout for silhouette and edge detail. Export preview is a local 1024 fit only.",
    costHow: "Listed at $0.01 for one BiRefNet V2 call at auto. Local resize is $0. No LLM. Prices and results vary. This page has no reviewed first-party cutout yet.",
  },
  "combine-images": {
    headline: "Drop it in the alley",
    job: "Volt radio. Wet neon alley.",
    purpose: "Preview the Volt radio on wet neon asphalt before you book the night lane. Scale, light, and contact shadows should feel inevitable. First-click is night-ride product placement — matte charcoal pocket radio, cyan lightning chevron, cyan and magenta alley light. Distinct from the charcoal-paper catalog cleanup: this drops the product into a real setting.",
    edit: "Product on <em>Product photo</em>, alley on <em>Setting photo</em>, and <em>Placement brief</em> if the default night-ride rules are wrong for your pair.",
    inspect: "Both references should matter. Product identity and the alley's layout survive. Shadows and scale should be plausible. Cover still is a Volt radio in a wet neon alley. The saved Product_in_setting.webp, product-input.png and setting-input.jpg are the earlier 5 September amber-bottle / tea-desk sample — historical, not regenerated. Composites still need a fidelity check.",
    costHow: "The reviewed tea-desk run reported $0.01 ($0.01/image). Cover still is card art. Prices and results vary.",
  },
  "image-model-arena": {
    headline: "Four models. One winner.",
    job: "Four models. One brief. No winner speech.",
    purpose: "Make them all draw the same Volt night-ride poster. Keep the one that got the useful details right — polish is not the same as a lightning chevron. First-click is NIGHT RIDE / TUE 9 SEP: one charcoal radio, cyan bolt, dark slate.",
    edit: "Rewrite <em>Shared test brief</em>. The four image nodes already pin Muse, GPT Image 2.5 Flare, Grok Imagine Image 2.0, and Recraft V4. Run spends four images.",
    inspect: "Exact heading NIGHT RIDE and footer TUE 9 SEP, one charcoal radio, cyan lightning chevron, composition, color. Cover still is the Volt night-ride poster. The saved Contender_1–4 images are the earlier 5 September FIX A FLAT / tire-lever sample — historical, not regenerated. Contender 2's saved still is the Krea sample; Open workflow now pins GPT Image 2.5 Flare. One prompt is not a ranking.",
    costHow: "The reviewed FIX A FLAT run reported $0.118 (Muse $0.01, Krea $0.01, Grok $0.06, Recraft $0.038). Four paid image calls. Cover still is card art. Prices and results vary.",
  },
  "night-market-postcard": {
    headline: "Rain. Neon. One postcard.",
    job: "A place, a mood, a postcard.",
    purpose: "Type a destination. Pick a vibe. Leave with a 3:2 travel print — not a stock photo of the wrong city. The sample place lives only in the input.",
    edit: "Rewrite <em>Place</em> and pick a <em>Vibe</em>. GLM Flash writes the postcard prompt; Muse renders at 3:2.",
    inspect: "Landmarks and local details should match what you typed. A new city should not inherit someone else's lanterns. Illustration, not a documentary frame, not typeset print copy.",
    costHow: "The reviewed run reported $0.01. The image step is listed at $0.01, plus a small text call. Prices and results vary.",
  },
  "photo-to-video": {
    headline: "Rain on a night-ride radio",
    job: "One still. One breath of rain.",
    purpose: "Five seconds where the Volt radio stays put and the rain doesn't. Generate the frame, then move one small thing. First-click is a charcoal night-ride radio on wet asphalt — magenta and cyan neon, no letters.",
    edit: "Change <em>Still brief</em> and <em>Motion brief</em> together so they describe the same scene. Muse draws the first frame; MiniMax H3 Spicy animates 5 seconds at 480p.",
    inspect: "Whatever you called still should stay still. A seamless loop is not promised. Cover still is the Volt night-ride radio. The saved MP4 is the earlier 5 September tea-mug steam sample — historical, not regenerated. The open workflow uses the current model ID after a provider-name migration.",
    costHow: "The reviewed tea-mug clip reported $0.21 (Muse $0.01 + MiniMax H3 Spicy $0.20 at 480p / 5s). Cover still is card art. Prices and results vary.",
  },
  "omni-flash-turntable": {
    headline: "Orbit the charcoal radio",
    job: "Orbit the radio. Keep the cyan rim honest.",
    purpose: "No upload. Describe the thing, pick one camera move, get a five-second draft. First-click is a matte-charcoal Volt pocket night-ride radio on a charcoal plinth — hard cyan rim, electric-cyan lightning chevron, dark studio void. Same knobs. A concept object, not a catalog SKU.",
    edit: "Rewrite <em>Object</em> and pick a <em>Move</em>. GLM Flash structures the brief; Omni Flash 1.1 renders 5 seconds at 360p / 16:9.",
    inspect: "The move you picked happens once. Geometry stays stable. Count and colors match. 360p draft. Cover still is the Volt radio on a charcoal plinth. The saved Clip.mp4 is the earlier chrome motorcycle helmet sample — historical, not regenerated.",
    costHow: "The reviewed helmet clip reported $0.195 for the video step, plus a small text call. Cover still is card art. Prices and results vary.",
  },
  "render-a-mockup": {
    headline: "A dispatch screen you can argue about",
    job: "A dispatch screen you can argue about.",
    purpose: "The labels you already wrote, as a picture. Design review — not a working app. First-click is a charcoal Volt courier-dispatch board — Tonight, Couriers, Radios, cyan New dispatch.",
    edit: "Edit <em>Screen brief</em> and <em>Visual style</em>. Keep the pair under 800 characters (the saved pair is 696). Qwen Image 3 Pro paints the joined brief at 1K. No prompt-writing call.",
    inspect: "Navigation, date, rows, courier ids, statuses, totals — still there, no invented sections. Output is an image. Cover still is the charcoal and cyan Volt dispatch board.",
    costHow: "The reviewed run reported $0.04 ($0.04/image at 1K). Prices and results vary.",
  },
  sing: {
    headline: "The song after the last leap",
    job: "Credits after the last leap.",
    purpose: "Original closing-credits music from a brief and a style. No artist cosplay. First-click is a rooftop getaway — rain, last leap, red neon six floors down.",
    edit: "Rewrite <em>Song brief (theme, not lyrics)</em> and <em>Style (instruments &amp; tempo)</em>. GLM Flash writes labeled lyrics; Mureka Generate Song sings them.",
    inspect: "Clear words, a chorus you can hum, fit to the brief. Duration and exact structure can wander. The saved ~182-second MP3 is the rooftop-getaway synthwave run; chorus \"I made it out, but the city wants me back\". No new paid audio-model review. Cover still is the rooftop leap.",
    costHow: "The reviewed song run reported $0.225 (music step $0.225, plus a small text call). Prices and results vary.",
  },
  "talking-avatar": {
    headline: "Look at camera. Clear the channel.",
    job: "Night courier. One line to camera.",
    purpose: "A face, a voice, a line to camera. Keep the script under 30 seconds. Match the presenter to the voice you picked. First-click is a Volt night-courier dispatcher — charcoal jacket, cyan lightning chevron, night board. Type the line you'd actually say.",
    edit: "Change <em>Presenter look</em>, <em>Spoken script</em>, and <em>Delivery</em>. Muse paints the face, MiniMax Speech reads, LongCat animates at 480p.",
    inspect: "The words are right, the face stays visible, the mouth follows the speech. Check lip-sync in playback — we don't claim frame-accurate timing. Generation can take several minutes; an earlier attempt blew a four-minute timeout. Cover still is the Volt night-courier dispatcher. The saved MP4 is the earlier 5 September workshop/museum-guide sample — historical, not regenerated. A Gemini 3.8 Flash transcript of that older run reported $0.00164 (model-assisted). The open workflow uses current model IDs after a provider-name migration.",
    costHow: "The reviewed workshop run reported at least $0.28. Video is listed at $0.03 per audio second at 480p, plus portrait and speech. Some provider price fields were omitted. Cover still is card art. Prices and results vary.",
  },
  "infinitetalk-radio-take": {
    headline: "Hold the radio. Follow the take.",
    job: "Still + audio. Lips and body follow the sound.",
    purpose: "Turn a still and an audio take into a speaking/singing courier clip where lips and body follow the sound — not a TTS→LongCat intro. First-click is a Volt charcoal/cyan night-ride radio take: mid-shot courier, pocket radio chest-high, rain-slick rooftop. Distinct from Night-courier spoken intro (Muse → MiniMax Speech → LongCat).",
    edit: "Rewrite <em>Still brief</em> and the <em>Radio take</em> line, or swap Speech for an uploaded clip under ~15 seconds. Leave Avatar / lipsync on <code>infinitetalk</code> at single / 480p.",
    inspect: "Cover still is card art for the mid-shot courier + pocket radio — not a paid InfiniteTalk QC clip. Sample video QC pending. Open the graph and hit Run with your key. Inspect body motion and lip timing. This model follows the sound; it does not invent a TTS script.",
    costHow: "Listed from about $0.09 for InfiniteTalk (duration/resolution) plus Muse ~$0.01. Speech only if you keep the bootstrap. Prices and results vary. This page has no reviewed first-party InfiniteTalk clip yet.",
  },
};

// Awesome-noodles README share link for character-sprites (Iron Verdict is
// not a samples.json entry). Do not invent a second link.
const IRON = {
  slug: "iron-verdict",
  title: "Iron Verdict",
  headline: "Iron Verdict",
  job: "A furnace knight. Then a fight you can actually play.",
  costLabel: "$0.02 combined (selected source images)",
  review: "Playable experiment",
  date: "2026-09-05",
  models: ["z-ai/glm-5.3-flash", "meta/muse-image/text-to-image", "meta/muse-image/edit"],
  open: readFileSync(join(ROOT, "scripts", "fixtures", "iron-verdict-open-url.txt"), "utf8").trim(),
  play: "https://nanoodle.com/examples/iron-verdict/",
  skill: "https://github.com/nanoodlecom/noodle-skills/tree/main/skills/character-sprites",
  graph: "https://github.com/nanoodlecom/awesome-noodles/blob/main/graphs/character-sprites.noodle-graph.json",
  zip: "/examples/iron-verdict/iron-verdict.zip",
  preview: "/examples/iron-verdict/screenshot.png",
  purpose: "A coding agent used the character-sprites skill for matching artwork and 32 transparent frames, then built this three-round foundry fighter around them. Playing is free. No key.",
  edit: "Want a different fighter? Open the artwork graph and rewrite <em>Character</em>. You get a reference and a four-quadrant parts sheet. Idle, walk, punch, and jump frames need the companion skill (Node.js and ffmpeg). The agent — not the graph — writes gravity, combat, and sound.",
  inspect: "Play it: three rounds, readable windups, heavy jumps. Cutout prototype — rigid limbs, mirrored facing. Opening the graph alone does not spit out an atlas or a game.",
  costHow: "The selected source images cost $0.02 combined ($0.01 each for reference and parts). Local baking and playtesting made no further model calls. Your own character spends your NanoGPT balance; the skill has the full run.",
};

for (const s of SAMPLES) {
  if (!HOWTO[s.slug]) throw new Error("Add HOWTO copy for sample: " + s.slug);
}

const GROUPS = [
  { id: "playable", title: "Playable", slugs: ["iron-verdict"] },
  { id: "image", title: "Image", slugs: [
    "edit-a-photo", "product-cutout", "combine-images", "render-a-mockup", "favicon",
    "night-market-postcard", "fibo-studio-still", "cinematic-character-still",
    "image-model-arena",
  ] },
  { id: "video", title: "Video", slugs: ["photo-to-video", "omni-flash-turntable", "talking-avatar", "infinitetalk-radio-take"] },
  { id: "audio", title: "Audio", slugs: ["sing"] },
  { id: "text", title: "Text", slugs: ["deslop", "fable-five-step"] },
];

function chrome({ title, description, path, crumbs, wide, body, next }) {
  const url = "https://nanoodle.com" + path;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />

<meta property="og:type" content="article" />
<meta property="og:site_name" content="nanoodle" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:image" content="https://nanoodle.com/og-card.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="Neon noodles rising from a ramen bowl into glowing workflow cables, with the nanoodle logo" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="https://nanoodle.com/og-card.png" />

<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<meta name="theme-color" content="#0b0d12" />
<link rel="canonical" href="${esc(url)}" />
<link rel="stylesheet" href="/guide/guide.css" />
</head>
<body>
<div class="wrap${wide ? " wide" : ""}">

  <header>
    <a class="logo" href="/"><span class="nano">NaNo</span>odle</a>
    <div class="spacer"></div>
    <a class="ghost" href="/">Open editor →</a>
  </header>

  <nav class="crumbs">${crumbs}</nav>

  <main>
${body}
      <nav class="next">
${next}
      </nav>
    </section>
  </main>

  <footer>
    <span>Made with <a href="https://nano-gpt.com/r/mgzwtqjw" target="_blank" rel="noopener">NanoGPT</a></span>
    <span>· 100% in your browser, no server</span>
    <div class="spacer"></div>
    <a href="https://github.com/nanoodlecom/nanoodle" target="_blank" rel="noopener">GitHub</a>
    <a href="https://www.reddit.com/user/dividebynano" target="_blank" rel="noopener">Contact</a>
    <a href="/">Home</a>
  </footer>

</div>
</body>
</html>
`;
}

function sampleBySlug(slug) {
  return SAMPLES.find((s) => s.slug === slug);
}

function howTitle(slug) {
  if (slug === "iron-verdict") return IRON.headline || IRON.title;
  const how = HOWTO[slug];
  return (how && how.headline) || sampleBySlug(slug).title;
}

function cardForSample(s) {
  const how = HOWTO[s.slug];
  const cost = formatCost(s.costUsd, s.costExact);
  const href = `/guide/examples/${esc(s.slug)}`;
  let thumb;
  if (how.skipPreview) {
    thumb = `<div class="thumb-fallback pending">${esc(how.thumbLabel || how.headline)}</div>`;
  } else if (s.preview) {
    thumb = `<img class="thumb" src="/examples/gallery/${esc(local(s.preview))}" alt="" loading="lazy" />`;
  } else if (s.outputs.some((o) => o.kind === "image")) {
    const img = s.outputs.find((o) => o.kind === "image");
    thumb = `<img class="thumb" src="/examples/gallery/${esc(local(img.src))}" alt="" loading="lazy" />`;
  } else {
    thumb = `<div class="thumb-fallback">No preview image — open for the reviewed ${s.outputs[0].kind} output</div>`;
  }
  return `<a class="howto-card" href="${href}">
        ${thumb}
        <span class="body">
          <b>${esc(how.headline || s.title)}</b>
          <span class="job">${esc(how.job)}</span>
          <span class="cost">${esc(cost)} to run the reviewed sample</span>
        </span>
      </a>`;
}

function ironCard() {
  return `<a class="howto-card" href="/guide/examples/iron-verdict">
        <img class="thumb" src="${esc(IRON.preview)}" alt="" loading="lazy" />
        <span class="body">
          <b>${esc(IRON.title)}</b>
          <span class="job">${esc(IRON.job)}</span>
          <span class="cost">${esc(IRON.costLabel)}</span>
        </span>
      </a>`;
}

function renderMedia(s, how) {
  if (how && how.skipHeroMedia) {
    return `<p class="no-preview pending">${esc(how.swapNotice || "Featured still incoming — open the graph.")}</p>`;
  }
  const multi = s.outputs.length > 1 ? " comparison" : "";
  const aria = (how && how.headline) || s.title;
  const figures = s.outputs.map((o) => {
    const src = "/examples/gallery/" + local(o.src);
    if (o.kind === "text") {
      const text = readFileSync(join(GALLERY, local(o.src)), "utf8");
      return `<figure><blockquote class="sample">${esc(text)}</blockquote><figcaption>${esc(o.label)} · <a href="${esc(src)}" download>Download</a></figcaption></figure>`;
    }
    if (o.kind === "video") {
      const poster = s.preview ? ` poster="/examples/gallery/${esc(local(s.preview))}"` : "";
      return `<figure><video controls preload="none"${poster} aria-label="${esc(aria)}"><source src="${esc(src)}" type="video/mp4"></video><figcaption>${esc(o.label)} · <a href="${esc(src)}" download>Download</a></figcaption></figure>`;
    }
    if (o.kind === "audio") {
      return `<figure><audio controls preload="none" aria-label="${esc(aria)}"><source src="${esc(src)}" type="audio/mpeg"></audio><figcaption>${esc(o.label)} · <a href="${esc(src)}" download>Download</a></figcaption></figure>`;
    }
    return `<figure><a href="${esc(src)}"><img src="${esc(src)}" alt="${esc(o.label + " — " + aria)}" loading="lazy" /></a><figcaption>${esc(o.label)} · <a href="${esc(src)}" download>Download</a></figcaption></figure>`;
  }).join("\n          ");
  const note = !s.preview && s.outputs.every((o) => o.kind === "audio" || o.kind === "text")
    ? `<p class="no-preview">No preview image was saved for this sample. The reviewed output is the ${s.outputs.map((o) => o.kind).join(" and ")} below.</p>`
    : "";
  const cover = s.preview && s.outputs.every((o) => o.kind === "audio" || o.kind === "text")
    ? `<div class="media">
          <figure><a href="/examples/gallery/${esc(local(s.preview))}"><img src="/examples/gallery/${esc(local(s.preview))}" alt="${esc(aria)}" loading="lazy" /></a><figcaption>Cover still · <a href="/examples/gallery/${esc(local(s.preview))}" download>Download</a></figcaption></figure>
        </div>
        `
    : "";
  return `${note}${cover}<div class="media${multi}">
          ${figures}
        </div>`;
}

function samplePage(s, prev, next) {
  const how = HOWTO[s.slug];
  const graph = readFileSync(join(GALLERY, local(s.slug + "/graph.json")));
  if (createHash("sha256").update(graph).digest("hex") !== s.graphSha256) {
    throw new Error("Sample graph changed: " + s.slug);
  }
  const workflow = readFileSync(join(GALLERY, local(s.workflow)));
  if (createHash("sha256").update(workflow).digest("hex") !== s.workflowSha256) {
    throw new Error("Workflow changed: " + s.slug);
  }
  const open = shareLink(workflow);
  const gallery = `/examples/gallery/#${s.slug}`;
  const cost = formatCost(s.costUsd, s.costExact);
  const title = how.headline || s.title;
  const crumbs = `<a href="/">Home</a> / <a href="/guide/">Guide</a> / <a href="/guide/examples/">Steal a noodle</a> / <span>${esc(title)}</span>`;
  const nextLinks = [
    `<a href="/guide/examples/">← All examples</a>`,
    prev ? `<a href="/guide/examples/${esc(prev.slug)}">${esc(prev.title)}</a>` : "",
    next ? `<a href="/guide/examples/${esc(next.slug)}">${esc(next.title)} →</a>` : "",
    `<a href="${esc(gallery)}">Reviewed run</a>`,
  ].filter(Boolean).map((a) => "        " + a).join("\n");

  const inputImgs = s.inputs.filter((i) => i.src).map((i) => {
    const src = "/examples/gallery/" + local(i.src);
    return `<figure><img src="${esc(src)}" alt="${esc(i.label)}" loading="lazy" /><figcaption>${esc(i.label)}</figcaption></figure>`;
  }).join("\n          ");
  const note = !how.hideNote && s.note
    ? `\n      <div class="callout"><p>${esc(s.note)}</p></div>`
    : "";

  const body = `    <h1><span class="grad">${esc(title)}</span></h1>
    <p class="lede">${esc(how.job)}</p>

    <section>
      <p class="meta-row">${esc(s.review)} · ${esc(s.date)} · Reported run: ${esc(cost)}. ${s.models.map((m) => `<code>${esc(m)}</code>`).join(" · ")}</p>

      <h2>The look</h2>
      ${renderMedia(s, how)}
      ${inputImgs ? `<h3>References that went in</h3>\n        <div class="media input-refs${s.inputs.filter((i) => i.src).length > 1 ? " comparison" : ""}">\n          ${inputImgs}\n        </div>` : ""}${note}

      <p>${esc(how.purpose)}</p>

      <h2>Make it yours</h2>
      <ol class="input-list">
        <li>Open the graph — save first if the canvas already has your work. Undo brings yours back.</li>
        <li>${how.edit}</li>
        <li>${how.inspect}</li>
        <li>${esc(how.costHow)}</li>
      </ol>

      <div class="cta">
        <a class="primary" href="${esc(open)}">Open this noodle →</a>
        <a class="secondary" href="${esc(gallery)}">See the reviewed run</a>
      </div>
      <p class="howto-note"><a href="/examples/gallery/${esc(local(s.workflow))}" download>Download workflow</a>
        · <a href="/examples/gallery/${esc(local(s.slug + "/graph.json"))}" download>Original sampled graph</a>
        · <a href="https://mcp.nanoodle.com/#${esc(s.slug)}">Explore MCP tools</a>
        · <a href="https://github.com/nanoodlecom/awesome-noodles">awesome-noodles</a></p>`;

  return chrome({
    title: `${title} — nanoodle`,
    description: `${how.job} ${cost}.`,
    path: `/guide/examples/${s.slug}`,
    crumbs,
    body,
    next: nextLinks,
  });
}

function ironPage(prev, next) {
  const crumbs = `<a href="/">Home</a> / <a href="/guide/">Guide</a> / <a href="/guide/examples/">Steal a noodle</a> / <span>${esc(IRON.headline)}</span>`;
  const nextLinks = [
    `<a href="/guide/examples/">← All examples</a>`,
    prev ? `<a href="/guide/examples/${esc(prev.slug)}">${esc(prev.title)}</a>` : "",
    next ? `<a href="/guide/examples/${esc(next.slug)}">${esc(next.title)} →</a>` : "",
    `<a href="${esc(IRON.play)}">Play Iron Verdict</a>`,
  ].filter(Boolean).map((a) => "        " + a).join("\n");
  const body = `    <h1><span class="grad">${esc(IRON.title)}</span></h1>
    <p class="lede">${esc(IRON.job)}</p>

    <section>
      <p class="meta-row">${esc(IRON.review)} · ${esc(IRON.date)} · ${esc(IRON.costLabel)}. Artwork models: ${IRON.models.map((m) => `<code>${esc(m)}</code>`).join(", ")}. Prices and results vary.</p>
      <p>A furnace knight, then a harsh afternoon. Playing is free. Making your own character spends your NanoGPT balance and needs Node.js plus ffmpeg.</p>

      <h2>The look</h2>
      <div class="media">
        <figure>
          <a href="${esc(IRON.play)}"><img src="${esc(IRON.preview)}" alt="Iron Verdict — playable foundry fighter" loading="lazy" /></a>
          <figcaption>Playable game · <a href="${esc(IRON.play)}">Open Iron Verdict</a></figcaption>
        </figure>
      </div>

      <p>${esc(IRON.purpose)}</p>

      <h2>Make it yours</h2>
      <ol class="input-list">
        <li>Play it. No key. Motion and sound toggles live on the game page.</li>
        <li>${IRON.edit}</li>
        <li>${esc(IRON.inspect)}</li>
        <li>${esc(IRON.costHow)}</li>
      </ol>

      <div class="cta">
        <a class="primary" href="${esc(IRON.open)}">Open this noodle →</a>
        <a class="secondary" href="${esc(IRON.play)}">Play Iron Verdict</a>
      </div>
      <p class="howto-note"><a href="${esc(IRON.skill)}">Get the character-sprites skill</a>
        · <a href="${esc(IRON.graph)}">Artwork workflow on GitHub</a>
        · <a href="${esc(IRON.zip)}" download>Download game + source</a>
        · <a href="https://mcp.nanoodle.com">Explore MCP tools</a></p>`;

  return chrome({
    title: "Iron Verdict — nanoodle",
    description: `${IRON.job} ${IRON.costLabel}.`,
    path: "/guide/examples/iron-verdict",
    crumbs,
    body,
    next: nextLinks,
  });
}

function hubPage() {
  const groups = GROUPS.map((g) => {
    const cards = g.slugs.map((slug) => {
      if (slug === "iron-verdict") return ironCard();
      const s = sampleBySlug(slug);
      if (!s) throw new Error("Hub slug missing from samples.json: " + slug);
      return cardForSample(s);
    }).join("\n      ");
    return `      <h2 class="group">${esc(g.title)}</h2>
      <div class="howto-grid">
      ${cards}
      </div>`;
  }).join("\n");

  const listed = new Set(GROUPS.flatMap((g) => g.slugs));
  for (const s of SAMPLES) {
    if (!listed.has(s.slug)) throw new Error("Sample not listed on the hub: " + s.slug);
  }

  const body = `    <h1>Steal a <span class="grad">noodle</span></h1>
    <p class="lede">See the real output. Open the graph. Make it yours.</p>

    <section>
      <p>Night markets. Neon couriers. Rain on a night-ride radio. A clip that actually sings. These sit beside the <a href="/examples/gallery/">reviewed gallery</a> — real stills, clips, songs, and edits, not mockups of mockups. Looking is free. Running spends your NanoGPT balance. Costs are the reported first-party runs. The next one will not be identical.</p>
      <p>Pick a card. Change a line. Hit <strong>Open this noodle</strong> for the same share graph the gallery uses. Every card is an <a href="https://github.com/nanoodlecom/awesome-noodles" target="_blank" rel="noopener">awesome-noodles</a> graph.</p>
${groups}`;

  const next = [
    `        <a href="/guide/">← Guide</a>`,
    `        <a href="/examples/gallery/">Reviewed gallery</a>`,
    `        <a href="/examples/iron-verdict/">Play Iron Verdict</a>`,
    `        <a href="/guide/share-links">How share links work</a>`,
  ].join("\n");

  return chrome({
    title: "Steal a noodle — nanoodle",
    description: "See the real output. Open the graph. Make it yours. Reviewed nanoodle samples with costs.",
    path: "/guide/examples/",
    crumbs: `<a href="/">Home</a> / <a href="/guide/">Guide</a> / <span>Steal a noodle</span>`,
    wide: true,
    body,
    next,
  });
}

function build() {
  const pages = { "index.html": hubPage() };
  const order = GROUPS.flatMap((g) => g.slugs);
  order.forEach((slug, i) => {
    const prevSlug = order[i - 1];
    const nextSlug = order[i + 1];
    const prev = prevSlug ? { slug: prevSlug, title: howTitle(prevSlug) } : null;
    const next = nextSlug ? { slug: nextSlug, title: howTitle(nextSlug) } : null;
    if (slug === "iron-verdict") pages["iron-verdict.html"] = ironPage(prev, next);
    else pages[slug + ".html"] = samplePage(sampleBySlug(slug), prev, next);
  });
  return pages;
}

export const PAGE_FILES = () => Object.keys(build());

const pages = build();
mkdirSync(OUT, { recursive: true });
const expected = new Set(Object.keys(pages));
if (process.argv.includes("--check")) {
  const have = existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith(".html")) : [];
  const extra = have.filter((f) => !expected.has(f));
  const missing = [...expected].filter((f) => !have.includes(f));
  const stale = [...expected].filter((f) => {
    const path = join(OUT, f);
    return !existsSync(path) || readFileSync(path, "utf8") !== pages[f];
  });
  if (extra.length || missing.length || stale.length) {
    const bits = [];
    if (missing.length) bits.push("missing " + missing.join(", "));
    if (stale.length) bits.push("stale " + stale.join(", "));
    if (extra.length) bits.push("extra " + extra.join(", "));
    throw new Error("Guide example pages out of date (" + bits.join("; ") + "). Run: node scripts/sync-guide-examples.mjs");
  }
  console.log(`✓ guide/examples: ${expected.size} pages match samples.json`);
} else {
  for (const [name, html] of Object.entries(pages)) writeFileSync(join(OUT, name), html);
  for (const name of readdirSync(OUT).filter((f) => f.endsWith(".html"))) {
    if (!expected.has(name)) throw new Error("Unexpected file left in guide/examples/: " + name);
  }
  console.log(`Wrote ${expected.size} how-to pages → guide/examples/`);
}
