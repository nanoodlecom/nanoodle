#!/usr/bin/env node
// Guard the universal pricing resolver in BOTH engines (index.html editor + play.html runtime).
//
// NanoGPT keeps inventing new video pricing shapes (35+ live: per_second_by_resolution,
// per_duration, base_prices_by_resolution, a dozen raw.type=* dynamics, megapixel/frame
// billing…). videoUnitUsd()/chatUnitUsd()/audioUnitUsd() turn every one into a USD number so
// the model picker never shows a blank price and the "~$X to run" / "~$X / run" estimates are
// real. index.html and play.html carry SEPARATE copies of this resolver (the runtime can't import
// the editor's) — a fix to one that misses the other is the classic dual-engine drift. This
// asserts BOTH resolve every shape, so the two engines can't disagree.
//
// Fully offline (no API spend): pricing-fixtures.json holds one REAL pricing object captured per
// live shape. We extract the pure resolver functions straight out of each HTML file and assert
// every fixture resolves to a finite, non-negative number (chat may be a real $0 for
// subscription/router models). Re-capture fixtures when NanoGPT adds a shape.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = JSON.parse(fs.readFileSync(path.join(root, "scripts", "pricing-fixtures.json"), "utf8"));

// Slice the self-contained pricing block from a file: `const EST = {` up to the first function that
// touches app globals (that function name differs per engine). Everything between is pure math.
function loadResolver(file, endMarker){
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const start = html.indexOf("const EST = {");
  const end = html.indexOf(endMarker);
  if(start < 0 || end < 0 || end < start){
    throw new Error(`could not locate the pricing block in ${file} (markers \`const EST = {\` … \`${endMarker}\`). If you renamed those, update scripts/check-pricing.mjs.`);
  }
  const block = html.slice(start, end);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(block + "\nthis.videoUnitUsd=videoUnitUsd; this.chatUnitUsd=chatUnitUsd; this.audioUnitUsd=audioUnitUsd; this.audioBilledSeconds=audioBilledSeconds; this.audioBilledSongs=audioBilledSongs;", sandbox);
  return sandbox;
}

// Each engine: [file, marker]. index normalizes chat pricing to promptUsd1M; play reads the raw
// catalog's pricing.prompt. The fixtures carry BOTH key sets so the same object works for either.
const ENGINES = [
  { name: "index.html (editor)", file: "index.html", end: "function nodeUnitUsd(" },
  { name: "play.html (runtime)", file: "play.html",  end: "async function nodeUnitUsdPlay(" },
];

let fail = 0;
for(const eng of ENGINES){
  let R;
  try { R = loadResolver(eng.file, eng.end); }
  catch(e){ console.error(`✗ ${eng.name}: ${e.message}`); fail++; continue; }

  const bad = (kind, id, shape, val)=>{ fail++; console.error(`  ✗ [${eng.name}] ${kind} ${id} (${shape||""}) → ${val}`); };
  for(const f of fixtures.video || []){ const v = R.videoUnitUsd(f.pricing, {}); if(v == null || !isFinite(v) || v < 0) bad("video", f.id, f.shape, v); }
  for(const f of fixtures.audio || []){ const v = R.audioUnitUsd(f.pricing);       if(v == null || !isFinite(v) || v < 0) bad("audio", f.id, f.shape, v); }
  for(const f of fixtures.chat  || []){ const v = R.chatUnitUsd(f, undefined, undefined); if(v == null || !isFinite(v) || v < 0) bad("chat", f.id, f.shape, v); }

  // Duration-aware per_second audio (Bug #1): a per_second music model with min/max_duration must meter
  // off the node's chosen duration (clamped to the model's range), not a flat EST.audioSeconds. A model
  // with no min/max_duration ignores the field and keeps the default estimate. Both engines must agree.
  for(const f of fixtures.audioDuration || []){
    for(const c of (f.cases || [])){
      const secs = R.audioBilledSeconds(f.params, { duration: c.duration });
      const v = R.audioUnitUsd(f.pricing, undefined, secs);
      if(v == null || !isFinite(v) || Math.abs(v - c.expect) > 1e-9)
        bad("audioDuration", f.id, `${f.shape} @ duration=${JSON.stringify(c.duration)}`, `${v} (expected ${c.expect})`);
    }
  }

  // Generation-count multiplier (PR #186 follow-up): number_of_songs multiplies the estimate ONLY when
  // the model advertises a generation_count_parameter — the same catalog signal collectAudioParams gates
  // the SEND on. A model without it (e.g. ACE-Step) drops a stale count from the request and makes ONE
  // song, so the "~$X to run" chip must NOT show 3× the price. Both engines must agree on the multiplier.
  for(const f of fixtures.audioSongs || []){
    for(const c of (f.cases || [])){
      const songs = R.audioBilledSongs(f.params, { number_of_songs: c.number_of_songs });
      if(songs !== c.expect)
        bad("audioSongs", f.id, `${f.shape} @ number_of_songs=${JSON.stringify(c.number_of_songs)}`, `${songs}× (expected ${c.expect}×)`);
    }
  }
}

const durCases = (fixtures.audioDuration||[]).reduce((n,f)=> n + (f.cases?.length||0), 0);
const songCases = (fixtures.audioSongs||[]).reduce((n,f)=> n + (f.cases?.length||0), 0);
const total = ((fixtures.video?.length||0) + (fixtures.audio?.length||0) + (fixtures.chat?.length||0) + durCases + songCases) * ENGINES.length;
if(fail){
  console.error(`\n✗ ${fail} pricing checks failed across ${ENGINES.length} engines — a resolver branch is missing or the two engines drifted.`);
  process.exit(1);
}
console.log(`✓ every pricing shape resolves in both engines (${fixtures.video?.length||0} video, ${fixtures.audio?.length||0} audio, ${fixtures.chat?.length||0} chat, ${durCases} audio-duration, ${songCases} audio-songs × ${ENGINES.length} engines = ${total} checks).`);
