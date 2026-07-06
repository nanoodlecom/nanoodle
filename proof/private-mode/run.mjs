#!/usr/bin/env node
// Drives the in-browser Private Mode PoC: serves this dir on a fresh localhost port
// (secure context), launches a private headless Edge via CDP, loads index.html with the
// NANOGPT_API_KEY injected from ../../.env (never committed), and prints the page's results
// plus every cross-origin host the attestation touched.
//
// Usage: node proof/private-mode/run.mjs          (from the repo root; needs .env with NANOGPT_API_KEY)
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const env = existsSync(join(repoRoot, '.env')) ? readFileSync(join(repoRoot, '.env'), 'utf8') : '';
const KEY = process.env.NANOGPT_API_KEY || env.match(/^NANOGPT_API_KEY=(.+)$/m)?.[1]?.trim();
if (!KEY) { console.error('NANOGPT_API_KEY not found (env or repo .env)'); process.exit(1); }

const MIME = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/key.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(`window.NANOGPT_API_KEY=${JSON.stringify(KEY)};`);
    return;
  }
  const file = join(here, path === '/' ? 'index.html' : path.slice(1));
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[file.split('.').pop()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('nope');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const pageUrl = `http://localhost:${port}/?key=1`;
console.log('serving', pageUrl);

const debugPort = 9200 + Math.floor(port % 700);
const profile = join(tmpdir(), `pm-poc-profile-${port}`);
const edge = spawn('/usr/bin/microsoft-edge', [
  '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  '--no-first-run', 'about:blank',
], { stdio: 'ignore' });
const kill = () => { try { edge.kill(); } catch {} server.close(); };
process.on('exit', kill);

await new Promise((r) => setTimeout(r, 4000));
const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const hosts = new Set();
const cdp = (method, params = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((resolve) => {
    const h = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === mid) { ws.removeEventListener('message', h); resolve(m); }
    };
    ws.addEventListener('message', h);
  });
};
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Network.requestWillBeSent') {
    try { hosts.add(new URL(m.params.request.url).host); } catch {}
  }
});
await cdp('Network.enable');
await cdp('Page.enable');

// index.html reads window.NANOGPT_API_KEY — inject it before any page script runs
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.NANOGPT_API_KEY=${JSON.stringify(KEY)};` });
await cdp('Page.navigate', { url: pageUrl });

for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const done = await cdp('Runtime.evaluate', { expression: 'window.__RESULT && window.__RESULT.done' });
  if (done.result?.result?.value === true) break;
}
const res = await cdp('Runtime.evaluate', { expression: 'JSON.stringify(window.__RESULT, null, 2)' });
const lines = await cdp('Runtime.evaluate', { expression: 'JSON.stringify(window.__LINES || [])' });
console.log('--- page log ---');
for (const l of JSON.parse(lines.result?.result?.value || '[]')) console.log(' ', l);
console.log('--- result ---');
console.log(res.result?.result?.value);
console.log('--- cross-origin hosts touched ---');
console.log([...hosts].filter((h) => !h.startsWith('localhost') && !h.startsWith('127.')).join('\n'));
ws.close();
kill();
process.exit(0);
