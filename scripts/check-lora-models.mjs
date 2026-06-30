#!/usr/bin/env node
// Audit NanoGPT's live catalog for LoRA-capable image/video models and check each
// against the loraFamily() classifier the app actually ships (extracted from play.html,
// the single source of truth). Flags any LoRA-capable model the app does NOT handle yet
// — i.e. a new family/shape a human must wire up — and snapshots the set to
// lora-models.json so the in-repo list refreshes.
//
// Build/audit-time ONLY. The app never fetches this at runtime (the classifier is inlined
// in index.html + play.html and bundled into exported apps). NOT a pre-commit check — it
// hits the live network and fails on vendor changes unrelated to your diff. Run by hand
//   node scripts/check-lora-models.mjs
// or monthly via .github/workflows/lora-audit.yml (cron) — a failing run is the alert.
//
// Exit 0 = every LoRA-capable catalog model is handled. Exit 1 = new unhandled model(s)
// found (the scheduled job treats this as "open a PR to add a family rule").
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_URL = "https://nano-gpt.com/api/models";

// Pull a function verbatim out of play.html so this audit can never drift from the app.
// Both loraFamily() (shape mapping) and imageTakesLora() (the IMAGE gate — the v1 image
// catalog hides lora params, so the app allow-lists by id and we verify that allow-list here).
const PLAY_SRC = readFileSync(join(root, "play.html"), "utf8");
function loadFn(name, deps = []) {
  // Extract a top-level `function name(...){ ... }` verbatim from play.html by
  // brace-matching from its opening brace — robust to indentation/body changes,
  // and loud (throws) rather than silently truncating if the source drifts.
  // Assumption (holds for these helpers): no `{`/`}` inside their string/regex
  // literals, so a naive depth count finds the true close.
  const grab = (n) => {
    const decl = new RegExp("function\\s+" + n + "\\s*\\(");   // word-exact: no prefix collisions
    const m = decl.exec(PLAY_SRC);
    if (!m) throw new Error(n + "() not found as a `function` declaration in play.html — did it get rewritten?");
    const open = PLAY_SRC.indexOf("{", m.index);
    if (open < 0) throw new Error(n + "(): no opening brace after its declaration");
    let depth = 0;
    for (let i = open; i < PLAY_SRC.length; i++) {
      const c = PLAY_SRC[i];
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return PLAY_SRC.slice(m.index, i + 1);
    }
    throw new Error(n + "(): unbalanced braces — extraction would be truncated, refusing to audit against a half-function");
  };
  const src = [...deps, name].map(grab).join("\n");   // pull dependency fns into scope too
  return new Function(src + "\nreturn " + name + ";")();
}
// the catalog's real stacking cap = the highest lora_url_N slot it advertises; a single
// lora_url / lora_weights / lora_link means one slot. loraCap() must mirror this.
function expectedCap(keys) {
  let max = 0;
  for (const k of keys) { const m = /^lora_url_(\d+)$/.exec(k); if (m) max = Math.max(max, +m[1]); }
  return max || 1;
}

// Deliberately NOT supported (their LoRA mechanism differs from the lora_url/_N shapes the
// app sends). Listed so the monthly audit only alerts on GENUINELY new models. Revisit if
// the app grows these shapes.
const KNOWN_SKIP = {
  "clarity-ai-flux-upscaler": "single lora_link on an upscaler — niche, not a generate/edit/video node",
  "wavespeed-ai/ltx-2.3-spicy/image-to-video-lora": "uses a 'loras' JSON strength-override, not lora_url",
};

// A catalog model is LoRA-capable if any of its param descriptors carries a lora key.
// Match "lora" only at a token boundary (start, or after a non-letter) so a key like
// "exploration_steps" — which contains the substring "lora" — is never miscounted.
const LORA_KEY = /(?:^|[^a-z])lora/i;
function loraKeys(model) {
  const keys = new Set();
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (LORA_KEY.test(k)) keys.add(k);
      walk(v);
    }
  };
  walk(model.additionalParams);
  walk(model.supported_parameters);
  return [...keys];
}

const main = async () => {
  let catalog;
  try {
    const r = await fetch(CATALOG_URL, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    catalog = await r.json();
  } catch (e) {
    // Never fail the build on a NanoGPT outage — the committed app keeps working.
    console.error("check-lora-models: catalog fetch failed (" + e.message + ") — skipping audit");
    process.exit(0);
  }

  const loraFamily = loadFn("loraFamily");
  const imageTakesLora = loadFn("imageTakesLora");
  const loraCap = loadFn("loraCap", ["loraFamily"]);
  const handled = [], unhandled = [], skipped = [];
  // IMAGE gate drift: the app shows the LoRA box on an image model iff imageTakesLora(id) is
  // true (the v1 catalog can't tell it). Compare against real capability so a false positive
  // (box on a non-lora model → silently ignored adapter) or false negative can't ship.
  const gateFalsePos = [], gateFalseNeg = [], capMismatch = [];
  let scanned = 0;
  for (const kind of ["image", "video"]) {
    const models = (catalog && catalog.models && catalog.models[kind]) || {};
    for (const [id, m] of Object.entries(models)) {
      scanned++;
      const keys = loraKeys(m);
      const capable = keys.length > 0 && !KNOWN_SKIP[id];   // truly takes a lora_url/_N we can send
      if (kind === "image") {
        const shows = imageTakesLora(id);
        if (shows && !capable) gateFalsePos.push({ id, loraKeys: keys.sort() });
        if (!shows && capable) gateFalseNeg.push({ id, loraKeys: keys.sort() });
      }
      if (!keys.length) continue;                     // not a LoRA model
      if (KNOWN_SKIP[id]) { skipped.push({ id, kind, why: KNOWN_SKIP[id] }); continue; }
      const fam = loraFamily(id);
      if (!fam) { unhandled.push({ id, kind, family: fam, loraKeys: keys.sort() }); continue; }
      handled.push({ id, kind, family: fam, loraKeys: keys.sort() });
      const want = expectedCap(keys), got = loraCap(id);    // loraCap() must match the catalog's slot count
      if (want !== got) capMismatch.push({ id, want, got });
    }
  }
  // Catalog fetched OK but yielded zero image/video models → the API shape changed
  // under us (models[kind] moved/renamed, or the body isn't the object we expect).
  // Reporting "✓ all handled" here would silently turn the audit into a no-op that
  // always passes — the opposite of its job. Fail loudly so the monthly run alerts.
  if (scanned === 0) {
    console.error("check-lora-models: fetched the catalog but found 0 image/video models — unexpected shape at " + CATALOG_URL + ". Audited nothing; refusing to report success.");
    process.exit(1);
  }

  handled.sort((a, b) => a.id.localeCompare(b.id));
  unhandled.sort((a, b) => a.id.localeCompare(b.id));

  skipped.sort((a, b) => a.id.localeCompare(b.id));
  const snapshot = { generated: new Date().toISOString().slice(0, 10), handled, skipped, unhandled };
  writeFileSync(join(root, "lora-models.json"), JSON.stringify(snapshot, null, 2) + "\n");

  console.log(`LoRA-capable catalog models: ${handled.length} handled, ${skipped.length} known-skipped, ${unhandled.length} new/unhandled.`);
  let fail = false;
  if (unhandled.length) {
    fail = true;
    console.log("\nNEW / UNHANDLED LoRA models — wire a family rule in loraFamily() (both index.html + play.html):");
    for (const u of unhandled) console.log(`  • [${u.kind}] ${u.id}  keys=${u.loraKeys.join(",")}`);
    console.log("\nThen extend loraCap/loraBodyFor for its shape, and (optionally) add a verified LORA_EXAMPLES entry.");
  }
  if (gateFalsePos.length) {
    fail = true;
    console.log("\nIMAGE GATE FALSE POSITIVES — imageTakesLora() shows the LoRA box but these take NO lora_url (adapter silently ignored). Tighten imageTakesLora() in index.html + play.html:");
    for (const g of gateFalsePos) console.log(`  • ${g.id}  catalogLoraKeys=[${g.loraKeys.join(",")}]`);
  }
  if (gateFalseNeg.length) {
    fail = true;
    console.log("\nIMAGE GATE FALSE NEGATIVES — these take a LoRA but imageTakesLora() hides the box. Widen imageTakesLora() in index.html + play.html:");
    for (const g of gateFalseNeg) console.log(`  • ${g.id}  catalogLoraKeys=[${g.loraKeys.join(",")}]`);
  }
  if (capMismatch.length) {
    fail = true;
    console.log("\nLoRA CAP MISMATCH — loraCap() disagrees with the catalog's lora_url_N slots. Fix loraCap() in index.html + play.html:");
    for (const c of capMismatch) console.log(`  • ${c.id}  loraCap=${c.got} but catalog allows ${c.want}`);
  }
  if (fail) process.exit(1);
  console.log("✓ every LoRA-capable model is handled and the image gate matches the catalog. Snapshot → lora-models.json");
};
main();
