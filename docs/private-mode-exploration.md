# NanoGPT Private Mode × nanoodle — exploration

*2026-07-05 · status: exploration (no product code changes in this PR) · everything marked **verified** below was live-probed against `@nanogpt/private-mode@0.1.4` and the real `https://nanoodle.com` origin in Edge 149.*

## TL;DR

NanoGPT shipped [`@nanogpt/private-mode`](https://www.npmjs.com/package/@nanogpt/private-mode) — an official localhost proxy that runs chat completions through an attested TEE with **end-to-end encryption, so NanoGPT itself cannot read prompts or completions**. It is OpenAI-compatible at `http://127.0.0.1:8787/v1` and has first-class support for browser clients via an explicit origin allowlist.

**Verdict: integration is viable and cheap, and it completes nanoodle's pitch.** Today we promise "no servers, your key stays in your browser — only NanoGPT sees your data." With Private Mode the last clause drops: *nobody* sees your data. The whole browser path already works end-to-end (verified below); the only things standing between us and shipping are one CSP line per route, a `private/*` routing branch in `genChat` (×2 engines), and a small opt-in settings UI.

Recommended: ship **Phase 1** (proxy-aware LLM node behind an opt-in toggle, ~1 day of work) and file **Phase 2** (zero-proxy, in-browser encryption via tinfoil's official browser build) as a follow-up spike.

---

## 1. What the package is (verified)

- Official NanoGPT package (`developer@nano-gpt.com`), MIT, first published 2026-06-04, latest **0.1.4** (2026-06-30). ~47 KB unpacked, one dependency: `tinfoil@1.1.3`.
- `NANOGPT_API_KEY=sk-… npx @nanogpt/private-mode` → OpenAI-compatible server on `http://127.0.0.1:8787/v1`.
- On boot it fetches NanoGPT's attestation bundle, verifies the enclave via the Tinfoil verifier, then encrypts every request body with EHBP/HPKE against the attested enclave key. NanoGPT sees: account, chosen model, timing, sizes, status, usage metadata. NanoGPT cannot see: message content, completions.
- **Verified live:** attestation verified against enclave `router.inf6.tinfoil.sh`; a non-streaming and a streaming chat completion both returned normal OpenAI JSON/SSE with `x-nanogpt-private-mode: tinfoil` on the response.
- Endpoints: `POST /v1/chat/completions`, `GET /v1/models`, `GET /v1/private-mode/status` (rich JSON incl. attestation state + allowed origins), `GET /v1/private-mode/attestation`, `GET /health`.
- 9 private models in 0.1.4 (`GET /v1/models` is the source of truth — the README already lags it, so never hardcode):
  `private/kimi-k2-6`, `private/gpt-oss-120b`, `private/llama3-3-70b`, `private/glm-5-2`, `private/glm-5-2:thinking`, `private/gemma4-31b`, `private/gemma4-31b:thinking`, `private/deepseek-v4-pro`, `private/deepseek-v4-pro:thinking`.
- All are **text→text only** (chat). No image/video/audio/vision.
- The **API key lives in the proxy's env, not in the request**: the proxy ignores incoming `Authorization` headers and signs upstream calls with its own `NANOGPT_API_KEY`. (Verified: chat with no auth header at all succeeds.)

### Browser client support (the part that matters for us)

- The proxy only accepts loopback connections, and rejects any browser `Origin` that isn't allowlisted (403 `origin_not_allowed`). Allowlist via `--allow-origin https://nanoodle.com` or `NANOGPT_PRIVATE_ALLOWED_ORIGINS`. Wildcards refused.
- **Verified:** with `https://nanoodle.com` allowlisted, preflight (`OPTIONS`) returns proper `access-control-allow-origin: https://nanoodle.com` + methods/headers/max-age, and real fetches get the ACAO header. `Origin: https://evil.example` → 403.
- `Origin: null` is explicitly rejected → **`file://` exported apps cannot use the proxy** (see §5).

### Request contract (from `lib/requestTransforms.js`)

Good news for our `genChat` options: `response_format` (JSON mode — used by structured nodes), `temperature`, `max_tokens`, `reasoning_effort` are all supported. `reasoning_effort`/`:thinking` suffixes are mapped per-model to the right `chat_template_kwargs`. `json_schema` is downgraded to `json_object` + an injected system instruction. Unknown body fields are stripped. Max request body 25 MB.

---

## 2. The decisive browser experiment (verified end-to-end)

From a **real, live `https://nanoodle.com` page** in headless Edge 149, `fetch('http://127.0.0.1:8787/…')` was tested under varying conditions. Result: exactly **two gates**, both now precisely characterized, and with both opened the full flow works:

| Gate | Finding |
|---|---|
| **Our CSP** | `connect-src … https:` does **not** match `http://127.0.0.1`. Verified blocked with the exact console error. Needs `http://127.0.0.1:8787 http://localhost:8787` added to `connect-src` on the editor + play routes (and the srcdoc iframe's `PREVIEW_CSP` if the play engine calls from inside the iframe). Harmless when no proxy is running. |
| **Chrome Local Network Access** | With CSP satisfied, Chrome (139+, incl. Edge 149) gates public-site→loopback fetches behind the LNA *permission prompt* ("allow this site to access devices on your local network"). Headless auto-denies (verified error: ``Permission was denied for this request to access the `loopback` address space``); headed browsers show a one-time Allow/Block prompt per origin. Our UI copy must tell the user to click Allow. |

Non-gates, also verified:

- **`upgrade-insecure-requests`** (in every one of our CSPs) does **not** rewrite loopback URLs — the request stayed `http:` (had it been upgraded it would have matched `https:` and died on TLS instead of CSP). No CSP surgery needed there.
- **Mixed content**: Chromium treats `http://127.0.0.1` as potentially trustworthy — no mixed-content block from an https page. (Safari historically does block this; needs a headed Safari check before we claim support there. Firefox has no LNA prompt yet and treats loopback as trustworthy.)
- **CORS**: with the origin allowlisted, preflight + response headers are correct out of the box.

With CSP allowed and LNA granted, all three succeeded from the nanoodle.com page: model list, encrypted non-streaming chat (`"browser e2e ok"` round-trip), and SSE streaming.

---

## 3. Why this is worth doing (product)

nanoodle's trust ladder today:

1. **nanoodle** never sees anything (no servers, no analytics — the core promise).
2. **NanoGPT** sees every prompt and output, because it runs the models.

NanoGPT already lists ~20 `TEE/*` chat models in the public catalog (attested enclaves, usable in the LLM node **today** with zero work from us — worth checking that the picker doesn't bury them). But on that path NanoGPT still relays plaintext. Private Mode closes the loop:

> **"Build AI apps where *nobody* — not us, not even the API provider — can read your data."**

No other node-graph tool can say this sentence. It's a genuinely differentiated story for exactly the communities we court (r/selfhosted, privacy, local-first) — and it's NanoGPT's own newly-launched feature, so a nanoodle integration is co-marketing they have every reason to amplify.

The realistic audience is a privacy-conscious minority — but it's a *loud, evangelizing* minority, and the feature is cheap. Also: since the proxy holds the key, an **LLM-only graph can run with no API key in the browser at all** — a nice hardening story for shared machines.

---

## 4. Proposed integration — Phase 1 (proxy-aware LLM node)

Smallest shippable slice; everything is opt-in and degrades to exactly today's behavior when no proxy is present.

1. **Settings toggle** "🔒 Private mode proxy" (default OFF). When turned on, the editor probes `GET http://127.0.0.1:8787/v1/private-mode/status` and shows attestation state (`verified ✓ · enclave router.inf6.tinfoil.sh`) plus the models it serves. **Never probe localhost unless the user opts in** — silent localhost port-scanning from a website is exactly the behavior privacy-minded users despise, and it would trip the LNA prompt out of nowhere. First enable also needs one line of copy: "your browser will ask permission to reach the local proxy — click Allow", plus the copy-pasteable launch command with `--allow-origin https://nanoodle.com` baked in.
2. **Model picker**: when the toggle is on and the probe succeeds, the LLM node's chat-model picker grows a pinned "🔒 Private (via local proxy)" group, populated from the proxy's `/v1/models` (never hardcoded — 0.1.4's README already disagrees with its own model list).
3. **Routing**: in `CTX.genChat`, if the node's model id starts with `private/` → POST to `http://127.0.0.1:8787/v1/chat/completions`, omit the `Authorization` header (proxy ignores it; no reason to hand the browser key to anything, even loopback). Everything else unchanged. **Dual-engine parity**: the same branch goes into the play.html `RUNTIME_JS` twin — this is the classic recurring miss.
4. **CSP**: add `http://127.0.0.1:8787 http://localhost:8787` to `connect-src` for `/`, `/index.html`, `/app`, `/editor`, `/play`, `/play.html` in `_headers`, and to the play srcdoc `PREVIEW_CSP` + the exported-app template CSP. This does **not** weaken the play anti-exfiltration gate: loopback is the user's own machine, and nothing answers unless the user deliberately started the proxy with our origin allowlisted. (`check-policy` golden will need `GOLDEN_UPDATE=1`.)
5. **Model field guards**: private models are text-only → hide the LLM node's `img*` vision ports for them, and exclude `private/*` from any shape-changing swap lists (settings-vs-ioSignature boundary: this is a `deriveSettings()` concern, shape stays text→text).
6. **Errors**: proxy unreachable mid-run → "private proxy not reachable — restart it (`npx @nanogpt/private-mode`) or pick a non-private model". LNA denial surfaces as a plain `TypeError: Failed to fetch` after a CSP-clean setup, so the toggle's probe failure copy should mention the browser permission explicitly.
7. **Cost/balance plumbing** (accept, don't build around): private responses carry **no `x_nanogpt_pricing` and no `x-remaining-balance`** (verified). Pricing: bill lands under the `billingModel` (`TEE/<name>`); the public catalog has prices for 4 of the 9 today (`TEE/gemma4-31b` $0.45/$1.00 per M, `TEE/deepseek-v4-pro` $1.50/$5.25, `TEE/gpt-oss-120b` and `TEE/llama3-3-70b` $2/$2) but **not** `TEE/kimi-k2-6` / `TEE/glm-5-2` yet. Map `private/x` → `TEE/x` in the pricing resolver, show "price unknown" for the rest, and let the balance chip refresh on the next direct NanoGPT call as it already does. Streaming runs are precharged with a reserve and refunded after verified usage — same family as the Remix node's charge-at-submit contract.
8. **describe-changes copilot**: `streamingCallLlm` already takes a `baseUrl` — pointing it at the proxy gives us a *fully private graph copilot* nearly for free. Nice second slice, same PR family.

Estimated effort: ~1 focused day including the pre-commit harness stubs and a CDP verify run (the LNA grant is scriptable via CDP `Browser.grantPermissions` + `--disable-features=LocalNetworkAccessChecks` for headless verification — both used in this exploration).

## 5. Sharp edges & non-goals

- **Exported apps on `file://` cannot participate** — the proxy hard-rejects `Origin: null`. Exported apps served over `http://localhost:<port>` work fine (user adds `--allow-origin http://localhost:<port>`; loopback→loopback also skips the LNA prompt entirely). Document, don't fight.
- **Safari**: likely blocked (mixed-content treatment of loopback). Chrome/Edge = prompt; Firefox = works silently today. Phase 1 copy should say "Chrome, Edge or Firefox".
- **Text chat only.** No Draw-node image-out (needs `gemini-3-pro-image-preview`, not in TEE), no vision inputs, no image/video/audio/speech nodes. Private mode covers the LLM brain of a graph, not its senses. Don't imply otherwise in copy.
- **Setup friction is real**: Node ≥20 + a terminal command + a browser prompt. This is a power-user feature; the toggle copy should own that honestly rather than pretend it's one-click.
- **Proxy availability ≠ attestation success**: status can return with `verified:false` + error. Treat unverified as *down* (never send prompts to an unverified tunnel — that would invert the entire promise).
- Model list drift between proxy versions is guaranteed (0.1.4's README vs its own JSON already differs) — always enumerate from `/v1/models`.

## 6. How the crypto works — and what could leak

The question every skeptical reader (and every r/selfhosted commenter) will ask: *if the browser encrypts, doesn't it hold a key that could be exposed?* The answer is that **there is no long-lived secret on the client side at all.** EHBP is HPKE (hybrid public-key encryption):

1. **The decryption key is born inside the enclave and never leaves.** The TEE generates its keypair in hardware; the private half physically stays there. NanoGPT, Tinfoil, nanoodle — nobody holds it.
2. **The client fetches the enclave's *public* key and verifies it before trusting it.** This attestation step is the security core: the key is bound to a report signed by the CPU vendor's hardware root of trust, proving it was minted inside genuine TEE hardware running exactly the measured, sigstore-published code. Without this, NanoGPT could substitute its own public key and read everything — attestation is what makes that impossible.
3. **Every request uses a throwaway key.** The client generates an ephemeral keypair, encapsulates against the enclave's public key (the encapsulated key rides openly in a request header — useless without the enclave's private half, per the `ehbp` source), derives a symmetric key, encrypts the body. Responses come back encrypted with a per-response nonce.

So the only client-side secrets are the ephemeral request key and its derived symmetric key — in memory for one request, then gone. In-browser they'd live in the same page memory that already holds the user's prompts and NanoGPT API key: nothing that couldn't already steal everything gains anything new, and per-request keys mean a compromise tomorrow can't decrypt today's traffic.

Two trust facts to state honestly in any copy:

- **The API key is not hidden by any of this** — `ehbp` encrypts bodies "while preserving HTTP headers for routing," so `Authorization` travels (TLS-protected) to nano-gpt.com exactly as it does on every current call, because billing needs it. Private Mode hides *content*, not *identity*. Same in both the proxy and in-browser paths; the key goes nowhere new.
- **Whoever runs the verification code is the trust anchor.** Proxy path: NanoGPT's auditable npm package on the user's machine. In-browser path: the tinfoil verifier inside *our served bundle* — users already extend that trust by pasting a key into us, but it makes two rules non-negotiable: pin + hash the vendored crypto, and **attestation failure = refuse to send** (never fall back to plaintext behind a 🔒).

## 7. Phase 2 (spike, separate PR): zero-proxy private mode

`tinfoil@1.1.3` ships an **official browser build** (`exports.browser` → `index.browser.js`, with `@freedomofpress/sigstore-browser`, `ehbp`; ~2 MB unpacked source across the four packages, no WASM files) — NanoGPT's own web app does attestation + EHBP entirely in the browser (`browser_frontend_local_proxy_required: false` in the status contract). nanoodle could do the same: vendor a tinfoil browser bundle (patchling precedent) and offer Private Mode with **zero install, zero terminal, zero LNA prompt** — the full "nobody can read your data" story at one-toggle friction, with the user's existing pasted key.

- Editor CSP already allows `connect-src https:` → enclave hosts (`*.tinfoil.sh`, dynamic) and the attestation bundle (`nano-gpt.com`) are reachable **today** with no CSP change.
- The play srcdoc iframe re-seals `connect-src` to `'self' blob: nano-gpt.com` — widening it to `https:` would gut the anti-exfiltration gate, so in play/exported contexts the encrypted call must run in the trusted parent (bridge), not the app iframe. That's a real design task; hence: spike, not slice.
- Open questions for the spike: bundle size once built+minified; `String.raw`/no-backtick constraint if any of it must ride inside `RUNTIME_JS`; auditability of vendored crypto (pin version + document hash, same discipline as the receipts CLI `npx @nanogpt/private-mode verify`).

## 8. Verification transcript (for reproducibility)

- Proxy: `NANOGPT_API_KEY=… NANOGPT_PRIVATE_ALLOWED_ORIGINS=https://nanoodle.com npx @nanogpt/private-mode` → boot log shows attestation verified.
- `curl -X OPTIONS -H "Origin: https://nanoodle.com" http://127.0.0.1:8787/v1/chat/completions` → 204 + correct CORS headers; evil origin → 403.
- `curl http://127.0.0.1:8787/v1/chat/completions -d '{"model":"private/gemma4-31b","messages":[…]}'` (no auth header) → 200, `x-nanogpt-private-mode: tinfoil`, exact requested reply, `usage` present, **no** `x_nanogpt_pricing`.
- Headless Edge 149 + CDP, page = live `https://nanoodle.com`: default → blocked by our CSP (exact directive in console); CSP bypassed → blocked by LNA permission; CSP bypassed + LNA granted → models + chat + SSE streaming all 200 from page context.
- Catalog cross-check: `GET https://nano-gpt.com/api/v1/models?detailed=true` (603 models) contains `TEE/*` pricing for 4 of 9 private billing models; `TEE/kimi-k2-6`, `TEE/glm-5-2` absent as of 2026-07-05.
