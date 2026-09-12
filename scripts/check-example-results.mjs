#!/usr/bin/env node
// Every featured workflow needs a useful pipeline and an inspectable saved result.
// Check provenance as well as links: changing a prompt must not relabel an old output.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { nodeKinds, parseExamples } from './check-example-models.mjs';
import { loadEngine, recordingFetch, catalog } from './play-engine.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const idx = readFileSync(join(ROOT, 'index.html'), 'utf8');
const examples = parseExamples(idx);
const kinds = nodeKinds(idx);
const samples = JSON.parse(readFileSync(join(ROOT, 'examples/gallery/samples.json'), 'utf8'));
const gallery = readFileSync(join(ROOT, 'examples/gallery/index.html'), 'utf8');
const bySlug = new Map(samples.map(s => [s.slug, s]));
assert.equal(bySlug.size, samples.length, 'duplicate saved sample');
const slugs = new Set(examples.map(e => e.slug));
assert.equal(slugs.size, examples.length, 'duplicate example card');
assert.deepEqual([...slugs].sort(), ['character-sprites', 'pocket-mystery', 'storyboard-relay', 'tiny-world-film', 'image-model-arena', 'photo-to-video', 'sing', 'talking-avatar'].sort(),
  'curated shelf changed: review the workflow and its saved evidence before featuring it');
assert.deepEqual([...bySlug.keys()].sort(), [...slugs].sort());
assert.deepEqual([...gallery.matchAll(/<section id="([^"]+)"/g)].map(m => m[1]).sort(), [...bySlug.keys()].sort());

const fn = idx.slice(idx.indexOf('function openExamples()'), idx.indexOf('function closeExamples()'));
const resultExpr = fn.match(/const result=([^;]+);/)?.[1];
const thumbExpr = fn.match(/const thumb=([^;]+);/)?.[1];
assert.ok(resultExpr && thumbExpr, 'example links and thumbnails must be inspectable');
const file = relative => {
  assert.match(relative, /^[\w/-]+\.[\w]+$/, `invalid sample path: ${relative}`);
  assert.ok(!relative.includes('..'), `sample path escapes site: ${relative}`);
  const path = join(ROOT, relative);
  assert.ok(existsSync(path), `missing asset: ${relative}`);
  return readFileSync(path);
};
const semanticGraph = graph => ({
  nodes: graph.nodes.filter(n => n.type !== 'comment').map(n => ({id:n.id, type:n.type, fields:n.fields})),
  links: graph.links,
});

for (const ex of examples) {
  const result = vm.runInNewContext(resultExpr, { ex, encodeURIComponent });
  file(vm.runInNewContext(thumbExpr, { ex }));
  const models = ex.graph.nodes.filter(n => kinds[n.type]?.kind);
  assert.ok(models.length >= 2, `${ex.slug}: a single model call belongs in the editor, not the workflow shelf`);
  const canReach = (from, target, seen = new Set()) => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return ex.graph.links.filter(l => l.from.node === from).some(l => canReach(l.to.node, target, seen));
  };
  const dependent = models.some(a => models.some(b => a !== b && canReach(a.id, b.id)));
  if (!dependent) {
    assert.equal(ex.slug, 'image-model-arena', 'independent calls need a meaningful comparison');
    assert.equal(models.length, 4);
    assert.equal(new Set(models.map(n => n.fields.model)).size, 4, 'arena must compare different models');
    const sources = models.map(n => ex.graph.links.find(l => l.to.node === n.id && l.to.port === 'prompt')?.from.node);
    assert.ok(sources.every(Boolean) && new Set(sources).size === 1, 'arena must compare the same brief');
  }
  const sample = bySlug.get(ex.slug);
  assert.ok(sample?.outputs?.length, `${ex.slug}: cover art is not a workflow result`);
  for (const output of sample.outputs) {
    const bytes = file('examples/gallery/' + output.src);
    if (output.sha256) {
      assert.equal(createHash('sha256').update(bytes).digest('hex'), output.sha256,
        `${ex.slug}: saved output changed without updating its provenance: ${output.src}`);
    }
  }
  for (const input of sample.inputs) if (input.src) file('examples/gallery/' + input.src);
  const original = file('examples/gallery/' + ex.slug + '/graph.json');
  const current = file('examples/gallery/' + sample.workflow);
  for (const [bytes, hash] of [[original, sample.graphSha256], [current, sample.workflowSha256]]) {
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, `${ex.slug}: graph hash drift`);
  }
  const originalGraph = JSON.parse(original), currentGraph = JSON.parse(current);
  for (const input of sample.inputs.filter(i => i.text)) {
    assert.ok(originalGraph.nodes.some(n => n.fields?.text === input.text), `${ex.slug}: displayed input does not match the sampled graph`);
  }
  assert.deepEqual(sample.models, [...new Set(originalGraph.nodes.map(n => n.fields?.model).filter(Boolean))], `${ex.slug}: sampled models mislabeled`);
  assert.equal(JSON.stringify(semanticGraph(ex.graph)), JSON.stringify(semanticGraph(currentGraph)), `${ex.slug}: gallery download differs from the editor workflow`);
  if (JSON.stringify(semanticGraph(originalGraph)) !== JSON.stringify(semanticGraph(currentGraph))) {
    assert.ok(sample.workflowNote, `${ex.slug}: changed workflow must explain how it differs from the saved run`);
  }
  if (ex.slug === 'character-sprites') {
    assert.equal(result, 'examples/iron-verdict/');
    file(result + 'index.html');
    file(result + 'game.js');
    continue;
  }
  assert.equal(result, 'examples/gallery/#' + ex.slug);
}

// Drive a featured EXAMPLES graph through play's real runGraph on both engines.
// Stubs stay offline: chat/image/audio/video never hit NanoGPT. Video submit+poll
// must complete so image→video and lipsync pipelines can finish. Seed the
// catalogs the send path actually reads — resolution is catalog-gated.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
catalog.chat.push({ id: 'z-ai/glm-5.3-flash' });
catalog.image.push(
  { id: 'meta/muse-image/text-to-image', supported_parameters: { resolutions: ['1:1', '16:9'] } },
  { id: 'meta/muse-image/edit', supported_parameters: { resolutions: ['1:1'], max_input_images: 1 } },
);
catalog.video.push(
  {
    id: 'minimax-h3/image-to-video-spicy',
    supported_parameters: { parameters: {
      resolution: { options: [{ value: '480p' }, { value: '720p' }] },
      duration: { options: [{ value: '5' }, { value: '6' }] },
    } },
  },
  {
    id: 'longcat-avatar-1.5',
    supported_parameters: { parameters: {
      resolution: { options: [{ value: '480p' }, { value: '720p' }] },
    } },
  },
);
catalog.audio.push(
  { id: 'Minimax-Speech-2.8-HD', supported_parameters: { voices: ['Deep_Voice_Man'] } },
  { id: 'minimax/music-3', supported_parameters: {} },
);
const chatPrompt = call => call.messages.filter(m => m.role === 'user').map(m => m.content).join('\n');

async function runFeaturedGraph(graph, { useLibrary, onFetch }) {
  const delegated = [];
  const errors = [];
  let sandbox;
  const engine = loadEngine(ctx => {
    sandbox = ctx;
    ctx.URLSearchParams = URLSearchParams;
    ctx.fetch = async (url, options = {}) => {
      const href = String(url);
      if (onFetch) {
        const hit = onFetch(href, options);
        if (hit) return hit;
      }
      if (/\/generate-video$/.test(href)) {
        return new Response(JSON.stringify({ runId: 'vid-1' }), { headers: { 'content-type': 'application/json' } });
      }
      if (/\/video\/status/.test(href)) {
        return new Response(JSON.stringify({
          status: 'COMPLETED',
          data: { status: 'COMPLETED', output: { video: { url: 'https://cdn.example/v.mp4' } } },
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (/\/images\/generations$/.test(href)) {
        return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { headers: { 'content-type': 'application/json' } });
      }
      return recordingFetch(url, options);
    };
    ctx.localStorage = ctx.sessionStorage = {
      getItem: key => key === 'ngpt_key' ? 'test-api-key' : key === 'njs_engine' ? (useLibrary ? '1' : '0') : null,
      setItem() {}, removeItem() {},
    };
  });
  if (useLibrary) {
    const window = {};
    new Function('window', readFileSync(join(ROOT, 'vendor/njs-engine.js'), 'utf8'))(window);
    const library = window.NanoodleEngine;
    sandbox.NanoodleEngine = { ...library, RUNNERS: Object.fromEntries(
      Object.entries(library.RUNNERS).map(([type, run]) => [type, (...args) => {
        delegated.push(type);
        return run(...args);
      }]),
    ) };
  }
  await engine.runGraph(engine.materialize(graph), {
    onStatus: (id, kind, message) => { if (kind === 'error') errors.push({ id, message }); },
  });
  return { delegated, errors };
}

function cloneExample(slug) {
  return JSON.parse(JSON.stringify(examples.find(e => e.slug === slug).graph));
}

// Exercise the actual Sing graph: the musical references must influence the
// writing, and both generated style branches must reach a supported music field.
// This catches the former flattening and a cosmetic negative_prompt connection.
const sing = cloneExample('sing');
const idea = 'A song about waiting for the last ferry.';
const bands = 'Björk, DJ Shadow';
sing.nodes.find(n => n.name === 'Song idea').fields.text = idea;
sing.nodes.find(n => n.name === 'Preferred bands').fields.text = bands;
const replies = [
  '[Verse]\nThe last ferry carries your name.\n[Chorus]\nWait for me.',
  'Slow swung breaks, dub bass and an intimate vocal; spare verses open into a wide chorus.',
  'four-on-the-floor drums, bright brass stabs, belted vocals',
];
for (const useLibrary of [false, true]) {
  const chat = [], music = [];
  const { delegated, errors } = await runFeaturedGraph(sing, {
    useLibrary,
    onFetch(url, options) {
      if (/\/chat\/completions$/.test(url)) {
        const body = JSON.parse(options.body);
        chat.push(body);
        assert.ok(chat.length <= replies.length, 'Sing has an unexpected text call');
        return new Response(JSON.stringify({ choices: [{ message: { content: replies[chat.length - 1] } }] }),
          { headers: { 'content-type': 'application/json' } });
      }
      if (/\/audio\/speech$/.test(url)) {
        music.push(JSON.parse(options.body));
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
      }
    },
  });
  assert.deepEqual(errors, [], 'Sing failed before producing a song');
  assert.deepEqual(delegated.filter(type => type === 'llm' || type === 'music'),
    useLibrary ? ['llm', 'llm', 'llm', 'music'] : [], 'exercise the selected engine');
  assert.equal(chat.length, 3, 'Sing must write lyrics, arrange them and identify musical clashes');
  for (const i of [0, 1]) {
    assert.ok(chatPrompt(chat[i]).includes(idea), 'the song idea must reach lyrics and arrangement');
    assert.ok(chatPrompt(chat[i]).includes(bands), 'musical references must reach lyrics and arrangement');
  }
  assert.ok(chatPrompt(chat[1]).includes(replies[0]), 'arrange the actual generated lyrics');
  assert.ok(chatPrompt(chat[2]).includes(replies[1]), 'derive exclusions from the actual arrangement');
  assert.equal(music.length, 1);
  assert.equal(music[0].lyrics, replies[0], 'send the generated lyrics to the music model');
  assert.ok(!('input' in music[0]), 'MiniMax Music 3 uses explicit prompt, not the TTS input field');
  const direction = music[0].prompt;
  assert.ok(direction.includes(replies[1]) && direction.includes(replies[2]),
    'arrangement and avoid-list must both reach the supported music prompt');
  assert.ok(!music[0].negative_prompt, 'keep musical exclusions in the supported style prompt');
}

// Character-sprites (#540 restore): designer brief → Muse still → Muse parts sheet.
// Resize is a local preview and may fail in this headless sandbox; the paid edit
// must still receive the generated reference. Catches flattening back to one image call.
const sprites = cloneExample('character-sprites');
const character = 'A compact glass fox courier with a cobalt scarf and brass goggles.';
sprites.nodes.find(n => n.name === 'Character').fields.text = character;
const designerOut = 'full body right-facing glass fox courier, cobalt scarf, brass goggles, flat magenta background';
for (const useLibrary of [false, true]) {
  const chat = [], images = [];
  const { delegated, errors } = await runFeaturedGraph(sprites, {
    useLibrary,
    onFetch(url, options) {
      if (/\/chat\/completions$/.test(url)) {
        chat.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: designerOut } }] }),
          { headers: { 'content-type': 'application/json' } });
      }
      if (/\/images\/generations$/.test(url)) {
        images.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }),
          { headers: { 'content-type': 'application/json' } });
      }
    },
  });
  assert.ok(errors.every(e => sprites.nodes.find(n => n.id === e.id)?.type === 'resize'),
    `character-sprites paid path failed: ${JSON.stringify(errors)}`);
  assert.deepEqual(delegated.filter(type => type === 'llm' || type === 'image' || type === 'edit'),
    useLibrary ? ['llm', 'image', 'edit'] : [], 'character-sprites must use the selected engine');
  assert.equal(chat.length, 1, 'character-sprites must ask the designer once');
  assert.ok(chatPrompt(chat[0]).includes(character), 'the character brief must reach the designer');
  assert.equal(images.length, 2, 'character-sprites must generate a reference and a parts sheet');
  const still = images.find(b => !b.imageDataUrl);
  const parts = images.find(b => b.imageDataUrl);
  assert.ok(still && still.model === 'meta/muse-image/text-to-image', 'canonical still must use Muse text-to-image');
  assert.equal(still.prompt, designerOut, 'Muse still must render the designer prompt, not the raw brief');
  assert.equal(still.size, '1:1', 'canonical still must stay square');
  assert.ok(parts && parts.model === 'meta/muse-image/edit', 'parts sheet must use Muse edit');
  assert.ok(String(parts.imageDataUrl).includes(PNG_B64), 'parts sheet must edit the generated reference');
  assert.ok(/FOUR equal/i.test(parts.prompt) && /TOP LEFT/i.test(parts.prompt),
    'parts sheet must keep the four-quadrant cutout brief');
}

// Photo-to-video (#538 shelf): still brief → Muse frame, motion brief → H3 i2v.
// Catches dropping the motion wire or sending the still prompt as the video prompt.
const p2v = cloneExample('photo-to-video');
const stillBrief = 'A copper kettle on a slate counter, one thin line of steam.';
const motionBrief = 'Locked camera. Only the steam rises. Nothing else moves.';
p2v.nodes.find(n => n.name === 'Still brief').fields.text = stillBrief;
p2v.nodes.find(n => n.name === 'Motion brief').fields.text = motionBrief;
for (const useLibrary of [false, true]) {
  const images = [], videos = [];
  const { delegated, errors } = await runFeaturedGraph(p2v, {
    useLibrary,
    onFetch(url, options) {
      if (/\/images\/generations$/.test(url)) {
        images.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }),
          { headers: { 'content-type': 'application/json' } });
      }
      if (/\/generate-video$/.test(url)) {
        videos.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ runId: 'vid-1' }), { headers: { 'content-type': 'application/json' } });
      }
    },
  });
  assert.deepEqual(errors, [], `photo-to-video failed: ${JSON.stringify(errors)}`);
  assert.deepEqual(delegated.filter(type => type === 'image' || type === 'ivideo'),
    useLibrary ? ['image', 'ivideo'] : [], 'photo-to-video must use the selected engine');
  assert.equal(images.length, 1);
  assert.equal(images[0].prompt, stillBrief, 'the still brief must reach Muse');
  assert.equal(images[0].model, 'meta/muse-image/text-to-image');
  assert.equal(videos.length, 1);
  assert.equal(videos[0].model, 'minimax-h3/image-to-video-spicy');
  assert.equal(videos[0].prompt, motionBrief, 'the motion brief must reach image-to-video');
  assert.ok(String(videos[0].imageDataUrl).includes(PNG_B64), 'H3 must animate the generated still');
  assert.equal(String(videos[0].duration), '5', 'H3 must keep the 5s sample duration');
  assert.equal(videos[0].resolution, '480p', 'H3 must keep the 480p sample resolution');
}

// Talking-avatar (#538 shelf): look → Muse face, script → speech, delivery → LongCat.
// TTS returns a hosted URL so lipsync stays deterministic (no blob: decode).
const avatar = cloneExample('talking-avatar');
const look = 'A fictional night-dispatch radio host, shoulders-up, clear mouth, navy shirt.';
const script = 'Check the blue tray. Paper, pencil, and the first model parts are inside.';
const delivery = 'Calm delivery, eyes toward camera, locked shot, no extra people.';
avatar.nodes.find(n => n.name === 'Presenter look').fields.text = look;
avatar.nodes.find(n => n.name === 'Spoken script').fields.text = script;
avatar.nodes.find(n => n.name === 'Delivery').fields.text = delivery;
const speechUrl = 'https://cdn.example/speech.mp3';
for (const useLibrary of [false, true]) {
  const images = [], audio = [], videos = [];
  const { delegated, errors } = await runFeaturedGraph(avatar, {
    useLibrary,
    onFetch(url, options) {
      if (/\/images\/generations$/.test(url)) {
        images.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }),
          { headers: { 'content-type': 'application/json' } });
      }
      if (/\/audio\/speech$/.test(url)) {
        audio.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ url: speechUrl }), { headers: { 'content-type': 'application/json' } });
      }
      if (/\/generate-video$/.test(url)) {
        videos.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ runId: 'vid-1' }), { headers: { 'content-type': 'application/json' } });
      }
    },
  });
  assert.deepEqual(errors, [], `talking-avatar failed: ${JSON.stringify(errors)}`);
  const avatarDelegated = delegated.filter(type => type === 'image' || type === 'tts' || type === 'lipsync');
  if (useLibrary) {
    assert.deepEqual([...avatarDelegated].sort(), ['image', 'lipsync', 'tts'], 'talking-avatar must delegate portrait, speech and lipsync');
    assert.equal(avatarDelegated.at(-1), 'lipsync', 'LongCat must run after the portrait and speech it consumes');
  } else {
    assert.deepEqual(avatarDelegated, [], 'talking-avatar built-in path must not delegate');
  }
  assert.equal(images.length, 1);
  assert.equal(images[0].prompt, look, 'the presenter look must reach Muse');
  assert.equal(audio.length, 1);
  assert.equal(audio[0].model, 'Minimax-Speech-2.8-HD');
  assert.equal(audio[0].input, script, 'the spoken script must reach Speech');
  assert.equal(audio[0].voice, 'Deep_Voice_Man', 'the sampled male voice must stay selected');
  assert.equal(videos.length, 1);
  assert.equal(videos[0].model, 'longcat-avatar-1.5');
  assert.equal(videos[0].prompt, delivery, 'the delivery brief must reach LongCat');
  assert.ok(String(videos[0].imageDataUrl).includes(PNG_B64), 'LongCat must receive the generated face');
  assert.equal(videos[0].audioUrl, speechUrl, 'LongCat must receive the generated speech');
  assert.equal(videos[0].resolution, '480p', 'LongCat must keep the 480p sample resolution');
}
const generated = spawnSync(process.execPath, ['scripts/sync-gallery-samples.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
assert.ifError(generated.error);
assert.equal(generated.status, 0, generated.stdout + generated.stderr);
console.log(`✓ ${examples.length} curated workflows: useful stages, reachable results, matching inputs and preserved sample provenance`);
