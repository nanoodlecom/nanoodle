#!/usr/bin/env node
// Deploy-config guard (offline, no network). Pins the boring-but-fatal files that every
// OTHER check passes AROUND rather than THROUGH: _headers, _redirects, sw.js, sitemap.xml,
// robots.txt, site.webmanifest. These aren't parsed by index.html/play.html, so a wrong
// value here ships silently and only shows up as "the whole app is blocked / stale / 404".
//
// History that motivated this: PR #81 shipped shortener origins that check-policy.mjs
// happily passed, but the DEPLOYED _headers connect-src still blocked them at runtime — a
// gap nothing guarded. And scripts/stamp-sw.mjs silently no-ops if it can't find the CACHE
// line, pinning every user to a stale offline shell forever.
//
// Invariants (all pure text parsing + file-existence; runs from a relocatable sandbox copy):
//   1. _headers CSP: one CSP line per HTML route (Cloudflare COMBINES duplicates by
//      intersection — two lines is a silent tighten trap); editor connect-src has self +
//      nano-gpt; /play(.html) connect-src has the shortener hosts named in check-policy.mjs;
//      landing pages stay default-src 'none'; and a golden DRIFT SNAPSHOT so any CSP change
//      is a deliberate, reviewed act (update the golden on purpose) not a silent one.
//   2. sw.js: exactly one line matches stamp-sw.mjs's own CACHE regex (so the stamp can't
//      no-op), and every SHELL[] precache path resolves to a file on disk.
//   3. _redirects: /app and /editor rewrite to /index.html with status 200.
//   4. site.webmanifest is valid JSON with all icon srcs on disk; robots Sitemap host ===
//      sitemap <loc> host === index.html rel=canonical host.
//   5. sitemap.xml has a <loc> for every non-en language dir (parsed from I18N_LANGS the way
//      check-lang-pages.mjs does) + /, /play, /legal — and no <loc> for a missing language.
//
// To intentionally change a CSP: edit _headers, then run
//   GOLDEN_UPDATE=1 node scripts/check-deploy-config.mjs
// and commit the regenerated golden alongside.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GOLDEN = path.join(ROOT, "scripts", "fixtures", "deploy-headers-csp.golden.json");
const r = (p) => path.join(ROOT, p);
const read = (p) => readFileSync(r(p), "utf8");

const problems = [];
const fail = (msg) => problems.push(msg);

// ---------------------------------------------------------------------------
// _headers parsing: pattern block → { headerName: [values...] }
// A non-indented, non-comment line is a route pattern; indented "Name: value"
// lines belong to the current pattern. Cloudflare allows repeated header names,
// so values are arrays (that's exactly how we catch the double-CSP trap).
// ---------------------------------------------------------------------------
function parseHeaders(src) {
  const blocks = [];
  let cur = null;
  for (const raw of src.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^\s/.test(raw)) {
      // header line under the current pattern
      const m = line.trim().match(/^([^:]+):\s*(.*)$/);
      if (cur && m) (cur.headers[m[1]] ||= []).push(m[2]);
    } else {
      cur = { pattern: line.trim(), headers: {} };
      blocks.push(cur);
    }
  }
  return blocks;
}

// Canonicalize a CSP string so cosmetic reordering isn't "drift" but any real
// token/directive add or drop is: sort tokens within each directive, sort
// directives by name.
function canonCSP(csp) {
  return csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [name, ...tokens] = d.split(/\s+/);
      return name + (tokens.length ? " " + tokens.slice().sort().join(" ") : "");
    })
    .sort()
    .join("; ");
}

// Pull a named directive's token set out of a CSP string.
function directive(csp, name) {
  const m = csp.match(new RegExp("(?:^|;)\\s*" + name + "\\s+([^;]+)"));
  return m ? m[1].trim().split(/\s+/) : null;
}

// ---------------------------------------------------------------------------
// Cross-file constants, parsed (not imported — those files run side effects) so
// the two checks can never diverge from their source of truth.
// ---------------------------------------------------------------------------
function shortenerHosts() {
  const src = read("scripts/check-policy.mjs");
  const m = src.match(/const SHORTENER_HOSTS\s*=\s*\[([^\]]*)\]/);
  if (!m) { fail("could not parse SHORTENER_HOSTS from scripts/check-policy.mjs"); return []; }
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function cacheRegexFromStamp() {
  const src = read("scripts/stamp-sw.mjs");
  // The line: const next = src.replace(/const CACHE = "[^"]*";/, `...`);
  const m = src.match(/\.replace\(\s*(\/.+?\/)\s*,/);
  if (!m) { fail("could not extract the CACHE regex from scripts/stamp-sw.mjs (.replace(/.../,…))"); return null; }
  const body = m[1].slice(1, -1); // strip the surrounding /…/
  return new RegExp(body);
}

function i18nNonEnLangs() {
  const src = read("index.html");
  const block = (src.match(/const I18N_LANGS\s*=\s*\[([\s\S]*?)\];/) || [])[1] || "";
  const codes = [...block.matchAll(/code:\s*"([a-z-]+)"/g)].map((m) => m[1]);
  if (!codes.length) fail("could not parse I18N_LANGS from index.html");
  return codes.filter((c) => c !== "en");
}

// Map a route/precache path to a file on disk the way Cloudflare static assets
// resolves it: "/" and "/foo/" → index.html; "/foo" → foo or foo.html; a real
// filename stays as-is.
function resolveRoute(p) {
  let rel = p.replace(/^\//, "");
  const tries = [];
  if (rel === "" || rel.endsWith("/")) tries.push(rel + "index.html");
  else {
    tries.push(rel);
    if (!path.extname(rel)) tries.push(rel + ".html", rel + "/index.html");
  }
  return tries.some((t) => existsSync(r(t)));
}

// ===========================================================================
// 1. _headers CSP invariants + golden drift snapshot
// ===========================================================================
const headerBlocks = parseHeaders(read("_headers"));
const byPattern = Object.fromEntries(headerBlocks.map((b) => [b.pattern, b]));

// Every route that MUST ship an HTML CSP, and exactly one.
const CSP_ROUTES = ["/", "/index.html", "/app", "/editor", "/play", "/play.html",
  "/legal", "/legal.html", "/es/*", "/fr/*", "/de/*", "/pt/*", "/ja/*"];
const EDITOR_ROUTES = ["/", "/index.html", "/app", "/editor"];
const PLAY_ROUTES = ["/play", "/play.html"];
const LANDING_ROUTES = ["/es/*", "/fr/*", "/de/*", "/pt/*", "/ja/*"];

for (const route of CSP_ROUTES) {
  const b = byPattern[route];
  if (!b) { fail(`_headers is missing a block for route "${route}"`); continue; }
  const csps = b.headers["Content-Security-Policy"] || [];
  if (csps.length === 0) fail(`_headers "${route}" has no Content-Security-Policy line`);
  else if (csps.length > 1)
    fail(`_headers "${route}" has ${csps.length} Content-Security-Policy lines — Cloudflare combines duplicates by INTERSECTION (browser enforces the tightest); collapse to exactly one`);
}

// Any block anywhere with 2+ CSP lines is the trap, even routes not in CSP_ROUTES.
for (const b of headerBlocks) {
  const n = (b.headers["Content-Security-Policy"] || []).length;
  if (n > 1 && !CSP_ROUTES.includes(b.pattern))
    fail(`_headers "${b.pattern}" has ${n} Content-Security-Policy lines (should be at most one)`);
}

// The CROSS-BLOCK form of the same intersection trap: a wildcard pattern (e.g. /*)
// that ALSO matches another CSP-bearing route ships a SECOND CSP header on that
// route's requests, and Cloudflare enforces the intersection. Each block has one
// CSP line so the loops above pass, and the golden snapshot happily absorbs the
// extra pattern as "just another route" (surviving even a GOLDEN_UPDATE regen) —
// yet at runtime every per-route CSP silently collapses to the intersection with
// the wildcard. So no wildcard pattern may carry a CSP if it also matches another
// CSP-bearing pattern. (Per-language /es/* etc. are fine: each matches only itself.)
const cspBlocks = headerBlocks.filter((b) => (b.headers["Content-Security-Policy"] || []).length >= 1);
const wildMatches = (pat, route) => {
  const star = pat.indexOf("*");
  return star >= 0 && route !== pat && route.startsWith(pat.slice(0, star));
};
for (const wild of cspBlocks) {
  const covered = cspBlocks.filter((o) => wildMatches(wild.pattern, o.pattern)).map((o) => o.pattern);
  if (covered.length)
    fail(`_headers wildcard "${wild.pattern}" carries a Content-Security-Policy but ALSO matches other CSP routes [${covered.join(", ")}] — Cloudflare ships both headers and enforces their INTERSECTION, silently tightening every one. Keep the CSP only on the specific routes and drop it from "${wild.pattern}".`);
}

const cspOf = (route) => (byPattern[route]?.headers["Content-Security-Policy"] || [])[0] || "";

// Editor connect-src must reach self + the nano-gpt API.
for (const route of EDITOR_ROUTES) {
  const cs = directive(cspOf(route), "connect-src") || [];
  for (const need of ["'self'", "https://nano-gpt.com"])
    if (!cs.includes(need)) fail(`_headers "${route}" connect-src is missing ${need} (editor must reach the nano-gpt API)`);
}

// /play(.html) connect-src must include every shortener host check-policy.mjs allows.
const SHORTENERS = shortenerHosts();
for (const route of PLAY_ROUTES) {
  const cs = directive(cspOf(route), "connect-src") || [];
  for (const host of SHORTENERS) {
    const token = "https://" + host;
    if (!cs.includes(token))
      fail(`_headers "${route}" connect-src is missing ${token} — check-policy.mjs allows it as a shortener sink but the deployed CSP would block it (the PR #81 class)`);
  }
}

// Landing pages stay locked down: default-src 'none', and no external connect.
for (const route of LANDING_ROUTES) {
  const csp = cspOf(route);
  const def = directive(csp, "default-src") || [];
  if (!(def.length === 1 && def[0] === "'none'"))
    fail(`_headers "${route}" must keep default-src 'none' (static landing page, zero network) — got [${def.join(" ")}]`);
  if (directive(csp, "connect-src"))
    fail(`_headers "${route}" must not declare connect-src (static landing page makes no network calls)`);
}

// Golden drift snapshot: canonical CSP for every CSP-bearing route.
const snapshot = {};
for (const b of headerBlocks) {
  const csps = b.headers["Content-Security-Policy"] || [];
  if (csps.length === 1) snapshot[b.pattern] = canonCSP(csps[0]);
}
if (process.env.GOLDEN_UPDATE) {
  writeFileSync(GOLDEN, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`✓ wrote golden snapshot (${Object.keys(snapshot).length} routes) → ${path.relative(ROOT, GOLDEN)}`);
  process.exit(0);
}
if (!existsSync(GOLDEN)) {
  fail(`golden snapshot missing (${path.relative(ROOT, GOLDEN)}) — run: GOLDEN_UPDATE=1 node scripts/check-deploy-config.mjs`);
} else {
  const golden = JSON.parse(read(path.relative(ROOT, GOLDEN)));
  const routes = new Set([...Object.keys(golden), ...Object.keys(snapshot)]);
  for (const route of routes) {
    if (!(route in golden)) fail(`CSP for "${route}" is new — update the golden deliberately if intended (GOLDEN_UPDATE=1)`);
    else if (!(route in snapshot)) fail(`CSP for "${route}" was removed — update the golden deliberately if intended (GOLDEN_UPDATE=1)`);
    else if (golden[route] !== snapshot[route])
      fail(`CSP for "${route}" changed:\n      was: ${golden[route]}\n      now: ${snapshot[route]}\n      — update scripts/fixtures/${path.basename(GOLDEN)} deliberately if intended (GOLDEN_UPDATE=1)`);
  }
}

// ===========================================================================
// 2. sw.js CACHE stamp + SHELL precache paths
// ===========================================================================
const swSrc = read("sw.js");
const cacheRe = cacheRegexFromStamp();
if (cacheRe) {
  const hits = swSrc.split("\n").filter((l) => cacheRe.test(l)).length;
  if (hits !== 1)
    fail(`sw.js has ${hits} lines matching stamp-sw.mjs's CACHE regex ${cacheRe} (need exactly 1, or the deploy cache-stamp silently no-ops and pins users to a stale offline shell)`);
}
const shellBlock = (swSrc.match(/const SHELL\s*=\s*\[([\s\S]*?)\]/) || [])[1] || "";
const shellPaths = [...shellBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
if (!shellPaths.length) fail("could not parse SHELL[] from sw.js");
for (const p of shellPaths)
  if (!resolveRoute(p)) fail(`sw.js SHELL precache path "${p}" resolves to no file on disk — install would fail to cache it`);

// ===========================================================================
// 3. _redirects: /app + /editor → /index.html 200
// ===========================================================================
const redirects = read("_redirects");
for (const from of ["/app", "/editor"]) {
  const rx = new RegExp("^\\s*" + from.replace("/", "\\/") + "\\s+\\/index\\.html\\s+200\\b", "m");
  if (!rx.test(redirects)) fail(`_redirects is missing the "${from} /index.html 200" rewrite (sw.js routing + deep links depend on it)`);
}

// ===========================================================================
// 4. webmanifest icons + host agreement (robots ↔ sitemap ↔ canonical)
// ===========================================================================
let manifest;
try { manifest = JSON.parse(read("site.webmanifest")); }
catch (e) { fail(`site.webmanifest is not valid JSON: ${(e && e.message) || e}`); }
if (manifest) {
  for (const icon of manifest.icons || []) {
    const src = (icon.src || "").replace(/^\//, "");
    if (!src || !existsSync(r(src))) fail(`site.webmanifest icon src "${icon.src}" not found on disk`);
  }
}

const hostOf = (url) => { try { return new URL(url).host; } catch { return null; } };
const canonHost = hostOf((read("index.html").match(/<link\s+rel="canonical"\s+href="([^"]+)"/) || [])[1] || "");
const robotsHost = hostOf((read("robots.txt").match(/^\s*Sitemap:\s*(\S+)/m) || [])[1] || "");
const sitemapSrc = read("sitemap.xml");
const firstLoc = (sitemapSrc.match(/<loc>([^<]+)<\/loc>/) || [])[1] || "";
const sitemapHost = hostOf(firstLoc);
if (!canonHost) fail("could not read rel=canonical host from index.html");
if (canonHost && robotsHost && robotsHost !== canonHost)
  fail(`robots.txt Sitemap host "${robotsHost}" != index.html canonical host "${canonHost}"`);
if (canonHost && sitemapHost && sitemapHost !== canonHost)
  fail(`sitemap.xml <loc> host "${sitemapHost}" != index.html canonical host "${canonHost}"`);

// ===========================================================================
// 5. sitemap.xml ↔ languages
// ===========================================================================
const locs = [...sitemapSrc.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const locPaths = new Set(locs.map((u) => { try { return new URL(u).pathname; } catch { return u; } }));
const nonEn = i18nNonEnLangs();
for (const base of ["/", "/play", "/legal"])
  if (!locPaths.has(base)) fail(`sitemap.xml is missing a <loc> for "${base}"`);
for (const code of nonEn)
  if (!locPaths.has(`/${code}/`)) fail(`sitemap.xml is missing a <loc> for language "/${code}/"`);
// No <loc> pointing at a language dir that doesn't exist.
for (const p of locPaths) {
  const m = p.match(/^\/([a-z]{2})\/$/);
  if (m && !nonEn.includes(m[1]))
    fail(`sitemap.xml has a <loc> for "/${m[1]}/" but there is no such language in index.html's I18N_LANGS`);
}

// ---------------------------------------------------------------------------
if (problems.length) {
  process.stderr.write("✗ check-deploy-config: " + problems.length + " problem(s):\n\n- " + problems.join("\n- ") + "\n");
  process.exit(1);
}
console.log(`✓ check-deploy-config: _headers CSP (${Object.keys(snapshot).length} routes, no drift), sw.js stamp + ${shellPaths.length} shell paths, _redirects, manifest/host/sitemap all consistent.`);
