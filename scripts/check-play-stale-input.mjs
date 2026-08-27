#!/usr/bin/env node
// When an upstream node FAILS in an exported app, play.html used to keep going and
// charge the dependent on leftover typed fields (image/video/llm `fields.prompt`).
// The editor's runGroup poisons that subtree (skip, never paid). This drives the
// REAL play runGraph() over a recording fetch and asserts the dependent image
// POST never fires — and that a healthy sibling branch still does.
//
// Offline node:vm, same harness as check-run-compat.mjs. No network, no API spend.

import { loadEngine, calls, catalog } from "./play-engine.mjs";

catalog.chat = [{ id: "ok-llm", capabilities: {} }];
catalog.image = [{ id: "ok-img", supported_parameters: { max_output_images: 1 } }];

const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
let _l = 0;
const link = (from, fromPort, to, toPort) => ({
  id: "l" + (++_l),
  from: { node: from, port: fromPort },
  to: { node: to, port: toPort },
});
const graph = (nodes, links) => ({ nodes, links });

const chatCalls = () => calls.filter((c) => /\/chat\/completions/.test(c.url));
const imgCalls = () => calls.filter((c) => /\/images\/generations/.test(c.url));

const app = loadEngine();
let fail = 0;
const ok = (c, m) => {
  if (!c) {
    fail++;
    console.log("  ✗ " + m);
  } else console.log("  ✓ " + m);
};

// 1) Drifted (catalog-missing) LLM → Image with a leftover typed prompt must NOT
//    bill the image. Before the fix, inp.prompt was undefined and image.run fell
//    back to n.fields.prompt ("LEFTOVER") and POSTed /images/generations.
{
  calls.length = 0;
  const statuses = [];
  const g = app.materialize(
    graph(
      [
        node("m1", "llm", { model: "gone", prompt: "user asked for this" }),
        node("i1", "image", { model: "ok-img", prompt: "LEFTOVER" }),
      ],
      [link("m1", "text", "i1", "prompt")],
    ),
  );
  await app.runGraph(g, { onStatus: (id, kind, msg) => statuses.push({ id, kind, msg }) });
  ok(chatCalls().length === 0, `drifted LLM must not chat (got ${chatCalls().length})`);
  ok(imgCalls().length === 0, `dependent image must not be billed on leftover prompt (POSTs=${imgCalls().length}, want 0)`);
  ok(
    statuses.some((s) => s.id === "i1" && s.kind === "skip"),
    `dependent shown skip, not done (statuses=${JSON.stringify(statuses.filter((s) => s.id === "i1"))})`,
  );
}

// 2) Poison is transitive: LLM → Image → Edit. Image skip must also skip Edit
//    (edit would otherwise throw "no image" for free, but a typed-fallback node
//    further down must not charge).
{
  calls.length = 0;
  const g = app.materialize(
    graph(
      [
        node("m1", "llm", { model: "gone", prompt: "hi" }),
        node("i1", "image", { model: "ok-img", prompt: "LEFTOVER" }),
        node("e1", "edit", { model: "ok-img", prompt: "also leftover" }),
      ],
      [link("m1", "text", "i1", "prompt"), link("i1", "image", "e1", "image")],
    ),
  );
  const statuses = [];
  await app.runGraph(g, { onStatus: (id, kind) => statuses.push({ id, kind }) });
  ok(imgCalls().length === 0, `transitive skip: no image/edit POSTs (got ${imgCalls().length})`);
  ok(
    statuses.some((s) => s.id === "i1" && s.kind === "skip") && statuses.some((s) => s.id === "e1" && s.kind === "skip"),
    `both dependents skipped (got ${JSON.stringify(statuses.filter((s) => s.kind === "skip"))})`,
  );
}

// 3) Sibling independence: a failed LLM must not block an unrelated Image.
{
  calls.length = 0;
  const g = app.materialize(
    graph(
      [
        node("m1", "llm", { model: "gone", prompt: "hi" }),
        node("i1", "image", { model: "ok-img", prompt: "LEFTOVER" }),
        node("i2", "image", { model: "ok-img", prompt: "SIBLING" }),
      ],
      [link("m1", "text", "i1", "prompt")],
    ),
  );
  await app.runGraph(g, {});
  ok(imgCalls().length === 1, `unrelated sibling image still runs (POSTs=${imgCalls().length}, want 1)`);
  ok(
    imgCalls()[0] && imgCalls()[0].body && imgCalls()[0].body.prompt === "SIBLING",
    `sibling billed its own prompt, not leftover (got ${JSON.stringify(imgCalls()[0] && imgCalls()[0].body && imgCalls()[0].body.prompt)})`,
  );
}

// 4) Control: a healthy LLM → Image uses the LLM output, not the leftover field.
{
  calls.length = 0;
  const g = app.materialize(
    graph(
      [
        node("m1", "llm", { model: "ok-llm", prompt: "user asked for this" }),
        node("i1", "image", { model: "ok-img", prompt: "LEFTOVER" }),
      ],
      [link("m1", "text", "i1", "prompt")],
    ),
  );
  await app.runGraph(g, {});
  ok(chatCalls().length === 1, `healthy LLM chats once (got ${chatCalls().length})`);
  ok(imgCalls().length === 1, `healthy dependent image is billed once (got ${imgCalls().length})`);
  ok(
    imgCalls()[0] && imgCalls()[0].body && imgCalls()[0].body.prompt === "CHAT_REPLY",
    `image consumed the LLM output, not leftover (got ${JSON.stringify(imgCalls()[0] && imgCalls()[0].body && imgCalls()[0].body.prompt)})`,
  );
}

if (fail) {
  console.error(`\n✗ play-stale-input: ${fail} assertion(s) failed.`);
  process.exit(1);
}
console.log("\n✓ play-stale-input: failed upstream poisons dependents — no leftover-field charge; siblings and healthy graphs unaffected.");
