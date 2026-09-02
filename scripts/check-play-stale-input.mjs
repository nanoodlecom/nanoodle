#!/usr/bin/env node
// When an upstream node FAILS in an exported app, play.html used to keep going and
// charge the dependent on leftover typed fields (image/video/llm `fields.prompt`).
// The editor's runGroup poisons that subtree (skip, never paid). This drives the
// REAL play runGraph() over a recording fetch and asserts the dependent image
// POST never fires — and that a healthy sibling branch still does.
//
// Offline node:vm, same harness as check-run-compat.mjs. No network, no API spend.

import { loadEngine, calls, catalog, recordingFetch } from "./play-engine.mjs";

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

// 5) Targeted sibling Plays: A(llm)→B(image), A→C(image). Play B then Play C
//    concurrently; shared A is charged once. Input kinds have no play control.
{
  ok(typeof app.isInputKind === "function", "play engine exports isInputKind");
  ok(app.isInputKind("text") && app.isInputKind("upload") && app.isInputKind("aupload")
    && app.isInputKind("vupload") && app.isInputKind("choice") && app.isInputKind("comment"),
    "input/source kinds are isInputKind (no Play)");
  ok(!app.isInputKind("image") && !app.isInputKind("llm") && !app.isInputKind("join"),
    "generate/processor kinds keep Play (empty inputs on image/llm do not hide it)");

  calls.length = 0;
  const g = app.materialize(
    graph(
      [
        node("a", "llm", { model: "ok-llm", prompt: "shared" }),
        node("b", "image", { model: "ok-img", prompt: "B" }),
        node("c", "image", { model: "ok-img", prompt: "C" }),
      ],
      [link("a", "text", "b", "prompt"), link("a", "text", "c", "prompt")],
    ),
  );
  const seenA = [];
  await Promise.all([
    app.runGraph(g, { seeds: ["b"], onResult: (n) => { if (n.id === "a") seenA.push({ seed: "b", cached: !!n.cached, costKnown: !!n.costKnown, costUsd: n.costUsd }); } }),
    app.runGraph(g, { seeds: ["c"], onResult: (n) => { if (n.id === "a") seenA.push({ seed: "c", cached: !!n.cached, costKnown: !!n.costKnown, costUsd: n.costUsd }); } }),
  ]);
  ok(chatCalls().length === 1, `shared upstream LLM charged once across sibling Plays (chats=${chatCalls().length})`);
  ok(imgCalls().length === 2, `both sibling images ran (POSTs=${imgCalls().length}, want 2)`);
  // Join must not mutate the shared node's billed cost. The owner already stamped
  // costUsd via bumpCost; zeroing / cached=true flashed the owner's branch Play
  // cost from the real bill to "↺ reused" (and the chip looked like A refunded).
  const nodeA = g.byId("a");
  ok(!nodeA.cached, `shared A must keep the owner's bill after a sibling joins (cached=${!!nodeA.cached} — would show ↺ reused on the owner)`);
  ok(nodeA.costKnown || nodeA.costUsd > 0, `shared A still carries the owner's cost after join (costUsd=${nodeA.costUsd}, costKnown=${!!nodeA.costKnown})`);
  ok(seenA.some((s) => !s.cached), `owner Play still reports A's real bill (seen=${JSON.stringify(seenA)})`);
  ok(seenA.some((s) => s.cached), `joining Play may label A reused on ITS lane without clobbering the node (seen=${JSON.stringify(seenA)})`);
}

// 6) Sequential sibling Play: after B finished, Play C reuses A (no second chat).
{
  calls.length = 0;
  const g = app.materialize(
    graph(
      [
        node("a", "llm", { model: "ok-llm", prompt: "shared" }),
        node("b", "image", { model: "ok-img", prompt: "B" }),
        node("c", "image", { model: "ok-img", prompt: "C" }),
      ],
      [link("a", "text", "b", "prompt"), link("a", "text", "c", "prompt")],
    ),
  );
  await app.runGraph(g, { seeds: ["b"] });
  const chatsAfterB = chatCalls().length;
  await app.runGraph(g, { seeds: ["c"] });
  ok(chatCalls().length === chatsAfterB, `Play C after B must not re-chat A (chats ${chatsAfterB} → ${chatCalls().length})`);
  ok(imgCalls().length === 2, `B then C each billed an image (POSTs=${imgCalls().length})`);
}

// 7) Stale-input (PR #391): editing shared A after Play B means Play C must re-run A,
//    not reuse the old chat. Empty-input generate nodes are still generate nodes.
{
  calls.length = 0;
  const g = app.materialize(
    graph(
      [
        node("a", "llm", { model: "ok-llm", prompt: "shared" }),
        node("b", "image", { model: "ok-img", prompt: "B" }),
        node("c", "image", { model: "ok-img", prompt: "C" }),
      ],
      [link("a", "text", "b", "prompt"), link("a", "text", "c", "prompt")],
    ),
  );
  await app.runGraph(g, { seeds: ["b"] });
  const chatsAfterB = chatCalls().length;
  g.byId("a").fields.prompt = "edited";
  await app.runGraph(g, { seeds: ["c"] });
  ok(chatCalls().length === chatsAfterB + 1, `edited A must re-chat on Play C (chats ${chatsAfterB} → ${chatCalls().length})`);
  ok(imgCalls().length === 2, `B then C each billed an image after A changed (POSTs=${imgCalls().length})`);
}

// 8) In-flight join + leftover out: A succeeded once, prompt changed, then A fails
//    while B and C share NODE_WORK. Joining C must skip — not bill an image on the
//    leftover chat (settleWork used to resolve leftover n.out as success).
{
  let chats = 0;
  const failApp = loadEngine((ctx) => {
    ctx.fetch = (url, opts) => {
      if (/\/chat\/completions/.test(String(url))) {
        chats++;
        if (chats >= 2) {
          return Promise.resolve({
            ok: false, status: 500,
            headers: { get: () => null },
            json: async () => ({ error: { message: "upstream 500" } }),
            text: async () => "upstream 500",
            arrayBuffer: async () => new ArrayBuffer(0),
          });
        }
      }
      return recordingFetch(url, opts);
    };
  });
  calls.length = 0;
  const g = failApp.materialize(
    graph(
      [
        node("a", "llm", { model: "ok-llm", prompt: "shared" }),
        node("b", "image", { model: "ok-img", prompt: "B" }),
        node("c", "image", { model: "ok-img", prompt: "C" }),
      ],
      [link("a", "text", "b", "prompt"), link("a", "text", "c", "prompt")],
    ),
  );
  await failApp.runGraph(g, { seeds: ["b"] });
  ok(chatCalls().length === 1 && imgCalls().length === 1, "first Play B succeeds (chat + image B)");
  g.byId("a").fields.prompt = "edited";
  const imgsAfterB = imgCalls().length;
  const statuses = [];
  await Promise.all([
    failApp.runGraph(g, { seeds: ["b"], onStatus: (id, kind) => statuses.push({ id, kind, seed: "b" }) }),
    failApp.runGraph(g, { seeds: ["c"], onStatus: (id, kind) => statuses.push({ id, kind, seed: "c" }) }),
  ]);
  ok(chats === 2, `edited A re-chats once and fails (chats=${chats})`);
  ok(imgCalls().length === imgsAfterB, `neither sibling image billed on leftover chat (POSTs ${imgsAfterB} → ${imgCalls().length})`);
  ok(
    statuses.some((s) => s.id === "c" && s.kind === "skip") || statuses.some((s) => s.id === "c" && s.kind === "error"),
    `Play C must skip/error, not done (statuses=${JSON.stringify(statuses.filter((s) => s.id === "c" || s.id === "b"))})`,
  );
}

if (fail) {
  console.error(`\n✗ play-stale-input: ${fail} assertion(s) failed.`);
  process.exit(1);
}
console.log("\n✓ play-stale-input: failed upstream poisons dependents — no leftover-field charge; sibling Plays run independently without double-charging shared upstream; a joined sibling does not bill on leftover .out when the shared run fails; joining a shared ancestor does not clobber the owner's costUsd; input kinds have no Play; healthy graphs unaffected.");
