#!/usr/bin/env node
/**
 * Selected-node suggestions: rank by open outputs, skip wires that exist,
 * skip an unused duplicate root, place in a free slot, recipes are short
 * chains fed by that output. Not confident → empty (menus stay as they are).
 */
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  suggestNext,
  freeSlot,
  overlaps,
  unusedRoot,
  wireExists,
} from "../vendor/next-action/suggest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`✗ next-action-suggest: ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const known = new Set([
  "text", "llm", "image", "edit", "ivideo", "vedit", "music", "tts", "lipsync",
  "join", "resize", "comment", "vision", "inpaint", "tvideo", "transcribe",
  "remix", "trim", "vframes", "extractaudio", "soundtrack", "choice", "upload",
]);

const textOut = [{ name: "text", type: "text" }];
const imageOut = [{ name: "image", type: "image" }];

function g(nodes, links, selectedId) {
  return { nodes, links, selectedId };
}

{
  const s = suggestNext(
    g([{ id: "t", type: "text", outputs: textOut }], [], "t"),
    { nodeTypes: known }
  );
  assert(s.confident && !s.quiet, "a selected Text node is confident");
  assert(s.adds[0] && s.adds[0].type === "llm", `Text should suggest LLM first, got ${s.adds.map((a) => a.type).join(",")}`);
  assert(s.adds[0].fromPort === "text" && s.adds[0].toPort === "prompt", "LLM wires from text → prompt");
  assert(!s.adds.some((a) => a.type === "text"), "do not suggest a second Text");
  assert(s.recipes[0] && s.recipes[0].id === "llm-image", "Text recipe starts with LLM, not a raw Image");
  assert(s.recipes[0].steps[0].type === "llm" && s.recipes[0].steps[1].type === "image", "LLM then Image chain");
  assert(!s.recipes.some((r) => r.steps[0].type === "image"), "Text must not offer a chain that bypasses the LLM");
}

{
  const nodes = [
    { id: "t", type: "text", outputs: textOut },
    { id: "l", type: "llm", outputs: textOut },
    { id: "i", type: "image", outputs: imageOut },
  ];
  const links = [
    { from: { node: "t", port: "text" }, to: { node: "l", port: "prompt" } },
    { from: { node: "l", port: "text" }, to: { node: "i", port: "prompt" } },
  ];
  const s = suggestNext(g(nodes, links, "l"), { nodeTypes: known });
  assert(s.confident, "selected LLM stays confident");
  assert(!s.adds.some((a) => a.type === "text"), "do not suggest Text when the graph already has Text→LLM→Image");
  assert(!s.adds.some((a) => a.type === "image"), "do not suggest Image when that wire already exists");
  assert(s.adds[0] && s.adds[0].type === "tts", `next open consumer should be Speech, got ${s.adds.map((a) => a.type).join(",")}`);
  assert(!s.recipes.some((r) => r.id === "image-upscale"), "Image then Upscale is already satisfied");
  assert(s.adds.every((a) => a.fromId === "l" && a.fromPort === "text"), "adds wire from the selected LLM output");
}

{
  const nodes = [
    { id: "t", type: "text", outputs: textOut },
    { id: "l", type: "llm", outputs: textOut },
  ];
  const links = [{ from: { node: "t", port: "text" }, to: { node: "l", port: "prompt" } }];
  const s = suggestNext(g(nodes, links, "l"), { nodeTypes: known });
  assert(s.adds[0].type === "image", `LLM text out should suggest Image first, got ${s.adds[0] && s.adds[0].type}`);
  assert(!s.adds.some((a) => a.type === "llm"), "do not suggest another LLM on top of the selected LLM");
  assert(s.recipes[0] && s.recipes[0].label === "Image then Upscale", "LLM offers Image then Upscale");
  assert(s.recipes[0].steps[0].type === "image" && s.recipes[0].steps[0].toPort === "prompt", "recipe image is fed by the LLM text");
  assert(s.recipes[0].steps[1].type === "edit" && s.recipes[0].steps[1].fromPort === "image", "upscale step is fed by the new Image");
  assert(s.recipes.length <= 2 && s.adds.length <= 3, "short list");
}

{
  const nodes = [{ id: "t", type: "text", outputs: textOut }];
  assert(unusedRoot(nodes, [], "text"), "an unwired Text is an unused root");
  assert(!unusedRoot(nodes, [{ from: { node: "t", port: "text" }, to: { node: "l", port: "prompt" } }], "text"), "a wired Text is not unused");
  const s = suggestNext(
    g(
      [
        { id: "t", type: "text", outputs: textOut },
        { id: "l", type: "llm", outputs: textOut },
      ],
      [],
      "l"
    ),
    { nodeTypes: known }
  );
  assert(!s.adds.some((a) => a.type === "text"), "unused Text root is not offered beside the LLM");
}

{
  assert(wireExists(
    [{ from: { node: "l", port: "text" }, to: { node: "i", port: "prompt" } }],
    [{ id: "i", type: "image" }],
    "l", "text", "image"
  ), "existing image wire is detected");
}

{
  const s = suggestNext(g([{ id: "t", type: "text", outputs: textOut }], [], null), { nodeTypes: known });
  assert(!s.confident && s.adds.length === 0 && s.recipes.length === 0, "no selection is not confident");
  const c = suggestNext(g([{ id: "c", type: "comment", outputs: [] }], [], "c"), { nodeTypes: known });
  assert(!c.confident, "a note is not confident");
  const bare = suggestNext(g([{ id: "x", type: "widget", outputs: [] }], [], "x"));
  assert(!bare.confident, "a node with no open output is not confident");
}

{
  const s = suggestNext(
    g([{ id: "t", type: "text", outputs: textOut }], [], "t"),
    { nodeTypes: known, dismissed: ["add:llm", "recipe:llm-image", "recipe:llm-speech"] }
  );
  assert(s.confident && s.adds[0].type === "image", "dismissing LLM reveals Image");
  assert(!s.recipes.some((r) => r.id === "llm-image"), "dismissed recipe is gone");
  const all = ["add:llm", "add:image", "add:tts", "add:music", "add:tvideo", "add:join", "recipe:llm-image", "recipe:llm-speech"];
  const q = suggestNext(g([{ id: "t", type: "text", outputs: textOut }], [], "t"), { nodeTypes: known, dismissed: all });
  assert(q.confident && q.quiet && q.adds.length === 0 && q.recipes.length === 0, "dismissing every row goes quiet instead of falling back to a stale list");
}

{
  const img = suggestNext(
    g([{ id: "i", type: "image", outputs: imageOut }], [], "i"),
    { nodeTypes: known }
  );
  assert(img.adds[0].type === "ivideo", "image output prefers Image→Video");
  assert(img.recipes[0].label === "Edit then Resize", "image output offers a 2-step chain");
  assert(img.recipes[0].steps[0].toPort === "image" && img.recipes[0].steps[1].type === "resize", "Edit is fed by the image, Resize by Edit");
}

{
  const anchor = { x: 40, y: 80, w: 280, h: 200 };
  const size = { w: 300, h: 220 };
  const blocked = { x: 40 + 280 + 44, y: 80, w: 300, h: 220 };
  const before = JSON.stringify([anchor, blocked]);
  const slot = freeSlot(anchor, size, [anchor, blocked]);
  assert(JSON.stringify([anchor, blocked]) === before, "freeSlot does not move existing rects");
  const box = { ...slot, w: size.w, h: size.h };
  assert(!overlaps(box, blocked, 16), "slot clears the blocked rect");
  assert(!overlaps(box, anchor, 16), "slot clears the anchor");
  assert(slot.x >= anchor.x + anchor.w, "slot stays to the right of the anchor");
  const open = freeSlot(anchor, size, [anchor]);
  assert(open.x === Math.round(anchor.x + anchor.w + 44) && open.y === anchor.y, `empty right side is the first slot, got ${open.x},${open.y}`);
}

{
  const index = readFileSync(join(ROOT, "index.html"), "utf8");
  const surface = readFileSync(join(ROOT, "vendor", "next-action", "editor-surface.mjs"), "utf8");
  assert(surface.includes("suggestNext"), "editor surface publishes graph-aware suggestions");
  assert(index.includes("spawnSuggestionAdd"), "picking a suggestion spawns from the selection");
  assert(index.includes("data-recipe"), "recipes are rows in the add menu");
  assert(!index.includes("na-panel") && !index.includes("na-ghost"), "no debug panel or ghost");
  assert(!/suggestNext[\s\S]{0,80}%/.test(index), "no percent scores in the editor");
}

console.log("✓ next-action-suggest: selected output, no duplicate wire, free slot, recipes, dismiss");
