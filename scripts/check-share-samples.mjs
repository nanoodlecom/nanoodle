#!/usr/bin/env node
// Creator samples in #a= shares — the keyless /play wow for share-link recipients.
//
// Problem: a recipient of a shared app never saw what it produces until they signed in
// and spent. The kind-aware empty placeholder (#216) names the media type but shows no
// real result. This layer bakes portable creator results (thumbs/text) into the share
// payload so mount() can paint "sample result" cards before any key.
//
// Offline, no network, no inference. We pin the wire contract by grepping the shipped
// play.html source for the critical chokepoints (pack, inject, paint, clear, size caps)
// and by lifting sanitizeSamples() into a node:vm sandbox to verify the budget rules.
//
// Invariants:
//   S1. doShare asks the iframe for samples (__getsamples__) and packs them into #a=
//   S2. #a= import passes spec.samples into installApp
//   S3. bundle injects window.NOODLE_SAMPLES (ENGINE.samples)
//   S4. mount paints samples (renderShareSamples) before the empty placeholder
//   S5. run() and renderResult clear samples so real output wins
//   S6. restoreOutputs does not treat sample cards as real results
//   S7. size caps exist (SAMPLE_BUDGET / SAMPLE_MAX / SAMPLE_TEXT_MAX / SAMPLE_IMG_EDGE)
//   S8. sanitizeSamples drops oversize / non-portable values
//   S9. shareableGraph still blanks uploads — samples must never be the upload path
//  S10. sample badge i18n keys exist in PLAY_I18N (5 languages) + badge is auth-aware
//  S11. pre-commit trigger fires on every file this checker asserts (index.html too)

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = join(ROOT, "play.html");
const html = readFileSync(PLAY, "utf8");

const failures = [];
const fail = (id, msg) => failures.push(`${id}: ${msg}`);
const ok = (id, cond, detail) => { if (!cond) fail(id, detail || "failed"); };

function matchBrace(src, openIdx) {
  let depth = 0;
  const tmpl = [];
  let mode = "code";
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

function extractFn(src, name) {
  const sig = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}()`);
  const open = src.indexOf("{", m.index);
  const close = matchBrace(src, open);
  return src.slice(m.index, close + 1);
}

// ---- S1: Share packs samples -------------------------------------------------
ok("S1a", /function\s+askAppSamples\s*\(/.test(html), "askAppSamples() missing");
ok("S1b", /type:\s*["']__getsamples__["']/.test(html), "parent never posts __getsamples__");
ok("S1c", /type:\s*["']__samples__["']/.test(html), "__samples__ reply missing");
const doShare = extractFn(html, "doShare");
ok("S1d", /askAppSamples\s*\(/.test(doShare), "doShare does not ask for samples");
ok("S1e", /\bsamples\b/.test(doShare) && /JSON\.stringify\s*\(\s*payload\s*\)/.test(doShare),
  "doShare does not pack samples into the #a= payload");
ok("S1f", /200000/.test(doShare), "doShare missing soft size ceiling for samples");

// ---- S1g: editor buildShareUrl("app") packs samples + lang (parity with doShare)
// Cookoff Submit / editor "share as app" used to ship {v,graph,files} only, so
// recipients of contest/editor #a= links never got the pre-sign-in sample preview.
{
  const IDX = join(ROOT, "index.html");
  const idxHtml = readFileSync(IDX, "utf8");
  let buildShare;
  try { buildShare = extractFn(idxHtml, "buildShareUrl"); }
  catch (e) { fail("S1g", "index.html buildShareUrl missing: " + e.message); buildShare = ""; }
  ok("S1g", /\bsamples\b/.test(buildShare) && /app\.samples/.test(buildShare),
    "editor buildShareUrl does not pack app.samples into the #a= payload (parity with play doShare)");
  ok("S1h", /app\.lang/.test(buildShare) || /\blang\b/.test(buildShare),
    "editor buildShareUrl does not pack app.lang into the #a= payload");
  ok("S1i", /200000/.test(buildShare),
    "editor buildShareUrl missing soft size ceiling for samples (must match doShare)");
  // Lang parity with play's bakedAppLang(): stored app.lang, else the creator's EXPLICIT
  // editor choice (localStorage noodle_lang) — the two share paths must bake the same lang.
  ok("S1j", /noodle_lang/.test(buildShare),
    "editor buildShareUrl lacks the explicit noodle_lang fallback (parity with play bakedAppLang)");
}

// ---- S1k: share/export must not race an app switch ----------------------------
// doShare/doExport await askAppSamples() for up to 2s; APP_STATE reads after that
// await belong to whatever app is open THEN. Both must snapshot CUR_ID before the
// await and discard when it changed — never share/export/stamp the wrong app.
{
  ok("S1k-share", /CUR_ID\s*!==\s*_id/.test(doShare),
    "doShare has no CUR_ID app-switch guard across the askAppSamples await");
  const shareAsk = doShare.indexOf("askAppSamples");
  const shareSnap = doShare.indexOf("_id = CUR_ID");
  ok("S1k-share-order", shareSnap >= 0 && shareAsk > shareSnap,
    "doShare must snapshot CUR_ID BEFORE awaiting askAppSamples");
  let doExportFn = "";
  try { doExportFn = extractFn(html, "doExport"); }
  catch (e) { fail("S1k-export", "doExport missing: " + e.message); }
  ok("S1k-export", /CUR_ID\s*!==\s*_id/.test(doExportFn),
    "doExport has no CUR_ID app-switch guard across the askAppSamples await");
  const expAsk = doExportFn.indexOf("askAppSamples");
  const expSnap = doExportFn.indexOf("_id = CUR_ID");
  ok("S1k-export-order", expSnap >= 0 && expAsk > expSnap,
    "doExport must snapshot CUR_ID BEFORE awaiting askAppSamples");
}

// ---- S2: import carries samples ---------------------------------------------
ok("S2", /installApp\(\{[^}]*samples:\s*spec\.samples/.test(html.replace(/\s+/g, " ")),
  "#a= import does not pass spec.samples into installApp");

// ---- S3: bundle injects NOODLE_SAMPLES ---------------------------------------
ok("S3a", /window\.NOODLE_SAMPLES\s*=/.test(html), "NOODLE_SAMPLES injection missing");
ok("S3b", /ENGINE\.samples\s*\(/.test(html) || /samples:\s*\(\)\s*=>/.test(html),
  "ENGINE.samples missing");
ok("S3c", /ENGINE\.samples\(\)/.test(html), "bundle never calls ENGINE.samples()");

// ---- S4: mount paints samples -----------------------------------------------
ok("S4a", /function\s+renderShareSamples\s*\(/.test(html), "renderShareSamples missing");
ok("S4b", /renderShareSamples\s*\(\s*bakedSamples\s*\)/.test(html)
       || /renderShareSamples\s*\([^)]*NOODLE_SAMPLES/.test(html)
       || /renderShareSamples\s*\(\s*bakedSamples/.test(html),
  "mount never calls renderShareSamples");
ok("S4c", /sample result — sign in to run it for real/.test(html),
  "sample badge copy missing");

// ---- S5: real output clears samples -----------------------------------------
const runFn = extractFn(html, "run");
ok("S5a", /clearShareSamples\s*\(/.test(runFn), "run() does not clear share samples");
const renderResult = extractFn(html, "renderResult");
ok("S5b", /clearShareSamples\s*\(/.test(renderResult), "renderResult does not clear samples");
ok("S5c", /rememberLiveOut\s*\(/.test(renderResult), "renderResult does not feed LIVE_OUT");

// ---- S6: restoreOutputs ignores sample cards --------------------------------
const restore = extractFn(html, "restoreOutputs");
ok("S6", /\.card:not\(\.nd-sample\)/.test(restore) || /nd-sample/.test(restore),
  "restoreOutputs does not exempt sample cards");
// S6b/S6c: restore must never clear the samples (or leave the placeholder gone) UNLESS a
// stored record actually produced a card. Clearing up-front blanks the whole output area
// when every record is skipped (node replaced in the editor → id/type no longer matches).
ok("S6b", /if\s*\(\s*restored\s*\)\s*\{\s*clearShareSamples\s*\(\s*\)/.test(restore),
  "restoreOutputs must clear share samples only once restored > 0");
{
  const idxClear = restore.indexOf("clearShareSamples");
  const idxLoop = restore.search(/for\s*\(/);
  ok("S6c", idxClear > 0 && idxLoop > 0 && idxClear > idxLoop,
    "restoreOutputs clears samples before knowing whether anything restores (blank-void bug)");
}

// ---- S7: size caps present --------------------------------------------------
ok("S7a", /SAMPLE_BUDGET\s*=\s*\d+/.test(html), "SAMPLE_BUDGET missing");
ok("S7b", /SAMPLE_MAX\s*=\s*\d+/.test(html), "SAMPLE_MAX missing");
ok("S7c", /SAMPLE_TEXT_MAX\s*=\s*\d+/.test(html), "SAMPLE_TEXT_MAX missing");
ok("S7d", /SAMPLE_IMG_EDGE\s*=\s*\d+/.test(html), "SAMPLE_IMG_EDGE missing");

// ---- S8: sanitizeSamples budget rules (live) --------------------------------
{
  // Lift sanitizeSamples + its const caps out of RUNTIME_JS. Caps are `var` at runtime scope.
  const capNames = ["SAMPLE_BUDGET", "SAMPLE_MAX", "SAMPLE_TEXT_MAX"];
  const caps = {};
  for (const n of capNames) {
    const m = html.match(new RegExp("var\\s+" + n + "\\s*=\\s*(\\d+)"));
    if (!m) { fail("S8", `could not find var ${n}`); break; }
    caps[n] = +m[1];
  }
  let sanitizeSrc;
  try { sanitizeSrc = extractFn(html, "sanitizeSamples"); }
  catch (e) { fail("S8", e.message); sanitizeSrc = null; }

  if (sanitizeSrc && Object.keys(caps).length === 3) {
    const sandbox = {
      SAMPLE_BUDGET: caps.SAMPLE_BUDGET,
      SAMPLE_MAX: caps.SAMPLE_MAX,
      SAMPLE_TEXT_MAX: caps.SAMPLE_TEXT_MAX,
    };
    vm.createContext(sandbox);
    vm.runInContext(sanitizeSrc, sandbox);
    const sanitize = sandbox.sanitizeSamples;

    const textOk = sanitize([{ id: "n1", type: "llm", port: "text", ptype: "text", v: "hello ramen" }]);
    ok("S8a", textOk.length === 1 && textOk[0].v === "hello ramen", "keeps short text sample");

    const long = "x".repeat(caps.SAMPLE_TEXT_MAX + 500);
    const textTrim = sanitize([{ id: "n1", type: "llm", port: "text", ptype: "text", v: long }]);
    ok("S8b", textTrim.length === 1 && textTrim[0].v.length <= caps.SAMPLE_TEXT_MAX + 2,
      `text not trimmed to SAMPLE_TEXT_MAX (got ${textTrim[0]?.v?.length})`);

    const badImg = sanitize([{ id: "n1", type: "image", port: "image", ptype: "image", v: "ftp://nope" }]);
    ok("S8c", badImg.length === 0, "non-http/data image should drop");

    const goodImg = sanitize([{ id: "n1", type: "image", port: "image", ptype: "image",
      v: "data:image/jpeg;base64," + "A".repeat(100) }]);
    ok("S8d", goodImg.length === 1, "data:image jpeg should keep");

    const hugeAudio = sanitize([{ id: "n1", type: "music", port: "audio", ptype: "audio",
      v: "data:audio/mpeg;base64," + "A".repeat(5000) }]);
    ok("S8e", hugeAudio.length === 0, "inline audio data must never ride a share");

    const remoteVid = sanitize([{ id: "n1", type: "tvideo", port: "video", ptype: "video",
      v: "https://cdn.example.com/out.mp4" }]);
    ok("S8f", remoteVid.length === 1, "short https video URL should keep");

    const many = [];
    for (let i = 0; i < caps.SAMPLE_MAX + 5; i++)
      many.push({ id: "n" + i, type: "llm", port: "text", ptype: "text", v: "t" + i });
    ok("S8g", sanitize(many).length === caps.SAMPLE_MAX, "SAMPLE_MAX not enforced");

    ok("S8h", sanitize(null).length === 0 && sanitize("x").length === 0, "non-array input → []");
  }
}

// ---- S9: shareableGraph still blanks uploads (samples are not that path) ----
const shareable = extractFn(html, "shareableGraph");
ok("S9a", /UPLOAD_FIELD/.test(shareable) || /upload/.test(shareable),
  "shareableGraph no longer blanks uploads");
ok("S9b", /inpaint/.test(shareable), "shareableGraph must still blank inpaint image/mask");
// samples live on the #a= envelope, not inside the graph — assert doShare still
// routes the graph through shareableGraph
ok("S9c", /shareableGraph\s*\(/.test(doShare), "doShare must still call shareableGraph");

// ---- S10: i18n coverage for the sample badge --------------------------------
{
  // PLAY_I18N is inside RUNTIME_JS; require the english keys with all 5 lang maps.
  const keys = [
    "sample result — sign in to run it for real",     // signed-out badge
    "Creator’s sample — Run to make your own",        // signed-in badge (+ tooltip)
  ];
  for (const key of keys) {
    const idx = html.indexOf(key);
    ok("S10a", idx >= 0, `sample badge key missing from play.html: ${key}`);
    if (idx >= 0) {
      const slice = html.slice(idx, idx + 800);
      for (const lang of ["es", "fr", "de", "pt", "ja"]) {
        ok("S10-" + lang, new RegExp("\\b" + lang + "\\s*:").test(slice),
          `sample badge missing ${lang} translation near key: ${key}`);
      }
    }
  }
  // S10b: the badge must be auth-aware — signed-in viewers get the "Run" phrasing,
  // not a stale "sign in to run it" nudge (same needsKey check as the placeholder).
  const rss = extractFn(html, "renderShareSamples");
  ok("S10b", /needsKey/.test(rss) && /Creator’s sample — Run to make your own/.test(rss),
    "renderShareSamples badge is not auth-aware (needsKey branch missing)");
}

// ---- S11: pre-commit trigger covers every guarded file ------------------------
// The checker asserts index.html (buildShareUrl parity) as well as play.html, so an
// index.html-only commit must still fire it. Pin the hook's trigger line.
{
  let hook = "";
  try { hook = readFileSync(join(ROOT, ".githooks", "pre-commit"), "utf8"); }
  catch (e) { fail("S11", "cannot read .githooks/pre-commit: " + e.message); }
  const m = hook.match(/touches_sharesamples=.*/);
  ok("S11a", !!m, "pre-commit has no touches_sharesamples trigger");
  if (m) {
    ok("S11b", m[0].includes("index\\.html"),
      "pre-commit touches_sharesamples must include index.html (checker asserts buildShareUrl)");
    ok("S11c", m[0].includes("play\\.html"),
      "pre-commit touches_sharesamples must include play.html");
  }
}

// ---- report -----------------------------------------------------------------
if (failures.length) {
  console.error("check-share-samples: FAILED");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("check-share-samples: ok (" + [
  "S1 pack", "S2 import", "S3 inject", "S4 paint", "S5 clear",
  "S6 restore", "S7 caps", "S8 sanitize", "S9 privacy", "S10 i18n", "S11 hook",
].join(", ") + ")");
