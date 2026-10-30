#!/usr/bin/env node
// Leftover Describe / Customize default-model edges after #692.
// That PR switched the empty-key default from z-ai/glm-5.2 to
// openai/gpt-6.1-sol at medium effort, and check-describe-apply only
// re-ran the apply-harness under both models. This file pins the leftover
// contract: editor DESCRIBE_DEFAULT_MODEL and play DEFAULT_MODEL stay
// lockstep on Sol, effort is "medium", the shared ngpt_app_model key is
// only written by an explicit picker, a saved glm-5.2 is kept, and the
// effort gate sends medium only for the default on a catalog miss (or
// when the live list includes medium) — never to a leftover glm-5.2 /
// a model whose catalog omits medium (that 400s). Offline, zero API spend.
// New file so it does not collide with check-describe-apply.
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

const SOL = "openai/gpt-6.1-sol";
const GLM = "z-ai/glm-5.2";

function grabConst(src, name) {
  const re = new RegExp("(?:const|let)\\s+" + name + "\\s*=\\s*(\"([^\"]+)\"|'([^']+)')");
  const m = re.exec(src);
  if (!m) throw new Error(name + " not found");
  return m[2] || m[3];
}

{
  const editorModel = grabConst(IDX, "DESCRIBE_DEFAULT_MODEL");
  const playModel = grabConst(PLAY, "DEFAULT_MODEL");
  const editorEffort = grabConst(IDX, "DESCRIBE_EFFORT");
  const playEffort = grabConst(PLAY, "GEN_EFFORT");
  const editorKey = grabConst(IDX, "DESCRIBE_MODEL_KEY");
  if (editorModel !== SOL || playModel !== SOL)
    fail(`default model drifted: editor ${editorModel} / play ${playModel} (want ${SOL})`);
  else ok("editor DESCRIBE_DEFAULT_MODEL and play DEFAULT_MODEL stay openai/gpt-6.1-sol");
  if (editorEffort !== "medium" || playEffort !== "medium")
    fail(`effort drifted: editor ${editorEffort} / play ${playEffort}`);
  else ok("Describe / Customize effort stays medium");
  if (editorKey !== "ngpt_app_model")
    fail("DESCRIBE_MODEL_KEY must stay ngpt_app_model (shared with Customize)");
  else if (!/localStorage\.getItem\("ngpt_app_model"\)/.test(PLAY))
    fail("play Customize must read the shared ngpt_app_model key");
  else ok("Describe and Customize share ngpt_app_model");
}

{
  const pins = [
    ["editor only writes ngpt_app_model from the picker",
      /openPicker\("chat"[\s\S]{0,240}localStorage\.setItem\(DESCRIBE_MODEL_KEY, id\)/],
    ["editor keeps a saved pick and only defaults when empty",
      /descModel = localStorage\.getItem\(DESCRIBE_MODEL_KEY\) \|\| ""[\s\S]{0,80}if\(!descModel\) descModel = DESCRIBE_DEFAULT_MODEL/],
    ["play keeps a saved pick — including leftover glm-5.2 — and only defaults when empty",
      /localStorage\.getItem\("ngpt_app_model"\) \|\| DEFAULT_MODEL/],
    ["play only writes ngpt_app_model from setModel",
      /function setModel\(id\)\{ MODEL = id; try\{ localStorage\.setItem\("ngpt_app_model", id\);/],
    ["play auto-clears only the dead mimo pin, not glm-5.2",
      /getItem\("ngpt_app_model"\) === "xiaomi\/mimo-v2\.5-pro-ultraspeed"/],
  ];
  for (const [label, re] of pins) {
    const src = /play /.test(label) ? PLAY : IDX;
    if (re.test(src)) ok("pin: " + label);
    else fail("pin: " + label);
  }
  if (/getItem\("ngpt_app_model"\) === "z-ai\/glm-5\.2"/.test(PLAY) || /removeItem\("ngpt_app_model"\).*glm-5\.2/.test(PLAY))
    fail("play must not auto-clear a saved glm-5.2 pick");
  else ok("pin: leftover glm-5.2 is kept as the user's pick");
}

function extractArrow(src, name) {
  const at = src.indexOf("const " + name + " =");
  if (at < 0) throw new Error(name + " not found");
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error("could not brace-match " + name);
}

{
  const catalogs = {
    miss: {},
    solMedium: { [SOL]: { reasoningEfforts: ["none", "low", "medium", "high"] } },
    solNoMedium: { [SOL]: { reasoningEfforts: ["none", "high", "max"] } },
    glmNoMedium: { [GLM]: { reasoningEfforts: ["none", "high", "max"] } },
    glmMedium: { [GLM]: { reasoningEfforts: ["none", "medium", "high"] } },
    emptyList: { [SOL]: { reasoningEfforts: [] } },
  };

  const editor = { catalogs: catalogs.miss, catItem: (kind, id) => (kind === "chat" ? editor.catalogs[id] : null) };
  vm.createContext(editor);
  vm.runInContext(
    'var DESCRIBE_DEFAULT_MODEL = "openai/gpt-6.1-sol";\n' +
    'var DESCRIBE_EFFORT = "medium";\n' +
    extractArrow(IDX, "describeEffort") + ";\nthis.describeEffort=describeEffort;",
    editor
  );

  const play = { catalogs: catalogs.miss, priceOf: (id) => play.catalogs[id] || null };
  vm.createContext(play);
  vm.runInContext(
    'var DEFAULT_MODEL = "openai/gpt-6.1-sol";\n' +
    'var GEN_EFFORT = "medium";\n' +
    extractArrow(PLAY, "genEffort") + ";\nthis.genEffort=genEffort;",
    play
  );

  const cases = [
    ["miss", SOL, "medium", "catalog-miss default still sends medium (live-probed)"],
    ["miss", GLM, null, "catalog-miss leftover glm-5.2 omits effort (none|high|max — medium 400s)"],
    ["miss", "openai/gpt-5.4-mini", null, "catalog-miss other model omits effort"],
    ["solMedium", SOL, "medium", "catalog that lists medium sends medium"],
    ["solNoMedium", SOL, null, "catalog that omits medium stays quiet even on the default id"],
    ["glmNoMedium", GLM, null, "glm-5.2 catalog (none|high|max) omits medium"],
    ["glmMedium", GLM, "medium", "a model whose catalog lists medium may send it"],
    ["emptyList", SOL, null, "empty reasoningEfforts is a present list and stays quiet"],
  ];
  let bad = 0;
  for (const [cat, id, want, label] of cases) {
    editor.catalogs = catalogs[cat];
    play.catalogs = catalogs[cat];
    const a = editor.describeEffort(id);
    const b = play.genEffort(id);
    if (a !== want || b !== want) {
      fail(`${label}: editor=${JSON.stringify(a)} play=${JSON.stringify(b)} want ${JSON.stringify(want)}`);
      bad++;
    }
  }
  if (!bad) ok(`effort gate: ${cases.length} catalog-miss / list cases (editor describeEffort = play genEffort)`);
}

if (failed) {
  console.error(`\n✗ check-describe-default-edges: ${failed} failure(s)`);
  process.exit(1);
}
console.log("✓ check-describe-default-edges: Sol/medium defaults lockstep; leftover glm-5.2 is kept; medium is gated.");
