<!-- Generated 2026-08-27 from a live nano-gpt /api/v1/video-models snapshot (153 models),
cross-referenced against index.html/play.html's video wiring (normVideo, NODE_TYPES.modelFilter,
modelHasImageRole/videoRefSpec, videoOptDefs/modeOK) and against the underlying providers' own API
docs (fal.ai, WaveSpeedAI, MiniMax platform docs) where the catalog itself couldn't be trusted. -->

# Video model launch audit — MiniMax H3 Max / Wan 3.0 Prime and neighbors (2026-08-27)

Investigation triggered by the MiniMax H3 Max (2026-08-27) and Wan 3.0 Prime (2026-08-24) launches.
Scope: can a user pick each model on the right node, do the advertised ports exist, does a run send
the payload the model actually needs — and where it can't, does the app fail loud (a note/omission)
or silently drop something billed.

## Verdicts

| Model | t2v/i2v/v2v routing | last-frame port | ref/multimodal ports | mode-select dead ends | Verdict |
|---|---|---|---|---|---|
| **`minimax/h3-max`** (MiniMax H3 Max) | correct — `text_to_video`+`image_to_video`, no `mode`, plain image/text routing | **was missing** — catalog hides `last_image` (day-one gap); fixed by extending the existing `minimax-h3` family fallback | N/A — no ref/video/audio capability advertised (`video_to_video:false`, `audio_input:false`); matches fal.ai: "Reference to video follows later this week" as of 2026-08-25 | N/A — no `mode` param | 🟡 **Fixed** — end-frame port was silently unreachable, now restored |
| **`alibaba/wan-3.0-prime`** (Wan 3.0 Prime) | correct — `text_to_video`+`image_to_video`+`video_to_video`, `mode` auto-detects | **was missing** — same day-one gap; fixed the same way | **multimodal refs (image+video+audio) exceed the current single-array ref-port design** — confirmed via WaveSpeedAI/fal.ai docs (`reference_video_urls`, `reference_audio_urls`, up to 10 images/5 videos/5 audio); not reachable today, and correctly stays OFF rather than mis-keyed (already-shipped `canRef` gate: no `reference_images`/`reference_image_urls`/`referenceImages` param, no ref-pricing keys) | `mode` offered `image-to-video`/`video-edit`/`video-extend`/`text-to-video` on every node regardless of whether that node actually had the matching port — fixed | 🟡 **Fixed** (end-frame + mode footguns); ⏸ **multimodal refs are a documented gap, not fixed** (see below) |
| `alibaba/wan-3.0/image-to-video` | correct | was missing (tags literally include `first-last-frame`); fixed alongside the above | N/A (t2v/refs live on the sibling `reference-to-video` id) | N/A | 🟡 Fixed |
| `alibaba/wan-3.0/text-to-video`, `alibaba/wan-3.0/reference-to-video` | correct | N/A — no image input at all / reference-mode-only, last-frame regex correctly excludes both | reference-to-video's refs have the same multimodal gap as Prime (image+video+audio) — same "stays OFF" verdict | N/A | ✅ Working as designed (reference-to-video gap tracked once, at Prime) |
| `bytedance/seedance-2.5`, `-turbo`, `-spicy` | correct | N/A — no last-frame capability advertised | `-2.5`/`-turbo` bill `video_reference_per_second_by_resolution` but never `included_reference_images`/`extra_reference_image` — the existing pricing-evidence heuristic doesn't fire, so refs stay OFF too (same "no reachable ref key" situation as Wan 3.0, tracked as a pre-existing dead-end in `docs/model-capability-coverage-audit.md`) | same `mode` dead-end class as Wan 3.0 Prime — **fixed by the same generic patch** (all three ship the identical 5-option `mode` shape) | 🟡 Fixed (mode footgun only; refs were already correctly inert, no change needed) |
| `lightricks/ltx-2.5/fast`, `/pro` | correct | N/A | N/A | N/A — no `mode` param | ✅ No issue found |
| `flux-3` (FLUX.3) | correct | N/A (uses `quality`/`mode`-free routing) | N/A | N/A — its `quality` param isn't a generation-type select, unaffected | ✅ No issue found |
| `wan-25-fast` (Wan 2.5 Fast) | correct | N/A — text+audio only, no image input | N/A | N/A | ✅ No issue found |

Legend: 🟡 fixed this pass · ✅ already correct · ⏸ verified gap, deliberately not built (see below).

## What was fixed

1. **`VIDEO_LAST_FRAME_FAMILIES`** (`index.html` + `play.html`) — extended the existing
   `minimax-h3`-only allowlist to also cover `minimax/h3-max`, `alibaba/wan-3.0-prime` and
   `alibaba/wan-3.0/image-to-video`. Without this, picking any of the three on the Image→Video node
   never grew the optional "end frame" port, even though all three advertise (and, per the
   underlying providers' own docs, actually support) a first/last-frame morph. See
   `docs/NANOGPT-video-last-frame-metadata.md` for the upstream ask and the evidence trail.

2. **`videoOptDefs`'s `modeOK` gate** (`index.html` only — play.html just replays whatever the editor
   already wrote to `modelOpts`, no runtime twin needed). Seedance 2.5 (all 3 variants) and Wan 3.0
   Prime all expose a generic `mode` select (`auto` / `text-to-video` / `image-to-video` /
   `video-edit` / `video-extend` / `reference-to-video`). The existing gate only excluded
   `reference-to-video` (no ref param) and `video-edit` (no video port on tvideo); `video-extend`
   (needs a source video, same as video-edit), `image-to-video` (needs a source image) and
   `text-to-video` (forcing it on a node that *always* sends an image/video as the primary input)
   were offered on every node regardless of whether it could actually feed them. Concretely, before
   the fix: a Text→Video node offered "Image to video" with no image port to wire, and an Image→Video
   node offered "Text to video" — which, if picked, tells the model to ignore the image the run just
   paid to send. Both are silent-drop risks, not just confusing decoys. The fix gates each option on
   the node's own declared input shape (`modelFilter` t2v/i2v/v2v), catalog-driven, no model names.

Both fixes are covered by new offline checks (`scripts/check-video-image-roles.mjs`,
`scripts/check-video-mode-gate.mjs`), wired into `.githooks/pre-commit` and the CI check suite.

## What was investigated and left alone

- **Wan 3.0 Prime / reference-to-video's multimodal references (image+video+audio).** The
  provider-side contract (confirmed via WaveSpeedAI's and kie.ai's Wan 3.0 docs) wants separate
  `reference_image_urls` (≤10), `reference_video_urls` (≤5, ≤15s total) and `reference_audio_urls`
  (≤5, ≤15s total) arrays — mutually exclusive with the first/last-frame pair. Nanoodle's only
  reference-port mechanism (`ref1`, `ref2`, … on `tvideo`/`vedit`) is a single image-only array bound
  to one param key (`videoRefSpec`). There is no video-reference or audio-reference port anywhere in
  either the editor or the exported runtime — the only "video" port sends a single primary source
  clip (`vedit`'s `video` input, one clip, not a reference list), and the only "audio" port on a video
  node is Soundtrack's post-hoc mux, not a model input. Building this out (multi-type, multi-array
  reference ports, each keyed to the provider's real param name) is a real feature, not a wiring fix,
  and it was already flagged as an explicit, deliberate dead-end in
  `docs/model-capability-coverage-audit.md` ("reference-to-video (reference_images/videos/audios, ~12
  models) — … no safe interim") before either launch. **Left as-is**: the existing `canRef` gate
  already keeps the mode/port correctly hidden rather than mis-keying a reference into the wrong
  field, so nothing is silently dropped today — the capability is simply unreachable, and stays that
  way until a real multi-port design lands.
- **Seedance 2.5's own reference/video-edit/video-extend capabilities** — same story as Wan 3.0: its
  pricing bills `video_reference_per_second_by_resolution` (proof the capability is real) but never
  the `included_reference_images`/`extra_reference_image` keys the existing pricing-evidence heuristic
  checks for, so refs correctly stay OFF rather than being guessed at.
  `video-edit`/`video-extend` mode values ride on the *existing* `vedit` node's video port + refs
  mechanism, which was already correct — only the `mode` dropdown's OWN gating needed the fix above.
- **Native audio on audio-generating video models** — already fixed (`docs/model-capability-coverage-audit.md`
  rank #4, PR #50): previews unmute when `capabilities.audio_generation` is true. Verified still true
  for `alibaba/wan-3.0-prime`/Seedance 2.5 (`audio_generation:true` for both) and for `wan-25-fast`.
- **Length/aspect/resolution honoring** — all three focus-family entries expose real
  `duration`/`resolution`/`aspect_ratio` selects that `videoDimParams`/`dimDefs` already read live off
  the catalog (rank #5 of the same audit, PR #53) — no hardcoded defaults found for any of them.

## Method

- `GET /api/v1/video-models` (public, no key) fetched 2026-08-27, 153 models.
- Existing wiring traced in `index.html`/`play.html`: `normVideo`, `NODE_TYPES.{tvideo,ivideo,vedit}`,
  `modelHasImageRole`/`videoRefSpec` (last-frame + ref-image ports), `videoOptDefs`/`modeOK`
  (per-node generation-type gating).
- Where the nano-gpt catalog's own metadata was silent (last-frame support for the 3 new ids), cross-
  checked the underlying provider's own public API docs (fal.ai, WaveSpeedAI, kie.ai, MiniMax
  platform docs) rather than trust prose or make a live paid call.
- No secrets, no paid generate calls — catalog GET only, plus public documentation lookups.
