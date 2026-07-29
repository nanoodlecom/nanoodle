# AlternativeTo listing

> DRAFT — for a human to submit at https://alternativeto.net/manage-item/
> (requires an AlternativeTo account). Drafted 2026-07-17, refreshed and
> fact-checked **2026-07-28**. AlternativeTo is slow-burn SEO, not a launch
> spike — submit any time; no timing pressure.
>
> **Account-age gate: CLEARED.** The 7-day new-account gate lifted 2026-07-13.
> Nothing blocks this submission now. It is the lowest-risk of the four pending
> launches: a directory entry cannot flop, and it compounds forever.
>
> Paste-ready copy also lives in `launch-checklist.md`.

## Listing fields

**Name:** nanoodle

**URL:** https://nanoodle.com

**Short description (one line):**

Node-graph AI workflow editor that runs entirely in the browser — no install,
no server, no analytics; export any workflow as a standalone HTML app.

> Note: the earlier version of this line said "no signup". That was dropped on
> purpose — you do need a nano-gpt.com account to run models, and the claim was
> already retired from the other copy on Jul 3. Do not put it back.

**Full description:**

nanoodle is a client-side-only node canvas for chaining AI models (LLM, image,
video, audio/TTS) into workflows. Everything runs in your browser: there is no
backend, no account system on nanoodle's side, and no analytics. You bring your
own NanoGPT (nano-gpt.com) API key — paste it or sign in via OAuth — and pay the
provider per call; nanoodle never sees your key, prompts, or outputs.

Workflows are shared as URLs (the graph is encoded in the URL fragment, which
never reaches a server) or exported as a single self-contained .html file you
can host anywhere or open from disk. A built-in Examples panel loads ready-made
workflows straight from an open gallery repository, so there is something to run
on the first visit. The same graph format also runs headlessly via the
`nanoodle` package on npm (0.8.0) and PyPI (0.4.0), and there's an MCP server
and a GitHub Action.

Open source (MIT) — the site is served straight from its repository, and the
whole ecosystem (13 public repos) is public at https://github.com/nanoodlecom.

**License:** Open Source (MIT)

**Platforms:** Online (web); Self-Hosted (it's a static folder — any file
server works)

**Pricing:** Free (the app itself; running models uses your own NanoGPT key,
pay-per-call). On AlternativeTo pick "Free • Open Source" and note the BYO-key
cost in the description — do not present it as fully free to operate.

**Tags/categories:** ai-workflow, node-editor, no-code, privacy, browser-based,
text-to-image, workflow-automation

## "Alternative to" entries

Add nanoodle as an alternative to (only where the claim is defensible — we
have comparison pages for the first two, and all three URLs below returned
HTTP 200 on 2026-07-28):

- **ComfyUI** — same node-graph idiom, but cloud models via API instead of a
  local GPU; see https://nanoodle.com/nanoodle-vs-comfyui and
  https://nanoodle.com/comfyui-alternative
- **n8n** — for AI-chain use cases only; see https://nanoodle.com/nanoodle-vs-n8n

Don't claim it as an alternative to full automation platforms (Zapier etc.) —
nanoodle has no triggers/integrations and the listing will get disputed.

## Notes for the submitter

- AlternativeTo entries are community-moderated; a plain, accurate description
  survives review better than marketing copy.
- **Disclose that you are the maker.** AlternativeTo requires it, and moderators
  remove undisclosed self-listings.
- Add 2–3 screenshots: the editor canvas with a wired graph, an exported app
  running, the share dialog (reuse the Product Hunt gallery assets in the local
  `shareassets/` folder — it is gitignored, so it is not on GitHub).
- **Leave the hosted MCP endpoint out of this listing.** mcp.nanoodle.com is
  real and live, but its payment rail is Nano, and a directory entry aimed at
  ComfyUI refugees is the wrong place for a payments conversation. It belongs in
  the r/mcp post. Nothing here is weakened by omitting it.
- Check first whether an entry for nanoodle already exists — AlternativeTo blocks
  scripted checks, so this has to be a manual search on the site. A duplicate
  submission gets merged or rejected.
- Once live, log the URL in shares.md and link it from the launch runbook.
