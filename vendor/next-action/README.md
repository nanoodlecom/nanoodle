# vendor/next-action — Product · 2 schema + Product · 4 gallery bake

- **Product · 2** — `schema.json` + `encode.mjs` (action/graph-sketch contract)
- **Product · 4** — `scripts/bake-next-action.mjs` + `corpus/gallery-synth.json`

Frequency baseline (· 3) and learned recommender (· 1) land in later stacked PRs.

## Bake

```sh
node scripts/bake-next-action.mjs
node scripts/check-next-action-schema.mjs
node scripts/check-next-action-bake.mjs
```

Product · N / Fun labels only. No `.bin` weights in tree.
