# Squeezing the Cookoff results — stretch, don't dump

The contest produces five assets, and only one of them is "a results post":

1. **The apps** — working, user-built noodles behind live share links
2. **The builders** — 3 winners + honorable mentions, freshly paid and feeling good
3. **The story** — "I ran a contest for my browser-only tool; strangers built X"
4. **The numbers** — N entries, vote counts, on-chain payout receipts
5. **A permanent corpus** — social proof that lives in the product forever

The failure mode is burning all five in one announcement on Jul 13. The play is a
**content annuity**: one beat at a time, each crediting a user (never the maker),
stretching ~3 weeks past the contest. This also feeds the daily-share habit through
the post-contest lull when there's otherwise nothing new to say.

## Beat calendar

| When | Beat | Venue |
|------|------|-------|
| Jul 13 | Results announcement (template in `2026-07-12-deadline-and-judging.md`) + on-chain payout receipts in replies | Nano venues + X |
| Jul 13 | AlternativeTo listing (gate lifts 05:49 Stockholm) — mention community-built examples | AlternativeTo |
| Jul 14–15 | Show HN / Product Hunt — winners are the "what do people make with it?" answer, one PH gallery slide of credited winner noodles | HN, PH |
| Jul 16+ | **Winner spotlights, ONE per post, ~2–3 days apart** — each is a full daily-share entry with a concrete artifact | X, relevant non-Nano venue per noodle's theme (an audio noodle → a music-AI community, etc.) |
| ~Jul 20 | **Retro writeup**: "I ran a build contest for my no-server AI tool — numbers, what worked, what strangers built" | Indie Hackers (contest-retro posts do well there) and/or dev.to; feeds a possible second HN submission weeks later |
| ~Jul 22 | **Next-event teaser** — even just "Cookoff #2 late August" keeps builders warm; or a standing "noodle of the month" feature so momentum never fully stops | Nano Discord + X |

## The winner DM (send Jul 13 with the payout — this unlocks everything above)

> Congrats — [title] won [category] 🍜 133 XNO is on its way to [wallet] (tx: [link]).
> Three quick things, all optional:
> 1. Your noodle gets featured in nanoodle's Examples, credited — what name/handle
>    should the credit show, and want it to link anywhere (your X/site)?
> 2. Can I spotlight it in a post next week? One line from you on how/why you built
>    it would make it 10× better.
> 3. Anything that annoyed you while building it? Genuinely want the friction list.

Why each ask matters: (1) credit-with-link means *they* share the feature to their
audience — the multiplier; (2) the quote turns a spotlight from promo into a story,
and doubles as **landing-page testimonial material** (real builder, real quote,
credited); (3) winners are the most motivated bug reporters you'll ever have.

## Spotlight post template (Jul 16+, one winner per post)

> [emoji] "[Title]" by [@builder] — [what it does in one plain sentence].
> [Their one-line quote about building it.]
> It's a live graph — open it, run it with your own key, remix it: [share link]
> ([category] winner in last week's Noodle Cookoff.)

Non-Nano venues: drop the Cookoff line, keep the credit + remix invitation.

## In-product: the 🏆 winners shelf (the compounding asset)

There is **no gallery on main** (PR #23's never merged) — 📚 Examples are embedded
graphs in `index.html`. But winner noodles don't need embedding: **share links
already carry the full graph**, so a "🏆 Cookoff winners" section in the Examples
modal is just a credited link list — title, builder (linked), one-liner, share link.

- Product task: small WINNERS array + a section in the Examples modal, i18n-keyed,
  hidden while the array is empty. Buildable *before* results exist; on Jul 13 the
  only edit is filling in names + links.
- This is the single highest-leverage product task of the window: every future
  first-visit sees "real people built these" at the exact moment of first-run
  hesitation. Contest energy → permanent activation asset.
- 📣 `updates.json` entry ("Update:" commit line) announcing the winners in-app at
  the same time.
- Honesty rule: real names/handles with permission, real vote counts, and if N was
  modest, say the true number — "14 entries" with three great winners reads better
  than vague bigness.
