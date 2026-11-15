// Offline candidate wiring and real transport regression. No provider calls.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const graph = JSON.parse(readFileSync(join(root, 'docs/sketch-to-svg-color/candidate-graph.json'), 'utf8'));
const node = id => graph.nodes.find(n => n.id === id);
const wired = (from, to, port) => graph.links.some(l => l.from.node === from && l.to.node === to && l.to.port === port);
assert.equal(node('sketch').type, 'upload');
const fixture = readFileSync(join(root, 'examples/gallery/sketch-to-svg/sketch.png'));
assert.equal(node('sketch').fields.image, 'data:image/png;base64,' + fixture.toString('base64'));
assert.equal(node('paint').type, 'edit');
assert.equal(node('paint').fields.model, 'qwen-image-2.1/edit');
assert.match(node('paint').name, /Color render/);
assert(wired('sketch', 'paint', 'image'));
assert(wired('instruction', 'paint', 'prompt'));
assert(wired('paint', 'vec', 'image'));
assert(!wired('sketch', 'vec', 'image'), 'Vector must receive the color render, never the raw sketch');
assert.equal(node('vec').fields.prompt, '');
assert.equal(node('vec').fields.modelOpts.vector_operation, 'convert');
assert(!graph.nodes.some(n => n.type === 'image'), 'the example must not start with text-to-image generation');

const color = 'data:image/png;base64,' + Buffer.from('stub colored raster').toString('base64');
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#ee7755" d="M0 0h10v10z"/></svg>';
async function exercise(Workflow, label) {
  const calls = [];
  const wf = Workflow.fromJSON(JSON.stringify(graph), { apiKey: 'offline-test', fetch: async (url, init) => {
    assert.equal(url, 'https://nano-gpt.com/v1/images/generations');
    const body = JSON.parse(init.body); calls.push(body);
    assert.equal(body.n, 1);
    const bytes = calls.length === 1 ? color.split(',')[1] : Buffer.from(svg).toString('base64');
    return new Response(JSON.stringify({ data: [{ b64_json: bytes }], cost: 0 }));
  } });
  await wf.run();
  assert.equal(calls.length, 2, label);
  assert.equal(calls[0].model, node('paint').fields.model);
  assert.equal(calls[0].imageDataUrl, node('sketch').fields.image);
  assert.equal(calls[0].prompt, node('instruction').fields.text);
  assert.equal(calls[1].model, 'ideogram/vector');
  assert.equal(calls[1].imageDataUrl, color, label + ': SVG uses the edit output');
  assert.equal(calls[1].vector_operation, 'convert', label);
  assert.equal(calls[1].mode, 'default', label);
  assert.equal(Object.hasOwn(calls[1], 'prompt'), false, label + ': blank convert prompt is omitted');
  console.log('✓ sketch-to-svg: ' + label + ' upload → color edit → explicit convert, two requests');
}
const context = vm.createContext({ window: {}, console, atob, btoa, TextEncoder, TextDecoder, Response,
  AbortController, AbortSignal, setTimeout, clearTimeout, URL, URLSearchParams });
vm.runInContext(readFileSync(join(root, 'vendor/njs-engine.js'), 'utf8'), context);
await exercise(context.window.NanoodleEngine.Workflow, 'installed browser engine');
const sdk = process.env.NANOODLE_JS || resolve(root, '../nanoodle-js');
if (existsSync(join(sdk, 'src/index.mjs'))) {
  await exercise((await import(pathToFileURL(join(sdk, 'src/index.mjs')).href)).Workflow, 'SDK');
} else console.log('⊘ sketch-to-svg: sibling SDK absent; installed engine checked');
