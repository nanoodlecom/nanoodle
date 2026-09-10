#!/usr/bin/env node
// Audit the homepage starter and gallery: every model node, capability and explicit setting.
// No generation calls or credentials. Catalog outages are INCONCLUSIVE (exit 2), never OK.
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINTS = {
  chat: '/api/v1/models?detailed=true', image: '/api/v1/image-models',
  video: '/api/v1/video-models', audio: '/api/v1/audio-models',
};

// Compile candidate array endings before evaluating: nested objects, strings containing
// brackets, quoted property names and arbitrary property ordering remain real JavaScript.
// Only the trusted, committed gallery literal is evaluated, with no app/browser context.
export function parseExamples(src) {
  const head = /\bconst\s+EXAMPLES\s*=\s*\[/.exec(src);
  if (!head) throw new Error('EXAMPLES not found');
  const start = head.index + head[0].length - 1;
  const tail = src.slice(start);
  for (const end of tail.matchAll(/\]\s*;/g)) {
    let script;
    try { script = new Script(`(${tail.slice(0, end.index + 1)})`); }
    catch { continue; }
    const examples = script.runInNewContext(Object.create(null), { timeout: 1000 });
    if (!Array.isArray(examples)) throw new Error('EXAMPLES must be an array');
    return examples;
  }
  throw new Error('Could not parse the complete EXAMPLES literal');
}

export function nodeKinds(src) {
  const begin = src.indexOf('const NODE_TYPES = {');
  const end = src.indexOf('\n};', begin);
  if (begin < 0 || end < 0) throw new Error('NODE_TYPES not found');
  const body = src.slice(begin, end);
  const heads = [...body.matchAll(/^ {2}(\w+):\s*\{/gm)];
  const out = {};
  for (let i = 0; i < heads.length; i++) {
    const entry = body.slice(heads[i].index, heads[i + 1]?.index ?? body.length);
    const kind = /modelKind\s*:\s*"(\w+)"/.exec(entry)?.[1];
    out[heads[i][1]] = { kind, filter: /modelFilter\s*:\s*"(\w+)"/.exec(entry)?.[1] };
  }
  if (!Object.keys(out).length) throw new Error('No model node types parsed');
  return out;
}

export function pinnedModels(examples, kinds) {
  return examples.flatMap(example => {
    if (!Array.isArray(example.graph?.nodes)) throw new Error(`${example.slug}: missing graph nodes`);
    return example.graph.nodes.flatMap(node => {
      const spec = kinds[node.type];
      if (!spec) throw new Error(`${example.slug}: unknown node type ${node.type}`);
      if (!spec.kind) return [];
      return [{ slug: example.slug, node: node.id, type: node.type, ...spec,
        fields: node.fields || {}, id: node.fields?.model }];
    });
  });
}

export function starterModels(graph, kinds) {
  return pinnedModels([{ slug: 'homepage starter (noodle-graph.json)', graph }], kinds);
}

export function galleryRegressions(pins) {
  const expected = [
    { slug: 'fibo-studio-still', type: 'image', model: 'bria/fibo-generate-1.5/text-to-image', size: '1mp' },
    { slug: 'cinematic-character-still', type: 'image', model: 'minimax-h3/text-to-image', size: '1k' },
    { slug: 'omni-flash-turntable', type: 'tvideo', model: 'google/gemini-omni-flash/v1.1' },
    { slug: 'fable-five-step', type: 'llm', model: 'anthropic/claude-fable-5.1' },
    { slug: 'product-cutout', type: 'edit', model: 'birefnet/v2' },
    { slug: 'infinitetalk-radio-take', type: 'lipsync', model: 'infinitetalk', resolution: '480p', people: 'single' },
    { slug: 'sam3-isolate', type: 'edit', model: 'sam3-image' },
    { slug: 'p-image-upscale', type: 'edit', model: 'pruna-ai/p-image/upscale', size: '2' },
    { slug: 'deslop', type: 'llm', model: 'venice-uncensored' },
    { slug: 'h3-max-multi-angle', type: 'ivideo', model: 'minimax/h3-max/multi-angle/image-to-video', resolution: '480p', duration: '5', camera_motion: 'orbit-right' },
    { slug: 'character-sprites', type: 'llm', model: 'z-ai/glm-5.3-flash' },
    { slug: 'character-sprites', type: 'image', model: 'meta/muse-image/text-to-image', size: '1:1' },
    { slug: 'character-sprites', type: 'edit', model: 'meta/muse-image/edit', size: '1:1' },
    { slug: 'transparent-brand-sticker', type: 'image', model: 'ideogram-v3-generate-transparent', size: '1:1' },
    { slug: 'remove-packaging-text', type: 'edit', model: 'ideogram-v3-remove-text', size: 'auto' },
    { slug: 'h3-identity-restyle', type: 'edit', model: 'minimax-h3/image-edit', size: '1k' },
    { slug: 'ideogram-v4-instant-poster', type: 'image', model: 'ideogram/v4/instant', size: '1024x1024' },
    { slug: 'volt-vector-mark', type: 'image', model: 'recraft-ai/recraft-v4.1/text-to-vector', size: '1024x1024' },
    { slug: 'mai-pack-type', type: 'image', model: 'microsoft/mai-image-2.6-flash', size: '1152x864' },
    { slug: 'crystal-video-upscale', type: 'vedit', model: 'clarity-ai/crystal-video-upscaler', target_megapixels: 1 },
    { slug: 'night-ride-sfx', type: 'music', model: 'elevenlabs/sound-effects/v2', duration: '4' },
    { slug: 'night-ride-radio-vo', type: 'tts', model: 'xai-tts', voice: 'Leo' },
    { slug: 'volt-dispatch-infographic', type: 'image', model: 'sensenova-u1-infographic', size: '16:9' },
    { slug: 'grok-imagine-still', type: 'ivideo', model: 'xai/grok-imagine-video/v1.5/image-to-video', resolution: '480p', duration: '4' },
    { slug: 'p-video-rewrite', type: 'vedit', model: 'pruna-ai/p-video/edit', draft: true },
  ];
  return expected.flatMap(({ slug, type, model, size, resolution, people, duration, camera_motion, target_megapixels, draft, voice }) => {
    const pin = pins.find(p => p.slug === slug && p.type === type);
    if (!pin) return [{ slug, type, reason: 'required gallery card missing' }];
    if (pin.id !== model) return [{ ...pin, reason: `gallery regression: expected model ${model}` }];
    if (size && pin.fields.size !== size) return [{ ...pin, reason: `gallery regression: expected size ${size}` }];
    if (resolution && pin.fields.resolution !== resolution) return [{ ...pin, reason: `gallery regression: expected resolution ${resolution}` }];
    if (duration && String(pin.fields.duration) !== String(duration)) return [{ ...pin, reason: `gallery regression: expected duration ${duration}` }];
    if (people && pin.fields.modelOpts?.people !== people) return [{ ...pin, reason: `gallery regression: expected people ${people}` }];
    if (camera_motion && pin.fields.modelOpts?.camera_motion !== camera_motion) return [{ ...pin, reason: `gallery regression: expected camera_motion ${camera_motion}` }];
    if (target_megapixels != null && pin.fields.modelOpts?.target_megapixels !== target_megapixels) return [{ ...pin, reason: `gallery regression: expected target_megapixels ${target_megapixels}` }];
    if (draft === true && pin.fields.modelOpts?.draft !== true) return [{ ...pin, reason: `gallery regression: expected draft true` }];
    if (voice && pin.fields.voice !== voice) return [{ ...pin, reason: `gallery regression: expected voice ${voice}` }];
    return [];
  });
}

export function appRules(src) {
  const dead = /const dead = \/\^\(([^)]*)\)\$\/i\.test\(m\.id\)/.exec(src);
  if (!dead) throw new Error('Known-dead audio rule not found');
  const set = name => {
    const match = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(src);
    if (!match) throw new Error(`${name} not found`);
    return new Set(new Script(`[${match[1]}]`).runInNewContext({}, { timeout: 1000 }));
  };
  return { dead: new RegExp(`^(${dead[1]})$`, 'i'), needsSource: set('NEEDS_SRC_IDS'), inpaint: set('INPAINT_OK') };
}

export function auditPins(pins, catalogs, rules = {}) {
  const issues = [];
  for (const pin of pins) {
    const fail = reason => issues.push({ ...pin, reason });
    if (typeof pin.id !== 'string' || !pin.id.trim()) { fail('missing pinned model ID'); continue; }
    const model = catalogs[pin.kind]?.find(m => m.id === pin.id);
    if (!model) { fail(`gone from the ${pin.kind} catalog`); continue; }
    if (pin.kind === 'audio' && rules.dead?.test(pin.id)) fail('on the app known-dead list');
    const c = model.capabilities || {}, sp = model.supported_parameters || {};
    const pp = sp.parameters || sp, mod = model.architecture?.modality || '';
    const needsSrc = rules.needsSource?.has(pin.id) || /upscal|inpaint|image-to-image|img2img/i.test(pin.id);
    const mask = /inpaint/i.test(pin.id), input = mod.split('->')[0].split('+');
    const tts = !!c.text_to_speech || model.category === 'audio_tts';
    const options = param => param?.options?.map(o => o.value).filter(v => v != null);
    const peopleOpts = options(pp.people);
    const canSingle = peopleOpts?.includes('single');
    const capabilities = pin.kind === 'image' ? {
      gen: !needsSrc && (mod ? mod.startsWith('text') : !c.image_to_image),
      edit: !mask && (needsSrc || !!c.image_to_image),
      inpaint: mask || rules.inpaint?.has(pin.id),
    } : pin.kind === 'video' ? {
      t2v: c.text_to_video && !(input.includes('video') && !input.includes('image')),
      i2v: c.image_to_video, v2v: c.video_to_video,
      avatar: c.image_to_video && c.audio_input && !(('left_audio' in pp || 'right_audio' in pp) && !canSingle),
    } : pin.kind === 'audio' ? {
      tts, music: !tts && mod.startsWith('text') && /audio|music/.test(mod.split('->')[1] || '') && !/lyric|describe|recognize|stem|clone|upload|cover|extend|inpaint/i.test(pin.id),
      stt: (c.speech_to_text || model.category === 'audio_stt') && !/clone/i.test(pin.id),
      remix: c.music_cover || c.audio_to_music || c.music_extension || c.audio_extension || c.audio_inpainting,
    } : {};
    if (pin.filter && pin.filter in capabilities && !capabilities[pin.filter]) fail(`does not support ${pin.type} (${pin.filter})`);
    const fields = pin.fields;
    const check = (field, listed) => {
      const value = fields[field];
      if (value == null || value === '' || !listed?.length) return;
      if (!listed.some(option => String(option) === String(value))) fail(`unsupported ${field}=${JSON.stringify(value)}; supported: ${listed.join(', ')}`);
    };
    if (pin.kind === 'image') check('size', sp.resolutions);
    if (pin.kind === 'video') {
      check('resolution', options(pp.resolution));
      check('duration', options(pp.duration || pp.seconds));
      check('aspect', options(pp.aspect_ratio || pp.orientation || pp.resolution_ratio));
      const people = fields.modelOpts?.people;
      if (people != null && people !== '' && peopleOpts?.length && !peopleOpts.some(option => String(option) === String(people))) {
        fail(`unsupported people=${JSON.stringify(people)}; supported: ${peopleOpts.join(', ')}`);
      }
    }
    if (pin.kind === 'audio') {
      check('voice', sp.voices);
      const duration = fields.duration;
      if (duration != null && duration !== '' && duration !== 'auto' && duration !== 'default') {
        if (!Number.isFinite(Number(duration)) || (sp.min_duration != null && Number(duration) < sp.min_duration) || (sp.max_duration != null && Number(duration) > sp.max_duration)) fail(`unsupported duration=${JSON.stringify(duration)} (range ${sp.min_duration ?? '?'}–${sp.max_duration ?? '?'})`);
      }
    }
  }
  return issues;
}

export async function main() {
  const src = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const kinds = nodeKinds(src);
  const examples = parseExamples(src);
  const galleryPins = pinnedModels(examples, kinds);
  if (!galleryPins.length) throw new Error('Parsed 0 gallery model nodes; refusing to report success');
  const starterPins = starterModels(JSON.parse(readFileSync(join(ROOT, 'noodle-graph.json'), 'utf8')), kinds);
  if (!starterPins.length) throw new Error('Homepage starter has no model pins; refusing to report success');
  const pins = [...starterPins, ...galleryPins];
  const catalogs = {};
  for (const kind of new Set(pins.map(p => p.kind))) {
    try {
      if (!ENDPOINTS[kind]) throw new Error(`Unknown catalog kind: ${kind}`);
      const response = await fetch(`https://nano-gpt.com${ENDPOINTS[kind]}`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()).data;
      if (!Array.isArray(data) || !data.some(m => m?.id)) throw new Error('catalog contains no usable models');
      catalogs[kind] = data;
    } catch (error) {
      console.error(`check-example-models: INCONCLUSIVE — ${kind} catalog: ${error.message}`);
      return 2;
    }
  }
  const issues = [...galleryRegressions(galleryPins), ...auditPins(pins, catalogs, appRules(src))];
  for (const p of issues) console.error(`✗ ${p.slug}: ${p.type} node ${p.node} (${p.id || 'no model'}) — ${p.reason}`);
  console.log(`check-example-models: ${issues.length ? 'FAIL' : 'OK'} (${pins.length} model nodes, ${Object.keys(catalogs).length} catalogs, ${issues.length} issues; homepage starter ${starterPins.length} pins + ${examples.length} gallery cards)`);
  return issues.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(`check-example-models: ${error.message}`);
    process.exitCode = 1;
  });
}
