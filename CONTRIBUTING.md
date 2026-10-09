# Contributing to nanoodle

## Share a workflow or a problem

If you use NanoGPT, your next useful app is a good contribution. Use the
[workflow form](https://github.com/nanoodlecom/nanoodle/issues/new?template=share-workflow.yml)
to share what it does and its full nanoodle share link. A short task
description is enough; run cost and whether you have used it again are
optional. The maintainer can review submissions for the examples or app
showcase with credit to the author.

For a failed run or a confusing step, use the
[problem form](https://github.com/nanoodlecom/nanoodle/issues/new?template=workflow-problem.yml).
Describe what you tried, what you expected, and what happened. A share
link is optional; a small reproducible example helps if it is safe to share.

GitHub issues are public after you submit them. A full share link contains
the graph and may include prompts, inputs, or samples. Remove private
material, API keys, and OAuth tokens before posting. The editor does not
send your workflow or feedback to GitHub automatically.

## Philosophy (read this first)

This repo is the site: nanoodle.com serves exactly these files as static
assets. The constraints are deliberate, not accidental:

- **No runtime dependencies to install.** There is **no `package.json`** for
  the site. The `check-*.mjs` guards use Node built-ins; the separate browser
  journey uses Playwright as development tooling outside the deployed files.
- **Two single-file apps.** `index.html` (the editor) and `play.html` (the
  app builder / exported-app runtime) each carry their entire UI and run
  engine inline. No bundler, no build step — what's in git is what ships.
- **The one vendored artifact** is `vendor/njs-engine.js` (plus its twin
  block inside `play.html`), generated from the sibling
  [nanoodle-js](https://github.com/nanoodlecom/nanoodle-js) repo — never
  edited by hand (see below).


## Client helper nets (`vendor/smallnet`)

nanoodle can run **tiny** on-device helper networks (layout hints, next-action
scores, canvas toys) without a server. The pipe lives in `vendor/smallnet/`:

- Pure JS MLP forward — no ONNX/TF.js, no CDN, CSP-safe.
- Manifest + registry; **weight `.bin` files are not shipped** (and are gitignored).
- `scripts/check-smallnet.mjs` guards the runtime and asserts the catalog stays empty of models until we intentionally add one.

Do not commit model weights. When a helper is ready, add a manifest with a
same-origin `weightsUrl` and the matching `.bin` via a deliberate release path.

Product · 1 (`vendor/next-action/`) uses that pipe for the learned recommender.
Confident scores mark rows in the editor’s existing menus (add node, wire-drop,
model picker). There is no separate next-action panel and no ghost preview.
Checks load inline float fixtures — never commit `.bin` packs under
`vendor/next-action/`. Schema / bake / frequency baseline are Product · 2 / · 4 / · 3.

## Running the check suite

The test suite is `scripts/check-*.mjs` — no browser or API spend. Most
checks are offline; the model and LoRA audits read public NanoGPT catalogs.
CI (`.github/workflows/checks.yml`) runs exactly this loop from the repo
root; run the same thing locally:

```sh
fails=0
for f in scripts/check-*.mjs; do
  node "$f" || fails=$((fails+1))
done
echo "$fails failed"
```

Run a single check the same way:

```sh
node scripts/check-pricing.mjs
```

Each check prints a `✓` line on success and exits non-zero on failure.

Checks that need the sibling `nanoodle-js` checkout (`check-js-parity.mjs`,
`gen-js-engine.mjs --check`) skip cleanly when it's absent. They look for it
at `../nanoodle-js` by default, or wherever `NANOODLE_JS` points:

```sh
NANOODLE_JS=/path/to/nanoodle-js node scripts/check-js-parity.mjs
```

CI always has the sibling checked out, so the skip path never hides drift on
main (`.github/workflows/engine-parity.yml` asserts it never fires).

The separate `.github/workflows/first-run.yml` installs Playwright outside
the site and exercises a fresh desktop/mobile visit through sample results,
Create app, sharing, HTML export, and a recipient starting NanoGPT OAuth.
All provider requests are intercepted: it does not complete a real sign-in
or buy inference. Its mobile case also simulates a retired starter model.
To use an existing local Playwright installation:

```sh
NANOODLE_PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/smoke-first-run.mjs
```

Set `NANOODLE_CHROMIUM` to a browser executable if needed, and
`NANOODLE_SMOKE_ARTIFACTS` to save screenshots when a journey fails.

## Regenerating the engine bundle

`play.html`'s `<script id="njs-engine">` block and `vendor/njs-engine.js`
are generated from the sibling nanoodle-js repo's `src/`. After nanoodle-js
changes land, regenerate:

```sh
node scripts/gen-js-engine.mjs          # rewrites play.html block + vendor file
node scripts/gen-js-engine.mjs --check  # verify only (what CI runs)
```

Both artifacts embed a `data-hash` of their own payload plus the sibling
commit stamp; `--check` regenerates in memory and fails on any drift. With
no sibling checkout, `--check` still verifies the shipped artifacts are
self-consistent (content matches `data-hash`, play block == vendor file).

## Pre-commit hook

Hooks live in `.githooks/` and are enabled per-clone with:

```sh
git config core.hooksPath .githooks
```

`.githooks/pre-commit` runs the subset of checks relevant to your staged
files (staging `index.html`/`play.html` triggers most of them). Don't bypass
it with `--no-verify` — CI runs the full suite unconditionally anyway.

## Changelog artifacts

`updates.json` is the source of truth for the in-app 📣 panel. `changelog.html`
and `feed.xml` are generated — do not edit them by hand. After editing
`updates.json`:

```sh
node scripts/gen-changelog.mjs
```

The pre-commit hook regenerates and stages those two files when `updates.json`
is in the commit, so a forgotten regen cannot land locally. CI runs
`gen-changelog.mjs --check` unconditionally (a named step in
`.github/workflows/checks.yml`).

### Usage clips on Updates entries

Most Updates entries have no clip. An entry gets one only if **both** of
these are true:

1. **The change is substantial and visible to users**, such as a new node,
   panel or workflow. Leave the clip off for small changes: a price or
   estimate fix, a model-default swap, a label or copy tweak, or a bug fix
   that's hard to see.
2. **The clip clearly and accurately shows exactly that entry's change.**
   Leave it off if the clip shows a different change, only one part of a
   bundled entry, or something the entry text doesn't claim. Also leave it
   off if it shows the change only in passing, or if its frames no longer
   match the current UI.

Check the actual frames before you add a clip. If you're unsure, leave it
off; an entry without a clip is fine.

For an entry that qualifies, reuse the real-editor usage GIF from the PR
description (committed under `docs/media/`). `docs/` is not deployed, so
add a re-encoded copy under `updates-media/` and do not link to the GIF:

```sh
ffmpeg -i docs/media/my-feature.gif -an \
  -vf "fps=12,scale='min(720,iw)':-2:flags=lanczos,format=yuv420p" \
  -c:v libx264 -preset veryslow -crf 23 -tune animation -movflags +faststart \
  updates-media/my-feature.mp4
ffmpeg -i updates-media/my-feature.mp4 -frames:v 1 -c:v libwebp -quality 72 updates-media/my-feature.webp
```

Then add the clip to that entry in `updates.json`. Use the clip's pixel
size for `w` and `h`:

```json
"media": { "src": "updates-media/my-feature.mp4", "poster": "updates-media/my-feature.webp", "w": 720, "h": 450 }
```

- **Hide account details.** Blur the balance in the recording, and keep
  out browser chrome, the dock and `localhost`.
- **One clip per entry.** `media` has no language, so all six languages
  show the same clip.

The editor loads a clip only while it is on screen in the panel. It plays
as a small muted loop, and a click opens it large. The changelog page shows
the poster, linking to the mp4.

#### Narrated clips (voiceover, captions, logo)

A qualifying clip should usually be narrated. `scripts/make-update-clip.mjs`
renders one from a small spec in `scripts/update-clips/<name>.json`:

- a short voiceover from NanoGPT TTS, timed to the on-screen actions;
- English captions burned into the picture, plus a WebVTT track for each
  language the spec translates;
- the nanoodle logo fading in as an intro and out as an outro;
- loudness normalized to −16 LUFS.

```sh
NANOGPT_API_KEY=… NANOODLE_PLAYWRIGHT=/path/to/playwright/index.mjs \
  node scripts/make-update-clip.mjs scripts/update-clips/decide-node.json \
  --source /path/to/raw-recording.webm --qa --attach
node scripts/gen-changelog.mjs
```

`--attach` writes `media` with `audio: true`, `captions: {en, es, …}` and
`burned: "en"`. In the 📣 panel the clip still loops muted. The enlarged
view plays it once with sound and shows the caption track for the UI
language, unless that language is the one burned into the picture.

How to write the voiceover:

- Use one or two short, warm lines that say what the viewer sees, as it
  happens. Start each cue as its action starts, and land the payoff line
  when the result appears on screen.
- Describe only what the clip shows. If the clip shows a sample result,
  don't say it was generated. Skip marketing words, prices and model
  names unless they are on screen.
- Use the UI's own words ("Run", "Decide node"). In each `i18n` line, use
  that language's UI label (es "Ejecutar", de "Ausführen", …).

The current voice is `elevenlabs/eleven-v4`, voice "Sarah". Keep that
voice so every clip sounds like the same narrator. To change it, render
one line with two or three voices, compare the takes, and keep the one
whose transcript matches exactly and whose pacing sounds natural.

`--qa` prints a checklist; go through all of it before you attach the
clip:

- [ ] Whisper's transcript matches the script (0% word error rate).
- [ ] Loudness is about −16 LUFS.
- [ ] In the contact sheet, every line lines up with its action, and the
      captions are readable and never cover the thing being shown.
- [ ] The logo intro and outro are clean.
- [ ] The balance is blurred, and no browser chrome or `localhost`
      appears.
- [ ] The clip is ≤ 1.5 MB.

`scripts/check-updates-media.mjs` runs in CI and in the pre-commit hook.
It fails if a referenced file is missing, sits outside `updates-media/`,
or is excluded by `.assetsignore`. It also fails on any of these:

- a clip over 1 MB (1.5 MB if narrated) or a poster over 100 KB
- an mp4 without `+faststart`
- an audio track without `audio: true`, or audio that isn't AAC
- a narrated clip without English WebVTT captions
- a `w`/`h` that does not match the poster
- a file in `updates-media/` that no entry references

## Deploys

Pushing to `main` triggers Cloudflare Workers Builds, which deploys the repo
root as static assets per `wrangler.jsonc` (`assets.directory: "."`).
Two details worth knowing:

- `.assetsignore` keeps non-site files (docs/, growth/, proof/, scripts/,
  shareassets/, README.md, `NANOGPT-*.md`, …) out of the deployed asset set.
  Anything in the repo root not listed there **is served publicly** — put
  internal notes in `docs/`.
- `scripts/stamp-sw.mjs` runs as the wrangler `build.command` and stamps
  `sw.js`'s cache name with the deploy's commit SHA so each release purges
  stale offline caches. Locally it's a no-op (no CI SHA present); nothing is
  committed back.

There's no local deploy step to run — a merged PR is a deploy.
