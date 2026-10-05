#!/usr/bin/env node
// Leftover Product · 26 add-search edges after #643 / #674.
// Those pins cover the "image" popular lift, already-first no-tag, empty /
// one-letter / nonsense quiet, tied popularity, and no fuzzy/desc matcher.
// This file pins the leftover match contract: a prefix-tier winner is
// isolated from a more popular substring, title (not desc) can lift, trim
// and case fold the query, and "comment" is dropped from the search ids.
// Offline, zero API spend. New file so it does not collide with the
// shipped check.
import {
  matchRank,
  normalizeQuery,
  pickSearchLift,
  REASON,
} from "../vendor/next-action/add-search-popular.mjs";

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

const meta = {
  image: { title: "Image" },
  preimage: { title: "Preimage" },
  imagine: { title: "Imagine" },
  comment: { title: "Note" },
  text: { title: "Text" },
  aaa: { title: "Image input" },
  bbb: { title: "Image" },
  llm: { title: "LLM", desc: "image helper" },
};
const pop = {
  unigram: {
    "add:preimage": 100,
    "add:image": 8,
    "add:imagine": 90,
    "add:comment": 200,
    "add:text": 5,
    "add:aaa": 5,
    "add:bbb": 80,
  },
};

{
  const q = normalizeQuery("  IMAGE\t");
  if (q !== "image")
    fail(`normalizeQuery must trim+lower, got ${JSON.stringify(q)}`);
  else if (matchRank("image", meta.image, "  ImAgE\t") !== 0)
    fail("trimmed mixed-case Image must still be a prefix match");
  else ok("normalizeQuery trims and lowercases the query");
}

{
  if (matchRank("image", meta.image, "im") !== 0)
    fail("id prefix must be rank 0");
  else if (matchRank("preimage", meta.preimage, "image") !== 1)
    fail("id/title substring must be rank 1, not a prefix");
  else if (matchRank("llm", meta.llm, "image") !== -1)
    fail("a desc-only hit must stay rank -1");
  else ok("prefix is rank 0, substring is rank 1, desc is ignored");
}

{
  const lift = pickSearchLift("image", pop, meta, ["preimage", "image"]);
  if (lift != null)
    fail(`a popular substring must not beat the prefix tier, got ${JSON.stringify(lift)}`);
  else ok("prefix-tier isolation keeps a popular substring unlifted");
}

{
  const lift = pickSearchLift("im", pop, meta, ["image", "imagine"]);
  if (!lift || lift.type !== "imagine" || lift.reason !== REASON)
    fail(`same-tier popularity must still lift imagine, got ${JSON.stringify(lift)}`);
  else ok("same prefix tier still lifts the popular type");
}

{
  const trimmed = pickSearchLift("  IM  ", pop, meta, ["image", "imagine"]);
  const mixed = pickSearchLift("Im", pop, meta, ["image", "imagine"]);
  if (!trimmed || trimmed.type !== "imagine")
    fail(`trimmed query must lift like "im", got ${JSON.stringify(trimmed)}`);
  else if (!mixed || mixed.type !== "imagine")
    fail(`mixed-case query must lift like "im", got ${JSON.stringify(mixed)}`);
  else ok("trim+case still lift the same popular prefix match");
}

{
  const title = matchRank("bbb", meta.bbb, "im");
  const idOnly = matchRank("image", null, "image");
  const emptyTitle = matchRank("xyz", { title: "" }, "image");
  if (title !== 0 || idOnly !== 0 || emptyTitle !== -1)
    fail(`title/id-only ranks drifted (title=${title} id=${idOnly} empty=${emptyTitle})`);
  const lift = pickSearchLift("im", pop, { aaa: meta.aaa, bbb: meta.bbb }, ["aaa", "bbb"]);
  if (!lift || lift.type !== "bbb")
    fail(`a title-only prefix must be able to lift, got ${JSON.stringify(lift)}`);
  else ok("title-only matches rank and can lift; empty title does not");
}

{
  const only = pickSearchLift("no", pop, meta, ["comment"]);
  const buried = pickSearchLift("im", pop, meta, ["comment", "image", "imagine"]);
  const quiet = pickSearchLift("no", pop, meta, ["comment", "text"]);
  if (only != null)
    fail(`a comment-only search list must stay quiet, got ${JSON.stringify(only)}`);
  else if (!buried || buried.type !== "imagine")
    fail(`dropping comment must not hide a later popular match, got ${JSON.stringify(buried)}`);
  else if (quiet != null)
    fail(`a comment title match must not lift, got ${JSON.stringify(quiet)}`);
  else ok("comment is skipped and cannot become the popular match");
}

if (failed) {
  console.error(`\n${failed} leftover add-search pin(s) failed`);
  process.exit(1);
}
console.log("✓ add-search leftover pins");
