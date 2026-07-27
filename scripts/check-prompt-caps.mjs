#!/usr/bin/env node
// Prompt-length caps: the wired prompt nobody can shorten.
//
// Many image/video models reject an over-long prompt at NanoGPT's route with 400 prompt_too_long.
// It costs nothing, but it's a dead end — the prompt is usually WIRED from an LLM, so "shorten it
// to 800 characters" points at a field with no keyboard behind it. The shipped answer:
//   1. trim to fit at a sentence boundary (fitPromptText) — and SAY SO, before the run (the node's
//      cap note) and after it (toast + a note that stays). The disclosure is the deal that makes
//      trimming acceptable; a silent trim would be a bug, so it's pinned as hard as the trim is;
//   2. learn an unknown cap from the live 400 (promptCapFromError) so the next run states the
//      limit up front instead of discovering it;
//   3. NEVER edit anyone's prompt to avoid a trim. No node's fields — an LLM's system prompt least
//      of all — may be rewritten on the way to the model. That's pinned below too.
//
// This pins it offline by extracting the REAL helpers from index.html and play.html and
// driving them. No network, no API spend (the live probe that GENERATED the table is a separate,
// hand-run script: scripts/probe-prompt-caps.mjs).
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);
const check = (cond, m) => { cond ? ok(m) : fail(m); };

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
const line = (src, needle) => {
  const i = src.indexOf(needle);
  if (i === -1) throw new Error("line not found: " + needle);
  return src.slice(i, src.indexOf("\n", i));
};
const capsBlock = (src) => {
  const a = src.indexOf("/* === PROMPT-CAPS-BEGIN === */"), b = src.indexOf("/* === PROMPT-CAPS-END === */");
  if (a < 0 || b < 0) throw new Error("PROMPT-CAPS markers not found");
  return src.slice(a, b);
};

// ---------------------------------------------------------------- table parity
// Both engines must read the SAME caps: an app exported from the editor has to fit exactly what
// the editor fit, or the same graph produces two different prompts.
{
  const a = capsBlock(IDX).replace(/\s+/g, " ").trim();
  const b = capsBlock(PLAY).replace(/\s+/g, " ").trim();
  check(a === b, "PROMPT_CAPS is identical in index.html and play.html (regenerate BOTH — scripts/probe-prompt-caps.mjs writes both)");
  const caps = JSON.parse(a.slice(a.indexOf("{"), a.lastIndexOf("}") + 1));
  check(caps.image["qwen-image-3"] === 800,
    "the reported model is in the table (qwen-image-3 = 800, live-verified 2026-07-26)");
  check(Object.values(caps.image).every((v) => Number.isInteger(v) && v >= 100 && v <= 100000),
    "every image cap is a plausible integer character count");
  check(Object.keys(caps.video).length > 0,
    "video models carry caps too (they hit the same wall: minimax-hailuo-02 = 2000, live-verified)");
}

// ---------------------------------------------------------------- editor helpers
const ctx = {
  console,
  document: undefined,
  localStorage: { getItem: () => null, setItem: () => {} },
  NODE_TYPES: {
    llm:    { modelKind: "chat" },
    text:   {},
    image:  { modelKind: "image" },
    tvideo: { modelKind: "video" },
    tts:    { modelKind: "audio" },
  },
  catalogs: { image: [{ id: "qwen-image-3", name: "Qwen Image 3" }], audio: [{ id: "tts-1", name: "TTS 1", params: { max_chars: 4096 } }] },
  graph: { nodes: [], links: [] },
};
ctx.byId = (id) => ctx.graph.nodes.find((n) => n.id === id);
vm.createContext(ctx);
vm.runInContext([
  line(IDX, "const catItem = (kind,id)=>").replace("const catItem", "var catItem"),
  capsBlock(IDX).replace("const PROMPT_CAPS", "var PROMPT_CAPS"),
  line(IDX, 'const LEARNED_CAPS_KEY = "nn_prompt_caps"').replace("const ", "var "),
  line(IDX, "let learnedCaps =").replace("let ", "var "),
  block(IDX, "function learnPromptCap(kind, id, cap){"),
  block(IDX, "function promptCap(n){"),
  line(IDX, "const modelLabel = (n)=>").replace("const ", "var "),
  block(IDX, "function fitPromptText(s, cap){"),
  block(IDX, "function withFittedPrompt(rn, n){"),
  line(IDX, "const PROMPT_TOO_LONG_RE =").replace("const ", "var "),
  line(IDX, "const isPromptTooLong =").replace("const ", "var "),
  block(IDX, "function promptCapFromError(msg){"),
].join("\n"), ctx);

// ---------------------------------------------------------------- resolving a cap
{
  const img = (model) => ({ id: "i1", type: "image", fields: { model } });
  check(ctx.promptCap(img("qwen-image-3")) === 800, "promptCap reads the probe table for image models");
  check(ctx.promptCap(img("flux-kontext")) === null, "an uncapped model stays uncapped (null, never a guessed default)");
  check(ctx.promptCap({ type: "llm", fields: { model: "gpt-5" } }) === null,
    "chat models are never capped here — an LLM's limit is tokens, and it isn't the one being fitted");
  check(ctx.promptCap({ type: "tts", fields: { model: "tts-1" } }) === 4096,
    "audio caps come from live catalog metadata (supported_parameters.max_chars), not the table");
  // A cap we learn from a live 400 must beat the baked table — the table is a snapshot, the 400 is today.
  ctx.learnPromptCap("image", "qwen-image-3", 640);
  check(ctx.promptCap(img("qwen-image-3")) === 640, "a learned cap overrides the generated table");
  ctx.learnPromptCap("image", "qwen-image-3", 800);
}

// ---------------------------------------------------------------- nobody's prompt gets rewritten
{
  // The line this feature does not cross: a graph's own text — an LLM's system prompt above all —
  // reaches the model exactly as written. Shortening a prompt to dodge a cap is the user's call to
  // make in their own words, not something to inject on their behalf.
  for (const [file, src] of [["index.html", IDX], ["play.html", PLAY]]) {
    check(!/withPromptBudget|promptBudgetDirective|PROMPT_BUDGET_SOURCES/.test(src),
      file + ": no upstream prompt-budget injection — a length directive is never appended to anyone's system prompt");
    const capsBody = src.slice(src.indexOf("PROMPT LENGTH CAPS"), src.indexOf("function fitPromptText"));
    check(!/fields\s*:\s*\{[^}]*\bsystem\s*:/.test(capsBody),
      file + ": the cap code never writes a `system` field at all");
  }
  const run = IDX.slice(IDX.indexOf("const rn0 = Object.keys(fieldOverrides).length"), IDX.indexOf("const sig = nodeSig(rn, inp)"));
  check(/const fitted = withFittedPrompt\(rn0, n\);/.test(run),
    "the run loop's only cap step is the fit — nothing else touches the resolved node on the way out");
}

// ---------------------------------------------------------------- fitting, when the LLM overshoots
{
  const sentence = "A neon city at night. Rain slicks the street. A lone figure walks toward the camera. Extra tail that overflows the cap and must go.";
  const cut = ctx.fitPromptText(sentence, 90);
  check(cut.length <= 90, "a fitted prompt never exceeds the cap");
  check(cut.endsWith("."), "the cut lands on a sentence boundary, not mid-thought");
  check(cut.length >= 63, "a boundary cut never throws away more than the overflow did (≥70% of the cap kept)");

  const noSentences = "a ".repeat(200);
  const w = ctx.fitPromptText(noSentences, 100);
  check(w.length <= 100 && !/\s$/.test(w), "with no sentence end, it falls back to a word boundary — never mid-word");

  const oneWord = "x".repeat(500);
  check(ctx.fitPromptText(oneWord, 100).length === 100, "one unbroken 500-char token still fits (hard cut is the last resort)");
  check(ctx.fitPromptText("short", 100) === "short", "a prompt already inside the cap is returned untouched");

  // the whole point: it's announced, and the caller decides when
  const n = { id: "i1", type: "image", fields: { model: "qwen-image-3", prompt: "z".repeat(900) } };
  const r = ctx.withFittedPrompt(n, n);
  check(r.rn.fields.prompt.length <= 800 && r.trimmed && r.trimmed.from === 900,
    "withFittedPrompt fits an over-long prompt and reports what it cut (from 900)");
  check(n.fields.prompt.length === 900, "the node's own prompt is not rewritten — only the request is fitted");
  const fits = { id: "i2", type: "image", fields: { model: "qwen-image-3", prompt: "z".repeat(100) } };
  check(ctx.withFittedPrompt(fits, fits).trimmed === null, "a prompt that fits reports no trim (nothing to announce)");
}

// ---------------------------------------------------------------- learning from the live 400
{
  // All three live shapes, verified against nano-gpt.com on 2026-07-26.
  const shapes = [
    ['400: {"error":"Your prompt is too long for Qwen Image 3. Please shorten it to 800 characters or less (current: 831 characters).","code":"prompt_too_long"}', 800],
    ['400: {"error":{"message":"Your prompt is too long for Step Image Edit 2. Please shorten it to 512 characters or less (current: 5999 characters).","code":"prompt_too_long"}}', 512],
    ['400: {"error":"Prompt is too long. Please keep it under 3000 characters."}', 3000],
  ];
  for (const [body, want] of shapes) {
    check(ctx.isPromptTooLong(body), "recognised as a prompt-length rejection: " + body.slice(14, 54) + "…");
    check(ctx.promptCapFromError(body) === want, "…and the cap read out of it is " + want);
  }
  // "(current: 5,999 characters)" is the length we SENT. Reading it as the cap would teach a limit
  // that grows with every failure — the model would never be prevented, only re-broken.
  check(ctx.promptCapFromError(shapes[1][0]) !== 5999,
    "the 'current:' length is never mistaken for the cap (a learned 5999 would defeat the whole mechanism)");
  check(ctx.promptCapFromError("400: something else entirely") === null, "an unrelated 400 teaches nothing");
  check(!ctx.isPromptTooLong('400: {"error":"Invalid image input."}'), "an unrelated 400 isn't routed as a prompt-length problem");
}

// ---------------------------------------------------------------- wiring pins
{
  // The fit has to land BEFORE nodeSig, or the signature describes a request we didn't send —
  // switching the Image node to a tighter model would then reuse the cached over-long result.
  const runLoop = IDX.slice(IDX.indexOf("const rn0 = Object.keys(fieldOverrides).length"));
  const iFit = runLoop.indexOf("withFittedPrompt(rn0, n)");
  const iSig = runLoop.indexOf("const sig = nodeSig(rn, inp)");
  check(iFit > -1 && iSig > -1 && iFit < iSig,
    "the editor fits BEFORE nodeSig, so the signature describes what actually goes out (swap to a tighter model and the run re-rolls)");
  check(/if\(fitted\.trimmed\) announcePromptFit\(n, fitted\.trimmed\)/.test(IDX),
    "a trim is announced (toast + a note that stays on the node) — a shorter prompt than the user wrote is never silent");
  check(IDX.indexOf("if(fitted.trimmed) announcePromptFit") > IDX.indexOf('setStatus(n, "run")'),
    "…and only for a request actually sent: the announcement sits after the seed/reuse skips");
  check(/friendlyRunError\(err, n\)/.test(IDX), "the editor hands the node to friendlyRunError so an unknown cap can be learned against its model");

  const playLoop = PLAY.slice(PLAY.indexOf("let rn = Object.keys(fieldOverrides).length"));
  const pFit = playLoop.indexOf("await withFittedPrompt(rn, n)");
  const pSig = playLoop.indexOf("const sig = nodeSig(rn, inp)");
  check(pFit > -1 && pSig > -1 && pFit < pSig,
    "exported apps do the same, in the same place — an app hits this wall harder (its user can't edit the prompt at all)");
  check(/prompt trimmed to " \+ fitted\.trimmed\.cap/.test(PLAY),
    "…and an app says when it trimmed, too — a silent trim in someone else's app is the worst version of this");
  check(/friendlyRunError\(err, n\)/.test(PLAY), "…and learn the cap the same way");
}

console.log(failed ? "" : "\n✓ prompt caps: trim at a boundary, say so before and after, learn what we didn't know — and never rewrite anyone's prompt. Both engines.");
process.exit(failed ? 1 : 0);
