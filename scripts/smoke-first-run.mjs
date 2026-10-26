#!/usr/bin/env node
// Real browser journey: fresh visit → sample → app → share/export → NanoGPT OAuth.
// All provider requests are intercepted. This never uses credentials or buys inference.
// Playwright is a development-only dependency, installed separately by first-run.yml.
// Locally: NANOODLE_PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/smoke-first-run.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = process.env.NANOODLE_PLAYWRIGHT;
const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : "playwright");
const mime = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript",
  ".json":"application/json", ".css":"text/css", ".jpg":"image/jpeg", ".png":"image/png",
  ".svg":"image/svg+xml", ".mp4":"video/mp4", ".woff2":"font/woff2", ".ico":"image/x-icon" };
const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/") pathname = "/index.html";
    if (pathname === "/play") pathname = "/play.html";
    const file = resolve(root, "." + pathname);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    const headers = { "Content-Type":mime[extname(file)] || "application/octet-stream" };
    const csp = cspFor(pathname === "/" ? "/index.html" : pathname);
    if (csp) headers["Content-Security-Policy"] = csp;
    res.writeHead(200, headers);
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
// The app normalizes loopback IPs to localhost for its OAuth redirect URI.
const origin = `http://localhost:${server.address().port}`;
const starter = JSON.parse(await readFile(resolve(root, "noodle-graph.json"), "utf8"));
const chatId = starter.nodes.find(n => n.type === "llm").fields.model;
const imageId = starter.nodes.find(n => n.type === "image").fields.model;
const catalog = {
  "/api/v1/models": { data:[{ id:chatId, name:"Starter LLM", pricing:{prompt:0.1,completion:0.1} }] },
  "/api/v1/image-models": { data:[{ id:imageId, name:"Starter image", architecture:{modality:"text->image"},
    pricing:{per_image:{"1k":0.04,"3:2":0.01}}, supported_parameters:{resolutions:["1k","3:2"]} }] },
  "/api/v1/video-models": { data:[] },
  "/api/v1/audio-models": { data:[] },
  "/api/v1/3d-models": { data:[] },
};
const headerText = await readFile(resolve(root, "_headers"), "utf8");
const cspByPath = new Map();
{
  let path = null;
  for (const line of headerText.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) { path = line.trim(); continue; }
    const m = line.match(/^\s*Content-Security-Policy:\s*(.+)$/);
    if (m && path && !cspByPath.has(path)) cspByPath.set(path, m[1].trim());
  }
}
const cspFor = (pathname) => cspByPath.get(pathname) || (pathname === "/" ? cspByPath.get("/index.html") : "") || "";
let browser;
try {
  browser = await chromium.launch({ headless:true,
    ...(process.env.NANOODLE_CHROMIUM ? { executablePath:process.env.NANOODLE_CHROMIUM } : {}) });
  for (const mobile of [false, true]) {
    const label = mobile ? "mobile-retired-model" : "desktop";
    const contexts = [];
    const forbidden = [];
    const errors = [];
    const consoleErrors = [];
    const authorize = [];
    const registrations = [];
    let finishAuthorize;
    const authorizeIntercepted = new Promise(resolve => { finishAuthorize = resolve; });
    const newContext = async () => {
      const context = await browser.newContext({
        viewport:mobile ? {width:390,height:844} : {width:1440,height:1000},
        isMobile:mobile, hasTouch:mobile, locale:"en-US",
      });
      contexts.push(context);
      await context.route("**/*", async route => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin === origin) {
          // Keep requests visible to the fixture router. Playwright's serviceWorkers:block
          // shim itself throws inside the app's deliberately opaque sandboxed iframe.
          if (url.pathname === "/sw.js") return route.fulfill({ contentType:"text/javascript", body:"// No caching in the browser smoke test.\n" });
          if (mobile && url.pathname === "/noodle-graph.json") {
            // A provider retirement must not take the prerecorded demo down.
            const retired = structuredClone(starter);
            retired.nodes.find(n => n.type === "llm").fields.model = "retired-browser-smoke-model";
            return route.fulfill({ json:retired });
          }
          return route.continue();
        }
        if (url.origin === "https://nano-gpt.com" && url.pathname === "/oauth/register" && req.method() === "POST") {
          registrations.push(req.postDataJSON());
          return route.fulfill({ json:{ client_id:"browser-smoke-client" } });
        }
        if (url.origin === "https://nano-gpt.com" && req.method() === "GET") {
          if (catalog[url.pathname]) return route.fulfill({ json:catalog[url.pathname] });
          if (url.pathname === "/oauth/authorize") {
            authorize.push(url);
            await route.abort();
            finishAuthorize();
            return;
          }
        }
        forbidden.push(`${req.method()} ${url.origin}${url.pathname}`);
        return route.abort();
      });
      context.on("page", page => {
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => {
          if (!["error", "warning"].includes(message.type())) return;
          const location = message.location();
          let path = "";
          try { path = new URL(location.url).pathname; } catch {}
          // Record location/type only: console text may contain request bodies.
          if (consoleErrors.length < 100) consoleErrors.push({ type:message.type(), line:location.lineNumber, path });
        });
      });
      return context;
    };
    const context = await newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    try {
      await page.goto(origin, {waitUntil:"networkidle"});
      assert.match(await page.locator("#canvashint").innerText(), /NanoGPT/);
      await page.locator("#run").click();
      const imageNodeId = starter.nodes.find(n => n.type === "image").id;
      await page.locator(`.node[data-id="${imageNodeId}"][data-status="done"] .result img`).waitFor();
      assert.equal(await page.locator('.node[data-status="error"]').count(), 0, "sample has no failed nodes");
      assert.equal(await page.locator(".demobadge").count(), 2, "both outputs are labeled as samples");
      assert.ok(await page.locator(`.node[data-id="${imageNodeId}"] .result img`).evaluate(img => img.complete && img.naturalWidth > 0),
        "sample image actually decodes");
      await page.locator("#demox").click();

      await page.locator("#makeapp").click();
      // The iframe element exists before play.html wires its controls and loads
      // the handoff. Use the editor's validated __appready__ handshake instead.
      await page.waitForFunction(() => typeof appFrameLoaded !== "undefined" && appFrameLoaded);
      const builder = page.frameLocator("#appmodalframe");
      await builder.locator("#appframe").waitFor();
      if (mobile) await builder.locator("#barmore").click();
      await builder.locator("#share").click();
      await builder.locator("#sharemenu:not([hidden])").waitFor();
      const link = await builder.locator("#sm-url").inputValue();
      assert.match(link, /#a=/, "share contains a complete app");
      assert.equal(new URL(link).origin, origin, "self-hosted share stays on its origin");
      assert.match(await builder.locator("#sm-showcase a").getAttribute("href"), /template=share-workflow\.yml/);
      // The exported artifact must still be available without author credentials.
      await builder.locator("#sm-url").press("Escape");
      if (!await builder.locator("#export").isVisible()) await builder.locator("#barmore").click();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        builder.locator("#export").click(),
      ]);
      assert.match(download.suggestedFilename(), /\.html$/);
      assert.equal(await download.failure(), null);

      const recipient = await (await newContext()).newPage();
      await recipient.goto(link, {waitUntil:"networkidle"});
      await recipient.locator("#recwelcome:not([hidden])").waitFor();
      assert.match(await recipient.locator("#recwelcome").innerText(), /NanoGPT/);
      const [oauthRequest] = await Promise.all([
        recipient.waitForRequest(req => new URL(req.url()).pathname === "/oauth/authorize"),
        recipient.locator("#recwelcome-signin").click(),
      ]);
      const oauth = new URL(oauthRequest.url());
      await authorizeIntercepted;
      assert.equal(oauth.origin, "https://nano-gpt.com");
      assert.equal(oauth.searchParams.get("code_challenge_method"), "S256");
      assert.ok(oauth.searchParams.get("state"), "OAuth includes state");
      assert.ok(oauth.searchParams.get("code_challenge"), "OAuth includes PKCE challenge");
      assert.equal(new URL(oauth.searchParams.get("redirect_uri")).origin, origin);
      assert.equal(authorize.length, 1, "only the deliberate sign-in starts OAuth");
      assert.equal(registrations.length, 1, "fresh recipient registers an OAuth client only after sign-in");
      assert.equal(oauth.searchParams.get("client_id"), "browser-smoke-client");
      assert.deepEqual(forbidden, [], "sample, share and export make no paid or unexpected external requests");
      assert.deepEqual(errors, [], "no browser JavaScript errors");
      console.log(`✓ ${label}: sample → app → share/export → recipient NanoGPT OAuth; no paid calls`);
    } catch (error) {
      const builderFrame = page.frames().find(frame => {
        try { return new URL(frame.url()).pathname === "/play.html"; } catch { return false; }
      });
      const shareState = builderFrame ? await builderFrame.evaluate(async () => {
        let clipboardPermission = "unsupported";
        try { clipboardPermission = (await navigator.permissions.query({name:"clipboard-write"})).state; } catch {}
        return {
          documentReady:document.readyState,
          appFramePopulated:Boolean(document.querySelector("#appframe")?.srcdoc),
          shareHidden:document.querySelector("#sharemenu")?.hidden,
          shareHandler:typeof document.querySelector("#share")?.onclick,
          documentFocused:document.hasFocus(),
          userActivation:navigator.userActivation?.isActive,
          clipboardPermission,
        };
      }).catch(() => ({frameUnavailable:true})) : {frameMissing:true};
      // Controlled test state only: no storage, clipboard content, graph fields,
      // authentication values, URLs with fragments, or request/response bodies.
      const redact = text => String(text).slice(0, 2000)
        .replace(/https?:\/\/[^\s]+/g, url => {
          try { const parsed = new URL(url); return parsed.origin + parsed.pathname; } catch { return "[URL]"; }
        })
        .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]");
      const diagnostics = {label, node:process.version, errors:errors.map(redact),
        unexpectedRequests:forbidden.map(redact), consoleErrors, shareState};
      console.error("Browser smoke diagnostics:", JSON.stringify(diagnostics));
      if (process.env.NANOODLE_SMOKE_ARTIFACTS) {
        const dir = resolve(process.env.NANOODLE_SMOKE_ARTIFACTS);
        await mkdir(dir, {recursive:true});
        await page.screenshot({path:resolve(dir, `${label}.png`), fullPage:true}).catch(() => {});
        await writeFile(resolve(dir, `${label}-diagnostics.json`), JSON.stringify(diagnostics, null, 2));
      }
      throw error;
    } finally {
      for (const context of contexts) await context.close();
    }

    // Exercise the literal plus button, with fresh isolated storage in each case.
    // The ordinary activation journey above waits for startup and misses this race.
    for (const storageDenied of [false, true]) {
      const tabContext = await newContext();
      const tabPage = await tabContext.newPage();
      tabPage.setDefaultTimeout(15000);
      let releaseStarter;
      const starterGate = new Promise(resolve => { releaseStarter = resolve; });
      let starterRequested;
      const starterSeen = new Promise(resolve => { starterRequested = resolve; });
      if (!storageDenied) await tabPage.route("**/noodle-graph.json", async route => {
        starterRequested();
        await starterGate;
        await route.fulfill({json:starter});
      });
      if (storageDenied) await tabPage.addInitScript(() => {
        window.__denyWorkspaceIndex = true;
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (this === localStorage && key === "noodle_workspaces" && window.__denyWorkspaceIndex)
            throw new DOMException("Test index write denial", "QuotaExceededError");
          return setItem.call(this, key, value);
        };
      });
      const openBlank = async () => {
        await tabPage.locator("#wsadd").click();
        await tabPage.locator("#wschooser:not([hidden])").waitFor({state:"visible"});
        assert.equal(await tabPage.locator("#wsadd").getAttribute("aria-expanded"), "true");
        await tabPage.locator('#wschooser [data-ws="blank"]').click();
      };
      try {
        await tabPage.goto(origin, {waitUntil:storageDenied ? "networkidle" : "domcontentloaded"});
        if (!storageDenied) {
          await starterSeen;
          assert.equal(await tabPage.locator("#world .node").count(), 0, "starter is still loading");
          await openBlank();
          releaseStarter();
          await tabPage.waitForLoadState("networkidle");
          await tabPage.waitForFunction(() => !initialCanvasUnclaimed());
          assert.equal(await tabPage.locator("#world .node").count(), 0, "late starter preserves the Blank choice");
          assert.equal(await tabPage.locator("#wstabs .wstab").count(), 1, "early Blank reuses the default tab");
          assert.equal(await tabPage.locator("#wstabs .wstab.on").getAttribute("data-id"), "w1");
          assert.match(await tabPage.locator("#workspaces").innerText(), /Blank canvas/);
        } else {
          const original = await tabPage.evaluate(() => JSON.stringify(serializeGraph()));
          assert.equal(await tabPage.locator("#world .node").count(), starter.nodes.length);
          for (let attempt = 0; attempt < 3; attempt++) {
            await openBlank();
            assert.equal(await tabPage.evaluate(() => JSON.stringify(serializeGraph())), original,
              "denied index write preserves the graph");
            assert.equal(await tabPage.locator("#wstabs .wstab.on").getAttribute("data-id"), "w1");
            assert.equal(await tabPage.locator("#wstabs .wstab").count(), 1);
          }
          await tabPage.evaluate(() => { window.__denyWorkspaceIndex = false; });
          await openBlank();
          assert.equal(await tabPage.locator("#world .node").count(), 0, "writes recover and open Blank");
          assert.equal(await tabPage.locator("#wstabs .wstab").count(), 2);
          if (mobile) {
            await tabPage.locator("#wsdrop").click();
            await tabPage.locator("#wsdropmenu .wsname").click();
          } else await tabPage.locator('#wstabs .wstab[data-id="w1"]').click();
          assert.equal(await tabPage.evaluate(() => JSON.stringify(serializeGraph())), original,
            "switching back restores the original graph after recovery");
        }
        assert.deepEqual(forbidden, [], "workspace clicks make no paid or unexpected external requests");
        assert.deepEqual(errors, [], "workspace clicks produce no browser JavaScript errors");
        console.log(`✓ workspace plus ${label}: ${storageDenied ? "persistent index denial → recovery → switch back" : "first click → chooser → Blank survives slow startup"}; no paid calls`);
      } catch (error) {
        if (process.env.NANOODLE_SMOKE_ARTIFACTS) {
          const dir = resolve(process.env.NANOODLE_SMOKE_ARTIFACTS);
          await mkdir(dir, {recursive:true});
          await tabPage.screenshot({path:resolve(dir, `workspace-${label}-${storageDenied ? "storage" : "startup"}.png`), fullPage:true}).catch(() => {});
        }
        throw error;
      } finally {
        releaseStarter();
        await tabContext.close();
      }
    }
  }
  const glb = await readFile(resolve(root, "examples/product-shot/sample.glb"));
  const cspContext = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const cspPage = await cspContext.newPage();
  const violations = [];
  cspPage.on("console", (msg) => { if (/content security policy/i.test(msg.text())) violations.push(msg.text()); });
  await cspPage.addInitScript(() => {
    localStorage.setItem("noodle_hint_dismissed", "1");
    localStorage.setItem("noodle_connect_hint_dismissed", "1");
    localStorage.setItem("noodle_graph", JSON.stringify({ v:1, nodes:[], links:[], nid:1, lid:1, view:{ panX:40, panY:30, scale:1 } }));
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => { window.__csp.push(e.violatedDirective + " " + e.blockedURI); });
  });
  const loaded = await cspPage.goto(origin + "/?product=off&na=0", { waitUntil:"networkidle" });
  const sent = loaded.headers()["content-security-policy"] || "";
  assert.match(sent, /connect-src/, "the editor is served with the _headers CSP");
  assert.doesNotMatch(sent, /connect-src[^;]*\bdata:/, "that CSP does not allow connect-src data:");
  await cspPage.evaluate((b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bin], "duck.glb", { type:"model/gltf-binary" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const editor = document.querySelector("#editor");
    const r = editor.getBoundingClientRect();
    const ev = new DragEvent("drop", { bubbles:true, cancelable:true, clientX:r.left + r.width / 2, clientY:r.top + 180 });
    Object.defineProperty(ev, "dataTransfer", { value:dt });
    editor.dispatchEvent(ev);
  }, glb.toString("base64"));
  await cspPage.waitForFunction(() => {
    const canvas = document.querySelector(".node .glb-canvas");
    return canvas && canvas.style.visibility !== "hidden" && !document.querySelector(".glb-err");
  });
  const blocked = await cspPage.evaluate(() => (window.__csp || []).filter((s) => /connect-src/.test(s) && /data:/.test(s)));
  assert.deepEqual(blocked, [], "dropping a GLB does not fetch a data: URL under the production CSP");
  assert.deepEqual(violations, [], "no CSP console errors while the dropped GLB draws");
  console.log("✓ csp: dropped GLB draws under the real _headers connect-src");
  await cspContext.close();

  // Corner-grip resize. Decide's question (and Choice's options) used to be ignored, and a
  // wired prompt is display:none so a height written there never moves the card. Mouse and
  // touch both have to grow the card and the visible primary box.
  const resizeSpecs = [
    { type:"text", fields:{ text:"resize me" }, field:"text" },
    { type:"image", fields:{ prompt:"a red lantern" }, field:"prompt" },
    { type:"tvideo", fields:{ prompt:"a slow pan across the market" }, field:"prompt" },
    { type:"decide", fields:{ question:"which is better?" }, field:"question" },
  ];
  async function touchDrag(page, x, y, dx, dy) {
    const client = await page.context().newCDPSession(page);
    const point = (px, py) => ({ x:px, y:py, id:1 });
    await client.send("Input.dispatchTouchEvent", { type:"touchStart", touchPoints:[point(x, y)] });
    for (let i = 1; i <= 8; i++) {
      await client.send("Input.dispatchTouchEvent", { type:"touchMove", touchPoints:[point(x + dx * i / 8, y + dy * i / 8)] });
    }
    await client.send("Input.dispatchTouchEvent", { type:"touchEnd", touchPoints:[] });
    await client.detach();
  }
  async function assertGripResize(page, touch) {
    for (const spec of resizeSpecs) {
      const id = await page.evaluate((spec) => {
        for (const n of [...graph.nodes]) removeNode(n.id);
        const n = addNode(spec.type, 70, 60, spec.fields);
        const ed = editor.getBoundingClientRect();
        const r = n.el.getBoundingClientRect();
        panX += (ed.left + 36) - r.left;
        panY += (ed.top + 28) - r.top;
        scale = 1;
        applyWorld();
        return n.id;
      }, spec);
      const grip = page.locator(`.node[data-id="${id}"] .rgrip`);
      const box = await grip.boundingBox();
      assert.ok(box && box.width >= 12 && box.height >= 12, `${spec.type} resize grip is on screen`);
      const before = await page.evaluate((arg) => {
        const n = graph.nodes.find(x => x.id === arg.id);
        const ta = n.el.querySelector(`textarea[data-f="${arg.field}"]`);
        const hit = document.elementFromPoint(
          n.el.querySelector(".rgrip").getBoundingClientRect().left + 8,
          n.el.querySelector(".rgrip").getBoundingClientRect().top + 8,
        );
        return {
          w: n.el.offsetWidth,
          h: ta ? ta.offsetHeight : 0,
          hidden: ta ? ta.hidden : true,
          hit: hit && (hit.classList?.contains("rgrip") || !!hit.closest?.(".rgrip")),
        };
      }, { id, field:spec.field });
      assert.equal(before.hidden, false, `${spec.type} ${spec.field} box is visible`);
      assert.equal(before.hit, true, `${spec.type} grip receives the pointer`);
      const x = box.x + Math.min(box.width, 16) / 2;
      const y = box.y + Math.min(box.height, 16) / 2;
      if (touch) await touchDrag(page, x, y, 130, 80);
      else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 130, y + 80, { steps:12 });
        await page.mouse.up();
      }
      const after = await page.evaluate((arg) => {
        const n = graph.nodes.find(x => x.id === arg.id);
        const ta = n.el.querySelector(`textarea[data-f="${arg.field}"]`);
        return { w: n.w, ow: n.el.offsetWidth, h: ta ? ta.offsetHeight : 0, sizes: n.sizes && n.sizes[arg.field] };
      }, { id, field:spec.field });
      assert.ok(after.ow >= before.w + 80, `${spec.type} card widened (${before.w} → ${after.ow})`);
      assert.ok(after.h >= before.h + 40, `${spec.type} ${spec.field} grew (${before.h} → ${after.h})`);
      assert.ok(after.sizes >= after.h - 2, `${spec.type} stored the new ${spec.field} height`);
    }
  }
  for (const touch of [false, true]) {
    const label = touch ? "touch" : "mouse";
    const resizeContext = await browser.newContext({
      viewport: touch ? { width:390, height:844 } : { width:1440, height:1000 },
      isMobile: touch, hasTouch: touch, locale:"en-US",
    });
    await resizeContext.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        if (url.pathname === "/sw.js") return route.fulfill({ contentType:"text/javascript", body:"// No caching in the browser smoke test.\n" });
        return route.continue();
      }
      return route.abort();
    });
    const resizePage = await resizeContext.newPage();
    resizePage.setDefaultTimeout(15000);
    await resizePage.addInitScript(() => {
      localStorage.setItem("noodle_hint_dismissed", "1");
      localStorage.setItem("noodle_connect_hint_dismissed", "1");
      localStorage.setItem("noodle_graph", JSON.stringify({ v:1, nodes:[], links:[], nid:1, lid:1, view:{ panX:40, panY:80, scale:1 } }));
    });
    try {
      await resizePage.goto(origin + "/?product=off&na=0", { waitUntil:"networkidle" });
      await resizePage.locator("#editor").waitFor();
      await assertGripResize(resizePage, touch);
      console.log(`✓ resize: text, image, video, and Decide grips grow the card and the visible box (${label})`);
    } catch (error) {
      if (process.env.NANOODLE_SMOKE_ARTIFACTS) {
        const dir = resolve(process.env.NANOODLE_SMOKE_ARTIFACTS);
        await mkdir(dir, { recursive:true });
        await resizePage.screenshot({ path:resolve(dir, `resize-${label}.png`), fullPage:true }).catch(() => {});
      }
      throw error;
    } finally {
      await resizeContext.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
