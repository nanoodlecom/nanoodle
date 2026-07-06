# In-browser Private Mode PoC (EHBP, no proxy)

Companion to `docs/private-mode-exploration.md` (PR #265) — this is the **Phase 2 feasibility harness**: run NanoGPT Private Mode (TEE attestation + EHBP end-to-end encryption) entirely from page JavaScript, no `@nanogpt/private-mode` localhost proxy.

## Verdict (live-run 2026-07-05)

**The crypto is fully browser-viable today; the only blockers are two CORS header lines on NanoGPT's side.**

| Step | In-browser result |
|---|---|
| Attestation (fetch bundle → verify enclave → EHBP handshake) | ✅ `verified=true`, enclave `inference.tinfoil.sh`, **1.07 s**, from a real page |
| Cross-origin hosts touched (whole flow incl. chat) | **`nano-gpt.com` only** — no sigstore CDN, no enclave host. nanoodle's existing CSPs (even the play iframe's re-sealed one) already allow it; **zero CSP changes needed** for Phase 2 |
| Encrypted chat, proxy-identical headers | ❌ browser CORS preflight rejects: `x-nanogpt-private-model` (required — verified server won't run the EHBP response path without it) is not in `Access-Control-Allow-Headers` |
| Encrypted chat, CORS-allowed headers only | ❌ request lands, but `ehbp` client can't complete: `Missing Ehbp-Response-Nonce header` |
| Same flow from Node (no CORS) | ✅ 200, decrypted reply, `x-nanogpt-private-mode: tinfoil`, `ehbp-response-nonce` present, `x-tinfoil-usage-metrics: prompt=20,completion=4,total=24` |

## The exact ask for NanoGPT

On `/api/v1/private/tinfoil/*` (already `Access-Control-Allow-Origin: *`):

1. `Access-Control-Allow-Headers` += `x-nanogpt-private-model, x-nanogpt-private-stream`
2. `Access-Control-Expose-Headers` += `Ehbp-Response-Nonce, x-nanogpt-private-mode, tinfoil-enclave, x-tinfoil-usage-metrics, x-request-id`

(1) is fatal today: the model header is required server-side (without it the response comes back without the EHBP nonce, i.e. the private path never engages) but can't be sent cross-origin. (2) is equally fatal even after (1): `ehbp` must *read* `Ehbp-Response-Nonce` to decrypt the response, and browsers hide un-exposed headers — today only `WWW-Authenticate` is exposed. The usage/enclave headers are what would let nanoodle show live cost + a receipt-style "which enclave answered" chip.

Note the allow-list is a fixed set, not a reflector: preflighting `ehbp-encapsulated-key` or `x-team-id` echoes them back (someone already added the EHBP *request* header — browser support is clearly intended); the two `x-nanogpt-private-*` headers just aren't on the list yet.

## Files

- `index.html` — the PoC page: loads the bundle, runs attestation, attempts the chat both ways, reports precise failures. Reads `window.NANOGPT_API_KEY` (injected by the driver — never committed).
- `tinfoil-browser.min.js` — `tinfoil@1.1.3` browser entry, bundled: **384 KB min / 119 KB gzip**. Rebuild:
  ```sh
  npm i tinfoil@1.1.3 esbuild
  printf "export { SecureClient } from 'tinfoil';" > entry.mjs
  npx esbuild entry.mjs --bundle --format=esm --platform=browser --minify \
    --external:zlib --alias:tinfoil=./node_modules/tinfoil/dist/index.browser.js \
    --outfile=tinfoil-browser.min.js
  ```
  (`--external:zlib` is safe: the verifier's only `zlib` import is a Node fallback behind a `DecompressionStream` feature check, and all browsers have `DecompressionStream`.)
- `run.mjs` — driver: serves this dir on a fresh localhost port, launches its own headless Edge over CDP (never the shared :9222 — it can't reach Bash-launched servers), injects the key from the repo `.env`, prints the page log, structured results, and every cross-origin host observed via `Network.requestWillBeSent`.

## Run it

```sh
node proof/private-mode/run.mjs   # repo root; needs NANOGPT_API_KEY in .env; spends <$0.01
```

## What this means for the product

Phase 2 ("Private mode" as a one-toggle, zero-install feature using the user's already-pasted key) is **not blocked on any nanoodle architecture problem** — not CSP, not bundle size, not WebCrypto. It is blocked solely on the two header lines above. Recommended sequence stands: ship Phase 1 (proxy support, works today) while asking NanoGPT for the headers; when they land, Phase 2 is mostly UI + the `genChat` branch + vendoring discipline (pin + hash, attestation-fail ⇒ refuse to send).
