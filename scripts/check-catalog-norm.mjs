#!/usr/bin/env node
// Catalog normalizers decide which node a model is offered on. NanoGPT often
// tags edit/extend/lipsync rows text_to_video:true even though they require a
// source video, and cover rows text_to_music even though they require a source
// track. A broken flag here is a paid dead-end: Text→Video / Music default to
// the newest passing id, so a mislabeled edit-video or cover model becoming
// t2v/music is the first-click charge that never returns a clip.
//
// check-catalog-fallback.mjs stubs normVideo/normAudio as identity, so it never
// exercises this. This file extracts the real normalizers and drives them with
// catalog-shaped fixtures for this week's shapes (FLUX.3 Edit Video, P-Video 2)
// plus the long-standing mislabel cases. Offline, no API spend.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");

let fail = 0;
const ok = (c, m) => {
  if (!c) { fail++; console.log("  ✗ " + m); }
  else console.log("  ✓ " + m);
};

function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error(name + "() not found in index.html");
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("could not brace-match " + name + "()");
}

const ctx = {
  videoUnitUsd: () => 0.05,
  audioUnitUsd: () => 0.01,
  EST: { ttsChars: 120 },
  catalogs: { video: [], audio: [] },
  NODE_TYPES: {
    tvideo: { modelKind: "video", modelFilter: "t2v" },
    ivideo: { modelKind: "video", modelFilter: "i2v" },
    vedit: { modelKind: "video", modelFilter: "v2v" },
    lipsync: { modelKind: "video", modelFilter: "avatar" },
    music: { modelKind: "audio", modelFilter: "music" },
    remix: { modelKind: "audio", modelFilter: "remix" },
    speech: { modelKind: "audio", modelFilter: "tts" },
    transcribe: { modelKind: "audio", modelFilter: "stt" },
  },
};
vm.createContext(ctx);
new vm.Script(
  [
    extractFn(IDX, "normVideo"),
    extractFn(IDX, "normAudio"),
    extractFn(IDX, "passesFilter"),
    extractFn(IDX, "defModelFor"),
  ].join("\n"),
  { filename: "index.html#catalog-norm" },
).runInContext(ctx);

const { normVideo, normAudio, passesFilter, defModelFor } = ctx;

function flags(m) {
  return {
    t2v: !!m.t2v, i2v: !!m.i2v, v2v: !!m.v2v, avatar: !!m.avatar,
    audioGen: !!m.audioGen, lora: !!m.lora,
    music: !!m.music, remix: !!m.remix, tts: !!m.tts, stt: !!m.stt,
  };
}

// ---- Video: NanoGPT tags edit/extend text_to_video even when they need a clip
{
  const fluxEdit = normVideo({
    id: "blackforestlabs/flux-3/edit-video",
    capabilities: { text_to_video: true, video_to_video: true },
    architecture: { modality: "text+video->video" },
    supported_parameters: { parameters: {} },
  });
  ok(flags(fluxEdit).v2v && !flags(fluxEdit).t2v,
    "FLUX.3 Edit Video (text+video→video, tagged t2v) is v2v only — Text→Video must not offer it");
  ok(!passesFilter(fluxEdit, "t2v") && passesFilter(fluxEdit, "v2v"),
    "passesFilter: flux-3/edit-video fails t2v and passes v2v");
}

{
  const pvideoEdit = normVideo({
    id: "pruna-ai/p-video/edit",
    capabilities: { text_to_video: true, video_to_video: true },
    architecture: { modality: "text+video->video" },
    supported_parameters: { parameters: {} },
  });
  ok(flags(pvideoEdit).v2v && !flags(pvideoEdit).t2v,
    "P-Video edit (same mislabel) stays off Text→Video");
}

{
  const t2v = normVideo({
    id: "pruna-ai/p-video-2/text-to-video",
    capabilities: { text_to_video: true, audio_generation: true },
    architecture: { modality: "text->video" },
    supported_parameters: { parameters: {} },
  });
  ok(flags(t2v).t2v && !flags(t2v).v2v && flags(t2v).audioGen,
    "P-Video 2 text-to-video is t2v + audioGen, not v2v");
}

{
  const i2v = normVideo({
    id: "pruna-ai/p-video-2/image-to-video",
    capabilities: { text_to_video: true, image_to_video: true, audio_generation: true },
    architecture: { modality: "text+image->video" },
    supported_parameters: { parameters: {} },
  });
  ok(flags(i2v).i2v && flags(i2v).t2v && !flags(i2v).v2v && flags(i2v).audioGen,
    "P-Video 2 image-to-video keeps t2v (no required source video) and i2v");
}

{
  const optionalVideo = normVideo({
    id: "seedance-2.5",
    capabilities: { text_to_video: true, image_to_video: true, video_to_video: true },
    architecture: { modality: "text+image+video->video" },
    supported_parameters: { parameters: {} },
  });
  ok(flags(optionalVideo).t2v && flags(optionalVideo).i2v && flags(optionalVideo).v2v,
    "text+image+video keeps t2v — video is optional when an image modality is also present");
}

{
  const videoOnly = normVideo({
    id: "extend-only",
    capabilities: { text_to_video: true, video_to_video: true },
    architecture: { modality: "video->video" },
    supported_parameters: { parameters: {} },
  });
  ok(!flags(videoOnly).t2v && flags(videoOnly).v2v,
    "video→video (no image) is never t2v even when tagged text_to_video");
}

{
  const avatar = normVideo({
    id: "longcat-avatar",
    capabilities: { image_to_video: true, audio_input: true, text_to_video: true },
    architecture: { modality: "text+image+audio->video" },
    supported_parameters: { parameters: {} },
  });
  ok(flags(avatar).avatar,
    "image + single audio (no left/right tracks) is an avatar model");
}

{
  const multi = normVideo({
    id: "longcat-multi",
    capabilities: { image_to_video: true, audio_input: true },
    architecture: { modality: "text+image+audio->video" },
    supported_parameters: { parameters: { left_audio: {}, right_audio: {}, people: { options: [{ value: "two" }] } } },
  });
  ok(!flags(multi).avatar,
    "left_audio/right_audio without people=single is not lipsync — the node only wires one track");
}

{
  const talk = normVideo({
    id: "infinitetalk",
    capabilities: { image_to_video: true, audio_input: true },
    architecture: { modality: "text+image+audio->video" },
    supported_parameters: { parameters: { left_audio: {}, people: { options: [{ value: "single" }, { value: "two" }] } } },
  });
  ok(flags(talk).avatar,
    "left_audio + people=single still qualifies as avatar (InfiniteTalk-shaped)");
}

{
  const withLora = normVideo({
    id: "lora-i2v",
    capabilities: { image_to_video: true },
    architecture: { modality: "text+image->video" },
    supported_parameters: { parameters: { lora_url_1: {} } },
  });
  const spicyOverride = normVideo({
    id: "spicy-loras",
    capabilities: { image_to_video: true },
    architecture: { modality: "text+image->video" },
    supported_parameters: { parameters: { loras: {} } },
  });
  ok(flags(withLora).lora && !flags(spicyOverride).lora,
    "lora flag follows a lora_url slot, not a spicy 'loras' override");
}

// Newest row is the mislabeled edit-video. Text→Video must skip it.
{
  ctx.catalogs.video = [
    normVideo({
      id: "blackforestlabs/flux-3/edit-video",
      created: 200,
      capabilities: { text_to_video: true, video_to_video: true },
      architecture: { modality: "text+video->video" },
      supported_parameters: { parameters: {} },
    }),
    normVideo({
      id: "pruna-ai/p-video-2/text-to-video",
      created: 100,
      capabilities: { text_to_video: true, audio_generation: true },
      architecture: { modality: "text->video" },
      supported_parameters: { parameters: {} },
    }),
    normVideo({
      id: "pruna-ai/p-video-2/image-to-video",
      created: 90,
      capabilities: { image_to_video: true },
      architecture: { modality: "text+image->video" },
      supported_parameters: { parameters: {} },
    }),
  ];
  ok(defModelFor("tvideo") === "pruna-ai/p-video-2/text-to-video",
    `tvideo default skips newest edit-video, got ${JSON.stringify(defModelFor("tvideo"))}`);
  ok(defModelFor("vedit") === "blackforestlabs/flux-3/edit-video",
    `vedit default is the newest v2v (flux-3/edit-video), got ${JSON.stringify(defModelFor("vedit"))}`);
  ok(defModelFor("ivideo") === "pruna-ai/p-video-2/image-to-video",
    `ivideo default is the i2v row, got ${JSON.stringify(defModelFor("ivideo"))}`);
}

// ---- Audio: cover / dead ids must not become the Music default
{
  const cover = normAudio({
    id: "minimax/music-cover",
    capabilities: { text_to_music: true, music_cover: true },
    architecture: { modality: "text+audio->audio" },
    supported_parameters: {},
  });
  ok(!flags(cover).music && flags(cover).remix,
    "minimax/music-cover is remix, not Music — id verb beats text_to_music");
}

{
  const music3 = normAudio({
    id: "minimax/music-3",
    capabilities: { text_to_music: true },
    architecture: { modality: "text->audio" },
    supported_parameters: {},
  });
  ok(flags(music3).music && !flags(music3).tts && !flags(music3).remix,
    "Music 3 (text→audio, no cover verb) is music");
}

{
  const dead = normAudio({
    id: "ACE-Step-v1.5-Base",
    capabilities: { text_to_music: true, music_cover: true },
    architecture: { modality: "text->audio" },
    supported_parameters: {},
  });
  ok(!flags(dead).music && !flags(dead).remix,
    "known-dead ACE-Step is neither music nor remix (was the Music default)");
}

{
  const clone = normAudio({
    id: "vendor/voice-clone",
    category: "audio_stt",
    capabilities: { speech_to_text: true },
    architecture: { modality: "audio->text" },
    supported_parameters: {},
  });
  ok(!flags(clone).stt,
    "voice-clone mislabeled audio_stt is not Transcribe");
}

{
  const speech = normAudio({
    id: "qwen-tts",
    capabilities: { text_to_speech: true },
    architecture: { modality: "text->audio" },
    supported_parameters: { language: { default: "auto", values: ["auto", "en", "zh"] } },
  });
  ok(flags(speech).tts && !flags(speech).music,
    "explicit TTS is tts, not music");
  ok(speech.language && speech.language.values.includes("en"),
    "Speech language object with string values is surfaced");
  const badLang = normAudio({
    id: "qwen-tts-bad",
    capabilities: { text_to_speech: true },
    architecture: { modality: "text->audio" },
    supported_parameters: { language: "en" },
  });
  ok(badLang.language == null,
    "a string language field is not treated as the Speech knob");
}

{
  ctx.catalogs.audio = [
    normAudio({
      id: "minimax/music-cover",
      created: 300,
      capabilities: { text_to_music: true, music_cover: true },
      architecture: { modality: "text+audio->audio" },
      supported_parameters: {},
    }),
    normAudio({
      id: "ACE-Step-v1.5-Base",
      created: 200,
      capabilities: { text_to_music: true },
      architecture: { modality: "text->audio" },
      supported_parameters: {},
    }),
    normAudio({
      id: "minimax/music-3",
      created: 100,
      capabilities: { text_to_music: true },
      architecture: { modality: "text->audio" },
      supported_parameters: {},
    }),
  ];
  ok(defModelFor("music") === "minimax/music-3",
    `Music default skips cover + dead rows, got ${JSON.stringify(defModelFor("music"))}`);
  ok(defModelFor("remix") === "minimax/music-cover",
    `Remix default is the cover row, got ${JSON.stringify(defModelFor("remix"))}`);
}

if (fail) {
  console.error(`\n✗ catalog-norm: ${fail} assertion(s) failed.`);
  process.exit(1);
}
console.log("\n✓ catalog-norm: edit-video / cover / dead rows cannot land on Text→Video or Music; FLUX.3 Edit Video and P-Video 2 classify by modality, not NanoGPT's t2v tag.");
