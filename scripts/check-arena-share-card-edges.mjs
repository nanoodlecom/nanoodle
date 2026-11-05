#!/usr/bin/env node
// Leftover arena share-card edges after #695.
// That PR shipped per-page og/twitter cards for the two live arenas
// (flux3 poster + grok/heygen/H3 video) and a sync --check that the
// generated HTML matches. This file pins the leftover router/validator
// those pages never hit: unknown slugs (and the hub / Iron Verdict)
// stay on the site-wide og-card, twitter:image locksteps with og:image,
// SHARE_CARDS is only those two slugs, a missing / non-PNG / wrong-size
// card throws at sync time, and a short or non-IHDR buffer is not a
// card. Offline, zero API spend. New file so it does not collide with
// check-guide-examples / check-arena-example-edges.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import vm from "node:vm";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = readFileSync(join(ROOT, "scripts", "sync-guide-examples.mjs"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

function block(src, anchor) {
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error("anchor not found: " + anchor);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced braces for: " + anchor);
}

function extractAssign(src, anchor) {
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error("anchor not found: " + anchor);
  let depth = 0;
  let begun = false;
  for (let j = start; j < src.length; j++) {
    if (src[j] === "{") { depth++; begun = true; }
    else if (src[j] === "}" && begun && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced braces for: " + anchor);
}

const ctx = {
  ROOT,
  readFileSync,
  existsSync,
  join,
};
vm.createContext(ctx);
vm.runInContext(
  extractAssign(SRC, "const DEFAULT_SHARE = {") + ";\n" +
  extractAssign(SRC, "const SHARE_CARDS = {") + ";\n" +
  block(SRC, "function pngSize(file) {") + "\n" +
  block(SRC, "function shareFor(slug) {").replace(/\bSHARE_CARDS\b/g, "this.SHARE_CARDS") + "\n" +
  "this.DEFAULT_SHARE = DEFAULT_SHARE; this.SHARE_CARDS = SHARE_CARDS; this.pngSize = pngSize; this.shareFor = shareFor;",
  ctx,
);

const ARENA = {
  "flux3-seedream-ideogram-arena": "/examples/gallery/flux3-seedream-ideogram-arena/og.png",
  "grok-heygen-minimax-video-arena": "/examples/gallery/grok-heygen-minimax-video-arena/og.png",
};
const DEFAULT_IMG = "https://nanoodle.com/og-card.png";
const GUIDE = [
  "index",
  "iron-verdict",
  "character-sprites",
  "storyboard-relay",
  "tiny-world-film",
  "image-model-arena",
  "flux3-seedream-ideogram-arena",
  "grok-heygen-minimax-video-arena",
  "photo-to-video",
  "sing",
  "talking-avatar",
  "neon-shrine-duel",
];

{
  const ids = Object.keys(ctx.SHARE_CARDS).sort();
  const want = Object.keys(ARENA).sort();
  if (ids.length !== want.length || ids.some((id, i) => id !== want[i]))
    fail("SHARE_CARDS slugs drifted: " + ids.join(", "));
  else if (want.some((id) => ctx.SHARE_CARDS[id].path !== ARENA[id]))
    fail("SHARE_CARDS paths drifted: " + JSON.stringify(ctx.SHARE_CARDS));
  else ok("SHARE_CARDS is only the two live arenas");
}

{
  const def = ctx.shareFor("character-sprites");
  const miss = ctx.shareFor("no-such-slug");
  const iron = ctx.shareFor("iron-verdict");
  if (def.image !== DEFAULT_IMG || miss.image !== DEFAULT_IMG || iron.image !== DEFAULT_IMG)
    fail("unknown / non-arena slug must stay on og-card.png, got " + def.image + " / " + miss.image);
  else if (def !== ctx.DEFAULT_SHARE || miss !== ctx.DEFAULT_SHARE)
    fail("unknown slug must return DEFAULT_SHARE by identity, not a copy");
  else ok("unknown / non-arena slug stays on the site-wide og-card");
}

{
  let bad = 0;
  for (const [slug, path] of Object.entries(ARENA)) {
    const card = ctx.shareFor(slug);
    const want = "https://nanoodle.com" + path;
    if (card.image !== want) {
      fail(slug + " shareFor image drifted: " + card.image);
      bad++;
    } else if (!card.alt || card.alt === ctx.DEFAULT_SHARE.alt) {
      fail(slug + " must keep its own share-card alt, not the site-wide ramen alt");
      bad++;
    }
  }
  if (!bad) ok("arena shareFor points at the per-page 1200×630 card");
}

{
  let bad = 0;
  for (const slug of GUIDE) {
    const page = readFileSync(join(ROOT, "guide", "examples", slug + ".html"), "utf8");
    const og = page.match(/<meta property="og:image" content="([^"]+)"/);
    const tw = page.match(/<meta name="twitter:image" content="([^"]+)"/);
    const w = page.match(/<meta property="og:image:width" content="([^"]+)"/);
    const h = page.match(/<meta property="og:image:height" content="([^"]+)"/);
    const want = ARENA[slug] ? "https://nanoodle.com" + ARENA[slug] : DEFAULT_IMG;
    if (!og || og[1] !== want) {
      fail(slug + " og:image is " + (og && og[1]) + ", want " + want);
      bad++;
    } else if (!tw || tw[1] !== og[1]) {
      fail(slug + " twitter:image must lockstep with og:image, got " + (tw && tw[1]));
      bad++;
    } else if (!w || w[1] !== "1200" || !h || h[1] !== "630") {
      fail(slug + " og size meta drifted: " + (w && w[1]) + "×" + (h && h[1]));
      bad++;
    }
  }
  if (!bad) ok("committed guide pages: arenas use their card, everyone else stays on og-card");
}

{
  const tmp = join(tmpdir(), "nanoodle-share-card-edge-" + process.pid + ".bin");
  const ihdr = (width, height) => {
    const buf = Buffer.alloc(24);
    buf.write("IHDR", 12);
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    return buf;
  };
  try {
    writeFileSync(tmp, Buffer.alloc(8));
    try {
      ctx.pngSize(tmp);
      fail("pngSize must refuse a buffer shorter than an IHDR");
    } catch (e) {
      if (!/not a PNG/.test(String(e && e.message)))
        fail("short buffer must throw 'not a PNG', got " + e);
      else ok("pngSize refuses a short buffer");
    }

    writeFileSync(tmp, Buffer.concat([Buffer.alloc(12), Buffer.from("JUNK"), Buffer.alloc(8)]));
    try {
      ctx.pngSize(tmp);
      fail("pngSize must refuse a non-IHDR header");
    } catch (e) {
      if (!/not a PNG/.test(String(e && e.message)))
        fail("non-IHDR must throw 'not a PNG', got " + e);
      else ok("pngSize refuses a non-IHDR header");
    }

    writeFileSync(tmp, ihdr(800, 600));
    const got = ctx.pngSize(tmp);
    if (got.width !== 800 || got.height !== 600)
      fail("pngSize read " + got.width + "×" + got.height + ", want 800×600");
    else ok("pngSize reads IHDR width × height");
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

{
  const missing = { ...ctx.SHARE_CARDS };
  ctx.SHARE_CARDS = {
    "missing-card": { path: "/examples/gallery/no-such-arena/og.png", alt: "x" },
  };
  try {
    ctx.shareFor("missing-card");
    fail("shareFor must throw when the card file is missing");
  } catch (e) {
    if (!/Missing share card/.test(String(e && e.message)))
      fail("missing card must throw 'Missing share card', got " + e);
    else ok("shareFor throws on a mapped-but-missing card");
  } finally {
    ctx.SHARE_CARDS = missing;
  }
}

{
  let bad = 0;
  for (const path of Object.values(ARENA)) {
    const file = join(ROOT, path.slice(1));
    const { width, height } = ctx.pngSize(file);
    if (width !== 1200 || height !== 630) {
      fail(path + " is " + width + "×" + height + ", want 1200×630");
      bad++;
    }
  }
  if (!bad) ok("committed arena cards are 1200×630 PNGs");
}

if (failed) {
  console.error("\n✗ check-arena-share-card-edges: " + failed + " failed");
  process.exit(1);
}
console.log("\n✓ check-arena-share-card-edges");
