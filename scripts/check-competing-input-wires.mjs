#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calls, loadEngine } from "./play-engine.mjs";

const win = {};
new Function("window", readFileSync(new URL("../vendor/njs-engine.js", import.meta.url), "utf8"))(win);
const app = loadEngine(ctx=>{ ctx.NanoodleEngine = {planBranches:win.NanoodleEngine.planBranches}; });
const node = (id, type, fields={}) => ({id,type,fields});
const wire = (from, port, to, input) => ({from:{node:from,port},to:{node:to,port:input}});
const text = (id, value) => node(id,"text",{text:value});
const paid = node("paid","llm",{model:"fixture-chat",prompt:"stored fallback"});
const duplicate = input => [wire("a","text","paid",input),wire("b","text","paid",input)];
const posts = () => calls.filter(call=> call.url.endsWith("/chat/completions"));

for (const [type, input] of [["llm","prompt"],["join","a"],["audio","prompt"]]) {
  const links = duplicate(input);
  if(type==="audio") links[0].to.port="text";
  for (const order of [links,[...links].reverse()]) {
    const graph = app.materialize({nodes:[text("a","first"),text("b","second"),node("paid",type,paid.fields),
      node("unrelated","llm",{model:"fixture-chat",prompt:"independent"})],links:order});
    calls.length = 0;
    for (const seeds of [undefined,["paid"]]) {
      await assert.rejects(app.runGraph(graph,{seeds,onStart:()=>assert.fail("ambiguous workflow began to run")}),
        error=> error.message.includes(`competing wires for input "${input}" (a.text and b.text)`));
    }
    assert.deepEqual(calls, [], "unconditional conflict stops all scheduled work before fetch");
    assert.equal(graph.links.length, 2);
    await app.runGraph(graph,{seeds:["unrelated"]});
    assert.equal(posts().length, 1);
    assert.equal(posts()[0].body.messages.at(-1).content, "independent");
  }
}

const same = wire("a","text","paid","prompt");
const repeated = app.materialize({nodes:[text("a","one value"),paid],links:[same,same]});
calls.length = 0;
assert.equal((await app.runGraph(repeated)).nodeErrors, 0);
assert.equal(posts()[0].body.messages.at(-1).content, "one value");

app.NODE_TYPES.decide.run = async n=>{
  if(n.fields.gate===true && n.fields.selection==="no") throw Object.assign(new Error("gated"),{gate:true});
  return {yes:"yes value",no:"no value",text:"pass",decision:{branch:n.fields.selection}};
};
const route = (id, selection, gate=false) => node(id,"decide",{mode:"yesno",branch:!gate,gate,selection});
for (const selection of ["yes","no"]) {
  const graph = app.materialize({nodes:[route("route",selection),paid],
    links:[wire("route","yes","paid","prompt"),wire("route","no","paid","prompt")]});
  calls.length = 0;
  assert.equal((await app.runGraph(graph)).nodeErrors, 0);
  assert.equal(posts()[0].body.messages.at(-1).content, selection + " value");
}

const statuses = new Map();
async function attempt(nodes, links) {
  calls.length = 0;
  statuses.clear();
  const graph=app.materialize({nodes,links});
  const report=await app.runGraph(graph,{onStatus:(id,kind,message)=>statuses.set(id,{kind,message})});
  return {graph,report};
}
const both = await attempt([route("x","yes"),route("y","yes"),paid],
  [wire("x","yes","paid","prompt"),wire("y","yes","paid","prompt")]);
assert.equal(both.report.nodeErrors, 1);
assert.match(statuses.get("paid").message, /competing wires for input "prompt"/);
assert.deepEqual(posts(), []);

await attempt([route("gate","no",true),text("a","first"),text("b","second"),paid],
  [wire("gate","text","paid","system"),...duplicate("prompt")]);
assert.equal(statuses.get("paid").kind, "skip", "a closed legacy gate wins over downstream input validation");
assert.deepEqual(posts(), []);

app.NODE_TYPES.render3d.run = async()=>({image:"only a still"});
const fallback = await attempt([node("render","render3d"),text("a","present value"),node("join","join")],
  [wire("render","video","join","a"),wire("a","text","join","a")]);
assert.equal(fallback.report.nodeErrors, 0);
assert.equal(fallback.graph.byId("join").out.text, "present value");

app.NODE_TYPES.llm.run = async (_node,inp)=>({text:[inp.img1,inp.img2].join(" + ")});
const indexed = await attempt([node("a","upload",{image:"first"}),node("b","upload",{image:"second"}),paid],
  [wire("a","image","paid","img1"),wire("b","image","paid","img2")]);
assert.equal(indexed.report.nodeErrors, 0);
assert.equal(indexed.graph.byId("paid").out.text, "first + second");
console.log("✓ competing inputs stop before consumption and preserve branches, optional values, aliases and indexed slots");
