#!/usr/bin/env node
// Guards against a recurring bug CLASS: an author `display:` CSS rule silently
// defeating the `hidden` attribute, so an element JS thinks it hid stays visible.
//
// The browser hides `hidden` elements via a UA rule `[hidden]{display:none}` at
// the LOWEST specificity. Any author rule that sets `display:` to a VISIBLE value
// on a selector whose subject is `#id` (id specificity 1,0,0) outranks it — so the
// element shows even while its `hidden` property/attribute is set. This shipped a
// real bug once: /play's #linkerr banner had `#linkerr{display:flex}` and appeared
// on every load despite `hidden` (fixed by rewriting it `#linkerr:not([hidden])`).
//
// This codebase has NO global `[hidden]{display:none}` rule; it relies on per-id
// guards. Two accepted guard forms exist and are both honored here:
//   (a) a companion  #id[hidden]{ display:none }        (e.g. #appmodal)
//   (b) writing the visible rule  #id:not([hidden]){ … } (e.g. #linkerr)
//
// THE RULE: for every id whose `hidden` is toggled from JS AND that has an author
// rule giving `#id` (as the rule's SUBJECT) a visible `display:`, one of the two
// guard forms MUST be present. Violations fail the commit with the id, the offending
// rule, and the fix.
//
// Why "visible display only": a `display:none` author rule (even a conditional one
// like `body.narrowbar #cost{display:none}`) can never REVEAL a hidden element, so
// it is not a hazard. Only a visible value (flex/block/grid/inline-flex/contents/…)
// can override the UA hide.
//
// Scope / known limits (kept honest on purpose):
//  - Only <style> author rules with an `#id` SUBJECT are considered. A display rule
//    whose subject is a class/tag (even under an ancestor `#id …`) is attributed to
//    that subject, not the id — correct, since that's the element the display applies
//    to. Class-based reveals (`#id.open{display:flex}` toggled via .open, not hidden)
//    are out of scope unless the SAME id is also `hidden`-toggled.
//  - Inline style="display:…" attributes are out of scope (rare; would be caught by
//    review). Media-query-wrapped rules ARE handled: the flat rule scanner picks up
//    the inner `#id{…}` regardless of the surrounding @media.
//  - HIDDEN_TOGGLED is resolved from BOTH direct grabs ($("id").hidden = / setAttribute)
//    and variable aliases (const el=$("id"); … el.hidden=…), but alias bindings are
//    SCOPED: a binding dies the moment the variable is reassigned, so the reuse of
//    common names like `el`/`b`/`box` across functions does not create false hits.
//  - play.html is scanned as raw text, which also covers the player runtime + any
//    <style> embedded in RUNTIME_JS. Per-app exported CSS is injected at runtime from
//    user data and is not statically present, so it is out of scope by nature.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["index.html", "play.html"];

// Ids allowed to carry an unguarded visible display rule despite being hidden-toggled.
// Format: { "file:id": "why it's benign" }. Empty today — main is clean — so ANY hit
// is a new, real hazard. Add an entry only with a written justification; if the entry
// would describe a genuine bug, fix the CSS instead and it never needs listing.
const ALLOW = {
  // "play.html:example": "reason this specific case cannot show while hidden",
};

// A grab expression that yields an element by id.
const GRAB =
  /^(?:\$\(|document\.getElementById\(|getElementById\()\s*["']([\w-]+)["']\s*\)$|^document\.querySelector\(\s*["']#([\w-]+)["']\s*\)$/;

// ---- 1) ids whose `hidden` is toggled from JS -----------------------------
function hiddenToggledIds(src) {
  const ids = new Set();

  // direct:  $("id").hidden = …  |  getElementById("id").hidden = …
  for (const m of src.matchAll(
    /(?:\$\(|document\.getElementById\(|getElementById\()\s*["']([\w-]+)["']\s*\)\.hidden\s*=(?!=)/g
  ))
    ids.add(m[1]);
  // direct:  document.querySelector("#id").hidden = …
  for (const m of src.matchAll(
    /document\.querySelector\(\s*["']#([\w-]+)["']\s*\)\.hidden\s*=(?!=)/g
  ))
    ids.add(m[1]);
  // direct:  $("id").setAttribute("hidden" …) / .removeAttribute("hidden")
  for (const m of src.matchAll(
    /(?:\$\(|document\.getElementById\(|getElementById\()\s*["']([\w-]+)["']\s*\)\.(?:set|remove)Attribute\(\s*["']hidden["']/g
  ))
    ids.add(m[1]);

  // scoped alias resolution: walk assignments and `.hidden =` uses in source order,
  // keeping a live binding var->id that is cleared the instant the var is reassigned.
  const evRe =
    /(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)|([A-Za-z_$][\w$]*)\.hidden\s*=(?!=)/g;
  const bind = new Map();
  let m;
  while ((m = evRe.exec(src))) {
    if (m[3] !== undefined) {
      const id = bind.get(m[3]);
      if (id) ids.add(id);
    } else {
      const g = m[2].trim().match(GRAB);
      if (g) bind.set(m[1], g[1] || g[2]);
      else bind.delete(m[1]); // reassigned to a non-grab -> alias no longer points at an id
    }
  }
  return ids;
}

// ---- 2) parse <style> rules: guards + unguarded visible-display id subjects --
// The SUBJECT of a selector is its rightmost compound (what the rule styles).
function subjectId(alt) {
  const parts = alt.trim().split(/\s+/).filter(Boolean);
  let last = parts[parts.length - 1] || "";
  if (/^[>+~]$/.test(last)) last = parts[parts.length - 2] || ""; // ignore trailing combinator
  const m = last.match(/#([\w-]+)/);
  return m ? { id: m[1], compound: last } : null;
}

function parseCss(src) {
  const styles = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1])
    .join("\n");
  const guardNone = new Set(); // ids with a #id[hidden]{display:none} guard
  const hazards = []; // { id, val, selfGuard, sel }
  // Flat rule scan. CSS here is unnested; @media wrappers never close cleanly under
  // [^{}]*, so only the inner `#id{…}` rules match — exactly what we want.
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(styles))) {
    const sel = m[1];
    const body = m[2];
    const dm = body.match(/(?:^|[\s;{])display\s*:\s*([a-zA-Z-]+)/);
    if (!dm) continue;
    const val = dm[1].toLowerCase();
    for (const alt of sel.split(",")) {
      const s = subjectId(alt);
      if (!s) continue;
      if (val === "none") {
        if (/\[hidden\]/.test(s.compound)) guardNone.add(s.id); // (a) companion guard
        continue; // display:none never reveals a hidden element
      }
      hazards.push({
        id: s.id,
        val,
        selfGuard: /:not\(\[hidden\]\)/.test(s.compound), // (b) self-guarded rule
        sel: alt.trim().replace(/\s+/g, " "),
      });
    }
  }
  return { guardNone, hazards };
}

// ---- run ------------------------------------------------------------------
const violations = [];
for (const file of FILES) {
  const src = readFileSync(join(ROOT, file), "utf8");
  const toggled = hiddenToggledIds(src);
  const { guardNone, hazards } = parseCss(src);
  for (const h of hazards) {
    if (!toggled.has(h.id)) continue; // only ids JS actually hides via `hidden`
    if (h.selfGuard || guardNone.has(h.id)) continue; // properly guarded
    if (ALLOW[`${file}:${h.id}`]) continue;
    violations.push({ file, ...h });
  }
}

// ---- self-verification: both historical guard forms must read as guarded ----
// (Cheap invariant so a future parser change can't silently stop recognizing them.)
{
  const idx = readFileSync(join(ROOT, "index.html"), "utf8");
  const ply = readFileSync(join(ROOT, "play.html"), "utf8");
  const idxCss = parseCss(idx);
  const plyCss = parseCss(ply);
  const idxTog = hiddenToggledIds(idx);
  const plyTog = hiddenToggledIds(ply);
  const bad = [];
  // Assert the toggle detector still SEES these sentinel idioms. Phrased as a positive
  // presence check (not a precondition) so a total regression of hiddenToggledIds — one
  // that returns an empty set — fails loudly here instead of passing vacuously green
  // (with no toggled ids there are no violations, so the main check can't catch it).
  // #appmodal (index.html) and #linkerr (play.html) are the two historical guard
  // examples this whole check is built on; if either is legitimately removed, update
  // the sentinel to another currently-hidden-toggled id.
  // form (a): #appmodal{display:flex} guarded by #appmodal[hidden]{display:none}
  if (!idxTog.has("appmodal"))
    bad.push(
      "toggle-detector regressed: #appmodal no longer seen as hidden-toggled in index.html"
    );
  else if (!idxCss.guardNone.has("appmodal"))
    bad.push("form (a) #appmodal[hidden] guard not recognized");
  // form (b): #linkerr:not([hidden]){display:flex}
  if (!plyTog.has("linkerr"))
    bad.push(
      "toggle-detector regressed: #linkerr no longer seen as hidden-toggled in play.html"
    );
  else if (!plyCss.hazards.some((h) => h.id === "linkerr" && h.selfGuard))
    bad.push("form (b) #linkerr:not([hidden]) guard not recognized");
  if (bad.length) {
    process.stderr.write(
      "✗ check-hidden-css self-verification failed (parser no longer recognizes a known guard):\n- " +
        bad.join("\n- ") +
        "\n"
    );
    process.exit(2);
  }
}

if (violations.length) {
  const lines = violations.map(
    (v) =>
      `  ${v.file}  #${v.id}  →  ${v.sel} { display:${v.val} }\n` +
      `      (#${v.id}.hidden is toggled from JS, but this rule outranks [hidden]{display:none})\n` +
      `      fix: write  #${v.id}:not([hidden]){ display:${v.val}; … }  OR add  #${v.id}[hidden]{ display:none }`
  );
  process.stderr.write(
    "✗ author display: rule defeats the `hidden` attribute (element will show while hidden):\n\n" +
      lines.join("\n\n") +
      "\n"
  );
  process.exit(1);
}
process.stdout.write(
  "✓ every hidden-toggled id with a visible display: rule is guarded against [hidden].\n"
);
