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
  "image-model-arena": {
    headline: "Compare four image models",
    job: "One prompt → four images to compare.",
    purpose: "A shared bicycle-workshop poster brief branches into four image models. Compare the lettering, object count and tool shapes before choosing a result.",
    edit: "Rewrite <em>Shared test brief</em> once. All four image nodes receive it: Muse, GPT Image 2.5 Flare, Grok Imagine Image 2.0 and Recraft V4. Running the whole graph makes four paid image calls.",
    inspect: "Check FIX A FLAT, SATURDAY 10 AM, one wheel and two recognizable tire levers across all four results.",
    costHow: "The archived comparison reported $0.118: Muse $0.01, Krea $0.01, Grok $0.06 and Recraft $0.038. That total covers the saved Krea run. Check the editor estimate for the current models before running.",
  },
  "photo-to-video": {
    headline: "Animate a still",
    job: "Generate a first frame, then animate its steam.",
    purpose: "Muse draws a mug of tea beside a notebook. MiniMax H3 Spicy uses that first frame and a separate motion brief to make a five-second clip. Keeping the scene and movement in separate inputs lets you change what moves without redesigning the still.",
    edit: "Change <em>Still brief</em> and <em>Motion brief</em> to describe the same scene. Muse generates the first frame; MiniMax H3 Spicy animates it for five seconds at 480p.",
    inspect: "Play the clip. The mug, notebook and desk should stay stable while the steam moves. Check the full clip before using it.",
    costHow: "The saved tea-mug run reported $0.21: $0.01 for the still and $0.20 for five seconds of video at 480p. Prices and results vary.",
  },
  sing: {
    headline: "Sing: trip-hop about the singularity",
    job: "Idea + favorite bands → lyrics, arrangement and song.",
    purpose: "Start with a wistful 90s trip-hop song about the singularity and musical references: Portishead, Massive Attack and Tricky. GLM Flash writes lyrics, then an arrangement fitted to those words, then an avoid-list grounded in that arrangement. MiniMax Music 3 receives the lyrics separately from the combined musical direction. Changing the references steers the groove, instruments and vocal delivery.",
    edit: "Rewrite <em>Song idea</em> and <em>Preferred bands</em>. Inspect <em>Write lyrics</em>, <em>Arrange the song</em> and <em>What would clash?</em> before running <em>Sing</em>, or run the whole graph. The references become descriptions of sound, without artist names in the music prompt.",
    inspect: "Read the generated lyrics, arrangement and avoid-list below, then listen for the hook, groove and vocal delivery. Musical direction guides the result; exact structure and duration are not guaranteed.",
    costHow: "The saved run reports its generation cost below. Three text calls prepare the lyrics, arrangement and avoid-list; one MiniMax Music 3 call makes the song. Check the editor estimate before running.",
  },
  "talking-avatar": {
    headline: "Make a speaking presenter",
    job: "Portrait + spoken script → lipsynced introduction.",
    purpose: "Muse generates a fictional museum guide while MiniMax Speech reads the workshop introduction. LongCat combines the portrait and speech into a video, using a delivery brief to control movement. The two branches let you change the presenter and the spoken words independently.",
    edit: "Change <em>Presenter look</em>, <em>Spoken script</em> and <em>Delivery</em>. Keep the face and mouth visible, match the selected voice to the presenter, and keep the script under 30 seconds. LongCat renders at 480p.",
    inspect: "Play with sound. Check the spoken words, face consistency and lip-sync timing through the whole clip.",
    costHow: "The saved workshop run reported at least $0.28 for generation; some provider price fields were missing. Its separate model-assisted audio review reported $0.00164. Longer speech increases video cost. Check the editor estimate before running.",
  },
};

// Awesome-noodles README share link for character-sprites (Iron Verdict is
// not a samples.json entry). Do not invent a second link.
const IRON = {
  slug: "iron-verdict",
  title: "Iron Verdict",
  headline: "Iron Verdict",
  job: "Character brief → reference → parts → local rig.",
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
  purpose: "The graph turns a character brief into a reference image and a matching four-quadrant parts sheet. The companion character-sprites skill extracts the parts and bakes 32 transparent animation frames locally. A coding agent used those assets to build Iron Verdict, the playable three-round fighter shown here.",
  edit: "Open the artwork graph and rewrite <em>Character</em>. GLM Flash writes the reference prompt, Muse draws the character, and Muse Edit makes matching parts. Use the companion skill with Node.js and ffmpeg to rig and bake idle, walk, punch and jump frames. Building a game around them requires separate coding work.",
  inspect: "Inspect the cutout joints and animation frames, then play the game to judge how they move. This prototype uses rigid limbs.",
  costHow: "The selected source images cost $0.02 combined ($0.01 each for reference and parts). Local baking and playtesting made no further model calls. Your own character spends your NanoGPT balance; the skill has the full run.",
};

const ORDER = ["iron-verdict", "image-model-arena", "photo-to-video", "sing", "talking-avatar"];
for (const sample of SAMPLES) {
  if (!HOWTO[sample.slug]) throw new Error("Unexpected sample: " + sample.slug);
}
for (const slug of Object.keys(HOWTO)) {
  if (!SAMPLES.some((sample) => sample.slug === slug)) throw new Error("Missing saved sample: " + slug);
}

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
    <span>· No analytics · Your key stays on your device</span>
    <div class="spacer"></div>
    <a href="https://github.com/nanoodlecom/nanoodle" target="_blank" rel="noopener">GitHub</a>
    <a href="https://www.reddit.com/user/dividebynano" target="_blank" rel="noopener">Contact</a>
    <a href="/">Home</a>
  </footer>

</div>
</body>
</html>
`.replace(/[ \t]+$/gm, "");
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
          <b>${esc(how.headline || s.title)}</b>
          <span class="job">${esc(how.job)}</span>
          <span class="cost">Reported saved run: ${esc(cost)}</span>
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

function visibleOutputs(s) {
  const note = String(s.note || "").trim();
  return s.outputs.filter((o) => {
    if (/NOTE\.txt$/i.test(o.src)) return false;
    if (o.kind !== "text") return true;
    return readFileSync(join(GALLERY, local(o.src)), "utf8").trim() !== note;
  });
}

function renderMedia(s, how) {
  const shown = visibleOutputs(s);
  const multi = shown.length > 1 ? " comparison" : "";
  const aria = (how && how.headline) || s.title;
  const figures = shown.map((o) => {
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
  const note = !s.preview && shown.every((o) => o.kind === "audio" || o.kind === "text") && shown.length
    ? `<p class="no-preview">No preview image was saved for this sample. The reviewed output is the ${shown.map((o) => o.kind).join(" and ")} below.</p>`
    : "";
  const cover = s.preview && shown.every((o) => o.kind === "audio" || o.kind === "text")
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
  const note = s.note
    ? `\n      <div class="callout"><p>${esc(s.note)}</p></div>`
    : "";

  const body = `    <h1><span class="grad">${esc(title)}</span></h1>
    <p class="lede">${esc(how.job)}</p>

    <section>
      <p class="meta-row">${esc(s.review)} · ${esc(s.date)} · Reported saved run: ${esc(cost)}. ${s.models.map((m) => `<code>${esc(m)}</code>`).join(" · ")}</p>
      <p>${esc(how.purpose)}</p>

      <h2>Saved result</h2>
      ${renderMedia(s, how)}
      ${inputImgs ? `<h3>References that went in</h3>\n        <div class="media input-refs${s.inputs.filter((i) => i.src).length > 1 ? " comparison" : ""}">\n          ${inputImgs}\n        </div>` : ""}${note}
      ${s.audioReview?.src ? `<p><a href="/examples/gallery/${esc(local(s.audioReview.src))}">Audio review notes</a></p>` : ""}

      <h2>Make it yours</h2>
      <ol class="input-list">
        <li>Open the graph — save first if the canvas already has your work. Undo brings yours back.</li>
        <li>${how.edit}</li>
        <li>Check the editor estimate, then run with your NanoGPT key. ${esc(how.costHow)}</li>
        <li>${how.inspect}</li>
      </ol>

      ${s.workflowNote ? `<p class="howto-note">${esc(s.workflowNote)}</p>` : ""}
      <div class="cta">
        <a class="primary" href="${esc(open)}">Open this noodle →</a>
        <a class="secondary" href="${esc(gallery)}">See the reviewed run</a>
      </div>
      <p class="howto-note"><a href="/examples/gallery/${esc(local(s.workflow))}" download>Download workflow</a>
        · <a href="/examples/gallery/${esc(local(s.slug + "/graph.json"))}" download>Original sampled graph</a>
        · <a href="https://mcp.nanoodle.com/#${esc(s.slug)}">${s.slug === "sing" ? "Hosted MCP (older Sing workflow)" : "Explore MCP tools"}</a>
        · <a href="https://github.com/nanoodlecom/awesome-noodles">awesome-noodles</a></p>`;

  return chrome({
    title: `${title} — nanoodle`,
    description: `${how.job} Reported saved run: ${cost}.`,
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
      <p>Play the finished game for free. Making your own character uses your NanoGPT key and balance; local rigging needs Node.js and ffmpeg.</p>

      <h2>Saved result</h2>
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
  const cards = ORDER.map((slug) => slug === "iron-verdict"
    ? ironCard()
    : cardForSample(sampleBySlug(slug))).join("\n      ");

  const body = `    <h1>Steal a <span class="grad">noodle</span></h1>
    <p class="lede">See the real output. Open the graph. Make it yours.</p>

    <section>
      <p>Five workflows with results you can inspect: character art used in a playable game, a four-model image comparison, an animated still, a song, and a speaking presenter. Each guide explains the stages, what to change and what the saved run cost.</p>
      <p>Viewing the <a href="/examples/gallery/">saved outputs</a> and playing Iron Verdict are free. Running your own version uses your NanoGPT key and balance. Your key stays on your device; prompts and media go directly to the model provider when you run. Saved costs describe past runs, and the next result will vary.</p>
      <p>Open a card, inspect its result, then use <strong>Open this noodle</strong> to edit the graph. The source graphs live in <a href="https://github.com/nanoodlecom/awesome-noodles" target="_blank" rel="noopener">awesome-noodles</a>. You can also <a href="/guide/run-headless">run the share link headlessly</a>.</p>
      <div class="howto-grid">
      ${cards}
      </div>`;

  const next = [
    `        <a href="/guide/">← Guide</a>`,
    `        <a href="/examples/gallery/">Reviewed gallery</a>`,
    `        <a href="/examples/iron-verdict/">Play Iron Verdict</a>`,
    `        <a href="/guide/run-headless">Run headlessly</a>`,
    `        <a href="/guide/share-links">How share links work</a>`,
  ].join("\n");

  return chrome({
    title: "Steal a noodle — nanoodle",
    description: "Five nanoodle workflows with saved results, instructions and reported costs. Open a graph and make it yours.",
    path: "/guide/examples/",
    crumbs: `<a href="/">Home</a> / <a href="/guide/">Guide</a> / <span>Steal a noodle</span>`,
    wide: true,
    body,
    next,
  });
}

function build() {
  const pages = { "index.html": hubPage() };
  const order = ORDER;
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
