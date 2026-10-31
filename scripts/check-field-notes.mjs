#!/usr/bin/env node
// Field notes: changelog stays a full day list with the notes beside it, and the
// in-app Updates panel mixes ARTICLE_SLOTS notes into that list. Notes count on
// the badge only until they have actually been rendered in the open panel.
//
//   node scripts/check-field-notes.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = readFileSync(join(root, "index.html"), "utf8");
const begin = index.indexOf("/* ARTICLE-SLOTS-BEGIN */");
const end = index.indexOf("/* ARTICLE-SLOTS-END */");
if (begin < 0 || end < begin) {
  console.error("✗ check-field-notes: ARTICLE-SLOTS markers missing");
  process.exit(1);
}
const src = index.slice(begin, end);

function createEl(tag) {
  return {
    tag,
    id: "",
    className: "",
    hidden: false,
    textContent: "",
    children: [],
    dataset: {},
    style: {},
    listeners: {},
    open:false,
    attrs: {},
    appendChild(ch) { this.children.push(ch); return ch; },
    replaceChildren(...nodes) { this.children = nodes.flat(); },
    insertAdjacentHTML(_pos, html) {
      this.children.push({ tag: "raw", html, children: [], className: "", textContent: html });
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(k, fn) { this.listeners[k] = fn; },
    removeAttribute(k) { delete this.attrs[k]; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
}

function textOf(node) {
  if (!node) return "";
  if (node.children && node.children.length) return node.children.map(textOf).join("");
  return node.textContent || "";
}

function findClass(node, cls) {
  if (!node) return null;
  if (node.className === cls) return node;
  for (const ch of node.children || []) {
    const hit = findClass(ch, cls);
    if (hit) return hit;
  }
  return null;
}

// Visible changelog lines and field notes, in paint order, skipping date headers.
function painted(list) {
  const out = [];
  for (const ch of list.children) {
    if (ch.className === "update-items") {
      for (const li of ch.children) out.push("u:" + textOf(li));
    } else if (ch.className === "field-note") {
      out.push("a:" + textOf(findClass(ch, "field-note-title")));
    }
  }
  return out;
}

function boot({ updates, articles, articlesGate }) {
  const store = new Map();
  const updateslist = createEl("div");
  const updatesmodal = createEl("div");
  updatesmodal.hidden = true;
  const badge = createEl("span");
  badge.hidden = true;
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  function $(id) {
    if (id === "updateslist") return updateslist;
    if (id === "updatesmodal") return updatesmodal;
    if (id === "updbadge") return badge;
    if (id === "updatespanel") return createEl("div");
    throw new Error("unexpected id " + id);
  }
  const document = {
    createElement: createEl,
    createTextNode: (text) => ({ tag: "text", textContent: text, children: [], className: "" }),
    querySelectorAll: () => [],
  };
  const sandbox = {
    fetch: async (url) => {
      const u = String(url);
      if (u.includes("articles.json")) {
        if (articlesGate) await articlesGate;
        return { ok: true, json: async () => articles };
      }
      return { ok: true, json: async () => updates };
    },
    document,
    localStorage,
    LANG: "en",
    t: (s) => s,
    $,
    updClip: () => null,
    updClipObs: null,
    console,
    URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    src + "\nglobalThis.__api = { openUpdates, interleaveArticles, unseenArticleCount, ARTICLE_SLOTS, artKey, updSafeUrl };",
    sandbox,
  );
  return { api: sandbox.__api, updateslist, updatesmodal, store };
}

const U = (n) => Array.from({ length: n }, (_, i) => ({ date: "2026-10-22", text: "u" + i }));
const A = (n) => Array.from({ length: n }, (_, i) => ({
  date: "2026-10-2" + (9 - i),
  url: "https://subnano.ai/@nano_maxi/note-" + i,
  title: "a" + i,
  blurb: "blurb " + i,
  thumb: "articles-media/tin-robot.webp",
  ability: "sing",
}));
const kinds = (rows) => rows.map((r) => (r.kind === "article" ? "a:" + r.item.title : "u:" + r.item.text)).join(",");

const api0 = boot({ updates: [], articles: [] }).api;
assert.equal(api0.ARTICLE_SLOTS, 3);
assert.equal(kinds(api0.interleaveArticles(U(8), A(5))), "a:a0,a:a1,a:a2,u:u0,u:u1,u:u2,u:u3,u:u4,u:u5,u:u6,u:u7");
assert.equal(kinds(api0.interleaveArticles(U(2), A(3))), "a:a0,a:a1,a:a2,u:u0,u:u1");
assert.equal(kinds(api0.interleaveArticles(U(0), A(2))), "a:a0,a:a1");
assert.equal(kinds(api0.interleaveArticles(U(3), A(1))), "a:a0,u:u0,u:u1,u:u2");
assert.equal(kinds(api0.interleaveArticles(U(4), A(3))), "a:a0,a:a1,a:a2,u:u0,u:u1,u:u2,u:u3");

// Shown in the open panel: notes render in those positions and become seen.
{
  const ctx = boot({ updates: U(8), articles: A(4) });
  await ctx.api.openUpdates();
  assert.equal(ctx.updatesmodal.hidden, false);
  assert.deepEqual(painted(ctx.updateslist), kinds(ctx.api.interleaveArticles(U(8), A(4))).split(","));
  const notes = [];
  (function walk(node) {
    if (!node) return;
    if (node.className === "field-note-link") notes.push(node);
    for (const ch of node.children || []) walk(ch);
  })(ctx.updateslist);
  assert.equal(notes.length, 3);
  for (const link of notes) {
    assert.equal(link.rel, "noopener");
    assert.equal(link.target, "_blank");
    const img = (link.children || []).find((ch) => ch.tag === "img");
    assert.equal(img.loading, "lazy");
    assert.equal(img.decoding, "async");
  }
  const seen = JSON.parse(ctx.store.get("noodle_seen_articles"));
  assert.deepEqual(seen, A(3).map(ctx.api.artKey));
  assert.equal(ctx.api.unseenArticleCount(A(4)), 0);
}

// Keep the initial feed short without deleting older changes or field notes.
{
  const ctx = boot({updates:U(20),articles:A(6)});
  await ctx.api.openUpdates();
  assert.equal(painted(ctx.updateslist).filter(x=>x.startsWith("u:")).length,12);
  assert.equal(painted(ctx.updateslist).filter(x=>x.startsWith("a:")).length,3);
  const archive = findClass(ctx.updateslist,"updates-archive");
  assert.ok(archive && !archive.open);
  const content = findClass(archive,"updates-archive-body");
  assert.equal(content.children.length,0,"older rows do not mount until requested");
  archive.open=true; archive.listeners.toggle();
  assert.equal(painted(content).filter(x=>x.startsWith("u:")).length,8);
  assert.equal(painted(content).filter(x=>x.startsWith("a:")).length,3);
  archive.listeners.toggle();
  assert.equal(painted(content).length,11,"reopening cannot duplicate old entries");
  assert.equal(JSON.parse(ctx.store.get("noodle_seen_articles")).length,6);
}
for(const bad of ["javascript:alert(1)","data:text/html,hi","https://user:secret@example.com/x","https://", "https://a b.test", "https://example.com/\npath"]){
  assert.equal(api0.updSafeUrl(bad),null,bad);
}
assert.equal(api0.updSafeUrl("https://example.com/clip?q=a&b=c"),"https://example.com/clip?q=a&b=c");

// Slow fetch, then the panel closes before it resolves: notes stay unseen and unrendered.
{
  let release;
  const articlesGate = new Promise((res) => { release = res; });
  const ctx = boot({ updates: U(6), articles: A(3), articlesGate });
  const pending = ctx.api.openUpdates();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(ctx.updatesmodal.hidden, false);
  ctx.updatesmodal.hidden = true;
  release();
  await pending;
  assert.equal(painted(ctx.updateslist).some((row) => row.startsWith("a:")), false);
  assert.equal(ctx.store.has("noodle_seen_articles"), false);
  assert.equal(ctx.api.unseenArticleCount(A(3)), 3);
  assert.equal(painted(ctx.updateslist).filter((row) => row.startsWith("u:")).length, 6);
}

// Changelog page: every update still renders, and the notes column does not precede it.
{
  const updates = JSON.parse(readFileSync(join(root, "updates.json"), "utf8"));
  const html = readFileSync(join(root, "changelog.html"), "utf8");
  const gen = readFileSync(join(root, "scripts/gen-changelog.mjs"), "utf8");
  const articles = readFileSync(join(root, "articles.json"), "utf8");
  const li = html.match(/<li id="u-/g) || [];
  assert.equal(li.length, updates.length, "every updates.json entry renders");
  const firstText = updates[0].text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  assert.ok(html.includes(firstText.slice(0, 80)), "newest changelog entry is present");
  const firstLi = html.indexOf("<li id=\"u-");
  const aside = html.indexOf("<aside class=\"fieldnotes\"");
  assert.ok(firstLi > 0 && aside > firstLi, "field notes follow the changelog column in source order");
  assert.ok(html.includes("Nano Maxi, an AI agent, runs one nanoodle flow a day and writes up what came out, misses included."));
  assert.ok(html.includes("<h1>Change<span class=\"grad\">log</span></h1>"));
  assert.equal((html.match(/<section>/g) || []).length, new Set(updates.map((e) => e.date)).size);
  const asideHtml = html.slice(html.indexOf("<aside class=\"fieldnotes\""), html.indexOf("</aside>") + 7);
  const slots = index.slice(index.indexOf("/* ARTICLE-SLOTS-BEGIN */"), index.indexOf("/* ARTICLE-SLOTS-END */"));
  for (const banned of ["pays in Nano", "cents of Nano", "paga en Nano", "paie en Nano", "zahlt in Nano", "paga em Nano", "Nano で支払い"]) {
    assert.equal(asideHtml.includes(banned), false, "changelog notes: " + banned);
    assert.equal(gen.includes(banned), false, "generator: " + banned);
    assert.equal(articles.includes(banned), false, "articles.json: " + banned);
    assert.equal(slots.includes(banned), false, "panel: " + banned);
  }
  assert.equal(index.includes("From the blog"), false);
  assert.equal(index.includes("id=\"bloglist\""), false);
  assert.ok(index.includes('const ARTICLE_SLOTS = 3'));
}

console.log("✓ check-field-notes: recent chronological feed + lazy archive, safe URLs, seen only while the panel is open, changelog entries intact");
