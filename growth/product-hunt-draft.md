# Product Hunt launch

> DRAFT — for a human to post. Nothing here is submitted anywhere.
> Refreshed **2026-07-28**. Fact-checked against the live product on that date.
> The Jul 15 and Jul 17 slots both slipped. Re-pick a Tue/Wed.
> Paste-ready copy also lives in `launch-checklist.md` (single-file launch page).

**When:** PH days roll over at **12:01am PT**. Set the launch up the evening
before (ideally after the Show HN day winds down). Tue/Wed are the
competitive-but-liquid days. Plan to check in on comments across the day.
**Framing:** product-led. No crypto in the listing. Honest pay-per-call pricing.
**Account note:** the PH account must not be brand-new on launch day. Create it
(or dust it off) at least 3 days ahead and follow/comment a little, so the launch
is not a zero-history account's first act. This is the one item with a lead time
— check it first, because it can push the date.

## Listing

**Name:** nanoodle

**Tagline (≤60 chars):**

Wire AI models into apps — in your browser, no server

**Description (≤260 chars):**

A node canvas for chaining text, image, video & audio AI models. Runs entirely
in your browser — no server, no analytics, no subscription. Export any workflow
as a standalone single-file .html app you own, or share it as a link. BYO
nano-gpt key, pay per call.

**Topics:** Artificial Intelligence · No-Code · Privacy · Developer Tools · Open Source

**Links:** add the GitHub repo (https://github.com/nanoodlecom/nanoodle — public + MIT
since Jul 10) in the listing's links section; PH surfaces it as an "Open Source"
badge and it pre-answers the trust question. The whole org is public (13 public
repos at https://github.com/nanoodlecom): headless runners on npm (`nanoodle`
0.8.0) and PyPI (`nanoodle` 0.4.0), an MCP server (`nanoodle-mcp` 0.4.0 on npm)
and a GitHub Action (run-noodle-action) — worth a line in the description or
first comment for the developer crowd.
*Version numbers verified 2026-07-28. Re-check with `npm view nanoodle version`
and `pip index versions nanoodle` on launch morning; both ship often.*

**Pricing:** select "Free options" / "Payment required to run models" per the
form's choices — describe as "no signup to build; running models uses your own
API key, pay-per-call (typically cents)". Don't use bare "Free" language.

## Assets

- Thumbnail/first gallery slot: `shareassets/nanoodle-demo-square-1080.mp4`
  (PH favors a moving first asset). `shareassets/` is gitignored, so this file
  exists only in the local nanoodle checkout — do not look for it on GitHub.
- Gallery: 3–5 stills — editor canvas with a wired graph, the hero result view,
  the export dialog, an exported app running from a file:// URL (that one sells
  the ownership story), 📚 Examples panel.
- **Community slide is now real** (it was conditional in the Jul 17 draft): the
  📚 Examples panel carries a "🏆 From the community" shelf with two credited
  Cookoff winners — AI Telephone Game (💡 Most Innovative, u/yuppienetwork1996)
  and RetroHandheldVision (❤️ People's Choice, @NanoCharts). Screenshot the shelf.
  "Built by users" is the strongest slide in the deck. Two entries, not three —
  the 🛠 Most Useful winner never resurfaced after automod ate the submission, so
  don't claim a third.

## Maker's first comment

Hey PH 👋 — solo builder here.

nanoodle started from a constraint: what's the most capable AI tool I can build
with NO backend at all? The answer turned out to be a node-graph playground —
drag models onto a canvas (LLMs, image gen/edit, video, TTS, music), wire them
together, hit run. Everything executes in your browser.

Two things I care most about:

🗂 **You own the output.** Any workflow exports to a single .html file — a real
app you can email, host anywhere, or open from a USB stick in ten years. No
platform lock-in, nothing phoning home, zero analytics anywhere.

💳 **No subscription.** You bring your own nano-gpt.com key and pay per model
call (usually cents). No monthly fee, no expiring credits, and your key never
touches a server of mine because there isn't one.

The honest tradeoff: the bring-your-own-key step is real friction before your
first run — there's a signed-out demo run so you can see it work first, but I
won't pretend the setup step isn't there.

Earlier this month the community ran a little build contest, and the two winners
are now on the shelf inside the app's 📚 Examples panel, credited — a photo
whispered between vision models until the details drift, and a one-node retro
handheld-screen filter. Ask me anything, especially about the single-file /
no-server architecture. 🍜

## Comment FAQ

Reuse the Show HN FAQ (`show-hn-draft.md`) — same questions come up, softer tone
here. PH-specific extras:
- **"How is it different from [AI app builder X]?"** — Most builders host your app
  on their platform; nanoodle's export is a file you own. That's the moat and the
  pitch.
- **"Roadmap?"** — Answer honestly from the current backlog. Don't promise dates.
  (The gallery-of-community-noodles item from the old draft is shipped, so drop it
  from the roadmap answer — it's a feature now, not a promise.)

## Logistics

- Never ask for upvotes anywhere (PH kills listings for it); "we launched today +
  link" as a neutral FYI on X and in the Discords is fine.
- Quote a good HN exchange from the Show HN day if one happened.
- Log in shares.md.
