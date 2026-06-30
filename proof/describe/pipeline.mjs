// Prove the SHIPPING design end-to-end: full-graph rewrite + locally computed diff preview
// + layout-preserving apply. Renders the diff exactly as the UI will.
import { systemPrompt, userPrompt, applyStrategy, diffSimple, fromSimple, validateGraph } from "./core.mjs";

const KEY=process.env.NANOGPT_API_KEY;
const H={Authorization:"Bearer "+KEY,"x-api-key":KEY,"Content-Type":"application/json"};
const MODELS={
  chat:["moonshotai/kimi-k2-instruct","openai/gpt-oss-120b"],
  image:["hidream-i1-fast","flux/dev","recraft-v3"],
  video:["kling-v26-pro"], audio:["mureka-ai/mureka-v9/generate-song"],
};
const MODEL = process.argv[2] || "gemini-2.5-flash";

// internal-format seed (as serializeGraph emits it), to prove layout preservation
const SEED_INTERNAL = {
  v:1,
  nodes:[
    { id:"n18", type:"text", x:200, y:-120, fields:{ text:"Write a 90s triphop. Repeat the hook." } },
    { id:"n17", type:"llm",  x:500, y:-200, w:213, sizes:{system:155}, fields:{ model:"xiaomi/mimo-v2.5-pro-ultraspeed", system:"You are an 80s singer-songwriter writing lyrics." } },
    { id:"n24", type:"llm",  x:780, y:90,  fields:{ model:"zai-org/glm-5.2:thinking", system:"You come up with a musical style." } },
    { id:"n19", type:"music",x:1080,y:-190, fields:{ model:"mureka-ai/mureka-v9/generate-song", instrumental:false } },
  ],
  links:[
    { id:"l13", from:{node:"n18",port:"text"}, to:{node:"n17",port:"prompt"} },
    { id:"l19", from:{node:"n17",port:"text"}, to:{node:"n19",port:"lyrics"} },
    { id:"l23", from:{node:"n24",port:"text"}, to:{node:"n19",port:"prompt"} },
    { id:"l40", from:{node:"n17",port:"text"}, to:{node:"n24",port:"prompt"} },
  ],
  nid:42, lid:42, view:{panX:0,panY:0,scale:1},
};

// mirror index.html toSimple on the INTERNAL format
function internalToSimple(g){
  return {
    nodes:(g.nodes||[]).map(n=>({id:n.id,type:n.type,fields:Object.fromEntries(Object.entries(n.fields||{}).filter(([,v])=>v!==""&&v!=null))})),
    links:(g.links||[]).map(l=>({from:`${l.from.node}.${l.from.port}`,to:`${l.to.node}.${l.to.port}`})),
  };
}

async function chat(sys,usr){
  const r=await fetch("https://nano-gpt.com/api/v1/chat/completions",{method:"POST",headers:H,
    body:JSON.stringify({model:MODEL,messages:[{role:"system",content:sys},{role:"user",content:usr}],temperature:0,max_tokens:8000})});
  if(!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0,120)}`);
  const j=await r.json();const m=j.choices?.[0]?.message||{};
  return m.content || m.reasoning || "";
}

function renderDiff(d){
  const L=[];
  const port=s=>s;
  for(const n of d.added)        L.push(`  + add ${n.type} node (${n.id})`+(n.fields?.model?` [${n.fields.model}]`:""));
  for(const n of d.removed)      L.push(`  – remove ${n.type} node (${n.id})`);
  for(const c of d.changed){
    if(c.retyped) L.push(`  ~ ${c.id}: retype ${c.retyped} → ${c.type}`);
    for(const f of c.fields) L.push(`  ~ ${c.id}.${f.key}: ${JSON.stringify(f.from)} → ${JSON.stringify(f.to)}`);
  }
  for(const l of d.linksAdded)   L.push(`  + wire ${port(l.from)} → ${port(l.to)}`);
  for(const l of d.linksRemoved) L.push(`  – unwire ${port(l.from)} → ${port(l.to)}`);
  return L.length?L.join("\n"):"  (no changes)";
}

const CASES = [
  { graph:SEED_INTERNAL, instr:"Also speak the generated lyrics aloud with a TTS node." },
  { graph:SEED_INTERNAL, instr:"Make the song instrumental." },
  { graph:SEED_INTERNAL, instr:"Remove the musical-style LLM node; send lyrics straight to the music node." },
  { graph:{v:1,nodes:[],links:[],nid:1,lid:1}, instr:"Write a haiku about the ocean with an LLM, then make an image from it." },
];

for(const c of CASES){
  const prev = internalToSimple(c.graph);
  console.log("\n#### "+c.instr);
  let out;
  try{ out = await chat(systemPrompt("full",MODELS), userPrompt("full",prev,c.instr)); }
  catch(e){ console.log("  LLM ERROR",e.message); continue; }
  let next;
  try{ next = applyStrategy("full",prev,out).simple; }
  catch(e){ console.log("  PARSE ERROR",e.message,"::",out.slice(0,120)); continue; }
  const v = validateGraph(next);
  const d = diffSimple(prev, next);
  const internal = fromSimple(next, c.graph);
  // verify layout preserved for surviving nodes
  const survived = (c.graph.nodes||[]).filter(o=> internal.nodes.find(n=>n.id===o.id));
  const layoutOk = survived.every(o=>{ const n=internal.nodes.find(x=>x.id===o.id); return n.x===o.x && n.y===o.y; });
  console.log(renderDiff(d));
  console.log(`  [valid:${v.ok?"yes":"NO "+v.errors.join(";")}] [layout-preserved:${layoutOk?"yes":"NO"}] [new internal: ${internal.nodes.length} nodes, ${internal.links.length} links]`);
}
