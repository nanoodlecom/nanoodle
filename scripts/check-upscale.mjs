#!/usr/bin/env node
// Pins the AI-upscale path through the Edit node — a dual-engine (index.html +
// play.html) invariant with a history of twin drift.
//
// Upscalers (model ids matching /upscal/) enlarge an image and take NO text
// instruction. Two things must hold, in BOTH engines, or the path dead-ends or
// posts a malformed paid call:
//
//   1. The Edit node's run() must NOT throw "no edit instruction" when the
//      selected model is an upscaler — the prompt-required guard is gated by
//      /upscal/i.test(n.fields.model).
//   2. genImage() must OMIT an empty prompt from the request body (build the
//      body without `prompt`, then add it only when non-empty). Every other
//      image path guarantees a non-empty prompt before reaching genImage, so
//      the only caller that reaches it blank is the upscale edit.
//
// Source-assertion check (no browser, no network, no spend). It intentionally
// does not assert the upscaler's send CONTRACT (scale factor vs target size) —
// that is catalog/fixture-derived and unverified; see the PR body.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
const fail = (m) => fails.push(m);

for (const file of ["index.html", "play.html"]) {
  const src = readFileSync(join(ROOT, file), "utf8");

  // 1. Edit run(): the "no edit instruction" throw must be gated on the upscale
  //    model check so a blank-prompt upscale run is allowed through.
  const throwRe = /if\(!prompt && !\/upscal\/i\.test\(n\.fields\.model\|\|""\)\) throw new Error\("no edit instruction/;
  if (!throwRe.test(src))
    fail(`${file}: Edit run() must gate the "no edit instruction" throw on !/upscal/i.test(n.fields.model||"") so upscalers run promptless`);

  // Guard against a stray un-gated "no edit instruction" throw creeping back in.
  const ungated = /if\(!prompt\) throw new Error\("no edit instruction/;
  if (ungated.test(src))
    fail(`${file}: found an UN-gated "if(!prompt) throw no edit instruction" — upscalers would dead-end`);

  // 2. genImage(): the request body literal must not hard-include `prompt`; it
  //    must be added conditionally so a blank prompt is never sent.
  const bodyLit = /const body = \{ model, size, n: opts\.n\|\|1, response_format:"b64_json" \};/;
  if (!bodyLit.test(src))
    fail(`${file}: genImage() body literal must be { model, size, n, response_format } (no bare 'prompt' key)`);
  if (/const body = \{ model, prompt, size,/.test(src))
    fail(`${file}: genImage() still hard-includes 'prompt' in the body literal — a blank upscale prompt would be sent`);
  const condPrompt = /if\(prompt\) body\.prompt = prompt;/;
  if (!condPrompt.test(src))
    fail(`${file}: genImage() must add the prompt conditionally — 'if(prompt) body.prompt = prompt;'`);
}

if (fails.length) {
  console.error("check-upscale: FAIL");
  for (const m of fails) console.error("  - " + m);
  process.exit(1);
}
console.log("check-upscale: ok (upscale prompt-optional path pinned in both engines)");
