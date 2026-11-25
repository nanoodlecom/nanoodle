#!/usr/bin/env node
// Overlap real player-runtime requests under a held mock provider.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { loadEngine, recordingFetch } from "./play-engine.mjs";

const win = {};
new Function("window", readFileSync(new URL("../vendor/njs-engine.js", import.meta.url), "utf8"))(win);

function player(delegated, fetch) {
  return loadEngine(ctx => {
    ctx.URLSearchParams = URLSearchParams;
    ctx.location.search = delegated ? "?engine=js" : "?engine=play";
    if (delegated) ctx.NanoodleEngine = win.NanoodleEngine;
    ctx.fetch = fetch;
  });
}

const node = (id, type, fields) => ({id,type,fields});
const wire = (from, port, to, input) => ({from:{node:from,port},to:{node:to,port:input}});
const makeChat = (prompt, key = "chat") => node(key,"llm",{model:"test",prompt});

for (const delegated of [false, true]) {
  test((delegated ? "delegated" : "built-in") + " player shares only matching resolved inputs",
    {timeout:3000}, async () => {
      const calls = [];
      const held = Promise.withResolvers(), release = Promise.withResolvers();
      const app = player(delegated, async (url, opts) => {
        if (!String(url).endsWith("/chat/completions")) return recordingFetch(url, opts);
        const prompt = JSON.parse(opts.body).messages.at(-1).content;
        calls.push(prompt);
        held.resolve();
        await release.promise;
        return Response.json({choices:[{message:{content:"answer to "+prompt}}],cost:0});
      });
      const run = async (prompt, reversedFields = false) => {
        const chat = reversedFields
          ? node("chat","llm",{prompt:"authored fallback",model:"test"})
          : makeChat("authored fallback");
        const graph = app.materialize({
          nodes:[node("source","text",{text:prompt}),chat],
          links:[wire("source","text","chat","prompt")],
        });
        await app.runGraph(graph);
        return graph.byId("chat").out.text;
      };
      const first = run("first");
      await held.promise;
      const second = run("second");
      const same = run("first",true);
      await setImmediate();
      release.resolve();
      assert.deepEqual(await Promise.all([first,second,same]),["answer to first","answer to second","answer to first"]);
      assert.deepEqual(calls,["first","second"]);
    });
}

test("same graph sibling runs read their own upstream result after an in-flight edit", {timeout:3000}, async () => {
  const earlier = Promise.withResolvers(), later = Promise.withResolvers();
  const began = Promise.withResolvers();
  const app = player(false, async (url, opts) => {
    if (!String(url).endsWith("/chat/completions")) return recordingFetch(url, opts);
    const prompt = JSON.parse(opts.body).messages.at(-1).content;
    began.resolve();
    await (prompt === "older" ? earlier.promise : later.promise);
    return Response.json({choices:[{message:{content:prompt}}],cost:0});
  });
  const graph = app.materialize({
    nodes:[makeChat("older"),node("a","join",{}),node("b","join",{})],
    links:[wire("chat","text","a","a"),wire("chat","text","b","a")],
  });
  const first = app.runGraph(graph,{seeds:["a"]});
  await began.promise;
  graph.byId("chat").fields.prompt = "newer";
  const second = app.runGraph(graph,{seeds:["b"]});
  // One script turn delivers both provider responses. Each downstream lookup
  // must still use the output produced for that invocation.
  await setImmediate();
  earlier.resolve();
  later.resolve();
  await Promise.all([first,second]);
  assert.deepEqual([graph.byId("a").out.text,graph.byId("b").out.text],["older","newer"]);
});

test("overlapping fixed-seed lanes still share an exact generation while another request is pending", {timeout:3000}, async () => {
  const calls = [];
  const held = Promise.withResolvers(), release = Promise.withResolvers();
  const app = player(false, async (url, opts) => {
    if (!String(url).endsWith("/images/generations")) return recordingFetch(url, opts);
    const {prompt} = JSON.parse(opts.body);
    calls.push(prompt);
    held.resolve();
    await release.promise;
    return Response.json({data:[{b64_json:prompt}],cost:0});
  });
  const run = async (prompt,lane) => {
    const graph = app.materialize({nodes:[node("same-id","image",{model:"test",prompt,seed:42})],links:[]});
    await app.runGraph(graph,{lane});
    return graph.byId("same-id").out.image;
  };
  const first = run("aaaa",0);
  await held.promise;
  const different = run("bbbb",1);
  await setImmediate();
  const same = run("aaaa",2);
  await setImmediate();
  release.resolve();
  assert.deepEqual(await Promise.all([first,different,same]),[
    "data:image/png;base64,aaaa","data:image/png;base64,bbbb","data:image/png;base64,aaaa",
  ]);
  assert.deepEqual(calls,["aaaa","bbbb"]);
});

test("distinct overlapping media requests keep their own accepted jobs for retry", {timeout:3000}, async () => {
  const submitted = Promise.withResolvers(), release = Promise.withResolvers();
  const posts = [], polls = [];
  let finishing = false;
  const app = player(false, async (raw, opts = {}) => {
    const url = new URL(raw);
    if (url.pathname === "/api/generate-video") {
      const {prompt} = JSON.parse(opts.body);
      posts.push(prompt);
      submitted.resolve();
      return Response.json({runId:prompt,cost:0});
    }
    if (url.pathname === "/api/video/status") {
      const job = url.searchParams.get("requestId");
      polls.push(job);
      if (finishing) return Response.json({status:"COMPLETED",output:{url:"https://example.test/"+job}});
      await release.promise;
      return Response.json({error:"temporarily unavailable"},{status:400});
    }
    return recordingFetch(raw, opts);
  });
  const run = async prompt => {
    const graph = app.materialize({nodes:[node("video","tvideo",{model:"test",prompt})],links:[]});
    await app.runGraph(graph);
    return graph.byId("video").out.video;
  };
  const first = run("first");
  await submitted.promise;
  const second = run("second");
  await setImmediate();
  release.resolve();
  assert.deepEqual(await Promise.all([first,second]),[undefined,undefined]);
  finishing = true;
  assert.equal(await run("first"),"https://example.test/first");
  assert.equal(await run("second"),"https://example.test/second");
  assert.deepEqual(posts,["first","second"]);
  assert.deepEqual(polls,["first","second","first","second"]);
});
