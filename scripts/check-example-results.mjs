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
import { loadEngine, recordingFetch } from './play-engine.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const idx = readFileSync(join(ROOT, 'index.html'), 'utf8');
const examples = parseExamples(idx);
const kinds = nodeKinds(idx);
const samples = JSON.parse(readFileSync(join(ROOT, 'examples/gallery/samples.json'), 'utf8'));
const gallery = readFileSync(join(ROOT, 'examples/gallery/index.html'), 'utf8');
const bySlug = new Map(samples.map(s => [s.slug, s]));
assert.equal(bySlug.size, samples.length, 'duplicate saved sample');
const localOnlyMatch = idx.match(/const LOCAL_ONLY_EXAMPLE_SLUGS = new Set\(\[([^\]]*)\]\)/);
assert.ok(localOnlyMatch, 'LOCAL_ONLY_EXAMPLE_SLUGS missing — teaching cards need an explicit list');
const LOCAL_ONLY = new Set([...localOnlyMatch[1].matchAll(/"([^"]+)"/g)].map(m => m[1]));
assert.ok(LOCAL_ONLY.has('custom-endpoint'), 'custom-endpoint must stay a teaching-only card');

const slugs = new Set(examples.map(e => e.slug));
assert.equal(slugs.size, examples.length, 'duplicate example card');
const curated = examples.filter(e => !LOCAL_ONLY.has(e.slug));
const curatedSlugs = new Set(curated.map(e => e.slug));
assert.deepEqual([...curatedSlugs].sort(), ['character-sprites', 'storyboard-relay', 'tiny-world-film', 'image-model-arena', 'photo-to-video', 'sing', 'talking-avatar', 'neon-shrine-duel'].sort(),
  'curated shelf changed: review the workflow and its saved evidence before featuring it');
assert.deepEqual([...bySlug.keys()].sort(), [...curatedSlugs].sort());
assert.deepEqual([...gallery.matchAll(/<section id="([^"]+)"/g)].map(m => m[1]).sort(), [...bySlug.keys()].sort());
for (const s of LOCAL_ONLY) assert.ok(slugs.has(s), `teaching slug ${s} is not an EXAMPLES card`);

const fn = idx.slice(idx.indexOf('function openExamples()'), idx.indexOf('function closeExamples()'));
const resultExpr = fn.match(/const result=([^;]+);/)?.[1];
const thumbExpr = fn.match(/const thumb=([^;]+);/)?.[1];
assert.ok(resultExpr && thumbExpr, 'example links and thumbnails must be inspectable');
assert.ok(fn.includes('LOCAL_ONLY_EXAMPLE_SLUGS.has(ex.slug)'), 'openExamples must consult LOCAL_ONLY_EXAMPLE_SLUGS');
assert.ok(/const see=result\?/.test(fn) || /const see=result \?/.test(fn) || fn.includes('const see=result?'), 'openExamples must gate See result on truthy result');
assert.ok(fn.includes('const previewWrap=result?') || fn.includes('const previewWrap=result ?'), 'openExamples must gate preview wrap on truthy result');
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
  const result = vm.runInNewContext(resultExpr, { ex, encodeURIComponent, LOCAL_ONLY_EXAMPLE_SLUGS: LOCAL_ONLY });
  if (LOCAL_ONLY.has(ex.slug)) {
    assert.equal(result, '', `${ex.slug}: teaching-only card must hide See result`);
    const models = ex.graph.nodes.filter(n => kinds[n.type]?.kind);
    assert.ok(models.length < 2, `${ex.slug}: teaching card should not look like a multi-model shelf workflow`);
    const choice = ex.graph.nodes.find(n => n.type === 'choice');
    assert.ok(choice, `${ex.slug}: teaching card needs a Choice node`);
    // Two teaching patterns: Choice → endpoint.url (path picker) OR Choice → model (paid model id).
    // Never "join the pick into the prompt" — that hides the field-port lesson.
    const ep = ex.graph.nodes.find(n => n.type === 'endpoint');
    const modelTarget = ex.graph.nodes.find(n => kinds[n.type]?.kind);
    if (ep) {
      assert.ok(ex.graph.links.some(l => l.from.node === choice.id && l.to.node === ep.id && l.to.port === 'url'),
        `${ex.slug}: Choice must wire into endpoint.url so the path picker retargets the POST`);
      // #569: Path options are URL segments (/post, /anything) joined onto the
      // typed host. A leftover Path→mode wire painted "⚡ from Path" while mode
      // stayed json — a non-driving chip that taught the wrong port.
      assert.ok(!ex.graph.links.some(l => l.to.node === ep.id && l.to.port === 'mode'),
        `${ex.slug}: Path must not wire into endpoint.mode — /post and /anything are path segments, not modes`);
      assert.equal(ep.fields.mode, 'json', `${ex.slug}: typed mode stays json; Path only retargets the URL`);
      const pathOpts = String(choice.fields.options || '').split('\n').map(s => s.trim()).filter(Boolean);
      assert.deepEqual(pathOpts, ['/post', '/anything'],
        `${ex.slug}: Path options must stay URL path segments (not mode names)`);
    } else if (modelTarget) {
      assert.ok(ex.graph.links.some(l => l.from.node === choice.id && l.to.node === modelTarget.id && l.to.port === 'model'),
        `${ex.slug}: Choice must wire into the model field so the pick drives the paid call`);
      assert.ok(!ex.graph.links.some(l => l.from.node === choice.id && l.to.port === 'prompt'),
        `${ex.slug}: Choice must not feed the prompt — that is not a model-port demo`);
    } else {
      assert.fail(`${ex.slug}: teaching card needs endpoint.url or Choice→model`);
    }
    continue;
  }
  file(vm.runInNewContext(thumbExpr, { ex, encodeURIComponent, LOCAL_ONLY_EXAMPLE_SLUGS: LOCAL_ONLY }));
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

// Exercise the actual Sing graph: the musical references must influence the
// writing, and both generated style branches must reach a supported music field.
// This catches the former flattening and a cosmetic negative_prompt connection.
const sing = JSON.parse(JSON.stringify(examples.find(e => e.slug === 'sing').graph));
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
  const chat = [], music = [], errors = [], delegated = [];
  let sandbox;
  const engine = loadEngine(ctx => {
    sandbox = ctx;
    ctx.URLSearchParams = URLSearchParams;
    ctx.fetch = async (url, options = {}) => {
      if (/\/chat\/completions$/.test(String(url))) {
        const body = JSON.parse(options.body);
        chat.push(body);
        assert.ok(chat.length <= replies.length, 'Sing has an unexpected text call');
        return new Response(JSON.stringify({choices:[{message:{content:replies[chat.length - 1]}}]}),
          {headers:{'content-type':'application/json'}});
      }
      if (/\/audio\/speech$/.test(String(url))) {
        music.push(JSON.parse(options.body));
        return new Response(new Uint8Array([1, 2, 3]), {headers:{'content-type':'audio/mpeg'}});
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
  await engine.runGraph(engine.materialize(sing), {
    onStatus: (id, kind, message) => { if (kind === 'error') errors.push({id, message}); },
  });
  assert.deepEqual(errors, [], 'Sing failed before producing a song');
  assert.deepEqual(delegated.filter(type => type === 'llm' || type === 'music'),
    useLibrary ? ['llm', 'llm', 'llm', 'music'] : [], 'exercise the selected engine');
  assert.equal(chat.length, 3, 'Sing must write lyrics, arrange them and identify musical clashes');
  const prompt = call => call.messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
  for (const i of [0, 1]) {
    assert.ok(prompt(chat[i]).includes(idea), 'the song idea must reach lyrics and arrangement');
    assert.ok(prompt(chat[i]).includes(bands), 'musical references must reach lyrics and arrangement');
  }
  assert.ok(prompt(chat[1]).includes(replies[0]), 'arrange the actual generated lyrics');
  assert.ok(prompt(chat[2]).includes(replies[1]), 'derive exclusions from the actual arrangement');
  assert.equal(music.length, 1);
  assert.equal(music[0].lyrics, replies[0], 'send the generated lyrics to the music model');
  assert.ok(!('input' in music[0]), 'MiniMax Music 3 uses explicit prompt, not the TTS input field');
  const direction = music[0].prompt;
  assert.ok(direction.includes(replies[1]) && direction.includes(replies[2]),
    'arrangement and avoid-list must both reach the supported music prompt');
  assert.ok(!music[0].negative_prompt, 'keep musical exclusions in the supported style prompt');
}
const generated = spawnSync(process.execPath, ['scripts/sync-gallery-samples.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
assert.ifError(generated.error);
assert.equal(generated.status, 0, generated.stdout + generated.stderr);
console.log(`✓ ${curated.length} curated workflows (+${LOCAL_ONLY.size} teaching): useful stages, reachable results, matching inputs and preserved sample provenance`);
