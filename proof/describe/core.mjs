// Shared core for the "Describe changes" feature: graph schema doc, prompt builder,
// and the three candidate apply strategies. Kept framework-free so it runs in Node (this
// harness) AND can be transplanted near-verbatim into index.html. The in-page version will
// derive NODE_SCHEMA from the live NODE_TYPES; here we mirror the same shape.

// ---- node schema: what the model is allowed to build with ----
// Mirrors index.html NODE_TYPES. `main` = the field a wired text input overrides / the focal field.
export const NODE_SCHEMA = [
  { type:"text",    title:"Text",        desc:"A literal string source",            in:[],                 out:"text",  fields:{ text:"the string" }, main:"text" },
  { type:"upload",  title:"Image input", desc:"User-uploaded/captured image",        in:[],                 out:"image", fields:{} },
  { type:"aupload", title:"Audio input", desc:"User-uploaded audio clip",            in:[],                 out:"audio", fields:{} },
  { type:"vupload", title:"Video input", desc:"User-uploaded video clip",            in:[],                 out:"video", fields:{} },
  { type:"join",    title:"Join",        desc:"Concatenate two texts",               in:["a:text","b:text"],out:"text",  fields:{ sep:"separator (default space; use \\n for newline)" } },
  { type:"llm",     title:"LLM",         desc:"Text (+images) -> text, any chat model", in:[],              out:"text",  modelKind:"chat", fields:{ model:"chat model id (optional)", system:"system prompt", prompt:"user prompt" }, main:"prompt", note:"vision-capable models also accept wired image ports" },
  { type:"vision",  title:"Vision",      desc:"Image -> text (describe/ask)",        in:["image:image"],    out:"text",  modelKind:"chat", fields:{ model:"vision model id (optional)", q:"the question" } },
  { type:"image",   title:"Image",       desc:"Text -> image",                       in:[],                 out:"image", modelKind:"image", fields:{ model:"image model id (optional)", prompt:"image prompt", size:"e.g. 1024x1024" }, main:"prompt" },
  { type:"edit",    title:"Edit",        desc:"Image + text -> image",               in:["image:image"],    out:"image", modelKind:"image", fields:{ model:"edit model id (optional)", prompt:"edit instruction" }, main:"prompt" },
  { type:"inpaint", title:"Inpaint",     desc:"Brush a region of an image -> repaint it", in:["image:image","mask:image"], out:"image", modelKind:"image", fields:{ model:"inpaint model id (optional)", prompt:"what to paint in" }, main:"prompt" },
  { type:"tvideo",  title:"Text->Video", desc:"Text -> video",                       in:[],                 out:"video", modelKind:"video", fields:{ model:"t2v model id (optional)", prompt:"video prompt", duration:"sec", aspect:"e.g. 16:9" }, main:"prompt" },
  { type:"ivideo",  title:"Image->Video",desc:"Image (+text) -> video",              in:["image:image"],    out:"video", modelKind:"video", fields:{ model:"i2v model id (optional)", prompt:"motion prompt", duration:"sec", aspect:"e.g. 16:9" }, main:"prompt" },
  { type:"vedit",   title:"Video edit",  desc:"Video (+text) -> video (edit/extend/upscale)", in:["video:video"], out:"video", modelKind:"video", fields:{ model:"v2v model id (optional)", prompt:"instruction" }, main:"prompt" },
  { type:"vframes", title:"Video->frames", desc:"Pull still frames out of a video",  in:["video:video"],    out:"image", fields:{ frames:"how many", gap:"sec between frames", dir:"end|start" }, note:"outputs grow as frame1, frame2, …" },
  { type:"combine", title:"Combine videos", desc:"Join clips end-to-end",            in:["clip1:video","clip2:video"], out:"video", fields:{ dedup:"trim duplicate seam frame (bool)" }, note:"input ports grow clip1, clip2, …" },
  { type:"lipsync", title:"Avatar / lipsync", desc:"Image + audio -> talking video", in:["image:image","audio:audio"], out:"video", modelKind:"video", fields:{ model:"avatar model id (optional)", prompt:"optional direction" } },
  { type:"music",   title:"Music",       desc:"Text -> music",                       in:[],                 out:"audio", modelKind:"audio", fields:{ model:"music model id (optional)", prompt:"style/prompt", lyrics:"lyrics for vocal models", instrumental:"bool" }, main:"prompt" },
  { type:"tts",     title:"Speech",      desc:"Text -> speech (TTS)",                in:[],                 out:"audio", modelKind:"audio", fields:{ model:"tts model id (optional)", prompt:"text to speak", voice:"voice id (optional)" }, main:"prompt" },
  { type:"trim",    title:"Trim audio",  desc:"Cut audio to start+length",           in:["audio:audio"],    out:"audio", fields:{ start:"sec", length:"sec" } },
  { type:"transcribe", title:"Transcribe", desc:"Audio -> text (speech-to-text)",    in:["audio:audio"],    out:"text",  modelKind:"audio", fields:{ model:"stt model id (optional)", language:"auto or a code" } },
];

const BY_TYPE = Object.fromEntries(NODE_SCHEMA.map(s=>[s.type,s]));
export const KNOWN_TYPES = new Set(NODE_SCHEMA.map(s=>s.type));

// media/binary fields the planner never sees — mirrors index.html MEDIA_KEYS
const MEDIA_KEYS = new Set(["image","audio","video","mask"]);

// port-type lookups for link validation
function outType(type){ return BY_TYPE[type]?.out; }
function inPortType(type, port){
  const s = BY_TYPE[type]; if(!s) return null;
  // dynamic ports: image1.., frame1.., clip1.., vid1.. accept the base type
  const dyn = { image:"image", frame:"image", clip:"video", vid:"video" };
  const base = port.replace(/\d+$/,"");
  for(const p of s.in){ const [name,t]=p.split(":"); if(name===port) return t; }
  if(dyn[base] && (s.in.some(p=>p.startsWith(base)) || s.note)) return dyn[base];
  // many nodes also accept their "main" field via a wired port of the upstream's type
  if(s.main && port===s.main) return null;     // main accepts text by convention; checked loosely
  return null;
}

// ---- schema doc for the prompt ----
export function schemaDoc(){
  const lines = NODE_SCHEMA.map(s=>{
    const ins = s.in.length ? s.in.join(", ") : "—";
    const flds = Object.entries(s.fields).map(([k,v])=>`${k} (${v})`).join("; ") || "—";
    return `- ${s.type}: ${s.desc}. inputs: ${ins}. output: ${s.out}. fields: ${flds}.${s.note?" "+s.note:""}`;
  });
  return lines.join("\n");
}

// ---- simplified <-> internal graph ----
// internal node: {id,type,x,y,fields,w,sizes}; internal link: {id,from:{node,port},to:{node,port}}
// simplified:   {nodes:[{id,type,fields}], links:["from.port>to.port"... as {from,to}]}
export function toSimple(g){
  return {
    nodes: (g.nodes||[]).map(n=>({ id:n.id, type:n.type, fields:stripEmpty(n.fields||{}) })),
    links: (g.links||[]).map(l=>({ from:`${l.from.node}.${l.from.port}`, to:`${l.to.node}.${l.to.port}` })),
  };
}
// mirrors index.html strip(): the planner sees neither empty fields nor the user's media
// (image/audio/video/mask) nor any inline data: blob — those are stripped from the simplified view.
function stripEmpty(f){
  const o={};
  for(const [k,v] of Object.entries(f)){
    if(v==="" || v==null) continue;
    if(MEDIA_KEYS.has(k)) continue;
    if(typeof v==="string" && v.startsWith("data:")) continue;
    o[k]=v;
  }
  return o;
}

// place new nodes in a tidy column to the right of existing ones
function autoPlace(existing, idx){
  const maxX = existing.length ? Math.max(...existing.map(n=>n.x||0)) : 0;
  return { x: maxX + 320, y: -120 + idx*200 };
}

// rebuild internal graph from a simplified one, preserving layout for surviving nodes
export function fromSimple(simple, prev){
  const prevById = Object.fromEntries((prev.nodes||[]).map(n=>[n.id,n]));
  let placeIdx = 0;
  const nodes = (simple.nodes||[]).map(sn=>{
    const old = prevById[sn.id];
    const base = old ? { x:old.x, y:old.y, w:old.w, sizes:old.sizes } : autoPlace(prev.nodes||[], placeIdx++);
    // The planner only ever sees the SIMPLIFIED fields (stripEmpty drops the user's media + inline
    // data:), so a key it leaves OUT is an intentional deletion only when it was visible to it.
    // Carry back just the stripped-away keys (media/binary) — those absences aren't edits.
    const carried = {};
    if(old){ const seen = stripEmpty(old.fields||{}); for(const k of Object.keys(old.fields||{})) if(!(k in seen)) carried[k] = old.fields[k]; }
    const fields = { ...carried, ...(sn.fields||{}) };
    return { id:sn.id, type:sn.type, x:base.x, y:base.y, fields, ...(base.w?{w:base.w}:{}), ...(base.sizes?{sizes:base.sizes}:{}) };
  });
  const num = s=> parseInt(String(s).replace(/\D/g,""),10)||0;
  let lid = Math.max(prev.lid||0, 0, ...(prev.links||[]).map(l=>num(l.id)));
  const links = (simple.links||[]).map(l=>{
    const [fn,fp] = String(l.from).split(".");
    const [tn,tp] = String(l.to).split(".");
    return { id:"l"+(++lid), from:{node:fn,port:fp}, to:{node:tn,port:tp} };
  });
  const nid = Math.max(prev.nid||0, 0, ...nodes.map(n=>num(n.id))) + 1;
  return { v:1, nodes, links, nid, lid:lid+1, view:prev.view };
}

// ---- validation ----
export function validateGraph(simple){
  const errors = [];
  const ids = new Set();
  for(const n of simple.nodes||[]){
    if(!n.id) errors.push("node missing id");
    if(ids.has(n.id)) errors.push(`duplicate node id ${n.id}`);
    ids.add(n.id);
    if(!KNOWN_TYPES.has(n.type)) errors.push(`unknown node type "${n.type}" on ${n.id}`);
  }
  for(const l of simple.links||[]){
    const [fn,fp]=String(l.from).split("."); const [tn,tp]=String(l.to).split(".");
    if(!ids.has(fn)) errors.push(`link from unknown node ${fn}`);
    if(!ids.has(tn)) errors.push(`link to unknown node ${tn}`);
    if(!fp || !tp) errors.push(`link missing a port — endpoints must be nodeId.port`);
  }
  // cycle check (stateless feed-forward DAG only)
  const adj = {}; (simple.links||[]).forEach(l=>{ const f=String(l.from).split(".")[0], t=String(l.to).split(".")[0]; (adj[f]||(adj[f]=[])).push(t); });
  const WHITE=0,GRAY=1,BLACK=2; const color={};
  let cyclic=false;
  const dfs=(u)=>{ color[u]=GRAY; for(const v of adj[u]||[]){ if(color[v]===GRAY){cyclic=true;return;} if(!color[v]) dfs(v);} color[u]=BLACK; };
  for(const id of ids){ if(!color[id]) dfs(id); }
  if(cyclic) errors.push("graph has a cycle (must be feed-forward)");
  return { ok: errors.length===0, errors };
}

// ---- prompt builder ----
export function systemPrompt(strategy, models){
  const modelHint = models ? `\nWhen a node needs a model you MAY set its "model" field to one of these ids (or omit it to use the app default — preferred unless the user names a model):\n${modelLines(models)}\n` : "";
  const head =
`You edit a node-graph workflow for "nanoodle", a browser tool that wires nano-gpt AI models into pipelines. The graph is a feed-forward DAG (NO cycles). Data flows along links from a node's output port to another node's input port; types must match (text/image/audio/video).

NODE TYPES you can use:
${schemaDoc()}

GRAPH FORMAT (simplified): an object {"nodes":[{"id","type","fields"}],"links":[{"from":"nodeId.port","to":"nodeId.port"}]}. A node's only required keys are id and type. Link endpoints are "nodeId.portName". A node's output port name equals its output type (text/image/audio/video) except vframes (frame1,frame2,…). Most generator nodes accept their main text via a wired link to their main field port (llm.prompt, image.prompt, tvideo.prompt, music.prompt, tts.prompt, edit.prompt) — or you can hardcode the field instead.
${modelHint}`;

  if(strategy==="full") return head +
`\nReturn the COMPLETE new graph after the user's change, as a single JSON object {"nodes":[...],"links":[...]}. Keep existing node ids stable; use fresh ids (n100, n101, …) for new nodes. Output ONLY the JSON, no prose, no markdown fences.`;

  if(strategy==="ops") return head +
`\nReturn a JSON array of edit operations to apply, in order. Op shapes:
  {"op":"addNode","id":"n100","type":"llm","fields":{...}}
  {"op":"removeNode","id":"n5"}
  {"op":"setFields","id":"n5","fields":{...}}   // merged into existing fields
  {"op":"addLink","from":"n100.text","to":"n5.prompt"}
  {"op":"removeLink","from":"n1.text","to":"n5.prompt"}
Use fresh ids (n100, n101, …) for added nodes; reference existing ids for edits. Output ONLY the JSON array, no prose, no markdown fences.`;

  if(strategy==="udiff") return head +
`\nThe current graph is shown as pretty-printed JSON. Return a unified diff (---/+++/@@ hunks) that transforms it into the desired graph. Keep ids stable; use fresh ids for new nodes. Output ONLY the diff.`;

  throw new Error("unknown strategy "+strategy);
}

function modelLines(models){
  const out=[];
  for(const kind of ["chat","image","video","audio"]){
    if(models[kind]?.length) out.push(`  ${kind}: ${models[kind].slice(0,8).join(", ")}`);
  }
  return out.join("\n");
}

export function userPrompt(strategy, simple, instruction){
  if(strategy==="udiff"){
    return `Current graph (pretty JSON):\n${JSON.stringify(simple,null,2)}\n\nChange requested: ${instruction}`;
  }
  return `Current graph:\n${JSON.stringify(simple)}\n\nChange requested: ${instruction}`;
}

// ---- semantic diff (prev vs next simplified graphs) → human-readable preview ----
// We compute the diff ourselves instead of trusting the model to emit diff syntax (which is
// brittle on JSON). This is what the user reviews before applying.
export function diffSimple(prev, next){
  const pById = Object.fromEntries((prev.nodes||[]).map(n=>[n.id,n]));
  const nById = Object.fromEntries((next.nodes||[]).map(n=>[n.id,n]));
  const added=[], removed=[], changed=[];
  for(const n of next.nodes||[]) if(!pById[n.id]) added.push(n);
  for(const n of prev.nodes||[]) if(!nById[n.id]) removed.push(n);
  for(const n of next.nodes||[]){
    const old = pById[n.id]; if(!old) continue;
    const fc = fieldChanges(old.fields||{}, n.fields||{});
    if(old.type!==n.type || fc.length) changed.push({ id:n.id, type:n.type, retyped: old.type!==n.type?old.type:null, fields:fc });
  }
  const linkKey = l=> `${l.from}→${l.to}`;
  const pL = new Set((prev.links||[]).map(linkKey));
  const nL = new Set((next.links||[]).map(linkKey));
  const linksAdded   = (next.links||[]).filter(l=>!pL.has(linkKey(l)));
  const linksRemoved = (prev.links||[]).filter(l=>!nL.has(linkKey(l)));
  const empty = !added.length && !removed.length && !changed.length && !linksAdded.length && !linksRemoved.length;
  return { added, removed, changed, linksAdded, linksRemoved, empty };
}
function fieldChanges(a, b){
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out=[];
  for(const k of keys){
    const av=a[k], bv=b[k];
    if(JSON.stringify(av)!==JSON.stringify(bv)) out.push({ key:k, from:av, to:bv });
  }
  return out;
}

// ---- strategy apply ----
export function applyStrategy(strategy, prevSimple, text){
  if(strategy==="full")  return applyFull(text);
  if(strategy==="ops")   return applyOps(prevSimple, text);
  if(strategy==="udiff") return applyUdiff(prevSimple, text);
  throw new Error("unknown strategy "+strategy);
}

function extractJson(text){
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fence) t = fence[1].trim();
  // grab the first balanced { } or [ ]
  const start = t.search(/[\[{]/);
  if(start<0) throw new Error("no JSON found");
  const open = t[start], close = open==="{" ? "}" : "]";
  let depth=0, end=-1, inStr=false, esc=false;
  for(let i=start;i<t.length;i++){
    const c=t[i];
    if(inStr){ if(esc) esc=false; else if(c==="\\") esc=true; else if(c==='"') inStr=false; continue; }
    if(c==='"'){ inStr=true; continue; }
    if(c===open) depth++;
    else if(c===close){ depth--; if(depth===0){ end=i; break; } }
  }
  if(end<0) throw new Error("unbalanced JSON");
  return JSON.parse(t.slice(start,end+1));
}

function applyFull(text){
  const g = extractJson(text);
  if(!g.nodes) throw new Error("no nodes in result");
  // normalize links to {from,to} strings
  g.links = (g.links||[]).map(l=> typeof l.from==="string" ? l : ({ from:`${l.from.node}.${l.from.port}`, to:`${l.to.node}.${l.to.port}` }));
  return { simple:{ nodes:g.nodes, links:g.links } };
}

function applyOps(prev, text){
  const ops = extractJson(text);
  if(!Array.isArray(ops)) throw new Error("ops must be an array");
  const nodes = prev.nodes.map(n=>({ ...n, fields:{...n.fields} }));
  let links = prev.links.map(l=>({...l}));
  const byId = id=> nodes.find(n=>n.id===id);
  for(const op of ops){
    if(op.op==="addNode"){
      if(!op.id || !op.type) throw new Error("addNode needs id+type");
      if(byId(op.id)) throw new Error("addNode duplicate id "+op.id);
      nodes.push({ id:op.id, type:op.type, fields:op.fields||{} });
    } else if(op.op==="removeNode"){
      const i=nodes.findIndex(n=>n.id===op.id); if(i>=0) nodes.splice(i,1);
      links = links.filter(l=> String(l.from).split(".")[0]!==op.id && String(l.to).split(".")[0]!==op.id);
    } else if(op.op==="setFields"){
      const n=byId(op.id); if(!n) throw new Error("setFields unknown id "+op.id);
      Object.assign(n.fields, op.fields||{});
    } else if(op.op==="addLink"){
      links.push({ from:op.from, to:op.to });
    } else if(op.op==="removeLink"){
      links = links.filter(l=> !(l.from===op.from && l.to===op.to));
    } else throw new Error("unknown op "+op.op);
  }
  return { simple:{ nodes, links }, ops };
}

// minimal tolerant unified-diff applier (line-based, fuzzy on context)
function applyUdiff(prev, text){
  const before = JSON.stringify(prev, null, 2).split("\n");
  let diff = text.trim();
  const fence = diff.match(/```(?:diff)?\s*([\s\S]*?)```/i); if(fence) diff=fence[1];
  const lines = diff.split("\n");
  const out = before.slice();
  let cursor = 0; let applied=false;
  for(let i=0;i<lines.length;i++){
    const m = lines[i].match(/^@@.*\+(\d+)/);
    if(!m) continue;
    // collect hunk body
    let j=i+1; const hunk=[];
    while(j<lines.length && !lines[j].startsWith("@@")){ hunk.push(lines[j]); j++; }
    // apply hunk by walking: this is intentionally simple and may fail on JSON — that's the point of the bake-off
    // find anchor: first context/removed line
    const anchor = hunk.find(h=>h.startsWith(" ")||h.startsWith("-"));
    if(anchor){
      const needle = anchor.slice(1);
      let at = out.findIndex((l,idx)=> idx>=cursor && l===needle);
      if(at<0) at = out.findIndex(l=>l===needle);
      if(at>=0){ cursor=at; applied=true; }
    }
    // rebuild: apply removals/additions sequentially from cursor
    let k=cursor;
    for(const h of hunk){
      if(h.startsWith(" ")){ k++; }
      else if(h.startsWith("-")){ if(out[k]===h.slice(1)) out.splice(k,1); }
      else if(h.startsWith("+")){ out.splice(k,0,h.slice(1)); k++; }
    }
    i=j-1;
  }
  if(!applied) throw new Error("diff did not apply (no anchor matched)");
  const g = JSON.parse(out.join("\n"));
  return { simple:{ nodes:g.nodes, links:g.links } };
}
