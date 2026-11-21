#!/usr/bin/env node
// Real IndexedDB + editor, isolated origins/profile, synthetic saved workspaces.
// Timer/open gates make timeout and Retry races deterministic. No credentials,
// inference, storage deletion, or dependencies beyond Node 24 and Chromium.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,extname,sep,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const chrome=process.env.NANOODLE_CHROMIUM || ['/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/chromium-browser'].find(existsSync);
if(!chrome){console.log('⊘ workspace-recovery: Chromium unavailable');process.exit(0);}
const profile=mkdtempSync(join(tmpdir(),'nanoodle-recovery-'));
const child=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{stdio:['ignore','pipe','pipe']});
const servers=[];let socket;
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.css':'text/css'};
try{
  // Chromium writes the chosen port into the isolated profile when using port 0.
  // Use that file as the readiness signal and keep launcher output for failures.
  const port=await new Promise((resolve,reject)=>{
    let output='';
    const collect=bytes=>{output=(output+bytes).slice(-1600);};
    child.stdout.on('data',collect);
    child.stderr.on('data',collect);
    const exited=(code,signal)=>finish(Error(`Chromium exited ${signal||code}: ${output.trim()}`));
    const finish=(error,activePort)=>{
      clearTimeout(deadline);
      clearInterval(poll);
      child.off('error',finish);
      child.off('exit',exited);
      if(error) reject(error);
      else resolve(activePort);
    };
    const deadline=setTimeout(()=>finish(Error(`Chromium startup timeout: ${output.trim()}`)),60000);
    const activePortFile=join(profile,'DevToolsActivePort');
    const poll=setInterval(()=>{
      try{
        const activePort=Number(readFileSync(activePortFile,'utf8').split('\n')[0]);
        if(Number.isInteger(activePort) && activePort>0 && activePort<=65535) finish(null,activePort);
      }catch(error){if(error.code!=='ENOENT') finish(error);}
    },100);
    child.once('error',finish);
    child.once('exit',exited);
  });
  const targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((yes,no)=>{socket.addEventListener('open',yes);socket.addEventListener('error',no);});
  let seq=0;const pending=new Map();
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}if(m.method==='Page.javascriptDialogOpening')void send('Page.handleJavaScriptDialog',{accept:true});});
  const send=(method,params={})=>new Promise((yes,no)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);no(Error(method+' timed out'));},20000);pending.set(id,m=>{clearTimeout(timer);if(m.error)no(Error(JSON.stringify(m.error)));else yes(m.result);});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  const until=async(expression)=>{const deadline=Date.now()+15000;while(Date.now()<deadline){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out: '+expression);};
  const goto=async url=>{await send('Page.navigate',{url});await until(`location.href===${JSON.stringify(url)} && document.readyState==='complete'`);};
  await send('Runtime.enable');await send('Page.enable');
  let injection;
  const cases=(process.env.NANOODLE_RECOVERY_CASES||'timeout,open,read,blocked,manual,persistent,version,invalid,schema,quota').split(',');
  const failures=[];
  for(const scenario of cases){
    const server=createServer((req,res)=>{
      try{
        const p=new URL(req.url,'http://x').pathname;
        if(p==='/__seed'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Synthetic workspace fixture</title>');return;}
        if(p==='/sw.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end('// No cache in persistence test');return;}
        const file=resolve(root,'.'+(p==='/'?'/index.html':p));if(!file.startsWith(root+sep))throw Error('path');
        res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});res.end(readFileSync(file));
      }catch{res.writeHead(404);res.end();}
    });servers.push(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const origin=`http://localhost:${server.address().port}`;
    if(injection)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection});
    await goto(origin+'/__seed');
    await evaluate(`(async()=>{
      const g=text=>JSON.stringify({v:1,nodes:[{id:'n1',type:'text',x:40,y:40,fields:{text}},{id:'n2',type:'upload',x:400,y:40,fields:{image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII='}}],links:[],nid:3,lid:1});
      localStorage.setItem('noodle_graph',g('LEGACY BACKUP'));
      localStorage.setItem('noodle_workspaces',JSON.stringify({v:1,active:'w1',seq:1,tabs:[{id:'w1',name:'Legacy'}]}));
      localStorage.setItem('noodle_hint_dismissed','1');
      const values={noodle_graph:g('SAVED ACTIVE'),noodle_ws_w2:g('IDB ONLY WORKSPACE'),noodle_workspaces:JSON.stringify({v:1,active:'w1',seq:2,tabs:[{id:'w1',name:'Saved'},{id:'w2',name:'IDB only'}]})};
      const record={v:${scenario==='invalid'?9:1},generation:'baseline',values};
      const db=await new Promise((yes,no)=>{const r=indexedDB.open('nanoodle-workspaces',${scenario==='version'?2:1});r.onupgradeneeded=()=>{r.result.createObjectStore(${JSON.stringify(scenario==='schema'?'unrelated':'workspaces')});r.result.createObjectStore('keep-me');};r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);});
      await new Promise((yes,no)=>{const tx=db.transaction(${JSON.stringify(scenario==='schema'?'unrelated':'workspaces')},'readwrite');tx.objectStore(${JSON.stringify(scenario==='schema'?'unrelated':'workspaces')}).put(record,'state');tx.oncomplete=yes;tx.onerror=()=>no(tx.error);});db.close();
      sessionStorage.setItem('expected-record',JSON.stringify(record));return true;
    })()`);
    const source=`(()=>{
      if(location.pathname==='/__seed')return;
      const scenario=sessionStorage.getItem("recovery-test-healthy")==="1"?"healthy":${JSON.stringify(scenario)},timeout=window.setTimeout.bind(window),nativeOpen=IDBFactory.prototype.open;
      window.__workspaceNativeOpen=nativeOpen;window.__restoreDeadlines=[];window.__workspaceOpens=0;window.__paidRequests=[];window.__writeHealthy=false;
      window.fetch=(url,options={})=>{const u=new URL(url instanceof Request?url.url:url,location.href);if(u.origin===location.origin)return fetchLocal(url,options);if(options.method && options.method!=='GET')window.__paidRequests.push(u.pathname);return Promise.resolve(new Response(JSON.stringify({data:[]}),{headers:{'Content-Type':'application/json'}}));};
      const fetchLocal=globalThis.__nativeFetch;
      window.setTimeout=(fn,ms,...args)=>{
        if(fn.name==='workspaceRestoreTimeout')window.__restoreDeadlines.push(ms);
        const gate=(name)=>{const id=timeout(()=>{},60000);window[name]=()=>{delete window[name];clearTimeout(id);fn(...args);};return id;};
        if(ms===2500)return gate('__expireRestore');
        if(fn.name==='retryWorkspaceRestore')return gate('__retryRestore');
        if(ms===250)return timeout(fn,60000,...args); // hold autosave, exercise the live-canvas checkpoint
        return timeout(fn,ms,...args);
      };
      IDBFactory.prototype.open=function(...args){
        if(args[0]!=='nanoodle-workspaces')return nativeOpen.apply(this,args);
        const count=++window.__workspaceOpens;
        if(scenario==='blocked' && count===1){const fake={};queueMicrotask(()=>fake.onblocked?.());return fake;}
        if((['open','manual'].includes(scenario) && count===1) || scenario==='persistent'){const fake={};queueMicrotask(()=>{fake.error=new DOMException('Synthetic open failure','UnknownError');fake.onerror?.();});return fake;}
        if((scenario==='timeout' && count<=2) || (scenario==='manual' && count===2)){const fake={},r=nativeOpen.apply(this,args);r.onsuccess=()=>{window[count===1?'__releaseLateOpen':'__releaseRetryOpen']=()=>{fake.result=r.result;fake.onsuccess?.();};};r.onerror=()=>{fake.error=r.error;fake.onerror?.();};return fake;}
        return nativeOpen.apply(this,args);
      };
      const get=IDBObjectStore.prototype.get;
      let failedRead=false;
      IDBObjectStore.prototype.get=function(key){if(this.name==='workspaces' && scenario==='read' && !failedRead){failedRead=true;const fake={};queueMicrotask(()=>{fake.error=new DOMException('Synthetic read failure','UnknownError');fake.onerror?.();});return fake;}return get.call(this,key);};
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){if(this.name==='workspaces' && scenario==='quota' && !window.__writeHealthy)throw new DOMException('Synthetic write quota','QuotaExceededError');return put.apply(this,args);};
      const set=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(this===localStorage && scenario==='quota' && /^noodle_(graph|workspaces|ws_)/.test(key))throw new DOMException('Synthetic local quota','QuotaExceededError');return set.call(this,key,value);};
    })();`;
    // Capture native fetch before the fixture wraps it. The wrapper never sends provider requests.
    injection=(await send('Page.addScriptToEvaluateOnNewDocument',{source:'globalThis.__nativeFetch=window.fetch.bind(window);'+source})).identifier;
    try{
      await send('Page.navigate',{url:origin+'/?product=off&na=0'});
      if(scenario==='timeout'){
        await until('typeof __releaseLateOpen===\'function\' && typeof __expireRestore===\'function\'');await evaluate('__expireRestore();true');
      }
      const transient=['timeout','open','read','blocked','manual'].includes(scenario),invalid=['invalid','schema','persistent'].includes(scenario);
      await until(`typeof workspacePersistence==='function' && !wsRestorePending && graph.nodes.length>0`);
      const initialState=await evaluate('workspacePersistence()');
      if(transient||invalid){
        assert.equal(await evaluate('workspacePersistence().restoreFailed'),true,scenario+': failure remains visible');
        if(transient && scenario!=='manual')assert.equal(await evaluate('typeof __retryRestore'),'function','transient failures schedule bounded automatic recovery');
        if(scenario!=='manual')assert.equal(initialState.restoreError,scenario==='timeout'?'BrowserStorageTimeout':scenario==='blocked'?'BrowserStorageBlocked':scenario==='invalid'?'InvalidWorkspaceRecord':scenario==='schema'?'NotFoundError':'UnknownError',scenario+': precise restore cause survives failed background writes');
      }
      if(scenario==='version'){
        assert.equal(await evaluate('workspacePersistence().restoreFailed'),false,'compatible higher database version restores');
        assert.equal(await evaluate('graph.nodes[0].fields.text'),'SAVED ACTIVE');
      }
      // Open the same public example whose Night keyframe is visible in the report.
      await evaluate(`openExamples();Array.from(document.querySelectorAll('#exampleslist .ex-card')).find(c=>c.querySelector('.ex-tt').textContent==='Day to night between two keyframes').querySelector('button').click();true`);
      assert.ok(await evaluate(`graph.nodes.some(n=>n.name==='Night keyframe · instruction')`),'actual Day to night example opens');
      const newest='NIGHT KEYFRAME EDIT '+scenario;
      const edit=`(()=>{const n=graph.nodes.find(n=>n.name==='Night keyframe · instruction'),field=document.querySelector('.node[data-id="'+n.id+'"] textarea');field.value=${JSON.stringify(newest)};field.dispatchEvent(new Event('input',{bubbles:true}));})();`;
      if(transient){
        if(scenario!=='manual')assert.equal(await evaluate('typeof __retryRestore'),'function','transient failures schedule bounded automatic recovery');
        if(scenario==='timeout'||scenario==='manual'){
          if(scenario==='timeout'){await evaluate('__releaseLateOpen();true');assert.equal(await evaluate('workspacePersistence().restoreFailed'),true,'late callback cannot replace the visit');}
          await evaluate(scenario==='manual'?'document.getElementById("wspersistence-retry").click();true':'__retryRestore();true');await until('typeof __releaseRetryOpen===\'function\'');
          // Type during Retry, leave its debounce pending, and release the saved record.
          await evaluate(edit+'__releaseRetryOpen();true');
        }else await evaluate(edit+'__retryRestore();true');
        await until(`!workspacePersistence().restoreFailed && workspacePersistence().mode==='browser'`);
        assert.equal(await evaluate('__workspaceOpens'),2,'one recovery, no duplicate open');
        assert.deepEqual(await evaluate('__restoreDeadlines'),[2500,10000],'recovery gives a slow disk more time while edits remain available');
      }else{
        await evaluate(edit);const state=await evaluate('settleWorkspaceStorage()');
        if(invalid){
          assert.equal(state.mode,'session','unread records stay protected');
          if(scenario==='persistent'){await evaluate('__retryRestore();true');await until('!wsInitFlight');assert.equal(await evaluate('__workspaceOpens'),2,'only one automatic retry');}
          assert.equal(await evaluate('typeof __retryRestore'),'undefined','no automatic retry loop');
          await evaluate('document.getElementById("wspersistence-retry").click();true');await until('!wsInitFlight');
        }else if(scenario==='quota'){
          assert.equal(state.mode,'session');assert.equal(state.restoreFailed,false,'write quota is distinct from failed restore');assert.equal(state.persistenceError,'QuotaExceededError');
          await evaluate('__writeHealthy=true;document.getElementById("wspersistence-retry").click();true');await until(`workspacePersistence().mode==='browser'`);
        }
      }
      const raw=await evaluate(`(async()=>{const db=await new Promise((yes,no)=>{const r=__workspaceNativeOpen.call(indexedDB,'nanoodle-workspaces');r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);});const store=${JSON.stringify(scenario==='schema'?'unrelated':'workspaces')};const record=await new Promise((yes,no)=>{const r=db.transaction(store,'readonly').objectStore(store).get('state');r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);});const result={version:db.version,extra:db.objectStoreNames.contains('keep-me'),record};db.close();return result;})()`);
      assert.ok(raw.extra,'unrelated object store retained');assert.equal(raw.version,scenario==='version'?2:1,'database version preserved');
      if(invalid){assert.equal(JSON.stringify(raw.record),await evaluate('sessionStorage.getItem("expected-record")'),'unreadable record is byte-equivalent and untouched');}
      else{
        assert.ok(raw.record.values.noodle_graph.includes(newest),'committed recovery checkpoints the latest typing before reporting saved');
        const original=JSON.parse(await evaluate('sessionStorage.getItem("expected-record")'));
        if(transient)assert.equal(raw.record.values.noodle_ws_w1,original.values.noodle_graph,'recovery retains saved active graph byte for byte');
        else{const content=({nid,lid,view,...rest})=>rest;assert.deepEqual(content(JSON.parse(raw.record.values.noodle_ws_w1)),content(JSON.parse(original.values.noodle_graph)),'normal save preserves all graph content');}
        assert.equal(raw.record.values.noodle_ws_w2,original.values.noodle_ws_w2,'IDB-only graph is retained byte for byte');
        if(scenario==='manual')assert.equal(initialState.restoreError,'UnknownError');
        await evaluate('sessionStorage.setItem("recovery-test-healthy","1");true');
        for(let reload=0;reload<2;reload++){
          await goto(origin+'/?product=off&na=0&reload='+reload);await until(`typeof workspacePersistence==='function' && !wsRestorePending && graph.nodes.some(n=>n.name==='Night keyframe · instruction')`);
          await evaluate('settleWorkspaceStorage()');
          const dump=await evaluate(`(()=>{const d=readWorkspaces();return {p:workspacePersistence(),tabs:d.tabs.length,all:d.tabs.map(t=>workspaceStorage.getItem(t.id===d.active?'noodle_graph':'noodle_ws_'+t.id)).join('\\n')};})()`);
          assert.equal(dump.p.mode,'browser');assert.match(dump.all,/SAVED ACTIVE/);assert.match(dump.all,/IDB ONLY WORKSPACE/);assert.ok(dump.all.includes(newest),'newest edit survives reload');assert.ok(dump.all.includes('iVBOR'),'uploaded input survives');assert.equal(dump.tabs,transient?4:3,'recovery/reload never duplicates or drops tabs');
        }
      }
      assert.deepEqual(await evaluate('__paidRequests'),[],'no paid calls');console.log('✓ workspace recovery: '+scenario+'; existing/new workspaces and uploads protected');
    }catch(error){failures.push(scenario+': '+error.message);console.error('✗ '+failures.at(-1));}
  }
  if(failures.length)throw Error(failures.join('\n'));
}finally{
  socket?.close();if(child.exitCode===null && child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await exited;}
  for(const server of servers){server.closeAllConnections();server.close();}
  rmSync(profile,{recursive:true,force:true});
}
