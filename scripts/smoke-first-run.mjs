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
    if(pathname === "/__workspace-test-seed") {
      res.writeHead(200, {"Content-Type":"text/html", "Content-Security-Policy":"default-src 'none'"});
      res.end("<!doctype html><title>Workspace storage fixture</title>");
      return;
    }
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
const song = JSON.parse(await readFile(resolve(root, "examples/gallery/sing/graph.json"), "utf8"));
song.nodes.find(n => n.type === "comment").name = "Song idea";
song.nodes.find(n => n.id === "n1").fields.text = "SYNTHETIC SONG IDEA";
const uploadedPNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=";
song.nodes.push({id:"upload-test",type:"upload",x:20,y:700,fields:{image:uploadedPNG},name:"Uploaded input"});
const graphContent = value => { const {nid, lid, ...content} = value; return content; };
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

      assert.equal(await page.title(), "nanoodle — like ComfyUI, but way simpler", "unbound editor uses its tagline");
      await page.locator("#makeapp").click();
      // The iframe element exists before play.html wires its controls and loads
      // the handoff. Use the editor's validated __appready__ handshake instead.
      await page.waitForFunction(() => typeof appFrameLoaded !== "undefined" && appFrameLoaded);
      const builder = page.frameLocator("#appmodalframe");
      await builder.locator("#appframe").waitFor();
      const currentAppTitle = await builder.locator("#bar-title").innerText();
      await page.waitForFunction(expected => document.title === expected, currentAppTitle + " · nanoodle app");
      await page.locator("#appmodalclose").click();
      assert.equal(await page.title(), "nanoodle - " + currentAppTitle + " app", "closing the modal restores the canvas title");
      await page.locator("#makeapp").click();
      await page.waitForFunction(expected => document.title === expected, currentAppTitle + " · nanoodle app");
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
    for (const scenario of ["starter", "quota", "storage-startup"]) {
      const storageDenied = scenario === "quota";
      const slowStorage = scenario === "storage-startup";
      const tabContext = await newContext();
      const tabPage = await tabContext.newPage();
      tabPage.setDefaultTimeout(15000);
      let releaseStarter;
      const starterGate = new Promise(resolve => { releaseStarter = resolve; });
      let starterRequested;
      const starterSeen = new Promise(resolve => { starterRequested = resolve; });
      if (scenario === "starter") await tabPage.route("**/noodle-graph.json", async route => {
        starterRequested();
        await starterGate;
        await route.fulfill({json:starter});
      });
      if (slowStorage) await tabPage.addInitScript(({song}) => {
        localStorage.setItem("noodle_graph", JSON.stringify(song));
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function(name, version) {
          if(name !== "nanoodle-workspaces") return open.call(this, name, version);
          // Delay this request's delivery, then use the actual IndexedDB engine.
          // The production code still performs its real read/upgrade transaction.
          const request = {};
          setTimeout(() => {
            const native = open.call(this, name, version);
            native.onupgradeneeded = e => { request.result=native.result; request.onupgradeneeded?.(e); };
            native.onsuccess = e => { request.result=native.result; request.onsuccess?.(e); };
            native.onerror = e => { request.error=native.error; request.onerror?.(e); };
          }, 1000);
          return request;
        };
      }, {song});
      if (storageDenied) await tabPage.addInitScript(({song}) => {
        if (!localStorage.getItem("workspace-test-seeded")) {
          localStorage.setItem("noodle_graph", JSON.stringify(song));
          localStorage.setItem("noodle_keep", "unrelated-data-must-survive");
          localStorage.setItem("workspace-test-seeded", "1");
        }
        window.__workspaceCap = Number(sessionStorage.getItem("workspace-test-cap") || Infinity);
        window.__workspaceRejected = [];
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (this === localStorage) {
            const usage = Object.keys(localStorage).reduce((n,k) => n + k.length + localStorage.getItem(k).length, 0);
            const old = localStorage.getItem(key);
            const projected = usage - (old === null ? 0 : key.length + old.length) + key.length + String(value).length;
            if (projected > window.__workspaceCap) {
              window.__workspaceRejected.push({key, projected, cap:window.__workspaceCap});
              throw new DOMException("Synthetic aggregate storage budget exceeded", "QuotaExceededError");
            }
          }
          return setItem.call(this, key, value);
        };
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(...args) {
          if (this.name === "workspaces" && window.__denyWorkspaceDatabase)
            throw new DOMException("Synthetic browser storage denial", "QuotaExceededError");
          return put.apply(this, args);
        };
      }, {song});
      const openBlank = async () => {
        // Mobile intentionally folds the plus/strip into the Workspaces menu.
        // Desktop still clicks the literal plus, through Playwright hit testing.
        const control = mobile ? "#wsdrop" : "#wsadd";
        const menu = mobile ? "#wsdropmenu" : "#wschooser";
        await tabPage.locator(control).click();
        await tabPage.locator(`${menu}:not([hidden])`).waitFor({state:"visible"});
        assert.equal(await tabPage.locator(control).getAttribute("aria-expanded"), "true");
        await tabPage.locator(`${menu} [data-ws="blank"]`).click();
      };
      const switchToOriginal = async () => {
        if (mobile) {
          await tabPage.locator("#wsdrop").click();
          await tabPage.locator("#wsdropmenu .wsname").first().click();
        } else await tabPage.locator('#wstabs .wstab[data-id="w1"]').click();
      };
      const saveBackup = async () => {
        if (!await tabPage.locator("#save").isVisible()) await tabPage.locator("#morebtn").click();
        const [backup] = await Promise.all([
          tabPage.waitForEvent("download"), tabPage.locator("#save").click(),
        ]);
        assert.equal(await backup.failure(), null);
        return backup.path();
      };
      const settle = () => tabPage.evaluate(() => settleWorkspaceStorage());
      try {
        await tabPage.goto(origin, {waitUntil:storageDenied ? "networkidle" : "domcontentloaded"});
        if (slowStorage) {
          assert.equal(await tabPage.locator("#world .node").count(), 0, "the stored graph has not restored yet");
          await openBlank();
          await tabPage.waitForFunction(() => !initialCanvasUnclaimed());
          assert.equal(await tabPage.locator("#world .node").count(), 0);
          assert.equal(await tabPage.locator("#wstabs .wstab").count(), 2, "an early choice opens beside the restored Song idea");
          await switchToOriginal();
          assert.equal(await tabPage.evaluate(() => graph.nodes.find(n => n.id === "n1").fields.text), "SYNTHETIC SONG IDEA");
        } else if (!storageDenied) {
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
          const original = await tabPage.evaluate(() => {
            flushSave();
            const usage = Object.keys(localStorage).reduce((n,k) => n + k.length + localStorage.getItem(k).length, 0);
            window.__workspaceCap = usage + 512;
            sessionStorage.setItem("workspace-test-cap", String(window.__workspaceCap));
            graph.nodes.find(n => n.type === "music").out = {audio:"data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="};
            return JSON.stringify(serializeGraph());
          });
          const legacy = await tabPage.evaluate(() => localStorage.getItem("noodle_graph"));
          assert.equal(await tabPage.locator("#world .node").count(), song.nodes.length);
          for (let attempt = 0; attempt < 3; attempt++) {
            await openBlank();
            assert.equal(await tabPage.locator("#world .node").count(), 0, "new tab works while local storage stays full");
            await switchToOriginal();
            const restored = JSON.parse(await tabPage.evaluate(() => JSON.stringify(serializeGraph())));
            assert.deepEqual(graphContent(restored), graphContent(JSON.parse(original)), "switch back preserves the entire Song idea and upload");
            assert.ok(await tabPage.evaluate(() => graph.nodes.find(n => n.type === "music").out.audio), "generated results survive in-session switching");
            assert.equal(await tabPage.locator("#wstabs .wstab.on").getAttribute("data-id"), "w1");
          }
          assert.equal((await settle()).mode, "browser", "fallback is durably committed before refresh");
          assert.equal(await tabPage.evaluate(() => workspacePersistence().cause.key), "noodle_ws_w1", "the duplicate shelving write caused the fallback");
          assert.equal(await tabPage.evaluate(() => localStorage.getItem("noodle_graph")), legacy, "the last legacy durable graph is not deleted or evicted");

          const backup = await saveBackup();
          const saved = JSON.parse(await readFile(backup, "utf8"));
          assert.equal(saved.nodes.find(n => n.id === "upload-test").fields.image, uploadedPNG, "Save includes uploaded inputs");
          assert.ok(saved.nodes.every(n => !n.out), "generated results keep their existing excluded-from-backup semantics");
          await openBlank();
          await tabPage.locator("#loadfile").setInputFiles(backup);
          await tabPage.waitForFunction(() => graph.nodes.some(n => n.id === "upload-test"));
          assert.equal((await settle()).mode, "browser", "Load persists immediately while local storage stays full");
          assert.deepEqual(graphContent(JSON.parse(await tabPage.evaluate(() => JSON.stringify(serializeGraph())))), graphContent(saved), "Save → Load restores the complete workflow");
          await tabPage.reload({waitUntil:"networkidle"});
          assert.deepEqual(graphContent(JSON.parse(await tabPage.evaluate(() => JSON.stringify(serializeGraph())))), graphContent(saved), "refresh restores the loaded workspace from browser storage");

          // A second independent storage failure must keep usable tabs and offer
          // an actual Save export. Retry must persist the newest edit, not the old record.
          await tabPage.evaluate(() => { window.__denyWorkspaceDatabase = true; });
          const idea = tabPage.locator('.node[data-id="n1"] textarea').first();
          await idea.fill("NEWEST UNSAVED SONG IDEA");
          assert.equal((await settle()).mode, "session", "uncommitted state is never labeled saved");
          await tabPage.locator("#wspersistence-save").waitFor({state:"visible"});
          assert.match(await tabPage.locator("#wspersistence").innerText(), /visit only/);
          assert.ok(await tabPage.evaluate(() => {
            const e = new Event("beforeunload", {cancelable:true}); dispatchEvent(e); return e.defaultPrevented;
          }), "unpersisted work warns before refresh/close");
          const visitBackup = await saveBackup();
          await idea.fill("TEMPORARY CHANGE BEFORE LOAD");
          await settle();
          await tabPage.locator("#loadfile").setInputFiles(visitBackup);
          await tabPage.waitForFunction(() => graph.nodes.find(n => n.id === "n1")?.fields.text === "NEWEST UNSAVED SONG IDEA");
          assert.equal((await settle()).mode, "session", "Load is usable even when both browser stores reject writes");
          await idea.fill("EVEN NEWER SONG IDEA");
          await settle();
          await tabPage.evaluate(() => { window.__denyWorkspaceDatabase = false; });
          await tabPage.locator("#wspersistence-retry").click();
          assert.equal((await settle()).mode, "browser", "Retry saving commits the current state after recovery");
          await tabPage.reload({waitUntil:"networkidle"});
          assert.equal(await tabPage.evaluate(() => graph.nodes.find(n => n.id === "n1").fields.text), "EVEN NEWER SONG IDEA", "recovery never overwrites newer edits with an old backup");
          await openBlank();
          const legacyFile = resolve(root, "scripts/fixtures/legacy-noodle-graph.json");
          await tabPage.locator("#loadfile").setInputFiles(legacyFile);
          await tabPage.waitForFunction(() => graph.nodes.some(n => n.name === "Night desk"));
          await settle();
          await tabPage.reload({waitUntil:"networkidle"});
          const oldWorkflow = JSON.parse(await readFile(legacyFile, "utf8"));
          assert.deepEqual(graphContent(JSON.parse(await tabPage.evaluate(() => JSON.stringify(serializeGraph())))), graphContent(oldWorkflow), "old imported workflows and their uploads survive Load and refresh");
          await switchToOriginal();
          assert.equal(await tabPage.evaluate(() => graph.nodes.find(n => n.id === "n1").fields.text), "SYNTHETIC SONG IDEA", "the original workspace survives imports, edits and refreshes");
          assert.equal(await tabPage.evaluate(() => localStorage.getItem("noodle_keep")), "unrelated-data-must-survive");
          await settle();
        }
        assert.deepEqual(forbidden, [], "workspace clicks make no paid or unexpected external requests");
        assert.deepEqual(errors, [], "workspace clicks produce no browser JavaScript errors");
        console.log(`✓ workspace ${mobile ? "menu" : "plus"} ${label}: ${slowStorage ? "first click during browser storage restore → Blank beside saved Song idea" : storageDenied ? "Song idea + results → tight aggregate quota → usable tabs → Save/Load → refresh → visit-only warning/export → retry newest edit → legacy import" : "first click → chooser → Blank survives slow startup"}; no paid calls`);
      } catch (error) {
        if (process.env.NANOODLE_SMOKE_ARTIFACTS) {
          const dir = resolve(process.env.NANOODLE_SMOKE_ARTIFACTS);
          await mkdir(dir, {recursive:true});
          await tabPage.screenshot({path:resolve(dir, `workspace-${label}-${scenario}.png`), fullPage:true}).catch(() => {});
        }
        throw error;
      } finally {
        releaseStarter();
        await tabContext.close();
      }
    }
    // Start with newer IDB-only tabs plus an older local backup, then fail the
    // actual restore request. Neither Retry nor healthy reload may erase either branch.
    for (const failure of ["open", "read", "timeout", "unavailable", "overlap"]) {
      const recoveryContext = await newContext();
      const seedPage = await recoveryContext.newPage();
      await seedPage.goto(origin + "/__workspace-test-seed");
      await seedPage.evaluate(async () => {
        const make = text => JSON.stringify({v:1,nodes:[{id:"n1",type:"text",x:30,y:40,fields:{text}}],links:[],nid:2,lid:1});
        localStorage.setItem("noodle_graph",make("LEGACY BACKUP"));
        localStorage.setItem("noodle_workspaces",JSON.stringify({v:1,active:"w1",seq:1,tabs:[{id:"w1",name:"Local backup"}]}));
        const db = await new Promise((resolve,reject) => {
          const req=indexedDB.open("nanoodle-workspaces",1);
          req.onupgradeneeded=()=>req.result.createObjectStore("workspaces");
          req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
        });
        await new Promise((resolve,reject) => {
          const tx=db.transaction("workspaces","readwrite");
          tx.objectStore("workspaces").put({v:1,values:{
            noodle_graph:make("IDB ONLY TAB"),noodle_ws_w1:make("IDB ORIGINAL"),
            noodle_workspaces:JSON.stringify({v:1,active:"w2",seq:2,tabs:[{id:"w1",name:"IDB original"},{id:"w2",name:"IDB only"}]}),
          }},"state");
          tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
        });
        db.close();
      });
      await seedPage.close();
      const recoveryPage = await recoveryContext.newPage();
      recoveryPage.setDefaultTimeout(15000);
      // This page contains synthetic edits with a recovery journal; accept only
      // this test page's unload warning when explicitly exercising reload.
      recoveryPage.on("dialog", dialog => dialog.accept());
      await recoveryPage.addInitScript(({failure}) => {
        const broken = () => sessionStorage.getItem("restore-test-healthy") !== "1";
        if(failure==="overlap") {
          // The manual race gate is independent of the separately tested 2.5s
          // timeout. Allow UI-action latency without timing out this race fixture.
          const timeout=window.setTimeout.bind(window);
          window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===2500?10000:ms,...args);
        }
        if(failure==="unavailable" && broken()) Object.defineProperty(window,"indexedDB",{value:undefined,configurable:true});
        const open=IDBFactory.prototype.open;
        window.__restoreRequests=0;
        IDBFactory.prototype.open=function(name,version){
          if(name==="nanoodle-workspaces" && failure==="overlap" && !broken() && sessionStorage.getItem("restore-test-overlap-done")!=="1") {
            window.__restoreRequests++;
            const req={},native=open.call(this,name,version);
            native.onsuccess=()=>{
              window.__releaseRestoreOpen=()=>{req.result=native.result;req.onsuccess?.();};
              window.__restoreReadPending=true;
            };
            native.onerror=()=>{req.error=native.error;req.onerror?.();};
            return req;
          }
          if(name!=="nanoodle-workspaces" || !broken() || failure==="read") return open.call(this,name,version);
          const req={};
          if(failure==="open" || failure==="overlap") setTimeout(()=>{req.error=new DOMException("Synthetic open failure","UnknownError");req.onerror?.();},0);
          else setTimeout(()=>{
            const native=open.call(this,name,version);
            native.onsuccess=()=>{req.result=native.result; req.onsuccess?.(); window.__lateWorkspaceOpenDelivered=true;};
            native.onerror=()=>{req.error=native.error; req.onerror?.();};
          },3200);
          return req;
        };
        const get=IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get=function(key){
          if(this.name!=="workspaces" || !broken() || failure!=="read") return get.call(this,key);
          const req={};
          setTimeout(()=>{req.error=new DOMException("Synthetic read failure","UnknownError");req.onerror?.();},0);
          return req;
        };
      },{failure});
      try {
        await recoveryPage.goto(origin,{waitUntil:"domcontentloaded"});
        await recoveryPage.waitForFunction(()=>typeof workspacePersistence==="function" && workspacePersistence().restoreFailed && graph.nodes.length>0);
        assert.equal((await recoveryPage.evaluate(()=>workspacePersistence())).mode,"session","failed restore never silently promotes the stale local backup");
        await recoveryPage.locator('.node[data-id="n1"] textarea').fill("NEWEST RECOVERY EDIT " + failure);
        await recoveryPage.evaluate(()=>settleWorkspaceStorage());
        assert.equal(await recoveryPage.evaluate(()=>workspacePersistence().recoveryBackup),"local","edits are journaled separately without touching unread IDB");
        if(mobile){
          await recoveryPage.locator("#wsdrop").click();
          await recoveryPage.locator("#wsdropmenu .wsrow.on .wsx").click();
        }else await recoveryPage.locator("#wstabs .wstab.on .wsx").click();
        await recoveryPage.locator("#wscloseundo-action").click();
        assert.equal(await recoveryPage.evaluate(()=>graph.nodes.find(n=>n.id==="n1").fields.text),"NEWEST RECOVERY EDIT " + failure,"close/Undo during unreadable storage preserves this visit's edits");
        await recoveryPage.evaluate(()=>settleWorkspaceStorage());
        assert.match(await recoveryPage.locator("#wspersistence").innerText(),/could not be restored/);
        if(failure==="timeout") {
          await recoveryPage.waitForFunction(()=>window.__lateWorkspaceOpenDelivered);
          assert.ok(await recoveryPage.evaluate(()=>workspacePersistence().restoreFailed),"a late open callback cannot silently change storage authority");
        }
        let expectedText=(failure==="read" ? "RAPID RECOVERY EDIT " : "NEWEST RECOVERY EDIT ")+failure;
        if(failure==="read") await recoveryPage.locator('.node[data-id="n1"] textarea').fill(expectedText);
        await recoveryPage.evaluate(()=>sessionStorage.setItem("restore-test-healthy","1"));
        if(failure==="overlap") {
          await recoveryPage.locator("#wspersistence-retry").click();
          await recoveryPage.waitForFunction(()=>window.__restoreReadPending);
          const field=recoveryPage.locator('.node[data-id="n1"] textarea');
          await field.fill("EDIT B WHILE RETRY IS PENDING");
          await recoveryPage.evaluate(()=>settleWorkspaceStorage());
          assert.ok(await recoveryPage.locator("#wspersistence-retry").isDisabled(),"a pending retry cannot be started again from the UI");
          // Force the duplicate handler as well: correctness must not depend on
          // button state or event ordering. It must share the first init promise.
          await recoveryPage.evaluate(()=>{void document.getElementById("wspersistence-retry").onclick();});
          expectedText="LATEST OVERLAPPING RETRY EDIT";
          await field.fill(expectedText);
          await recoveryPage.evaluate(()=>settleWorkspaceStorage());
          assert.equal(await recoveryPage.evaluate(()=>window.__restoreRequests),1,"overlapping Retry shares one storage restore");
          await recoveryPage.evaluate(()=>{sessionStorage.setItem("restore-test-overlap-done","1");window.__releaseRestoreOpen();});
          await recoveryPage.waitForFunction(()=>!workspacePersistence().restoreFailed && workspacePersistence().mode==="browser");
        } else if(failure==="open") {
          await recoveryPage.locator("#wspersistence-retry").click();
          await recoveryPage.waitForFunction(()=>!workspacePersistence().restoreFailed && workspacePersistence().mode==="browser");
        } else await recoveryPage.reload({waitUntil:"networkidle"});
        await recoveryPage.evaluate(()=>settleWorkspaceStorage());
        assert.equal(await recoveryPage.evaluate(()=>readWorkspaces().tabs.length),3,"IDB-only tabs and the recovery visit are all retained");
        assert.equal(await recoveryPage.evaluate(()=>graph.nodes[0].fields.text),expectedText);
        await recoveryPage.reload({waitUntil:"networkidle"});
        assert.equal(await recoveryPage.evaluate(()=>readWorkspaces().tabs.length),3,"a consumed recovery journal does not duplicate or overwrite work on healthy reload");
        assert.equal(await recoveryPage.evaluate(()=>graph.nodes[0].fields.text),expectedText);
        if(mobile) {
          await recoveryPage.locator("#wsdrop").click();
          await recoveryPage.locator("#wsdropmenu").getByRole("button",{name:"IDB only",exact:true}).click();
        } else await recoveryPage.locator('#wstabs .wstab[data-id="w2"]').click();
        assert.equal(await recoveryPage.evaluate(()=>graph.nodes[0].fields.text),"IDB ONLY TAB","Retry/reload never deletes a previously unread IDB-only workspace");
        await recoveryPage.evaluate(()=>settleWorkspaceStorage());
        if(failure==="open") {
          const backupPage=await recoveryContext.newPage();
          await backupPage.goto(origin+"/workspace-recovery.html");
          const button=backupPage.locator('button[data-source="browser"][data-id="w2"]');
          await button.waitFor({state:"visible"});
          const [backup]=await Promise.all([backupPage.waitForEvent("download"),button.click()]);
          const recovered=JSON.parse(await readFile(await backup.path(),"utf8"));
          assert.equal(recovered.nodes[0].fields.text,"IDB ONLY TAB","the same-origin read-only recovery page exports an IDB-only workflow");
          assert.equal(await backupPage.locator('button[data-source="legacy"]').count(),1,"the retained legacy backup is separately available");
          await backupPage.close();
          await recoveryPage.reload({waitUntil:"networkidle"});
          assert.equal(await recoveryPage.evaluate(()=>readWorkspaces().tabs.length),3,"backup export does not mutate workspace storage");
          await recoveryPage.evaluate(async()=>{
            const db=await new Promise((resolve,reject)=>{const r=indexedDB.open("nanoodle-workspaces",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
            await new Promise((resolve,reject)=>{
              const tx=db.transaction("workspaces","readwrite"),store=tx.objectStore("workspaces"),r=store.get("state");
              r.onsuccess=()=>{
                const record=r.result,index=JSON.parse(record.values.noodle_workspaces);
                index.tabs.push({id:"w9",name:"Other writer"});index.seq=9;
                record.values.noodle_workspaces=JSON.stringify(index);
                record.values.noodle_ws_w9=JSON.stringify({v:1,nodes:[{id:"n1",type:"text",x:20,y:30,fields:{text:"OTHER WRITER TAB"}}],links:[],nid:2,lid:1});
                record.generation="synthetic-other-writer";store.put(record,"state");
              };
              tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
            });db.close();
          });
          await recoveryPage.locator('.node[data-id="n1"] textarea').fill("UNCOMMITTED CONCURRENT EDIT");
          const conflict=await recoveryPage.evaluate(()=>settleWorkspaceStorage());
          assert.equal(conflict.mode,"session");assert.equal(conflict.cause.name,"WorkspaceConflict","an older window cannot overwrite a newer database snapshot");
          await recoveryPage.locator("#wspersistence-retry").click();
          await recoveryPage.waitForFunction(()=>!workspacePersistence().restoreFailed && workspacePersistence().mode==="browser");
          assert.ok(await recoveryPage.evaluate(()=>readWorkspaces().tabs.some(t=>t.id==="w9")),"conflict recovery preserves the other writer's IDB-only tab");
          assert.equal(await recoveryPage.evaluate(()=>graph.nodes[0].fields.text),"UNCOMMITTED CONCURRENT EDIT","conflict recovery also preserves this visit's newest edit");
          await recoveryPage.reload({waitUntil:"networkidle"});
          assert.equal(await recoveryPage.evaluate(()=>graph.nodes[0].fields.text),"UNCOMMITTED CONCURRENT EDIT");
        }
        assert.deepEqual(forbidden,[]); assert.deepEqual(errors,[]);
        console.log(`✓ workspace recovery ${label}: ${failure} failure → edit → ${failure==="open" ? "Retry" : "healthy reload"} → preserve both saved tabs and newest visit`);
      } catch(error) {
        if(process.env.NANOODLE_SMOKE_ARTIFACTS){
          const dir=resolve(process.env.NANOODLE_SMOKE_ARTIFACTS);await mkdir(dir,{recursive:true});
          await recoveryPage.screenshot({path:resolve(dir,`recovery-${label}-${failure}.png`),fullPage:true}).catch(()=>{});
        }
        throw error;
      } finally { await recoveryContext.close(); }
    }
    // Real close controls, action buttons and native keyboard dispatch. The
    // tombstones are visit-only; persisted graphs still use the storage adapter.
    {
      const closeContext=await newContext();
      const closePage=await closeContext.newPage();closePage.setDefaultTimeout(15000);
      const dialogs=[];
      closePage.on("dialog",async dialog=>{dialogs.push(dialog.type());await dialog.dismiss();});
      await closePage.addInitScript(({song})=>{
        if(!localStorage.getItem("close-test-seeded")){
          const other={v:1,nodes:[{id:"other",type:"text",x:30,y:30,fields:{text:"OTHER WORKFLOW"},name:"Other"}],links:[],nid:2,lid:1};
          localStorage.setItem("noodle_graph",JSON.stringify(song));
          localStorage.setItem("noodle_ws_w2",JSON.stringify(other));
          localStorage.setItem("noodle_ws_w3",JSON.stringify(other));
          localStorage.setItem("noodle_workspaces",JSON.stringify({v:1,seq:3,active:"w1",tabs:[
            {id:"w1",name:"Song idea",app:null},{id:"w2",name:"Poster",app:null},{id:"w3",name:"Sketch",app:null}]}));
          localStorage.setItem("close-test-seeded","1");
          localStorage.setItem("noodle_hint_dismissed","1");localStorage.setItem("noodle_connect_hint_dismissed","1");
        }
        const set=Storage.prototype.setItem;
        Storage.prototype.setItem=function(key,value){
          if(this===localStorage && window.__closeStorageFull && /^noodle_(graph|workspaces|ws_|editor_app)/.test(key))throw new DOMException("Synthetic full storage","QuotaExceededError");
          return set.call(this,key,value);
        };
        const put=IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put=function(...args){
          if(this.name==="workspaces" && window.__closeDatabaseDenied)throw new DOMException("Synthetic database denial","QuotaExceededError");
          return put.apply(this,args);
        };
      },{song});
      const closeTab=async id=>{
        if(mobile){
          if(!await closePage.locator("#wsdropmenu").isVisible())await closePage.locator("#wsdrop").click();
          const index=await closePage.evaluate(id=>readWorkspaces().tabs.findIndex(t=>t.id===id),id);
          await closePage.locator("#wsdropmenu .wsrow").nth(index).locator(".wsx").click();
        }else await closePage.locator(`#wstabs .wstab[data-id="${id}"] .wsx`).click();
      };
      const ids=()=>closePage.evaluate(()=>readWorkspaces().tabs.map(t=>t.id));
      const shortcut=async key=>{await closePage.evaluate(()=>document.activeElement?.blur());await closePage.keyboard.press(key);};
      try{
        await closePage.goto(origin+"/?product=off&na=0",{waitUntil:"networkidle"});
        await closePage.evaluate(()=>{const n=graph.nodes.find(n=>n.id==="n1");n.out={text:"GENERATED IN THIS VISIT"};pushUndo();});
        await closeTab("w2");
        assert.deepEqual(await ids(),["w1","w3"],"inactive close is immediate");
        assert.match(await closePage.locator("#wscloseundo").innerText(),/Closed “Poster”/);
        assert.equal(await closePage.locator("#wscloseundo").getAttribute("role"),"status");
        assert.equal(await closePage.locator("#wscloseundo").getAttribute("aria-live"),"polite");
        assert.equal(await closePage.locator("#wscloseundo-action").evaluate(el=>el===document.activeElement),false,"notice does not steal focus");
        assert.ok(await closePage.locator("#wscloseundo-action").evaluate(el=>el.getBoundingClientRect().height>=44),"Undo is a touch-sized button");
        // A rename input and contenteditable retain browser undo, even while a
        // close is pending. Merely opening an editor must not close another tab.
        if(mobile){
          const rename=closePage.locator("#wsdropmenu input.wsrename");
          await rename.focus();await closePage.keyboard.press("Control+z");
        }else{
          await closePage.locator('#wstabs .wstab[data-id="w1"]').press("F2");
          await closePage.locator("#wstabs input.wsrename").press("Control+z");
        }
        assert.deepEqual(await ids(),["w1","w3"],"rename input Ctrl+Z never reopens tabs");
        const native=await closePage.evaluate(()=>{
          const el=document.createElement("div");el.contentEditable="true";document.body.append(el);el.focus();
          const event=new KeyboardEvent("keydown",{key:"z",ctrlKey:true,bubbles:true,cancelable:true});el.dispatchEvent(event);
          const prevented=event.defaultPrevented;el.remove();return prevented;
        });
        assert.equal(native,false,"contenteditable keeps native undo");
        if(process.env.NANOODLE_SMOKE_ARTIFACTS){
          const dir=resolve(process.env.NANOODLE_SMOKE_ARTIFACTS);await mkdir(dir,{recursive:true});
          await closePage.screenshot({path:resolve(dir,`close-undo-${label}.png`),fullPage:true});
        }
        await closePage.locator("#wscloseundo-action").click();
        assert.deepEqual(await ids(),["w1","w2","w3"],"button restores inactive tab at original position");
        assert.equal(await closePage.evaluate(()=>readWorkspaces().active),"w1","inactive Undo keeps current workflow");
        await closeTab("w1");
        assert.equal(await closePage.evaluate(()=>readWorkspaces().active),"w2");
        await shortcut("Control+z");
        assert.equal(await closePage.evaluate(()=>readWorkspaces().active),"w1","literal keyboard Undo restores active close");
        assert.equal(await closePage.evaluate(()=>graph.nodes.find(n=>n.id==="n1").out.text),"GENERATED IN THIS VISIT","Undo retains generated results in this visit");
        assert.equal(await closePage.evaluate(()=>graph.nodes.find(n=>n.id==="upload-test").fields.image),uploadedPNG);
        await shortcut("Control+Shift+z");
        assert.deepEqual(await ids(),["w2","w3"],"keyboard Redo closes restored active tab");
        await closeTab("w3");
        await shortcut("Control+z");await shortcut("Control+z");
        assert.deepEqual(await ids(),["w1","w2","w3"],"multiple closes undo LIFO without losing tabs");
        await closeTab("w2");await closeTab("w3");
        await closeTab("w1");
        assert.deepEqual(await ids(),["w1"],"last close keeps its ID");
        assert.equal(await closePage.locator(".node").count(),0);
        await closePage.locator("#wscloseundo-action").click();
        assert.deepEqual(await ids(),["w1"],"last Undo restores into the same ID");
        assert.equal(await closePage.evaluate(()=>readWorkspaces().tabs[0].name),"Song idea");
        assert.equal(await closePage.evaluate(()=>graph.nodes.find(n=>n.id==="n1").out.text),"GENERATED IN THIS VISIT");
        // A new edit makes the earlier close toast stale. Canvas Undo remains
        // available and cannot accidentally reopen one of those old tabs.
        await closePage.evaluate(()=>{addNode("text",20,20,{text:"LATEST NEW NODE"});});
        assert.equal(await closePage.locator("#wscloseundo").isVisible(),false,"new action dismisses stale close Undo");
        await shortcut("Control+z");
        assert.deepEqual(await ids(),["w1"],"canvas Undo does not resurrect stale tab closures");
        assert.equal(await closePage.evaluate(()=>graph.nodes.some(n=>n.fields?.text==="LATEST NEW NODE")),false,"canvas Undo still works");
        // Both stores denied: close/Undo are still usable and accurately marked
        // visit-only. Recovery persists the restored newest graph, not a tombstone.
        await closePage.evaluate(()=>{window.__closeStorageFull=true;window.__closeDatabaseDenied=true;});
        await closeTab("w1");await closePage.locator("#wscloseundo-action").click();
        assert.equal((await closePage.evaluate(()=>settleWorkspaceStorage())).mode,"session");
        assert.match(await closePage.locator("#wspersistence").innerText(),/visit only/);
        assert.equal(await closePage.evaluate(()=>graph.nodes.find(n=>n.id==="upload-test").fields.image),uploadedPNG);
        await closePage.evaluate(()=>{window.__closeDatabaseDenied=false;});
        await closePage.locator("#wspersistence-retry").click();
        assert.equal((await closePage.evaluate(()=>settleWorkspaceStorage())).mode,"browser");
        // Save/Load exercises the restored workflow's real file controls.
        if(!await closePage.locator("#save").isVisible())await closePage.locator("#morebtn").click();
        const [backup]=await Promise.all([closePage.waitForEvent("download"),closePage.locator("#save").click()]);
        const saved=JSON.parse(await readFile(await backup.path(),"utf8"));
        assert.equal(saved.nodes.find(n=>n.id==="upload-test").fields.image,uploadedPNG);
        assert.ok(saved.nodes.every(n=>!n.out),"Save retains existing generated-output exclusion");
        await closeTab("w1");await closePage.locator("#loadfile").setInputFiles(await backup.path());
        await closePage.waitForFunction(()=>graph.nodes.some(n=>n.id==="upload-test"));
        assert.equal(await closePage.locator("#wscloseundo").isVisible(),false,"Load invalidates stale close action");
        await closePage.evaluate(()=>settleWorkspaceStorage());
        await closePage.reload({waitUntil:"networkidle"});
        assert.equal(await closePage.evaluate(()=>graph.nodes.find(n=>n.id==="upload-test").fields.image),uploadedPNG,"Save/Load then reload keeps restored upload");
        assert.equal(await closePage.locator("#wscloseundo").isVisible(),false,"reload never implies visit-only close history survived");
        await closePage.evaluate(()=>Object.defineProperty(navigator,"platform",{value:"MacIntel",configurable:true}));
        await closeTab("w1");
        assert.equal(await closePage.locator("#wscloseundo-key").textContent(),"⌘ + Z","Mac shows the native hotkey");
        await shortcut("Meta+z");
        assert.equal(await closePage.evaluate(()=>graph.nodes.find(n=>n.id==="upload-test").fields.image),uploadedPNG,"Cmd+Z restores a closed workspace");
        await closeTab("w1");await closePage.keyboard.press("Escape");
        assert.equal(await closePage.locator("#wscloseundo").isVisible(),false,"Escape dismisses the action without undoing the close");
        await closePage.locator("#loadfile").setInputFiles(await backup.path());
        await closePage.waitForFunction(()=>graph.nodes.some(n=>n.id==="upload-test"));
        // Timer is suspended while pointer/focus is on the action and expires
        // after eight available seconds. Escape dismisses without altering data.
        await closeTab("w1");
        await closePage.evaluate(()=>settleWorkspaceStorage());
        await closePage.clock.install();
        await closePage.locator("#wscloseundo-action").focus();
        await closePage.clock.runFor(9000);
        assert.equal(await closePage.locator("#wscloseundo").isVisible(),true,"focused Undo does not expire");
        await closePage.evaluate(()=>document.activeElement.blur());await closePage.mouse.move(1,1);
        await closePage.clock.runFor(8100);
        assert.equal(await closePage.locator("#wscloseundo").isVisible(),false,"notice expires without deleting more data");
        assert.deepEqual(await ids(),["w1"]);
        assert.deepEqual(dialogs,[],"workspace deletion never opens a blocking browser dialog");
        assert.deepEqual(errors,[],"close/Undo produces no browser exceptions");
        assert.deepEqual(forbidden,[],"close/Undo makes no paid or unexpected requests");
        console.log(`✓ workspace close ${label}: immediate controls, button/hotkey Undo/Redo, native typing, results/uploads/history, last ID, storage denial/recovery, Save/Load/reload, notice focus/expiry`);
      }catch(error){
        if(process.env.NANOODLE_SMOKE_ARTIFACTS){const dir=resolve(process.env.NANOODLE_SMOKE_ARTIFACTS);await mkdir(dir,{recursive:true});await closePage.screenshot({path:resolve(dir,`close-undo-failure-${label}.png`),fullPage:true}).catch(()=>{});}
        throw error;
      }finally{await closeContext.close();}
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
  // Several tabs, narrow enough that the strip scrolls sideways. overflow-x:auto
  // must not grow a vertical scrollbar, and a horizontal bar must not steal
  // height from the tabs (scrollHeight stays within the strip).
  {
    const stripContext = await browser.newContext({ viewport:{ width:880, height:800 }, locale:"en-US" });
    await stripContext.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        if (url.pathname === "/sw.js") return route.fulfill({ contentType:"text/javascript", body:"// No caching in the browser smoke test.\n" });
        return route.continue();
      }
      return route.abort();
    });
    const stripNames = ["Song idea","Night desk","Poster","Loop","Ask","Storyboard","Hero ad","Snow loop","Bilingual poster","Product shot"];
    const stripPage = await stripContext.newPage();
    stripPage.setDefaultTimeout(15000);
    await stripPage.addInitScript((names) => {
      const tabs = names.map((name, i) => ({ id:"w" + (i + 1), name, app:null }));
      localStorage.setItem("noodle_workspaces", JSON.stringify({ v:1, active:"w1", seq:tabs.length, tabs }));
      localStorage.setItem("noodle_graph", JSON.stringify({ v:1, nodes:[], links:[], nid:1, lid:1 }));
      localStorage.setItem("noodle_hint_dismissed", "1");
      localStorage.setItem("noodle_connect_hint_dismissed", "1");
    }, stripNames);
    try {
      await stripPage.goto(origin + "/?product=off&na=0", { waitUntil:"domcontentloaded" });
      await stripPage.locator("#wstabs .wstab").nth(stripNames.length - 1).waitFor();
      const box = await stripPage.locator("#wstabs").evaluate(el => {
        el.scrollLeft = el.scrollWidth;
        const strip = el.getBoundingClientRect();
        const tabs = [...el.querySelectorAll(".wstab")];
        const tabOverflow = tabs.filter(t => {
          const r = t.getBoundingClientRect();
          return r.top < strip.top - 0.5 || r.bottom > strip.bottom + 0.5 || r.height > strip.height + 0.5;
        }).length;
        const cs = getComputedStyle(el);
        return {
          scrollHeight:el.scrollHeight, clientHeight:el.clientHeight,
          scrollWidth:el.scrollWidth, clientWidth:el.clientWidth,
          overflowY:cs.overflowY, count:tabs.length, tabOverflow,
        };
      });
      assert.ok(box.count >= 4, "several workspace tabs are open");
      assert.ok(box.scrollWidth > box.clientWidth, "the strip is wide enough to scroll sideways");
      assert.ok(box.scrollHeight <= box.clientHeight, `tab strip scrollHeight ${box.scrollHeight} exceeds clientHeight ${box.clientHeight}`);
      assert.equal(box.overflowY, "hidden");
      assert.equal(box.tabOverflow, 0, "tab height stays inside the strip");
      console.log("✓ workspace tab strip: no vertical scrollbar with several tabs");
    } catch (error) {
      if (process.env.NANOODLE_SMOKE_ARTIFACTS) {
        const dir = resolve(process.env.NANOODLE_SMOKE_ARTIFACTS);
        await mkdir(dir, { recursive:true });
        await stripPage.screenshot({ path:resolve(dir, "tab-strip.png"), fullPage:true }).catch(() => {});
      }
      throw error;
    } finally {
      await stripContext.close();
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
