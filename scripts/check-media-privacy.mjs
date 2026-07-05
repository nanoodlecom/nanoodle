#!/usr/bin/env node
// Verifies the MEDIA-PRIVACY sanitizers in index.html — the core "no servers,
// no tracking" promise — stay wired and correct on BOTH the import and share
// sides of a shared graph.
//
// Two threats, two shipped guards (index.html ~7919-7956):
//
//   IMPORT (stripInjectedMedia): a shared #g=/#j= link auto-applies on open with
//   no Run/gesture. Upload-node media fields are ALWAYS data:/blob: URLs locally
//   (FileReader / canvas.toDataURL), so any remote http(s) value in one can only
//   be an injected beacon — the default <audio>/<video> preload would fetch it and
//   leak the VIEWER's IP / UA / open-timestamp. stripInjectedMedia blanks any
//   upload/inpaint media field whose value is not data:/blob:, on import.
//
//   SHARE (shareableGraph): the SHARER's own uploaded photos/audio/video + the
//   inpaint source photo & brushed mask are private data — shareableGraph blanks
//   them out of every share link so they never ride to a stranger, while leaving
//   the graph structure (nodes/links/other fields) intact.
//
// Plus the WIRE-IN: the functions existing isn't enough — a refactor that drops
// the call site would silently reopen the hole. We statically assert applyGraphData
// still calls stripInjectedMedia (before it stores the node) and buildShareUrl
// still routes BOTH share paths (#a= app link, #g= graph link) through shareableGraph.
//
// No browser, no network, no inference. We lift the REAL shipped constants and
// functions out of index.html as text and run them in a Function sandbox, then
// enumerate the governed media fields from the real source (never re-implemented).

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const failures = [];
const fail = (msg) => failures.push(msg);

// ---- a JS-string/comment/template-aware matcher for the body of `{ ... }` ---
// Returns the index of the `}` that closes the `{` at openIdx.
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

// pull `function <name>(...) { ... }` out as text
function extractFunction(src, name) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}()`);
  const open = src.indexOf("{", m.index);
  const close = matchBrace(src, open);
  return src.slice(m.index, close + 1);
}

// pull a single-statement `const <name> = ... ;` out as text. The RHS of both
// governed decls (an object literal and a regex literal) contains no ';', so we
// read to the first ';' after the `=`.
function extractConst(src, name) {
  const sig = new RegExp("const\\s+" + name + "\\s*=");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find const ${name}`);
  const semi = src.indexOf(";", m.index + m[0].length);
  if (semi === -1) throw new Error(`const ${name} has no terminating ;`);
  return src.slice(m.index, semi + 1);
}

const src = readFileSync(join(ROOT, "index.html"), "utf8");

let api, stripFnText, applyFnText, shareUrlFnText, uploadDecl, safeDecl, shareFnText;
try {
  uploadDecl     = extractConst(src, "UPLOAD_FIELD");
  safeDecl       = extractConst(src, "SAFE_MEDIA_RE");
  shareFnText    = extractFunction(src, "shareableGraph");
  stripFnText    = extractFunction(src, "stripInjectedMedia");
  applyFnText    = extractFunction(src, "applyGraphData");
  shareUrlFnText = extractFunction(src, "buildShareUrl");

  // Build a sandbox from the REAL source pieces. shareableGraph only calls
  // serializeGraph() when handed no arg; we always pass a graph, so no stub needed.
  const program =
    uploadDecl + "\n" +
    safeDecl + "\n" +
    shareFnText + "\n" +
    stripFnText + "\n" +
    "return { UPLOAD_FIELD, SAFE_MEDIA_RE, shareableGraph, stripInjectedMedia };";
  api = new Function(program)();
} catch (e) {
  fail("could not lift the media-privacy code out of index.html: " + (e && e.message ? e.message : e));
}

if (api) {
  // ---- Enumerate the governed media fields from the REAL source ---------------
  // upload/aupload/vupload → their media field, plus inpaint's image+mask (parsed
  // out of stripInjectedMedia so a new inpaint media field is picked up automatically).
  const governed = [];
  for (const [type, field] of Object.entries(api.UPLOAD_FIELD)) governed.push({ type, field });
  const inpaintM = /for\s*\(\s*const\s+k\s+of\s*\[([^\]]*)\]/.exec(stripFnText);
  const inpaintFields = inpaintM
    ? inpaintM[1].split(",").map((s) => s.trim().replace(/['"]/g, "")).filter(Boolean)
    : [];
  if (!inpaintFields.length) fail("stripInjectedMedia no longer enumerates inpaint media fields (image/mask) — the inpaint source photo & mask could ride in a link");
  for (const field of inpaintFields) governed.push({ type: "inpaint", field });

  // ---- 0. SAFE_MEDIA_RE semantics: data:/blob: safe, everything else a beacon --
  const RE = api.SAFE_MEDIA_RE;
  const safeCases = ["data:image/png;base64,AAAA", "blob:https://x/y"];
  // The last two embed "data:"/"blob:" as a SUBSTRING: a remote URL can legitimately carry them
  // in a path/query, so the regex MUST be anchored (^) — an unanchored /(data:|blob:)/ would treat
  // http://evil/x?u=data:… as safe and let the beacon survive import.
  const beaconCases = ["http://evil.example/t.gif", "https://evil.example/a.mp3", "javascript:alert(1)", "//evil.example/x",
                       "http://evil.example/x?u=data:image/png;base64,AA", "https://evil.example/blob:abc"];
  for (const v of safeCases) if (!RE.test(v)) fail(`SAFE_MEDIA_RE rejects a legitimate local upload value ${JSON.stringify(v)} — real uploads would be wiped on import`);
  for (const v of beaconCases) if (RE.test(v)) fail(`SAFE_MEDIA_RE treats ${JSON.stringify(v)} as safe — a remote beacon would survive import`);

  // ---- 1. IMPORT BEACON-STRIP: stripInjectedMedia over EVERY governed field ----
  for (const { type, field } of governed) {
    // a remote http(s) value (only possible source: an injected beacon) → blanked
    for (const beacon of ["http://beacon.example/x", "https://beacon.example/y.mp4"]) {
      const n = { type, fields: { [field]: beacon, keepme: "http://not-a-media-field.example/keep" } };
      api.stripInjectedMedia(n);
      if (n.fields[field] !== "") fail(`stripInjectedMedia left a remote beacon in ${type}.${field} (${JSON.stringify(n.fields[field])}) — importing a shared link would leak the viewer's IP/UA`);
      if (n.fields.keepme !== "http://not-a-media-field.example/keep") fail(`stripInjectedMedia blanked a NON-media field on ${type} — it must only touch governed media fields`);
    }
    // a genuine local upload (data:/blob:) → untouched
    for (const good of ["data:audio/mp3;base64,ZZZ", "blob:https://nanoodle/abc"]) {
      const n = { type, fields: { [field]: good } };
      api.stripInjectedMedia(n);
      if (n.fields[field] !== good) fail(`stripInjectedMedia wiped a legitimate ${type}.${field} data:/blob: upload — user media would vanish on import`);
    }
  }
  // a non-media node's remote-looking fields are left alone (scoping sanity)
  {
    const n = { type: "text", fields: { prompt: "http://example.com/looks-remote" } };
    api.stripInjectedMedia(n);
    if (n.fields.prompt !== "http://example.com/looks-remote") fail("stripInjectedMedia blanked a field on a non-upload node — it must be scoped to media fields only");
  }
  // no fields → no throw
  try { api.stripInjectedMedia({ type: "upload" }); } catch (e) { fail("stripInjectedMedia throws on a node with no fields: " + e.message); }

  // ---- 2. SHARE BLANKING: shareableGraph blanks the sharer's media, keeps the rest
  const graphIn = {
    nodes: [
      { id: 1, type: "upload",  fields: { image: "data:image/png;base64,PRIVATE", label: "my pic" } },
      { id: 2, type: "aupload", fields: { audio: "data:audio/mp3;base64,PRIVATE" } },
      { id: 3, type: "vupload", fields: { video: "blob:https://nanoodle/PRIVATE" } },
      { id: 4, type: "inpaint", fields: { image: "data:image/png;base64,PHOTO", mask: "data:image/png;base64,MASK", strength: "0.8" } },
      { id: 5, type: "text",    fields: { prompt: "keep this prompt" } },
    ],
    links: [{ from: { node: 1, port: "out" }, to: { node: 5, port: "image" } }],
    view: { panX: 10, panY: 20, scale: 1.5 },
  };
  const before = JSON.stringify(graphIn);
  const g = api.shareableGraph(JSON.parse(before));

  const nodeBy = (id) => (g.nodes || []).find((n) => n.id === id);
  const mediaBlanked = [
    ["upload", 1, "image"], ["aupload", 2, "audio"], ["vupload", 3, "video"],
    ["inpaint", 4, "image"], ["inpaint", 4, "mask"],
  ];
  for (const [type, id, field] of mediaBlanked) {
    const nn = nodeBy(id);
    if (!nn) { fail(`shareableGraph dropped the ${type} node from the shared graph`); continue; }
    if (nn.fields[field] !== "") fail(`shareableGraph left the sharer's private ${type}.${field} in the share link (${JSON.stringify(nn.fields[field])})`);
  }
  // structure + non-media fields preserved
  if (nodeBy(1)?.fields.label !== "my pic") fail("shareableGraph dropped a non-media field (upload.label) — it must only blank media");
  if (nodeBy(4)?.fields.strength !== "0.8") fail("shareableGraph dropped a non-media field (inpaint.strength)");
  if (nodeBy(5)?.fields.prompt !== "keep this prompt") fail("shareableGraph altered an unrelated node's fields (text.prompt)");
  if ((g.nodes || []).length !== 5) fail(`shareableGraph changed the node count (${(g.nodes || []).length} ≠ 5) — graph structure must survive`);
  if (JSON.stringify(g.links) !== JSON.stringify(graphIn.links)) fail("shareableGraph mutated the links array — wiring must survive sharing");
  if (JSON.stringify(g.view) !== JSON.stringify(graphIn.view)) fail("shareableGraph dropped/altered the view");
  // must not mutate the caller's graph in place (it spreads)
  if (JSON.stringify(graphIn) !== before) fail("shareableGraph mutated its input graph in place — the sharer's own canvas would lose its media");
  // ALIASING: serializeGraph() hands shareableGraph the LIVE node.fields object BY REFERENCE
  // (nodes:[{...,fields:n.fields}]). A mutate-in-place impl (n.fields.image="") would therefore blank
  // the sharer's real canvas on every share click. shareableGraph must blank a spread COPY, so the
  // live fields object must survive untouched. Reassigning the disposable wrapper's .nodes is fine.
  const liveFields = { image: "data:image/png;base64,LIVE", label: "keep" };
  const outAlias = api.shareableGraph({ nodes: [{ id: 9, type: "upload", fields: liveFields }], links: [] });
  if (liveFields.image !== "data:image/png;base64,LIVE") fail("shareableGraph blanked the LIVE node.fields object in place — serializeGraph() aliases fields by reference, so sharing would erase the sharer's own canvas media (must blank a spread copy, not mutate)");
  if (outAlias?.nodes?.[0]?.fields.image !== "") fail("shareableGraph did not blank the shared copy's upload.image in the aliasing case");

  // ---- 3. WIRE-IN: the sanitizers are actually CALLED at the two boundaries ----
  // applyGraphData must strip imported nodes, BEFORE it stores them.
  if (!/stripInjectedMedia\s*\(/.test(applyFnText)) {
    fail("applyGraphData no longer calls stripInjectedMedia — imported #g=/#j= media beacons would reach the viewer unstripped");
  } else {
    const iStrip = applyFnText.indexOf("stripInjectedMedia");
    const iPush = applyFnText.indexOf("graph.nodes.push");
    const iBuild = applyFnText.indexOf("buildNodeEl");
    if (iPush !== -1 && iStrip > iPush) fail("applyGraphData stores the node BEFORE stripInjectedMedia — a beacon could be committed to the graph unsanitized");
    // The actual leak trigger is buildNodeEl: it mounts the upload node's <img>/<audio>/<video>
    // straight from n.fields, so the browser fetches whatever src is there. If the DOM is built
    // before the field is blanked, the beacon is already requested — strip MUST precede buildNodeEl.
    if (iBuild === -1) fail("applyGraphData no longer calls buildNodeEl — the import-time strip ordering can no longer be verified (this check assumes buildNodeEl mounts the media element)");
    else if (iStrip > iBuild) fail("applyGraphData builds the node's DOM (buildNodeEl) BEFORE stripInjectedMedia — the <img>/<audio>/<video> is created with the raw remote src, so the browser fetches the beacon (leaking the viewer's IP/UA) before the field is blanked");
  }
  // buildShareUrl must route BOTH share payloads (#a= app link, #g= graph link) through shareableGraph.
  const shareCalls = (shareUrlFnText.match(/shareableGraph\s*\(/g) || []).length;
  if (shareCalls < 2) fail(`buildShareUrl routes only ${shareCalls} of the 2 share paths through shareableGraph — the app-link (#a=) or graph-link (#g=) could carry raw uploaded media`);
  if (/JSON\.stringify\(\s*serializeGraph\s*\(/.test(shareUrlFnText)) fail("buildShareUrl stringifies raw serializeGraph() into a share payload — bypasses shareableGraph blanking");
}

if (failures.length) {
  process.stderr.write("✗ media-privacy sanitizers are broken:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ media privacy holds: imports strip remote beacons, shares blank the sharer's uploads, and both call sites stay wired.\n");
