#!/usr/bin/env node
// Pins index.html's MODEL-CATALOG fetch/fallback/default-resolution layer — the
// code that decides what the editor shows on first paint, offline, and when
// NanoGPT's catalog endpoint 500s, plus which model a fresh node defaults to.
//
// Why this is load-bearing (money + first-run):
//  - A wrong first-paint / offline path shows a blank or broken picker to a
//    returning visitor who is 30 seconds past pasting their key.
//  - defModelFor() feeds the default model of every new node. The wrong default
//    is the wrong PRICE — a node that silently charges for a pricier model.
//  - The empty catalog must stay PERMISSIVE (typed-in / unknown model ids are
//    never blocked) — a signed-off product decision (2026-07-04). A future
//    "helpful" strictness change here must trip this check.
//
// No browser, no network, no inference. Following the house pattern
// (check-share-link.mjs), we lift the SHIPPED catalog code out of index.html as
// TEXT and run it in a node:vm-style sandbox against stubbed fetch/localStorage —
// this check exists precisely to pin OFFLINE behavior, so every fetch is stubbed.
//
// Invariants pinned (see runChecks):
//  1. FAILURE FALLBACK  — fetch 500/throw ⇒ fetchCatalog→null, loadCatalog→stable
//     [] without throwing, and does NOT re-fetch in a loop (empty is cached).
//  2. CACHE PRIME       — a seeded localStorage cache primes CATALOG synchronously
//     (instant first paint, before any network).
//  3. SWR REVALIDATE    — refreshCatalog with a working fetch writes fresh data
//     back to the cache (writeCatCache called with the live list).
//  4. DEFAULT RESOLUTION— over a real fetched+sorted catalog, defModelFor(type)
//     returns the NEWEST entry that passes the node's filter, and NEVER one that
//     fails passesFilter for that node kind.
//  5. PERMISSIVE-EMPTY  — with an empty catalog, the capability gate that consumes
//     CATALOG (modelSupportsImages) stays permissive: an unknown model id is not
//     blocked.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- brace/string/template-aware matcher (verbatim from check-share-link.mjs) --
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

// pull `function <name>(...) { ... }` out as text
function extractFunction(src, name) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}()`);
  const open = src.indexOf("{", m.index);
  const close = matchBrace(src, open);
  return src.slice(m.index, close + 1);
}

// pull a contiguous verbatim slab from a start anchor through the close of a
// named function that ends the region — so the ACTUAL shipped catalog code runs.
function extractSlab(src, startAnchor, endFnName) {
  const start = src.indexOf(startAnchor);
  if (start === -1) throw new Error(`could not find slab start anchor: ${startAnchor}`);
  const sig = new RegExp("function\\s+" + endFnName + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src.slice(start));
  if (!m) throw new Error(`could not find slab end function ${endFnName}()`);
  const at = start + m.index;
  const open = src.indexOf("{", at);
  const close = matchBrace(src, open);
  return src.slice(start, close + 1);
}

// pull `const CHAT_IMAGE_OUT = new Set([ ... ]);` as text (simple string members)
function extractSetLiteral(src, anchor) {
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error(`could not find set literal: ${anchor}`);
  const end = src.indexOf("]);", start);
  if (end === -1) throw new Error(`unterminated set literal: ${anchor}`);
  return src.slice(start, end + 3);
}

// Build a runnable sandbox from the shipped catalog pieces + minimal stubs. The
// returned object exposes the module-level catalog surface plus mutable stubs so
// each invariant can drive fetch/localStorage independently. NODE_TYPES is a
// fixture (we test the resolver's rule, not the real node table).
function buildSandbox(src, opts = {}) {
  const chatImageOut = extractSetLiteral(src, "const CHAT_IMAGE_OUT = new Set([");
  const normChat = extractFunction(src, "normChat");
  // CATALOG .. modelSupportsAudio, verbatim (CATALOG, catalogs, cache fns,
  // fetch/load/refresh, catItem, passesFilter, defModelFor, modelSupports*).
  const slab = extractSlab(src, "const CATALOG = {", "modelSupportsAudio");

  // localStorage stub (in-memory) — seeded per test.
  const store = new Map(Object.entries(opts.seedStore || {}));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  // fetch stub — behaviour set per test; counts calls.
  let fetchCount = 0;
  const fetchState = { mode: opts.fetchMode || "throw", data: opts.fetchData || [] };
  const fetch = async () => {
    fetchCount++;
    if (fetchState.mode === "throw") throw new Error("stub: network down");
    if (fetchState.mode === "500") {
      // a real 500 body has no .data — the shipped `.data || []` path yields [],
      // which normalizes to an empty (but non-null) list.
      return { json: async () => ({ error: "server error" }) };
    }
    return { json: async () => ({ data: fetchState.data }) };
  };

  // Deps the catalog slab references but that live elsewhere in index.html.
  const EST = { llmInTokens: 1000, llmOutTokens: 500 };   // matches the shipped EST keys normChat reads
  const getKey = () => null;                              // offline: no auth header
  const NANOGPT = "https://nano-gpt.test";
  // Only the chat norm is exercised; the other three exist so `const CATALOG`
  // (which references them) constructs. They are never invoked in these tests.
  const normImg = (x) => x, normVideo = (x) => x, normAudio = (x) => x;
  const NODE_TYPES = opts.nodeTypes || {};

  const names = ["localStorage", "fetch", "EST", "getKey", "NANOGPT",
    "normChat", "normImg", "normVideo", "normAudio", "NODE_TYPES", "CHAT_IMAGE_OUT_SRC"];
  const program =
    `${chatImageOut}\n` +
    `${normChat}\n` +
    `${slab}\n` +
    `return { catalogs, CATALOG, primeCatalogsFromCache, fetchCatalog, loadCatalog,` +
    ` refreshCatalog, readCatCache, writeCatCache, catCacheKey, catItem, passesFilter,` +
    ` defModelFor, modelSupportsImages };`;

  const fn = new Function(...names, program);
  const api = fn(localStorage, fetch, EST, getKey, NANOGPT,
    normChat, normImg, normVideo, normAudio, NODE_TYPES, chatImageOut);
  return { api, store, get fetchCount() { return fetchCount; }, fetchState, localStorage };
}

// A raw NanoGPT-shaped chat catalog (UNSORTED). Newest overall (new-plain, 500)
// FAILS the vision filter — so a correct defModelFor must skip it to the newest
// vision model, which pins both "newest-passing" and "never returns a failing one".
const RAW_CHAT = [
  { id: "old-vision", name: "Old Vision", created: 100, capabilities: { vision: true }, pricing: { prompt: 1, completion: 2 } },
  { id: "mid-vision", name: "Mid Vision", created: 200, capabilities: { vision: true }, pricing: { prompt: 1, completion: 2 } },
  { id: "newest-vision", name: "Newest Vision", created: 400, capabilities: { vision: true }, pricing: { prompt: 1, completion: 2 } },
  { id: "new-plain", name: "New Plain (no vision)", created: 500, capabilities: {}, pricing: { prompt: 1, completion: 2 } },
];
const NODE_TYPES = {
  vis: { modelKind: "chat", modelFilter: "vision", imageInputs: "vision" },
  plain: { modelKind: "chat", modelFilter: "" },
};

async function runChecks(src) {
  const failures = [];
  const fail = (msg) => failures.push(msg);

  // ---- Invariant 1: FAILURE FALLBACK (throw) --------------------------------
  try {
    const s = buildSandbox(src, { fetchMode: "throw", nodeTypes: NODE_TYPES });
    const nul = await s.api.fetchCatalog("chat");
    if (nul !== null) fail(`INV1 fetchCatalog should return null on network failure, got ${JSON.stringify(nul)}`);
    const list1 = await s.api.loadCatalog("chat");
    if (!Array.isArray(list1) || list1.length !== 0)
      fail(`INV1 loadCatalog should resolve to a stable [] on failure, got ${JSON.stringify(list1)}`);
    if (s.api.catalogs.chat !== list1)
      fail("INV1 loadCatalog should stash the empty list in catalogs (so it isn't re-fetched)");
    const before = s.fetchCount;
    const list2 = await s.api.loadCatalog("chat");   // second call must NOT re-fetch
    if (s.fetchCount !== before)
      fail(`INV1 loadCatalog re-fetched after a cached failure (fetchCount ${before}→${s.fetchCount}) — offline re-hammer`);
    if (list2 !== list1) fail("INV1 second loadCatalog returned a different list object (unstable empty cache)");
    // a failure must NOT poison the persistent cache (a later success should win)
    if (s.store.has(s.api.catCacheKey("chat")))
      fail("INV1 a failed fetch wrote an empty list into the localStorage cache (would mask a later good fetch)");
  } catch (e) { fail("INV1 threw: " + (e && e.message ? e.message : e)); }

  // ---- Invariant 1b: FAILURE FALLBACK (500 body, no .data) ------------------
  try {
    const s = buildSandbox(src, { fetchMode: "500", nodeTypes: NODE_TYPES });
    const list = await s.api.loadCatalog("chat");
    if (!Array.isArray(list) || list.length !== 0)
      fail(`INV1b a 500 (no .data) body should yield an empty list, got ${JSON.stringify(list)}`);
  } catch (e) { fail("INV1b threw: " + (e && e.message ? e.message : e)); }

  // ---- Invariant 2: CACHE PRIME (synchronous first paint) -------------------
  try {
    const seeded = JSON.stringify({ t: Date.now(), list: [{ id: "cached-a" }, { id: "cached-b" }] });
    const s = buildSandbox(src, { fetchMode: "throw", seedStore: { "nn_catalog_chat": seeded } });
    // no await, no network:
    s.api.primeCatalogsFromCache();
    if (s.fetchCount !== 0) fail("INV2 primeCatalogsFromCache touched the network (must be synchronous, cache-only)");
    const primed = s.api.catalogs.chat;
    if (!Array.isArray(primed) || primed.length !== 2 || primed[0].id !== "cached-a")
      fail(`INV2 primeCatalogsFromCache did not populate CATALOG from the localStorage cache, got ${JSON.stringify(primed)}`);
  } catch (e) { fail("INV2 threw: " + (e && e.message ? e.message : e)); }

  // ---- Invariant 3: SWR REVALIDATE (working fetch writes fresh cache) -------
  try {
    const s = buildSandbox(src, { fetchMode: "ok", fetchData: RAW_CHAT, nodeTypes: NODE_TYPES });
    const ok = await s.api.refreshCatalog("chat");
    if (ok !== true) fail(`INV3 refreshCatalog should report success with a working fetch, got ${JSON.stringify(ok)}`);
    if (!Array.isArray(s.api.catalogs.chat) || s.api.catalogs.chat.length !== RAW_CHAT.length)
      fail("INV3 refreshCatalog did not update the in-memory catalog with the live list");
    const raw = s.store.get(s.api.catCacheKey("chat"));
    if (!raw) { fail("INV3 refreshCatalog did not write the fresh list to the localStorage cache"); }
    else {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.list) || parsed.list.length !== RAW_CHAT.length)
        fail(`INV3 the cache was written but not with the fresh list, got ${raw.slice(0, 120)}`);
      // sorted newest-first by fetchCatalog → the top of the written cache is the newest id
      if (parsed.list[0].id !== "new-plain")
        fail(`INV3 the written cache is not sorted newest-first (top=${parsed.list[0].id}, expected new-plain)`);
    }
  } catch (e) { fail("INV3 threw: " + (e && e.message ? e.message : e)); }

  // ---- Invariant 4: DEFAULT RESOLUTION (newest passing, never a failing one) -
  try {
    const s = buildSandbox(src, { fetchMode: "ok", fetchData: RAW_CHAT, nodeTypes: NODE_TYPES });
    await s.api.loadCatalog("chat");   // populate via the real fetch+normalize+sort pipeline
    const visDef = s.api.defModelFor("vis");
    if (visDef !== "newest-vision")
      fail(`INV4 defModelFor('vis') should pick the newest vision model 'newest-vision', got ${JSON.stringify(visDef)} (newest-overall 'new-plain' has no vision and must be skipped)`);
    // the resolved default must itself pass the node's filter
    const item = s.api.catItem("chat", visDef);
    if (!item || !s.api.passesFilter(item, NODE_TYPES.vis.modelFilter))
      fail(`INV4 defModelFor('vis') returned a model that fails passesFilter('vision')`);
    // unfiltered node → newest overall
    const plainDef = s.api.defModelFor("plain");
    if (plainDef !== "new-plain")
      fail(`INV4 defModelFor('plain') (no filter) should pick the newest overall 'new-plain', got ${JSON.stringify(plainDef)}`);
    // empty catalog → "" (no crash)
    const empty = buildSandbox(src, { fetchMode: "throw", nodeTypes: NODE_TYPES });
    if (empty.api.defModelFor("vis") !== "")
      fail("INV4 defModelFor over an empty catalog should return '' (no default), not crash or invent one");
  } catch (e) { fail("INV4 threw: " + (e && e.message ? e.message : e)); }

  // ---- Invariant 5: PERMISSIVE-EMPTY (unknown id not blocked) ---------------
  // Signed-off product decision (2026-07-04): an empty/unknown catalog stays
  // permissive so a typed-in model id is never blocked. Pin it so a future
  // strictness change is flagged here.
  try {
    const s = buildSandbox(src, { fetchMode: "throw", nodeTypes: NODE_TYPES });
    await s.api.loadCatalog("chat");   // failure ⇒ catalogs.chat === []
    if (s.api.catalogs.chat.length !== 0) fail("INV5 setup: expected an empty catalog");
    const nodeUnknown = { type: "vis", fields: { model: "some-model-nobody-has-in-catalog" } };
    if (s.api.modelSupportsImages(nodeUnknown) !== true)
      fail("INV5 an unknown model id over an EMPTY catalog must stay permissive (image ports not blocked) — the signed-off keep-permissive decision regressed");
    // and permissive too when the catalog is populated but the id is absent from it
    const s2 = buildSandbox(src, { fetchMode: "ok", fetchData: RAW_CHAT, nodeTypes: NODE_TYPES });
    await s2.api.loadCatalog("chat");
    const nodeTyped = { type: "vis", fields: { model: "typed-in-brand-new-model" } };
    if (s2.api.modelSupportsImages(nodeTyped) !== true)
      fail("INV5 a typed-in id absent from a populated catalog must stay permissive (never blocked)");
    // sanity (not the pinned decision, just guards the gate isn't a constant-true):
    const nodeKnownNoVision = { type: "vis", fields: { model: "new-plain" } };
    if (s2.api.modelSupportsImages(nodeKnownNoVision) !== false)
      fail("INV5 sanity: a KNOWN non-vision model should gate OFF (else the permissive check is vacuous)");
  } catch (e) { fail("INV5 threw: " + (e && e.message ? e.message : e)); }

  return failures;
}

// ---- self-test: mutate a sandbox copy to confirm each guard actually bites ---
async function selfTest() {
  const src = readFileSync(join(ROOT, "index.html"), "utf8");
  const cases = [
    {
      name: "INV1 broken (fetchCatalog re-throws instead of returning null)",
      mutate: (s) => s.replace("catch{ return null; }        // offline",
                               "catch{ throw new Error('boom'); }  // offline"),
    },
    {
      name: "INV4 broken (defModelFor ignores the node filter)",
      mutate: (s) => s.replace("const m = (catalogs[t.modelKind]||[]).find(x=> passesFilter(x, t.modelFilter));",
                               "const m = (catalogs[t.modelKind]||[])[0];"),
    },
    {
      name: "INV5 broken (modelSupportsImages turns strict — blocks unknown ids)",
      mutate: (s) => s.replace("return !m || !!m[t.imageInputs];   // permissive when the id isn't in the catalog",
                               "return !!m && !!m[t.imageInputs];   // STRICT (mutation)"),
    },
  ];
  let allBit = true;
  for (const c of cases) {
    const mutated = c.mutate(src);
    if (mutated === src) { console.log(`  ✗ self-test could not apply mutation: ${c.name}`); allBit = false; continue; }
    let fails;
    try { fails = await runChecks(mutated); }
    catch (e) { fails = ["harness threw: " + e.message]; }
    if (fails.length) console.log(`  ✓ caught: ${c.name}\n      → ${fails[0]}`);
    else { console.log(`  ✗ MISSED: ${c.name} (mutation did not fail the check)`); allBit = false; }
  }
  process.exit(allBit ? 0 : 1);
}

if (process.argv.includes("--selftest")) {
  await selfTest();
} else {
  let failures;
  try {
    const src = readFileSync(join(ROOT, "index.html"), "utf8");
    failures = await runChecks(src);
  } catch (e) {
    process.stderr.write("✗ check-catalog-fallback harness error: " + (e && e.stack ? e.stack : e) + "\n");
    process.exit(1);
  }
  if (failures.length) {
    process.stderr.write("✗ model-catalog fetch/fallback/default layer regressed:\n\n- " + failures.join("\n- ") + "\n");
    process.exit(1);
  }
  process.stdout.write("✓ catalog fallback holds: offline→stable [] (no re-hammer), cache primes first paint, SWR revalidates, defModelFor picks newest-passing, empty stays permissive.\n");
}
