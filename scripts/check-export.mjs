#!/usr/bin/env node
// Verifies that a *exported* app is self-contained — i.e. it runs WITHOUT
// nanoodle (no editor, no play.html, no remote scripts/stylesheets).
//
// How it stays cheap (no browser, no npm, runs in the pre-commit hook):
//   1. Pull play.html's module script out as text.
//   2. Run it in a node:vm sandbox with tiny inert DOM/window stubs, but inject
//      a test hook the moment bundle()/defaultFiles() are defined and throw a
//      sentinel to stop before any of the editor's DOM-wiring code — so the
//      stub surface we must keep alive is small and stable.
//   3. Call bundle() to produce a real export, then assert it carries zero
//      external dependencies and node --check every inline <script> in it.
//
// That last step is the part check-html-js.mjs CAN'T do: there, RUNTIME_JS is
// just a string literal inside play.html's outer script, so its JS is never
// parsed. Here we materialize the export and check the runtime's real code.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = join(ROOT, "play.html");
const SENTINEL_KEY = "NOODLE_EXPORT_TEST_SECRET_KEY"; // must never appear in an export

// ---- 1. extract the module script block that defines the bundler ----------
function extractBundlerScript(html) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!/\bsrc=/i.test(m[1]) && /\bfunction bundle\s*\(/.test(m[2])) return m[2];
  }
  throw new Error("could not find the inline <script> defining bundle() in play.html");
}

// ---- 2. make it runnable under node:vm ------------------------------------
function prepare(code) {
  // Drop the gptdiff-js import (only used inside event handlers, never before
  // our hook) and stub the names so nothing can ReferenceError.
  code = code.replace(
    /import\s*\{[^}]*\}\s*from\s*["'][^"']*gptdiff-js[^"']*["'];?/,
    "const buildEnvironment=()=>({}),generateDiff=()=>{},smartapply=()=>{},parseDiffPerFile=()=>{},callLlmForApply=()=>{},setEnv=()=>{};",
  );

  // Inject the hook right after shareableGraph() — by then defaultFiles, bundle
  // and APP_STATE all exist — then throw to halt before the editor's DOM wiring.
  const anchor = "// SHARE: pack";
  const at = code.indexOf(anchor);
  if (at === -1)
    throw new Error(
      "anchor '// SHARE: pack' not found in play.html — update scripts/check-export.mjs to inject after the bundler is defined",
    );
  const hook =
    ";globalThis.__exportTest = {" +
    "  make(graph){" +
    "    APP_STATE.graph = graph || { nodes:[], links:[] };" +
    "    APP_STATE.files = defaultFiles(APP_STATE.graph);" +
    "    return bundle(APP_STATE.files);" +
    "  }" +
    "};" +
    "throw new Error('__EXPORT_TEST_HOOK_READY__');\n";
  return code.slice(0, at) + hook + code.slice(at);
}

// A self-returning, primitive-coercible, non-thenable proxy that absorbs every
// DOM access the top-of-module code makes before our hook fires.
function inert() {
  const fn = () => p;
  const p = new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === Symbol.iterator) return function* () {};
      if (prop === "then") return undefined; // never look like a Promise
      return p;
    },
    set: () => true,
    has: () => true,
    construct: () => p,
    apply: () => p,
  });
  return p;
}

function buildExport(graph) {
  const code = prepare(extractBundlerScript(readFileSync(PLAY, "utf8")));
  const doc = inert();
  const localStorage = {
    getItem: (k) => (k === "ngpt_key" ? SENTINEL_KEY : null),
    setItem: () => {},
    removeItem: () => {},
  };
  const ctx = {
    document: doc,
    localStorage,
    sessionStorage: localStorage,
    location: { origin: "", pathname: "", hash: "", href: "", replace() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    addEventListener() {},
    removeEventListener() {},
    setTimeout() {},
    clearTimeout() {},
    fetch: () => Promise.reject(new Error("no network in export test")),
    console,
    TextEncoder,
    TextDecoder,
    URL,
    btoa,
    atob,
    crypto,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.window.parent = ctx; // IN_EDITOR-style checks: not in an editor frame
  vm.createContext(ctx);
  try {
    new vm.Script(code, { filename: "play.html#module" }).runInContext(ctx);
  } catch (e) {
    if (!String(e && e.message).includes("__EXPORT_TEST_HOOK_READY__")) throw e;
  }
  if (!ctx.__exportTest) throw new Error("export test hook did not initialize");
  return ctx.__exportTest.make(graph);
}

// ---- 3. assertions: the export must run standalone ------------------------
const MOUNT_IDS = ["app-title", "app-tagline", "app-auth", "app-inputs", "app-run", "app-loop", "app-count", "app-status", "app-output"];

function assertStandalone(out, failures) {
  const fail = (msg) => failures.push(msg);

  if (/<!--\s*include(-config)?:/.test(out)) fail("unresolved <!-- include --> marker — a build include was not inlined");
  if (/<!--\s*missing:/.test(out)) fail("export references a missing local file (<!-- missing: ... -->)");
  if (/<script\b[^>]*\bsrc\s*=/i.test(out)) fail("export has a <script src=...> — external script means it can't run standalone");
  if (/<link\b[^>]*href\s*=\s*["'](?:https?:)?\/\//i.test(out)) fail("export links a remote stylesheet — not self-contained");
  if (/@import\s+(?:url\()?["']?(?:https?:)?\/\//i.test(out)) fail("export @imports a remote stylesheet — not self-contained");
  if (out.includes(SENTINEL_KEY)) fail("export embeds the API key — exports must never contain a key");

  if (!/NoodleApp\s*\.\s*mount\s*\(/.test(out)) fail("export has no NoodleApp.mount() call — runtime would never start");
  if (!/window\.NOODLE_GRAPH\s*=/.test(out)) fail("export has no window.NOODLE_GRAPH — the workflow graph is missing");
  if (!/window\.NoodleApp\b/.test(out)) fail("export does not define window.NoodleApp — the runtime is missing");
  for (const id of MOUNT_IDS) if (!out.includes(`id="${id}"`)) fail(`export is missing mount point id="${id}"`);
}

// node --check every inline <script> in the export — this is what actually
// proves the runtime's JS parses (and would run) outside nanoodle.
function assertInlineJsParses(out, failures, tmp) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, n = 0;
  while ((m = re.exec(out))) {
    if (/\bsrc=/i.test(m[1])) continue;
    const code = m[2].trim();
    if (!code) continue;
    n++;
    const f = join(tmp, `block${n}.mjs`);
    writeFileSync(f, code);
    try {
      execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
    } catch (e) {
      const msg = (e.stderr || e.stdout || "").toString().replace(/\S*block\d+\.mjs/g, `export inline script #${n}`);
      failures.push("syntax error in an exported inline script:\n" + msg.replace(/\n+$/, ""));
    }
  }
  if (n === 0) failures.push("export contained no inline scripts — bundling produced nothing runnable");
}

// The embedded NOODLE_GRAPH is hand-escaped (< > and line/paragraph separators)
// so a graph value can never break out of its <script>. Pull the graph back out
// of the export, run it, and confirm it round-trips to the exact input — if any
// escaping were dropped, the value would corrupt or the JSON would fail to parse.
function assertGraphRoundTrips(out, original, failures) {
  const block = [...out.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).find((c) => /window\.NOODLE_GRAPH\s*=/.test(c));
  if (!block) return failures.push("export has no NOODLE_GRAPH block to verify escaping against");
  let parsed;
  try {
    const w = {};
    vm.runInNewContext(block, { window: w });
    parsed = w.NOODLE_GRAPH;
  } catch (e) {
    return failures.push("embedded NOODLE_GRAPH did not parse — graph escaping is broken: " + (e && e.message));
  }
  const got = parsed?.nodes?.find((n) => n.id === original.id)?.fields?.text;
  if (got !== original.text) failures.push(`graph value did not survive embedding (escaping bug):\n  sent: ${JSON.stringify(original.text)}\n  got:  ${JSON.stringify(got)}`);
  if (out.includes("</script><img")) failures.push("a graph value broke out of its <script> — '</script><img' appears raw in the export");
}

// ---- run ------------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), "export-check-"));
const failures = [];
try {
  // A representative graph (an upload + a prompt node) exercises shareableGraph's
  // image-stripping and a non-empty NOODLE_GRAPH payload; the standalone contract
  // is graph-independent, so this also covers the empty-graph default.
  assertStandalone(buildExport({
    nodes: [
      { id: "u1", type: "upload", fields: { image: "data:image/png;base64,AAAA" } },
      { id: "p1", type: "prompt", fields: { text: "Describe {{u1}}" } },
    ],
    links: [{ from: "u1", to: "p1" }],
  }), failures);

  // Privacy: uploaded media (upload nodes) AND an inpaint node's source photo + brushed
  // mask are the user's own data — they must NEVER ride along in an exported file (or share
  // link). Build an export whose nodes carry sentinel media and assert the bytes are stripped
  // from NOODLE_GRAPH. Regression guard for the inpaint leak (image/mask were not blanked).
  const MEDIA_LEAKS = {
    "upload image": "UPLOADIMGLEAK",
    "inpaint source photo": "INPAINTSRCLEAK",
    "inpaint mask": "INPAINTMASKLEAK",
  };
  const mediaExport = buildExport({
    nodes: [
      { id: "u1", type: "upload", fields: { image: "data:image/png;base64," + MEDIA_LEAKS["upload image"] } },
      { id: "ip1", type: "inpaint", fields: {
        image: "data:image/png;base64," + MEDIA_LEAKS["inpaint source photo"],
        mask: "data:image/png;base64," + MEDIA_LEAKS["inpaint mask"],
        prompt: "repaint the sky",
      } },
    ],
    links: [],
  });
  for (const [what, marker] of Object.entries(MEDIA_LEAKS)) {
    if (mediaExport.includes(marker)) failures.push(`export leaks the ${what} — shareableGraph did not strip it from the exported graph`);
  }

  // Adversarial graph: a field value that tries to break out of the <script>
  // and a line/paragraph separator that would corrupt an unescaped JS string.
  const evil = { id: "p1", text: "</script><img src=x onerror=alert(1)>   & <b>ok</b>" };
  const advExport = buildExport({ nodes: [{ id: "p1", type: "prompt", fields: { text: evil.text } }], links: [] });
  assertStandalone(advExport, failures);
  assertInlineJsParses(advExport, failures, tmp);
  assertGraphRoundTrips(advExport, evil, failures);
} catch (e) {
  failures.push("export could not be built: " + (e && e.stack ? e.stack : e));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures.length) {
  process.stderr.write("✗ exported app is NOT self-contained:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ exported app is self-contained and runs without nanoodle.\n");
