#!/usr/bin/env node
// Regression (P1, Oct 27 2026): a returning visitor whose localStorage is full
// and who has no noodle_workspaces index yet saw "Couldn’t store workspaces in
// this browser…" on every load. Boot's pre-restore ensureWorkspaces() wrote the
// index before initWorkspaceStorage() armed the IndexedDB overflow, so the
// QuotaExceededError hit the banner even though IndexedDB then took the
// workspaces fine. Here, in real headless Chrome against this checkout:
//   A. full localStorage + working IndexedDB → no banner, no notice left up,
//      saved graph untouched, workspaces still there after a reload;
//   B. full localStorage + no IndexedDB (session-only) → no banner, and the
//      visit-only notice says plainly that nothing was deleted.
// Offline: synthetic data in a throwaway profile, no API key, no network.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chrome = ["/usr/local/bin/google-chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => existsSync(p));
if (!chrome) { console.log("⊘ check-workspaces-full-storage: no Chrome (covered by check-workspaces.mjs)"); process.exit(0); }

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
const profile = mkdtempSync(join(tmpdir(), "nanoodle-ws-full-"));
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

const GRAPH = JSON.stringify({ v: 1, nodes: [{ id: "n1", type: "text", x: 40, y: 40, fields: { text: "SYNTHETIC PRECIOUS PROMPT" } }], links: [], nid: 2, lid: 1 });
const FILL = `(() => { localStorage.clear();
  localStorage.setItem("noodle_hint_dismissed","1"); localStorage.setItem("noodle_connect_hint_dismissed","1");
  localStorage.setItem("noodle_graph", ${JSON.stringify(GRAPH)});
  let s = "x".repeat(1<<20), i = 0;
  while (true) { try { localStorage.setItem("zz_fill_" + i++, s); } catch (e) { if (s.length < 4) break; s = s.slice(0, s.length >> 1); } }
  return !localStorage.getItem("noodle_workspaces"); })()`;
const STATE = `(async () => {
  for (let i = 0; i < 60; i++) { if (typeof settleWorkspaceStorage === "function" && document.getElementById("wstabs")) break; await new Promise(r => setTimeout(r, 100)); }
  try { await settleWorkspaceStorage(); } catch (_) {}
  await new Promise(r => setTimeout(r, 600));
  const box = document.getElementById("wspersistence");
  return { banner: (window.__seen + document.body.innerText).includes("store workspaces in this browser"),
    notice: box && !box.hidden ? box.textContent : "",
    graph: localStorage.getItem("noodle_graph"),
    tabs: (() => { try { return readWorkspaces().tabs.length; } catch (_) { return 0; } })() };
})()`;

// A. IndexedDB works.
await navigate(origin + "/blank-404");
ok(await evaluate(FILL), "A: setup leaves no index in a full localStorage");
await navigate(origin + "/?product=off&na=0");
let s = await evaluate(STATE);
ok(s && !s.banner, "A: full localStorage + working IndexedDB must not show the storage banner");
ok(s && !s.notice, "A: no visit-only notice once IndexedDB holds the workspaces, got: " + (s && s.notice));
ok(s && String(s.graph).includes("SYNTHETIC PRECIOUS PROMPT"), "A: the saved graph is untouched");
ok(s && s.tabs >= 1, "A: the workspace strip has a tab");
await navigate(origin + "/?product=off&na=0&r=1");
s = await evaluate(STATE);
ok(s && !s.banner, "A: no banner after a reload either");
ok(s && s.tabs >= 1, "A: workspaces come back after a reload");

// B. No IndexedDB: session-only.
await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{ Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true }); }catch(_){}` });
await navigate(origin + "/blank-404?b");
await evaluate(FILL);
await navigate(origin + "/?product=off&na=0&b=1");
s = await evaluate(STATE);
ok(s && !s.banner, "B: session-only mode does not show the misleading storage banner");
ok(s && /visit only/.test(s.notice) && /Nothing was deleted/.test(s.notice), "B: the session-only notice says visit-only and nothing deleted, got: " + (s && s.notice));
ok(s && !/could not be restored/.test(s.notice), "B: a browser with no IndexedDB is not told a restore failed");
ok(s && String(s.graph).includes("SYNTHETIC PRECIOUS PROMPT"), "B: the saved graph is untouched");

if (failures.length) { console.error("✗ check-workspaces-full-storage:\n- " + failures.join("\n- ")); done(1); }
console.log("✓ check-workspaces-full-storage: a full localStorage overflows to IndexedDB without the banner; session-only mode says so plainly");
done(0);
