// Real signed-out Render 3D runs in the hosted sandbox and its exported HTML.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export async function checkPlayerRender3d({ browser, origin, root }) {
  const file = resolve(root, "scripts/fixtures/rotoscope/two-cube.glb");
  const model = "data:model/gltf-binary;base64," + (await readFile(file)).toString("base64");
  const graph = { v:1, nid:3, lid:2, nodes:[
    { id:"model", type:"mupload", name:"Model", x:20, y:20, fields:{} },
    { id:"render", type:"render3d", name:"Render 3D", x:300, y:20, fields:{
      width:64, height:64, background:"transparent", mode:"image", duration:0.5, fps:4,
    } },
  ], links:[{ id:"link", from:{node:"model", port:"model"}, to:{node:"render", port:"model"} }] };
  const link = origin + "/play.html#g=" + gzipSync(JSON.stringify(graph)).toString("base64url");
  const unexpected = [];
  const context = await browser.newContext({ serviceWorkers:"block", acceptDownloads:true });
  const temp = await mkdtemp(resolve(tmpdir(), "nanoodle-render3d-"));
  let offline = false;
  await context.route(/^https?:/, route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!offline && url.origin === origin) return route.continue();
    if (offline || request.method() !== "GET" || url.origin !== "https://nano-gpt.com") unexpected.push(request.url());
    if (!offline && url.origin === "https://nano-gpt.com") return route.fulfill({json:{data:[]}});
    return route.abort();
  });
  try {
    const player = await context.newPage();
    await player.goto(link);
    const preview = player.frameLocator("#appframe");
    const upload = preview.locator('#app-inputs input[type="file"][accept*=".glb"]');
    await upload.waitFor();
    const frame = await player.locator("#appframe").elementHandle().then(el=>el.contentFrame());
    assert.equal(await frame.evaluate(()=>self.origin), "null", "hosted export remains sandboxed");
    await upload.setInputFiles(file);
    await preview.locator("#app-run").click();
    await preview.locator('#app-output img[src^="data:image/png"]').waitFor();
    if (await verifyOutputs(frame, graph, model)) await verifyVideoCard(player, preview);

    const [download] = await Promise.all([player.waitForEvent("download"), player.locator("#export").click()]);
    const exportPath = resolve(temp, "render3d.html");
    await download.saveAs(exportPath);
    offline = true;
    const exported = await context.newPage();
    await exported.goto(pathToFileURL(exportPath).href);
    await exported.locator('#app-inputs input[type="file"][accept*=".glb"]').setInputFiles(file);
    await exported.locator("#app-run").click();
    await exported.locator('#app-output img[src^="data:image/png"]').waitFor();
    if (await verifyOutputs(exported, graph, model)) await verifyVideoCard(exported, exported);
    assert.deepEqual(unexpected, [], "Render 3D uses no paid requests or network access from the exported file");
  } finally {
    await context.close();
    await rm(temp, {recursive:true, force:true});
  }
  console.log("✓ Render 3D runs signed out in the hosted sandbox and offline export");
}

async function verifyOutputs(page, graph, model) {
  const checks = await page.evaluate(async ({data, model})=>{
    const app = window.NoodleApp;
    const run = async (mode, wired) => {
      const draft = structuredClone(data);
      draft.nodes[0].fields.model = model;
      if (!wired) draft.links = [];
      if (mode === "video") {
        draft.nodes.push({id:"mode", type:"text", fields:{text:"video"}});
        draft.links.push({id:"mode-wire", from:{node:"mode", port:"text"}, to:{node:"render", port:"mode"}});
      }
      const graph = app.materialize(draft);
      const errors = [];
      const report = await app.runGraph(graph, {onStatus(id, status, text){
        if (id === "render" && status === "error") errors.push(text);
      }});
      const node = graph.byId("render");
      return { errors, nodeErrors:report.nodeErrors, out:node.out, primary:app.primaryOutputPort(node).name };
    };
    return { image:await run("image", true), video:await run("video", true), unwired:await run("image", false) };
  }, { data:graph, model });
  assert.equal(checks.image.nodeErrors, 0);
  assert.deepEqual(Object.keys(checks.image.out), ["image"]);
  assert.equal(checks.image.primary, "image");
  const png = Buffer.from(checks.image.out.image.split(",")[1], "base64");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 64);
  assert.equal(png.readUInt32BE(20), 64);
  if (checks.video.nodeErrors) {
    assert.deepEqual(Object.keys(checks.video.out), []);
    assert.match(checks.video.errors.join(" "), /cannot encode Render 3D MP4|cannot encode H\.264/);
    console.log("Chromium has no usable H.264 encoder. Render 3D surfaced the codec error.");
  } else {
    assert.deepEqual(Object.keys(checks.video.out), ["video"]);
    assert.equal(checks.video.primary, "video", "the wired mode determines output presentation");
    assert.match(checks.video.out.video, /^data:video\/mp4;base64,/);
    const mp4 = Buffer.from(checks.video.out.video.split(",")[1], "base64");
    assert.equal(mp4.toString("ascii", 4, 8), "ftyp");
    assert.ok(mp4.includes(Buffer.from("moov")) && mp4.includes(Buffer.from("avc1")));
  }
  assert.equal(checks.unwired.nodeErrors, 1);
  assert.match(checks.unwired.errors.join(" "), /Connect a 3D model first/);
  return checks.video.nodeErrors === 0;
}

async function verifyVideoCard(page, scope) {
  const settings = scope.locator("#app-inputs details.opt");
  await settings.locator("summary").click();
  await settings.locator('select:has(option[value="video"])').selectOption("video");
  await scope.locator("#app-run:not(.stop)").click();
  const card = scope.locator('#app-output .card:has(video[src^="data:video/mp4"])');
  await card.waitFor();
  assert.equal(await card.locator("img").count(), 0,
    "the video sink is presented as video even though the first declared port is image");
  const [download] = await Promise.all([page.waitForEvent("download"), card.locator(".dlrow .dl").click()]);
  assert.match(download.suggestedFilename(), /\.mp4$/);
  assert.equal(await download.failure(), null);
  console.log("✓ Render 3D video output is displayed and downloads as MP4");
}
