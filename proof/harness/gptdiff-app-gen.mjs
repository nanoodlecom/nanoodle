#!/usr/bin/env node
/* ======================================================================
   HEADLESS nanoodle "Create app" + gptdiff customize/iterate loop.

   This is a faithful, browser-free reproduction of play.html's app
   builder: it takes a noodle-graph.json, produces the SAME deterministic
   seed app shell (defaultFiles), then runs the SAME gptdiff loop the
   "Customize" / "Port" buttons use — buildEnvironment -> generateDiff ->
   parseDiffPerFile -> smartapply — against the SAME vendored gptdiff-js
   and live NanoGPT, over the SAME two editable files (index.html + app.css).
   The REAL RUNTIME_JS engine is sliced straight out of play.html and
   embedded, so the exported bundle is a genuinely runnable standalone app.

   Usage:
     NANOGPT_API_KEY=... node gptdiff-app-gen.mjs <graph.json> <out-dir> "goal 1" ["goal 2" ...]

   Each goal is one customize iteration (a new version), proving iteration.
   ====================================================================== */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  buildEnvironment, generateDiff, smartapply, parseDiffPerFile, callLlmForApply,
} from "../../vendor/gptdiff-js/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");                 // worktree root
const PLAY = join(REPO, "play.html");

const NANOGPT = "https://nano-gpt.com";
const MODEL  = process.env.GPTDIFF_MODEL || "xiaomi/mimo-v2.5-pro-ultraspeed";          // writes the diff (play.html DEFAULT_MODEL)
const APPLY  = process.env.GPTDIFF_APPLY || process.env.GPTDIFF_MODEL || "xiaomi/mimo-v2.5-pro-ultraspeed"; // applies the diff
const ACCENT = "#7c8cff";
const KEY = process.env.NANOGPT_API_KEY;
if (!KEY) { console.error("NANOGPT_API_KEY not set"); process.exit(1); }

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

/* ---------- non-streaming callLlm -> NanoGPT (shape gptdiff-js expects) ---------- */
async function callLlm({ apiKey, baseUrl, model, messages, maxTokens = null, temperature = 1.0 }) {
  const endpoint = (baseUrl || (NANOGPT + "/api/v1/")).replace(/\/+$/, "") + "/chat/completions";
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: "Bearer " + (apiKey || KEY), "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, ...(maxTokens ? { max_tokens: maxTokens } : {}), temperature }),
  });
  if (!r.ok) throw new Error("LLM " + r.status + ": " + (await r.text()).slice(0, 300));
  const j = await r.json();
  const content = j.choices?.[0]?.message?.content ?? "";
  const pricing = j.x_nanogpt_pricing || {};
  const usd = pricing.costUsd != null ? pricing.costUsd : pricing.cost;
  if (usd != null) callLlm._cost += Number(usd);
  return { choices: [{ message: { content } }] };
}
callLlm._cost = 0;

/* ======================================================================
   Pull the REAL RUNTIME_JS engine out of play.html, and run it under a
   tiny DOM-free shim so we get NoodleApp.materialize / describeGraph —
   the exact pure helpers play.html feeds to the customize prompt.
   ====================================================================== */
const playSrc = readFileSync(PLAY, "utf8");
const start = playSrc.indexOf("String.raw`", playSrc.indexOf("const RUNTIME_JS")) + "String.raw`".length;
const end = playSrc.indexOf("`;", start);
if (start < "String.raw`".length || end < 0) { console.error("could not extract RUNTIME_JS"); process.exit(1); }
const RUNTIME_JS = playSrc.slice(start, end);

function loadNoodleApp() {
  const noop = () => {};
  const win = {};
  win.parent = win;                          // EMBEDDED = (parent && parent!==window) -> false
  win.addEventListener = noop;
  win.postMessage = noop;
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear(),
  };
  const document = {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop, addEventListener: noop }),
    addEventListener: noop, head: { appendChild: noop }, body: { appendChild: noop },
  };
  const location = { href: "http://localhost/", origin: "http://localhost", pathname: "/", search: "", hash: "" };
  win.location = location;
  const sandbox = {
    window: win, self: win, globalThis: win, document, localStorage, sessionStorage: localStorage, location,
    history: { replaceState: noop, pushState: noop }, navigator: { userAgent: "node" },
    addEventListener: noop, performance: { now: () => 0 }, fetch: () => Promise.reject(new Error("no fetch in builder")),
    console, setTimeout, clearTimeout, TextDecoder, TextEncoder, DOMException,
    btoa: s => Buffer.from(s, "binary").toString("base64"), atob: s => Buffer.from(s, "base64").toString("binary"),
  };
  win.document = document; win.localStorage = localStorage;
  vm.createContext(sandbox);
  vm.runInContext(RUNTIME_JS, sandbox, { filename: "runtime.js" });
  if (!win.NoodleApp) throw new Error("RUNTIME_JS did not define window.NoodleApp");
  return win.NoodleApp;
}
const NoodleApp = loadNoodleApp();

/* ======================================================================
   defaultFiles(graph): byte-faithful port of play.html's deterministic
   seed-shell generator (deriveTitle/deriveTagline + the index.html/app.css
   templates). This is the v0 the customize loop edits.
   ====================================================================== */
function deriveTitle(graph) {
  const txt = (graph.nodes || []).find(n => n.type === "text" && (n.fields && n.fields.text || "").trim());
  if (txt) { const w = txt.fields.text.trim().replace(/\s+/g, " ").split(" ").slice(0, 5).join(" "); if (w) return w.slice(0, 48); }
  const kinds = new Set((graph.nodes || []).map(n => ({ image:"Image",tvideo:"Video",ivideo:"Video",music:"Music",tts:"Speech",llm:"Text",vision:"Vision" }[n.type])).filter(Boolean));
  if (kinds.size === 1) return [...kinds][0] + " Generator";
  return "My nanoodle app";
}
function deriveTagline(graph) {
  const out = new Set((graph.nodes || []).map(n => ({ image:"images",tvideo:"video",ivideo:"video",music:"music",tts:"speech",llm:"text",vision:"descriptions" }[n.type])).filter(Boolean));
  return out.size ? "Fill in the inputs, hit Run, and get " + [...out].join(", ") + "." : "Fill in the inputs and hit Run.";
}
function defaultFiles(graph) {
  const title = deriveTitle(graph), tagline = deriveTagline(graph);
  const indexHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style><!-- include: app.css --></style>
</head>
<body>
<main class="app">
  <header class="app-head">
    <h1 id="app-title">${esc(title)}</h1>
    <p id="app-tagline">${esc(tagline)}</p>
    <div id="app-auth" class="auth"></div>
  </header>

  <section id="app-inputs" class="inputs"></section>

  <div class="run-row">
    <button id="app-run" class="run">▶ Run</button>
    <label id="app-loop" class="loop"></label>
    <div id="app-count" class="count"></div>
  </div>

  <div id="app-status" class="status"></div>

  <section id="app-output" class="output"></section>
</main>

<!-- include-config: graph.json -->
<!-- include: runtime.js -->
<script>NoodleApp.mount();<\/script>
</body>
</html>
`;
  const appCss = `:root{
  color-scheme: dark;
  --bg:#0d0f17; --panel:#161a27; --panel2:#1d2236; --line:#2a3150;
  --ink:#e6e9f5; --dim:#8b93b4; --faint:#5d6788;
  --accent:${ACCENT}; --accent-soft:${ACCENT}22; --accent-line:${ACCENT}66;
  --ok:#46d27a; --danger:#ff6b6b; --radius:.7rem;
}
*{ box-sizing:border-box; }
html,body{ margin:0; }
body{ background:
    radial-gradient(900px 520px at 50% -10%, #1a2147 0%, transparent 60%), var(--bg);
  color:var(--ink); font:15px/1.55 ui-sans-serif, system-ui, sans-serif; min-height:100vh; }
.app{ max-width:760px; margin:0 auto; padding:2rem 1.1rem 4rem; }
.app-head h1{ font-size:1.5rem; margin:0 0 .25rem; letter-spacing:.01em; }
.app-head .auth{ font-size:.78rem; color:var(--dim); margin-top:.4rem; min-height:1.1em; }
#app-tagline{ color:var(--dim); margin:0; max-width:60ch; }
.inputs{ display:flex; flex-direction:column; gap:1rem; margin:1.6rem 0; }
.field label{ display:block; font-size:.8rem; color:var(--dim); margin-bottom:.3rem; }
.field input, .field textarea, .field select{
  width:100%; font:inherit; padding:.6rem .7rem; border-radius:var(--radius);
  background:var(--panel); border:1px solid var(--line); color:var(--ink); }
.field textarea{ min-height:90px; resize:vertical; }
.run-row{ display:flex; align-items:center; gap:1rem; margin:.4rem 0 1.2rem; flex-wrap:wrap; }
.run{ font:inherit; font-weight:700; padding:.7rem 1.6rem; border-radius:var(--radius); cursor:pointer;
  background:linear-gradient(180deg,#8b97ff,#6573ef); border:1px solid #8b97ff; color:#0b0e18;
  box-shadow:0 0 26px ${ACCENT}33; }
.status{ font-size:.82rem; color:var(--dim); min-height:1.2em; display:flex; flex-direction:column; gap:.2rem; }
.output{ display:flex; flex-direction:column; gap:1rem; }
.output .card{ background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:1rem; }
.output img, .output video, .output audio{ width:100%; border-radius:.5rem; display:block; }
.output .text{ white-space:pre-wrap; line-height:1.6; }
.output.grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); }
`;
  return { "index.html": indexHtml, "app.css": appCss };
}

/* ---------- bundle(files, graph): faithful port of play.html bundler ---------- */
const MOUNT_IDS = ["app-title","app-tagline","app-auth","app-inputs","app-run","app-loop","app-count","app-status","app-output"];
const MOUNT_FALLBACK = {
  "app-title":'<h1 id="app-title"></h1>', "app-tagline":'<p id="app-tagline"></p>', "app-auth":'<div id="app-auth" class="auth"></div>',
  "app-inputs":'<section id="app-inputs" class="inputs"></section>', "app-run":'<button id="app-run" class="run">▶ Run</button>',
  "app-loop":'<label id="app-loop" class="loop"></label>', "app-count":'<div id="app-count" class="count"></div>',
  "app-status":'<div id="app-status" class="status"></div>', "app-output":'<section id="app-output" class="output"></section>',
};
function bundle(files, graph) {
  const ENGINE = {
    css: () => "<style>" + (files["app.css"] || "") + "</style>",
    runtime: () => "<script>\n" + RUNTIME_JS.replace(/<\/script/gi, "<\\/script") + "\n<\/script>",
    graph: () => {
      const json = JSON.stringify(graph).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
      return "<script>window.NOODLE_GRAPH = " + json + ";<\/script>";
    },
  };
  const injectInHead = (h, s) => /<\/head>/i.test(h) ? h.replace(/<\/head>/i, s + "</head>") : s + h;
  const injectInBody = (h, s) => /<\/body>/i.test(h) ? h.replace(/<\/body>/i, s + "</body>") : h + s;
  let html = files["index.html"];
  let cssDone = false, runtimeDone = false, graphDone = false;
  html = html.replace(/<!--\s*include:\s*([^>]+?)\s*-->/g, (_, p) => {
    const name = p.trim();
    if (name === "runtime.js") { runtimeDone = true; return ENGINE.runtime(); }
    if (name === "app.css") { cssDone = true; return files["app.css"] || ""; }
    return files[name] != null ? files[name] : "<!-- missing: " + name + " -->";
  });
  html = html.replace(/<!--\s*include-config:\s*([^>]+?)\s*-->/g, () => { graphDone = true; return ENGINE.graph(); });
  const missing = MOUNT_IDS.filter(id => !html.includes('id="' + id + '"'));
  if (missing.length) html = injectInBody(html, '<div class="noodle-shim">' + missing.map(id => MOUNT_FALLBACK[id]).join("") + "</div>");
  if (!cssDone) html = injectInHead(html, ENGINE.css());
  if (!graphDone) html = injectInHead(html, ENGINE.graph());
  if (!runtimeDone) html = injectInHead(html, ENGINE.runtime());
  html = html.replace(/<script>\s*NoodleApp\s*\.\s*mount\s*\(\s*\)\s*;?\s*<\/script>/gi, "");
  html = injectInBody(html, '<script>NoodleApp.mount();<\/script>');
  return html;
}

/* ======================================================================
   The customize loop — the SAME contract play.html uses (runDiffPass).
   ====================================================================== */
const CONTRACT =
`You are customizing a small single-purpose web app. You edit two files — index.html and app.css —
restyling it, re-laying it out, and rewriting the visible copy (title, tagline, input labels, button
text, helper text) to fit the workflow described below. Keep it a clean, self-contained form-over-flow
UI: no frameworks, no external scripts or stylesheets. The app already has its working controls wired
up (run button, input area, status and output regions); keep those in place as you restyle.

Below is a description of the workflow this app is a front-end for. Use it to give the app a
fitting title, tagline, input labels, button text, and helper copy, and to reason about what the
user is trying to accomplish — then make their requested change in a way that serves that goal.`;

async function runDiffPass(files, graph, goal) {
  const env = buildEnvironment({ "index.html": files["index.html"], "app.css": files["app.css"] });
  const appDesc = NoodleApp.describeGraph(NoodleApp.materialize(graph));
  const prompt = CONTRACT + "\n\n--- WHAT THIS APP DOES ---\n" + appDesc + "\n--- END ---\n\nThe change to make: " + goal;
  const diff = await generateDiff(env, prompt, { apiKey: KEY, model: MODEL, callLlm });
  const parsed = parseDiffPerFile(diff);
  if (!diff.trim() || !parsed.length) return { ok: false, diff, files, reason: "no applicable change" };
  const before = { "index.html": files["index.html"], "app.css": files["app.css"] };
  const updated = await smartapply(diff, before, {
    apiKey: KEY, model: APPLY,
    callLlmForApply: (p, o, d, m, o2) => callLlmForApply(p, o, d, m, { ...o2, callLlm }),
  });
  return { ok: true, diff, parsed, files: { ...files, "index.html": updated["index.html"], "app.css": updated["app.css"] } };
}

/* ---------------------------------- main ---------------------------------- */
const [graphPath, outDir, ...goals] = process.argv.slice(2);
if (!graphPath || !outDir || !goals.length) {
  console.error('usage: node gptdiff-app-gen.mjs <graph.json> <out-dir> "goal 1" ["goal 2" ...]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const graph = JSON.parse(readFileSync(graphPath, "utf8"));

let files = defaultFiles(graph);
writeFileSync(join(outDir, "v0-index.html"), files["index.html"]);
writeFileSync(join(outDir, "v0-app.css"), files["app.css"]);
writeFileSync(join(outDir, "v0-describe.txt"), NoodleApp.describeGraph(NoodleApp.materialize(graph)));
writeFileSync(join(outDir, "v0-standalone.html"), bundle(files, graph));
console.log("v0 seed written (deterministic, no LLM). describeGraph:\n" + NoodleApp.describeGraph(NoodleApp.materialize(graph)) + "\n");

let v = 0;
for (const goal of goals) {
  v++;
  console.log(`\n=== customize v${v}: "${goal}" ===`);
  const t0 = Date.now();
  const res = await runDiffPass(files, graph, goal);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  writeFileSync(join(outDir, `v${v}-goal.txt`), goal);
  writeFileSync(join(outDir, `v${v}.diff`), res.diff || "");
  if (!res.ok) { console.log(`  ⚠ ${res.reason} (${secs}s) — diff saved for inspection`); continue; }
  files = res.files;
  writeFileSync(join(outDir, `v${v}-index.html`), files["index.html"]);
  writeFileSync(join(outDir, `v${v}-app.css`), files["app.css"]);
  writeFileSync(join(outDir, `v${v}-standalone.html`), bundle(files, graph));
  const titleMatch = files["index.html"].match(/<title>([^<]*)<\/title>/i);
  console.log(`  ✓ applied in ${secs}s · ${res.parsed.length} file(s) changed · title now "${(titleMatch && titleMatch[1]) || "?"}" · running cost $${callLlm._cost.toFixed(4)}`);
}
writeFileSync(join(outDir, "final-standalone.html"), bundle(files, graph));
console.log(`\nDONE. ${v} iteration(s). Total customize cost $${callLlm._cost.toFixed(4)}. Artifacts in ${outDir}`);
