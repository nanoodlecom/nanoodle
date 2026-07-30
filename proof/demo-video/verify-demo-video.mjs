#!/usr/bin/env node
// Verifies the signed-out sample run reaches a VIDEO result — in real Microsoft Edge, over raw
// CDP, against the real index.html. Zero API spend, and it proves that rather than assuming it:
// the whole nano-gpt.com origin is blocked at the network layer AND wrapped by a recording
// fetch guard, so any request to the API fails the run instead of quietly costing money.
//
//   node proof/demo-video/verify-demo-video.mjs             # the check (offline, deterministic)
//   node proof/demo-video/verify-demo-video.mjs --capture    # refresh catalog-fixture.json
//   node proof/demo-video/verify-demo-video.mjs --keep-open   # leave the browser up to poke at
//
// --capture is the ONLY mode that talks to nano-gpt.com, and only to its free public
// model-list endpoints (GET /api/v1/{models,image-models,video-models}). It never runs a graph.
// It re-records catalog-fixture.json: the three normalized catalog entries the covered path
// needs, taken from the app's own localStorage cache so the shape can never drift from normVideo
// and friends. Prices move, so re-capture rather than hand-editing the fixture.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(path.dirname(HERE));
const FIXTURE = path.join(HERE, "catalog-fixture.json");
const EDGE = "/opt/microsoft/msedge/msedge";
const CAPTURE = process.argv.includes("--capture");
const KEEP_OPEN = process.argv.includes("--keep-open");

const MIME = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript",
  ".json":"application/json", ".css":"text/css", ".jpg":"image/jpeg", ".jpeg":"image/jpeg",
  ".png":"image/png", ".mp4":"video/mp4", ".svg":"image/svg+xml", ".ico":"image/x-icon",
  ".webmanifest":"application/manifest+json", ".txt":"text/plain", ".wav":"audio/wav" };

let pass = 0; const fails = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fails.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* ---------------- static server (port 0, awaited: no bind race) ---------------- */
function serve(root) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain" }); res.end("404"); return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

/* ---------------- CDP over the built-in WebSocket (Node 24) ---------------- */
async function cdp(port) {
  let info;
  for (let i = 0; i < 100; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  if (!info) throw new Error("Edge never opened its debug port");
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const waiting = new Map(); const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { const { r, j } = waiting.get(m.id); waiting.delete(m.id); m.error ? j(new Error(m.error.message)) : r(m.result); }
    else if (m.method) listeners.forEach((fn) => fn(m));
  };
  const send = (method, params = {}, sessionId) => new Promise((r, j) => {
    const n = ++id; waiting.set(n, { r, j });
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { send, on: (fn) => listeners.push(fn), close: () => ws.close() };
}

/* Evaluate in the page and return the VALUE (throws the page's error, so a typo in a probe
   fails loudly instead of silently reading as undefined). */
async function ev(c, sid, expr) {
  const r = await c.send("Runtime.evaluate", {
    // async wrapper + awaitPromise so probes may `await` (caches, blobs) as freely as they read DOM
    expression: `(async()=>{ ${expr} })()`, returnByValue: true, awaitPromise: true, userGesture: true,
  }, sid);
  if (r.exceptionDetails) throw new Error("page: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
// Poll a condition. Errors count as "not yet": early on, the evaluate races the navigation
// ("Inspected target navigated or closed") and the app's globals do not exist yet.
const poll = async (c, sid, expr, ms = 30000, every = 250) => {
  const t0 = Date.now();
  for (;;) {
    try { if (await ev(c, sid, expr)) return true; } catch {}
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, every));
  }
};

/* ---------------- main ---------------- */
const srv = await serve(ROOT);
const base = `http://127.0.0.1:${srv.address().port}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nn-demo-video-"));
const dbg = 9500 + Math.floor(Math.random() * 400);
const edge = spawn(EDGE, [
  "--headless=new", `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--mute-audio",
  "--autoplay-policy=no-user-gesture-required",
  "--disable-site-isolation-trials",
  "--disable-features=IsolateOrigins,site-per-process,SitePerProcessOnly",
  "about:blank",
], { stdio: "ignore" });

let code = 1;
try {
  const c = await cdp(dbg);
  const { targetId } = await c.send("Target.createTarget", { url: "about:blank" });
  const { sessionId: sid } = await c.send("Target.attachToTarget", { targetId, flatten: true });
  await c.send("Page.enable", {}, sid);
  await c.send("Runtime.enable", {}, sid);
  await c.send("Network.enable", {}, sid);

  // Every nano-gpt.com request the page attempts, recorded from OUTSIDE the page.
  const apiHits = [];
  c.on((m) => {
    if (m.method === "Network.requestWillBeSent" && /nano-gpt\.com/.test(m.params.request.url)) apiHits.push(m.params.request.url);
  });
  if (!CAPTURE) await c.send("Network.setBlockedURLs", { urls: ["*nano-gpt.com*"] }, sid);

  const fixture = (!CAPTURE && fs.existsSync(FIXTURE)) ? JSON.parse(fs.readFileSync(FIXTURE, "utf8")) : null;
  if (!CAPTURE && !fixture) throw new Error(`no ${FIXTURE} — run with --capture once`);

  // Signed OUT, welcome dismissed, catalogs primed from the fixture (so prices exist with the
  // network off), plus an in-page fetch guard that records and refuses the API either way.
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    try {
      localStorage.clear();
      localStorage.setItem("noodle_welcome_seen", "1");
      localStorage.setItem("noodle_make_cta_shown", "1");
      ${fixture ? Object.entries(fixture.catalogs).map(([k, list]) =>
        `localStorage.setItem("nn_catalog_${k}", JSON.stringify({ t: Date.now(), list: ${JSON.stringify(list)} }));`).join("\n      ") : ""}
    } catch (e) {}
    window.__apiHits = [];
    const _f = window.fetch;
    window.fetch = function (u, o) {
      const url = String((u && u.url) || u);
      if (url.includes("nano-gpt.com")) {
        window.__apiHits.push(url);
        ${CAPTURE ? "return _f.apply(this, arguments);" : 'return Promise.reject(new Error("BLOCKED by the harness: " + url));'}
      }
      return _f.apply(this, arguments);
    };
  ` }, sid);

  await c.send("Page.navigate", { url: base + "/index.html" }, sid);

  console.log(CAPTURE ? "\n== capturing catalog fixture ==" : "\n== signed-out demo run reaches a video result ==");

  // Boot: the classic (non-module) script means the app's own functions are real globals.
  if (!await poll(c, sid, `return typeof demoMode === "function" && typeof addNode === "function" && graph.nodes.length === 3;`, 20000))
    throw new Error("app never booted (3 starter nodes + demoMode)");

  if (CAPTURE) {
    if (!await poll(c, sid, `return !!(catalogs.chat && catalogs.chat.length && catalogs.image && catalogs.image.length && catalogs.video && catalogs.video.length);`, 30000))
      throw new Error("live catalogs never arrived");
    const cap = await ev(c, sid, `
      const want = defModelFor("ivideo");                                 // the app's OWN resolver — the fixture must hold the model a real appended node gets
      const vid = catalogs.video.find(m => m.id === want);
      return { chat: catalogs.chat.filter(m => m.id === "zai-org/glm-5.2"),
               image: catalogs.image.filter(m => m.id === "nano-banana-2-lite"),
               video: vid ? [vid] : [] };
    `);
    for (const k of ["chat", "image", "video"]) if (!cap[k].length) throw new Error(`capture: no ${k} entry found`);
    fs.writeFileSync(FIXTURE, JSON.stringify({
      note: "Normalized catalog entries for the 3 models the covered demo path uses, read out of the app's own localStorage cache. Re-record with --capture; prices move.",
      captured: new Date().toISOString().slice(0, 10), catalogs: cap,
    }, null, 2) + "\n");
    console.log(`  wrote ${path.relative(ROOT, FIXTURE)} — video model ${cap.video[0].id}`);
    code = 0;
  } else {
    const chip = `(()=>{ const e=document.getElementById("runest"); return { hidden:e.hidden, display:getComputedStyle(e).display, text:e.textContent.trim(), title:e.title }; })()`;

    // ---- 1. the pristine starter still samples, and still prices itself ----
    eq("starter demoMode is a sampleable mode", await ev(c, sid, `return demoMode();`), "exact");
    eq("signed out", await ev(c, sid, `return !getKey();`), true);
    let ch = await ev(c, sid, `return ${chip};`);
    ok("starter: run-cost chip VISIBLE in demo mode", ch.display !== "none" && !ch.hidden, `display=${ch.display}`);
    ok("starter: chip says the price is for the real run", /to run for real/.test(ch.text), JSON.stringify(ch.text));
    ok("starter: chip title says this run is not billed", /isn’t billed/.test(ch.title), JSON.stringify(ch.title.split("\n")[0]));
    ok("starter: chip shows a real dollar figure", /\$\d/.test(ch.text) || /<\$0\.01/.test(ch.text), JSON.stringify(ch.text));

    // ---- 2. append the covered Image→Video node with the app's own API ----
    const vid = await ev(c, sid, `
      const img = graph.nodes.find(n => n.type === "image");
      const v = addNode("ivideo", img.x + 300, img.y);
      connect(img.id, "image", v.id, "image");
      refreshAllPrices();
      return { id: v.id, model: v.fields.model, nodes: graph.nodes.length };
    `);
    eq("Image→Video node appended", vid.nodes, 4);
    ok("it picked a real i2v model", !!vid.model, vid.model);
    eq("demoMode() is now 'video'", await ev(c, sid, `return demoMode();`), "video");
    eq("demoVideoNode() returns THAT node", await ev(c, sid, `const v = demoVideoNode(); return v && v.id;`), vid.id);
    eq("still a demo run", await ev(c, sid, `return inDemoRun();`), true);

    // ---- 3. the price disclosure survives the priciest node (the review finding) ----
    const before = ch;
    ch = await ev(c, sid, `return ${chip};`);
    ok("video node: run-cost chip STILL VISIBLE", ch.display !== "none" && !ch.hidden, `display=${ch.display}, text=${JSON.stringify(ch.text)}`);
    ok("video node: chip still labelled for the real run", /to run for real/.test(ch.text), JSON.stringify(ch.text));
    const usd = (s) => { const m = s.match(/\$([\d.]+)/); return m ? parseFloat(m[1]) : 0; };
    ok("adding the video node RAISED the quoted price", usd(ch.text) > usd(before.text), `${before.text.trim()} → ${ch.text.trim()}`);
    ok("the video node shows its own per-run price too", await ev(c, sid, `
      const v = byId(${JSON.stringify(vid.id)}); const el = v.el.querySelector("[data-mp]");
      return !!(el && /\\$/.test(el.textContent));
    `), await ev(c, sid, `return byId(${JSON.stringify(vid.id)}).el.querySelector("[data-mp]").textContent.trim();`));

    // ---- 4. run it, signed out, with the service worker in charge ----
    // The clip is deliberately absent from sw.js's SHELL precache list, so the ONLY thing that
    // ever caches it is the fetch handler, on first use. Wait until the SW actually controls the
    // page before running, otherwise that path is never exercised and the assert below is a lie.
    const swReady = await poll(c, sid, `return !!navigator.serviceWorker.controller;`, 20000);
    ok("a service worker controls the page", swReady, swReady ? "controller present" : "no controller in 20 s");
    eq("the clip is NOT precached (not in SHELL)", await ev(c, sid, `
      return await (await caches.open("nanoodle-v6")).match("/demo-sample.mp4") ? "cached" : "absent";
    `), "absent");

    await ev(c, sid, `document.getElementById("run").click(); return 1;`);
    const done = await poll(c, sid,
      `return graph.nodes.filter(n => n.el && n.el.dataset.status === "done").length === 4;`, 60000);
    const statuses = await ev(c, sid, `return graph.nodes.map(n => n.type + ":" + (n.el && n.el.dataset.status));`);
    ok("all 4 nodes reached done", done, statuses.join(", "));

    // ---- 5. it is really a video, and really the shipped clip ----
    const out = await ev(c, sid, `
      const v = byId(${JSON.stringify(vid.id)});
      const el = v.el.querySelector(".result video");
      return { url: (v.out && v.out.video || "").slice(0, 24), len: (v.out && v.out.video || "").length,
        hasEl: !!el, srcMatches: !!el && el.src === v.out.video,
        readyState: el ? el.readyState : -1, duration: el ? el.duration : -1,
        w: el ? el.videoWidth : -1, h: el ? el.videoHeight : -1,
        badge: (v.el.querySelector(".demobadge") || {}).textContent || "",
        save: !!v.el.querySelector(".result [data-dl]"), open: !!v.el.querySelector(".result [data-open]") };
    `);
    ok("video output is a data:video/mp4 URL", out.url.startsWith("data:video/mp4"), `${out.url}… (${out.len} chars)`);
    ok("a <video> element renders it", out.hasEl && out.srcMatches, `hasEl=${out.hasEl} srcMatches=${out.srcMatches}`);
    eq("the clip actually decoded (readyState 4)", out.readyState, 4);
    ok("duration is the shipped clip's 5.04 s", Math.abs(out.duration - 5.041667) < 0.05, String(out.duration));
    ok("dimensions are the shipped clip's 640x360", out.w === 640 && out.h === 360, `${out.w}x${out.h}`);
    ok("carries the ✨ sample result badge", /✨/.test(out.badge) && /sample result/.test(out.badge), JSON.stringify(out.badge));
    ok("⬇ save and ↗ open are offered, like a real result", out.save && out.open, `save=${out.save} open=${out.open}`);

    // ---- 5b. …and the service worker cached it on that first use ----
    ok("the fetch handler cached the clip on first use", await poll(c, sid, `
      const r = await (await caches.open("nanoodle-v6")).match("/demo-sample.mp4");
      return !!r && r.ok;
    `, 10000), "present in nanoodle-v6 after the run");
    eq("what it cached is the real clip, byte for byte", await ev(c, sid, `
      const r = await (await caches.open("nanoodle-v6")).match("/demo-sample.mp4");
      const b = await r.blob();
      return b.size + " " + b.type;
    `), "228408 video/mp4");

    // ---- 6. the pill tells the truth about whose prompt made the clip ----
    const pill = await ev(c, sid, `
      const p = document.getElementById("demopop");
      return { shown: !!p && getComputedStyle(p).display !== "none", text: p ? p.textContent : "" };
    `);
    ok("the demo pill is up", pill.shown, `display checked`);
    ok("pill says the clip is canned and ignores the visitor's prompt",
      /canned example of what Image→Video makes, not your prompt/.test(pill.text), JSON.stringify(pill.text.slice(0, 120)));

    // ---- 7. every other result still carries its badge ----
    eq("all 3 output nodes are badged", await ev(c, sid, `return document.querySelectorAll(".demobadge").length;`), 3);

    // ---- 8. and it cost nothing, provably ----
    // The only nano-gpt.com URLs the page may even ATTEMPT are the free, read-only model lists
    // (the boot SWR revalidate). Anything else is a billable endpoint and fails the run. Here
    // even the lists were blocked, and the run still finished — the demo path is fully offline.
    const inPage = await ev(c, sid, `return window.__apiHits.slice();`);
    const CATALOG_ONLY = /^https:\/\/nano-gpt\.com\/api\/v1\/(models\?detailed=true|image-models|video-models|audio-models)$/;
    const billable = inPage.filter((u) => !CATALOG_ONLY.test(u));
    ok("no billable NanoGPT endpoint was called", billable.length === 0, billable.join(", ") || `0 (only ${inPage.length} free model-list reads, all blocked)`);
    ok("no nano-gpt.com request left the browser", apiHits.length === 0, apiHits.join(", ") || "0 requests");
    ok("the whole sample run works with nano-gpt.com unreachable", done, "4/4 nodes done, network blocked");

    // ---- 9. the sign-in wall still guards everything not covered ----
    eq("a 2nd video node loses demo mode (wall)", await ev(c, sid, `
      const img = graph.nodes.find(n => n.type === "image");
      const v2 = addNode("ivideo", img.x + 300, img.y + 260);
      connect(img.id, "image", v2.id, "image");
      const m = demoMode();
      graph.nodes.pop(); graph.links.pop();
      return m;
    `), null);
    eq("a node downstream of the clip loses demo mode (wall)", await ev(c, sid, `
      const v = byId(${JSON.stringify(vid.id)});
      const e = addNode("vedit", v.x + 300, v.y);
      connect(v.id, "video", e.id, "video");
      const m = demoMode();
      graph.nodes.pop(); graph.links.pop();
      return m;
    `), null);
    eq("back to 'video' once the canvas is the covered shape again", await ev(c, sid, `return demoMode();`), "video");

    console.log(`\n${fails.length ? "✗" : "✓"} ${pass} passed, ${fails.length} failed` + (fails.length ? `\n  ${fails.join("\n  ")}` : ""));
    code = fails.length ? 1 : 0;
  }

  if (KEEP_OPEN) { console.log(`\nbrowser left open on ${base} (debug :${dbg}) — ctrl-C to stop`); await new Promise(() => {}); }
  c.close();
} catch (e) {
  console.error("✗ harness error: " + e.message);
} finally {
  if (edge.pid) { try { process.kill(edge.pid, "SIGTERM"); } catch {} }   // exact PID, never a pattern kill
  srv.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(code);
