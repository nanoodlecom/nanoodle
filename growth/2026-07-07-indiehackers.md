# Jul 7 — Indie Hackers · 30 min

**Venue:** https://www.indiehackers.com — post to your profile / relevant group
(e.g. "Developers" or "Artificial Intelligence"). IH is slow-burn; comments trickle
over days, so a 30-min day fits — post and walk away, reply in the evening if any.
**Framing:** NON-Nano venue → product + business-model led. No crypto lead, no
prize amounts. IH loves an unusual business model, so the *economics* are the hook.
**Budget:** 15 min post + 5 min profile/product page sanity check + 10 min log/replies.

---

**Title:**

I built an AI app builder with no backend, no subscription, and no analytics — users bring their own API key and my infra bill is $0

---

**Body:**

nanoodle (https://nanoodle.com) is a ComfyUI-style node canvas in the browser: wire
text / image / video / audio models together, hit run, then export the workflow as a
standalone single-file .html app you own — or share it as a link.

The business-model experiment is the part IH might find interesting:

- **No server.** The entire product is a static page. My monthly infra cost is
  effectively zero, and there's no backend to scale, secure, or babysit.
- **No subscription.** Users bring their own nano-gpt.com key and pay per model
  call (typically cents). I earn through the provider's referral/invite mechanism
  instead of billing users myself — no Stripe, no invoices, no churn dashboard.
- **No analytics.** Zero tracking, zero third-party origins. It's a feature, not a
  gap — the privacy promise is most of the pitch, and it's only credible *because*
  there's no server to phone home to.

The tradeoff is real: the "wow" moment (actually running a model) sits behind
funding a key at a third party, which costs me some activation. Building and
poking around needs no signup, and there's a canned demo run for the signed-out
first visit, but I won't pretend the key step is free of friction.

Solo build, browser-only, about [X months] in. Happy to go deep on the single-file
export or the zero-server constraint — both forced more product decisions than any
feature did.

---

## Norms note (not part of the post)

- Fill in the [X months] honestly before posting.
- IH is allergic to hype and loves numbers — if anyone asks for revenue/usage,
  answer honestly (including "no analytics = I genuinely don't know traffic"; that
  answer itself tends to land well here).
- One soft contest line is OK **in a comment reply** if someone asks "how do you
  get users?" — describe the Cookoff as a community contest, don't lead with XNO.
- Don't say "free". Don't paste the same body to multiple groups.
