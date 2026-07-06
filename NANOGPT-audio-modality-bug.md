# Bug report — model catalog mislabels modality / input_modalities / output_modalities

> **RESOLVED UPSTREAM (verified 2026-07-05, never filed).** NanoGPT fixed every mislabel below on
> their own: the audio→audio models now report `text+audio->audio/music` with
> `audio_to_audio`/`music_cover`/`music_extension` capabilities, lyrics models are `text->text`,
> and `create-upload-id` was delisted. Live re-verification in `docs/audio-remix-probe-2026-07-05.md`.
> Of the two "separate issues": Gemini TTS (all 3 models) is also FIXED — 200 with binary wav
> (the pro model 400s on non-speech-like prompts; prompt sensitivity, not an outage).
> `Elevenlabs-Music-V1` is STILL broken (502, verbatim unchanged) — the only item left to raise.
> Kept for historical reference only.

**Endpoints:** `GET /api/v1/audio-models` and `GET /api/v1/image-models` (same in `?detailed=true`)

**Summary:** 15 models declare an `architecture.modality` (and `input_modalities` / `output_modalities`)
that does not match their real I/O. They are stamped as plain `text->...` generators but actually
require a non-text input (a source audio/image) or produce a different output (lyrics text, a song
description, an upload id). Because the structured fields (modality, capabilities, category) report the
same generic value as real generators, **a client cannot tell them apart from metadata** — they leak
into the wrong node and fail at call time.

Every claim below is **verified with live API calls** (errors quoted verbatim); none are inferred.

## Audio — 12 models tagged `text->music` that aren't (`/api/v1/audio/speech`)

| model id | declared | actual I/O | live response to `{model, input:"lo-fi beat"}` |
|---|---|---|---|
| `mureka-ai/generate-lyrics` | text→music | text→text | 400 "Mureka Generate Lyrics requires prompt" |
| `mureka-ai/extend-lyrics` | text→music | text→text | 400 "Mureka Extend Lyrics requires lyrics" |
| `mureka-ai/describe-song` | text→music | audio→text | 400 "Mureka Describe Song requires audio" |
| `mureka-ai/mureka-v7.6/recognize-song` | text→music | audio→text | 400 "... Recognize Song requires audio" |
| `mureka-ai/stem-song` | text→music | audio→audio | 400 "Mureka Stem Song requires audio" |
| `mureka-ai/vocal-clone` | text→music | audio→voice | 400 "Mureka Vocal Clone requires audio" |
| `mureka-ai/create-upload-id` | text→music | audio-url→id | 400 "Mureka Upload Audio requires audio" |
| `minimax/music-cover` | text→music | audio+text→music | 400 "MiniMax Music Cover requires an audio URL." |
| `mureka-ai/mureka-v7.6/extend-song` | text→music | audio+text→audio | 400 "... Extend Song requires audio" |
| `mureka-ai/mureka-v8/extend-song` | text→music | audio+text→audio | 400 "... Extend Song requires audio" |
| `mirelo-ai/sfx1.6/extend-audio` | text→music | audio+text→audio | 400 "... requires a source audio URL." |
| `mirelo-ai/sfx1.6/inpaint-audio` | text→music | audio+text→audio | 400 "... requires a source audio URL." |

## Image — 3 models tagged `text->image` that require a source image (`/v1/images/generations`)

These also report `capabilities.image_to_image:false`, so they look like pure text-to-image generators.

| model id | declared | actual I/O | live response to text-only `{model, prompt}` |
|---|---|---|---|
| `Upscaler` | text→image | image→image | 400 "Image upload is required for upscaling" |
| `flux-dev-image-to-image` | text→image | image→image | 400 "No input image data provided for image-to-image." |
| `flux-lora/inpainting` | text→image | image→image | 400 "Flux LoRA Inpainting requires a base image." |

Control: `flux-2-klein-9b` (genuine text→image) returns 200 with the same text-only request, confirming
the difference is real and not a client error.

## Separate issues — service failures (correctly labeled, but the model errors)

These are NOT mislabels — the modality is right — but the generation service fails for every request,
so they're effectively unusable until fixed upstream:

- **`Elevenlabs-Music-V1`** — `POST /api/v1/audio/speech` with any param shape returns
  `502 {"type":"server_error","message":"Music generation service error"}`. (ElevenLabs *TTS* models
  like `Elevenlabs-Turbo-V2.5` work fine — only Music is down.)
- **`gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts`, `gemini-3.1-flash-tts-preview`** —
  return `400 {"message":"Gemini TTS Error"}` even when passing a voice from the model's own
  `supported_parameters.voices` list (e.g. `voice:"Zephyr"`). Fails with and without a voice.

### Coverage that IS correct (verified, for reference)

Every node filter nanoodle uses was audited; these are all correctly tagged and need no change:

- `audio_tts` (25) → correctly `text->audio`; `audio_stt` (13) → correctly `audio->text`.
- Chat catalog (`/api/v1/models`, 622) → all `text->text`, no media models leaking in; the
  `capabilities.vision` flag is meaningful (243/622).
- Video (131) → modality correct; capability flags `text_to_video`/`image_to_video`/`video_to_video`
  /`audio_input` are all meaningful with zero unreachable ("orphan") models.

Only the audio-music and image rows above (15 models) are actually mislabeled.

> Note: video *generation* was verified by metadata only — we did not fire live generate calls because
> a genuine text→video model would charge for a real clip (unlike the audio/image mislabels, which 400
> for free on a missing required input). The audio/image findings above are all confirmed by live calls.

## Requested fix

Set `architecture.modality` / `input_modalities` / `output_modalities` (and ideally `capabilities` +
`category`) to match real I/O:

- lyrics models → `text->text` (or a `text_to_lyrics` capability)
- describe / recognize → `audio->text`, `input_modalities:["audio"]`
- stem / vocal-clone → `audio->audio`
- cover / extend / inpaint (audio + image) → include the source in `input_modalities`
  (e.g. `audio+text->...`, `image+text->image`) and set `image_to_image:true` for the image ones
- `create-upload-id` → ideally drop from the models list (it's a helper endpoint, not a model)

Once these are corrected, nanoodle's metadata-driven filters classify them correctly with no client-side
special-casing.
