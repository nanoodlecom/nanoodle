# Jul 14 — Show HN (full-attention day)

**Where:** https://news.ycombinator.com/submit — Show HN post with URL.
**When:** ~8–10am ET on a weekday. Do NOT post and leave; the first two hours of
comment replies decide everything. Block the morning.
**Framing:** engineering-led, zero crypto/contest language in the post itself.
If Cookoff results come up, the honest reframe is fine: "I ran a small build
contest in the API provider's community; here's what people made."
**Pre-check:** search HN for prior nanoodle submissions (avoid dupe-title penalty);
coordinate with the old PR #32 proposal so we don't double-post — this draft
supersedes it.

---

**Title (≤80 chars, no superlatives — HN mods edit hype):**

Show HN: Nanoodle – node-graph AI workflows in one HTML file, no server

**URL:** https://nanoodle.com

**Text (first comment, post immediately after submitting):**

Hi HN — solo builder here. Nanoodle is a ComfyUI-style node canvas that runs
entirely in the browser: wire text/image/video/audio models into a graph, run it,
then export the graph as a standalone single-file .html app you can host anywhere
or open from disk.

The whole product is one static HTML page — no build step, no bundler, no backend.
Constraints that fell out of that, which turned out to be the interesting part:

- Exported apps embed their own runtime, so the runtime JS lives in a String.raw
  template inside the page. A single backtick anywhere in it breaks every export;
  there's a pre-commit hook whose only job is hunting backticks.
- The editor and the exported app are two run-engines that must behave identically.
  Engine drift became the dominant bug class, so parity is enforced by hooks too.
- No server means auth is OAuth PKCE browser→provider, persistence is IndexedDB +
  share-links in URL fragments (the fragment never hits any server), and there's
  zero analytics — not as a policy, but because there's nothing to receive it.

The honest tradeoff: it's bring-your-own-key. Building/browsing needs no signup,
but running models goes through your own nano-gpt.com key, pay-per-call. I built
it this way so I never host anyone's data or keys — but it does put the "wow"
moment behind funding an account, and I'm still working on softening that (there's
a canned demo run for signed-out visitors).

Happy to answer anything about the single-file architecture — it forced more
design decisions than any feature did.

---

## Comment FAQ (prep — answer in your own words, don't paste)

- **"Why not open-source it?"** — Answer honestly per current stance. If closed:
  the exported .html apps are yours forever and fully inspectable (view-source);
  the product promise is ownership of *your* output, and the page itself ships
  un-minified enough to audit.
- **"BYO-key is a paywall."** — Yes, effectively. The alternative is me proxying
  keys through a server, which breaks the entire privacy model and makes me a
  custodian. Chose the tradeoff eyes-open.
- **"How do you make money?"** — Provider referral on sign-ups routed through the
  app. No subscription, no markup on calls, no data. If that ever changes it'll be
  said out loud.
- **"Isn't this just an API wrapper?"** — The models are the provider's, yes. The
  product is the graph editor, the dual-engine runtime, and the single-file export.
  Same sense in which a spreadsheet is "just" a wrapper over arithmetic.
- **"Crypto??"** (someone will find the Nano angle) — The API provider accepts
  feeless micropayments, which is what makes per-call pricing work without
  subscriptions. Nanoodle itself has no wallet, no token, no chain code.
- **"CSP / privacy claims — prove it."** — Point at the response headers: no
  third-party origins in the CSP, connect-src pinned to the API provider. Invite
  them to open devtools; the network tab is the receipt.
- **Someone posts what they built** — best possible outcome; engage hard, ask to
  feature it credited. Winner noodles from the Cookoff are your show-and-tell
  links if asked "what do people make with it?"

## Logistics

- If it doesn't take off (< ~5 points in 2h), let it die quietly — HN allows a
  respectful re-submit weeks later; don't bump-beg or ask for votes ANYWHERE
  (voting-ring detection is real and fatal).
- Log result in shares.md either way.
