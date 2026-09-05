# Q3 distribution plan (Jul 15 → Oct 15, 2026)

## Current plan — 2026-09-04

**NanoGPT users are the audience. NanoGPT OAuth is the sign-in path.**
The product promise is reusable apps that run on a user's existing NanoGPT
balance. This revision supersedes every audience, launch, and expansion
priority in the July plan retained below.

The next completed outcome is one existing NanoGPT user running a workflow
for their own task and leaving with a share link or exported app. Confirm
repeat use separately on a later occasion. Begin with willing Cookoff
builders; an independent completion and a useful failure report are both
more informative than a maintainer walkthrough. Canned sample runs do not
count as live generation or activation.

Keep the work small: maintain a working starter and examples, make the
OAuth → run → Create app → share/export path clear, and fix the obstacle
reported by the next user. Voluntary public GitHub forms collect the task,
an optional cost, and optional repeat-use feedback. A showcase submission
requires a full share link; a problem report does not. Nothing is sent
automatically. Users review their content and choose whether to publish it.

For promotion, use existing NanoGPT community relationships and concrete
apps useful to that audience. Broad HN/PH launches, unrelated directories,
new markets, and new integration surfaces are outside this plan. The
existing ecosystem remains supported; its size is not a growth outcome.

Record one weekly outcome in `shares.md`: task, live completion and
share/export evidence, later repeat use or unknown, and one observed
obstacle. No on-site analytics, event beacons, or tracking. Use voluntary
reports and public artifacts only with their authors' permission.

NanoGPT referral dashboard totals and Search Console can supplement that
record when the maintainer supplies them. Neither dataset has been
provided for this review, and neither measures a user's full in-app path.
Existing NanoGPT users may already have referral attribution, so referral
signups are not an activation or retention count. Preserve existing OAuth
and signup referral codes; separate valid codes and their dashboard mapping
need provider/maintainer verification before any change. Do not infer
users or returning users from package downloads, stars, or missing logs.

## Archived July plan — historical context only

The original plan below is retained to explain existing assets and drafts.
Its checkboxes, deadlines, market assumptions, and launch instructions are
not active requirements; use the September 4 scope above.

Rev 1 — 2026-07-11. At the time, superseded "post somewhere daily" as the growth model.
Research basis: 8-agent sweep 2026-07-11 (repo audit, MCP ecosystem, GEO/LLM
visibility, directories, i18n venues, integration surfaces, SEO, critic).

## The reframe

The old model: nanoodle is a destination site, marketing = telling humans about it.
The new model: nanoodle is an **ecosystem that machines and curators index** —
registries, package managers, agent-tool catalogs, answer engines, directories.
A listing is written once and compounds; a post decays in 48 hours.

Four disconnects this plan closes:

1. **Languages ≠ avenues.** We localized 6 landing pages but share in EN (+ a
   little JA). Fix: one durable, indexed asset per language (not chat groups).
2. **Avenues ≠ how discovery works in 2026.** People find tools via answer
   engines, MCP/skill registries, "alternative to X" pages, awesome lists, npm
   search — not via a subreddit post. Fix: shift effort from posting to listing.
3. **Build cost is near zero and unused.** We can ship pages, CLIs, actions,
   and integrations in hours. Fix: programmatic SEO surface, CLI, agent skill,
   RSS changelog, OG worker — build the assets other channels then amplify.
4. **nanoodle's biggest untapped market is AI agents, not humans.** A noodle is
   a typed, composable capability. nanoodle-mcp + Agent Skills make every
   shared noodle URL an executable agent tool. That's a category ("visual
   pipeline → single agent tool"), not another API-wrapper MCP server.

**Measurement (privacy-compatible, the only two dials):** NanoGPT referral
dashboard with a distinct invitation code per major channel (site / exported
apps / MCP / docs), plus Google Search Console impressions. Zero on-site
analytics, ever. Quarterly hand-check: ask ChatGPT/Claude/Perplexity the 5
target queries, log whether nanoodle appears.

## Standing rules

- **Nothing third-party on nanoodle.com.** Badges, embeds, YouTube iframes live
  in GitHub READMEs only. Link, never embed. (CSP is the privacy proof.)
- Reddit/forums: disclosed-maker posts only ("I built one of these"), a handful
  per quarter. No necro-reply campaigns, no volume. r/LocalLLaMA and
  r/StableDiffusion remain VETOED until explicitly un-vetoed.
- Skip list (verified): Wikipedia article (fails GNG, deletion log is negative
  signal — Wikidata item instead), paid GEO tooling, Futurepedia/$497 listings,
  awesome-selfhosted (proprietary-API dependency fails criteria), selfh.st,
  localized Product-Hunt clones (don't exist), Menéame self-submission.
- Cap concurrent NEW integration surfaces at 3 (CLI, agent skill, MCP server).
  Obsidian plugin / Raycast / VS Code deferred unless demand shows up.
- Every repo launch follows the runbook (below). No silent launches.

## Phase 0 — before Show HN (Jul 11–14) 🔴

All P0, all hours-scale:

- [ ] **Link site → GitHub.** Footer/menu link on index/play/legal + 5 lang
      pages; "Is nanoodle open source?" FAQ in legal; GitHub/npm/PyPI in
      JSON-LD sameAs. (Today: zero links. First HN comment is "source?")
- [ ] **llms.txt: add the ecosystem.** Open-source section (org + `npm install
      nanoodle` / `pip install nanoodle` — package is `nanoodle` on BOTH
      registries), share-link #g=/#a= format, noodle-graph.json. Generate
      llms-full.txt (node reference + graph shape + executor quickstarts) via
      scripts/gen-llms-full.mjs.
- [ ] **README pass on nanoodlecom/nanoodle:** hero screenshot/GIF, Ecosystem
      table (copy from org profile), registry-name mapping stated plainly.
- [ ] **AlternativeTo account TODAY** (1-week cooldown; submit ~Jul 18).
- [ ] **LibHunt: submit all public repos before HN** (it captures the mention
      wave automatically).
- [ ] **Search Console + Bing Webmaster registration.** site: shows 1 indexed
      page — nothing else in this plan works until crawling is verified.
- [ ] **Mikkel, in Cloudflare dash** (bundle with Builds reconnect): confirm
      the AI-crawler block is OFF (default-on for new zones; UA-spoof curl
      can't rule out IP-verified blocking). Gates the entire GEO track.
- [ ] Topics + homepageUrl on the 4 still-private repos (so they're indexed
      from hour one when flipped).
- [ ] play.html head: retitle from "My nanoodle app" to app-builder product
      metadata.

## Phase 1 — launch wave + build the surface (Jul 15–31)

**Launch (planned):** Show HN + Product Hunt Jul 15; repos flip public 1/day.

**Partnership + attribution (the critic's biggest find):**
- NanoGPT referral program is live (10% revshare, permanent links) and
  invitation_code on /oauth/authorize is honored. Audit EVERY key-acquisition
  path to carry a code — OAuth flow, get-a-key CTAs on all pages + lang pages,
  executor-lib and MCP READMEs, and the get-a-key link inside every EXPORTED
  app. Mint distinct codes per channel → channel-level conversion data with
  zero tracking.
- Ask NanoGPT for a docs/frontends listing (they said they add "every frontend
  we can think of"; their blog already mentions nanoodle). Highest-authority
  backlink available to a 1-month-old domain. Lead with "we send you paying
  customers."

**SEO surface — must ship by ~Aug 1 or it can't rank inside the window:**
- /noodles/<slug>/ template gallery, batch 1 of 15–20 (the n8n-workflows
  pattern: 500+ unique words, node walkthrough, run-cost from pricing
  resolver, OG screenshot via CDP harness, one-click "open in browser").
- /docs section (real, deployed): node reference (~30 pages generated from the
  node registry), graph JSON spec, executor quickstarts, share-link format,
  self-hosting. Feeds llms-full.txt. docs/ internal audits stay ignored.
- 4–6 hand-written honest comparison pages: /comfyui-alternative (+ no-gpu
  variant), /vs/comfyui, /vs/n8n. Concede ComfyUI's custom-node ecosystem;
  win on no-install + privacy + single-file export + open source. The current
  SERP holders are all peer-scale startups — winnable.
- JSON-LD everywhere (lang pages via gen-lang-pages.mjs, FAQPage on legal),
  sitemap regeneration in build, internal footer links.
- EN-only first. Localize proven winners in Sep (Search Console data), never
  6× machine-translated on day one (sitewide-quality risk).

**Agent-tool track (nanoodle-mcp launch week):**
- server.json + mcp-publisher → official registry (verify com.nanoodle
  namespace via DNS). Re-publish per release (CI).
- Install badges/one-liners in README FIRST (claude mcp add / Cursor deeplink /
  VS Code badge) — directories scrape the README.
- Same day: Smithery, Glama (claim → Official tier), PulseMCP, mcp.so,
  awesome-mcp-servers PR.
- Positioning everywhere: "build a multi-model pipeline visually, hand it to
  your agent as ONE typed tool" + `run_noodle(<share-url>)` so every share
  link on the internet is an executable tool. Ship 3–5 canned noodles as
  named tools (storyboard-from-script, podcast-intro, thumbnail-batch).
- Claude Code plugin (.claude-plugin/) + submit to Anthropic community
  marketplace (form at clau.de/plugin-directory-submission).
- ChatGPT remote-MCP: README note only; do NOT build a hosted endpoint.

**Substrate:**
- `npx nanoodle run <graph.json|share-url>` CLI on the existing npm package
  (fold into the pending --otp publish, + repository-field/keyword/provenance
  hardening on npm and PyPI trove classifiers).
- Flagship Agent Skill (SKILL.md, `npx skills add nanoodlecom/skill`) — the
  open standard spans 30+ agent tools; publishing = pushing a public repo.

**Directory blitz (one sitting each):** OpenAlternative.co,
opensourcealternative.to, AlternativeTo (Jul 18+, vs ComfyUI/n8n/Node-RED),
Slashdot/SourceForge directory, xyflow/awesome-node-based-uis,
localfirstweb.dev + awesome-local-first, pluja/awesome-privacy +
awesome-privacy.xyz, steven2358/awesome-generative-ai, Wikidata item,
free-for-dev (marginal, accept a decline).

## Phase 2 — launch drumbeat + video + languages (August)

**Launch runbook** (write once, ~1 day per launch): topics/homepage set →
README GIF → Show HN draft → Uneed/Fazier/Microlaunch → LibHunt → newsletter
pitches (Console.dev, JavaScript Weekly/Node Weekly, Changelog News) →
MCP/skill registries if applicable → gallery page + changelog entry.

- **mp4cat Show HN** (~Aug 5): zero-dep lossless mp4 concat is HN catnip and
  reaches video devs outside the AI bubble. PR into krzemienski/awesome-video
  (contents.json!) + transitive-bullshit/awesome-ffmpeg (7-day age rule).
- **nanoodle-mcp Show HN** (~Aug 19): rides the MCP wave; registries same day.
- **Video pipeline:** CDP screencast harness → 60–120s silent demos, <1h
  marginal cost each. One per gallery template, per launch, plus "nanoodle vs
  ComfyUI in 90s". YouTube channel; LINK from gallery pages (never embed).
  This is where ComfyUI's audience actually learns tools.
- **Per-model pages:** /models/<slug>/ from the live catalog for ~25 head
  models. Own "[model] in browser / no code" (winnable), not "[model] API"
  (reseller-saturated). New-model day-one pages via the existing daily cron.
- **devtools.fm pitch:** "browser-only node-graph editor, single HTML file, no
  server, no analytics, built by one person + AI agents" — exactly their beat.
- **Language wave 1 (one durable asset each):**
  - JA: Zenn article #1 (drafted) + #2 targeting the ComfyUI search cluster
    ("ComfyUIはローカルGPU必須。nanoodleはブラウザだけ"); Zenn GitHub-repo
    publishing so agents can draft. Qiita crosspost.
  - DE: Kuketz Empfehlungsecke PR on Codeberg (disclose the NanoGPT dependency
    upfront — they WILL check the network tab) + forum feedback thread.
  - FR: LinuxFr dépêche (libre angle, technical substance). Request Journal du
    hacker invite NOW (invite-only, days of lead time).
  - PT: TabNews pitch — architecture story (sanctioned self-promo format).

## Phase 3 — community + compounding (September)

- **awesome-noodles launch:** awesome-lint-clean, every entry = share URL +
  `run_noodle` one-liner + SKILL.md → each community noodle is simultaneously
  gallery content, an agent tool, and an SEO page. noodles.json feeds both
  nanoodle-mcp tool listing and an in-editor "Browse templates" entry
  (My-apps modal mount point) — closes the loop both directions.
- **Community home = GitHub Discussions** (Show-and-tell / Q&A / Ideas), NOT
  Discord: indexed by search + LLMs, near-zero moderation. Generalize the
  Cookoff winners shelf into a monthly "noodle of the month" (~2h/month).
- **RSS/Atom changelog:** render updates.json → /changelog page + feed. The
  only zero-analytics subscription channel; curators and aggregators ingest
  feeds. GitHub Releases on the libs for the same reason.
- **Exported-app footer:** small static "Made with nanoodle" link (+ referral
  code) in every exported app, removal documented. Exported apps circulate
  where we can't reach — currently unbranded. Dual-engine parity applies.
- **Share-link OG worker (v1 = static branded card):** every #g=/#a= link
  pasted in Discord/X/Slack currently renders generic. Fragment never reaches
  the server, so zero privacy cost.
- **Localize winners:** top 10–20 pages by Search Console impressions →
  ES/FR/DE/PT/JA via gen-lang-pages.mjs, human-reviewed, correct hreflang.
- DE #2: GNU/Linux.ch guest article. JA #3: note.com creator-recipe article.
  ES: dev.to #spanish article + Genbeta tip (no strong ES aggregator exists).
- **Hacktoberfest prep (late Sep):** `hacktoberfest` topic org-wide,
  good-first-issues from the open backlog, CONTRIBUTING.md. Headline:
  "contribute a noodle" to awesome-noodles — beginner-achievable PR.
- Listicle outreach: one reusable blurb to the ~10 live "ComfyUI alternatives"
  / "no-code AI tools" posts LLMs currently cite. Expect ~10% hits; permanent.

## Phase 4 — harvest + review (Oct 1–15)

- Hacktoberfest live (agent-triaged review).
- nanolink launch, or fold into a technical blog post: the da.gd h3
  header-stall war story (strong HN submission on its own).
- Quarterly GEO hand-check (5 queries × 3 engines, log results).
- Prune: noindex any programmatic page with zero impressions after 8 weeks.
- Review against targets below; write Q4 rev.

## What "good" looks like by Oct 15 (honest guesses, no data yet)

- 20+ durable listings live (registries, directories, awesome lists).
- 60+ indexed pages on nanoodle.com (from today's ~1); first page-1 long-tail
  rankings for "comfyui alternative no install"-class queries.
- nanoodle-mcp installed via 4+ registries; skill installable everywhere
  SKILL.md works; `npx nanoodle run` shipping.
- 4–5 launch spikes executed via runbook; ≥2 newsletter/podcast placements.
- One indexed flagship asset in each of JA/DE/FR/PT (+ ES dev.to).
- Referral dashboard shows which channel actually converts — the Q4 plan
  gets written from that number.

## Daily habit, upgraded

"Share in one new place per day" becomes **"land one durable distribution
asset per day"** — a listing, a registry publish, a gallery page, a docs page,
a video, an accepted PR to an awesome list. Posts still happen at launches;
they're the spike, not the system. Log stays in growth/shares.md.
