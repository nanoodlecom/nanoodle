#!/usr/bin/env node
// Pins the pure pre/post-processing of the "describe changes" graph copilot in
// index.html — the path that turns a natural-language edit into an applied graph:
//
//   toSimple → (LLM rewrite, NOT tested) → fromSimple → sanitizeFields →
//   validate → diff, with placeNew / normalizeLinks as helpers.
//
// The copilot itself calls an LLM. This check NEVER does: it lifts the shipped
// PURE functions out of index.html as text and runs them in a sandbox against
// stubs, so we exercise the exact code that decides what the user ends up with
// after a described edit — no network, no browser, no API spend.
//
// Invariants pinned (see each check() below):
//   1. MEDIA CARRY — a described edit must not silently destroy the user's
//      uploaded photo/song: fromSimple carries the stripped-away media fields of
//      a SURVIVING node back into the applied graph.
//   2. DELETION RESPECTED (audit M4) — a *visible* field the planner omitted
//      from a surviving node stays deleted, not resurrected from prev.
//   3. SANITIZE — an out-of-range paid option (duration 60 on a 5/10s model, a
//      bad inpaint size, an over-cap vframes count) is snapped back to a legal
//      value before it can reach a run payload.
//   4. VALIDATE — a hand-built cycle and a portless link are both rejected.
//   5. PLACEMENT / LINK SHAPE — new nodes get numeric coordinates; links
//      normalize to the internal string form (survivors keep their exact spot).

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- JS-string/comment/template-aware `{ ... }` matcher (house pattern; see
//      check-share-link.mjs). Returns the index of the `}` closing `{` at openIdx.
function matchBrace(src, openIdx) {
  let depth = 0;
  const tmpl = [];
  let mode = "code"; // code | sq | dq | tpl | line | block
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i++; }
      else if (c === "/" && n === "*") { mode = "block"; i++; }
      else if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (tmpl.length && depth === tmpl[tmpl.length - 1]) { tmpl.pop(); mode = "tpl"; }
        else if (depth === 0) return i;
      }
    } else if (mode === "line") { if (c === "\n") mode = "code"; }
    else if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i++; } }
    else if (mode === "sq") { if (c === "\\") i++; else if (c === "'") mode = "code"; }
    else if (mode === "dq") { if (c === "\\") i++; else if (c === '"') mode = "code"; }
    else if (mode === "tpl") {
      if (c === "\\") i++;
      else if (c === "`") mode = "code";
      else if (c === "$" && n === "{") { mode = "code"; tmpl.push(depth); depth++; i++; }
    }
  }
  throw new Error("unbalanced braces from index " + openIdx);
}

// pull `function <name>(...) { ... }` out as text
function extractFunction(src, name) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = sig.exec(src);
  if (!m) throw new Error(`could not find function ${name}() in index.html`);
  const open = src.indexOf("{", m.index);
  const close = matchBrace(src, open);
  return src.slice(m.index, close + 1);
}

// Assemble a runnable module from the SHIPPED source pieces + stubbed dependencies.
// The stubs stand in for the editor's live catalog/registry (NODE_TYPES, dimDefs,
// SIZES, …) — they are NOT the logic under test; the extracted functions are.
const COPILOT_FNS = ["strip", "toSimple", "placeNew", "fromSimple", "sanitizeFields", "validate", "diff", "normalizeLinks"];

function buildModule(src) {
  const bodies = COPILOT_FNS.map((f) => extractFunction(src, f)).join("\n\n");
  const program = `
    "use strict";
    const MEDIA_KEYS = new Set(["image","audio","video","mask"]);
    // Port-name regexes lifted verbatim from index.html — validate()'s port check reads them.
    const IMG_PORT_RE = /^img\\d+$/, EDIT_IMG_RE = /^image\\d*$/, VID_PORT_RE = /^vid\\d+$/, REF_PORT_RE = /^ref\\d+$/;
    // Stubs of the live registry. validate() now derives a type's REAL ports from outputs/body/the
    // dynamic-port flags, so those must be present (the extracted functions are the logic under test,
    // not these shapes). bodies use single quotes so their attr quotes survive this template literal.
    const P = (name)=> '<textarea data-f="' + name + '"></textarea>';   // one wirable field port
    const NODE_TYPES = {
      text:{ outputs:[{name:"text",type:"text"}], body:()=> P("text") },
      edit:{ modelKind:true, imageInputs:{multi:true}, outputs:[{name:"image",type:"image"}], body:()=> P("system")+P("prompt") },
      llm:{ modelKind:true, imageInputs:"vision", audioInput:"audio_input", outputs:[{name:"text",type:"text"}], body:()=> P("system")+P("prompt") },
      image:{ modelKind:true, outputs:[{name:"image",type:"image"}], body:()=> P("prompt") },
      tvideo:{ modelKind:true, refInputs:true, outputs:[{name:"video",type:"video"}], body:()=> P("prompt") },
      ivideo:{ modelKind:true, endFrame:true, outputs:[{name:"video",type:"video"}], body:()=> P("prompt") },
      inpaint:{ modelKind:true, imageInputs:{multi:true}, outputs:[{name:"image",type:"image"}], body:()=> P("prompt") },
      vframes:{ inputs:[{name:"video",type:"video"}], outputs:(n)=> [{name:"frame1",type:"image"}], body:()=> "" },
      music:{ modelKind:true, outputs:[{name:"audio",type:"audio"}], body:()=> P("prompt") },
      tts:{ modelKind:true, outputs:[{name:"audio",type:"audio"}], body:()=> P("prompt") },
      transcribe:{ modelKind:true, audioInput:"audio_input", outputs:[{name:"text",type:"text"}], body:()=> "" },
    };
    function defModelFor(type){ return "stub-default-model"; }
    // real dimDefs returns [{ f, options:[[value,label],…], def }]; stub the shape,
    // not the loop under test (sanitizeFields snaps against whatever table this yields).
    function dimDefs(type, model){
      if(type==="tvideo" || type==="ivideo") return [{ f:"duration", options:[["5","5"],["10","10"]], def:"5" }];
      if(type==="image") return [{ f:"size", options:[["1024x1024","1024x1024"],["512x512","512x512"]], def:"1024x1024" }];
      return [];
    }
    function audioFields(t, it){ return []; }
    function catItem(kind, model){ return null; }
    const SIZES = [["1024x1024"],["512x512"]];
    const MAX_FRAMES = 8;

    ${bodies}

    return { strip, toSimple, placeNew, fromSimple, sanitizeFields, validate, diff, normalizeLinks };
  `;
  return new Function(program)();
}

// ---- the invariant checks: each returns a list of failure strings ----
function runInvariants(mod) {
  const F = [];
  const { fromSimple, sanitizeFields, validate, placeNew, normalizeLinks, diff } = mod;

  // 1. MEDIA CARRY — a surviving node's uploaded media (stripped before the planner
  //    ever saw it) survives the described edit.
  {
    const prev = { nodes: [{ id: "n1", type: "edit", x: 100, y: 50,
      fields: { prompt: "make it pop", image: "data:image/png;base64,AAAA" } }], links: [] };
    const simple = { nodes: [{ id: "n1", type: "edit", fields: { prompt: "make it dramatic" } }], links: [] };
    const out = fromSimple(simple, prev);
    const n1 = out.nodes.find((n) => n.id === "n1");
    if (!n1) F.push("MEDIA CARRY: surviving node n1 vanished from the applied graph");
    else {
      if (n1.fields.image !== "data:image/png;base64,AAAA")
        F.push(`MEDIA CARRY: fromSimple dropped the user's uploaded image (fields.image=${JSON.stringify(n1.fields.image)}) — a described edit would silently destroy the upload`);
      if (n1.fields.prompt !== "make it dramatic")
        F.push(`MEDIA CARRY: the planner's prompt edit was lost (fields.prompt=${JSON.stringify(n1.fields.prompt)})`);
    }
  }

  // 2. DELETION RESPECTED (audit M4) — a VISIBLE field the planner omitted stays
  //    gone; only the invisible media is carried back.
  {
    const prev = { nodes: [{ id: "n1", type: "edit", x: 0, y: 0,
      fields: { prompt: "keep", system: "delete me", image: "data:image/png;base64,BBBB" } }], links: [] };
    const simple = { nodes: [{ id: "n1", type: "edit", fields: { prompt: "keep" } }], links: [] };
    const out = fromSimple(simple, prev);
    const n1 = out.nodes.find((n) => n.id === "n1");
    if (n1 && "system" in n1.fields)
      F.push(`DELETION RESPECTED: an omitted visible field was resurrected (fields.system=${JSON.stringify(n1.fields.system)}) — the planner's deletion was undone`);
    if (n1 && n1.fields.image !== "data:image/png;base64,BBBB")
      F.push("DELETION RESPECTED: media should still be carried even while a visible field is deleted");
  }

  // 3. SANITIZE — out-of-range paid options snap back to legal values.
  {
    // duration 60 on a 5/10s model → snapped to the model default
    const bad = { id: "n2", type: "tvideo", fields: { model: "m", duration: 60 } };
    sanitizeFields(bad);
    if (String(bad.fields.duration) !== "5")
      F.push(`SANITIZE: an illegal duration survived (duration=${JSON.stringify(bad.fields.duration)}) — an invalid paid option could reach a run payload`);
    // a legal value is left untouched
    const ok = { id: "n3", type: "tvideo", fields: { model: "m", duration: "10" } };
    sanitizeFields(ok);
    if (String(ok.fields.duration) !== "10")
      F.push(`SANITIZE: a legal duration was wrongly changed (duration=${JSON.stringify(ok.fields.duration)})`);
    // inpaint size not in SIZES → dropped
    const inp = { id: "n4", type: "inpaint", fields: { size: "9999x9999" } };
    sanitizeFields(inp);
    if ("size" in inp.fields && inp.fields.size != null)
      F.push(`SANITIZE: an out-of-catalog inpaint size survived (size=${JSON.stringify(inp.fields.size)})`);
    // vframes count over MAX_FRAMES → clamped
    const vf = { id: "n5", type: "vframes", fields: { frames: "20" } };
    sanitizeFields(vf);
    if (parseInt(vf.fields.frames, 10) > 8)
      F.push(`SANITIZE: a vframes count above the cap survived (frames=${JSON.stringify(vf.fields.frames)})`);
  }

  // 4. VALIDATE — cycles and portless links are rejected; a clean graph passes.
  {
    const okG = { nodes: [{ id: "n1", type: "text", fields: {} }, { id: "n2", type: "llm", fields: {} }],
      links: [{ from: "n1.text", to: "n2.prompt" }] };
    if (!validate(okG).ok)
      F.push(`VALIDATE: a legal feed-forward graph was rejected (${validate(okG).errs.join("; ")})`);

    // two llm nodes wired prompt↔text: every port is REAL, so the ONLY defect is the loop —
    // keeps this pin measuring the cycle check, not the new port check.
    const cyc = { nodes: [{ id: "n1", type: "llm", fields: {} }, { id: "n2", type: "llm", fields: {} }],
      links: [{ from: "n1.text", to: "n2.prompt" }, { from: "n2.text", to: "n1.prompt" }] };
    const cr = validate(cyc);
    if (cr.ok) F.push("VALIDATE: a cyclic graph was accepted — the run engine would loop");
    else if (!cr.errs.some((e) => /loop|flow one way/.test(e)))
      F.push(`VALIDATE: a cycle was rejected but without a loop-specific message (${cr.errs.join("; ")})`);

    // portless link (audit L3): "n1" has no `.port` → rejected (verified: shipped
    // code guards `!fp || !tp`, so this is a real pin, not a FINDING).
    const portless = { nodes: [{ id: "n1", type: "text", fields: {} }, { id: "n2", type: "llm", fields: {} }],
      links: [{ from: "n1", to: "n2.prompt" }] };
    const pr = validate(portless);
    if (pr.ok) F.push("VALIDATE: a portless link (no nodeId.port) was accepted");
    else if (!pr.errs.some((e) => /port/.test(e)))
      F.push(`VALIDATE: a portless link was rejected but without a port-specific message (${pr.errs.join("; ")})`);
  }

  // 5. PLACEMENT / LINK SHAPE — new nodes get numeric coords; survivors keep their
  //    spot; links normalize to the internal string form.
  {
    const prev = { nodes: [{ id: "n1", x: 100, y: 50 }] };
    const simple = { nodes: [{ id: "n1" }, { id: "n100" }],
      links: [{ from: "n1.text", to: "n100.prompt" }] };
    const pos = placeNew(simple, prev);
    if (!(pos.n1 && pos.n1.x === 100 && pos.n1.y === 50))
      F.push(`PLACEMENT: a surviving node lost its exact position (pos.n1=${JSON.stringify(pos.n1)})`);
    if (!(pos.n100 && Number.isFinite(pos.n100.x) && Number.isFinite(pos.n100.y)))
      F.push(`PLACEMENT: a new node got non-numeric coordinates (pos.n100=${JSON.stringify(pos.n100)})`);

    const norm = normalizeLinks([
      { from: { node: "n1", port: "text" }, to: { node: "n2", port: "prompt" } },
      { from: "n3.image", to: "n4.image" },
    ]);
    if (norm[0].from !== "n1.text" || norm[0].to !== "n2.prompt")
      F.push(`LINK SHAPE: object-form link not normalized to string form (${JSON.stringify(norm[0])})`);
    if (norm[1].from !== "n3.image" || norm[1].to !== "n4.image")
      F.push(`LINK SHAPE: already-string link was mangled (${JSON.stringify(norm[1])})`);

    // a new node lands with numeric coords through the full fromSimple path too.
    const out = fromSimple(simple, { nodes: [{ id: "n1", x: 100, y: 50, fields: {} }], links: [] });
    const nn = out.nodes.find((n) => n.id === "n100");
    if (!(nn && Number.isFinite(nn.x) && Number.isFinite(nn.y)))
      F.push(`PLACEMENT: fromSimple emitted a new node without numeric coords (${JSON.stringify(nn)})`);
    // …and a SURVIVOR keeps its EXACT spot through fromSimple (not just via placeNew):
    // fromSimple copies old.x/old.y straight over, so a described edit never nudges an
    // untouched node — the user's canvas layout is preserved.
    const sv = out.nodes.find((n) => n.id === "n1");
    if (!(sv && sv.x === 100 && sv.y === 50))
      F.push(`PLACEMENT: fromSimple moved a surviving node from its exact spot (x=${sv && sv.x}, y=${sv && sv.y}) — a described edit shifted an untouched node`);

    // diff sanity: it reports the changed field so the user's review panel isn't blank.
    const d = diff(
      { nodes: [{ id: "n1", type: "llm", fields: { prompt: "a" } }], links: [] },
      { nodes: [{ id: "n1", type: "llm", fields: { prompt: "b" } }], links: [] });
    if (!(d.changed && d.changed.length === 1 && d.changed[0].fields.some((f) => f.key === "prompt")))
      F.push(`DIFF: a changed prompt field was not reported (${JSON.stringify(d.changed)})`);
  }

  // 6. PORT EXISTS (audit L3) — a wire aimed at a port the target type doesn't have is rejected
  //    (else it applies as a phantom wire that looks connected but the run engine reads nothing
  //    from), while a wire to a REAL structural/field port still passes (no false alarm).
  {
    const phantom = { nodes: [{ id: "n1", type: "text", fields: {} }, { id: "n2", type: "image", fields: {} }],
      links: [{ from: "n1.text", to: "n2.styl" }] };   // image nodes have no "styl" input port
    const pr = validate(phantom);
    if (pr.ok) F.push("PORT EXISTS: a wire to a non-existent input port (n2.styl on an image node) was accepted — a phantom dead wire");
    else if (!pr.errs.some((e) => /port/.test(e) && /styl/.test(e)))
      F.push(`PORT EXISTS: the phantom input port was rejected but not named in the recap (${pr.errs.join("; ")})`);

    const badOut = { nodes: [{ id: "n1", type: "text", fields: {} }, { id: "n2", type: "image", fields: {} }],
      links: [{ from: "n1.imagine", to: "n2.prompt" }] };   // a text node only outputs "text"
    if (validate(badOut).ok) F.push("PORT EXISTS: a wire FROM a non-existent output port (n1.imagine) was accepted");

    const good = { nodes: [{ id: "n1", type: "text", fields: {} }, { id: "n2", type: "image", fields: {} }],
      links: [{ from: "n1.text", to: "n2.prompt" }] };   // image DOES have a wirable prompt field port
    if (!validate(good).ok)
      F.push(`PORT EXISTS: a legal wire to a real field port was wrongly rejected (${validate(good).errs.join("; ")})`);

    // dynamic slots still resolve: an edit node's image2 port and a tvideo ref1 port are real.
    const dyn = { nodes: [{ id: "n1", type: "image", fields: {} }, { id: "n2", type: "edit", fields: {} }],
      links: [{ from: "n1.image", to: "n2.image2" }] };
    if (!validate(dyn).ok)
      F.push(`PORT EXISTS: a real dynamic image slot (n2.image2) was wrongly rejected (${validate(dyn).errs.join("; ")})`);
  }

  return F;
}

// ---- self-test: mutate the source for the 3 load-bearing invariants and confirm
//      each mutation produces a POINTED failure (proves the check actually bites). ----
function selfTest() {
  const src = readFileSync(join(ROOT, "index.html"), "utf8");
  const cases = [
    { name: "media-carry", need: /MEDIA CARRY/,
      // stop carrying the stripped-away media fields
      from: "if(!(k in seen)) carried[k] = old.fields[k];",
      to:   "if(false) carried[k] = old.fields[k];" },
    { name: "sanitize-snap", need: /SANITIZE/,
      // never snap an out-of-range dim value back to its default
      from: "!d.options.some(o=> String(o[0])===String(cur))) f[d.f] = d.def;",
      to:   "!d.options.some(o=> String(o[0])===String(cur))) void 0;" },
    { name: "validate-cycle", need: /VALIDATE: a cyclic graph was accepted/,
      // drop the cycle error
      from: 'if(cyclic) errs.push("that change would create a loop — workflows must flow one way");',
      to:   'if(cyclic) void 0;' },
    { name: "phantom-port", need: /PORT EXISTS/,
      // stop rejecting a wire to a port the target type doesn't have (audit L3)
      from: "if(toN && NODE_TYPES[toN.type] && !inPortOk(toN.type, tp))",
      to:   "if(false && toN && NODE_TYPES[toN.type] && !inPortOk(toN.type, tp))" },
    { name: "deletion-respected", need: /DELETION RESPECTED/,
      // the pre-04520f1 regression: merge ALL old fields under the planner's, resurrecting
      // a field the planner deliberately omitted (audit M4)
      from: "const fields = { ...carried, ...(sn.fields||{}) };",
      to:   "const fields = { ...(old ? old.fields : {}), ...(sn.fields||{}) };" },
  ];
  const out = [];
  for (const c of cases) {
    if (!src.includes(c.from)) { out.push(`  ✗ ${c.name}: anchor not found — the mutation is stale`); continue; }
    const mutated = src.replace(c.from, c.to);
    let failures;
    try { failures = runInvariants(buildModule(mutated)); }
    catch (e) { out.push(`  ✗ ${c.name}: mutated build threw ${e.message}`); continue; }
    const hit = failures.some((f) => c.need.test(f));
    out.push(hit
      ? `  ✓ ${c.name}: caught (${failures.filter((f) => c.need.test(f)).length} pointed failure)`
      : `  ✗ ${c.name}: mutation NOT caught — check is blind here (got: ${failures.join(" | ") || "no failures"})`);
  }
  // sanity: the UNMUTATED source must pass clean, or the self-test proves nothing.
  const clean = runInvariants(buildModule(src));
  out.push(clean.length ? `  ✗ baseline: clean source has failures — ${clean.join(" | ")}` : "  ✓ baseline: clean source passes");
  return out;
}

// ---- main ----
if (process.argv.includes("--self-test")) {
  const lines = selfTest();
  process.stdout.write("describe-apply self-test:\n" + lines.join("\n") + "\n");
  process.exit(lines.some((l) => l.includes("✗")) ? 1 : 0);
}

let failures;
try {
  const src = readFileSync(join(ROOT, "index.html"), "utf8");
  failures = runInvariants(buildModule(src));
} catch (e) {
  process.stderr.write("✗ check-describe-apply harness error: " + (e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
}

if (failures.length) {
  process.stderr.write("✗ the describe-changes copilot apply path is broken:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ describe-changes apply path holds (media carry, deletion, sanitize, validate, placement).\n");
