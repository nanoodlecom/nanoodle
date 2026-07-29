# Twin drift: the index.html ↔ play.html extraction map

Date: 2026-07-28, revised 2026-07-29. Line ranges are from commit `dbd4543`; every count here comes
from `scripts/check-twin-drift.mjs` or `scripts/twin-drift-worklist.mjs`, every verdict from
`scripts/check-twin-drift-cases.mjs`, and every timing in the Runtime table from
`scripts/twin-drift-bench.mjs`. The 2 timings outside that table — the baseline refresh and the
sandbox matrix — were timed by running those 2 commands directly. Every timing states the load
average of the machine it was measured on.

## The measurement

`index.html` is 12,493 lines. `play.html` is 13,639 lines. They are the two engine surfaces:

- `index.html` — the editor. It may load files from `vendor/`.
- `play.html` — the app player and the single-file `.html` export. It must stay 1 self-contained file.

**893 distinct lines longer than 40 characters are identical in both files.** They occur
957 times in `index.html` and 1,011 times in `play.html`. The generated `<script id="njs-engine">`
bundle, the probe-written `PROMPT-CAPS` table, the generated i18n maps and the Runware AIR table are
excluded from that count, so the number is hand-maintained duplication only.

**"Identical" means identical after `String.prototype.trim()`** — leading and trailing whitespace
stripped, nothing inside the line touched. That is not a detail. `play.html` nests most of the
shared code 1 or 2 levels deeper than `index.html`, so only **415 of the 893 lines are
byte-identical in the files; the other 478 match only after the strip**. `seekVideo` is the visible
case: `index.html:8995` starts at column 0 and `play.html:6639` starts at column 2. The guard is
right to strip — an indentation change is not drift — and the older wording of this document, which
said "byte-identical" throughout, was wrong about more than half the set.

Reproduce the counts above:

```sh
TWIN_DRIFT_STATS=1 node scripts/check-twin-drift.mjs
```

538 of the 893 lines sit in 87 contiguous blocks of 4 lines or more, counted on `index.html` line
numbers with at most 1 non-shared line inside a block. The other 355 are scattered single lines and
pairs. This document ranks 16 of the 87 blocks. Reproduce those 3 figures:

```sh
node scripts/twin-drift-worklist.mjs
```

### What this map does NOT cover

The ranked list below is a map, not an exhaustive partition. Read it that way.

- **16 of 87 blocks are ranked.** The other 71 blocks and all 355 scattered lines are guarded by
  `check-twin-drift.mjs` exactly like the ranked ones, but this document does not give them a
  verdict.
- **A twin can fall between 2 block ranges and be in no block's `sig` count.** `seekVideo`
  (`index.html:8995-9004`, `play.html:6639-6648`) is the known example. It sits after block 4's range
  (which ends at `index.html:8870`) and before block 12's range (which starts at `index.html:9009`),
  so no ranked block counts it. The guard still holds it, because the guard works on the whole shared
  set and not on this document's blocks.
- **Lines of 40 characters or fewer are outside the shared set by design, on every block.** That
  threshold buys the guard its very low false-positive rate, and it costs coverage. `seekVideo` shows
  the trade in 1 place: 10 lines, identical on both surfaces after the strip, but only 2 of them are
  longer than 40 characters. Those 2 are guarded. The other 8 (`let settled = false;`,
  `vid.addEventListener("seeked", done);` and the like) are not, on either surface.
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
- **Divergence.** A shared line left BOTH surfaces, and each surface now carries its own, **new**,
  **different** replacement of it. Both engines still do the work and they now do it differently.
  See "The one exemption" below for the exact test, and for what **new** costs.
- **Growth.** The distinct shared-line count went up, or a shared line gained a copy.

It **passes** on:

- **Extraction.** A line that left both surfaces and left no matching pair of replacements behind.
  The note names both readings — a real extraction, or the old half of a mirrored edit — instead of
  guessing. When the generated bundle carries the same text, the note says so, because then
  "extracted into the library" is the reading.
- **A correctly mirrored edit.** Both surfaces change together, to the same new text, the count
  holds, and the guard asks for a baseline refresh in a note.

Every departure is **classified**, up to the `MAX_CLASSIFY` ceiling of 200. Each failure list
**names its first 12 lines and reports the rest as a count**. A departure lands under 1 of 3
headings — `TWIN DIVERGENCE`, `TWIN DRIFT` or `ONE-SIDED DELETION` — and all 3 can fire in the same
run, so at the ceiling the guard classifies 200 departures and names **at most 36** of them, 12 under
each. (An earlier revision of this document said 24. That assumed only 2 headings could fire at
once. Edit `index.html:9292`/`play.html:6850` divergently, rename `play.html:12698` on 1 surface, and
delete `play.html:7330` from 1 surface: all 3 headings print together.) How the 200 split between the
3 headings depends on which lines departed, so no fixed split belongs in this document. The guard
does not name every line, and no part of it claims to.

### The one exemption, stated exactly

Leaving both surfaces is **not** what makes a departure an extraction. Leaving both surfaces **while
the 2 surfaces still agree afterwards** is. A departure from both surfaces fails as divergence when
all 3 of these hold, and passes otherwise:

1. `index.html` carries a **new** line near-identical to the departed line,
2. `play.html` carries one too,
3. those 2 replacements are near-identical **to each other**.

"Near-identical" is one number in one place: `DRIFT_SIMILARITY = 0.72`, a Dice coefficient over
character bigrams, the same test the drift rule already used. Condition 3 makes the 2 replacements 2
versions of 1 line rather than 2 coincidences, and the surviving pair is always *different*, because
an identical pair would be in the shared set.

**"New" is the whole rule, and leaving it out failed 4 of the 9 extractions this document plans.**
Deleting a twin block from both surfaces and editing a twin divergently on both surfaces leave trees
that differ in exactly one way: the divergent edit **adds text**. Nothing else separates them, so a
rule that matches a departed line against whatever happens to survive must eventually match a
coincidence — and coincidences are not rare here. There are **796 look-alike pairs over the 893
baseline lines** in the tree as it stands, before anything is edited. Deleting the block ranges of
the work list below, from both surfaces, then produced:

| Row | Verdict of the first divergence rule | The "replacements" it named (positions in the files as committed) |
|-----|--------------------------------------|-----------------------------|
| 1 Resize and crop geometry | exit 1, **2 false divergences** | `index.html:7084` and `play.html:9744`, 2 unrelated canvas lines that had been sitting there all along |
| 3 `encodeWavMono` + `mediaFetchError` | exit 1, **1 false divergence** | `index.html:8929`, a `FileReader` line in the demo-image path |
| 7 Local media recorder path | exit 1, **3 false divergences** | `index.html:6328` / `play.html:6946`, an unrelated `onerror` pair |
| 8 Share packer, card and shorteners | exit 1, **2 false divergences** | the same canvas pair as row 1 |

Rows 3, 7 and 9 also reported one-sided deletions, and those were **true**: the ranges those rows
published paired regions that are not twins. They are corrected below, and the guard is what found
them.

Row 1 is the plainest mirrored removal in the plan — `sig` = `deletes` = 25, every occurrence of
every twin inside the 2 ranges — and the guard called it divergence.

So the baseline now stores, per line, the **look-alike set**: the hash of every other line on that
surface that already scored 0.72 or more against it when the baseline was written. A candidate
replacement from that set replaced nothing; it was there first. With the sets in place all 4 rows
above pass, and the 2-sided divergent edit still fails. Both directions are pinned:

```sh
node scripts/check-twin-drift-cases.mjs
```

**So the exemption is: a departure from both surfaces where at most 1 surface grew a NEW look-alike
line.** That includes a case the guard would ideally fail — 1 engine edits the line while the other
drops it outright. Condition 3 is what keeps that case out, and it is there for a measured reason.
An earlier draft failed a single-sided match. Run against a genuine extraction control — delete the
whole MP4CAT block, `index.html:9099-9376` and `play.html:6657-6934`, 123 shared lines gone from both
surfaces at once — that draft raised 1 FALSE failure out of the 123. The departing banner comment
`/* ---- Lossless in-browser mp4 concatenation (Combine node) ----…` scored **0.840** against the
unrelated banner still sitting at `index.html:9086`,
`/* ---- in-browser video concatenation (the Combine node) ----…`, because a run of dashes carries
the bigram profile. A guard that fails a correct extraction is a guard that gets bypassed.

**How many lines does the exemption cover today? Zero.** It is a rule about future departures, and
on the current tree nothing departs. Its size on any given commit is the number of departures from
both surfaces in that commit where fewer than 2 NEW look-alike replacements appeared.

The look-alike sets also close the MP4CAT banner case above on their own: the surviving banner
(`index.html:9086`, hash `7f8cbc2c5d8093fb`) is the whole `index.html` look-alike set of the
departing one (`48b64f163787aa57`), so it can no longer be read as a replacement. Condition 3 stays
anyway. It is the cheaper guarantee and it holds even when the baseline is stale.

### The sandbox matrix

`scripts/check-twin-drift-cases.mjs` is 16 mutations of the 2 surfaces with the verdict the guard
must return for each. It copies both files, the guard and the baseline into a scratch directory,
mutates the copies and runs the guard there. Nothing touches the working tree. The 2 directions sit
in one table on purpose: a change that fixes one of them can silently break the other, which is
exactly what the first divergence rule did.

| Case | Must |
|------|------|
| Clean tree | pass |
| The 9 planned extractions, each deleted from BOTH surfaces | 8 pass; row 8 fails, see below |
| Edit `index.html:9292` to `a+s.durIDX` **and** `play.html:6850` to `a+s.durPLAY` | fail, 1 `TWIN DIVERGENCE` |
| Edit `index.html:9292` only | fail, 1 `TWIN DRIFT` |
| Delete `play.html:6850` only | fail, 1 `ONE-SIDED DELETION` |
| Edit both surfaces to the SAME new text | pass, note asks for a refresh |
| Paste an `index.html`-only line into `play.html` as well | fail, the ratchet |

**Row 8 is the one planned extraction that cannot be silent, and the guard is right.** Deleting the
2 share blocks leaves 5 twins live on exactly 1 surface, because their other copy is in unrelated
code:

- `index.html:10714` and `10716` are an inline copy of `play.html`'s `explicitLang()`
  (`play.html:11362-11375`). `index.html` has no other copy; `play.html` keeps its function.
- `index.html:10631` and `10636` (the share card's thumbnail downscale) twin `play.html:9745,9752`,
  a thumbnail helper outside the share block.
- `play.html:13056` twins `index.html:7937,8018`, the canvas fit bounds.

Plus 1 occurrence drift: the `noodle_lang` read lives twice in each file, and only `index.html`'s
second copy is inside the block. No choice of ranges fixes this — the extra copies are somewhere
else entirely. Whoever does row 8 refreshes the baseline as part of the move, deliberately, which is
what the guard's own remedy line asks for. The matrix pins the exact counts, so if that extraction
ever starts reporting something *else*, it fails the matrix.

### The bundle is never an exemption

A line still live on 1 surface always fails, and it fails even when the generated bundle happens to
carry the same text. That clause is load-bearing. An earlier version of the guard read "the text is
somewhere inside the bundle" as proof of extraction. It is not: **131 of the 893 baseline lines are
identical to a line already inside the bundle while both hand copies are still live**, because the
library ships MP4CAT, the pricing resolver and the resize geometry too. Under that rule a one-sided
deletion of live MP4CAT code
(`play.html:6850`, `const totalTicks = t.samples.reduce((a,s)=>a+s.dur, 0);`) exited 0 with a
"moved into the generated bundle" note, so the one-sided-deletion rule was off on 15% of the guarded
set. The same text-presence rule, 1 level down, also exited 0 on the **2-sided divergent** edit of
that same line, which is the hole the exemption above closes. Presence in the bundle now only picks
the wording of a note on a departure that is already classified as extraction. Count the 131 for
yourself:

```sh
TWIN_DRIFT_STATS=1 node scripts/check-twin-drift.mjs
```

Refresh the baseline deliberately:

```sh
TWIN_DRIFT_UPDATE=1 node scripts/check-twin-drift.mjs
```

### What the baseline stores, and why it cannot be hand edited

Each `lines` entry is `<hash> <n in index.html> <n in play.html> <look-alikes in index.html>
<look-alikes in play.html> <the stripped line>`, each look-alike field being `-` or a
comma-separated list of hashes.

- The **text** is there because a line gone from both surfaces has no copy left in either file. The
  divergence test above cannot run without it. That is what took the baseline from 25 KB to 102 KB.
- The **look-alike sets** are the guard's memory of what the tree looked like when the baseline was
  written, and the divergence test is wrong without them: it reads a line that was already there as
  a "replacement". 796 hashes over the 893 entries, which took the file from 101,630 to 118,241
  bytes. They are written at refresh only, because each one costs a scan of both surfaces.
- The **hash is a checksum of the text**: the guard re-hashes every stored line and refuses the
  baseline if any entry's text does not hash to its own hash. A stored line cannot be swapped for a
  friendlier one.
- The **count is a ratchet, derived from the `lines` array**, never read from the `count:` field. The
  `count`, `occurrencesIndexHtml` and `occurrencesPlayHtml` fields stay in the JSON for a human
  reader, and the guard fails if any of them stops describing `lines`.
- The **`digest` field is required**. It hashes the `lines` array, which now carries the per-line
  occurrence counts and the text, so it is the only thing pinning those. It used to be checked as
  `if (baseline.digest && …)`, which made *deleting the field* a way to switch the check off:
  inflate 1 line's stored counts from `1 1` to `2 2` (the guard reads a drop on both surfaces as a
  mirrored deletion and allows it), move `occurrencesIndexHtml` and `occurrencesPlayHtml` to match,
  delete `digest`, and a clean tree exited 0 with that line's ratchet silently raised. A missing or
  malformed digest is now an error.

The pre-commit hook runs the guard when `index.html`, `play.html`, the guard or the baseline is
staged, and the sandbox matrix when the guard, the baseline or the matrix is staged.

`touches_twindrift` was missing from the hook's early-exit condition, so a commit that staged **only**
`scripts/twin-drift-baseline.json` returned before any check ran — the one file to edit to defeat the
ratchet was the one file that skipped it. Both variables are in the condition now. Reproduce the old
behaviour by removing them: stage a baseline with its `digest` field deleted, on its own, and commit.

### Runtime

Offline, no network, no API spend.

The cost that matters is the drift classifier: for every baseline line that left the shared set it
scores the departing text against every candidate line of the surface that moved. A departure that
left BOTH surfaces is the dearest kind, because the divergence test scores it against both.
`MAX_CLASSIFY` caps the work at 200 departures; at 201 the guard reports totals instead, so the run
is always bounded. The ceiling is not free, and a normal commit never reaches it.

**Every range below is scoped to the load band it was measured in. Outside that band it says
nothing, and none of it is a promise about your machine — on this evidence the load matters more than
the code. Measure your own before you quote one.** 160 samples of each case, 32 runs of 5, on
2026-07-29, on a shared 18-core machine whose 1-minute load average ran between **2.6 and 12.1**
across those runs. Each range is the full spread of the 160: the low end of every row came from the
lightest-loaded runs and the high end from the busiest.

| Case | Wall clock | CPU time |
|------|------------|----------|
| Clean tree, nothing departs | 0.13-0.57 s | 0.15-0.67 s |
| 200 departures, all gone from BOTH surfaces | 2.07-8.21 s | 2.15-8.38 s |
| 200 departures, all gone from 1 surface | 0.98-4.64 s | 1.03-5.14 s |

CPU exceeds wall on the clean-tree row because Node's own startup runs on more than 1 thread.

Two costs are NOT in that table, and both are paid on purpose:

- **The baseline refresh takes 9.22-28.15 s wall** (36 samples, same machine, load average 2.6-9.5),
  because it scores every one of the 893 shared lines against every line of both surfaces to build
  the look-alike sets. It runs only when someone asks for it.
- **The sandbox matrix takes 12.2-29.9 s wall** (25 samples, same machine, load average 3.0-14.8):
  it runs the guard 16 times over mutated copies of 1.7 MB of HTML. The pre-commit hook runs it when
  the RULES change — the guard, the baseline or the matrix itself — not on every surface edit. It is
  the slowest check in the hook, which is why it is not on every surface edit.

**How little of any of this is the code.** While that matrix still had 15 cases it ran in 9.6-17.8 s
over 25 samples at a load average of 3.8-9.9. One further 15-case run, made while an unrelated Rust
build held this box at a load average of **23.5** and 6 GB into swap, took **65.9 s** — same commit,
same verdicts, nearly 4 times the slowest of the other 25. Those 15-case figures are labelled as such
because they do not describe the 16-case matrix above. They are here to make one point: every figure
on this page carries a load band, and you should quote your own numbers rather than any of these.

An earlier round measured the 200-departure ceiling at 23-30 s wall, on a machine under a load
average of 25 to 34, before `bestMatch` got its candidate index — it rebuilt the bigram profile of
every candidate line on every call, while the header claimed "well under 2 seconds" and the hook
claimed "~0.2s". That figure is not comparable to the table above: different code, and a far busier
machine.

Reproduce the whole table:

```sh
node scripts/twin-drift-bench.mjs        # 5 samples of each case, prints the load average too
time node scripts/check-twin-drift.mjs   # just the clean-tree row
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
`index.html` range **and** a hit inside the paired `play.html` range. It measures how much of the
shared set a block touches; it is **not** a deletion count, and the work-list table below explains
where the 2 differ. Line ranges are from commit `dbd4543`.

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

### 3. Local media: the MediaRecorder fallback — sig 68

- `index.html:9378-9630` (`pickVideoMime`, `loadVideoMeta`, `prepClip`, `recordClip`,
  `concatViaRecorder`, the MediaRecorder and AudioContext fallback path, async audio polling)
- `play.html:6616-6621`, `play.html:6649-6656` and `play.html:6935-7148`

The MediaRecorder fallback runs when the clips are not matching mp4s.

The `play.html` ranges used to read `6616-6660` and `6960-7150`, and both ends were wrong. The first
swallowed `toLocalMediaUrl`, `seekVideo` and MP4CAT's opening 4 lines, none of which
`index.html:9378-9630` holds; the second started **after** `prepClip` and `recordClip`
(`play.html:6935-6975`), which `index.html:9378-9630` does hold. Deleting the old pair from both
surfaces reported 11 one-sided deletions. `scripts/check-twin-drift-cases.mjs` holds the corrected
pair and proves it is silent.

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

Paired range by range, because a later row of the work list needs 1 of these pairs exactly:

- `index.html:4345-4358` (`audioInputPart`) ↔ `play.html:7277-7290`
- `index.html:5181-5189` (the music/remix song-count clamp) ↔ `play.html:7216-7224`
- `index.html:5380-5389` (`llmOpts`, the chat sampling options) ↔ `play.html:6138-6147`
- `index.html:6024-6100` (message assembly, the 4 MB reference-image guard) and `6183-6212` (the
  Resize node body) ↔ `play.html:7418-7518`
- `index.html:6316-6344` (Extract-frames stepping) ↔ `play.html:7583-7608`
- `index.html:7165-7183` (`maskToSource`) ↔ `play.html:7301-7319`

**Verdict: mixed.** `maskToSource` is already exported from `browser.mjs` — extract it now, it is
the cheapest win in the whole list at 5 shared lines. The message-assembly lines belong to block 4's
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
- `play.html:13262`, `play.html:13344-13396` and `play.html:13500`

The `play.html` range used to read `13262-13500` in one piece. That swallowed the whole agent-pill
popover (`play.html:13264-13343`) and the model-picker search, which `index.html` keeps at
`11583-11599` and `10369` — so deleting the pair reported 6 one-sided deletions.

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

### 12. Local media: WAV encode and fetch-error text — sig 26

- `index.html:9009-9084` (`mediaFetchError`, `encodeWavMono` and its header writes,
  `trimAudioToWavUrl`, `extractAudioToWavUrl`)
- `play.html:6497-6614`

The `index.html` range used to stop at `9070`. `play.html:6497-6614` carries the twins of
`trimAudioToWavUrl` and `extractAudioToWavUrl` as well (`index.html:9071-9084`), so the short range
deleted those 3 shared lines from `play.html` only.

**Verdict: partly covered.** `browser.mjs` already exports `encodeWavMono` from `local-media.mjs`.
`mediaFetchError` is not in the library. Extract `encodeWavMono` with block 8; the other needs a home
first. `seekVideo` (`index.html:8995-9004`, `play.html:6639-6648`) is a third twin. It sits before
this block's range and after block 4's, so no ranked block counts it. Only 2 of its 10 lines are
longer than 40 characters, so only those 2 are in the shared set at all. See "What this map does NOT
cover".

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

Three different numbers, one definition each. Nothing in this table is hand arithmetic — every cell
comes from `node scripts/twin-drift-worklist.mjs`, which reads the same shared set the guard pins and
prints the table below verbatim.

- **`sig`** — distinct shared lines with at least 1 occurrence inside the row's `index.html` range
  **and** at least 1 inside its `play.html` range. How much of the shared set the block touches.
- **`deletes`** — distinct shared lines whose **every** occurrence, on **both** surfaces, sits inside
  the row's ranges. Only these leave the shared set when the block goes. A twin with a copy outside
  the ranges survives the deletion, so `deletes` ≤ `sig`.
- **`new`** — this row's `deletes`, minus everything the rows above it already deleted.
- **`Baseline after`** — 893 minus the running union of `new`.

The old version of this table stated the `deletes` rule in prose and then subtracted `sig`. The 2
rules disagree on rows 3, 7 and 8, so every "Baseline after" cell from row 3 down was wrong. The
numbers below also move because rows 3, 7 and 9 now quote **corrected ranges**: the sandbox matrix
deleted the old ones from both surfaces and the guard reported one-sided deletions, which is what a
range that pairs 2 regions that are not twins looks like.

| # | Block | sig | deletes | new | Baseline after | Blocker |
|---|-------|-----|---------|-----|----------------|---------|
| 1 | Resize and crop geometry | 25 | 25 | 25 | 868 | flag-off fallback only |
| 2 | `maskToSource` | 5 | 5 | 5 | 863 | flag-off fallback only |
| 3 | `encodeWavMono` + `mediaFetchError` | 26 | 25 | 25 | 838 | `mediaFetchError` has no library home |
| 4 | Prompt-cap helpers | 9 | 9 | 9 | 829 | 1-line `browser.mjs` re-export |
| 5 | Pricing resolver | 68 | 68 | 68 | 761 | `estimate.mjs` not in the browser bundle |
| 6 | MP4CAT | 123 | 123 | 123 | 638 | `MP4CAT` not re-exported; `check-combine.mjs` must move |
| 7 | Local media recorder path | 68 | 66 | 66 | 572 | needs a new library module |
| 8 | Share packer, card and shorteners | 140 | 136 | 136 | 436 | needs a new `share-pack.mjs` |
| 9 | Share-menu wiring | 24 | 24 | 24 | 412 | only after row 8 |

**No row overlaps another.** The rows where `sig` and `deletes` disagree are 3 (26/25), 7 (68/66) and
8 (140/136), and every line in the gap is named here:

- `const AC = window.AudioContext || window.webkitAudioContext;` — `index.html:9051,9466,9528`,
  `play.html:6537,6565,7004,7055`. Rows 3 and 7 each hold some of those copies and neither holds all
  of them, so **neither row deletes it**. It is the whole of row 3's gap and half of row 7's.
- `const vid = document.createElement("video");` — `index.html:6322,9400`, `play.html:6944,7589`.
  The other half of row 7's gap.
- Row 8's 4: `let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;`,
  `c.getContext("2d").drawImage(img, 0, 0, w, h);`, `try{ img.src = src; }catch(_){ finish(null); }`
  and `const packed = await gzip(json).catch(()=>null);`, each with a copy outside the share packer.

Rows 1 to 6 all sit behind the same decision: **does `index.html` load `vendor/njs-engine.js`
unconditionally, and does the built-in fallback survive?** Answer that once and 255 of the 893 shared
lines become deletable (893 down to 638).

Recompute the whole table, including the agreement check against the guard's baseline:

```sh
node scripts/twin-drift-worklist.mjs
```

Blocks 4, 7, 10, 13, 15 and 16 are not on the list. They are covered by the delegation design or they
genuinely belong to 2 separate documents.

## What was not done in this PR

Nothing was extracted. Deleting the MP4CAT hand copies today would break `?engine=play` and every run
that starts before `vendor/njs-engine.js` arrives. The guard and this map ship first, so the number
is measured and cannot grow while the decision is pending.
