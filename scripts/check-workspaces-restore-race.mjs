#!/usr/bin/env node
// Regression (P0, Oct 28 2026): while IndexedDB was still restoring w1 and w2,
// renaming w1 from the strip wrote a partial index that the restore never
// merged back; the next normal save then dropped w2 and its graph while the
// app reported healthy saving. Workspace mutations now wait for the restore.
// Real headless Chrome, throwaway profile, synthetic data, no network.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chrome = ["/usr/local/bin/google-chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => existsSync(p));
if (!chrome) { console.log("⊘ check-workspaces-restore-race: no Chrome (covered by check-workspaces.mjs)"); process.exit(0); }

const mime = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml" };
let slowStarterMs = 0;   // section 6 slows the shipped starter fetch
const handler = async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/noodle-graph.json" && slowStarterMs) await new Promise(r => setTimeout(r, slowStarterMs));
    if (p === "/") p = "/index.html";
    const file = resolve(ROOT, "." + p);
    if (!file.startsWith(ROOT + sep)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(file);
    res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404, { "Content-Type": "text/html" }); res.end("<!doctype html><title>404</title>"); }
};
const server = createServer(handler);
const freshServer = createServer(handler);   // a second origin = a fresh profile's empty storage, without clearing anything
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://localhost:${server.address().port}`;
await new Promise((r) => freshServer.listen(0, "127.0.0.1", r));
const freshOrigin = `http://localhost:${freshServer.address().port}`;   // index.html canonicalizes 127.0.0.1 to localhost
const profile = mkdtempSync(join(tmpdir(), "nanoodle-ws-race-"));
const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--remote-debugging-port=0", origin + "/blank-404"], { stdio: ["ignore", "pipe", "pipe"] });
const failures = [];
const ok = (c, m) => { if (!c) failures.push(m); };
const done = (code) => { try { proc.kill("SIGKILL"); } catch {} server.close(); freshServer.close(); try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); };
let dbg = "";
const port = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("chrome debug port")), 60000);
  const on = (b) => { dbg += b; const m = dbg.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(t); res(m[1]); } };
  proc.stderr.on("data", on); proc.stdout.on("data", on);
}).catch((e) => { console.error("✗ " + e.message); done(1); });
let page = null;
for (let i = 0; i < 40 && !page; i++) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) await new Promise((r) => setTimeout(r, 250));
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
let id = 0; const pending = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const navigate = async (url) => { await send("Page.navigate", { url }); await sleep(300);
  for (let i = 0; i < 120; i++) { if (await evaluate(`document.readyState==="complete" && location.href===${JSON.stringify(url)}`)) return; await sleep(250); } };
await send("Runtime.enable"); await send("Page.enable");
// Toasts fade, so record every text the page ever showed.
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__seen = "";
  new MutationObserver(() => { try { window.__seen += "\\n" + document.body.innerText; } catch (_) {} })
    .observe(document, { subtree: true, childList: true, characterData: true });` });


// The saved graphs carry the names, so a lost w2 is a missing string.
const UPLOAD = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const g = (t, up) => JSON.stringify({ v: 1, nodes: [{ id: "n1", type: "text", x: 40, y: 40, fields: { text: t } }]
  .concat(up ? [{ id: "n2", type: "upload", x: 300, y: 40, fields: { image: UPLOAD } }] : []), links: [], nid: 3, lid: 1 });
const FILL = `(() => { localStorage.clear();
  localStorage.setItem("noodle_hint_dismissed","1"); localStorage.setItem("noodle_connect_hint_dismissed","1");
  localStorage.setItem("noodle_graph", ${JSON.stringify(g("GRAPH ONE"))});
  let s = "x".repeat(1<<20), i = 0;
  while (true) { try { localStorage.setItem("zz_fill_" + i++, s); } catch (e) { if (s.length < 4) break; s = s.slice(0, s.length >> 1); } }
  return true; })()`;
const READY = `(async () => {
  for (let i = 0; i < 80; i++) { if (typeof settleWorkspaceStorage === "function" && document.getElementById("wstabs")) break; await new Promise(r => setTimeout(r, 100)); }
  try { await settleWorkspaceStorage(); } catch (_) {}
  await new Promise(r => setTimeout(r, 800)); return true; })()`;
const DUMP = `(async () => { ${"" }
  const d = readWorkspaces(); const graphs = {};
  for (const t of d.tabs) graphs[t.id] = t.id === d.active ? JSON.stringify(serializeGraph()) : String(workspaceStorage.getItem("noodle_ws_" + t.id));
  return { tabs: d.tabs.map(t => t.id + ":" + t.name), graphs, notice: (document.getElementById("wspersistence")||{}).hidden === false };
})()`;

// 1. A healthy visit with two saved workspaces, held by IndexedDB.
await navigate(origin + "/blank-404");
await evaluate(FILL);
await navigate(origin + "/?product=off&na=0");
await evaluate(READY);
ok(await evaluate(`openWorkspaceWithGraph(${g("GRAPH TWO", true)}, "Second", { fit:false }) !== false`), "setup: second workspace opens");
await evaluate(`(async()=>{ flushSave(); try{ await settleWorkspaceStorage(); }catch(_){} await new Promise(r=>setTimeout(r,800)); })()`);
let s = await evaluate(DUMP);
ok(s && s.tabs.length === 2, "setup: two workspaces saved, got " + JSON.stringify(s && s.tabs));

// 2. Reload with IndexedDB's open held back 1.5s (under the 2.5s restore
// timeout) and act meanwhile. Each scenario is one way a user or link could
// mutate workspaces before the saved tabs are back.
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const real = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (...a) {
    const f = this, fake = { onsuccess:null, onerror:null, onupgradeneeded:null, onblocked:null, _r:null,
      get result(){ return this._r && this._r.result; }, get error(){ return this._r && this._r.error; },
      addEventListener(){}, removeEventListener(){} };
    setTimeout(() => { const r = real.apply(f, a); fake._r = r;
      for (const k of ["onsuccess","onerror","onupgradeneeded","onblocked"]) r[k] = (e) => fake[k] && fake[k].call(fake, e); }, 1500);
    return fake;
  };
})();` });
const SCENARIOS = {
  strip: `run(() => renameWorkspace("w1", "Renamed during boot"));
    run(() => chooseWorkspace("blank")); run(() => switchWorkspace("w2"));
    run(() => commitReorder("w1", 1)); run(() => closeWorkspace("w2"));
    run(() => save()); run(() => flushSave());`,
  // Ember's P1: Plus → Browse Examples → pick one, mid-restore.
  examples: `run(() => document.querySelector('[data-ws="examples"]').click());
    run(() => openExamples()); out.pick = (() => { try { loadExample(0); return "ran"; } catch (e) { return String(e); } })();`,
  direct: `out.open = (() => { try { return openWorkspaceWithGraph(${JSON.stringify(g("INTRUDER"))}, "Intruder", { fit:false }); } catch (e) { return String(e); } })();
    out.ex = (() => { try { return openExampleWorkspace(JSON.parse(${JSON.stringify(g("INTRUDER EX"))}), "Ex", "x-slug"); } catch (e) { return String(e); } })();
    run(() => restoreClosedWorkspace());
    run(() => loadFile(new File([${JSON.stringify(g("INTRUDER FILE"))}], "f.json", { type: "application/json" })));
    run(() => workspaceStorage.setItem("noodle_ws_w9", "x"));`,
};
for (const [name, actions] of Object.entries(SCENARIOS)) {
  await send("Page.navigate", { url: origin + "/?product=off&na=0&race=" + name });
  for (let i = 0; i < 80; i++) { if (await evaluate(`typeof renameWorkspace==="function" && !!document.getElementById("wstabs")`)) break; await sleep(25); }
  const out = await evaluate(`(() => { const out = {}; const run = (f) => { try { f(); } catch (_) {} }; ${actions} return out; })()`);
  if (name === "direct") ok(out && out.open === false && out.ex === false, `direct: opens are refused mid-restore, got ${JSON.stringify(out)}`);
  await sleep(2500); // past the held open
  await evaluate(READY);
  try { await evaluate(`closeExamples()`); } catch {}
  // A normal save once the restore is back.
  await evaluate(`(async()=>{ save(); await new Promise(r=>setTimeout(r,500)); flushSave(); try{ await settleWorkspaceStorage(); }catch(_){} await new Promise(r=>setTimeout(r,800)); })()`);
  // 3. A reload must still have both workspaces, both graphs and the upload.
  await navigate(origin + "/?product=off&na=0&after=" + name);
  await sleep(2500);
  await evaluate(READY);
  s = await evaluate(DUMP);
  const all = s ? Object.values(s.graphs).join("\n") : "";
  const ids = s ? s.tabs.map(t => t.split(":")[0]) : [];
  ok(ids.includes("w1") && ids.includes("w2"), `${name}: w1 and w2 survive actions during the delayed restore, got ${JSON.stringify(s && s.tabs)}`);
  ok(all.includes("GRAPH ONE"), `${name}: workspace 1's graph survives`);
  ok(all.includes("GRAPH TWO"), `${name}: workspace 2's graph survives`);
  ok(all.includes(UPLOAD), `${name}: workspace 2's upload survives`);
  ok(!/INTRUDER/.test(all), `${name}: nothing was opened mid-restore`);
}

// 4. Ember's P2: a compressed share link that lands mid-restore is held,
// replayed, AND seen by normal boot. It must import exactly once.
{
  const { gzipSync } = await import("node:zlib");
  const SHARE = "#g=" + gzipSync(Buffer.from(g("SHARED LINK"))).toString("base64url");
  const COUNT = `(() => { const d = readWorkspaces(); let n = 0;
    for (const t of d.tabs) { const j = t.id === d.active ? JSON.stringify(serializeGraph()) : String(workspaceStorage.getItem("noodle_ws_" + t.id)); if (j.includes("SHARED LINK")) n++; }
    return { n, tabs: d.tabs.length, hash: location.hash }; })()`;
  for (const how of ["hashchange", "url"]) {
    if (how === "url") await send("Page.navigate", { url: origin + "/?product=off&na=0&share=url" + SHARE });
    else {
      await send("Page.navigate", { url: origin + "/?product=off&na=0&share=hc" });
      for (let i = 0; i < 80; i++) { if (await evaluate(`typeof onWorkspaceHash==="function" && !!document.getElementById("wstabs")`)) break; await sleep(25); }
      await evaluate(`location.hash = ${JSON.stringify(SHARE)}; true`);
    }
    await sleep(2500);
    await evaluate(READY);
    await sleep(1000);
    let c = await evaluate(COUNT);
    ok(c && c.n === 1, `share/${how}: mid-restore link imported exactly once, got ${JSON.stringify(c)}`);
    await evaluate(`(async()=>{ flushSave(); try{ await settleWorkspaceStorage(); }catch(_){} await new Promise(r=>setTimeout(r,800)); })()`);
    await navigate(origin + "/?product=off&na=0&after=share-" + how);
    await sleep(2500);
    await evaluate(READY);
    c = await evaluate(COUNT);
    ok(c && c.n === 1, `share/${how}: still exactly one imported tab after reload, got ${JSON.stringify(c)}`);
    s = await evaluate(DUMP);
    const ids = s ? s.tabs.map(t => t.split(":")[0]) : [];
    ok(ids.includes("w1") && ids.includes("w2"), `share/${how}: w1 and w2 still there`);
    // drop the imported tab so the next variant starts from the same two
    await evaluate(`(async()=>{ const d = readWorkspaces(); for (const t of d.tabs) if (t.id!=="w1" && t.id!=="w2") { try{ closeWorkspace(t.id); }catch(_){} } flushSave(); try{ await settleWorkspaceStorage(); }catch(_){} await new Promise(r=>setTimeout(r,800)); })()`);
  }
}

// 5. The single-flight entry is cleared once an import settles: the same link
// can be reopened after its tab is closed, and a failed import can be retried.
{
  const { gzipSync } = await import("node:zlib");
  const LINK = "#g=" + gzipSync(Buffer.from(g("REOPEN LINK"))).toString("base64url");
  await navigate(origin + "/?product=off&na=0&reopen=1");
  await sleep(2500);
  await evaluate(READY);
  const COUNT2 = `(() => { const d = readWorkspaces(); let n = 0;
    for (const t of d.tabs) { const j = t.id === d.active ? JSON.stringify(serializeGraph()) : String(workspaceStorage.getItem("noodle_ws_" + t.id)); if (j.includes("REOPEN LINK")) n++; }
    return { n, tabs: d.tabs.length, active: d.active }; })()`;
  const open = `(async () => { history.replaceState({}, "", location.pathname + location.search); location.hash = ${JSON.stringify(LINK)};
    await new Promise(r => setTimeout(r, 1500)); return true; })()`;
  await evaluate(open);
  let c = await evaluate(COUNT2);
  ok(c && c.n === 1, `reopen: first open imports one tab, got ${JSON.stringify(c)}`);
  await evaluate(`(async()=>{ closeWorkspace(readWorkspaces().active); await new Promise(r=>setTimeout(r,500)); return true; })()`);
  const afterClose = await evaluate(COUNT2);
  ok(afterClose && afterClose.n === 0, `reopen: closing removes the imported tab, got ${JSON.stringify(afterClose)}`);
  await evaluate(open);
  c = await evaluate(COUNT2);
  ok(c && c.n === 1 && c.tabs === afterClose.tabs + 1, `reopen: the same link opened again creates a new tab, got ${JSON.stringify(c)} after ${JSON.stringify(afterClose)}`);
  await evaluate(`(async()=>{ closeWorkspace(readWorkspaces().active); await new Promise(r=>setTimeout(r,500)); return true; })()`);

  // Forced failure, then a retry of the same link.
  const before = await evaluate(COUNT2);
  const failed = await evaluate(`(async () => { const real = window.loadFromHash; let threw = false;
    window.loadFromHash = () => Promise.reject(new Error("forced import failure"));
    history.replaceState({}, "", location.pathname + location.search + ${JSON.stringify(LINK)});   // no hashchange: only this call imports
    try { await importHashOnce(); } catch (_) { threw = true; }
    window.loadFromHash = real; await new Promise(r => setTimeout(r, 300)); return threw; })()`);
  ok(failed === true, "retry: the forced import failed");
  c = await evaluate(COUNT2);
  ok(c && c.n === 0 && c.tabs === before.tabs, `retry: the failed import created nothing, got ${JSON.stringify(c)}`);
  const retried = await evaluate(`(async () => { try { return await importHashOnce(); } catch (e) { return String(e); } })()`);
  await sleep(800);
  c = await evaluate(COUNT2);
  ok(retried === true && c && c.n === 1, `retry: the same link retried imports once, got ${JSON.stringify(retried)} ${JSON.stringify(c)}`);
}

// 6. Ember's block: fresh profile, a share link lands mid-restore, and the
// shipped starter is slow. The starter must never overwrite the shared graph.
{
  const { gzipSync } = await import("node:zlib");
  const LINK = "#g=" + gzipSync(Buffer.from(g("FRESH SHARED"))).toString("base64url");
  slowStarterMs = 4000;
  await send("Page.navigate", { url: freshOrigin + "/?product=off&na=0&fresh=1" });
  for (let i = 0; i < 80; i++) { if (await evaluate(`typeof onWorkspaceHash==="function" && !!document.getElementById("wstabs")`)) break; await sleep(25); }
  const held = await evaluate(`(() => { const p = wsRestorePending; location.hash = ${JSON.stringify(LINK)}; return p; })()`);
  ok(held === true, "fresh: the link landed while the restore was still pending");
  await sleep(7000);   // past the held restore AND the slowed starter
  await evaluate(READY);
  const FRESH = `(() => { const d = readWorkspaces(); const all = d.tabs.map(t => t.id === d.active ? JSON.stringify(serializeGraph()) : String(workspaceStorage.getItem("noodle_ws_" + t.id))).join("\\n");
    return { shared: (all.match(/FRESH SHARED/g) || []).length, starter: /Raohe night market/.test(JSON.stringify(serializeGraph())), canvasShared: /FRESH SHARED/.test(JSON.stringify(serializeGraph())), tabs: d.tabs.length }; })()`;
  let f = await evaluate(FRESH);
  ok(f && f.canvasShared && !f.starter, `fresh: canvas shows the shared graph, not the starter, got ${JSON.stringify(f)}`);
  await evaluate(`(async()=>{ save(); await new Promise(r=>setTimeout(r,400)); flushSave(); try{ await settleWorkspaceStorage(); }catch(_){} await new Promise(r=>setTimeout(r,800)); })()`);
  slowStarterMs = 0;
  await navigate(freshOrigin + "/?product=off&na=0&fresh=after");
  await sleep(2500);
  await evaluate(READY);
  f = await evaluate(FRESH);
  ok(f && f.shared === 1 && f.canvasShared && !f.starter, `fresh: after save + reload the shared graph persists once and the starter does not, got ${JSON.stringify(f)}`);
}

if (failures.length) { console.error("✗ check-workspaces-restore-race:\n- " + failures.join("\n- ")); done(1); }
console.log("✓ check-workspaces-restore-race: strip, Examples, direct opens and a share link (imported once; reopen and retry work; a slow starter never clobbers it on a fresh profile) during a slow IndexedDB restore leave both workspaces, graphs and the upload intact");
done(0);
