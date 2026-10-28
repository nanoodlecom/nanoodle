#!/usr/bin/env node
// Post-deploy smoke gate: a fresh headless browser against the LIVE site (or any base URL).
//   1. (when a sha is given) wait until /sw.js carries CACHE = "nanoodle-<sha7>" AND the editor
//      HTML carries <meta name="nanoodle-build" content="<sha7>"> (both stamped by stamp-sw.mjs)
//   2. load the editor; prove the page's own build marker; fail on any warning/error banner or
//      toast, and on any console error / uncaught page error
//   3. open a new workspace, rename it (which saves it), reload, re-prove the build marker,
//      confirm the workspace persisted
//   4. open 📣 Updates and require real update cards (a dated heading + a non-empty item)
// Makes NO paid or generation calls and uses no API keys: every request to a provider API host
// is aborted in the browser (except free, keyless model-catalog GETs), and nothing is ever run.
//
// Env:
//   NANOODLE_SMOKE_URL        base URL (default https://nanoodle.com)
//   NANOODLE_SMOKE_SHA        commit to wait for / prove (version checks skipped when unset)
//   NANOODLE_SMOKE_WAIT_S     max seconds to wait for the deploy (default 900)
//   NANOODLE_PLAYWRIGHT       path to playwright/index.mjs (dev tooling lives outside the site)
//   NANOODLE_SMOKE_ARTIFACTS  where to drop a failure screenshot + log
//   GITHUB_STEP_SUMMARY       (set by Actions) the result table is appended here
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const base = (process.env.NANOODLE_SMOKE_URL || "https://nanoodle.com").replace(/\/+$/, "");
const sha7 = (process.env.NANOODLE_SMOKE_SHA || "").trim().slice(0, 7);
const waitS = Number(process.env.NANOODLE_SMOKE_WAIT_S || 900);
const artifacts = process.env.NANOODLE_SMOKE_ARTIFACTS;
const mod = process.env.NANOODLE_PLAYWRIGHT;
const { chromium } = await import(mod ? pathToFileURL(resolve(mod)).href : "playwright");

const FETCH_TIMEOUT_MS = 15000;   // every Node-side fetch (sw.js / index.html polls)
const NAV_TIMEOUT_MS = 60000;     // every page navigation
const ACTION_TIMEOUT_MS = 15000;  // every Playwright locator action/wait without its own timeout

// Hosts that could cost money or need a key. Requests to them are aborted, EXCEPT the public,
// keyless, free model-catalog GETs (/api/v1/*models) the editor reads on load, so the editor
// renders the way a real first visitor sees it. No generation endpoint is ever reachable.
const BLOCKED_HOSTS = /(^|\.)(nano-gpt\.com|runware\.ai|openai\.com|anthropic\.com|fal\.(ai|run)|replicate\.com)$/i;
const urlParts = u => { try { const x = new URL(u); return { host: x.hostname, path: x.pathname }; } catch { return { host: "", path: "" }; } };

// Console allowlist: ONLY the exact request URLs this test aborted itself. Chromium logs each as
// "Failed to load resource: net::ERR_FAILED" with the URL as the message location. Anything else
// (a catalog 503, a same-origin 404, a CSP violation) is a real error and fails the gate.
const deliberatelyBlocked = new Set();
const isOwnAbort = (text, url) => /Failed to load resource: net::ERR_FAILED/.test(text) && deliberatelyBlocked.has(url);

const results = [];
const step = async (name, fn) => {
  try { const note = await fn(); results.push({ name, ok: true, note: note || "" }); console.log(`✓ ${name}${note ? " — " + note : ""}`); }
  catch (e) { const msg = String(e && e.message || e); results.push({ name, ok: false, note: msg }); console.log(`✗ ${name} — ${msg}`); throw e; }
};
async function summary(ok, extra = "") {
  const lines = [`## Post-deploy smoke: ${ok ? "✅ passed" : "❌ FAILED"}`, "", `Target: ${base}${sha7 ? `  ·  commit \`${sha7}\`` : "  ·  (no sha: version checks skipped)"}`, "",
    "| step | result | detail |", "|---|---|---|",
    ...results.map(r => `| ${r.name} | ${r.ok ? "✅" : "❌"} | ${r.note.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 400)} |`)];
  if (extra) lines.push("", extra);
  const md = lines.join("\n") + "\n";
  console.log("\n" + md);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md);
}
async function fetchText(url) {
  const r = await fetch(url, { cache: "no-store", headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}
const pageBuild = html => (html.match(/<meta name="nanoodle-build" content="([^"]*)"/) || [, "(no nanoodle-build meta)"])[1];

const consoleErrors = [], ignored = [], pageErrors = [];
let browser, page, ok = false;
try {
  if (sha7) await step(`deploy live (sw.js "nanoodle-${sha7}" + page build "${sha7}")`, async () => {
    const t0 = Date.now(), until = t0 + waitS * 1000; let last = "";
    while (Date.now() < until) {
      try {
        const sw = await fetchText(`${base}/sw.js?smoke=${Date.now()}`);
        const cache = (sw.match(/const CACHE = "([^"]*)"/) || [, "(no CACHE line)"])[1];
        const build = pageBuild(await fetchText(`${base}/?smoke=${Date.now()}`));
        last = `sw.js CACHE "${cache}", page build "${build}"`;
        if (cache === `nanoodle-${sha7}` && build === sha7) return `seen after ${Math.round((Date.now() - t0) / 1000)}s`;
      } catch (e) { last = String(e.message || e); }
      if (Date.now() + 15000 >= until) break;
      await new Promise(r => setTimeout(r, 15000));
    }
    throw new Error(`timed out after ${waitS}s; live has ${last}`);
  });

  browser = await chromium.launch();
  const context = await browser.newContext(); // fresh: no storage, no cookies, no service worker
  context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);
  await context.route("**/*", route => {
    const req = route.request(), { host, path } = urlParts(req.url());
    if (!BLOCKED_HOSTS.test(host)) return route.continue();
    const freeCatalog = req.method() === "GET" && /^\/api\/v1\/[a-z0-9-]*models$/.test(path) && !req.headers()["authorization"];
    if (freeCatalog) return route.continue();
    deliberatelyBlocked.add(req.url());
    return route.abort("failed");
  });
  // Record every warning/error toast, even ones that vanish before we look.
  await context.addInitScript(() => {
    window.__smokeToasts = [];
    const watch = () => {
      const el = document.getElementById("toast"); if (!el) return setTimeout(watch, 50);
      new MutationObserver(() => { if (/\b(err|warn)\b/.test(el.className) && el.classList.contains("show")) window.__smokeToasts.push(`[${el.className}] ${el.textContent}`); })
        .observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
    };
    watch();
  });
  page = await context.newPage();
  page.on("console", m => {
    if (m.type() !== "error") return;
    const text = m.text(), url = (m.location() || {}).url || "";
    if (isOwnAbort(text, url)) ignored.push(`${text} ${url} (allowed: this test aborted that exact request)`);
    else consoleErrors.push(`${text}${url ? " @ " + url : ""}`);
  });
  page.on("pageerror", e => pageErrors.push(String(e && e.stack || e)));
  // The editor's beforeunload guard must be accepted or reload() never navigates; anything else is dismissed.
  page.on("dialog", d => (d.type() === "beforeunload" ? d.accept() : d.dismiss()).catch(() => {}));

  // Banner/toast scan, scoped to the app's notice surfaces ONLY, never page-wide text, so the
  // changelog or docs quoting a warning can't trip it.
  const banners = async () => page.evaluate(() => {
    const vis = el => !!el && !el.hidden && (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : el.getClientRects().length > 0);
    const out = [];
    for (const id of ["wspersistence", "appblock"]) { const el = document.getElementById(id); if (vis(el)) out.push(`#${id}: ${el.textContent.trim()}`); }
    for (const el of document.querySelectorAll('[role="alert"]')) if (vis(el) && el.textContent.trim()) out.push(`[role=alert]: ${el.textContent.trim()}`);
    const toast = document.getElementById("toast");
    if (vis(toast) && /\b(err|warn)\b/.test(toast.className) && toast.classList.contains("show")) out.push(`toast [${toast.className}] ${toast.textContent.trim()}`);
    return [...new Set([...out, ...(window.__smokeToasts || []).map(t => "toast " + t)])];
  });
  const assertClean = async (when) => {
    const b = await banners();
    if (b.length) throw new Error(`warning/error banner ${when}: ${b.join(" ‖ ")}`);
    if (pageErrors.length) throw new Error(`uncaught page error ${when}: ${pageErrors.join(" ‖ ")}`);
    if (consoleErrors.length) throw new Error(`console error ${when}: ${consoleErrors.join(" ‖ ")}`);
  };
  const assertBuild = async (when) => {
    const b = await page.evaluate(() => document.querySelector('meta[name="nanoodle-build"]')?.content ?? "(no nanoodle-build meta)");
    if (sha7 && b !== sha7) throw new Error(`page build ${when} is "${b}", expected "${sha7}"`);
    return b;
  };
  const editorReady = async () => {
    await page.locator("#wstabs .wstab").first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2000); // let deferred storage/restore work surface its banners
  };

  await step("load editor (fresh context)", async () => {
    // Up to 3 tries: a single slow edge response shouldn't page anyone; 3 in a row should.
    let r, lastErr;
    for (let i = 0; i < 3 && !r; i++) { try { r = await page.goto(base + "/", { waitUntil: "domcontentloaded" }); } catch (e) { lastErr = e; console.log(`  (load attempt ${i + 1} failed: ${String(e.message).split("\n")[0]})`); } }
    if (!r) throw lastErr;
    if (!r.ok()) throw new Error(`HTTP ${r.status()}`);
    const b = await assertBuild("on load");
    await editorReady();
    await assertClean("on load");
    return `build "${b}", title "${await page.title()}"`;
  });

  const name = `smoke ${Date.now().toString(36)}`;
  await step("create + save workspace", async () => {
    const before = await page.locator("#wstabs .wstab").count();
    await page.locator("#wsadd").click();
    await page.locator('#wschooser button[data-ws="blank"]').click();
    // An untouched default tab is reused by Blank (by design), so the tab count may not grow.
    await page.locator("#wschooser").waitFor({ state: "hidden" });
    await page.locator("#wstabs .wstab.on").waitFor();
    await page.locator("#wstabs .wstab.on").press("F2");
    const inp = page.locator("#wstabs input.wsrename"); await inp.waitFor();
    await inp.fill(name); await inp.press("Enter");
    await page.waitForFunction(n => { try { return JSON.parse(localStorage.getItem("noodle_workspaces") || "{}").tabs?.some(t => t.name === n); } catch { return false; } }, name, { timeout: 10000 })
      .catch(async () => {
        const b = await banners().catch(() => []);
        throw new Error(`renamed workspace "${name}" never reached localStorage noodle_workspaces${b.length ? "; banner: " + b.join(" ‖ ") : ""}`);
      });
    await page.waitForTimeout(1500);
    await assertClean("after save");
    return `"${name}" saved (${await page.locator("#wstabs .wstab").count()} tab(s), was ${before})`;
  });

  await step("reload → same build, workspace persisted", async () => {
    const r = await page.reload({ waitUntil: "domcontentloaded" });
    if (r && !r.ok()) throw new Error(`HTTP ${r.status()} on reload`);
    const b = await assertBuild("after reload");
    await editorReady();
    const names = await page.locator("#wstabs .wstab").allTextContents();
    if (!names.some(n => n.includes(name))) throw new Error(`"${name}" missing after reload; tabs: ${JSON.stringify(names)}`);
    await assertClean("after reload");
    return `build "${b}"; tabs: ${names.map(s => s.replace(/\s*×\s*$/, "").trim()).join(", ")}`;
  });

  await step("📣 Updates shows real update cards", async () => {
    await page.locator("#updates").click();
    await page.locator("#updatesmodal").waitFor({ state: "visible" });
    // Loading… and empty states render as #updatesempty with no .update-date or .update-items li,
    // so they can never satisfy this: it needs a dated heading AND a non-empty update item.
    await page.waitForFunction(() => {
      const dates = [...document.querySelectorAll("#updateslist .update-date")].filter(d => /\d{4}-\d{2}-\d{2}/.test(d.textContent));
      const items = [...document.querySelectorAll("#updateslist .update-items > li")].filter(li => li.textContent.trim().length > 3);
      return dates.length > 0 && items.length > 0;
    }, null, { timeout: 20000 }).catch(async () => {
      const st = await page.evaluate(() => (document.getElementById("updateslist")?.innerText || "").trim().slice(0, 160)).catch(() => "?");
      throw new Error(`no real update cards (dated heading + item) within 20s; panel shows: ${JSON.stringify(st)}`);
    });
    const info = await page.evaluate(() => ({
      dates: document.querySelectorAll("#updateslist .update-date").length,
      items: document.querySelectorAll("#updateslist .update-items > li").length,
      first: document.querySelector("#updateslist .update-date")?.textContent.trim(),
    }));
    await assertClean("with Updates open");
    return `${info.items} items under ${info.dates} dates, newest ${info.first}`;
  });
  ok = true;
} catch (e) {
  if (page && artifacts) {
    await mkdir(artifacts, { recursive: true }).catch(() => {});
    await page.screenshot({ path: resolve(artifacts, "failure.png"), fullPage: true, timeout: 15000 }).catch(() => {});
    await writeFile(resolve(artifacts, "log.txt"), [`console errors:`, ...consoleErrors, ``, `page errors:`, ...pageErrors, ``, `allowed noise:`, ...ignored].join("\n")).catch(() => {});
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  await summary(ok, ignored.length ? `Allowed console noise (${ignored.length}, each an exact request this test aborted):\n${ignored.map(s => "- " + s.slice(0, 200)).join("\n")}` : "");
}
process.exit(ok ? 0 : 1);
