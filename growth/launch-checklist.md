# Launch checklist — the four pending launches

One page. Everything to paste at all four venues is here, and this is the only
copy of it. The four draft files hold the framing, the comment FAQ and the asset
notes; none of them repeats a post body, so a correction here is the whole
correction.

Written 2026-07-29. The published version figures were verified live on that
date. Every other fact carries forward from the 2026-07-28 pass against the live
product.

Five pull requests merged on 2026-07-29, after that pass. None of them makes a
claim below false, and one of them is worth adding to the copy: a signed-out
visitor can now reach a **video** result in the sample run, with no account and no
key. Before, the sample covered text and images only. The showcase is also linked
from the product now. Re-read the hooks with that in mind before you post. `scripts/check-launch-facts.mjs` re-checks the load-bearing figures
on every commit, so a stale draft fails the hook instead of reaching a reader.
Only Mikkel can post. A pull request cannot.

**Suggested order:** AlternativeTo → r/mcp → Show HN → Product Hunt.
Reasons are in `shares.md`. You can do 1 and 2 today in under an hour.

**Rules that apply to all four:**
- Disclose that you are the maker. Every venue.
- Never write "free" in a call to action. Say what it costs.
- Never ask for votes. Not on any platform, not in any Discord, not in DMs.
- Say the bring-your-own-key cost out loud. Do not bury it.
- Name a payment rail only where this file tells you to.
- Never propose an importer or a converter from another tool.

**Re-check on the day** (both packages ship often, and a wrong version number in
a launch post is the kind of error people quote back at you):
```
npm view nanoodle version          # 0.8.0 on 2026-07-29
npm view nanoodle-mcp version      # 0.4.0 on 2026-07-29
pip index versions nanoodle        # 0.5.0 on 2026-07-29
```

**Do not show the 🎨 Draw node in any screenshot.** That node retired on
2026-07-22. A screenshot with it is a false claim in a launch post.

---

## 1. AlternativeTo — 20 minutes, no timing pressure

**Account:** an AlternativeTo account. The 7-day new-account gate lifted on
2026-07-13, so the account is old enough.
**Where:** https://alternativeto.net/manage-item/
**When:** any time. This is directory SEO, not a launch spike.
**Community rule:** entries are community-moderated. A plain, accurate
description survives review. Marketing copy gets edited or removed. Undisclosed
self-listings get removed.

**Steps:**
1. Search AlternativeTo for "nanoodle" first. The site blocks scripted checks, so
   do this by hand. Stop if an entry already exists. A duplicate gets rejected.
2. Open the manage-item form and paste the fields below.
3. Attach 2 or 3 screenshots. Use the editor canvas with a wired graph, an
   exported app running from a `file://` URL, and the share dialog. The Product
   Hunt gallery assets work. They are in your local `shareassets/` folder, which
   is gitignored and is not on GitHub.
4. Disclose in the submission that you are the maker.
5. Add the "alternative to" entries.
6. Log the live URL in `shares.md`.

**Name:** `nanoodle`

**URL:** `https://nanoodle.com`

**Short description:**

> Node-graph AI workflow editor that runs entirely in the browser — no install,
> no server, no analytics; export any workflow as a standalone HTML app.

**Full description:**

> nanoodle is a client-side-only node canvas for chaining AI models (LLM, image,
> video, audio/TTS) into workflows. Everything runs in your browser: there is no
> backend, no account system on nanoodle's side, and no analytics. You bring your
> own NanoGPT (nano-gpt.com) API key — paste it or sign in via OAuth — and pay the
> provider per call; nanoodle never sees your key, prompts, or outputs.
>
> Workflows are shared as URLs (the graph is encoded in the URL fragment, which
> never reaches a server) or exported as a single self-contained .html file you
> can host anywhere or open from disk. A built-in Examples panel carries fifteen
> ready-made workflows, mirrored from an open gallery repository and shipped
> inside the page, so there is something to run on the first visit and the panel
> itself needs no network. The same graph format also runs headlessly via the
> `nanoodle` package on npm (0.8.0) and PyPI (0.5.0), and there's an MCP server
> and a GitHub Action.
>
> Open source (MIT) — the site is served straight from its repository, and the
> whole ecosystem (13 public repos) is public at https://github.com/nanoodlecom.

**License:** Open Source (MIT)
**Platforms:** Online (web); Self-Hosted (nanoodle is a static folder, so any
file server hosts it)
**Pricing:** pick "Free • Open Source". Note the BYO-key cost in the description.
Do not present it as fully free to operate.
**Tags:** ai-workflow, node-editor, no-code, privacy, browser-based,
text-to-image, workflow-automation

**Alternative to:**
- ComfyUI (primary) — https://nanoodle.com/nanoodle-vs-comfyui and
  https://nanoodle.com/comfyui-alternative
- n8n (secondary, AI-chain use cases only) — https://nanoodle.com/nanoodle-vs-n8n
- Do not claim Zapier or other automation platforms. nanoodle has no triggers.
  The listing gets disputed.

**Do not mention mcp.nanoodle.com or Nano here.** This audience came for a
ComfyUI replacement. A payments conversation costs you the listing's credibility
and gains nothing.

---

## 2. r/mcp — 30 minutes, then answer comments for an hour

**Account:** your Reddit account.
**Where:** https://reddit.com/r/mcp (the MCP Discord's #showcase channel is the
alternative or the follow-up).
**When:** a weekday morning US time. Stay for about an hour after posting.
**Community rule:** read the subreddit rules and the pinned post before you
post. Self-promotion limits change. Disclose that you built it, in the post body,
not in a reply. This audience wants server mechanics, not a product pitch.
**Framing rule:** lead with the mechanism, which is HTTP 402. Name Nano once, as
the rail. Never lead with the coin, a price chart, or an investment angle.

**Title:**

> An MCP server with no signup and no API key — the 402 payment IS the handshake

**Body:**

> I run a browser node-graph editor (nanoodle.com) where you wire text/image/video/
> audio models into a workflow and save it as JSON. The MCP server turns those
> saves into tools. There are two ways to use it, and the second one is the part I
> think is actually new.
>
> **Self-hosted:** point it at a folder of saved graphs and every graph becomes an
> MCP tool.
>
> ```
> claude mcp add nanoodle --env NANOGPT_API_KEY=... -- npx -y nanoodle-mcp --graphs ~/noodles
> ```
>
> - Each graph's *inputs* become the tool's typed parameters. A graph with a "Text"
>   input and an "Image" output is a tool your client calls with text and gets an
>   image back.
> - Plus a `run_noodle` tool that executes any nanoodle share link directly.
> - Hand-rolled JSON-RPC over stdio and streamable HTTP, small enough to read.
>   Offline test suite. Your key never touches stdout or logs.
>
> **Hosted, no account anywhere:** https://mcp.nanoodle.com/mcp
>
> ```
> claude mcp add --transport http noodles https://mcp.nanoodle.com/mcp
> ```
>
> That is the entire setup. No signup, no API key, no dashboard. Fifteen workflows are
> published on it right now — image generation and editing, image-to-video, TTS +
> lipsync, a music one, a four-way model arena.
>
> The handshake: your agent calls a tool, the server answers with an HTTP 402 and a
> payment link, you scan the QR with any Nano wallet, and the run streams back a
> couple of seconds later. Paying *is* the authentication — there is no identity to
> establish, so there is nothing to sign up for. Mechanically:
>
> - What you pay up front is a **deposit**. The run settles at the model's actual
>   metered cost + 20%, and the difference goes back to the paying wallet on-chain.
> - That 20% is routable to the person who wrote the workflow: a graph that names
>   a Nano address in its JSON collects the whole markup of every paid run,
>   on-chain, automatically. None of the fifteen published workflows claims one yet,
>   so right now it lands in the server wallet. Add a workflow to the gallery
>   with your address in it and that changes.
> - A failed run refunds the whole payment automatically. Quotes expire after 15
>   minutes.
> - The server can also sit on the *paying* side: with no API key set, it runs in
>   wallet mode, signs the Nano send block locally and pays 402s itself. `--max-usd`
>   caps one call; the wallet balance caps the total.
>
> It costs real money per call either way, and the server prints a cost line per
> invocation so an agent can report what it spent.
>
> Config for Claude Code / Cursor / VS Code / Windsurf / Claude Desktop is in the
> README at github.com/nanoodlecom/nanoodle-mcp (it also installs as a Claude Code
> plugin). I built this, happy to answer anything about the graph→tool mapping or
> the 402 flow.

**Asset:** none needed. Text post. Do not attach a video.

**If the subreddit rejects paid or crypto content:** drop the hosted half and
post the self-hosted half only. The graphs→tools mapping stands on its own.

**After:** log the link and the response in `shares.md`.

---

## 3. Show HN — block the whole morning

**Account:** your Hacker News account.
**Where:** https://news.ycombinator.com/submit
**When:** 8am to 10am US Eastern, on a weekday. Do not post and leave. The first
two hours of replies decide the outcome.
**Community rule:** Show HN is for something a reader can try immediately. The
URL must land on a usable thing. Titles stay under 80 characters, factual, no
superlatives — moderators edit hype out. Never solicit upvotes anywhere.
**Dupe check:** done on 2026-07-28. hn.algolia.com returns 0 stories with
"nanoodle" in the title or URL. Nothing to work around.
**Framing rule:** no crypto and no contest language in the post itself. If
someone finds the Nano angle, answer honestly — the prepared answer is in
`show-hn-draft.md` under "Crypto??". Read that answer before you post.

**Title:**

> Show HN: Nanoodle – node-graph AI workflows in one HTML file, no server

**URL:** `https://nanoodle.com`

**First comment — post it immediately after you submit:**

> Hi HN — solo builder here. Nanoodle is a ComfyUI-style node canvas that runs
> entirely in the browser: wire text/image/video/audio models into a graph, run it,
> then export the graph as a standalone single-file .html app you can host anywhere
> or open from disk.
>
> The whole product is one static HTML page — no build step, no bundler, no backend.
> It's open source (MIT): https://github.com/nanoodlecom/nanoodle
> Constraints that fell out of that, which turned out to be the interesting part:
>
> - Exported apps embed their own runtime, so the runtime JS lives in a String.raw
>   template inside the page. A single backtick anywhere in it silently ends the
>   template and breaks every export, so a pre-commit hook pulls every inline
>   script out of the HTML and syntax-checks it. That hook exists because of the
>   backtick.
> - The editor and the exported app are two run-engines that must behave identically.
>   Engine drift became the dominant bug class, so parity is enforced by hooks too.
> - No server means auth is OAuth PKCE browser→provider, persistence is the
>   browser's localStorage + share-links in URL fragments (the fragment never hits
>   any server), and there's zero analytics — not as a policy, but because there's
>   nothing to receive it.
>
> The graph format is portable beyond the browser: the same noodle-graph.json runs
> headlessly via `npm install nanoodle` (a zero-dependency Node library/CLI) or
> `pip install nanoodle` (stdlib-only Python), and there's an MCP server and a
> GitHub Action. Everything lives under https://github.com/nanoodlecom — 13 public
> repos, all MIT.
>
> If you'd rather see the format than the canvas, the 📚 Examples panel in the
> editor holds fifteen ready-made graphs, mirrored from an open gallery repo
> (https://github.com/nanoodlecom/awesome-noodles) and shipped inline, so opening
> the panel costs no network at all. Every entry is a plain JSON file in that
> repo, so you can read a workflow before you run one.
>
> The honest tradeoff: it's bring-your-own-key. Building and browsing need no
> signup, but running models goes through your own nano-gpt.com key, pay-per-call.
> I built it this way so I never host anyone's data or keys — but it does put the
> "wow" moment behind funding an account, and I'm still working on softening that
> (there's a canned demo run for signed-out visitors).
>
> Happy to answer anything about the single-file architecture — it forced more
> design decisions than any feature did.

**Asset:** none. The URL is the demo.

**Comment prep:** the full FAQ is in `show-hn-draft.md`. Skim it once the night
before. Answer in your own words. Do not paste the FAQ.

**If it stalls** (under about 5 points in 2 hours): let it die quietly. A
respectful re-submit weeks later is allowed. Bump-begging is fatal.

**After:** log the result in `shares.md`, win or lose.

---

## 4. Product Hunt — set up the night before, answer all day

**Account:** a Product Hunt account that is **not** brand new. Create it or dust
it off at least 3 days before launch day, and follow or comment a little. A
zero-history account whose first act is a launch does badly. **Check this
first — it is the only item with a lead time, and it can move your date.**
**Where:** producthunt.com — use the "Submit" / "Launch" control in the site
header while signed in. Do not trust a bookmarked submit URL; PH moves that path.
**When:** PH days roll over at 12:01am PT. Set the launch up the evening before.
Tuesday and Wednesday are competitive but liquid. Best sequencing: the Tue or Wed
right after your Show HN day, so you can quote a good HN exchange.
**Community rule:** never ask for upvotes. PH removes listings for it. A neutral
"we launched today, here is the link" on X or in a Discord is acceptable.
**Framing rule:** product-led. No crypto in the listing. Honest pay-per-call
pricing. Do not write bare "Free".

**Name:** `nanoodle`

**Tagline (60 characters max):**

> Wire AI models into apps — in your browser, no server

**Description (260 characters max):**

> A node canvas for chaining text, image, video & audio AI models. Runs entirely
> in your browser — no server, no analytics, no subscription. Export any workflow
> as a standalone single-file .html app you own, or share it as a link. BYO
> nano-gpt key, pay per call.

**Topics:** Artificial Intelligence · No-Code · Privacy · Developer Tools ·
Open Source

**Links:** add https://github.com/nanoodlecom/nanoodle. PH turns it into an
"Open Source" badge and it pre-answers the trust question.

**Pricing field:** choose "Free options" / "Payment required to run models".
Describe it as "no signup to build; running models uses your own API key,
pay-per-call (typically cents)".

**Assets:**
- First gallery slot, and the thumbnail:
  `shareassets/nanoodle-demo-square-1080.mp4`. PH favours a moving first asset.
  That folder is gitignored, so the file is only in your local checkout.
- 3 to 5 stills: the editor canvas with a wired graph, the hero result view, the
  export dialog, an exported app running from a `file://` URL, the 📚 Examples
  panel.
- One community slide: screenshot the "🏆 From the community" shelf inside the
  📚 Examples panel. It carries two credited Cookoff winners — AI Telephone Game
  (💡 Most Innovative, u/yuppienetwork1996) and RetroHandheldVision (❤️ People's
  Choice, @NanoCharts). Two entries, not three. The 🛠 Most Useful winner never
  resurfaced after automod ate the submission, so do not claim a third.

**Maker's first comment:**

> Hey PH 👋 — solo builder here.
>
> nanoodle started from a constraint: what's the most capable AI tool I can build
> with NO backend at all? The answer turned out to be a node-graph playground —
> drag models onto a canvas (LLMs, image gen/edit, video, TTS, music), wire them
> together, hit run. Everything executes in your browser.
>
> Two things I care most about:
>
> 🗂 **You own the output.** Any workflow exports to a single .html file — a real
> app you can email, host anywhere, or open from a USB stick in ten years. No
> platform lock-in, nothing phoning home, zero analytics anywhere.
>
> 💳 **No subscription.** You bring your own nano-gpt.com key and pay per model
> call (usually cents). No monthly fee, no expiring credits, and your key never
> touches a server of mine because there isn't one.
>
> The honest tradeoff: the bring-your-own-key step is real friction before your
> first run — there's a signed-out demo run so you can see it work first, but I
> won't pretend the setup step isn't there.
>
> Earlier this month the community ran a little build contest, and the two winners
> are now on the shelf inside the app's 📚 Examples panel, credited — a photo
> whispered between vision models until the details drift, and a one-node retro
> handheld-screen filter. Ask me anything, especially about the single-file /
> no-server architecture. 🍜

**Comment prep:** reuse the Show HN FAQ in a softer tone. Two PH-specific
answers are in `product-hunt-draft.md`.

**After:** log the result in `shares.md`.

---

## After all four

- Fill in the `shares.md` table: date, venue, angle, result. The log only
  compounds if it is true. Write "flopped" when it flopped.
- Answer every substantive comment on every venue on the day it lands. A late
  answer reads as abandonment.
- Add one post-mortem line to `shares.md`: what worked, and what to change in
  `launch-runbook.md`. Then change it.
