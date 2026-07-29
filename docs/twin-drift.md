# Twin drift: the index.html ↔ play.html extraction map

Date: 2026-07-28. Measured at commit `dbd4543`.

## The measurement

`index.html` is 12,493 lines. `play.html` is 13,639 lines. They are the two engine surfaces:

- `index.html` — the editor. It may load files from `vendor/`.
- `play.html` — the app player and the single-file `.html` export. It must stay 1 self-contained file.

**696 distinct lines longer than 40 characters appear byte-identically in both files.** They occur
749 times in `index.html` and 771 times in `play.html`. The generated `<script id="njs-engine">`
bundle and the probe-written `PROMPT-CAPS` table are excluded from that count, so the number is
hand-maintained duplication only.

Reproduce the number:

```sh
node scripts/check-twin-drift.mjs
```

496 of the 696 lines sit in 90 contiguous blocks of 4 lines or more. The other 200 are scattered
single lines and pairs. This document ranks the blocks.

## The guard

`scripts/check-twin-drift.mjs` pins the shared set against `scripts/twin-drift-baseline.json`.

- It **fails** when a shared line leaves the set because 1 surface moved and the other did not. It
  prints both `file:line` positions and the 2 versions of the line.
- It **fails** when the shared-line count goes up.
- It **passes** on extraction. A line that disappears from a surface with no near-identical
  replacement is deduplication, which is always allowed.
- It **passes** on a correctly mirrored edit. Both surfaces change together, the count holds, and
  the guard asks for a baseline refresh in a note.

Refresh the baseline deliberately:

```sh
TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs
```

The pre-commit hook runs the guard when `index.html`, `play.html`, the guard, or the baseline is
staged.

## Why extraction is hard here

Both surfaces run the nanoodle-js bundle **behind a flag**. `njsOn()` reads `?engine=js`,
`?engine=play` and `localStorage.njs_engine`. When the flag is off, or before the bundle arrives,
both engines fall back to their built-in copies:

- `index.html:8207` appends `vendor/njs-engine.js` **asynchronously**, and only when the flag is on.
  `index.html:8188-8193` states the contract: until the bundle loads, `njsRunFor()` returns null and
  the built-in runners execute.
- `play.html` embeds the bundle inline, but `play.html:11238-11241` copies it into an export only
  when the script element carries text.

So the built-in copy on each surface is a **live fallback path**, not dead code. You cannot delete a
duplicated block until one of these is true:

1. `index.html` loads the bundle unconditionally and waits for it before the first run, or
2. the block is moved into the bundle **and** the flag stops gating it.

Both are architecture decisions with a first-paint cost. Neither belongs in a drive-by refactor.

Local media is a second constraint. `index.html:8188` and `play.html:7947` both say local media nodes
keep the canvas and Web Audio paths, because a browser has no ffmpeg fallback. The library's
`local-media.mjs` therefore does not drive the Combine, Resize, Extract-frames or Trim nodes on
either surface today.

## Ranked blocks

`sig` is the number of shared lines longer than 40 characters in the block. Line ranges are from
commit `dbd4543`.

### 1. MP4CAT lossless mp4 remux — sig 125

- `index.html:9099-9376`
- `play.html:6657-6934`

The Combine node copies compressed H.264 and AAC samples onto 1 timeline. It is the largest single
duplicated block in the repo, and it is duplicated 3 times: both surfaces plus
`nanoodle-js/src/mp4cat.mjs`, which the bundle already carries as a dependency of `local-media.mjs`.

**Verdict: extractable, but not in 1 PR.** `browser.mjs` does not re-export `MP4CAT`, so
`window.NanoodleEngine.MP4CAT` is undefined today. The work is:

1. nanoodle-js: add `export { MP4CAT } from "./mp4cat.mjs";` to `src/browser.mjs`. 1 line.
2. nanoodle: regenerate the bundle and `vendor/njs-engine.js` with `node scripts/gen-js-engine.mjs`.
3. nanoodle: make `index.html` load the bundle unconditionally, or keep a local fallback for the
   flag-off path. This is the blocking decision.
4. Delete both hand copies. `scripts/check-combine.mjs` must then run the library copy against the
   same `scripts/fixtures/clip[AB].mp4` fixtures, so the test value is not lost.

Removing this block alone drops the baseline from 696 to 573. That is 18% of the duplication in
1 move.

### 2. Pricing resolver — sig 66

- `index.html:5537-5681` (`pickByRes`, `pickObjByRes`, `videoUnitUsd`, `genericScanUsd`,
  `audioUnitUsd`, the `per_duration` and `referenceToVideoPrices` branches)
- `play.html:5910-6039`

Every NanoGPT price shape maps to 1 USD number here. It feeds the picker prices and the
"~$X to run" chip.

**Verdict: extractable, and a third copy already exists.** `nanoodle-js/src/estimate.mjs` carries
the same `pickByRes` / `pickObjByRes` / `videoUnitUsd` / `genericScanUsd` / `audioUnitUsd`, but
`src/index.mjs` exports it and `src/browser.mjs` does not. The module is therefore **absent from the
browser bundle**. Add it to `browser.mjs`, regenerate, then route both surfaces at it. The same
flag-off blocker as block 1 applies.

`scripts/check-pricing.mjs` already runs both engine copies over `scripts/pricing-fixtures.json`.
Point it at the library copy when the hand copies go.

### 3. Local media helpers, not MP4CAT — sig 76

- `index.html:8995-9070` (`encodeWavMono`, `seekVideo`, `mediaFetchError`, WAV header writes)
- `index.html:9378-9640` (`pickVideoMime`, `loadVideoMeta`, `concatViaRecorder`, the MediaRecorder
  and AudioContext fallback path, async audio polling)
- `play.html:6497-6660` and `play.html:6960-7150`

The MediaRecorder fallback runs when the clips are not matching mp4s.

**Verdict: partly covered, partly surface-specific.** `browser.mjs` already exports `encodeWavMono`.
The MediaRecorder and AudioContext path is not in the library at all, because the library's
`local-media.mjs` uses ffmpeg for that case in Node. Extract `encodeWavMono` and `loadVideoMeta`
first. The recorder path needs a new library module before it can move.

### 4. NanoGPT client, built-in runner fallback — sig 60

- `index.html:8530-8870` (`b64ImageMime`, `normalizeLoraUrl`, `nodeLoras`, `genImage`, `genVideo`,
  the chat body build, audio content-type repair, blob size guards)
- `play.html:6160-6480`

**Verdict: already covered by the bundle path — do not extract again.** This is exactly the surface
`scripts/check-js-parity.mjs`, `scripts/check-njs-delegation.mjs` and
`scripts/check-njs-editor-delegation.mjs` lock against the library. These lines are the
flag-off fallback that the delegation design deliberately keeps. They disappear when the flag
disappears, not before.

### 5. Vision, LLM and frame-extraction node bodies — sig 53

- `index.html:4345-4358` (`audioInputPart`), `5181-5189`, `5380-5389` (chat sampling options),
  `6024-6100` (message assembly, the 4 MB reference-image guard), `6183-6212` (Vision node),
  `6316-6344` (Extract-frames stepping), `7165-7183` (`maskToSource`)
- `play.html:7216-7224`, `7301-7319`, `7418-7518`, `7583-7608`, `6138-6147`, `7277-7290`

**Verdict: mixed.** `maskToSource` is already exported from `browser.mjs` — extract it now, it is
the cheapest win in the whole list. The message-assembly lines belong to block 4's delegation
surface. The Extract-frames stepping is local media and needs a library module first.

### 6. njs delegation shim — sig 27

- `index.html:8117-8124` (`topoOrder`), `8198-8206` (`NJS_TYPES`), `8254-8329`, `8418-8424`
  (`fieldOverrides`)
- `play.html:7749-7756`, `7953-8060`, `8126-8132`

**Verdict: deliberate twin. Leave it.** `index.html:8182-8196` names it "Twin of play.html's Phase-E
shim". `scripts/check-njs-editor-delegation.mjs` exists to hold the 2 copies byte-identical. Note
that `topoSort` and `MAX_FRAMES` are already exported from `browser.mjs`, so `topoOrder` could go if
the shim ever collapses.

### 7. Resize and crop geometry — sig 25

- `index.html:6882-6942` (`resizePlan`, `resizeCropImage`, the aspect derivation)
- `play.html:7323-7358` and `play.html:8803-8817`

**Verdict: extractable, blocked only by the flag.** `browser.mjs` already exports `resizePlan` and
`resizeCropImage`. `scripts/check-resize-plan.mjs` already proves the 2 hand copies agree with each
other. This block is the safest candidate after MP4CAT, because the library copy is exported and
tested today.

### 8. Share and shorten chrome, plus `<head>` metadata — sig 23

- `index.html:8-31` (og and twitter cards), `index.html:1072-1129` (`sm-urlrow`, `sm-social`, the
  da.gd button)
- `play.html:8-31`, `play.html:467-519`

**Verdict: genuinely surface-specific. Leave it.** This is HTML markup, not engine code. The 2 pages
are separate documents with separate CSP paths (see `_headers`). A build step that templated the
head would break the "1 self-contained file" property of the export. The guard still protects it:
an og-card change on 1 page only now fails the commit, which is the correct outcome.

### 9. OAuth PKCE login — sig 15

- `index.html:11667-11704`
- `play.html:10352-10486`

**Verdict: extractable in principle, low priority.** The library has no auth module.
`scripts/check-login-state.mjs` already replays a sign-in round-trip on both files. The exported app
also runs this code from `file://`, where OAuth does not work, so any move must keep the
paste-key path intact.

### 10. i18n `translateTree` and `withLocale` — sig 12

- `index.html:3779-3814`
- `play.html:5671-5721`

**Verdict: surface-specific for now.** The editor localizes its own chrome; exported apps ship
English-only chrome plus the app-player chrome. `scripts/check-i18n-coverage.mjs` covers the maps.
The 2 helper functions could move to a shared module, but the payoff is 12 lines.

### 11. Prompt-cap helpers — sig 8

- `index.html:4169-4219` (`learnPromptCap`, `fitPromptText`, `promptCapFromError`)
- `play.html:7861-7910`

**Verdict: extractable, and the library copy is already in the bundle.**
`nanoodle-js/src/prompt-caps.mjs` exports `fitPromptText`, `promptCapFromError` and
`learnPromptCap`, and the bundle carries the module. `browser.mjs` does not re-export them. Add the
re-export, then route both surfaces at it. The generated `PROMPT-CAPS` table itself is already
excluded from the drift count, because `scripts/probe-prompt-caps.mjs` writes it into both files.

### 12. Small shared helpers — sig 6

- `index.html:4018-4023` (`verParts` version compare), `index.html:9634-9639` (`isLowFundsError`)
- `play.html:8542-8547`, `play.html:5752-5757`

**Verdict: leave them.** 6 lines. The guard is cheaper than the extraction.

## The work list, in order

| # | Block | sig | Baseline after | Blocker |
|---|-------|-----|----------------|---------|
| 1 | Resize and crop geometry | 25 | 671 | flag-off fallback only |
| 2 | `maskToSource` and `encodeWavMono` | ~10 | 661 | flag-off fallback only |
| 3 | Prompt-cap helpers | 8 | 653 | 1-line `browser.mjs` re-export |
| 4 | Pricing resolver | 66 | 587 | `estimate.mjs` not in the browser bundle |
| 5 | MP4CAT | 125 | 462 | `MP4CAT` not re-exported; `check-combine.mjs` must move |
| 6 | Local media recorder path | ~50 | 412 | needs a new library module |

Items 1 to 5 all sit behind the same decision: **does `index.html` load
`vendor/njs-engine.js` unconditionally, and does the built-in fallback survive?** Answer that once
and 234 of the 696 shared lines become deletable.

Blocks 4, 6, 8 and 10 are not on the list. They are covered by the delegation design or genuinely
belong to 2 separate documents.

## What was not done in this PR

The largest block was **not** extracted. Deleting the MP4CAT hand copies today would break
`?engine=play` and every run that starts before `vendor/njs-engine.js` arrives. The guard and this
map ship first, so the number is measured and cannot grow while the decision is pending.
