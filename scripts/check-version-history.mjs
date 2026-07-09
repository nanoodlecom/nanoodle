#!/usr/bin/env node
// Guards the TWO append-only version strips — the subsystem behind every "v4 lost my
// changes" report. Both were bitten (PR #63) by the same class of bug: editing off an
// OLDER version slice()d away every forward version, silently destroying the paid
// customizations the user could still want back. The fix in both places is "never
// truncate — a new version always lands at the END": append-only history.
//
//   A) play.html app-builder strip  — pushVersion / selectVersion / APP_STATE.versions
//   B) index.html "Describe changes" copilot strip — versions[] / curVer, its
//      selectVersion (parks hand edits before jumping) and submit (append on apply)
//
// Three things this pins, none of which any browser/network is needed for — we lift the
// REAL shipped functions out of the HTML as text (house pattern: matchBrace /
// extractFunction from check-share-link.mjs) and run them in node:vm against stubs:
//
//  1. play.html append-only: editing off an older version keeps every forward version.
//  2. index.html H1 (media-aware park): selectVersion snapshots UNSAVED canvas edits —
//     including MEDIA-only edits (an uploaded photo, a renamed node) — into a new version
//     before it applies the one you clicked, so jumping back can never destroy them. The
//     regression to catch is comparing with toSimple() (which strips media): a media-only
//     edit would read as "no change", get no snapshot, and vanish.
//  3. index.html CALLER-SET COMPLETENESS: every wholesale graph SWAP (open an Example, a
//     shared link, a file, an editor→app handoff) must call resetDescribeVersions — else
//     its stale chips overwrite the just-loaded graph. Enumerated so a NEW applyGraphData
//     caller that is neither "external (resets)" nor in the internal allowlist FAILS the
//     check, forcing a human to classify it.
//
// Offline. Non-zero exit + a pointed message on failure; one OK line otherwise.
// Run with --selftest to prove the three invariants actually fail when the code regresses.

import { readFileSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- a JS string/comment/template-aware `{ … }` matcher (ported verbatim from
// check-share-link.mjs). Needed because the copilot selectVersion body contains
// backtick template strings — a naive brace counter would miscount. -------------------
function matchBrace(src, openIdx) {
  let depth = 0;
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
function extractFunction(src, name) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}()`);
  const open = src.indexOf("{", m.index);
  const close = matchBrace(src, open);
  return src.slice(m.index, close + 1);
}
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

// =====================================================================================
// A) play.html app-builder strip — lift pushVersion + selectVersion, run for real.
// =====================================================================================
function checkPlay(root, fail) {
  const SRC = readFileSync(join(root, "play.html"), "utf8");
  let pushSrc, selSrc;
  try {
    pushSrc = extractFunction(SRC, "pushVersion");
    selSrc = extractFunction(SRC, "selectVersion");
  } catch (e) { fail("play.html: " + e.message); return; }

  // A sandbox that owns APP_STATE + inert UI/persistence stubs. renderVersions is stubbed
  // (it only paints the DOM); we're testing the array/curVer bookkeeping, not the paint.
  function makeCtx() {
    const toasts = [];
    const ctx = {
      APP_STATE: null,
      appDirty: false,
      toast: (msg, kind) => toasts.push({ msg, kind }),
      $: () => ({ innerHTML: "", disabled: false, textContent: "", set: () => {} }),
      document: { title: "" },
      syncTitleFromFiles: () => {},
      renderVersions: () => {},
      renderApp: () => {},
      persist: () => {},
      console,
      _toasts: toasts,
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(pushSrc + "\n" + selSrc, ctx);
    return ctx;
  }
  const mkVer = (tag) => ({ files: { "index.html": "<title>" + tag + "</title>", "app.css": "/*" + tag + "*/" }, goal: tag });

  // A1 — APPEND-ONLY: seed v0,v1,v2 (curVer=2), jump BACK to the older v1, then push a new
  // version. The old bug slice()d to curVer+1 (dropping the original v2) before pushing;
  // append-only must keep v2 by identity and land the new one at the end (length 4, cur=3).
  {
    const ctx = makeCtx();
    const v0 = mkVer("v0"), v1 = mkVer("v1"), v2 = mkVer("v2");
    ctx.APP_STATE = { files: { ...v2.files }, versions: [v0, v1, v2], curVer: 2 };
    vm.runInContext("selectVersion(1);", ctx);         // edit off an OLDER version
    if (ctx.APP_STATE.curVer !== 1) fail(`play.html: selectVersion(1) did not move curVer to 1 (got ${ctx.APP_STATE.curVer})`);
    vm.runInContext('pushVersion(APP_STATE.files, "new");', ctx);
    const vs = ctx.APP_STATE.versions;
    if (vs.length !== 4) fail(`play.html: pushVersion off an older version did not append (versions.length=${vs.length}, expected 4 — a slice/truncate is back)`);
    if (vs[0] !== v0 || vs[1] !== v1 || vs[2] !== v2)
      fail("play.html: pushVersion DROPPED or replaced an earlier version object — forward history was truncated (the PR #63 regression)");
    if (ctx.APP_STATE.curVer !== 3) fail(`play.html: new version is not current (curVer=${ctx.APP_STATE.curVer}, expected 3)`);
  }

  // A2 — H1 heads-up: switching versions with unsaved in-app edits (appDirty) must NOT be
  // silent — a non-blocking toast tells you your model/prompt tweaks were reset — and it
  // must NOT mutate the versions array (switching is a read, never a truncate).
  {
    const ctx = makeCtx();
    const v0 = mkVer("v0"), v1 = mkVer("v1");
    ctx.APP_STATE = { files: { ...v1.files }, versions: [v0, v1], curVer: 1 };
    ctx.appDirty = true;
    vm.runInContext("selectVersion(0);", ctx);
    if (ctx.APP_STATE.versions.length !== 2) fail(`play.html: selectVersion mutated the versions array (length=${ctx.APP_STATE.versions.length}, expected 2)`);
    if (ctx.APP_STATE.curVer !== 0) fail(`play.html: selectVersion(0) did not switch (curVer=${ctx.APP_STATE.curVer})`);
    if (!ctx._toasts.length) fail("play.html: switching versions with unsaved in-app edits gave NO heads-up toast — the reset is a silent surprise (audit H1)");
  }
}

// =====================================================================================
// B) index.html "Describe changes" copilot strip.
// =====================================================================================
function checkIndex(root, fail) {
  const SRC = readFileSync(join(root, "index.html"), "utf8");

  // --- B1: media-aware park (H1). Lift the copilot selectVersion and drive it with a
  // serializeGraph that returns a graph differing from the current version ONLY in a media
  // field. The shipped code must snapshot (park) that edit as a NEW version before applying
  // the clicked one — proving it compares full fields (media included), not toSimple(). ---
  let selSrc;
  try { selSrc = extractFunction(SRC, "selectVersion"); }
  catch (e) { fail("index.html: " + e.message); }
  if (selSrc) {
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const G = (img) => ({ nodes: [{ id: "a", type: "img", name: "", fields: { image: img } }], links: [] });
    const G0 = G("data:V0");
    const V1 = G("data:V1");               // the version currently selected
    const EDITED = G("data:HAND_UPLOAD");  // hand edit since then: a MEDIA-ONLY change
    const applied = [];
    const ctx = {
      versions: [{ graph: G0, goal: "start" }, { graph: clone(V1), goal: "change" }],
      curVer: 1,
      busy: false,
      runningNodes: new Set(),        // idle: the run-guard added to selectVersion is a no-op here
      flash: () => {},
      serializeGraph: () => clone(EDITED),
      applyGraphData: (g) => applied.push(g),
      clone,
      save: () => {},
      renderVersions: () => {},
      setStatus: () => {},
      esc: (s) => String(s),
      console,
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    try {
      vm.runInContext(selSrc + "\nselectVersion(0);", ctx);
      const vs = ctx.versions;
      if (vs.length !== 3)
        fail(`index.html: selectVersion did not PARK the unsaved canvas edit before jumping (versions.length=${vs.length}, expected 3) — a media-only edit is being destroyed (audit H1). Is contentSig using toSimple/stripping media?`);
      else {
        const parked = vs[2].graph;
        const parkedImg = parked && parked.nodes && parked.nodes[0] && parked.nodes[0].fields && parked.nodes[0].fields.image;
        if (parkedImg !== "data:HAND_UPLOAD")
          fail(`index.html: the parked version lost its media (fields.image=${JSON.stringify(parkedImg)}) — the snapshot stripped the uploaded photo (audit H1)`);
      }
      if (ctx.curVer !== 0) fail(`index.html: selectVersion(0) did not land on the clicked version (curVer=${ctx.curVer})`);
      if (applied.length !== 1) fail(`index.html: selectVersion applied the target graph ${applied.length} times (expected 1)`);
    } catch (e) {
      fail("index.html: copilot selectVersion threw when lifted: " + (e && e.message ? e.message : e));
    }
  }

  // --- B2: append-only static assertion over the copilot IIFE. submit()'s only version
  // writes live here; assert the array is never spliced/sliced/reassigned and the single
  // in-place length write is the reset (versions.length = 0). ---
  // Locate the copilot IIFE by CONTENT, not by "first (function(){ after the label" — a
  // decoy/new IIFE inserted between the label comment and the real one would otherwise shift
  // this region onto the wrong block, silently disabling every assertion below (anchor drift).
  // Scan candidate IIFEs and take the one that actually holds the version-strip internals.
  const iifeStart = SRC.indexOf("💬 Describe changes");
  let region = null, scanned = 0;
  if (iifeStart >= 0) {
    const openRe = /\(function\s*\(\s*\)\s*\{/g;
    openRe.lastIndex = iifeStart;
    let mm;
    while ((mm = openRe.exec(SRC))) {
      scanned++;
      if (scanned > 200) break;                       // pathological guard
      const brace = SRC.indexOf("{", mm.index);
      let close;
      try { close = matchBrace(SRC, brace); } catch { continue; }
      const cand = SRC.slice(mm.index, close + 1);
      // the real strip owns BOTH the reset closure and its own selectVersion
      if (cand.includes("window.resetDescribeVersions") && /function\s+selectVersion\s*\(/.test(cand)) {
        region = cand;
        break;
      }
    }
  }
  if (region == null) {
    fail("index.html: could not locate the copilot version-strip IIFE (the block holding window.resetDescribeVersions + selectVersion) — the region moved or was split; re-point this check");
  } else {
    if (/\bversions\s*\.\s*splice\s*\(/.test(region))
      fail("index.html: copilot strip calls versions.splice() — append-only history is broken (forward versions can be dropped, the PR #63 bug)");
    if (/\bversions\s*\.\s*slice\s*\(/.test(region))
      fail("index.html: copilot strip calls versions.slice() — a truncate-on-branch is back (the PR #63 bug); versions must only ever be pushed");
    // alias-mutation: `const v = versions` then v.splice/v.slice would slip past the direct
    // checks above. Flag any alias of `versions` that is then spliced/sliced.
    let am;
    const aliasRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*versions\b(?!\s*[.[])/g;
    while ((am = aliasRe.exec(region))) {
      const alias = am[1];
      const mut = new RegExp("\\b" + alias + "\\s*\\.\\s*(?:splice|slice)\\s*\\(");
      if (mut.test(region))
        fail(`index.html: copilot aliases the versions array ('${alias} = versions') and then ${alias}.splice/slice — append-only history can be truncated through the alias (the PR #63 bug)`);
    }
    // any `versions =` reassignment other than the initial `const versions = []`
    const reassign = region.match(/(^|[^.\w])versions\s*=(?!=)/g) || [];
    if (reassign.length > 1)
      fail(`index.html: copilot 'versions' array is reassigned (${reassign.length} sites) — only the initial declaration is allowed; a rebuild can drop history`);
    // the ONLY in-place length write may be the reset to 0
    const lenWrites = region.match(/\bversions\s*\.\s*length\s*=(?!=)\s*([^;]+)/g) || [];
    for (const w of lenWrites) {
      if (!/=\s*0\s*$/.test(w.trim()))
        fail(`index.html: copilot writes '${w.trim()}' — the only permitted versions.length write is the reset to 0`);
    }
  }

  // --- B3: CALLER-SET COMPLETENESS. Enumerate every applyGraphData(…) call; each must be
  // either EXTERNAL (resetDescribeVersions within the same block) or in the internal
  // allowlist. An unclassified caller fails, forcing a human to decide reset-or-allowlist. ---
  const lines = SRC.split("\n");
  // internal callers: same-workflow ops + boot restores (the strip is empty at boot).
  // Keyed on a stable substring that appears ON the call's own line.
  const INTERNAL = [
    { tag: "undo/redo (_restore)",        snippet: "applyGraphData(JSON.parse(entry.s), entry.boundary ? {resultStash:entry.stash} : {carryResults:true})" },
    { tag: "boot local-graph load()",     snippet: "applyGraphData(JSON.parse(raw))" },
    { tag: "boot default graph",          snippet: "applyGraphData(JSON.parse(JSON.stringify(d)))" },
    { tag: "OAuth-redirect resume",       snippet: "applyGraphData(JSON.parse(rs))" },
    { tag: "copilot selectVersion",       snippet: "applyGraphData(clone(v.graph), {carryResults:true})" },
    { tag: "copilot submit",              snippet: "applyGraphData(appliedInternal, {carryResults:true})" },
  ];
  // external callers (wholesale swaps): must have resetDescribeVersions nearby. Named so a
  // dropped reset on any of them is caught explicitly, not just via the unclassified path.
  const EXTERNAL = [
    { tag: "loadFile (open a .json)",     snippet: "applyGraphData(JSON.parse(r.result))" },
    { tag: "loadFromHash (shared link)",  snippet: "applyGraphData(spec.graph)" },
    { tag: "loadFromHash (bare graph)",   snippet: "applyGraphData(JSON.parse(json))" },
    { tag: "editor→app postMessage",      snippet: "applyGraphData(e.data.graph, sameFlow ? {carryResults:true} : undefined)" },
    { tag: "open an Example",             snippet: "applyGraphData(JSON.parse(JSON.stringify(ex.graph)))" },
  ];
  const WINDOW = 8;  // reset may trail the call by a few lines (loadFromHash: two calls, one reset)
  const hasResetNear = (lineNo) =>
    lines.slice(lineNo - 1, lineNo - 1 + WINDOW).some((l) => l.includes("resetDescribeVersions"));

  // find all real call sites (skip the `function applyGraphData(` definition)
  const callRe = /applyGraphData\s*\(/g;
  const sites = [];
  let m;
  while ((m = callRe.exec(SRC))) {
    const pre = SRC.slice(Math.max(0, m.index - 10), m.index);
    if (/function\s*$/.test(pre)) continue;           // the definition itself
    const lineNo = lineOf(SRC, m.index);
    sites.push({ lineNo, text: lines[lineNo - 1] });
  }
  if (!sites.length) fail("index.html: found NO applyGraphData call sites — the enumeration anchor moved");

  for (const s of sites) {
    const ext = hasResetNear(s.lineNo);
    const intl = INTERNAL.find((e) => s.text.includes(e.snippet));
    if (ext) continue;                                 // external swap that resets — good
    if (intl) continue;                                // known same-workflow / boot caller
    fail(`index.html:${s.lineNo}: new applyGraphData caller not classified — "${s.text.trim()}". Decide: external swap (call resetDescribeVersions) or add to the INTERNAL allowlist in check-version-history.mjs.`);
  }
  // Pin the named external paths: each must be present AND actually reset (a dropped reset
  // regresses to stale chips overwriting the swapped-in graph).
  for (const e of EXTERNAL) {
    const idx = SRC.indexOf(e.snippet);
    if (idx < 0) { fail(`index.html: external graph-swap path "${e.tag}" not found (snippet moved) — re-point check-version-history.mjs`); continue; }
    if (!hasResetNear(lineOf(SRC, idx)))
      fail(`index.html: external graph-swap path "${e.tag}" no longer calls resetDescribeVersions nearby — the previous workflow's version chips will overwrite the swapped-in graph`);
  }
}

// =====================================================================================
function runChecks(root) {
  const failures = [];
  const fail = (msg) => failures.push(msg);
  try { checkPlay(root, fail); } catch (e) { fail("play harness error: " + (e && e.stack ? e.stack : e)); }
  try { checkIndex(root, fail); } catch (e) { fail("index harness error: " + (e && e.stack ? e.stack : e)); }
  return failures;
}

// ---- self-test: mutate sandbox copies, confirm the three invariants fail pointedly. ----
function selftest() {
  const cases = [
    {
      name: "play append-only (reintroduce slice-to-curVer)",
      file: "play.html",
      mutate: (s) => s.replace(
        'APP_STATE.versions.push({ files:{ "index.html":files["index.html"], "app.css":files["app.css"] }, goal });',
        'APP_STATE.versions = APP_STATE.versions.slice(0, APP_STATE.curVer+1);\n  APP_STATE.versions.push({ files:{ "index.html":files["index.html"], "app.css":files["app.css"] }, goal });'),
      want: /append|truncat|DROPPED/i,
    },
    {
      name: "index H1 media-aware park (contentSig strips media)",
      file: "index.html",
      // drop fields from contentSig → a media-only edit reads as no-change → never parked
      mutate: (s) => s.replace(
        'nodes:(g.nodes||[]).map(n=>({ id:n.id, type:n.type, name:(n.name&&n.name.trim())||"", fields:n.fields||{} })),',
        'nodes:(g.nodes||[]).map(n=>({ id:n.id, type:n.type, name:(n.name&&n.name.trim())||"", fields:{} })),'),
      want: /PARK|media/i,
    },
    {
      name: "index caller completeness (drop loadFile reset)",
      file: "index.html",
      mutate: (s) => s.replace(
        'setPendingApp(null); applyGraphData(JSON.parse(r.result)); window.resetDescribeVersions?.(); save();',
        'setPendingApp(null); applyGraphData(JSON.parse(r.result)); save();'),
      want: /not classified|no longer calls resetDescribeVersions/i,
    },
  ];
  let ok = true;
  for (const c of cases) {
    const dir = mkdtempSync(join(tmpdir(), "cvh-selftest-"));
    cpSync(join(ROOT, "index.html"), join(dir, "index.html"));
    cpSync(join(ROOT, "play.html"), join(dir, "play.html"));
    const orig = readFileSync(join(dir, c.file), "utf8");
    const mutated = c.mutate(orig);
    if (mutated === orig) { console.log(`  ✗ ${c.name}: mutation anchor not found (no-op) — self-test can't run`); ok = false; continue; }
    writeFileSync(join(dir, c.file), mutated);
    const fs = runChecks(dir);
    const hit = fs.find((f) => c.want.test(f));
    if (hit) console.log(`  ✓ ${c.name}\n      → ${hit.split("\n")[0]}`);
    else { console.log(`  ✗ ${c.name}: expected a failure matching ${c.want}, got:\n      ${fs.join("\n      ") || "(no failures — the mutation slipped past the check!)"}`); ok = false; }
  }
  // sanity: the pristine tree must PASS
  const clean = runChecks(ROOT);
  if (clean.length) { console.log("  ✗ current main is not clean:\n      " + clean.join("\n      ")); ok = false; }
  else console.log("  ✓ current main passes clean");
  process.exit(ok ? 0 : 1);
}

if (process.argv.includes("--selftest")) { selftest(); }
else {
  const failures = runChecks(ROOT);
  if (failures.length) {
    process.stderr.write("✗ version-history strip regressions:\n\n- " + failures.join("\n- ") + "\n");
    process.exit(1);
  }
  process.stdout.write("✓ version strips stay append-only: no truncation, media-only edits are parked, every graph swap resets the copilot chips.\n");
}
