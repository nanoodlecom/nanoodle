import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPins, nodeKinds, parseExamples, pinnedModels } from './check-example-models.mjs';

const kinds = { text: {}, upload: {}, aupload: {}, llm: { kind: 'chat' },
  vision: { kind: 'chat', filter: 'vision' },
  image: { kind: 'image', filter: 'gen' }, edit: { kind: 'image', filter: 'edit' },
  ivideo: { kind: 'video', filter: 'i2v' }, tvideo: { kind: 'video', filter: 't2v' },
  vedit: { kind: 'video', filter: 'v2v' },
  lipsync: { kind: 'video', filter: 'avatar' }, tts: { kind: 'audio', filter: 'tts' },
  transcribe: { kind: 'audio', filter: 'stt' }, remix: { kind: 'audio', filter: 'remix' } };
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

// Public endpoint metadata, checked 2026-11-09:
// https://api.nano-gpt.com/api/v1/images/models/gpt-image-2.6-flare/endpoints
// Sunburst advertises the same GIF contract. Sheets include unused layout cells.
const gifParams = () => ({
  resolutions: ['1k', '2k', '4k'], output_format: ['png', 'jpeg', 'webp', 'gif'],
  gif: { frame_count: { min: 2, max: 16, default: 9 }, frame_sheet: {
    layouts: { '2-8': ['4x2', '2x4'], '9': ['3x3'], '10-12': ['4x3', '3x4', '4x4'], '13-16': ['4x4'] },
    max_edge: 3840, min_pixels: 655360, max_pixels: 8294400,
    max_aspect_ratio: 3, per_output: true,
  } },
});
const gifIssues = (size, frames, params = gifParams(), model = 'gpt-image-2.6-flare', opts = {}) =>
  auditPins([pin('image', { model, size, modelOpts: { output_format: 'gif', frame_count: frames, ...opts } })],
    { image: [{ id: model, architecture: { modality: 'text->image' }, supported_parameters: params }] });

test('custom GIF sizes use advertised padded sheets, including historical 12-frame dimensions', () => {
  for (const model of ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst']) {
    assert.deepEqual(gifIssues('960x960', 7, gifParams(), model), []);
    assert.deepEqual(gifIssues('512x512', 12, gifParams(), model), []);
    assert.deepEqual(gifIssues('512x512', undefined, gifParams(), model), [], 'default 9 uses 3x3');
    assert.deepEqual(gifIssues('960x960', '7', gifParams(), model), [], 'serialized numeric frame count');
  }
});

test('seven 1024-square frames exceed both padded sheet bounds despite fitting the frame-area sum', () => {
  assert.ok(7 * 1024 ** 2 < 8294400);
  const issues = gifIssues('1024x1024', 7);
  assert.equal(issues.length, 1);
  assert.match(issues[0].reason, /GIF frame sheet/);
  assert.match(issues[0].reason, /4096x2048/);
  assert.match(issues[0].reason, /8388608/);
  assert.match(issues[0].reason, /3840/);
  assert.match(issues[0].reason, /8294400/);
});

test('GIF sheet audit checks edge, area, aspect, padding and all advertised orientations', () => {
  assert.match(gifIssues('1936x400', 7)[0].reason, /GIF frame sheet/, 'edge fails even when pixels fit');
  assert.match(gifIssues('1024x1024', 9)[0].reason, /GIF frame sheet/, '3x3 fits edge but exceeds area');
  assert.deepEqual(gifIssues('960x960', 9), [], '3x3 exactly at the maximum pixel count');
  assert.match(gifIssues('128x128', 7)[0].reason, /GIF frame sheet/, 'minimum sheet pixels');
  assert.match(gifIssues('960x128', 7)[0].reason, /GIF frame sheet/, 'sheet aspect ratio');
  assert.deepEqual(gifIssues('1280x480', 7), [], '2x4 succeeds when 4x2 exceeds max edge');
  assert.deepEqual(gifIssues('960x960', 8), [], 'unused eighth cell is already counted for seven');
  const bounds = gifParams();
  bounds.gif.frame_sheet.max_edge = 4096;
  assert.match(gifIssues('1024x1024', 7, bounds)[0].reason, /GIF frame sheet/, 'padded area alone rejects');
});

test('custom GIF exception requires known model, format and complete advertised bounds', () => {
  assert.match(gifIssues('960x960', 7, gifParams(), 'other-model')[0].reason, /unsupported size/);
  assert.match(gifIssues('960x960', 7, gifParams(), undefined, { output_format: 'png' })[0].reason, /unsupported size/);
  for (const field of ['max_edge', 'min_pixels', 'max_pixels', 'max_aspect_ratio', 'layouts', 'per_output']) {
    const params = gifParams();
    delete params.gif.frame_sheet[field];
    assert.equal(gifIssues('960x960', 7, params).length, 1, `missing ${field} cannot certify custom GIF`);
  }
  const params = gifParams();
  params.output_format = ['png'];
  assert.equal(gifIssues('960x960', 7, params).length, 1);
});

test('custom GIF dimensions and frame counts must be valid before checking layouts', () => {
  for (const frames of [0, 1, 17, 7.5, 'bad', Infinity, [7], { value: 7 }]) {
    assert.match(gifIssues('960x960', frames)[0].reason, /frame_count/, String(frames));
  }
  for (const size of ['0x960', '959x960']) {
    assert.match(gifIssues(size, 7)[0].reason, /dimensions/);
  }
  const params = gifParams();
  params.gif.frame_sheet.layouts = { '9': ['3x3'] };
  assert.match(gifIssues('960x960', 7, params)[0].reason, /layout/);
  assert.deepEqual(gifIssues('960x960', 7, gifParams(), undefined, { n: 4 }), [], 'sheet budget is per output');
  assert.deepEqual(gifIssues('1k', 7), [], 'existing preset validation stays intact');
  assert.match(gifIssues('wrong', 7)[0].reason, /unsupported size/);
});

test('vision nodes require catalog vision capability, including when the flag is absent', () => {
  const pins = pinnedModels([{ slug: 'image-question', graph: {
    nodes: [{ id: 'reader', type: 'vision', fields: { model: 'reader' } }], links: [],
  } }], kinds);
  for (const capabilities of [{ vision: false }, {}]) {
    const issues = auditPins(pins, { chat: [{ id: 'reader', capabilities }] });
    assert.equal(issues.length, 1);
    assert.match(issues[0].reason, /does not support vision \(vision\)/);
  }
  assert.deepEqual(auditPins(pins, { chat: [{ id: 'reader', capabilities: { vision: true } }] }), []);
});

test('LLM image requirements follow incoming imgN wires without rejecting plain text calls', () => {
  const pins = pinnedModels([{ slug: 'image-review', graph: {
    nodes: [
      { id: 'photo', type: 'upload', fields: {} },
      { id: 'brief', type: 'text', fields: { text: 'Describe the attached image.' } },
      { id: 'writer', type: 'llm', fields: { model: 'text' } },
      { id: 'judge', type: 'llm', fields: { model: 'reviewer' } },
    ],
    links: [
      { from: { node: 'brief', port: 'text' }, to: { node: 'writer', port: 'prompt' } },
      { from: { node: 'writer', port: 'text' }, to: { node: 'judge', port: 'prompt' } },
      { from: { node: 'photo', port: 'image' }, to: { node: 'judge', port: 'img1' } },
      { from: { node: 'photo', port: 'image' }, to: { node: 'judge', port: 'img3' } },
    ],
  } }], kinds);
  const catalogs = { chat: [{ id: 'text' }, { id: 'reviewer', capabilities: { vision: false } }] };
  const issues = auditPins(pins, catalogs);
  assert.equal(issues.length, 1, 'multiple images need one vision capability; the text writer needs none');
  assert.equal(issues[0].node, 'judge');
  assert.match(issues[0].reason, /does not support llm \(vision\)/);
  catalogs.chat[1].capabilities.vision = true;
  assert.deepEqual(auditPins(pins, catalogs), []);
});

test('LLM audio wires require audio_input independently of vision support', () => {
  const pins = pinnedModels([{ slug: 'audio-review', graph: {
    nodes: [
      { id: 'take', type: 'aupload', fields: {} },
      { id: 'photo', type: 'upload', fields: {} },
      { id: 'judge', type: 'llm', fields: { model: 'reviewer' } },
    ],
    links: [
      { from: { node: 'take', port: 'audio' }, to: { node: 'judge', port: 'audio' } },
      { from: { node: 'photo', port: 'image' }, to: { node: 'judge', port: 'img1' } },
    ],
  } }], kinds);
  const catalogs = { chat: [{ id: 'reviewer', capabilities: { vision: true } }] };
  const issues = auditPins(pins, catalogs);
  assert.equal(issues.length, 1);
  assert.match(issues[0].reason, /does not support llm \(audio_input\)/);
  catalogs.chat[0].capabilities.audio_input = true;
  assert.deepEqual(auditPins(pins, catalogs), []);
  catalogs.chat[0].capabilities.vision = false;
  assert.match(auditPins(pins, catalogs)[0].reason, /does not support llm \(vision\)/);
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

test('lipsync rejects reference-audio and source-video omni models', () => {
  const ref = { id: 'minimax-h3/reference-to-video', capabilities: { image_to_video: true, audio_input: true },
    architecture: { modality: 'text+image+audio->video' },
    supported_parameters: { parameters: { reference_audios: { type: 'text' } } } };
  assert.match(auditPins([pin('lipsync', { model: ref.id })], { video: [ref] })[0].reason, /does not support/);
  const omni = { id: 'alibaba/wan-3.0-prime', capabilities: { image_to_video: true, audio_input: true, text_to_video: true },
    architecture: { modality: 'text+image+video+audio->video' },
    supported_parameters: { parameters: { mode: { type: 'select' } } } };
  assert.match(auditPins([pin('lipsync', { model: omni.id })], { video: [omni] })[0].reason, /does not support/);
  const talk = { id: 'bytedance/seedance-2.5/talking-avatar', capabilities: { image_to_video: true, audio_input: true },
    architecture: { modality: 'image+audio->video' },
    supported_parameters: { parameters: { audio: { type: 'string' } } } };
  assert.equal(auditPins([pin('lipsync', { model: talk.id })], { video: [talk] }).length, 0);
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

test('reviewed pipelines retain source roles, sung lyrics and bounded video settings', async () => {
  const { galleryRegressions } = await import('./check-example-models.mjs');
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const pins = pinnedModels(parseExamples(src), nodeKinds(src));
  assert.deepEqual(galleryRegressions(pins), []);
  const edit = pins.find(p => p.slug === 'character-sprites' && p.type === 'edit');
  edit.id = 'meta/muse-image/text-to-image';
  const video = pins.find(p => p.slug === 'photo-to-video' && p.type === 'ivideo');
  video.fields.duration = '10';
  const music = pins.find(p => p.slug === 'sing' && p.type === 'music');
  music.fields.instrumental = true;
  const issues = galleryRegressions(pins);
  assert.equal(issues.length, 3);
  assert.match(issues.find(p => p.slug === 'character-sprites').reason, /expected model/);
  assert.match(issues.find(p => p.slug === 'photo-to-video').reason, /expected duration 5/);
  assert.match(issues.find(p => p.slug === 'sing').reason, /expected instrumental false/);
  assert.ok(galleryRegressions(pins.filter(p => p.type !== 'lipsync')).some(p => /node missing/.test(p.reason)));
});
