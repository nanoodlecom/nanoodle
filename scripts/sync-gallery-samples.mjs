#!/usr/bin/env node
// Render saved workflow outputs. No network, credentials, or model calls.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { alternateEditorial, editorial } from './lib/gallery-editorial.mjs';

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

const types = { image: 'Image', video: 'Video', audio: 'Audio', model3d: '3D model', text: 'Text' };
const leadKind = s => s.outputs.find(o => o.kind !== 'text')?.kind || 'text';
const sampleType = s => editorial[s.slug]?.type || leadKind(s);
const port = (type, label = types[type]) => `<span class="port-label" data-type="${esc(type)}">${esc(label)}</span>`;
const cost = s => `${s.costExact ? '' : 'at least '}$${Number(s.costUsd.toFixed(5))}`;
const openLink = graph => 'https://nanoodle.com/#g=' + gzipSync(graph).toString('base64url');
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const date = s => `<time datetime="${esc(s.date)}">${dateFormat.format(new Date(s.date))}</time>`;

function outputLabel(output) {
  const [title, ...technical] = output.label.replace(/^\d+\. /, '').split(' · ');
  return { title, technical: technical.join(' · ') };
}

function renderOutput(s, o, { square = false, portrait = false, leadCaption } = {}) {
  const src = local(o.src);
  const { title, technical } = leadCaption || outputLabel(o);
  const name = esc(title + ' — ' + s.title);
  const download = `<a class="download" href="${src}" download aria-label="Download ${esc(title)}">Download <span aria-hidden="true">↓</span></a>`;
  const metadata = technical ? `<small>${esc(technical)}</small>` : '';
  const caption = `<figcaption><span><strong>${esc(title)}</strong>${metadata}</span>${download}</figcaption>`;
  if (o.kind === 'text') {
    const text = textHtml(readFileSync(join(root, src), 'utf8'));
    return `<figure class="text-output"><details><summary>${esc(title)}</summary><blockquote>${text}</blockquote></details><figcaption class="text-meta">${metadata}${download}</figcaption></figure>`;
  }

  let media;
  if (o.kind === 'video') {
    const posterPath = o.src.replace(/\.mp4$/, '-poster.webp');
    const poster = local(posterPath !== o.src && existsSync(join(root, posterPath)) ? posterPath : s.preview);
    media = `<video controls playsinline${o.loop ? ' loop' : ''} preload="${square ? 'metadata' : 'none'}" poster="${poster}" aria-label="${name}"><source src="${src}" type="video/mp4"></video>`;
  } else if (o.kind === 'audio') {
    media = `<div class="audio-player">${port('audio', 'Saved audio')}<audio controls preload="none" aria-label="${name}"><source src="${src}" type="audio/mpeg"></audio></div>`;
  } else if (o.kind === 'image') {
    const stillPath = o.src.replace(/\.gif$/, '-still.webp');
    const still = stillPath !== o.src && existsSync(join(root, stillPath)) ? local(stillPath) : '';
    const animated = still ? ` data-animated-src="${src}" data-still-src="${still}"` : '';
    media = `<a href="${src}" aria-label="Open full-size image: ${name}"><img src="${still || src}"${animated} alt="${name}" loading="lazy"></a>`;
  } else {
    throw Error('Unsupported sample output: ' + o.kind);
  }
  return `<figure class="output media-${o.kind}${square ? ' media-square' : ''}${portrait ? ' media-portrait' : ''}">${media}${caption}</figure>`;
}

function renderOutputGrid(s, outputs, className = '') {
  return `<div class="output-grid ${className}">${outputs.map(o => renderOutput(s, o)).join('\n')}</div>`;
}

function renderInputs(inputs) {
  return inputs.map(i => i.src
    ? `<figure class="input-media"><a href="${local(i.src)}"><img src="${local(i.src)}" alt="${esc(i.label)}" loading="lazy"></a><figcaption>${esc(i.label)}</figcaption></figure>`
    : `<div class="text-input"><h4>${esc(i.label)}</h4><p>${esc(i.text)}</p></div>`).join('\n');
}

function renderRunDetails(s, label, inputs = s.inputs) {
  const models = s.models.map(model => `<li><code>${esc(model)}</code></li>`).join('');
  const note = s.workflowNote ? `<p class="technical">${esc(s.workflowNote)}</p>` : '';
  return `<details class="run-details">
<summary>${esc(label)}</summary>
<div class="run-detail-body">
${inputs.length ? `<div class="inputs">${renderInputs(inputs)}</div>` : ''}
<div class="run-models">${models ? `<h4>Models in this run</h4><ul>${models}</ul>` : '<p>All nodes run locally.</p>'}${note}</div>
</div>
</details>`;
}

function renderAlternate(s, a) {
  const graph = checkedGraph(a.graph, a.graphSha256);
  checkedGraph(a.sourceGraph, a.sourceGraphSha256);
  return `<details class="alternate" id="${esc(s.slug + '--' + a.id)}"><summary><img src="${local(a.preview)}" alt="" loading="lazy"><b>Another run: ${esc(a.title)}</b></summary>
<div class="alternate-body">
<p class="technical">${date(a)} · Saved run <strong>${cost(a)}</strong></p>
<p class="alternate-note">${esc(alternateEditorial[a.id] || a.note)}</p>
<p class="technical alternate-review">${esc(a.review)}</p>
${renderOutputGrid(a, a.outputs)}
${renderRunDetails(a, 'Inputs for this version')}
<div class="actions"><a class="button primary" href="${openLink(graph)}">Open this version <span aria-hidden="true">↗</span></a><a class="button secondary" href="${local(a.graph)}" download>Download this version</a><a class="button quiet" href="${local(a.sourceRun)}">Run record</a></div>
</div></details>`;
}

function partitionOutputs(s, copy) {
  if (!s.outputs?.length) throw Error('Sample has no saved output: ' + s.slug);
  const kind = leadKind(s);
  const featured = copy.compare
    ? s.outputs.filter(o => o.kind === (copy.type === 'video' ? 'video' : kind))
    : [copy.lead === undefined ? s.outputs.find(o => o.kind !== 'text') || s.outputs[0] : s.outputs[copy.lead]];
  if (!featured.length || featured.includes(undefined)) throw Error('Invalid lead output: ' + s.slug);
  return [featured, s.outputs.filter(o => !featured.includes(o))];
}

const sections = samples.map(s => {
  const copy = editorial[s.slug] || { summary: s.review, workflow: s.note };
  checkedGraph(s.slug + '/graph.json', s.graphSha256);
  const workflow = checkedGraph(s.workflow, s.workflowSha256);
  const [featured, supporting] = partitionOutputs(s, copy);
  const input = copy.pairInput ? s.inputs[0] : null;
  const related = copy.related && samples.find(other => other.slug === copy.related);
  const downloads = [
    `<a class="button secondary" href="${local(s.workflow)}" download>Download workflow</a>`,
    s.workflow === s.slug + '/graph.json' ? '' :
      `<a class="button quiet" href="${local(s.slug + '/graph.json')}" download>Original sampled graph</a>`,
  ].join('');
  return `<section id="${esc(s.slug)}" class="sample" aria-labelledby="${esc(s.slug)}-title" tabindex="-1">
<div class="sample-top${featured.length > 1 ? ' sample-top-wide' : ''}">
<header class="sample-intro">
<div class="sample-meta">${port(sampleType(s))}<span>Saved sample</span>${date(s)}</div>
<h2 id="${esc(s.slug)}-title"${copy.indexTitle ? ' class="long-title"' : ''}>${esc(s.title)}</h2>
<p class="sample-summary">${esc(copy.summary)}</p>
<div class="actions">
<a class="button primary" href="${openLink(workflow)}">Open workflow <span aria-hidden="true">↗</span></a>
${copy.asset ? `<a class="button secondary" href="${local(copy.asset)}" download>Download GLB <span aria-hidden="true">↓</span></a>` : ''}

</div>
<p class="technical sample-cost">Saved run <strong>${cost(s)}</strong> <span>·</span> ${s.models.length ? 'Live prices vary' : 'Local processing'}</p>
</header>
${input ? `<div class="media-pair">${renderOutput(s, featured[0], { square: true, leadCaption: copy.leadCaption })}${renderInputs([{ ...input, label: 'Source photo' }])}</div>`
  : featured.length > 1 ? renderOutputGrid(s, featured, 'comparisons') : renderOutput(s, featured[0], { portrait: copy.portrait })}
</div>
<div class="sample-notes">
<div><h3>How it runs</h3><p>${esc(copy.workflow)}</p></div>
${copy.review ? `<div><h3>What to look for</h3><p>${esc(copy.review)}</p>${related ? `<a class="related-link" href="#${esc(related.slug)}">Compare with ${esc(related.title)} <span aria-hidden="true">↗</span></a>` : ''}</div>` : ''}
</div>
${supporting.length ? `<div class="other-outputs"><h3>More from this run</h3>${renderOutputGrid(s, supporting)}</div>` : ''}
${renderRunDetails(s, 'Inputs and run details', input ? s.inputs.slice(1) : s.inputs)}
<div class="actions sample-files"><a class="button quiet" href="/guide/examples/${esc(s.slug)}">How it works <span aria-hidden="true">↗</span></a>${downloads}<a class="button quiet back-link" href="#workflow-index">All workflows <span aria-hidden="true">↑</span></a></div>
${(s.alternates || []).map(a => renderAlternate(s, a)).join('\n')}
</section>`;
}).join('\n');

const mesh = samples.find(s => s.slug === 'photo-to-game-ready-mesh');
const hero = `<div class="hero">
<div class="hero-copy">
<p class="eyebrow">Workflow gallery</p>
<h1>From input<br>to <span>output.</span></h1>
<p class="lead">See the images, clips, songs, and 3D models nanoodle workflows made. Inspect the inputs and saved results, then open a workflow to make it your own.</p>
<div class="actions"><a class="button primary" href="#${esc(mesh.slug)}">See the mesh example <span aria-hidden="true">↓</span></a><a class="button secondary" href="#workflow-index">Browse all workflows</a></div>
<p class="billing">Samples are free to view. Live runs use your NanoGPT balance.</p>
</div>
<figure class="hero-feature">
<figcaption><span>${port('model3d', 'Featured sample')}</span><strong>${esc(mesh.title)}</strong></figcaption>
<div class="hero-frames">
<div class="hero-frame"><img src="${local(mesh.inputs[0].src)}" alt="Source photo of the bronze dragon" width="1600" height="1600" fetchpriority="high"><span>${port('image', 'Source photo')}</span></div>
<span class="hero-connector" aria-hidden="true"></span>
<div class="hero-frame"><img src="${local(mesh.preview)}" alt="Rendered three-quarter view of the reconstructed mesh" width="768" height="768"><span>${port('model3d', 'Textured mesh')}</span></div>
</div>
</figure>
</div>`;

const showcase = `<nav class="showcase" aria-label="More featured workflows">${samples.filter(s => s.showcase).map(s =>
  `<a class="showcase-card" href="#${esc(s.slug)}"><img src="${local(s.preview)}" alt="" loading="lazy"><span class="showcase-copy">${port(sampleType(s))}<strong>${esc(s.title)}</strong><span>${esc(s.showcase)}</span></span><span class="card-arrow" aria-hidden="true">↘</span></a>`
).join('')}</nav>`;

const searchTypes = Object.entries(types).filter(([type]) => samples.some(s => sampleType(s) === type));
const directory = `<details class="directory" id="workflow-index">
<summary>All workflows <span class="directory-count">${samples.length} samples</span></summary>
<nav class="directory-body" aria-label="All workflows">
<div class="directory-tools" hidden>
<label>Find a workflow <input type="search" id="workflow-search" placeholder="Title or model"></label>
<label>Output type <select id="workflow-type"><option value="">All types</option>${searchTypes.map(([type, label]) => `<option value="${type}">${label}</option>`).join('')}</select></label>
</div>
<p class="directory-status" aria-live="polite" hidden></p>
<ul class="directory-list">${samples.map(s => {
  const copy = editorial[s.slug];
  const keywords = [s.title, copy?.summary, ...s.inputs.map(i => i.label), ...s.models].filter(Boolean).join(' ');
  return `<li data-type="${esc(sampleType(s))}" data-search="${esc(keywords)}"><a href="#${esc(s.slug)}">${port(sampleType(s), copy?.indexTitle || s.title)}</a></li>`;
}).join('\n')}</ul>
<div class="actions"><a class="button quiet" href="/guide/examples/">Workflow guides</a><a class="button quiet" href="../iron-verdict/">Play Iron Verdict <span aria-hidden="true">↗</span></a></div>
</nav>
</details>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Workflow gallery · nanoodle</title>
<meta name="description" content="Explore saved images, videos, songs, and 3D models made with nanoodle. See the inputs, inspect the results, and open any workflow in the editor.">
<meta name="theme-color" content="#0b0d12">
<link rel="canonical" href="https://nanoodle.com/examples/gallery/">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="stylesheet" href="/brand/nanoodle-v1.0.0/tokens/tokens.css">
<link rel="stylesheet" href="/brand/nanoodle-v1.0.0/fonts/fonts.css">
<link rel="stylesheet" href="gallery.css">
<script src="gallery.js" defer></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
<div class="site-bar">
<a class="gallery-brand" href="/" aria-label="nanoodle home"><img src="/favicon-32.png" width="32" height="32" alt=""><img src="/brand/nanoodle-v1.0.0/assets/wordmark-gradient.svg" width="102" height="18" alt=""></a>
<nav aria-label="Site"><a class="button quiet" href="/guide/examples/">Workflow guides</a><a class="button secondary" href="/app">Open editor <span aria-hidden="true">↗</span></a></nav>
</div>
</header>
<main id="main" tabindex="-1">
${hero}
${showcase}
${directory}
<div class="samples">
${sections}
</div>
</main>
<footer class="site-footer"><div><p>Made with nanoodle.</p><nav aria-label="Gallery resources"><a href="samples.json">Sample details</a><a href="https://github.com/nanoodlecom/awesome-noodles">Workflow source</a><a href="https://branding.nanoodle.com/">Brand guidelines</a></nav></div></footer>
</body>
</html>
`;

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
