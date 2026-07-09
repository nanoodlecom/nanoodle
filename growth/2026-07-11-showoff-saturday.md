# Jul 11 (Sat) — r/webdev Showoff Saturday + last-24h Nano blast

Two-parter. You're back with real time; this is the highest-leverage day before the
deadline.

## Part 1 — r/webdev "Showoff Saturday"

**Where:** r/webdev allows self-promo **only on Saturdays** under the Showoff
Saturday flair (check whether it's currently a weekly sticky thread or flaired
standalone posts — it has flip-flopped; follow whatever the sidebar says today).
**Framing:** pure engineering flex. No crypto, no contest, no growth talk.

**Title (if standalone post):**

Showoff Saturday: a node-graph AI editor that's ONE static HTML file — no build step, no bundler, no server — and it exports user workflows as standalone .html apps

**Body:**

The constraint I set myself: the entire product ships as a single static HTML page.
No webpack/vite, no framework, no backend, CSP locked down, zero analytics.

Fun problems that fell out of it:

- The exported apps embed their own runtime, so the runtime JS is stored as a
  giant `String.raw` template — one backtick anywhere in it breaks every export.
  There's a pre-commit guard whose whole job is hunting backticks.
- Two run-engines (editor + exported app) must stay behaviorally identical; drift
  between them is the most common bug class, so parity is hook-checked.
- No server means auth is OAuth PKCE straight from the browser to the API provider,
  and "saving" user work is IndexedDB + shareable URL fragments — the server never
  sees your graph because there is no server.

Live: https://nanoodle.com — wire up text/image/video/audio models, export the
graph as a self-contained .html app. Running models is BYO-key (nano-gpt),
pay-per-call; building/browsing needs no signup.

*(Stay in comments through the afternoon — r/webdev will ask sharp architecture
questions, and those threads are the value.)*

## Part 2 — Last-24h Cookoff blast (Nano venues only, ~30 min)

Same short message, adapted per venue. Post in: **X thread** (reply to the
performing Jul-3 thread), **nano-gpt Discord #community-projects**, **official Nano
Discord** (as a reply/bump to the Jul-6 post, not a fresh post), **r/nanocurrency**
(comment on the existing Cookoff post — don't make a new submission).

**Copy:**

⏰ ~24 hours left in the 🍜 Noodle Cookoff — entries close **July 12, 23:59 UTC**.

3 × 133 XNO: 🛠 Most Useful · 💡 Most Innovative · ❤️ People's Choice (community
votes — hearts + upvotes on your entry post). Max 2 entries each.

Build at https://nanoodle.com → 🔗 Share → post the link in #community-projects or
r/nanocurrency with a title + category. A noodle takes an evening — some of the
best entries so far were built in one sitting. 👨‍🍳

*(If there's a standout recent entry, lead with it — "look what X built yesterday,
you have 24h to top it" is a better urgency hook than the clock alone.)*
