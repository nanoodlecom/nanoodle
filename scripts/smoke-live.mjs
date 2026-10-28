#!/usr/bin/env node
// Post-deploy smoke gate: a fresh headless browser against the LIVE site (or any base URL).
//   1. (optional) wait until /sw.js carries CACHE = "nanoodle-<sha7>" for the deployed commit
//   2. load the editor; fail on any warning/error banner or toast, and on any console error
//   3. open a new workspace, rename it (which saves it), reload, confirm it persisted
//   4. open 📣 Updates and confirm at least one entry renders
// Makes NO paid or generation calls and uses no API keys: every request to a provider API
// host is aborted before it leaves the browser, and nothing is ever run.
//
// Env:
//   NANOODLE_SMOKE_URL        base URL (default https://nanoodle.com)
//   NANOODLE_SMOKE_SHA        commit to wait for in sw.js (skip the wait when unset)
//   NANOODLE_SMOKE_WAIT_S     max seconds to wait for the deploy (default 900)
//   NANOODLE_PLAYWRIGHT       path to playwright/index.mjs (dev tooling lives outside the site)
//   NANOODLE_SMOKE_ARTIFACTS  where to drop a failure screenshot + log
//   GITHUB_STEP_SUMMARY       (set by Actions) the result table is appended here
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const base = (process.env.NANOODLE_SMOKE_URL || "https://nanoodle.com").replace(/\/+$/, "");
const sha = (process.env.NANOODLE_SMOKE_SHA || "").trim();
const waitS = Number(process.env.NANOODLE_SMOKE_WAIT_S || 900);
const artifacts = process.env.NANOODLE_SMOKE_ARTIFACTS;
const mod = process.env.NANOODLE_PLAYWRIGHT;
const { chromium } = await import(mod ? pathToFileURL(resolve(mod)).href : "playwright");

// Console noise that is clearly not an app bug. Keep this list SHORT and explain every entry.
const BENIGN_CONSOLE = [
  // We abort provider/API requests on purpose (no paid calls, no keys); Chromium logs each one as
  // "Failed to load resource: net::ERR_FAILED". Only allowed when the failing URL is a blocked host,
  // so a broken same-origin asset still fails the gate.
  { test: (text, url) => /Failed to load resource/i.test(text) && BLOCKED_HOSTS.test(hostOf(url)), why: "provider request this test aborts on purpose" },
];
const hostOf = u => { try { return new URL(u).hostname; } catch { return ""; } };
// Hosts that could cost money or need a key. Everything to them is aborted, EXCEPT the public,
// keyless, free model-catalog GETs (/api/v1/*models) the editor reads on load, so the editor
// renders the way a real first visitor sees it. No generation endpoint is ever reachable.
const BLOCKED_HOSTS = /(^|\.)(nano-gpt\.com|runware\.ai|openai\.com|anthropic\.com|fal\.(ai|run)|replicate\.com)$/i;

const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ name, ok: true, note: note || "", ms: Date.now() - t0 }); console.log(`✓ ${name}${note ? " — " + note : ""}`); }
  catch (e) { results.push({ name, ok: false, note: String(e && e.message || e), ms: Date.now() - t0 }); console.log(`✗ ${name} — ${e && e.message || e}`); throw e; }
};

async function summary(ok, extra = "") {
  const lines = [`## Post-deploy smoke: ${ok ? "✅ passed" : "❌ FAILED"}`, "", `Target: ${base}${sha ? `  ·  commit \`${sha.slice(0, 7)}\`` : ""}`, "",
    "| step | result | detail |", "|---|---|---|",
    ...results.map(r => `| ${r.name} | ${r.ok ? "✅" : "❌"} | ${r.note.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 400)} |`)];
  if (extra) lines.push("", extra);
  const md = lines.join("\n") + "\n";
  console.log("\n" + md);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md);
}

const consoleErrors = [], ignored = [], pageErrors = [];
let browser, page, ok = false;
try {
  if (sha) await step(`deploy live (sw.js CACHE = "nanoodle-${sha.slice(0, 7)}")`, async () => {
    const want = `const CACHE = "nanoodle-${sha.slice(0, 7)}"`;
    const t0 = Date.now(), until = t0 + waitS * 1000; let last = "";
    while (Date.now() < until) {
      try {
        const r = await fetch(`${base}/sw.js?smoke=${Date.now()}`, { cache: "no-store", headers: { "cache-control": "no-cache" } });
        const txt = await r.text(); last = (txt.match(/const CACHE = "[^"]*"/) || ["(no CACHE line)"])[0];
        if (txt.includes(want)) return `seen after ${Math.round((Date.now() - t0) / 1000)}s`;
      } catch (e) { last = String(e.message || e); }
      await new Promise(r => setTimeout(r, 15000));
    }
    throw new Error(`timed out after ${waitS}s; live sw.js still has ${last}`);
  });

  browser = await chromium.launch();
  const context = await browser.newContext(); // fresh: no storage, no cookies, no service worker
  await context.route("**/*", route => {
    let host = ""; try { host = new URL(route.request().url()).hostname; } catch {}
    const req = route.request(), path = (() => { try { return new URL(req.url()).pathname; } catch { return ""; } })();
    const freeCatalog = req.method() === "GET" && /^\/api\/v1\/[a-z0-9-]*models$/.test(path) && !req.headers()["authorization"];
    return BLOCKED_HOSTS.test(host) && !freeCatalog ? route.abort() : route.continue();
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
    const text = m.text(), url = (m.location() || {}).url || ""; const b = BENIGN_CONSOLE.find(x => x.test(text, url));
    (b ? ignored : consoleErrors).push(b ? `${text} ${url} (allowed: ${b.why})` : `${text}${url ? " @ " + url : ""}`);
  });
  page.on("pageerror", e => pageErrors.push(String(e && e.stack || e)));
  // The editor's beforeunload guard must be accepted or reload() never navigates; anything else is dismissed.
  page.on("dialog", d => (d.type() === "beforeunload" ? d.accept() : d.dismiss()).catch(() => {}));

  const banners = async () => page.evaluate(() => {
    // offsetParent is null for position:fixed banners, so use checkVisibility / client rects instead.
    const vis = el => !!el && !el.hidden && (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : el.getClientRects().length > 0);
    const out = [];
    for (const id of ["wspersistence", "appblock"]) { const el = document.getElementById(id); if (vis(el)) out.push(`#${id}: ${el.textContent.trim()}`); }
    for (const el of document.querySelectorAll('[role="alert"]')) if (vis(el) && el.textContent.trim()) out.push(`[role=alert]: ${el.textContent.trim()}`);
    for (const el of document.querySelectorAll("body *")) {
      if (el.children.length || !vis(el)) continue;
      if (/Couldn[’']t store workspaces/i.test(el.textContent)) out.push(`text: ${el.textContent.trim()}`);
    }
    return [...new Set([...out, ...(window.__smokeToasts || []).map(t => "toast " + t)])];
  });
  const assertClean = async (when) => {
    const b = await banners();
    if (b.length) throw new Error(`warning/error banner ${when}: ${b.join(" ‖ ")}`);
    if (pageErrors.length) throw new Error(`uncaught page error ${when}: ${pageErrors.join(" ‖ ")}`);
    if (consoleErrors.length) throw new Error(`console error ${when}: ${consoleErrors.join(" ‖ ")}`);
  };

  await page.waitForTimeout(0);
  await step("load editor (fresh context)", async () => {
    // Up to 3 tries: a single slow edge response shouldn't page anyone; 3 in a row should.
    let r, lastErr;
    for (let i = 0; i < 3 && !r; i++) { try { r = await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 60000 }); } catch (e) { lastErr = e; console.log(`  (load attempt ${i + 1} failed: ${String(e.message).split("\n")[0]})`); } }
    if (!r) throw lastErr;
    if (!r || !r.ok()) throw new Error(`HTTP ${r && r.status()}`);
    await page.locator("#wstabs .wstab").first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2000); // let deferred storage/restore work surface its banners
    await assertClean("on load");
    return `title "${await page.title()}"`;
  });

  const name = `smoke ${Date.now().toString(36)}`;
  await step("create + save workspace", async () => {
    const before = await page.locator("#wstabs .wstab").count();
    await page.locator("#wsadd").click();
    await page.locator('#wschooser button[data-ws="blank"]').click();
    // An untouched default tab is reused by Blank (by design), so the tab count may not grow.
    await page.locator("#wschooser").waitFor({ state: "hidden", timeout: 10000 });
    await page.locator("#wstabs .wstab.on").waitFor({ timeout: 10000 });
    await page.locator("#wstabs .wstab.on").press("F2");
    const inp = page.locator("#wstabs input.wsrename"); await inp.waitFor({ timeout: 5000 });
    await inp.fill(name); await inp.press("Enter");
    await page.waitForFunction(n => { try { return JSON.parse(localStorage.getItem("noodle_workspaces") || "{}").tabs?.some(t => t.name === n); } catch { return false; } }, name, { timeout: 10000 }).catch(async () => {
      const b = await banners().catch(() => []);
      throw new Error(`renamed workspace "${name}" never reached localStorage noodle_workspaces${b.length ? "; banner: " + b.join(" ‖ ") : ""}`);
    });
    await page.waitForTimeout(1500);
    await assertClean("after save");
    return `"${name}" saved (${await page.locator("#wstabs .wstab").count()} tab(s), was ${before})`;
  });

  await step("reload → workspace persisted", async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator("#wstabs .wstab").first().waitFor({ timeout: 20000 });
    const names = await page.locator("#wstabs .wstab").allTextContents();
    if (!names.some(n => n.includes(name))) throw new Error(`"${name}" missing after reload; tabs: ${JSON.stringify(names)}`);
    await page.waitForTimeout(1500);
    await assertClean("after reload");
    return `tabs: ${names.map(s => s.replace(/\s*×\s*$/, "").trim()).join(", ")}`;
  });

  await step("📣 Updates shows ≥1 entry", async () => {
    await page.locator("#updates").click();
    await page.locator("#updatesmodal").waitFor({ state: "visible", timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll("#updateslist > *").length > 0, null, { timeout: 15000 });
    const n = await page.locator("#updateslist > *").count();
    await assertClean("with Updates open");
    return `${n} entries`;
  });
  ok = true;
} catch (e) {
  if (page && artifacts) {
    await mkdir(artifacts, { recursive: true }).catch(() => {});
    await page.screenshot({ path: resolve(artifacts, "failure.png"), fullPage: true }).catch(() => {});
    await writeFile(resolve(artifacts, "log.txt"), [`console errors:`, ...consoleErrors, ``, `page errors:`, ...pageErrors, ``, `allowed noise:`, ...ignored].join("\n")).catch(() => {});
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  await summary(ok, ignored.length ? `Allowed console noise (${ignored.length}):\n${ignored.map(s => "- " + s.slice(0, 200)).join("\n")}` : "");
}
process.exit(ok ? 0 : 1);
