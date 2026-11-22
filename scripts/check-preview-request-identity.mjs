#!/usr/bin/env node
// Exercise the shipped standalone runtime and builder bridge against delayed
// provider fixtures. The preview deliberately reuses one WindowProxy.
import assert from "node:assert/strict";
import vm from "node:vm";
import { loadEngine } from "./play-engine.mjs";

const originalKey = "fixture-original";
const replacementKey = "fixture-replacement";
const chatPath = "/api/v1/chat/completions";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function mockStorage(ctx, storage) {
  ctx.localStorage.getItem = key => storage.get(key) ?? null;
  ctx.localStorage.setItem = (key, value) => storage.set(key, value);
  ctx.localStorage.removeItem = key => storage.delete(key);
}

async function standalone(status, replaceKey) {
  const storage = new Map([["ngpt_key", originalKey], ["njs_engine", "0"]]);
  const sent = deferred(), answer = deferred();
  const app = loadEngine(ctx => {
    mockStorage(ctx, storage);
    ctx.fetch = async (url, opts) => {
      if (!String(url).endsWith(chatPath)) return Response.json({ data: [] });
      sent.resolve(opts.headers["x-api-key"]);
      return answer.promise;
    };
  });
  const graph = app.materialize({
    nodes: [{ id: "n", type: "llm", fields: { prompt: "Fixture prompt", model: "fixture-model" } }],
    links: [],
  });
  const errors = [];
  const run = app.runGraph(graph, {
    onStatus: (_id, kind, msg) => { if (kind === "error") errors.push(String(msg)); },
  });
  assert.equal(await sent.promise, originalKey);
  if (replaceKey) storage.set("ngpt_key", replacementKey);
  answer.resolve(new Response("fixture rejected", { status }));
  await run;
  assert.equal(storage.get("ngpt_key"), replaceKey ? replacementKey : undefined);
  assert(errors.some(msg => msg.includes(String(status))), "the run still surfaces a rejected request");
}

function preview() {
  const appsKey = "noodle_apps";
  const storage = new Map([
    ["ngpt_key", originalKey],
    [appsKey, JSON.stringify([{ id: "first-app", imported: true }, { id: "second-app", imported: true }])],
  ]);
  const replies = [], writes = [];
  const started = deferred(), releaseBody = deferred();
  const frame = { contentWindow: { postMessage: reply => replies.push(reply) } };
  let context, onMessage, fetches = 0;
  loadEngine(ctx => {
    context = ctx;
    mockStorage(ctx, storage);
    const doc = ctx.document;
    ctx.document = new Proxy(doc, {
      get(target, prop, receiver) {
        if (prop === "getElementById") return id => id === "appframe" ? frame : target.getElementById(id);
        if (prop === "body") return { ...target.body, classList: { remove() {} } };
        return Reflect.get(target, prop, receiver);
      },
    });
    ctx.addEventListener = (type, fn) => {
      if (type === "message" && String(fn).includes('d.type === "__api__"')) onMessage = fn;
    };
    ctx.fetch = async (url, opts) => {
      assert(String(url).endsWith(chatPath));
      assert.equal(opts.headers["x-api-key"], originalKey);
      fetches++;
      return {
        status: 200, ok: true, type: "basic",
        headers: new Headers({ "content-type": "application/json" }),
        arrayBuffer() { started.resolve(); return releaseBody.promise; },
      };
    };
    ctx.recordDisclosure = appId => writes.push(appId);
  });
  assert.equal(typeof onMessage, "function", "captured the shipped builder bridge");
  const run = code => vm.runInContext(code, context);
  run(`
    paintBal = () => {};
    cacheBal = () => {};
    writeState = () => { recordDisclosure(CUR_ID); return true; };
    APP_STATE.files = {"index.html": "<!doctype html><html><head></head><body></body></html>"};
    CUR_ID = "first-app"; curImported = true; curArmed = true; BAL = 10;
    renderApp();
  `);
  const event = {
    source: frame.contentWindow,
    data: { type: "__api__", mount: run("previewMount"), id: 1, url: chatPath, method: "POST", body: "{}" },
  };
  assert(frame.srcdoc.includes(`window.NOODLE_PREVIEW_MOUNT=${event.data.mount}`), "the iframe receives its own render identity");
  const request = onMessage(event);
  return {
    async finish() {
      const body = JSON.stringify({ x_nanogpt_pricing: { remainingBalance: 9 }, fixture: "dispatched result" });
      releaseBody.resolve(new TextEncoder().encode(body).buffer);
      await request;
    },
    started: started.promise,
    replaceKey() { storage.set("ngpt_key", replacementKey); run("BAL = 25"); },
    remount(newApp) {
      if (newApp) run('CUR_ID = "second-app"; curRanOnce = false;');
      run("renderApp()");
    },
    deleteOriginal() { storage.set(appsKey, JSON.stringify([{ id: "second-app", imported: true }])); },
    readApps: () => JSON.parse(storage.get(appsKey)),
    sendOldRequest: () => onMessage(event),
    fetches: () => fetches,
    sendStaleCost() {
      return onMessage({ source: frame.contentWindow, data: { type: "__cost__", total: 1, balance: 9, count: 1 } });
    },
    replies: () => replies.filter(reply => reply.type === "__api_result__"),
    balance: () => run("BAL"),
    sessionCost: () => run("SES.cost"),
    writes,
  };
}

await standalone(401, false);
await standalone(403, true);

{
  const app = preview();
  await app.started;
  await app.finish();
  assert.equal(app.balance(), 9, "current wire balance reaches the builder");
  assert.deepEqual(app.writes, ["first-app"]);
  assert.match(new TextDecoder().decode(app.replies()[0].body), /dispatched result/);
}

{
  const app = preview();
  await app.started;
  app.replaceKey();
  await app.finish();
  assert.equal(app.balance(), 25, "old account must not update the replacement balance");
  assert.deepEqual(app.writes, ["first-app"], "the original preview still owns its successful charge disclosure");
  assert.match(app.replies()[0]?.error ?? "", /account changed/);
  assert.equal(app.replies()[0]?.body, undefined, "the response body belongs to the old account");
  await app.sendStaleCost();
  assert.equal(app.balance(), 25, "the iframe cannot republish its previous account balance");
  assert.equal(app.sessionCost(), 1, "session costs still reach the builder");
}

for (const newApp of [false, true]) {
  const app = preview();
  await app.started;
  app.remount(newApp);
  const stale = app.sendOldRequest();
  assert.equal(app.fetches(), 1, "a stale queued request must not reach its provider after remount");
  await app.finish();
  await stale;
  assert.deepEqual(app.replies(), [], "a remount must fence off in-flight API replies on the same WindowProxy");
  assert.deepEqual(app.writes, newApp ? [] : ["first-app"], "the response must not unlock a different app");
  if (newApp) assert.deepEqual(app.readApps().map(a => !!a.ranOnce), [true, false], "only the original app records the completed charge");
  assert.equal(app.balance(), 9, "a different preview still shares the original account balance");
}

{
  const app = preview();
  await app.started;
  app.remount(true);
  app.deleteOriginal();
  await app.finish();
  assert.deepEqual(app.readApps(), [{ id: "second-app", imported: true }], "a settled charge cannot recreate a deleted app");
}

console.log("✓ Standalone auth and preview responses keep their original account and app owners.");
