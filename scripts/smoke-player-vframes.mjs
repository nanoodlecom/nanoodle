import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const fixtures = [
  { file:"cfr", title:"CFR stride", indices:[3,5,7],
    fields:{ frames:5, dir:"start", gap:1.2, stride:2, startSec:0.125, endSec:0.292 } },
  { file:"vfr", title:"VFR reverse", indices:[5,3],
    fields:{ frames:5, dir:"end", stride:2, startSec:0.09, endSec:0.6 } },
];

function savedGraph() {
  const nodes = [], links = [];
  for (const { file, title, fields } of fixtures) {
    nodes.push({ id:file, type:"vupload", name:file.toUpperCase()+" source", fields:{} });
    nodes.push({ id:file+"-frames", type:"vframes", name:title, fields });
    links.push({ id:file+"-wire", from:{ node:file, port:"video" }, to:{ node:file+"-frames", port:"video" } });
  }
  return { v:1, nodes, links };
}

async function replay(app, root) {
  for (const { file, title, fields } of fixtures) {
    const group = app.locator(".setgroup").filter({hasText:title});
    for (const [label, value] of [["Frame stride",fields.stride],["Range start (s)",fields.startSec],["Range end (s)",fields.endSec]]) {
      const knob = group.getByLabel(label, { exact:true });
      await knob.waitFor({state:"attached",timeout:10000});
      assert.equal(await knob.inputValue(),String(value));
    }
    await app.getByLabel(file.toUpperCase()+" source")
      .setInputFiles(join(root,"scripts/fixtures/rotoscope",file+".mp4"));
  }
  const previews = app.locator("#app-inputs video");
  await previews.nth(fixtures.length-1).waitFor({state:"attached",timeout:10000});
  await app.locator("#app-run").click();

  const cards = app.locator("#app-output .card:has(.frames img)");
  try {
    await cards.nth(fixtures.length-1).waitFor({state:"visible",timeout:15000});
  } catch (cause) {
    const status = await app.locator("#app-status").textContent();
    throw new Error("Exact frames did not render. Player status: "+status,{cause});
  }
  const rendered = await cards.evaluateAll(async cards=>{
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    return Promise.all(cards.map(card=>Promise.all(Array.from(card.querySelectorAll(".frames img"),async image=>{
      await image.decode();
      ctx.drawImage(image,0,0,1,1);
      return ctx.getImageData(0,0,1,1).data[0];
    }))));
  });
  assert.equal(rendered.length,fixtures.length);
  for (const { title, indices } of fixtures) {
    const values = rendered.find(values=>values.length===indices.length);
    assert.ok(values,title+" frame count "+indices.length);
    for (const [i, index] of indices.entries()) {
      assert.ok(Math.abs(values[i]-(20+3*index))<=2,`${title} frame ${i+1} comes from source index ${index} (red channel ${values[i]})`);
    }
  }
}

export async function verifyPlayerVframes(browser, { origin, root }) {
  const requestedPosts = [];
  const player = await browser.newContext({locale:"en-US",serviceWorkers:"block"});
  const standalone = await browser.newContext({locale:"en-US",serviceWorkers:"block",offline:true});
  const dir = await mkdtemp(join(tmpdir(),"nanoodle-player-vframes-"));
  try {
    await player.route("**/*", route=>{
      const request = route.request();
      if (request.method()==="POST") requestedPosts.push(new URL(request.url()).pathname);
      return new URL(request.url()).origin===origin && request.method()==="GET" ? route.continue() : route.abort();
    });
    const page = await player.newPage();
    await page.goto(origin+"/play#g="+gzipSync(JSON.stringify(savedGraph())).toString("base64url"));
    await replay(page.frameLocator("#appframe"),root);

    const [download] = await Promise.all([
      page.waitForEvent("download",{timeout:15000}),
      page.locator("#export").click(),
    ]);
    const exported = join(dir,"exact-frames.html");
    await download.saveAs(exported);
    const exportedPage = await standalone.newPage();
    await exportedPage.goto(pathToFileURL(exported).href);
    await replay(exportedPage,root);
    assert.deepEqual(requestedPosts,[]);
    console.log("✓ player and offline export replay exact CFR stride and VFR reverse ranges");
  } finally {
    await Promise.all([player.close(),standalone.close()]);
    await rm(dir,{recursive:true,force:true});
  }
}
