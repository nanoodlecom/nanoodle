#!/usr/bin/env node
// Real browser journey: fresh visit → sample → app → share/export → NanoGPT OAuth.
// All provider requests are intercepted. This never uses credentials or buys inference.
// Playwright is a development-only dependency, installed separately by first-run.yml.
// Locally: NANOODLE_PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/smoke-first-run.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
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
    res.writeHead(200, { "Content-Type":mime[extname(file)] || "application/octet-stream" });
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
    pricing:{per_image:{"1k":0.04}}, supported_parameters:{resolutions:["1k"]} }] },
  "/api/v1/video-models": { data:[] },
  "/api/v1/audio-models": { data:[] },
};
let browser;
try {
  browser = await chromium.launch({ headless:true,
    ...(process.env.NANOODLE_CHROMIUM ? { executablePath:process.env.NANOODLE_CHROMIUM } : {}) });
  for (const mobile of [false, true]) {
    const label = mobile ? "mobile-retired-model" : "desktop";
    const contexts = [];
    const forbidden = [];
    const errors = [];
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
      context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
      return context;
    };
    const context = await newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    try {
      await page.goto(origin, {waitUntil:"networkidle"});
      assert.match(await page.locator("#canvashint").innerText(), /NanoGPT/);
      await page.locator("#run").click();
      await page.locator('.node[data-id="n3"][data-status="done"] .result img').waitFor();
      assert.equal(await page.locator('.node[data-status="error"]').count(), 0, "sample has no failed nodes");
      assert.equal(await page.locator(".demobadge").count(), 2, "both outputs are labeled as samples");
      assert.ok(await page.locator('.node[data-id="n3"] .result img').evaluate(img => img.complete && img.naturalWidth > 0),
        "sample image actually decodes");
      await page.locator("#demox").click();

      await page.locator("#makeapp").click();
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
      if (process.env.NANOODLE_SMOKE_ARTIFACTS) {
        const dir = resolve(process.env.NANOODLE_SMOKE_ARTIFACTS);
        await mkdir(dir, {recursive:true});
        await page.screenshot({path:resolve(dir, `${label}.png`), fullPage:true}).catch(() => {});
      }
      throw error;
    } finally {
      for (const context of contexts) await context.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
