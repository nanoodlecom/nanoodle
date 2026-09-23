# vendor/next-action — schema · bake · frequency · ring · cold-start · learned · export

| Product | Paths |
| --- | --- |
| · 2 | `schema.json`, `encode.mjs` |
| · 4 | `scripts/bake-next-action.mjs`, `corpus/gallery-synth.json` |
| · 3 | `frequency.mjs`, `corpus/frequency-tables.json`, `recommend.mjs` (baseline / optional blend) |
| · 5 | `ring.mjs` — flagged local action ring (memory / localStorage; local `export()` only) |
| · 6 | `cold-start.mjs`, `firstNode` / `firstTrio` in `corpus/frequency-tables.json`, empty-canvas tips + trio chips (`?product=6`) |
| · 1 | `scripts/train-next-action.py`, `fixtures/smoke-weights.json`, `scripts/check-next-action.mjs` |
| · 10 | `scripts/export-smallnet-weights.py`, `export-load.mjs`, catalog `next-action-v1` + `weightsUrl`, `?product=10` load-status badge |

Learned `.bin` weights stay **gitignored**; tests load inline float fixtures.
Real-editor soft tips: `editor-surface.mjs` mounts in `index.html` (`?product=1`…`6`, `10`).

## Train / export (box-local)

```sh
# Train (Product · 1)
python scripts/train-next-action.py \
  --corpus vendor/next-action/corpus/gallery-synth.json \
  --schema vendor/next-action/schema.json \
  --out /home/box/workspace/particlegan-product1-runs \
  --fixture vendor/next-action/fixtures/smoke-weights.json

# Export → browser drop path (Product · 10)
python scripts/export-smallnet-weights.py \
  --fixture vendor/next-action/fixtures/smoke-weights.json \
  --out-bin vendor/next-action/weights/next-action-v1.bin \
  --out-manifest vendor/next-action/weights/manifest.json \
  --roundtrip
```

`catalog.json` registers `next-action-v1` with
`weightsUrl: /vendor/next-action/weights/next-action-v1.bin`.
Without a local bin, `export-load.mjs` packs the smoke fixture (status `fixture`).

## Checks

```sh
node scripts/check-next-action-schema.mjs
node scripts/check-next-action-bake.mjs
node scripts/check-next-action-frequency.mjs
node scripts/check-next-action-ring.mjs
node scripts/check-next-action-cold-start.mjs
node scripts/check-next-action.mjs
node scripts/check-next-action-export.mjs   # Product · 10
node scripts/check-smallnet.mjs             # catalog registers ·1; no .bin in git
```

Product · N / Fun labels only. Never commit `.bin` under `vendor/next-action/`.
