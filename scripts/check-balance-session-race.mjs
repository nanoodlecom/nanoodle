#!/usr/bin/env node
// Delayed balance replies must not cross sign-out/account changes. Real shipped
// refresh functions, deferred fetch + JSON, no provider calls or real keys.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function extract(src, name) {
  const start = src.indexOf((name === "refreshPlayBalance" ? "function " : "async function ") + name + "(");
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced " + name);
}
const balances = `let _balPending=false, _balSeq=0, _balAgain=false, _balAgainCorrective=false;
  let _playBalPending=false, _playBalSeq=0, _playBalAgain=false, _playBalAgainCorrective=false;
  let BAL=null, BAL_STALE=false; const EMBEDDED=false, COST=stats;`;
for (const [file, name] of [["index.html", "refreshBalance"], ["play.html", "refreshBal"], ["play.html", "refreshPlayBalance"]]) {
  const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  for (const replacement of [null, "account-B"]) {
    for (const phase of ["response", "json", "failure"]) {
      let key = "account-A", paints = 0, caches = 0;
      const request = deferred(), body = deferred();
      const stats = { balance:null, balStale:false };
      const sandbox = {
        getKey: () => key, stats, NANOGPT:"https://example.invalid",
        authHeaders: () => ({}), fetch: () => request.promise,
        paintCost: () => { paints++; }, paintBal: () => { paints++; },
        cacheBalance: () => { caches++; }, postToApp: () => { paints++; }, notifyParentCost: () => { paints++; }
      };
      vm.createContext(sandbox);
      vm.runInContext(`${balances}
        function noteBalance(n){ stats.balance=n; _balSeq++; cacheBalance(); paintBal(); }
        ${extract(source, name)}
        globalThis.refresh=${name};`, sandbox);
      const pending = sandbox.refresh(true);
      if (phase === "json") {
        request.resolve({ ok:true, json: () => body.promise });
        await Promise.resolve(); await Promise.resolve();
      }
      key = replacement;
      if (phase === "json") body.resolve({ usd_balance:123 });
      else request.resolve({ ok:phase !== "failure", json:async () => ({ usd_balance:123 }) });
      await pending;
      assert.equal(stats.balance, null, `${file}: ${phase} reply crossed account change to ${replacement}`);
      assert.equal(stats.balStale, false, `${file}: old failure marked new account stale`);
      assert.equal(paints + caches, 0, `${file}: old response touched UI/cache after ${phase}`);
    }
  }
  // A request queued during the old account's request must still refresh the
  // new account when the obsolete reply drains.
  let key="account-A";
  const requests=[], stats={ balance:null, balStale:false };
  const sandbox={ getKey:()=>key, stats, NANOGPT:"https://example.invalid", authHeaders:()=>({}),
    fetch:()=>{ const d=deferred(); requests.push(d); return d.promise; },
    paintCost(){}, paintBal(){}, cacheBalance(){}, postToApp(){}, notifyParentCost(){} };
  vm.createContext(sandbox);
  vm.runInContext(`${balances}
    function noteBalance(n){ stats.balance=n; _balSeq++; }
    ${extract(source,name)} globalThis.refresh=${name};`,sandbox);
  const old=sandbox.refresh(); key="account-B"; await sandbox.refresh(true);
  requests[0].resolve({ok:true,json:async()=>({usd_balance:123})});
  for(let i=0;i<8 && requests.length<2;i++) await Promise.resolve();
  assert.equal(requests.length,2,`${file}: new account refresh lost`);
  assert.equal(stats.balance,null,`${file}: obsolete balance painted before queued refresh`);
  requests[1].resolve({ok:true,json:async()=>({usd_balance:7})});
  await old;
  assert.equal(stats.balance,7,`${file}: new account balance not accepted`);
}
console.log("✓ balance replies stay with their account across sign-out, key replacement, delayed JSON, failures and coalesced refreshes");
