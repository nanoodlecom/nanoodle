#!/usr/bin/env node
// Deferred editor Describe requests, including a metered SSE fixture. Everything
// here is synthetic: no network, credentials, model generation or payment.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=process.env.NANOODLE_EDITOR_FIXTURE_ROOT||resolve(dirname(fileURLToPath(import.meta.url)),'..');
const src=readFileSync(join(root,'index.html'),'utf8');
function close(start){
 let depth=0,mode='code';const tmpl=[];
 for(let i=start;i<src.length;i++){const c=src[i],n=src[i+1];
  if(mode==='code'){if(c==='/'&&n==='/'){mode='line';i++;}else if(c==='/'&&n==='*'){mode='block';i++;}else if(c==="'")mode='sq';else if(c==='"')mode='dq';else if(c==='`')mode='tpl';else if(c==='{')depth++;else if(c==='}'){depth--;if(tmpl.length&&depth===tmpl.at(-1)){tmpl.pop();mode='tpl';}else if(!depth)return i;}}
  else if(mode==='line'){if(c==='\n')mode='code';}else if(mode==='block'){if(c==='*'&&n==='/'){mode='code';i++;}}else if(mode==='sq'){if(c==='\\')i++;else if(c==="'")mode='code';}else if(mode==='dq'){if(c==='\\')i++;else if(c==='"')mode='code';}else if(mode==='tpl'){if(c==='\\')i++;else if(c==='`')mode='code';else if(c==='$'&&n==='{'){mode='code';tmpl.push(depth);depth++;i++;}}
 }throw Error('unclosed source');
}
function fn(name){
 const m=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\(').exec(src);assert(m,name);
 const start=m.index;let i=src.indexOf('(',start)+1,depth=1;
 for(;depth&&i<src.length;i++){if(src[i]==='(')depth++;else if(src[i]===')')depth--;}
 const open=src.indexOf('{',i);return src.slice(start,close(open)+1);
}
const graph=text=>({v:1,nodes:[{id:'n1',type:'text',fields:{text}}],links:[]});
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 const changes=[],charges=[];const c={console,AbortController,DOMException,TextDecoder,Response,performance:{now:()=>200},graph:graph('start'),workspace:'A',input:{value:'change A',disabled:false},busy:false,dbAbort:null,lastReply:null,versions:[],curVer:-1,descModel:'offline',USAGE:{inTok:0,outTok:0,cost:0,exact:true},bar:{classList:{add(){},remove(){}},offsetWidth:1},
 clone,serializeGraph(){return c.graph;},readWorkspaces(){return {active:c.workspace};},toSimple:clone,wsMutationBlocked:()=>false,ensureAuth:()=>true,hideDetail(){},
 setBusy(on){c.busy=on;c.input.disabled=on;},setStatus(html){c.status=html;changes.push(html);},usageMeter:()=>'',esc:String,estTok:s=>Math.ceil(String(s||'').length/4),describeEffort:()=>null,CHAT_ENDPOINT:'https://provider.invalid/offline-fixture',authHeaders:()=>({}),
 accrue(value){charges.push(value);},validate:()=>({ok:true}),fromSimple:clone,diff:()=>({count:1,added:[],changed:[{id:'n1',fields:['text']}]}),
 applyGraphData(g){c.graph=g;},save(){},renderVersions(){},revealNodes(){},pulse(){},summarize:()=> 'changed',friendlyRunError:e=>e.message};
 vm.createContext(c);vm.runInContext(fn('resetUsage')+'\n'+fn('meteredCallLlm')+'\n'+fn('submit'),c);return {c,changes,charges};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function until(fn){for(let n=0;n<60&&!fn();n++)await Promise.resolve();assert(fn(),'deferred stage not reached');}
const snapshot=c=>JSON.stringify({graph:c.graph,versions:c.versions,curVer:c.curVer,draft:c.input.value,status:c.status});
let failures=0;
async function test(name,fn){try{await fn();console.log('✓ '+name);}catch(e){failures++;console.error('✗ '+name+': '+e.message);}}
await test('Describe clean completion applies once and retains a newly typed next draft',async()=>{
 const {c}=fixture(),d=deferred();c.runGptdiff=()=>d.promise;const pending=c.submit();c.input.value='next request';d.resolve({next:graph('applied')});await pending;assert.equal(c.graph.nodes[0].fields.text,'applied');assert.equal(c.versions.length,2);assert.equal(c.input.value,'next request');assert.equal(c.busy,false);
});
await test('Describe keeps the exact editable prompt for consecutive changes and respects clearing it',async()=>{
 const {c}=fixture(),prompts=[];
 const prompt='  make another change  ';
 c.input.value=prompt;c.input.focus=()=>{};
 c.runGptdiff=async(_prev,goal)=>{prompts.push(goal);return {next:graph('applied '+prompts.length)};};
 await c.submit();assert.equal(c.input.value,prompt);assert.equal(c.graph.nodes[0].fields.text,'applied 1');
 await c.submit();assert.equal(c.input.value,prompt);assert.equal(c.graph.nodes[0].fields.text,'applied 2');
 assert.deepEqual(prompts,['make another change','make another change']);assert.equal(c.versions.length,3);
 c.input.value='';await c.submit();assert.equal(c.input.value,'');assert.equal(prompts.length,2);
});
await test('Describe cancellation leaves the prompt available to retry',async()=>{
 const {c}=fixture();
 c.runGptdiff=()=>new Promise((_resolve,reject)=>c.dbAbort.signal.addEventListener('abort',()=>reject(c.dbAbort.signal.reason),{once:true}));
 const pending=c.submit();c.dbAbort.abort();await pending;
 assert.equal(c.input.value,'change A');assert.equal(c.graph.nodes[0].fields.text,'start');
 assert.equal(c.versions.length,0);assert.equal(c.busy,false);assert.match(c.status,/Stopped/);
});
for(const scenario of ['workspace switch','switch away and back','same-workspace graph replacement','identical graph replacement','late failure'])await test('Describe rejects '+scenario,async()=>{
 const {c}=fixture(),d=deferred();c.runGptdiff=()=>d.promise;const original=clone(c.graph),pending=c.submit();
 if(scenario==='workspace switch'){c.workspace='B';c.graph=graph('B');}
 else if(scenario==='switch away and back'){c.workspace='B';c.graph=graph('B');c.workspace='A';c.graph=clone(original);}
 else c.graph=scenario==='identical graph replacement'?clone(original):graph('new graph');
 c.versions=[{graph:clone(c.graph),goal:'current'}];c.curVer=0;c.input.value='current draft';c.status='current status';const before=snapshot(c);
 if(scenario==='late failure')d.reject(Error('late provider failure'));else d.resolve({next:graph('STALE')});
 await pending;assert.equal(snapshot(c),before);assert.equal(c.busy,false);
});
await test('Describe protects in-place edits with an immutable starting snapshot',async()=>{
 const {c}=fixture(),d=deferred();c.runGptdiff=()=>d.promise;const pending=c.submit();c.graph.nodes[0].fields.text='manual edit';d.resolve({next:graph('STALE')});await pending;assert.equal(c.graph.nodes[0].fields.text,'manual edit');assert.equal(c.versions.length,0);assert.equal(c.input.value,'change A');
});
for(const interruption of ['workspace replacement','manual edit','Stop'])await test(`Describe preserves the workflow after ${interruption} during layout`,async()=>{
 const {c}=fixture(),layout=deferred();let arranging=false;
 c.window={arrangeUxLayout:()=>{arranging=true;return layout.promise;}};
 c.runGptdiff=async()=>({next:graph('planned change')});
 const pending=c.submit();await until(()=>arranging);
 if(interruption==='workspace replacement'){
  c.workspace='B';c.graph=graph('new workflow');c.status='new workspace status';
 }else if(interruption==='manual edit')c.graph.nodes[0].fields.text='manual edit';
 else c.dbAbort.abort();
 const before=clone(c.graph);
 layout.resolve(true);await pending;
 assert.deepEqual(c.graph,before);assert.equal(c.versions.length,0);assert.equal(c.busy,false);
 if(interruption==='workspace replacement')assert.equal(c.status,'new workspace status');
 if(interruption==='manual edit')assert.match(c.status,/current changes were kept/);
 if(interruption==='Stop')assert.match(c.status,/Stopped/);
});
await test('stale metered SSE settles exactly once without painting the replacement or starting apply',async()=>{
 const {c,charges,changes}=fixture();let controller,requests=0,applyCalls=0;
 const payload={choices:[{delta:{content:'offline diff'}}],x_nanogpt_pricing:{costUsd:0.012,inputTokens:7,outputTokens:3}};
 const frame='data: '+JSON.stringify(payload)+'\n\ndata: [DONE]\n\n';
 c.fetch=async()=>{requests++;return requests===1 ? new Response(new ReadableStream({start(value){controller=value;}})) : new Response(frame);};
 c.runGptdiff=async(_prev,_text,_model,clients)=>{await clients.gen({model:'offline',messages:[{content:'fixture'}]});applyCalls++;await clients.apply({model:'offline',messages:[]});return {next:graph('STALE')};};
 const pending=c.submit();await until(()=>controller);c.workspace='B';c.graph=graph('B');c.input.value='B draft';c.versions=[];c.status='B status';const before=snapshot(c),paintCount=changes.length;
 controller.enqueue(new TextEncoder().encode(frame));controller.close();await pending;
 assert.equal(charges.length,1);assert.equal(charges[0].x_nanogpt_pricing.costUsd,0.012);assert.equal(c.USAGE.cost,0.012);assert.equal(c.USAGE.inTok,7);assert.equal(c.USAGE.outTok,3);
 assert.equal(requests,1);assert.equal(applyCalls,0);assert.equal(changes.length,paintCount);assert.equal(c.lastReply,null);assert.equal(snapshot(c),before);assert.equal(c.busy,false);
});
const meteredFrame='data: '+JSON.stringify({choices:[{delta:{content:'offline diff'}}],x_nanogpt_pricing:{costUsd:0.012,inputTokens:7,outputTokens:3}})+'\n\ndata: [DONE]\n\n';
const paidPair=async(_prev,_text,_model,clients)=>{
 await clients.gen({model:'offline',messages:[]});
 await clients.apply({model:'offline',messages:[]});
 return {next:graph('applied')};
};
for(const edit of ['field','link'])await test('in-place '+edit+' edit during generation cannot start paid fallback',async()=>{
 const {c,charges}=fixture();let controller,requests=0;
 if(edit==='link')c.graph.nodes.push({id:'n2',type:'llm',fields:{prompt:''}});
 c.fetch=async()=>{requests++;return requests===1?new Response(new ReadableStream({start(value){controller=value;}})):new Response(meteredFrame);};
 c.runGptdiff=paidPair;const pending=c.submit();await until(()=>controller);
 if(edit==='field')c.graph.nodes[0].fields.text='manual field edit';
 else c.graph.links.push({id:'l1',from:{node:'n1',port:'text'},to:{node:'n2',port:'prompt'}});
 const current=JSON.stringify(c.graph),draft=c.input.value;
 controller.enqueue(new TextEncoder().encode(meteredFrame));controller.close();await pending;
 assert.equal(requests,1,'no follow-up request after an in-place edit');assert.equal(charges.length,1);assert.equal(c.USAGE.cost,0.012);
 assert.equal(JSON.stringify(c.graph),current);assert.equal(c.input.value,draft);assert.equal(c.versions.length,0);assert.equal(c.busy,false);
});
await test('content edit between generation and apply is checked before dispatch',async()=>{
 const {c,charges}=fixture();let requests=0;c.fetch=async()=>{requests++;return new Response(meteredFrame);};
 c.runGptdiff=async(_p,_t,_m,clients)=>{
  await clients.gen({model:'offline',messages:[]});c.graph.nodes[0].fields.text='edited between phases';
  await clients.apply({model:'offline',messages:[]});return {next:graph('STALE')};
 };
 await c.submit();assert.equal(requests,1);assert.equal(charges.length,1);assert.equal(c.graph.nodes[0].fields.text,'edited between phases');assert.equal(c.versions.length,0);assert.equal(c.input.value,'change A');
});
await test('an already dispatched apply still records its charge once after an in-place edit',async()=>{
 const {c,charges}=fixture();let controller,requests=0;c.fetch=async()=>{requests++;return requests===1?new Response(meteredFrame):new Response(new ReadableStream({start(value){controller=value;}}));};
 c.runGptdiff=paidPair;const pending=c.submit();await until(()=>controller);c.graph.nodes[0].fields.text='edit during apply';
 controller.enqueue(new TextEncoder().encode(meteredFrame));controller.close();await pending;
 assert.equal(requests,2);assert.equal(charges.length,2);assert.equal(c.USAGE.cost,0.024);assert.equal(c.graph.nodes[0].fields.text,'edit during apply');assert.equal(c.versions.length,0);assert.equal(c.input.value,'change A');assert.equal(c.busy,false);
});
await test('fresh generation and apply still complete and record both calls once',async()=>{
 const {c,charges}=fixture();let requests=0;c.fetch=async()=>{requests++;return new Response(meteredFrame);};c.runGptdiff=paidPair;
 await c.submit();assert.equal(requests,2);assert.equal(charges.length,2);assert.equal(c.USAGE.cost,0.024);assert.equal(c.graph.nodes[0].fields.text,'applied');assert.equal(c.versions.length,2);assert.equal(c.input.value,'change A');assert.equal(c.busy,false);
});
if(failures)process.exitCode=1;
