#!/usr/bin/env node
// Pins the multi-place "graph identity" signature invariant in index.html.
//
// A nanoodle workflow is signed in three places, each answering a different
// question about the SAME graph:
//   • serializeGraph()  — everything persisted to localStorage / share files
//     (node id,type,x,y,fields,w,sizes,name + view/pan/zoom).
//   • appHandoffSig()   — "what a bound app actually consumes": id,type,name,
//     fields + links. NO layout. Gates the editor↔app-builder resume + the
//     demo-starter baseline.
//   • contentSig (inside selectVersion) — "did the canvas change in an
//     app-meaningful way since this copilot version": id,type,name,fields +
//     links. NO layout.
//
// The two sigs are meant to gate the exact same concept ("an edit that
// changes the app"), so any app-meaningful mutation must move BOTH and any
// pure-layout mutation must move NEITHER. The recurring regression (PR #114:
// node rename `name` was added to serializeGraph but not to appHandoffSig nor
// contentSig) is precisely a drift between these lists — users' renames were
// silently dropped from handoff/versioning. This check makes that class fail
// at commit time.
//
// 100% offline: we lift the REAL shipped functions out of index.html as text
// (house pattern, see check-share-link.mjs) and run them in a Function sandbox
// against plain-object graphs. Nothing is re-implemented.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- brace matcher (JS-string / template / comment aware), from check-share-link ----
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

function extractFunction(src, name) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}()`);
  const open = src.indexOf("{", m.index);
  const close = matchBrace(src, open);
  return src.slice(m.index, close + 1);
}

// contentSig is a local arrow `const contentSig = g => JSON.stringify({ ... });`
// inside selectVersion — lift it out as a standalone declaration.
function extractContentSig(src) {
  const anchor = "const contentSig = g => JSON.stringify(";
  const at = src.indexOf(anchor);
  if (at === -1) throw new Error("could not find the contentSig arrow inside selectVersion");
  const open = src.indexOf("{", at + anchor.length);
  const close = matchBrace(src, open);
  return src.slice(at, close + 1) + ");"; // `const contentSig = g => JSON.stringify({...});`
}

// the `const UPLOAD_FIELD = { ... };` map shareableGraph depends on
function extractUploadField(src) {
  const m = /const\s+UPLOAD_FIELD\s*=\s*\{[^}]*\}\s*;/.exec(src);
  if (!m) throw new Error("could not find the UPLOAD_FIELD map");
  return m[0];
}

// Collect the node-object property set a node-map callback reads, i.e. every
// `n.<prop>` accessed inside the FIRST `n=>({ ... })` in the given function
// text. Works for serializeGraph, appHandoffSig and contentSig alike.
function nodeMapProps(fnText, where) {
  const at = fnText.indexOf("n=>({");
  if (at === -1) throw new Error(`no node-map callback (n=>({…})) found in ${where}`);
  const open = fnText.indexOf("{", at); // the object-literal brace after `n=>(`
  const close = matchBrace(fnText, open);
  const body = fnText.slice(open, close + 1);
  const props = new Set();
  let m; const re = /\bn\.([A-Za-z_$][\w$]*)/g;
  while ((m = re.exec(body))) props.add(m[1]);
  if (!props.size) throw new Error(`node-map in ${where} read no n.<prop> — extraction likely wrong`);
  return props;
}

// ---- assemble a runnable module from the shipped source pieces ----
function buildSigs(src) {
  const serializeFn = extractFunction(src, "serializeGraph");
  const handoffFn = extractFunction(src, "appHandoffSig");
  const shareFn = extractFunction(src, "shareableGraph");
  const contentDecl = extractContentSig(src);
  const uploadDecl = extractUploadField(src);

  const props = {
    serialize: nodeMapProps(serializeFn, "serializeGraph"),
    handoff: nodeMapProps(handoffFn, "appHandoffSig"),
    content: nodeMapProps(contentDecl, "contentSig"),
  };

  // module-level names the shipped code closes over. We always pass an explicit
  // graph to the sigs, so `graph` is only a harmless fallback; pendingAppId is a
  // fixed baseline so the `app` field is constant across mutations.
  const program =
    "let pendingAppId = 'APP_BASE';\n" +
    "let panX = 0, panY = 0, scale = 1, nid = 99, lid = 99;\n" +
    "let graph = { nodes: [], links: [] };\n" +
    uploadDecl + "\n" +
    serializeFn + "\n" +
    handoffFn + "\n" +
    shareFn + "\n" +
    contentDecl + "\n" +
    "return { serializeGraph, appHandoffSig, contentSig, shareableGraph };\n";

  const mod = new Function(program)();
  return { ...mod, props };
}

const clone = (o) => JSON.parse(JSON.stringify(o));

function baseGraph() {
  return {
    nodes: [
      { id: "n1", type: "text",  x: 10,  y: 20, w: 200, sizes: {},        fields: { prompt: "hi" }, name: "First" },
      { id: "n2", type: "image", x: 300, y: 40, w: 180, sizes: { h: 100 }, fields: { model: "x" } },
    ],
    links: [
      { id: "l1", from: { node: "n1", port: "out" }, to: { node: "n2", port: "prompt" } },
    ],
    view: { panX: 0, panY: 0, scale: 1 },
  };
}

// mutation matrix: [name, mutate(g), expectSigChange]
const MUTATIONS = [
  ["rename node",      g => { g.nodes[0].name = "Renamed"; },                                  true],
  ["edit a field",     g => { g.nodes[0].fields.prompt = "bye"; },                             true],
  ["change node type", g => { g.nodes[0].type = "llm"; },                                      true],
  ["add a link",       g => { g.links.push({ id: "l2", from: { node: "n2", port: "out" }, to: { node: "n1", port: "x" } }); }, true],
  ["remove a link",    g => { g.links.pop(); },                                                true],
  ["rewire link `to`",  g => { g.links[0].to = { node: "n2", port: "seed" }; },                 true],
  ["rewire link `from`",g => { g.links[0].from = { node: "n1", port: "alt" }; },                true],
  ["pan/move (x,y)",   g => { g.nodes[0].x = 999; g.nodes[0].y = 888; g.view.panX = 77; },     false],
  ["resize (w,sizes)", g => { g.nodes[0].w = 512; g.nodes[0].sizes = { h: 999 }; },            false],
  ["view zoom",        g => { g.view.scale = 2.5; },                                           false],
];

const LAYOUT_ALLOW = new Set(["x", "y", "w", "sizes", "view"]);

// ---- run every invariant against a source string; return a failures array ----
function runChecks(src, label = "index.html") {
  const failures = [];
  const fail = (m) => failures.push(`${label}: ${m}`);
  let S;
  try { S = buildSigs(src); }
  catch (e) { return [`${label}: could not lift the signature functions — ${e.message}`]; }

  const { appHandoffSig, contentSig, shareableGraph, props } = S;

  // --- Invariant 2a: the two sigs gate the same concept → same prop set ---
  const eqSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  if (!eqSet(props.handoff, props.content))
    fail(`appHandoffSig node props {${[...props.handoff].sort()}} and contentSig node props {${[...props.content].sort()}} disagree — they must sign the same node fields (they gate the same "app-meaningful edit" concept)`);

  // --- Invariant 2b: property-set closure over serializeGraph ---
  for (const p of props.serialize) {
    const inBoth = props.handoff.has(p) && props.content.has(p);
    if (!inBoth && !LAYOUT_ALLOW.has(p))
      fail(`new persisted node prop ${p} must be added to appHandoffSig + contentSig or the layout allowlist`);
  }

  // --- Invariant 2c: reverse closure — everything the sigs SIGN must be persisted.
  // A prop signed by handoff/content but dropped from serializeGraph is the mirror of
  // PR#114: it survives in the live sig but vanishes on reload, so a round-trip through
  // localStorage/share silently changes the "identity" and breaks app binding/versioning.
  for (const p of new Set([...props.handoff, ...props.content])) {
    if (!props.serialize.has(p) && !LAYOUT_ALLOW.has(p))
      fail(`node prop ${p} is signed by appHandoffSig/contentSig but NOT persisted by serializeGraph — it would vanish on reload and spuriously change the graph signature`);
  }

  // --- Invariant 1: mutation matrix through the REAL sigs ---
  try {
    const base = baseGraph();
    const baseH = appHandoffSig(clone(base));
    const baseC = contentSig(clone(base));
    for (const [name, mutate, expect] of MUTATIONS) {
      const g = clone(base); mutate(g);
      const changedH = appHandoffSig(g) !== baseH;
      const changedC = contentSig(g) !== baseC;
      if (changedH !== changedC)
        fail(`mutation "${name}" moved appHandoffSig=${changedH} but contentSig=${changedC} — the two sigs disagree on whether this is an app-meaningful edit`);
      else if (changedH !== expect)
        fail(expect
          ? `mutation "${name}" is an app-meaningful edit but neither signature changed — it would be silently dropped on handoff/versioning`
          : `mutation "${name}" is pure layout but the signatures changed — a plain drag/pan/resize would spuriously count as an app edit`);
    }
  } catch (e) {
    fail(`mutation matrix threw while running the sigs: ${e.message}`);
  }

  // --- Invariant 1b: contentSig flattens links to "node.port" strings, so the node/port
  // boundary MUST stay delimited or two structurally-different graphs alias to one sig.
  // Same node set both sides; only the from-endpoint's node|port split differs (a|bc vs ab|c).
  try {
    const shared = [{ id: "a", type: "t", fields: {} }, { id: "ab", type: "t", fields: {} }];
    const gA = { nodes: shared, links: [{ id: "l", from: { node: "a",  port: "bc" }, to: { node: "a", port: "x" } }], view: {} };
    const gB = { nodes: shared, links: [{ id: "l", from: { node: "ab", port: "c"  }, to: { node: "a", port: "x" } }], view: {} };
    if (contentSig(gA) === contentSig(gB))
      fail(`contentSig aliases two structurally-different link endpoints (node "a" port "bc" vs node "ab" port "c") — its node/port flattening lost its delimiter and can collide distinct graphs`);
  } catch (e) {
    fail(`contentSig collision probe threw: ${e.message}`);
  }

  // --- Invariant 3: shareableGraph blanks upload media but preserves structure ---
  try {
    const g = {
      nodes: [
        { id: "u1", type: "upload",  x: 0, y: 0, w: 100, sizes: {}, fields: { image: "data:image/png;base64,SECRET" } },
        { id: "t1", type: "text",    x: 0, y: 0, w: 100, sizes: {}, fields: { prompt: "keep me" } },
        { id: "p1", type: "inpaint", x: 0, y: 0, w: 100, sizes: {}, fields: { image: "data:PHOTO", mask: "data:MASK" } },
      ],
      links: [
        { id: "l1", from: { node: "u1", port: "out" }, to: { node: "t1", port: "prompt" } },
        { id: "l2", from: { node: "t1", port: "out" }, to: { node: "p1", port: "image" } },
      ],
      view: { panX: 0, panY: 0, scale: 1 },
    };
    const before = clone(g);
    const out = shareableGraph(clone(g));
    const ids = (x) => (x.nodes || []).map(n => n.id).join(",");
    if (ids(out) !== ids(before))
      fail(`shareableGraph changed the node set (${ids(before)} → ${ids(out)}) — it must only blank upload media, not restructure`);
    if (JSON.stringify(out.links) !== JSON.stringify(before.links))
      fail("shareableGraph altered the links — sharing must preserve graph structure");
    const byId = (gr, id) => (gr.nodes || []).find(n => n.id === id) || {};
    if (byId(out, "u1").fields.image !== "")
      fail("shareableGraph did NOT blank the upload node's image field — the sharer's own media would leak into share links/files");
    if (byId(out, "p1").fields.image !== "" || byId(out, "p1").fields.mask !== "")
      fail("shareableGraph did NOT blank the inpaint node's image/mask — the source photo would leak");
    if (byId(out, "t1").fields.prompt !== "keep me")
      fail("shareableGraph clobbered a non-upload field — it should only touch upload media");
  } catch (e) {
    fail(`shareableGraph check threw: ${e.message}`);
  }

  return failures;
}

// ---- self-test: mutate sandbox copies and confirm this script FAILS pointedly ----
function selfTest(src) {
  const cases = [
    {
      name: "PR#114 regression: drop `name` from appHandoffSig",
      // strip the name key out of appHandoffSig's node map only
      mutate: s => s.replace(
        "nodes: (g.nodes||[]).map(n=>({ id:n.id, type:n.type, name:(n.name&&n.name.trim())||\"\", fields:n.fields })),",
        "nodes: (g.nodes||[]).map(n=>({ id:n.id, type:n.type, fields:n.fields })),"),
      expect: /new persisted node prop name|disagree on whether|silently dropped|gate the same/,
    },
    {
      name: "new persisted prop `flag` added to serializeGraph only",
      mutate: s => s.replace(
        "w:n.w,sizes:n.sizes,",
        "w:n.w,sizes:n.sizes,flag:n.flag,"),
      expect: /new persisted node prop flag must be added to appHandoffSig \+ contentSig or the layout allowlist/,
    },
    {
      name: "appHandoffSig starts signing layout (x)",
      mutate: s => s.replace(
        "nodes: (g.nodes||[]).map(n=>({ id:n.id, type:n.type, name:(n.name&&n.name.trim())||\"\", fields:n.fields })),",
        "nodes: (g.nodes||[]).map(n=>({ id:n.id, type:n.type, x:n.x, name:(n.name&&n.name.trim())||\"\", fields:n.fields })),"),
      expect: /pure layout but the signatures changed|disagree on whether|gate the same/,
    },
  ];
  let ok = true;
  for (const c of cases) {
    const mutated = c.mutate(src);
    if (mutated === src) { console.log(`  ✗ self-test "${c.name}": mutation did not apply (anchor drift)`); ok = false; continue; }
    const fs = runChecks(mutated, "MUTATED");
    const hit = fs.find(f => c.expect.test(f));
    if (hit) console.log(`  ✓ self-test "${c.name}" → caught: ${hit.replace(/^MUTATED: /, "")}`);
    else { console.log(`  ✗ self-test "${c.name}" NOT caught. failures=${JSON.stringify(fs)}`); ok = false; }
  }
  return ok;
}

// ---- main ----
const src = readFileSync(join(ROOT, "index.html"), "utf8");

if (process.argv.includes("--selftest")) {
  console.log("self-test (mutating sandbox copies of index.html):");
  const ok = selfTest(src);
  process.exit(ok ? 0 : 1);
}

const failures = runChecks(src);
if (failures.length) {
  process.stderr.write("✗ graph-identity signatures are out of sync:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ graph signatures agree: serializeGraph props are covered by appHandoffSig + contentSig, both gate app-edits identically, shareableGraph preserves structure.\n");
