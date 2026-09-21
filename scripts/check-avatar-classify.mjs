#!/usr/bin/env node
// Avatar / lipsync classification. Live catalog 2026-09-21 (GET /api/v1/video-models, no spend):
// image_to_video && audio_input was enough to land a model on the Avatar node, and the newest
// such row — minimax-h3/reference-to-video — became the node's default (same created stamp as
// MiniMax H3 Max Lip Sync, and it sorts first). That model wants reference_audios[], but the
// lipsync run posts audioUrl / audioDataUrl. The speech track is dropped and the call still bills.
// Wan 3.0 Prime, Wan 3.0 reference-to-video, and Seedance 2.5 (the omni id, not the talking-avatar
// id) have the same leak: their modality includes a source video this node cannot supply.
//
// Offline. Extracts normVideo (editor) and modelSuits (play / exported apps) and runs both against
// fixture rows copied from that catalog response. No browser, no API spend.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

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

const idxCtx = {};
vm.createContext(idxCtx);
vm.runInContext(
  "function videoUnitUsd(){ return 0; }\n" + extractFn(IDX, "normVideo") + "\nthis.normVideo = normVideo;",
  idxCtx,
);

const playCtx = { INPAINT_OK: {}, NEEDS_SRC_IDS: {} };
vm.createContext(playCtx);
vm.runInContext(extractFn(PLAY, "modelSuits") + "\nthis.modelSuits = modelSuits;", playCtx);

// Shapes copied from the public video catalog (capabilities, modality, param keys, created).
// created stamps are what made reference-to-video the default: it ties H3 Max Lip Sync and
// the catalog's native order puts it first.
const PEOPLE_SINGLE = { type: "select", options: [{ value: "single" }, { value: "two" }], default: "single" };
const FIXTURES = [
  { id: "minimax-h3/reference-to-video", created: 1789689600,
    architecture: { modality: "text+image+audio->video" },
    capabilities: { image_to_video: true, audio_input: true, text_to_video: true },
    supported_parameters: { parameters: { reference_images: { type: "text" }, reference_audios: { type: "text" }, reference_videos: { type: "text" } } } },
  { id: "minimax/h3-max/lip-sync/image-to-video", created: 1789689600,
    architecture: { modality: "image+audio->video" },
    capabilities: { image_to_video: true, audio_input: true },
    supported_parameters: { parameters: { resolution: { type: "select" }, enable_transcription: { type: "switch" } } } },
  { id: "bytedance/seedance-2.5/talking-avatar", created: 1789603200,
    architecture: { modality: "image+audio->video" },
    capabilities: { image_to_video: true, audio_input: true },
    supported_parameters: { parameters: { resolution: { type: "select" }, audio: { type: "string" } } } },
  { id: "infinitetalk", created: 1788825600,
    architecture: { modality: "image+audio->video" },
    capabilities: { image_to_video: true, audio_input: true },
    supported_parameters: { parameters: { people: PEOPLE_SINGLE, audio: { type: "text" }, left_audio: { type: "text" }, right_audio: { type: "text" } } } },
  { id: "longcat-avatar-1.5", created: 1779494400,
    architecture: { modality: "image+audio->video" },
    capabilities: { image_to_video: true, audio_input: true },
    supported_parameters: { parameters: { resolution: { type: "select" } } } },
  { id: "longcat-avatar-1.5/multi", created: 1779494400,
    architecture: { modality: "image+audio->video" },
    capabilities: { image_to_video: true, audio_input: true },
    supported_parameters: { parameters: { left_audio: { type: "string" }, right_audio: { type: "string" } } } },
  { id: "bytedance/seedance-2.5", created: 1786060800,
    architecture: { modality: "text+image+video+audio->video" },
    capabilities: { text_to_video: true, image_to_video: true, video_to_video: true, audio_input: true },
    supported_parameters: { parameters: { mode: { type: "select" }, generate_audio: { type: "switch" } } } },
  { id: "bytedance/seedance-2.5-turbo", created: 1786060800,
    architecture: { modality: "text+image+video+audio->video" },
    capabilities: { text_to_video: true, image_to_video: true, video_to_video: true, audio_input: true },
    supported_parameters: { parameters: { generate_audio: { type: "switch" } } } },
  { id: "alibaba/wan-3.0-prime", created: 1787529600,
    architecture: { modality: "text+image+video+audio->video" },
    capabilities: { text_to_video: true, image_to_video: true, video_to_video: true, audio_input: true, audio_generation: true },
    supported_parameters: { parameters: { mode: { type: "select" }, enable_audio: { type: "switch" } } } },
  { id: "alibaba/wan-3.0/reference-to-video", created: 1786320000,
    architecture: { modality: "image+video+audio->video" },
    capabilities: { image_to_video: true, video_to_video: true, audio_input: true, audio_generation: true },
    supported_parameters: { parameters: { enable_audio: { type: "switch" } } } },
  { id: "minimax/h3-max", created: 1787702400,
    architecture: { modality: "text+image+video+audio->video" },
    capabilities: { text_to_video: true, image_to_video: true, video_to_video: true, audio_input: true },
    supported_parameters: { parameters: { reference_audios: { type: "text" }, mode: { type: "select" } } } },
  { id: "minimax-h3", created: 1785456000,
    architecture: { modality: "text+image+video+audio->video" },
    capabilities: { text_to_video: true, image_to_video: true, video_to_video: true, audio_input: true },
    supported_parameters: { parameters: { reference_audios: { type: "text" } } } },
  // These accept one driving audio track and do NOT take a source video. They stay on the node.
  { id: "music-video-generator", created: 1776124800,
    architecture: { modality: "text+image+audio->video" },
    capabilities: { text_to_video: true, image_to_video: true, audio_input: true },
    supported_parameters: { parameters: { prompt: { type: "string" } } } },
  { id: "lightricks/ltx-2.5/fast", created: 1786406400,
    architecture: { modality: "text+image+audio->video" },
    capabilities: { text_to_video: true, image_to_video: true, audio_input: true, audio_generation: true },
    supported_parameters: { parameters: { generateAudio: { type: "switch" } } } },
  { id: "wan-s2v", created: 1756857600,
    architecture: { modality: "image+audio->video" },
    capabilities: { image_to_video: true, audio_input: true },
    supported_parameters: { parameters: { resolution: { type: "select" } } } },
];

const NOT_AVATAR = [
  "minimax-h3/reference-to-video",
  "bytedance/seedance-2.5",
  "bytedance/seedance-2.5-turbo",
  "alibaba/wan-3.0-prime",
  "alibaba/wan-3.0/reference-to-video",
  "minimax/h3-max",
  "minimax-h3",
  "longcat-avatar-1.5/multi",
];
const IS_AVATAR = [
  "minimax/h3-max/lip-sync/image-to-video",
  "bytedance/seedance-2.5/talking-avatar",
  "infinitetalk",
  "longcat-avatar-1.5",
  "music-video-generator",
  "lightricks/ltx-2.5/fast",
  "wan-s2v",
];

const editor = new Map(FIXTURES.map((m) => [m.id, idxCtx.normVideo(m)]));
const play = new Map(FIXTURES.map((m) => [m.id, playCtx.modelSuits("lipsync", m)]));

for (const id of NOT_AVATAR) {
  ok(editor.get(id) && editor.get(id).avatar === false, "editor: " + id + " is not an avatar");
  ok(play.get(id) === false, "play: " + id + " is not offered on lipsync");
}
for (const id of IS_AVATAR) {
  ok(editor.get(id) && editor.get(id).avatar === true, "editor: " + id + " stays an avatar");
  ok(play.get(id) === true, "play: " + id + " stays offered on lipsync");
}

// The lipsync submit path (both engines) names the speech track audioUrl / audioDataUrl.
// It never writes reference_audios. A reference model classified as an avatar therefore
// drops the track the user wired.
const genStart = IDX.indexOf("async genVideo(");
const genEnd = IDX.indexOf("async genChat(", genStart);
const gen = IDX.slice(genStart, genEnd > genStart ? genEnd : genStart + 4000);
ok(/audioUrl/.test(gen) && /audioDataUrl/.test(gen), "editor genVideo sends the lipsync track as audioUrl/audioDataUrl");
ok(!/reference_audios/.test(gen), "editor genVideo does not map that track onto reference_audios");

// Default Avatar model = newest non-nsfw avatar. With the reference row excluded, that is
// H3 Max Lip Sync (created 1789689600), not minimax-h3/reference-to-video.
const avatars = [...editor.values()].filter((m) => m.avatar && !m.nsfw);
const newest = Math.max(...avatars.map((m) => m.created || 0));
const newestIds = avatars.filter((m) => m.created === newest).map((m) => m.id);
ok(newestIds.length === 1 && newestIds[0] === "minimax/h3-max/lip-sync/image-to-video",
  "editor default avatar is H3 Max Lip Sync, got " + JSON.stringify(newestIds));
ok(!avatars.some((m) => m.id === "minimax-h3/reference-to-video"),
  "editor default set no longer includes H3 reference-to-video");

if (fail) {
  console.error("\n✗ " + fail + " avatar-classify checks failed");
  process.exit(1);
}
console.log("\n✓ avatar classify: omni/reference models stay off the Avatar node; real talking avatars stay on. Both engines agree.");
