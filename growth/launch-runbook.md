# Repo launch runbook (repeatable, ~1 day per launch)

> **Not the file you want for the four launches that are pending right now.**
> This runbook covers *future repo* launches (mp4cat, nanoodle-mcp, awesome-noodles,
> nanolink — the table at the bottom). For the four drafted-and-waiting posts
> (AlternativeTo, r/mcp, Show HN, Product Hunt) use `launch-checklist.md`, which
> holds the exact paste-ready copy. Added 2026-07-28.

Rev 1 — 2026-07-11. Companion to `plan-q3-distribution.md` Phase 2
("write once, ~1 day per launch"). Every public-repo launch walks this list
top to bottom; no silent launches. This folder is public — the checklist is
deliberately in the open, same as the rest of `growth/`.

Standing rules apply everywhere: disclosed-maker voice, never say "free" in
CTA copy, never ask for votes anywhere, BYOK/paid-API disclosed honestly.

---

## T-minus 2+ days — pre-flight

- [ ] **Repo metadata** (indexers scrape this before humans arrive):
  - `gh repo edit nanoodlecom/<repo> --homepage <url> --add-topic <t1> --add-topic <t2> ...`
  - Description ≤ ~120 chars, plain-language, no hype.
- [ ] **README pass** — the README is the landing page for every directory
  that scrapes it:
  - Hero GIF or screenshot near the top (hosted in-repo; the *site* stays
    third-party-clean, READMEs may carry badges/embeds per the standing rule).
  - Install one-liners above the fold (`npm install …` / `pip install …` /
    `npx …` / `claude mcp add …` — whichever apply, copy-paste-verified).
  - What it is in one sentence, what it is NOT in one more (honest scope).
  - License badge/section (MIT), link back to nanoodle.com + the org.
- [ ] **LICENSE file present** (MIT, matching the main repo). Directories
  auto-reject or mislabel repos without one.
- [ ] **Cut a release:** `gh release create v<X.Y.Z> --generate-notes` —
  GitHub Releases is the zero-analytics subscription channel; LibHunt and
  newsletter editors look for a tagged release, not a bare default branch.
- [ ] **Registry hygiene** (when the repo ships a package): repository/
  homepage fields correct on npm / PyPI trove classifiers, keywords set,
  version on the registry matches the tag.
- [ ] **Dupe check:** search HN (hn.algolia.com) for prior submissions of the
  same URL/name to avoid the dupe-title penalty; pick a title that hasn't run.
- [ ] Draft the Show HN title + first comment (see norms below) and park it
  in `growth/` the day before — launch morning is for replying, not writing.

## Launch day

Post morning US Eastern on a weekday, then **stay present** — the first two
hours of comment replies decide the outcome.

- [ ] **Show HN** (https://news.ycombinator.com/submit), per the
  news.ycombinator.com/showhn.html norms:
  - Show HN is for something people can *try out* — the URL must land on a
    usable thing, not a signup wall or a video.
  - Title ≤ 80 chars, factual, no superlatives (mods edit hype out anyway).
  - Post the explanatory first comment immediately after submitting: what it
    is, how it works, the honest tradeoffs, what feedback you want.
  - Never solicit upvotes, anywhere, in any channel. If it stalls
    (< ~5 points in 2h) let it die; a respectful re-submit weeks later is
    allowed, bump-begging is fatal.
- [ ] **Uneed** (uneed.best) — submit the launch.
- [ ] **Fazier** (fazier.com) — submit the launch.
- [ ] **Microlaunch** (microlaunch.net) — submit the launch.
- [ ] **LibHunt** — make sure the repo is listed *before* the HN post goes
  live (LibHunt captures the mention wave automatically).
- [ ] **lobste.rs — check note:** invite-only and tag-strict; only submit if
  (a) we hold an invite, (b) the story fits an existing tag as *technical*
  content (the mp4cat internals or the da.gd h3 war story qualify; a product
  landing page does not), and (c) the venue hasn't been vetoed in
  `shares.md` by then. When in doubt, skip — one bad-fit submission burns
  the account.
- [ ] **Changelog entry on nanoodle.com:** ship the day's commit with an
  `Update:` line (repo convention — `updates.json` + 📣 pick it up; the
  hook expects the whole update on one physical line).
- [ ] Log everything in `growth/shares.md` (venue, link, time, outcome).

## Day after

- [ ] **Newsletter pitches** (short, factual, one link — templates in
  `growth/pitch-templates.md`):
  - Console.dev — via their tool-recommendation form on console.dev.
  - JavaScript Weekly / Node Weekly — via the Cooperpress "suggest a link"
    /recommendation links in each issue's footer (both newsletters, where
    the story genuinely fits both).
  - Changelog News — email pitch to the editors via the submit address
    linked from changelog.com/news.
- [ ] **MCP / skill registries — when applicable** (i.e. the nanoodle-mcp
  launch): official MCP registry publish (server.json + mcp-publisher, DNS
  namespace verify), then Smithery, Glama (claim → Official tier), PulseMCP,
  mcp.so, and an awesome-mcp-servers PR — same day as or day after the HN
  post, per the plan's agent-tool track.
- [ ] Reply sweep: answer every substantive comment on every venue from
  launch day. Late answers read as abandonment.
- [ ] Post-mortem line in `shares.md`: what worked, what to change in this
  runbook (edit the runbook, that's the point of it).

---

## The four planned launches

| Window | Repo | Angle (one line) |
|--------|------|------------------|
| **~Aug 5** | **mp4cat** | Zero-dependency lossless MP4 concatenation — HN catnip that reaches video/media devs entirely outside the AI bubble. Extra step: PR into krzemienski/awesome-video (contents.json format!) and transitive-bullshit/awesome-ffmpeg (respect its 7-day repo-age rule — trivially met by then). |
| **~Aug 19** | **nanoodle-mcp** | "Build a multi-model pipeline visually, hand it to your agent as ONE typed tool" — rides the MCP wave; all MCP registries same day (see day-after list). Also the Claude Code plugin + Anthropic community marketplace submission from the plan. |
| **September** | **awesome-noodles** | Community launch, not a product launch: awesome-lint-clean list where every entry is simultaneously a share URL, a runnable agent tool, and gallery content. Coordinate with GitHub Discussions opening. |
| **October** | **nanolink** — or fold into a blog post | Either launch the first-party short-link worker, or (if it stays internal) publish the da.gd/Cloudflare h3 header-stall investigation as a technical war story — that debugging writeup is a strong HN submission on its own and needs no product attached. Decide by Oct 1 based on whether nanolink shipped. |

Windows are targets, not appointments: never launch into a broken build, a
holiday weekend, or a same-week mega-launch by someone else in the niche.
Shift a week rather than launch tired.
