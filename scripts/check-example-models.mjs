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
  model3d: '/api/v1/3d-models',
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
    const nodeIds = new Set(example.graph.nodes.map(node => String(node.id)));
    return example.graph.nodes.flatMap(node => {
      const spec = kinds[node.type];
      if (!spec) throw new Error(`${example.slug}: unknown node type ${node.type}`);
      if (!spec.kind) return [];
      // An LLM's media requirements come from incoming wires, not its type. A
      // catalog-listed text model can otherwise pass the audit and ignore paid
      // upstream media (audio) or fail when sent an image. Match runtime ports.
      const requiredCapabilities = new Set(node.type === 'vision' ? ['vision'] : []);
      if (node.type === 'llm') {
        for (const link of example.graph.links || []) {
          if (String(link?.to?.node) !== String(node.id) || !nodeIds.has(String(link?.from?.node))) continue;
          if (/^img\d+$/.test(link.to.port)) requiredCapabilities.add('vision');
          if (link.to.port === 'audio') requiredCapabilities.add('audio_input');
        }
      }
      return [{ slug: example.slug, node: node.id, type: node.type, ...spec,
        fields: node.fields || {}, id: node.fields?.model,
        requiredCapabilities: [...requiredCapabilities] }];
    });
  });
}

export function starterModels(graph, kinds) {
  return pinnedModels([{ slug: 'homepage starter (noodle-graph.json)', graph }], kinds);
}

// Preserve the reviewed pipeline settings when model catalogs or defaults change.
export function galleryRegressions(pins) {
  const expected = [
    { slug: 'character-sprites', type: 'llm', model: 'z-ai/glm-5.3-flash' },
    { slug: 'character-sprites', type: 'image', model: 'meta/muse-image/text-to-image', size: '1:1' },
    { slug: 'character-sprites', type: 'edit', model: 'meta/muse-image/edit', size: '1:1' },
    { slug: 'photo-to-video', type: 'ivideo', model: 'minimax-h3-singularity/image-to-video', resolution: '480p', duration: '5' },
    { slug: 'sing', type: 'music', model: 'minimax/music-3', instrumental: false },
    { slug: 'talking-avatar', type: 'tts', model: 'Minimax-Speech-2.8-HD', voice: 'Deep_Voice_Man' },
    { slug: 'talking-avatar', type: 'lipsync', model: 'longcat-avatar-1.5', resolution: '480p' },
  ];
  return expected.flatMap(({ slug, type, model, ...fields }) => {
    const pin = pins.find(p => p.slug === slug && p.type === type);
    if (!pin) return [{ slug, type, reason: 'required gallery pipeline node missing' }];
    if (pin.id !== model) return [{ ...pin, reason: `gallery regression: expected model ${model}` }];
    for (const [key, value] of Object.entries(fields)) {
      if (String(pin.fields[key]) !== String(value)) {
        return [{ ...pin, reason: `gallery regression: expected ${key} ${value}` }];
      }
    }
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

// These GPT Image models document custom pixel sizes; resolutions is a preset
// list, not an exhaustive enum. For GIFs the pixels belong to a padded sheet,
// not just frame_count * width * height. Read layouts/bounds from the catalog:
// https://api.nano-gpt.com/api/v1/images/models/gpt-image-2.6-flare/endpoints
// Custom dimensions must be multiples of 16 (OpenAI image-generation guide).
// undefined leaves the existing size audit in charge; null means a valid sheet.
function customGifSizeIssue(id, fields, sp) {
  const opts = fields.modelOpts || {}, size = /^(\d+)x(\d+)$/.exec(fields.size || '');
  if (!/^gpt-image-2\.6-(flare|sunburst)$/.test(id) || !size || opts.output_format !== 'gif') return;
  const gif = sp.gif, sheet = gif?.frame_sheet, range = gif?.frame_count;
  if (!Array.isArray(sp.output_format) || !sp.output_format.includes('gif') || !sheet?.layouts || sheet.per_output !== true
      || !['max_edge', 'min_pixels', 'max_pixels', 'max_aspect_ratio'].every(key => Number.isFinite(sheet[key]) && sheet[key] > 0)
      || !Number.isSafeInteger(range?.min) || !Number.isSafeInteger(range?.max)
      || range.min < 1 || range.max < range.min) {
    return 'cannot validate custom GIF dimensions: incomplete catalog frame-sheet constraints';
  }
  const frameValue = opts.frame_count ?? range.default, frames = Number(frameValue);
  if (!['number', 'string'].includes(typeof frameValue) || !Number.isSafeInteger(frames) || frames < range.min || frames > range.max) {
    return `unsupported GIF frame_count=${JSON.stringify(opts.frame_count)}; supported: ${range.min}–${range.max}`;
  }
  const width = Number(size[1]), height = Number(size[2]);
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n % 16 === 0)) {
    return 'unsupported custom GIF dimensions: width and height must be positive multiples of 16';
  }
  const layouts = Object.entries(sheet.layouts).flatMap(([key, values]) => {
    const span = /^(\d+)(?:-(\d+))?$/.exec(key);
    return span && frames >= Number(span[1]) && frames <= Number(span[2] ?? span[1]) && Array.isArray(values) ? values : [];
  });
  const candidates = layouts.flatMap(layout => {
    const grid = /^(\d+)x(\d+)$/.exec(layout);
    if (!grid) return [];
    const cols = Number(grid[1]), rows = Number(grid[2]);
    if (![cols, rows].every(n => Number.isSafeInteger(n) && n > 0) || cols * rows < frames) return [];
    const w = cols * width, h = rows * height, pixels = w * h;
    return [{ w, h, pixels }];
  });
  if (!candidates.length) return `cannot validate custom GIF dimensions: no catalog layout for ${frames} frames`;
  if (candidates.some(({ w, h, pixels }) => Number.isSafeInteger(pixels)
      && Math.max(w, h) <= sheet.max_edge && pixels >= sheet.min_pixels && pixels <= sheet.max_pixels
      && Math.max(w / h, h / w) <= sheet.max_aspect_ratio)) return null;
  return `unsupported GIF frame sheet for ${frames} frames at ${fields.size}: `
    + candidates.map(({ w, h, pixels }) => `${w}x${h} (${pixels} pixels)`).join(' or ')
    + `; limits: edge <= ${sheet.max_edge}, pixels ${sheet.min_pixels}–${sheet.max_pixels}, aspect <= ${sheet.max_aspect_ratio}:1`;
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
      avatar: (()=>{
        const multiAudio = (('left_audio' in pp || 'right_audio' in pp) && !canSingle);
        const refAudio = ('reference_audios' in pp || 'reference_audio' in pp || 'reference_audio_urls' in pp);
        const tags = (model.tags || []).map(t => String(t).toLowerCase());
        const avatarTagged = tags.some(t => t === 'avatar' || t === 'lip-sync' || t === 'talking-avatar')
          || /avatars?/i.test(model.category || '');
        const audioOnlyIn = input.length === 1 && input[0] === 'audio';
        return !!c.audio_input && !multiAudio && !refAudio && !input.includes('video')
          && (!!c.image_to_video || (audioOnlyIn && avatarTagged));
      })(),
    } : pin.kind === 'audio' ? {
      tts, music: !tts && mod.startsWith('text') && /audio|music/.test(mod.split('->')[1] || '') && !/lyric|describe|recognize|stem|clone|upload|cover|extend|inpaint/i.test(pin.id),
      stt: (c.speech_to_text || model.category === 'audio_stt') && !/clone/i.test(pin.id),
      remix: c.music_cover || c.audio_to_music || c.music_extension || c.audio_extension || c.audio_inpainting,
    } : pin.kind === 'chat' ? { vision: !!c.vision, audio_input: !!c.audio_input } : {};
    for (const required of new Set([pin.filter, ...(pin.requiredCapabilities || [])])) {
      if (required && required in capabilities && !capabilities[required]) fail(`does not support ${pin.type} (${required})`);
    }
    const fields = pin.fields;
    const check = (field, listed) => {
      const value = fields[field];
      if (value == null || value === '' || !listed?.length) return;
      if (!listed.some(option => String(option) === String(value))) fail(`unsupported ${field}=${JSON.stringify(value)}; supported: ${listed.join(', ')}`);
    };
    if (pin.kind === 'image') {
      const issue = customGifSizeIssue(pin.id, fields, sp);
      if (issue === undefined) check('size', sp.resolutions);
      else if (issue) fail(issue);
    }
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
