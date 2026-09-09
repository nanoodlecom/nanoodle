#!/usr/bin/env node
// Exercise the real audit with capability fixtures; no network or generation calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { nodeKinds, parseExamples, pinnedModels, starterModels } from './check-example-models.mjs';

const audit = new URL('./check-example-models.mjs', import.meta.url).href;
const editor = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const starter = JSON.parse(readFileSync(new URL('../noodle-graph.json', import.meta.url), 'utf8'));
const kinds = nodeKinds(editor);
const pins = [...starterModels(starter, kinds), ...pinnedModels(parseExamples(editor), kinds)];
const starterId = starter.nodes.find(n => n.type === 'llm').fields.model;
const opts = values => ({ options: values.map(value => ({ value })) });
// These are representative provider capabilities, deliberately independent of graph settings.
// Chat IDs follow pins because catalog retirement is tested separately below.
const image = (id, resolutions, edit = false) => ({ id,
  architecture: { modality: edit ? 'text+image->image' : 'text->image' },
  capabilities: { image_to_image: edit }, supported_parameters: { resolutions } });
const catalogs = {
  chat: [...new Set(pins.filter(p => p.kind === 'chat').map(p => p.id))].map(id => ({ id })),
  image: [
    image('nano-banana-2-lite', ['1k', '2k']),
    image('meta/muse-image/edit', ['auto', '1:1', '3:2', '16:9'], true),
    image('meta/muse-image/text-to-image', ['1:1', '3:2', '16:9']),
    image('krea-v2/turbo', ['1k', '2k']),
    image('xai/grok-imagine-image/v2.0/text-to-image', ['1:1', '16:9']),
    image('recraft-v4', ['1024x1024']),
    image('qwen-image-3-pro', ['auto', '1k', '2k']),
    image('bria/fibo-generate-1.5/text-to-image', ['1mp']),
    image('minimax-h3/text-to-image', ['1k', '2k']),
    image('birefnet/v2', ['auto'], true),
  ],
  video: [
    { id: 'minimax-h3/image-to-video-spicy', capabilities: { image_to_video: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '720p']), duration: opts([5, 10]) } } },
    { id: 'google/gemini-omni-flash/v1.1', capabilities: { text_to_video: true },
      supported_parameters: { parameters: { resolution: opts(['360p', '720p']), duration: opts([5, 8]), aspect_ratio: opts(['16:9']) } } },
    { id: 'longcat-avatar-1.5', capabilities: { image_to_video: true, audio_input: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '720p']) } } },
  ],
  audio: [
    { id: 'Minimax-Speech-2.8-HD', capabilities: { text_to_speech: true }, supported_parameters: { voices: ['Deep_Voice_Man'] } },
    { id: 'mureka-ai/mureka-v9.5/generate-song', architecture: { modality: 'text->audio' } },
  ],
};

function run(mode) {
  const program = `
    const mode = ${JSON.stringify(mode)};
    const catalogs = ${JSON.stringify(catalogs)};
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://nano-gpt.com/api/v1/')) throw new Error('unexpected endpoint');
      if (!(options?.signal instanceof AbortSignal)) throw new Error('catalog fetch has no timeout signal');
      if (mode === 'unavailable') throw new Error('fixture catalog outage');
      if (mode === 'http-error') return { ok: false, status: 503 };
      const kind = /\\/(image|video|audio)-models/.exec(url)?.[1] || 'chat';
      let data = catalogs[kind].filter(m => mode !== 'missing-starter' || m.id !== ${JSON.stringify(starterId)});
      if (mode === 'bad-size' && kind === 'image') data.find(m => m.id === 'bria/fibo-generate-1.5/text-to-image').supported_parameters.resolutions = ['2mp'];
      if (mode === 'bad-avatar' && kind === 'video') data.find(m => m.id === 'longcat-avatar-1.5').capabilities.audio_input = false;
      if (mode === 'empty') data = [];
      if (mode === 'malformed') data = {};
      return { ok: true, json: async () => ({ data }) };
    };
    const { main } = await import(${JSON.stringify(audit)});
    process.exitCode = await main();
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

const good = run('live');
assert.equal(good.status, 0, good.output);
assert.match(good.output, /homepage starter \d+ pins/, 'success must include the homepage audit');
console.log('✓ starter and gallery audit succeeds with bounded capability catalog fixtures');

for (const [mode, reason] of [
  ['missing-starter', /homepage starter \(noodle-graph\.json\).*gone from the chat catalog/],
  ['bad-size', /fibo-studio-still:.*unsupported size/],
  ['bad-avatar', /talking-avatar:.*does not support lipsync/],
]) {
  const result = run(mode);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, reason);
  console.log(`✓ ${mode} fails with the affected workflow`);
}
for (const mode of ['unavailable', 'http-error', 'empty', 'malformed']) {
  const result = run(mode);
  assert.equal(result.status, 2, result.output);
  assert.doesNotMatch(result.output, /check-example-models: OK/);
  assert.match(result.output, /INCONCLUSIVE/);
  console.log(`✓ ${mode} catalog cannot certify a successful audit`);
}
console.log('check-example-models-offline: OK');
