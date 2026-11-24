#!/usr/bin/env node
// Drive both shipped fallback audio pollers with mocked responses and a fake clock.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function poller(file) {
  const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const source = html.match(/^( *)async function pollAudio\([\s\S]*?^\1}/m)?.[0];
  assert.ok(source, `${file} fallback pollAudio found`);
  const pending = new Map(), responses = [], settlements = [], requests = [];
  const controller = new AbortController();
  let elapsed = 0, reads = 0;
  const fetch = async (url, options) => {
    requests.push({ url, options });
    return responses.shift()?.() ?? reply(200, { status: "processing" })();
  };
  const reply = (status, body) => () => ({
    status, ok: status >= 200 && status < 300,
    async json() {
      reads++;
      if (typeof body === "function") return body();
      return body;
    },
  });
  const ctx = vm.createContext({
    URLSearchParams, DOMException, fetch, apiFetch: fetch,
    Date: { now: () => elapsed }, sleep: async ms => { elapsed += ms; },
    NANOGPT: "https://provider.example", getKey: () => "fixture-key", authHeaders: () => ({}),
    ABORT: controller,
    abortError: () => new DOMException("canceled", "AbortError"),
    PENDING_AUDIO: pending,
    applyPollSettlement: (body, _response, refunded) => settlements.push({ body, refunded }),
    applyPollBalance: (body, _response, refunded) => settlements.push({ body, refunded }),
  });
  const credentialGuard = html.match(/^function assertRunCredential\([^)]*\)\{[\s\S]*?^\}/m)?.[0] || "";
  vm.runInContext(credentialGuard + "\n" + source, ctx);
  const job = { runId: "paid-audio", cost: 0.25, paymentSource: "balance", isApiRequest: false };
  return {
    pending, responses, requests, settlements, controller, reply,
    reads: () => reads, run: (j = job) => ctx.pollAudio("audio-model", j, null, "node", "same-input", controller.signal, pending, "fixture-key"),
  };
}

const completed = { status: "completed", audioUrl: "https://cdn.example/audio.mp3" };
for (const file of ["index.html", "play.html"]) {
  for (const status of [401, 403, 404, 410]) {
    const p = poller(file);
    p.responses.push(p.reply(status, { status: "error", error: "status access denied" }));
    const hint = [401, 403].includes(status) ? ".*Sign in again" : "";
    await assert.rejects(p.run(), new RegExp(`HTTP ${status}${hint}`));
    assert.equal(p.requests.length, 1, `${file} HTTP ${status} stops immediately`);
    assert.equal(p.reads(), 0, "an HTTP failure is distinct from a provider job failure");
    assert.deepEqual(p.settlements, []);
    const charged = p.pending.get("node").job;
    assert.equal(charged.runId, "paid-audio");
    p.responses.push(p.reply(200, completed));
    assert.equal(await p.run(charged), completed.audioUrl);
    const query = new URL(p.requests.at(-1).url).searchParams;
    assert.equal(query.get("runId"), "paid-audio");
    assert.equal(query.get("cost"), "0.25");
    assert.equal(query.get("paymentSource"), "balance");
    assert.equal(query.get("isApiRequest"), "false");
  }

  {
    const p = poller(file);
    p.responses.push(
      p.reply(408, { status: "cancelled" }),
      p.reply(429, { status: "completed", audioUrl: "https://wrong.example/limit" }),
      p.reply(503, { status: "failed" }),
      () => { throw new TypeError("provider is temporarily unreachable"); },
      p.reply(200, () => { throw new SyntaxError("truncated status JSON"); }),
      p.reply(200, completed),
    );
    assert.equal(await p.run(), completed.audioUrl);
    assert.equal(p.requests.length, 6);
    assert.equal(p.reads(), 2, "transient HTTP bodies are never read as job status");
    assert.deepEqual(p.settlements, [{ body: completed, refunded: false }]);
    assert.equal(p.pending.get("node").resultUrl, completed.audioUrl);
  }

  for (const body of [
    { status: "Canceled", error: "Provider canceled job" },
    { data: { status: "CANCELLED", error: { message: "Provider canceled job" } } },
  ]) {
    const p = poller(file);
    p.responses.push(p.reply(200, body));
    await assert.rejects(p.run(), /audio failed: Provider canceled job/);
    assert.equal(p.requests.length, 1, `${file} terminal cancellation stops polling`);
    assert.deepEqual(p.settlements, [{ body, refunded: true }]);
    assert.equal(p.pending.has("node"), false, "provider cancellation retires the charged job");
  }

  {
    const p = poller(file);
    const newer = { sig: "new-input", job: { runId: "new-job" } };
    p.responses.push(p.reply(200, () => {
      p.pending.set("node", newer);
      return { status: "cancelled" };
    }));
    await assert.rejects(p.run(), /audio failed: cancelled/);
    assert.equal(p.pending.get("node"), newer, "a late cancellation cannot remove a replacement slot");
  }

  {
    const p = poller(file);
    p.responses.push(p.reply(200, () => {
      p.controller.abort();
      return { status: "cancelled" };
    }));
    await assert.rejects(p.run(), { name: "AbortError" });
    assert.deepEqual(p.settlements, []);
    assert.equal(p.pending.get("node").job.runId, "paid-audio", "Stop leaves the charged job resumable");
  }

  {
    const p = poller(file);
    p.responses.push(() => { throw new DOMException("request aborted", "AbortError"); });
    await assert.rejects(p.run(), { name: "AbortError" });
    assert.equal(p.requests.length, 1);
    assert.equal(p.pending.get("node").job.runId, "paid-audio");
  }
  console.log(`✓ ${file}: fallback audio HTTP errors, provider cancellations, and Stop preserve the right job state`);
}
