# Prompt length caps — what was measured, 2026-07-26

Reported: an LLM node writing the prompt for a `qwen-image-3` Image node produced 831 characters and
the run died with

```
400 {"error":"Your prompt is too long for Qwen Image 3. Please shorten it to 800 characters
     or less (current: 831 characters).","code":"prompt_too_long"}
```

The prompt was **wired**, so there was nothing to shorten. Three questions had to be answered before
touching any code: how common is this, is the limit discoverable, and does telling the LLM about it
actually work.

## 1. How common — 183 of 214 image models probed

`scripts/probe-prompt-caps.mjs` (raw results: `census-2026-07-26.json`).

| cap (chars) | count | examples |
|---|---|---|
| 512 | 1 | `step-image-edit-2` |
| 800 | 1 | `qwen-image-3` ← the reported one, and a **Featured** model |
| 1200 | 3 | `z-image-turbo` family |
| 3000 | 40 | `flux-schnell`, `qwen-image`, `hidream`, `riverflow-2-*`, most Runware/CivitAI ids |
| none at 6000 | 39 | `nano-banana`, `flux-kontext`, `seedream-v4.5`, `imagen-4-ultra`, … |

31 models never reported (edit-only ids that reject the probe on its missing/synthetic source image
before prompt validation) — recorded as unknown, **not** as uncapped. Cost: $1.60, all of it from
models that ignore `size`, generate the 6000-character prompt and charge for the image.

Not image-only:

* **Video** — `minimax-hailuo-02` = 2000, `lightricks-ltx-2-fast` = 3000, and a third message shape
  with no `code` field at all.
* **Edit path** — same cap as generation (`qwen-image-3` = 800 with an `imageDataUrl` attached,
  `step-image-edit-2` = 512).
* **Audio** — already solved upstream: `supported_parameters.max_chars` is real catalog metadata for
  20 TTS models (512 … 20000). The editor applied it as a textarea `maxlength`, which a **wired**
  input walks straight past — same bug, different door. Now resolved through the same code path.

## 2. Is it discoverable — no

Neither `/api/v1/image-models` nor `/api/v1/video-models` carries any prompt-length field
(`supported_parameters` has `resolutions`, `max_images`, `max_output_images`, `max_input_images`,
`fixed_image_count`, `input_image_constraints` — nothing about text). Upstream ask filed:
`docs/NANOGPT-prompt-length-metadata.md`. Until it lands, caps come from the probed table plus
whatever a live 400 teaches us.

**Probe trick worth remembering:** route validation runs
`input images → route resolution limit → prompt length → model-specific size`. A 6000-char prompt
sent with a size the model doesn't support is therefore rejected *on prompt length* when the model
caps — free. Only models that ignore `size` fall through and charge.

## 3. What the trim costs — measured, not guessed

`verify-trim.mjs` runs the reported graph against five chat models and applies the shipped
`fitPromptText` to what each one wrote:

| model | written | sent | kept | cut at |
|---|---|---|---|---|
| `celeris-1` | 1244 | 698 | 56% | word |
| `openai/gpt-5-nano` | 1205 | 748 | 62% | sentence end |
| `deepseek-chat` | 1866 | 719 | 39% | sentence end |
| `claude-haiku-4-5-20251001` | 1292 | 641 | 50% | sentence end |
| `meta-llama/llama-4-scout` | 2785 | 794 | 29% | sentence end |

Read that plainly: **an LLM writing an image prompt overshoots a 800-char cap every single time**
(5/5, by 1.5–3.5×), so on a tight model the trim is the normal path, not the rare one, and between a
third and two thirds of the generated text is dropped. Four of five cuts land on a sentence end;
`celeris-1` had no sentence boundary above the 70% floor and fell back to a word boundary, which is
the fallback doing its job.

That is a real cost, and it is why the disclosure is not optional:

* **before the run** — the node shows `prompt limit 800 characters — a longer wired prompt is
  trimmed to fit`, so the limit is visible while there's still time to pick a different model;
* **at the run** — a toast, `prompt trimmed to 800 characters for Qwen Image 3 (was 2785)`;
* **after it** — a note that stays on the node: `✂ trimmed 2785 → 794 characters to fit`.

What nanoodle does **not** do is edit the graph's own prompts to avoid the trim. An LLM node's
system prompt is the user's text and reaches the model exactly as written; shortening it is their
call to make in their own words.

End to end: the trimmed 794-character prompt (from 2785) generated on `qwen-image-3` — the same
model that 400s at 831.

## Re-running

```sh
NANOGPT_API_KEY=… node scripts/probe-prompt-caps.mjs --dry-run          # queue + worst-case spend
NANOGPT_API_KEY=… node scripts/probe-prompt-caps.mjs --budget 1.00 --write
NANOGPT_API_KEY=… node proof/prompt-caps/verify-trim.mjs                # ~$0.10
node scripts/check-prompt-caps.mjs                                       # offline, in pre-commit
```
