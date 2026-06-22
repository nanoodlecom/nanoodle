#!/usr/bin/env node
// Syntax-checks the inline JS inside our HTML files.
//
// Catches the class of bug where a stray backtick/brace inside a big
// String.raw template (e.g. RUNTIME_JS in play.html) silently terminates
// the literal and turns the rest of the file into a parse error.
//
// Usage:
//   node scripts/check-html-js.mjs [file.html ...]   # explicit files
//   node scripts/check-html-js.mjs                   # all tracked *.html
//
// Each inline <script> block (those without a src=) is extracted and run
// through `node --check`, with errors mapped back to real HTML line numbers.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

function htmlFiles(argv) {
  if (argv.length) return argv;
  // default: every tracked .html file at the repo root and below
  const out = execFileSync("git", ["ls-files", "*.html"], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

function checkBlock(code, file, startLine, tmp) {
  const f = join(tmp, "block.mjs");
  writeFileSync(f, code);
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
    return null;
  } catch (e) {
    const msg = (e.stderr || e.stdout || "").toString();
    // node reports `<tmp>/block.mjs:<n>` — remap to the real HTML file + line.
    return msg.replace(/\S*block\.mjs:(\d+)/g, (_, n) =>
      `${file}:${startLine + Number(n) - 1}`,
    );
  }
}

const tmp = mkdtempSync(join(tmpdir(), "htmljs-"));
let failed = 0;
try {
  for (const file of htmlFiles(process.argv.slice(2))) {
    const html = readFileSync(file, "utf8");
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      const [, attrs, code] = m;
      if (/\bsrc=/i.test(attrs)) continue; // external script, nothing inline to check
      const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
      // Only real JS is executable; a typed data block (e.g. application/ld+json) is not JS.
      if (type && !/^(module|text\/javascript|application\/javascript|text\/ecmascript|application\/ecmascript)$/i.test(type)) continue;
      const startLine = html.slice(0, m.index).split("\n").length;
      const err = checkBlock(code, file, startLine, tmp);
      if (err) {
        process.stderr.write(err.replace(/\n+$/, "") + "\n");
        failed++;
      }
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  process.stderr.write(`\n✗ ${failed} inline-script syntax error(s) found.\n`);
  process.exit(1);
}
process.stdout.write("✓ inline HTML JavaScript is syntactically valid.\n");
