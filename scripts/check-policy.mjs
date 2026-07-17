#!/usr/bin/env node
// Static policy checks over our HTML — cheap greps that enforce two promises:
//
//   1. No third-party origins. The privacy policy promises zero analytics and
//      self-hosted assets, so the only external host a page may LOAD from or
//      CONNECT to is the nano-gpt API. Everything else must be same-origin /
//      relative (fonts, icons, styles are vendored under /vendor, /favicon…).
//      This is the check that would have caught the Google Fonts dependency
//      before it had to be self-hosted by hand.
//
//   2. No CSP-unsafe constructs. The app ships under a CSP that allows inline
//      <script> but NOT eval — so eval()/new Function()/string-timer calls are
//      valid JS that silently die at runtime. node --check can't see that;
//      this can.
//
// Usage:
//   node scripts/check-policy.mjs [file.html ...]   # explicit files
//   node scripts/check-policy.mjs                   # all tracked *.html

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// The ONLY external origin any page may load or connect to. Subdomains allowed.
const ALLOWED_HOSTS = ["nano-gpt.com"];

// NOTE: the Share popover's opt-in "shorten" button used to be the one allowed
// third-party fetch sink (tinyurl.com, da.gd). It now calls our own nanolink
// worker (NANOLINK_ORIGIN, a first-party Cloudflare Worker + KV), so there is
// no shortener exception anymore — every literal third-party connection sink
// is a violation again.

function htmlFiles(argv) {
  if (argv.length) return argv;
  return execFileSync("git", ["ls-files", "*.html"], { encoding: "utf8" }).split("\n").filter(Boolean);
}

const lineAt = (s, i) => s.slice(0, i).split("\n").length;

// A URL is "external & disallowed" only if it names a host that isn't on the
// allowlist. Relative, root-relative, data:, blob:, hash and mailto stay local.
function disallowedHost(url) {
  const u = url.trim();
  if (!u || u.startsWith("#") || u.startsWith("/") && !u.startsWith("//")) return null; // relative / root-relative
  if (/^(data|blob|mailto|tel):/i.test(u)) return null;
  const m = u.match(/^(?:https?:)?\/\/([^/:?#]+)/i);
  if (!m) return null; // not an absolute URL → relative, same-origin
  const host = m[1].toLowerCase();
  const ok = ALLOWED_HOSTS.some((h) => host === h || host.endsWith("." + h));
  return ok ? null : host;
}

// Each rule: a regex whose capture group 1 is the thing to test, plus a tester
// that returns a violation message (or null). Line numbers map back to the file.
function scan(file, html, out) {
  const add = (i, msg) => out.push(`${file}:${lineAt(html, i)}: ${msg}`);

  // <link> only loads/connects for these rels. canonical/alternate/author/etc.
  // are metadata (the browser never fetches them) — flagging them third-party
  // would wrongly trip on a canonical URL pointing at our own deploy origin.
  const FETCHING_REL = /\b(?:stylesheet|icon|shortcut|apple-touch-icon(?:-precomposed)?|mask-icon|manifest|preload|modulepreload|prefetch|prerender|preconnect|dns-prefetch|fetch)\b/i;
  let lm;
  const linkRe = /<link\b[^>]*>/gi;
  while ((lm = linkRe.exec(html))) {
    const tag = lm[0];
    if (!FETCHING_REL.test((tag.match(/\brel\s*=\s*["']([^"']*)["']/i) || [, ""])[1])) continue;
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    const host = href && disallowedHost(href);
    if (host) add(lm.index, `<link> loads/connects to third-party origin "${host}" — self-host it (only ${ALLOWED_HOSTS.join(", ")} is allowed)`);
  }

  const resource = [
    { re: /<(?:script|img|iframe|source|audio|video|embed|track|input|object)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi, what: "<… src>" },
    { re: /@import\s+(?:url\(\s*)?["']([^"']+)["']/gi, what: "CSS @import" },
    { re: /\burl\(\s*["']?((?:https?:)?\/\/[^"')]+)["']?\s*\)/gi, what: "CSS url()" },
  ];
  for (const { re, what } of resource) {
    let m;
    while ((m = re.exec(html))) {
      const host = disallowedHost(m[1]);
      if (host) add(m.index, `loads ${what} from third-party origin "${host}" — self-host it (only ${ALLOWED_HOSTS.join(", ")} is allowed)`);
    }
  }

  // Connection sinks pointed at a literal third-party URL → an analytics beacon
  // or remote API. (nano-gpt traffic uses a variable, so it never matches here.)
  const sink = /\b(?:fetch|EventSource|WebSocket|sendBeacon|importScripts)\s*\(\s*["']((?:https?:)?\/\/[^"']+)["']/gi;
  let s;
  while ((s = sink.exec(html))) {
    const host = disallowedHost(s[1]);
    if (host) add(s.index, `connects to third-party origin "${host}" — only ${ALLOWED_HOSTS.join(", ")} is allowed`);
  }

  // CSP-unsafe: eval / new Function / string-argument timers (all blocked by CSP).
  const csp = [
    { re: /\beval\s*\(/g, what: "eval()" },
    { re: /\bnew\s+Function\s*\(/g, what: "new Function()" },
    { re: /\b(?:setTimeout|setInterval)\s*\(\s*["'`]/g, what: "string-argument timer" },
  ];
  for (const { re, what } of csp) {
    let m;
    while ((m = re.exec(html))) add(m.index, `uses ${what} — blocked by CSP, will silently fail at runtime`);
  }
}

const out = [];
for (const file of htmlFiles(process.argv.slice(2))) scan(file, readFileSync(file, "utf8"), out);

if (out.length) {
  process.stderr.write("✗ policy violations:\n\n- " + out.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ no third-party origins or CSP-unsafe constructs.\n");
