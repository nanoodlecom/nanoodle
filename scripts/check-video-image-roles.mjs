#!/usr/bin/env node
// Video extra-image roles (PR #378, extended for the MiniMax H3 Max / Wan 3.0 Prime launch):
// last_image / end-frame morph and reference-image arrays.
//
// Two hand-kept exceptions to "catalog param presence or no port", copied across the editor
// (index.html) and play RUNTIME. A one-sided edit silently drops a billed morph / extra ref
// or posts an ignored array that still charges:
//   last — VIDEO_LAST_FRAME_FAMILIES. Day-one catalog gaps: the id ships advertising only
//     duration/aspect/resolution/etc, but the underlying provider takes a last-frame image.
//     minimax-h3 was live-verified (2026-07-31). minimax/h3-max, alibaba/wan-3.0-prime and
//     alibaba/wan-3.0/image-to-video launched 2026-08-2{4,7} with the identical gap — confirmed
//     against fal.ai's own minimax-h3-max page ("image to video, which also handles
//     first-to-last keyframes through an optional end_image_url") and fal.ai/WaveSpeedAI's
//     wan-3.0-prime/image-to-video docs (`last_image`/`end_image_url`), not a live NanoGPT call.
//   refs — VIDEO_REF_PRICE_KEYS (included_reference_images / extra_reference_image). Pricing
//     that meters refs is the catalog advertising them. Family maxima (seedance/minimax-h3 = 9,
//     luma|ray = 4) cap the send; included_reference_images is a floor, not the cap.
//
// Editor is permissive-OFF when the catalog can't be read (an ignored-but-sent extra image
// is charged). Play honors authored wires when the catalog is missing (the editor already
// gated the port). This pins both contracts plus the play run() payload.
//
// Offline: extract the editor predicates; drive play NODE_TYPES.tvideo/ivideo.run with a
// spy genVideo. No browser, no API spend.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadEngine, catalog } from "./play-engine.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");
const VENDOR = join(ROOT, "vendor", "njs-engine.js");

let fail = 0;
const ok = (c, m) => {
  if (!c) { fail++; console.log("  ✗ " + m); }
  else console.log("  ✓ " + m);
};

function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error(name + "() not found");
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("could not brace-match " + name + "()");
}

function extractAllFns(src, name) {
  const out = [];
  const needle = "function " + name + "(";
  let from = 0;
  while (from < src.length) {
    const start = src.indexOf(needle, from);
    if (start === -1) break;
    let depth = 0;
    for (let j = src.indexOf("{", start); j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}" && --depth === 0) {
        out.push(src.slice(start, j + 1));
        from = j + 1;
        break;
      }
    }
  }
  return out;
}

function loadAssigns(src, name) {
  const re = new RegExp("(?:const|var|let)\\s+" + name + "\\s*=\\s*([^;]+);", "g");
  return [...src.matchAll(re)].map((m) => new Function("return (" + m[1] + ");")());
}

// ---- A. family-table twins ------------------------------------------------
{
  const lastIdx = loadAssigns(IDX, "VIDEO_LAST_FRAME_FAMILIES");
  const lastPlay = loadAssigns(PLAY, "VIDEO_LAST_FRAME_FAMILIES");
  ok(lastIdx.length === 1, `index.html VIDEO_LAST_FRAME_FAMILIES ×${lastIdx.length}`);
  ok(lastPlay.length >= 1, `play.html VIDEO_LAST_FRAME_FAMILIES ×${lastPlay.length}`);
  const lasts = [...lastIdx, ...lastPlay];
  const LAST_YES = [
    "minimax-h3", "Minimax-H3", "MINIMAX-H3",
    "minimax/h3-max", "MiniMax/H3-Max",
    "alibaba/wan-3.0-prime",
    "alibaba/wan-3.0/image-to-video",
    "google/gemini-omni-flash/v1.1",
    "Google/Gemini-Omni-Flash/v1.1",
  ];
  const LAST_NO = [
    "minimax-hailuo", "hailuo-02", "seedance-2.0", "luma-ray", "kling-v2", "",
    "minimax-h3-max",              // NanoGPT's real id uses a slash, not a second hyphen — don't over-match
    "minimax/h3",                  // must not leak into the sibling id's own slash form
    "alibaba/wan-3.0/text-to-video",       // no image input at all — last-frame is meaningless here
    "alibaba/wan-3.0/reference-to-video",  // takes image/video/audio REFERENCES, not a first/last-frame pair
    "alibaba/wan-3.0",
    "google/gemini-omni-flash",            // v1: no supportsLastImage, no first-last-frame tag — not a last-frame model
    "google/gemini-omni",                  // family prefix without -flash
    "gemini-omni-flash",                   // missing google/ owner
    "google/gemini-omni-flash/v2",         // unlisted future version — don't over-match
    "google/gemini-omni-flash-lite",
  ];
  for (const id of LAST_YES) {
    const drifted = lasts.map((re, i) => re.test(id) ? null : i).filter((i) => i != null);
    ok(!drifted.length, `VIDEO_LAST_FRAME_FAMILIES matches ${JSON.stringify(id)}`);
  }
  for (const id of LAST_NO) {
    const leaked = lasts.map((re, i) => re.test(id) ? i : null).filter((i) => i != null);
    ok(!leaked.length, `VIDEO_LAST_FRAME_FAMILIES rejects ${JSON.stringify(id)}`);
  }

  const keysIdx = loadAssigns(IDX, "VIDEO_REF_PRICE_KEYS");
  const keysPlay = loadAssigns(PLAY, "VIDEO_REF_PRICE_KEYS");
  ok(keysIdx.length === 1 && keysPlay.length >= 1, "VIDEO_REF_PRICE_KEYS present on both surfaces");
  const wantKeys = ["included_reference_images", "extra_reference_image"];
  for (const got of [...keysIdx, ...keysPlay]) {
    ok(JSON.stringify([...got].sort()) === JSON.stringify([...wantKeys].sort()),
      `VIDEO_REF_PRICE_KEYS === ${JSON.stringify(wantKeys)} (got ${JSON.stringify(got)})`);
  }
}

// ---- B. editor predicates (permissive-OFF offline) ------------------------
{
  const grab = (re, what) => {
    const m = IDX.match(re);
    if (!m) throw new Error(what + " not found in index.html");
    return m[0];
  };
  const bundle = [
    grab(/const VIDEO_IMG_ROLE_KEYS = \{[^}]*\};/, "VIDEO_IMG_ROLE_KEYS"),
    grab(/const VIDEO_REF_PRICE_KEYS = \[[^\]]*\];/, "VIDEO_REF_PRICE_KEYS"),
    grab(/const videoRefsModePriced = \(p\)=>[\s\S]*?;/, "videoRefsModePriced"),
    grab(/const videoRefsPriced = \(m\)=> \{[^}]*\};/, "videoRefsPriced"),
    grab(/const VIDEO_LAST_FRAME_FAMILIES = \/[^\n]+\/i;/, "VIDEO_LAST_FRAME_FAMILIES"),
    grab(/const VIDEO_REF_MAX = \[[\s\S]*?\];/, "VIDEO_REF_MAX"),
    extractFn(IDX, "modelHasImageRole"),
    extractFn(IDX, "videoRefSpec"),
    "globalThis.__t = { modelHasImageRole, videoRefSpec, videoRefsPriced };",
  ].join("\n");

  const MODELS = {};
  const ctx = {
    NODE_TYPES: {
      tvideo: { modelKind: "video" },
      ivideo: { modelKind: "video" },
      vedit: { modelKind: "video" },
    },
    catItem: (_kind, id) => MODELS[id] || null,
  };
  vm.createContext(ctx);
  new vm.Script(bundle, { filename: "index.html#video-image-roles" }).runInContext(ctx);
  const T = ctx.__t;
  const node = (model, type) => ({ id: "v1", type: type || "tvideo", fields: { model } });

  // minimax-h3 as the catalog actually ships: duration + aspect only, refs metered in pricing.
  MODELS["minimax-h3"] = {
    params: { duration: {}, aspect_ratio: {} },
    pricing: { included_reference_images: 5, extra_reference_image: 0.04 },
  };
  ok(T.modelHasImageRole(node("minimax-h3", "ivideo"), "last") === true,
    "editor: minimax-h3 last_image via family fallback (catalog hides the param)");
  ok(T.modelHasImageRole(node("minimax-h3"), "refs") === true,
    "editor: minimax-h3 refs via pricing (no reference_images param)");
  const h3 = T.videoRefSpec(node("minimax-h3"));
  ok(h3 && h3.key === "reference_images" && h3.cap === 9,
    `editor: minimax-h3 ref spec is reference_images/9 (included=5 is a floor), got ${JSON.stringify(h3)}`);

  // family still opens last_image when pricing is also missing (refs stay OFF)
  MODELS["minimax-h3"] = { params: { duration: {}, aspect_ratio: {} }, pricing: {} };
  ok(T.modelHasImageRole(node("minimax-h3", "ivideo"), "last") === true,
    "editor: minimax-h3 last_image does not need ref pricing");
  ok(T.videoRefSpec(node("minimax-h3")) === null,
    "editor: minimax-h3 without ref pricing and without a ref param → no ref ports (permissive-OFF)");

  // minimax/h3-max as the live catalog actually ships it (fetched 2026-08-27): duration, resolution,
  // aspect_ratio, prompt_expansion_mode, enable_safety_checker, seed — no last_image/end_image, no ref
  // param, no ref pricing. capabilities.video_to_video is false (no reference-to-video yet, matching
  // fal.ai: "Reference to video follows later this week" as of 2026-08-25), so refs correctly stay OFF —
  // only "last" needs the family fallback.
  MODELS["minimax/h3-max"] = {
    params: { duration: {}, resolution: {}, aspect_ratio: {}, prompt_expansion_mode: {}, enable_safety_checker: {}, seed: {} },
    pricing: { per_second_by_resolution: { "480p": 0.05, "768p": 0.08 } },
  };
  ok(T.modelHasImageRole(node("minimax/h3-max", "ivideo"), "last") === true,
    "editor: minimax/h3-max last_image via family fallback (catalog hides the param, same gap as minimax-h3)");
  ok(T.modelHasImageRole(node("minimax/h3-max"), "refs") === false,
    "editor: minimax/h3-max has no refs yet (no param, no ref pricing) — must stay OFF");
  ok(T.videoRefSpec(node("minimax/h3-max")) === null,
    "editor: minimax/h3-max ref spec is null (reference-to-video isn't live for this id)");

  // alibaba/wan-3.0-prime as the live catalog ships it: mode/resolution/aspect_ratio/duration/
  // thinking_mode/enable_audio/seed — no last_image/end_image, no reference_images/_urls/referenceImages
  // key, no ref-pricing keys either (its reference-to-video mode uses reference_video_urls /
  // reference_audio_urls / reference_image_urls per the provider docs — none of which this app's
  // single ref-image-array port design speaks), so refs correctly stay OFF; only "last" needs the fix.
  MODELS["alibaba/wan-3.0-prime"] = {
    params: { mode: {}, resolution: {}, aspect_ratio: {}, duration: {}, thinking_mode: {}, enable_audio: {}, seed: {} },
    pricing: { per_second_by_resolution: { "480p": 0.0625, "720p": 0.125, "1080p": 0.25 } },
  };
  ok(T.modelHasImageRole(node("alibaba/wan-3.0-prime", "ivideo"), "last") === true,
    "editor: alibaba/wan-3.0-prime last_image via family fallback (catalog hides the param)");
  ok(T.modelHasImageRole(node("alibaba/wan-3.0-prime"), "refs") === false,
    "editor: alibaba/wan-3.0-prime has no image-ref port under this app's design (video+audio refs unsupported) — must stay OFF, not silently mis-keyed");
  ok(T.videoRefSpec(node("alibaba/wan-3.0-prime")) === null,
    "editor: alibaba/wan-3.0-prime ref spec is null (no reachable ref param under the current single-array port design)");

  // google/gemini-omni-flash as /api/v1/video-models ships it (fetched 2026-09-01): duration +
  // aspect only, no last_image/end_image, no reference_images key, no extra_reference_image —
  // but pricing.per_second_by_mode.reference_to_video is a billed r2v mode (catalog advertising
  // refs). v1 does NOT advertise last-frame (no supportsLastImage, no first-last-frame tag) —
  // last stays OFF; refs via that mode key (exact `reference_to_video` only).
  MODELS["google/gemini-omni-flash"] = {
    params: { duration: {}, aspect_ratio: {} },
    pricing: { per_second_by_mode: { text_to_video: 0.13, image_to_video: 0.14, reference_to_video: 0.16, video_edit: 0.16 } },
  };
  ok(T.modelHasImageRole(node("google/gemini-omni-flash", "ivideo"), "last") === false,
    "editor: gemini-omni-flash v1 must not grow an end-frame port (no last-frame evidence)");
  ok(T.modelHasImageRole(node("google/gemini-omni-flash"), "refs") === true,
    "editor: gemini-omni-flash refs via per_second_by_mode.reference_to_video (no reference_images param)");
  const omni = T.videoRefSpec(node("google/gemini-omni-flash"));
  ok(omni && omni.key === "reference_images" && omni.cap === 4,
    `editor: gemini-omni-flash ref spec is reference_images/4 (generic cap; catalog lists no max), got ${JSON.stringify(omni)}`);

  MODELS["google/gemini-omni-flash/v1.1"] = {
    params: { duration: {}, resolution: {}, aspect_ratio: {} },
    pricing: { per_second_by_mode_and_resolution: {
      text_to_video: { "720p": 0.13, "4k": 0.39 },
      image_to_video: { "720p": 0.14, "4k": 0.42 },
      reference_to_video: { "720p": 0.16, "4k": 0.48 },
      video_edit: { "720p": 0.16, "4k": 0.48 },
    } },
  };
  ok(T.modelHasImageRole(node("google/gemini-omni-flash/v1.1", "ivideo"), "last") === true,
    "editor: gemini-omni-flash/v1.1 last_image via family fallback (catalog hides the param)");
  ok(T.modelHasImageRole(node("google/gemini-omni-flash/v1.1"), "refs") === true,
    "editor: gemini-omni-flash/v1.1 refs via per_second_by_mode_and_resolution.reference_to_video");
  const omni11 = T.videoRefSpec(node("google/gemini-omni-flash/v1.1"));
  ok(omni11 && omni11.key === "reference_images" && omni11.cap === 4,
    `editor: gemini-omni-flash/v1.1 ref spec is reference_images/4, got ${JSON.stringify(omni11)}`);

  // kling-o1 bills reference_to_video_image / _video — not the exact reference_to_video key.
  // Must stay OFF (those keys are a different shape; canRef already hid the mode).
  MODELS["kling-video-o1"] = {
    params: { duration: {}, aspect_ratio: {}, mode: {} },
    pricing: { per_second_by_mode: { text_to_video: 0.112, reference_to_video_image: 0.112, reference_to_video_video: 0.168 } },
  };
  ok(T.modelHasImageRole(node("kling-video-o1"), "refs") === false,
    "editor: kling-o1 reference_to_video_image/_video is not the Omni-style reference_to_video key — refs stay OFF");

  // param presence still wins for families that advertise last_image / a ref key
  MODELS["seedance-2.0"] = { params: { last_image: {}, reference_images: { max: 9 } }, pricing: {} };
  ok(T.modelHasImageRole(node("seedance-2.0", "ivideo"), "last") === true,
    "editor: seedance last_image via advertised param (not the family regex)");
  const sd = T.videoRefSpec(node("seedance-2.0"));
  ok(sd && sd.key === "reference_images" && sd.cap === 9,
    `editor: seedance declared max 9, got ${JSON.stringify(sd)}`);

  // declared max wins over the family table (luma family default is 4)
  MODELS["luma-ray"] = { params: { reference_image_urls: { max: 1 } }, pricing: {} };
  const luma = T.videoRefSpec(node("luma-ray"));
  ok(luma && luma.key === "reference_image_urls" && luma.cap === 1,
    `editor: declared maxItems/max wins (got ${JSON.stringify(luma)})`);

  // known model, no param, no pricing → no extra ports
  MODELS["plain-t2v"] = { params: {}, pricing: {} };
  ok(T.modelHasImageRole(node("plain-t2v", "ivideo"), "last") === false,
    "editor: known no-last model must not grow an end-frame port");
  ok(T.videoRefSpec(node("plain-t2v")) === null,
    "editor: known no-ref model must not grow ref ports");

  // unlisted family: included_reference_images is the only number the catalog gives
  MODELS["priced-unlisted"] = { params: {}, pricing: { included_reference_images: 7 } };
  const un = T.videoRefSpec(node("priced-unlisted"));
  ok(un && un.key === "reference_images" && un.cap === 7,
    `editor: unlisted family uses included_reference_images as cap, got ${JSON.stringify(un)}`);

  // catalog miss / typed-in id → editor stays OFF (would charge an ignored extra image)
  ok(T.modelHasImageRole(node("not-in-catalog", "ivideo"), "last") === false,
    "editor: catalog-missing model is permissive-OFF for last_image");
  ok(T.videoRefSpec(node("not-in-catalog")) === null,
    "editor: catalog-missing model is permissive-OFF for refs");

  ok(T.videoRefsPriced({ pricing: { extra_reference_image: 0.04 } }) === true, "editor videoRefsPriced: extra_reference_image");
  ok(T.videoRefsPriced({ pricing: { included_reference_images: 5 } }) === true, "editor videoRefsPriced: included_reference_images");
  ok(T.videoRefsPriced({ pricing: { per_second: 0.1 } }) === false, "editor videoRefsPriced: unrelated pricing is not evidence");
  ok(T.videoRefsPriced(null) === false, "editor videoRefsPriced: null model");
}

// ---- C. refMaxFor twins (play RUNTIME + njs) ------------------------------
{
  const sources = [["play.html", PLAY]];
  if (existsSync(VENDOR)) sources.push(["vendor/njs-engine.js", readFileSync(VENDOR, "utf8")]);
  const fns = [];
  for (const [label, src] of sources) {
    const copies = extractAllFns(src, "refMaxFor");
    ok(copies.length >= 1, `${label}: refMaxFor exists (×${copies.length})`);
    copies.forEach((fn, i) => fns.push([`${label}#${i + 1}`, new Function(fn + "; return refMaxFor;")()]));
  }
  const CAP_CASES = [
    ["seedance-2.0", undefined, 9],
    ["minimax-h3", { included_reference_images: 5 }, 9], // included is a floor; family cap is 9
    ["Minimax-H3", undefined, 9],
    ["luma-ray/v3.2", undefined, 4],
    ["plain-t2v", undefined, 4],
    ["plain-t2v", { included_reference_images: 7 }, 7],
    ["", undefined, 4],
  ];
  for (const [id, pricing, want] of CAP_CASES) {
    const drifted = fns.filter(([, fn]) => fn(id, pricing) !== want);
    ok(!drifted.length, `refMaxFor(${JSON.stringify(id)}, ${JSON.stringify(pricing)}) === ${want}` +
      (drifted.length ? ` — ${drifted.map(([l, fn]) => l + "=" + fn(id, pricing)).join(", ")}` : ""));
  }
}

// ---- D. play RUNTIME payload (honor authored wires; drop only when known-incapable)
catalog.video = [
  {
    id: "minimax-h3",
    supported_parameters: { parameters: { duration: {}, aspect_ratio: {} } },
    pricing: { included_reference_images: 5, extra_reference_image: 0.04 },
  },
  {
    id: "minimax/h3-max",
    supported_parameters: { parameters: { duration: {}, resolution: {}, aspect_ratio: {}, seed: {} } },
    pricing: { per_second_by_resolution: { "480p": 0.05, "768p": 0.08 } },
  },
  {
    id: "alibaba/wan-3.0-prime",
    supported_parameters: { parameters: { mode: {}, resolution: {}, aspect_ratio: {}, duration: {}, enable_audio: {}, seed: {} } },
    pricing: { per_second_by_resolution: { "480p": 0.0625, "720p": 0.125, "1080p": 0.25 } },
  },
  {
    id: "google/gemini-omni-flash",
    supported_parameters: { parameters: { duration: {}, aspect_ratio: {} } },
    pricing: { per_second_by_mode: { text_to_video: 0.13, image_to_video: 0.14, reference_to_video: 0.16, video_edit: 0.16 } },
  },
  {
    id: "google/gemini-omni-flash/v1.1",
    supported_parameters: { parameters: { duration: {}, resolution: {}, aspect_ratio: {} } },
    pricing: { per_second_by_mode_and_resolution: {
      text_to_video: { "720p": 0.13, "4k": 0.39 },
      reference_to_video: { "720p": 0.16, "4k": 0.48 },
    } },
  },
  { id: "plain-t2v", supported_parameters: { parameters: {} } },
  {
    id: "seedance-2.0",
    supported_parameters: { parameters: { last_image: {}, reference_images: { max: 9 } } },
  },
  {
    id: "luma-like",
    supported_parameters: { parameters: { reference_image_urls: { max: 1 } } },
  },
];

const START = "data:image/png;base64,START";
const END = "data:image/png;base64,END";
const app = loadEngine();

async function spyRun(type, fields, inp) {
  let sent = null;
  const notes = [];
  await app.NODE_TYPES[type].run(
    { id: "v1", type, fields: { prompt: "morph", ...fields } },
    inp,
    { genVideo: (model, prompt, opts, img) => { sent = { model, prompt, opts, img }; return "https://cdn.example/v.mp4"; } },
    (msg) => notes.push(String(msg || "")),
  );
  return { sent, notes };
}

{
  const { sent } = await spyRun("ivideo", { model: "minimax-h3" }, { image: START, endframe: END });
  ok(sent && sent.opts.last_image === END,
    `play: minimax-h3 (catalog hides last_image) still sends end frame, got ${JSON.stringify(sent && sent.opts && sent.opts.last_image)}`);
  ok(sent && sent.img === START, "play: ivideo still sends the start image");
}

{
  const { sent } = await spyRun("ivideo", { model: "minimax/h3-max" }, { image: START, endframe: END });
  ok(sent && sent.opts.last_image === END,
    `play: minimax/h3-max (day-one catalog gap, fixed alongside minimax-h3) still sends end frame, got ${JSON.stringify(sent && sent.opts && sent.opts.last_image)}`);
  ok(sent && sent.img === START, "play: minimax/h3-max ivideo still sends the start image");
}

{
  const { sent } = await spyRun("ivideo", { model: "alibaba/wan-3.0-prime" }, { image: START, endframe: END });
  ok(sent && sent.opts.last_image === END,
    `play: alibaba/wan-3.0-prime (day-one catalog gap) still sends end frame, got ${JSON.stringify(sent && sent.opts && sent.opts.last_image)}`);
  ok(sent && sent.img === START, "play: alibaba/wan-3.0-prime ivideo still sends the start image");
}

{
  const { sent } = await spyRun("ivideo", { model: "google/gemini-omni-flash/v1.1" }, { image: START, endframe: END });
  ok(sent && sent.opts.last_image === END,
    `play: gemini-omni-flash/v1.1 (catalog hides last_image) still sends end frame, got ${JSON.stringify(sent && sent.opts && sent.opts.last_image)}`);
  ok(sent && sent.img === START, "play: gemini-omni-flash/v1.1 ivideo still sends the start image");
}

{
  const { sent, notes } = await spyRun("ivideo", { model: "google/gemini-omni-flash" }, { image: START, endframe: END });
  ok(sent && sent.opts.last_image == null,
    `play: gemini-omni-flash v1 must omit last_image (no supportsLastImage / no first-last-frame), got ${JSON.stringify(sent && sent.opts && sent.opts.last_image)}`);
  ok(notes.some((m) => /end frame ignored/i.test(m)),
    `play: dropping an end frame on Omni v1 must say so, notes=${JSON.stringify(notes)}`);
}

{
  const { sent, notes } = await spyRun("ivideo", { model: "plain-t2v" }, { image: START, endframe: END });
  ok(sent && sent.opts.last_image == null,
    `play: known no-last model must omit last_image, keys=${sent && Object.keys(sent.opts)}`);
  ok(notes.some((m) => /end frame ignored/i.test(m)),
    `play: dropping an end frame must say so, notes=${JSON.stringify(notes)}`);
}

{
  const { sent } = await spyRun("ivideo", { model: "typed-in-vid" }, { image: START, endframe: END });
  ok(sent && sent.opts.last_image === END,
    "play: catalog-missing model honors the authored end-frame wire (editor already gated the port)");
}

{
  const { sent } = await spyRun("tvideo", { model: "minimax-h3" }, { ref1: "R1", ref2: "R2" });
  ok(sent && sent.opts.refKey === "reference_images",
    `play: minimax-h3 refs ride reference_images (pricing evidence), got ${JSON.stringify(sent && sent.opts.refKey)}`);
  ok(sent && Array.isArray(sent.opts.refImages) && sent.opts.refImages.join(",") === "R1,R2",
    `play: minimax-h3 keeps both refs, got ${JSON.stringify(sent && sent.opts.refImages)}`);
}

{
  const { sent } = await spyRun("tvideo", { model: "google/gemini-omni-flash/v1.1" }, { ref1: "R1", ref2: "R2" });
  ok(sent && sent.opts.refKey === "reference_images",
    `play: omni 1.1 refs ride reference_images (reference_to_video mode pricing), got ${JSON.stringify(sent && sent.opts.refKey)}`);
  ok(sent && Array.isArray(sent.opts.refImages) && sent.opts.refImages.join(",") === "R1,R2",
    `play: omni 1.1 keeps both refs, got ${JSON.stringify(sent && sent.opts.refImages)}`);
}

{
  // alibaba/wan-3.0-prime has NO reachable ref-image param/pricing under this app's design (its
  // reference-to-video mode wants separate reference_video_urls/reference_audio_urls/reference_image_urls
  // arrays, not the single reference_images-style key this app's ref1/ref2 ports feed) — refs sent into
  // it must be DROPPED with a note, never silently posted under a made-up key.
  const { sent, notes } = await spyRun("tvideo", { model: "alibaba/wan-3.0-prime" }, { ref1: "R1" });
  ok(sent && !sent.opts.refKey && !(sent.opts.refImages && sent.opts.refImages.length),
    `play: wan-3.0-prime has no image-ref port reachable today — must omit the ref array, got ${JSON.stringify(sent && sent.opts)}`);
  ok(notes.some((m) => /reference image/.test(m) && /ignored/.test(m)),
    `play: dropping refs on wan-3.0-prime must say so, notes=${JSON.stringify(notes)}`);
}

{
  const inp = {};
  for (let i = 1; i <= 10; i++) inp["ref" + i] = "R" + i;
  const { sent, notes } = await spyRun("tvideo", { model: "seedance-2.0" }, inp);
  ok(sent && sent.opts.refImages && sent.opts.refImages.length === 9,
    `play: seedance family cap is 9 (generic 4 used to slice 5-9), got ${sent && sent.opts.refImages && sent.opts.refImages.length}`);
  ok(notes.some((m) => /dropped 1/.test(m) && /limit of 9/.test(m)),
    `play: over-cap drop must say so, notes=${JSON.stringify(notes)}`);
}

{
  const { sent } = await spyRun("tvideo", { model: "luma-like" }, { ref1: "A", ref2: "B" });
  ok(sent && sent.opts.refKey === "reference_image_urls" && sent.opts.refImages && sent.opts.refImages.join(",") === "A",
    `play: luma-like uses declared key + max 1, got key=${sent && sent.opts.refKey} refs=${JSON.stringify(sent && sent.opts.refImages)}`);
}

{
  const { sent, notes } = await spyRun("tvideo", { model: "plain-t2v" }, { ref1: "R1" });
  ok(sent && !sent.opts.refKey && !(sent.opts.refImages && sent.opts.refImages.length),
    `play: known no-ref model must omit the ref array (ignored-but-sent is charged)`);
  ok(notes.some((m) => /reference image/.test(m) && /ignored/.test(m)),
    `play: dropping refs must say so, notes=${JSON.stringify(notes)}`);
}

{
  const { sent } = await spyRun("tvideo", { model: "typed-in-vid" }, { ref1: "R1" });
  ok(sent && sent.opts.refKey === "reference_images" && sent.opts.refImages && sent.opts.refImages[0] === "R1",
    "play: catalog-missing model honors authored ref wires under the common spelling");
}

if (fail) {
  console.error(`\n✗ video-image-roles: ${fail} assertion(s) failed.`);
  process.exit(1);
}
console.log("\n✓ video-image-roles: last_image family fallback (incl. minimax/h3-max + alibaba/wan-3.0-prime/image-to-video + google/gemini-omni-flash/v1.1; v1 stays OFF) + ref pricing/cap twins agree; play payload honors authored wires and drops only when the model is known-incapable.");
