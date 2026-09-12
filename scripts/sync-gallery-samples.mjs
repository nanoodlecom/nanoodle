#!/usr/bin/env node
// Render saved workflow outputs. No network, credentials, or model calls.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

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
    else if (o.kind === 'video') media = `<video controls playsinline preload="none" poster="${local(s.preview)}" aria-label="${esc(o.label + ' — ' + s.title)}"><source src="${src}" type="video/mp4"></video>`;
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

const css = `:root{color-scheme:dark;--bg:#0b0d12;--panel:#12151d;--panel2:#171b25;--ink:#eef1f7;--dim:#9aa3b2;--muted:var(--dim);--line:#262c3a;--accent:#7c8cff;--accent2:#ff79c6;--cyan:#67e8f9}*{box-sizing:border-box}body{margin:0;background:radial-gradient(1100px 540px at 70% -10%,#1a1f3a55,transparent),var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}main{max-width:1040px;margin:auto;padding:40px 24px 80px}a{color:var(--accent);text-decoration:none;text-underline-offset:3px}a:hover{text-decoration:underline}header{padding:24px 0 38px;border-bottom:1px solid var(--line)}header>a{font-weight:800;letter-spacing:-.02em;text-decoration:none;color:var(--ink)}header>a:hover{color:var(--cyan);text-decoration:none}h1{font-size:clamp(34px,6vw,62px);line-height:1.06;letter-spacing:-2px;margin:30px 0 20px;font-weight:850;background:linear-gradient(90deg,var(--cyan),var(--accent) 55%,var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}header p{max-width:760px;color:#cdd3df}section>p{color:#cdd3df}nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}nav a{font-size:14px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);padding:.32rem .7rem;border-radius:2rem}nav a:hover{border-color:#3a425a;text-decoration:none}section{padding:40px 0;border-bottom:1px solid var(--line);scroll-margin-top:20px}h2{font-size:30px;line-height:1.2;margin:8px 0 18px;letter-spacing:-.7px;font-weight:800}.heading span,.meta,figcaption{font-size:13px;color:var(--muted)}figure{margin:0;min-width:0}figure img,video{display:block;width:100%;max-height:620px;object-fit:contain;background:var(--panel);border:1px solid var(--line);border-radius:10px}audio{width:100%}figcaption{margin:8px 0 18px}.outputs{max-width:760px;margin:24px 0}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:none}.sequence{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;max-width:none}.sequence-text{grid-column:1/-1}.comparison img{aspect-ratio:1;object-fit:contain}h3{font-size:20px;margin:28px 0 10px;letter-spacing:-.3px}blockquote{margin:0;padding:24px;border-left:3px solid var(--accent);background:var(--panel2);border-radius:0 .6rem .6rem 0;white-space:pre-wrap;color:#dbe2ef}.inputs{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px;padding:20px;margin-top:12px;background:var(--panel2);border:1px solid var(--line);border-radius:.7rem}.inputs img{max-height:280px}.inputs h4{margin:0;color:var(--ink)}.inputs p{white-space:pre-wrap;font-size:14px;color:#cdd3df}summary{cursor:pointer;font-weight:600;color:var(--ink)}.links{display:flex;flex-wrap:wrap;gap:12px 24px;font-size:14px}.showcase{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:28px}.showcase-card{overflow:hidden;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--ink)}.showcase-card:hover{border-color:var(--accent);text-decoration:none}.showcase-card>img{display:block;width:100%;aspect-ratio:3/2;object-fit:cover}.showcase-card>span{display:grid;gap:10px;padding:18px}.showcase-card b{font-size:20px;line-height:1.25}.showcase-card span span{font-size:14px;color:#cdd3df}.showcase-card strong{font-size:13px;color:var(--cyan)}.alternate{margin-top:28px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.alternate>summary{padding:16px;list-style:none}.alternate>summary::-webkit-details-marker{display:none}.alternate-summary{display:flex;align-items:center;gap:18px}.alternate-summary>img{width:120px;aspect-ratio:3/2;object-fit:cover;border-radius:7px}.alternate-summary>span{display:grid;gap:6px}.alternate-summary span span{font-size:13px;font-weight:400;color:var(--dim)}.alternate-body{padding:0 18px 18px}.alternate .outputs{margin-top:18px}footer{color:var(--dim);font-size:.82rem;padding-top:1.1rem}@media(max-width:600px){main{padding:20px 18px 60px}.comparison,.sequence,.showcase{grid-template-columns:1fr}.showcase-card{display:grid;grid-template-columns:115px 1fr}.showcase-card>img{height:100%;aspect-ratio:auto}.showcase-card>span{padding:14px}.alternate-summary>img{width:90px}h1{letter-spacing:-1px}section{padding:30px 0}}`;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workflow results — nanoodle</title><meta name="description" content="Inspect an illustrated mystery, a revised storyboard, a miniature film with foley, character artwork, model comparisons, a song and a speaking presenter. Actual outputs with their inputs and run details."><meta name="theme-color" content="#0b0d12"><link rel="canonical" href="https://nanoodle.com/examples/gallery/"><style>${css}</style></head>
<body><main><header><a href="/">nanoodle 🍜</a><h1>What the workflows made.</h1><p>Saved images, stories, video and music, with the inputs that produced them. Viewing is free. Run your own version with your NanoGPT key and balance.</p>${showcase}<nav aria-label="Workflow samples"><a href="../iron-verdict/">Play Iron Verdict</a><a href="/guide/examples/">Workflow guides</a>${samples.map(s => `<a href="#${esc(s.slug)}">${esc(s.title)}</a>`).join('')}</nav></header>
${sections}<footer><p>Made by nanoodle. No analytics. <a href="samples.json">Sample details</a> · <a href="https://github.com/nanoodlecom/awesome-noodles">Workflow source</a></p></footer></main></body></html>\n`;
const target = join(root, 'index.html');
if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== html) throw Error('Sample page stale: run node scripts/sync-gallery-samples.mjs');
} else writeFileSync(target, html);
console.log(`Verified ${samples.length} saved runs${process.argv.includes('--check') ? '' : '; rendered gallery page'}`);
