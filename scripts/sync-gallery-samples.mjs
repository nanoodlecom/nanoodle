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

const sections = samples.map(s => {
  if (!s.outputs?.length) throw Error('Sample has no saved output: ' + s.slug);
  checkedGraph(s.slug + '/graph.json', s.graphSha256);
  const workflow = checkedGraph(s.workflow, s.workflowSha256);
  const link = 'https://nanoodle.com/#g=' + gzipSync(workflow).toString('base64url');
  const outputs = s.outputs.map(o => {
    const src = local(o.src);
    let media;
    if (o.kind === 'text') media = `<blockquote>${esc(readFileSync(join(root, src), 'utf8'))}</blockquote>`;
    else if (o.kind === 'video') media = `<video controls preload="none" poster="${local(s.preview)}" aria-label="${esc(s.title)}"><source src="${src}" type="video/mp4"></video>`;
    else if (o.kind === 'audio') media = `<audio controls preload="none" aria-label="${esc(s.title)}"><source src="${src}" type="audio/mpeg"></audio>`;
    else if (o.kind === 'image') media = `<a href="${src}"><img src="${src}" alt="${esc(o.label + ' — ' + s.title)}" loading="lazy"></a>`;
    else throw Error('Unsupported sample output: ' + o.kind);
    return `<figure>${media}<figcaption>${esc(o.label)} · <a href="${src}" download>Download</a></figcaption></figure>`;
  }).join('\n');
  const inputs = s.inputs.map(i => i.src
    ? `<figure><img src="${local(i.src)}" alt="${esc(i.label)}" loading="lazy"><figcaption>${esc(i.label)}</figcaption></figure>`
    : `<div><h4>${esc(i.label)}</h4><p>${esc(i.text)}</p></div>`).join('\n');
  const cost = `${s.costExact ? '' : 'at least '}$${Number(s.costUsd.toFixed(5))}`;
  const differences = s.workflowNote ? `<p>${esc(s.workflowNote)}</p>` : '';
  return `<section id="${esc(s.slug)}"><div class="heading"><span>${esc(s.review)} · ${esc(s.date)}</span><h2>${esc(s.title)}</h2></div>
<p>${esc(s.note)}</p><div class="outputs ${s.outputs.every(o => o.kind === 'image') && s.outputs.length > 1 ? 'comparison' : ''}">${outputs}</div>
<p class="meta">Reported generation cost: ${cost}. Prices and results vary.</p>
<details><summary>Inputs and run details</summary><div class="inputs">${inputs}</div><p class="meta">Sampled models: ${s.models.map(esc).join(', ')}.</p>${differences}</details>
<p class="links"><a href="${link}">Open workflow ↗</a><a href="/guide/examples/${esc(s.slug)}">How it works</a><a href="${local(s.workflow)}" download>Download workflow</a><a href="${local(s.slug + '/graph.json')}" download>Original sampled graph</a></p></section>`;
}).join('\n');

const css = `:root{color-scheme:dark;--bg:#0b0d12;--panel:#12151d;--panel2:#171b25;--ink:#eef1f7;--dim:#9aa3b2;--muted:var(--dim);--line:#262c3a;--accent:#7c8cff;--accent2:#ff79c6;--cyan:#67e8f9}*{box-sizing:border-box}body{margin:0;background:radial-gradient(1100px 540px at 70% -10%,#1a1f3a55,transparent),var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}main{max-width:1040px;margin:auto;padding:40px 24px 80px}a{color:var(--accent);text-decoration:none;text-underline-offset:3px}a:hover{text-decoration:underline}header{padding:24px 0 38px;border-bottom:1px solid var(--line)}header>a{font-weight:800;letter-spacing:-.02em;text-decoration:none;color:var(--ink)}header>a:hover{color:var(--cyan);text-decoration:none}h1{font-size:clamp(34px,6vw,62px);line-height:1.06;letter-spacing:-2px;margin:30px 0 20px;font-weight:850;background:linear-gradient(90deg,var(--cyan),var(--accent) 55%,var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}header p{max-width:760px;color:#cdd3df}section>p{color:#cdd3df}nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}nav a{font-size:14px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);padding:.32rem .7rem;border-radius:2rem}nav a:hover{border-color:#3a425a;text-decoration:none}section{padding:40px 0;border-bottom:1px solid var(--line);scroll-margin-top:20px}h2{font-size:30px;line-height:1.2;margin:8px 0 18px;letter-spacing:-.7px;font-weight:800}.heading span,.meta,figcaption{font-size:13px;color:var(--muted)}figure{margin:0;min-width:0}figure img,video{display:block;width:100%;max-height:620px;object-fit:contain;background:var(--panel);border:1px solid var(--line);border-radius:10px}audio{width:100%}figcaption{margin:8px 0 18px}.outputs{max-width:760px;margin:24px 0}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:none}.comparison img{aspect-ratio:1;object-fit:contain}h3{font-size:20px;margin:28px 0 10px;letter-spacing:-.3px}blockquote{margin:0;padding:24px;border-left:3px solid var(--accent);background:var(--panel2);border-radius:0 .6rem .6rem 0;white-space:pre-wrap;color:#dbe2ef}.inputs{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px;padding:20px;margin-top:12px;background:var(--panel2);border:1px solid var(--line);border-radius:.7rem}.inputs img{max-height:280px}.inputs h4{margin:0;color:var(--ink)}.inputs p{white-space:pre-wrap;font-size:14px;color:#cdd3df}summary{cursor:pointer;font-weight:600;color:var(--ink)}.links{display:flex;flex-wrap:wrap;gap:12px 24px;font-size:14px}footer{color:var(--dim);font-size:.82rem;padding-top:1.1rem}@media(max-width:600px){main{padding:20px 18px 60px}.comparison{grid-template-columns:1fr}h1{letter-spacing:-1px}section{padding:30px 0}}`;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workflow results — nanoodle</title><meta name="description" content="Inspect character-kit artwork, a four-model image comparison, generated video, a song, and a speaking presenter. Saved outputs with their original inputs and run details."><meta name="theme-color" content="#0b0d12"><link rel="canonical" href="https://nanoodle.com/examples/gallery/"><style>${css}</style></head>
<body><main><header><a href="/">nanoodle 🍜</a><h1>What the workflows made.</h1><p>Saved images, video and a song, with the inputs that produced them. Viewing is free. Run your own version with your NanoGPT key and balance.</p><nav aria-label="Workflow samples"><a href="../iron-verdict/">Play Iron Verdict</a><a href="/guide/examples/">Workflow guides</a>${samples.map(s => `<a href="#${esc(s.slug)}">${esc(s.title)}</a>`).join('')}</nav></header>
${sections}<footer><p>Made by nanoodle. No analytics. <a href="samples.json">Sample details</a> · <a href="https://github.com/nanoodlecom/awesome-noodles">Workflow source</a></p></footer></main></body></html>\n`;
const target = join(root, 'index.html');
if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== html) throw Error('Sample page stale: run node scripts/sync-gallery-samples.mjs');
} else writeFileSync(target, html);
console.log(`Verified ${samples.length} saved runs${process.argv.includes('--check') ? '' : '; rendered gallery page'}`);
