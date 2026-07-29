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
> **The paste-ready listing fields live in `launch-checklist.md` § 1, and only
> there.** This file holds the "alternative to" reasoning and the submitter
> notes. One copy of the fields is deliberate — two copies drift.

## Listing fields

Paste them from `launch-checklist.md` § 1: name, URL, short description, full
description, license, platforms, pricing and tags.

Two rules that travel with those fields:

> The short description must not claim you can run anything without an account.
> You do need a nano-gpt.com account to run models. That claim came off the rest
> of the copy on Jul 3. Do not put it back.

> The pricing field is "Free • Open Source", and the BYO-key cost goes in the
> description. Do not present nanoodle as fully free to operate.

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
