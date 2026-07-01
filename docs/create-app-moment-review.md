# The Create-app moment — product review

**Date:** 2026-07-01 · **Goal:** make ✨ Create app the *primary* way people use nanoodle —
build → create app → keep generating things they love → share → others use & modify → return.

**Method:** 6-lens multi-agent workflow (discovery, handoff, builder loop, share/spread,
return/modify, + a live CDP walkthrough of real Chromium with cleared storage), 43 agents,
every top bad/confusing claim adversarially re-verified against `index.html`/`play.html`.
Builds on `docs/new-user-confusion-review.md` (referenced as "prior issue N", not rehashed).
Live-walkthrough screenshots referenced below were session artifacts (scratchpad), not committed.

**Funnel lens:** land → first run → first wow → **create app** → keep generating → share →
others modify → return.

---

## Verdict in one paragraph

The *machinery* of the loop is unusually strong — instant keyless app creation, a closed
hosted remix loop, append-only versions, honest costs, an airtight sandbox/trust story —
but the *moment* itself is broken in three ways: the product never **pulls** anyone toward
Create app (no nudge at the wow moment, no visual hierarchy, invisible on phones); clicking
Create **doesn't durably create anything** (draft with no id, no binding, no My-apps entry —
so the next iteration forks a duplicate and users believe their app vanished); and the
within-session **tweak → Update loop is a live bug** — the reopened modal silently shows the
stale app. Fix pull, fix "create creates", fix the stale re-handoff, and the vision is
mostly already built.

---

## What's genuinely good — protect these

- **Instant, keyless, loss-proof create.** One click → a real runnable-looking app, built
  deterministically client-side, no sign-in wall, no model call. The modal keep-alive +
  `appHandoffSig` resume means ✕/Esc/backdrop never destroys the draft (`index.html:4329-4358`).
- **The hosted remix loop is structurally closed** — rare, and the product's strongest
  growth asset. An `#a=` recipient gets the app auto-imported into My apps, full Customize,
  and ✎ Edit workflow round-trips to the editor with the binding intact
  (`play.html:4353-4368`, `:4323-4335`). Value renders *before* sign-in.
- **Experimentation is safe by construction.** Both version strips are append-only; a
  customize can never brick the app (`bundle()` self-heal, `play.html:3362-3377`); the
  port-after-shape-change bar never auto-spends (`play.html:3790-3795`).
- **The binding is legible when it exists.** `✨ Update <name>` + "Save as a new app"
  escape hatch, single `setPendingApp` chokepoint, survives reload (`index.html:4254-4286`).
- **Costs are honest.** Streaming per-token meter with exact `x_nanogpt_pricing` commit
  (`play.html:3602-3679`); the generated app runtime is already built for "keep generating"
  (1×/2×/4×/8× lanes, Keep-generating toggle, per-result cost badges, error-preserved
  partials — `play.html:2413-2534`).
- **Outside positioning already leads with the app story** (meta/OG descriptions, llms.txt,
  README), and a bare `/play` visit advertises Create app instead of dead-ending.
- **Trust story is airtight:** null-origin app frame, key never enters the frame, parent
  proxies API calls, re-sealed CSP (`play.html:3384-3409`).

---

## Tier 1 — loop breakers

### 1. Within-session re-handoff is a silent no-op — the reopened modal shows the STALE app (live-confirmed bug)
`index.html:4350` (`openAppModal`), `:4354` (sig check)

`openAppModal` re-hands-off by reassigning the iframe src to `"play.html"+hash`. Since the
URL differs **only in the fragment**, the browser performs fragment navigation — no reload —
and `play.html` has no `hashchange` listener. So: create app → close → tweak a prompt on the
canvas → click `✨ Create app` / `Update <app>` → the modal reopens showing the **old** app;
the new graph is silently dropped, *and* `lastHandoffSig` is updated to the new sig, so
every subsequent reopen "resumes" the stale app. Confirmed twice in the live walkthrough
(within-session = stale; after a full page reload it works and shows the new graph).

Note: the code's own comments (and several code-reading passes) assume this path reloads the
iframe. It doesn't. Silver lining: the feared "reload aborts an in-flight paid Apply /
discards the draft" scenarios can't fire from this path today — but only because the
handoff itself is broken.

- **Fix (S):** postMessage the new `{graph, appId}` into the live builder (message channel
  already exists) or force a real reload (blank `src`, then set); or add a `hashchange`
  listener in play.html. When adding a real reload, *then* guard the in-flight-Apply case
  (builder posts `__busy__`; editor resumes instead of reloading while busy).

### 2. "Create app" doesn't create anything durable — and the editor never finds out
`play.html:3961` (`commit()`), `index.html:4470-4477` (only `__editflow__` binds)

A fresh app is a transient draft: no id, no My-apps entry, no editor binding until the user
customizes, draws, or renames. The binding is one-directional — play.html never notifies the
editor of a commit — so after creating (even after customizing!) the topbar still reads
`✨ Create app`, and the next click after a graph change mints a **duplicate default app**,
stranding the customized one in My apps. The live walkthrough confirmed the whole arc:
"creating" an app leaves no trace anywhere the user can see.

- **User's read:** "I made my app, tweaked the graph, hit the button — my app is gone /
  it made a second plain one."
- **Fix (M):** (a) commit an id on the fresh-handoff `installApp` path so Create actually
  creates; (b) have `commit()`/rename postMessage `{type:'__appsaved__', appId, title}` and
  handle it with `setPendingApp` — the button flips to `✨ Update <name>` the moment the app
  exists, and duplicates stop.

### 3. Nothing pulls users toward the moment — and on phones it's invisible
`index.html:574` (classless button), `:3996` (`RELOC` buries `appmenu` in ⋯ at ≤640px),
`:3296-3300` (run completion fires no hint)

The intended headline interaction has zero hierarchy: ▶ Run is the only `.primary`; Create
app is styled identically to Save/Load/Updates. The natural conversion moment — first
successful run — triggers nothing. On mobile (a big share of share-link traffic) the button
doesn't exist on screen at all. The only organic in-flow pitch is the >4MB media error…
which is a **false promise**: the app runtime enforces the identical limit
(`index.html:3509/:3584` vs the same checks in RUNTIME_JS), so following the advice hits the
same wall after real effort. That's the one place the product advertises its own headline
feature, and it burns trust.

- **Fix (S, bundle):** one-time post-first-wow chip ("Like it? ✨ Turn this into an app you
  can share" → `openCreateApp()`, reuse the canvashint one-shot infra); give `#makeapp` a
  distinct visual tier (keep Run the only filled primary pre-wow; consider flipping accent
  to Create/Update once a run has succeeded); keep ✨ out of `RELOC` (icon-only at narrow
  widths); rewrite the 4MB error copy in **both engines** (dual-engine parity) to point at
  ✂️ Trim instead of Create app.

### 4. Iterating wipes the things they just loved
`play.html:3425-3430` (`renderApp` remounts srcdoc), `:3822` (version switch), `:4439` (undo)

Every customize apply, version-chip click, and undo remounts the app iframe: all generated
results, typed inputs, and the session cost meter vanish — re-seeing them costs money. The
companion gap: **in-app edits** (model swap, prompt tweak — the most natural remix) are a
shadow state with no promotion path; Share/Export ship the original template and the only
surface is the 4-word "✱ edits aren't shared" hint. "Keep generating things they love" is
undermined at exactly the moment they love something.

- **Fix:** (L) snapshot/restore result cards + input values across remounts via the existing
  postMessage bridge; (M) "Keep these edits" promotion that bakes dirty field values into
  the template as a new version. These two are the biggest "keep generating" unlocks.

### 5. The recipient's first wow sits behind a funded third-party account, in an IDE
`play.html:4255` (`doShare` packs `{graph, files}` only), `:3973-3995` (full authoring chrome)

A shared `#a=` link carries no example output — the recipient sees an empty form; pressing
Run routes to NanoGPT signup + funding before any evidence the app is good. And they land in
the full authoring chrome (Customize, model picker, versions, Export) with one transient
toast as orientation — "was I sent the wrong link? Will I break their app?"

- **Fix (M):** optional baked "cover" result (one capped-size image/text) rendered pre-auth;
  (S) a one-time recipient welcome strip ("Someone shared this app. It's yours now — runs on
  your own key; customize below or ✎ remix its workflow"); (M) port the editor's run-cost
  resolver into RUNTIME_JS so the app answers "what does Run cost ME" (cents, not dollars)
  before the first paid click.

---

## Tier 2 — trust & loss edges

6. **✎ Edit workflow destroys an unbound canvas unrecoverably** — `__editflow__` calls
   `applyGraphData` with no `pushUndo` and autosaves over single-slot `noodle_graph`
   (`index.html:4471-4477`). Return-visit horror story: open an old app, click Edit
   workflow, last night's half-built noodle is gone from canvas, storage, undo, everything.
   *Fix (S): `pushUndo()` before apply; park the old graph.*
7. **Update always overwrites the app's stored graph, kept nowhere** — builder versions
   snapshot files only; the editor's describe-versions strip is in-memory and empties on
   reload (the known "v4 lost my changes" class). Viewing and overwriting are the same
   gesture: "Update" is also the only door back into a bound app.
   *Fix (M): add `graph` to `pushVersion` entries; persist the editor strip; split
   "open my app" from "push canvas changes" when sigs differ.*
8. **Keyless Customize: click is a dead-end, Enter is an eject** — Apply is disabled with no
   tooltip/reason while Enter in the same field kicks sign-in (`play.html:4209` vs `:3706`).
   The vision's "others MODIFY it" user hits this on their first customize.
   *Fix (S): route clicks through `kickBuilderSignIn`, ideally with the inline
   sign-in/paste-key choice instead of an instant redirect.*
9. **Export is a viral dead end** — no visible "Made with nanoodle / remix" anywhere in the
   exported .html (meta tags are crawler-only), and nothing can re-import an exported file.
   *Fix (S): footer link injected as an engine piece (self-heal-protected); accept exported
   .html in the Load path (~20 lines).*
10. **The contest/Submit "App" link ships the DEFAULT app** — `buildShareUrl("app")` packs
    `#g=` graph only, so voters see none of the entrant's Customize polish
    (`index.html:4193-4198`). During a live contest this is an own-goal.
    *Fix (S): when bound, emit the real app's `#a=` from `noodle_apps`.*
11. **Small trust dents:** app delete is instant with no confirm/undo and demotes the open
    app (`play.html:4123-4128`); the localStorage-quota toast always blames media while
    per-version full-file snapshots are a primary growth vector (`play.html:3929-3935`);
    the stock "Remember inputs" suggestion chip is guaranteed broken in the sandboxed
    preview (storage shimmed to memory, `play.html:3393-3397`); auto app titles are raw
    truncated prompts (and the demo bakes in "an 90s" — the first app every new user makes
    has a typo in its hero title).

---

## Confusing — the mental-model debt (one list)

- **Update-vs-Create is invisible until you perform the one gesture that binds** — users
  who only ever click Create never see Update, and the button says "Create app" right after
  they created one.
- **Two identical-looking version strips protect different artifacts with different
  lifetimes** (editor: graph, in-memory only; builder: skin files, durable) — and no UI says
  which. Neither durably protects the workflow.
- **Three "new app" verbs** (Create app / Save as a new app / ＋ New app from this workflow)
  and **three different "app" links** (share `#a=`, Submit `#g=`, exported .html) share
  names but not behavior.
- **Apps have no home in the editor** — zero references to `noodle_apps` in index.html; ≡ My
  apps lives only inside the builder and is hidden until nonempty. Returning users can't
  find what they made. (Related: creating an app is effectively how you get a *named,
  multi-slot save* of a workflow — nothing tells users that.)
- **Template-vs-session is never taught** — "✱ edits aren't shared" is the entire curriculum.
- **The intro hint camps on top of the Customize composer** (the first thing users want to
  touch) and reappears every open until dismissed; on mobile it blocks the input.
- Two "✨ model ▾" pickers mean different budgets (app-writing LLM vs generation models).

---

## Ship order (my call)

**This week (mostly S, all high-leverage):**
1. Stale re-handoff bug (#1) — it's a plain bug in the core loop, fix first.
2. Bind-on-create + `__appsaved__` postMessage (#2) — makes Create real, kills duplicates.
3. Keyless Apply parity (#8) — one-liner, unblocks every share-link recipient's first customize.
4. Discovery bundle (#3) — post-wow nudge + visual tier + mobile visibility + honest 4MB copy.
5. `pushUndo` before `__editflow__` (#6) — cheap insurance against the worst data-loss story.
6. "Made with nanoodle — remix" footer in exports (#9a) + Submit ships the real app (#10).

**Next:** session-preserving remounts + "Keep these edits" (#4) — the real "keep generating"
unlock; recipient cover/welcome/run-cost (#5); graph into builder versions + persist the
editor strip (#7); ≡ My apps in the editor topbar; goal-named version chips
("v2 · gallery"); delete-undo toast.

**Deliberately not now:** per-app OG for `#a=` links (needs the opt-in edge Worker — already
scoped and deferred), provenance/remix-credit fields (great, but after the loop itself is
sound), parent-bridged persistent storage for previews.
