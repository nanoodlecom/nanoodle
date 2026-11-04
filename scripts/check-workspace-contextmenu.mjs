#!/usr/bin/env node
// Exercise the shipped context-menu handler and inline editor without a browser.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rename = src.slice(src.indexOf('function beginWorkspaceRename('), src.indexOf('let wsDrag = null'));
const start = src.indexOf('tabs.addEventListener("contextmenu", (e)=>{');
assert.ok(start >= 0, 'the shipped contextmenu handler exists');
const handler = src.slice(start, src.indexOf('\n    });', start) + 7);
const state = {active:'active', tabs:[{id:'active',name:'Active'}, {id:'other',name:'Other'}]};
let creates = 0, holds = 0, commits = [], renders = 0;
const inputs = [];
const document = {createElement() {
  creates++;
  const listeners = {};
  const input = {className:'',setAttribute(){},focus(){},select(){},
    addEventListener(k,f){listeners[k]=f;},removeEventListener(k){delete listeners[k];},listeners};
  inputs.push(input);
  return input;
}};
function tab(id) {
  const b = {dataset:{id},style:{transform:'translateX(1px)',zIndex:'2'},input:null};
  b.querySelector = s => s === '.wslabel' && !b.input ? {replaceWith(inp){b.input=inp;}} : null;
  return b;
}
const a = tab('active'), b = tab('other');
let onContext;
const ctx = vm.createContext({document, readWorkspaces:()=>state, wsT:s=>s,
  renameWorkspace:(id,value)=>commits.push([id,value]), renderWorkspaces:()=>renders++,
  clearWsHold:()=>holds++, wsDrag:null, wsSuppressClick:false,
  tabs:{addEventListener(k,f){assert.equal(k,'contextmenu');onContext=f;}}});
vm.runInContext(rename + '\n' + handler, ctx);
function fire(b, kind='label', pointerType='mouse') {
  let prevented=false;
  onContext({pointerType,target:{closest(s){
    if(s === '.wstab') return b;
    if(s === 'input, textarea, .wsx') return kind === 'label' ? null : {};
    return null;
  }}, preventDefault(){prevented=true;}});
  return prevented;
}
assert.equal(fire(null),false);
assert.equal(fire(a,'close'),false);
assert.equal(fire(a,'input'),false);
assert.equal(fire(a,'textarea'),false);
assert.equal(creates,0);
ctx.wsDrag={el:b};
assert.equal(fire(b),true);
assert.equal(b.input.value,'Other');
assert.equal(state.active,'active', 'right-click must not select the inactive tab');
assert.equal(ctx.wsDrag,null);
assert.equal(b.style.transform,'');
assert.equal(b.style.zIndex,'');
assert.equal(holds,1);
assert.equal(fire(b),true);
assert.equal(creates,1,'repeated context menu must not replace an open editor');
assert.equal(fire(b,'input'),false,'native edit context menu stays available');
b.input.value='Changed';
b.input.listeners.keydown({key:'Enter',preventDefault(){}});
assert.deepEqual(commits,[['other','Changed']]);
assert.equal(fire(a,'label','touch'),true);
assert.equal(ctx.wsSuppressClick,true,'touch context menu suppresses the follow-on click');
a.input.listeners.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});
assert.equal(commits.length,1,'Escape must not commit');
assert.equal(renders,1);
const c = tab('active');
assert.equal(fire(c,'label','pen'),true);
c.input.value='Blurred';
c.input.listeners.blur();
assert.deepEqual(commits,[['other','Changed'],['active','Blurred']]);
console.log('✓ workspace context menu: inactive-tab rename, repeats, native text menu, close guard, drag/hold cancellation, touch/pen, Enter, blur and Escape');
