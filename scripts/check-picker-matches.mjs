#!/usr/bin/env node
// Pins index.html pickerMatches(): empty NSFW-off lists stay SFW (plus the
// already-selected id); a non-empty query can reveal a hidden NSFW model only
// when the query matches that model's id after normalize (decodeURIComponent,
// %2F→/, lowercase). Name hits never unhide NSFW. i2v vs t2v still uses
// passesFilter. Offline, no DOM, no network.
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

function block(src, anchor) {
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error("anchor not found: " + anchor);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced braces for: " + anchor);
}

const SPICY = "wavespeed-ai/minimax-h3/image-to-video-spicy";
const SPICY_ENC = "wavespeed-ai%2Fminimax-h3%2Fimage-to-video-spicy";
const VIDEO = [
  { id: "sfw-i2v", name: "Safe I2V", i2v: true, t2v: false, nsfw: false },
  { id: "sfw-t2v", name: "Safe T2V", i2v: false, t2v: true, nsfw: false },
  { id: SPICY, name: "MiniMax H3 Spicy", i2v: true, t2v: false, nsfw: true },
  { id: "other-nsfw-i2v", name: "Unrelated Hot Name", i2v: true, t2v: false, nsfw: true },
  { id: "wavespeed-ai/minimax-h3/text-to-video-spicy", name: "H3 t2v spicy", i2v: false, t2v: true, nsfw: true },
];

const ids = (list) => list.map((m) => m.id).sort().join(",");

function sandbox() {
  const ctx = {
    catalogs: { video: VIDEO },
    picker: { kind: "video", filter: "i2v", current: "sfw-i2v" },
    nsfwOnly: false,
    pickerSort: "name",
    searchValue: "",
  };
  ctx.$ = (id) => {
    if (id !== "mpicksearch") throw new Error("unexpected $(" + id + ")");
    return { value: ctx.searchValue };
  };
  vm.createContext(ctx);
  vm.runInContext(
    block(IDX, "function passesFilter(m, filter){") + "\n" +
    block(IDX, "function sortMatches(list){") + "\n" +
    block(IDX, "function normalizePickerQuery(s){") + "\n" +
    block(IDX, "function pickerIdHitsQuery(id, qNorm){") + "\n" +
    block(IDX, "function pickerMatches(){") + "\n" +
    block(IDX, "function rankPickerMatches(list){"),
    ctx,
  );
  return ctx;
}

{
  const ctx = sandbox();
  ctx.searchValue = "";
  const got = ids(ctx.pickerMatches());
  if (got !== "sfw-i2v") fail("empty + NSFW off should be SFW i2v only, got " + got);
  else ok("empty search + NSFW off is SFW-only (i2v filter)");
}

{
  const ctx = sandbox();
  ctx.picker.current = SPICY;
  ctx.searchValue = "";
  const got = ids(ctx.pickerMatches());
  if (!got.split(",").includes(SPICY) || !got.split(",").includes("sfw-i2v")) {
    fail("current spicy id should remain visible with empty search, got " + got);
  } else if (got.split(",").includes("other-nsfw-i2v")) {
    fail("empty search listed a non-current NSFW model: " + got);
  } else ok("picker.current exception keeps the selected spicy id in an empty SFW list");
}

{
  const ctx = sandbox();
  ctx.searchValue = SPICY;
  const got = ctx.pickerMatches().map((m) => m.id);
  if (!got.includes(SPICY)) fail("pasting the exact spicy id did not surface it, got " + got);
  else if (got.includes("other-nsfw-i2v")) fail("exact spicy id search also dumped unrelated NSFW: " + got);
  else ok("exact spicy id search surfaces H3 with NSFW off");
}

{
  const ctx = sandbox();
  ctx.searchValue = SPICY_ENC;
  const got = ctx.pickerMatches().map((m) => m.id);
  if (!got.includes(SPICY)) fail("URL-encoded spicy id paste did not surface it, got " + got);
  else ok("URL-encoded %2F spicy id paste matches the catalog slash-id");
}

{
  const ctx = sandbox();
  ctx.searchValue = "image-to-video-spicy";
  const got = ctx.pickerMatches().map((m) => m.id);
  if (!got.includes(SPICY)) fail("id substring image-to-video-spicy missed H3, got " + got);
  else ok("id substring image-to-video-spicy finds spicy H3");
}

{
  const ctx = sandbox();
  ctx.searchValue = "minimax";
  const got = ctx.pickerMatches().map((m) => m.id);
  if (!got.includes(SPICY)) fail("minimax id substring missed spicy H3, got " + got);
  else if (got.includes("other-nsfw-i2v")) fail("minimax dumped NSFW models whose id does not contain it: " + got);
  else ok("minimax reveals spicy H3 by id, not the whole NSFW catalog");
}

{
  const ctx = sandbox();
  ctx.searchValue = "hot";
  const got = ctx.pickerMatches().map((m) => m.id);
  if (got.includes("other-nsfw-i2v")) fail("NSFW name hit unhid a hidden model: " + got);
  else ok("NSFW-hidden models are not revealed by name search");
}

{
  const ctx = sandbox();
  ctx.searchValue = "x";
  const got = ctx.pickerMatches().map((m) => m.id);
  if (got.includes(SPICY) || got.includes("other-nsfw-i2v")) fail("1-char search flooded NSFW: " + got);
  else ok("1-char search does not unhide NSFW models");
}

{
  const ctx = sandbox();
  ctx.picker.filter = "t2v";
  ctx.searchValue = SPICY;
  const got = ctx.pickerMatches().map((m) => m.id);
  if (got.includes(SPICY)) fail("i2v-only spicy H3 appeared on Text→Video, got " + got);
  else ok("i2v-only spicy H3 stays out of the t2v picker");
}

{
  const ctx = sandbox();
  ctx.searchValue = "Safe";
  const got = ctx.pickerMatches().map((m) => m.id);
  if (!got.includes("sfw-i2v")) fail("SFW name search broke, got " + got);
  else ok("SFW name search still works");
}

{
  const ctx = sandbox();
  ctx.searchValue = SPICY_ENC;
  const ranked = ctx.rankPickerMatches(ctx.pickerMatches());
  if (!ranked.length || ranked[0].id !== SPICY) fail("exact-id paste was not ranked first, got " + ranked.map((m) => m.id));
  else ok("exact spicy id (encoded or not) ranks first for Enter");
}

if (failed) {
  process.stderr.write(`\n✗ pickerMatches NSFW id-search: ${failed} failure(s)\n`);
  process.exit(1);
}
process.stdout.write("✓ pickerMatches: SFW default, exact/encoded NSFW id search, i2v filter, no name-unhide\n");
