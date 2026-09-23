# vendor/next-action — schema · bake · frequency baseline

| Product | Paths |
| --- | --- |
| · 2 | `schema.json`, `encode.mjs` |
| · 4 | `scripts/bake-next-action.mjs`, `corpus/gallery-synth.json` |
| · 3 | `frequency.mjs`, `corpus/frequency-tables.json`, `recommend.mjs` (baseline / optional blend) |

Soft ghost tips UI is **not** in this PR — stub/docs only. Learned MLP + smoke fixtures are Product · 1.

## Checks

```sh
node scripts/bake-next-action.mjs
node scripts/check-next-action-schema.mjs
node scripts/check-next-action-bake.mjs
node scripts/check-next-action-frequency.mjs
```

Product · N / Fun labels only. Never commit `.bin` under `vendor/next-action/`.
