# Bug report — model catalog mislabels modality / input_modalities / output_modalities

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

## Separate issue — `Elevenlabs-Music-V1` 502

`POST /api/v1/audio/speech` with any param shape returns
`502 {"type":"server_error","message":"Music generation service error"}`. This one is correctly labeled
(it IS a text→music model) but the generation service is failing upstream.

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
