# vendor/next-action — schema · bake · frequency · ring · cold-start · learned

| Product | Paths |
| --- | --- |
| · 2 | `schema.json`, `encode.mjs` |
| · 4 | `scripts/bake-next-action.mjs`, `corpus/gallery-synth.json` |
| · 3 | `frequency.mjs`, `corpus/frequency-tables.json`, `recommend.mjs` (baseline / optional blend) |
| · 5 | `ring.mjs` — flagged local action ring (memory / localStorage; local `export()` only) |
| · 6 | `cold-start.mjs`, `firstNode` / `firstTrio` in `corpus/frequency-tables.json`, empty-canvas tips + trio chips (`?product=6`) |
| · 1 | `scripts/train-next-action.py`, `fixtures/smoke-weights.json`, `scripts/check-next-action.mjs` |
| · 17 | `dismiss-bandit.mjs` — accept/dismiss/undo tip QoS (`?product=17`); localStorage `nanoodle.nextAction.bandit.v1`; `scripts/check-next-action-dismiss-bandit.mjs` |

Learned `.bin` weights stay **gitignored**; tests load inline float fixtures.
Real-editor soft tips: `editor-surface.mjs` mounts in `index.html` (`?product=1`…`6`, `17`).
Catalog stays empty — no `weightsUrl` until a deliberate release.

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
node scripts/check-next-action-dismiss-bandit.mjs
node scripts/check-next-action.mjs
node scripts/check-smallnet.mjs   # catalog still empty
```

Product · N / Fun labels only. Never commit `.bin` under `vendor/next-action/`.
