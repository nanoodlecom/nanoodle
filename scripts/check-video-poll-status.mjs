#!/usr/bin/env node
// Drive the shipped built-in video submit/poll paths without API calls or real sleeps.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadRunner(file) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const method = src.match(/^( +)async genVideo\([\s\S]*?^\1},/m)?.[0];
  assert.ok(method, `${file} video runner found`);
  const pending = new Map(), replies = [], polled = [], settled = [];
  const controller = new AbortController();
  let submissions = 0, reads = 0, elapsed = 0;
  const reply = (status, body) => () => ({
    status, ok: status >= 200 && status < 300,
    async json() {
      reads++;
      return typeof body === "function" ? body() : body;
    },
  });
  const fetch = async (url, options) => {
    if (options.method === "POST") return reply(200, { runId: `paid-${++submissions}` })();
    polled.push(new URL(url).searchParams.get("requestId"));
    if (!replies.length) throw new DOMException("unexpected extra poll", "AbortError");
    return replies.shift()();
  };
  const genVideo = vm.runInNewContext(`({${method}}).genVideo`, {
    AbortController, DOMException, fetch, apiFetch: fetch, send: fetch, credential: "fixture-key",
    ABORT: controller, runSignal: () => controller.signal, runKey: "node",
    Date: { now: () => elapsed }, sleep: async ms => { elapsed += ms; },
    setTimeout: () => Symbol("3D timer"), clearTimeout() {},
    MEDIA_INLINE_MAX: 4_000_000, MODEL3D_DEADLINE_MS: 25 * 60_000, MODEL3D_STALL_MS: 12 * 60_000,
    NANOGPT: "https://provider.example", getKey: () => "fixture-key", authHeaders: () => ({}), t: text => text,
    PENDING_VIDEO: pending, pendingMediaJobs: () => ({ video: pending }),
    sigHash: payload => payload, videoSig: payload => payload,
    costWithHeaders: body => body, accrue() {}, onCost() {},
    applyPollBalance: (body, _response, refunded) => settled.push({ body, refunded }),
    applyPollSettlement: (body, _response, refunded) => settled.push({ body, refunded }),
    videoFailText: (body, state) => body.data?.error || body.error || state,
    model3dStatusUrl: body => body.data?.output?.model_url,
    deliverResolvedMedia: async (map, key, entry, url) => {
      if (map && key) {
        map.set(key, entry);
        map.delete(key);
      }
      return url;
    },
  });
  const run = (mediaKind = "video", onProgress = null) => genVideo("model", "prompt", { mediaKind, runKey: "node" }, null, onProgress);
  return { pending, replies, polled, settled, controller, reply, run, counts: () => ({ submissions, reads }) };
}

const complete = { data: { status: "COMPLETED", output: { url: "https://cdn.example/clip.mp4" } } };
const failed = { data: { status: "FAILED", error: "provider failed" } };
for (const file of ["index.html", "play.html"]) {
  for (const status of [401, 403, 404, 410]) {
    const r = loadRunner(file);
    r.replies.push(r.reply(status, failed));
    const hint = [401, 403].includes(status) ? ".*Sign in again" : "";
    await assert.rejects(r.run(), new RegExp(`HTTP ${status}${hint}`));
    assert.deepEqual(r.polled, ["paid-1"], `${file} HTTP ${status} stops at the first poll`);
    assert.deepEqual(r.counts(), { submissions: 1, reads: 1 }, "only the accepted POST response was read");
    assert.deepEqual(r.settled, []);
    assert.equal(r.pending.get("node").runId, "paid-1");
    r.replies.push(r.reply(200, complete));
    assert.equal(await r.run(), complete.data.output.url);
    assert.deepEqual(r.polled, ["paid-1", "paid-1"]);
    assert.equal(r.counts().submissions, 1, "same inputs retry the original charged job");
  }

  {
    const r = loadRunner(file);
    const wrong = { data: { status: "COMPLETED", output: { url: "https://wrong.example/unavailable" } } };
    r.replies.push(r.reply(503, wrong), r.reply(429, failed), r.reply(408, failed),
      () => { throw new TypeError("temporarily offline"); },
      r.reply(200, () => { throw new SyntaxError("partial body"); }),
      r.reply(200, complete));
    assert.equal(await r.run(), complete.data.output.url);
    assert.equal(r.polled.length, 6);
    assert.deepEqual(r.counts(), { submissions: 1, reads: 3 });
    assert.deepEqual(r.settled, [{ body: complete, refunded: false }], "only an HTTP success can settle a job");
  }

  for (const status of ["CANCELED", "cancelled", "ERROR", "FAILED", "CONTENT_POLICY_VIOLATION"]) {
    const r = loadRunner(file);
    const body = { data: { status, error: "provider terminal" } };
    r.replies.push(r.reply(200, body));
    await assert.rejects(r.run(), /video failed: provider terminal/);
    assert.deepEqual(r.polled, ["paid-1"]);
    assert.deepEqual(r.settled, [{ body, refunded: true }]);
    assert.equal(r.pending.has("node"), false);
    r.replies.push(r.reply(200, complete));
    assert.equal(await r.run(), complete.data.output.url);
    assert.deepEqual(r.polled, ["paid-1", "paid-2"], "a confirmed terminal failure allows a new submit");
  }

  {
    const r = loadRunner(file);
    const newer = { runId: "new-job", sig: "edited" };
    r.replies.push(r.reply(200, () => {
      r.pending.set("node", newer);
      return { status: "CANCELLED" };
    }));
    await assert.rejects(r.run(), /video failed: CANCELLED/);
    assert.equal(r.pending.get("node"), newer, "a terminal reply only retires its own registry entry");
  }

  {
    const r = loadRunner(file);
    const newer = { runId: "new-job", sig: "edited" };
    r.replies.push(r.reply(200, () => {
      r.pending.set("node", newer);
      return complete;
    }));
    assert.equal(await r.run(), complete.data.output.url);
    assert.equal(r.pending.get("node"), newer, "a late delivery cannot displace a newer paid job");
  }

  {
    const r = loadRunner(file);
    r.replies.push(r.reply(200, () => {
      r.controller.abort();
      return { status: "CANCELLED" };
    }));
    await assert.rejects(r.run(), { name: "AbortError" });
    assert.deepEqual(r.settled, []);
    assert.equal(r.pending.get("node").runId, "paid-1", "Stop before the status settles leaves the job resumable");
  }
  console.log(`✓ ${file}: built-in video polls distinguish HTTP errors, provider terminal responses, and Stop`);
}

{
  const r = loadRunner("index.html");
  r.replies.push(r.reply(401, failed));
  await assert.rejects(r.run("model3d"), /3D model status check failed \(HTTP 401\)/);
  const mesh = { data: { status: "SUCCEEDED", output: { model_url: "https://cdn.example/model.glb" } } };
  r.replies.push(r.reply(200, mesh));
  assert.equal(await r.run("model3d"), mesh.data.output.model_url);
  assert.deepEqual(r.polled, ["paid-1", "paid-1"]);
  assert.equal(r.counts().submissions, 1);
  console.log("✓ editor 3D status recovery polls the original model job and delivers the GLB");
}
