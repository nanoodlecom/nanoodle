#!/usr/bin/env node
// Browser pin: serve index.html with the real /index.html Content-Security-Policy
// from _headers and drop a GLB. connect-src does not allow data:, so the viewer
// has to take the bytes (or a blob:) rather than fetch a data: URL.
// Uses system Chrome. Exits 0 with a skip when Chrome isn't installed — the same
// drop is also asserted by scripts/smoke-first-run.mjs in the browser CI job.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chrome = ["/usr/local/bin/google-chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
  .find((p) => existsSync(p));
if (!chrome) {
  console.log("⊘ check-3d-csp: no Chrome (covered by scripts/smoke-first-run.mjs)");
  process.exit(0);
}

const headerText = readFileSync(join(ROOT, "_headers"), "utf8");
const cspByPath = new Map();
let path = null;
for (const line of headerText.split("\n")) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  if (!/^\s/.test(line)) { path = line.trim(); continue; }
  const m = line.match(/^\s*Content-Security-Policy:\s*(.+)$/);
  if (m && path && !cspByPath.has(path)) cspByPath.set(path, m[1].trim());
}
const csp = cspByPath.get("/index.html") || "";
if (!/connect-src/.test(csp) || /connect-src[^;]*\bdata:/.test(csp)) {
  console.error("✗ _headers /index.html CSP is missing or allows connect-src data:");
  process.exit(1);
}

const mime = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".glb": "model/gltf-binary" };
const server = createServer((req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/") pathname = "/index.html";
    const file = resolve(ROOT, "." + pathname);
    if (!file.startsWith(ROOT + sep)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(file);
    const headers = { "Content-Type": mime[extname(file)] || "application/octet-stream" };
    if (pathname === "/index.html") headers["Content-Security-Policy"] = csp;
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(join(tmpdir(), "nanoodle-3d-csp-"));
const proc = spawn(chrome, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl",
  `--user-data-dir=${profile}`, "--remote-debugging-port=0", origin + "/?product=off&na=0",
], { stdio: ["ignore", "pipe", "pipe"] });
let dbg = "";
const fail = (m) => { console.error("✗ " + m); proc.kill("SIGKILL"); server.close(); process.exit(1); };
// Wait for Chrome to print its DevTools port. Override with CHECK_3D_CSP_CHROME_TIMEOUT_MS.
const chromeStartMs = Number(process.env.CHECK_3D_CSP_CHROME_TIMEOUT_MS) || 60000;
const port = await new Promise((resolvePort, reject) => {
  const t = setTimeout(() => reject(new Error("chrome debug port")), chromeStartMs);
  const on = (buf) => {
    dbg += buf.toString();
    const m = dbg.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (m) { clearTimeout(t); resolvePort(m[1]); }
  };
  proc.stderr.on("data", on);
  proc.stdout.on("data", on);
  proc.on("exit", () => { clearTimeout(t); reject(new Error("chrome exited")); });
});
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) fail("no debuggable page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const waitOpen = new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
await waitOpen;
const send = (method, params = {}) => new Promise((res) => {
  const n = ++id;
  pending.set(n, res);
  ws.send(JSON.stringify({ id: n, method, params }));
});
await send("Runtime.enable");
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  try {
    localStorage.setItem("noodle_hint_dismissed", "1");
    localStorage.setItem("noodle_connect_hint_dismissed", "1");
    localStorage.setItem("noodle_graph", JSON.stringify({ v:1, nodes:[], links:[], nid:1, lid:1 }));
  } catch (e) {}
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => { window.__csp.push(e.violatedDirective + " " + e.blockedURI); });
` });
await send("Page.reload", { ignoreCache: true });
const glb = readFileSync(join(ROOT, "examples/product-shot/sample.glb")).toString("base64");
for (let i = 0; i < 40; i++) {
  const ready = await send("Runtime.evaluate", { expression: "!!document.querySelector('#editor')", returnByValue: true });
  if (ready.result && ready.result.result && ready.result.result.value) break;
  await new Promise((r) => setTimeout(r, 250));
}
const drop = await send("Runtime.evaluate", {
  expression: `(() => {
    const bin = Uint8Array.from(atob(${JSON.stringify(glb)}), (c) => c.charCodeAt(0));
    const file = new File([bin], "duck.glb", { type: "model/gltf-binary" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const editor = document.querySelector("#editor");
    if (!editor) return "no-editor";
    const r = editor.getBoundingClientRect();
    const ev = new DragEvent("drop", { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + 180 });
    Object.defineProperty(ev, "dataTransfer", { value: dt });
    editor.dispatchEvent(ev);
    return "dropped";
  })()`,
  returnByValue: true,
});
if (!drop.result || drop.result.result.value !== "dropped") fail("drop did not run: " + JSON.stringify(drop.result && drop.result.result));
let drew = false;
for (let i = 0; i < 40; i++) {
  const probe = await send("Runtime.evaluate", {
    expression: `(() => {
      const canvas = document.querySelector(".node .glb-canvas");
      const err = document.querySelector(".glb-err");
      return JSON.stringify({
        vis: canvas ? canvas.style.visibility : "",
        err: err ? err.textContent : "",
        csp: (window.__csp || []).filter((s) => /connect-src/.test(s) && /data:/.test(s))
      });
    })()`,
    returnByValue: true,
  });
  const raw = probe.result && probe.result.result && probe.result.result.value;
  if (raw) {
    const state = JSON.parse(raw);
    if (state.csp.length) fail("CSP blocked a data: fetch: " + state.csp.join("; "));
    if (state.err) fail("viewer error: " + state.err);
    if (state.vis && state.vis !== "hidden") { drew = true; break; }
  }
  await new Promise((r) => setTimeout(r, 250));
}
if (!drew) fail("dropped GLB did not draw a canvas under the production CSP");
console.log("✓ check-3d-csp: dropped GLB draws under the _headers CSP");
ws.close();
proc.kill("SIGKILL");
server.close();
