# Product Hunt launch

> DRAFT — for a human to post. Nothing here is submitted anywhere.
> Refreshed **2026-07-28**. Fact-checked against the live product on that date.
> The Jul 15 and Jul 17 slots both slipped. Re-pick a Tue/Wed.
> **The paste-ready listing and maker's first comment live in
> `launch-checklist.md` § 4, and only there.** This file holds the timing, the
> asset notes and the PH-specific FAQ. One copy of the body is deliberate — two
> copies drift.

**When:** PH days roll over at **12:01am PT**. Set the launch up the evening
before (ideally after the Show HN day winds down). Tue/Wed are the
competitive-but-liquid days. Plan to check in on comments across the day.
**Framing:** product-led. No crypto in the listing. Honest pay-per-call pricing.
**Account note:** the PH account must not be brand-new on launch day. Create it
(or dust it off) at least 3 days ahead and follow/comment a little, so the launch
is not a zero-history account's first act. This is the one item with a lead time
— check it first, because it can push the date.

## Listing

Name, tagline, description and topics: paste them from `launch-checklist.md` § 4.
The tagline field caps at 60 characters and the description at 260, so count
them again if you edit either one.

**Links:** add the GitHub repo (https://github.com/nanoodlecom/nanoodle — public + MIT
since Jul 10) in the listing's links section; PH surfaces it as an "Open Source"
badge and it pre-answers the trust question. The whole org is public (13 public
repos at https://github.com/nanoodlecom): headless runners on npm (`nanoodle`
0.8.0) and PyPI (`nanoodle` 0.5.0), an MCP server (`nanoodle-mcp` 0.4.0 on npm)
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

Paste it from `launch-checklist.md` § 4. Post it right after the listing goes
live, then stay in the thread.

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
