#!/usr/bin/env node
// Verifies the SHARE → SHORTEN flow in index.html AND play.html hands the
// shortener the FULL payload-bearing link — not a bare URL.
//
// The regression this pins (fixed 2026-06-30): the share flow strips the
// #a=/#g= payload back out of the address bar right after copying (so a
// leftover handoff hash isn't re-imported as a duplicate on reload). The
// "Shorten" button used to rebuild the URL from location.hash — empty by
// then — so the shortener received a bare page and returned a short link to
// an EMPTY app. Every prettified share link (the ones people actually paste
// into Reddit/Discord/tweets) silently pointed at nothing.
//
// Also pinned here (2026-07-10, reworked 2026-07-16 for the first-party
// nanolink shortener that replaced TinyURL/da.gd):
//   - packShareFit strips baked-in media samples (never the compact text ones)
//     when the link would overflow the SHARE_FIT_MAX raw-link budget, and
//     REPORTS the cut so the share toast can tell the creator.
//   - past the nanolink store ceiling (128 KiB) the shorten button greys out
//     with a note, and the social row blanks (X/Reddit/Facebook reject
//     multi-kB URLs outright).
//
// No browser, no network, no inference. We lift the shipped code pieces
// out of the HTML as text and run them against stubs, reproducing the exact
// bug condition:
//   1. openShareMenu(LONG_URL_WITH_FRAGMENT)  — the popover captures the link
//   2. location.hash = ""                     — the share flow strips it
//   3. fire the shortener button's click handler
//   4. assert the URL passed to the shortener STILL carries the fragment
// Old code (longUrl from location.hash) fails step 4; the fix passes it.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const failures = [];
const fail = (file, msg) => failures.push(`${file}: ${msg}`);

// ---- a JS-string/comment/template-aware matcher for the body of `{ ... }` ---
// Returns the index of the `}` that closes the `{` at openIdx.
function matchBrace(src, openIdx) {
  let depth = 0;
  // for each open template `${` interpolation, the code-brace depth that existed
  // just BEFORE it opened — so the `}` that closes the interpolation (which drops
  // depth back to that level) returns us to template (string) mode, not code.
  const tmpl = [];
  let mode = "code"; // code | sq | dq | tpl | line | block
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i++; }
      else if (c === "/" && n === "*") { mode = "block"; i++; }
      else if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (tmpl.length && depth === tmpl[tmpl.length - 1]) { tmpl.pop(); mode = "tpl"; }
        else if (depth === 0) return i;
      }
    } else if (mode === "line") { if (c === "\n") mode = "code"; }
    else if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i++; } }
    else if (mode === "sq") { if (c === "\\") i++; else if (c === "'") mode = "code"; }
    else if (mode === "dq") { if (c === "\\") i++; else if (c === '"') mode = "code"; }
    else if (mode === "tpl") {
      if (c === "\\") i++;
      else if (c === "`") mode = "code";
      else if (c === "$" && n === "{") { mode = "code"; tmpl.push(depth); depth++; i++; }
    }
  }
  throw new Error("unbalanced braces from index " + openIdx);
}

// pull `[async] function <name>(...) { ... }` out as text (keep `async` — dropping it
// turns every `await` in the body into a syntax error)
function extractFunction(src, name) {
  const sig = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}()`);
  const open = src.indexOf("{", m.index);
  const close = matchBrace(src, open);
  return src.slice(m.index, close + 1);
}

// pull `const <name> = { ... };` out as text (single-level object literal)
function extractConst(src, name) {
  const m = new RegExp("const\\s+" + name + "\\s*=\\s*\\{[^{}]*\\};?").exec(src);
  if (!m) throw new Error(`could not find const ${name}`);
  return m[0];
}

// pull `const <name> = <number>;` out as text
function extractNumConst(src, name) {
  const m = new RegExp("const\\s+" + name + "\\s*=\\s*\\d+;?").exec(src);
  if (!m) throw new Error(`could not find const ${name}`);
  return m[0];
}

// pull the shorten button's click handler BODY out as text (the async arrow
// wired onto each .sm-svc button). Anchored on the exact wiring line.
function extractShortenHandlerBody(src) {
  const anchor = '.sm-svc button").forEach(btn => btn.onclick = async ()=>';
  const at = src.indexOf(anchor);
  if (at === -1) throw new Error("could not find the shorten-button wiring (.sm-svc button …onclick)");
  const open = src.indexOf("{", at + anchor.length);
  const close = matchBrace(src, open);
  return src.slice(open + 1, close); // inside the braces
}

// which capture variable does openShareMenu assign the opened URL into?
function captureVar(openFnText) {
  const m = /\b(\w+)\s*=\s*url\s*;/.exec(openFnText);
  if (!m) throw new Error("openShareMenu() no longer captures the URL into a variable");
  return m[1];
}

const FRAG = "https://nanoodle.example/APP#a=PAYLOAD_MUST_SURVIVE_123";
const FRAG_MARK = "#a=PAYLOAD_MUST_SURVIVE_123";

async function checkFile(file) {
  const src = readFileSync(join(ROOT, file), "utf8");
  let openFn, handlerBody, capVar, syncFn, ceilings;
  try {
    openFn = extractFunction(src, "openShareMenu");
    handlerBody = extractShortenHandlerBody(src);
    capVar = captureVar(openFn);
    syncFn = extractFunction(src, "syncShortenButtons");
    ceilings = extractConst(src, "SHORTEN_CEILING");
  } catch (e) {
    fail(file, e.message);
    return;
  }

  // record what the shortener was actually handed
  const shortenCalls = [];
  // memoized per-id elements so assertions can observe what the shipped code set
  const els = {};
  const stubs = {
    $: (id) => els[id] || (els[id] = { hidden: false, value: "", textContent: "", select() {}, setAttribute() {} }),
    setShareUrl: () => {},
    copyText: async () => true,
    toast: () => {},
    shortenWith: async (_svc, url) => { shortenCalls.push(url); return "https://sh.rt/x"; },
    location: { origin: "https://nanoodle.example", pathname: "/APP", search: "", hash: "" },
  };
  // the (single, first-party nanolink) shorten button + the social row syncShortenButtons
  // blanks when no shortener can serve the link (social intents reject multi-kB URLs outright)
  const btn = { dataset: { svc: "nanolink" }, textContent: "nanolink", disabled: false };
  const socialHead = { hidden: false };
  const socialRow = { hidden: false, previousElementSibling: socialHead };
  stubs.document = {
    querySelectorAll: (sel) => (/sm-social/.test(sel) ? [] : [btn]),
    querySelector: (sel) => (/sm-social/.test(sel) ? socialRow : null),
  };

  // Assemble a runnable program from the SHIPPED source pieces. `capVar` is the
  // module-level capture var openShareMenu writes and the handler reads. After the
  // normal flow, re-open the popover with a link past every shortener's ceiling —
  // the buttons must grey out and the "too long" note must appear (2026-07-10 fix:
  // baked-in-image links used to surface the services' raw HTML error pages).
  const program =
    `let ${capVar} = "";\n` +
    ceilings + "\n" +
    syncFn + "\n" +
    openFn + "\n" +
    `const __click = async (btn) => {${handlerBody}};\n` +
    `return (async () => {\n` +
    `  openShareMenu(FRAG);\n` +           // popover captures the full link
    `  const socialSmall = socialRow.hidden;\n` +  // a shortenable link must keep the social row
    `  location.hash = "";\n` +            // share flow strips the address-bar hash
    `  await __click(btn);\n` +            // user clicks "Shorten"
    `  const got = ${capVar};\n` +
    `  openShareMenu(BIG);\n` +            // media-heavy link: past the 128 KiB nanolink ceiling
    `  return { got, socialSmall };\n` +
    `})();`;

  const BIG = "https://nanoodle.example/APP#a=" + "A".repeat(140000);
  const extras = { btn, FRAG, BIG, socialRow };
  const names = Object.keys(stubs).concat(Object.keys(extras));
  let captured, socialSmall;
  try {
    const fn = new Function(...names, program);
    ({ got: captured, socialSmall } = await fn(...names.map((k) => (k in extras ? extras[k] : stubs[k]))));
  } catch (e) {
    fail(file, "share/shorten flow threw: " + (e && e.message ? e.message : e));
    return;
  }

  if (captured !== FRAG)
    fail(file, `openShareMenu did not capture the full link (${capVar}=${JSON.stringify(captured)})`);
  if (socialSmall !== false)
    fail(file, "a comfortably-shortenable link hid the social share row — it should only blank past the nanolink ceiling");
  if (shortenCalls.length !== 1) {
    fail(file, `expected exactly one shorten call, got ${shortenCalls.length}`);
    return;
  }
  const sent = shortenCalls[0];
  if (!sent.includes(FRAG_MARK))
    fail(file, `the shortener was handed a link with NO payload fragment (${JSON.stringify(sent)}) — short links would open an empty app`);
  else if (sent !== FRAG)
    fail(file, `the shortener was handed an altered link: ${JSON.stringify(sent)}`);
  // the over-ceiling reopen: no dead-end buttons, and the note says why
  if (!btn.disabled)
    fail(file, "a link past the shortener ceilings left the shorten button enabled — clicking it is a guaranteed dead end");
  const note = els["sm-toolong"];
  if (!note || note.hidden !== false || !/kB/.test(note.textContent))
    fail(file, "a link past the shortener ceilings did not surface the too-long note (#sm-toolong with a kB size)");
  if (socialRow.hidden !== true || socialHead.hidden !== true)
    fail(file, "a link past the shortener ceilings left the social share row visible — X/Reddit/Facebook reject multi-kB URLs, so every click is a dead end");
}

// ---- packShareFit: shrink baked-in media (given a shrinker) or strip it (never the compact
// text samples) to fit the SHARE_FIT_MAX raw-link budget, report what was compressed/cut so
// the share toast can tell the creator, and expose alt {media, noMedia} endpoints for the
// popover's preview-image toggle. ----
async function checkPackFit(file) {
  const src = readFileSync(join(ROOT, file), "utf8");
  let program;
  try {
    program =
      extractNumConst(src, "SHARE_FIT_MAX") + "\n" +
      extractFunction(src, "packShareFit") + "\n" +
      "return packShareFit(base, samples, prefix, shrinkMedia);";
  } catch (e) {
    fail(file, e.message);
    return;
  }
  // Track the shipped fit budget instead of hardcoding it — it's the raw-link-survives-
  // messengers figure (~9k), well under nanolink's 128 KiB store ceiling (see the
  // SHARE_FIT_MAX comment in the HTML).
  const FIT = Number((extractNumConst(src, "SHARE_FIT_MAX").match(/=\s*(\d+)/) || [])[1]);
  // Node-native stand-ins for the browser helpers packShareFit leans on (matchBrace can't
  // lex the shipped bytesToB64url — its /\//g regex literal reads as a line comment — and
  // their exact bytes aren't the contract here; the tiering logic is).
  const { gzipSync } = await import("node:zlib");
  const gzip = async (str) => gzipSync(Buffer.from(str));
  const bytesToB64url = (bytes) => Buffer.from(bytes).toString("base64url");
  const run = (base, samples, shrinkMedia) =>
    new Function("base", "samples", "prefix", "gzip", "bytesToB64url", "shrinkMedia", program)(
      base, samples, "https://nanoodle.example/play.html", gzip, bytesToB64url, shrinkMedia);
  // incompressible junk (sha256 chain — deterministic run to run) so gzip can't rescue the link
  const { createHash } = await import("node:crypto");
  const junk = (n) => {
    let out = "", block = Buffer.from("nanoodle-share-fit-seed");
    while (out.length < n) { block = createHash("sha256").update(block).digest(); out += block.toString("base64"); }
    return out.slice(0, n);
  };
  const base = { v: 1, graph: { nodes: [], wires: [] }, files: { "index.html": "<html>app</html>" } };
  const mediaSample = { id: "n1", type: "image", port: "image", ptype: "image", v: "data:image/jpeg;base64," + junk(90000) };
  const textSample = { id: "n2", type: "llm", port: "text", ptype: "text", v: "a tiny text preview" };
  try {
    // media blows the ceiling → the image goes, the text preview stays, the link fits
    const stripped = await run(base, [mediaSample, textSample]);
    if (stripped.url.length > FIT || !stripped.url.includes("#a="))
      fail(file, `packShareFit shipped a link no shortener can take (${stripped.url.length} chars) instead of stripping media`);
    if (stripped.stripped !== "media")
      fail(file, `packShareFit cut media without reporting it (stripped=${JSON.stringify(stripped.stripped)}) — the creator hears nothing`);
    if (stripped.hasSample !== true)
      fail(file, "packShareFit dropped the compact text sample too — only baked-in media needed to go");
    // …and the popover's preview toggle gets both endpoints: the (over-ceiling) with-media
    // link and the stripped one it shipped.
    if (!stripped.alt || typeof stripped.alt.media !== "string" || stripped.alt.noMedia !== stripped.url)
      fail(file, "packShareFit did not expose alt {media, noMedia} for the preview toggle on a media-bearing share");
    // given a shrinker, media gets re-encoded smaller instead of dropped — the preview survives
    const shrunk = await run(base, [mediaSample, textSample],
      async () => "data:image/jpeg;base64," + junk(2000));
    if (shrunk.stripped !== "shrunk" || shrunk.hasSample !== true || shrunk.url.length > FIT)
      fail(file, `packShareFit ignored the media shrinker (stripped=${JSON.stringify(shrunk.stripped)}, ${shrunk.url.length} chars) — it dropped a preview it could have compressed`);
    if (!shrunk.alt || shrunk.alt.media !== shrunk.url || !(shrunk.alt.noMedia.length < shrunk.alt.media.length))
      fail(file, "packShareFit's alt endpoints are wrong on a shrunk share — the preview toggle would swap to the wrong link");
    // everything fits → nothing stripped, sample rides along
    const fits = await run(base, [textSample]);
    if (fits.stripped !== null || fits.hasSample !== true)
      fail(file, `packShareFit touched a link that already fit (stripped=${JSON.stringify(fits.stripped)}, hasSample=${fits.hasSample})`);
    // no samples at all → still packs, flags nothing
    const bare = await run(base, []);
    if (bare.stripped !== null || bare.hasSample !== false || !bare.url.includes("#a="))
      fail(file, "packShareFit mishandled a sample-less share");
    // even the bare app overflows → return the full-fidelity link (popover greys the dead ends)
    const huge = await run({ ...base, files: { "index.html": junk(120000) } }, [mediaSample]);
    if (huge.stripped !== null || huge.url.length <= FIT)
      fail(file, "packShareFit stripped samples from a link that overflows either way — that loses the preview for nothing");
  } catch (e) {
    fail(file, "packShareFit threw: " + (e && e.message ? e.message : e));
  }
}

try {
  await checkFile("index.html");
  await checkFile("play.html");
  await checkPackFit("index.html");
  await checkPackFit("play.html");
} catch (e) {
  fail("check-share-link", "harness error: " + (e && e.stack ? e.stack : e));
}

if (failures.length) {
  process.stderr.write("✗ share-link shortening is broken:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ share links keep their payload through shortening (editor #g= and app #a=).\n");
