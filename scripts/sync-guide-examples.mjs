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
    job: "Keep the price and the date — lose the seamless unlock.",
    purpose: "A customer notice that sounds like promotional filler still has to be accurate. This workflow rewrites the draft in plain language, then checks every date, price, hour, and caveat against the source before a final pass.",
    edit: "Paste your notice into <em>Your draft</em>. Leave the three LLM nodes as they are unless you are changing models on purpose: Grok drafts, Terra fact-checks, Grok applies the review.",
    inspect: "Every supplied fact must survive (the sample keeps 8 September, the $15 fee, the 14-day credit, Tuesday–Saturday hours, existing bookings, and repairs@example.com). Empty promotional claims should disappear. The review checks writing and factual preservation — it does not detect authorship.",
    costHow: "The reviewed run reported $0.0079 across three paid text calls. Token use and model prices vary; check the editor estimate before you run.",
  },
  favicon: {
    job: "A brand idea becomes one bold square icon.",
    purpose: "Turn a short brand brief into a raster favicon concept you can inspect at the sizes an app actually uses.",
    edit: "Change <em>Brand</em> — name, symbol, and colors. The LLM condenses that brief; Muse renders one square image.",
    inspect: "Look at the result at 16 pixels. You want one simple glyph, the requested palette, and a readable silhouette. This is a raster concept: export or convert to the icon formats your app needs as a separate step. No letters in the sample brief.",
    costHow: "The reviewed run reported $0.01. The image step is listed at $0.01, plus a small text call. Prices and results vary.",
  },
  "fibo-studio-still": {
    job: "Explore product lighting and materials with FIBO.",
    purpose: "Describe a product and pick a light setup to get an editorial still of a fictional object. Use this when you do not have a real product photo yet.",
    edit: "Rewrite <em>Product</em> (shape, materials, count) and pick a <em>Light</em> option. GLM Flash structures the brief; Bria FIBO renders at 1MP.",
    inspect: "Product count, material, color, and the selected light should match the brief. No invented packaging, logos, or props. The sample is square and depicts a fictional bottle — it is not a photograph of merchandise. For an exact existing product, start with Clean a product photo instead.",
    costHow: "The reviewed run reported $0.04. The image step is listed at $0.04, plus a small text call. Prices and results vary.",
  },
  "cinematic-character-still": {
    job: "Photoreal key-art from a short person, light, and frame brief.",
    purpose: "Make a cinematic character still without a prompt-writing call. Useful for key-art exploration when you can describe the person and the shot.",
    edit: "Change <em>Person</em>, <em>Light</em>, and <em>Frame</em>. Those three inputs are the whole brief — MiniMax H3 Image renders them directly at 1K.",
    inspect: "Wardrobe, tools, selected light, and selected frame should match. One person; no readable text. The reviewed sample is a coherent chest-up portrait of a fictional piano tuner; the subject reads older than the forty-year-old brief. This is generated key-art, not a photograph of a real person.",
    costHow: "The reviewed run reported $0.02 ($0.02/image at 1K). Prices and results vary.",
  },
  "edit-a-photo": {
    job: "Prepare a product photo for a clean catalog listing.",
    purpose: "Replace a busy background while keeping the product itself. Start here when you already have a photo (or a generated still) of the object.",
    edit: "Upload your photo to <em>Product photo</em> and, if needed, tighten <em>Edit request</em>. Muse Edit uses that reference and the prompt.",
    inspect: "Compare shape, color, materials, markings, and any visible text with the source. The sample turns a generated bottle into a catalog-style image on warm-white paper. Check real product markings before using a generated edit commercially.",
    costHow: "The reviewed run reported $0.01 ($0.01/image). Prices and results vary.",
  },
  "combine-images": {
    job: "Place your product into a setting from another photo.",
    purpose: "Preview how one object sits in a real (or generated) scene before a photoshoot — matching scale, light, and contact shadows.",
    edit: "Upload the product to <em>Product photo</em>, the environment to <em>Setting photo</em>, and adjust <em>Placement brief</em> if the default placement rules are wrong for your pair.",
    inspect: "Both references should matter. Product identity and the setting layout should survive; scale, perspective, and shadows should be plausible. Generated composites still need a check for exact product fidelity.",
    costHow: "The reviewed run reported $0.01 ($0.01/image). Prices and results vary.",
  },
  "image-model-arena": {
    job: "Compare four image models on text, layout, and useful detail.",
    purpose: "Get evidence for a model choice on one shared brief. The sample is a workshop poster that asks for exact type and two recognizable tire levers — a task where polish is not the same as usefulness.",
    edit: "Change <em>Shared test brief</em>. All four image nodes already pin different models (Muse Image, Krea 2 Turbo, Grok Imagine Image 2.0, Recraft V4). Run makes four paid images.",
    inspect: "Judge exact heading and footer, the wheel, two hooked plastic tire levers, composition, and color. The reviewed set: all four rendered the requested heading and footer; only Grok drew recognizable tire levers. One prompt is not a general ranking. The sample was generated on 5 September; the open workflow uses current model IDs after a provider-name migration.",
    costHow: "The reviewed run reported $0.118 (Muse $0.01, Krea $0.01, Grok $0.06, Recraft $0.038). Four paid image calls. Prices and results vary.",
  },
  "night-market-postcard": {
    job: "Turn a place and a mood into a travel postcard illustration.",
    purpose: "A reusable destination-plus-style illustration. The sample place lives only in the input, so a new destination should not inherit Taipei night-market scenery.",
    edit: "Rewrite <em>Place</em> and pick a <em>Vibe</em>. GLM Flash writes the postcard prompt; Muse renders at 3:2.",
    inspect: "Landmarks and local details should match the brief you typed. The reviewed sample is a coherent illustrated night market with a food-stall focal point — an illustration, not a documentary image or a print-ready layout with typeset copy.",
    costHow: "The reviewed run reported $0.01. The image step is listed at $0.01, plus a small text call. Prices and results vary.",
  },
  "photo-to-video": {
    job: "Animate a still with one specific motion brief.",
    purpose: "A five-second ambient motion concept: generate a first frame, then move one small thing while the rest stays put.",
    edit: "Change <em>Still brief</em> and <em>Motion brief</em> together so they describe the same scene. Muse draws the first frame; MiniMax H3 Spicy animates 5 seconds at 480p.",
    inspect: "Objects named as still should stay still. The reviewed frames show the mug, notebook, and desk stable while steam changes. A seamless loop is not promised. The sample was generated on 5 September; the open workflow uses the current model ID after a provider-name migration.",
    costHow: "The reviewed run reported $0.21 (Muse $0.01 + MiniMax H3 Spicy $0.20 at 480p / 5s). Prices and results vary.",
  },
  "omni-flash-turntable": {
    job: "Five seconds of a product under a chosen camera move.",
    purpose: "A text-to-video product-motion draft when you do not have a still to animate. Describe the object and pick one move.",
    edit: "Rewrite <em>Object</em> and pick a <em>Move</em>. GLM Flash structures the brief; Omni Flash 1.1 renders 5 seconds at 360p / 16:9.",
    inspect: "The selected camera or object motion should happen once, geometry should stay stable, and object count and colors should match. The reviewed frames show a coherent orbit around a stable bottle and plinth. This is a 360p draft of a fictional product.",
    costHow: "The reviewed run reported $0.195 for the video step, plus a small text call. Prices and results vary.",
  },
  "render-a-mockup": {
    job: "Turn a screen brief into a UI concept image.",
    purpose: "Get a design-review picture of a specific screen — labels, rows, and totals you already wrote — without a prompt-writing call.",
    edit: "Edit <em>Screen brief</em> and <em>Visual style</em>. Keep the combined text under 800 characters (the sample pair is 696). Qwen Image 3 Pro renders the joined brief directly at 1K.",
    inspect: "Requested navigation, date, rows, names, statuses, and totals should stay legible, with no invented sections. The reviewed run preserved those values. Output is an image, not working UI.",
    costHow: "The reviewed run reported $0.04 ($0.04/image at 1K). Prices and results vary.",
  },
  sing: {
    job: "The track that plays after the last repair.",
    purpose: "Write original closing-credits lyrics from a brief, then hear them sung in an editable musical style.",
    edit: "Rewrite <em>Song Instructions</em> (theme and concrete details) and <em>Musical style</em>. GLM Flash writes labeled lyrics; Mureka Generate Song sings them.",
    inspect: "Listen for clear words, a usable chorus, and fit to the brief. Generated duration and exact musical structure can vary. The reviewed 170-second song had a separate Gemini 3.8 Flash listening pass (reported $0.00627) that identified the supplied chorus — that pass is model-assisted, not a human sign-off. This sample has no still preview; the audio and lyrics are the reviewed output.",
    costHow: "The reviewed song run reported $0.225 (music step $0.225, plus a small text call). The optional audio-review call is separate. Prices and results vary.",
  },
  "talking-avatar": {
    job: "A presenter looks at camera and tells you where to start.",
    purpose: "Prototype a short spoken introduction: a portrait, a read script, and lipsync. Keep the script under 30 seconds.",
    edit: "Change <em>Presenter look</em>, <em>Spoken script</em>, and <em>Delivery</em>. Muse paints the face, MiniMax Speech reads the script, LongCat animates at 480p. Match presenter gender to the selected voice.",
    inspect: "Spoken words and pronunciation, a visible face, and mouth timing that follows the speech. The reviewed frames keep a fictional male presenter (matched to the male voice). Check precise lip-sync in playback. Generation took several minutes; an earlier attempt exceeded a four-minute timeout. Gemini 3.8 Flash transcribed the intended script (reported $0.00164) — model-assisted. The sample was generated on 5 September; the open workflow uses current model IDs after a provider-name migration.",
    costHow: "The reviewed run reported at least $0.28. Video is listed at $0.03 per audio second at 480p, plus the portrait and speech steps. Some provider price fields were omitted. Prices and results vary.",
  },
};

// Awesome-noodles README share link for character-sprites (Iron Verdict is
// not a samples.json entry). Do not invent a second link.
const IRON = {
  slug: "iron-verdict",
  title: "Iron Verdict",
  job: "From a character brief to a playable arena fighter.",
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
  purpose: "A coding agent used the character-sprites skill to make matching artwork and 32 transparent animation frames, then built this three-round foundry fighter around them. Playing the game is free and needs no key.",
  edit: "Open the artwork workflow and edit <em>Character</em> if you want a different fighter. The graph returns a canonical reference and a four-quadrant parts sheet. Baking idle, walk, punch, and jump frames needs the companion skill (Node.js and ffmpeg). The agent — not the graph — writes gravity, combat, enemies, and sound.",
  inspect: "Play Iron Verdict in the browser: three rounds, readable windups, heavy jumps. This is a cutout-animation prototype with rigid limbs and mirrored facing. Opening the graph alone does not produce an atlas or game code.",
  costHow: "The selected source images cost $0.02 combined during the experiment ($0.01 each for the reference and parts calls). Local animation baking and gameplay iteration made no further model calls. Generating your own character uses your NanoGPT balance; see the skill for the full run instructions.",
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
      <p class="meta-row">${esc(s.review)} · ${esc(s.date)} · Reported run cost: ${esc(cost)}. Models: ${s.models.map((m) => `<code>${esc(m)}</code>`).join(", ")}. Prices and results vary.</p>
      <p>${esc(s.note)}</p>

      <h2>Reviewed output</h2>
      ${renderMedia(s)}
      ${inputImgs ? `<h3>Supplied references</h3>\n        <div class="media input-refs${s.inputs.filter((i) => i.src).length > 1 ? " comparison" : ""}">\n          ${inputImgs}\n        </div>` : ""}

      <h2>What this workflow is for</h2>
      <p>${esc(how.purpose)}</p>

      <h2>How to use it</h2>
      <ol class="input-list">
        <li><strong>Open the graph</strong> with the button below. Save current work first — loading an example replaces the canvas (Undo restores it).</li>
        <li><strong>Edit the inputs.</strong> ${how.edit}</li>
        <li><strong>Inspect the result.</strong> ${how.inspect}</li>
        <li><strong>Typical cost.</strong> ${esc(how.costHow)}</li>
      </ol>

      <div class="cta">
        <a class="primary" href="${esc(open)}">Open in nanoodle →</a>
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
      <p>A furnace knight, then a harsh arena. Playing the saved game is free. Generating your own character uses your NanoGPT balance, Node.js, and ffmpeg.</p>

      <h2>Reviewed output</h2>
      <div class="media">
        <figure>
          <a href="${esc(IRON.play)}"><img src="${esc(IRON.preview)}" alt="Iron Verdict — playable foundry fighter" loading="lazy" /></a>
          <figcaption>Playable game · <a href="${esc(IRON.play)}">Open Iron Verdict</a></figcaption>
        </figure>
      </div>

      <h2>What this workflow is for</h2>
      <p>${esc(IRON.purpose)}</p>

      <h2>How to use it</h2>
      <ol class="input-list">
        <li><strong>Play the reviewed game</strong> — no key and no payment. Motion and sound toggles are on the game page.</li>
        <li><strong>Open the artwork graph</strong> if you want to remix the fighter. ${IRON.edit}</li>
        <li><strong>Inspect the result.</strong> ${esc(IRON.inspect)}</li>
        <li><strong>Typical cost.</strong> ${esc(IRON.costHow)}</li>
      </ol>

      <div class="cta">
        <a class="primary" href="${esc(IRON.open)}">Open in nanoodle →</a>
        <a class="secondary" href="${esc(IRON.play)}">See reviewed sample</a>
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

  const body = `    <h1>Examples <span class="grad">how-to</span></h1>
    <p class="lede">Each reviewed gallery workflow, with the saved output, the inputs to edit, and the reported cost — then open it in nanoodle.</p>

    <section>
      <p>These pages sit beside the <a href="/examples/gallery/">reviewed output gallery</a> and the rest of the <a href="/guide/">guide</a>. Viewing saved outputs is free. Generating your own uses your NanoGPT balance. Costs below are the reported first-party runs — prices and results vary.</p>
      <p>Open a card to see the reviewed media, what the workflow is for, and which nodes to change. The <strong>Open in nanoodle</strong> button loads the current share graph (the same link the gallery uses). A <a href="https://github.com/nanoodlecom/awesome-noodles" target="_blank" rel="noopener">awesome-noodles</a> graph is behind every card.</p>
${groups}`;

  const next = [
    `        <a href="/guide/">← Guide</a>`,
    `        <a href="/examples/gallery/">Reviewed gallery</a>`,
    `        <a href="/examples/iron-verdict/">Play Iron Verdict</a>`,
    `        <a href="/guide/share-links">How share links work</a>`,
  ].join("\n");

  return chrome({
    title: "Examples how-to — nanoodle guide",
    description: "How to remix every reviewed nanoodle gallery workflow: saved output, inputs to edit, what to inspect, reported cost, and Open in nanoodle.",
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
