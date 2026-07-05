#!/usr/bin/env node
// A saved/shared graph names its models by id (fields.model). NanoGPT renames and retires ids over
// time, so a graph can carry a model the live catalog no longer has. A dead id must NEVER reach a
// paid sender: both engines run a preflight that blocks the node BEFORE any request (no opaque 4xx,
// no charge on a dead id). This pins that contract offline by extracting the REAL helpers from both
// files and driving them — the editor's mdl()/modelDrifted() and play's assertModelAvailable():
//
//   unknown model id + LOADED catalog  → throws (no send)
//   known model id                     → passes
//   empty/unavailable catalog          → permissive (typed-in id + offline runs never false-block)
//
// Offline node:vm, no network, no API spend. Mirrors check-stale-input-charge's extraction technique.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

// Brace-match a block starting at `anchor` (through its balanced closing "}").
function block(src, anchor) {
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error("anchor not found: " + anchor);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced braces for: " + anchor);
}
const line = (src, needle) => {
  const i = src.indexOf(needle);
  if (i === -1) throw new Error("line not found: " + needle);
  return src.slice(i, src.indexOf("\n", i));
};

// ---- EDITOR: mdl() + modelDrifted() + catItem() ---------------------------
{
  const mdlSrc = block(IDX, "const mdl = (n)=>{");
  const driftSrc = block(IDX, "function modelDrifted(n){");
  const catItemSrc = line(IDX, "const catItem = (kind,id)=>");
  const ctx = {
    t: (s) => s,
    NODE_TYPES: { llm: { modelKind: "chat" } },
    catalogs: {},
    console,
  };
  vm.createContext(ctx);
  // top-level const/let don't bind onto a vm context — only var/function do; rewrite so the
  // extracted helpers are reachable as ctx.mdl / ctx.catItem (verbatim bodies, only the keyword changes).
  vm.runInContext(catItemSrc.replace("const catItem", "var catItem") + "\n" + driftSrc + "\n" + mdlSrc.replace("const mdl", "var mdl"), ctx);

  const node = (model) => ({ type: "llm", fields: { model } });
  const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };

  // catalog LOADED with only the live id
  ctx.catalogs.chat = [{ id: "good-model" }];
  if (throws(() => ctx.mdl(node("good-model")))) fail("editor: live model id was blocked");
  else ok("editor: live model id passes preflight");

  let blocked = false, ret;
  try { ret = ctx.mdl(node("dead-model-v1")); } catch (e) { blocked = true; }
  if (!blocked) fail("editor: drifted id '" + ret + "' reached the sender (no preflight throw)");
  else ok("editor: drifted model id throws before any send");

  // catalog UNAVAILABLE (offline / not yet fetched) → must stay permissive
  ctx.catalogs.chat = [];
  if (throws(() => ctx.mdl(node("dead-model-v1")))) fail("editor: empty catalog false-blocked a typed-in id (offline regression)");
  else ok("editor: empty catalog stays permissive (no false block)");

  // empty model still reports the original 'pick a model first'
  ctx.catalogs.chat = [{ id: "good-model" }];
  let msg = "";
  try { ctx.mdl(node("")); } catch (e) { msg = e.message; }
  if (!/pick a model/.test(msg)) fail("editor: empty model no longer prompts to pick one");
  else ok("editor: empty model still prompts 'pick a model first'");
}

// ---- PLAY (exported app): assertModelAvailable() --------------------------
{
  const src = block(PLAY, "async function assertModelAvailable(n){");
  let RAW = null;   // stubbed catalog the extracted fn awaits via loadCatalogRaw
  // Deliberately OMIT inpaint from the stub map — it's absent from the real SETTING_MODEL_KIND too.
  // The fn must still resolve inpaint's kind ("image") via its explicit fallback, or a drifted inpaint
  // model would slip past the play preflight while the editor's mdl() still blocks it (parity gap).
  const ctx = {
    SETTING_MODEL_KIND: { llm: "chat" },
    loadCatalogRaw: async () => RAW,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);

  const node = (model) => ({ type: "llm", fields: { model } });
  const rejects = async (n) => { try { await ctx.assertModelAvailable(n); return false; } catch (e) { return e.message || true; } };

  RAW = [{ id: "good-model" }];
  if (await rejects(node("good-model"))) fail("play: live model id was blocked");
  else ok("play: live model id passes preflight");

  const msg = await rejects(node("dead-model-v1"));
  if (!msg) fail("play: drifted id reached the sender (no preflight throw)");
  else if (!/updating by its creator/.test(msg)) fail("play: drift error must tell the app user the creator needs to update it");
  else ok("play: drifted id throws with a 'creator needs to update' message before any send");

  RAW = [];   // catalog unavailable/offline
  if (await rejects(node("dead-model-v1"))) fail("play: empty catalog false-blocked a typed-in id (offline regression)");
  else ok("play: empty catalog stays permissive (no false block)");

  // inpaint is a paid image sender that's absent from SETTING_MODEL_KIND → its kind must still resolve
  // so a drifted inpaint model is blocked in play too (parity with the editor's mdl() guard).
  RAW = [{ id: "good-model" }];
  const inpaintNode = (model) => ({ type: "inpaint", fields: { model } });
  if (await rejects(inpaintNode("good-model"))) fail("play: live inpaint model was blocked");
  else ok("play: live inpaint model passes preflight");
  if (!(await rejects(inpaintNode("dead-inpaint-v0")))) fail("play: drifted inpaint model slipped past the preflight (parity gap with editor)");
  else ok("play: drifted inpaint model throws before any send");
}

if (failed) { console.error("\ncheck-drifted-model: " + failed + " failure(s)"); process.exit(1); }
console.log("\ncheck-drifted-model: OK");
