#!/usr/bin/env node
// Watch NanoGPT's public changelog (https://nano-gpt.com/updates) for new CHAT/LLM
// model announcements and mirror them into nanoodle's own 📣 updates.json — because
// nanoodle's LLM node pulls its model list straight from NanoGPT's catalog, so a
// model NanoGPT adds is a model nanoodle users can use *today*, and they should
// hear about it without us shipping a code change.
//
// Scope is deliberately narrow: only entries whose announcement links to
//   https://nano-gpt.com/conversation?model=<slug>
// (NanoGPT's chat-model conversation page). Image/video/audio models link to
// /media?mode=... instead and are out of scope here — those already get their own
// growth passes (see the audio/NSFW-toggle work). Community-app posts (World Forge,
// LettuceAI, etc.) and infra notices (billing modes, deposits) carry no model link
// at all, so they're naturally skipped too.
//
// The updates page is a Next.js client-rendered app (no server HTML, no RSS) — the
// entries only exist after client JS runs. We render it with a real headless
// browser (--dump-dom) rather than reverse-engineer whatever internal API it
// calls, since that's far more likely to survive NanoGPT's next deploy.
//
// State: scripts/nanogpt-model-updates-seen.json tracks every (date, slug) we've
// already turned into a nanoodle changelog line, so reruns never double-add. On
// the very first run (no state file yet) we walk newest-first from the top of the
// page down through — and including — BOOTSTRAP_FLOOR_SLUG, then stop; anything
// older than that floor is assumed already known/irrelevant. Every run after that
// just walks until it hits an already-seen entry.
//
// Usage (safe to run repeatedly / on a cron):
//   node scripts/sync-nanogpt-model-updates.mjs                 # writes+commits if anything new; no-op otherwise
//   node scripts/sync-nanogpt-model-updates.mjs --dry-run       # never writes/commits, just reports
//   node scripts/sync-nanogpt-model-updates.mjs --no-translate  # skip the i18n backfill (no API spend)
//   node scripts/sync-nanogpt-model-updates.mjs --no-commit     # write updates.json but don't touch git
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEEN_FILE = join(root, "scripts", "nanogpt-model-updates-seen.json");
const UPDATES_URL = "https://nano-gpt.com/updates";

// The model slug the user pointed at as the starting boundary: "this one, and
// everything newer than it, should get a nanoodle changelog entry." Only used
// to bound the very first run, before any state file exists.
const BOOTSTRAP_FLOOR_SLUG = "tencent/hy3";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const noTranslate = argv.includes("--no-translate");
const noCommit = argv.includes("--no-commit");
const doPush = argv.includes("--push") || process.env.NOODLE_SYNC_AUTO_PUSH === "1";

const MONTHS = {
  January: "01", February: "02", March: "03", April: "04", May: "05", June: "06",
  July: "07", August: "08", September: "09", October: "10", November: "11", December: "12",
};

function log(msg) { console.log(`[sync-nanogpt-model-updates] ${msg}`); }

// --- 1. Render the updates page with a real headless browser ----------------
// Candidate binaries, in preference order. Anything supporting --dump-dom works.
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
      "The NanoGPT updates page is client-rendered — a real browser is required to see entries."
    );
  }
  log(`rendering ${UPDATES_URL} via ${bin} …`);
  const html = execFileSync(bin, [
    "--headless", "--disable-gpu", "--no-sandbox",
    "--virtual-time-budget=15000", "--dump-dom", UPDATES_URL,
  ], { maxBuffer: 20 * 1024 * 1024, timeout: 45000, encoding: "utf8" });
  if (!html || html.length < 1000) throw new Error("rendered page came back empty/too small — site may have changed");
  return html;
}

// --- 2. Parse out chat-model announcement entries ----------------------------
// Anchored on Mantine's own (library) class names / data-attributes, NOT on the
// app's per-deploy content-hashed wrapper classes (those change every build).
function stripTags(s) { return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim(); }

function enclosingParagraphText(html, nearIndex) {
  const pOpen = html.lastIndexOf("<p", nearIndex);
  const pClose = html.indexOf("</p>", nearIndex);
  if (pOpen === -1 || pClose === -1) return null;
  const gt = html.indexOf(">", pOpen);
  if (gt === -1 || gt > pClose) return null;
  return stripTags(html.slice(gt + 1, pClose));
}

function parseDate(raw) {
  const m = raw && raw.match(/(\w+)\s+(\d+),\s+(\d+)/);
  if (!m) return null;
  const mon = MONTHS[m[1]];
  if (!mon) return null;
  return `${m[3]}-${mon}-${String(m[2]).padStart(2, "0")}`;
}

function extractEntries(html) {
  const linkRe = /<a href="https:\/\/nano-gpt\.com\/conversation\?model=([^"]+)"[^>]*>([^<]*)<\/a>/g;
  const entries = [];
  let m;
  while ((m = linkRe.exec(html))) {
    const slug = decodeURIComponent(m[1].replace(/&amp;/g, "&"));
    const idx = m.index;
    const lgPos = html.lastIndexOf('data-size="lg"', idx);
    const title = lgPos !== -1 ? enclosingParagraphText(html, lgPos) : null;
    const description = enclosingParagraphText(html, idx); // the <p data-size="sm"> containing the link
    const xsPos = html.indexOf('data-size="xs"', idx);
    const dateRaw = xsPos !== -1 ? enclosingParagraphText(html, xsPos) : null;
    const date = parseDate(dateRaw);
    if (!slug || !title || !date) continue; // couldn't confidently parse this card — skip, don't guess
    entries.push({ slug, title: stripTags(m[2]) || title, description, date });
  }
  return entries; // page order = newest first
}

// --- 3. Compose a nanoodle-facing changelog line from NanoGPT's announcement --
function trimDetail(description) {
  const parts = (description || "").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  // Drop leading pure-availability sentences ("<Model> is now available!") — the
  // entry title already says exactly that. Sentence-level, NOT a prefix regex:
  // dotted model names ("Qwen3.8", "Grok 4.5") defeat any [^.]* lead-in match.
  while (parts.length && /^.{0,80}?\b(?:is|are)(?: now)? available(?: again)?[.!]$/.test(parts[0])) parts.shift();
  // The scraped card copy is itself cut off mid-sentence ("… It uses…"), so a
  // raw length cap ships a dangling fragment into a "one line per change" log.
  // Keep whole sentences up to ~200 chars and drop any trailing fragment —
  // unless the fragment is all there is.
  const kept = [];
  for (const s of parts) {
    if (kept.length && (kept.join(" ").length + s.length + 1 > 200 || /…$/.test(s))) break;
    kept.push(s);
  }
  // Smooth "<Title> — It is a …" into "<Title> — a …" — the title already named
  // the subject, so the pronoun just repeats it awkwardly after the em dash.
  let detail = kept.join(" ").replace(/^(?:It(?:'s| is)|They(?:'re| are))\s+/, "");
  if (detail.length > 220) detail = detail.slice(0, 217).replace(/\s+\S*$/, "") + "…";
  return detail;
}

function toChangelogText(titles, description) {
  const detail = trimDetail(description);
  const title = titles.join(" & ");
  const label = titles.length > 1 ? "New LLM models" : "New LLM model";
  const text = detail
    ? `${label}: ${title} — ${detail}`
    : `${label}: ${title} ${titles.length > 1 ? "are" : "is"} now available for the LLM node.`;
  return text.replace(/\s+/g, " ").trim();
}

// --- 4. State (seen set) ------------------------------------------------------
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
  const merged = [...keptKeys, ...seenSet].slice(0, 300);
  writeFileSync(SEEN_FILE, JSON.stringify({
    _comment: "Tracks NanoGPT /updates chat-model entries (date|slug) already folded into ../updates.json. " +
      "See scripts/sync-nanogpt-model-updates.mjs. Do not hand-edit unless backfilling/correcting history.",
    seen: merged,
  }, null, 2) + "\n");
}

// --- main ---------------------------------------------------------------------
const html = renderUpdatesPage();
const entries = extractEntries(html);
log(`found ${entries.length} chat-model (conversation?model=) announcement(s) in the rendered page`);
if (!entries.length) {
  log("nothing to do — either NanoGPT posted none recently, or the page markup changed (parser may need an update).");
  process.exit(0);
}

const { seen } = loadSeen();
const seenSet = new Set(seen);
const isBootstrap = seen.length === 0;

const pending = []; // newest-first, same order as `entries`
for (const entry of entries) {
  const key = `${entry.date}|${entry.slug}`;
  if (seenSet.has(key)) break; // reached a previously-processed point — stop walking
  pending.push({ ...entry, key });
  if (isBootstrap && entry.slug === BOOTSTRAP_FLOOR_SLUG) break; // first run: stop at the given floor, inclusive
}

if (!pending.length) {
  log("no new chat models since the last check. Nothing to do.");
  process.exit(0);
}

log(`${pending.length} new entr${pending.length === 1 ? "y" : "ies"} to add: ${pending.map(p => p.title).join(", ")}`);

// One NanoGPT announcement often covers several models (each gets its own card
// with the same date + description) — mirror it as ONE line ("New LLM models:
// A & B — …"), not near-duplicate neighbours.
const groups = [];
for (const entry of pending) {
  const g = groups.find(g => g.date === entry.date && g.description === entry.description);
  if (g) g.titles.push(entry.title);
  else groups.push({ date: entry.date, description: entry.description, titles: [entry.title] });
}

if (dryRun) {
  for (const g of groups) log(`  [dry-run] ${g.date} — ${toChangelogText(g.titles, g.description)}`);
  process.exit(0);
}

// Oldest-of-the-batch first so newest ends up on top; --day-end keeps mirrored
// model news below any hand-written product update sharing the same date.
for (const g of [...groups].reverse()) {
  const text = toChangelogText(g.titles, g.description);
  execFileSync("node", [join(root, "scripts", "add-update.mjs"), "--day-end", g.date, text], { stdio: "inherit" });
}

saveSeen(seen, pending.map(p => p.key));
log(`wrote ${pending.length} entr${pending.length === 1 ? "y" : "ies"} to updates.json and updated ${SEEN_FILE}`);

// --- 5. Validate -------------------------------------------------------------
execFileSync("node", [join(root, "scripts", "check-updates.mjs")], { stdio: "inherit" });

// --- 6. Translate (spends credits) -------------------------------------------
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

// --- 7. Commit --------------------------------------------------------------
if (noCommit) {
  log("--no-commit: leaving changes uncommitted.");
  process.exit(0);
}

const NOODLE_SKIP_UPDATE_HOOK = { ...process.env, NOODLE_SKIP_UPDATE_HOOK: "1" }; // our own commit already carries updates.json — don't let post-commit re-fire
execFileSync("git", ["add", "updates.json", SEEN_FILE], { cwd: root, stdio: "inherit" });
const summary = pending.map(p => p.title).join(", ");
const message = `chore(updates): NanoGPT LLM model sync — ${summary}\n\nAuto-generated by scripts/sync-nanogpt-model-updates.mjs from https://nano-gpt.com/updates.`;
execFileSync("git", ["commit", "-m", message], { cwd: root, stdio: "inherit", env: NOODLE_SKIP_UPDATE_HOOK });
log("committed.");

// --- 8. Push (opt-in: --push or NOODLE_SYNC_AUTO_PUSH=1) --------------------
// Only ever fast-forwards onto origin/main first — if main has moved in a way
// that doesn't cleanly rebase, we bail and leave the commit local rather than
// force anything or risk clobbering concurrent work.
if (!doPush) {
  log("not pushing (pass --push or set NOODLE_SYNC_AUTO_PUSH=1 to push automatically). Commit is local on this branch.");
  process.exit(0);
}

try {
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  execFileSync("git", ["fetch", "origin", branch], { cwd: root, stdio: "inherit" });
  execFileSync("git", ["rebase", `origin/${branch}`], { cwd: root, stdio: "inherit" });
  execFileSync("git", ["push", "origin", `HEAD:${branch}`], { cwd: root, stdio: "inherit" });
  log(`pushed to origin/${branch}.`);
} catch (e) {
  try { execFileSync("git", ["rebase", "--abort"], { cwd: root, stdio: "ignore" }); } catch { /* nothing to abort */ }
  log(`WARNING: push failed (${e.message.split("\n")[0]}) — commit remains local; resolve and push by hand.`);
  process.exit(1);
}
