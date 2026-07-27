# Feature request — image/video catalogs don't advertise the prompt character cap the route enforces

**Endpoints:** `GET /api/v1/image-models`, `GET /api/v1/video-models`
(the audio catalog already gets this right — see "Precedent" below)

**Summary:** many image and video models reject an over-long prompt at the route, before the
provider is called:

```
POST /v1/images/generations   {"model":"qwen-image-3","prompt":"…831 chars…"}
400 {"error":"Your prompt is too long for Qwen Image 3. Please shorten it to 800 characters
     or less (current: 831 characters).","code":"prompt_too_long"}
```

That message is templated per model, so the limit clearly exists as data on your side. But nothing
in the catalog exposes it. `supported_parameters` carries `resolutions`, `max_images`,
`max_output_images`, `max_input_images`, `fixed_image_count`, `input_image_constraints`
(with lovely per-route/per-provider min/max pixel and byte limits) — and no prompt length at all.

**Measured, 2026-07-26** (183 of 214 image models probed; method below):

| cap (chars) | models |
|---|---|
| 512 | `step-image-edit-2` |
| 800 | `qwen-image-3` |
| 1200 | `z-image-turbo`, `z-image-turbo-lora`, `z-image-turbo-image-to-image` |
| 3000 | 40 models (`flux-schnell`, `qwen-image`, `hidream`, `riverflow-2-*`, most Runware/CivitAI ids) |
| none at 6000 | 39 models (`nano-banana`, `flux-kontext`, `seedream-v4.5`, `imagen-4-ultra`, …) |

Video models cap too, with a *different* message shape:
`minimax-hailuo-02` → 2000 (`"Your prompt is too long. Please shorten it to 2000 characters or less"`),
`lightricks-ltx-2-fast` → 3000 (`"Prompt is too long. Please keep it under 3000 characters."` — no `code` field).

**Why it matters:** in a node-graph tool the prompt is usually *generated*, not typed — an LLM node
writes it and a wire carries it into the image node. "Please shorten it to 800 characters" then
points at a field the user cannot type into, on a model they picked for its picture quality, with no
hint that 800 was ever the number. It's the single most confusing dead end we've seen reported,
because everything about it looks like a bug in the tool rather than a limit of the model.

It's also unnecessary spend upstream: the LLM call that wrote the 831-character prompt was paid for,
and it had to be re-run to get a shorter one.

**Ask:** publish the cap as catalog metadata, e.g.

```json
"supported_parameters": { "max_prompt_chars": 800 }
```

alongside the existing `resolutions` / `max_input_images`. Clients could then size prompts *before*
sending — and, more usefully, tell the model that writes the prompt how much room it has.

**Precedent:** `GET /api/v1/audio-models` already does exactly this —
`supported_parameters.max_chars` is populated for 20 TTS models (512 … 20000), and it's how we size
speech input today with no probing at all. The same field name on image/video would be ideal.

**Secondary ask — one error shape.** Three different phrasings for the same condition
(`{"error": "…"} + code`, `{"error":{"message":"…","code":"…"}}`, and a bare sentence with no code)
means every client parses prose. A consistent `code: "prompt_too_long"` plus a machine-readable
`max_chars` in the error body would let clients recover without regexes.

**Our workaround (client-side, shipping meanwhile):** a probed table (`scripts/probe-prompt-caps.mjs`
→ `PROMPT_CAPS` in index.html/play.html), a cap learned from the live 400 the first time we hit one,
and a boundary trim on anything over the cap — stated on the node before the run and again after it.
Measured against five chat models on the reported graph, that trim drops 38–71% of what the LLM
wrote, because a model with no way to know the limit overshoots it every time. With the cap in the
catalog we could show it in the model picker, where someone would pick a different model instead of
losing two thirds of their prompt. Probing also costs real money — models *without* a cap generate the 6000-character prompt and charge for
the image (~$1.60 for the 2026-07-26 sweep), so the table is partial by design and goes stale every
time a model is added. One catalog field would delete all of it.

---

**Probe method** (for reproducing the table): route validation runs
`input images → route resolution limits → prompt length → model-specific size`, so a request with a
6000-character prompt *and* a size the model doesn't support is rejected on prompt length when the
model caps, and on size when it doesn't — both free. Models that ignore `size` entirely (about 40%)
generate and charge instead; that's the cost above.
