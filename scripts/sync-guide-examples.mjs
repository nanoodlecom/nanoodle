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
  deslop: {
    job: "Kill the AI voice. Keep every fact.",
    purpose: "That booking notice sounds like a press release from a toaster. This noodle rewrites it like a person, then a second model checks every date, price, and caveat against the source before the last pass.",
    edit: "Paste the slop into <em>Your draft</em>. Leave the three LLM nodes unless you mean to change models: Grok drafts, Terra fact-checks, Grok applies the review.",
    inspect: "Every supplied fact has to survive — the saved run keeps 8 September, the $15 fee, the 14-day credit, Tuesday–Saturday hours, existing bookings, and repairs@example.com. Empty hype should vanish. The review checks writing and facts. It does not detect authorship.",
    costHow: "The reviewed run reported $0.0079 across three paid text calls. Token use and model prices move; check the editor estimate before you hit Run.",
  },
  favicon: {
    job: "One mark. Readable at 16 pixels.",
    purpose: "A brand sentence becomes a glyph you'd actually put on a tab. Flat, bold, no tiny detail that dies when the favicon shrinks.",
    edit: "Rewrite <em>Brand</em> — name, symbol, colors. GLM Flash condenses it; Muse paints one square.",
    inspect: "Squint at 16 pixels. One glyph, the palette you asked for, a silhouette that still reads. This is a raster concept — export real favicon sizes as a separate step. The saved brief has no letters.",
    costHow: "The reviewed run reported $0.01. The image step is listed at $0.01, plus a small text call. Prices and results vary.",
  },
  "fibo-studio-still": {
    job: "Light a product that doesn't exist yet.",
    purpose: "Describe the object, pick a light, get an editorial still. When you already have the real bottle, start with the catalog-clean edit instead.",
    edit: "Rewrite <em>Product</em> (shape, materials, count) and pick a <em>Light</em>. GLM Flash structures the brief; Bria FIBO renders at 1MP.",
    inspect: "Count, material, color, and the light you picked should match. No invented packaging or logos. The saved still is square and fictional — not a photo of merchandise.",
    costHow: "The reviewed run reported $0.04. The image step is listed at $0.04, plus a small text call. Prices and results vary.",
  },
  "cinematic-character-still": {
    job: "Night-ride key-art. One person, one light, one frame.",
    purpose: "Photoreal character stills from three knobs — who they are, the light, the crop. Built for cinematic portraits: a courier under neon, a face in a work lamp, whoever you type next. MiniMax H3 Image paints the brief directly. No prompt-writing call.",
    edit: "Change <em>Person</em>, <em>Light</em>, and <em>Frame</em>. Those three inputs are the whole brief. Do not inherit the saved sample's wardrobe — type the character you actually want.",
    inspect: "One person. The light you picked. The crop you picked. No extra people, no readable text. This is generated key-art, not a photograph of a real person. The saved still is one reviewed run of this graph, not the character you have to keep.",
    costHow: "The reviewed run reported $0.02 ($0.02/image at 1K). Prices and results vary.",
  },
  "edit-a-photo": {
    job: "Catalog-clean. Same product.",
    purpose: "Keep the object. Lose the clutter. Start here when you already have a shot — or a generated still — of the thing.",
    edit: "Drop your photo on <em>Product photo</em>. Tighten <em>Edit request</em> if the default catalog brief is wrong. Muse Edit uses both.",
    inspect: "Shape, color, materials, markings, visible text — compare them to the source. Check real product marks before you publish a generated edit.",
    costHow: "The reviewed run reported $0.01 ($0.01/image). Prices and results vary.",
  },
  "combine-images": {
    job: "Drop the product into the room.",
    purpose: "Preview the bottle on the desk before you book the studio. Scale, light, and contact shadows should feel inevitable.",
    edit: "Product on <em>Product photo</em>, room on <em>Setting photo</em>, and <em>Placement brief</em> if the default rules are wrong for your pair.",
    inspect: "Both references should matter. Product identity and the room's layout survive. Shadows and scale should be plausible. Composites still need a fidelity check.",
    costHow: "The reviewed run reported $0.01 ($0.01/image). Prices and results vary.",
  },
  "image-model-arena": {
    job: "Four models. One brief. No winner speech.",
    purpose: "Make them all draw the same poster. Keep the one that got the useful details right — polish is not the same as a tire lever.",
    edit: "Rewrite <em>Shared test brief</em>. The four image nodes already pin Muse, Krea 2 Turbo, Grok Imagine Image 2.0, and Recraft V4. Run spends four images.",
    inspect: "Exact heading and footer, the wheel, two hooked plastic tire levers, composition, color. On the saved set every model got the type; only Grok drew recognizable levers. One prompt is not a ranking. The open workflow uses current model IDs after a provider-name migration.",
    costHow: "The reviewed run reported $0.118 (Muse $0.01, Krea $0.01, Grok $0.06, Recraft $0.038). Four paid image calls. Prices and results vary.",
  },
  "night-market-postcard": {
    job: "A place, a mood, a postcard.",
    purpose: "Type a destination. Pick a vibe. Leave with a 3:2 travel print — not a stock photo of the wrong city. The sample place lives only in the input.",
    edit: "Rewrite <em>Place</em> and pick a <em>Vibe</em>. GLM Flash writes the postcard prompt; Muse renders at 3:2.",
    inspect: "Landmarks and local details should match what you typed. A new city should not inherit someone else's lanterns. Illustration, not a documentary frame, not typeset print copy.",
    costHow: "The reviewed run reported $0.01. The image step is listed at $0.01, plus a small text call. Prices and results vary.",
  },
  "photo-to-video": {
    job: "One still. One breath of motion.",
    purpose: "Five seconds where the mug stays put and the steam doesn't. Generate the frame, then move one small thing.",
    edit: "Change <em>Still brief</em> and <em>Motion brief</em> together so they describe the same scene. Muse draws the first frame; MiniMax H3 Spicy animates 5 seconds at 480p.",
    inspect: "Whatever you called still should stay still. A seamless loop is not promised. The open workflow uses the current model ID after a provider-name migration.",
    costHow: "The reviewed run reported $0.21 (Muse $0.01 + MiniMax H3 Spicy $0.20 at 480p / 5s). Prices and results vary.",
  },
  "omni-flash-turntable": {
    job: "Orbit the object. Keep the chrome honest.",
    purpose: "No upload. Describe the thing, pick one camera move, get a five-second draft. A concept object — not a catalog SKU.",
    edit: "Rewrite <em>Object</em> and pick a <em>Move</em>. GLM Flash structures the brief; Omni Flash 1.1 renders 5 seconds at 360p / 16:9.",
    inspect: "The move you picked happens once. Geometry stays stable. Count and colors match. 360p draft of a fictional product.",
    costHow: "The reviewed run reported $0.195 for the video step, plus a small text call. Prices and results vary.",
  },
  "render-a-mockup": {
    job: "A screen you can argue about.",
    purpose: "The labels you already wrote, as a picture. Design review — not a working app.",
    edit: "Edit <em>Screen brief</em> and <em>Visual style</em>. Keep the pair under 800 characters (the saved pair is 696). Qwen Image 3 Pro paints the joined brief at 1K. No prompt-writing call.",
    inspect: "Navigation, date, rows, names, statuses, totals — still there, no invented sections. Output is an image.",
    costHow: "The reviewed run reported $0.04 ($0.04/image at 1K). Prices and results vary.",
  },
  sing: {
    job: "The song after the last repair.",
    purpose: "Original closing-credits music from a brief and a style. No artist cosplay.",
    edit: "Rewrite <em>Song Instructions</em> and <em>Musical style</em>. GLM Flash writes labeled lyrics; Mureka Generate Song sings them.",
    inspect: "Clear words, a chorus you can hum, fit to the brief. Duration and exact structure can wander. The saved 170-second track had a separate Gemini 3.8 Flash listen (reported $0.00627) — model-assisted, not a human sign-off. No still preview; the audio and lyrics are the reviewed output.",
    costHow: "The reviewed song run reported $0.225 (music step $0.225, plus a small text call). The optional audio-review call is separate. Prices and results vary.",
  },
  "talking-avatar": {
    job: "Look at camera. Say the line.",
    purpose: "A face, a voice, a short intro. Keep the script under 30 seconds. Match the presenter to the voice you picked.",
    edit: "Change <em>Presenter look</em>, <em>Spoken script</em>, and <em>Delivery</em>. Muse paints the face, MiniMax Speech reads, LongCat animates at 480p.",
    inspect: "The words are right, the face stays visible, the mouth follows the speech. Check lip-sync in playback — we don't claim frame-accurate timing. Generation can take several minutes; an earlier attempt blew a four-minute timeout. A Gemini 3.8 Flash transcript of the saved run reported $0.00164 (model-assisted). The open workflow uses current model IDs after a provider-name migration.",
    costHow: "The reviewed run reported at least $0.28. Video is listed at $0.03 per audio second at 480p, plus portrait and speech. Some provider price fields were omitted. Prices and results vary.",
  },
};

// Awesome-noodles README share link for character-sprites (Iron Verdict is
// not a samples.json entry). Do not invent a second link.
const IRON = {
  slug: "iron-verdict",
  title: "Iron Verdict",
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
    "edit-a-photo", "combine-images", "render-a-mockup", "favicon",
    "night-market-postcard", "fibo-studio-still", "cinematic-character-still",
    "image-model-arena",
  ] },
  { id: "video", title: "Video", slugs: ["photo-to-video", "omni-flash-turntable", "talking-avatar"] },
  { id: "audio", title: "Audio", slugs: ["sing"] },
  { id: "text", title: "Text", slugs: ["deslop"] },
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

function cardForSample(s) {
  const how = HOWTO[s.slug];
  const cost = formatCost(s.costUsd, s.costExact);
  const href = `/guide/examples/${esc(s.slug)}`;
  let thumb;
  if (s.preview) {
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
          <b>${esc(s.title)}</b>
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

function renderMedia(s) {
  const multi = s.outputs.length > 1 ? " comparison" : "";
  const figures = s.outputs.map((o) => {
    const src = "/examples/gallery/" + local(o.src);
    if (o.kind === "text") {
      const text = readFileSync(join(GALLERY, local(o.src)), "utf8");
      return `<figure><blockquote class="sample">${esc(text)}</blockquote><figcaption>${esc(o.label)} · <a href="${esc(src)}" download>Download</a></figcaption></figure>`;
    }
    if (o.kind === "video") {
      const poster = s.preview ? ` poster="/examples/gallery/${esc(local(s.preview))}"` : "";
      return `<figure><video controls preload="none"${poster} aria-label="${esc(s.title)}"><source src="${esc(src)}" type="video/mp4"></video><figcaption>${esc(o.label)} · <a href="${esc(src)}" download>Download</a></figcaption></figure>`;
    }
    if (o.kind === "audio") {
      return `<figure><audio controls preload="none" aria-label="${esc(s.title)}"><source src="${esc(src)}" type="audio/mpeg"></audio><figcaption>${esc(o.label)} · <a href="${esc(src)}" download>Download</a></figcaption></figure>`;
    }
    return `<figure><a href="${esc(src)}"><img src="${esc(src)}" alt="${esc(o.label + " — " + s.title)}" loading="lazy" /></a><figcaption>${esc(o.label)} · <a href="${esc(src)}" download>Download</a></figcaption></figure>`;
  }).join("\n          ");
  const note = !s.preview && s.outputs.every((o) => o.kind === "audio" || o.kind === "text")
    ? `<p class="no-preview">No preview image was saved for this sample. The reviewed output is the ${s.outputs.map((o) => o.kind).join(" and ")} below.</p>`
    : "";
  return `${note}<div class="media${multi}">
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
  const crumbs = `<a href="/">Home</a> / <a href="/guide/">Guide</a> / <a href="/guide/examples/">Examples how-to</a> / <span>${esc(s.title)}</span>`;
  const nextLinks = [
    `<a href="/guide/examples/">← All examples</a>`,
    prev ? `<a href="/guide/examples/${esc(prev.slug)}">${esc(prev.title)}</a>` : "",
    next ? `<a href="/guide/examples/${esc(next.slug)}">${esc(next.title)} →</a>` : "",
    `<a href="${esc(gallery)}">Reviewed sample</a>`,
  ].filter(Boolean).map((a) => "        " + a).join("\n");

  const inputImgs = s.inputs.filter((i) => i.src).map((i) => {
    const src = "/examples/gallery/" + local(i.src);
    return `<figure><img src="${esc(src)}" alt="${esc(i.label)}" loading="lazy" /><figcaption>${esc(i.label)}</figcaption></figure>`;
  }).join("\n          ");

  const body = `    <h1><span class="grad">${esc(s.title)}</span></h1>
    <p class="lede">${esc(how.job)}</p>

    <section>
      <p class="meta-row">${esc(s.review)} · ${esc(s.date)} · Reported run: ${esc(cost)}. ${s.models.map((m) => `<code>${esc(m)}</code>`).join(" · ")}</p>

      <h2>The saved run</h2>
      ${renderMedia(s)}
      ${inputImgs ? `<h3>References that went in</h3>\n        <div class="media input-refs${s.inputs.filter((i) => i.src).length > 1 ? " comparison" : ""}">\n          ${inputImgs}\n        </div>` : ""}
      <div class="callout"><p>${esc(s.note)}</p></div>

      <h2>What it's for</h2>
      <p>${esc(how.purpose)}</p>

      <h2>Remix it</h2>
      <ol class="input-list">
        <li><strong>Open the graph.</strong> Save first — an example replaces the canvas. Undo brings yours back.</li>
        <li><strong>Change the inputs that matter.</strong> ${how.edit}</li>
        <li><strong>Look at what you got.</strong> ${how.inspect}</li>
        <li><strong>What it cost.</strong> ${esc(how.costHow)}</li>
      </ol>

      <div class="cta">
        <a class="primary" href="${esc(open)}">Open this noodle →</a>
        <a class="secondary" href="${esc(gallery)}">See reviewed sample</a>
      </div>
      <p class="howto-note"><a href="/examples/gallery/${esc(local(s.workflow))}" download>Download workflow</a>
        · <a href="/examples/gallery/${esc(local(s.slug + "/graph.json"))}" download>Original sampled graph</a>
        · <a href="https://mcp.nanoodle.com/#${esc(s.slug)}">Explore MCP tools</a>
        · <a href="https://github.com/nanoodlecom/awesome-noodles">awesome-noodles</a></p>`;

  return chrome({
    title: `${s.title} — how to use this noodle`,
    description: `${how.job} Reviewed sample, inputs to edit, what to inspect, and the reported ${cost} run cost.`,
    path: `/guide/examples/${s.slug}`,
    crumbs,
    body,
    next: nextLinks,
  });
}

function ironPage(prev, next) {
  const crumbs = `<a href="/">Home</a> / <a href="/guide/">Guide</a> / <a href="/guide/examples/">Examples how-to</a> / <span>${esc(IRON.title)}</span>`;
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

      <h2>The saved run</h2>
      <div class="media">
        <figure>
          <a href="${esc(IRON.play)}"><img src="${esc(IRON.preview)}" alt="Iron Verdict — playable foundry fighter" loading="lazy" /></a>
          <figcaption>Playable game · <a href="${esc(IRON.play)}">Open Iron Verdict</a></figcaption>
        </figure>
      </div>

      <h2>What it's for</h2>
      <p>${esc(IRON.purpose)}</p>

      <h2>Remix it</h2>
      <ol class="input-list">
        <li><strong>Play it.</strong> No key. Motion and sound toggles live on the game page.</li>
        <li><strong>Open the artwork graph</strong> when you want a different fighter. ${IRON.edit}</li>
        <li><strong>Look at what you got.</strong> ${esc(IRON.inspect)}</li>
        <li><strong>What it cost.</strong> ${esc(IRON.costHow)}</li>
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
    title: "Iron Verdict — how to use this noodle",
    description: `${IRON.job} Play the reviewed game, open the artwork graph, and see the $0.02 source-image cost.`,
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
      <p>These pages sit beside the <a href="/examples/gallery/">reviewed gallery</a> — actual stills, clips, songs, and edits, not mockups of mockups. Looking is free. Running spends your NanoGPT balance. Costs are the reported first-party runs. The next one will not be identical.</p>
      <p>Pick a card. Change the inputs that matter. Hit <strong>Open in nanoodle</strong> for the same share graph the gallery uses. Every card is an <a href="https://github.com/nanoodlecom/awesome-noodles" target="_blank" rel="noopener">awesome-noodles</a> graph.</p>
${groups}`;

  const next = [
    `        <a href="/guide/">← Guide</a>`,
    `        <a href="/examples/gallery/">Reviewed gallery</a>`,
    `        <a href="/examples/iron-verdict/">Play Iron Verdict</a>`,
    `        <a href="/guide/share-links">How share links work</a>`,
  ].join("\n");

  return chrome({
    title: "Steal a noodle — examples how-to",
    description: "See the real output, then open the graph. Every reviewed gallery workflow — plus Iron Verdict — with the inputs to change, the reported cost, and Open in nanoodle.",
    path: "/guide/examples/",
    crumbs: `<a href="/">Home</a> / <a href="/guide/">Guide</a> / <span>Examples how-to</span>`,
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
    const prev = prevSlug === "iron-verdict"
      ? { slug: "iron-verdict", title: IRON.title }
      : prevSlug ? { slug: prevSlug, title: sampleBySlug(prevSlug).title } : null;
    const next = nextSlug === "iron-verdict"
      ? { slug: "iron-verdict", title: IRON.title }
      : nextSlug ? { slug: nextSlug, title: sampleBySlug(nextSlug).title } : null;
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
