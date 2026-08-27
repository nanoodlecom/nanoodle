// Shared parser for scripts/sync-nanogpt-model-updates.mjs.
//
// NanoGPT's public changelog is JSON at GET /api/updates (paginated). Each card
// has markdown `text` with links to conversation?model= (chat/LLM) or
// /media?mode=image|video|audio&model= (media). NanoGPT's own `category` field
// is messy (Wan 3.0 Prime is category=models but links to /media?mode=video),
// so we classify by those URLs — never by category.
//
// The HTML dump-dom path is a fallback only: same card shape, no API id. This
// module is the source of truth for classify / compose / seen-walk so the
// checker can pin behaviour against a fixture with zero network.

export const MEDIA_FLOOR_DATE = "2026-08-01";
export const BOOTSTRAP_FLOOR_SLUG = "tencent/hy3";
export const ID_PREFIX = "id:";

export const MONTHS = {
  January: "01", February: "02", March: "03", April: "04", May: "05", June: "06",
  July: "07", August: "08", September: "09", October: "10", November: "11", December: "12",
};

const MODEL_PATH_RE = /(?:https?:\/\/nano-gpt\.com)?\/?(conversation\?model=|media\?mode=(image|video|audio)&(?:amp;)?model=)([^)\s"']+)/i;

export function seenKeyForId(id) {
  return id != null && String(id) !== "" ? `${ID_PREFIX}${id}` : null;
}

export function seenKeyForSlug(date, slug) {
  return `${date}|${slug}`;
}

export function hasSeenApiIds(seen) {
  return (seen || []).some(k => typeof k === "string" && k.startsWith(ID_PREFIX));
}

export function parseDate(raw) {
  if (!raw) return null;
  const iso = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const m = String(raw).match(/(\w+)\s+(\d+),\s+(\d+)/);
  if (!m) return null;
  const mon = MONTHS[m[1]];
  if (!mon) return null;
  return `${m[3]}-${mon}-${String(m[2]).padStart(2, "0")}`;
}

export function stripTags(s) {
  return String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
}

export function markdownToPlain(text) {
  return String(text || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeSlug(raw) {
  const cleaned = String(raw || "").replace(/&amp;/g, "&").replace(/&quot;/g, "").trim();
  try { return decodeURIComponent(cleaned); } catch { return cleaned; }
}

export function titleIntent(title) {
  const t = String(title || "").toLowerCase();
  if (/retir|deprecat|remov|sunset/.test(t)) return "retired";
  if (/\bnow use\b|\bdefault\b|\bupgraded\b|\breturns\b/.test(t)) return "updated";
  if (/\bpric(?:e|es|ing)\b|\bcheaper\b|\bdiscount\b|\b\d+%\s*off\b/.test(t)) return "pricing";
  return "new";
}

export function extractMarkdownModelLinks(text) {
  const models = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const parsed = parseModelUrl(m[2]);
    if (parsed) models.push({ name: m[1].trim() || parsed.slug, slug: parsed.slug, kind: parsed.kind });
  }
  return models;
}

export function extractHtmlModelLinks(html) {
  const models = [];
  const re = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const parsed = parseModelUrl(m[1]);
    if (parsed) {
      const name = stripTags(m[2]) || parsed.slug;
      models.push({ name, slug: parsed.slug, kind: parsed.kind });
    }
  }
  return models;
}

export function parseModelUrl(url) {
  const m = String(url || "").match(MODEL_PATH_RE);
  if (!m) return null;
  const kind = m[1].startsWith("conversation") ? "chat" : m[2];
  const slug = decodeSlug(m[3]);
  if (!slug) return null;
  return { slug, kind };
}

function cardKindFromModels(models) {
  if (!models.length) return null;
  const kinds = models.map(m => m.kind);
  const first = kinds[0];
  if (kinds.every(k => k === first)) return first;
  return first; // mixed (rare): first link wins
}

function fallbackTitleKey(date, intent, title) {
  const slug = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "untitled";
  return `${date}|${intent}|${slug}`;
}

function displayTitles(card, models, intent) {
  if (models.length) return models.map(m => m.name);
  let title = String(card.title || "").trim();
  if (intent === "retired") title = title.replace(/\s+(retired|deprecated|removed|sunset)s?\s*$/i, "").trim() || card.title;
  return [title];
}

export function classifyCard(card) {
  const date = parseDate(card && card.date);
  const title = card && card.title ? String(card.title).trim() : "";
  const rawText = card && card.text != null ? String(card.text) : "";
  const models = Array.isArray(card && card.models) ? card.models : extractMarkdownModelLinks(rawText);
  const intent = titleIntent(title);
  const linkKind = cardKindFromModels(models);
  const description = markdownToPlain(rawText);

  let skip = false;
  let kind = linkKind;
  if (!linkKind) {
    if (intent === "retired") kind = "retired";
    else if (intent === "pricing") kind = "pricing";
    else skip = true;
  }

  const idKey = seenKeyForId(card && card.id);
  const keys = [];
  if (idKey) keys.push(idKey);
  for (const m of models) keys.push(seenKeyForSlug(date || "", m.slug));
  if (!models.length && !skip && date) keys.push(fallbackTitleKey(date, intent, title));

  return {
    id: card && card.id != null ? String(card.id) : null,
    date,
    title,
    description,
    models,
    kind,       // chat | image | video | audio | retired | pricing | null
    intent,     // new | updated | retired | pricing
    skip,
    keys,
    category: card && (card.category || card.kind) || null,
  };
}

export function isExpansionCard(info) {
  return info.kind === "image" || info.kind === "video" || info.kind === "audio"
    || info.intent === "retired" || info.intent === "pricing";
}

export function isChatPath(info) {
  return info.kind === "chat" && info.intent !== "retired" && info.intent !== "pricing";
}

// Newest-first walk. After the first media expansion (seen file has id: keys)
// we stop at the first already-seen API id. Until then, chat uses the existing
// "stop adding historical chat once we hit a seen date|slug" rule, and
// media/retired/pricing cards are only ingested from MEDIA_FLOOR_DATE onward.
export function selectPending(cards, seen, opts = {}) {
  const seenList = Array.isArray(seen) ? seen : [];
  const seenSet = new Set(seenList);
  const expanded = hasSeenApiIds(seenList);
  const isBootstrap = opts.isBootstrap != null ? opts.isBootstrap : seenList.length === 0;
  const pending = [];
  let hitSeenChat = false;

  for (const card of cards) {
    const info = classifyCard(card);
    if (!info.date) continue;

    const idKey = seenKeyForId(info.id);
    if (expanded && idKey && seenSet.has(idKey)) break;

    if (info.skip) continue;

    if (info.keys.some(k => seenSet.has(k))) {
      if (isChatPath(info)) hitSeenChat = true;
      continue;
    }

    if (!expanded) {
      if (isExpansionCard(info) && info.date < MEDIA_FLOOR_DATE) continue;
      if (isChatPath(info)) {
        if (hitSeenChat) continue;
        if (isBootstrap && info.models.some(m => m.slug === BOOTSTRAP_FLOOR_SLUG)) {
          pending.push(info);
          hitSeenChat = true;
          continue;
        }
      }
    }

    pending.push(info);
  }
  return pending;
}

export function trimDetail(description) {
  const parts = (description || "").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  while (parts.length && /^.{0,80}?\b(?:is|are)(?: now)? available(?: again)?[.!]$/.test(parts[0])) parts.shift();
  const kept = [];
  for (const s of parts) {
    if (kept.length && (kept.join(" ").length + s.length + 1 > 200 || /…$/.test(s))) break;
    kept.push(s);
  }
  let detail = kept.join(" ").replace(/^(?:It(?:'s| is)|They(?:'re| are))\s+/, "");
  if (detail.length > 220) detail = detail.slice(0, 217).replace(/\s+\S*$/, "") + "…";
  return detail;
}

function kindNoun(kind) {
  return kind === "chat" ? "LLM" : kind;
}

function fallbackSentence(titles, intent, kind) {
  const title = titles.join(" & ");
  const plural = titles.length > 1;
  if (intent === "retired") return `${title} ${plural ? "are" : "is"} no longer available.`;
  if (intent === "updated") return `${title} ${plural ? "were" : "was"} updated.`;
  if (intent === "pricing") return `${title} pricing was updated.`;
  const noun = kindNoun(kind) || "LLM";
  return `${title} ${plural ? "are" : "is"} now available for the ${noun} node.`;
}

export function changelogLabel(intent, kind, count) {
  if (intent === "retired") return "Retired";
  if (intent === "updated") return "Updated";
  if (intent === "pricing") return "Pricing";
  const noun = kindNoun(kind) || "LLM";
  return count > 1 ? `New ${noun} models` : `New ${noun} model`;
}

export function toChangelogText(titles, description, intent = "new", kind = "chat") {
  const detail = trimDetail(description);
  const title = titles.join(" & ");
  const label = changelogLabel(intent, kind, titles.length);
  const text = detail
    ? `${label}: ${title} — ${detail}`
    : `${label}: ${fallbackSentence(titles, intent, kind)}`;
  return text.replace(/\s+/g, " ").trim();
}

export function groupPending(pending) {
  const groups = [];
  for (const info of pending) {
    const titles = displayTitles(info, info.models, info.intent);
    const g = groups.find(g => g.date === info.date && g.description === info.description);
    if (g) {
      g.titles.push(...titles);
      g.keys.push(...info.keys);
    } else {
      groups.push({
        date: info.date,
        description: info.description,
        titles: [...titles],
        intent: info.intent,
        kind: info.kind,
        keys: [...info.keys],
        titles_source: info.title,
      });
    }
  }
  return groups.map(g => ({
    ...g,
    text: toChangelogText(g.titles, g.description, g.intent, g.kind),
  }));
}

export function enclosingParagraphText(html, nearIndex) {
  const pOpen = html.lastIndexOf("<p", nearIndex);
  const pClose = html.indexOf("</p>", nearIndex);
  if (pOpen === -1 || pClose === -1) return null;
  const gt = html.indexOf(">", pOpen);
  if (gt === -1 || gt > pClose) return null;
  return stripTags(html.slice(gt + 1, pClose));
}

// Card-oriented HTML parse (dump-dom fallback). Anchored on Mantine data-size
// attributes, not per-deploy hashed class names. Extracts media + chat links
// from the card HTML so classification still works after stripTags.
export function cardsFromHtml(html) {
  const cards = [];
  const re = /data-size="lg"/g;
  const positions = [];
  let m;
  while ((m = re.exec(html))) positions.push(m.index);
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : html.length;
    const chunk = html.slice(start, end);
    const title = enclosingParagraphText(html, start);
    const smRel = chunk.indexOf('data-size="sm"');
    const xsRel = chunk.indexOf('data-size="xs"');
    const rawSm = smRel !== -1 ? (() => {
      const abs = start + smRel;
      const pOpen = html.lastIndexOf("<p", abs);
      const pClose = html.indexOf("</p>", abs);
      if (pOpen === -1 || pClose === -1) return "";
      return html.slice(pOpen, pClose + 4);
    })() : "";
    const textPlain = rawSm ? stripTags(rawSm) : "";
    const models = extractHtmlModelLinks(rawSm || chunk);
    const dateRaw = xsRel !== -1 ? enclosingParagraphText(html, start + xsRel) : null;
    const date = parseDate(dateRaw);
    if (!title || !date) continue;
    cards.push({
      id: null,
      title,
      text: textPlain,
      date,
      category: null,
      models,
    });
  }
  return cards;
}

// Incremental API pagination helper: newest-first pages until `shouldStop`
// says we have enough, or the endpoint reports no more.
export async function fetchApiUpdates(fetchImpl, opts = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("fetch is not available");
  const limit = opts.limit || 50;
  const maxPages = opts.maxPages || 40;
  const shouldStop = opts.shouldStop;
  const base = opts.url || "https://nano-gpt.com/api/updates";
  const headers = { Accept: "application/json", "User-Agent": "nanoodle-changelog-sync" };
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const offset = page * limit;
    const url = `${base}?offset=${offset}&limit=${limit}`;
    const ac = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(opts.timeoutMs || 15000) : undefined;
    const res = await fetchFn(url, { headers, signal: ac });
    if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
    const data = await res.json();
    const batch = data && Array.isArray(data.updates) ? data.updates : [];
    if (!batch.length) {
      if (page === 0) throw new Error("API returned no updates");
      break;
    }
    all.push(...batch);
    if (shouldStop && shouldStop(all, batch, data)) break;
    if (data.hasMore === false) break;
  }
  return all;
}

export function shouldStopFetching(cards, seen) {
  const seenSet = new Set(seen || []);
  if (hasSeenApiIds(seen || [])) {
    return cards.some(c => seenSet.has(seenKeyForId(c && c.id)));
  }
  if (!cards.length) return false;
  const last = cards[cards.length - 1];
  const date = parseDate(last && last.date);
  return date != null && date < MEDIA_FLOOR_DATE;
}
