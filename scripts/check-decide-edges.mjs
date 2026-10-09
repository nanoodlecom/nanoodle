#!/usr/bin/env node
// Leftover ⚖️ Decide edges after #704.
// That PR shipped happy-path question shapes (pick/choose/score/yesno),
// 1-image pick refuse, choose trim+de-dupe, score default-4 / cap-10,
// unknown mode → pick, catalog image_limits, labelled multi-image state,
// choose/score/yesno outputs, reversed-slot merge + summed cost, two-request
// pick, text-only refuse, over-cap refuse, empty refuse, gate on/off, and
// picker isolation. This file pins leftover parse/clamp/gate/send-count
// those toys never hit: case-sensitive mode, default questions, 255-label
// cap, 2-level score floor, missing/zero image_limits fallback, single-
// image state (no image_1: label), yesno 0.5 / clamp / NaN, pick missing
// choice, merge missing-prob / missing-cost, question-only vs whitespace
// refuse, falsy image slots, choose/score/yesno send once, gate at 0.5
// passes, gate "TRUE"/1 does not close, decideFitImage onerror + shrink
// refuse, pick×2 estimate lockstep, and njs thin-catalog "unknown" not
// text-only. Offline, zero API spend. New file so it does not collide
// with check-decide.mjs.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");
const NJS = readFileSync(join(ROOT, "vendor/njs-engine.js"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);
const check = (c, m) => { if (c) ok(m); else fail(m); };

function twinBlock(src, label) {
  const start = src.search(/\/\* =+\n\s*⚖️ DECIDE — typed judgments/);
  if (start < 0) throw new Error(label + ": decide twin header not found");
  const endNeedle = "  return out;\n";
  const runAt = src.indexOf("async function decideRun(", start);
  const end = src.indexOf("}", src.indexOf(endNeedle, runAt) + endNeedle.length);
  return src.slice(start, end + 1);
}

function load(block, label, stubs) {
  const toDataURL = stubs && stubs.toDataURL
    ? stubs.toDataURL
    : () => "data:image/jpeg;base64,QUJD";
  const ctx = {
    console,
    Image: class {
      set src(v) {
        this._src = v;
        setTimeout(() => {
          if (stubs && stubs.imageError) this.onerror && this.onerror();
          else {
            this.naturalWidth = 1024;
            this.naturalHeight = 768;
            this.onload && this.onload();
          }
        }, 0);
      }
    },
    document: {
      createElement: () => ({
        getContext: () => ({ fillRect() {}, drawImage() {}, imageSmoothingEnabled: true, imageSmoothingQuality: "high" }),
        toDataURL,
      }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    block +
      "\n;globalThis.__d = { decideMode, decideLines, decideDefaultQuestion, decideQuestionFor, decideState, decideOutputs, decideMergeOrders, decideRun, decideFitImage, decideImageLimits, DECIDE_IMG_FALLBACK, DECIDE_SCALE_DEFAULT };",
    ctx,
    { filename: label + "#decide-edges" }
  );
  return ctx.__d;
}

async function throwsMsg(fn, re) {
  try { await fn(); return false; }
  catch (e) { return re.test(String(e && e.message)); }
}

const IDX_BLOCK = twinBlock(IDX, "index.html");
const PLAY_BLOCK = twinBlock(PLAY, "play.html");
const twofiftyfive = Array.from({ length: 255 }, (_, i) => "L" + i).join("\n");
const twofiftysix = twofiftyfive + "\nL255";

for (const [label, block] of [["index.html", IDX_BLOCK], ["play.html", PLAY_BLOCK]]) {
  console.log(label);
  const D = load(block, label);

  check(D.decideMode(null) === "pick" && D.decideMode({}) === "pick" && D.decideMode({ mode: "" }) === "pick",
    label + ": null / empty / blank mode → pick");
  check(D.decideMode({ mode: "PICK" }) === "pick" && D.decideMode({ mode: "Choose" }) === "pick",
    label + ": case-mismatched mode is not a mode (falls back to pick)");
  check(D.decideMode({ mode: "choose" }) === "choose" && D.decideMode({ mode: "score" }) === "score" && D.decideMode({ mode: "yesno" }) === "yesno",
    label + ": exact choose / score / yesno stay");

  check(D.decideDefaultQuestion("pick") === "Which image best matches the brief?",
    label + ": pick default question");
  check(D.decideDefaultQuestion("choose") === "Which label fits best?",
    label + ": choose default question");
  check(D.decideDefaultQuestion("score") === "How good is it?",
    label + ": score default question");
  check(D.decideDefaultQuestion("yesno") === "Is it good enough to use?",
    label + ": yes/no default question");

  const qBlank = D.decideQuestionFor("choose", { question: "   ", options: "a\nb" }, 0);
  check(qBlank.instructions === "Which label fits best?",
    label + ": whitespace-only question uses the mode default");
  const qKeep = D.decideQuestionFor("yesno", { question: "Ship it?" }, 0);
  check(qKeep.instructions === "Ship it?",
    label + ": a typed question is kept");

  check(D.decideLines(null).length === 0 && D.decideLines(undefined).length === 0 && D.decideLines("  \n\n  ").length === 0,
    label + ": decideLines drops null / empty / whitespace-only lines");

  const c255 = D.decideQuestionFor("choose", { options: twofiftyfive }, 0);
  check(Object.keys(c255.criteria).length === 255,
    label + ": choose accepts 255 labels");
  check(await throwsMsg(() => D.decideQuestionFor("choose", { options: twofiftysix }, 0), /255/),
    label + ": choose 256 labels refuses before any request");
  check(await throwsMsg(() => D.decideQuestionFor("choose", { options: "  \n\n" }, 0), /two labels/),
    label + ": choose whitespace-only options refuses");

  check(await throwsMsg(() => D.decideQuestionFor("score", { levels: "only" }, 0), /2 to 10/),
    label + ": score with 1 level refuses");
  const s2 = D.decideQuestionFor("score", { levels: "bad\ngood" }, 0);
  check(s2.criteria.length === 2 && s2.criteria[0] === "bad",
    label + ": score accepts the 2-level floor");
  const sWs = D.decideQuestionFor("score", { levels: "  \n  " }, 0);
  check(sWs.criteria.join() === "poor,okay,good,great",
    label + ": whitespace-only levels fall back to the default 4");

  const miss = D.decideImageLimits({ image_input: true }, true);
  check(miss && miss.maxImages === D.DECIDE_IMG_FALLBACK.maxImages && miss.maxDimension === D.DECIDE_IMG_FALLBACK.maxDimension && miss.maxEncodedBytes === D.DECIDE_IMG_FALLBACK.maxEncodedBytes,
    label + ": known image model with no image_limits uses launch fallbacks");
  const zero = D.decideImageLimits({ image_input: true, image_limits: { maxImages: 0, maxDimension: -8, maxEncodedBytes: NaN } }, true);
  check(zero && zero.maxImages === 4 && zero.maxDimension === 512 && zero.maxEncodedBytes === 240000,
    label + ": zero / negative / NaN image_limits do not invent a 0-image model");

  const one = D.decideState("brief", ["data:a"]);
  check(Array.isArray(one) && one[0] === "brief" && one[1] && one[1].type === "image_url" && !one.some((p) => p === "image_1:"),
    label + ": a single wired image is not labelled image_1:");
  const noText = D.decideState("", ["data:a", "data:b"]);
  check(noText[0] === "image_1:" && noText[1].image_url.url === "data:a",
    label + ": empty text is omitted from the state parts");

  check(await throwsMsg(() => D.decideOutputs("yesno", null, { type: "noul" }, [], {}, "m"), /no answer/),
    label + ": missing answer throws");
  check(await throwsMsg(() => D.decideOutputs("yesno", {}, { type: "noul" }, [], {}, "m"), /no answer/),
    label + ": answer without type throws");
  const yHalf = D.decideOutputs("yesno", { type: "noul", noul: 0.5 }, { type: "noul" }, ["data:x"], { cost: "0.01" }, "m");
  check(yHalf.text === "yes" && yHalf.image === "data:x" && yHalf.decision.yes === 0.5 && yHalf.decision.cost === null,
    label + ": yes/no at 0.5 is yes; first image passes through; non-number cost stays null");
  const yHi = D.decideOutputs("yesno", { type: "noul", noul: 1.4 }, { type: "noul" }, [], {}, "m");
  check(yHi.text === "yes" && yHi.decision.yes === 1,
    label + ": yes/no noul > 1 clamps to 1");
  const yNaN = D.decideOutputs("yesno", { type: "noul", noul: "nope" }, { type: "noul" }, [], {}, "m");
  check(yNaN.text === "no" && yNaN.decision.yes === 0,
    label + ": yes/no NaN noul is no");
  const qPick = D.decideQuestionFor("pick", {}, 2);
  const pMiss = D.decideOutputs("pick", { type: "choice" }, qPick, ["data:a", "data:b"], {}, "m");
  check(pMiss.text === "image 1" && pMiss.image === "data:a" && pMiss.decision.pick === 1,
    label + ": pick with no choice key defaults to image 1");

  check(await throwsMsg(() => D.decideMergeOrders([{ answers: { answer: { type: "choice" } } }], [[0, 1]]), /no answer/),
    label + ": merge with no probabilities throws");
  const mCost = D.decideMergeOrders([
    { answers: { answer: { probabilities: { image_1: 0.6, image_2: 0.4 } } } },
    { answers: { answer: { probabilities: { image_1: 0.2, image_2: 0.8 } } }, usage: {} },
  ], [[0, 1], [1, 0]]);
  check(mCost.usage.cost === null && mCost.answers.answer.choice === "image_1",
    label + ": merge with missing usage.cost reports cost null (does not invent 0)");

  const fake = (answerFor, sent) => async (body) => {
    sent.push(body);
    return { answers: { answer: answerFor(body) }, usage: { cost: 0.00001 } };
  };
  const sentQ = [];
  const qOnly = await D.decideRun({ mode: "yesno", question: "Cat?" }, "m", "", [], null, fake(() => ({ type: "noul", noul: 0.8 }), sentQ), async (u) => u);
  check(qOnly.text === "yes" && sentQ.length === 1,
    label + ": question-only yes/no (no text, no images) is allowed and sends once");
  check(await throwsMsg(() => D.decideRun({ mode: "yesno", question: "   " }, "m", "", [], null, fake(() => ({}), []), async (u) => u), /nothing to judge/),
    label + ": whitespace question + empty inputs still refuses");
  check(await throwsMsg(() => D.decideRun({ mode: "pick" }, "m", "", [], D.DECIDE_IMG_FALLBACK, fake(() => ({}), []), async (u) => u), /at least two images/),
    label + ": pick with zero images refuses with the pick message (not the empty-canvas one)");

  const sentOnce = [];
  await D.decideRun({ mode: "choose", options: "a\nb", question: "Which?" }, "m", "brief", [], null, fake(() => ({ type: "choice", choice: "a" }), sentOnce), async (u) => u);
  const sentScore = [];
  await D.decideRun({ mode: "score", question: "How?" }, "m", "brief", [], null, fake(() => ({ type: "score", score: 1 }), sentScore), async (u) => u);
  check(sentOnce.length === 1 && sentScore.length === 1,
    label + ": choose / score send one request (pick's two-call debias does not leak)");

  const sentSlots = [];
  const slotted = await D.decideRun({ mode: "pick", question: "best?" }, "pplx", "", ["data:a", "", null, "data:b"], D.DECIDE_IMG_FALLBACK,
    fake(() => ({ type: "choice", choice: "image_1", probabilities: { image_1: 0.6, image_2: 0.4 } }), sentSlots), async (u) => u);
  check(sentSlots.length === 2 && slotted.text === "image 1",
    label + ": falsy image slots are dropped so pick(['a','',null,'b']) is two candidates, two requests");

  let gateHalf = null;
  try {
    gateHalf = await D.decideRun({ mode: "yesno", gate: true, question: "Cat?" }, "m", "maybe", [], null, fake(() => ({ type: "noul", noul: 0.5 }), []), async (u) => u);
  } catch (e) { gateHalf = e; }
  check(gateHalf && gateHalf.text === "yes" && !gateHalf.gate,
    label + ": gate on + yes=0.5 passes (threshold is < 0.5, not ≤)");

  const sentTrue = [];
  let gateTRUE = null;
  try {
    gateTRUE = await D.decideRun({ mode: "yesno", gate: "TRUE", question: "Cat?" }, "m", "a dog", [], null, fake(() => ({ type: "noul", noul: 0.1 }), sentTrue), async (u) => u);
  } catch (e) { gateTRUE = e; }
  const sentOne = [];
  let gate1 = null;
  try {
    gate1 = await D.decideRun({ mode: "yesno", gate: 1, question: "Cat?" }, "m", "a dog", [], null, fake(() => ({ type: "noul", noul: 0.1 }), sentOne), async (u) => u);
  } catch (e) { gate1 = e; }
  check(gateTRUE && gateTRUE.text === "no" && !gateTRUE.gate && gate1 && gate1.text === "no" && !gate1.gate,
    label + ": gate 'TRUE' / 1 do not close (only true / 'true')");

  const Dbad = load(block, label, { imageError: true });
  check(await throwsMsg(() => Dbad.decideFitImage("data:image/png;base64,QQ==", 512, 1000), /read an image/),
    label + ": unreadable image refuses before any request");
  const Dfat = load(block, label, { toDataURL: () => "data:image/jpeg;base64," + "A".repeat(8000) });
  check(await throwsMsg(() => Dfat.decideFitImage("data:image/png;base64,QQ==", 512, 40), /small enough/),
    label + ": an image that never fits the byte budget refuses");
}

console.log("estimate + njs catalog");
check(/chatUnitUsd\(it, inTok, 0\) \* \(decideMode\(f\)==="pick" \? 2 : 1\)/.test(IDX),
  "editor run-cost: pick ×2, choose/score/yesno ×1");
check(/u \* \(decideMode\(f\)==="pick" \? 2 : 1\)/.test(PLAY),
  "app run-cost: pick ×2, choose/score/yesno ×1");
check(/decideImageLimits\(it && it\.decision_input, !!\(it && it\.decision_input\)\)/.test(NJS)
  && /decideImageLimits\(it && it\.decision_input, !!\(it && it\.decision_input\)\)/.test(PLAY),
  "njs + play: a catalog row without decision_input stays unknown (permissive), not text-only");

if (failed) { console.error("\n" + failed + " check(s) failed"); process.exit(1); }
console.log("\nall decide leftover-edge checks passed");
