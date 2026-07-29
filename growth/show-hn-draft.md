# Show HN (full-attention day)

> DRAFT — for a human to post. Nothing here is submitted anywhere.
> Refreshed **2026-07-28**. Fact-checked against the live product on that date.
> The Jul 14 and Jul 17 slots both slipped. Pick the next weekday you can block.
> **The paste-ready title and first comment live in `launch-checklist.md` § 3,
> and only there.** This file holds the framing, the dupe check and the comment
> FAQ. One copy of the body is deliberate — two copies drift.

**Where:** https://news.ycombinator.com/submit — Show HN post with URL.
**When:** ~8–10am ET on a weekday. Do NOT post and leave; the first two hours of
comment replies decide everything. Block the morning.
**Framing:** engineering-led, zero crypto/contest language in the post itself.
If the Cookoff comes up, the honest reframe is fine: "I ran a small build
contest in the API provider's community; here's what people made."
**Dupe pre-check: DONE 2026-07-28.** hn.algolia.com returns 0 stories whose
title or URL contains "nanoodle". No dupe penalty, no prior submission to
coordinate around. The old PR #32 Show HN proposal is superseded by this draft.

---

## Title, URL and first comment

Paste them from **`launch-checklist.md` § 3**. Do not copy them back here.

**URL field:** `https://nanoodle.com` — the live product goes in the URL field and
the repo link goes in the text. The app is the demo, the source is the receipt.

**Title length:** HN caps titles at 80 characters and moderators edit hype out, so
if you change the title, count the characters and keep it flat.

---

## Comment FAQ (prep — answer in your own words, don't paste)

- **"Why not open-source it?"** — Moot as of Jul 10: it IS open source, MIT, full
  commit history — https://github.com/nanoodlecom/nanoodle. If asked why the repo also
  contains marketing notes (`growth/`) and an AI output style: shrug honestly —
  solo project, everything lives in one repo, planned the launch in the open.
- **"BYO-key is a paywall."** — Yes, effectively. The alternative is me proxying
  keys through a server, which breaks the entire privacy model and makes me a
  custodian. Chose the tradeoff eyes-open.
- **"How do you make money?"** — Provider referral on sign-ups routed through the
  app (the OAuth link carries a referral code; it's in the source). No
  subscription, no data, and nothing added to a call you make with your own key.
  The one place I do take a cut is the hosted MCP endpoint, which charges the
  model's cost plus 20% because it fronts the money for you — say that out loud
  if it comes up, because the 20% is documented on mcp.nanoodle.com and someone
  will find it. If any of this changes it'll be said out loud too.
- **"Isn't this just an API wrapper?"** — The models are the provider's, yes. The
  product is the graph editor, the dual-engine runtime, and the single-file export.
  Same sense in which a spreadsheet is "just" a wrapper over arithmetic.
- **"Crypto??"** (someone will find the Nano angle — and since Jul 23 there's more
  to find, so don't get caught flat) — The API provider accepts feeless
  micropayments, which is what makes per-call pricing work without subscriptions.
  Nanoodle the editor has no wallet, no token, no chain code. Separately I run a
  small hosted MCP endpoint (mcp.nanoodle.com) that lets an agent call these same
  workflows with no account at all: the server answers with an HTTP 402 and a
  payment link, the agent pays, the run streams back. It is the one place a payment
  rail shows up, it's opt-in, and it's the only way I could think of to bill an
  agent that has no email address. Happy to talk about the 402 flow if that's the
  interesting part; it has nothing to do with the browser editor you're looking at.
- **"CSP / privacy claims — prove it."** — Point at the response headers: no
  third-party origins in the CSP, connect-src pinned to the API provider. Invite
  them to open devtools; the network tab is the receipt — and the `_headers` file
  in the repo shows the same CSP in source, so the claim is auditable both ways.
- **Someone posts what they built** — best possible outcome; engage hard, ask to
  feature it credited. The two credited community noodles on the 📚 Examples shelf
  (AI Telephone Game, RetroHandheldVision) are your show-and-tell links if asked
  "what do people make with it?"

## Logistics

- If it doesn't take off (< ~5 points in 2h), let it die quietly — HN allows a
  respectful re-submit weeks later; don't bump-beg or ask for votes ANYWHERE
  (voting-ring detection is real and fatal).
- Log result in shares.md either way.
