#!/usr/bin/env node
/*
  Live check of what the trim actually costs, on the graph from the bug report.
  (album background → art-director system prompt → image prompt → Qwen Image 3, cap 800)

  Nothing here nudges the LLM: the graph's prompts go to the model exactly as the user wrote them,
  which is the point. So the question this answers is the honest one — how much of a real generated
  image prompt does the boundary trim keep, and does what's left still produce an image on the model
  that rejected the full text?

  Uses the REAL fitPromptText lifted out of index.html, so this measures what ships.

  Hand-run, spends a few cents of LLM plus one $0.075 image:
      NANOGPT_API_KEY=… node proof/prompt-caps/verify-trim.mjs
      NANOGPT_API_KEY=… node proof/prompt-caps/verify-trim.mjs --no-image
*/
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const KEY = process.env.NANOGPT_API_KEY;
if (!KEY) { console.error("NANOGPT_API_KEY is required"); process.exit(1); }

const ctx = { console };
vm.createContext(ctx);
const grab = (anchor) => {
  const start = IDX.indexOf(anchor); let depth = 0;
  for (let j = IDX.indexOf("{", start); j < IDX.length; j++) {
    if (IDX[j] === "{") depth++; else if (IDX[j] === "}" && --depth === 0) return IDX.slice(start, j + 1);
  }
};
vm.runInContext(grab("function fitPromptText(s, cap){"), ctx);

const CAP = 800;
const SYSTEM = "You are an art director for album covers. Given album background and a specific track, write a vivid, descriptive image prompt for the cover art of that track.";
const USER = `Album: Neon Mirage

Background: A synthwave record exploring the intersection of memory and technology in late-night cityscapes. The mood is nostalgic but forward-looking, with warm analog textures cutting through digital precision.

Track 3: "Midnight Protocol"

Lyrics:
[Verse 1]
Streetlights flicker in the rain
Every signal calls your name
Data streams in neon blue
All I want is to find you

[Chorus]
Midnight protocol, running through the night
Chasing down your signal till the morning light
Midnight protocol, echoes in the wire
Every beat a memory, every spark a fire`;

const MODELS = ["celeris-1", "openai/gpt-5-nano", "deepseek-chat", "claude-haiku-4-5-20251001", "meta-llama/llama-4-scout"];

async function chat(model) {
  const r = await fetch("https://nano-gpt.com/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
    body: JSON.stringify({ model, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: USER }] }),
  });
  const t = await r.text();
  if (!r.ok) return { err: r.status + " " + t.slice(0, 120) };
  const j = JSON.parse(t);
  const c = j.choices && j.choices[0] && j.choices[0].message;
  return { text: ((c && c.content) || "").trim() };
}

console.log("Qwen Image 3 caps prompts at " + CAP + " characters. What a real LLM writes, and what survives:\n");
console.log("model".padEnd(30) + "written".padEnd(10) + "sent".padEnd(8) + "kept".padEnd(8) + "cut at");

let worst = null;
for (const m of MODELS) {
  const { text, err } = await chat(m);
  if (err) { console.log(m.padEnd(30) + "— " + err); continue; }
  const cut = ctx.fitPromptText(text, CAP);
  const pct = Math.round((cut.length / text.length) * 100);
  const boundary = cut.length === text.length ? "—" : (/[.!?]$/.test(cut) ? "sentence end" : "word");
  console.log(m.padEnd(30) + String(text.length).padEnd(10) + String(cut.length).padEnd(8) + (pct + "%").padEnd(8) + boundary);
  if (cut.length < text.length && (!worst || cut.length > (worst.cut || "").length)) worst = { text, cut: cut };
}

console.log("\nEvery prompt over " + CAP + " is trimmed — the node says so before the run and again after it.");
if (process.argv.includes("--no-image") || !worst) process.exit(0);

const r = await fetch("https://nano-gpt.com/v1/images/generations", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
  body: JSON.stringify({ model: "qwen-image-3", prompt: worst.cut, size: "1024x1024", n: 1, response_format: "b64_json" }),
});
const body = await r.text();
console.log("\nqwen-image-3 with the trimmed " + worst.cut.length + "-char prompt (was " + worst.text.length + ") → " + r.status +
            (r.ok ? " ✓ image returned (" + Math.round(body.length / 1024) + " kB)" : " ✗ " + body.slice(0, 200)));
process.exit(r.ok ? 0 : 1);
