#!/usr/bin/env node
// Offline request-body regression for the supplied Carbon 400 screenshot.
// Carbon ignores sampling knobs upstream; its NanoGPT provider can reject them.
// https://docs.cloud.google.cn/gemini-enterprise-agent-platform/models/guides/gemini-4-carbon
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
for (const file of ["index.html","play.html"]) {
  const src = readFileSync(new URL("../"+file,import.meta.url),"utf8");
  const method = src.match(/async genChat\(messages, model, opts\)\{[\s\S]*?\n\s*\},/)[0].replace(/,$/,"");
  let body;
  const fetch = async (_url,init) => {
    body=JSON.parse(init.body);
    return {ok:true,json:async()=>({choices:[{message:{content:"fixture"}}]})};
  };
  const ctx = vm.createContext({fetch,apiFetch:fetch,CHAT_ENDPOINT:"fixture",
    withLocale:x=>x,authHeaders:()=>({}),runSignal:()=>undefined,
    accrue:()=>{},onCost:()=>{},costWithHeaders:()=>0});
  const client = vm.runInContext("({"+method+"})",ctx);
  for (const temperature of [undefined,"",0,0.8,2]) {
    await client.genChat([{role:"user",content:"fixture"}],"google/gemini-4-carbon",
      {temperature,max_tokens:1536,reasoning_effort:"medium"});
    assert.equal("temperature" in body,false,file+" must omit Carbon temperature");
    assert.equal(body.max_tokens,1536);
    assert.equal(body.reasoning_effort,"medium");
  }
  await client.genChat([],"google/gemini-4-argon",{temperature:0});
  assert.equal(body.temperature,0,file+" preserves Argon");
  const gate=src.match(/const TEMP_LOCKED = (.*);/)[1];
  const locked=vm.runInNewContext(gate);
  assert(locked.test("google/gemini-4-carbon"),file+" hides ineffective Carbon slider");
  assert(!locked.test("google/gemini-4-argon"),file+" keeps Argon slider");
  console.log("✓ "+file+": Carbon omitted, valid knobs preserved, Argon unaffected");
}

// Streaming planner/customizer send expressions must obey the same omission.
for (const file of ["index.html", "play.html"]) {
  const src = readFileSync(new URL("../"+file,import.meta.url),"utf8");
  const expression = file === "index.html"
    ? src.match(/const body = (\{ model, messages, .*stream:true, .*\});/)[1]
    : src.match(/body: JSON.stringify\((\{ model:m, messages, .*stream:true \})\)/)[1];
  for (const model of ["google/gemini-4-carbon","google/gemini-4-argon"]) {
    const body = vm.runInNewContext("("+expression+")",
      {model,m:model,messages:[],temperature:0.8,cap:1536,re:"medium"});
    assert.equal("temperature" in body, model!=="google/gemini-4-carbon", file+" streaming");
    assert.equal(body.max_tokens,1536);
    assert.equal(body.reasoning_effort,"medium");
  }
  console.log("✓ "+file+": streaming Carbon omission, Argon preservation");
}
