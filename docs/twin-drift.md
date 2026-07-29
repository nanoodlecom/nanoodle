# Twin drift: the index.html ↔ play.html extraction map

Date: 2026-07-28. Measured at commit `dbd4543`.

## The measurement

`index.html` is 12,493 lines. `play.html` is 13,639 lines. They are the two engine surfaces:

- `index.html` — the editor. It may load files from `vendor/`.
- `play.html` — the app player and the single-file `.html` export. It must stay 1 self-contained file.

**893 distinct lines longer than 40 characters appear byte-identically in both files.** They occur
957 times in `index.html` and 1,011 times in `play.html`. The generated `<script id="njs-engine">`
bundle, the probe-written `PROMPT-CAPS` table, the generated i18n maps and the Runware AIR table are
excluded from that count, so the number is hand-maintained duplication only.

Reproduce every number in this section:

```sh
TWIN_DRIFT_STATS=1 node scripts/check-twin-drift.mjs
```

538 of the 893 lines sit in 87 contiguous blocks of 4 lines or more, counted on `index.html` line
numbers with at most 1 non-shared line inside a block. The other 355 are scattered single lines and
pairs. This document ranks 16 of the 87 blocks.

### What this map does NOT cover

The ranked list below is a map, not an exhaustive partition. Read it that way.

- **16 of 87 blocks are ranked.** The other 71 blocks and all 355 scattered lines are guarded by
  `check-twin-drift.mjs` exactly like the ranked ones, but this document does not give them a
  verdict.
- **A twin can fall between 2 block ranges and be in neither block's `sig` count.** `seekVideo`
  (`index.html:8995`, `play.html:6639`) is the known example: it sits between the range of block 3
  and the range of block 12, so no ranked block counts it. The guard still holds it, because the
  guard works on the whole shared set and not on this document's blocks.
- **The deliberately per-page `<head>` lines are guarded by nothing.** `og:title`, `og:description`,
  `og:url`, `twitter:title` and `twitter:description` differ per page on purpose, so they were never
  in the shared set, so no whole-file twin guard can cover them. No other check covers them either.
  Block 10 says this again in place.

### How the generated bundle is identified

The bundle must be excluded, and finding it is not as simple as it looks. `play.html` also holds the
export builder's **string literal** for the same tag:

```js
const engTag = engText ? '<script id="njs-engine">\n' + engText.replace(/<\/script/gi, "<\\/script") …
```

Every `</script` inside `RUNTIME_JS` is written escaped, so a lazy
`/<script id="njs-engine"[\s\S]*?<\/script>/` that starts on that literal does not close until the
last real `</script>` in the file. That match blanked `play.html:11240-13637`: 2,398 lines, 17.6% of
the file, all of it hand-written player code. 197 shared lines were invisible while it did.

The guard therefore matches `<script id="njs-engine" data-hash="…">` and **re-derives the hash**.
`scripts/gen-js-engine.mjs:165` writes `data-hash = sha256(bundle).slice(0,16)`. A quoted string
inside `RUNTIME_JS` cannot forge a body that hashes to its own declared hash. The other 3 generated
regions carry unique `BEGIN`/`END` comment markers and appear at most once per file.

## The guard

`scripts/check-twin-drift.mjs` pins the shared set against `scripts/twin-drift-baseline.json`.

It **fails** on:

- **Drift.** A shared line left the set because 1 surface edited it and the other did not. The guard
  prints both `file:line` positions and the 2 versions of the line.
- **One-sided deletion.** A shared line is gone from 1 surface, nothing near-identical replaced it,
  and the line is still live on the other surface. The code did not move. 1 engine stopped doing the
  work and the other still does it.
- **Occurrence drift.** A shared line lost a copy on 1 surface only. 74 of the 893 lines appear more
  than once inside a surface (28 in `index.html`, 65 in `play.html`), so presence alone is not
  enough: editing 1 of 2 identical copies leaves the hash present. The baseline stores the
  per-surface count of every line.
- **Growth.** The distinct shared-line count went up, or a shared line gained a copy.

It **passes** on:

- **Extraction.** A line that left BOTH hand-maintained surfaces. The baseline stores hashes and not
  text, so a line gone from both surfaces cannot be told apart from the old half of a mirrored edit.
  The note names both readings instead of guessing. When the generated bundle carries the same text,
  the note says so, because then "extracted into the library" is the reading.
- **A correctly mirrored edit.** Both surfaces change together, the count holds, and the guard asks
  for a baseline refresh in a note.

**There is no other exemption.** A line still live on 1 surface always fails, and it fails even when
the generated bundle happens to carry the same text. That last clause is load-bearing. An earlier
version of the guard read "the text is somewhere inside the bundle" as proof of extraction. It is
not: **131 of the 893 baseline lines are byte-identical to a line already inside the bundle while
both hand copies are still live**, because the library ships MP4CAT, the pricing resolver and the
resize geometry too. Under that rule a one-sided deletion of live MP4CAT code
(`play.html:6850`, `const totalTicks = t.samples.reduce((a,s)=>a+s.dur, 0);`) exited 0 with a
"moved into the generated bundle" note, so the one-sided-deletion rule was off on 15% of the guarded
set. Presence in the bundle now only picks the wording of a note on a line that already left both
surfaces. Count the 131 for yourself:

```sh
TWIN_DRIFT_STATS=1 node scripts/check-twin-drift.mjs
```

Refresh the baseline deliberately:

```sh
TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs
```

The count is a ratchet, and the ratchet number is **derived from the baseline `lines` array**, never
read from the `count:` field. The stored digest hashes `lines` only, so a hand-raised `count:` would
otherwise lift the ratchet with no digest mismatch. The `count`, `occurrencesIndexHtml` and
`occurrencesPlayHtml` fields stay in the JSON for a human reader, and the guard fails if any of them
stops describing `lines`.

The pre-commit hook runs the guard when `index.html`, `play.html`, the guard, or the baseline is
staged.

### Runtime

Offline, no network, no API spend.

The cost that matters is the drift classifier: for every baseline line that left the shared set it
scores the departing text against every candidate line of the surface that moved. `MAX_CLASSIFY`
caps that work at 200 departures; at 201 the guard reports totals instead, so the run is always
bounded. The ceiling is not free, and a normal commit never reaches it. Measured on the review
machine, which held a load average of 25 to 34 throughout:

| Case | Wall clock | CPU time |
|------|------------|----------|
| Clean tree, nothing departs | 0.9 s (0.2 s on a quiet machine) | 0.5-0.6 s |
| 200 departures, the `MAX_CLASSIFY` ceiling | 3.5-5.7 s, fastest run 1.5 s | 3.1-4.9 s |
| 200 departures, before the candidate index | 23-30 s | 22-27 s |

The first version of the guard rebuilt the bigram profile of every candidate line on every call.
That is where the 23-30 s came from, while the header claimed "well under 2 seconds" and the hook
claimed "~0.2s". The candidate index builds each profile once and binary-searches the length band.
The classification output is byte-identical before and after the change.

Reproduce the clean-tree figure:

```sh
time node scripts/check-twin-drift.mjs
```

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

`sig` is the number of distinct shared lines longer than 40 characters that have a hit inside the
`index.html` range **and** a hit inside the paired `play.html` range. Line ranges are from commit
`dbd4543`. "Baseline after" is the 893 count minus the lines whose every occurrence, on both
surfaces, sits inside the block.

### 1. Share packer, share card and shorteners — sig 140

- `index.html:10614-10930` (`shrinkShareMedia`, `packShareFit`, `buildShareUrl`, `drawShareCard`,
  `shareCardB64`, `shortenWith`, `socLinks`, `setShareUrl`, `syncShortenButtons`, `openShareMenu`)
- `play.html:12804-13123`

This block was invisible until the region detection was fixed, and it is now the largest single
duplicated block in the repo. The code itself says so: `index.html:10616` and `index.html:10651`
both end a header comment with "(Twin of play.html's.)".

**Verdict: extractable, and nothing in the library covers it yet.** `nanoodle-js/src/share.mjs`
exports `isShareRef`, `decodeShareFragment` and `decodeShareUrl` — it **decodes** share links and
does not pack them. The 2 hand copies are the only packer that exists.
`scripts/check-share-link.mjs` already lifts `packShareFit` out of both files as text and runs it, so
that 1 function is pinned. The card drawing, the shortener client and the button-state logic had no
guard at all before this one. The work is a new `share-pack.mjs` in nanoodle-js, then the same
flag-off decision as block 2.

### 2. MP4CAT lossless mp4 remux — sig 123

- `index.html:9099-9376`
- `play.html:6657-6934`

The Combine node copies compressed H.264 and AAC samples onto 1 timeline. It is duplicated 3 times:
both surfaces plus `nanoodle-js/src/mp4cat.mjs`, which the bundle already carries as a dependency of
`local-media.mjs`.

**Verdict: extractable, but not in 1 PR.** `browser.mjs` does not re-export `MP4CAT`, so
`window.NanoodleEngine.MP4CAT` is undefined today. The work is:

1. nanoodle-js: add `export { MP4CAT } from "./mp4cat.mjs";` to `src/browser.mjs`. 1 line.
2. nanoodle: regenerate the bundle and `vendor/njs-engine.js` with `node scripts/gen-js-engine.mjs`.
3. nanoodle: make `index.html` load the bundle unconditionally, or keep a local fallback for the
   flag-off path. This is the blocking decision.
4. Delete both hand copies. `scripts/check-combine.mjs` must then run the library copy against the
   same `scripts/fixtures/clip[AB].mp4` fixtures, so the test value is not lost.

Removing this block alone drops the baseline from 893 to 770. That is 14% of the duplication in
1 move.

### 3. Local media: the MediaRecorder fallback — sig 64

- `index.html:9378-9630` (`pickVideoMime`, `loadVideoMeta`, `concatViaRecorder`, the MediaRecorder
  and AudioContext fallback path, async audio polling)
- `play.html:6616-6660` and `play.html:6960-7150`

The MediaRecorder fallback runs when the clips are not matching mp4s.

**Verdict: needs a new library module first.** This path is not in nanoodle-js at all, because the
library's `local-media.mjs` uses ffmpeg for the same case in Node. A browser has no ffmpeg, so the
library needs a browser-only recorder module before either hand copy can go.

### 4. NanoGPT client, built-in runner fallback — sig 81

- `index.html:8530-8870` (`b64ImageMime`, `normalizeLoraUrl`, `nodeLoras`, `genImage`, `genVideo`,
  the chat body build, audio content-type repair, blob size guards)
- `play.html:6160-6480`

**Verdict: already covered by the bundle path — do not extract again.** This is exactly the surface
`scripts/check-js-parity.mjs`, `scripts/check-njs-delegation.mjs` and
`scripts/check-njs-editor-delegation.mjs` lock against the library. These lines are the
flag-off fallback that the delegation design deliberately keeps. They disappear when the flag
disappears, not before.

### 5. Pricing resolver — sig 68

- `index.html:5537-5681` (`pickByRes`, `pickObjByRes`, `videoUnitUsd`, `genericScanUsd`,
  `audioUnitUsd`, the `per_duration` and `referenceToVideoPrices` branches)
- `play.html:5910-6039`

Every NanoGPT price shape maps to 1 USD number here. It feeds the picker prices and the
"~$X to run" chip.

**Verdict: extractable, and a third copy already exists.** `nanoodle-js/src/estimate.mjs` carries
the same `pickByRes` / `pickObjByRes` / `videoUnitUsd` / `genericScanUsd` / `audioUnitUsd`, but
`src/index.mjs` exports it and `src/browser.mjs` does not. The module is therefore **absent from the
browser bundle**. Add it to `browser.mjs`, regenerate, then route both surfaces at it. The same
flag-off blocker as block 2 applies.

`scripts/check-pricing.mjs` already runs both engine copies over `scripts/pricing-fixtures.json`.
Point it at the library copy when the hand copies go.

Note that `if(raw[k]){ v=pickByRes(raw[k], res, defRes); if(v!=null) return v*dur; }` appears **twice**
inside `index.html` (5630 and 5639). It is 1 of the 74 lines that need the occurrence count, not just
presence, to stay protected.

### 6. Vision, LLM and frame-extraction node bodies — sig 54

- `index.html:4345-4358` (`audioInputPart`), `5181-5189`, `5380-5389` (chat sampling options),
  `6024-6100` (message assembly, the 4 MB reference-image guard), `6183-6212` (Vision node),
  `6316-6344` (Extract-frames stepping), `7165-7183` (`maskToSource`)
- `play.html:7216-7224`, `7301-7319`, `7418-7518`, `7583-7608`, `6138-6147`, `7277-7290`

**Verdict: mixed.** `maskToSource` is already exported from `browser.mjs` — extract it now, it is
the cheapest win in the whole list at 5 lines. The message-assembly lines belong to block 4's
delegation surface. The Extract-frames stepping is local media and needs a library module first.

### 7. njs delegation shim — sig 35

- `index.html:8117-8124` (`topoOrder`), `8198-8206` (`NJS_TYPES`), `8254-8329`, `8418-8424`
  (`fieldOverrides`)
- `play.html:7749-7756`, `7953-8060`, `8126-8132`

**Verdict: deliberate twin. Leave it.** `index.html:8182-8196` names it "Twin of play.html's Phase-E
shim". `scripts/check-njs-editor-delegation.mjs` exists to hold the 2 copies byte-identical. Note
that `topoSort` and `MAX_FRAMES` are already exported from `browser.mjs`, so `topoOrder` could go if
the shim ever collapses.

### 8. Resize and crop geometry — sig 25

- `index.html:6882-6942` (`resizePlan`, `resizeCropImage`, the aspect derivation)
- `play.html:7323-7358` and `play.html:8803-8817`

**Verdict: extractable, blocked only by the flag.** `browser.mjs` already exports `resizePlan` and
`resizeCropImage`. `scripts/check-resize-plan.mjs` already proves the 2 hand copies agree with each
other. This block is the safest candidate in the list, because the library copy is exported and
tested today.

### 9. Share-menu wiring — sig 24

- `index.html:11043-11083` (the `#sharemenu` button handlers, the shorten-in-flight disable, the
  Escape closer)
- `play.html:13262-13500`

**Verdict: extract with block 1, not before.** These are DOM handlers over the same 2 element ids on
2 separate documents. They only collapse if the share popover itself becomes a shared component,
which is a bigger move than extracting the packer.

### 10. `<head>` metadata and the share-menu markup — sig 21

- `index.html:8-31` (`og:image`, `twitter:card`, the icon and manifest links),
  `index.html:1104-1127` (`sm-urlrow`, `sm-svc`, `sm-social`, the shortener button row)
- `play.html:8-31`, `play.html:465-493`

**Verdict: genuinely surface-specific. Leave it.** This is HTML markup, not engine code. The 2 pages
are separate documents with separate CSP paths (see `_headers`). A build step that templated the
head would break the "1 self-contained file" property of the export.

Be precise about what the guard covers here. `og:image`, `og:image:width`, `og:image:height`,
`og:image:alt`, `twitter:card`, `twitter:image`, `twitter:image:alt` and the icon and manifest links
are byte-identical on the 2 pages, so they are in the shared set and a 1-page change to any of them
fails. `og:title`, `og:description`, `og:url`, `twitter:title` and `twitter:description` are
**deliberately different per page**. They were never in the shared set, so they cannot leave it, and
this guard cannot protect them. Nothing else guards them either — that is a real gap, and it is not
one this guard can close.

### 11. OAuth PKCE login — sig 17

- `index.html:11667-11704`
- `play.html:10352-10486`

**Verdict: extractable in principle, low priority.** The library has no auth module.
`scripts/check-login-state.mjs` already replays a sign-in round-trip on both files. The exported app
also runs this code from `file://`, where OAuth does not work, so any move must keep the
paste-key path intact.

### 12. Local media: WAV encode and fetch-error text — sig 23

- `index.html:9009-9070` (`mediaFetchError`, `encodeWavMono` and its header writes)
- `play.html:6497-6614`

**Verdict: partly covered.** `browser.mjs` already exports `encodeWavMono` from `local-media.mjs`.
`mediaFetchError` is not in the library. Extract `encodeWavMono` with block 8; the other needs a home
first. `seekVideo` (`index.html:8995`, `play.html:6639`) is a third twin that falls between this
block's range and block 3's, so it is in neither count.

### 13. i18n `translateTree` and `withLocale` — sig 12

- `index.html:3779-3814`
- `play.html:5671-5721`

**Verdict: surface-specific for now.** The editor localizes its own chrome; exported apps ship
English-only chrome plus the app-player chrome. `scripts/check-i18n-coverage.mjs` covers the maps.
The 2 helper functions could move to a shared module, but the payoff is 12 lines.

### 14. Prompt-cap helpers — sig 9

- `index.html:4169-4219` (`learnPromptCap`, `fitPromptText`, `promptCapFromError`)
- `play.html:7861-7910`

**Verdict: extractable, and the library copy is already in the bundle.**
`nanoodle-js/src/prompt-caps.mjs` exports `fitPromptText`, `promptCapFromError` and
`learnPromptCap`, and the bundle carries the module. `browser.mjs` does not re-export them. Add the
re-export, then route both surfaces at it. The generated `PROMPT-CAPS` table itself is already
excluded from the drift count, because `scripts/probe-prompt-caps.mjs` writes it into both files.

### 15. Small shared helpers — sig 6

- `index.html:4018-4023` (`verParts` version compare), `index.html:9634-9639` (`isLowFundsError`)
- `play.html:8542-8547`, `play.html:5752-5757`

**Verdict: leave them.** 6 lines. The guard is cheaper than the extraction.

### 16. Chat SSE stream loop — sig 5, agent-pill popover — sig 5

- `index.html:12376-12385` / `play.html:11795-11807`
- `index.html:11620-11645` / `play.html:13295-13335`

Both were invisible before the region fix. 10 lines between them. **Verdict: leave them.** The SSE
lines belong to block 4's delegation surface.

## The work list, in order

Each row deletes only lines that no earlier row already deleted, so "Baseline after" is cumulative.

| # | Block | sig | Baseline after | Blocker |
|---|-------|-----|----------------|---------|
| 1 | Resize and crop geometry | 25 | 868 | flag-off fallback only |
| 2 | `maskToSource` | 5 | 863 | flag-off fallback only |
| 3 | `encodeWavMono` + `mediaFetchError` | 23 | 841 | `mediaFetchError` has no library home |
| 4 | Prompt-cap helpers | 9 | 832 | 1-line `browser.mjs` re-export |
| 5 | Pricing resolver | 68 | 764 | `estimate.mjs` not in the browser bundle |
| 6 | MP4CAT | 123 | 641 | `MP4CAT` not re-exported; `check-combine.mjs` must move |
| 7 | Local media recorder path | 64 | 578 | needs a new library module |
| 8 | Share packer, card and shorteners | 140 | 442 | needs a new `share-pack.mjs` |
| 9 | Share-menu wiring | 24 | 418 | only after row 8 |

Rows 1 to 6 all sit behind the same decision: **does `index.html` load `vendor/njs-engine.js`
unconditionally, and does the built-in fallback survive?** Answer that once and 252 of the 893 shared
lines become deletable.

Blocks 4, 7, 10, 13, 15 and 16 are not on the list. They are covered by the delegation design or they
genuinely belong to 2 separate documents.

## What was not done in this PR

Nothing was extracted. Deleting the MP4CAT hand copies today would break `?engine=play` and every run
that starts before `vendor/njs-engine.js` arrives. The guard and this map ship first, so the number
is measured and cannot grow while the decision is pending.
