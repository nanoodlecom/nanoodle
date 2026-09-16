#!/usr/bin/env node
// Choice → model wire must drive "~$ to run" / node price chips — not leftover fields.model.
// Live repro (2026-09-16): Pick the chat model teaching card, flip Choice to glm-5.3-flash;
// runest stayed ~$0.02 (Fable) instead of dropping to <$0.01.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const PLAY = fs.readFileSync(path.join(ROOT, "play.html"), "utf8");

function matchBrace(src, openIdx) {
  let i = openIdx, depth = 0, inStr = null, esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("unbalanced brace from " + openIdx);
}
function extractFn(src, name) {
  const sig = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = sig.exec(src);
  if (!m) throw new Error("function " + name + "() not found");
  const open = src.indexOf("{", m.index);
  const end = matchBrace(src, open);
  return src.slice(m.index, end + 1);
}

const failures = [];
const ok = (c, msg) => { if (!c) failures.push(msg); };

ok(SRC.includes("function wiredFieldValue("), "index.html defines wiredFieldValue");
ok(SRC.includes("function effectiveModelFields("), "index.html defines effectiveModelFields");
ok(/function nodeUnitUsd\(n\)\{\s*const t = NODE_TYPES\[n\.type\]; if\(!t \|\| !t\.modelKind\) return null;\s*const fields = effectiveModelFields\(n\);/.test(SRC.replace(/\s+/g, " ")),
  "nodeUnitUsd prices through effectiveModelFields");
ok(/function updateNodePrice\(n\)\{[\s\S]*effectiveModelFields\(n\)/.test(SRC),
  "updateNodePrice prices through effectiveModelFields");
ok(/function endpointWiredField\(n, port\)\{\s*\/\/[^\n]*\s*return wiredFieldValue\(n, port\);/.test(SRC),
  "endpointWiredField aliases wiredFieldValue (no duplicated body)");
ok(PLAY.includes("function wiredFieldValuePlay("), "play.html defines wiredFieldValuePlay");
ok(PLAY.includes("function effectiveModelFieldsPlay("), "play.html defines effectiveModelFieldsPlay");
ok(/async function nodeUnitUsdPlay\(n\)\{\s*const kind = SETTING_MODEL_KIND\[n\.type\]; if\(!kind\) return null;\s*const f = effectiveModelFieldsPlay\(n\);/.test(PLAY.replace(/\s+/g, " ")),
  "nodeUnitUsdPlay prices through effectiveModelFieldsPlay");

// Behavioral: Choice.selected wins over leftover fields.model
const bundle = [
  extractFn(SRC, "wiredFieldValue"),
  extractFn(SRC, "effectiveModelFields"),
  "var graph; function byId(id){ return graph.nodes.find(function(n){ return n.id===id; }); }",
  "this.wiredFieldValue=wiredFieldValue; this.effectiveModelFields=effectiveModelFields;",
  "this.setGraph=function(g){ graph=g; };",
].join("\n");
const sb = {};
vm.createContext(sb);
vm.runInContext(bundle, sb);

const llm = { id: "m1", type: "llm", fields: { model: "anthropic/claude-fable-5.1", prompt: "hi" } };
sb.setGraph({
  nodes: [
    { id: "c1", type: "choice", fields: { selected: "z-ai/glm-5.3-flash", options: "anthropic/claude-fable-5.1\nz-ai/glm-5.3-flash" } },
    llm,
  ],
  links: [{ id: "l1", from: { node: "c1", port: "text" }, to: { node: "m1", port: "model" } }],
});
const wired = sb.effectiveModelFields(llm);
ok(wired.model === "z-ai/glm-5.3-flash", "effectiveModelFields uses Choice.selected over fields.model (got " + wired.model + ")");
ok(wired.prompt === "hi", "effectiveModelFields keeps other fields");

// No model wire → unchanged
sb.setGraph({
  nodes: [llm, { id: "c1", type: "choice", fields: { selected: "z-ai/glm-5.3-flash" } }],
  links: [],
});
const plain = sb.effectiveModelFields(llm);
ok(plain.model === "anthropic/claude-fable-5.1", "without a model wire, fields.model stands");
ok(plain === llm.fields, "without a wire, returns the same fields object");

if (failures.length) {
  process.stderr.write("✗ wired-model estimate:\n\n- " + failures.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("✓ Choice→model wire drives estimate fields (editor + play helpers).\n");
