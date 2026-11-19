#!/usr/bin/env node
// Offline: supported rerun pins must not rewrite the evidence from original runs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseExamples } from './check-example-models.mjs';
const read = p => readFileSync(new URL('../'+p, import.meta.url), 'utf8');
const samples = JSON.parse(read('examples/gallery/samples.json'));
const examples = parseExamples(read('index.html'));
for (const slug of ['blockout-to-shot', 'same-shot-three-looks', 'product-photo-to-hero-ad']) {
  const sample = samples.find(s => s.slug === slug);
  const original = read(`examples/gallery/${slug}/graph.json`);
  assert.equal(createHash('sha256').update(original).digest('hex'), sample.graphSha256);
  assert.ok(JSON.parse(original).nodes.some(n => n.fields?.model === 'bytedance-seedance-v1.5-pro'));
  assert.ok(sample.models.includes('bytedance-seedance-v1.5-pro'));
  assert.match(sample.workflowNote, /replacement has not been sampled/);
  for (const graph of [JSON.parse(read('examples/gallery/'+sample.workflow)), examples.find(e => e.slug === slug).graph]) {
    const videos = graph.nodes.filter(n => n.type === 'ivideo');
    assert.equal(videos.length, 1);
    const f = videos[0].fields;
    assert.equal(f.model, 'seedance-lite-video');
    assert.equal(f.resolution, '720p');
    assert.equal(f.duration, '5');
    assert.equal(JSON.stringify(f.modelOpts), '{}');
  }
}
console.log('✓ Seedance gallery reruns: three supported pins/settings; historical provenance retained; replacement unsampled');
