# Examples gallery — interesting-utility review (2026-09-16)

For Mikkel. Shelf as live on 2026-09-16: 8 gallery cards
(`storyboard-relay`, `tiny-world-film`, `character-sprites`,
`image-model-arena`, `photo-to-video`, `sing`, `talking-avatar`,
`neon-shrine-duel`) + `custom-endpoint` as editor-only teaching card
(no See result — correct, keep it there).
Sources: `examples/gallery/`, `guide/examples/`, live
`nanoodle.com/examples/gallery/` and `/guide/examples/`, recent shelf
history (#533–#555). No paid generation spent; no public posts.

Bar used: fun-useful titles, short punches, job-true thumbs, newer
models, multi-stage or compare workflows with matching saved media.
Vivid cinematic first-clicks over workshop docs, two-node text slop,
empty results, and detector-score marketing.

## What's already strong

- **Storyboard relay** — the gold standard. 15 nodes / 5 paid calls
  (Muse → Nano Banana → Gemini 3.8 Flash → Muse Edit → fresh review).
  Draft *and* repaired frames saved side by side, both critiques saved,
  alternate run (`salt-lagoon-kite`) proves the workflow replays.
  Review copy admits remaining flaws. New models throughout.
- **Tiny world, full soundtrack** — image → video → foley with the
  *silent intermediate saved*, so visitors see what each stage added.
  Alternate run + separate audio review. Honest limits (abrupt ending,
  sync not established). Exactly the multi-stage shape to copy.
- **Neon shrine duel** (newest, 2026-09-14) — best first-click on the
  shelf: fight seed → GLM → Anima still → GLM → H3 Max clash, ~$0.27.
  Current stack (GLM 5.3 Flash, Anima, MiniMax H3 Max), cinematic thumb,
  short punch. One gap: the Anima still is not a saved output, so the
  middle stage is invisible (see pin 4).
- **Sing** — good bones: 3 LLM calls (lyrics / arrangement / avoid-list)
  + MiniMax Music 3, and *all four artifacts saved* (mp3, lyrics,
  arrangement, avoid-list). The listening check admits the trip-hop
  brief only partly landed. Keep the honesty; fix the thumb and the
  review model (see below).
- Shelf hygiene is good overall: no detector-score marketing, no empty
  result pages, no engineer note walls (copy is short everywhere),
  `gpt-4o-mini` confirmed gone. The Pocket-mystery cull (#551) was
  the right call.

## What's weak / thin / tourist

1. **Photo-to-video is the thinnest card.** Text → image → video of a
   steaming mug: the classic demo-ware first-click, and the single
   saved output is just the clip — the first frame isn't even an
   output, despite the note citing "five sampled frames." Titles drift
   between surfaces (gallery "From scene to short clip" vs guide
   "Animate a still" — neither is fun-useful). The workflow note about
   the provider's renamed video model ID is maintenance residue
   leaking into user copy.
2. **Talking avatar reads like workshop docs.** A fictional museum
   guide reads a workshop introduction — the exact dull-workshop
   register Mikkel excludes. Single mp4 output for a 3-stage workflow
   (no portrait, no TTS audio saved). Only non-exact cost on the shelf
   ("at least $0.28; some provider costs were omitted"). Stack is
   aging: Minimax-Speech-2.8-HD + LongCat while `xai-tts` and
   InfiniteTalk exist in-catalog.
3. **Arena's saved media no longer matches its workflow.** Saved
   contender 2 is Krea; the live workflow runs Flare ("has not been
   sampled here"). A compare card whose comparison can't be reproduced
   is a job-truth gap, not a caveat to keep. (Also: Recraft V4 vs
   current V4.1 — confirm which is canonical before resampling.)
4. **Sing's thumb isn't job-true.** Every other card shows what the
   workflow made; Sing shows a generated waveform SVG. For a music
   card the honest thumb is cover art or the lyric sheet, not a
   waveform graphic. Minor: its audio review ran on `gemini-2.5-flash`
   while the rest of the shelf reviews on `gemini-3.8-flash`.
5. **Character-sprites is fine but niche.** Reference + rig parts,
   feeds Iron Verdict — real utility for game makers, weak pull for
   everyone else. Punch ("Furnace knight. Reference + parts you can
   rig.") is accurate but not vivid. No change urgent; don't lead
   the shelf with it.
6. **Zero shelf presence for Choice.** The flagship branching node
   appears only in the editor-only custom-endpoint card. No gallery
   workflow shows a Choice driving anything — that is the shelf's
   biggest structural hole, and it points directly at pin 1.

## Concrete next pins, ranked

1. **Fable 5.1 Choice multi-node (the known hole).** Restore
   `fable-five-step` (culled as bloat in #538; graph at `92ef8f2`:
   text dump + Choice(Shape) + join + `anthropic/claude-fable-5.1`)
   as a real gallery card. It is the only candidate that (a) puts
   Choice on the shelf, (b) uses the flagship LLM, (c) adds the
   shelf's only text-first workflow, and (d) costs ~$0.02 to sample.
   Ship it properly this time: it previously carried a `NOTE.txt`
   stub with no NanoGPT spend. Run all three shapes (five steps /
   PR body / failing-test-first) on the invoices crime-scene dump,
   save all three outputs, honest note. Vivid punch writes itself:
   "a messy dump becomes the plan in the shape you pick."
2. **Resample arena contender 2 on Flare.** Same FIX A FLAT brief,
   replace the Krea file, delete the staleness caveat. While there,
   confirm the other three contenders are still the current model IDs
   (Recraft V4 vs V4.1 question). A compare card must be reproducible
   or it reads as marketing.
3. **Promote photo-to-video or cut it.** Two options, in order of
   preference: (a) rebuild it as still → motion → *sound* (Mirelo
   foley, Wan 3.0 `enable_audio`, or P-Video 2 — all newer than the
   current silent clip), saving the first frame and sampled frames as
   outputs with one fun-useful title on both surfaces; (b) drop it —
   tiny-world-film already teaches image-to-video better, with sound.
   Do not keep the steaming mug as-is.
4. **Talking-avatar refresh.** Save the portrait + TTS audio as
   outputs (3 stages → 3 artifacts, like Sing), resample on the
   current speech/avatar stack, pin an exact cost, and rewrite the
   script brief away from the workshop introduction — give the
   presenter something with a pulse (night-market dispatch,
   museum-heist briefing). Keep the honest lip-sync framing.
5. **Sing thumb + review model.** Commission cover art from the song's
   own lyrics/arrangement (or thumb the lyric sheet) instead of the
   waveform SVG; re-run the listening check on `gemini-3.8-flash`.
   Small work, removes the shelf's least job-true thumb.
6. **Neon-shrine-duel stage media.** Save the Anima still as output 1
   alongside the clip, and consider a second seed as an alternate
   (the relay/film alternates pattern). Cheap, makes the "→LLM→"
   chain visible.

## What to cut or rewrite

- **Cut or rebuild photo-to-video** (pin 3) — still smells like slop:
  demo-ware subject, single output, drifting titles, residue in the
  notes. Nothing else on the shelf needs cutting.
- **Rewrite talking-avatar's brief/punch**, not the card — the
  workflow is legitimate utility, the packaging is workshop docs.
- **Delete, don't keep, the arena + avatar workflow caveats**
  (Krea-vs-Flare, renamed model IDs) by resampling — permanent
  caveats train visitors to distrust saved media.
- **Keep custom-endpoint editor-only.** $0 echo + no See result is
  exactly right for a teaching card; promoting it to the shelf would
  be a tourist trap (empty result page by design).

## Top 3 next utility moves

1. Fable 5.1 Choice card with three saved shapes (~$0.06 total).
2. Arena Flare resample so the comparison reproduces.
3. Photo-to-video goes still→motion→sound with saved frames, or gets cut.
