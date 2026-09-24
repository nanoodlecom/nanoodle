# vendor/next-action — schema · bake · frequency · ring · cold-start · learned

| Product | Paths |
| --- | --- |
| · 2 | `schema.json`, `encode.mjs` |
| · 4 | `scripts/bake-next-action.mjs`, `corpus/gallery-synth.json` |
| · 3 | `frequency.mjs`, `corpus/frequency-tables.json`, `recommend.mjs` (baseline / optional blend) |
| · 5 | `ring.mjs` — flagged local action ring (memory / localStorage; local `export()` only) |
| · 6 | `cold-start.mjs`, `firstNode` / `firstTrio` in `corpus/frequency-tables.json` (library + checks; no chips on the canvas) |
| · 1 | `scripts/train-next-action.py`, `fixtures/smoke-weights.json`, `scripts/check-next-action.mjs`, `hints.mjs` |

Learned `.bin` weights stay **gitignored**; tests load inline float fixtures.
The editor reads scores from `editor-surface.mjs` and shows them inside existing
menus (add-node, wire-drop quick-add, model picker). There is no floating
next-action panel and no ghost node. `?product=` does not mount one.
`?na=0` or `?product=off` disables hints; a failed load does the same, and
menus stay unchanged. Catalog stays empty — no `weightsUrl` until a deliberate release.

## Train / export (box-local)

```sh
python scripts/train-next-action.py \
  --corpus vendor/next-action/corpus/gallery-synth.json \
  --schema vendor/next-action/schema.json \
  --out /home/box/workspace/particlegan-product1-runs \
  --fixture vendor/next-action/fixtures/smoke-weights.json
```

## Checks

```sh
node scripts/check-next-action-schema.mjs
node scripts/check-next-action-bake.mjs
node scripts/check-next-action-frequency.mjs
node scripts/check-next-action-ring.mjs
node scripts/check-next-action-cold-start.mjs
node scripts/check-next-action.mjs
node scripts/check-smallnet.mjs   # catalog still empty
```

Product · N / Fun labels only. Never commit `.bin` under `vendor/next-action/`.
