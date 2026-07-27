#!/usr/bin/env node
/*
  Discover each model's prompt CHARACTER cap and regenerate the PROMPT_CAPS tables in
  index.html + play.html.

  HAND-RUN ONLY, and it CAN SPEND — never a pre-commit hook, never CI. Read this before running.

  Why it exists
  -------------
  NanoGPT's image and video catalogs advertise resolutions, input-image constraints, LoRA slots,
  max_input_images … and nothing at all about prompt length (checked live 2026-07-26 — the upstream
  ask is docs/NANOGPT-prompt-length-metadata.md). Yet 45 of 183 probed image models reject an
  over-long prompt at the route:

      400 {"error":"Your prompt is too long for Qwen Image 3. Please shorten it to 800 characters
           or less (current: 831 characters).","code":"prompt_too_long"}

  The AUDIO catalog does expose supported_parameters.max_chars, so audio caps are read live at run
  time and are deliberately NOT in the generated table.

  How it probes without paying (mostly)
  -------------------------------------
  Route validation runs in this order (live-verified):

      input images → route resolution limits (>8192px/edge) → PROMPT LENGTH → model-specific size

  So a request carrying a deliberately over-long prompt AND a size the model doesn't support gets
  rejected on prompt length first when the model caps, and on size when it doesn't — both free.
  That's the whole trick, and it holds for every model that validates its own size list.

  It does NOT hold for models that ignore size entirely (nano-banana, flux-kontext and friends
  accept "7x7", "abc", even ""). Those GENERATE the over-long prompt and CHARGE for the image —
  about 40% of the catalog in the 2026-07-26 run, $1.60 total. Hence:

    · --budget <usd>   hard stop once charged responses reach this (default 1.00)
    · --max-price <p>  skip models above this per-image price entirely (default 0.30)
    · --models a,b,c   probe just these ids (how you re-check one model for free)
    · --edit           send a synthetic source image too, so edit-only models get past their
                       "no image" rejection and reach prompt validation (charges the same way)
    · --dry-run        print the queue and the worst-case spend, send nothing

  Cheapest models go first, so the budget stop bites on the expensive tail, not the useful head.

  Usage
  -----
    NANOGPT_API_KEY=… node scripts/probe-prompt-caps.mjs --dry-run
    NANOGPT_API_KEY=… node scripts/probe-prompt-caps.mjs --budget 1.00 --write

  --write rewrites the PROMPT-CAPS block in BOTH index.html and play.html (they must stay
  byte-identical — scripts/check-prompt-caps.mjs pins that). Without it, results print only.

  A model absent from the table means "no cap found, or never probed" — never "no cap, promise".
  Unknown stays unconstrained at run time until a live 400 teaches the cap, which the runtime then
  remembers (learnPromptCap). This table only makes that lesson unnecessary.
*/
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.NANOGPT_API_KEY;
const NANOGPT = "https://nano-gpt.com";
const IMG_EP = NANOGPT + "/v1/images/generations";
const VID_EP = NANOGPT + "/api/generate-video";

const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf(name); return i < 0 ? def : argv[i + 1]; };
const has = (name) => argv.includes(name);
const BUDGET = parseFloat(flag("--budget", "1.00"));
const MAX_PRICE = parseFloat(flag("--max-price", "0.30"));
const ONLY = (flag("--models", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const DRY = has("--dry-run");
const EDIT = has("--edit");
const WRITE = has("--write");
const KIND = flag("--kind", "image");           // image | video
const PROBE_LEN = 6000;                          // comfortably past every cap seen so far

if (!KEY) { console.error("NANOGPT_API_KEY is required"); process.exit(1); }

// A long, boring, unmistakably-safe prompt. Content doesn't matter — length does.
const LONG = "a cinematic neon city at night with rain, ".repeat(300).slice(0, PROBE_LEN);
// 1x1 transparent PNG is REJECTED by route preflight (min 8px), so --edit needs real pixels:
// a 640x640 solid-colour PNG, built here so the script has no fixture and no image dependency.
function solidPng() {
  const zlib = require("node:zlib");
  const W = 640, H = 640, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { const o = y * (W * 3 + 1); raw[o] = 0; for (let x = 0; x < W; x++) { raw[o + 1 + x * 3] = 51; raw[o + 2 + x * 3] = 85; raw[o + 3 + x * 3] = 170; } }
  const crcTable = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return "data:image/png;base64," + png.toString("base64");
}
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);

const perImage = (m) => { const p = (m.pricing && m.pricing.per_image) || {}; const v = p["1024x1024"] ?? p.square ?? Object.values(p)[0]; return v != null ? +v : 0.05; };

async function catalog(kind) {
  const url = kind === "video" ? "/api/v1/video-models" : "/api/v1/image-models";
  const r = await fetch(NANOGPT + url, { headers: { Authorization: "Bearer " + KEY } });
  return (await r.json()).data || [];
}

// The rejection arrives in three shapes (all live-verified) — match the sentence, not the envelope.
// "current: N" is the length we SENT and must never be read as the cap.
const CAP_RE = /(?:shorten (?:it )?to|keep it under|at most|maximum of|limit of)\s*([\d,]{2,})\s*characters/i;
function readCap(text) {
  let j = {}; try { j = JSON.parse(text); } catch { /* not JSON — match the raw body */ }
  const e = j.error;
  const msg = String(typeof e === "string" ? e : (e && (e.message || e.error)) || j.message || text);
  const m = CAP_RE.exec(msg);
  return { cap: m ? +m[1].replace(/,/g, "") : null, msg: msg.slice(0, 200), code: j.code || (e && e.code) || j.type || "" };
}

async function probe(m) {
  const body = KIND === "video"
    ? { model: m.id, prompt: LONG, duration: 999 }              // an absurd duration is the video-side free rejection
    : { model: m.id, prompt: LONG, size: "7x7", n: 1, response_format: "b64_json" };
  if (EDIT && KIND !== "video") body.imageDataUrl = solidPng();
  const r = await fetch(KIND === "video" ? VID_EP : IMG_EP, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY }, body: JSON.stringify(body),
  });
  const text = await r.text();
  if (r.ok) return { id: m.id, cap: null, charged: perImage(m), note: "generated — no route cap at " + PROBE_LEN + " chars" };
  const { cap, msg, code } = readCap(text);
  return { id: m.id, cap, charged: 0, code, note: msg };
}

const models = (await catalog(KIND))
  .filter((m) => (ONLY.length ? ONLY.includes(m.id) : perImage(m) <= MAX_PRICE))
  .sort((a, b) => perImage(a) - perImage(b));

if (DRY) {
  console.log(models.length + " models queued (" + KIND + "), cheapest first");
  console.log("worst case if NONE cap: $" + models.reduce((s, m) => s + perImage(m), 0).toFixed(2) +
              " — the budget stop ($" + BUDGET.toFixed(2) + ") cuts it well before that");
  process.exit(0);
}

const out = [];
let spent = 0, stopped = false;
const queue = [...models];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length && !stopped) {
    const m = queue.shift();
    let r; try { r = await probe(m); } catch (e) { r = { id: m.id, cap: null, charged: 0, note: "probe failed: " + e.message }; }
    out.push(r);
    if (r.charged) { spent += r.charged; if (spent >= BUDGET) { stopped = true; console.error("budget stop at $" + spent.toFixed(2)); } }
    console.log((r.cap ? String(r.cap).padStart(6) : (r.charged ? "  paid" : "     —")) + "  " + r.id + (r.cap ? "" : "  | " + r.note.slice(0, 80)));
  }
}));

const caps = {};
for (const r of out.sort((a, b) => (a.cap || 0) - (b.cap || 0) || a.id.localeCompare(b.id))) if (r.cap) caps[r.id] = r.cap;
console.log("\nprobed " + out.length + " · capped " + Object.keys(caps).length + " · spent $" + spent.toFixed(2) +
            (stopped ? " (stopped early — the rest are unprobed, not uncapped)" : ""));

if (!WRITE) { console.log("\n(--write to fold these into index.html + play.html)"); process.exit(0); }

const BEGIN = "/* === PROMPT-CAPS-BEGIN === */", END = "/* === PROMPT-CAPS-END === */";
const existing = (() => {
  const src = readFileSync(join(ROOT, "index.html"), "utf8");
  const a = src.indexOf(BEGIN), b = src.indexOf(END);
  const body = src.slice(a + BEGIN.length, b);
  return JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
})();
// Merge, don't replace: a partial run (--models, --budget stop, one kind at a time) must never
// silently drop caps an earlier run proved. Removing one is a deliberate hand-edit.
const merged = { ...existing, [KIND]: { ...(existing[KIND] || {}), ...caps } };
merged.generated = new Date().toISOString().slice(0, 10);
const fmt = (o) => Object.entries(o).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
  .map(([k, v]) => "    " + JSON.stringify(k) + ": " + v).join(",\n");
const rendered = BEGIN + "\n" +
  "// Generated by scripts/probe-prompt-caps.mjs — do not hand-edit.\n" +
  "// Route-enforced prompt character caps, live-probed. Absent id = no cap found\n" +
  "// (or never probed): unknown stays unconstrained until a live 400 teaches us.\n" +
  "const PROMPT_CAPS = {\n" +
  '  "generated": ' + JSON.stringify(merged.generated) + ",\n" +
  '  "image": {\n' + fmt(merged.image || {}) + "\n  },\n" +
  '  "video": {\n' + fmt(merged.video || {}) + "\n  }\n};\n" + END;

for (const file of ["index.html", "play.html"]) {
  const p = join(ROOT, file), src = readFileSync(p, "utf8");
  const a = src.indexOf(BEGIN), b = src.indexOf(END);
  if (a < 0 || b < 0) { console.error("✗ " + file + ": PROMPT-CAPS markers missing"); process.exit(1); }
  writeFileSync(p, src.slice(0, a) + rendered + src.slice(b + END.length));
  console.log("✓ rewrote PROMPT_CAPS in " + file);
}
console.log("now run: node scripts/check-prompt-caps.mjs");
