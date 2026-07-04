# nanoodle

A node-graph playground for AI models that runs entirely in your browser.
Wire text, image, video, audio and LLM nodes into a workflow, run it, turn
it into a standalone app, share it as a URL, or export it as a single
self-contained `.html` file.

## Privacy architecture

nanoodle is three static HTML pages. There is no backend, and that is the
design, not a limitation:

- **No analytics, no tracking, no third-party scripts.** Nothing phones home.
  The only dependency that isn't hand-written is vendored into `vendor/` and
  served from the same origin — no CDNs, no external gateways.
- **Model calls go directly from your browser to [NanoGPT](https://nano-gpt.com)**
  on your own API key. nanoodle never sees your prompts, your outputs, or
  your key — there is no server to send them to.
- **Your key and your workflows live in your browser's localStorage.** Sign in
  via NanoGPT OAuth (PKCE) or paste an API key; either way the credential
  stays on your machine.
- **Exported apps are self-contained files with no key inside.** The person
  you send one to brings their own key. Share links (`#g=` / `#a=`) encode
  the graph in the URL fragment, which never reaches any server.
- A per-path Content-Security-Policy (`_headers`) pins which origins each
  page may talk to, so "no tracking" is enforced by the browser, not just
  promised in a README.

The privacy page at `/legal` states the same things in plain terms; this
repo is the proof.

## Hosted vs. self-hosted

**Hosted:** https://nanoodle.com serves exactly the files in this repo as a
static site (Cloudflare Pages / Workers assets — see `wrangler.jsonc`,
`_headers`, `_redirects`, `sw.js`). There is no server-side code; hosting
adds nothing but HTTPS and the CSP headers.

**Self-hosted:** serve the folder with any static file server:

```sh
python3 -m http.server 8000
# http://localhost:8000/        → the editor
# http://localhost:8000/play.html → the app builder
```

Notes for self-hosting:
- OAuth sign-in needs an `http(s)` origin; pasting an API key also works
  from plain `file://`.
- `_headers` and `_redirects` are Cloudflare conventions. On another host,
  reproduce the CSP headers yourself or skip them (the app works without,
  you just lose the browser-enforced guarantee).
- Exported `.html` apps are standalone and need no hosting at all.

## Referral codes

The default config routes 10% of usage as referral credits to the
maintainer. If you self-host, swap the key. Concretely, two things carry a
referral code:

- `invitation_code` in the OAuth authorize URL (`index.html`, `play.html`,
  search for `invitation_code`)
- the "create an account" links to `nano-gpt.com/r/...`

This costs you nothing — NanoGPT pays it out of their side, and per their
program, signing up through a referral link gives you a 5% discount. It
does credit the maintainer for accounts and usage originating here.
Replace the code with your own (or delete the parameter and use bare
`nano-gpt.com` links) if you'd rather not.

## The pages

- **`index.html`** — the editor (site root, `/app`). A ComfyUI-style node
  canvas: Text, Join, LLM, Image, Edit, Vision, video, music, speech and
  more. Drag port to port (compatible inputs glow and snap by type), run
  disconnected groups in parallel, share a graph via URL, save/load JSON.
  UI in six languages (EN/ES/FR/DE/PT/JA), auto-detected with a switcher.
- **`play.html`** — the app builder (`/play`, or ✨ **Create app** in the
  editor). Turns any workflow into a standalone app: auto-generated inputs
  → Run → outputs. Restyle it with
  [gptdiff-js](https://github.com/255BITS/gptdiff-js), share via `#a=`
  link, or export a self-contained `.html`.
- **`legal.html`** — terms, privacy, FAQ (`/legal`).

## Development

No build step. Edit the HTML files, refresh the browser.

`scripts/check-*.mjs` are offline pre-commit checks (wired via
`.githooks/`, `git config core.hooksPath .githooks`) covering the export
bundler, the OAuth flow, run-engine compatibility, pricing, i18n coverage
and more. They spend no API credits — everything runs against recorded
fixtures.

`updates.json` is the in-app changelog behind the 📣 button. It's opt-in
per commit: add an `Update: one polished line` to a commit message and the
`post-commit` hook folds it in. Commits without one stay silent. Edit the
JSON by hand anytime; `scripts/check-updates.mjs` keeps it valid.

## License

[MIT](LICENSE).
