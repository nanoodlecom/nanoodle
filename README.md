# nanoodle

Small, self-contained AI web apps — each one is a single `.html` file that runs
entirely in the browser and talks straight to [NanoGPT](https://nano-gpt.com).
No server, no build step: open the file (or serve the folder) and go.

The UI is available in six languages — English, Español, Français, Deutsch,
Português and 日本語 — auto-detected from your browser with a manual switcher.

Each app handles its own auth (NanoGPT OAuth PKCE sign-in, or paste an API key)
and calls the model APIs directly from the browser. You pay per call on your own key.

Deployed as a static site on Cloudflare Pages (hub: **nanoodle.com**). `_redirects`
maps the clean URL `/app` → the editor; `/` serves the editor too.

## Apps

- **`index.html`** — **nanoodle**, a tiny ComfyUI-style node playground (the site
  root / `/app`). Wire primitives together (Text, Join, LLM, Image, Edit, Vision,
  Text→Video, Image→Video, Music, Speech), drag from port to port (compatible
  inputs glow and snap by type), run disconnected groups in parallel, and share a
  graph via URL. Live model pickers for every modality (text, image, video, audio),
  image editing, async video generation, TTS/music, and save/load to JSON.
- **`play.html`** — the **app builder ("Create app")**. Turns any nanoodle
  workflow into a standalone, shareable web app: auto-generated inputs → Run →
  outputs, restyle it with [gptdiff-js](https://github.com/255BITS/gptdiff-js),
  go fullscreen, share via `#a=` link, or export a self-contained `.html` (no key
  inside). Open it from the editor's **✨ Create app** button (served at `/play`).
- **`legal.html`** — terms, privacy, and FAQ (reachable at `/legal`).

## Running

Open any file directly, or serve the folder so OAuth redirects resolve cleanly:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000/   (the editor)
```

## Updates / changelog

`updates.json` is the in-app changelog the editor's **📣 Updates** button renders —
a newest-first array of `{ "date": "YYYY-MM-DD", "text": "one line" }`. No server,
no tracking: it ships as a static file, and "unseen" state is local-only.

The changelog is **opt-in, so internal churn never spams it.** Most commits stay
silent. When a commit is worth showing users, add an `Update:` line to its message
and the `post-commit` hook folds that one line into the same commit:

```
Feat: Inpaint node — brush a region and repaint

Update: New Inpaint node — paint over any part of an image and regenerate just that area
```

So the PR process is just: **when you ship something user-facing, write one polished
`Update:` line.** Commits without one — refactors, typos, growth notes — add nothing.

- **Edit / reword / reorder / delete:** `updates.json` is plain JSON — change it by
  hand anytime. A commit that hand-edits it is left alone (your line wins).
- **Add a line by hand:** `node scripts/add-update.mjs "2026-06-27" "Short line"`.
- Merge commits are skipped automatically. `scripts/check-updates.mjs` (run from
  `pre-commit`) keeps the file valid.
