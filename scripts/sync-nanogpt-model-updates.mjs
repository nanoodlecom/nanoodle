#!/usr/bin/env node
// Watch NanoGPT's public changelog for new model announcements (chat/LLM, image,
// video, audio) plus retirements and pricing notes, and mirror them into
// nanoodle's own 📣 updates.json — because nanoodle's nodes pull their model
// lists straight from NanoGPT's catalogs, so a model NanoGPT adds is a model
// nanoodle users can use *today*, and they should hear about it without us
// shipping a code change.
//
// Classification is by markdown/HTML model links, NOT by NanoGPT's category
// field (Wan 3.0 Prime is category=models but links to /media?mode=video):
//   conversation?model=          → chat / LLM
//   /media?mode=image|video|audio → image / video / audio
//   no model link + title matches retir/deprecat/remov/sunset → retired
//   no model link + title matches price/pricing/cheaper/discount → pricing
//   community / infra / developers / news with no model link → skip
//
// Intent comes from the TITLE before the line is composed:
//   retired/deprecated/removed  → "Retired: …"
//   now use / default / upgraded / returns → "Updated: …" (not "New LLM models")
//   price/pricing/cheaper/discount → "Pricing: …"
//   else → "New LLM/image/video/audio model(s): …" matching the link kind
//
// Source of truth is GET https://nano-gpt.com/api/updates (public JSON, paginated
// with ?offset=&limit=). The updates *page* is a Next.js client-rendered app, so
// if the JSON endpoint fails or returns empty we fall back to a real headless
// browser (--dump-dom) rather than silently no-op — a NanoGPT deploy must not
// stop the cron.
//
// State: scripts/nanogpt-model-updates-seen.json tracks every (date, slug) and
// API id we've already turned into a nanoodle changelog line, so reruns never
// double-add (an id: key also survives a title edit). Existing chat date|slug
// keys are kept. The first run that understands media/retired/pricing only
// ingests those cards with date >= 2026-08-01 (the chat path stays as-is,
// already walked); after that we walk newest-first until a seen API id.
//
// Usage (safe to run repeatedly / on a cron):
//   node scripts/sync-nanogpt-model-updates.mjs                 # writes+commits if anything new; no-op otherwise
//   node scripts/sync-nanogpt-model-updates.mjs --dry-run       # never writes/commits, just reports
//   node scripts/sync-nanogpt-model-updates.mjs --no-translate  # skip the i18n backfill (no API spend)
//   node scripts/sync-nanogpt-model-updates.mjs --no-commit     # write updates.json + changelog artifacts but don't touch git
//   node scripts/sync-nanogpt-model-updates.mjs --push          # also push, after a clean rebase onto origin
//
// Translation spends NanoGPT credits (see scripts/translate-updates.mjs) — set
// NANOGPT_API_KEY in the environment for that step, or pass --no-translate.
// Pushing is opt-in (--push, or NOODLE_SYNC_AUTO_PUSH=1 for cron use) and only
// ever fast-rebases onto origin first; a non-clean rebase aborts and leaves the
// commit local instead of forcing anything.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  cardsFromHtml,
  fetchApiUpdates,
  groupPending,
  selectPending,
  shouldStopFetching,
} from "./lib/nanogpt-updates.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEEN_FILE = join(root, "scripts", "nanogpt-model-updates-seen.json");
const UPDATES_URL = "https://nano-gpt.com/updates";
const API_URL = "https://nano-gpt.com/api/updates";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const noTranslate = argv.includes("--no-translate");
const noCommit = argv.includes("--no-commit");
const doPush = argv.includes("--push") || process.env.NOODLE_SYNC_AUTO_PUSH === "1";

function log(msg) { console.log(`[sync-nanogpt-model-updates] ${msg}`); }

// --- 1. Load cards: JSON first, dump-dom only if that fails -------------------
const BROWSERS = [
  "google-chrome", "google-chrome-stable", "chromium-browser", "chromium",
  "/opt/microsoft/msedge/msedge", "microsoft-edge",
];

function findBrowser() {
  for (const bin of BROWSERS) {
    try {
      execFileSync(bin, ["--version"], { stdio: ["ignore", "ignore", "ignore"] });
      return bin;
    } catch { /* try next */ }
  }
  return null;
}

function renderUpdatesPage() {
  const bin = findBrowser();
  if (!bin) {
    throw new Error(
      "No headless browser found (tried: " + BROWSERS.join(", ") + "). " +
      "JSON /api/updates failed and the HTML page is client-rendered — a real browser is required for the fallback."
    );
  }
  log(`rendering ${UPDATES_URL} via ${bin} (JSON fallback) …`);
  const html = execFileSync(bin, [
    "--headless", "--disable-gpu", "--no-sandbox",
    "--virtual-time-budget=15000", "--dump-dom", UPDATES_URL,
  ], { maxBuffer: 20 * 1024 * 1024, timeout: 45000, encoding: "utf8" });
  if (!html || html.length < 1000) throw new Error("rendered page came back empty/too small — site may have changed");
  return html;
}

async function loadCards(seen) {
  try {
    const cards = await fetchApiUpdates(fetch, {
      url: API_URL,
      shouldStop: (all) => shouldStopFetching(all, seen),
    });
    if (cards.length) {
      log(`fetched ${cards.length} card(s) from ${API_URL}`);
      return { source: "api", cards };
    }
    log("API returned no cards — falling back to dump-dom");
  } catch (e) {
    log(`API unavailable (${e.message}) — falling back to dump-dom`);
  }
  const html = renderUpdatesPage();
  const cards = cardsFromHtml(html);
  log(`parsed ${cards.length} card(s) from the rendered page`);
  return { source: "html", cards };
}

// --- 2. State (seen set) ------------------------------------------------------
function loadSeen() {
  if (!existsSync(SEEN_FILE)) return { seen: [] };
  try {
    const data = JSON.parse(readFileSync(SEEN_FILE, "utf8"));
    return { seen: Array.isArray(data.seen) ? data.seen : [] };
  } catch {
    log(`WARNING: ${SEEN_FILE} is corrupt — treating as empty (first-run bootstrap rules apply)`);
    return { seen: [] };
  }
}

function saveSeen(seenSet, keptKeys) {
  // Newest-known first; cap growth — we only ever need enough history to find
  // the walk-stop point, not a full permanent audit log (git history has that).
  const merged = [...keptKeys, ...seenSet].filter((k, i, a) => a.indexOf(k) === i).slice(0, 500);
  writeFileSync(SEEN_FILE, JSON.stringify({
    _comment: "Tracks NanoGPT /updates entries already folded into ../updates.json: " +
      "date|slug for each model link, plus id:<api-id> so a title edit does not double-post. " +
      "See scripts/sync-nanogpt-model-updates.mjs. Do not hand-edit unless backfilling/correcting history.",
    seen: merged,
  }, null, 2) + "\n");
}

// --- main ---------------------------------------------------------------------
async function main() {
  const { seen } = loadSeen();
  const { source, cards } = await loadCards(seen);
  log(`found ${cards.length} announcement(s) via ${source}`);
  if (!cards.length) {
    log("nothing to do — either NanoGPT posted none recently, or both the JSON API and the page markup failed.");
    process.exit(0);
  }

  const pending = selectPending(cards, seen);
  if (!pending.length) {
    log("no new model / retirement / pricing cards since the last check. Nothing to do.");
    process.exit(0);
  }

  const groups = groupPending(pending);
  log(`${pending.length} new card(s) → ${groups.length} changelog line(s): ${groups.map(g => g.titles.join(" & ")).join("; ")}`);

  if (dryRun) {
    for (const g of groups) log(`  [dry-run] ${g.date} — ${g.text}`);
    process.exit(0);
  }

  // Oldest-of-the-batch first so newest ends up on top; --day-end keeps mirrored
  // model news below any hand-written product update sharing the same date.
  for (const g of [...groups].reverse()) {
    execFileSync("node", [join(root, "scripts", "add-update.mjs"), "--day-end", g.date, g.text], { stdio: "inherit" });
  }

  saveSeen(seen, pending.flatMap(p => p.keys));
  log(`wrote ${groups.length} line(s) to updates.json and updated ${SEEN_FILE}`);

  // --- 3. Validate + regenerate public /changelog artifacts --------------------
  // The in-app 📣 panel reads updates.json live; the public page and Atom feed
  // are generated. Skipping this is how /changelog froze at 5 August while
  // updates.json kept growing.
  execFileSync("node", [join(root, "scripts", "check-updates.mjs")], { stdio: "inherit" });
  execFileSync("node", [join(root, "scripts", "gen-changelog.mjs")], { stdio: "inherit" });

  // --- 4. Translate (spends credits) -------------------------------------------
  if (!noTranslate) {
    if (!process.env.NANOGPT_API_KEY) {
      log("NANOGPT_API_KEY not set — skipping translation (entries ship English-only for now). Run scripts/translate-updates.mjs by hand later.");
    } else {
      log("backfilling translations …");
      execFileSync("node", [join(root, "scripts", "translate-updates.mjs")], { stdio: "inherit" });
    }
  } else {
    log("--no-translate: skipping i18n backfill.");
  }

  // --- 5. Commit --------------------------------------------------------------
  if (noCommit) {
    log("--no-commit: leaving changes uncommitted.");
    process.exit(0);
  }

  const NOODLE_SKIP_UPDATE_HOOK = { ...process.env, NOODLE_SKIP_UPDATE_HOOK: "1" }; // our own commit already carries updates.json — don't let post-commit re-fire
  execFileSync("git", ["add", "updates.json", SEEN_FILE, "changelog.html", "feed.xml"], { cwd: root, stdio: "inherit" });
  const summary = groups.map(g => g.titles.join(" & ")).join(", ");
  const message = `chore(updates): NanoGPT model sync — ${summary}\n\nAuto-generated by scripts/sync-nanogpt-model-updates.mjs from ${source === "api" ? API_URL : UPDATES_URL}.`;
  execFileSync("git", ["commit", "-m", message], { cwd: root, stdio: "inherit", env: NOODLE_SKIP_UPDATE_HOOK });
  log("committed.");

  // --- 6. Push (opt-in: --push or NOODLE_SYNC_AUTO_PUSH=1) --------------------
  // Only ever fast-forwards onto origin/main first — if main has moved in a way
  // that doesn't cleanly rebase, we bail and leave the commit local rather than
  // force anything or risk clobbering concurrent work.
  if (!doPush) {
    log("not pushing (pass --push or set NOODLE_SYNC_AUTO_PUSH=1 to push automatically). Commit is local on this branch.");
    process.exit(0);
  }

  try {
    // NOODLE_SYNC_PUSH_BRANCH pins the push target regardless of the checked-out
    // branch name — the cron worktree sits on a local "cron-sync" branch but must
    // land its commits on origin/main.
    const branch = process.env.NOODLE_SYNC_PUSH_BRANCH
      || execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    execFileSync("git", ["fetch", "origin", branch], { cwd: root, stdio: "inherit" });
    execFileSync("git", ["rebase", `origin/${branch}`], { cwd: root, stdio: "inherit" });
    execFileSync("git", ["push", "origin", `HEAD:${branch}`], { cwd: root, stdio: "inherit" });
    log(`pushed to origin/${branch}.`);
  } catch (e) {
    try { execFileSync("git", ["rebase", "--abort"], { cwd: root, stdio: "ignore" }); } catch { /* nothing to abort */ }
    log(`WARNING: push failed (${e.message.split("\n")[0]}) — commit remains local; resolve and push by hand.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`[sync-nanogpt-model-updates] ${err && err.stack || err}`);
  process.exit(1);
});
