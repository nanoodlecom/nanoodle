# Jul 20 — Cookoff results post (late, and says so)

Venue: **r/nanocurrency** (new post), then link it from nano-gpt Discord
#community-projects + quote-tweet the original contest thread from @nanosapien1.

Fill before posting: the chaos one-liner, tx receipts if winners are cool with
it (runbook: Nano crowd loves receipts). Handles are in.

---

## Reddit post — r/nanocurrency

**Title:** 🍜 Noodle Cookoff results — prizes paid, one winner lost to automod (are you the security-camera builder?)

> The Cookoff closed Jul 12 and I'm a week late posting results — that's on me;
> the prizes themselves already went out on-chain. Here's who cooked:
>
> 💡 **Most Innovative — "AI Telephone Game" by u/yuppienetwork1996** — 133 XNO
> A photo gets described by one vision model, redrawn by another from that
> description alone, described again, redrawn again. Generation loss, but for
> AI — watching what survives the whispering is genuinely fascinating (and a
> little unsettling when the photo is *you*).
> Try it on your own webcam photo: [share link]
>
> ❤️ **People's Choice — "RetroHandheldVision" by @NanoCharts (Twitter)** — 133 XNO
> Any photo → monochrome 8-bit handheld screen. Two nodes, instant nostalgia,
> most votes. [share link]
>
> 🌀 **Chaos Award — u/blaketran** — 13.3 XNO
> This category did not exist until they made it necessary. (No, it wasn't
> planned — it's a *Chaos* Award, planning one would disqualify it.) Their
> entry was, strictly speaking, not a noodle. It was also too good to ignore,
> so it gets 10% of a prize for being 0% of a noodle.
> [one line on what it actually was]
>
> 🛠 **Most Useful — LOST, and I need your help.** Someone submitted a video
> security-camera workflow and automod removed the comment before I could save
> it. If that was you: reply here or DM me — your 133 XNO and gallery spot are
> waiting. (Mods, if you can see the removed comment in the queue, a restore
> would be heroic.)
>
> Winners are now featured in-app — 📚 Examples → "From the community", credited
> — so anyone can open, run, and remix them. Thank you all for cooking. 👨‍🍳

---

## Reply to the Telephone Game winner's feature ask
(they asked for "output to Excel file" / "output to executable Python script")

> On the "executable Python script" wish — that shipped, just quietly. Your
> share link IS the script:
>
> ```python
> # pip install nanoodle
> from nanoodle import Workflow
> wf = Workflow.load("https://nanoodle.com/#g=<your-telephone-game-link>")
> result = wf.run({"image": "webcam.jpg"})     # your NanoGPT key via env
> result["Image"].save("round2.png")
> ```
>
> Whole graph runs headlessly — telephone game as a cron job, basically.
> `Workflow.load` also takes a saved `noodle-graph.json` (💾 Save workflow in
> the editor) if you'd rather keep it as a file than a link. Same for JS:
> `npm i nanoodle`. And if you use a coding agent (Claude Code, Cursor, …),
> `npx skills add nanoodlecom/nanoodle-skill` teaches it to build and run
> noodles for you — "run my telephone game on this photo" becomes a prompt.
> Excel/CSV output doesn't exist yet — it's a genuinely good idea and it's
> on the list now.

## Checklist
- [ ] Recover Most Useful: check your Reddit **inbox → comment replies ~Jul 11–12**
      — the notification keeps the text+author even after automod removal; else
      modmail r/nanocurrency for the removed-comment queue
- [ ] Post, then Discord + X echo (quote the original contest thread)
- [ ] When Most Useful resurfaces: pay 133 XNO, add the reserved podium card
