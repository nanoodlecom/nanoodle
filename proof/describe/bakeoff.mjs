// Live bake-off: for each (strategy, model, case) ask nano-gpt to edit the graph, then
// apply + validate. Prints a scorecard. Run: node proof/describe/bakeoff.mjs
import { systemPrompt, userPrompt, applyStrategy, toSimple, validateGraph } from "./core.mjs";

const KEY = process.env.NANOGPT_API_KEY;
if(!KEY){ console.error("set NANOGPT_API_KEY"); process.exit(1); }
const H = { Authorization:"Bearer "+KEY, "x-api-key":KEY, "Content-Type":"application/json" };

// curated model shortlist injected into the prompt (real ids confirmed present in the catalog)
const MODELS = {
  chat:  ["moonshotai/kimi-k2-instruct","openai/gpt-oss-120b","Qwen/Qwen3-235B-A22B-Instruct-2507"],
  image: ["hidream-i1-fast","flux/dev","recraft-v3"],
  video: ["kling-v26-pro","pruna-ai/p-video/image-to-video"],
  audio: ["mureka-ai/mureka-v9/generate-song","Elevenlabs-Music-V1"],
};

// the shipped seed graph (lyrics -> style -> song), simplified
const SEED = {
  nodes: [
    { id:"n18", type:"text", fields:{ text:"Write a 90s trip hop song. Repeat the hook." } },
    { id:"n17", type:"llm",  fields:{ model:"xiaomi/mimo-v2.5-pro-ultraspeed", system:"You are an 80s singer-songwriter writing lyrics." } },
    { id:"n24", type:"llm",  fields:{ model:"zai-org/glm-5.2:thinking", system:"You come up with a musical style that fits the given lyrics." } },
    { id:"n19", type:"music",fields:{ model:"mureka-ai/mureka-v9/generate-song", instrumental:false } },
  ],
  links: [
    { from:"n18.text", to:"n17.prompt" },
    { from:"n17.text", to:"n19.lyrics" },
    { from:"n24.text", to:"n19.prompt" },
    { from:"n17.text", to:"n24.prompt" },
  ],
};
const EMPTY = { nodes:[], links:[] };

const CASES = [
  { name:"empty->haiku-image", graph:EMPTY, instr:"Build a flow that writes a haiku about the ocean with an LLM, then generates an image from that haiku." },
  { name:"empty->tts", graph:EMPTY, instr:"Make a text box that feeds a speech (TTS) node so I can hear typed text spoken." },
  { name:"seed+tts", graph:SEED, instr:"Also speak the generated lyrics aloud with a TTS node." },
  { name:"seed-instrumental", graph:SEED, instr:"Make the song instrumental." },
  { name:"seed-swap-vision", graph:EMPTY, instr:"Upload an image, describe it with a vision model, then turn that description into a video." },
  { name:"seed-remove", graph:SEED, instr:"Remove the musical-style LLM node; just send the lyrics straight to the music node." },
];

async function chat(model, sys, usr){
  const r = await fetch("https://nano-gpt.com/api/v1/chat/completions", {
    method:"POST", headers:H,
    body: JSON.stringify({ model, messages:[{role:"system",content:sys},{role:"user",content:usr}], temperature:0, max_tokens:8000 }),
  });
  if(!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0,120)}`);
  const j = await r.json();
  const m = j.choices?.[0]?.message || {};
  let c = m.content || "";
  if(!c && m.reasoning) c = m.reasoning;   // some reasoning models leak JSON only into reasoning
  if(!c) throw new Error("empty content (finish="+j.choices?.[0]?.finish_reason+")");
  return c;
}

const STRATEGIES = ["full","ops","udiff"];
const TEST_MODEL = process.argv[2] || "openai/gpt-oss-120b";

const score = Object.fromEntries(STRATEGIES.map(s=>[s,{parse:0,apply:0,valid:0,total:0}]));
const rows = [];

for(const c of CASES){
  const simple = c.graph;   // CASES graphs are already in simplified form
  for(const strat of STRATEGIES){
    const rec = { case:c.name, strat, model:TEST_MODEL, ok:"", err:"" };
    score[strat].total++;
    try{
      const sys = systemPrompt(strat, MODELS);
      const usr = userPrompt(strat, simple, c.instr);
      const out = await chat(TEST_MODEL, sys, usr);
      rec.raw = out.length;
      let applied;
      try{ applied = applyStrategy(strat, simple, out); score[strat].parse++; score[strat].apply++; }
      catch(e){ rec.err = "apply: "+e.message; rec.sample = out.slice(0,160); rows.push(rec); continue; }
      const v = validateGraph(applied.simple);
      if(v.ok){ score[strat].valid++; rec.ok = "PASS"; rec.nodes = applied.simple.nodes.length; rec.links = applied.simple.links.length; }
      else { rec.err = "invalid: "+v.errors.join("; "); }
    }catch(e){ rec.err = "llm: "+e.message; }
    rows.push(rec);
    process.stderr.write(`. ${c.name}/${strat} ${rec.ok||rec.err}\n`);
  }
}

console.log("\n=== RESULTS (model: "+TEST_MODEL+") ===");
for(const r of rows){
  console.log(`${(r.case+"/"+r.strat).padEnd(34)} ${r.ok==="PASS"?"PASS":"FAIL"} ${r.ok==="PASS"?`(${r.nodes}n ${r.links}l)`:r.err}`);
}
console.log("\n=== SCORECARD ===");
for(const s of STRATEGIES){
  const x=score[s];
  console.log(`${s.padEnd(7)} parse ${x.parse}/${x.total}  apply ${x.apply}/${x.total}  valid ${x.valid}/${x.total}`);
}
