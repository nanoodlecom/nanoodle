#!/usr/bin/env node
/* ======================================================================
   General single-file gptdiff editor — the SAME diff tool nanoodle's app
   builder uses (vendored gptdiff-js: buildEnvironment -> generateDiff ->
   parseDiffPerFile -> smartapply), but applied to any one file instead of
   the app shell. Each goal is one diff iteration; the file is rewritten in
   place and a per-iteration .diff is saved alongside.

   Usage:
     NANOGPT_API_KEY=... node gptdiff-edit.mjs <file> "goal 1" ["goal 2" ...]
   ====================================================================== */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { buildEnvironment, generateDiff, smartapply, parseDiffPerFile, callLlmForApply } from "../../vendor/gptdiff-js/index.js";

const NANOGPT = "https://nano-gpt.com";
const MODEL = process.env.GPTDIFF_MODEL || "xiaomi/mimo-v2.5-pro-ultraspeed";
const APPLY = process.env.GPTDIFF_APPLY || process.env.GPTDIFF_MODEL || "xiaomi/mimo-v2.5-pro-ultraspeed";
const KEY = process.env.NANOGPT_API_KEY;
if (!KEY) { console.error("NANOGPT_API_KEY not set"); process.exit(1); }
let COST = 0;
async function callLlm({ apiKey, baseUrl, model, messages, maxTokens = null, temperature = 1.0 }) {
  const endpoint = (baseUrl || (NANOGPT + "/api/v1/")).replace(/\/+$/, "") + "/chat/completions";
  const r = await fetch(endpoint, { method: "POST", headers: { Authorization: "Bearer " + (apiKey || KEY), "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, ...(maxTokens ? { max_tokens: maxTokens } : {}), temperature }) });
  if (!r.ok) throw new Error("LLM " + r.status + ": " + (await r.text()).slice(0, 200));
  const j = await r.json(); const p = j.x_nanogpt_pricing || {}; const u = p.costUsd ?? p.cost; if (u != null) COST += Number(u);
  return { choices: [{ message: { content: j.choices?.[0]?.message?.content ?? "" } }] };
}

const [file, ...goals] = process.argv.slice(2);
if (!file || !goals.length) { console.error('usage: node gptdiff-edit.mjs <file> "goal" ["goal2" ...]'); process.exit(1); }
const name = basename(file);
let content = readFileSync(file, "utf8");
let v = 0;
for (const goal of goals) {
  v++;
  process.stdout.write(`=== diff v${v}: "${goal.slice(0, 60)}${goal.length > 60 ? "…" : ""}" … `);
  const t0 = Date.now();
  const diff = await generateDiff(buildEnvironment({ [name]: content }), goal, { apiKey: KEY, model: MODEL, callLlm });
  if (!diff.trim() || !parseDiffPerFile(diff).length) { console.log(`no applicable change (${((Date.now()-t0)/1000).toFixed(1)}s)`); continue; }
  const updated = await smartapply(diff, { [name]: content }, { apiKey: KEY, model: APPLY,
    callLlmForApply: (p, o, d, m, o2) => callLlmForApply(p, o, d, m, { ...o2, callLlm }) });
  content = updated[name];
  writeFileSync(file, content);
  writeFileSync(file + `.v${v}.diff`, diff);
  console.log(`applied (${((Date.now()-t0)/1000).toFixed(1)}s, $${COST.toFixed(4)})`);
}
console.log(`DONE. ${v} iteration(s), $${COST.toFixed(4)} -> ${file}`);
