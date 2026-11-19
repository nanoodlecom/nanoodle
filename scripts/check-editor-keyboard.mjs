#!/usr/bin/env node
// Shipped event handlers and deferred builder applies, all offline. A fixture
// root can hold an older pair of HTML files to reproduce the regressions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root = process.env.NANOODLE_EDITOR_FIXTURE_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const editor = readFileSync(join(root,'index.html'),'utf8'), play = readFileSync(join(root,'play.html'),'utf8');
const failures=[];
async function test(name, fn){ try{await fn();console.log('✓ '+name);}catch(e){failures.push(name+': '+e.message);console.error('✗ '+name+': '+e.message);} }
function closing(src,start){
 let depth=0, mode='code'; const tmpl=[];
 for(let i=start;i<src.length;i++){
  const c=src[i],n=src[i+1];
  if(mode==='code'){
   if(c==='/'&&n==='/'){mode='line';i++;}else if(c==='/'&&n==='*'){mode='block';i++;}
   else if(c==="'")mode='sq';else if(c==='"')mode='dq';else if(c==='`')mode='tpl';
   else if(c==='{')depth++;else if(c==='}'){depth--;if(tmpl.length&&depth===tmpl.at(-1)){tmpl.pop();mode='tpl';}else if(!depth)return i;}
  }else if(mode==='line'){if(c==='\n')mode='code';}
  else if(mode==='block'){if(c==='*'&&n==='/'){mode='code';i++;}}
  else if(mode==='sq'){if(c==='\\')i++;else if(c==="'")mode='code';}
  else if(mode==='dq'){if(c==='\\')i++;else if(c==='"')mode='code';}
  else if(mode==='tpl'){if(c==='\\')i++;else if(c==='`')mode='code';else if(c==='$'&&n==='{'){mode='code';tmpl.push(depth);depth++;i++;}}
 }throw Error('unclosed source');
}
function fn(src,name,from=0){const m=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\(').exec(src.slice(from));assert(m,'missing '+name);const start=from+m.index,open=src.indexOf('{',start);return src.slice(start,closing(src,open)+1);}
function handler(src,anchor){const start=src.indexOf(anchor);assert(start>=0,anchor);const arrow=src.indexOf('=>',start),open=src.indexOf('{',arrow);return '(e)=>'+src.slice(open,closing(src,open)+1);}
function evt(overrides={}){return {key:'Enter',ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,repeat:false,isComposing:false,keyCode:13,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...overrides};}
const element=tagName=>({tagName,isContentEditable:false});
await test('editor Enter, Ctrl/Cmd+Enter and IME stay with the composer',()=>{
 const input=element('INPUT'),ctx={document:{activeElement:input},applies:0,runs:0,busy:false,selected:null,runningNodes:new Set(),submit(){ctx.applies++;},runAll(){ctx.runs++;},fitView(){},geoOn:()=>false};
 vm.createContext(ctx);
 vm.runInContext('var local='+handler(editor,'input.addEventListener("keydown",')+'; var global='+handler(editor.slice(editor.indexOf('// delete selected node with keyboard')),'window.addEventListener("keydown",')+';',ctx);
 for(const keys of [{},{ctrlKey:true},{metaKey:true}]){ctx.applies=ctx.runs=0;const e=evt({target:input,...keys});ctx.local(e);if(!e.stopped)ctx.global(e);assert.equal(ctx.applies,1);assert.equal(ctx.runs,0,'typing must never run the canvas');}
 for(const flags of [{isComposing:true},{keyCode:229},{repeat:true},{defaultPrevented:true}]){ctx.applies=ctx.runs=0;const e=evt({target:input,...flags});ctx.local(e);if(!e.stopped)ctx.global(e);assert.equal(ctx.applies,0);assert.equal(ctx.runs,0);}
 for(const target of [element('INPUT'),element('TEXTAREA'),element('SELECT'),{...element('DIV'),isContentEditable:true}]){ctx.document.activeElement=target;ctx.runs=0;ctx.global(evt({target,ctrlKey:true}));assert.equal(ctx.runs,0);}
 const canvas=element('DIV');ctx.document.activeElement=canvas;ctx.runs=0;ctx.global(evt({target:canvas,ctrlKey:true}));assert.equal(ctx.runs,1,'canvas shortcut remains available');
});
await test('builder Enter applies once; IME/repeat/canceled keys do not submit',()=>{
 const ctx={busy:false,count:0,applyCustomize(){ctx.count++;}};vm.createContext(ctx);vm.runInContext('var handler='+handler(play,'$("goal").addEventListener("keydown",')+';',ctx);
 for(const flags of [{isComposing:true},{keyCode:229},{repeat:true},{defaultPrevented:true}]){ctx.count=0;ctx.handler(evt(flags));assert.equal(ctx.count,0);}
 ctx.handler(evt());assert.equal(ctx.count,1);ctx.busy=true;ctx.handler(evt());assert.equal(ctx.count,1);
});
function dom(){
 const document={};
 class El{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.value='';this.disabled=false;this._html='';this.classList={add(){},remove(){},toggle(){}};}
  contains(el){return el===this||this.children.some(c=>c.contains(el));}
  appendChild(el){this.children.push(el);el.parent=this;return el;}
  set innerHTML(s){if(this.contains(document.activeElement))document.activeElement=document.body;this.children=[];this._html=s;for(const m of String(s).matchAll(/<button[^>]*data-ver="(\d+)"[^>]*>/g)){const b=new El('button');b.dataset.ver=m[1];this.appendChild(b);}}
  get innerHTML(){return this._html;}
  getAttribute(k){return k==='data-ver'?this.dataset.ver:null;}
  querySelectorAll(){return this.children.filter(c=>c.tagName==='BUTTON');}
  querySelector(s){const i=s.match(/data-ver="(\d+)"/)?.[1];return this.children.find(c=>c.dataset.ver===i)||null;}
  focus(){document.activeElement=this;}
 }
 document.body=new El('body');document.activeElement=document.body;document.createElement=tag=>new El(tag);
 const els=new Map();return {document,$:id=>{if(!els.has(id))els.set(id,new El());return els.get(id);}};
}
const files=n=>({'index.html':'<title>v'+n+'</title>','app.css':'/*v'+n+'*/'});
function builder(){
 const d=dom(),ctx={...d,console,AbortController,performance,busy:false,custAbort:null,pendingHandoff:null,appDirty:false,CONTRACT:'offline',MODEL:'offline',FALLBACK_MODEL:'offline',
 APP_STATE:{files:{...files(1),'runtime.js':'keep-runtime'},graph:{nodes:[]},versions:[{files:files(0),goal:'start'},{files:files(1),goal:'one'}],curVer:1},
 getKey:()=> 'offline-test',loadChatCatalog:async()=>{},resetUsage(){},buildEnvironment:x=>x,NoodleApp:{materialize:x=>x,describeGraph:()=> 'offline graph'},streamingCallLlm:()=>()=>{},parseDiffPerFile:()=>[{}],ioSignature:()=> 'offline',exitFirstRun(){},syncTitleFromFiles(){},renderApp(){},commit(){return true;},persist(){},usageMeter:()=>'',esc:s=>s,friendlyRunError:e=>e.message,newSuggestion(){},syncSuggest(){},syncApply(){},toast(){}};
 vm.createContext(ctx);vm.runInContext(['renderVersions','selectVersion','pushVersion','stopCustomize','setCustBusy','runDiffPass','applyCustomize'].map(n=>fn(play,n)).join('\n'),ctx);ctx.renderVersions();return ctx;
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function until(predicate){for(let n=0;n<50&&!predicate();n++)await Promise.resolve();assert(predicate(),'deferred stage was not reached');}
await test('deferred builder apply stays on its starting version and retains the next draft',async()=>{
 const c=builder(),gen=deferred(),apply=deferred();let before;
 c.generateDiff=()=>gen.promise;c.smartapply=async(_diff,source)=>{before=source;return apply.promise;};c.$('goal').value='first change';
 const pending=c.applyCustomize();await until(()=>c.busy);c.selectVersion(0);assert.equal(c.APP_STATE.curVer,1,'busy version selection must be ignored');
 c.$('goal').value='my next request';gen.resolve('offline diff');await until(()=>before);
 assert.equal(before['index.html'],files(1)['index.html'],'apply must use the original generation input');
 c.selectVersion(0);assert.equal(c.APP_STATE.curVer,1,'version cannot change during apply either');
 apply.resolve({'index.html':'<title>changed</title>','app.css':'edited-css'});await pending;
 assert.equal(c.$('goal').value,'my next request');assert.equal(c.APP_STATE.files['runtime.js'],'keep-runtime');assert.equal(c.APP_STATE.curVer,2);assert.equal(c.busy,false);
});
await test('a replaced app rejects a stale deferred edit and keeps its draft',async()=>{
 const c=builder(),gen=deferred();let called=false;c.generateDiff=()=>gen.promise;c.smartapply=async()=>{called=true;throw Error('must not apply');};c.$('goal').value='keep me';const pending=c.applyCustomize();
 await until(()=>c.busy);await Promise.resolve();await Promise.resolve();
 const next={files:files(9),graph:{nodes:[]},versions:[],curVer:0};c.APP_STATE=next;gen.resolve('offline diff');await pending;
 assert.equal(c.APP_STATE,next);assert.equal(next.files['index.html'],files(9)['index.html']);assert.equal(c.$('goal').value,'keep me');assert.equal(called,false);
});
await test('unchanged builder request clears after one successful apply',async()=>{
 const c=builder();let count=0;c.generateDiff=async()=>{count++;return 'offline diff';};c.smartapply=async(_d,b)=>({...b,'index.html':'changed'});c.$('goal').value='apply this';await c.applyCustomize();assert.equal(c.$('goal').value,'');assert.equal(count,1);
});
await test('typing a next builder request during generation does not lose it on success',async()=>{
 const c=builder(),gen=deferred();let started=false;c.generateDiff=()=>{started=true;return gen.promise;};c.smartapply=async(_d,b)=>({...b,'index.html':'changed'});c.$('goal').value='first request';const pending=c.applyCustomize();await until(()=>started);c.$('goal').value='next request';gen.resolve('offline diff');await pending;assert.equal(c.$('goal').value,'next request');
});
await test('builder version selection preserves focus and draft text',()=>{
 const c=builder();c.$('goal').value='unsubmitted draft';const b=c.$('versions').querySelectorAll('button')[0];b.focus();c.selectVersion(0);assert.equal(c.document.activeElement.tagName,'BUTTON');assert.equal(c.document.activeElement.getAttribute('data-ver'),'0');assert.equal(c.$('goal').value,'unsubmitted draft');assert.equal(c.APP_STATE.curVer,0);
});
await test('editor version selection preserves focus and draft text',()=>{
 const d=dom(),graph=n=>({nodes:[{id:'n1',type:'text',fields:{text:'v'+n}}],links:[]});let current=graph(1);const c={...d,versions:[{graph:graph(0),goal:'start'},{graph:graph(1),goal:'one'}],curVer:1,busy:false,runningNodes:new Set(),versEl:d.$('versions'),input:d.$('goal'),clone:x=>JSON.parse(JSON.stringify(x)),esc:s=>s,serializeGraph:()=>current,applyGraphData:x=>{current=x;},save(){},setStatus(){},wsMutationBlocked:()=>false};
 vm.createContext(c);const from=editor.indexOf('const versions = [];');vm.runInContext(fn(editor,'renderVersions',from)+'\n'+fn(editor,'selectVersion',from),c);c.renderVersions();c.input.value='draft';c.versEl.querySelector('[data-ver="0"]').focus();c.selectVersion(0);assert.equal(c.document.activeElement.getAttribute('data-ver'),'0');assert.equal(c.input.value,'draft');assert.equal(current.nodes[0].fields.text,'v0');
});
if(failures.length){console.error(failures.length+' editor keyboard/version regression(s)');process.exitCode=1;}
