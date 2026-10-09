#!/usr/bin/env node
// Offline guard for the ⚖️ Decide node (NanoGPT /api/v1/decisions).
//
// Lifts the SHIPPED decide twin block out of index.html and play.html (house extract pattern),
// asserts the two copies are identical after trim, then runs it in node:vm with a fake send():
// question shapes per mode, the image state parts, pick's in-order + reversed debias merge,
// the yes/no gate error, and output text/image per mode. Also pins the wiring around it:
// decision models stay out of every other picker (both engines), Decide is a paid NanoGPT type,
// and both runners treat a closed gate as a skip, not an error. No browser, no network, no spend.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

const failures = [];
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { console.error("  ✗ " + m); failures.push(m); } };

function twinBlock(src, label) {
  const start = src.search(/\/\* =+\n\s*⚖️ DECIDE — typed judgments/);
  if (start < 0) throw new Error(label + ": decide twin header not found");
  const endNeedle = "  return out;\n";
  const runAt = src.indexOf("async function decideRun(", start);
  const end = src.indexOf("}", src.indexOf(endNeedle, runAt) + endNeedle.length);
  return src.slice(start, end + 1);
}
const norm = (s) => s.split("\n").map((l) => l.trim()).join("\n");
const IDX_BLOCK = twinBlock(IDX, "index.html");
const PLAY_BLOCK = twinBlock(PLAY, "play.html");

console.log("decide twin");
ok(norm(IDX_BLOCK) === norm(PLAY_BLOCK), "index.html and play.html carry the same decide block (after trim)");
ok(!PLAY_BLOCK.includes("`"), "play.html copy has no backticks (RUNTIME_JS is a String.raw template)");

function load(block, label) {
  // Canvas/Image stubs: decideFitImage shrinks on-device; here every image "fits" as a tiny JPEG.
  const ctx = {
    console,
    Image: class { set src(v) { this._src = v; this.naturalWidth = 1024; this.naturalHeight = 768; setTimeout(() => this.onload && this.onload(), 0); } },
    document: { createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,QUJD" }) },
  };
  vm.createContext(ctx);
  vm.runInContext(block + "\n;globalThis.__d = { decideMode, decideQuestionFor, decideState, decideOutputs, decideMergeOrders, decideRun, decideImageLimits, DECIDE_DEFAULT_MODEL, DECIDE_IMG_FALLBACK };", ctx, { filename: label + "#decide" });
  return ctx.__d;
}

async function throwsMsg(fn, re) { try { await fn(); return false; } catch (e) { return re.test(String(e && e.message)); } }

for (const [label, block] of [["index.html", IDX_BLOCK], ["play.html", PLAY_BLOCK]]) {
  console.log(label);
  const D = load(block, label);
  // questions
  const qp = D.decideQuestionFor("pick", { question: "" }, 3);
  ok(qp.type === "choice" && Object.keys(qp.criteria).join() === "image_1,image_2,image_3" && /best matches/.test(qp.instructions), "pick → choice over image_1…N with a default question");
  ok(await throwsMsg(() => D.decideQuestionFor("pick", {}, 1), /at least two images/), "pick with one image refuses before any request");
  const qc = D.decideQuestionFor("choose", { question: "Team?", options: "billing\n shipping \n\nbilling\nsales" }, 0);
  ok(JSON.stringify(Object.keys(qc.criteria)) === '["billing","shipping","sales"]', "choose → trimmed, de-duplicated labels");
  ok(await throwsMsg(() => D.decideQuestionFor("choose", { options: "one" }, 0), /two labels/), "choose with one label refuses");
  const qs = D.decideQuestionFor("score", { levels: "" }, 0);
  ok(qs.type === "score" && qs.criteria.length === 4 && qs.criteria[0] === "poor", "score → default 4-level scale, worst first");
  ok(await throwsMsg(() => D.decideQuestionFor("score", { levels: "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk" }, 0), /2 to 10/), "score caps at 10 levels");
  ok(D.decideQuestionFor("yesno", { question: "Cat?" }, 0).type === "noul", "yes/no → noul");
  ok(D.decideMode({ mode: "bogus" }) === "pick", "unknown mode falls back to pick");
  // image limits
  ok(D.decideImageLimits(null, false).maxImages === 4, "uncatalogued model → permissive launch limits");
  ok(D.decideImageLimits({ image_input: false }, true) === null, "known text-only model → no images");
  ok(D.decideImageLimits({ image_input: true, image_limits: { maxImages: 2, maxDimension: 256, maxEncodedBytes: 1000 } }, true).maxImages === 2, "catalog image_limits win");
  // state
  const st = D.decideState("brief", ["data:a", "data:b"]);
  ok(Array.isArray(st) && st[0] === "brief" && st[1] === "image_1:" && st[2].type === "image_url" && st[4].image_url.url === "data:b", "state = text + labelled image_url parts");
  ok(D.decideState("just text", []) === "just text", "text-only state stays a string");
  // outputs
  const oc = D.decideOutputs("choose", { type: "choice", choice: "billing", confidence: 0.4, probabilities: { billing: 0.44, shipping: 0.39, sales: 0.17 } }, qc, [], { cost: 0.000002 }, "liquid/d1");
  ok(oc.text === "billing" && oc.decision.rows.find((r) => r.win).label === "billing" && oc.decision.cost === 0.000002, "choose → the label is the text out; real cost carried");
  const os = D.decideOutputs("score", { type: "score", score: 2.78, probabilities: { 0: 0, 1: 0.03, 2: 0.16, 3: 0.81 } }, qs, ["data:x"], {}, "m");
  ok(os.text === "3.78" && os.image === "data:x" && os.decision.rows[3].win, "score → 1-based expected level; first image passes through");
  const oy = D.decideOutputs("yesno", { type: "noul", noul: 0.99 }, { type: "noul" }, [], {}, "m");
  ok(oy.text === "yes" && oy.decision.yes === 0.99, "yes/no → yes when P(yes) ≥ 0.5");
  // merge (debias)
  const m = D.decideMergeOrders([
    { answers: { answer: { probabilities: { image_1: 0.45, image_2: 0.05, image_3: 0.5 } } }, usage: { cost: 1 } },
    { answers: { answer: { probabilities: { image_1: 0.8, image_2: 0.05, image_3: 0.15 } } }, usage: { cost: 2 } },   // reversed: slot1 = orig 3
  ], [[0, 1, 2], [2, 1, 0]]);
  ok(m.answers.answer.choice === "image_3" && Math.abs(m.answers.answer.probabilities.image_3 - 0.65) < 1e-9 && Math.abs(m.answers.answer.probabilities.image_1 - 0.3) < 1e-9 && m.usage.cost === 3, "merge maps reversed slots back to the originals, averages, sums cost");

  // full runs with a fake send
  const sent = [];
  const fake = (answerFor) => async (body) => { sent.push(body); return { answers: { answer: answerFor(body) }, usage: { input_tokens: 10, output_tokens: 0, cost: 0.00001 } }; };
  // pick: model always favours the image in slot 1 a bit, but image "C" much more wherever it sits
  const imgs = ["data:image/png;base64,QQ==", "https://x/b.png", "data:image/png;base64,Qw=="];
  let toDataCalls = 0;
  const pick = await D.decideRun({ mode: "pick", question: "best?" }, "pplx", "brief", imgs, D.DECIDE_IMG_FALLBACK,
    fake((b) => {
      const urls = b.state.filter((p) => p && p.type === "image_url");
      ok(urls.every((u) => /^data:image\/jpeg/.test(u.image_url.url)), "every image is inlined + shrunk to JPEG before sending");
      return { type: "choice", choice: "image_1", confidence: 0.5, probabilities: b === sent[0] ? { image_1: 0.45, image_2: 0.05, image_3: 0.5 } : { image_1: 0.8, image_2: 0.05, image_3: 0.15 } };   // a first-slot bias on top of a real preference for the 3rd image
    }), async () => { toDataCalls++; return "data:image/png;base64,Qg=="; });
  ok(sent.length === 2 && sent[1].state.filter((p) => p && p.image_url).length === 3 && sent[1].state[1] === "image_1:" && sent[0].questions.answer.type === "choice" && sent[0].model === "pplx", "pick sends two requests (in order + reversed)");
  ok(toDataCalls === 1, "remote image URLs are inlined via toDataUrl (data: URLs pass straight through)");
  ok(pick.text === "image 3" && pick.image === imgs[2] && Math.abs(pick.decision.cost - 0.00002) < 1e-12, "merged pick: winner image flows out, cost is both calls");
  ok(pick.decision.rows.length === 3 && pick.decision.rows[2].win && Math.abs(pick.decision.rows[2].p - 0.65) < 1e-9, "pick result card rows cover every candidate");
  // limits
  ok(await throwsMsg(() => D.decideRun({ mode: "pick" }, "d1", "", ["data:a", "data:b"], null, fake(() => ({})), async (u) => u), /can.t see images/), "images into a text-only model refuse before any request");
  ok(await throwsMsg(() => D.decideRun({ mode: "pick" }, "m", "", ["data:a", "data:b", "data:c"], { maxImages: 2, maxDimension: 512, maxEncodedBytes: 240000 }, fake(() => ({})), async (u) => u), /at most 2 images/), "over the model's image cap refuses");
  ok(await throwsMsg(() => D.decideRun({ mode: "yesno" }, "m", "", [], null, fake(() => ({})), async (u) => u), /nothing to judge/), "nothing wired and no question refuses");
  // gate
  sent.length = 0;
  let gateErr = null;
  try { await D.decideRun({ mode: "yesno", gate: true, question: "Cat?" }, "m", "a dog", [], null, fake(() => ({ type: "noul", noul: 0.2 })), async (u) => u); } catch (e) { gateErr = e; }
  ok(gateErr && gateErr.gate === true && /gate closed/.test(gateErr.message) && sent.length === 1, "gate on + no → one billed call, then a gate error (not a plain failure)");
  const pass = await D.decideRun({ mode: "yesno", gate: "true", question: "Cat?" }, "m", "a cat", [], null, fake(() => ({ type: "noul", noul: 0.9 })), async (u) => u);
  ok(pass.text === "yes", "gate on + yes → passes through");
  const noGate = await D.decideRun({ mode: "yesno", question: "Cat?" }, "m", "a dog", [], null, fake(() => ({ type: "noul", noul: 0.1 })), async (u) => u);
  ok(noGate.text === "no", "gate off + no → just outputs no");
}

console.log("wiring");
ok(/decide:\s*\{\s*em:"⚖️"/.test(IDX.replace(/\n\s*/g, "")) || /decide:\s*\{[^]*?em:\s*"⚖️"/.test(IDX), "index.html registers the decide node");
ok(/decide:\s*\{\s*\n\s*em:"⚖️", title:"Decide"/.test(PLAY), "play.html runtime registers the decide node");
ok(/DECIDE_ENDPOINT = .*\/api\/v1\/decisions/.test(IDX) && /DECIDE_ENDPOINT = NANOGPT \+ "\/api\/v1\/decisions"/.test(PLAY), "both engines post to NanoGPT /api/v1/decisions (the one allowed host — no Liquid direct call, which has no CORS)");
for (const [label, src] of [["index.html", IDX], ["play.html", PLAY]]) {
  const m = /function isPaidNanoType\(type\)\{\s*return \/\^\(([^)]*)\)\$\//.exec(src);
  ok(m && m[1].split("|").includes("decide"), label + ": decide is a paid NanoGPT type (needs a key)");
  ok(/err(?:or)? && err\.gate|err\.gate/.test(src) && /gate upstream said no/.test(src), label + ": a closed gate settles as a skip with downstream skipped, not an error");
}
// play: decision models only suit decide
{
  const start = PLAY.indexOf("function modelSuits(type, m){");
  const end = PLAY.indexOf("function isDecisionRaw(m){", start);
  const fnEnd = PLAY.indexOf("\n", end);
  const src = PLAY.slice(start, fnEnd);
  const ctx = { NEEDS_SRC_IDS: {}, INPAINT_OK: {} };
  vm.createContext(ctx);
  vm.runInContext(src + "\n;globalThis.__s = modelSuits;", ctx);
  const dec = { id: "perplexity/pplx-decider-v1.1-27b", capabilities: { vision: true }, architecture: { output_modalities: ["decisions"] } };
  const chat = { id: "openai/gpt-x", capabilities: { vision: true }, architecture: { output_modalities: ["text"] } };
  ok(ctx.__s("decide", dec) && !ctx.__s("decide", chat), "play: decide's model swap lists decision models only");
  ok(!ctx.__s("llm", dec) && !ctx.__s("vision", dec) && ctx.__s("llm", chat) && ctx.__s("vision", chat), "play: LLM / Vision swaps never offer a decision model");
}
// editor: passesFilter keeps decision models in the Decide picker only
{
  const start = IDX.indexOf("function passesFilter(");
  ok(start >= 0, "index.html has passesFilter");
  const body = IDX.slice(start, IDX.indexOf("\n}\n", start) + 3);
  ok(/filter==="decision"/.test(body) && /m\.decision/.test(body), "index.html: passesFilter routes decision models to the Decide picker only");
}

if (failures.length) { console.error("\n" + failures.length + " check(s) failed"); process.exit(1); }
console.log("\nall decide checks passed");
