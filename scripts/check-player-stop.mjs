#!/usr/bin/env node
// Drive the real player runtime with controlled browser and provider completions.
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { loadEngine, recordingFetch } from "./play-engine.mjs";

function player(extend) {
  let ctx;
  const app = loadEngine(sandbox => {
    ctx = sandbox;
    ctx.location.search = "?engine=play";
    extend?.(ctx);
  }, {
    prepareRuntime(source) {
      const anchor = "let ABORT = null;";
      assert.ok(source.includes(anchor), "test can access the player's Stop controller");
      return source.replace(anchor, anchor + " window.__testSetController = controller => { ABORT = controller; };");
    },
  });
  return { app, setController: ctx.__testSetController };
}

function run(app, graph, options) {
  const states = [];
  const results = [];
  const settled = app.runGraph(graph, {
    ...options,
    onStatus: (id, kind) => states.push([id, kind]),
    onResult: node => results.push(node.id),
  });
  return { states, results, settled };
}

function assertUnpublished(graph, id, result) {
  assert.deepEqual(Object.keys(graph.byId(id).out), [], id + " has no late output");
  assert.equal(graph.byId(id)._sig, undefined, id + " has no success signature");
  assert.ok(!result.states.some(([node, kind]) => node === id && kind === "done"), id + " was never marked done");
  assert.ok(!result.results.includes(id), id + " never reached onResult");
}

test("Stop drains an independent sibling and discards a late browser frame", { timeout: 3000 }, async () => {
  const metadata = Promise.withResolvers();
  const siblingStarted = Promise.withResolvers();
  const controller = new AbortController();
  const { app, setController } = player(ctx => {
    Object.assign(ctx, { setTimeout, clearTimeout });
    ctx.__createElement = tag => {
      if (tag === "canvas") return { getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,AAAA" };
      if (tag === "video") return {
        duration: 2, videoWidth: 16, videoHeight: 16, readyState: 1,
        removeAttribute() {}, load() {},
        set onloadedmetadata(fn) { metadata.resolve(fn); },
        set currentTime(time) { this.time = time; queueMicrotask(() => this.seeked?.()); },
        get currentTime() { return this.time ?? 0; },
        addEventListener(type, fn) { if (type === "seeked") this.seeked = fn; },
        removeEventListener() { this.seeked = null; },
      };
    };
  });
  app.NODE_TYPES.text.run = () => new Promise((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    siblingStarted.resolve();
  });
  setController(controller);
  const graph = app.materialize({
    nodes: [
      { id: "input", type: "vupload", fields: { video: "data:video/mp4;base64,AAAA" } },
      { id: "frame", type: "vframes", fields: { frames: 1 } },
      { id: "sibling", type: "text", fields: { text: "independent" } },
    ],
    links: [{ from: { node: "input", port: "video" }, to: { node: "frame", port: "video" } }],
  });
  const result = run(app, graph);
  const [finishMetadata] = await Promise.all([metadata.promise, siblingStarted.promise]);
  const beforeStop = result.states.slice();
  let didSettle = false;
  const stopped = assert.rejects(result.settled, { name: "AbortError" }).finally(() => { didSettle = true; });
  controller.abort();
  await setImmediate();
  const settledBeforeDecoder = didSettle;
  finishMetadata();
  await stopped;
  assert.equal(settledBeforeDecoder, false, "the controller stays owned until its decoder drains");
  assert.deepEqual(result.states, beforeStop, "late decoder progress remains hidden");
  assertUnpublished(graph, "frame", result);
});

for (const reuse of ["shared work", "fixed-seed cache"]) {
  test("Stop prevents a waiter publishing via " + reuse, { timeout: 3000 }, async () => {
    const generated = Promise.withResolvers();
    const release = Promise.withResolvers();
    const { app, setController } = player();
    const graphForRun = () => app.materialize({
      nodes: [{ id: "image", type: "image", fields: {
        prompt: "a cat", model: "test", seed: reuse === "fixed-seed cache" ? "42" : "",
      } }],
      links: [],
    });
    const first = graphForRun();
    const second = graphForRun();
    let calls = 0;
    app.NODE_TYPES.image.run = () => {
      calls++;
      generated.resolve();
      return release.promise;
    };
    const owner = new AbortController();
    setController(owner);
    const primary = run(app, first, { lane: 0 });
    await generated.promise;

    const waiter = new AbortController();
    setController(waiter);
    const lane = reuse === "fixed-seed cache" ? 1 : 0;
    const secondary = run(app, second, { lane });
    const stopped = assert.rejects(secondary.settled, { name: "AbortError" });
    await setImmediate();
    waiter.abort();
    setController(owner);
    release.resolve({ image: "data:image/png;base64,CAT" });
    await Promise.all([primary.settled, stopped]);

    assertUnpublished(second, "image", secondary);
    assert.equal(first.byId("image").out.image, "data:image/png;base64,CAT");
    assert.equal(calls, 1, "the waiter shared the original generation");
    await app.runGraph(second, { lane });
    assert.equal(calls, reuse === "fixed-seed cache" ? 1 : 2, "the waiter released its work slot");
    assert.equal(second.byId("image").out.image, first.byId("image").out.image);
  });
}

test("Stop during a finished paid video download keeps it resumable", { timeout: 3000 }, async () => {
  const downloading = Promise.withResolvers();
  const bytes = Promise.withResolvers();
  const content = "/api/generate-video/content?runId=paid-video";
  let submits = 0, polls = 0, downloads = 0;
  const json = obj => new Response(JSON.stringify(obj));
  const { app, setController } = player(ctx => {
    ctx.fetch = async (url, init) => {
      const { pathname } = new URL(url);
      if (pathname === "/api/generate-video") {
        submits++;
        return json({ runId: "paid-video", cost: 0.25 });
      }
      if (pathname === "/api/video/status") {
        polls++;
        return json({ data: { status: "COMPLETED", output: { url: content } } });
      }
      if (pathname === "/api/generate-video/content") {
        downloads++;
        return {
          ok: true, status: 200, headers: new Headers({ "content-type": "video/mp4" }),
          arrayBuffer() {
            downloading.resolve();
            return bytes.promise;
          },
        };
      }
      return recordingFetch(url, init);
    };
  });
  const controller = new AbortController();
  setController(controller);
  const graph = app.materialize({
    nodes: [{ id: "video", type: "tvideo", fields: { model: "veo", prompt: "a cat" } }],
    links: [],
  });
  const result = run(app, graph);
  await downloading.promise;
  const stopped = assert.rejects(result.settled, { name: "AbortError" });
  controller.abort();
  bytes.resolve(Uint8Array.of(1, 2, 3).buffer);
  await stopped;
  assertUnpublished(graph, "video", result);
  setController(new AbortController());
  const retry = run(app, graph);
  await retry.settled;
  assert.deepEqual([submits, polls, downloads], [1, 1, 2]);
  assert.deepEqual(retry.results, ["video"]);
  assert.equal(graph.byId("video").out.video, "data:video/mp4;base64,AQID");
});
