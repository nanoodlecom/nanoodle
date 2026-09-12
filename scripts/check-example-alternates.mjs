#!/usr/bin/env node
// Alternate examples are saved executions with different inputs, not relabeled
// covers. Check their provenance and both rendered surfaces without network access.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GALLERY = join(ROOT, 'examples/gallery');
const APPROVED = new Map([
  ['pocket-mystery', 'submarine-bakery'],
  ['storyboard-relay', 'salt-lagoon-kite'],
  ['tiny-world-film', 'alternate'],
]);
const CAPTURED_OUTPUTS = {
  'pocket-mystery': ['room-image.webp', 'observe-text.txt'],
  'storyboard-relay': ['frame-one-image.webp', 'frame-two-image.png', 'repair-image.webp', 'review-text.txt', 'final-review-text.txt'],
  'tiny-world-film': ['n3-image.webp', 'n4-video.mp4', 'n5-video.mp4'],
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const esc = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
  if (code[0] === '#') return String.fromCodePoint(Number.parseInt(code.slice(/^#x/i.test(code) ? 2 : 1), /^#x/i.test(code) ? 16 : 10));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[code.toLowerCase()];
});
const read = file => readFileSync(join(ROOT, file), 'utf8');
const sameSet = (actual, expected, label) => {
  assert.equal(new Set(actual).size, actual.length, label + ': duplicates');
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
};
const asset = (file, hash, prefix) => {
  assert.equal(typeof file, 'string', 'missing alternate asset path');
  assert.match(file, /^[\w/-]+\.[\w]+$/, 'invalid alternate asset path: ' + file);
  assert(!file.includes('..') && file.startsWith(prefix), 'alternate asset escaped its own directory: ' + file);
  const path = join(GALLERY, file);
  assert(statSync(path).isFile(), 'alternate asset is not a file: ' + file);
  const bytes = readFileSync(path);
  assert(bytes.length, 'empty alternate asset: ' + file);
  assert.match(hash || '', /^[a-f0-9]{64}$/, 'missing alternate asset hash: ' + file);
  assert.equal(sha(bytes), hash, 'alternate asset hash drift: ' + file);
  return bytes;
};

// These generated pages contain escaped text and nested details, so match the
// details stack rather than stopping at the first closing tag (the GM spoiler).
function detailsBlocks(html) {
  const stack = [], blocks = [];
  for (const match of html.matchAll(/<details\b[^>]*>|<\/details\s*>/g)) {
    if (!match[0].startsWith('</')) stack.push({ start: match.index, opening: match[0] });
    else {
      const entry = stack.pop();
      assert(entry, 'unmatched closing details tag');
      blocks.push({ ...entry, html: html.slice(entry.start, match.index + match[0].length) });
    }
  }
  assert.equal(stack.length, 0, 'unclosed details tag');
  return blocks;
}
const alternateBlocks = html => detailsBlocks(html).filter(b => /\bclass="[^"]*\balternate\b[^"]*"/.test(b.opening));
const blockId = block => block.opening.match(/\bid="([^"]+)"/)?.[1];
const cost = a => `${a.costExact ? '' : 'at least '}$${Number(a.costUsd.toFixed(5))}`;

function checkRendered(page, slug, a, graphBytes, texts, guide) {
  const id = slug + '--' + a.id;
  const variants = alternateBlocks(page).filter(b => blockId(b) === id);
  assert.equal(variants.length, 1, id + ': missing or duplicated rendered alternate');
  const block = variants[0].html;
  const local = file => esc((guide ? '/examples/gallery/' : '') + file);
  const summary = block.slice(0, block.indexOf('</summary>'));
  assert(summary.includes(`src="${local(a.preview)}"`), id + ': thumbnail missing from alternate summary');
  assert(summary.includes(esc(a.title)), id + ': alternate title missing');
  for (const value of [a.review, a.date, a.note]) assert(block.includes(esc(value)), id + ': review/date/note omitted');
  const costLabel = guide ? 'Reported saved run: ' : 'Reported generation cost: ';
  assert(block.includes(costLabel + cost(a) + '.'), id + ': shown cost differs from saved run');
  assert(block.includes('Sampled models: ' + a.models.map(esc).join(', ') + '.'), id + ': shown model list differs');
  for (const input of a.inputs) {
    assert(block.includes(esc(input.label)) && block.includes(esc(input.text)), id + ': shown input omitted: ' + input.label);
  }
  assert(block.includes(`href="${local(a.graph)}" download`), id + ': effective graph download omitted');
  assert(block.includes(`href="${local(a.sourceRun)}"`), id + ': saved run link omitted');
  const shares = [...block.matchAll(/href="https:\/\/nanoodle\.com\/#g=([A-Za-z0-9_-]+)"/g)];
  assert.equal(shares.length, 1, id + ': alternate must have exactly one Open this version share link');
  assert(gunzipSync(Buffer.from(shares[0][1], 'base64url')).equals(graphBytes),
    id + ': share link differs from the effective graph bytes');

  const figures = [...block.matchAll(/<figure\b[^>]*>[\s\S]*?<\/figure>/g)].map(m => m[0]);
  for (const output of a.outputs) {
    const matches = figures.filter(f => f.includes(`href="${local(output.src)}" download`));
    assert.equal(matches.length, 1, id + ': missing or duplicated downloadable output: ' + output.src);
    const figure = matches[0];
    assert(figure.includes(esc(output.label)), id + ': output label omitted');
    if (output.kind === 'text') {
      const text = texts.get(output.src);
      const quotes = [...figure.matchAll(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/g)];
      assert.equal(quotes.length, 1, id + ': text needs one rendered body');
      // Numeric entities preserve source Markdown trailing spaces without adding
      // trailing whitespace to generated HTML. Compare the actual DOM text.
      assert.equal(decode(quotes[0][1]), text, id + ': rendered text differs from its saved output');
      if (output.spoiler || output.collapsed) {
        const hidden = detailsBlocks(figure).filter(b => b.html.includes(quotes[0][0]));
        assert.equal(hidden.length, 1, id + ': text needs its own disclosure: ' + output.src);
        assert(!/\sopen(?:\s|=|>)/i.test(hidden[0].opening), id + ': spoiler/review disclosure must start closed');
      }
      if (output.spoiler) assert.equal(decode(block).split(text).length, 2, id + ': spoiler text appeared outside its disclosure');
    } else {
      assert(figure.includes(`src="${local(output.src)}"`), id + ': output is linked but not shown');
      if (output.kind === 'video' || output.kind === 'audio') assert(/\bcontrols\b/.test(figure), id + ': media cannot be played');
    }
  }
}

export function checkAlternates({
  samples = JSON.parse(read('examples/gallery/samples.json')),
  gallery = read('examples/gallery/index.html'),
  guides = new Map([...APPROVED.keys()].map(slug => [slug, read('guide/examples/' + slug + '.html')])),
} = {}) {
  const variants = samples.flatMap(s => (s.alternates || []).map(a => ({ slug: s.slug, a })));
  const ids = variants.map(({ slug, a }) => slug + '--' + a.id);
  sameSet(ids, [...APPROVED].map(([slug, id]) => slug + '--' + id), 'approved alternate set');
  sameSet(alternateBlocks(gallery).map(blockId), ids, 'gallery alternate set');
  for (const [slug, id] of APPROVED) {
    sameSet(alternateBlocks(guides.get(slug)).map(blockId), [slug + '--' + id], slug + ': guide alternate set');
  }

  for (const { slug, a } of variants) {
    const prefix = `${slug}/alternates/${a.id}/`;
    const load = (file, hash) => asset(file, hash, prefix);
    const sourceBytes = load(a.sourceGraph, a.sourceGraphSha256);
    const graphBytes = load(a.graph, a.graphSha256);
    const workflowBytes = load(a.workflow, a.workflowSha256);
    const overrides = JSON.parse(load(a.inputOverrides, a.inputOverridesSha256));
    const run = JSON.parse(load(a.sourceRun, a.sourceRunSha256));
    assert(workflowBytes.equals(graphBytes), slug + ': workflow and effective graph differ');
    assert.equal(run.graphSha256, sha(sourceBytes), slug + ': source graph does not belong to saved run');
    assert.equal(run.slug, slug, slug + ': wrong source run');
    assert.equal(a.case, a.id, slug + ': alternate case mislabeled');
    assert.equal(run.case, a.case, slug + ': source run has different inputs');
    assert.deepEqual(run.errors, [], slug + ': selected run has execution errors');
    assert.deepEqual(run.captureErrors, [], slug + ': selected run has capture errors');
    assert(!run.executionError, slug + ': selected run failed');
    assert(Number.isFinite(run.costUsd) && run.costUsd >= 0, slug + ': invalid reported run cost');
    for (const field of ['costUsd', 'costExact', 'recordedAt', 'elapsedMs']) {
      assert.equal(a[field], run[field], slug + ': mislabeled ' + field);
    }
    assert.equal(a.date, run.recordedAt.slice(0, 10), slug + ': displayed date differs from saved run');
    assert(a.review?.trim() && a.note?.trim(), slug + ': missing alternate review');
    assert(!/unreviewed|not reviewed|pending/i.test(a.review), slug + ': alternate is an unreviewed placeholder');

    const source = JSON.parse(sourceBytes), effective = JSON.parse(graphBytes);
    assert.equal(source.v, 1, slug + ': invalid source graph');
    const textNodes = source.nodes.filter(n => n.type === 'text');
    assert(overrides && typeof overrides === 'object' && !Array.isArray(overrides), slug + ': invalid input overrides');
    sameSet(Object.keys(overrides), textNodes.map(n => n.name), slug + ': alternate must record every named text input');
    sameSet(a.inputs.map(i => i.label), textNodes.map(n => n.name), slug + ': displayed input set differs');
    const expected = structuredClone(source);
    for (const node of textNodes) {
      const text = overrides[node.name];
      assert.equal(typeof text, 'string', slug + ': input override is not text');
      expected.nodes.find(n => n.id === node.id).fields.text = text;
      assert.deepEqual(a.inputs.find(i => i.label === node.name), { label: node.name, text }, slug + ': displayed input differs');
      const recorded = run.nodes.find(n => n.id === node.id)?.outputs.find(o => o.port === 'text');
      assert(recorded, slug + ': saved run did not capture input ' + node.name);
      assert.equal(sha(Buffer.from(text)), recorded.sha256, slug + ': input was changed after the captured run');
      assert.equal(Buffer.byteLength(text), recorded.bytes, slug + ': captured input length differs');
    }
    assert.deepEqual(effective, expected, slug + ': effective graph changed more than the recorded inputs');
    const models = [...new Set(source.nodes.map(n => n.fields?.model).filter(Boolean))];
    assert.deepEqual(a.models, models, slug + ': graph model list mislabeled');
    for (const node of source.nodes.filter(n => n.type !== 'comment')) {
      const recorded = run.nodes.find(n => n.id === node.id);
      assert(recorded && recorded.type === node.type && recorded.status === 'done', slug + ': incomplete source node ' + node.id);
      assert.equal(recorded.model, node.fields?.model, slug + ': recorded model differs at ' + node.id);
    }

    const recordedOutputs = run.nodes.flatMap(n => n.outputs);
    const captured = new Map(recordedOutputs.map(o => [o.file, o]));
    assert.equal(captured.size, recordedOutputs.length, slug + ': captured file names collide');
    const fromRun = (file, hash, kind) => {
      const bytes = load(file, hash), record = captured.get(basename(file));
      assert(record, slug + ': displayed output is absent from the saved run: ' + file);
      assert.equal(record.sha256, hash, slug + ': media belongs to a different run: ' + file);
      assert.equal(record.bytes, bytes.length, slug + ': captured output length differs: ' + file);
      assert.equal(record.kind, kind, slug + ': output media type mislabeled: ' + file);
      return bytes;
    };
    sameSet(a.outputs.map(o => o.src), [...new Set(a.outputs.map(o => o.src))], slug + ': duplicate displayed output');
    const derived = new Map();
    if (slug === 'pocket-mystery') {
      assert.equal(a.combinedText?.delimiter, 'GM ONLY - SPOILERS', 'mystery: missing raw spoiler boundary');
      const combined = fromRun(a.combinedText.src, a.combinedText.sha256, 'text').toString('utf8');
      const delimiter = a.combinedText.delimiter, at = combined.indexOf(delimiter);
      assert(at > 0 && combined.indexOf(delimiter, at + delimiter.length) < 0, 'mystery: ambiguous spoiler boundary');
      const player = a.outputs.find(o => basename(o.src) === 'player.txt');
      const gm = a.outputs.find(o => basename(o.src) === 'gm.txt');
      assert(player?.kind === 'text' && !player.spoiler && gm?.kind === 'text' && gm.spoiler === true, 'mystery: player/GM disclosure flags missing');
      derived.set(player.src, combined.slice(0, at));
      derived.set(gm.src, combined.slice(at));
    }
    if (slug === 'tiny-world-film') {
      assert(a.audioReview, 'film: missing independent audio review record');
      const review = JSON.parse(load(a.audioReview.source, a.audioReview.sourceSha256));
      for (const field of ['model', 'costUsd', 'costExact']) assert.equal(a.audioReview[field], review[field], 'film: audio review metadata differs');
      assert.equal(review.kind, 'model-assisted audio review', 'film: review method mislabeled');
      assert.equal(typeof review.text, 'string', 'film: missing audio review text');
      assert(load(a.audioReview.src, a.audioReview.sha256).equals(Buffer.from(review.text)), 'film: audio review text changed');
      assert(a.outputs.some(o => o.src === a.audioReview.src && o.kind === 'text'), 'film: audio review is hidden');
      derived.set(a.audioReview.src, review.text);
    }
    sameSet(a.outputs.filter(o => !derived.has(o.src)).map(o => basename(o.src)), CAPTURED_OUTPUTS[slug], slug + ': missing intermediate or final captured output');
    const texts = new Map();
    for (const output of a.outputs) {
      assert(['image', 'video', 'audio', 'text'].includes(output.kind), slug + ': invalid output kind');
      assert(output.label?.trim(), slug + ': output needs a visible label');
      const bytes = derived.has(output.src) ? load(output.src, output.sha256) : fromRun(output.src, output.sha256, output.kind);
      if (derived.has(output.src)) assert(bytes.equals(Buffer.from(derived.get(output.src))), slug + ': derived text changed beyond its exact split/extraction');
      if (output.kind === 'text') texts.set(output.src, bytes.toString('utf8'));
    }
    load(a.preview, a.previewSha256);
    assert(a.outputs.some(o => o.src === a.previewSource && ['image', 'video'].includes(o.kind)), slug + ': thumbnail source is not retained media');
    checkRendered(gallery, slug, a, graphBytes, texts, false);
    checkRendered(guides.get(slug), slug, a, graphBytes, texts, true);
  }
  return variants.length;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(`✓ ${checkAlternates()} alternate examples: captured media, exact input overrides, disclosed reviews and matching share links`);
}
