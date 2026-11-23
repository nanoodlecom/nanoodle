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

function preview({path = chatPath, responseBody} = {}) {
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
      assert(String(url).endsWith(path));
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
  const auth = () => {
    run("pushAuthToApp()");
    return replies.at(-1);
  };
  const original = auth();
  const event = {
    source: frame.contentWindow,
    data: { type: "__api__", mount: run("previewMount"), credential: original.credential,
      id: 1, url: path, method: "POST", body: "{}" },
  };
  assert(frame.srcdoc.includes(`window.NOODLE_PREVIEW_MOUNT=${event.data.mount}`), "the iframe receives its own render identity");
  const request = onMessage(event);
  return {
    async finish() {
      const body = JSON.stringify(responseBody || { x_nanogpt_pricing: { remainingBalance: 9 }, fixture: "dispatched result" });
      releaseBody.resolve(new TextEncoder().encode(body).buffer);
      await request;
    },
    started: started.promise,
    auth,
    original,
    replaceKey() { storage.set("ngpt_key", replacementKey); run("BAL = 25"); },
    restoreKey() { storage.set("ngpt_key", originalKey); },
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

{
  const app = preview();
  await app.started;
  await app.finish();
  assert.equal(app.original.signedIn, true);
  assert.notEqual(app.original.credential, originalKey);
  assert.ok(!JSON.stringify(app.original).includes(originalKey), "the sandbox gets only the opaque ID");
  app.replaceKey();
  const replacement = app.auth();
  assert.notEqual(replacement.credential, app.original.credential);
  assert.ok(!JSON.stringify(replacement).includes(replacementKey));
  await app.sendOldRequest();
  assert.equal(app.fetches(), 1, "a stale credential ID must be rejected before network");
  assert.equal(app.replies().at(-1).accountChanged, true);
  app.restoreKey();
  assert.equal(app.auth().credential, app.original.credential, "returning to the exact key restores its scope");
}

for (const [path, audio] of [["/api/generate-video", false], ["/api/v1/audio/speech", true]]) {
  const receipt = {runId:"fixture-paid-job", cost:0.25};
  const audioMeta = {paymentSource:"balance", isApiRequest:true};
  const app = preview({path, responseBody:{
    ...receipt, ...audioMeta, resultUrl:"https://private.example/should-not-leave", credential:originalKey, remainingBalance:8,
  }});
  await app.started;
  app.replaceKey();
  await app.finish();
  const reply = app.replies()[0];
  assert.equal(reply.ok, true, "an accepted async submit remains recoverable");
  const body = new TextDecoder().decode(reply.body);
  assert.deepEqual(JSON.parse(body), audio ? {...receipt, ...audioMeta} : receipt);
  assert.equal(app.balance(), 25);
}

{
  const app = preview({path:"/api/v1/audio/speech", responseBody:{
    id:"a-receipt-is-not-a-job", audioUrl:"https://private.example/audio.mp3",
  }});
  await app.started;
  app.replaceKey();
  await app.finish();
  assert.equal(app.replies()[0]?.accountChanged, true);
  assert.equal(app.replies()[0]?.body, undefined, "a finished response cannot masquerade as a resumable job");
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
