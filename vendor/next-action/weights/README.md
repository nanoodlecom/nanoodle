# next-action weights (local drop — gitignored)

Drop the Product · 1 / · 10 export here after running the recipe:

```sh
# From repo root (box or Pop!_OS):
python scripts/export-smallnet-weights.py \
  --fixture vendor/next-action/fixtures/smoke-weights.json \
  --out-bin vendor/next-action/weights/next-action-v1.bin \
  --out-manifest vendor/next-action/weights/manifest.json \
  --roundtrip

# Or from an existing train export:
python scripts/export-smallnet-weights.py \
  --bin /path/to/export/next-action-v1.bin \
  --manifest /path/to/export/manifest.json \
  --out-bin vendor/next-action/weights/next-action-v1.bin \
  --out-manifest vendor/next-action/weights/manifest.json
```

`catalog.json` registers `next-action-v1` with
`weightsUrl: /vendor/next-action/weights/next-action-v1.bin`.

**Never commit `.bin` files.** This directory’s binaries stay gitignored.
Without a local bin, the editor falls back to packing `fixtures/smoke-weights.json`.
