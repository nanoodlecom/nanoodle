# r/mcp + AlternativeTo — the two ecosystem shares

> Drafted 2026-07-17 on the "the whole org went public" hook. **Rewritten
> 2026-07-28**, because the hook changed under it: since Jul 23 there is a
> public hosted MCP endpoint at https://mcp.nanoodle.com, and that is a far
> better r/mcp story than "our repos are public now".
>
> **The paste-ready post body lives in `launch-checklist.md` § 2, and only
> there.** This file holds the framing, the rules and the fact-check. One copy
> of the body is deliberate: an earlier revision of this file carried the body
> too, and a wrong sentence about payouts then had to be corrected twice.

**What the old copy said — read before posting:**

| Old copy | True on 2026-07-28 |
|---|---|
| `nanoodle-mcp@0.1.0` (this draft, Jul 17) | npm 0.4.0; the repo and the hosted server run 0.6.0 (npm publish of 0.6.0 is still pending) |
| stdio server only (this draft, Jul 17) | stdio **and** streamable HTTP; a public hosted endpoint is live |
| "zero-dep" JSON-RPC (this draft, Jul 17) | hand-rolled JSON-RPC, but **two runtime dependencies** (`nanoodle`, `nanocurrency`). Do not say zero-dep. |
| org has 11+ public repos (`show-hn-draft.md`, `product-hunt-draft.md`, `launch-alternativeto.md` — **not** this draft, which said "7 repos flipped") | 13 public repos |
| r/mcp is "gated on `nanoodle-mcp` landing on npm" (**`shares.md`**, not this draft — this draft recorded the gate as CLEARED on Jul 17) | no gate has existed since Jul 17. The stale row sat in `shares.md` for 11 days and is corrected there now. |

---

## 1. r/mcp (or the MCP Discord's #showcase) — the hosted endpoint

**Post body:** `launch-checklist.md` § 2. Paste from there. Do not copy it back
into this file.

**Framing:** MCP-first, tool-mechanics led. This crowd wants a novel *server*,
not an app pitch. nanoodle is the context, not the headline.

**On the standing "no crypto framing outside Nano venues" rule:** it holds here.
Lead with the *mechanism* — HTTP 402, a payment handshake instead of an API key —
never with the coin, the price of anything, or an investment angle. Nano is named
once, as the rail that makes sub-cent settlement possible. If that still reads as
crypto-forward to you on the day, the fallback is to lead with the self-hosted
graphs→tools mapping and put the hosted endpoint in the last bullet.

**Before posting:** read r/mcp's current rules and pinned post. Self-promotion
limits change. Disclose that you built it, in the post body, not in a reply.

**If the subreddit rejects paid or crypto content:** drop the hosted half and
post the self-hosted half only. The graphs→tools mapping stands on its own.

**Every money claim in that post, and where it is checked.** These are the
sentences a reader quotes back at you, so re-verify them if the server changes.

- "settles at the model's actual metered cost + 20%, change back on-chain" —
  `settle()` in `nanoodle-mcp/src/gate.mjs`: `markup = cost / 5`, and
  `change = deposit − cost − take` goes to the payer.
- "the 20% is routable to a workflow author, but no published workflow claims it
  yet" — `authorFor()` in the same file reads `x402.author` off the graph and
  returns `null` when the field is absent, and none of the 15 graphs in
  `awesome-noodles/graphs` carries one. mcp.nanoodle.com advertises the
  mechanism, so present it as an open invitation. Never say the payout already
  happens. It does not.
- "a failed run refunds the whole payment" — `refund(q, "run_failed")`.
- "quotes expire after 15 minutes" — `QUOTE_TTL_MS = 15 * 60 * 1000`.
- "`--max-usd` caps one call" — `bin/nanoodle-mcp.mjs`, wallet mode.
- "prints a cost line per invocation" — `emitResult()` in `src/tools.mjs` pushes
  a `cost: $X.XXXX` text block.
- "fifteen workflows published" — EXAMPLES ships 15; mcp.nanoodle.com serves that same set.

**After posting:** log venue + link + response in shares.md, per the habit.

---

## 2. AlternativeTo — list nanoodle as a ComfyUI alternative

The full listing draft moved to **`launch-alternativeto.md`** — use that file, not
this section. It has the exact fields, the "alternative to" entries with verified
comparison-page URLs, and the submitter notes.

Status as of 2026-07-28: the account-age gate lifted Jul 13, so nothing blocks it.
It is evergreen, it cannot flop, and it compounds. Of the four pending launches it
is the one to clear first, on any day, in about 20 minutes.
