#!/usr/bin/env node
// Drives the editor, hosted app preview and standalone HTML with offline provider responses.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const { chromium } = await import(process.env.NANOODLE_PLAYWRIGHT
  ? pathToFileURL(resolve(process.env.NANOODLE_PLAYWRIGHT)).href : "playwright");
const { cases, legacy, ...graph } = JSON.parse(await readFile(resolve(root, "examples/conditional-execution/noodle-graph.json")));
const mime = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".woff2": "font/woff2" };
let exported;
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/portable.html" && exported) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(exported);
      return;
    }
    const file = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + sep)) throw Error("invalid path");
    const bytes = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = "http://localhost:" + server.address().port;
const models = Object.fromEntries(graph.nodes.filter(n => n.type === "llm").map(n => [n.fields.model, n.id]));
const catalog = Object.keys(models).map(id => ({ id, name: id, pricing: { prompt: 0.1, completion: 0.1 } }));
catalog.push({ id: graph.nodes[1].fields.model, pricing: { prompt: 0.1, completion: 0 }, decision_input: { available: true, image_input: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
let browser;
try {
  browser = await chromium.launch(process.env.NANOODLE_CHROMIUM ? { executablePath: process.env.NANOODLE_CHROMIUM } : {});
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    try { localStorage.setItem("ngpt_key", "nano-offline-fixture"); } catch {}
  });
  let calls = [], answers = [];
  const errors = [];
  await context.route("**/*", route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === origin) {
      if (url.pathname === "/sw.js") return route.fulfill({ contentType: "text/javascript", body: "// Offline fixture." });
      return route.continue();
    }
    if (url.hostname !== "nano-gpt.com") {
      if (req.method() === "POST") errors.push("unexpected POST " + url.hostname + url.pathname);
      return route.abort();
    }
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === "/api/check-balance") return route.fulfill({ headers: cors, json: { usd_balance: 10 } });
    if (req.method() === "GET") {
      const data = url.pathname.includes("models") ? catalog : [];
      return route.fulfill({ headers: cors, json: { data, balance: 10, remainingBalance: 10 } });
    }
    const payload = req.postDataJSON();
    if (url.pathname === "/api/v1/decisions") {
      calls.push(calls.includes("n2") ? "n5" : "n2");
      const value = answers.shift();
      const answer = value == null ? null : { type: "noul", noul: value };
      return route.fulfill({ headers: cors, json: { answers: { answer }, usage: { cost: 0.001 } } });
    }
    if (url.pathname === "/api/v1/chat/completions" && models[payload.model]) {
      const id = models[payload.model];
      calls.push(id);
      return route.fulfill({ headers: cors, json: { choices: [{ message: { content: id } }], cost: 0.001 } });
    }
    errors.push("unexpected provider call " + url.pathname);
    return route.abort();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  await page.goto(origin + "/?engine=play");
  await page.waitForFunction(() => typeof readWorkspaces === "function" && !wsRestorePending && !initialCanvasUnclaimed() && readWorkspaces());
  const load = async (data, routerType) => {
    await page.locator("#loadfile").setInputFiles({
      name: "decider.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)),
    });
    await page.waitForFunction(type => serializeGraph().nodes.some(n => n.id === "n2" && n.type === type), routerType);
  };
  await page.locator("#addbtn").click();
  await page.locator("#addsearch").fill("branch");
  await page.locator('#addlist button[data-type="decide"]').first().click();
  const added = page.locator(".node").filter({ has: page.locator("[data-decide-mode]") }).last();
  await added.getByRole("combobox", { name: "Decision mode" }).selectOption("yesno");
  await added.getByRole("checkbox", { name: "Enable Yes/No branching" }).check();
  assert.equal(await added.locator('.port[data-port="yes"], .port[data-port="no"]').count(), 2);
  await load(legacy, "decide");
  assert.equal(await page.evaluate(() => serializeGraph().nodes.find(n => n.id === "n2").fields.gate), true);
  answers = [0];
  await page.locator("#run").click();
  await page.locator('.node[data-id="n4"][data-status="skip"]').waitFor();
  assert.deepEqual(calls, ["n2"], "the legacy gate retains its old behavior after import");
  await load(graph, "decide-branch");
  assert.equal(await page.locator('.node[data-id="n2"] [data-decide-branch]').isChecked(), true);
  const router = page.locator('.node[data-id="n2"]');
  assert.equal(await router.locator('.port[data-port="yes"], .port[data-port="no"]').count(), 2);
  const overlaps = await page.evaluate(() => graph.nodes.flatMap((a, i) =>
    graph.nodes.slice(i + 1).filter(b => a.x < b.x + b.el.offsetWidth && b.x < a.x + a.el.offsetWidth
      && a.y < b.y + b.el.offsetHeight && b.y < a.y + a.el.offsetHeight).map(b => [a.id, b.id])));
  assert.deepEqual(overlaps, [], "example cards leave all controls reachable");
  await router.getByRole("checkbox", { name: "Enable Yes/No branching" }).click();
  assert.equal(await router.locator("[data-decide-branch]").isChecked(), true);
  await page.getByText("Disconnect the yes and no wires before turning branching off.", { exact: true }).waitFor();
  await router.getByRole("combobox", { name: "Decision mode" }).selectOption("choose");
  assert.equal(await router.locator("[data-decide-mode]").inputValue(), "yesno");
  assert.deepEqual(await page.evaluate(() => serializeGraph().links), graph.links);
  await page.locator("#runest").getByText("all branches").waitFor();

  for (const scenario of cases) {
    calls = [];
    answers = [...scenario.answers];
    // A different request on each run forces a fresh answer without replacing
    // the canvas, so stale outputs from the previous branch would be visible.
    await page.locator('.node[data-id="n1"] textarea[data-f="text"]').fill("Request for " + scenario.name);
    await page.locator("#run").click();
    await page.waitForFunction(() => !seedRuns.size);
    assert.deepEqual(calls.sort(), [...scenario.calls].sort(), scenario.name);
    const outcome = await page.evaluate(() => Object.fromEntries(
      graph.nodes.map(n => [n.id, { status: n.el.dataset.status, text: n.out.text }])));
    if (!scenario.error) {
      assert.equal(outcome.n9.text, scenario.output);
      for (const id of scenario.skipped) assert.equal(outcome[id].status, "skip");
    } else {
      assert.equal(outcome.n9.status, "skip");
    }
  }
  console.log("✓ Editor: legacy import, both branches, joins, nested routes, malformed answers and fresh decisions on retry");

  await page.locator("#makeapp").click();
  await page.waitForFunction(() => typeof appFrameLoaded !== "undefined" && appFrameLoaded);
  const builder = page.frameLocator("#appmodalframe");
  const runner = builder.frameLocator("#appframe");
  await runner.locator("#app-runcost").getByText("all branches").waitFor();
  await runner.locator("details.opt summary").click();
  const decisionSettings = runner.locator(".setgroup").filter({ hasText: "Technical topic?" });
  await decisionSettings.waitFor();
  assert.equal(await decisionSettings.getByText("Question", { exact: true }).count(), 1);
  assert.equal(await decisionSettings.getByText("Gate: stop downstream on no", { exact: true }).count(), 0);
  assert.equal(await decisionSettings.getByText("Decide", { exact: true }).count(), 0);
  calls = [];
  answers = [0, 1];
  await runner.locator("#app-run").click();
  await runner.locator("#app-output").getByText("n6", { exact: true }).waitFor();
  assert.deepEqual(calls.sort(), ["n2", "n3", "n5", "n6"]);
  const [download] = await Promise.all([page.waitForEvent("download"), builder.locator("#export").click()]);
  exported = await readFile(await download.path());
  const portable = await context.newPage();
  await portable.goto(origin + "/portable.html");
  calls = [];
  answers = [1];
  await portable.locator("#app-run").click();
  await portable.locator("#app-output").getByText("n4", { exact: true }).waitFor();
  assert.deepEqual(calls.sort(), ["n2", "n3", "n4"]);
  assert.deepEqual(errors, []);
  console.log("✓ App preview and standalone export: only selected model calls, including the nested branch");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
