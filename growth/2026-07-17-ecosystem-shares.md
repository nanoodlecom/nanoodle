# r/mcp + AlternativeTo — the two ecosystem shares

> Drafted 2026-07-17 on the "the whole org went public" hook. **Rewritten
> 2026-07-28**, because the hook changed under it: since Jul 23 there is a
> public hosted MCP endpoint at https://mcp.nanoodle.com, and that is a far
> better r/mcp story than "our repos are public now".
>
> Paste-ready copy also lives in `launch-checklist.md`.

**What changed since the Jul 17 draft — read before posting:**

| Jul 17 draft said | True on 2026-07-28 |
|---|---|
| gated on `nanoodle-mcp` reaching npm | **gate is gone** — `nanoodle-mcp` is on npm, latest 0.4.0 |
| `nanoodle-mcp@0.1.0` | npm 0.4.0; the repo and the hosted server run 0.6.0 (npm publish of 0.6.0 is still pending) |
| stdio server only | stdio **and** streamable HTTP; a public hosted endpoint is live |
| "zero-dep" JSON-RPC | hand-rolled JSON-RPC, but **two runtime dependencies** (`nanoodle`, `nanocurrency`). Do not say zero-dep. |
| org has 11+ public repos | 13 public repos |

---

## 1. r/mcp (or the MCP Discord's #showcase) — the hosted endpoint

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

**Title:**

An MCP server with no signup and no API key — the 402 payment IS the handshake

**Body:**

I run a browser node-graph editor (nanoodle.com) where you wire text/image/video/
audio models into a workflow and save it as JSON. The MCP server turns those
saves into tools. There are two ways to use it, and the second one is the part I
think is actually new.

**Self-hosted:** point it at a folder of saved graphs and every graph becomes an
MCP tool.

```
claude mcp add nanoodle --env NANOGPT_API_KEY=... -- npx -y nanoodle-mcp --graphs ~/noodles
```

- Each graph's *inputs* become the tool's typed parameters. A graph with a "Text"
  input and an "Image" output is a tool your client calls with text and gets an
  image back.
- Plus a `run_noodle` tool that executes any nanoodle share link directly.
- Hand-rolled JSON-RPC over stdio and streamable HTTP, small enough to read.
  Offline test suite. Your key never touches stdout or logs.

**Hosted, no account anywhere:** https://mcp.nanoodle.com/mcp

```
claude mcp add --transport http noodles https://mcp.nanoodle.com/mcp
```

That is the entire setup. No signup, no API key, no dashboard. Ten workflows are
published on it right now — image generation and editing, image-to-video, TTS +
lipsync, a music one, a four-way model arena.

The handshake: your agent calls a tool, the server answers with an HTTP 402 and a
payment link, you scan the QR with any Nano wallet, and the run streams back a
couple of seconds later. Paying *is* the authentication — there is no identity to
establish, so there is nothing to sign up for. Mechanically:

- What you pay up front is a **deposit**. The run settles at the model's actual
  metered cost + 20%, and the difference goes back to the paying wallet on-chain.
- The 20% goes to whoever authored the workflow, not to the platform.
- A failed run refunds the whole payment automatically. Quotes expire after 15
  minutes.
- The server can also sit on the *paying* side: with no API key set, it runs in
  wallet mode, signs the Nano send block locally and pays 402s itself. `--max-usd`
  caps one call; the wallet balance caps the total.

It costs real money per call either way, and the server prints a cost line per
invocation so an agent can report what it spent.

Config for Claude Code / Cursor / VS Code / Windsurf / Claude Desktop is in the
README at github.com/nanoodlecom/nanoodle-mcp (it also installs as a Claude Code
plugin). I built this, happy to answer anything about the graph→tool mapping or
the 402 flow.

**After posting:** log venue + link + response in shares.md, per the habit.

---

## 2. AlternativeTo — list nanoodle as a ComfyUI alternative

The full listing draft moved to **`launch-alternativeto.md`** — use that file, not
this section. It has the exact fields, the "alternative to" entries with verified
comparison-page URLs, and the submitter notes.

Status as of 2026-07-28: the account-age gate lifted Jul 13, so nothing blocks it.
It is evergreen, it cannot flop, and it compounds. Of the four pending launches it
is the one to clear first, on any day, in about 20 minutes.
