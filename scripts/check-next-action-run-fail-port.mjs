#!/usr/bin/env node
/**
 * Product · 49 — run-failure rewire pulse toys.
 * Pure helpers + editor wiring pins. No tip panel, no ?product= surface.
 */
import vm from "node:vm";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_PAIR, MIN_LEAD, MIN_SHARE } from "../vendor/next-action/port-suggest.mjs";
import {
  pickRunFailPort,
  inMass,
  parseMissingInputError,
  isMissingInputFailure,
  scoreInputAgainstError,
  collectMissingInputCandidates,
} from "../vendor/next-action/run-fail-port.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NA = join(ROOT, "vendor", "next-action");
const CORPUS = join(NA, "corpus", "port-suggest.json");

function fail(msg) {
  console.error(`✗ next-action-run-fail-port: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

assert(existsSync(join(NA, "run-fail-port.mjs")), "missing run-fail-port.mjs");
assert(existsSync(CORPUS), "missing port-suggest.json");

const tables = JSON.parse(readFileSync(CORPUS, "utf8"));
const index = readFileSync(join(ROOT, "index.html"), "utf8");
const surface = readFileSync(join(NA, "editor-surface.mjs"), "utf8");
const readme = readFileSync(join(NA, "README.md"), "utf8");
const helper = readFileSync(join(NA, "run-fail-port.mjs"), "utf8");

const toys = [];
function toy(name, ok, detail) {
  toys.push({ name, ok, detail });
  if (!ok) console.error(`  toy FAIL ${name}: ${detail}`);
  else console.log(`  toy OK   ${name}: ${detail}`);
}

// --- parse / classify ---
{
  const p = parseMissingInputError("no image — wire an image into the image port");
  toy("parse-image-wire", p.ports.includes("image") && p.modalities.includes("image") && p.wireHint, JSON.stringify(p));
  const p2 = parseMissingInputError("no prompt — describe the image to generate");
  toy("parse-prompt", p2.ports.includes("prompt") && p2.modalities.includes("prompt"), JSON.stringify(p2));
  const p3 = parseMissingInputError("no audio — wire an audio clip into the audio port");
  toy("parse-audio", p3.ports.includes("audio") && p3.modalities.includes("audio"), JSON.stringify(p3));
  const p4 = parseMissingInputError("no mask — brush the area to repaint (white), or wire the mask port");
  toy("parse-mask", p4.ports.includes("mask"), JSON.stringify(p4));
  const p5 = parseMissingInputError("no video — wire a video into the video port");
  toy("parse-video", p5.ports.includes("video"), JSON.stringify(p5));
  toy(
    "is-missing-image",
    isMissingInputFailure("no image — wire an image into the image port"),
    "true"
  );
  toy(
    "not-network",
    !isMissingInputFailure("couldn't reach nano-gpt.com — an ad-blocker"),
    "false"
  );
  toy("not-abort", !isMissingInputFailure("AbortError: signal is aborted"), "false");
  toy("not-response", !isMissingInputFailure("no image in response — return { url }"), "false");
  toy("not-cycle", !isMissingInputFailure("cycle detected"), "false");
}

// --- score ---
{
  const parsed = parseMissingInputError("no image — wire an image into the image port");
  const sImg = scoreInputAgainstError({ name: "image", type: "image", wired: false, empty: true }, parsed);
  const sPrompt = scoreInputAgainstError({ name: "prompt", type: "text", wired: false, empty: true }, parsed);
  toy("score-image-wins", sImg > sPrompt && sImg > 0, `img=${sImg} prompt=${sPrompt}`);
  const sFilled = scoreInputAgainstError({ name: "image", type: "image", wired: true, empty: false }, parsed);
  toy("score-filled-zero", sFilled === 0, `s=${sFilled}`);
}

// --- pick: resize missing image (gallery mass ≥ MIN_PAIR) ---
{
  const ctx = {
    nodeId: "r1",
    nodeType: "resize",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [{ name: "image", type: "image", wired: false, empty: true }],
  };
  const pick = pickRunFailPort(tables, ctx);
  toy("resize-image-picks", !!(pick && pick.port === "image" && pick.dir === "in"), pick ? `${pick.port} count=${pick.count}` : "null");
  toy("resize-image-identity", !!(pick && pick.nodeId === "r1" && pick.type === "resize"), pick ? pick.nodeId : "—");
  toy("resize-image-meets-min", !!(pick && pick.count >= MIN_PAIR), pick ? `count=${pick.count}` : "—");
  toy(
    "resize-mass-matches",
    inMass(tables, "resize", "image") === (pick ? pick.count : -1),
    `mass=${inMass(tables, "resize", "image")}`
  );
}

// --- pick: image empty prompt (fieldport, high inbound mass) ---
{
  const ctx = {
    nodeId: "img1",
    nodeType: "image",
    errorMessage: "no prompt — describe the image to generate",
    inputsMeta: [{ name: "prompt", type: "text", wired: false, empty: true, field: true }],
  };
  const pick = pickRunFailPort(tables, ctx);
  toy(
    "image-prompt-picks",
    !!(pick && pick.port === "prompt" && pick.dir === "in" && pick.count >= MIN_PAIR),
    pick ? `count=${pick.count}` : "null"
  );
}

// --- pick: edit missing image ---
{
  const ctx = {
    nodeId: "e1",
    nodeType: "edit",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [
      { name: "image", type: "image", wired: false, empty: true },
      { name: "prompt", type: "text", wired: false, empty: true, field: true },
    ],
  };
  const pick = pickRunFailPort(tables, ctx);
  toy(
    "edit-prefers-image",
    !!(pick && pick.port === "image"),
    pick ? pick.port : "null"
  );
}

// --- pick: wired-but-empty upstream ---
{
  const ctx = {
    nodeId: "v1",
    nodeType: "vision",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [{ name: "image", type: "image", wired: true, empty: true }],
  };
  // Explicit missing-image errors remain useful even when the gallery never used this port.
  const pick = pickRunFailPort(tables, ctx);
  toy("vision-rare-port-picked", pick?.port === "image", pick ? `count=${pick.count}` : "null");
  // same with no tables → allow
  const pick2 = pickRunFailPort(null, ctx);
  toy(
    "vision-no-tables-allows",
    !!(pick2 && pick2.port === "image" && pick2.count === 0),
    pick2 ? `count=${pick2.count}` : "null"
  );
}

// --- multi equally-likely → quiet ---
{
  const ctx = {
    nodeId: "ls1",
    nodeType: "lipsync",
    errorMessage: "no image — wire an image into the image port", // only mentions image
    inputsMeta: [
      { name: "image", type: "image", wired: false, empty: true },
      { name: "audio", type: "audio", wired: false, empty: true },
    ],
  };
  const pick = pickRunFailPort(tables, ctx);
  // error only names image → should pick image if mass ok, or quiet if flat
  const mass = inMass(tables, "lipsync", "image");
  if (mass >= MIN_PAIR) {
    toy("lipsync-image-only-err", !!(pick && pick.port === "image"), pick ? pick.port : "null");
  } else {
    toy("lipsync-rare-image-picked", pick?.port === "image", pick ? `count=${pick.count}` : "null");
  }

  // Ambiguous: error mentions both somehow via generic dual missing — synthesize equal scores
  const amb = {
    nodeId: "ls2",
    nodeType: "join",
    errorMessage: "no text — type something", // weak; both a and b are text
    inputsMeta: [
      { name: "a", type: "text", wired: false, empty: true },
      { name: "b", type: "text", wired: false, empty: true },
    ],
  };
  // Force equal by using an error that doesn't distinguish — collect may still score both via modality text
  // Synthetic tie: the live gallery's join a/b inbound mass drifts as examples
  // land (idea-to-short-film's Style + shot Joins made it 5 / 7 on 2026-10-08),
  // so the tied branch is pinned on tables where both ports carry the same mass.
  const ambPick = pickRunFailPort({ topTargets: { "llm|text": { "join|a": 4, "join|b": 4 } } }, {
    ...amb,
    errorMessage: "no text — wire something",
  });
  // join a/b both text with equal errScore and equal mass → quiet
  toy("join-multi-tied-quiet", ambPick === null, ambPick ? ambPick.port : "null");
}

// --- llm prompt ---
{
  const ctx = {
    nodeId: "llm1",
    nodeType: "llm",
    errorMessage: "no prompt — type what to ask in the prompt field",
    inputsMeta: [{ name: "prompt", type: "text", wired: false, empty: true, field: true }],
  };
  const pick = pickRunFailPort(tables, ctx);
  toy(
    "llm-prompt-picks",
    !!(pick && pick.port === "prompt" && pick.count >= MIN_PAIR),
    pick ? `count=${pick.count}` : "null"
  );
}

// --- ivideo missing image ---
{
  const ctx = {
    nodeId: "iv1",
    nodeType: "ivideo",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [
      { name: "image", type: "image", wired: false, empty: true },
      { name: "prompt", type: "text", wired: false, empty: false, field: true },
    ],
  };
  const pick = pickRunFailPort(tables, ctx);
  toy(
    "ivideo-image-picks",
    !!(pick && pick.port === "image" && pick.count >= MIN_PAIR),
    pick ? `count=${pick.count}` : "null"
  );
}

// --- gates / identity ---
{
  toy(
    "missing-nodeId-quiet",
    pickRunFailPort(tables, {
      nodeType: "resize",
      errorMessage: "no image — wire an image into the image port",
      inputsMeta: [{ name: "image", type: "image", wired: false, empty: true }],
    }) === null,
    "null"
  );
  toy(
    "missing-nodeType-quiet",
    pickRunFailPort(tables, {
      nodeId: "r1",
      errorMessage: "no image — wire an image into the image port",
      inputsMeta: [{ name: "image", type: "image", wired: false, empty: true }],
    }) === null,
    "null"
  );
  toy(
    "non-missing-err-quiet",
    pickRunFailPort(tables, {
      nodeId: "r1",
      nodeType: "resize",
      errorMessage: "resized image is still over the ~4 MB inline limit",
      inputsMeta: [{ name: "image", type: "image", wired: true, empty: false }],
    }) === null,
    "null"
  );
  toy(
    "id-alias",
    !!(
      pickRunFailPort(tables, {
        id: "r9",
        type: "resize",
        errorMessage: "no image — wire an image into the image port",
        inputsMeta: [{ name: "image", type: "image", wired: false, empty: true }],
      })?.nodeId === "r9"
    ),
    "r9"
  );
}

// --- no / empty tables ---
{
  const ctx = {
    nodeId: "r1",
    nodeType: "resize",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [{ name: "image", type: "image", wired: false, empty: true }],
  };
  const pick = pickRunFailPort(null, ctx);
  toy("no-tables-allows", !!(pick && pick.count === 0 && pick.port === "image"), pick ? `count=${pick.count}` : "null");
  const pick2 = pickRunFailPort({}, ctx);
  toy("empty-tables-allows", !!(pick2 && pick2.count === 0), pick2 ? `count=${pick2.count}` : "null");
}

// --- below MIN_PAIR synthetic ---
{
  const tiny = { topTargets: { "z|out": { "resize|image": 1 } } };
  const pick = pickRunFailPort(tiny, {
    nodeId: "r1",
    nodeType: "resize",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [{ name: "image", type: "image", wired: false, empty: true }],
  });
  toy("explicit-error-beats-low-prior", pick?.port === "image", pick ? `count=${pick.count}` : "null");
  const okTab = { topTargets: { "z|out": { "resize|image": MIN_PAIR } } };
  const pick2 = pickRunFailPort(okTab, {
    nodeId: "r1",
    nodeType: "resize",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [{ name: "image", type: "image", wired: false, empty: true }],
  });
  toy("at-min-pair-picks", !!(pick2 && pick2.count === MIN_PAIR), pick2 ? `count=${pick2.count}` : "null");
}

// --- collect candidates ---
{
  const cands = collectMissingInputCandidates({
    nodeId: "e1",
    errorMessage: "no image — wire an image into the image port",
    inputsMeta: [
      { name: "image", type: "image", wired: false, empty: true },
      { name: "prompt", type: "text", wired: false, empty: true, field: true },
    ],
  });
  toy("collect-has-image", cands.some((c) => c.name === "image" && c.errScore > 0), `n=${cands.length}`);
  toy(
    "collect-skips-filled",
    !collectMissingInputCandidates({
      errorMessage: "no image — wire an image into the image port",
      inputsMeta: [{ name: "image", type: "image", wired: true, empty: false }],
    }).length,
    "empty"
  );
}

// --- exports / docs ---
{
  toy("gates-exported", MIN_PAIR >= 2 && MIN_LEAD > 1 && MIN_SHARE > 0, `pair=${MIN_PAIR}`);
  toy("helper-mentions-621", /#621|gallery inbound|inbound mass/.test(helper), "gallery/#621");
  toy("helper-distinct-46", /·\s*46|aborted-wire/.test(helper), "distinct ·46");
  toy("helper-distinct-44", /·\s*44|post-delete/.test(helper), "distinct ·44");
}

// --- editor wiring pins ---
{
  toy("html-has-css", /\.port\.na-run-fail-port\s*\{/.test(index), ".port.na-run-fail-port");
  toy("html-has-keyframes", /@keyframes\s+naRunFailPortPulse/.test(index), "naRunFailPortPulse");
  toy(
    "html-reduced-motion",
    /prefers-reduced-motion[\s\S]{0,200}na-run-fail-port/.test(index) ||
      /runFailPortReducedMotion/.test(index),
    "reduced-motion"
  );
  toy("html-clearRunFailPort", index.includes("clearRunFailPort"), "fn");
  toy("html-applyRunFailPort", index.includes("applyRunFailPort"), "fn");
  toy("html-scheduleRunFailPort", index.includes("scheduleRunFailPort"), "fn");
  toy("html-pick-call", /pickRunFailPort\s*\(/.test(index), "call site");
  toy(
    "html-catch-schedules",
    /setStatus\(n,\s*"error",\s*friendlyRunError[\s\S]{0,280}scheduleRunFailPort/.test(index),
    "catch schedules"
  );
  toy(
    "html-run-clears",
    /runGroup\s*=\s*function[\s\S]{0,280}clearRunFailPort/.test(index),
    "new run clears"
  );

  toy(
    "html-geoOn-gate",
    /applyRunFailPort[\s\S]{0,500}geoOn/.test(index),
    "geoOn gate"
  );
  toy(
    "surface-exports-pick",
    /pickRunFailPort\(ctx\)/.test(surface) && /from "\.\/run-fail-port\.mjs"/.test(surface),
    "editor-surface"
  );
  toy("readme-mentions-49", /·\s*49|Product · 49|run-fail-port/.test(readme), "README · 49");
  toy(
    "no-product-twin",
    !/product\s*=\s*["']?49/.test(index) && !/\?product=49/.test(index),
    "no ?product=49"
  );
  toy(
    "no-tip-panel-mount",
    !/mountTipPanel|next-action-panel|ghost-overlay-panel/.test(index),
    "no tip/ghost panel"
  );
  toy(
    "usage-gif-present",
    existsSync(join(NA, "product-49-usage.gif")),
    "product-49-usage.gif"
  );
  toy(
    "distinct-class",
    index.includes("na-run-fail-port") && !index.includes("na-run-fail-port-panel"),
    "distinct .na-run-fail-port"
  );
  toy(
    "build-inputs-meta",
    index.includes("buildRunFailInputsMeta"),
    "buildRunFailInputsMeta"
  );
}

// Drive the real editor helpers and wrappers through a failed/corrected flow.
function editorFn(name) {
  const start = index.indexOf("function " + name + "(");
  assert(start >= 0, "missing editor helper " + name);
  let depth = 0;
  for (let i = index.indexOf("{", start); i < index.length; i++) {
    if (index[i] === "{") depth++;
    else if (index[i] === "}" && --depth === 0) return index.slice(start, i + 1);
  }
  fail("unbalanced editor helper " + name);
}
{
  const classes = (...initial) => {
    const values = new Set(initial);
    return { contains:x=>values.has(x), add:x=>values.add(x), remove:x=>values.delete(x) };
  };
  const port = (node,name,type,field) => ({ dataset:{node,port:name,ptype:type}, classList:classes(...(field?["fieldport"]:[]),"compatible","snap") });
  const imagePort=port("r1","image","image"), promptPort=port("i1","prompt","text",true);
  const resize={id:"r1",type:"resize",fields:{},el:{querySelectorAll:()=>[imagePort]}};
  const image={id:"i1",type:"image",fields:{prompt:""},el:{querySelectorAll:()=>[promptPort]}};
  const source={id:"up",type:"upload",fields:{image:""},out:{}};
  const graph={nodes:[resize,image,source],links:[]};
  let enabled=true, reduced=false, timer=0, runs=0;
  const timers=new Map();
  const allPorts=[imagePort,promptPort];
  const ctx={
    graph, tempWire:null, NODE_TYPES:{resize:{inputs:[{name:"image",type:"image"}]},image:{inputs:[],body(){}},upload:{inputs:[]}},
    byId:id=>graph.nodes.find(n=>n.id===id), geoOn:()=>enabled, isInputKind:type=>type==="upload",
    window:{__nextAction:{disabled:false,pickRunFailPort:q=>pickRunFailPort(tables,q),record(){},refresh(){}},matchMedia:()=>({matches:reduced})},
    document:{
      querySelector:sel=>allPorts.find(p=>sel.includes('data-node="'+p.dataset.node+'"') && sel.includes('data-port="'+p.dataset.port+'"')),
      querySelectorAll:()=>allPorts.filter(p=>p.classList.contains("na-run-fail-port")),
    },
    setTimeout(fn){timers.set(++timer,fn);return timer;},clearTimeout(id){timers.delete(id);},
    addNode(){},select(){},loadExample(){},runGroup(){runs++;return "ran";},
    connect(fromNode,fromPort,toNode,toPort){graph.links.push({from:{node:fromNode,port:fromPort},to:{node:toNode,port:toPort}});return true;},
    loadSurface:async()=>({mount:async()=>{}}),console,
  };
  vm.createContext(ctx);
  vm.runInContext('var _runFailPortTimer=0, _runFailPortKey="", _runFailPortCtx=null;\n'+
    ["runFailPortReducedMotion","buildRunFailInputsMeta","clearRunFailPort","syncRunFailPort","applyRunFailPort","scheduleRunFailPort"].map(editorFn).join("\n"),ctx);
  const bootAt=index.indexOf("(function bootNextActionHints(){");
  const bootEnd=index.indexOf("})();",bootAt)+5;
  vm.runInContext(index.slice(bootAt,bootEnd).replace(/import\(["']\.\/vendor\/next-action\/editor-surface\.mjs["']\)/,"loadSurface()"),ctx);
  const failure={nodeId:"r1",nodeType:"resize",errorMessage:"no image — wire an image into the image port"};
  ctx.applyRunFailPort(failure);
  toy("editor-missing-input-marked",imagePort.classList.contains("na-run-fail-port"),"actual diagnosed port");
  toy("editor-no-expiry-timer",timers.size===0,"error state survives its short animation");
  ctx.select(image); ctx.tempWire={}; ctx.syncRunFailPort(); ctx.tempWire=null;
  toy("editor-selection-drag-preserve-cue",imagePort.classList.contains("na-run-fail-port"),"unrelated gestures don't hide the error");
  ctx.connect("up","image","unrelated","image");
  toy("editor-unrelated-wire-preserves-cue",imagePort.classList.contains("na-run-fail-port"),"only this input matters");
  ctx.connect("up","image","r1","image");
  toy("editor-empty-source-preserves-cue",imagePort.classList.contains("na-run-fail-port"),"a wire without content isn't a fix");
  source.fields.image="data:image/png;base64,AA"; ctx.syncRunFailPort();
  toy("editor-source-field-corrects-before-run",!imagePort.classList.contains("na-run-fail-port"),"live upload beats absent cached out");
  toy("editor-unrelated-classes-preserved",imagePort.classList.contains("compatible") && imagePort.classList.contains("snap"),"owns only its error class");
  const promptFailure={nodeId:"i1",nodeType:"image",errorMessage:"no prompt — describe the image to generate"};
  ctx.applyRunFailPort(promptFailure);
  toy("editor-empty-field-marked",promptPort.classList.contains("na-run-fail-port"),"empty prompt");
  image.fields.prompt="A ceramic cup";ctx.syncRunFailPort();
  toy("editor-typed-field-corrects-cue",!promptPort.classList.contains("na-run-fail-port"),"typing the missing input clears it");
  image.fields.prompt=""; reduced=true;ctx.applyRunFailPort(promptFailure);
  toy("editor-reduced-motion-keeps-cue",promptPort.classList.contains("na-run-fail-port"),"static error remains");
  ctx.runGroup([],{});
  toy("editor-new-run-clears-cue",!promptPort.classList.contains("na-run-fail-port") && runs===1,"new attempt resets diagnosis");
  ctx.scheduleRunFailPort(promptFailure,40);ctx.runGroup([],{});
  toy("editor-new-run-cancels-pending-cue",timers.size===0,"old failure can't reappear after a new attempt");
  ctx.applyRunFailPort(promptFailure);enabled=false;ctx.syncRunFailPort();
  toy("editor-flags-off-clear-cue",!promptPort.classList.contains("na-run-fail-port"),"disabled editor mode");
  enabled=true;ctx.window.__nextAction.disabled=true;ctx.applyRunFailPort(promptFailure);
  toy("editor-engine-off-quiet",!promptPort.classList.contains("na-run-fail-port"),"disabled hints");
  ctx.window.__nextAction.disabled=false;ctx.applyRunFailPort(promptFailure);graph.nodes=graph.nodes.filter(n=>n!==image);ctx.syncRunFailPort();
  toy("editor-deleted-node-clears-cue",!promptPort.classList.contains("na-run-fail-port"),"stale node gone");
}

{
  const pick=pickRunFailPort(tables,{nodeId:"i1",nodeType:"image",errorMessage:"no prompt — describe the image to generate",inputsMeta:[{name:"prompt",type:"text",wired:false,empty:false,field:true}]});
  toy("filled-unwired-field-not-missing",pick===null,"typed fields count as satisfied");
  const css=index.match(/\.port\.na-run-fail-port\s*\{([^}]+)\}/)?.[1]||"";
  toy("finite-attention-static-error",/animation:/.test(css) && !/infinite/.test(css) && /box-shadow:/.test(css),"brief animation settles to a visible ring");
}
const failed = toys.filter((t) => !t.ok);
console.log(`\nrun-fail-port toys: ${toys.length - failed.length}/${toys.length} ok`);
if (failed.length) {
  fail(failed.map((f) => f.name).join(", "));
}
console.log("✓ next-action-run-fail-port");
