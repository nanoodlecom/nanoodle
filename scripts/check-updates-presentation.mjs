#!/usr/bin/env node
// Regression checks for public field-note layout, URL punctuation and clip lifetime.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const root = new URL("../", import.meta.url);
const index = readFileSync(new URL("index.html", root), "utf8");
const html = readFileSync(new URL("changelog.html", root), "utf8");
const feed = readFileSync(new URL("feed.xml", root), "utf8");
const gen = readFileSync(new URL("scripts/gen-changelog.mjs", root), "utf8");
const articles = JSON.parse(readFileSync(new URL("articles.json", root), "utf8"));
let failed = 0;
function check(name, fn){
  try { fn(); console.log("✓ " + name); }
  catch(e){ failed++; console.error("✗ " + name + ": " + e.message); }
}
check("every public field-note grid child is one complete fn-card", ()=>{
  const grid = html.split('<div class="fn-grid">')[1]?.split('</div>')[0];
  assert.ok(grid, "field-note grid exists");
  const stack = []; let cards = 0;
  const voids = new Set(["img", "br", "hr", "source", "track", "input"]);
  for(const match of grid.matchAll(/<(\/?)([a-z][a-z0-9]*)([^>]*)>/gi)){
    const [, closing, rawTag, attrs] = match, tag = rawTag.toLowerCase();
    if(closing){ assert.equal(stack.pop(), tag, "balanced card markup"); continue; }
    if(!stack.length){
      assert.equal(tag, "a", "a direct grid child is the article link");
      assert.match(attrs, /\bclass="fn-card"/, "no standalone clip occupies a grid cell");
      cards++;
    }
    if(!voids.has(tag)) stack.push(tag);
  }
  assert.equal(stack.length,0);
  assert.equal(cards, articles.length);
});
check("public autolinks trim alternating punctuation until stable", ()=>{
  const code = gen.slice(gen.indexOf("const escHtml ="), gen.indexOf("// An entry's optional"));
  const box = { URL }; vm.createContext(box);
  vm.runInContext(code + "\nglobalThis.linkify = linkifyHtml;", box);
  for(const [text, href, tail] of [
    ["https://x.y/a.)", "https://x.y/a", ".)"],
    ["https://x.y/a_(b).)", "https://x.y/a_(b)", ".)"],
    ["https://x.y/a_(b)).", "https://x.y/a_(b)", ")."],
  ]) assert.equal(box.linkify(text), `<a href="${href}">${href.slice(8)}</a>${tail}`);
});
check("workflow destinations have a compact label and reject unsafe links on both surfaces", ()=>{
  const generator = gen.slice(gen.indexOf("const escHtml ="), gen.indexOf("// An entry's optional"));
  const safe = index.slice(index.indexOf("function updSafeUrl("), index.indexOf("function updSafeUrl(") + 650).match(/function updSafeUrl\([\s\S]*?\n\}/)?.[0];
  const workflow = index.slice(index.indexOf("function updWorkflowLink("), index.indexOf("let updatesOpenGen ="));
  assert.ok(safe && workflow);
  const box = { URL, t:s=>s, document:{createElement:tag=>({tag})} };
  vm.createContext(box);
  vm.runInContext(generator + safe + workflow + "\nglobalThis.publicLink = workflowHtml;", box);
  const long = "https://nanoodle.com/#g=" + "a".repeat(5000);
  const panel = box.updWorkflowLink({workflow:long});
  assert.equal(panel.textContent, "Open workflow");
  assert.equal(panel.href, long);
  assert.equal(panel.target, "_blank");
  assert.equal(panel.rel, "noopener");
  assert.equal(box.publicLink({workflow:long}), `<a class="workflow-link" href="${long}">Open workflow</a>`);
  assert.equal(box.publicLink({workflow:'https://example.com/?a=1&b="quoted"'}), '<a class="workflow-link" href="https://example.com/?a=1&amp;b=%22quoted%22">Open workflow</a>');
  for(const value of [undefined, null, 42, "javascript:alert(1)", "data:text/html,unsafe", "file:///tmp/x", "mailto:a@b.c", "http://example.com/", "//example.com/", "https://user:pass@example.com/", "https://example.com/\nunsafe", " https://example.com/"]){
    assert.equal(box.updWorkflowLink({workflow:value}), null, String(value));
    assert.equal(box.publicLink({workflow:value}), "", String(value));
  }
});
check("Atom preserves labeled workflow links as escaped HTML", ()=>{
  const updates = JSON.parse(readFileSync(new URL("updates.json", root), "utf8"));
  const code = gen.slice(gen.indexOf("const escHtml ="), gen.indexOf("// An entry's optional"));
  const box = {URL}; vm.createContext(box);
  vm.runInContext(code + "\nglobalThis.content = e=>escXml(escHtml(e.text) + ' ' + workflowHtml(e));", box);
  const entries = [...feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m=>m[1]);
  assert.equal(entries.length, updates.length);
  for(const entry of updates.filter(e=>e.workflow)){
    const content = box.content(entry);
    assert.equal(entries.filter(xml=>xml.includes(`<content type="html">${content}</content>`)).length,1);
    assert.ok(content.includes('&gt;Open workflow&lt;/a&gt;'), "the destination remains behind a label in feed readers");
  }
});
check("document visibility pauses Updates clips only when hidden", ()=>{
  const code = index.slice(index.indexOf("// Updates media stops when its document is hidden.")).match(/document\.addEventListener\("visibilitychange", \(\)=>\{[\s\S]*?\n\}\);/)?.[0];
  assert.ok(code, "Updates installs a document visibility handler");
  let callback, pauses = 0;
  const document = {
    hidden:false,
    addEventListener(name,fn){ assert.equal(name,"visibilitychange"); callback=fn; },
    querySelectorAll(selector){ assert.equal(selector,"#updateslist video"); return [{pause(){pauses++;}},{pause(){pauses++;}}]; }
  };
  vm.runInNewContext(code, {document});
  callback(); assert.equal(pauses,0,"visible document keeps user playback");
  document.hidden=true; callback(); assert.equal(pauses,2,"every Updates video pauses");
});
check("the wrapper does not duplicate the native video's accessible label", ()=>{
  const clip = index.slice(index.indexOf("function updClip(e){"), index.indexOf("const UPD_CAP_LABEL"));
  assert.ok(!/btn\.title\s*=|btn\.setAttribute\("aria-label"/.test(clip));
  assert.match(clip,/clipVid\.setAttribute\("aria-label", label\)/);
  assert.match(clip,/clipVid\.controls = true/);
});
if(failed) process.exit(1);
