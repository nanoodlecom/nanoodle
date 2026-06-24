#!/usr/bin/env node
// Behavioural test for the editor's link-removal path: when the node feeding a
// wired text field (e.g. an LLM's `prompt`) is deleted, the textarea must be
// UNLOCKED again — not left disabled with nothing connected.
//
// removeLink() already did this (via refreshPortFills); removeNode() did not.
// We run the REAL refreshPortFills() and removeNode() extracted from index.html
// against a tiny fake DOM and assert the orphaned textarea re-enables.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "index.html"), "utf8");

function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error(`function ${name}() not found in index.html`);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`could not brace-match ${name}()`);
}
const reLine = (SRC.match(/const IMG_PORT_RE = \/[^\n]*;/) || [])[0];

// ---- a fake DOM just big enough for refreshPortFills' selectors -----------
const ALL = [];
class El {
  constructor(tag, cls, dataset) {
    this.tagName = tag.toUpperCase();
    this._cls = new Set((cls || "").split(/\s+/).filter(Boolean));
    this.dataset = dataset || {};
    this.disabled = false; this.children = []; this.parentElement = null;
    ALL.push(this);
  }
  get classList() { const s = this._cls; return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c) }; }
  append(c) { c.parentElement = this; this.children.push(c); return c; }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this);
    const prune = (e) => { const i = ALL.indexOf(e); if (i >= 0) ALL.splice(i, 1); e.children.forEach(prune); };
    prune(this);
  }
  querySelector(sel) { return descendants(this).find((e) => matches(e, sel)) || null; }
}
function descendants(el) { const out = []; const walk = (e) => e.children.forEach((c) => { out.push(c); walk(c); }); walk(el); return out; }
function parseSel(s) {
  s = s.trim(); const out = { tag: null, cls: [], attrs: [] }; let m;
  if ((m = s.match(/^([a-zA-Z]+)/))) { out.tag = m[1].toUpperCase(); s = s.slice(m[1].length); }
  while (s.length) {
    if (s[0] === ".") { m = s.match(/^\.([\w-]+)/); out.cls.push(m[1]); s = s.slice(m[0].length); }
    else if (s[0] === "[") {
      m = s.match(/^\[([\w-]+)(?:="([^"]*)")?\]/);
      out.attrs.push({ key: m[1].replace(/^data-/, ""), val: m[2] }); s = s.slice(m[0].length);
    } else break;
  }
  return out;
}
function matches(el, sel) {
  return sel.split(",").some((alt) => {
    const p = parseSel(alt);
    if (p.tag && el.tagName !== p.tag) return false;
    if (!p.cls.every((c) => el._cls.has(c))) return false;
    return p.attrs.every((a) => (a.val === undefined ? el.dataset[a.key] != null : el.dataset[a.key] === a.val));
  });
}
const document = {
  querySelectorAll: (sel) => ALL.filter((e) => matches(e, sel)),
  querySelector: (sel) => ALL.find((e) => matches(e, sel)) || null,
};

// ---- scenario: text node t1 → m1's `prompt` field (textarea locked) -------
// m1 body: <wrap> <i.fieldport> <textarea data-f=prompt .wired disabled> </wrap>
const wrap = new El("div", "");
const fieldport = wrap.append(new El("i", "port text fieldport", { node: "m1", port: "prompt", dir: "in" }));
const textarea = wrap.append(new El("textarea", "wired", { f: "prompt" }));
textarea.disabled = true;                       // it's wired, so it starts locked
new El("i", "port text", { node: "t1", port: "text", dir: "out" });   // t1's output port

const m1El = new El("div", ""); m1El.append(wrap);
const t1El = new El("div", "");

const ctx = {
  console, document,
  graph: {
    nodes: [{ id: "t1", type: "text", el: t1El }, { id: "m1", type: "llm", el: m1El }],
    links: [{ id: "l1", from: { node: "t1", port: "text" }, to: { node: "m1", port: "prompt" } }],
  },
  selected: null,
  redraw: () => {}, save: () => {},
  refreshImageInputs: () => {}, recompactImageLinks: () => {},  // not exercised in this scenario
};
ctx.byId = (id) => ctx.graph.nodes.find((n) => n.id === id);
vm.createContext(ctx);
const bundle = reLine + "\n" + extractFn(SRC, "refreshPortFills") + "\n" + extractFn(SRC, "removeNode") +
  "\n;globalThis.__t = { refreshPortFills, removeNode };";
new vm.Script(bundle, { filename: "index.html#editor-ports" }).runInContext(ctx);

// ---- assertions -----------------------------------------------------------
const failures = [];
const ok = (c, m) => { if (!c) failures.push(m); };

// sanity: while wired, refreshPortFills keeps the textarea locked
ctx.__t.refreshPortFills();
ok(textarea.disabled === true && textarea._cls.has("wired"), "precondition: a wired prompt should be disabled");

// THE BUG: delete the source node → textarea must unlock
ctx.__t.removeNode("t1");
ok(ctx.graph.links.length === 0, "removeNode should drop the link");
ok(textarea.disabled === false, "after removing its source node, the prompt textarea must be ENABLED");
ok(!textarea._cls.has("wired"), "after removal the textarea must lose the 'wired' lock class");

if (failures.length) {
  process.stderr.write("✗ editor link-removal leaves stale field state:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ removing a node unlocks the text field it fed (no stuck-disabled prompt).\n");
