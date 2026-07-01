# New-user confusion review — nanoodle editor + app builder

**Goal:** minimize confusion in the first 60 seconds for a brand-new visitor, *without*
hand-holding — keep the high skill ceiling, just remove the avoidable friction.

**Method:** drove a real Chromium (fresh profile, empty `localStorage`) through the live
landing → first-run → auth → share/create-app flows via CDP, then a multi-agent code
review confirmed each observation against `index.html` / `play.html` and adversarially
re-checked severity. 29 raw findings → **20 confirmed**, deduped here into 9 issues by
root cause. Every item cites `file:line` and proposes the *smallest shippable* fix.

Funnel lens: **land → first run → first "wow" → share/save → return.** Friction in the
first two steps is a five-alarm fire; polish three clicks deep is not. Issues are ranked
by **priority = severity × reach × how early in the funnel it bites**, not raw severity.

---

## Tier 1 — Activation blockers (fix first)

### 1. Clicking **▶ Run** while signed-out silently ejects the user off-site to OAuth
`index.html:4075-4080` (`ensureAuth`), `:4060` (`signIn` → `location.assign`), reached from
`runAll` `:2937`, `runGroup` `:2854`, and every per-node `▶` `:1969`.

The single most likely first click is the big primary **▶ Run**. On the hosted (https) site,
`ensureAuth()` with no key calls `signIn()` immediately — a **full-page redirect to
nano-gpt.com's login/signup**, with no confirmation, no "running needs a key," and no mention
that **paste key** is a no-redirect alternative. The paste-key prompt only appears on the
`file://` branch (`:4078`). A first-timer who just wanted to *see what this does* gets bounced
to a third-party signup and reads it as a forced wall — directly undercutting the
"bring-your-own-key, no server" pitch.

- **Mitigated, not absent:** the graph is stashed to `sessionStorage` (`:4057`) and restored
  after OAuth (`:4096`), so there's no data loss — the problem is the *unexplained eject*, and
  the resulting bounce, not lost work.
- **Fix (S):** in the https branch of `ensureAuth()`, instead of an unconditional
  `location.assign`, open `#keyrow` and show both choices inline with one line —
  *"Running calls models on your NanoGPT key — sign in, or paste a key."* — a **Sign in** button
  (calls the existing `signIn()`) plus the existing paste-key field. Unify the https and
  `file://` branches so the choice always shows. Fixing `ensureAuth()` covers the per-node `▶`
  and the top-bar Run in one place.
- **Keeps the ceiling:** signed-in users (`getKey()` truthy, `:4076`) still run instantly with
  zero extra clicks — the prompt only appears for the keyless first run.

### 2. The demo graph never fits the viewport — new users see half a workflow (or one node on mobile)
`index.html:3589` (`applyGraphData` applies the saved view verbatim), `:4110` (default load on
first run), `noodle-graph.json` ships `view={panX:-41,panY:261,scale:0.84}`. No
`fitView`/`center`/`zoom-reset` exists anywhere (`grep` is empty; keydown `:2750-2755` binds only
Run and Delete).

The shipped demo's pan/zoom is whatever the author last saved — tuned for a wide desktop and
**never recomputed to the actual viewport.** Measured live at 780px wide: the graph runs
**426px off the right and 295px off the bottom** — a first-timer sees a Text node and a wire
vanishing off-screen. On a 390px phone only the leftmost node is visible. They can't form a
mental model of what nanoodle *is* from what's on screen, and there's no recenter control to
recover if they pan into empty space.

- **Fix (M):** add `fitView()` that frames the node bounding box with margin (clamp max scale to
  ~1.0 so a 3-node graph doesn't over-zoom; pad the bbox). Call it on boot **only when the
  loaded default's bbox exceeds the current viewport** — never when restoring a user's own saved
  view or a shared `#g=` link. Also expose it as a small **⊡ Fit** button + a key (`F` or
  double-click empty canvas). This also resolves the mobile "lone node" view and the
  "I panned and lost my graph" trap.
- **Keeps the ceiling:** auto-fit fires only for the shipped demo on small/odd viewports; manual
  pan/zoom/pinch are untouched, and experts gain a fast standard reframe shortcut.

---

## Tier 2 — Major friction

### 3. Destructive edits are irreversible — no undo, and clicking a wire silently deletes it
`index.html:2750-2755` (no Ctrl/Cmd+Z bound), `removeNode` `:2276-2288` and `removeLink` `:2415`
mutate the graph in place with no snapshot; wire hit-path `:2403-2412` deletes on a bare click
with only a `cursor:pointer` cue.

A new user exploring the demo can wipe a node (Delete/Backspace) or snip a connection (one stray
click on a wire) with **no way back** — there is no global history. The wire-delete gesture is
also undiscoverable: nothing says a wire is clickable-to-delete. Fearless experimentation is a
core skill-ceiling enabler; right now it's a footgun.

- **Fix:** (a) in-memory `serializeGraph()` snapshot stack pushed on each structural mutation,
  bound to Ctrl/Cmd+Z (+ redo) restoring via `applyGraphData` — **L**; (b) add
  `title="click to remove"` (or a hover red/snip highlight) on the wire hit-path — **S**.
  Do **not** add a confirm dialog (taxes the power flow for a cheaply-reversible action) — undo
  is the right safety net.
- **Keeps the ceiling:** undo is invisible until needed; the wire tooltip keeps fast
  click-to-delete for experts while making it legible to newcomers.

### 4. Zero first-run orientation, and the Gallery (browse & remix) has no way in
`index.html:4089-4120` (boot loads a graph, no overlay; `:4114` comment notes the welcome modal
was removed), `openGallery()` `:3945` has **no callers** — reachable only via a hand-typed
`#gallery=<slug>` deep link (`:4101`). The `noodle_seen_gallery` "first-visit welcome" guard
(`:3946`) is *written but never read* — the welcome it implies never fires. The only "what is
this" copy lives in `<meta og:*>` (`:12-13`), never shown in-app.

The most natural new-user move — *"show me a working example"* — has literally no button, and
the product markets "browse & remix curated noodles." Combined with #2 (half-hidden demo), the
newcomer gets neither an explainer nor a legible example.

- **Fix (S):** (a) one dismissible canvas line, persisted-dismissed like other one-shot flags —
  *"A live AI workflow — press ▶ Run, or ＋ Add node to build your own."*; (b) wire the existing
  `openGallery()` to a **🖼️ Gallery** entry (top bar, or a "START HERE" row in the Add-node
  popover). No new logic — just an entry point.
- **Keeps the ceiling:** one sentence + an X, and an opt-in modal; no tour, no gating. Experts
  dismiss once and never see it again.

### 5. The contest **🏆 Submit** clutters prime toolbar space, auto-pops on Share, and rots after Jul 12
`index.html:514` (`🏆 Submit` inline between Share and Save, no date-gate — it's static HTML),
modal "closes July 12" `:609`; `:3704` auto-opens the Submit modal on *every* successful Share
copy, and that modal defaults to an **app** link (`submitTarget='app'`, `:3830`) that contradicts
the **workflow** link (`#g=`) just placed on the clipboard.

"Submit" is a bare verb with no object, sitting among core actions (Run / Create app / Share) so
it implies a primary action — but it opens a time-boxed crypto-prize contest a newcomer can't act
on (nothing built yet), and it becomes dead weight after the close date. Worse, the casual
Share path shoves the contest modal in the user's face uninvited, showing a *different URL* than
the one they just copied.

- **Fix (S):** (a) relabel **🏆 Cookoff** (names the thing, not a primary verb) and
  client-side date-gate it (and the 🍜 promo) to auto-hide after Jul 12 23:59 UTC; (b) stop
  auto-opening the Submit modal on the casual Share copy — keep it behind the explicit button; if
  it must nudge, mirror the `submitTarget` to what was copied so the URLs match.
- **Keeps the ceiling:** the contest stays one click away via its own button + floating promo;
  the bar declutters for everyone learning the actual product. Pure DOM/date logic, no analytics.

---

## Tier 3 — Polish (cheap clarity wins)

### 6. Terse run-time errors are dead-ends with no next step — `index.html:1099,1470,1495,1520,1598,1621,1641`
`"no text"`, `"no prompt"`, `"no image input"` state the lack but not the remedy — while adjacent
code already models the house style: `"no image — upload or capture one first"` (`:1419`). Bring
the short ones up to `"<problem> — <do this>"`, tailored per node (e.g. on edit/video nodes,
*"wire an image into the image port"* since there's no inline upload there). Renders on the
failing node, so it's clear *which* node — just finish the sentence. **(S)**

### 7. "Share" means two opposite things across the two apps — `index.html:513` vs `play.html:244`
Editor 🔗 Share emits an **editable workflow** link (`#g=`, `buildShareUrl` default `:3688`);
builder 🔗 Share emits a **runnable app** link (`#a=`, `:3697`). Same label, opposite artifact —
a newcomer who builds a graph and hits editor-Share to "send my app" hands friends the raw node
editor. Relabel the editor button **🔗 Share workflow** (and/or have its toast name the
destination). **(S)**

### 8. "✨ Create app" drops the user into a second tool with no orientation — `index.html:3782-3803`
Create app loads `play.html` (a whole separate builder/runtime: AI Customize bar, Share, Export,
`✎ Edit workflow`) into a modal iframe. It's a standard dismissible modal (✕/Esc/backdrop returns
to the editor), so the user isn't trapped — but nothing explains the one non-obvious bit: that
**✎ Edit workflow round-trips back to the graph and keeps the app binding.** One dismissible
first-run line inside the modal, shown once. **(M)**

### 9. Keyboard shortcuts are undocumented — `index.html:2750-2755`
Delete/Backspace deletes the selected node; ⌘/Ctrl+Enter runs — but only Run advertises its
hotkey (`:510`). Each node already has a visible ✕ (`title="delete"`, `:1931`), so deletion isn't
*blocked* — just extend that title to **"delete (Del)"** to surface the hotkey. A full shortcuts
legend is optional and risks hand-holding; skip it. **(S)**

---

## What's already good — don't regress these

- **Add-node menu**: searchable, "START HERE", typed one-line descriptions (`Text → image`). A
  genuinely strong on-ramp.
- **Paste-key field**: clean inline row with the `nano-gpt.com → Settings → API` hint.
- **play.html opened directly**: clear empty state ("Open a workflow from the editor →").
- **Responsive top bar**: collapses to ＋ / Run / ⋯ at mobile widths (no horizontal overflow).
- **Touch plumbing**: `touch-action:none`, coarse-pointer fat hit targets, one-finger pan +
  two-finger pinch all wired correctly (`:307-310, :487-498, :2687-2747`). The gap is
  discoverability (#2/#4), not the gestures.
- **OAuth state safety**: the graph survives the redirect via `sessionStorage` — keep this when
  reworking #1.

## Checked and *not* worth changing (for transparency)

- **Top-bar wrapping/clipping**: only the flex spacer collapses; no real clip at normal widths.
- **"💬 Describe changes" bar**: it has an inline model picker with a "Choose the model that
  plans your change" tooltip and a placeholder example — its purpose reads fine.
- **Port-to-port wiring discoverability**: ports use `cursor:crosshair` + hover glow/scale that
  already signal "draggable"; compatible inputs glow on drag.
- **No multi-select / box-select**: a real limitation, but not a *confusion* point for newcomers.
- **Zoom floor (ZMIN=0.4)**: the actual new-user *starter* (`seed()`, `:3893`) is two nodes
  (~580px) that fit a 390px phone even at the floor; only the *demo* graph overflows (→ #2).

---

## Suggested ship order

1. **#1 auth prompt** (S) — biggest activation lift, touches the most common first click.
2. **#2 fitView + ⊡ Fit** (M) — makes the demo legible on every screen; unblocks mobile.
3. **#5 contest date-gate + no auto-popup** (S) — declutters the bar and removes the rot.
4. **#4 first-run line + Gallery entry** (S) — gives newcomers an example to remix.
5. **#3 undo + wire tooltip** (undo L / tooltip S) — makes experimentation safe.
6. **#6–#9** — copy/label polish, batch them.

Items #1, #2, #4, #5 together rebuild the entire land → first-run → first-wow path and are all
small/medium. That's the highest-leverage week of work for new-user activation.
