#!/usr/bin/env node
// Drive the real player and bundled client through key switches during paid media work.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadEngine, recordingFetch } from "./play-engine.mjs";

const bundle = readFileSync(new URL("../vendor/njs-engine.js", import.meta.url), "utf8");
const window = {};
new Function("window", bundle)(window);
const engine = window.NanoodleEngine;

const oldKey = "fixture-original";
const newKey = "fixture-replacement";
const cases = [
  { kind:"video", type:"tvideo", submit:"/api/generate-video", poll:"/api/video/status",
    idParam:"requestId", content:"/api/generate-video/content", mime:"video/mp4" },
  { kind:"audio", type:"music", submit:"/api/v1/audio/speech", poll:"/api/tts/status",
    idParam:"runId", content:"/api/v1/audio/content", mime:"audio/mpeg" },
];

for (const delegated of [false, true]) {
  for (const fixture of cases) {
    test((delegated ? "delegated" : "built-in") + " " + fixture.kind + " keeps its paid job with its exact credential",
      { timeout: 3000 }, async () => {
        let key = oldKey;
        const accepted = Promise.withResolvers(), finishSubmit = Promise.withResolvers();
        const submits = [], polls = [], downloads = [];
        const app = loadEngine(ctx => {
          ctx.URLSearchParams = URLSearchParams;
          ctx.location.search = delegated ? "?engine=js" : "?engine=play";
          ctx.localStorage.getItem = name => name === "ngpt_key" ? key : null;
          ctx.NanoodleEngine = { ...engine, NanoClient: class extends engine.NanoClient {
            constructor(opts) { super({ ...opts, pollIntervals:{ [fixture.kind]:1 } }); }
          } };
          ctx.fetch = async (raw, init = {}) => {
            const url = new URL(raw), requestKey = new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "");
            if (url.pathname === fixture.submit && init.method === "POST") {
              submits.push(requestKey);
              if (submits.length === 1) {
                accepted.resolve();
                await finishSubmit.promise;
              }
              return Response.json({ runId:"job-" + submits.length, cost:0, paymentSource:"balance", isApiRequest:true });
            }
            if (url.pathname === fixture.poll) {
              const id = url.searchParams.get(fixture.idParam);
              polls.push([requestKey, id]);
              const content = fixture.content + "?runId=" + id;
              if (id === "job-1") key = newKey; // the account switches as the old poll is completing
              return Response.json({ status:"completed", audioUrl:content, output:{ url:content } });
            }
            if (url.pathname === fixture.content) {
              assert.equal(new Headers(init.headers).has("x-api-key"), false, "content is bearer-only");
              const id = url.searchParams.get("runId");
              downloads.push([requestKey, id]);
              return new Response(Uint8Array.of(id === "job-1" ? 1 : 2), { headers:{ "content-type":fixture.mime } });
            }
            return recordingFetch(raw, init);
          };
        });
        const raw = { nodes:[{ id:"media", type:fixture.type, fields:{ model:"fixture", prompt:"fixture prompt" } }], links:[] };
        const run = async () => {
          const errors = [];
          const graph = app.materialize(raw);
          const report = await app.runGraph(graph, {
            onStatus: (_id, kind, message) => { if (kind === "error") errors.push(message); },
          });
          return { errors, report, value:graph.byId("media").out[fixture.kind] };
        };

        const first = run();
        await accepted.promise;
        key = newKey;
        finishSubmit.resolve();
        assert.match((await first).errors.join(" "), /account changed/i);
        assert.deepEqual(polls, [], "an old accepted job must not start a poll under the replacement key");

        assert.equal((await run()).value, "data:" + fixture.mime + ";base64,Ag==");
        key = oldKey;
        const changedDuringPoll = await run();
        assert.match(changedDuringPoll.errors.join(" "), /account changed/i);
        assert.equal(changedDuringPoll.value, undefined);
        assert.deepEqual(downloads, [[newKey, "job-2"]], "an old content URL must never be fetched for the new account");

        key = oldKey;
        const recovered = await run();
        assert.equal(recovered.value, "data:" + fixture.mime + ";base64,AQ==");
        assert.equal(recovered.report.nodeErrors, 0);
        assert.deepEqual(submits, [oldKey, newKey], "returning to the original account never submits again");
        assert.deepEqual(polls, [[newKey, "job-2"], [oldKey, "job-1"]], "a completed paid job resumes at content download");
        assert.deepEqual(downloads, [[newKey, "job-2"], [oldKey, "job-1"]]);
      });
  }
}
