#!/usr/bin/env node
// Generator for llms-full.txt (offline except for two shallow git clones).
//
// llms.txt is the index; llms-full.txt is the expanded single-file reference
// that llmstxt.org suggests for crawlers/LLMs that want everything in one
// fetch. Nothing in it is hand-written: every section is copied or extracted
// verbatim from a source file, so the output can never say something the
// sources don't:
//
//   - the main README.md (full, minus images, relative links absolutized)
//   - a node-type catalog parsed out of index.html's NODE_TYPES registry
//     (key + emoji + title + one-line desc, exactly as the editor shows them)
//   - curated sections of the nanoodle-js and nanoodle-py READMEs
//     (intro, At a glance, Install, quickstarts, Supported nodes)
//
// The two library repos are shallow-cloned into .tmp-libs/ (gitignored). Every
// run re-fetches that clone and hard-resets it to the remote default branch: a
// reused cache is how a regeneration silently reproduces last month's library
// README. Set NANOODLE_JS / NANOODLE_PY to a local checkout to read that
// instead of cloning (CI does this, so its check needs no network).
//
// Run:  node scripts/gen-llms-full.mjs             writes llms-full.txt at the repo root
//       node scripts/gen-llms-full.mjs --check     regenerates and diffs, writes nothing
//       node scripts/gen-llms-full.mjs --offline   reuses the cache as-is, no fetch
//
// scripts/check-llms-full.mjs is the offline guard the pre-commit hook runs: it
// verifies the sections that come from files in THIS repo. The library sections
// need the sibling repos, so CI covers those.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = path.join(root, ".tmp-libs");
export const OUT_PATH = path.join(root, "llms-full.txt");

export const LIBS = [
  { repo: "nanoodle-js", lang: "JavaScript / Node.js", install: "npm install nanoodle", env: "NANOODLE_JS",
    sections: ["At a glance", "Install", "Quickstart (library)", "Quickstart (CLI)", "Supported nodes"] },
  { repo: "nanoodle-py", lang: "Python", install: "pip install nanoodle", env: "NANOODLE_PY",
    sections: ["At a glance", "Install", "Quickstart (library)", "CLI", "Supported nodes"] },
];

// Where to read a library README from. A local checkout wins (CI points these at
// freshly checked-out siblings); otherwise the .tmp-libs clone, always refreshed.
export function libSource(lib, { offline = false } = {}) {
  const local = process.env[lib.env];
  if (local) {
    if (!fs.existsSync(path.join(local, "README.md"))) {
      throw new Error(`${lib.env}=${local} has no README.md`);
    }
    return local;
  }
  return clone(lib.repo, { offline });
}

const git = (args) => execFileSync("git", args, { stdio: ["ignore", "ignore", "inherit"] });

function clone(repo, { offline = false } = {}) {
  const dest = path.join(TMP, repo);
  const url = `https://github.com/nanoodlecom/${repo}.git`;
  if (fs.existsSync(path.join(dest, ".git"))) {
    if (offline) {
      console.warn(`⚠ --offline: reusing ${path.relative(root, dest)} without a fetch — it may be stale`);
      return dest;
    }
    // Refresh in place. Never trust the cache: a stale README here is invisible
    // in the output, and that is exactly how llms-full.txt went stale before.
    try {
      git(["-C", dest, "fetch", "--depth", "1", "origin", "HEAD"]);
      git(["-C", dest, "reset", "--hard", "FETCH_HEAD"]);
      git(["-C", dest, "clean", "-fdx"]);
      return dest;
    } catch (e) {
      throw new Error(
        `could not refresh the cached clone at ${path.relative(root, dest)} (${e.message.trim()}). ` +
        `Delete .tmp-libs/ and retry, set ${repo === "nanoodle-js" ? "NANOODLE_JS" : "NANOODLE_PY"} ` +
        `to a local checkout, or pass --offline to accept the cache as-is.`);
    }
  }
  if (offline) {
    throw new Error(`--offline: no clone at ${path.relative(root, dest)} and nothing to reuse`);
  }
  fs.mkdirSync(TMP, { recursive: true });
  git(["clone", "--depth", "1", url, dest]);
  return dest;
}

// --- markdown helpers (fence-aware: never touch lines inside ``` blocks) ---

function mapOutsideFences(md, fn) {
  let inFence = false;
  return md.split("\n").map((line) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return line; }
    return inFence ? line : fn(line);
  }).filter((l) => l !== null).join("\n");
}

// Demote headings one level, drop images, absolutize relative links.
function embed(md, repoUrl) {
  return mapOutsideFences(md, (line) => {
    if (/^!\[/.test(line)) return null;                       // images: useless in a text file
    if (/^#/.test(line)) line = "#" + line;                    // ## -> ###
    // [text](relative) -> [text](https://github.com/.../blob/main/relative)
    return line.replace(/(!?)\[([^\]]*)\]\((?!https?:\/\/|#|mailto:)([^)]+)\)/g,
      (m, bang, txt, href) => bang ? m : `[${txt}](${repoUrl}/blob/main/${href})`);
  }).replace(/\n{3,}/g, "\n\n").trim();
}

// Return "## <title>" section including its heading, up to the next "## ".
function section(md, title) {
  const lines = md.split("\n");
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startRe = new RegExp(`^## ${esc}\\s*$`);
  const start = lines.findIndex((l) => startRe.test(l));
  if (start < 0) throw new Error(`section "## ${title}" not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join("\n").trim();
}

// Everything between the H1 and the first H2 (the README's intro paragraphs).
function intro(md) {
  const lines = md.split("\n");
  const h1 = lines.findIndex((l) => /^# /.test(l));
  let end = lines.length;
  for (let i = h1 + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  return lines.slice(h1 + 1, end).join("\n").trim();
}

// --- node catalog: parse index.html's NODE_TYPES registry ---

function nodeCatalog() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const start = html.indexOf("const NODE_TYPES = {");
  if (start < 0) throw new Error("NODE_TYPES not found in index.html");
  const end = html.indexOf("\n};", start);
  const block = html.slice(start, end);
  const keys = [...block.matchAll(/^ {2}([a-z]+): \{/gm)].map((m) => m[1]);
  const re = /^ {2}([a-z]+): \{\s*\n\s*em:"([^"]*)", title:"([^"]*)", desc:"([^"]*)", group:"([^"]*)"/gm;
  const nodes = [...block.matchAll(re)].map(([, key, em, title, desc, group]) => ({ key, em, title, desc, group }));
  if (nodes.length !== keys.length) {
    const missed = keys.filter((k) => !nodes.some((n) => n.key === k));
    throw new Error(`parsed ${nodes.length}/${keys.length} NODE_TYPES entries; unparsed: ${missed.join(", ")} — update the regex in gen-llms-full.mjs`);
  }
  const groups = [];
  for (const n of nodes) if (!groups.includes(n.group)) groups.push(n.group);
  let out = `The editor registers ${nodes.length} node types. Titles and one-line descriptions below are ` +
    "taken verbatim from the node registry in index.html (the same text the in-editor " +
    "quick-add menu shows); the `key` is the type identifier used in noodle-graph.json " +
    "and in the executor libraries' supported-node tables.\n";
  for (const g of groups) {
    out += `\n### ${g}\n\n`;
    for (const n of nodes.filter((x) => x.group === g)) {
      out += `- \`${n.key}\` — ${n.em} ${n.title}: ${n.desc}\n`;
    }
  }
  return out.trim();
}

// --- assemble ---

/**
 * The sections built only from files in THIS repo (llms.txt, README.md,
 * index.html). They are always the leading parts of the output, which is what
 * lets the offline guard compare them without cloning anything.
 */
export function localParts() {
  const mainReadme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const llmsTxt = fs.readFileSync(path.join(root, "llms.txt"), "utf8");
  const blockquote = llmsTxt.split("\n").find((l) => l.startsWith("> "));
  if (!blockquote) throw new Error("no blockquote line in llms.txt");

  const parts = [];
  parts.push("# nanoodle — full reference");
  parts.push(blockquote);
  parts.push(
    "This file is generated by `scripts/gen-llms-full.mjs` in " +
    "[nanoodlecom/nanoodle](https://github.com/nanoodlecom/nanoodle) — do not edit by hand. " +
    "Every section is copied or extracted verbatim from the repository's README.md and " +
    "index.html, and from the public READMEs of " +
    "[nanoodlecom/nanoodle-js](https://github.com/nanoodlecom/nanoodle-js) and " +
    "[nanoodlecom/nanoodle-py](https://github.com/nanoodlecom/nanoodle-py). " +
    "The short index lives at [llms.txt](https://nanoodle.com/llms.txt)."
  );

  parts.push("## nanoodle (the site)");
  parts.push(embed(mainReadme.replace(/^# nanoodle\s*\n/, ""), "https://github.com/nanoodlecom/nanoodle"));

  parts.push("## Node types in the editor");
  parts.push(nodeCatalog());
  return parts;
}

/** The sections copied out of one library README. Needs that repo on disk. */
export function libParts(lib, dir) {
  const md = fs.readFileSync(path.join(dir, "README.md"), "utf8");
  const repoUrl = `https://github.com/nanoodlecom/${lib.repo}`;
  const parts = [];
  parts.push(`## ${lib.repo} — run workflows from ${lib.lang}`);
  parts.push(`Repository: ${repoUrl} · package: \`nanoodle\` (\`${lib.install}\`). ` +
    `Curated from the repository README; see it for the full docs (specs, agent skills, error model, cost fields).`);
  parts.push(embed(intro(md), repoUrl));
  for (const s of lib.sections) parts.push(embed(section(md, s), repoUrl));
  return parts;
}

export const joinParts = (parts) => parts.join("\n\n") + "\n";

export function build({ offline = false } = {}) {
  const parts = localParts();
  for (const lib of LIBS) parts.push(...libParts(lib, libSource(lib, { offline })));
  return joinParts(parts);
}

function main(argv) {
  const offline = argv.includes("--offline");
  const out = build({ offline });
  if (argv.includes("--check")) {
    const have = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, "utf8") : "";
    if (have === out) {
      console.log("✓ llms-full.txt matches the current sources");
      return 0;
    }
    console.error("✗ llms-full.txt is stale — run: node scripts/gen-llms-full.mjs");
    console.error(firstDiff(have, out));
    return 1;
  }
  fs.writeFileSync(OUT_PATH, out);
  console.log(`wrote llms-full.txt (${out.length} bytes, ${out.split("\n").length} lines)`);
  return 0;
}

/** Name the first line that differs, so the failure says WHAT drifted. */
export function firstDiff(have, want) {
  const a = have.split("\n"), b = want.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `  first difference at line ${i + 1}\n` +
             `    on disk:   ${a[i] === undefined ? "<end of file>" : JSON.stringify(a[i].slice(0, 160))}\n` +
             `    generated: ${b[i] === undefined ? "<end of file>" : JSON.stringify(b[i].slice(0, 160))}`;
    }
  }
  return "  files are identical";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
