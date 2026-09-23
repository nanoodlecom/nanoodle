# vendor/next-action — schema · bake · frequency · ring · cold-start

| Product | Paths |
| --- | --- |
| · 2 | `schema.json`, `encode.mjs` |
| · 4 | `scripts/bake-next-action.mjs`, `corpus/gallery-synth.json` |
| · 3 | `frequency.mjs`, `corpus/frequency-tables.json`, `recommend.mjs` (baseline / optional blend) |
| · 5 | `ring.mjs` — flagged local action ring (memory / localStorage; local `export()` only) |
| · 6 | `cold-start.mjs`, `firstNode` / `firstTrio` in `corpus/frequency-tables.json`, empty-canvas tips + trio chips on `editor-surface.mjs` (`?product=6`) |

Learned MLP + smoke fixtures are Product · 1. No `weightsUrl` / `.bin` here.

## Layout

| Path | Role |
| --- | --- |
| `schema.json` | Product · 2 contract (vocab, sketch, intent-fork tags, encode sizes) |
| `encode.mjs` | History + graph sketch → `Float32Array` (+ smallnet manifest helper) |
| `frequency.mjs` / `recommend.mjs` | Product · 3 frequency baseline |
| `ring.mjs` | Product · 5 local ring (capacity 48; flagged persist; local export) |
| `cold-start.mjs` | Product · 6 empty-canvas seeds + first-trio helpers |
| `editor-surface.mjs` | Real-editor panel (`?product=2`…`6`) |
| `corpus/gallery-synth.json` | Product · 4 bake output |
| `corpus/frequency-tables.json` | Product · 3 / · 6 frequency + cold-start tables |

## Checks

```sh
node scripts/bake-next-action.mjs
node scripts/check-next-action-schema.mjs
node scripts/check-next-action-bake.mjs
node scripts/check-next-action-frequency.mjs
node scripts/check-next-action-ring.mjs
node scripts/check-next-action-cold-start.mjs
```

Product · N / Fun labels only. Never commit `.bin` under `vendor/next-action/`.
