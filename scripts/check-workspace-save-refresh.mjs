#!/usr/bin/env node
// Real editor save/storage helpers, with a second VM representing refresh.
// Hold/discard IDB transactions and debounce timers deterministically: an old
// page cannot finish its asynchronous work after it has been unloaded.
// Offline; synthetic workflows and Map-backed browser storage only.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const src=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const block=src.slice(src.indexOf('const WS_INDEX_KEY = "noodle_workspaces";'),src.indexOf("/* WORKSPACES-END */"));
const save=src.slice(src.indexOf("function save(){"),src.indexOf("/* ---- Undo / redo:"));
assert.ok(block.includes("function flushSave()"));
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const graph=text=>({v:1,nodes:[{id:"n1",type:"text",fields:{text}},{id:"n2",type:"upload",fields:{image:"data:image/png;base64,c3ludGhldGlj"}}],links:[],nid:3,lid:1});
const index=JSON.stringify({v:1,active:"w1",seq:2,tabs:[{id:"w1",name:"Editing"},{id:"w2",name:"Other tab"}]});
const initial=()=>({noodle_graph:JSON.stringify(graph("OLD EDIT")),noodle_workspaces:index,noodle_ws_w2:JSON.stringify(graph("OTHER WORKSPACE"))});
const storage=values=>({values:new Map(Object.entries(values)),deny:false,
  get length(){return this.values.size;},key(i){return [...this.values.keys()][i]??null;},
  getItem(k){return this.values.get(k)??null;},
  setItem(k,v){if(this.deny){const e=new Error("synthetic quota");e.name="QuotaExceededError";throw e;}this.values.set(k,String(v));},
  removeItem(k){this.values.delete(k);}});

function page(local,session,disk){
  const events=new Map(),documentEvents=new Map(),timers=new Map();
  let seq=0,alive=true;
  const document={visibilityState:"visible",addEventListener:(k,fn)=>documentEvents.set(k,fn)};
  const ctx={console,document,localStorage:local,sessionStorage:session,
    addEventListener:(k,fn)=>events.set(k,fn),
    setTimeout(fn,ms){const id=++seq;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    indexedDB:{open(){
      const request={};
      queueMicrotask(()=>{if(!alive)return;request.result={close(){},transaction(_name,mode){
        if(mode==="readwrite" && disk.fail){const e=new Error("synthetic interrupted write");e.name="QuotaExceededError";throw e;}
        const tx={abort(){this.aborted=true;},objectStore(){return {
          get(){const read={};const deliver=()=>{
            if(!alive)return;
            read.result=copy(disk.record);read.onsuccess?.();
            if(mode==="readwrite")queueMicrotask(()=>{if(alive && !tx.aborted){disk.record=copy(tx.value);tx.oncomplete?.();}});
          };
          queueMicrotask(()=>{if(mode==="readwrite" && disk.hold)(disk.held??=[]).push(deliver);else deliver();});
          return read;},put(value){tx.value=copy(value);}
        };}};return tx;}};request.onsuccess?.();});return request;
    }},
  };
  vm.createContext(ctx);
  vm.runInContext(`
    var saveT=null,serializeFailure=false,graph=${JSON.stringify(graph("OLD EDIT"))};
    const EDITOR_APP_KEY="noodle_editor_app";
    var undoStack=[],redoStack=[],pendingAppId=null,pendingAppTitle=null;
    var location={hash:"",pathname:"/",search:""},history={replaceState(){location.hash="";}};
    function serializeGraph(){if(serializeFailure)throw new Error("synthetic serialization failure");return graph;}
    function flash(){} function refreshRunEstimate(){} function refreshPromptCaps(){}
    function refreshAppButton(){return false;} function layoutBar(){} function $(){return null;}
    ${save}\n${block}
    globalThis.api={save,flushSave,initWorkspaceStorage,settleWorkspaceStorage,workspacePersistence,
      edit(text){graph.nodes[0].fields.text=text;save();},
      restore(){graph=JSON.parse(workspaceStorage.getItem("noodle_graph"));return graph;},
      read:key=>workspaceStorage.getItem(key),
      set:(key,value)=>workspaceStorage.setItem(key,value),
      pending:()=>saveT!==null,
      failSerialization(value){serializeFailure=value;},
      hash(value){if(value!==undefined)location.hash=value;return location.hash;},
      restorePending(value){wsRestorePending=value;},
    };
  `,ctx);
  return {...ctx.api,async boot(){await ctx.api.initWorkspaceStorage();return ctx.api.restore();},
    event(name){const e={prevented:false,preventDefault(){this.prevented=true;}};events.get(name)?.(e);return e;},
    hidden(){document.visibilityState="hidden";documentEvents.get("visibilitychange")?.();},
    timer(){for(const [id,t] of [...timers])if(t.ms===250){timers.delete(id);t.fn();}},
    close(){alive=false;timers.clear();},
  };
}
const turns=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
const text=value=>JSON.parse(value).nodes[0].fields.text;
const failures=[];
async function check(name,fn){try{await fn();console.log("✓ "+name);}catch(e){failures.push(name+": "+e.message);}}

for(const event of ["beforeunload","pagehide","hidden"]){
  await check(`local storage: immediate ${event} saves the newest repeated edit`,async()=>{
    const local=storage(initial()),session=storage({}),disk={};
    const p=page(local,session,disk);await p.boot();
    p.edit("FIRST KEYSTROKE");p.edit("LATEST KEYSTROKE");
    assert.equal(text(local.getItem("noodle_graph")),"OLD EDIT","fixture must refresh before debounce fires");
    if(event==="hidden")p.hidden();else p.event(event);
    p.close();
    const reloaded=page(local,session,disk);
    assert.equal((await reloaded.boot()).nodes[0].fields.text,"LATEST KEYSTROKE");
    assert.equal(text(reloaded.read("noodle_ws_w2")),"OTHER WORKSPACE");
    assert.match(reloaded.read("noodle_graph"),/c3ludGhldGlj/,"uploaded input survives");
    reloaded.close();
  });
}
await check("completed debounce leaves no phantom pending save",async()=>{
  const p=page(storage(initial()),storage({}),{});await p.boot();p.edit("SAVED");p.timer();
  assert.equal(p.pending(),false);p.close();
});
await check("a failed flush keeps warning and retries the newest edit",async()=>{
  const local=storage(initial()),p=page(local,storage({}),{});await p.boot();
  p.edit("RETRY THIS EDIT");p.failSerialization(true);p.timer();
  assert.equal(p.event("beforeunload").prevented,true);assert.equal(p.event("beforeunload").prevented,true);
  assert.equal(p.pending(),true);assert.equal(text(local.getItem("noodle_graph")),"OLD EDIT");
  p.failSerialization(false);assert.equal(p.event("beforeunload").prevented,false);
  assert.equal(text(local.getItem("noodle_graph")),"RETRY THIS EDIT");p.close();
});
await check("a flushed local edit supersedes its shared URL before reload",async()=>{
  const p=page(storage(initial()),storage({}),{});await p.boot();p.hash("#j=old-shared-graph");
  p.edit("EDITED SHARED GRAPH");p.event("beforeunload");assert.equal(p.hash(),"");p.close();
});
for(const failure of ["hold","fail"]){
  await check(`IndexedDB: ${failure} → edit → immediate refresh → replay once`,async()=>{
    const values=initial(),local=storage(values),session=storage({});local.deny=true;
    const disk={record:{v:1,values,generation:"base"},[failure]:true};
    const p=page(local,session,disk);await p.boot();
    p.edit("INTERRUPTED EDIT");p.event("beforeunload");p.event("pagehide");await turns();p.close();
    assert.equal(text(disk.record.values.noodle_graph),"OLD EDIT","IDB transaction did not commit");
    disk[failure]=false;
    const next=page(local,session,disk);const restored=await next.boot();
    assert.equal(restored.nodes[0].fields.text,"INTERRUPTED EDIT");
    assert.equal(JSON.parse(next.read("noodle_workspaces")).tabs.length,2,"replay uses the same tabs");
    await next.settleWorkspaceStorage();next.close();
    const again=page(local,session,disk);assert.equal((await again.boot()).nodes[0].fields.text,"INTERRUPTED EDIT");
    assert.equal(JSON.parse(again.read("noodle_workspaces")).tabs.length,2,"repeated reload does not duplicate tabs");
    assert.equal(text(again.read("noodle_ws_w2")),"OTHER WORKSPACE");
    assert.equal(session.getItem("noodle_workspace_recovery"),null,"committed journal is cleaned up");again.close();
  });
}
await check("failed background save is journaled before any unload event",async()=>{
  const values=initial(),local=storage(values),session=storage({});local.deny=true;
  const disk={record:{v:1,values,generation:"base"},fail:true};
  const p=page(local,session,disk);await p.boot();p.edit("BACKGROUND EDIT");p.timer();await turns();p.close();
  disk.fail=false;const next=page(local,session,disk);
  assert.equal((await next.boot()).nodes[0].fields.text,"BACKGROUND EDIT");await next.settleWorkspaceStorage();next.close();
});
for(const interrupt of [false,true]){
  await check(`overlapping saves: older commit cannot clear the newest journal (interrupt=${interrupt})`,async()=>{
    const values=initial(),local=storage(values),session=storage({});local.deny=true;
    const disk={record:{v:1,values,generation:"base"},hold:true};
    const p=page(local,session,disk);await p.boot();p.edit("OLDER SAVE");p.timer();await turns();
    p.edit("NEWEST SAVE");p.timer();await turns();
    disk.held.shift()();await turns();
    assert.equal(text(disk.record.values.noodle_graph),"OLDER SAVE");
    assert.match(session.getItem("noodle_workspace_recovery"),/NEWEST SAVE/);
    p.event("beforeunload"); // checkpoint again after the older commit rebased the database
    if(!interrupt){disk.held.shift()();await p.settleWorkspaceStorage();
      assert.equal(session.getItem("noodle_workspace_recovery"),null,"last commit clears its own journal");}
    p.event("beforeunload");p.close();disk.hold=false;
    const next=page(local,session,disk);assert.equal((await next.boot()).nodes[0].fields.text,"NEWEST SAVE");
    assert.equal(JSON.parse(next.read("noodle_workspaces")).tabs.length,2,"own earlier commit remains on the same branch");
    await next.settleWorkspaceStorage();next.close();
  });
}
await check("a journal that moves between storage backends leaves no stale predecessor",async()=>{
  const values=initial(),local=storage(values),session=storage({}),disk={record:{v:1,values,generation:"base"},fail:true};
  const p=page(local,session,disk);await p.boot();p.edit("SMALL JOURNAL");p.timer();await turns();
  assert.match(session.getItem("noodle_workspace_recovery"),/SMALL JOURNAL/);
  session.deny=true;p.edit("LARGER JOURNAL");p.timer();await turns();
  assert.equal(session.getItem("noodle_workspace_recovery"),null,"previous session journal was safely replaced");
  assert.match(local.getItem("noodle_workspace_recovery"),/LARGER JOURNAL/);
  local.deny=true;session.deny=false;p.edit("LARGEST JOURNAL");p.timer();await turns();
  assert.equal(local.getItem("noodle_workspace_recovery"),null,"previous local journal was safely replaced");
  assert.match(session.getItem("noodle_workspace_recovery"),/LARGEST JOURNAL/);
  disk.fail=false;p.set("noodle_graph",p.read("noodle_graph"));await p.settleWorkspaceStorage();p.close();
  const next=page(local,session,disk);assert.equal((await next.boot()).nodes[0].fields.text,"LARGEST JOURNAL");
  assert.equal(JSON.parse(next.read("noodle_workspaces")).tabs.length,2);next.close();
});
await check("a different database generation preserves both writers on recovery",async()=>{
  const values=initial(),local=storage(values),session=storage({}),disk={record:{v:1,values,generation:"base"},hold:true};
  const p=page(local,session,disk);await p.boot();p.edit("THIS WINDOW EDIT");p.event("beforeunload");await turns();p.close();
  disk.record={v:1,values:{...values,noodle_graph:JSON.stringify(graph("OTHER WINDOW EDIT"))},generation:"other-writer"};disk.hold=false;
  const next=page(local,session,disk);assert.equal((await next.boot()).nodes[0].fields.text,"THIS WINDOW EDIT");
  const d=JSON.parse(next.read("noodle_workspaces"));
  const all=d.tabs.map(t=>next.read(t.id===d.active?"noodle_graph":"noodle_ws_"+t.id)).join("\n");
  assert.match(all,/OTHER WINDOW EDIT/);assert.match(all,/THIS WINDOW EDIT/);
  await next.settleWorkspaceStorage();next.close();
});
await check("two windows retain their own interrupted edits",async()=>{
  const values=initial(),local=storage(values),sessionA=storage({}),sessionB=storage({});
  const disk={record:{v:1,values,generation:"base"},fail:true};
  const a=page(local,sessionA,disk),b=page(local,sessionB,disk);await a.boot();await b.boot();
  a.edit("WINDOW A EDIT");a.timer();await turns();b.edit("WINDOW B EDIT");b.timer();await turns();a.close();b.close();
  assert.match(sessionA.getItem("noodle_workspace_recovery"),/WINDOW A EDIT/);
  assert.match(sessionB.getItem("noodle_workspace_recovery"),/WINDOW B EDIT/);
  disk.fail=false;const nextA=page(local,sessionA,disk);assert.equal((await nextA.boot()).nodes[0].fields.text,"WINDOW A EDIT");
  await nextA.settleWorkspaceStorage();nextA.close();
  const nextB=page(local,sessionB,disk);assert.equal((await nextB.boot()).nodes[0].fields.text,"WINDOW B EDIT");
  const d=JSON.parse(nextB.read("noodle_workspaces"));
  const all=d.tabs.map(t=>nextB.read(t.id===d.active?"noodle_graph":"noodle_ws_"+t.id)).join("\n");
  assert.match(all,/WINDOW A EDIT/);assert.match(all,/WINDOW B EDIT/);
  await nextB.settleWorkspaceStorage();nextB.close();
});
await check("leaving during restore never saves the unclaimed canvas",async()=>{
  const local=storage(initial()),p=page(local,storage({}),{});await p.boot();p.restorePending(true);
  p.edit("MUST NOT SAVE");p.event("beforeunload");p.event("pagehide");p.hidden();
  assert.equal(text(local.getItem("noodle_graph")),"OLD EDIT");p.close();
});
if(failures.length){console.error("✗ refresh persistence:\n- "+failures.join("\n- "));process.exitCode=1;}
