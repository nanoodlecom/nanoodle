# vendor/smallnet — tiny client-side nets (no models shipped yet)

Scaffolding so nanoodle can run **small** helper networks in the browser
(layout snap, next-action hints, canvas toys, …) without a server and without
pulling ONNX Runtime or TF.js.

## What this is

- Pure JS MLP forward (`Float32Array` only) — CSP-safe, no WASM, no CDN.
- A **registry + manifest** format for future weight packs.
- **No weight files in this repo.** Manifests may list a `weightsUrl`; until
  that URL exists, `load()` stays unloaded and `run()` throws a clear error.

## Quick use (when a model exists)

```js
import { SmallnetRegistry } from "/vendor/smallnet/index.js";

const reg = new SmallnetRegistry();
reg.register({
  id: "demo-mlp",
  version: "0",
  format: "smallnet-mlp-v1",
  inputSize: 4,
  outputSize: 2,
  layers: [
    { type: "linear", in: 4, out: 8, activation: "relu" },
    { type: "linear", in: 8, out: 2, activation: "linear" },
  ],
  // Point at a same-origin `.bin` once we ship one. Leave null for now.
  weightsUrl: null,
});

// With inline weights (tests / local experiments only — not for shipping):
import { packWeights, createSession } from "/vendor/smallnet/index.js";
const session = createSession(manifest, packWeights(manifest, arrays));
const out = session.run(new Float32Array([0, 1, 0, 1]));
```

## Weight blob layout (`smallnet-mlp-v1`)

Little-endian binary:

1. Magic `SNM1` (4 bytes)
2. `u32` version (= 1)
3. For each linear layer in order: `W` row-major (`out * in` f32) then `b` (`out` f32)

See `packWeights()` / `unpackWeights()` in `runtime.js`.

## Deliberate non-goals (for now)

- No ONNX / ORT-web / TF.js (heavy; CSP + vendor policy).
- No model files under `vendor/smallnet/` or `/models` in git.
- No editor UI wiring in this PR — just the runnable pipe.
