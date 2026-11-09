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
// Current public GIF endpoint metadata (2026-11-09). The committed seven-frame
// 1024-square gallery requests exceed these bounds. The current-contract fixture
// below asserts both failures while preserving the committed graphs.
const gifImage = id => ({ ...image(id, ['1k', '2k', '4k'], true), supported_parameters: {
  resolutions: ['1k', '2k', '4k'], output_format: ['png', 'jpeg', 'webp', 'gif'],
  gif: { frame_count: { min: 2, max: 16, default: 9 }, frame_sheet: {
    layouts: { '2-8': ['4x2', '2x4'], '9': ['3x3'], '10-12': ['4x3', '3x4', '4x4'], '13-16': ['4x4'] },
    max_edge: 3840, min_pixels: 655360, max_pixels: 8294400, max_aspect_ratio: 3, per_output: true,
  } },
} });
const catalogs = {
  chat: [...new Set([...pins.filter(p => p.kind === 'chat').map(p => p.id), 'fixture-other-chat'])].map(id => ({ id,
    ...(['google/gemini-3.8-flash', 'elorian/glimpse'].includes(id) ? { capabilities: { vision: true } } : {}) })),
  image: [
    image('meta/muse-image/edit', ['auto', '1:1', '3:2', '16:9', '9:16'], true),
    image('meta/muse-image/text-to-image', ['1:1', '3:2', '3:4', '16:9', '9:16']),
    image('nano-banana-edit', ['auto'], true),
    image('openai/gpt-image-2.5/flare/text-to-image', ['1k', '2k', '4k']),
    image('xai/grok-imagine-image/v2.0/text-to-image', ['1:1', '16:9']),
    image('recraft-v4', ['1024x1024']),
    image('anima/text-to-image', ['1k', '2k']),
    image('black-forest-labs/flux-3/text-to-image', ['1k', '2k', '4k'], true),
    image('blackforestlabs/flux-3/klein/edit-image', ['768x768', '1024x1024', '1536x1536', '2048x2048', '4096x4096'], true),
    image('blackforestlabs/flux-3/klein/text-to-image', ['768x768', '1024x1024', '1536x1536', '2048x2048', '4096x4096']),
    image('qwen-image-2.1/edit', ['1k', '1.5k', '2k', 'auto'], true),
    image('bria/remove-background-guided', ['auto'], true),
    image('bytedance/seedream-v5.0-flash', ['2k', '1.5k', '1k'], true),
    image('ideogram/v4.5', ['1024x1024', '2048x2048']),
    image('recraft-ai/recraft-v4.1-flash/text-to-image', ['1024x1024', '1024x768']),
    image('moss-image', ['1024x1024', '512x512', '1536x1024', '1024x1536', '1920x1072', '2048x2048']),
    image('bytedance/seedream-v5.0-flash/edit', ['2k','1.5k','1k'], true),
    gifImage('gpt-image-2.6-flare'),
    gifImage('gpt-image-2.6-sunburst'),
    image('ideogram/vector', ['auto','1:1','1:4','1:3','1:2','9:16','10:16','2:3','3:4','4:5','5:4','4:3','3:2','16:10','16:9','2:1','3:1','4:1'], true),
  ],
  video: [
    { id: 'grok-imagine-video-1.5-lite', capabilities: { text_to_video: true, image_to_video: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '720p', '1080p']), duration: opts(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15']), aspect_ratio: opts(['16:9','4:3','3:2','1:1','2:3','3:4','9:16']) } } },
    { id: 'heygen/heygen-video-1', capabilities: { text_to_video: true, image_to_video: true, video_to_video: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '768p']), duration: opts(['5','6','7','8','9','10']), aspect_ratio: opts(['auto','21:9','16:9','4:3','1:1','3:4','9:16','9:21']) } } },
    { id: 'minimax-h3', capabilities: { text_to_video: true, image_to_video: true, video_to_video: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '540p', '768p', '1080p']), duration: opts(['3','4','5','6','7','8','9','10','11','12','13','14','15']), aspect_ratio: opts(['auto','21:9','16:9','4:3','1:1','3:4','9:16','9:21']) } } },
    { id: 'bytedance-seedance-v1.5-pro', capabilities: { text_to_video: true, image_to_video: true, audio_generation: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '720p', '1080p']), duration: opts(['4','5','6','7','8','9','10','11','12']), aspect_ratio: opts(['16:9','9:16','1:1','3:4','4:3','21:9']),
        generateAudio: { type: 'switch', default: true } } } },
    { id: 'bytedance-seedance-v1-pro-fast', capabilities: { text_to_video: true, image_to_video: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '720p', '1080p']), duration: opts(['2','3','4','5','6','7','8','9','10','11','12']), aspect_ratio: opts(['16:9','9:16','1:1','3:4','4:3','21:9']) } } },
    { id: 'minimax-h3/reference-to-video', architecture: { modality: 'text+image+audio->video' }, capabilities: { text_to_video: true, image_to_video: true, audio_input: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '540p', '768p', '1080p']), duration: opts(['3','4','5','6','7','8','9','10','11','12','13','14','15']), aspect_ratio: opts(['16:9','9:16','1:1','4:3','3:4','21:9','9:21']),
        reference_images: { type: 'string' } } } },
    { id: 'minimax-h3-singularity/image-to-video', capabilities: { image_to_video: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '540p', '768p', '1080p']), duration: opts(['3','4','5','6','7','8','9','10','11','12','13','14','15']) } } },
    { id: 'minimax-h3/image-to-video-spicy', capabilities: { image_to_video: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '720p']), duration: opts([5, 10]) } } },
    { id: 'minimax/h3-max', capabilities: { image_to_video: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '768p', '1080p']), duration: opts([5, 10]) } } },
    { id: 'minimax/h3-max-turbo', capabilities: { text_to_video: true, image_to_video: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '768p', '1080p']), duration: opts(['5','6','7','8','9','10','11','12','13','14','15']),
        lastImageUrl: { type: 'string', format: 'uri' } } } },
    { id: 'minimax/h3-max/multi-angle/image-to-video', capabilities: { image_to_video: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '768p', '1080p']), duration: opts(['5','6','7','8','9','10','11','12','13','14','15']),
        camera_motion: opts(['orbit-right','orbit-left','push-in','pull-back','rise']) } } },
    { id: 'longcat-avatar-1.5', capabilities: { image_to_video: true, audio_input: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '720p']) } } },
    { id: 'wan-video-image-to-video', capabilities: { image_to_video: true },
      supported_parameters: { parameters: { resolution: opts(['480p', '720p']),
        num_frames: { type: 'number', default: 81 }, frames_per_second: { type: 'number', default: 16 } } } },
    { id: 'blackforestlabs/flux-3/edit-video', architecture: { modality: 'video->video' },
      capabilities: { video_to_video: true }, supported_parameters: { parameters: { safety_tolerance: { type: 'number', default: 2 } } } },
    { id: 'wan-22-animate', architecture: { modality: 'image+video->video', input_modalities: ['image', 'video'] },
      capabilities: { video_to_video: true, image_to_video: true }, supported_parameters: { parameters: { resolution: opts(['480p', '720p']), mode: opts(['animate', 'replace']) } } },
    { id: 'mirelo-ai/sfx1.6/video-to-video', architecture: { modality: 'text+video->video' },
      capabilities: { video_to_video: true }, supported_parameters: { parameters: { seed: { type: 'number', default: -1 } } } },
    { id: 'pruna-ai/p-video-2-pro/text-to-video', architecture: { modality: 'text+image+video+audio->video', input_modalities: ['text','image','video','audio'] }, capabilities: { text_to_video: true, image_to_video: true, video_to_video: true, audio_input: true, audio_generation: true, nsfw: true },
      supported_parameters: { parameters: { resolution: opts(['480p','768p']), duration: opts(['5','6','7','8','9','10','11','12','13','14','15']), aspect_ratio: opts(['auto','16:9','9:16','4:3','3:4','3:2','2:3','1:1']) } } },
    { id: 'kandinsky6-lite', architecture: { modality: 'text+image->video', input_modalities: ['text','image'] }, capabilities: { text_to_video: true, image_to_video: true, audio_generation: true },
      supported_parameters: { parameters: { resolution: opts(['480p']), duration: opts(['5']), aspect_ratio: opts(['auto','16:9','9:16','1:1','4:3','3:4']) } } },
    { id: 'minimax/h3-max-turbo/extend-video', architecture: { modality: 'text+video+audio->video', input_modalities: ['text','video','audio'] }, capabilities: { text_to_video: true, video_to_video: true, audio_input: true, audio_generation: true },
      supported_parameters: { parameters: { resolution: opts(['480p','768p','1080p','2k']), duration: opts(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15']), aspect_ratio: opts(['auto','21:9','16:9','4:3','1:1','3:4','9:16']) } } },
    { id: 'minimax/h3-lite', architecture: { modality: 'text+image+video+audio->video', input_modalities: ['text','image','video','audio'] }, capabilities: { text_to_video: true, image_to_video: true, video_to_video: true, audio_input: true, audio_generation: true },
      supported_parameters: { parameters: { resolution: opts(['480p','768p']), duration: opts(['4','5','6','7','8','9','10','11','12','13','14','15']), aspect_ratio: opts(['21:9','16:9','4:3','1:1','3:4','9:16']) } } },
    { id: 'music-video-generator', architecture: { modality: 'text+image+audio->video', input_modalities: ['text','image','audio'] }, capabilities: { text_to_video: true, image_to_video: true, audio_input: true },
      supported_parameters: { parameters: { resolution: opts(['480p','720p']), aspect_ratio: opts(['16:9','9:16']) } } },
  ],
  audio: [
    { id: 'Minimax-Speech-2.8-HD', capabilities: { text_to_speech: true }, supported_parameters: { voices: ['Deep_Voice_Man', 'Lively_Girl'] } },
    { id: 'gemini-3.1-flash-tts-preview', capabilities: { text_to_speech: true }, supported_parameters: { voices: ['Puck', 'Kore'] } },
    { id: 'gpt-4o-mini-tts', capabilities: { text_to_speech: true }, supported_parameters: { voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] } },
    { id: 'elevenlabs/eleven-v4-turbo', capabilities: { text_to_speech: true }, supported_parameters: { voices: ['Alicia', 'Aria', 'Roger', 'Sarah', 'Laura', 'Charlie', 'George', 'Callum', 'River', 'Liam', 'Charlotte', 'Alice', 'Matilda', 'Will', 'Jessica', 'Eric', 'Chris', 'Brian', 'Daniel', 'Lily', 'Bill'] } },
    { id: 'minimax/music-3', architecture: { modality: 'text->audio' } },
    { id: 'mureka-ai/mureka-v7.6/generate-bgm', architecture: { modality: 'text->music' }, capabilities: { text_to_music: true } },
    { id: 'Minimax-Music-2.6', architecture: { modality: 'text->music' }, capabilities: { text_to_music: true }, supported_parameters: { min_duration: 10, max_duration: 300 } },
    { id: 'elevenlabs/music', architecture: { modality: 'text->music' }, capabilities: { text_to_music: true }, supported_parameters: { min_duration: 5, max_duration: 300 } },
  ],
  model3d: [
    { id: 'tripo3d/v2.5', architecture: { input_modalities: ['image'] } },
    { id: 'wavespeed-ai/hunyuan-3d-v3.1-rapid', architecture: { input_modalities: ['text', 'image'] } },
    { id: 'wavespeed-ai/trellis-2/image-to-3d', architecture: { input_modalities: ['image'] },
      supported_parameters: { parameters: { resolution: opts(['512', '1024', '1536']), texture_size: opts(['1024', '2048', '4096']), target_face_count: { type: 'number', min: 10000, max: 1000000 } } } },
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
      const kind = /\\/3d-models/.test(String(url)) ? 'model3d' : (/\\/(image|video|audio)-models/.exec(url)?.[1] || 'chat');
      let data = catalogs[kind].filter(m => mode !== 'missing-starter' || m.id !== ${JSON.stringify(starterId)});
      // A synthetic wider-sheet fixture exercises the success path without
      // editing committed graphs. This is deliberately NOT the live contract.
      if (mode === 'synthetic-wide-sheet' && kind === 'image') {
        for (const m of data.filter(m => m.supported_parameters?.gif)) {
          m.supported_parameters.gif.frame_sheet.max_edge = 4096;
          m.supported_parameters.gif.frame_sheet.max_pixels = 8388608;
        }
      }
      if (mode === 'bad-size' && kind === 'image') data.find(m => m.id === 'meta/muse-image/text-to-image').supported_parameters.resolutions = ['2mp'];
      if (mode === 'bad-avatar' && kind === 'video') data.find(m => m.id === 'longcat-avatar-1.5').capabilities.audio_input = false;
      if (mode === 'bad-vision' && kind === 'chat') data.find(m => m.id === 'google/gemini-3.8-flash').capabilities.vision = false;
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

const current = run('live');
assert.equal(current.status, 1, current.output);
assert.equal((current.output.match(/unsupported GIF frame sheet/g) || []).length, 2, current.output);
assert.match(current.output, /2 issues;/, current.output);
console.log('✓ current GIF contract rejects both unchanged gallery sheets with their actual bounds');

const good = run('synthetic-wide-sheet');
assert.equal(good.status, 0, good.output);
assert.match(good.output, /homepage starter \d+ pins/, 'success must include the homepage audit');
console.log('✓ starter and gallery success path works with explicitly synthetic wider sheet limits');

for (const [mode, reason] of [
  ['missing-starter', /homepage starter \(noodle-graph\.json\).*gone from the chat catalog/],
  ['bad-size', /photo-to-video:.*unsupported size/],
  ['bad-avatar', /talking-avatar:.*does not support lipsync/],
  ['bad-vision', /storyboard-relay:.*does not support llm \(vision\)/],
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
