# r/SideProject — nanoodle daily share (draft, Jul 2 2026)

**Venue:** r/SideProject (https://www.reddit.com/r/SideProject/)
**Format:** Video post (attach `nanoodle-demo-30s.mp4` directly — SideProject allows native video uploads, and a 30s screen-capture of a workflow running lands harder than a screenshot). Put the live link in the body.
**Post type:** Video + text body.
**Attach video here:** upload `nanoodle-demo-30s.mp4` as the post's video.
**Live demo link (in body):** https://nanoodle.com

---

**Title:**

I built a ComfyUI-style AI playground that runs 100% in your browser — and any workflow exports to a single .html file you own

---

**Body:**

Hey r/SideProject — solo builder here, this is my project.

It's called nanoodle. You drag nodes onto a canvas, wire up image / text / video / audio / LLM models, and hit run — kind of like ComfyUI, but there's no install and no server. The whole thing is one HTML page running in your browser.

The part I'm most proud of: once you like a workflow, you hit a button and it becomes a standalone app. You can share it as a link, or export it as a single self-contained .html file that you own forever — no backend to keep alive, no account, nothing phoning home. There's zero analytics and zero server by design.

The tradeoff / the honest part: it's bring-your-own-key. Browsing and building the graph is completely free with no signup, but to actually *run* the models you plug in a nano-gpt.com key and pay per call (feeless nano micropayments, so no monthly sub and no expiring credits). I went this route specifically so I never have to run a server or store anyone's data — but it does mean the "run it and see output" moment needs a funded key. Wanted to be upfront about that rather than bury it.

30s demo attached above so you can see a workflow actually run and then get turned into an app.

Live, no signup to poke around: https://nanoodle.com

There's also a little contest running right now if anyone wants a reason to build something — the 🍜 Noodle Cookoff (3 categories, 133 XNO each, closes Jul 12). Totally optional, just a fun excuse.

Happy to answer anything about the architecture — the single-file export and the "no server ever" constraint drove basically every decision and I learned a ton making it work.

---

## Norms note (for the human poster — not part of the post)

- r/SideProject expects you to disclose you're the builder (done in line 1) and to hang around in the comments. Reply to early comments fast; the sub rewards engagement.
- No marketing-speak — the draft leads with *what it does* and names the honest tradeoff (BYO-key paywall on running models) instead of hiding it. Keep that tone in replies.
- Self-promo and contest mentions are fine here (unlike IIB), but the Cookoff is kept to one soft, optional line so it doesn't read as the point of the post.
- Best posting window: weekday morning US time for visibility. Avoid dropping and ghosting.
- If a mod/user asks "is this just a wrapper for an API?" — honest answer: yes, it's a client-side graph editor + runtime over nano-gpt's models; the value is the node UI, the app-export, and the zero-server/zero-analytics ownership model, not the models themselves.
