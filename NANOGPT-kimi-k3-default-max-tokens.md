# Bug report — kimi-k3 route: tiny default output cap + entire reply streamed as `reasoning`

**Endpoint:** `POST /api/v1/chat/completions` (streaming), `model: moonshotai/kimi-k3`

Every claim verified with live API calls on 2026-07-17 (nanoodle Describe-changes prompt,
~3.3k input tokens; raw SSE captures on file).

## 1. Default `max_tokens` is ~5k despite a 1M advertised ceiling (Moonshot route only)

The catalog reports `context_length: 1048576` and `max_output_tokens: 1048576` for
`moonshotai/kimi-k3`. But a request that sends **no** `max_tokens` is cut at ~4.8k output
tokens: the stream ends with `finish_reason: "length"` mid-sentence, after
`x_nanogpt_pricing` reports `outputTokens: 4770`. Kimi K3 is an always-thinking model
(`reasoning_efforts: ["max"]` — no lower setting), so on any non-trivial task it spends
more than that budget reasoning and is cut off **before it emits a single content token**.
The caller pays (~$0.077 in our capture) and receives no answer.

Sending an explicit `max_tokens: 30000` on the identical request completes normally
(`finish_reason: "stop"`, ~14k chars of reasoning then a full answer in `content`).

This is specific to the Moonshot route, not the gateway: with no `max_tokens`,
`openai/gpt-5.4-mini` ran to 23,004 output tokens and `zai-org/glm-5.2` to 29,079, both
`finish_reason: "stop"` (same day, same key). Note also that a client cannot simply send the
catalog's `max_output_tokens` as a workaround: `max_tokens: 1048576` on kimi-k3 is rejected
with HTTP 400 ("Your prompt exceeds the model's context length … input tokens + requested
output tokens must fit"), i.e. the full advertised output ceiling is unusable whenever any
input is present.

**Expected:** when the client omits `max_tokens`, default to the model's real ceiling (or at
least something an always-thinking model can finish inside), as the OpenAI-compatible
convention implies and as the catalog's `max_output_tokens` advertises.

## 2. All output streams as `reasoning` deltas; `content` deltas arrive only at the very end

Until the model finishes thinking, every chunk carries `delta.reasoning` only. Combined with
bug 1 this means the truncated stream contains **zero** `delta.content` — an
OpenAI-compatible client that reads `message.content` sees an empty reply with HTTP 200 and
no error object, which reads as "the model had nothing to say".

(nanoodle now works around both: Moonshot models get an explicit `max_tokens` — other routes
stay uncapped since they behave — `finish_reason: "length"` is treated as an error, and the
accumulated `reasoning` text is used when `content` is empty.)
