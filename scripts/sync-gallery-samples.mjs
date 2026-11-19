#!/usr/bin/env node
// Render saved workflow outputs. No network, credentials, or model calls.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../examples/gallery');
const samples = JSON.parse(readFileSync(join(root, 'samples.json'), 'utf8'));
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
// Preserve the generated text, including Markdown hard-break spaces, without
// introducing trailing whitespace into generated HTML source.
const textHtml = s => esc(s).replace(/[ \t]+$/gm, ws => [...ws].map(c => c === ' ' ? '&#32;' : '&#9;').join(''));
const local = file => {
  if (!/^[\w/-]+\.[\w]+$/.test(file) || file.includes('..') || !existsSync(join(root, file))) {
    throw Error('Missing/invalid sample asset: ' + file);
  }
  return esc(file);
};
const checkedGraph = (file, hash) => {
  const bytes = readFileSync(join(root, local(file)));
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw Error('Graph changed: ' + file);
  return bytes;
};

function renderOutputs(s) {
  if (!s.outputs?.length) throw Error('Sample has no saved output: ' + s.slug);
  const outputs = s.outputs.map(o => {
    const src = local(o.src);
    let media;
    if (o.kind === 'text') {
      const text = `<blockquote>${textHtml(readFileSync(join(root, src), 'utf8'))}</blockquote>`;
      media = (o.spoiler || o.collapsed) ? `<details><summary>${esc(o.label)}</summary>${text}</details>` : text;
    }
    else if (o.kind === 'video') media = `<video controls playsinline${o.loop ? ' loop' : ''} preload="none" poster="${local(s.preview)}" aria-label="${esc(o.label + ' — ' + s.title)}"><source src="${src}" type="video/mp4"></video>`;
    else if (o.kind === 'audio') media = `<audio controls preload="none" aria-label="${esc(s.title)}"><source src="${src}" type="audio/mpeg"></audio>`;
    else if (o.kind === 'image') media = `<a href="${src}"><img src="${src}" alt="${esc(o.label + ' — ' + s.title)}" loading="lazy"></a>`;
    else throw Error('Unsupported sample output: ' + o.kind);
    return `<figure${s.layout === 'sequence' && o.kind === 'text' ? ' class="sequence-text"' : ''}>${media}<figcaption>${esc(o.label)} · <a href="${src}" download>Download</a></figcaption></figure>`;
  }).join('\n');
  return `<div class="outputs ${s.layout === 'sequence' ? 'sequence' : s.outputs.every(o => o.kind === 'image') && s.outputs.length > 1 ? 'comparison' : ''}">${outputs}</div>`;
}

function renderInputs(s) {
  return s.inputs.map(i => i.src
    ? `<figure><img src="${local(i.src)}" alt="${esc(i.label)}" loading="lazy"><figcaption>${esc(i.label)}</figcaption></figure>`
    : `<div><h4>${esc(i.label)}</h4><p>${esc(i.text)}</p></div>`).join('\n');
}

const cost = s => `${s.costExact ? '' : 'at least '}$${Number(s.costUsd.toFixed(5))}`;
const openLink = graph => 'https://nanoodle.com/#g=' + gzipSync(graph).toString('base64url');

function renderAlternate(s, a) {
  const graph = checkedGraph(a.graph, a.graphSha256);
  checkedGraph(a.sourceGraph, a.sourceGraphSha256);
  return `<details class="alternate" id="${esc(s.slug + '--' + a.id)}"><summary><span class="alternate-summary"><img src="${local(a.preview)}" alt="" loading="lazy"><span><b>Another run: ${esc(a.title)}</b><span>See what the same workflow made with different inputs ↓</span></span></span></summary>
<div class="alternate-body"><p class="meta">${esc(a.review)} · ${esc(a.date)}</p><p>${esc(a.note)}</p>${renderOutputs(a)}
<p class="meta">Reported generation cost: ${cost(a)}. Prices and results vary.</p>
<details><summary>Inputs for this version</summary><div class="inputs">${renderInputs(a)}</div><p class="meta">Sampled models: ${a.models.map(esc).join(', ')}.</p></details>
<p class="links"><a href="${openLink(graph)}">Open this version ↗</a><a href="${local(a.graph)}" download>Download this version</a><a href="${local(a.sourceRun)}">Run record</a></p></div></details>`;
}

const sections = samples.map(s => {
  checkedGraph(s.slug + '/graph.json', s.graphSha256);
  const workflow = checkedGraph(s.workflow, s.workflowSha256);
  const differences = s.workflowNote ? `<p>${esc(s.workflowNote)}</p>` : '';
  return `<section id="${esc(s.slug)}"><div class="heading"><span>${esc(s.review)} · ${esc(s.date)}</span><h2>${esc(s.title)}</h2></div>
<p>${esc(s.note)}</p>${renderOutputs(s)}
<p class="meta">Reported generation cost: ${cost(s)}. Prices and results vary.</p>
<details><summary>Inputs and run details</summary><div class="inputs">${renderInputs(s)}</div><p class="meta">Sampled models: ${s.models.map(esc).join(', ')}.</p>${differences}</details>
<p class="links"><a href="${openLink(workflow)}">Open workflow ↗</a><a href="/guide/examples/${esc(s.slug)}">How it works</a><a href="${local(s.workflow)}" download>Download workflow</a><a href="${local(s.slug + '/graph.json')}" download>Original sampled graph</a></p>
${(s.alternates || []).map(a => renderAlternate(s, a)).join('\n')}</section>`;
}).join('\n');

const showcase = `<div class="showcase" aria-label="Featured model combinations">${samples.filter(s => s.showcase).map(s => `<a class="showcase-card" href="#${esc(s.slug)}"><img src="${local(s.preview)}" alt=""><span><b>${esc(s.title)}</b><span>${esc(s.showcase)}</span><strong>See the results ↓</strong></span></a>`).join('')}</div>`;

// Deep links (the Updates feed, guides) address an example as #slug and an alternate
// run as #slug--id. Alternates live in a closed <details>, so open it (and any
// enclosing details) when the hash names one, then bring it into view.
const hashOpener = `<script>(()=>{const go=()=>{let id;try{id=decodeURIComponent(location.hash.slice(1))}catch{return}const el=id&&document.getElementById(id);if(!el)return;for(let d=el;d;d=d.parentElement)if(d.tagName==='DETAILS')d.open=true;el.scrollIntoView()};addEventListener('hashchange',go);go()})()</script>`;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workflow results — nanoodle</title><meta name="description" content="Inspect an illustrated mystery, a revised storyboard, a miniature film with foley, character artwork, model comparisons, a song and a speaking presenter. Actual outputs with their inputs and run details."><meta name="theme-color" content="#0b0d12"><link rel="canonical" href="https://nanoodle.com/examples/gallery/"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="stylesheet" href="/brand/nanoodle-v1.0.0/tokens/tokens.css"><link rel="stylesheet" href="/brand/nanoodle-v1.0.0/fonts/fonts.css"><link rel="stylesheet" href="gallery.css"></head>
<body><main><header>
<a class="gallery-brand" href="/"><img src="/favicon-32.png" width="24" height="24" alt=""><span><span class="nano">nano</span>odle</span></a>
<p class="eyebrow">Workflow examples</p><h1>What the workflows made.</h1>
<p>Explore saved images, stories, video, and music with the inputs that produced them. Viewing is free. Live runs use your NanoGPT balance.</p>${showcase}<nav aria-label="Workflow samples"><a href="../iron-verdict/">Play Iron Verdict</a><a href="/guide/examples/">Workflow guides</a>${samples.map(s => `<a href="#${esc(s.slug)}">${esc(s.title)}</a>`).join('')}</nav></header>
${sections}<footer><p>Made by nanoodle. No analytics. <a href="samples.json">Sample details</a> · <a href="https://github.com/nanoodlecom/awesome-noodles">Workflow source</a> · <a href="https://branding.nanoodle.com/">Brand guidelines</a></p></footer></main>${hashOpener}</body></html>\n`;
const target = join(root, 'index.html');
// Node 20 vs 22 gzip streams differ; normalize #g= payloads to the sha of the
// decoded graph JSON so --check stays green across the CI matrix.
const normalizeShareLinks = (s) => s.replace(/#g=[A-Za-z0-9_-]+/g, (m) => {
  try {
    const json = gunzipSync(Buffer.from(m.slice(3), 'base64url')).toString('utf8');
    return '#g=sha256:' + createHash('sha256').update(json).digest('hex');
  } catch {
    return m;
  }
});
if (process.argv.includes('--check')) {
  const onDisk = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (normalizeShareLinks(onDisk) !== normalizeShareLinks(html)) throw Error('Sample page stale: run node scripts/sync-gallery-samples.mjs');
} else writeFileSync(target, html);
console.log(`Verified ${samples.length} saved runs${process.argv.includes('--check') ? '' : '; rendered gallery page'}`);
