#!/usr/bin/env node
// Verifies the SHARE → SHORTEN flow in index.html AND play.html hands the
// shortener the FULL payload-bearing link — not a bare URL.
//
// The regression this pins (fixed 2026-06-30): the share flow strips the
// #a=/#g= payload back out of the address bar right after copying (so a
// leftover handoff hash isn't re-imported as a duplicate on reload). The
// "Shorten" buttons used to rebuild the URL from location.hash — empty by
// then — so TinyURL/da.gd received a bare page and returned a short link to
// an EMPTY app. Every prettified share link (the ones people actually paste
// into Reddit/Discord/tweets) silently pointed at nothing.
//
// No browser, no network, no inference. We lift the two shipped code pieces
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

// pull `function <name>(...) { ... }` out as text
function extractFunction(src, name) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}()`);
  const open = src.indexOf("{", m.index);
  const close = matchBrace(src, open);
  return src.slice(m.index, close + 1);
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
  let openFn, handlerBody, capVar;
  try {
    openFn = extractFunction(src, "openShareMenu");
    handlerBody = extractShortenHandlerBody(src);
    capVar = captureVar(openFn);
  } catch (e) {
    fail(file, e.message);
    return;
  }

  // record what the shortener was actually handed
  const shortenCalls = [];
  const stubs = {
    $: () => ({ hidden: false, value: "", select() {} }),
    setShareUrl: () => {},
    copyText: async () => true,
    toast: () => {},
    shortenWith: async (_svc, url) => { shortenCalls.push(url); return "https://sh.rt/x"; },
    location: { origin: "https://nanoodle.example", pathname: "/APP", search: "", hash: "" },
  };
  // one fake shorten button (TinyURL); document.querySelectorAll returns [it]
  const btn = { dataset: { svc: "tinyurl" }, textContent: "TinyURL", disabled: false };
  stubs.document = { querySelectorAll: () => [btn] };

  // Assemble a runnable program from the SHIPPED source pieces. `capVar` is the
  // module-level capture var openShareMenu writes and the handler reads.
  const program =
    `let ${capVar} = "";\n` +
    openFn + "\n" +
    `const __click = async (btn) => {${handlerBody}};\n` +
    `return (async () => {\n` +
    `  openShareMenu(FRAG);\n` +           // popover captures the full link
    `  location.hash = "";\n` +            // share flow strips the address-bar hash
    `  await __click(btn);\n` +            // user clicks "Shorten → TinyURL"
    `  return ${capVar};\n` +
    `})();`;

  const names = Object.keys(stubs).concat(["btn", "FRAG"]);
  let captured;
  try {
    const fn = new Function(...names, program);
    captured = await fn(...names.map((k) => (k === "btn" ? btn : k === "FRAG" ? FRAG : stubs[k])));
  } catch (e) {
    fail(file, "share/shorten flow threw: " + (e && e.message ? e.message : e));
    return;
  }

  if (captured !== FRAG)
    fail(file, `openShareMenu did not capture the full link (${capVar}=${JSON.stringify(captured)})`);
  if (shortenCalls.length !== 1) {
    fail(file, `expected exactly one shorten call, got ${shortenCalls.length}`);
    return;
  }
  const sent = shortenCalls[0];
  if (!sent.includes(FRAG_MARK))
    fail(file, `the shortener was handed a link with NO payload fragment (${JSON.stringify(sent)}) — short links would open an empty app`);
  else if (sent !== FRAG)
    fail(file, `the shortener was handed an altered link: ${JSON.stringify(sent)}`);
}

try {
  await checkFile("index.html");
  await checkFile("play.html");
} catch (e) {
  fail("check-share-link", "harness error: " + (e && e.stack ? e.stack : e));
}

if (failures.length) {
  process.stderr.write("✗ share-link shortening is broken:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ share links keep their payload through shortening (editor #g= and app #a=).\n");
