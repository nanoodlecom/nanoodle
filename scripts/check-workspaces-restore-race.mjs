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
const server = createServer((req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    const file = resolve(ROOT, "." + p);
    if (!file.startsWith(ROOT + sep)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(file);
    res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404, { "Content-Type": "text/html" }); res.end("<!doctype html><title>404</title>"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://localhost:${server.address().port}`;   // index.html canonicalizes 127.0.0.1 to localhost
const profile = mkdtempSync(join(tmpdir(), "nanoodle-ws-race-"));
const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--remote-debugging-port=0", origin + "/blank-404"], { stdio: ["ignore", "pipe", "pipe"] });
const failures = [];
const ok = (c, m) => { if (!c) failures.push(m); };
const done = (code) => { try { proc.kill("SIGKILL"); } catch {} server.close(); try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); };
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
const g = (t) => JSON.stringify({ v: 1, nodes: [{ id: "n1", type: "text", x: 40, y: 40, fields: { text: t } }], links: [], nid: 2, lid: 1 });
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
ok(await evaluate(`openWorkspaceWithGraph(${g("GRAPH TWO")}, "Second", { fit:false }) !== false`), "setup: second workspace opens");
await evaluate(`(async()=>{ flushSave(); try{ await settleWorkspaceStorage(); }catch(_){} await new Promise(r=>setTimeout(r,800)); })()`);
let s = await evaluate(DUMP);
ok(s && s.tabs.length === 2, "setup: two workspaces saved, got " + JSON.stringify(s && s.tabs));

// 2. Reload with IndexedDB's open held back 1.5s (under the 2.5s restore timeout) and act on the strip meanwhile.
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
await send("Page.navigate", { url: origin + "/?product=off&na=0&race=1" });
for (let i = 0; i < 60; i++) { if (await evaluate(`typeof renameWorkspace==="function" && !!document.getElementById("wstabs")`)) break; await sleep(50); }
await evaluate(`(() => { const run = (f) => { try { f(); } catch (_) {} };
  run(() => renameWorkspace("w1", "Renamed during boot"));
  run(() => chooseWorkspace("blank"));
  run(() => switchWorkspace("w2"));
  run(() => commitReorder("w1", 1));
  run(() => closeWorkspace("w2"));
  run(() => save()); run(() => flushSave()); return true; })()`);
await sleep(2500); // past the held open
await evaluate(READY);
// A normal save once the restore is back.
await evaluate(`(async()=>{ save(); await new Promise(r=>setTimeout(r,500)); flushSave(); try{ await settleWorkspaceStorage(); }catch(_){} await new Promise(r=>setTimeout(r,800)); })()`);

// 3. A plain reload must still have both workspaces and both graphs.
await navigate(origin + "/?product=off&na=0&after=1");
await sleep(2500);
await evaluate(READY);
s = await evaluate(DUMP);
const all = s ? Object.values(s.graphs).join("\n") : "";
ok(s && s.tabs.length >= 2, "both saved workspaces survive actions taken during the delayed restore, got " + JSON.stringify(s && s.tabs));
ok(all.includes("GRAPH ONE"), "workspace 1's graph survives");
ok(all.includes("GRAPH TWO"), "workspace 2's graph survives");

if (failures.length) { console.error("✗ check-workspaces-restore-race:\n- " + failures.join("\n- ")); done(1); }
console.log("✓ check-workspaces-restore-race: strip actions during a slow IndexedDB restore leave both workspaces and graphs intact");
done(0);
