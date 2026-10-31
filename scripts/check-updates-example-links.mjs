#!/usr/bin/env node
// Every Updates entry that links a gallery example (updates.json "examples") must point
// at a real one: id is a gallery section (slug) or an alternate run (slug--alternate id)
// that exists in examples/gallery/samples.json AND in the rendered gallery page, the
// alternate belongs to that slug, and the link title is that example's (or alternate's)
// gallery title. Also pins the announcements that must stay linked, so a dropped link
// or a link to the wrong alternate fails CI. Offline; no network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = f => readFileSync(join(ROOT, f), 'utf8');
const updates = JSON.parse(read('updates.json'));
const samples = JSON.parse(read('examples/gallery/samples.json'));
const gallery = read('examples/gallery/index.html');
const editor = read('index.html');

// id → { title, kind } for every gallery example and alternate run.
const targets = new Map();
for (const s of samples) {
  targets.set(s.slug, { title: s.title, kind: 'section' });
  for (const a of s.alternates || []) targets.set(s.slug + '--' + a.id, { title: a.title, kind: 'alternate', slug: s.slug });
}
const decode = v => v.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

let links = 0;
const errs = [];
updates.forEach((e, i) => {
  if (e.examples === undefined) return;
  const where = `updates.json #${i} (${e.date} "${e.text.slice(0, 50)}…")`;
  const seen = new Set();
  for (const x of e.examples) {
    links++;
    if (seen.has(x.id)) errs.push(`${where}: duplicate link ${x.id}`);
    seen.add(x.id);
    const t = targets.get(x.id);
    if (!t) { errs.push(`${where}: ${x.id} is not a gallery example or alternate`); continue; }
    if (x.title !== t.title) errs.push(`${where}: ${x.id} title "${x.title}" ≠ gallery title "${t.title}"`);
    const tag = t.kind === 'alternate'
      ? new RegExp(`<details class="alternate" id="${x.id}">`)
      : new RegExp(`<section id="${x.id}">`);
    if (!tag.test(gallery)) errs.push(`${where}: examples/gallery/index.html has no ${t.kind} with id ${x.id} (run node scripts/sync-gallery-samples.mjs)`);
    if (t.kind === 'section') {
      const h = gallery.match(new RegExp(`<section id="${x.id}">.*?<h2>(.*?)</h2>`));
      if (!h || decode(h[1]) !== t.title) errs.push(`${where}: gallery section ${x.id} heading does not read "${t.title}"`);
    } else {
      const b = gallery.match(new RegExp(`<details class="alternate" id="${x.id}">.*?<b>Another run: (.*?)</b>`));
      if (!b || decode(b[1]) !== t.title) errs.push(`${where}: gallery alternate ${x.id} does not read "Another run: ${t.title}"`);
      // An alternate must sit inside its own example's section.
      const sec = gallery.indexOf(`<section id="${t.slug}">`), alt = gallery.indexOf(`id="${x.id}"`);
      const next = gallery.indexOf('<section id=', sec + 1);
      if (!(sec >= 0 && alt > sec && (next < 0 || alt < next))) errs.push(`${where}: alternate ${x.id} is not inside section ${t.slug}`);
    }
  }
});

// Announcements that must link, with exactly these targets (newest-first text prefixes).
const REQUIRED = [
  ['🔁 Same workflow, different input:', ['song-to-music-video--owl-lighthouse-lullaby', 'composer-watches-your-film--domino-chain-bell', 'sketch-to-svg--camp-badge']],
  ['🎤 New example: Song in, music video out.', ['song-to-music-video']],
  ['🎻 New example: A composer that watches your film.', ['composer-watches-your-film']],
  ['🐉 New example: Prompt to an editable SVG sticker.', ['sketch-to-svg']],
  ['New gallery example: Mix the references', ['mix-the-references']],
  ['New gallery example: Same shot, three looks', ['same-shot-three-looks']],
  ['New Examples card: Neon shrine duel', ['neon-shrine-duel']],
  ['New Examples card: Character sprites', ['character-sprites']],
  ['Examples shelf cut to five useful workflows', ['character-sprites', 'image-model-arena', 'photo-to-video', 'sing', 'talking-avatar']],
];
for (const [prefix, ids] of REQUIRED) {
  const hits = updates.filter(e => e.text.startsWith(prefix));
  if (hits.length !== 1) { errs.push(`expected one Updates entry starting "${prefix}", found ${hits.length}`); continue; }
  const got = (hits[0].examples || []).map(x => x.id);
  try { assert.deepEqual(got, ids); } catch { errs.push(`"${prefix}" links [${got.join(', ')}], expected [${ids.join(', ')}]`); }
}
// Any entry naming an alternate run ("second run", "another run") must link alternates only.
updates.forEach((e, i) => {
  if (!/\b(second|another) run\b/i.test(e.text)) return;
  const ex = e.examples || [];
  if (!ex.length || ex.some(x => !x.id.includes('--'))) errs.push(`updates.json #${i}: mentions an alternate run but does not link only alternates`);
});

// The editor renders the link exactly as examples/gallery/#<id>, and the gallery opens
// a closed alternate <details> when its hash arrives.
if (!editor.includes('a.href = "examples/gallery/#" + x.id;')) errs.push('index.html: Updates renderer no longer links examples/gallery/#<id>');
if (!/addEventListener\('hashchange',go\)/.test(gallery) || !/d\.tagName==='DETAILS'\)d\.open=true/.test(gallery)) errs.push('examples/gallery/index.html: missing the hash opener for alternate runs');

if (errs.length) { console.error('✗ Updates example links:\n  ' + errs.join('\n  ')); process.exit(1); }
console.log(`✓ Updates example links: ${links} links across ${updates.filter(e => e.examples).length} entries resolve to their gallery examples`);
