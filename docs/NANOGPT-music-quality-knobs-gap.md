# Feature request — MiniMax Music family never exposes bitrate/sample_rate in `supported_parameters`

**Endpoint:** `GET /api/v1/audio-models`

**Models affected:** `minimax/music-3`, `Minimax-Music-02`, `Minimax-Music-2.5`, `Minimax-Music-2.6`
(every MiniMax music model in the catalog as of 2026-08-27).

**Summary:** three of these four models' own catalog `description` fields advertise a bitrate/sample-rate
quality knob, but `supported_parameters` never carries it:

| model id | description says | `supported_parameters` |
|---|---|---|
| `minimax/music-3` | "creates complete songs from a detailed music description and structured lyrics, or instrumental-only mode" (no bitrate/sample-rate mention, and no duration either) | `{}` |
| `Minimax-Music-02` | "configurable bitrate and sample rate" | `{min_duration:10, max_duration:300}` |
| `Minimax-Music-2.5` | "Choose bitrate and sample rate to control output quality" | `{min_duration:10, max_duration:300}` |
| `Minimax-Music-2.6` | "Supports instrumental-only mode plus configurable bitrate and sample rate" | `{min_duration:10, max_duration:300}` |

None of the four declare a `bitrates`/`sample_rates` list (or any bitrate/sample-rate field at all),
the way `voices` or `min_duration`/`max_duration` are declared for other params. MiniMax's own hosted
API confirms the knob is real: `POST /v1/music_generation` takes an `audio_setting` object with
`sample_rate` (16000/24000/32000/44100), `bitrate` (32000/64000/128000/256000) and `format`
(mp3/wav/pcm) — see `platform.minimax.io/docs/api-reference/music-generation`.

**`minimax/music-3` is also missing `min_duration`/`max_duration`, unlike its siblings — but that one
is NOT a gap.** Independent third-party write-ups of MiniMax's real API confirm Music 3 has no duration
parameter at all (length is model-chosen; the same prompt+lyrics produced 35s–224s runs across 5 calls
in one published test). The empty `supported_parameters` correctly reflects that the model has nothing
else to expose yet, which is why nanoodle's Music node correctly does not show a Duration control for
`minimax/music-3` while showing one for `Minimax-Music-02/2.5/2.6`.

**Why it matters:** nanoodle's audio param UI is entirely catalog-driven (`supported_parameters` →
`audioApplies()`/`audioFields()` in `index.html`, mirrored in `play.html`) specifically so it never has
to hardcode a model name or guess a request shape. `lyrics`/`instrumental`/`negative_prompt`/`seed` are
sent as best-effort "all" pass-through keys because they're well-established across many providers and
harmless when unsupported (the provider just ignores the key). Bitrate/sample-rate don't fit that
pattern safely: the real wire shape is unknown from the catalog alone — MiniMax's own API nests it
under `audio_setting`, but NanoGPT's public `/api/v1/audio/speech` docs don't mention `audio_setting`,
`bitrate`, or `sample_rate` at all, and other integrators of the same models (Pika, AtlasCloud) forward
them as flat top-level keys instead of nested. Guessing wrong would not error — it would silently no-op
(exactly the failure mode worth avoiding): the user picks "256kbps / 44.1kHz" in nanoodle, the field
sends, NanoGPT/MiniMax ignores the misnamed/mis-shaped key, and the song renders at whatever the
model's default happens to be, with no error to tell the user their choice did nothing.

**Ask:** add a real `supported_parameters` entry for the MiniMax music family, e.g.

```json
"supported_parameters": {
  "sample_rates": [16000, 24000, 32000, 44100],
  "bitrates": [32000, 64000, 128000, 256000]
}
```

(naming to match whatever shape `/api/v1/audio/speech` actually forwards — flat `sample_rate`/`bitrate`
keys, or a nested `audio_setting` object). Once that lands, nanoodle can wire a `cat:*`-gated Quality
control the same way `cat:voices`/`cat:duration` already work — real options, real defaults, zero
guessing.

**Not fixed client-side.** Unlike the `language` gap this repo did fix (see the Speech node's Language
control, gated on `supported_parameters.language`), there is no live catalog signal here to gate on or
to read the correct key name from, and this task's scope excludes paid generate calls that could
otherwise confirm the wire shape. Shipping a guess risks the exact silent-no-op failure this note warns
about, so the Music node's Duration/Quality surface stays exactly as wide as the catalog currently
supports.
