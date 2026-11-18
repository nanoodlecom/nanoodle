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
const load=src.slice(src.indexOf("function load(){"),src.indexOf("let _starterData"));
assert.ok(block.includes("function flushSave()"));
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const graph=text=>({v:1,nodes:[{id:"n1",type:"text",fields:{text}},{id:"n2",type:"upload",fields:{image:"data:image/png;base64,c3ludGhldGlj"}}],links:[],nid:3,lid:1});
const index=JSON.stringify({v:1,active:"w1",seq:2,tabs:[{id:"w1",name:"Editing"},{id:"w2",name:"Other tab"}]});
const initial=()=>({noodle_graph:JSON.stringify(graph("OLD EDIT")),noodle_workspaces:index,noodle_ws_w2:JSON.stringify(graph("OTHER WORKSPACE"))});
const tab=(id,name,extra)=>({id,name,...extra});
const recovered=(id,name)=>tab(id,"Recovered visit: "+name,{recovery:{name,label:"Recovered visit: "+name}});
function workspaceValues(tabs,active,graphs,binding){
  const values={noodle_workspaces:JSON.stringify({v:1,active,seq:Math.max(...tabs.map(t=>+t.id.slice(1))),tabs})};
  for(const [id,data] of Object.entries(graphs)){
    values[id===active?"noodle_graph":"noodle_ws_"+id]=JSON.stringify(data);
  }
  if(binding)values.noodle_editor_app=JSON.stringify(binding);
  return values;
}
const tabIndex=p=>JSON.parse(p.read("noodle_workspaces"));
const journal=(s,values)=>s.setItem("noodle_workspace_recovery",JSON.stringify({v:1,id:"pending-visit",updated:1,values}));
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
      queueMicrotask(()=>{if(!alive)return;
        if(disk.failOpen){request.onerror?.();return;}
        request.result={close(){},transaction(_name,mode){
        if(mode==="readwrite" && disk.fail){const e=new Error("synthetic interrupted write");e.name="QuotaExceededError";throw e;}
        const tx={abort(){this.aborted=true;},objectStore(){return {
          get(){const read={};const deliver=()=>{
            if(!alive)return;
            read.result=copy(disk.record);read.onsuccess?.();
            if(mode==="readwrite")queueMicrotask(()=>{if(alive && !tx.aborted){disk.record=copy(tx.value);tx.oncomplete?.();}});
          };
          queueMicrotask(()=>{
            if(mode==="readwrite" && disk.hold)(disk.held??=[]).push(deliver);
            else if(mode==="readonly" && disk.holdRead)(disk.heldReads??=[]).push(deliver);
            else deliver();
          });
          return read;},put(value){tx.value=copy(value);}
        };}};return tx;}};request.onsuccess?.();});return request;
    }},
  };
  vm.createContext(ctx);
  vm.runInContext(`
    var saveT=null,serializeFailure=false,graph=${JSON.stringify(graph("OLD EDIT"))};
    const EDITOR_APP_KEY="noodle_editor_app";
    var undoStack=[],redoStack=[],pendingAppId=null,pendingAppTitle=null;
    var undoMuted=false,window={},runningNodes=new Set();
    var location={hash:"",pathname:"/",search:""},history={replaceState(){location.hash="";}};
    function serializeGraph(){if(serializeFailure)throw new Error("synthetic serialization failure");return graph;}
    ${load}
    function applyGraphData(data){graph={...data,nid:data.nid+1,lid:data.lid+1};}
    function setPendingApp(){workspaceStorage.removeItem(EDITOR_APP_KEY);}
    function flash(){} function refreshRunEstimate(){} function refreshPromptCaps(){}
    function refreshAppButton(){return false;} function layoutBar(){} function $(){return null;}
    ${save}\n${block}
    globalThis.api={save,flushSave,initWorkspaceStorage,settleWorkspaceStorage,workspacePersistence,
      edit(text){graph.nodes[0].fields.text=text;save();},
      restore(){load();claimInitialCanvas();return graph;},
      open:openWorkspaceWithGraph,
      liveBinding(binding){pendingAppId=binding.id;pendingAppTitle=binding.title;},
      stashResult(id){workspaceResults.set(id,new Map([["n1 text",{out:{text:"PAID RESULT"}}]]));},
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
await check("an exact recovery reuses the original tab and focuses it, including repeated recovery and reload",async()=>{
  const binding={id:"app-1",title:"My app"};
  const workflow=graph("EXACT WORKFLOW"),other=graph("UNRELATED WORKFLOW");
  const values=workspaceValues([tab("w1","Editing",{app:binding}),tab("w2","Other")],"w2",{w1:workflow,w2:other});
  const visit=workspaceValues([tab("w9","Editing",{app:binding})],"w9",{w9:workflow},binding);
  const local=storage({}),session=storage({}),disk={record:{v:1,values,generation:"base"}};
  for(let i=0;i<3;i++){
    if(i!==2)journal(session,visit);
    const p=page(local,session,disk);await p.boot();
    assert.deepEqual(tabIndex(p),{v:1,active:"w1",seq:2,tabs:JSON.parse(values.noodle_workspaces).tabs});
    assert.equal(p.read("noodle_graph"),JSON.stringify(workflow));
    assert.equal(p.read("noodle_ws_w2"),JSON.stringify(other));
    assert.equal(p.read("noodle_editor_app"),JSON.stringify(binding));
    await p.settleWorkspaceStorage();p.close();
    assert.equal(session.getItem("noodle_workspace_recovery"),null);
  }
});
for(const sameId of [true,false]){
  await check("distinct identical tabs survive merge, reload and journal replay (shared ID "+sameId+")",async()=>{
    const workflow=graph("INDEPENDENT TABS");
    const original=tab("w1","Editing");
    const values=workspaceValues([original],"w1",{w1:workflow});
    const first=sameId?"w1":"w8";
    const visit=workspaceValues([tab(first,"Editing"),tab("w9","Editing")],"w9",{[first]:workflow,w9:workflow});
    const local=storage({}),session=storage({}),disk={record:{v:1,values,generation:"base"}};
    let merged;
    for(const replay of [true,false,true,false]){
      if(replay)journal(session,visit);
      const p=page(local,session,disk);await p.boot();await p.settleWorkspaceStorage();
      const d=tabIndex(p);
      assert.equal(d.tabs.length,sameId?2:3);
      assert.deepEqual(d.tabs[0],original);
      assert.notEqual(d.active,"w1");
      for(const t of d.tabs){
        assert.equal(p.read(t.id===d.active?"noodle_graph":"noodle_ws_"+t.id),JSON.stringify(workflow));
      }
      if(merged)assert.deepEqual(d,merged,"recovery must preserve each tab and its focus across replay");
      else merged=d;
      p.close();
    }
  });
}
await check("restore removes a historical recovered copy and keeps the original tab active",async()=>{
  const workflow=graph("EXACT LEGACY WORKFLOW");
  const values=workspaceValues([tab("w1","Editing"),tab("w2","Recovered visit: Editing")],"w2",{w1:workflow,w2:workflow});
  // This is the active shadow the old merge persisted beside noodle_graph.
  values.noodle_ws_w2=values.noodle_graph;
  const local=storage({}),session=storage({}),disk={record:{v:1,values,generation:"base"}};
  const p=page(local,session,disk);await p.boot();await p.settleWorkspaceStorage();p.close();
  const next=page(local,session,disk);await next.boot();
  assert.deepEqual(tabIndex(next),{v:1,active:"w1",seq:2,tabs:[tab("w1","Editing")]});
  assert.equal(next.read("noodle_ws_w2"),null);
  assert.equal(next.read("noodle_graph"),JSON.stringify(workflow));
  next.close();
});
await check("an inactive recovered copy restored from storage leaves unrelated focus intact",async()=>{
  const workflow=graph("SAVED TWICE");
  const values=workspaceValues([recovered("w4","Editing"),tab("w1","Editing"),tab("w3","Other")],
    "w3",{w1:workflow,w4:workflow,w3:graph("FOCUSED")});
  const disk={record:{v:1,values,generation:"base"}};
  const p=page(storage({}),storage({}),disk);await p.boot();await p.settleWorkspaceStorage();
  assert.equal(tabIndex(p).active,"w3");
  assert.deepEqual(tabIndex(p).tabs.map(t=>t.id),["w1","w3"]);
  assert.equal(p.read("noodle_ws_w4"),null);
  assert.equal(text(p.read("noodle_graph")),"FOCUSED");
  p.close();
});
await check("opening the equivalent original later removes the recovered copy",async()=>{
  const workflow=graph("OPEN AGAIN");
  const values=workspaceValues([recovered("w2","Editing")],"w2",{w2:workflow});
  const local=storage({}),session=storage({}),disk={record:{v:1,values,generation:"base"}};
  const p=page(local,session,disk);await p.boot();
  assert.equal(p.open(workflow,"Editing"),true);await p.settleWorkspaceStorage();
  assert.deepEqual(tabIndex(p).tabs.map(t=>t.id),["w3"]);
  assert.equal(tabIndex(p).active,"w3");
  assert.equal(p.read("noodle_ws_w2"),null);
  p.close();
  const next=page(local,session,disk);await next.boot();
  assert.deepEqual(tabIndex(next).tabs,[tab("w3","Editing",{app:null})]);
  next.close();
});
await check("a recovery-like name alone cannot remove an independently opened tab",async()=>{
  const workflow=graph("OPENED TWICE ON PURPOSE");
  const tabs=[tab("w1","Editing"),tab("w2","Recovered visit: Editing")];
  const values=workspaceValues(tabs,"w2",{w1:workflow,w2:workflow});
  const p=page(storage({}),storage({}),{record:{v:1,values,generation:"base"}});
  await p.boot();assert.deepEqual(tabIndex(p).tabs,tabs);p.close();
});
for(const [difference,change] of Object.entries({
  prompt:g=>{g.nodes[0].fields.text="DIVERGENT EDIT";},
  upload:g=>{g.nodes[1].fields.image+="YXQ=";},
  layout:g=>{g.nodes[0].x=40;},
  view:g=>{g.view={panX:55,panY:70,scale:1};},
  counters:g=>{g.nid++;},
  "unknown graph metadata":g=>{g.note="keep this";},
})){
  await check("recovery keeps both workflows when "+difference+" differs",async()=>{
    const original=graph("SAME TITLE"),edited=copy(original);change(edited);
    const values=workspaceValues([tab("w1","Editing")],"w1",{w1:original});
    const session=storage({}),disk={record:{v:1,values,generation:"base"}};
    journal(session,workspaceValues([tab("w1","Editing")],"w1",{w1:edited}));
    const p=page(storage({}),session,disk);await p.boot();await p.settleWorkspaceStorage();
    assert.deepEqual(tabIndex(p).tabs,[tab("w1","Editing"),recovered("w2","Editing")]);
    assert.equal(p.read("noodle_graph"),JSON.stringify(edited));
    assert.equal(p.read("noodle_ws_w1"),JSON.stringify(original));
    p.close();
  });
}
await check("the same graph keeps separate tabs with differing bindings and example metadata",async()=>{
  const workflow=graph("SAME GRAPH");
  const first={id:"app-1",title:"Same title"},second={id:"app-2",title:"Same title"};
  const tabs=[tab("w1","Editing",{app:first,example:"first"}),recovered("w2","Editing")];
  Object.assign(tabs[1],{app:second,example:"second"});
  const values=workspaceValues(tabs,"w2",{w1:workflow,w2:workflow},second);
  const p=page(storage({}),storage({}),{record:{v:1,values,generation:"base"}});
  await p.boot();assert.deepEqual(tabIndex(p).tabs,tabs);p.close();
});
await check("matching standalone graph bytes cannot prove separately stored uploads match",async()=>{
  const workflow=graph("EXTERNAL UPLOAD");
  workflow.nodes.push({id:"n3",type:"mupload",fields:{model:"",modelFile:{name:"edit.glb",size:12}}});
  const tabs=[tab("w1","Editing"),recovered("w2","Editing")];
  const values=workspaceValues(tabs,"w2",{w1:workflow,w2:workflow});
  const p=page(storage({}),storage({}),{record:{v:1,values,generation:"base"}});
  await p.boot();assert.deepEqual(tabIndex(p).tabs,tabs);p.close();
});
await check("live reconciliation waits for a pending edit and keeps a copy with unique results",async()=>{
  for(const state of ["pending edit","paid result"]){
    const workflow=graph("SAME ON DISK"),different=graph("DIFFERENT ON DISK");
    const tabs=[tab("w1","Editing"),recovered("w2","Editing")];
    const values=workspaceValues(tabs,"w2",{w1:different,w2:workflow});
    const p=page(storage({}),storage({}),{record:{v:1,values,generation:"base"}});await p.boot();
    if(state==="pending edit")p.edit("UNSAVED IN CANVAS");
    else p.stashResult("w1");
    p.set("noodle_ws_w1",JSON.stringify(workflow));await turns();
    assert.deepEqual(tabIndex(p).tabs,tabs);
    p.timer();await p.settleWorkspaceStorage();
    assert.deepEqual(tabIndex(p).tabs,tabs);
    p.close();
  }
});
await check("foreground reconciliation waits for the live app ID and title to match storage",async()=>{
  const binding={id:"app-1",title:"Saved title"};
  for(const divergent of [{id:"app-2",title:binding.title},{id:binding.id,title:"Live title"}]){
    const tabs=[tab("w1","Editing",{app:binding}),{...recovered("w2","Editing"),app:binding}];
    const values=workspaceValues(tabs,"w2",{w1:graph("STILL DIFFERENT"),w2:graph("MATCH AFTER SAVE")},binding);
    const p=page(storage({}),storage({}),{record:{v:1,values,generation:"base"}});await p.boot();
    p.liveBinding(divergent);
    p.set("noodle_ws_w1",p.flushSave());
    await p.settleWorkspaceStorage();
    assert.deepEqual(tabIndex(p).tabs,tabs);
    assert.equal(tabIndex(p).active,"w2");
    assert.equal(p.read("noodle_editor_app"),JSON.stringify(binding));

    p.liveBinding(binding);
    p.flushSave();
    await p.settleWorkspaceStorage();
    assert.deepEqual(tabIndex(p).tabs,[tabs[0]]);
    assert.equal(tabIndex(p).active,"w1");
    assert.equal(p.read("noodle_ws_w2"),null);
    p.close();
  }
});
await check("a live retry reuses an untouched loaded workflow despite rebuilt canvas counters",async()=>{
  const values=initial(),local=storage(values),session=storage({});
  const disk={record:{v:1,values,generation:"base"},failOpen:true};
  const p=page(local,session,disk);
  assert.notEqual((await p.boot()).nid,JSON.parse(values.noodle_graph).nid);
  await p.settleWorkspaceStorage();
  disk.failOpen=false;
  await p.initWorkspaceStorage();await p.settleWorkspaceStorage();
  assert.deepEqual(tabIndex(p),JSON.parse(index));
  assert.equal(p.read("noodle_graph"),values.noodle_graph);
  p.close();
});
await check("live retry checks edits made while IndexedDB was opening",async()=>{
  const values=initial(),local=storage(values),session=storage({});
  const disk={record:{v:1,values,generation:"base"},failOpen:true};
  const p=page(local,session,disk);await p.boot();await p.settleWorkspaceStorage();
  disk.failOpen=false;disk.holdRead=true;
  const retry=p.initWorkspaceStorage();await turns();
  p.edit("EDIT WHILE RETRY IS OPENING");
  disk.heldReads.shift()();await retry;await p.settleWorkspaceStorage();
  const d=tabIndex(p);
  assert.equal(d.tabs.length,3);
  assert.equal(text(p.read("noodle_graph")),"EDIT WHILE RETRY IS OPENING");
  assert.equal(text(p.read("noodle_ws_w1")),"OLD EDIT");
  p.close();
});
await check("leaving during restore never saves the unclaimed canvas",async()=>{
  const local=storage(initial()),p=page(local,storage({}),{});await p.boot();p.restorePending(true);
  p.edit("MUST NOT SAVE");p.event("beforeunload");p.event("pagehide");p.hidden();
  assert.equal(text(local.getItem("noodle_graph")),"OLD EDIT");p.close();
});
if(failures.length){console.error("✗ refresh persistence:\n- "+failures.join("\n- "));process.exitCode=1;}
