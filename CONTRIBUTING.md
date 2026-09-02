# Contributing to nanoodle

## Philosophy (read this first)

This repo is the site: nanoodle.com serves exactly these files as static
assets. The constraints are deliberate, not accidental:

- **Dependency-free.** There is **no `package.json`** on purpose — no npm
  install, no lockfile, no supply chain. Every script and check runs on Node
  built-ins only (Node ≥ 20; CI uses 22). Please don't add one.
- **Two single-file apps.** `index.html` (the editor) and `play.html` (the
  app builder / exported-app runtime) each carry their entire UI and run
  engine inline. No bundler, no build step — what's in git is what ships.
- **The one vendored artifact** is `vendor/njs-engine.js` (plus its twin
  block inside `play.html`), generated from the sibling
  [nanoodle-js](https://github.com/nanoodlecom/nanoodle-js) repo — never
  edited by hand (see below).

## Running the check suite

The test suite is `scripts/check-*.mjs` — offline, no browser, no API spend.
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
