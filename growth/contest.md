# Noodle Contest — plan & rules

**Goal:** generate a wave of shareable noodles (nanoodle apps) + a corpus for the
in-app Gallery, and put nanoodle in front of two adjacent communities (nano-gpt
users and Nano holders) without spending a cent on ads or breaking the
no-server / no-analytics / BYO-key promise.

The contest *is* the gallery's submission pipeline: entries get posted in Discord,
winners and honorable mentions get hand-curated into `gallery.json`.

---

## Prize

- **3 prizes of 133 Nano (XNO) each** — paid to the winner's Nano wallet. Doubles
  as nano-gpt credit, since nano-gpt takes Nano. (Total payout: 399 XNO.)
- Three prizes, not one, so it's not a single winner-take-all popularity race —
  see categories.

## Categories (one prize each)

Splitting the pot by category pulls *diverse* submissions and blunts pure
heart-farming. Three different "best" noodles beats three flavors of the same
viral one.

1. **🛠 Most Useful** — the noodle you'd actually open again. Host's pick on craft.
2. **🎨 Most Beautiful / Weird** — the one that makes people go "whoa." Host's pick.
3. **❤️ People's Choice** — most-hearted entry in #community-projects. Pure votes.

> Why a hybrid: pure "most hearted" rewards the biggest Discord following and the
> loudest vote-begging, not the coolest build. Two host-judged categories protect
> craft; one heart-voted category keeps the community-energy and the viral loop.

## How to enter

1. Build a noodle at **nanoodle.app** (no account needed — bring your own
   nano-gpt key or sign in).
2. Hit **🔗 Share** in the toolbar — the link to your exact workflow is copied to
   your clipboard.
3. Post it in **#community-projects** with a title, a one-line description, and
   your category. Use Discord's masked-link syntax so the long URL stays tidy:
   ```
   **Title** — what it does, in one line. 🎨
   Category: Most Beautiful/Weird
   [▶ Open it](PASTE-YOUR-SHARE-LINK)
   ```

## Rules

- **Window:** opens `<LAUNCH DATE>`, closes `<LAUNCH DATE + 14 days>` at 23:59 UTC.
- **Max 2 entries per person.** One category each. No spam reposts.
- Entry must be a working nanoodle **share link** (not a screenshot) and must run
  for someone using **their own** key — i.e. self-contained, no private uploads
  baked in. (Share links already blank uploaded media, so this is automatic.)
- Be excellent to each other. Vote-rings / brigading get an entry disqualified —
  trust is the asset, don't burn it.
- Winners agree to have their noodle featured in the in-app Gallery (credited).

## Judging

- **People's Choice:** highest ❤️ count on the entry message at close.
- **Most Useful / Most Beautiful-Weird:** host pick from all entries, leaning on
  hearts as a signal but not bound by them.
- Announced within ~3 days of close, in #community-projects.

## After the contest → the Gallery

- Curate the winners + best honorable mentions into `gallery.json` (one entry =
  `{slug, title, author, desc, tags, graph}`; drop the graph JSON in `gallery/`).
- Tag entries by category (`useful` / `beautiful-weird` / `peoples-choice`) so
  they're filterable later.
- The Gallery then doubles as first-run inspiration — new visitors land on it and
  remix a real noodle instead of staring at a blank canvas.

## Distribution checklist (the contest is itself a share)

- [ ] Launch post in nano-gpt Discord **#community-projects** (primary).
- [ ] Cross-post in **#nanocurrency** with the Nano-holder angle ("spend/earn Nano
      on a no-signup AI playground").
- [ ] Mid-contest nudge: repost 2–3 standout entries as they roll in.
- [ ] Results post — winners + links, which becomes its own shareable artifact
      (Show HN / Reddit / X) pointing at the new Gallery.
- [ ] Log each post in `shares.md`.

## Open questions for the host

- ~~Prize currency~~ → **confirmed: 133 Nano (XNO) per winner, paid to wallet.**
- Exact launch date / window length (14 days suggested).
- Is nano-gpt co-announcing / amplifying? (They benefit — prize flows into their
  ecosystem — so worth asking them to boost or match.)
