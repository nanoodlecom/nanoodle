#!/usr/bin/env node
// Leftover videoAudioOn parse / clamp / caller-wiring after #712.
// That PR shipped the happy-path dollars (Seedance / Veo / PixVerse untouched
// vs explicit, no-descriptor silent, audio_multiplier) plus boolean
// default-on / explicit-false / default-off. This file pins the other half:
// string/number truthy, snake_case + enable_audio keys, negative-prefix
// keys that must not count as the switch, non-object modelOpts, boolean
// param type, defaults-over-descriptor, and the four editor + one play
// call sites that must keep passing {params, defaults} or 42 default-on
// models silently underquote again. Offline, zero API spend. New file so
// it does not collide with check-audio-switch-default or open leftover PRs.
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

function loadResolver(src, end) {
  const s = src.indexOf("const EST = {"), e = src.indexOf(end);
  if (s < 0 || e < 0) throw new Error("pricing block not found");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.slice(s, e) + "\nthis.videoAudioOn=videoAudioOn;", ctx);
  return ctx;
}

const DUR = { type: "select", options: [] };
const onCtx = { params: { duration: DUR, generateAudio: { type: "switch", default: true } }, defaults: { generateAudio: true } };
const ENGINES = [["editor", IDX, "function nodeUnitUsd("], ["play", PLAY, "async function nodeUnitUsdPlay("]];

for (const [name, src, end] of ENGINES) {
  const R = loadResolver(src, end);
  const on = (fields, ctx) => R.videoAudioOn(fields, ctx);

  const truthy = ["true", "1", 1, "on", "yes"];
  const truthyBad = truthy.filter((v) => on({ modelOpts: { generateAudio: v } }, onCtx) !== true);
  if (truthyBad.length) fail(name + ": truthy " + JSON.stringify(truthyBad) + " must read as audio on");
  else ok(name + ": string/number truthy (true/1/on/yes) reads as audio on");

  const falsy = ["false", "0", 0, "off", "no", ""];
  const falsyBad = falsy.filter((v) => on({ modelOpts: { generateAudio: v } }, onCtx) !== false);
  if (falsyBad.length) fail(name + ": explicit " + JSON.stringify(falsyBad) + " must stay off on a default-on model");
  else ok(name + ": explicit false/0/off/no/empty stays silent on a default-on model");

  if (on({ modelOpts: { generate_audio: true } }, onCtx) !== true)
    fail(name + ": snake_case generate_audio:true must count as the audio switch");
  else if (on({ modelOpts: { generate_audio: false } }, onCtx) !== false)
    fail(name + ": snake_case generate_audio:false must stay off");
  else if (on({ modelOpts: { enable_audio: true } }, onCtx) !== true)
    fail(name + ": enable_audio:true must count as the audio switch");
  else ok(name + ": generate_audio / enable_audio keys count as the switch");

  const negKeys = ["no_audio", "disableAudio", "without_audio", "mute_audio"];
  const negBad = negKeys.filter((k) => on({ modelOpts: { [k]: true } }, onCtx) !== true);
  if (negBad.length) fail(name + ": " + negBad.join("/") + " must not steal the default-on (prefix is a mute flag, not the switch)");
  else ok(name + ": no_/disable_/without_/mute_ keys do not count as the audio switch");

  const fallthrough = [
    [null, "null fields"],
    [{}, "missing modelOpts"],
    [{ modelOpts: null }, "null modelOpts"],
    [{ modelOpts: "true" }, "string modelOpts"],
  ];
  const fallBad = fallthrough.filter(([f]) => on(f, onCtx) !== true);
  if (fallBad.length) fail(name + ": " + fallBad.map(([, l]) => l).join("/") + " must fall through to the catalog default");
  else ok(name + ": missing/null/non-object modelOpts falls through to the catalog default");

  const boolCtx = { params: { generateAudio: { type: "boolean", default: true } }, defaults: {} };
  if (on({ modelOpts: {} }, boolCtx) !== true)
    fail(name + ": type:boolean default-on must read as audio on");
  else ok(name + ": type:boolean (not only switch) still reads the catalog default");

  const defaultsWin = { params: { generateAudio: { type: "switch", default: true } }, defaults: { generateAudio: false } };
  const descWin = { params: { generateAudio: { type: "switch", default: false } }, defaults: {} };
  const strDef = { params: { generateAudio: { type: "switch", default: "true" } }, defaults: {} };
  if (on({ modelOpts: {} }, defaultsWin) !== false)
    fail(name + ": supported_parameters.defaults must win over the param's own default");
  else if (on({ modelOpts: {} }, descWin) !== false)
    fail(name + ": missing defaults must use the param's own default (false)");
  else if (on({ modelOpts: {} }, strDef) !== true)
    fail(name + ": string catalog default \"true\" must read as audio on");
  else ok(name + ": defaults win over d.default; string \"true\" default is on");

  const enhance = { params: { enhance: { type: "switch", default: true } }, defaults: { enhance: true } };
  if (on({ modelOpts: {} }, enhance) !== false || on({ modelOpts: { enhance: true } }, enhance) !== false)
    fail(name + ": a non-audio switch must not flip the audio tier");
  else ok(name + ": a non-audio switch does not flip the audio tier");
}

// The helper is unused if a caller drops the 6th argument — #712's whole
// point. Kandinsky's livePrice pin was loosened in #713 to *allow* the
// extra arg; these pins require it.
{
  const pins = [
    ["editor livePrice", IDX, "videoUnitUsd(applyVideoQuotePricing(fields.model, it.pricing), videoPriceFields(it.params, fields), refCount, videoWired, nodeFilter, { params:it.params, defaults:it.defaults })"],
    ["editor nodeUnitUsd", IDX, "videoUnitUsd(applyVideoQuotePricing(fields.model, it.pricing), videoPriceFields(it.params, fields), refCount, videoWired, t.modelFilter, { params:it.params, defaults:it.defaults })"],
    ["editor pickerRowPrice", IDX, "videoUnitUsd(applyVideoQuotePricing(m.id, m.pricing), {}, false, false, picker.filter, { params:m.params, defaults:m.defaults })"],
    ["editor normVideo", IDX, "videoUnitUsd(p, {}, false, false, undefined, { params:pp, defaults:sp.defaults||{} })"],
    ["play nodeUnitUsdPlay", PLAY, "videoUnitUsd(pricing, videoPriceFields(pp, f), refCount, videoWired, t.modelFilter, { params:pp, defaults:sp.defaults||{} })"],
  ];
  let pinBad = 0;
  for (const [label, src, needle] of pins) {
    if (!src.includes(needle)) { fail(label + " must pass {params, defaults} into videoUnitUsd"); pinBad++; }
  }
  if (!pinBad) ok("chip / run-cost / picker / catalog-norm keep the audio-default context (" + pins.length + " call sites)");
}

if (failed) { console.error("✗ audio switch edges: " + failed + " failed"); process.exit(1); }
console.log("✓ audio switch edges");
