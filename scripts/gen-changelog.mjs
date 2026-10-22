#!/usr/bin/env node
// Generate the public changelog artifacts:
//
//   changelog.html — static, self-contained page (zero scripts, zero third-party,
//                    inline CSS matching the site's visual language). Dated 📣
//                    updates come from updates.json, newest-first, grouped by date.
//                    Between the lede and those sections: a Field notes card strip
//                    from articles.json (Nano Maxi's daily Subnano posts) and a
//                    Guides link set from sitemap.xml's /guide/examples/* pages
//                    (each title is that page's h1).
//   feed.xml       — Atom feed of the updates.json entries only, so people can
//                    follow nanoodle without accounts or analytics (RSS is the only
//                    subscription channel consistent with the zero-analytics promise).
//
// updates.json is the source of truth for shipped changes (fed by the "Update:"
// commit-line convention + the daily model-updates cron). Entry shape:
// { date: "YYYY-MM-DD", text: "…", i18n: {es,fr,de,pt,ja}, media?: {src,poster,w,h} }.
// This page renders the English text; the localized strings stay in-app
// (the 📣 Updates panel).
//
// articles.json shape: { key, date, url, title, ability, thumb, blurb }.
// thumb is a same-origin path under articles-media/. The changelog's CSP is
// img-src 'self', so a remote poster URL would not paint.
//
// Deterministic by design: output depends only on updates.json, articles.json,
// sitemap.xml, and the h1 of each linked guide page (no Date.now()). Re-running
// on unchanged inputs is a byte-identical no-op — CI/pre-commit can diff freely.
// After editing any of those inputs the pre-commit hook regenerates and stages
// changelog.html + feed.xml; CI --checks them unconditionally.
//
//   node scripts/gen-changelog.mjs            # write changelog.html + feed.xml
//   node scripts/gen-changelog.mjs --check    # compare committed files, write nothing

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = "https://nanoodle.com";
const CHECK = process.argv.includes("--check");
const HTML_PATH = path.join(ROOT, "changelog.html");
const FEED_PATH = path.join(ROOT, "feed.xml");

// ---------------------------------------------------------------------------
// Load + order entries: newest date first; file order preserved within a date
// (updates.json is maintained newest-first, so this is a stable no-op sort).
// ---------------------------------------------------------------------------
const entries = JSON.parse(readFileSync(path.join(ROOT, "updates.json"), "utf8"));
if (!Array.isArray(entries) || !entries.length) {
  console.error("✗ gen-changelog: updates.json is empty or not an array");
  process.exit(1);
}
for (const [i, e] of entries.entries()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "") || typeof e.text !== "string" || !e.text.trim()) {
    console.error(`✗ gen-changelog: updates.json[${i}] needs a YYYY-MM-DD date and a non-empty text`);
    process.exit(1);
  }
}
const sorted = entries
  .map((e, i) => ({ ...e, i }))
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.i - b.i));

// Stable per-entry slug: date + content hash. Survives reordering and edits to
// OTHER entries; only changes if this entry's own text changes (which is the
// correct Atom semantic — a rewritten entry is a new entry). Collisions between
// identical texts on the same date get a -2, -3… suffix in file order.
const seen = new Map();
for (const e of sorted) {
  const base = `${e.date}-${createHash("sha256").update(e.text, "utf8").digest("hex").slice(0, 12)}`;
  const n = (seen.get(base) || 0) + 1;
  seen.set(base, n);
  e.slug = n === 1 ? base : `${base}-${n}`;
}

const escHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const escXml = escHtml;

// Bare https:// URLs in an entry render as real links on the HTML page (each
// fragment still escaped; trailing punctuation stays text). Mirrors the in-app
// 📣 modal's linkifier. The Atom feed keeps plain escaped text.
const linkifyHtml = (s) =>
  s.split(/(https:\/\/[^\s]*[^\s.,;:)!?»」。])/)
    .map((part) => /^https:\/\//.test(part)
      ? `<a href="${escHtml(part)}">${escHtml(part.replace(/^https:\/\//, ""))}</a>`
      : escHtml(part))
    .join("");

// An entry's optional usage clip (media:{src,poster,w,h}, files under updates-media/,
// validated by check-updates.mjs + check-updates-media.mjs). The page has zero
// scripts and no media-src, so it shows the lazy poster image linking to the mp4
// (the browser plays it on click) rather than an inline <video>.
const MEDIA_RE = /^updates-media\/[a-z0-9][a-z0-9._-]*\.(mp4|webp|png|jpg)$/;
function clipHtml(e) {
  const m = e.media;
  if (m === undefined) return "";
  if (!m || !MEDIA_RE.test(m.src || "") || !/\.mp4$/.test(m.src) || !MEDIA_RE.test(m.poster || "") ||
      !(Number.isInteger(m.w) && m.w > 0 && Number.isInteger(m.h) && m.h > 0)) {
    console.error(`✗ gen-changelog: bad media on ${e.date} "${e.text.slice(0, 60)}" — run node scripts/check-updates.mjs`);
    process.exit(1);
  }
  return `<a class="clip" href="/${m.src}" title="Play the usage clip">` +
    `<img src="/${m.poster}" width="${m.w}" height="${m.h}" loading="lazy" decoding="async" alt="Usage clip: ${escHtml(e.text)}" /></a>`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function humanDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
function cardDate(iso, newestYear) {
  const [y, m, d] = iso.split("-").map(Number);
  const mon = `${d} ${MONTHS_SHORT[m - 1]}`;
  return String(y) === String(newestYear) ? mon : `${mon} ${y}`;
}

// ---------------------------------------------------------------------------
// Field notes (articles.json) + example guides (sitemap → guide h1).
// Same-origin thumbs only: /changelog's CSP is img-src 'self'.
// ---------------------------------------------------------------------------
const ART_RE = /^articles-media\/[a-z0-9][a-z0-9._-]*\.(webp|png|jpg)$/;
function die(msg) { console.error("✗ gen-changelog: " + msg); process.exit(1); }

function loadArticles() {
  let articles;
  try { articles = JSON.parse(readFileSync(path.join(ROOT, "articles.json"), "utf8")); }
  catch (e) { die("articles.json is missing or invalid JSON — " + e.message); }
  if (!Array.isArray(articles) || !articles.length) die("articles.json is empty or not an array");
  const seen = new Set();
  articles.forEach((a, i) => {
    const where = `articles.json[${i}]`;
    if (!a || typeof a !== "object" || Array.isArray(a)) die(`${where} must be an object`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || "")) die(`${where} needs a YYYY-MM-DD date`);
    for (const k of ["key", "url", "title", "ability", "thumb", "blurb"]) {
      if (typeof a[k] !== "string" || !a[k].trim()) die(`${where} needs a non-empty ${k}`);
      if (/[\r\n]/.test(a[k])) die(`${where} ${k} must be a single line`);
    }
    if (!/^https:\/\/subnano\.ai\/@nano_maxi(?:\/|$)/.test(a.url)) die(`${where} url must be an https://subnano.ai/@nano_maxi link`);
    if (!ART_RE.test(a.thumb) || !existsSync(path.join(ROOT, a.thumb))) die(`${where} thumb must be an existing articles-media image (${a.thumb})`);
    if (seen.has(a.key)) die(`duplicate article key ${a.key}`);
    seen.add(a.key);
  });
  const dir = path.join(ROOT, "articles-media");
  if (existsSync(dir)) {
    const referenced = new Set(articles.map((a) => a.thumb));
    for (const f of readdirSync(dir)) {
      if (!referenced.has(`articles-media/${f}`)) die(`articles-media/${f} is not referenced by articles.json`);
    }
  }
  return articles
    .map((a, i) => ({ ...a, i }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.i - b.i));
}

function decodeBasic(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

function loadGuides() {
  let xml;
  try { xml = readFileSync(path.join(ROOT, "sitemap.xml"), "utf8"); }
  catch (e) { die("cannot read sitemap.xml — " + e.message); }
  const guides = [];
  const seen = new Set();
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    let pathname;
    try { pathname = new URL(m[1]).pathname; } catch { continue; }
    const slugM = pathname.match(/^\/guide\/examples\/([a-z0-9-]+)\/?$/);
    if (!slugM) continue;
    const slug = slugM[1];
    if (seen.has(slug)) die(`duplicate guide in sitemap: ${slug}`);
    seen.add(slug);
    const file = path.join(ROOT, "guide", "examples", `${slug}.html`);
    if (!existsSync(file)) die(`sitemap lists /guide/examples/${slug} but guide/examples/${slug}.html is missing`);
    const page = readFileSync(file, "utf8");
    const h1 = page.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    const title = decodeBasic((h1 ? h1[1] : "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (!title) die(`no h1 title in guide/examples/${slug}.html`);
    guides.push({ slug, title, href: `/guide/examples/${slug}` });
  }
  if (!guides.length) die("sitemap has no /guide/examples/* pages");
  return guides;
}

const articles = loadArticles();
const guides = loadGuides();
const newestArticleYear = articles[0].date.slice(0, 4);

function fieldNotesHtml() {
  const cards = articles.map((a) => `        <a class="fn-card" href="${escHtml(a.url)}" target="_blank" rel="noopener">
          <span class="fn-shot"><img src="/${escHtml(a.thumb)}" alt="" loading="lazy" decoding="async" /></span>
          <span class="fn-body">
            <span class="fn-meta"><span class="fn-chip">${escHtml(a.ability)}</span><time datetime="${escHtml(a.date)}">${escHtml(cardDate(a.date, newestArticleYear))}</time></span>
            <h3>${escHtml(a.title)}</h3>
            <p>${escHtml(a.blurb)}</p>
            <span class="fn-read">Read the run →</span>
          </span>
        </a>`).join("\n");
  const links = guides.map((g) => `          <li><a href="${escHtml(g.href)}">${escHtml(g.title)}</a></li>`).join("\n");
  const n = articles.length;
  return `    <section class="fieldnotes" id="fieldnotes" aria-labelledby="fieldnotes-title">
      <h2 id="fieldnotes-title">Field notes</h2>
      <p class="fn-intro">Nano Maxi, an AI agent, runs a nanoodle flow daily, pays in Nano, and posts the results on Subnano, misses included.</p>
      <div class="fn-grid">
${cards}
      </div>
      <p class="fn-cta"><a class="cta" href="https://subnano.ai/@nano_maxi" target="_blank" rel="noopener">Read all of Nano Maxi's notes →</a><span class="fn-count">${n} article${n === 1 ? "" : "s"}</span></p>
      <nav class="guides" aria-label="Guides">
        <h3>Guides <span>nanoodle.com</span></h3>
        <ul>
${links}
        </ul>
        <a class="guides-all" href="/guide/examples/">All example guides →</a>
      </nav>
    </section>`;
}

// ---------------------------------------------------------------------------
// changelog.html
// ---------------------------------------------------------------------------
const byDate = [];
for (const e of sorted) {
  const last = byDate[byDate.length - 1];
  if (last && last.date === e.date) last.items.push(e);
  else byDate.push({ date: e.date, items: [e] });
}

const newestDate = sorted[0].date;
const DESC = "Every nanoodle update in one place — new nodes, models and fixes for the " +
  "browser-only AI workflow playground — plus Nano Maxi's daily field notes. Follow along via the Atom feed, no account or tracking involved.";

const sections = byDate
  .map(
    ({ date, items }) => `    <section class="day">
      <h2 id="d-${date}"><a href="#d-${date}">${humanDate(date)}</a></h2>
      <ul>
${items.map((e) => `        <li id="u-${e.slug}">${linkifyHtml(e.text)}${clipHtml(e)}</li>`).join("\n")}
      </ul>
    </section>`
  )
  .join("\n");

const html = `<!doctype html>
<!-- GENERATED FILE — do not edit by hand. Source: updates.json + articles.json + sitemap.xml via scripts/gen-changelog.mjs -->
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>nanoodle - Changelog</title>
<meta name="description" content="${escHtml(DESC)}" />

<!-- Open Graph -->
<meta property="og:type" content="website" />
<meta property="og:site_name" content="nanoodle" />
<meta property="og:title" content="nanoodle - Changelog" />
<meta property="og:description" content="${escHtml(DESC)}" />
<meta property="og:url" content="${SITE}/changelog" />
<meta property="og:image" content="${SITE}/og-card.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="Neon noodles rising from a ramen bowl into glowing workflow cables, with the nanoodle logo" />

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="nanoodle - Changelog" />
<meta name="twitter:description" content="${escHtml(DESC)}" />
<meta name="twitter:image" content="${SITE}/og-card.png" />
<meta name="twitter:image:alt" content="Neon noodles rising from a ramen bowl into glowing workflow cables, with the nanoodle logo" />

<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<meta name="theme-color" content="#0b0d12" />
<link rel="canonical" href="${SITE}/changelog" />
<link rel="alternate" type="application/atom+xml" title="nanoodle changelog" href="/feed.xml" />
<style>
  :root{
    color-scheme: dark;
    --bg:#0b0d12; --panel:#12151d; --panel2:#171b25; --ink:#eef1f7; --dim:#9aa3b2;
    --line:#262c3a; --accent:#7c8cff; --accent2:#ff79c6; --cyan:#67e8f9;
  }
  *{box-sizing:border-box}
  html,body{margin:0; height:100%}
  body{ background:radial-gradient(1100px 540px at 70% -10%, #1a1f3a55, transparent), var(--bg);
        color:var(--ink); font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        min-height:100vh; display:flex; flex-direction:column; }
  a{color:var(--accent); text-decoration:none}
  a:hover{text-decoration:underline}
  .wrap{ max-width:1120px; margin:0 auto; padding:1.4rem 1.2rem; flex:1; display:flex; flex-direction:column; width:100%; }

  header{ display:flex; align-items:center; gap:.5rem; }
  .logo{ font-weight:800; letter-spacing:-.02em; font-size:1.25rem; }
  .logo .nano{ background:linear-gradient(90deg,var(--cyan),var(--accent) 70%); -webkit-background-clip:text; background-clip:text;
        color:transparent; font-weight:900; filter:drop-shadow(0 0 9px #7c8cff77); }
  .spacer{flex:1}
  .ghost{ font:inherit; font-size:.85rem; color:var(--dim); border:1px solid var(--line); border-radius:.55rem; padding:.35rem .7rem; }
  .ghost:hover{ border-color:#3a425a; color:var(--ink); text-decoration:none }

  main{ flex:1; padding:2.4rem 0; }
  h1{ font-size:clamp(1.8rem, 5vw, 2.6rem); line-height:1.08; letter-spacing:-.03em; margin:0 0 .4rem; font-weight:850; }
  h1 .grad{ background:linear-gradient(90deg,var(--cyan),var(--accent) 55%,var(--accent2)); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .sub{ color:var(--dim); font-size:.95rem; margin:0 0 .8rem; max-width:740px; }
  .feedrow{ display:flex; flex-wrap:wrap; gap:.45rem; margin:0 0 1.35rem; max-width:740px; }
  .feedrow a{ font-size:.82rem; border:1px solid var(--line); background:var(--panel2); color:var(--ink);
         padding:.32rem .7rem; border-radius:2rem; }
  .feedrow a:hover{ border-color:#3a425a; text-decoration:none }

  section.day{ border-top:1px solid var(--line); padding:1.6rem 0 .4rem; max-width:740px; }
  section.fieldnotes + section.day{ border-top:none; padding-top:.15rem; }
  section.fieldnotes{ border-bottom:1px solid var(--line); padding:0 0 1.25rem; margin:0 0 1.15rem; }
  .fn-intro{ color:var(--dim); font-size:.95rem; max-width:720px; margin:0 0 1rem; }
  .fn-grid{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:.85rem; }
  a.fn-card{ display:flex; flex-direction:column; min-width:0; background:var(--panel); border:1px solid var(--line);
             border-radius:1rem; overflow:hidden; color:inherit; text-decoration:none;
             transition:transform .18s ease, border-color .18s ease; }
  a.fn-card:hover{ transform:translateY(-3px); border-color:#3a425a; text-decoration:none; }
  a.fn-card:focus-visible{ outline:2px solid var(--accent); outline-offset:3px; }
  .fn-shot{ display:block; aspect-ratio:16/10; overflow:hidden; background:#0e1218; }
  .fn-shot img{ display:block; width:100%; height:100%; object-fit:cover; }
  .fn-body{ display:flex; flex-direction:column; flex:1; padding:.8rem .85rem .9rem; min-width:0; }
  .fn-meta{ display:flex; justify-content:space-between; align-items:center; gap:.45rem; }
  .fn-chip{ min-width:0; font:500 .68rem/1.3 ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--cyan);
            background:#132028; border:1px solid #1e3c48; border-radius:.4rem; padding:.08rem .4rem;
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fn-meta time{ flex:none; font-size:.75rem; color:var(--dim); }
  .fn-card h3{ font-size:.98rem; line-height:1.28; letter-spacing:-.02em; margin:.55rem 0 .35rem; font-weight:750; color:var(--ink); }
  .fn-card p{ margin:0; color:var(--dim); font-size:.82rem; line-height:1.45; }
  .fn-read{ margin-top:auto; padding-top:.75rem; color:var(--accent); font-size:.8rem; font-weight:700; }
  a.fn-card:hover .fn-read{ text-decoration:underline; }
  .fn-cta{ display:flex; flex-wrap:wrap; align-items:center; gap:.7rem 1rem; margin:1.05rem 0 0; }
  a.cta{ display:inline-block; background:linear-gradient(90deg,var(--cyan),var(--accent) 55%,var(--accent2)); color:#081018;
         font-weight:750; font-size:.9rem; padding:.55rem 1rem; border-radius:.7rem; text-decoration:none; }
  a.cta:hover{ text-decoration:none; filter:brightness(1.06); }
  .fn-count{ color:var(--dim); font-size:.85rem; }
  .guides{ margin-top:1.25rem; padding-top:1rem; border-top:1px solid var(--line); }
  .guides h3{ margin:0 0 .55rem; font-size:.95rem; letter-spacing:-.01em; font-weight:750; }
  .guides h3 span{ color:var(--dim); font-weight:550; font-size:.8rem; margin-left:.35rem; }
  .guides ul{ list-style:none; margin:0; padding:0; display:grid; grid-template-columns:1fr 1fr; gap:.28rem 1.4rem; }
  .guides li{ margin:0; min-width:0; }
  .guides li a{ color:var(--dim); font-size:.84rem; }
  .guides li a:hover{ color:var(--accent); }
  a.guides-all{ display:inline-block; margin-top:.75rem; font-size:.84rem; font-weight:700; }
  @media (max-width:980px){
    .fn-grid{ grid-template-columns:repeat(2,minmax(0,1fr)); }
  }
  @media (max-width:640px){
    .sub, .feedrow, section.day{ max-width:none; }
    .fn-grid{ display:flex; overflow-x:auto; scroll-snap-type:x mandatory; gap:.7rem; padding:0 .05rem .45rem; scrollbar-width:thin; }
    a.fn-card{ flex:0 0 86%; scroll-snap-align:start; }
    a.fn-card:hover{ transform:none; }
    .guides ul{ grid-template-columns:1fr; }
  }
  @media (prefers-reduced-motion: reduce){
    a.fn-card{ transition:none; }
    a.fn-card:hover{ transform:none; }
  }
  h2{ font-size:1.15rem; letter-spacing:-.01em; margin:0 0 .7rem; font-weight:800; scroll-margin-top:1rem; }
  h2 a{ color:var(--ink); }
  h2 a:hover{ color:var(--accent); text-decoration:none }
  ul{ margin:0 0 1rem; padding-left:1.2rem; }
  li{ margin:.45rem 0; color:#cdd3df; scroll-margin-top:1rem; }
  li:target{ color:var(--ink); }
  a.clip{ display:block; position:relative; width:min(100%,320px); margin:.5rem 0 .2rem; border:1px solid var(--line);
          border-radius:.55rem; overflow:hidden; line-height:0; background:#000; }
  a.clip:hover{ border-color:var(--accent); }
  a.clip img{ display:block; width:100%; height:auto; }
  a.clip::after{ content:"▶"; position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:2.6rem; height:2.6rem;
          border-radius:50%; background:#0b0d12cc; border:1px solid #3a425a; color:var(--ink); font-size:1rem; line-height:2.6rem;
          text-align:center; }
  a.clip:hover::after{ border-color:var(--accent); }

  footer{ border-top:1px solid var(--line); color:var(--dim); font-size:.82rem; padding:1.1rem 0 .3rem;
          display:flex; gap:.4rem 1rem; flex-wrap:wrap; align-items:center; }
  footer .spacer{flex:1}
</style>
</head>
<body>
<div class="wrap">

  <header>
    <a class="logo" href="/"><span class="nano">NaNo</span>odle</a>
    <div class="spacer"></div>
    <a class="ghost" href="/">Open editor →</a>
  </header>

  <main>
    <h1>Change<span class="grad">log</span> &amp; field notes</h1>
    <p class="sub">Everything that ships to nanoodle, newest first — the same entries as the in-app 📣 Updates panel. Last update: ${humanDate(newestDate)}.</p>
    <nav class="feedrow">
      <a href="/feed.xml" type="application/atom+xml">Follow via Atom feed</a>
      <a href="https://github.com/nanoodlecom/nanoodle" target="_blank" rel="noopener">Source on GitHub</a>
    </nav>

${fieldNotesHtml()}

${sections}
  </main>

  <footer>
    <span>Made with <a href="https://nano-gpt.com/r/mgzwtqjw" target="_blank" rel="noopener">NanoGPT</a></span>
    <span>· 100% in your browser, no server</span>
    <div class="spacer"></div>
    <a href="/feed.xml">Atom feed</a>
    <a href="https://github.com/nanoodlecom/nanoodle" target="_blank" rel="noopener">GitHub</a>
    <a href="/legal">Legal</a>
    <a href="/">Home</a>
  </footer>

</div>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// feed.xml (Atom, RFC 4287)
// ---------------------------------------------------------------------------
// Dates in updates.json are day-granular; Atom wants RFC3339 instants, so every
// entry is stamped at UTC midnight of its date — stable across regenerations.
const rfc3339 = (isoDate) => `${isoDate}T00:00:00Z`;

// Stable Atom ids use the tag: URI scheme (RFC 4151): the domain + the entry's
// own date as the taggingdate, so the id never changes once published.
const tagId = (e) => `tag:nanoodle.com,${e.date}:changelog/${e.slug}`;

const feedEntries = sorted
  .map(
    (e) => `  <entry>
    <id>${tagId(e)}</id>
    <title type="text">${escXml(e.text)}</title>
    <link rel="alternate" type="text/html" href="${SITE}/changelog#u-${e.slug}"/>
    <updated>${rfc3339(e.date)}</updated>
    <content type="text">${escXml(e.text)}</content>
  </entry>`
  )
  .join("\n");

const feed = `<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED FILE - do not edit by hand. Source: updates.json via scripts/gen-changelog.mjs -->
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${SITE}/changelog</id>
  <title>nanoodle changelog</title>
  <subtitle>Updates from nanoodle - wire AI models into workflows in your browser, then turn one into a shareable app. No server, no accounts, no analytics.</subtitle>
  <link rel="self" type="application/atom+xml" href="${SITE}/feed.xml"/>
  <link rel="alternate" type="text/html" href="${SITE}/changelog"/>
  <updated>${rfc3339(newestDate)}</updated>
  <author><name>nanoodle</name><uri>${SITE}/</uri></author>
  <icon>${SITE}/icon-192.png</icon>
  <logo>${SITE}/og-card.png</logo>
${feedEntries}
</feed>
`;

// ---------------------------------------------------------------------------
// Well-formedness gate for the feed: a tiny stack parser (node has no built-in
// DOM). Catches unbalanced tags, unquoted attributes, raw & / < in text — the
// failure modes an escaping bug here would actually produce. Not a full XML
// parser; it doesn't need to be (we control the vocabulary).
// ---------------------------------------------------------------------------
function assertWellFormedXml(xml, label) {
  let s = xml;
  if (s.startsWith("﻿")) s = s.slice(1);
  s = s.replace(/^<\?xml[^?]*\?>\s*/, "");
  s = s.replace(/<!--[\s\S]*?-->/g, ""); // comments (generator emits none nested)
  const stack = [];
  const re = /<[^>]*>|[^<]+/g;
  let m;
  const bad = (why) => { throw new Error(`${label} is not well-formed XML: ${why}`); };
  while ((m = re.exec(s))) {
    const tok = m[0];
    if (tok[0] !== "<") {
      // text node: only entity-escaped & allowed, no stray <
      const t = tok.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, "");
      if (t.includes("&")) bad(`raw '&' in text near ${JSON.stringify(tok.slice(0, 60))}`);
      continue;
    }
    if (!tok.endsWith(">")) bad(`unterminated tag ${JSON.stringify(tok.slice(0, 60))}`);
    if (tok.startsWith("</")) {
      const name = tok.slice(2, -1).trim();
      const open = stack.pop();
      if (open !== name) bad(`</${name}> closes <${open}>`);
    } else {
      const inner = tok.slice(1, tok.endsWith("/>") ? -2 : -1);
      const name = (inner.match(/^[A-Za-z_][\w:.-]*/) || [])[0];
      if (!name) bad(`bad tag ${JSON.stringify(tok.slice(0, 60))}`);
      // attributes must be name="quoted" pairs
      const attrs = inner.slice(name.length);
      if (!/^(\s+[A-Za-z_][\w:.-]*="[^"<]*")*\s*$/.test(attrs))
        bad(`malformed attributes in <${name}${attrs.slice(0, 60)}>`);
      if (!tok.endsWith("/>")) stack.push(name);
    }
  }
  if (stack.length) bad(`unclosed <${stack.join("> <")}>`);
}
assertWellFormedXml(feed, "feed.xml");

// Sanity: every id unique (Atom hard requirement).
const ids = sorted.map(tagId);
if (new Set(ids).size !== ids.length) {
  console.error("✗ gen-changelog: duplicate Atom entry ids");
  process.exit(1);
}

function firstDiff(have, want, label) {
  const a = have.split("\n"), b = want.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `  ${label}: first difference at line ${i + 1}\n` +
             `    on disk:   ${a[i] === undefined ? "<end of file>" : JSON.stringify(a[i].slice(0, 160))}\n` +
             `    generated: ${b[i] === undefined ? "<end of file>" : JSON.stringify(b[i].slice(0, 160))}`;
    }
  }
  return `  ${label}: files are identical`;
}

if (CHECK) {
  const haveHtml = existsSync(HTML_PATH) ? readFileSync(HTML_PATH, "utf8") : "";
  const haveFeed = existsSync(FEED_PATH) ? readFileSync(FEED_PATH, "utf8") : "";
  const htmlOk = haveHtml === html;
  const feedOk = haveFeed === feed;
  if (htmlOk && feedOk) {
    console.log(`✓ gen-changelog: changelog.html + feed.xml match updates.json + articles.json (updated ${newestDate}, ${articles.length} field notes, ${guides.length} guides)`);
    process.exit(0);
  }
  console.error("✗ gen-changelog: changelog.html / feed.xml are stale vs updates.json + articles.json + the guide sitemap.");
  console.error("  Regenerate with:  node scripts/gen-changelog.mjs");
  if (!htmlOk) console.error(firstDiff(haveHtml, html, "changelog.html"));
  if (!feedOk) console.error(firstDiff(haveFeed, feed, "feed.xml"));
  process.exit(1);
}

writeFileSync(HTML_PATH, html);
writeFileSync(FEED_PATH, feed);
console.log(`✓ gen-changelog: wrote changelog.html (${byDate.length} days, ${articles.length} field notes, ${guides.length} guides) + feed.xml (${sorted.length} entries, well-formed, updated ${newestDate})`);
