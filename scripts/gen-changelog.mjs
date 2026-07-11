#!/usr/bin/env node
// Generate the public changelog artifacts from updates.json:
//
//   changelog.html — static, self-contained page (zero scripts, zero third-party,
//                    inline CSS matching the site's visual language) listing every
//                    📣 update newest-first, grouped by date.
//   feed.xml       — Atom feed of the same entries, so people can follow nanoodle
//                    without accounts or analytics (RSS is the only subscription
//                    channel consistent with the zero-analytics promise).
//
// updates.json is the single source of truth (fed by the "Update:" commit-line
// convention + the daily model-updates cron). Entry shape: { date: "YYYY-MM-DD",
// text: "…", i18n: {es,fr,de,pt,ja} }. This page renders the English text; the
// localized strings stay in-app (the 📣 Updates panel).
//
// Deterministic by design: output depends ONLY on updates.json (no Date.now()),
// so re-running the generator on an unchanged input is a byte-identical no-op —
// CI/pre-commit can diff freely. Run it after editing updates.json:
//
//   node scripts/gen-changelog.mjs
//
// and commit changelog.html + feed.xml alongside.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = "https://nanoodle.com";

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

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
function humanDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
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
  "browser-only AI workflow playground. Follow along via the Atom feed, no account or tracking involved.";

const sections = byDate
  .map(
    ({ date, items }) => `    <section>
      <h2 id="d-${date}"><a href="#d-${date}">${humanDate(date)}</a></h2>
      <ul>
${items.map((e) => `        <li id="u-${e.slug}">${escHtml(e.text)}</li>`).join("\n")}
      </ul>
    </section>`
  )
  .join("\n");

const html = `<!doctype html>
<!-- GENERATED FILE — do not edit by hand. Source: updates.json via scripts/gen-changelog.mjs -->
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
  .wrap{ max-width:760px; margin:0 auto; padding:1.4rem 1.2rem; flex:1; display:flex; flex-direction:column; width:100%; }

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
  .sub{ color:var(--dim); font-size:.95rem; margin:0 0 .8rem; }
  .feedrow{ display:flex; flex-wrap:wrap; gap:.45rem; margin:0 0 2.2rem; }
  .feedrow a{ font-size:.82rem; border:1px solid var(--line); background:var(--panel2); color:var(--ink);
         padding:.32rem .7rem; border-radius:2rem; }
  .feedrow a:hover{ border-color:#3a425a; text-decoration:none }

  section{ border-top:1px solid var(--line); padding:1.6rem 0 .4rem; }
  section:first-of-type{ border-top:none; padding-top:0; }
  h2{ font-size:1.15rem; letter-spacing:-.01em; margin:0 0 .7rem; font-weight:800; scroll-margin-top:1rem; }
  h2 a{ color:var(--ink); }
  h2 a:hover{ color:var(--accent); text-decoration:none }
  ul{ margin:0 0 1rem; padding-left:1.2rem; }
  li{ margin:.45rem 0; color:#cdd3df; scroll-margin-top:1rem; }
  li:target{ color:var(--ink); }

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
    <h1>Change<span class="grad">log</span></h1>
    <p class="sub">Everything that ships to nanoodle, newest first — the same entries as the in-app 📣 Updates panel. Last update: ${humanDate(newestDate)}.</p>
    <nav class="feedrow">
      <a href="/feed.xml" type="application/atom+xml">Follow via Atom feed</a>
      <a href="https://github.com/nanoodlecom/nanoodle" target="_blank" rel="noopener">Source on GitHub</a>
    </nav>

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

writeFileSync(path.join(ROOT, "changelog.html"), html);
writeFileSync(path.join(ROOT, "feed.xml"), feed);
console.log(`✓ gen-changelog: wrote changelog.html (${byDate.length} days) + feed.xml (${sorted.length} entries, well-formed, updated ${newestDate})`);
