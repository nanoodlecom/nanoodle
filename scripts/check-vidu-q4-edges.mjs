#!/usr/bin/env node
// Leftover Vidu Q4 picker-price / media-hide / ref-hint edges after #721.
// That PR shipped the happy-path dollars (720p × 5s ~$0.52, explicit 540p,
// Wan 2.5 card-default beats pricing.default_resolution, Seedance extend
// card duration beats pricing.default_duration) plus camelCase media hide
// and the t2v-gated Image→Video hint. This file pins the other half those
// fixtures never hit: videoSettingDefault empty-string / defaults-bag /
// first-option / seconds fallback, kebab + clobber + URL-descriptor media
// skip, hyphen/case "reference mode" hide vs a plain Generate Audio stay,
// and catalog-miss / missing-t2v / non-ivideo hint quiet. Both engines for
// the setting helper. Offline, zero API spend. New file so it does not
// collide with check-vidu-q4.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDX = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const PLAY = fs.readFileSync(path.join(ROOT, "play.html"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);
const near = (a, b) => a != null && isFinite(a) && Math.abs(a - b) < 1e-9;

function loadResolver(src, end) {
  const s = src.indexOf("const EST = {"), e = src.indexOf(end);
  if (s < 0 || e < 0) throw new Error("pricing block not found");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    src.slice(s, e) +
      "\nthis.videoSettingDefault=videoSettingDefault; this.videoDefaultFields=videoDefaultFields; this.videoUnitUsd=videoUnitUsd;",
    ctx
  );
  return ctx;
}

const VIDU = {
  currency: "USD",
  per_second_by_resolution: { "540p": 0.0495, "720p": 0.1045, "1080p": 0.132 },
};

// ---- 1. videoSettingDefault leftover fallback (both engines) ---------------
{
  const engines = [
    ["editor", IDX, "function nodeUnitUsd("],
    ["play", PLAY, "async function nodeUnitUsdPlay("],
  ];
  for (const [name, src, end] of engines) {
    const R = loadResolver(src, end);

    const emptyDef = {
      params: { resolution: { type: "select", default: "", options: [{ value: "540p" }, { value: "720p" }] } },
      defaults: { resolution: "720p" },
    };
    if (R.videoSettingDefault(emptyDef, "resolution") !== "720p")
      fail(name + ": empty-string param default must fall through to the defaults bag");
    else ok(name + ": empty-string param default falls through to defaults.resolution");

    const bagOnly = {
      params: { resolution: { type: "select", options: [{ value: "540p" }, { value: "720p" }] } },
      defaults: { resolution: "720p" },
    };
    if (R.videoSettingDefault(bagOnly, "resolution") !== "720p")
      fail(name + ": missing param default must use the defaults bag, not first-option 540p");
    else ok(name + ": defaults bag wins when param.default is missing");

    const firstOpt = {
      params: { resolution: { type: "select", options: [{ value: "" }, { value: "720p" }, { value: "1080p" }] } },
      defaults: {},
    };
    if (R.videoSettingDefault(firstOpt, "resolution") !== "720p")
      fail(name + ": empty default+bag must skip blank options and take the first listed value");
    else ok(name + ": first listed non-empty option fills when default and bag are empty");

    const bare = {
      params: { resolution: { type: "select", options: ["720p", "1080p"] } },
      defaults: {},
    };
    if (R.videoSettingDefault(bare, "resolution") !== "720p")
      fail(name + ": a bare-string option list must still yield the first value");
    else ok(name + ": bare-string options still yield the first value");

    const secs = {
      params: { seconds: { type: "integer", default: "8" } },
      defaults: {},
    };
    const filled = R.videoDefaultFields({ resolution: "", duration: "" }, {
      params: {
        resolution: { type: "select", default: "720p", options: [{ value: "540p" }, { value: "720p" }] },
        seconds: { type: "integer", default: "8" },
      },
      defaults: {},
    });
    if (R.videoSettingDefault(secs, "duration") != null)
      fail(name + ": duration key must stay null when only seconds is catalogued");
    else if (filled.resolution !== "720p" || filled.duration !== "8")
      fail(name + ": empty-string fields must fill resolution + seconds-as-duration, got " + JSON.stringify(filled));
    else ok(name + ": empty-string fields fill; seconds stands in for a missing duration param");

    const srcFields = { resolution: "540p", duration: "5" };
    const out = R.videoDefaultFields(srcFields, {
      params: { resolution: { type: "select", default: "720p" }, duration: { type: "integer", default: "8" } },
      defaults: {},
    });
    if (out.resolution !== "540p" || out.duration !== "5")
      fail(name + ": an explicit field must not be overwritten by the card default");
    else if (srcFields.resolution !== "540p" || srcFields === out)
      fail(name + ": videoDefaultFields must copy, not mutate, the input fields object");
    else ok(name + ": explicit fields win and the input object is not mutated");

    const numDef = { params: { duration: { type: "integer", default: 5 } }, defaults: {} };
    if (R.videoSettingDefault(numDef, "duration") !== "5")
      fail(name + ": a numeric catalog default must stringify");
    else ok(name + ": numeric catalog default stringifies");

    const quiet = [
      [null, "null ctx"],
      [{}, "missing params"],
      [{ params: { resolution: "720p" } }, "non-object param"],
    ];
    const quietBad = quiet.filter(([ctx]) => R.videoSettingDefault(ctx, "resolution") != null);
    if (quietBad.length)
      fail(name + ": " + quietBad.map(([, l]) => l).join("/") + " must return null (no invented default)");
    else ok(name + ": null/missing/non-object ctx invents no resolution default");

    const bagUsd = R.videoUnitUsd(VIDU, {}, false, false, "i2v", bagOnly);
    const emptyUsd = R.videoUnitUsd(VIDU, { resolution: "", duration: "" }, false, false, "i2v", emptyDef);
    if (!near(bagUsd, 0.5225) || !near(emptyUsd, 0.5225))
      fail(name + ": defaults-bag / empty-string field must still bill 720p × 5s (~$0.52), got bag=" + bagUsd + " empty=" + emptyUsd);
    else ok(name + ": defaults-bag and empty-string fields still price 720p × 5s, not first-key 540p");
  }
}

// ---- 2 + 3. leftover media skip + reference-mode hide (editor only) --------
function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error(name + "() not found");
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("could not brace-match " + name);
}
const grab = (re, what) => {
  const m = IDX.match(re);
  if (!m) throw new Error(what + " not found");
  return m[0];
};

const ui = {
  NODE_TYPES: {
    tvideo: { modelKind: "video", modelFilter: "t2v", refInputs: true },
    ivideo: { modelKind: "video", modelFilter: "i2v", endFrame: true },
    vedit: { modelKind: "video", modelFilter: "v2v", refInputs: true },
  },
  models: {},
  esc: (s) => String(s == null ? "" : s),
  t: (s) => s,
};
ui.catItem = (_kind, id) => ui.models[id] || null;
vm.createContext(ui);
vm.runInContext([
  grab(/const PRICE_OR_DIM_PARAM = \/[^\n]*;/, "PRICE_OR_DIM_PARAM"),
  grab(/const VIDEO_IMG_ROLE_KEYS = \{[^}]*\};/, "VIDEO_IMG_ROLE_KEYS"),
  grab(/const VIDEO_REF_PRICE_KEYS = \[[^\]]*\];/, "VIDEO_REF_PRICE_KEYS"),
  grab(/const videoRefsModePriced = \(p\)=>[\s\S]*?;/, "videoRefsModePriced"),
  grab(/const videoRefsPriced = \(m\)=> \{[^}]*\};/, "videoRefsPriced"),
  grab(/const VIDEO_REF_MAX = \[[\s\S]*?\];/, "VIDEO_REF_MAX"),
  extractFn(IDX, "videoFreetextSkip"),
  extractFn(IDX, "videoOptDefs"),
  extractFn(IDX, "videoRefSpec"),
  extractFn(IDX, "refreshRefHint"),
  "globalThis.api = { videoFreetextSkip, videoOptDefs, videoRefSpec, refreshRefHint };",
].join("\n"), ui);
const api = ui.api;

{
  const skip = [
    ["image-url", "kebab-case image-url"],
    ["end-image-url", "kebab-case end-image-url"],
    ["startImage", "startImage folds to start_image"],
    ["voiceUrl", "voiceUrl folds to voice_url"],
    ["last_image", "hardcoded last_image"],
    ["end_image", "hardcoded end_image"],
    ["prompt", "hardcoded prompt (would clobber the node's main box)"],
    ["loras", "hardcoded loras"],
    ["element_list", "hardcoded element_list"],
    ["multi_prompt", "hardcoded multi_prompt"],
    ["style_url", "*_url suffix"],
    ["voice_urls", "*_urls suffix"],
    ["video", "whole-key video"],
    ["audio", "whole-key audio"],
    ["reference_audios", "reference_audios"],
  ];
  const skipBad = skip.filter(([key]) => !api.videoFreetextSkip(key, { type: "string" }));
  if (skipBad.length) fail("media skip missed: " + skipBad.map(([, l]) => l).join(", "));
  else ok("kebab / startImage / voiceUrl / last_image / prompt / *_url / whole-key media still hide");

  if (!api.videoFreetextSkip("camera_moves", { type: "text", description: "JSON array of camera moves" }))
    fail("a JSON-array descriptor must hide the free-text box");
  else if (!api.videoFreetextSkip("style", { type: "text", placeholder: "image URLs, comma-separated" }))
    fail("a placeholder that names URLs must hide the free-text box");
  else ok("JSON-array description and URL placeholder still hide");

  const kept = ["cfg_scale", "num_inference_steps", "motion_strength"];
  const keptBad = kept.filter((key) => api.videoFreetextSkip(key, { type: "number", description: "a creative knob" }));
  if (keptBad.length) fail("creative knob hidden: " + keptBad.join(", "));
  else ok("cfg_scale / num_inference_steps / motion_strength stay visible");
}

{
  ui.models["vidu-edges"] = {
    id: "vidu-edges",
    t2v: false,
    i2v: true,
    params: {
      generate_audio: { type: "switch", label: "Generate reference-mode audio", default: false },
      generate_audio_plain: { type: "switch", label: "Generate Audio", default: true },
      generate_audio_caps: { type: "switch", label: "REFERENCE MODE AUDIO", default: false },
      reference_audios: { type: "text", label: "Reference voice URLs" },
      seed: { type: "number", label: "Seed", default: -1 },
    },
    defaults: {},
    pricing: {},
  };
  const keys = api.videoOptDefs("vidu-edges", "ivideo").map((d) => d.key);
  if (keys.includes("generate_audio") || keys.includes("generate_audio_caps"))
    fail("hyphen / ALL-CAPS 'reference mode' label must hide on Image→Video: " + JSON.stringify(keys));
  else if (!keys.includes("generate_audio_plain"))
    fail("a plain 'Generate Audio' switch must stay on Image→Video: " + JSON.stringify(keys));
  else if (keys.includes("reference_audios"))
    fail("reference_audios must stay hidden as a media slot: " + JSON.stringify(keys));
  else if (!keys.includes("seed"))
    fail("Seed must stay: " + JSON.stringify(keys));
  else ok("hyphen/CAPS reference-mode hide; plain Generate Audio stays; reference_audios hidden");
}

// ---- 4. leftover hint quiet (catalog miss / missing t2v / non-ivideo) ------
function hintFor(id, type = "ivideo") {
  const box = { innerHTML: "stale" };
  const n = {
    id: "n1",
    type,
    fields: { model: id },
    el: { querySelector: (sel) => sel === "[data-refhint]" ? box : null },
  };
  api.refreshRefHint(n);
  return box.innerHTML;
}
ui.models["seedance-ref"] = {
  id: "seedance-ref",
  t2v: true,
  params: { reference_images: { type: "text", max: 9 } },
  pricing: {},
};
ui.models["no-t2v-flag"] = {
  id: "no-t2v-flag",
  params: { reference_images: { type: "text", max: 4 } },
  pricing: {},
};

if (hintFor("missing-model") === "")
  ok("catalog-miss model clears the Image→Video ref hint");
else fail("unknown model still shows a ref hint: " + hintFor("missing-model"));

if (hintFor("no-t2v-flag") === "")
  ok("a ref model with no t2v flag does not grow the dead-end hint");
else fail("missing t2v still shows the hint: " + hintFor("no-t2v-flag"));

const tvideoBox = hintFor("seedance-ref", "tvideo");
const veditBox = hintFor("seedance-ref", "vedit");
if (tvideoBox === "stale" && veditBox === "stale")
  ok("refreshRefHint is a no-op on Text→Video / Edit video (does not paint the i2v sentence)");
else fail("non-ivideo hint mutated the box: tvideo=" + tvideoBox + " vedit=" + veditBox);

if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1); }
console.log("✓ check-vidu-q4-edges");
