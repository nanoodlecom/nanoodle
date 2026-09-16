# Feature request — model catalogs need real per-model `created` timestamps (audio stamped at response time, ~190 chat/image/video models on a 2024-01-01 sentinel)

**Endpoints:** `GET /api/v1/models` (chat), `GET /api/v1/image-models`, `GET /api/v1/video-models`,
`GET /api/v1/audio-models`
(sibling to `NANOGPT-audio-created-timestamp.md`, which documents the audio half of this — kept and
cross-linked; this note covers all four catalogs in one place)

**Summary:** every model in all four catalogs returns a `created` field (0 truly blank), but only
some of those values are real release/addition timestamps. Verified 2026-09-16 against the live
catalogs:

- **Audio (~89 models): all share one identical `created` stamp, and it moves with request time.**
  Every model reports the same value — approximately the moment the response was generated — so a
  second request minutes later returns a different, but again uniform, stamp. There is zero
  per-model recency data in the audio catalog.
- **Chat (~94 models), image (~84 models), video (~12 models): still on the `2024-01-01` sentinel**
  (`created: 1704067200`). The rest of each catalog carries distinct, plausible per-model timestamps,
  so the sentinel rows read as ancient under any `created`-desc sort regardless of when the model
  actually launched.

The other catalogs prove the field is meant to be real per-model data: on the same check, chat and
image carry well over a hundred distinct `created` values each, and video carries dozens. Audio is
the only catalog with no recency signal at all; the sentinel rows are the only stale pocket in the
other three.

**Why it matters:** any client that offers "sort by newest" (we default to it in nanoodle's model
picker) has nothing correct to sort on. Two failure modes, both user-visible:

1. Audio: with every `created` tied, a `created`-desc sort with a stable tiebreak falls back to
   catalog order — and the audio catalog's native order runs oldest-first within families
   (`Minimax-Music-02` before `-2.5` before `-2.6`, `mureka-v7.5` before `-v9`), so **old versions
   sit on top under "Newest"**.
2. Chat/image/video sentinels: genuinely new models stamped `2024-01-01` sort as the oldest in the
   catalog — the exact inverse of the truth. A user picking "Newest" never sees them.

In both cases the picker misleads precisely the user who cares most about what's new, and there is
no client-side signal that recovers the truth — unlike e.g. the prompt-cap gap
(`NANOGPT-prompt-length-metadata.md`), where the live 400 at least teaches the limit, a wrong
`created` never errors, so the client can never learn the right date by probing.

**Ask:**

1. **Audio:** populate `created` with each model's real addition/release timestamp, as the chat,
   image, and video catalogs already do for most models. (If backfill dates are unavailable for
   some ids, any monotonic addition-order value beats a uniform response-time stamp.)
2. **Chat / image / video:** replace the `2024-01-01` (`1704067200`) sentinels with real dates
   where known — roughly 94 chat, 84 image, and 12 video rows as of 2026-09-16. For models whose
   true date is genuinely unknown, prefer omitting the field (or `null`) over a sentinel that
   parses as a real date: clients treat a missing value as "unknown" but a sentinel as "ancient".

**Our workaround (client-side, shipping meanwhile):** for audio, when `created` ties we reverse the
catalog's native family order (the audio API lists older lines first and appends newer ones later)
and sort version-descending within a family — which surfaces late-added lines (Mureka v9.5, MiniMax
Music 3) above early ones under "Newest". For sentinel rows we treat `1704067200` as "date unknown"
rather than as January 2024. Both are heuristics that go stale the moment a model is added; real
per-model `created` stamps would delete them.
