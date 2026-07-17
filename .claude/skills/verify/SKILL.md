---
name: verify
description: Drive nanoodle's real UI headlessly (zero API spend) to verify index.html/play.html changes end-to-end.
---

# Verifying nanoodle changes in a real browser

No build step — index.html and play.html are the app. Verify by serving the
worktree and driving real Microsoft Edge over raw CDP (no puppeteer; Node 24
has WebSocket built in).

## The recipe (proven)

The reference harness is `proof/output-ux/shot.mjs` (gitignored; lives in
worktrees). Copy its structure for one-off verifications:

1. **Serve the worktree** with a tiny Node `http.createServer` static server on
   port 0 and `await` the `listening` event (python http.server has a bind
   race — don't use it).
2. **Launch Edge** at `/opt/microsoft/msedge/msedge` with `--headless=new`,
   a fresh `--remote-debugging-port`, a `mkdtemp` profile, and
   `--disable-site-isolation-trials --disable-features=IsolateOrigins,site-per-process,SitePerProcessOnly`
   so the sandboxed app iframe stays in-process (full-page screenshots paint
   it, and its DOM is reachable via `Page.createIsolatedWorld`).
   Never reuse a cr-debug :9222 browser — it can't reach Bash-launched
   localhost servers.
3. **Seed state** via `Page.addScriptToEvaluateOnNewDocument`: an owned app is
   `localStorage.noodle_app_state = {v:1, imported:false, ranOnce:false,
   armed:false, graph, samples?, updated}` plus `ngpt_key`,
   `noodle_welcome_seen=1`, `noodle_make_cta_shown=1`. Boot auto-opens it with
   no consent gate. Stub `window.fetch` for nano-gpt.com in the same seed —
   the sandboxed app proxies its calls to the parent, so a parent-side stub
   catches everything. ZERO real API spend.
4. **Drive the real UI** with `Runtime.evaluate` (`userGesture: true`):
   click real buttons, read real DOM. Parent-frame chrome (Share popover,
   toasts: `#toast`, `#sharemenu`) evaluates in the default context; the app's
   own DOM needs the isolated world on the iframe's frameId.

## Gotchas

- **Serve real MIME types.** play.html's module imports `/vendor/*.js`; a
  harness server that answers everything as `text/html` kills the entire
  module graph silently (strict MIME checking) — the page renders its static
  chrome, zero handlers, zero console output, and looks "booted but broken".
  Enable the CDP `Log` domain to see the module-load error; Runtime alone
  won't show it.
- Page JS is not reachable as globals from Runtime.evaluate (module-scoped) —
  drive the UI through DOM clicks, not by calling internal functions.
- Wait for handlers: clicking `#share` etc. right after load can race the
  wiring. Poll for the element AND retry the click/assert loop.
- `hidden` attribute vs CSS: always assert `getComputedStyle(el).display`,
  not just `.hidden`.
- Share/export flows never touch NanoGPT, but ENABLED shorten buttons hit
  real da.gd/TinyURL — only click them when disabled (inertness probe).
- Sample entries on an app: `{id, type, port, ptype:"image"|"text", v}` —
  seed `randomBytes(...).toString("base64")` data URLs when the packed link
  must stay big (random doesn't gzip).
