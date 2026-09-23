# vendor/next-action — schema · bake · frequency · ring · cold-start · learned · port-suggest

| Product | Paths |
| --- | --- |
| · 2 | `schema.json`, `encode.mjs` |
| · 4 | `scripts/bake-next-action.mjs`, `corpus/gallery-synth.json` |
| · 3 | `frequency.mjs`, `corpus/frequency-tables.json`, `recommend.mjs` (baseline / optional blend) |
| · 5 | `ring.mjs` — flagged local action ring (memory / localStorage; local `export()` only) |
| · 6 | `cold-start.mjs`, `firstNode` / `firstTrio` in `corpus/frequency-tables.json`, empty-canvas tips + trio chips (`?product=6`) |
| · 1 | `scripts/train-next-action.py`, `fixtures/smoke-weights.json`, `scripts/check-next-action.mjs` |
| · 7 | `port-suggest.mjs`, `corpus/port-suggest.json` — ghost-wire tips from Examples edge/port freqs (`?product=7`) |

Learned `.bin` weights stay **gitignored**; tests load inline float fixtures.
Real-editor soft tips: `editor-surface.mjs` mounts in `index.html` (`?product=1`…`7`).
Catalog stays empty — no `weightsUrl` until a deliberate release.

## Train / export (box-local)

```sh
python scripts/train-next-action.py \
  --corpus vendor/next-action/corpus/gallery-synth.json \
  --schema vendor/next-action/schema.json \
  --out /home/box/workspace/particlegan-product1-runs \
  --fixture vendor/next-action/fixtures/smoke-weights.json
```

## Layout

| Path | Role |
| --- | --- |
| `schema.json` | Product · 2 contract (vocab, sketch, intent-fork tags, encode sizes) |
| `encode.mjs` | History + graph sketch → `Float32Array` (+ smallnet manifest helper) |
| `frequency.mjs` / `recommend.mjs` | Product · 3 frequency baseline |
| `ring.mjs` | Product · 5 local ring (capacity 48; flagged persist; local export) |
| `cold-start.mjs` | Product · 6 empty-canvas first-node / first-trio tips |
| `port-suggest.mjs` | Product · 7 dangling-port → ranked ghost wires (type/port freqs; no learned weights) |
| `corpus/port-suggest.json` | Baked gallery edge tables (type→type, port pairs, topTargets, portCatalog) |
| `editor-surface.mjs` | Real-editor panel (`?product=1`…`7`: learned, schema, tips, ring, cold-start, ghost wires) |

## Checks

```sh
node scripts/check-next-action-schema.mjs
node scripts/check-next-action-bake.mjs
node scripts/check-next-action-frequency.mjs
node scripts/check-next-action-ring.mjs
node scripts/check-next-action-cold-start.mjs
node scripts/check-next-action.mjs
node scripts/check-next-action-port-suggest.mjs
node scripts/check-smallnet.mjs   # catalog still empty
```

Product · N / Fun labels only. Never commit `.bin` under `vendor/next-action/`.
