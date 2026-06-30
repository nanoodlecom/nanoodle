<!-- Generated 2026-06-29 from a live nano-gpt catalog snapshot (chat 601 / image 202 / video 135 / audio 78) cross-referenced against NODE_TYPES in index.html. Produced via a 4-analyst + synthesis workflow; every code-line and model-count claim spot-verified against source and the live catalog. -->

# Model Capability Coverage Audit

> **Status (2026-06-29) — 9 of the top items shipped to `main`, all live-smoke-verified + locked by offline `check-run-compat` scenarios:**
> - **Wave 1:** ranks **1/2/3** LLM sampling + JSON mode + reasoning (PR #52), **4** unmute audio-gen video (#50), **5** text/number video params (#53), **10** STT language dropdown (#51).
> - **Wave 2:** **#7** image batch variations + `fixed_image_count` fix (#55), **#6** multi-reference image edit / compositing (#58), **#8** audio input to the LLM node (#54, audio half).
> - **Deferred:** **#8 video input** (frames/URL-only, riskier) and **#9 STT timestamps/diarization** — the `Elevenlabs-STT` verbose endpoint 400'd on probe; needs the contract debugged before building. **#11 end-frame** and **#12 fps** remain as smaller follow-ups.

## TL;DR
- **The single biggest lever is `normChat`.** It extracts exactly 1 of 8 advertised chat capabilities (`vision`); the other 7 (reasoning 262, tool_calling 195, structured_output 190, video_input 73, pdf_upload 86, audio_input 32) are invisible to every node and control. Widening this one normalizer (~3 lines) is the prerequisite that unblocks three separate high-reach chat features.
- **Chat is our deepest gap and our cheapest win.** Every one of 601 chat models runs at a hardcoded `temperature:0.8` with no `max_tokens`, no reasoning depth, and no JSON mode — even though those are standard OpenAI params nano-gpt already proxies. The text a node emits is freeform prose, which quietly undermines the core "LLM → next node" promise of a DAG playground.
- **Image and video routing is sound; the gaps are plurality and parameter surface.** No gen-capable model is wrongly hidden. But `genImage` hardcodes `n:1`/`data[0]` (150 batch-capable models capped, 2 `fixed_image_count:4` models throw away 3 paid images) and wires one input image (55 multi-reference edit models — nano-banana-2/seedream — can't do their marquee composite). Video's options block silently drops every `text`/`number` param, so negative_prompt/seed/cfg are unreachable on 30 models.
- **A few near-zero-effort fixes have outsized reach:** dropping `muted` on the 43 audio-generating video models (Veo3/Kling/Seedance render with sound today and users hear nothing), and exposing the catalog's per-model sampling/voice/language lists that already exist in the data.
- **Honest dead-ends exist and should be documented, not attempted:** tool_calling (195) needs state/cycles the feed-forward DAG forbids; the audio-in remix/extend/clone family and inline PDF/video are gated by the ~4.5MB edge cap and unverified upload contracts until nano-gpt ships a CORS media endpoint.

## How coverage works today
A model "shines" only if it survives a four-stage pipeline. (1) Models arrive **live** from nano-gpt into four catalogs and are run through a **normalizer** (`normChat`/`normImg`/`normVideo`/`normAudio`, index.html ~531–643) that collapses the raw API shape into a small set of boolean **capability flags**. (2) Each **node** in `NODE_TYPES` (~1108–1530) declares `{modelKind, modelFilter}`, and the filter reads those flags to decide which models appear in its picker. (3) The node body renders **controls** (selects, sliders, ports), some catalog-driven (resolutions, voices, durations), some hardcoded. (4) The `gen*`/`ctx.*` senders build the request body. A capability is only reachable when it survives all four stages — so a flag the normalizer never extracts (most of chat) is invisible no matter how many models advertise it, and a param no control renders (video text/number params) is unsettable even when the node otherwise fits.

## Coverage scorecard
| Modality | Models | Well-mapped today | Headline gap |
|---|---|---|---|
| Chat | 601 | text+image-in → text (llm vision ports, vision node) | normChat extracts only `vision`; no sampling/reasoning/JSON, no audio/video/pdf input |
| Image | 202 | gen/edit/inpaint routing, live resolutions+pricing, LoRA | `n:1`/single input image — no batch, no multi-reference compositing |
| Video | 135 | t2v/i2v/v2v/avatar routing, select/switch params, dims+price | options block drops all text/number params; audio-gen previews muted |
| Audio | 78 | text→music, TTS (voices/max_chars), STT | STT timestamps/diarization dropped; audio-in family unreachable |

## Prioritized roadmap (executed)
Ranked by (models served × user impact) ÷ effort. Overlapping findings deduplicated (multimodal LLM input ports = one item; reasoning/JSON/sampling share the `normChat` widening). **Status reflects what actually shipped** — the original "do now" batch was built out wave-by-wave; the two remaining items are parked behind unverified contracts.

| Rank | Change | Modality | Models | User win | Status |
|---|---|---|---|---|---|
| 1 | LLM/vision sampling controls (temperature slider + max_tokens) | Chat | 601 | Determinism, creativity, cost/length bound on every chat run | ✅ shipped — #52 |
| 2 | Widen `normChat` to 5 flags + JSON mode (`response_format`) on llm | Chat | 190 | Structured output makes "LLM → downstream field" reliable; unblocks #3/#8 | ✅ shipped — #52 |
| 3 | Reasoning control (`reasoning_effort` + show-thinking) | Chat | 262 | Biggest cost/quality lever; stop relying on `:thinking` id suffixes | ✅ shipped — #52 |
| 4 | Drop `muted` on audio-generating video previews | Video | 43 | Veo3/Kling/Seedance audio is audible instead of silently "broken" | ✅ shipped — #50 |
| 5 | Render text/number video params (negative_prompt, seed, cfg, steps) | Video | 30 | Artifact suppression + reproducible seeds on Kling/Wan/LTX | ✅ shipped — #53 |
| 6 | Multi-reference input ports on edit node (max_input_images) | Image | 55 | nano-banana-2/seedream multi-image compositing — the model's whole point | ✅ shipped — #58 |
| 7 | Image batch + fix `fixed_image_count:4` data loss | Image | 150 | "Generate 4, pick best"; stop discarding 3 paid Midjourney images | ✅ shipped — #55 |
| 8 | Multimodal LLM input ports (audio + video) | Chat | 105 | Wire in-graph audio/video into omni models to transcribe/caption/QA | ◐ audio shipped — #54; video deferred (frames/URL-only, riskier) |
| 9 | Transcribe timestamps + diarization toggles | Audio | 6 | Subtitles, karaoke timing, speaker-labeled notes | ⏸ deferred — `Elevenlabs-STT` verbose endpoint 400'd on probe; contract needs debugging first |
| 10 | STT language dropdown from supported_languages | Audio | 6 | No more guessing/typo'd language codes | ✅ shipped — #51 |
| 11 | i2v end-frame port (`last_image`) | Video | 11 | Seedance 2.0 / Wan 2.7 keyframe interpolation | ⏸ follow-up |
| 12 | rendering_speed (image, 2) + fps/num_frames (video, 5) | Image/Video | 7 | Speed-vs-quality + frame-rate knobs; fps folds into #5 | ⏸ follow-up |

**Outcome:** the original "do now" batch (ranks 1–7, 10 + the audio half of 8) shipped across PRs #50–#55, #58 — ~1,140 model-slots, all live-smoke-verified and locked by offline `check-run-compat` scenarios. Remaining: **#8 video input** and **#9 timestamps/diarization** (both blocked on contracts to verify), plus **#11/#12** as smaller follow-ups. The deep dives below are retained as the implementation record + rationale for the parked items.

## Deep dives
> Retained as the implementation record. Each shipped item is tagged with its PR; the rationale is kept so the parked items (#8 video, #9) have a documented contract to pick up later.

### 1. LLM sampling controls (temperature/max_tokens) — 601 models — ✅ #52
**Gap:** `genChat` hardcodes `{temperature:0.8}` with no length cap; reads back only `choices[0].message.content`. No control exists on llm or vision.
**Change:** a small settings disclosure on llm/vision with a temperature slider (default 0.8) and optional max_tokens, passed through `genChat`. Per the play-settings boundary these are shape-preserving knobs — they belong in `deriveSettings`, not `deriveInputs`. Drive the max_tokens ceiling from the catalog's `max_output_tokens` (present on 556 models).
**Risks:** negligible — universally accepted OpenAI params nano-gpt already proxies. Follow the existing omit-on-default convention so default bodies stay clean.

### 2. structured_output / JSON mode + the `normChat` widening — 190 models — ✅ #52
**Gap:** the entire premise of nanoodle is piping an LLM's output into the next node, but that output is freeform prose. 190 models can guarantee valid JSON and the user can't ask for it. Root cause: `normChat` (~531) extracts only `vision`.
**Change:** first widen `normChat` to also extract `structured_output`, `reasoning`, `tool_calling`, `audio_input`, `video_input`, `pdf_upload` (~3 lines — this is the keystone that also enables #3 and #8). Then add a Format select (Text | JSON) on llm gated on `structured_output`; when JSON, `genChat` sends `response_format:{type:'json_object'}`. Optional follow-up: a schema textarea → `json_schema`.
**Example models:** nanogpt/coding-router, stepfun/step-3.7-flash:thinking, sakana/fugu-ultra, claw-high, perceptron/perceptron-mk1.
**Risks:** `json_object` is broadly supported; `json_schema` is not universal across nano-gpt's upstreams — gate on the flag and fall back gracefully on a 400. Verify the exact body shape the /chat endpoint accepts before shipping schema mode.

### 3. Reasoning depth + thinking trace — 262 models — ✅ #52
**Gap:** the only way to touch reasoning depth today is hand-picking a model whose effort is baked into its id (~70 `:thinking`/`:high`/`-high` variants act as a de-facto UI). Same base model at a different effort = a separate catalog entry. Separately, `genChat` reads only `message.content`, so any `reasoning`/`reasoning_content` chain-of-thought is silently dropped.
**Change:** a Reasoning select (off/low/medium/high) on llm gated on the `reasoning` flag → `genChat` passes `reasoning_effort`; plus a "show thinking" toggle that concatenates `reasoning_content`/`reasoning` into the output (or a second thinking port).
**Example models:** openai/o4-mini-high, moonshotai/kimi-k2.5:thinking, google/gemini-3.1-pro-preview-high, nvidia/nemotron-3-ultra-550b-a55b:thinking.
**Risks:** param name is not uniform (`reasoning_effort` vs `thinking_budget` vs id-suffix-only models that reject the param); trace field name varies (`reasoning` vs `reasoning_content`). Live-probe a few providers before committing to one body shape; gate strictly on the flag so id-suffix-only models don't get a rejected param.

### 4. Unmute audio-generating video previews — 43 models — ✅ #50
**Gap:** Veo3, Kling v2.6/v3.0, Seedance and 40 others render video *with synchronized audio* (their headline feature), but the result preview is `<video … loop muted>` (line 2027) with no cue that sound exists. Users conclude audio failed. The audio is in the file — this is discoverability, not data loss.
**Change:** expose `audio_generation` from `normVideo` (currently not in the returned object) and render `muted` only when it's false; optionally add a 🔊 badge. The preview has `controls` and no autoplay, so unmuting won't blast sound until play is pressed.
**Risks:** none material — line 2027 has no autoplay, so removing `muted` is safe. Cheapest high-reach fix in the audit.

### 5. Render text/number video params — 30 models — ✅ #53
**Gap:** `videoOptDefs` (~922–937) only emits controls for `d.type` 'select' and 'switch'/'boolean', silently dropping all 57 text + 35 number + 14 string param descriptors. So negative_prompt (9 models), seed (14), cfg_scale (5), num_inference_steps (2) are unreachable — even though the audio nodes already ship exactly this via curated `AUDIO_PARAMS` (negative_prompt+seed, send-only-when-nonempty).
**Change:** extend `videoOptDefs`/`refreshModelOpts` to render 'text'/'string' as input/textarea and 'number' as a number input (min/max/step from the descriptor), passed unchanged through `opts.extra` (`genVideo` already Object.assigns extra into the body). Keep a skip-set for URL-list params (`last_image`, `reference_*`, `audio_url`, `loras`) that need real wiring, not free text.
**Example models:** wan-2.7-video, kling-v21-master/pro, kling-video-v2, ltx-2-19b.
**Risks:** some 'text' params are media URLs — free-texting them is a footgun, so exclude them (covered by #11 and out-of-scope items). Confirm the API tolerates omitted empty seed/negative_prompt (audio already proves it does).

### 6. Multi-reference input ports on the edit node — 55 models — ✅ #58
**Gap:** the edit node declares one `image` port and `genImage` sends one `imageDataUrl`, but 55 edit-routed models accept 2–14 reference images (53 accept ≥3). The signature "put THIS product in THAT scene with THIS face" composite is impossible.
**Change:** reuse the llm node's dynamic-port machinery (`imageInputs` + `refreshImageInputs`, ~1667–1700): when the picked model's `max_input_images > 1`, grow image_2..image_N ports up to that cap, collect wired data URLs into an array, and add an array branch in `genImage` (~2646).
**Example models:** nano-banana-2 (cap 14), nano-banana-pro, seedream-v4.5, qwen-image-2.0, hidream-o1-image.
**Risks:** **API contract unverified** — the endpoint may want `imageDataUrls:[…]`, numbered `imageDataUrl_1..N`, or `image_urls`; confirm with nano-gpt first (biggest unknown). N inlined refs hit the ~4MB `MEDIA_INLINE_MAX` per-request cap fast — add a combined-size guard like inpaint's (~1277). Key the multi-port trigger off `max_input_images`, not the i2i flag (nano-banana-pro-ultra reports max_input_images=10 with image_to_image=false).

### 7. Image batch + `fixed_image_count` data loss — 150 models — ✅ #55
**Gap:** `genImage` hardcodes `n:1` (~2647) and reads `(j.data||[])[0]` (~2654). The "generate 4 candidates, pick best" UX is absent. Worse, midjourney/text-to-image and higgsfield-soul carry `fixed_image_count:4` — they always return 4 — and we discard 3 paid images.
**Change:** add a variations control (clamped to `max_output_images`) setting `n`, and surface all of `data[]` instead of just `[0]`. v1 minimum: a node-local results gallery/preview strip (pick-one to forward), which avoids new port semantics and *also* closes the fixed-count waste today. True fan-out to N downstream ports is a larger DAG change — defer.
**Example models:** midjourney/text-to-image, higgsfield-soul, gpt-image-1.5, nano-banana-2, seedream-v4.5.
**Risks:** a DAG port carries one image, so keep v1 node-local. Verify the endpoint honors `n` (some providers ignore it). nsfw batches need the same handling as single output.

### 8. Multimodal LLM input ports (audio + video) — ~105 models — ◐ audio shipped #54; video deferred
**Gap:** 32 chat models accept audio and 73 accept video, and nanoodle *already produces both in-graph* (aupload/music/tts emit audio; vupload/tvideo/ivideo emit video). But the llm node only grows image ports (`imageInputs:'vision'`), so a "generate a clip → describe/critique it" loop is impossible despite both halves existing. Dedupe: this is one port-generalization, since omni models advertise both.
**Change:** generalize the dynamic-port mechanism beyond images — grow an audio/video port gated on the (newly-extracted, see #2) `audio_input`/`video_input` flags, and have `run()` emit OpenAI-style content parts (`{type:'input_audio', input_audio:{data,format}}`, the provider's video part) alongside the prompt. Reuse the `collectImageInputs` pattern.
**Example models:** gemini-3.1-pro-preview, qwen3.5-omni-flash/plus (audio); xiaomi/mimo-v2.5, glm-4.6v-flash, qwen3.7-plus (video).
**Risks:** **content-part shape unverified** (`input_audio` vs `audio_url`; inline base64 vs URL). Inline payloads hit the ~4.5MB edge cap that already bites lipsync — long clips 413; add the same size guard/message. Video is higher-risk: many vision-LLMs ingest only sampled frames or a hosted URL, so inline video may be a partial dead-end viable only for chained remote `videoUrl` sources. Ship audio first; gate video behind a live probe.

## Explicitly out of scope / dead-ends
- **tool_calling (195 chat models)** — needs a stateful multi-turn loop; nanoodle is a feed-forward DAG (cycles error) per the documented capability boundary. Document as a known non-goal. At most a hardcoded hosted-tool toggle (linkup-research/mirothinker ids) — marginal value, not a tool runtime.
- **PDF document Q&A (86 models)** — no PDF source node and inline base64 PDFs routinely exceed the ~4.5MB edge cap. Shippable only for small docs; full document reasoning is blocked until nano-gpt offers an upload/CORS media endpoint (already a tracked TODO). Defer with the audio-in family.
- **Audio-in generative family — extend/cover/inpaint/stem (~9 models)** — "generate a song then remix it" is appealing, but the source-audio passing contract for /audio/speech is undocumented, the 3.5MB inline cap is too small for full songs (CORS-fetch of CDN bytes), and stem_separation needs multi-port output. Blocked on contract + upload endpoint; several members are 1-offs.
- **Voice clone → TTS (5 models)** — flagship use case, but voice-id portability across clone vs TTS providers is unproven (a MiniMax id likely only works on MiniMax TTS), plus reference-audio upload contract is unverified and there's a privacy/consent surface to uploading a person's voice. A paste-your-own-voice-id override on the TTS control is the only safe slice.
- **reference-to-video (reference_images/videos/audios, ~12 models)** — multiple inlined reference media blow the 4MB cap immediately and free-texting URLs is a footgun. Strategic follow-on to #6/#11's port mechanism once a media-upload endpoint exists; no safe interim.
- **text_to_lyrics generators (2 models)** — the generic llm node already does text→text into the Music node's Lyrics port; a dedicated node is marginal.
- **rendering_speed (2 image models), sample_count for Mirelo SFX (1 model), kling-lipsync-a2v (1)** — real but tiny reach. rendering_speed/fps fold into existing param work (#5/#12). kling-lipsync-a2v currently dead-ends in vedit (sends no audio) — cheapest correct move is to gate it out of vedit like multi-audio avatars already are, rather than build a port for one model.
- **No-analytics / no-server constraints hold throughout** — none of the ranked items add a third-party origin, tracking, or a server hop; all stay BYO-key and client-side. The recurring blocker across the dead-ends is the deliberate absence of an upload/S3 path, not a policy we'd relax.
---

## Methodology & data snapshot
- **Snapshot:** live nano-gpt catalogs fetched 2026-06-29 — `/api/v1/models?detailed=true` (601 chat), `/api/v1/image-models` (202), `/api/v1/video-models` (135), `/api/v1/audio-models` (78).
- **Method:** one analyst per modality cross-referenced each advertised capability/parameter against the four-stage pipeline (normalizer → flag → node filter → control/sender) in `index.html`, then a synthesis pass deduplicated and ranked by (models served × user impact) ÷ effort.
- **Verification:** code-line claims (`genChat` `temperature:0.8` @2661, preview `muted` @2027, `videoOptDefs` dropping text/number @922, `genImage` `n:1`/`data[0]` @2647/2654) and model counts (556/601 carry `max_output_tokens`; exactly 2 models `fixed_image_count:4`; 150 batch-capable; 64 multi-input) were spot-checked against source and the live catalog before publishing.
- **Caveat:** counts drift as nano-gpt's catalog changes — re-run the snapshot before acting on a specific number. Every "API contract unverified" item in the deep dives must be live-probed before implementation.
