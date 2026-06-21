export const meta = {
  name: 'noodle-app-builder',
  description: 'Build play.html: turn a nanoodle workflow into a shareable, customizable app',
  phases: [
    { title: 'Design', detail: 'extract headless runtime + draft app/bundler/customize code' },
    { title: 'Build', detail: 'assemble play.html, wire editor button, docs' },
    { title: 'Verify', detail: 'playwright smoke test + fidelity + integration/security review' },
    { title: 'Refine', detail: 'apply findings, re-run smoke test to green' },
  ],
}

const REPO = '/home/ntc/dev/nanoodle'

// ----------------------------------------------------------------------------
// AUTHORITATIVE SPEC — every agent gets this verbatim. Do not diverge from it.
// ----------------------------------------------------------------------------
const SPEC = `
FEATURE: "Create app" — turn a nanoodle workflow (node graph) into a standalone,
shareable, customizable web app. The graph is the engine; the app is a clean
form-over-flow UI (auto inputs -> Run -> outputs) that the user can restyle with
gptdiff-js, make fullscreen, share via link, and export as a self-contained file.

REPO: ${REPO} (single-file static site, no build step). Branch already checked out.
Reference patterns (READ them, do not modify them):
  - ${REPO}/index.html               (the nanoodle editor: graph model, engine, CTX, auth, share)
  - /home/ntc/dev/gptdiff-js-examples/marvis.html   (localStorage state, version history, #s= gzip share)
  - /home/ntc/dev/gptdiff-js-examples/overlay.html  (mini-bundler include directives, export bundle)
  - /home/ntc/dev/gptdiff-js-examples/index.html    (generateDiff/smartapply, streaming callLlm, iframe srcdoc preamble)

KEY FACTS about the editor (index.html), already verified — reuse, do not reinvent:
  - graph = { nodes:[{id,type,x,y,fields,out}], links:[{id,from:{node,port},to:{node,port}}] }
  - serializeGraph() shape: { v:1, nodes:[{id,type,x,y,fields}], links, nid, lid, view }
  - NODE_TYPES (index.html ~line 502-672): text, upload(Image input), join, llm, image, edit,
    vision, tvideo(Text->Video), ivideo(Image->Video), music, tts(Speech). Each has
    inputs[], outputs[{name,type}], and async run(n, inp, ctx).
  - Source nodes (no inputs): text, upload, llm, image, tvideo, music, tts. Sinks: nodes with
    no outgoing link. Engine: topoOrder + per-node run(n, inp, CTX); a link into a field name
    overrides that field (fieldOverrides). See index.html runGroup() ~1096-1129.
  - CTX (index.html ~1138-1214): genImage(prompt,model,size,imageDataUrl), genChat(messages,model),
    genVideo(model,prompt,opts,imageDataUrl,onProgress) [polls /api/video/status 5s/5min],
    genAudio(model,input,extra,onProgress) [POST /api/v1/audio/speech, may poll /api/tts/status].
    Endpoints: NANOGPT="https://nano-gpt.com", IMG /v1/images/generations, CHAT /api/v1/chat/completions.
    authHeaders(): { Authorization:Bearer<key>, x-api-key:<key>, Content-Type }. Helpers: mdl(n)
    resolves the chosen model id from n.fields; SIZES; audioRun/audioBody for music+tts; pollAudio.
  - Auth: OAuth PKCE + paste key, key in localStorage["ngpt_key"], client in ["ngpt_client"].
  - Share hash helpers in index.html: gzip/gunzip (CompressionStream), bytesToB64url/b64urlToBytes,
    copyText, toast. Graph share = "#g="+b64url(gzip(json)) or "#j="+b64url(json).

ARCHITECTURE (authoritative — build exactly this):

NEW FILE: ${REPO}/play.html — self-contained, no build step. ESM import of gptdiff-js from
  esm.sh allowed: import { buildEnvironment, generateDiff, smartapply, parseDiffPerFile,
  callLlmForApply, setEnv } from "https://esm.sh/gh/255BITS/gptdiff-js";

play.html has two layers:
  (1) BUILDER CHROME (outside any iframe): top bar with app title, a "Customize" box (goal
      <input> + Apply button) driving the gptdiff loop, a version-history strip, and buttons:
      [⛶ Fullscreen] [🔗 Share] [⭳ Export] [✎ Open in editor], plus an auth status + sign-in/
      paste-key UI (same pattern + same localStorage keys as index.html, so signing in once
      works across editor and app).
  (2) THE APP, rendered into a sandboxed <iframe id="appframe" sandbox="allow-scripts">. The
      srcdoc = withPreamble(bundle(files)). Preamble = marvis-style localStorage/sessionStorage
      shim + Escape->parent postMessage. After the iframe loads, the parent postMessages the
      current ngpt_key into it so the live preview runs WITHOUT re-auth. (Export/Share output
      must NOT contain the key — the recipient signs in with their own.)

EDITABLE VIRTUAL FS "files" (this is what gptdiff sees & edits):
  - "index.html" : the app shell. doctype + <head> with <style><!-- include: app.css --></style>,
    <body> with FIXED MOUNT POINTS the runtime binds to by id:
      #app-title, #app-tagline, #app-auth, #app-inputs, #app-run, #app-status, #app-output, #app-share.
    End of body: <!-- include-config: graph.json -->  then  <!-- include: runtime.js -->  then an
    inline boot <script> that calls NoodleApp.mount().
  - "app.css" : styling (gptdiff edits freely; default theme matches nanoodle dark UI).
  gptdiff edits ONLY these two. runtime.js and graph.json are NOT in the files map shown to it
  (injected by the bundler from fixed sources), so the engine can never be broken by a diff. The
  customize goal is prefixed with a short CONTRACT telling the model: it may restyle/relayout/
  rewrite copy in index.html + app.css, but MUST preserve the mount-point ids listed above.

FIXED RUNTIME (a string constant RUNTIME_JS inside play.html — the faithful headless engine,
  extracted from index.html). It defines:
    - NANOGPT consts, authHeaders(), getKey() (reads its own localStorage["ngpt_key"]), the full
      CTX (genImage/genChat/genVideo/genAudio + pollAudio + sleep + a no-op cost accrue), and the
      NODE_TYPES run map + helpers (mdl, SIZES, audioRun) — execution-only, NO editor DOM/body code.
    - topoOrder/ancestors/run loop (port wiring + fieldOverrides) ported from runGroup().
    - window.NoodleApp.mount(): reads window.NOODLE_GRAPH, computes INPUTS = source-node fields not
      satisfied by an incoming link (text.text, llm.prompt/system, image/tvideo/music/tts prompts,
      upload.image as a file picker, etc.), and OUTPUTS = sink nodes. Renders labeled controls into
      #app-inputs; wires #app-run to apply input values onto a clone of the graph, run it, stream
      per-node status into #app-status, and render terminal results into #app-output (img for image,
      <video controls> for video, <audio controls> for audio, text block for text). Renders its own
      auth UI into #app-auth (sign in / paste key) AND accepts a postMessaged key from the parent.
      Wires #app-share to call parent via postMessage('__share__') (the parent owns the link).
      Listens for parent fullscreen/key messages.
  RUNTIME_JS must be self-contained and run inside the sandboxed iframe with no external imports
  except fetch to nano-gpt.com.

BUNDLER bundle(files) (overlay.html style): returns ONE html string =
  files["index.html"] with: <!-- include: app.css --> -> the css text; <!-- include-config:
  graph.json --> -> <script>window.NOODLE_GRAPH = <json>;</script>; <!-- include: runtime.js -->
  -> <script>RUNTIME_JS</script>; any local <script src> inlined. This single string is BOTH the
  iframe srcdoc (via withPreamble) and the Export/Share payload.

DEFAULT app generation defaultFiles(graph): deterministic, NO LLM. Produces a working index.html
  shell + app.css themed like nanoodle (dark, accent #7c8cff). Title from the graph (or "My nanoodle
  App"), a tagline, the mount points, a primary Run button, output area, a Share button. Works the
  instant play.html opens — before any AI customization.

CUSTOMIZE loop (gptdiff): goal -> generateDiff(buildEnvironment({ "index.html":..., "app.css":... }),
  CONTRACT+goal, { apiKey, model: "xiaomi/mimo-v2.5-pro-ultraspeed", callLlm: streamingCallLlm() })
  -> parseDiffPerFile guard for no-op -> smartapply(diff, files, { apiKey, model, callLlmForApply })
  -> update files, pushVersion(files, goal), re-render iframe. streamingCallLlm streams the
  /api/v1/chat/completions SSE (Bearer key) and returns { choices:[{ message:{ content } }] }.
  Version strip: click a version to flip files (branch on edit, marvis/index pattern).

LOAD priority on play.html boot: location.hash "#a=" (full app spec {v,graph,files}, gzip) >
  "#g="/"#j=" (graph-only handoff from the editor -> defaultFiles) > localStorage "noodle_app_state"
  ({v,graph,files,versions,curVer}) > friendly empty state ("Open a workflow from the editor").
SHARE button (builder chrome): pack {v:1, graph, files} -> gzip -> b64url -> location +
  "#a="+packed, copy to clipboard, toast. (marvis #s= pattern, renamed #a=.)
EXPORT button: download bundle(files) as "<title>.html" (overlay pattern). No key inside.
FULLSCREEN: appframe.requestFullscreen().
PERSIST: localStorage "noodle_app_state" autosaved (debounced) on any change.

EDITOR INTEGRATION (edit ${REPO}/index.html):
  - Add a top-bar button after #share:  <button id="makeapp" title="Turn this workflow into a
    shareable app">✨ Create app</button>
  - Handler (near the other $("...").onclick lines): serialize the graph, reuse the EXISTING
    gzip()+bytesToB64url() helpers, window.open("play.html#g="+packed, "_blank"). Fallback: if the
    graph is empty, flash("add a node first"). Also stash localStorage["noodle_app_handoff"]=json
    as a belt-and-suspenders handoff that play.html reads if the hash is missing.
  - Do NOT otherwise refactor index.html. Keep the editor's inline engine untouched.

ROUTING: play.html is a real file; Cloudflare serves it at /play automatically (like landing).
  Do NOT add a _redirects rule for it (the file comment warns that collides/loops). Leave _redirects.
DOCS: add one bullet to ${REPO}/README.md describing play.html (the app builder / "Create app").

CONSTRAINTS: vanilla JS, no framework, no build. Match index.html's house style (concise, terse
  comments that explain WHY, CSS variables, the same dark theme tokens). Escape all user/graph text
  inserted into HTML (reuse an esc()). Must work over file:// (paste-key path) and https (OAuth).
  No secrets baked into exported/shared output. Keep play.html cohesive and readable.
`

// ----------------------------------------------------------------------------

phase('Design')

const design = await parallel([
  () => agent(
    `You are extracting a FAITHFUL headless execution runtime from the nanoodle editor.\n\n${SPEC}\n\n`
    + `YOUR TASK (read-only; produce code, write nothing): Read ${REPO}/index.html closely — the\n`
    + `NODE_TYPES map (~502-672), the run loop runGroup() (~1096-1135), CTX (~1138-1214), pollAudio,\n`
    + `authHeaders, mdl/SIZES/audioRun/audioBody helpers, topoOrder/ancestors/components.\n`
    + `Produce the COMPLETE JavaScript source for RUNTIME_JS: a single self-contained script (no\n`
    + `imports) that, when run inside the sandboxed app iframe, can execute window.NOODLE_GRAPH and\n`
    + `exposes window.NoodleApp.mount() exactly as the SPEC describes (auto inputs -> run -> outputs,\n`
    + `own auth UI + accept postMessaged key, share via postMessage). Port every node type's run()\n`
    + `verbatim in behavior (image data-url edits, video/audio polling, field overrides via links,\n`
    + `cycle handling). Return the full runtime as one fenced \`\`\`js block, preceded by a short bullet\n`
    + `list of every editor helper you depended on and how you reproduced it. Be exhaustive and exact;\n`
    + `this is the highest-risk correctness piece.`,
    { label: 'design:runtime', phase: 'Design', effort: 'high' }
  ),
  () => agent(
    `You are designing the app shell, bundler, and customize/share/export machinery.\n\n${SPEC}\n\n`
    + `YOUR TASK (read-only; produce code, write nothing): Read the three gptdiff-js-examples files\n`
    + `(marvis.html, overlay.html, index.html) for concrete patterns. Produce concrete, paste-ready\n`
    + `code blocks for everything in play.html EXCEPT RUNTIME_JS (another agent owns that):\n`
    + ` 1. defaultFiles(graph) -> { "index.html", "app.css" }: the deterministic default app shell\n`
    + `    (mount points exactly as SPEC) + a nanoodle-themed app.css. Show the full template strings.\n`
    + ` 2. bundle(files) mini-bundler (overlay style) + withPreamble() (marvis style) + the iframe\n`
    + `    render + parent<->iframe postMessage (inject key, fullscreen, receive __share__).\n`
    + ` 3. The gptdiff customize loop: streamingCallLlm(), the CONTRACT preamble, generateDiff +\n`
    + `    parseDiffPerFile no-op guard + smartapply, pushVersion/version-strip UI.\n`
    + ` 4. Load/boot priority (#a= > #g=/#j= > localStorage > empty), Share (#a= gzip), Export\n`
    + `    (download bundle), Fullscreen, persistence (localStorage "noodle_app_state"), auth chrome.\n`
    + `Also give the exact builder-chrome HTML/CSS for the top bar + customize box + version strip,\n`
    + `themed to match index.html. Return well-labeled fenced code blocks ready to assemble.`,
    { label: 'design:shell', phase: 'Design', effort: 'high' }
  ),
])

const RUNTIME_DESIGN = design[0] || '(runtime design agent returned nothing — derive it yourself from index.html)'
const SHELL_DESIGN = design[1] || '(shell design agent returned nothing — derive it yourself from the examples)'

// ----------------------------------------------------------------------------
phase('Build')

const buildReport = await agent(
  `You are the single writer assembling the feature into the repo. Branch is checked out.\n\n${SPEC}\n\n`
  + `Two design agents produced these (use them, but verify against the real source files; fix any\n`
  + `mistakes you spot — you own correctness):\n\n`
  + `===== RUNTIME DESIGN =====\n${RUNTIME_DESIGN}\n\n`
  + `===== SHELL / BUNDLER / CUSTOMIZE DESIGN =====\n${SHELL_DESIGN}\n\n`
  + `DO THIS:\n`
  + `1. Write ${REPO}/play.html — the complete, cohesive, self-contained page per the SPEC and the\n`
  + `   designs above. It must be production-quality and readable, matching index.html's house style.\n`
  + `2. Edit ${REPO}/index.html: add the #makeapp "✨ Create app" top-bar button after #share and its\n`
  + `   onclick handler (reuse the existing gzip/bytesToB64url helpers; window.open play.html#g=...;\n`
  + `   localStorage "noodle_app_handoff" fallback; flash if graph empty). Change NOTHING else there.\n`
  + `3. Add one README.md bullet describing play.html. Do NOT touch _redirects.\n`
  + `4. Syntax-check your work: extract the main inline <script> (and the RUNTIME_JS string body) from\n`
  + `   play.html to temp .mjs/.js files under /tmp and run \`node --check\` on them; fix any parse\n`
  + `   errors. (RUNTIME_JS is a template-string literal — check its body as standalone JS.) Also\n`
  + `   sanity-check that play.html has matching mount-point ids between the shell template and the\n`
  + `   runtime's mount() selectors.\n`
  + `Return: the list of files written/edited, the exact play.html line count, the result of your\n`
  + `node --check runs, and any spec points you deviated from and why. Be concise.`,
  { label: 'build:assemble', phase: 'Build', effort: 'high' }
)

// ----------------------------------------------------------------------------
phase('Verify')

const PW_SETUP =
  `Playwright 1.61 + chromium browsers are already cached at ~/.cache/ms-playwright. To run tests:\n`
  + `  mkdir -p /tmp/noodle-pw && cd /tmp/noodle-pw && npm init -y >/dev/null 2>&1 && npm i playwright >/dev/null 2>&1\n`
  + `  (browsers are cached so this only fetches the JS package; then \`import { chromium } from 'playwright'\`).\n`
  + `Load the app via  page.goto('file://${REPO}/play.html#g=<gzip-b64url of a sample serializeGraph json>')\n`
  + `OR set localStorage 'noodle_app_handoff' before load. Build a sample graph: a text node -> image\n`
  + `node, and a separate llm node, etc. Intercept ALL network with page.route('**://nano-gpt.com/**')\n`
  + `(and esm.sh if needed): return a 1x1 b64 PNG for /v1/images/generations, a chat completion for\n`
  + `/api/v1/chat/completions (also a streaming SSE variant for the customize path), COMPLETED status\n`
  + `for video/audio. Mock navigator.clipboard. Set localStorage['ngpt_key']='test-key' so run() proceeds.`

const reviews = await parallel([
  () => agent(
    `You are the SMOKE TESTER. Drive ${REPO}/play.html headlessly and report what actually works.\n\n${SPEC}\n\n${PW_SETUP}\n\n`
    + `BUILD REPORT FROM THE WRITER:\n${buildReport}\n\n`
    + `Write Playwright scripts under /tmp/noodle-pw and run them. Verify, with concrete assertions:\n`
    + ` - play.html loads with a graph handed via #g= ; the default app renders inputs for unwired\n`
    + `   source fields and an output area inside the #appframe iframe.\n`
    + ` - Clicking the app's Run (#app-run, inside the iframe) executes the graph against the MOCKED\n`
    + `   nano-gpt endpoints and renders the terminal output (img/text/etc) without uncaught errors.\n`
    + ` - Builder chrome: Fullscreen calls requestFullscreen on the iframe; Share writes a "#a=" link\n`
    + `   to the (mocked) clipboard and updates location.hash; Export triggers a download of an .html\n`
    + `   whose contents are a self-contained bundle that does NOT contain the test key.\n`
    + ` - The gptdiff Customize path: with a mocked streaming SSE diff that changes app.css, Apply\n`
    + `   updates the app and pushes a new version onto the strip. (Mock the SSE; do not call real LLM.)\n`
    + ` - Reload after edits restores from localStorage "noodle_app_state".\n`
    + ` - Collect ALL console errors and page errors. Report each check as PASS/FAIL with the exact\n`
    + `   error text on failure, and include the failing script path. Be specific and adversarial —\n`
    + `   try an empty graph and an upload(Image input) node too. Return a structured PASS/FAIL list.`,
    { label: 'verify:smoke', phase: 'Verify', effort: 'high' }
  ),
  () => agent(
    `You are a RUNTIME-FIDELITY reviewer (read-only). Compare the RUNTIME_JS and NoodleApp.mount in\n`
    + `${REPO}/play.html against the real engine in ${REPO}/index.html (NODE_TYPES, runGroup, CTX,\n`
    + `pollAudio, mdl/SIZES/audioRun, topoOrder, fieldOverrides).\n\n${SPEC}\n\n`
    + `Find every place the app would execute a graph DIFFERENTLY from the editor, or crash on a valid\n`
    + `graph. Check: all 11 node types ported correctly; image-edit data-url path; video & audio\n`
    + `polling loops + error/timeout handling; link-into-field overrides; cycle handling; model id\n`
    + `resolution (mdl); music vs tts; the upload(Image input) node as an app input; outputs chosen as\n`
    + `true sinks. Return a numbered list of concrete findings, each: severity (blocker/major/minor),\n`
    + `file:line, what's wrong, and the fix. If faithful, say so explicitly. Do not write files.`,
    { label: 'verify:fidelity', phase: 'Verify', effort: 'high' }
  ),
  () => agent(
    `You are an INTEGRATION & SECURITY reviewer (read-only) for this feature.\n\n${SPEC}\n\n`
    + `BUILD REPORT:\n${buildReport}\n\n`
    + `Review: (a) the index.html editor integration — the #makeapp button + handler: does it serialize\n`
    + `correctly, reuse existing helpers, handle empty graphs, and avoid regressing the editor? (b) the\n`
    + `bundler + share + export: confirm NO ngpt_key (or any secret) can leak into exported/shared\n`
    + `output, while the live in-iframe preview still gets the key via postMessage; check the iframe\n`
    + `sandbox flags; check HTML-escaping of graph/user text (XSS via node fields/titles); check the\n`
    + `#a=/#g=/#j= load priority and gzip round-trip; localStorage schema/versioning + quota handling.\n`
    + `(c) house-style + cohesion of play.html. Return numbered findings (severity, file:line, fix).\n`
    + `Do not write files.`,
    { label: 'verify:integration', phase: 'Verify', effort: 'high' }
  ),
])

// ----------------------------------------------------------------------------
phase('Refine')

const refineReport = await agent(
  `You are the FIXER. Apply the verification findings to the repo files and get the smoke test green.\n\n${SPEC}\n\n`
  + `BUILD REPORT:\n${buildReport}\n\n`
  + `===== SMOKE TEST RESULTS =====\n${reviews[0] || '(none)'}\n\n`
  + `===== RUNTIME FIDELITY FINDINGS =====\n${reviews[1] || '(none)'}\n\n`
  + `===== INTEGRATION/SECURITY FINDINGS =====\n${reviews[2] || '(none)'}\n\n${PW_SETUP}\n\n`
  + `DO THIS: Triage every blocker/major finding and fix it in ${REPO}/play.html (and index.html /\n`
  + `README.md if needed). Fix minors when cheap. Then RE-RUN the Playwright smoke test (reuse/repair\n`
  + `the tester's scripts under /tmp/noodle-pw) until the core path is green: graph loads, app renders,\n`
  + `Run produces output against mocked endpoints, Share/Export/Fullscreen/Customize work, no uncaught\n`
  + `console errors. Re-run node --check on the extracted scripts. Do NOT regress the editor.\n`
  + `Return: a concise changelog of fixes applied, which findings you deferred (with why), the final\n`
  + `smoke-test PASS/FAIL summary, and the final play.html line count.`,
  { label: 'refine:fix', phase: 'Refine', effort: 'high' }
)

return {
  build: buildReport,
  smoke: reviews[0],
  fidelity: reviews[1],
  integration: reviews[2],
  refine: refineReport,
}
