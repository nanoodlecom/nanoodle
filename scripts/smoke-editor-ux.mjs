#!/usr/bin/env node
// Fresh browser, local static assets and stubbed Describe changes only. Never
// attaches to a signed-in browser; external POSTs fail before leaving the page.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(process.env.NANOODLE_PLAYWRIGHT ? pathToFileURL(resolve(process.env.NANOODLE_PLAYWRIGHT)).href : 'playwright');
const mime={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.css':'text/css','.wasm':'application/wasm'};
const hook='window.__describeTest={submit,selectVersion,capture:captureDescribeState,restore:restoreDescribeState,isBusy:()=>busy,setPlanner:fn=>{runGptdiff=fn;}};\n';
const server=createServer(async(req,res)=>{try{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const asset=pathname.endsWith('/') ? pathname+'index.html' : extname(pathname) ? pathname : pathname+'.html';
 const path=resolve(root,'.'+asset);if(!path.startsWith(root+'/'))throw Error('path');
 let bytes=await readFile(path);if(path===resolve(root,'index.html')){const text=bytes.toString();assert(text.includes('  async function submit(){'));bytes=Buffer.from(text.replace('  async function submit(){',hook+'  async function submit(){'));}
 res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'});res.end(bytes);
 }catch(e){console.error('fixture asset failure',req.url,e.message);res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://localhost:'+server.address().port;
let browser;const errors=[],externalPosts=[];
try{
 browser=await chromium.launch({...(process.env.NANOODLE_CHROMIUM?{executablePath:process.env.NANOODLE_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/*',route=>{
  const req=route.request(),u=new URL(req.url());if(u.origin===base)return route.continue();
  if(req.method()!=='GET'){externalPosts.push({method:req.method(),host:u.host,path:u.pathname});return route.abort();}
  if(/\/api\/v1\/(?:chat|image|video|audio|3d)-models$/.test(u.pathname))return route.fulfill({contentType:'application/json',body:'{"data":[]}'});
  return route.abort();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{errors.push(d.message());await d.dismiss();});await page.goto(base);
 await page.waitForFunction(()=>window.__describeTest&&typeof readWorkspaces==='function'&&!wsRestorePending&&readWorkspaces());
 await page.evaluate(()=>{
  claimInitialCanvas();ensureAuth=()=>true;window.__allRuns=0;runAll=()=>{window.__allRuns++;};window.__plans=0;
  applyGraphData({v:1,nodes:[{id:'n1',type:'text',x:0,y:0,fields:{text:'A before'}}],links:[]});flushSave();
  window.__describeTest.setPlanner(async prev=>{window.__plans++;const next=structuredClone(prev);next.nodes[0].fields.text='A applied '+window.__plans;return {rawDiff:'offline',next};});
 });
 const input=page.locator('#describegoal'), prompt='  make the first change  ';
 await input.fill(prompt);await input.press('Control+Enter');
 await page.waitForFunction(()=>!window.__describeTest.isBusy()&&window.__describeTest.capture().versions.length===2);
 assert.equal(await input.inputValue(),prompt);
 await page.locator('#describego').click();
 await page.waitForFunction(()=>!window.__describeTest.isBusy()&&window.__describeTest.capture().versions.length===3);
 assert.equal(await input.inputValue(),prompt);assert.equal(await page.evaluate(()=>window.__plans),2);
 assert.equal(await page.evaluate(()=>window.__allRuns),0);
 await input.fill('A next request');const a=await page.evaluate(()=>readWorkspaces().active);
 const b=await page.evaluate(()=>{openExampleWorkspace({v:1,nodes:[{id:'n1',type:'text',fields:{text:'B'}}],links:[]},'B','offline-b');return readWorkspaces().active;});
 assert.equal(await input.inputValue(),'');await input.fill('B request');await page.evaluate(id=>switchWorkspace(id),a);
 assert.equal(await input.inputValue(),'A next request');assert.equal(await page.locator('#describeversions [data-ver]').count(),3);
 const before=await page.evaluate(()=>JSON.stringify(window.__describeTest.capture()));
 await page.evaluate(id=>{const old=workspaceStorage.setItem;let writes=0;workspaceStorage.setItem=(k,v)=>{if(k==='noodle_graph'&&++writes===3)throw Error('offline final-save fixture');return old(k,v);};try{switchWorkspace(id);}finally{workspaceStorage.setItem=old;}},b);
 assert.equal(await page.evaluate(()=>readWorkspaces().active),a);assert.equal(await page.evaluate(()=>JSON.stringify(window.__describeTest.capture())),before);
 await page.locator('#describeversions [data-ver="0"]').click();assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-ver')),'0');assert.equal(await input.inputValue(),'A next request');
 for(const flags of [{isComposing:true},{keyCode:229}])await input.evaluate((el,flags)=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...flags})),flags);
 assert.equal(await page.evaluate(()=>window.__plans),2);assert.equal(await input.inputValue(),'A next request');
 await input.press('Enter');await page.waitForFunction(()=>!window.__describeTest.isBusy()&&window.__plans===3);assert.equal(await page.evaluate(()=>window.__allRuns),0);
 console.log('✓ real editor Apply: Ctrl+Enter and Apply reuse the exact prompt, IME ignored, focused version chip, distinct A/B drafts/history and failed-switch rollback');
 // FileReader is a real asynchronous graph-replacement path. Resolve the
 // original planner only after a new graph/draft/status own the composer.
 await input.fill('request for the old graph');
 await page.evaluate(()=>{
  window.__describeTest.setPlanner(prev=>new Promise(resolve=>{window.__finishOldPlan=()=>{const next=structuredClone(prev);next.nodes[0].fields.text='STALE PLANNER OUTPUT';resolve({rawDiff:'offline',next});};}));
  window.__pendingOldPlan=window.__describeTest.submit();
 });
 await page.waitForFunction(()=>window.__describeTest.isBusy()&&window.__finishOldPlan);
 await page.locator('#loadfile').setInputFiles({name:'replacement.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({v:1,nodes:[{id:'n1',type:'text',fields:{text:'NEW FILE GRAPH'}}],links:[]}))});
 await page.waitForFunction(()=>serializeGraph().nodes[0]?.fields.text==='NEW FILE GRAPH');
 const replacement=await page.evaluate(()=>{document.querySelector('#describegoal').value='new file draft';document.querySelector('#describestatus').textContent='new file status';return JSON.stringify({graph:serializeGraph(),describe:window.__describeTest.capture(),status:document.querySelector('#describestatus').innerHTML});});
 await page.evaluate(async()=>{window.__finishOldPlan();await window.__pendingOldPlan;});
 assert.equal(await page.evaluate(()=>JSON.stringify({graph:serializeGraph(),describe:window.__describeTest.capture(),status:document.querySelector('#describestatus').innerHTML})),replacement,'a late planner must not overwrite a real File Load, its versions, draft or status');
 console.log('✓ deferred planner after actual File Load preserves the replacement graph, versions, draft and status');
 for(const awayBack of [false,true]){
  await input.fill('request before switching');
  const navigation=await page.evaluate(()=>{
   const source=readWorkspaces().active,other=readWorkspaces().tabs.find(t=>t.id!==source).id;
   window.__describeTest.setPlanner(prev=>new Promise(resolve=>{window.__finishSwitchPlan=()=>{const next=structuredClone(prev);next.nodes[0].fields.text='STALE SWITCH OUTPUT';resolve({rawDiff:'offline',next});};}));
   window.__pendingSwitchPlan=window.__describeTest.submit();return {source,other};
  });
  await page.waitForFunction(()=>window.__describeTest.isBusy()&&window.__finishSwitchPlan);
  await page.evaluate(id=>switchWorkspace(id),navigation.other);
  assert.equal(await page.evaluate(()=>readWorkspaces().active),navigation.source,'the normal busy guard still blocks switching');
  // Fault injection only: exercise the real switch transaction as if a stale
  // navigation arrived despite its UI busy guard. Never weaken production guards.
  const state=await page.evaluate(({source,other,awayBack})=>{
   const guard=window.describeChangeBusy;window.describeChangeBusy=()=>false;
   try{switchWorkspace(other);if(awayBack)switchWorkspace(source);}finally{window.describeChangeBusy=guard;}
   document.querySelector('#describegoal').value='draft after navigation';document.querySelector('#describestatus').textContent='status after navigation';
   return JSON.stringify({active:readWorkspaces().active,graph:serializeGraph(),describe:window.__describeTest.capture(),status:document.querySelector('#describestatus').innerHTML});
  },{...navigation,awayBack});
  await page.evaluate(async()=>{window.__finishSwitchPlan();await window.__pendingSwitchPlan;});
  assert.equal(await page.evaluate(()=>JSON.stringify({active:readWorkspaces().active,graph:serializeGraph(),describe:window.__describeTest.capture(),status:document.querySelector('#describestatus').innerHTML})),state);
 }
 console.log('✓ deferred switch and away/back completions preserve the owning workspace; normal busy guard remains enforced');
 // Grow by actual Blank/Example paths; a file Load intentionally replaces the
 // selected graph, and must leave every other workspace and its bytes intact.
 const expected=new Map();for(const id of await page.evaluate(()=>readWorkspaces().tabs.map(t=>t.id))){const text=await page.evaluate(id=>{switchWorkspace(id);return serializeGraph().nodes.find(n=>n.type==='text')?.fields.text;},id);expected.set(id,text);}
 for(let count=3;count<=33;count++){
  const id=await page.evaluate(count=>{const g={v:1,nodes:[{id:'n1',type:'text',x:0,y:0,fields:{text:'workspace '+count}}],links:[]};if(count%2){chooseWorkspace('blank');applyGraphData(g);flushSave();}else openExampleWorkspace(g,'Example '+count,'offline-example-'+count);return readWorkspaces().active;},count);
  expected.set(id,'workspace '+count);assert.equal(await page.evaluate(()=>readWorkspaces().tabs.length),count);
  if([16,17,33].includes(count)){
   const text='loaded file '+count;await page.locator('#loadfile').setInputFiles({name:'offline-load.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({v:1,nodes:[{id:'n1',type:'text',fields:{text}}],links:[]}))});
   await page.waitForFunction(text=>serializeGraph().nodes[0]?.fields.text===text,text);expected.set(id,text);assert.equal(await page.evaluate(()=>readWorkspaces().tabs.length),count);
  }
 }
 const strip=await page.locator('#wstabs').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth,vertical:el.scrollHeight>el.clientHeight+2}));assert(strip.overflow);assert.equal(strip.vertical,false);
 await page.waitForFunction(()=>!workspacePersistence().pending);await page.reload();await page.waitForFunction(()=>!wsRestorePending&&readWorkspaces()?.tabs.length===33);
 for(const [id,text] of expected){assert.equal(await page.evaluate(id=>{switchWorkspace(id);return serializeGraph().nodes.find(n=>n.type==='text')?.fields.text;},id),text);}
 await page.setViewportSize({width:390,height:844});await page.locator('#wsdrop').click();assert.equal(await page.locator('#wsdropmenu .wsrow').count(),33);
 const menu=await page.locator('#wsdropmenu').evaluate(el=>({scroll:el.scrollHeight>el.clientHeight,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}));assert(menu.scroll);assert(menu.left>=0&&menu.right<=390);
 await page.locator('#wsdropmenu .wsname').first().click();assert.equal(await page.locator('#wsdropmenu').isVisible(),false);
 assert.deepEqual(externalPosts,[]);assert.deepEqual(errors,[]);
 console.log('✓ 33 workspaces: Blank/Example beyond16, file Load at16/17/33, every graph restored after reload, desktop strip and mobile picker usable; zero external POSTs');
}catch(e){console.error('Browser fixture errors:',JSON.stringify(errors));throw e;}
finally{await browser?.close();await new Promise(r=>server.close(r));}
