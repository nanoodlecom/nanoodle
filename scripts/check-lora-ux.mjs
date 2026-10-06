#!/usr/bin/env node
// Two LoRA-section UX pins (offline, no API spend):
//
// 1. The empty LoRA URL box reads as EMPTY. Its placeholder used to be a greyed
//    https://huggingface.co/…/resolve/main/x.safetensors, which looked like a URL had already been
//    pasted. It is now an instruction ("Paste a LoRA .safetensors URL", localized), and the URL shape
//    moved into the help line under it.
// 2. A node that grows under the user's hand stays on screen. Opening the LoRA section on MiniMax
//    H3 at 1280×800 pushed the node under the composer bar. keepNodeInView pans up just enough,
//    only after a section the user opened (not one that renders open on load or rebuild), and
//    when a LoRA row or the LoRA-only resolution knob appears.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);
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

// ---- 1. empty-state placeholder -------------------------------------------
const lora = block(IDX, "function refreshLoraParams(n){");
{
  const inputs = [...lora.matchAll(/<input data-lu[^>]*>/g)].map((m) => m[0]);
  if (!inputs.length) fail("no LoRA URL input (data-lu) found in refreshLoraParams");
  for (const tag of inputs) {
    const ph = /placeholder="([^"]*(?:"[^"]*"[^"]*)*)"\s+value=/.exec(tag)?.[1] ?? "";
    if (/https?:|huggingface\.co|\/resolve\//i.test(ph)) fail(`LoRA URL placeholder still looks like a filled-in URL: ${ph}`);
    else if (!ph.includes('t("Paste a LoRA .safetensors URL")')) fail(`LoRA URL placeholder is not the localized instruction: ${ph}`);
    else ok("LoRA URL placeholder is an instruction, not a URL");
  }
  if (!/class="fhint">HuggingFace …\/resolve\/main\/x\.safetensors or any direct URL/.test(lora))
    fail("the URL shape (…/resolve/main/x.safetensors) should live in the help line");
  else ok("URL shape moved into the help line");
  // Any other LoRA URL input that reuses the old URL-shaped placeholder.
  const stray = IDX.match(/placeholder="https:\/\/huggingface\.co\/[^"]*safetensors"/g);
  if (stray) fail(`URL-shaped LoRA placeholder elsewhere: ${stray.join(", ")}`);
  else ok("no URL-shaped LoRA placeholder left anywhere in the editor");
  // Localized in every language map.
  const maps = IDX.slice(IDX.indexOf("I18N-MAPS-BEGIN"), IDX.indexOf("I18N-MAPS-END"));
  const hits = (maps.match(/"Paste a LoRA \.safetensors URL":"[^"]+"/g) || []).length;
  if (hits !== 5) fail(`"Paste a LoRA .safetensors URL" should be in all 5 language maps, found ${hits}`);
  else ok("instruction localized in es/fr/de/pt/ja");
}

// ---- 2. keep the grown node on screen ---------------------------------------
{
  const ctx = { Math };
  vm.createContext(ctx);
  vm.runInContext(block(IDX, "function revealPanDelta(top, bottom, ceil, floor, margin){"), ctx);
  // 1280×800, editor top 56, composer bar top 744, margin 16.
  const cases = [
    ["already fits → camera stays", 300, 700, 56, 744, 16, 0],
    ["bottom just at the margin → stays", 300, 728, 56, 744, 16, 0],
    ["H3 + LoRA open (node 525→890) pans up 162", 525, 890, 56, 744, 16, 162],
    ["taller than the room pins the top (pan stops at ceil+margin)", 400, 1200, 56, 744, 16, 328],
    ["node top already at the ceiling → no pan up", 72, 1000, 56, 744, 16, 0],
    ["node above the ceiling → never pans down", 20, 900, 56, 744, 16, 0],
  ];
  let bad = 0;
  for (const [what, top, bottom, ceil, floor, m, want] of cases) {
    const got = ctx.revealPanDelta(top, bottom, ceil, floor, m);
    if (Math.abs(got - want) > 1e-9) { fail(`revealPanDelta: ${what} → ${got} (want ${want})`); bad++; }
  }
  if (!bad) ok(`revealPanDelta: ${cases.length} pan cases (only up, only as far as needed, never past the top)`);

  const keep = block(IDX, "function keepNodeInView(n){");
  if (!/costChipReduceMotion\(\)/.test(keep)) fail("keepNodeInView must jump (not ease) under prefers-reduced-motion");
  else ok("reduced motion jumps instead of easing");
  if (!/if\(panY !== last\) return;/.test(keep)) fail("keepNodeInView must yield to a user pan mid-ease");
  else ok("a user drag/wheel mid-ease wins");
  if (/scale\s*=/.test(keep) || /panX\s*=/.test(keep)) fail("keepNodeInView must not zoom or pan sideways");
  else ok("vertical pan only (no zoom, no sideways move)");
  if (!/"describebar", "cornerpills", "controlbar"/.test(keep)) fail("keepNodeInView must clear the composer bar and corner controls");
  else ok("floor = composer bar, plus corner controls the node overlaps");

  const tog = IDX.slice(IDX.indexOf("let summaryOpened = null;"), IDX.indexOf('editor.addEventListener("wheel"'));
  if (!/closest\("summary"\)/.test(tog) || !/summaryOpened\.d===d/.test(tog) || !/keepNodeInView\(n\)/.test(tog))
    fail("toggle reveal must follow a click on that section's own summary only (not sections rendered open)");
  else ok("reveal follows a user-opened section only");

  if (!/refreshDims\(n\); keepNodeInView\(n\);/.test(lora)) fail("the LoRA-only resolution knob appearing must keep the node in view");
  else ok("LoRA URL → resolution knob appears → node kept in view");
  if (!/rows\.push\(\{ url:"", strength:"" \}\); save\(\); refreshLoraParams\(n\); keepNodeInView\(n\);/.test(lora))
    fail("+ add LoRA must keep the node in view");
  else ok("+ add LoRA keeps the node in view");
}

if (failed) { console.error(`\n✗ check-lora-ux: ${failed} failure(s)`); process.exit(1); }
console.log("✓ check-lora-ux: the empty LoRA box reads empty, and a node that grows under the user's hand stays on screen.");
