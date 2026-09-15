#!/usr/bin/env node
// Live-run the three composition graphs #545 put at the front of Examples.
// Structural slug/hash pins still pass if a brief is rewired to the wrong port
// or a five-call relay is flattened into one model. These drive play's real
// runGraph on both engines and assert the NanoGPT bodies: which prompt, which
// generated media, which JSON/vision/edit shape. Offline stubs; no API spend.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExamples } from './check-example-models.mjs';
import { catalog, loadEngine, recordingFetch } from './play-engine.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const examples = parseExamples(readFileSync(join(ROOT, 'index.html'), 'utf8'));
const cloneExample = slug => {
  const graph = examples.find(e => e.slug === slug)?.graph;
  assert.ok(graph, `featured composition missing from EXAMPLES: ${slug}`);
  return JSON.parse(JSON.stringify(graph));
};

// Distinct 1×1 PNGs so a later step can prove it received THIS generated frame,
// not a sibling's. Small enough that fitImageInline passes them through.
const OPENING_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DRAFT_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==';
const REPAIRED_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==';
const SILENT_URL = 'https://cdn.example/silent.mp4';

// Seed the catalogs the send path actually reads. Resolution/JSON/edit-cap are
// catalog-gated; a silent muse-edit entry would cap the two-image repair to 1.
catalog.chat.push(
  { id: 'google/gemini-3.8-flash', capabilities: { vision: true, structured_output: true } },
  { id: 'z-ai/glm-5.3-flash' },
);
catalog.image.push(
  { id: 'meta/muse-image/text-to-image', supported_parameters: { resolutions: ['1:1', '3:2', '16:9'] } },
  { id: 'meta/muse-image/edit', supported_parameters: { resolutions: ['auto', '1:1', '3:2', '16:9'], max_input_images: 4 } },
  { id: 'nano-banana-edit', supported_parameters: { resolutions: ['auto'], max_input_images: 4 } },
);
catalog.video.push(
  {
    id: 'wan-video-image-to-video',
    supported_parameters: { parameters: {
      resolution: { options: [{ value: '480p' }, { value: '720p' }] },
      num_frames: { type: 'number', default: 81 },
      frames_per_second: { type: 'number', default: 16 },
    } },
  },
  {
    id: 'mirelo-ai/sfx1.6/video-to-video',
    supported_parameters: { parameters: { seed: { type: 'number', default: -1 } } },
  },
);

const png = model => {
  if (model === 'nano-banana-edit') return DRAFT_B64;
  if (model === 'meta/muse-image/edit') return REPAIRED_B64;
  return OPENING_B64;
};
const chatText = call => (call.messages || []).filter(m => m.role === 'user').map(m => {
  const c = m.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return String(c ?? '');
  return c.filter(p => p.type === 'text').map(p => p.text).join('\n');
}).join('\n');
const chatImages = call => (call.messages || []).flatMap(m => {
  if (!Array.isArray(m.content)) return [];
  return m.content.filter(p => p.type === 'image_url').map(p => p.image_url?.url || '');
});
const paidErrors = (errors, graph) => errors.filter(e => graph.nodes.find(n => n.id === e.id)?.type !== 'resize');

async function runComposition(graph, { useLibrary, onFetch }) {
  const delegated = [];
  const errors = [];
  let sandbox;
  const engine = loadEngine(ctx => {
    sandbox = ctx;
    ctx.URLSearchParams = URLSearchParams;
    ctx.fetch = async (url, options = {}) => {
      const href = String(url);
      const hit = onFetch && onFetch(href, options);
      if (hit) return hit;
      if (/\/generate-video$/.test(href)) {
        return new Response(JSON.stringify({ runId: 'vid-1' }), { headers: { 'content-type': 'application/json' } });
      }
      if (/\/video\/status/.test(href)) {
        return new Response(JSON.stringify({
          status: 'COMPLETED',
          data: { status: 'COMPLETED', output: { video: { url: SILENT_URL } } },
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (/\/images\/generations$/.test(href)) {
        const body = JSON.parse(options.body || '{}');
        return new Response(JSON.stringify({ data: [{ b64_json: png(body.model) }] }),
          { headers: { 'content-type': 'application/json' } });
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

// Pocket mystery: room brief → Muse still → Gemini vision JSON → GLM mystery.
// Catches flattening to one LLM, dropping the generated room from observe, or
// sending JSON mode on a model that bills empty (gate needs structured_output).
const mystery = cloneExample('pocket-mystery');
const roomBrief = 'A brass orrery workshop with one telescope, one ivory moon, one vermilion sewing machine.';
mystery.nodes.find(n => n.name === 'Room brief').fields.text = roomBrief;
const landmarks = JSON.stringify({
  scene: 'A workshop with three large objects.',
  landmarks: [
    { id: 'A', label: 'telescope', location: 'left', appearance: 'brass' },
    { id: 'B', label: 'moon', location: 'center', appearance: 'ivory' },
    { id: 'C', label: 'sewing machine', location: 'right', appearance: 'vermilion' },
  ],
  warnings: [],
});
for (const useLibrary of [false, true]) {
  const chat = [], images = [];
  const { delegated, errors } = await runComposition(mystery, {
    useLibrary,
    onFetch(url, options) {
      if (/\/chat\/completions$/.test(url)) {
        const body = JSON.parse(options.body);
        chat.push(body);
        const reply = chat.length === 1 ? landmarks : 'TITLE\nThe Moon-Mender\nPLAYER HANDOUT\nVisit telescope before moon.\nGM ONLY - SPOILERS\nC then A then B.';
        return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }),
          { headers: { 'content-type': 'application/json' } });
      }
      if (/\/images\/generations$/.test(url)) {
        images.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ data: [{ b64_json: OPENING_B64 }] }),
          { headers: { 'content-type': 'application/json' } });
      }
    },
  });
  assert.deepEqual(paidErrors(errors, mystery), [], `pocket-mystery paid path failed: ${JSON.stringify(errors)}`);
  assert.deepEqual(delegated.filter(type => type === 'image' || type === 'llm'),
    useLibrary ? ['image', 'llm', 'llm'] : [], 'pocket-mystery must use the selected engine');
  assert.equal(images.length, 1, 'pocket-mystery must invent exactly one room');
  assert.equal(images[0].model, 'meta/muse-image/text-to-image');
  assert.equal(images[0].prompt, roomBrief, 'the room brief must reach Muse');
  assert.equal(images[0].size, '1:1', 'the room still must stay square');
  assert.equal(chat.length, 2, 'pocket-mystery must observe the room, then write the mystery');
  assert.equal(chat[0].model, 'google/gemini-3.8-flash');
  assert.deepEqual(chat[0].response_format, { type: 'json_object' },
    'observe must send json_object so a structured_output model does not return prose');
  assert.ok(chatText(chat[0]).includes('Inspect the attached room illustration'),
    'observe must keep its baked vision brief, not the room-generation prompt');
  const observed = chatImages(chat[0]);
  assert.equal(observed.length, 1, 'observe must see exactly one room image');
  assert.ok(observed[0].includes(OPENING_B64), 'observe must read the generated room, not an imagined brief');
  assert.equal(chat[1].model, 'z-ai/glm-5.3-flash');
  assert.ok(!('response_format' in chat[1]), 'the mystery writer is prose, not JSON mode');
  assert.equal(chatImages(chat[1]).length, 0, 'the mystery writer must not see the image — only the JSON observations');
  assert.ok(chatText(chat[1]).includes(landmarks), 'the mystery writer must receive the actual observe JSON');
}

// Storyboard relay: Muse opening → Nano Banana next beat → Gemini draft check
// → Muse two-image repair → independent Gemini final notes. Catches skipping
// the repair, sending only one frame to a vision pass, or swapping draft/opening.
const story = cloneExample('storyboard-relay');
const firstScene = 'A cream postal robot holds one seedling capsule outside a locked hatch.';
const nextBeat = 'The same robot plants the seedling inside the open greenhouse.';
const rules = 'One robot, one capsule, one seedling. Frame 2 is planting, not the doorway.';
story.nodes.find(n => n.name === 'First scene').fields.text = firstScene;
story.nodes.find(n => n.name === 'Next beat').fields.text = nextBeat;
story.nodes.find(n => n.name === 'Continuity rules').fields.text = rules;
const draftNotes = 'The draft still shows the closed hatch and a second capsule.';
const finalNotes = 'Planting reads. Capsule count is now consistent.';
for (const useLibrary of [false, true]) {
  const chat = [], images = [];
  const { delegated, errors } = await runComposition(story, {
    useLibrary,
    onFetch(url, options) {
      if (/\/chat\/completions$/.test(url)) {
        const body = JSON.parse(options.body);
        chat.push(body);
        return new Response(JSON.stringify({
          choices: [{ message: { content: chat.length === 1 ? draftNotes : finalNotes } }],
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (/\/images\/generations$/.test(url)) {
        const body = JSON.parse(options.body);
        images.push(body);
        return new Response(JSON.stringify({ data: [{ b64_json: png(body.model) }] }),
          { headers: { 'content-type': 'application/json' } });
      }
    },
  });
  assert.deepEqual(paidErrors(errors, story), [], `storyboard-relay paid path failed: ${JSON.stringify(errors)}`);
  assert.deepEqual(delegated.filter(type => type === 'image' || type === 'edit' || type === 'llm'),
    useLibrary ? ['image', 'edit', 'llm', 'edit', 'llm'] : [], 'storyboard-relay must use the selected engine');
  assert.equal(images.length, 3, 'storyboard-relay must open, stage, then repair — three image calls');
  assert.equal(images[0].model, 'meta/muse-image/text-to-image');
  assert.equal(images[0].prompt, firstScene, 'the first scene must reach Muse');
  assert.equal(images[0].size, '3:2');
  assert.ok(!images[0].imageDataUrl, 'the opening is text-to-image, not an edit');
  assert.equal(images[1].model, 'nano-banana-edit');
  assert.ok(String(images[1].imageDataUrl).includes(OPENING_B64),
    'Nano Banana must stage the next beat from the generated opening');
  assert.ok(!Array.isArray(images[1].imageDataUrl), 'the next-beat edit is a single reference');
  assert.ok(images[1].prompt.includes(nextBeat) && images[1].prompt.includes(rules),
    'the next-beat edit must receive the beat and the continuity rules');
  assert.equal(images[2].model, 'meta/muse-image/edit');
  assert.ok(Array.isArray(images[2].imageDataUrl) && images[2].imageDataUrl.length === 2,
    'repair must send the draft and the opening as two references');
  assert.ok(String(images[2].imageDataUrl[0]).includes(DRAFT_B64),
    'repair image[0] is the draft next frame (the pixels to correct)');
  assert.ok(String(images[2].imageDataUrl[1]).includes(OPENING_B64),
    'repair image[1] is the opening (identity/style anchor only)');
  assert.ok(images[2].prompt.includes(draftNotes), 'repair must use the actual draft continuity notes');
  assert.ok(images[2].prompt.includes(nextBeat) && images[2].prompt.includes(rules),
    'repair must keep the story and continuity requirements');
  assert.equal(chat.length, 2, 'storyboard-relay must review the draft, then independently review the repair');
  const draftImgs = chatImages(chat[0]);
  const finalImgs = chatImages(chat[1]);
  assert.equal(draftImgs.length, 2, 'draft continuity check compares two frames');
  assert.ok(draftImgs[0].includes(OPENING_B64) && draftImgs[1].includes(DRAFT_B64),
    'draft check image 1 is the opening, image 2 is the Nano Banana draft');
  assert.ok(chatText(chat[0]).includes(firstScene) && chatText(chat[0]).includes(nextBeat),
    'draft check must receive the story brief');
  assert.equal(finalImgs.length, 2, 'final notes compare two frames');
  assert.ok(finalImgs[0].includes(OPENING_B64) && finalImgs[1].includes(REPAIRED_B64),
    'final notes image 1 is the opening, image 2 is the repaired frame — not the unfixed draft');
  assert.ok(!chatText(chat[1]).includes(draftNotes),
    'final notes must not inherit the earlier review; they inspect the repaired pixels');
}

// Tiny world film: World → Muse still; Motion + still → Wan silent take;
// generated VIDEO → Mirelo foley. Catches sending the still prompt as the
// motion prompt, or giving Mirelo the text brief instead of the silent clip.
const film = cloneExample('tiny-world-film');
const world = 'A walnut-shell watermill with one copper wheel on a mossy stone.';
const motion = 'Locked-off macro. Only the copper wheel turns. No camera travel.';
film.nodes.find(n => n.name === 'World').fields.text = world;
film.nodes.find(n => n.name === 'Motion').fields.text = motion;
for (const useLibrary of [false, true]) {
  const images = [], videos = [];
  const { delegated, errors } = await runComposition(film, {
    useLibrary,
    onFetch(url, options) {
      if (/\/images\/generations$/.test(url)) {
        images.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ data: [{ b64_json: OPENING_B64 }] }),
          { headers: { 'content-type': 'application/json' } });
      }
      if (/\/generate-video$/.test(url)) {
        videos.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ runId: 'vid-' + videos.length }),
          { headers: { 'content-type': 'application/json' } });
      }
    },
  });
  assert.deepEqual(paidErrors(errors, film), [], `tiny-world-film paid path failed: ${JSON.stringify(errors)}`);
  assert.deepEqual(delegated.filter(type => type === 'image' || type === 'ivideo' || type === 'vedit'),
    useLibrary ? ['image', 'ivideo', 'vedit'] : [], 'tiny-world-film must use the selected engine');
  assert.equal(images.length, 1);
  assert.equal(images[0].model, 'meta/muse-image/text-to-image');
  assert.equal(images[0].prompt, world, 'the world brief must reach Muse');
  assert.equal(images[0].size, '16:9');
  assert.equal(videos.length, 2, 'tiny-world-film must animate, then add foley');
  assert.equal(videos[0].model, 'wan-video-image-to-video');
  assert.equal(videos[0].prompt, motion, 'the motion brief must reach Wan — not the still prompt');
  assert.ok(String(videos[0].imageDataUrl).includes(OPENING_B64), 'Wan must animate the generated miniature');
  assert.equal(String(videos[0].duration), '5', 'Wan must keep the 5s sample duration');
  assert.equal(videos[0].resolution, '480p', 'Wan must keep the 480p sample resolution');
  assert.equal(videos[1].model, 'mirelo-ai/sfx1.6/video-to-video');
  assert.equal(videos[1].videoUrl, SILENT_URL, 'Mirelo must receive the generated silent clip, not the text brief');
  assert.ok(!videos[1].imageDataUrl, 'Mirelo is video-to-video — it must not be sent the still as an i2v source');
  assert.equal(videos[1].prompt, '', 'foley watches the clip; a leftover still/motion prompt is a rewire');
}

console.log('✓ featured compositions: pocket-mystery, storyboard-relay and tiny-world-film keep their paid handoffs on both engines');
