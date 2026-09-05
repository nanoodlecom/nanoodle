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
