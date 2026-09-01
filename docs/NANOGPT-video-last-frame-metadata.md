# Feature request — new video launches keep shipping without `last_image`/`end_image` in `supported_parameters`

**Endpoint:** `GET /api/v1/video-models`

**Summary:** at least three video ids have gone live advertising first/last-frame support in their
`name`/`description`/`tags`, while `supported_parameters.parameters` lists only the dimension/seed
knobs (duration, resolution, aspect_ratio, thinking_mode, seed, …) — no `last_image` or `end_image`
key at all:

| id | catalog says (description/tags) | `supported_parameters` actually lists |
|---|---|---|
| `minimax-h3` | "…text-to-video, image animation, first/last-frame transitions, and multimodal reference guidance…" | `duration`, `aspect_ratio` |
| `minimax/h3-max` | "…from a text prompt or a first-frame image, with optional first/last-frame transitions." | `duration`, `resolution`, `aspect_ratio`, `prompt_expansion_mode`, `enable_safety_checker`, `seed` |
| `alibaba/wan-3.0-prime` | "Automatically routes text, first/last-frame images, or multimodal image, video, and audio references…" | `mode`, `resolution`, `aspect_ratio`, `duration`, `thinking_mode`, `enable_audio`, `seed` |
| `alibaba/wan-3.0/image-to-video` (sibling, non-Prime) | description: "…with optional last-frame guidance…"; **tags include `first-last-frame`** | `resolution`, `aspect_ratio`, `duration`, `thinking_mode`, `enable_audio`, `seed` |
| `google/gemini-omni-flash` | marketing `/api/models` omits `supportsLastImage`; video-models tags have no `first-last-frame` (hypothesis: same family gap as v1.1) | `duration`, `aspect_ratio` |
| `google/gemini-omni-flash/v1.1` | description: "image animation with optional end frames"; **tags include `first-last-frame`**; marketing `supportsLastImage: true` | `duration`, `resolution`, `aspect_ratio` |

`minimax-h3`'s gap was closed client-side by live-testing the field (2026-07-31: sending `last_image`
on an unlisted-param request morphed first→last as documented). We can't repeat that live probe for
the three newer ids without spending real credits mid-audit, so instead we cross-checked the
**underlying providers' own API docs**, which nano-gpt appears to proxy directly:

- fal.ai's `minimax-h3-max` page states the `image-to-video` endpoint "also handles first-to-last
  keyframes through an **optional `end_image_url`**" (checked 2026-08-27).
- fal.ai `alibaba/wan-3.0-prime/image-to-video`: `start_image_url` (required) + **`end_image_url`**
  (optional, "Last frame of the generated video. Requires `start_image_url`.").
- WaveSpeedAI `alibaba/wan-3.0-prime/image-to-video`: `image` (first frame, required) + **`last_image`**
  (optional, "guide the ending of the video").

We've shipped a client-side family-fallback (a hand-kept allowlist of exact ids, same mechanism
already used for `minimax-h3`) so the end-frame port keeps working for these ids — but every new
launch repeats the same investigation from scratch, and a wrong guess here either hides a real
capability (no port drawn) or risks an unverified param on someone's paid request. A one-line catalog
fix removes both risks. Omni 1.1's evidence is the marketing `supportsLastImage` flag plus the
`first-last-frame` tag (2026-09-01 catalog GET); v1 is included as the unversioned family pair.

**Ask:** when `supported_parameters` is generated from the upstream provider schema, either forward
the provider's own optional frame/keyframe params under nano-gpt's existing `last_image`/`end_image`
convention, or add them post-hoc for ids whose description/tags already promise the capability.

**Our workaround (client-side, shipping meanwhile):** `VIDEO_LAST_FRAME_FAMILIES` in `index.html` /
`play.html` — an exact-id allowlist checked only when the param isn't in `supported_parameters`.
Drop each id from the allowlist the moment its catalog entry lists `last_image`/`end_image` for real.
