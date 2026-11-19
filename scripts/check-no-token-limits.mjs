#!/usr/bin/env node
// Only a graph node's explicit budget is sent. Planner calls stay uncapped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { callLlm } from '../vendor/patchling/llm.js';
for (const file of ['index.html','play.html']) {
 const src=fs.readFileSync(file,'utf8').replace(/<script id="njs-engine"[^>]*>[\s\S]*?<\/script>/,'');
 assert(!/data-lf="maxTokens"|f:\s*"maxTokens",\s*label:/.test(src),file+' has no default budget control');
 const method=src.match(/function llmOpts\(n\)\{[\s\S]*?return o;\s*\}/)[0];
 const llmOpts=vm.runInNewContext('('+method+')');
 const opts=llmOpts({fields:{maxTokens:'1536.75',reasoningEffort:'low'}});
 assert.equal(opts.max_tokens,1536,file+' forwards a numeric graph budget');
 assert.equal(opts.reasoning_effort,'low');
 for(const fields of [{},{maxTokens:''},{maxTokens:'invalid'},{max_tokens:1536},{max_completion_tokens:1536}]) {
  assert(!('max_tokens' in llmOpts({fields})),file+' omits unset or unsupported budgets');
 }
 const expression=file==='index.html'
  ?src.match(/const body = (\{ model, messages, .*stream:true, .*\});/)[1]
  :src.match(/body: JSON.stringify\((\{ model:m, messages, .*stream:true \})\)/)[1];
 for(const model of ['google/gemini-4-carbon','moonshotai/kimi-k3','other']) {
  const body=vm.runInNewContext('('+expression+')',{model,m:model,messages:[],temperature:1,re:null,cap:128000,maxTokens:1536});
  assert(!('max_tokens' in body));
 }
}
for(const baseUrl of ['https://nano-gpt.com/api/v1','https://api.anthropic.com']) {
 let body;
 await callLlm({apiKey:'fixture',baseUrl,model:'fixture',messages:[],maxTokens:1536,
  fetchImpl:async(_url,init)=>{body=JSON.parse(init.body);return {ok:true,json:async()=>baseUrl.includes('anthropic')?{content:[{type:'text',text:'ok'}],usage:{}}:{choices:[{message:{content:'ok'}}],usage:{}}};}});
 if(baseUrl.includes('anthropic')) assert.equal(body.max_tokens,32000,'native protocol requires field; not a website feature');
 else assert(!('max_tokens' in body));
}
console.log('✓ explicit graph budgets honored; defaults, planner and NanoGPT transport uncapped; native Anthropic field retained');
