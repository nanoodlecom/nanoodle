# Visual match: built nanoodle apps vs. the gptdiff‑js originals

I screenshotted each built app and its original (headless chromium, both served locally), then used
**the diff tool with `zai-org/glm-5.2:thinking`** to push the built apps as close to the originals as
possible. Side‑by‑side images (left = first build, middle = diff‑matched, right = original) are in
[`proof/shots/compare-*.png`](shots/).

## How close the diff tool gets

| Example | Diff tool **reaches** (shell/CSS) | Stays **out of reach** (structural → a missing buildable) |
|---|---|---|
| **pictureme** | gradient "Picture Me As…" title, warm dark theme + glow, amber **Transform** button, matching tagline, "Made with NanoGPT" footer | the dashed **photo drop‑zone**, the **look‑chips** (Renaissance/Cyberpunk/…), **Fuse vs Transform‑each**, the **N‑up result grid** → **G6 fanout/chips** |
| **comic** | "Inkflight // AI Comic Studio", inky teal/amber + halftone, **Render Page** button, spec cards, footer | the **file‑tabs** (`config.json` / `panels/*.json`), the **goal → Apply** gptdiff pane, the live **render preview** → **G1 runtime‑instruct + G2 multi‑file** |
| **marvis** | cyan **MARVIS** wordmark with HUD **corner‑brackets**, "MOOD · DORMANT" badge, mono theme, **▶ Continue** button | the **portrait‑orb avatar**, the **RPG chat stage**, **save / share / clear**, persisted history → **G5 state + chat‑render** |

**The ceiling is consistent:** the diff tool reliably nails *identity, theme, copy, primary‑action
label, footer, and a thematic badge* — the parts of the app that live in the editable shell
(`index.html` + `app.css`). It **cannot** add the originals' signature *interaction structures*,
because those are runtime/functional, not styling — they are exactly the missing primitives from
[`REPORT.md`](REPORT.md) (fanout, runtime‑instruct, multi‑file, state). Asking the diff tool for them
wastes prompt budget and gets ignored, since the form controls are injected by `NoodleApp.mount()` at
runtime and the diff only edits the shell CSS.

## Suggested better prompt for the diff tool

**Shorter is better — and it's shorter precisely because you drop the asks the diff tool can't honor.**
Spend the whole prompt on what lives in the shell; never ask for chips/drop‑zones/tabs/avatars/grids.

```
Reskin as <example>: <≤6‑word vibe>, <one accent> accent.
Match its title, tagline, button label and footer; keep the controls.
```

Validated fills (each one short prompt, one pass, `zai-org/glm-5.2:thinking`):

- **pictureme** — `Reskin as the "Picture Me As…" demo: warm photo‑booth, amber accent. Match title, tagline, Transform button, NanoGPT footer; keep the controls.`
- **comic** — `Reskin as the AI‑liftoff comic studio: inky noir + teal/amber, halftone. Match title, copy, a bold Render Page button, footer; keep the controls.`
- **marvis** — `Reskin as MARVIS: cinematic cyan/amber HUD, mono. Match title, tagline, mood badge, Continue button; keep the controls.`

**Rules that make it land (and stay short):**
1. **Name the target + ≤6‑word vibe + exactly one accent colour.** That alone fixes identity, palette and copy — ~80% of the visible gap.
2. **List only shell regions:** title, tagline, button label, footer, an optional badge.
3. **End with "keep the controls"** so the diff never touches the wired Run/inputs/outputs.
4. **Do NOT ask for structural elements** (chips, drop‑zone, file‑tabs, avatar, result grid). They're the *missing buildables*, not a styling job — and the moment those primitives ship (fanout/instruct/state), this **same** short prompt reaches them for free, because they'll be real shell regions the diff can style.

So the "better prompt" doubles as a gap map: everything it deliberately omits is precisely the
feature work that turns these partials into full‑fidelity builds.
```
built  |  diff‑matched (glm‑5.2‑thinking, short prompt)  |  original
proof/shots/compare-pictureme.png
proof/shots/compare-comic.png
proof/shots/compare-marvis.png
```
