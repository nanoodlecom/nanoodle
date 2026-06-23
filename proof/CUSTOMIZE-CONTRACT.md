# Make "Customize app" build features, not reskins

The `play.html` **Customize app** button runs a gptdiff loop over the app's two editable files
(`index.html` + `app.css`). What it's *allowed* to do is set by one string — the `CONTRACT` preamble.
The shipped contract scopes it to **restyling only**:

> *"You are customizing a small single-purpose web app… **restyling it, re-laying it out, and rewriting
> the visible copy**… Keep it a clean, self-contained **form-over-flow UI**… keep [the controls] in
> place **as you restyle**."*

So no matter the goal, the model reskins. But the bundler already allows far more: **inline `<script>`
survives** (only *remote/external* scripts and stylesheets are stripped), the mount-point ids
self-heal, and the runtime + workflow are injected regardless. The only thing stopping richer apps was
the contract never telling the model it could add behavior — or how to do it safely.

## The change

Replace the `CONTRACT` constant in `play.html` with one that **invites real features** and states the
**exact invariants** so richer edits don't break the wiring:

```
You are upgrading a small, self-contained single-page web app — and you may make it genuinely more
capable, not just restyle it. You edit two files, index.html and app.css. Add interactive UI,
client-side logic, layout, micro-interactions, output galleries, preset controls, keyboard shortcuts,
drag-and-drop, localStorage persistence — whatever best serves the goal below. Think "build a real
feature," not "change the theme."

How the app works, so you can build on it safely:
- It's ONE self-contained page. Add as much inline <script>, <style> and markup as you need. Do NOT
  reference external/remote scripts or stylesheets — inline everything (anything remote is dropped).
  No build step.
- A prebuilt engine, window.NoodleApp, is already loaded. It renders the input form into #app-inputs,
  runs the workflow when #app-run is clicked, writes status to #app-status and results into
  #app-output. Keep those element ids present and let the engine own what it renders INSIDE
  #app-inputs / #app-output / #app-status. You may freely wrap, restyle, reposition and surround them,
  and add new sections, controls and scripts around them.
- To add behavior, attach your own event listeners and helpers: read or fill the engine's input
  fields (inside #app-inputs), enhance the result cards in #app-output (zoom, download, compare,
  grid), drive #app-run, persist to localStorage, add shortcuts or animation. Do NOT redefine or
  remove the engine, and do NOT touch the embedded workflow.

Keep it self-contained, responsive and accessible. Below is a description of the workflow this app is
a front-end for — use it to give the app a fitting identity and to reason about what the user is
trying to accomplish, then make their requested change in a way that genuinely serves that goal.
```

Three moves: **(1)** "more capable, not just restyle" + a concrete menu of behaviors invites ambition;
**(2)** it tells the model the freedom it actually has (inline JS is allowed and survives) — the old
contract never mentioned scripts, so it defaulted to CSS; **(3)** it names the invariants (`#app-*`
ids, `window.NoodleApp`, no remote refs) so richer edits stay wired — which is what the bundler's
self-heal already guards.

## Proof it now builds features

Same diff loop, new contract, one goal (`zai-org/glm-5.2:thinking`):

> *"Add clickable preset style chips (Renaissance, Cyberpunk, Claymation, 90s Anime, Marble) that fill
> the prompt field when tapped, remember the last prompt in localStorage, and show each result as a
> zoomable card with a Download button."*

The generated `index.html` (see [`proof/apps/pictureme-feature/`](apps/pictureme-feature/),
screenshot [`proof/shots/feature-pictureme.png`](shots/feature-pictureme.png)) contained:

- **2 inline `<script>` blocks**, **7 `addEventListener`s**, **3 `localStorage` uses**, **16 chip refs**
- a working **"Quick styles" chip row** that fills the prompt, **Ctrl/⌘+Enter to run**, **click-to-zoom**, **Esc to close**, per-result **Download**
- **all 9 mount ids preserved**, **0 remote scripts** — the engine's Run/inputs/outputs stay wired

That's a genuine feature, not a reskin — and notably it reaches the exact "look-chips" that the
restyle-only contract could never produce (see [`COMPARISON.md`](COMPARISON.md)). The harness now reads
this contract straight from `play.html`, so the test uses the shipped string verbatim.
