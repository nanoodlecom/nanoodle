import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPins, nodeKinds, parseExamples, pinnedModels } from './check-example-models.mjs';

const kinds = { text: {}, image: { kind: 'image', filter: 'gen' }, edit: { kind: 'image', filter: 'edit' },
  ivideo: { kind: 'video', filter: 'i2v' }, tvideo: { kind: 'video', filter: 't2v' },
  vedit: { kind: 'video', filter: 'v2v' },
  lipsync: { kind: 'video', filter: 'avatar' }, tts: { kind: 'audio', filter: 'tts' } };
const pin = (type, fields) => ({ type, ...kinds[type], fields, id: fields.model });

test('complete literal parser includes JSON keys, name before fields and nested settings', () => {
  const examples = parseExamples(`const EXAMPLES = [
    {slug:'nested', graph:{nodes:[
      {"name":"a }; and ]; in a name", "type":"image", "id":"n1", "sizes":{"prompt":200}, "fields":{"advanced":{"seed":42},"model":"img"}},
      {type:'text', fields:{text:'model:fake'}},
      {fields:{model:'editor'}, type:'edit', id:'n3'},
      {type:'image', id:'missing', fields:{}}
    ]}}
  ];\nconst AFTER = 'not evaluated';`);
  const pins = pinnedModels(examples, kinds);
  assert.equal(pins.length, 3);
  assert.deepEqual(Array.from(pins, p => p.id), ['img', 'editor', undefined]);
  assert.equal(pins[0].fields.advanced.seed, 42);
  assert.match(auditPins([pins[2]], {})[0].reason, /missing pinned model/);
  assert.throws(() => pinnedModels([{graph:{nodes:[{type:'new-model-node'}]}}], kinds), /unknown node type/);
});

test('node kind extraction stops at NODE_TYPES end and includes local nodes', () => {
  const types = nodeKinds(`const NODE_TYPES = {
  image: { modelKind:"image", modelFilter:"gen" },
  text: { fields:{} },
};
const OTHER = {
  text: {modelKind:"chat"},
};`);
  assert.equal(types.image.kind, 'image');
  assert.equal(types.text.kind, undefined);
});

test('rejects incompatible image/edit capability and explicit unsupported size', () => {
  const catalogs = {image:[{id:'img', architecture:{modality:'text->image'}, supported_parameters:{resolutions:['1k','2k']}}]};
  assert.equal(auditPins([pin('image',{model:'img',size:'1k'})], catalogs).length, 0);
  assert.match(auditPins([pin('image',{model:'img',size:'1024x1024'})], catalogs)[0].reason, /unsupported size/);
  assert.match(auditPins([pin('edit',{model:'img'})], catalogs)[0].reason, /does not support edit/);
});

test('validates video parameter aliases, resolution, duration and input capability', () => {
  const catalogs = {video:[{id:'v', capabilities:{image_to_video:true}, supported_parameters:{parameters:{
    seconds:{options:[{value:'4'},{value:'8'}]}, orientation:{options:[{value:'portrait'}]},
    resolution:{options:[{value:'720p'}]},
  }}}]};
  assert.equal(auditPins([pin('ivideo',{model:'v',duration:4,aspect:'portrait',resolution:'720p'})],catalogs).length,0);
  const issues = auditPins([pin('tvideo',{model:'v',duration:5,aspect:'16:9',resolution:'480p'})],catalogs);
  assert.equal(issues.length,4);
  assert.ok(issues.some(p=>/unsupported duration/.test(p.reason)));
  assert.match(auditPins([pin('lipsync',{model:'v'})],catalogs)[0].reason,/does not support/);
  catalogs.video[0].capabilities.audio_input = true;
  assert.equal(auditPins([pin('lipsync',{model:'v'})],catalogs).length,0);
  catalogs.video[0].supported_parameters.parameters.left_audio = {};
  assert.match(auditPins([pin('lipsync',{model:'v'})],catalogs)[0].reason,/does not support/);
});

test('validates audio voices and bounds; permits unset fields and automatic duration', () => {
  const catalogs = {audio:[{id:'speech',capabilities:{text_to_speech:true},supported_parameters:{voices:['Eve'],min_duration:1,max_duration:60}}]};
  assert.equal(auditPins([pin('tts',{model:'speech',voice:'Eve',duration:'auto'})],catalogs).length,0);
  assert.equal(auditPins([pin('tts',{model:'speech'})],catalogs).length,0);
  assert.equal(auditPins([pin('tts',{model:'speech',voice:'wrong',duration:99})],catalogs).length,2);
  assert.match(auditPins([pin('tts',{model:'speech'})],catalogs,{dead:/^speech$/})[0].reason,/known-dead/);
  assert.match(auditPins([pin('tts',{model:'retired'})],catalogs)[0].reason,/gone from/);
});

test('catalog outage is inconclusive and exits nonzero instead of certifying examples', async () => {
  const { main } = await import('./check-example-models.mjs');
  const fetchBefore = globalThis.fetch, errorBefore = console.error;
  const messages = [];
  try {
    globalThis.fetch = async () => { throw new Error('fixture offline'); };
    console.error = message => messages.push(message);
    assert.equal(await main(), 2);
    assert.match(messages.join('\n'), /INCONCLUSIVE.*fixture offline/);
  } finally {
    globalThis.fetch = fetchBefore;
    console.error = errorBefore;
  }
});

test('homepage pins use the same strict model, type and capability checks as gallery pins', async () => {
  const { starterModels } = await import('./check-example-models.mjs');
  const pins = starterModels({ nodes: [
    { id: 'prompt', type: 'text', fields: { text: 'hello' } },
    { id: 'render', type: 'image', fields: { model: 'img', size: 'wrong' } },
    { id: 'missing', type: 'image', fields: {} },
  ] }, kinds);
  assert.equal(pins.length, 2);
  assert.equal(pins[0].slug, 'homepage starter (noodle-graph.json)');
  const problems = auditPins(pins, { image: [{ id: 'img', supported_parameters: { resolutions: ['1k'] } }] });
  assert.match(problems[0].reason, /unsupported size/);
  assert.match(problems[1].reason, /missing pinned model/);
  assert.throws(() => starterModels({}, kinds), /missing graph nodes/);
  assert.throws(() => starterModels({ nodes: [{ type: 'unknown' }] }, kinds), /unknown node type/);
});

test('preserves FIBO size/model, H3 cinematic still, Omni version, Fable, BiRefNet, InfiniteTalk, SAM 3, P-Image Upscale, deslop venice-uncensored, H3 Max Multi Angle, character-sprites, transparent-brand-sticker, remove-packaging-text, h3-identity-restyle, ideogram-v4-instant-poster, volt-vector-mark, mai-pack-type, Crystal video upscale, Night-ride SFX, Night-ride radio VO, SenseNova dispatch, Grok Imagine 1.5 still, Wan 3.0 still+audio, P-Video rewrite and Mirelo video foley pin regressions', async () => {
  const { galleryRegressions } = await import('./check-example-models.mjs');
  const pins = [
    { slug: 'fibo-studio-still', ...pin('image', { model: 'bria/fibo-generate-1.5/text-to-image', size: '1mp' }) },
    { slug: 'cinematic-character-still', ...pin('image', { model: 'minimax-h3/text-to-image', size: '1k' }) },
    { slug: 'omni-flash-turntable', ...pin('tvideo', { model: 'google/gemini-omni-flash/v1.1' }) },
    { slug: 'fable-five-step', ...pin('llm', { model: 'anthropic/claude-fable-5.1' }) },
    { slug: 'product-cutout', ...pin('edit', { model: 'birefnet/v2' }) },
    { slug: 'infinitetalk-radio-take', ...pin('lipsync', { model: 'infinitetalk', resolution: '480p', modelOpts: { people: 'single' } }) },
    { slug: 'sam3-isolate', ...pin('edit', { model: 'sam3-image' }) },
    { slug: 'p-image-upscale', ...pin('edit', { model: 'pruna-ai/p-image/upscale', size: '2' }) },
    { slug: 'deslop', ...pin('llm', { model: 'venice-uncensored' }) },
    { slug: 'h3-max-multi-angle', ...pin('ivideo', { model: 'minimax/h3-max/multi-angle/image-to-video', resolution: '480p', duration: '5', modelOpts: { camera_motion: 'orbit-right' } }) },
    { slug: 'character-sprites', ...pin('llm', { model: 'z-ai/glm-5.3-flash' }) },
    { slug: 'character-sprites', ...pin('image', { model: 'meta/muse-image/text-to-image', size: '1:1' }) },
    { slug: 'character-sprites', ...pin('edit', { model: 'meta/muse-image/edit', size: '1:1' }) },
    { slug: 'transparent-brand-sticker', ...pin('image', { model: 'ideogram-v3-generate-transparent', size: '1:1' }) },
    { slug: 'remove-packaging-text', ...pin('edit', { model: 'ideogram-v3-remove-text', size: 'auto' }) },
    { slug: 'h3-identity-restyle', ...pin('edit', { model: 'minimax-h3/image-edit', size: '1k' }) },
    { slug: 'ideogram-v4-instant-poster', ...pin('image', { model: 'ideogram/v4/instant', size: '1024x1024' }) },
    { slug: 'volt-vector-mark', ...pin('image', { model: 'recraft-ai/recraft-v4.1/text-to-vector', size: '1024x1024' }) },
    { slug: 'mai-pack-type', ...pin('image', { model: 'microsoft/mai-image-2.6-flash', size: '1152x864' }) },
    { slug: 'crystal-video-upscale', ...pin('vedit', { model: 'clarity-ai/crystal-video-upscaler', modelOpts: { target_megapixels: 1 } }) },
    { slug: 'night-ride-sfx', ...pin('music', { model: 'elevenlabs/sound-effects/v2', duration: '4' }) },
    { slug: 'night-ride-radio-vo', ...pin('tts', { model: 'xai-tts', voice: 'Leo' }) },
    { slug: 'volt-dispatch-infographic', ...pin('image', { model: 'sensenova-u1-infographic', size: '16:9' }) },
    { slug: 'grok-imagine-still', ...pin('ivideo', { model: 'xai/grok-imagine-video/v1.5/image-to-video', resolution: '480p', duration: '4' }) },
    { slug: 'wan-still-audio', ...pin('ivideo', { model: 'alibaba/wan-3.0/image-to-video', resolution: '480p', duration: 2, modelOpts: { enable_audio: true } }) },
    { slug: 'p-video-rewrite', ...pin('vedit', { model: 'pruna-ai/p-video/edit', modelOpts: { draft: true } }) },
    { slug: 'mirelo-video-foley', ...pin('vedit', { model: 'mirelo-ai/sfx1.6/video-to-video' }) },
  ];
  assert.equal(galleryRegressions(pins).length, 0);
  assert.equal(galleryRegressions([]).length, 27);
  pins[0].fields.size = 'auto';
  assert.match(galleryRegressions(pins)[0].reason, /expected size 1mp/);
  pins[0].fields.size = '1mp';
  pins[0].id = 'bria-fibo';
  pins[1].id = 'minimax-h3-image';
  pins[2].id = 'google/gemini-omni-flash/v1';
  pins[3].id = 'anthropic/claude-fable-5';
  pins[4].id = 'fal-ai/birefnet/v2';
  pins[5].id = 'wavespeed-ai/infinitetalk';
  pins[6].id = 'wavespeed-ai/sam3-image';
  pins[7].id = 'clarity-upscaler';
  pins[8].id = 'openai/gpt-4o-mini';
  pins[9].id = 'minimax-h3/image-to-video-spicy';
  pins[10].id = 'openai/gpt-4o-mini';
  pins[11].id = 'minimax-h3/text-to-image';
  pins[12].id = 'meta/muse-image/text-to-image';
  pins[13].id = 'meta/muse-image/text-to-image';
  pins[14].id = 'ideogram-v3-generate-transparent';
  pins[15].id = 'minimax-h3/text-to-image';
  pins[16].id = 'ideogram-v3-generate-transparent';
  pins[17].id = 'recraft-v4';
  pins[18].id = 'ideogram-v4-instant';
  pins[19].id = 'clarity-upscaler';
  pins[20].id = 'elevenlabs/music';
  pins[21].id = 'Minimax-Speech-2.8-HD';
  pins[22].id = 'ideogram-v4-instant';
  pins[23].id = 'minimax-h3/image-to-video-spicy';
  pins[24].id = 'minimax-h3/image-to-video-spicy';
  pins[25].id = 'clarity-ai/crystal-video-upscaler';
  pins[26].id = 'pruna-ai/p-video/edit';
  assert.equal(galleryRegressions(pins).length, 27);
  assert.ok(galleryRegressions(pins).every(p => /expected model/.test(p.reason)));
});
