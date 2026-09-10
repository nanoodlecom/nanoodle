#!/usr/bin/env node
// Offline pins for scripts/sync-nanogpt-model-updates.mjs / lib/nanogpt-updates.mjs.
//
// The live sync hits GET https://nano-gpt.com/api/updates (Chrome dump-dom only
// if that fails). CI must not need that network, a browser, or NANOGPT_API_KEY.
// This checker runs the same classify / compose / seen-walk against a captured
// fixture: image/video/audio cards, Claw-style "now use" updates, retirements
// with no model link, retirements whose only links are "try [replacement]",
// community skips, and Wan (category=models, /media video).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cardsFromHtml,
  classifyCard,
  groupPending,
  MEDIA_FLOOR_DATE,
  selectPending,
  toChangelogText,
} from "./lib/nanogpt-updates.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(readFileSync(join(root, "scripts", "fixtures", "nanogpt-updates.json"), "utf8"));
const byId = Object.fromEntries(fixture.updates.map(u => [u.id, u]));

let fail = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    fail++;
    console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

function lineFor(card, seen = []) {
  const pending = selectPending([card], seen);
  if (!pending.length) return null;
  const [g] = groupPending(pending);
  return g ? g.text : null;
}

console.log("sync-nanogpt-model-updates (fixture)");

// (a) a video /media card becomes "New video model"
{
  const line = lineFor(byId["1023"]);
  check(
    "video /media card → New video model",
    typeof line === "string" && line.startsWith("New video model: MiniMax H3 Max"),
    line
  );
}

// (b) Claw/Hermes-style "now use GLM 5.3" becomes "Updated" not "New LLM models"
{
  const line = lineFor(byId["1016"]);
  check("Claw/Hermes now-use → Updated", typeof line === "string" && line.startsWith("Updated:"), line);
  check("Claw/Hermes now-use is not New LLM", typeof line === "string" && !/New LLM/.test(line), line);
}

// (c) a retirement with no model link becomes "Retired"
{
  const info = classifyCard(byId["1013"]);
  const line = lineFor(byId["1013"]);
  check("retirement has no model links", info.models.length === 0, JSON.stringify(info.models));
  check("retirement is not skipped", info.skip === false, `skip=${info.skip}`);
  check("retirement → Retired", typeof line === "string" && line.startsWith("Retired:"), line);
}

// (d) community posts with no model link are skipped
{
  const info = classifyCard(byId["community-110"]);
  const line = lineFor(byId["community-110"]);
  check("community has no model links", info.models.length === 0);
  check("community is skipped", info.skip === true, `kind=${info.kind} intent=${info.intent}`);
  check("community produces no changelog line", line == null, line);
}

// (e) Wan-style category=models + media video link is still video
{
  const info = classifyCard(byId["1007"]);
  const line = lineFor(byId["1007"]);
  check("Wan category=models is ignored", byId["1007"].category === "models" && info.kind === "video", `kind=${info.kind}`);
  check(
    "Wan → New video model",
    typeof line === "string" && line.startsWith("New video model: Wan 3.0 Prime"),
    line
  );
}

// (c2) a retirement whose only model links are "try [replacement]" uses the
// API title, not the substitutes — NanoGPT #1117 named Gemma/Qwen 3.8 in the
// body as alternatives while retiring Ornith 1.5 9B / Qwen 3.6 35B Uncensored.
{
  const info = classifyCard(byId["1117"]);
  const line = lineFor(byId["1117"]);
  const headline = typeof line === "string" ? line.split("—")[0] : "";
  check("try-link retirement has no subject models", info.models.length === 0, JSON.stringify(info.models));
  check("try-link retirement is not skipped", info.skip === false, `skip=${info.skip} kind=${info.kind}`);
  check("try-link retirement kind is retired", info.kind === "retired", `kind=${info.kind}`);
  check(
    "try-link retirement headline uses API title",
    typeof line === "string" && line.startsWith("Retired: Ornith 1.5 9B and Qwen 3.6 35B Uncensored —"),
    line
  );
  check("try-link retirement headline omits replacements", !/Gemma 4 12B|Qwen 3\.8 27B Uncensored/.test(headline), headline);
  check(
    "try-link retirement body keeps retired models",
    typeof line === "string" && /Ornith 1\.5 9B and Qwen 3\.6 35B A3B Uncensored/.test(line),
    line
  );
  check(
    "try-link retirement does not record replacement slugs",
    !info.keys.includes("2026-09-10|gemma-4-12b-it") && !info.keys.includes("2026-09-10|qwen/qwen3.8-27b-uncensored"),
    JSON.stringify(info.keys)
  );
}

// (c3) a retirement that links the dropped model still uses that name, and
// still drops a trailing "try [replacement]" from titles / seen slugs.
{
  const info = classifyCard(byId["retire-linked-subject"]);
  const line = lineFor(byId["retire-linked-subject"]);
  check(
    "linked-subject retirement keeps the retired model",
    info.models.length === 1 && info.models[0].name === "Yi Lightning",
    JSON.stringify(info.models)
  );
  check(
    "linked-subject retirement → Retired: Yi Lightning",
    typeof line === "string" && line.startsWith("Retired: Yi Lightning —"),
    line
  );
  check(
    "linked-subject retirement records the retired slug only",
    info.keys.includes("2026-09-10|yi-lightning") && !info.keys.includes("2026-09-10|gemma-4-12b-it"),
    JSON.stringify(info.keys)
  );
}

// extras that guard the rest of the walk / compose rules
{
  const audio = lineFor(byId["977"]);
  check(
    "audio /media card → New audio model",
    typeof audio === "string" && audio.startsWith("New audio model: MiniMax Music 3"),
    audio
  );

  const image = lineFor(byId["1024"]);
  check(
    "image /media card → New image models",
    typeof image === "string" && image.startsWith("New image models: Recraft V4 Style"),
    image
  );

  const pricing = lineFor(byId["990"]);
  check("no-link pricing title → Pricing", typeof pricing === "string" && pricing.startsWith("Pricing:"), pricing);

  const devs = classifyCard(byId["1006"]);
  check("developers / no model link is skipped", devs.skip === true);
}

// First-expansion floor: media/retired/pricing older than 2026-08-01 stay out
{
  const pending = selectPending(fixture.updates, []);
  const ids = pending.map(p => p.id);
  check("floor keeps July media out", !ids.includes("928"), ids.join(","));
  check("floor keeps August video in", ids.includes("1023"), ids.join(","));
  check("floor date is 2026-08-01", MEDIA_FLOOR_DATE === "2026-08-01");
}

// Chat already-seen slugs are not re-added; media still is (first expansion)
{
  const seen = [
    "2026-08-26|claw-high",
    "2026-08-26|alibaba/qwen3.8-flash",
  ];
  const pending = selectPending(fixture.updates, seen);
  const ids = pending.map(p => p.id);
  check("seen chat slug skips Claw", !ids.includes("1016"), ids.join(","));
  check("seen chat slug skips Qwen3.8 Flash", !ids.includes("1015"), ids.join(","));
  check("first expansion still adds Wan", ids.includes("1007"), ids.join(","));
  check("first expansion still adds Ling retired", ids.includes("1013"), ids.join(","));
}

// After expansion, walk stops at the first seen API id (newer cards above still count)
{
  const seen = ["id:1016"];
  const pending = selectPending(fixture.updates, seen);
  const ids = pending.map(p => p.id);
  check("walk-until-seen-id adds cards above 1016", ids.includes("1023"), ids.join(","));
  check("walk-until-seen-id stops at 1016 (no Wan)", !ids.includes("1007") && !ids.includes("1016"), ids.join(","));
}

// Title edit of a seen API id must not double-post
{
  const renamed = { ...byId["1023"], title: "MiniMax H3 Max (renamed)" };
  const line = lineFor(renamed, ["id:1023"]);
  check("seen API id skips title-edited card", line == null, line);
}

// HTML dump-dom fallback: media href survives stripTags and classifies as video
{
  const html = `
    <div>
      <p data-size="lg">Wan 3.0 Prime</p>
      <p data-size="sm"><a href="https://nano-gpt.com/media?mode=video&model=alibaba%2Fwan-3.0-prime">Wan 3.0 Prime</a> is now available!</p>
      <p data-size="xs">August 24, 2026</p>
    </div>
    <div>
      <p data-size="lg">Ling and Ring 2.6 Retired</p>
      <p data-size="sm">Ling 2.6 Flash, Ling 2.6 1T, and Ring 2.6 1T have been retired because they are no longer available from any provider.</p>
      <p data-size="xs">August 25, 2026</p>
    </div>
    <div>
      <p data-size="lg">Ornith 1.5 9B and Qwen 3.6 35B Uncensored Retired</p>
      <p data-size="sm">Ornith 1.5 9B and Qwen 3.6 35B A3B Uncensored are no longer available. For Ornith 1.5 9B, try <a href="https://nano-gpt.com/conversation?model=gemma-4-12b-it">Gemma 4 12B</a>.</p>
      <p data-size="xs">September 10, 2026</p>
    </div>
    <div>
      <p data-size="lg">CharacterVault official site migration</p>
      <p data-size="sm">CharacterVault now has an official home at <a href="https://charactervault.app/">charactervault.app</a>.</p>
      <p data-size="xs">August 25, 2026</p>
    </div>
  `;
  const cards = cardsFromHtml(html);
  check("HTML fallback found 4 cards", cards.length === 4, `got ${cards.length}`);
  const wan = cards.find(c => c.title === "Wan 3.0 Prime");
  const wanLine = wan ? toChangelogText(
    wan.models.map(m => m.name),
    wan.text,
    classifyCard(wan).intent,
    classifyCard(wan).kind
  ) : null;
  check("HTML Wan link is video", wan && classifyCard(wan).kind === "video", wan && classifyCard(wan).kind);
  check("HTML Wan → New video model", typeof wanLine === "string" && wanLine.startsWith("New video model:"), wanLine);
  const retired = cards.find(c => c.title === "Ling and Ring 2.6 Retired");
  check("HTML retirement with no model link → Retired", retired && !classifyCard(retired).skip && classifyCard(retired).intent === "retired");
  const tryRetire = cards.find(c => /Ornith/.test(c.title || ""));
  const tryInfo = tryRetire && classifyCard(tryRetire);
  const tryLine = tryRetire ? lineFor(tryRetire) : null;
  check("HTML try-link retirement drops replacement models", tryInfo && tryInfo.models.length === 0, tryInfo && JSON.stringify(tryInfo.models));
  check(
    "HTML try-link retirement uses API title",
    typeof tryLine === "string" && tryLine.startsWith("Retired: Ornith 1.5 9B and Qwen 3.6 35B Uncensored —"),
    tryLine
  );
  const community = cards.find(c => /CharacterVault/.test(c.title || ""));
  check("HTML community with no model link is skipped", community && classifyCard(community).skip === true);
}

// grouping: same date + same description → one line (Recraft's two image links)
{
  const pending = selectPending([byId["1024"]], []);
  const groups = groupPending(pending);
  check("Recraft stays one grouped line", groups.length === 1, `groups=${groups.length}`);
  check(
    "Recraft joins both model names",
    groups[0] && /Recraft V4 Style & Recraft V4 Style Pro/.test(groups[0].text),
    groups[0] && groups[0].text
  );
}

if (fail) {
  console.error(`\n✗ sync-nanogpt-model-updates: ${fail} assertion(s) failed.`);
  process.exit(1);
}
console.log("✓ sync-nanogpt-model-updates");
