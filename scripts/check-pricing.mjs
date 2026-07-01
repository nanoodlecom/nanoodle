#!/usr/bin/env node
// Guard the universal pricing resolver in index.html.
//
// NanoGPT keeps inventing new video pricing shapes (35+ live: per_second_by_resolution,
// per_duration, base_prices_by_resolution, a dozen raw.type=* dynamics, megapixel/frame
// billing…). videoUnitUsd()/chatUnitUsd()/audioUnitUsd() turn every one into a USD number so
// the model picker never shows a blank price and the bottom-right "~$X to run" estimate is real.
// A refactor that drops a branch would silently reintroduce blanks — this catches that offline.
//
// Fully offline (no API spend): pricing-fixtures.json holds one REAL pricing object captured per
// live shape. We extract the pure resolver functions straight out of index.html and assert each
// fixture resolves to a finite, non-negative number (chat may be a real $0 for subscription/router
// models). Re-capture fixtures when NanoGPT adds a shape (see how they were generated in the PR).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const fixtures = JSON.parse(fs.readFileSync(path.join(root, "scripts", "pricing-fixtures.json"), "utf8"));

// Slice the self-contained pricing block: from `const EST = {` up to (but not including) the first
// function that touches app globals (`function nodeUnitUsd`). Everything in between is pure.
const start = html.indexOf("const EST = {");
const end = html.indexOf("function nodeUnitUsd(");
if(start < 0 || end < 0 || end < start){
  console.error("✗ could not locate the pricing block in index.html (markers `const EST = {` … `function nodeUnitUsd(`).");
  console.error("  If you renamed those, update scripts/check-pricing.mjs to match.");
  process.exit(1);
}
const block = html.slice(start, end);

const sandbox = {};
vm.createContext(sandbox);
try {
  vm.runInContext(block + "\nthis.videoUnitUsd=videoUnitUsd; this.chatUnitUsd=chatUnitUsd; this.audioUnitUsd=audioUnitUsd;", sandbox);
} catch(e){
  console.error("✗ pricing block failed to evaluate:", e.message);
  process.exit(1);
}
const { videoUnitUsd, chatUnitUsd, audioUnitUsd } = sandbox;

let fail = 0;
const bad = (kind, id, shape, val)=>{ fail++; console.error(`  ✗ [${kind}] ${id}  (${shape||""}) → ${val}`); };

for(const f of fixtures.video || []){
  const v = videoUnitUsd(f.pricing, {});
  if(v == null || !isFinite(v) || v < 0) bad("video", f.id, f.shape, v);
}
for(const f of fixtures.audio || []){
  const v = audioUnitUsd(f.pricing);
  if(v == null || !isFinite(v) || v < 0) bad("audio", f.id, f.shape, v);
}
for(const f of fixtures.chat || []){
  const v = chatUnitUsd(f, undefined, undefined);   // uses EST token defaults
  if(v == null || !isFinite(v) || v < 0) bad("chat", f.id, f.shape, v);
}

const total = (fixtures.video?.length||0) + (fixtures.audio?.length||0) + (fixtures.chat?.length||0);
if(fail){
  console.error(`\n✗ ${fail}/${total} pricing fixtures did not resolve to a usable number — a resolver branch is missing.`);
  process.exit(1);
}
console.log(`✓ every pricing shape resolves to a number (${total} fixtures: ${fixtures.video?.length||0} video, ${fixtures.audio?.length||0} audio, ${fixtures.chat?.length||0} chat).`);
