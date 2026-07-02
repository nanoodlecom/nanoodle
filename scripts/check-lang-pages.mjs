#!/usr/bin/env node
// Guard for the per-language landing pages (offline, no network).
//
// The hreflang cluster is all-or-nothing: one missing or non-reciprocal entry makes
// Google ignore the WHOLE cluster, and a thin/stale localized page ranks poorly. This
// check keeps the set complete, mutual, and in lockstep with the generator:
//
//  1. Coverage: every non-en code in index.html's I18N_LANGS has a <code>/index.html,
//     the generator (gen-lang-pages.mjs) has a copy table for it, and there are no
//     orphan pages/tables for a language the app doesn't ship.
//  2. Reciprocity: index.html AND every landing page carry the COMPLETE cluster
//     (all languages + x-default), so every member points at every other — plus each
//     landing page is self-canonical (never canonical → /, which would de-index it).
//  3. No drift: regenerate all pages via gen-lang-pages.mjs into a temp dir and diff
//     against the committed files — the committed pages must byte-match the generator.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CLUSTER, PAGES } from "./gen-lang-pages.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const gen = path.join(root, "scripts", "gen-lang-pages.mjs");
let failed = 0;
const fail = (msg) => { console.error("✗ " + msg); failed++; };

// ---- parse the app's language list from index.html ------------------------
const indexSrc = fs.readFileSync(path.join(root, "index.html"), "utf8");
const langBlock = (indexSrc.match(/const I18N_LANGS\s*=\s*\[([\s\S]*?)\];/) || [])[1] || "";
const codes = [...langBlock.matchAll(/code:\s*"([a-z-]+)"/g)].map((m) => m[1]);
if (!codes.length) fail("could not parse I18N_LANGS from index.html");
if (codes[0] !== "en") fail(`expected 'en' first in I18N_LANGS, got '${codes[0]}'`);
const nonEn = codes.filter((c) => c !== "en");

// ---- the expected reciprocal cluster (from the generator, the source of truth) --
// Every page must carry a <link> for each app language + x-default, all pointing home for en.
const expectClusterCodes = [...codes, "x-default"];
const gotClusterCodes = CLUSTER.map((c) => c.hreflang);
for (const c of expectClusterCodes)
  if (!gotClusterCodes.includes(c)) fail(`generator CLUSTER is missing hreflang="${c}" — the cluster is incomplete`);
for (const c of gotClusterCodes)
  if (!expectClusterCodes.includes(c)) fail(`generator CLUSTER has stray hreflang="${c}" (not an app language)`);

const clusterLinks = CLUSTER.map((c) => `<link rel="alternate" hreflang="${c.hreflang}" href="${c.href}" />`);
const hasFullCluster = (html, where) => {
  for (const link of clusterLinks) if (!html.includes(link)) fail(`${where} is missing hreflang link: ${link}`);
};

// index.html (the en + x-default member) must reciprocate.
hasFullCluster(indexSrc, "index.html");

// ---- 1. coverage: pages/tables line up with the app's languages ----------
for (const code of nonEn) {
  if (!PAGES[code]) fail(`no copy table in gen-lang-pages.mjs for language '${code}' (in I18N_LANGS)`);
  if (!fs.existsSync(path.join(root, code, "index.html"))) fail(`missing landing page ${code}/index.html for I18N_LANGS language '${code}'`);
}
for (const code of Object.keys(PAGES))
  if (!nonEn.includes(code)) fail(`gen-lang-pages.mjs has a copy table for '${code}', which is not in index.html's I18N_LANGS`);

// ---- 2. per-page cluster + self-canonical --------------------------------
for (const code of nonEn) {
  const file = path.join(root, code, "index.html");
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, "utf8");
  hasFullCluster(html, `${code}/index.html`);
  const canon = `<link rel="canonical" href="https://nanoodle.com/${code}/" />`;
  if (!html.includes(canon)) fail(`${code}/index.html must be self-canonical (${canon})`);
  if (!new RegExp(`<html lang="${code}"`).test(html)) fail(`${code}/index.html must declare <html lang="${code}">`);
}

// ---- 3. no drift: committed pages must byte-match the generator -----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nanoodle-lang-"));
try {
  execFileSync("node", [gen, tmp], { stdio: "pipe" });
  for (const code of Object.keys(PAGES)) {
    const genFile = path.join(tmp, code, "index.html");
    const repoFile = path.join(root, code, "index.html");
    if (!fs.existsSync(repoFile)) continue; // already reported above
    const a = fs.readFileSync(genFile, "utf8");
    const b = fs.readFileSync(repoFile, "utf8");
    if (a !== b) fail(`${code}/index.html is out of sync with gen-lang-pages.mjs — run: node scripts/gen-lang-pages.mjs`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) { console.error(`\ncheck-lang-pages: ${failed} problem(s).`); process.exit(1); }
console.log(`✓ check-lang-pages: ${nonEn.length} landing pages, hreflang cluster complete & reciprocal, no drift.`);
