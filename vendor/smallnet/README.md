# vendor/smallnet — tiny client-side nets

Scaffolding so nanoodle can run **small** helper networks in the browser
(layout snap, next-action hints, canvas toys, …) without a server and without
pulling ONNX Runtime or TF.js.

## What this is

- Pure JS MLP forward (`Float32Array` only) — CSP-safe, no WASM, no CDN.
- A **registry + manifest** format for weight packs.
- **Product · 10** registers `next-action-v1` in `catalog.json` with a
  `weightsUrl`. The `.bin` itself stays **gitignored** — drop it locally or
  fall back to packing `fixtures/smoke-weights.json` (see
  `vendor/next-action/export-load.mjs`).

## Quick use

```js
import { bootstrapSmallnet, ModelNotAvailableError } from "/vendor/smallnet/index.js";

const reg = await bootstrapSmallnet();
try {
  const session = await reg.load("next-action-v1");
  session.run(new Float32Array(83));
} catch (e) {
  if (e instanceof ModelNotAvailableError) {
    // No local .bin — use export-load fixture fallback or installWeights()
  }
}
```

Inline weights (tests / local experiments):

```js
import { packWeights, createSession } from "/vendor/smallnet/index.js";
const session = createSession(manifest, packWeights(manifest, arrays));
```

## Export recipe (Product · 10)

Pop!_OS / box → browser path:

```sh
python scripts/export-smallnet-weights.py \
  --fixture vendor/next-action/fixtures/smoke-weights.json \
  --out-bin vendor/next-action/weights/next-action-v1.bin \
  --out-manifest vendor/next-action/weights/manifest.json \
  --roundtrip
```

Also accepts an existing SNM1 `--bin` + `--manifest`. See `--help`.
Drop path: `vendor/next-action/weights/` (binaries gitignored).

## Weight blob layout (`smallnet-mlp-v1`)

Little-endian binary:

1. Magic `SNM1` (4 bytes)
2. `u32` version (= 1)
3. For each linear layer in order: `W` row-major (`out * in` f32) then `b` (`out` f32)

See `packWeights()` / `unpackWeights()` in `runtime.js`.

## Deliberate non-goals (for now)

- No ONNX / ORT-web / TF.js (heavy; CSP + vendor policy).
- No `.bin` weight files committed under `vendor/smallnet/` or `vendor/next-action/`.
