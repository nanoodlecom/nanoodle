# NanoGPT: `instructions` on /api/v1/audio/speech — most TTS models ignore it; two BREAK on it

**Status: open — reported 2026-07-17, full 25-model sweep 2026-07-17.**

The speech endpoint documents an `instructions` body param ("Voice/style instructions
(supported by some models/providers)"), but the catalog gives no way to tell WHICH
models support it. Measured behavior across every TTS model in the catalog:

## Method

Same input text ("Hello there, how are you doing on this fine day?"), first catalog
voice, opposite instructions — "speak extremely slowly, whispering, with long
dramatic pauses" vs "speak as fast as you possibly can" — compare output durations.
Borderline models re-run twice more.

## Results (2026-07-17)

| verdict | models | evidence |
|---|---|---|
| **follows** | gemini-2.5-flash-preview-tts | 18.29s vs 2.05s (8.9×) |
| **follows** | gemini-2.5-pro-preview-tts | 8.49s vs 2.53s (3.4×) |
| **follows** | gpt-4o-mini-tts (+ 2025-03-20, 2025-12-15 variants) | 1.65×–4.3× |
| **weakly follows** | Minimax-Speech-02-HD | 1.19×–1.32× slow>fast in 3/3 runs (the only Minimax that reacts) |
| **keyword-only** | Omnivoice | `instructions:"whisper"` completes; free text ("warm and cheerful", "speak very slowly") FAILS the whole job: "Unsupported instruct items found" |
| **BREAKS** | gemini-3.1-flash-tts-preview | 200 + audio without instructions; **502 "OpenRouter Gemini TTS returned no audio data" every time instructions are sent** (3/3) |
| **ignores** | xai-tts, Minimax 2.6/2.8 HD+Turbo, inworld realtime-tts-2 / 1.5-max / 1.5-mini, bytedance/seed-speech-tts-2.0, microsoft/vibevoice, microsoft/mai-voice-2, Kokoro-82m, Elevenlabs-Turbo-V2.5, Elevenlabs-V3, Qwen-3-TTS-1.7B, tts-1, tts-1-hd | ratios 0.8–1.1 across runs (variance band); Qwen byte-different but duration-identical (runIds 019f7296-2af6-7883-a088-156981344601 / 019f7296-37f7-7342-a9bb-b9b01bceb2db) |

## Asks

1. **gemini-3.1-flash-tts-preview: strip or map `instructions` instead of 502ing.**
   A documented optional param hard-failing the request (after the older 2.5 Gemini
   TTS models honor it beautifully) is the worst possible shape for clients.
2. **Omnivoice: surface its supported instruct-item vocabulary** (or accept free text
   and drop what it can't parse) — free-text instructions currently fail the job.
3. **Expose instructions support in the audio catalog**, e.g.
   `supported_parameters.instructions: true|false|"keywords"` — nanoodle's params UI
   is metadata-driven (no hardcoded model names), so with that flag we could show
   the Instructions field only where it works instead of hinting "most models
   ignore this".
4. Where a provider has a native style mechanism (ElevenLabs V3 audio tags, Minimax
   emotion), consider mapping `instructions` onto it server-side.

## nanoodle-side mitigation (shipped)

The Speech node's Instructions hint now names the models that listen
(gpt-4o-mini-tts & Gemini 2.5 TTS) and says most others ignore it. Remove the hedge
and gate the field per-model once the catalog advertises support (grep `cat:` in
index.html → audioApplies()). NOT yet mitigated: sending instructions to
gemini-3.1-flash-tts-preview 502s and to Omnivoice fails the job — needs either the
catalog flag (ask 3) or an upstream fix (asks 1–2).
