# Bug report — audio-models endpoint mislabels modality / input_modalities / output_modalities

**Endpoint:** `GET /api/v1/audio-models` (same in `?detailed=true`)

**Summary:** 12 audio models are stamped `architecture.modality: "text->music"` with
`input_modalities: ["text"]`, `output_modalities: ["music"]`, `capabilities.text_to_music: true`,
`category: "audio_music"` — but they are **not** text→music generators. They are utility / analysis /
source-requiring endpoints with different real I/O. Because every field (modality, capabilities,
category) reports the same generic `text→music`, there is **no way for a client to tell a real music
generator from a lyrics generator, a song analyzer, or a file-upload helper.**

The catalog already supports the correct labels (other models correctly report
`input_modalities:["audio"]`, `output_modalities:["text"]`), so this is a data-tagging fix, not a
schema change.

## The 12 mislabeled models

| model id | declared | actual I/O | what it really does |
|---|---|---|---|
| `mureka-ai/generate-lyrics` | text→music | **text→text** | generates lyrics text |
| `mureka-ai/extend-lyrics` | text→music | **text→text** | extends lyrics text |
| `mureka-ai/describe-song` | text→music | **audio→text** | takes an audio URL, returns a description |
| `mureka-ai/mureka-v7.6/recognize-song` | text→music | **audio→text** | identifies a song from audio |
| `mureka-ai/stem-song` | text→music | **audio→audio** | stem separation |
| `mureka-ai/vocal-clone` | text→music | **audio→voice-id** | voice clone from a reference |
| `mureka-ai/create-upload-id` | text→music | **audio-url→upload-id** | registers an upload, returns an id |
| `minimax/music-cover` | text→music | **audio+text→music** | cover — requires a source audio |
| `mureka-ai/mureka-v7.6/extend-song` | text→music | **audio+text→audio** | extends a source song |
| `mureka-ai/mureka-v8/extend-song` | text→music | **audio+text→audio** | extends a source song |
| `mirelo-ai/sfx1.6/extend-audio` | text→music | **audio+text→audio** | extends a source clip |
| `mirelo-ai/sfx1.6/inpaint-audio` | text→music | **audio+text→audio** | inpaints a region of source audio |

## Requested fix

Set `architecture.input_modalities` / `output_modalities` / `modality` (and ideally `capabilities` +
`category`) to match the real I/O — e.g.:

- lyrics models → `modality: "text->text"` (a `text_to_lyrics` capability would be even clearer)
- describe / recognize → `modality: "audio->text"`, `input_modalities:["audio"]`
- stem → `modality: "audio->audio"`
- vocal-clone → `modality: "audio->audio"` (or a `voice_clone` capability)
- create-upload-id → not a model; ideally drop from the models list (it's a helper endpoint)
- cover / extend / inpaint → include `audio` in `input_modalities` (e.g. `audio+text->music|audio`)

## How we verified

Live calls to `/api/v1/audio/speech`:
- `Elevenlabs-Music-V1` → **HTTP 502** `{"type":"server_error","message":"Music generation service error"}`
  regardless of params (separate upstream issue worth a look).
- `mureka-ai/mureka-v8/generate-song` → clean 400 "requires lyrics" (correct behavior).
- `fal-ai/stable-audio-3/.../text-to-audio` → `202 {status:"pending", runId}` (works).
- The 12 above were classified from their `id` action verb + `description` text, cross-checked against
  the declared modality.
