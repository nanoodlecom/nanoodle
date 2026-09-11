# Feature request — audio-models catalog has no recency signal (`created` is stamped at response time)

**Endpoint:** `GET /api/v1/audio-models`

**Summary:** every model in the audio catalog returns the **same** `created` value, and that value
is the time of the request, not the model's release date. Verified 2026-07-05: all 78 models
reported `created: 1783314578` (≈ the moment the response was generated); a second request minutes
later returns a different — but again uniform — stamp.

The other catalogs carry real per-model timestamps (same-day check: chat 175 distinct values across
603 models, image 56/203, video 75/136). Audio is the only one with zero recency data.

**Why it matters:** any client that offers "sort by newest" (we default to it in nanoodle's model
picker) has nothing to sort on for music/speech/SFX. Worse, the catalog's native order runs
oldest-first within families — `Minimax-Music-02` before `-2.5` before `-2.6`,
`mureka-v7.5` before `-v9` — so a `created`-desc sort with a stable tiebreak shows **old versions on
top under "Newest"**.

**Ask:** populate `created` with the model's real addition/release timestamp (as the chat, image and
video catalogs already do).

**Our workaround (client-side, shipping meanwhile):** when `created` ties, reverse the catalog's
native family order (the audio API lists older lines first and appends newer ones later) and sort
version-descending within a family. That surfaces late-added lines (Mureka v9.5, MiniMax Music 3)
above early ones under "Newest". Real per-model `created` stamps would still be better.
