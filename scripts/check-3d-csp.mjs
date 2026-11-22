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
// Paint budget for the dropped GLB. A fixed 10s (40 × 250ms) expired on slow
// runners before SwiftShader drew. CHECK_3D_CSP_DRAW_TIMEOUT_MS overrides it
// only when the value is a base-10 integer from 1 to 600000. Anything else
// warns and keeps this default, so a bad override does not fail the CSP check.
const DRAW_TIMEOUT_DEFAULT_MS = 45000;
const DRAW_TIMEOUT_MAX_MS = 600000;
function drawTimeoutMsFromEnv(raw) {
  if (raw == null) return DRAW_TIMEOUT_DEFAULT_MS;
  const text = String(raw).trim();
  const n = Number(text);
  if (/^[0-9]+$/.test(text) && Number.isInteger(n) && n >= 1 && n <= DRAW_TIMEOUT_MAX_MS) return n;
  console.warn("⚠ CHECK_3D_CSP_DRAW_TIMEOUT_MS=" + JSON.stringify(raw) + " is not an integer from 1 to " + DRAW_TIMEOUT_MAX_MS + "; using " + DRAW_TIMEOUT_DEFAULT_MS + "ms");
  return DRAW_TIMEOUT_DEFAULT_MS;
}
const drawTimeoutMs = drawTimeoutMsFromEnv(process.env.CHECK_3D_CSP_DRAW_TIMEOUT_MS);
const chrome = process.env.NANOODLE_CHROMIUM ||
  ["/usr/local/bin/google-chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
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
let exportedApp;
const server = createServer((req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/rig-app.html" && exportedApp) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(exportedApp);
      return;
    }
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
  "--password-store=basic", "--use-mock-keychain", "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
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
const listeners = new Set();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method) for (const l of [...listeners]) l(msg);
});
// Resolve on the next CDP event named `method` (or after `ms`, resolving null).
const nextEvent = (method, ms) => new Promise((res) => {
  const t = setTimeout(() => { listeners.delete(on); res(null); }, ms);
  const on = (msg) => { if (msg.method === method) { clearTimeout(t); listeners.delete(on); res(msg); } };
  listeners.add(on);
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
// Mark the current document so the new one can be told apart after the reload.
await send("Runtime.evaluate", { expression: "window.__cspOldDoc = true", returnByValue: true });
const loaded = nextEvent("Page.loadEventFired", 30000);
await send("Page.reload", { ignoreCache: true });
await loaded; // null on timeout; the readiness poll below is the real gate

// Synthetic drops reach an inert editor too. Wait for storage restoration and the
// initial canvas before dispatching: either can replace a graph dropped during boot.
const READY = `(() => {
  const editor = document.querySelector("#editor");
  return document.readyState === "complete" && !window.__cspOldDoc && !!editor && !editor.inert &&
    typeof wsRestorePending !== "undefined" && !wsRestorePending &&
    typeof initialCanvasUnclaimed === "function" && !initialCanvasUnclaimed() &&
    typeof droppedFileKind === "function" && typeof addNode === "function";
})()`;
async function waitReady() {
  for (let i = 0; i < 120; i++) {
    const r = await send("Runtime.evaluate", { expression: READY, returnByValue: true });
    if (r.result && r.result.result && r.result.result.value === true) return true;
    await new Promise((res) => setTimeout(res, 250));
  }
  return false;
}
if (!(await waitReady())) fail("reloaded page never became ready (document loaded, workspaces restored, canvas initialized)");

const glb = readFileSync(join(ROOT, "examples/product-shot/sample.glb")).toString("base64");
// The drop re-checks readiness in the same evaluation, so it can't land in a document
// that replaced the ready one in between (still running its scripts, no drop handler yet).
const DROP = `(() => {
    if (!${READY}) return "not-ready";
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
    window.__cspDropped = true;
    return "dropped";
  })()`;
// A CDP error (no result), e.g. "Execution context was destroyed", means the page navigated mid-step.
async function dropOnce() {
  const drop = await send("Runtime.evaluate", { expression: DROP, returnByValue: true });
  if (!drop.result) return { navigated: true, detail: JSON.stringify(drop.error || drop) };
  if (drop.result.result && drop.result.result.value === "not-ready") return { navigated: true, detail: "page was not ready (navigated)" };
  if (drop.result.result && drop.result.result.value === "dropped") return { ok: true };
  return { detail: JSON.stringify(drop.result.exceptionDetails || drop.result.result) };
}
let retried = false;
async function drop() {
  let d = await dropOnce();
  if (d.navigated && !retried) {
    retried = true;
    console.log("  ↻ page navigated during the drop; waiting for it and retrying once");
    if (!(await waitReady())) fail("page never became ready again after navigating mid-drop");
    d = await dropOnce();
  }
  if (!d.ok) fail("drop did not run: " + d.detail);
}
await drop();
const drawPollMs = 250;
let drew = false;
let lastState = null;
const drawDeadline = Date.now() + drawTimeoutMs;
while (Date.now() < drawDeadline) {
  const probe = await send("Runtime.evaluate", {
    expression: `(() => {
      const canvas = document.querySelector(".node .glb-canvas");
      const err = document.querySelector(".glb-err");
      return JSON.stringify({
        dropped: !!window.__cspDropped,
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
    lastState = state;
    if (!state.dropped) {
      // the document holding the drop is gone: the page navigated after the drop step
      if (retried) fail("page navigated again after the retried drop");
      retried = true;
      console.log("  ↻ page navigated after the drop; waiting for it and retrying once");
      if (!(await waitReady())) fail("page never became ready again after navigating");
      const d = await dropOnce();
      if (!d.ok) fail("drop did not run: " + d.detail);
      continue;
    }
    if (state.csp.length) fail("CSP blocked a data: fetch: " + state.csp.join("; "));
    if (state.err) fail("viewer error: " + state.err);
    if (state.vis && state.vis !== "hidden") { drew = true; break; }
  }
  await new Promise((r) => setTimeout(r, drawPollMs));
}
if (!drew) fail("dropped GLB did not draw a canvas under the production CSP within " + drawTimeoutMs + "ms; last state " + JSON.stringify(lastState));
console.log("✓ check-3d-csp: dropped GLB draws under the _headers CSP");
// Exercise the installed graph runners with the same dropped, textured GLB.
// The editor reads local model bytes under its shipping connect-src policy.
const stack = await send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => {
  const input = graph.nodes.find(n => n.type === "mupload");
  function addConnected(type, origin, dir, port, x) {
    const socket = origin.el.querySelector('.port[data-dir="' + dir + '"][data-port="' + port + '"]');
    quickSpawn(type, x, 200, dir, socket.dataset.ptype, socket);
    return graph.nodes[graph.nodes.length - 1];
  }
  const slicer = addConnected("slice-3d", input, "out", "model", 400);
  const mode = slicer.el.querySelector("[data-slice-output]");
  const animation = slicer.el.querySelector("[data-slice-animation]");
  if(mode.value!=="rest" || !animation.hidden || animation.offsetHeight) throw Error("A new Slice 3D node should show a still output");
  for(let i=0;i<100 && !mode.options[1].disabled;i++) await new Promise(r=>setTimeout(r,50));
  if(!mode.options[1].disabled || !slicer.el.querySelector("[data-slice-source-hint]").textContent.includes("no animation clips"))
    throw Error("Static model should explain why animation is unavailable");
  Object.assign(slicer.fields, {slices:16, resolution:24});
  const render = addConnected("sprite-stack-render", slicer, "out", "sheet", 720);
  await runGroup([render.id]);
  const layout = JSON.parse(slicer.out.layout);
  const img = new Image(); img.src = slicer.out.sheet; await img.decode();
  const preview = slicer.out.image;
  const saved = serializeGraph();
  applyGraphData(saved);
  await runGroup([render.id]);
  // Export through the same graph with browser recording unavailable.
  const restoredRender = byId(render.id);
  Object.assign(restoredRender.fields, {turntable:true, duration:0.5, fps:8});
  const recorder = window.MediaRecorder;
  try {
    window.MediaRecorder = undefined;
    await runGroup([restoredRender.id]);
  } finally {
    window.MediaRecorder = recorder;
  }
  const url = restoredRender.out.video;
  if (!url?.startsWith("data:video/mp4;base64,")) throw new Error("Missing MP4 turntable");
  const encoded = atob(url.slice(url.indexOf(",") + 1));
  const mp4 = encoded.slice(4, 8) === "ftyp" && encoded.includes("avcC");
  const player = document.createElement("video");
  let played = false;
  if (player.canPlayType('video/mp4; codecs="avc1.42001f"')) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("Timed out decoding turntable")), 10000);
      player.onloadeddata = () => { clearTimeout(timeout); resolve(); };
      player.onerror = () => { clearTimeout(timeout); reject(Error("Browser could not decode turntable")); };
      player.src = url;
      player.load();
    });
    played = player.videoWidth > 0 && Math.abs(player.duration - 0.5) < 0.01;
    if (!played) throw new Error("Wrong duration or dimensions for browser-decoded turntable");
  }
  const destination = addNode("sprite-stack-render", 1400, 200, {});
  const imageSink = addNode("resize", 1400, 800, {});
  function checkUpstream(dest, port, x) {
    const src = addConnected("slice-3d", dest, "in", port, x);
    return serializeGraph().links.some(l => l.from.node === src.id && l.from.port === port &&
      l.to.node === dest.id && l.to.port === port);
  }
  const source = byId(slicer.id);
  history.replaceState(null, "", location.pathname);
  function checkAddMenu(type, port) {
    const dest = addNode(type, 1800, 1200, {});
    geoSettleNew(dest, {dir:"out", anchor:source});
    return serializeGraph().links.some(l => l.from.node === source.id && l.from.port === port &&
      l.to.node === dest.id && l.to.port === port);
  }
  const wiring = {upstreamSheet:checkUpstream(destination,"sheet",1100), upstreamImage:checkUpstream(imageSink,"image",1100),
    menuSheet:checkAddMenu("sprite-stack-render","sheet"), menuImage:checkAddMenu("resize","image")};
  const wired = Object.values(wiring).every(Boolean);
  return {
    wiring, wired, mp4, played, width: img.width, height: img.height, order: layout.order,
    same: preview === byId(render.id).out.image,
    restored: byId(slicer.id).out.sheet === slicer.out.sheet,
    violations: (window.__csp || []).filter(s => /connect-src.*(?:data:|blob:)/.test(s))
  };
})()` });
const result = stack.result?.result?.value;
if (!result || !result.wired || !result.mp4 || result.width !== 384 || result.height !== 24 || result.order !== "bottom-to-top" ||
    !result.same || !result.restored || result.violations.length) {
  fail("sprite stack editor run/reopen failed: " + JSON.stringify(result || stack.result?.exceptionDetails?.text || stack.error));
}
console.log("✓ check-3d-csp: textured GLB slices, reopens and exports MP4 under the editor CSP" + (result.played ? " (decoded in Chromium)" : ""));
// The downloadable Fox workflow exercises real skinning and ships with the site.
// Use the same saved graph in the editor and the builder's standalone export.
async function evaluate(fn) {
  const res = await send("Runtime.evaluate", {expression:"("+fn.toString()+")()", awaitPromise:true, returnByValue:true});
  if (res.error || res.result?.exceptionDetails) fail(res.error?.message || res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text);
  return res.result.result.value;
}
const exported = await evaluate(async () => {
  const example = await (await fetch("/examples/gallery/slice-3d/graph.json")).json();
  applyGraphData(example);
  const slicer = graph.nodes.find(n=>n.type==="slice-3d"), render = graph.nodes.find(n=>n.type==="sprite-stack-render");
  const mode = slicer.el.querySelector("[data-slice-output]");
  const animation = slicer.el.querySelector("[data-slice-animation]");
  const picker = slicer.el.querySelector("[data-slice-picker]");
  const select = (el,value)=>{ el.value = value; el.dispatchEvent(new Event("change",{bubbles:true})); };
  for(let i=0;i<100 && picker.hidden;i++) await new Promise(r=>setTimeout(r,50));
  if(picker.hidden || mode.value!=="clip" || animation.hidden || picker.value!=="Walk" ||
      ["Walk","Run","Survey"].some(name=>![...picker.options].some(o=>o.value===name)))
    throw Error("Saved Fox workflow should list its model clips and select Walk");
  select(mode,"rest");
  if(!animation.hidden || slicer.fields.clip || slicer.fields.frames!==1) throw Error("Still output should clear the active clip and use one pose");
  select(mode,"clip");
  if(animation.hidden || picker.value!=="Walk" || Number(slicer.fields.frames)!==12) throw Error("Switching back should restore the clip and frame count");
  select(picker,"Run");
  if(slicer.fields.clip!=="Run") throw Error("Choosing a model clip should update the graph");
  select(picker,"Walk");
  function set(field,value){
    const el = slicer.el.querySelector('[data-f="'+field+'"]');
    el.value = value;
    el.dispatchEvent(new Event(el.tagName==="SELECT" ? "change" : "input", {bubbles:true}));
  }
  set("preset","default");
  if(slicer.fields.resolution!==48 || slicer.fields.palette!==16) throw Error("Default preset did not apply");
  set("preset","character");
  if(slicer.fields.resolution!==128 || slicer.fields.slices!==80 || slicer.fields.palette!==0 ||
     !slicer.el.querySelector('[data-f="outline"]').checked) throw Error("Character preset did not apply");
  set("slices",16); set("resolution",24); set("frames",4); set("clip","Walk");
  const saved = serializeGraph();
  applyGraphData(saved);
  const restored = byId(slicer.id), renderer = byId(render.id);
  if(restored.el.querySelector('[data-f="resolution"]').value!=="24" || restored.fields.clip!=="Walk") throw Error("Saved override or clip lost");
  await runGroup([renderer.id]);
  const layout = JSON.parse(restored.out.layout);
  if(layout.animation?.frames!==4 || layout.animation.clip!=="Walk") throw Error("Missing Walk clip on the editor sheet");
  if(!restored.el.querySelector(".result details img") || !renderer.el.querySelector(".result video")) throw Error("Missing animated sheet or video preview");
  const downloads = [];
  const click = HTMLAnchorElement.prototype.click;
  try {
    HTMLAnchorElement.prototype.click = function(){ downloads.push([this.download,this.href]); };
    for(const [node,label] of [[restored,"Save animated sheet"],[renderer,"Save video"]]){
      [...node.el.querySelectorAll(".result button")].find(b=>b.textContent.includes(label)).click();
    }
  } finally { HTMLAnchorElement.prototype.click = click; }
  if(downloads[0][1]!==restored.out.sheet || !downloads[0][0].endsWith(".png") ||
     downloads[1][1]!==renderer.out.video || !downloads[1][0].endsWith(".mp4")) throw Error("Editor downloads differ from graph outputs");

  startAppRequest("create");
  const frame = document.getElementById("appmodalframe");
  for(let i=0; i<200 && (!frame.contentDocument?.getElementById("appframe")?.srcdoc || appRequest); i++){
    await new Promise(r=>setTimeout(r,100));
  }
  if(appRequest || frame.hidden || !frame.contentDocument?.getElementById("appframe")?.srcdoc) throw Error("3D upload graph did not open in the app builder");
  const win = frame.contentWindow, proto = win.HTMLAnchorElement.prototype, original = proto.click;
  let html;
  try {
    proto.click = function(){ if(this.download.endsWith(".html")) html = win.fetch(this.href).then(r=>r.text()); };
    win.document.getElementById("export").click();
    for(let i=0;i<100 && !html;i++) await new Promise(r=>setTimeout(r,100));
    if(!html) throw Error("Builder did not export its standalone app");
    return await html;
  } finally { proto.click = original; }
});
exportedApp = exported;
await send("Page.navigate", {url:origin+"/rig-app.html"});
await nextEvent("Page.loadEventFired", 10000);
const app = await evaluate(async () => {
  const inputs = document.getElementById("app-inputs");
  const field = (name)=>[...inputs.querySelectorAll(".field")].find(row=>row.querySelector("label")?.textContent.trim()===name)?.querySelector("input,select");
  const preset = field("Preset");
  if(!preset || preset.value!=="character" || field("Tile resolution").value!=="24" || field("Animation clip").value!=="Walk") throw Error("Builder settings lost");
  const mode = field("Output"), animation = mode?.closest("[data-slice-output]").querySelector("[data-slice-animation]");
  if(mode?.value!=="clip" || animation.hidden) throw Error("App should start on the saved animation");
  for(const value of ["rest","clip"]){
    mode.value=value; mode.dispatchEvent(new Event("change",{bubbles:true}));
    if(animation.hidden!==(value==="rest")) throw Error("App visibility should follow the output mode");
  }
  if(field("Animation clip").value!=="Walk" || Number(field("Pose frames").value)!==4) throw Error("App should restore saved clip settings after switching back");
  function selectPreset(name){ preset.value=name; preset.dispatchEvent(new Event("change",{bubbles:true})); }
  selectPreset("default"); selectPreset("character");
  if(field("Tile resolution").value!=="128" || field("Palette colors").value!=="0" || field("Slices").value!=="80" || !field("Outline").checked) throw Error("App preset controls not synchronized");
  for(const [name,value] of [["Slices",16],["Tile resolution",24]]){
    const el=field(name); el.value=value; el.dispatchEvent(new Event("input",{bubbles:true}));
  }
  const f = inputs.querySelector('input[type="file"][accept*=".glb"]');
  const blob = await (await fetch("/examples/gallery/slice-3d/Fox.glb")).blob();
  const dt = new DataTransfer(); dt.items.add(new File([blob],"Fox.glb",{type:"model/gltf-binary"}));
  f.files = dt.files;
  // Wait for the file reader used by the actual control before pressing Run.
  await new Promise(resolve=>{
    const reader = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function(file){ this.addEventListener("loadend",resolve,{once:true}); reader.call(this,file); };
    try { f.dispatchEvent(new Event("change",{bubbles:true})); } finally { FileReader.prototype.readAsDataURL=reader; }
  });
  document.getElementById("app-run").click();
  let player;
  for(let i=0; i<200 && !(player=document.querySelector("#app-output .card video")); i++) await new Promise(r=>setTimeout(r,100));
  if(!player) throw Error("App did not render the MP4: "+document.getElementById("app-status").textContent);
  const card=player.closest(".card"), downloads=[];
  const click=HTMLAnchorElement.prototype.click;
  try {
    HTMLAnchorElement.prototype.click=function(){ downloads.push([this.download,this.href]); };
    for(const button of card.querySelectorAll(".dlrow button")) button.click();
  } finally { HTMLAnchorElement.prototype.click=click; }
  const playable = !!player.canPlayType('video/mp4; codecs="avc1.42001f"');
  if(playable){
    for(let i=0;i<100 && !player.videoWidth;i++) await new Promise(r=>setTimeout(r,50));
    if(!player.videoWidth || !(player.duration>0)) throw Error("Exported app MP4 could not be decoded");
  }
  return {playable,video:downloads[0]?.[0].endsWith(".mp4") && downloads[0][1]===player.src,still:downloads[1]?.[0].endsWith(".png")};
});
if(!app.video || !app.still) fail("Wrong exported app downloads: "+JSON.stringify(app));
console.log("✓ check-3d-csp: rigged Walk sheet and fixed-yaw MP4 render, reopen, download and run in a standalone app export"+(app.playable?" (decoded in Chromium)":""));
await send("Page.navigate", {url:origin+"/?product=off&na=0"});
if(!(await waitReady())) fail("Editor did not reopen for the Idol request check");
await evaluate(async () => {
  const model = "speridlabs/idol/max/turbo";
  catalogs.model3d = [norm3d({
    id:model, architecture:{input_modalities:["image"]},
    supported_parameters:{parameters:{
      rig:{type:"switch",default:false,label:"Rig character"},
      animations:{type:"array",items:{type:"string",enum:["walk","run","jump","idle"]},maxItems:4,uniqueItems:true,default:[],requires:"rig"},
    }},
  })];
  catalogFetchedAt.model3d = Date.now();
  applyGraphData({nodes:[
    {id:"photo",type:"upload",x:0,y:0,fields:{image:"examples/gallery/slice-3d/preview.png"}},
    {id:"idol",type:"model3d",x:380,y:0,fields:{model}},
    {id:"slice",type:"slice-3d",x:780,y:0,fields:{clip:"Walk",frames:4,slices:16,resolution:24}},
  ],links:[
    {id:"photo-idol",from:{node:"photo",port:"image"},to:{node:"idol",port:"image"}},
    {id:"idol-slice",from:{node:"idol",port:"model"},to:{node:"slice",port:"model"}},
  ]});
  const rig = () => byId("idol").el.querySelector('[data-of="rig"]');
  const choice = name => byId("idol").el.querySelector('[data-of="animations"][data-of-value="'+name+'"]');
  if(choice("walk")) throw Error("Animation clips should start hidden when rigging is off");
  rig().click();
  choice("walk").click();
  choice("idle").click();
  choice("idle").click();
  choice("idle").click();
  const saved = serializeGraph();
  applyGraphData(saved);
  if(!rig().checked || !choice("walk").checked || !choice("idle").checked || choice("run").checked)
    throw Error("Saved Idol clip selections did not reopen");
  const fetchOriginal = window.fetch;
  let request;
  window.fetch = (url, options)=>{
    if(String(url)===NANOGPT+"/api/generate-video"){
      request = JSON.parse(options.body);
      return Promise.resolve(Response.json({runId:"idol-test"}));
    }
    if(String(url)===NANOGPT+"/api/video/status?requestId=idol-test")
      return Promise.resolve(Response.json({data:{status:"COMPLETED",output:{
        kind:"3d",format:"glb",model_url:"examples/gallery/slice-3d/Fox.glb",
      }}}));
    return fetchOriginal(url,options);
  };
  try{ await runGroup(["slice"], CTX); }
  finally{ window.fetch = fetchOriginal; }
  if(request?.model!==model || request.rig!==true || JSON.stringify(request.animations)!=='["walk","idle"]')
    throw Error("The generation request did not include the chosen animation clips");
  if(JSON.parse(byId("slice").out.layout).animation?.clip!=="Walk") throw Error("The returned model did not reach Slice 3D");
  rig().click();
  if(choice("walk") || Object.hasOwn(byId("idol").fields.modelOpts,"animations"))
    throw Error("Disabling rigging should clear the animation request");
});
console.log("✓ check-3d-csp: Idol clip choices reopen, reach the generation request, and return a GLB to Slice 3D (mock provider)");
ws.close();
proc.kill("SIGKILL");
server.close();
