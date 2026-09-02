#!/usr/bin/env node
// Generate Song (Mureka family …/generate-song) needs lyrics. Empty lyrics are
// omitted by collectAudioParams, which used to POST and 400 at NanoGPT. This
// pins the local preflight + the audio-400 API-message surfacing, offline.
//
//   * generate-song with no lyrics never POSTs (built-in + njs send path)
//   * generate-bgm still POSTs prompt-only
//   * generate-song with lyrics forwards `lyrics`
//   * Sing-style wired lyrics port must appear on the generate-song POST
//   * editor catalog miss still forwards lyrics (send-everything fallback)
//   * extraJson lyrics still count; whitespace-only does not
//   * MiniMax Music 3 instrumental still omits empty lyrics and POSTs
//   * audio 400 prefers API error.message; lyrics/invalid_request skip the
//     "model may have changed" suffix
//   * editor + play twins of assertGenerateSongLyrics / audioApiMessage
//
// Zero API spend.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadEngine, calls, catalog } from "./play-engine.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");
const VENDOR = join(ROOT, "vendor", "njs-engine.js");

const SONG = "mureka-ai/mureka-v9.5/generate-song";
const SONG_O2 = "mureka-ai/mureka-o2/generate-song";
const BGM = "mureka-ai/mureka-v9.5/generate-bgm";
const PTS = "mureka-ai/mureka-v9.5/prompt-to-song";
const API_400 = '{"error":{"message":"Mureka v9.5 Generate Song requires lyrics","type":"invalid_request_error","code":"invalid_request"}}';

catalog.audio.push(
  { id: SONG, supported_parameters: {} },
  { id: SONG_O2, supported_parameters: {} },
  { id: BGM, supported_parameters: {} },
  { id: PTS, supported_parameters: {} },
  { id: "music3shape", supported_parameters: {} },
  { id: "x", supported_parameters: { voices: ["alloy"], min_duration: 1, max_duration: 300 } },
);

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

// Gallery Sing supplies lyrics (LLM→lyrics wire). Pin Generate Song, not Prompt-to-Song.
// awesome-noodles #11 (7e462b4) landed the same id — keep lockstep on re-sync.
{
  const ex = IDX.slice(IDX.indexOf("const EXAMPLES = ["), IDX.indexOf("\n];", IDX.indexOf("const EXAMPLES = [")));
  const sing = /slug:"sing"[\s\S]*?type:"music",[^}]*fields:\{([^}]*)\}/.exec(ex);
  const mid = sing && /"?model"?:"([^"]+)"/.exec(sing[1]);
  if (!mid || mid[1] !== SONG)
    fail(`EXAMPLES sing music node must pin ${SONG} (got ${JSON.stringify(mid && mid[1])})`);
  else ok("EXAMPLES sing pins generate-song (lyrics in; not prompt-to-song / Music 3)");
}

function braceMatch(src, start) {
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced braces from: " + src.slice(start, start + 40));
}
function extractFn(src, name) {
  const at = src.search(new RegExp("(async )?function " + name + "\\("));
  if (at === -1) throw new Error(name + "() not found");
  return braceMatch(src, at);
}
function stripWs(s) { return String(s).split("\n").map((l) => l.trim()).filter(Boolean).join("\n"); }

const node = (id, type, fields) => ({ id, type, x: 0, y: 0, fields: fields || {} });
const audioPosts = () => calls.filter((c) => /\/audio\/speech/.test(c.url));

/* ---- twin lockstep ------------------------------------------------------- */

{
  const aIdx = extractFn(IDX, "assertGenerateSongLyrics");
  const aPlay = extractFn(PLAY, "assertGenerateSongLyrics");
  if (stripWs(aIdx) !== stripWs(aPlay)) fail("assertGenerateSongLyrics drifted between index.html and play.html");
  else ok("assertGenerateSongLyrics is twin-identical");

  const mIdx = extractFn(IDX, "audioApiMessage");
  const mPlay = extractFn(PLAY, "audioApiMessage");
  if (stripWs(mIdx) !== stripWs(mPlay)) fail("audioApiMessage drifted between index.html and play.html");
  else ok("audioApiMessage is twin-identical");

  if (!/assertGenerateSongLyrics\(n\.fields\.model, body\.lyrics\)/.test(IDX)
    || !/assertGenerateSongLyrics\(n\.fields\.model, body\.lyrics\)/.test(PLAY))
    fail("collectAudioParams must call assertGenerateSongLyrics after extraJson");
  else ok("collectAudioParams preflights generate-song on both surfaces");

  if (!/assertGenerateSongLyrics\(model, extra && extra\.lyrics\)/.test(IDX)
    || !/assertGenerateSongLyrics\(model, extra && extra\.lyrics\)/.test(PLAY))
    fail("njsCtx.audio must preflight generate-song before the library POSTs");
  else ok("njsCtx.audio preflights generate-song on both surfaces");

  if (/if\(\/lyric\/i\.test\(t\)\) throw new Error\("This model needs lyrics/.test(IDX)
    || /if\(\/lyric\/i\.test\(t\)\) throw new Error\("This model needs lyrics/.test(PLAY))
    fail("genAudio still swallows lyric 400s with the generic remap");
  else ok("genAudio no longer swallows lyric 400s");

  if (!/if\(r\.status===400 && apiMsg\) throw new Error\(apiMsg\)/.test(IDX)
    || !/if\(r\.status===400 && apiMsg\) throw new Error\(apiMsg\)/.test(PLAY))
    fail("genAudio must throw the API error.message on audio 400");
  else ok("genAudio prefers API error.message on 400");

  if (!/\/\^4\\d\\d\\b\/\.test\(m\) && \/model\/i\.test\(m\) && !\/lyric\|invalid_request\/i\.test\(m\)/.test(IDX))
    fail("friendlyRunError must skip the model-changed suffix for lyrics/invalid_request");
  else ok("friendlyRunError skips model-changed suffix for lyrics/invalid_request");

  if (!/const fields = it \? audioFields\(n\.type, it\) : \(AUDIO_PARAMS\[n\.type\]\|\|\[\]\)\.map/.test(IDX))
    fail("editor collectAudioParams must send-everything on catalog miss (lyrics wire)");
  else ok("editor collectAudioParams has catalog-miss send-everything fallback");
}

/* ---- helpers: editor extract --------------------------------------------- */

function loadHelpers(src) {
  const ctx = { console, JSON, String, Error };
  vm.createContext(ctx);
  vm.runInContext(
    extractFn(src, "assertGenerateSongLyrics") + "\n" + extractFn(src, "audioApiMessage"),
    ctx,
  );
  return ctx;
}

{
  for (const [name, src] of [["index.html", IDX], ["play.html", PLAY]]) {
    const h = loadHelpers(src);
    let threw = null;
    try { h.assertGenerateSongLyrics(SONG, ""); } catch (e) { threw = e; }
    if (!threw) fail(`${name}: generate-song + empty lyrics must throw`);
    else if (!/needs Lyrics/.test(threw.message) || !/Generate BGM/.test(threw.message) || !/Prompt-to-Song/.test(threw.message))
      fail(`${name}: preflight message unhelpful: ${JSON.stringify(threw.message)}`);
    else if (!threw.message.includes(SONG))
      fail(`${name}: preflight must name the model id, got ${JSON.stringify(threw.message)}`);
    else ok(`${name}: generate-song + empty lyrics throws a named requirement`);

    threw = null;
    try { h.assertGenerateSongLyrics(SONG, "   "); } catch (e) { threw = e; }
    if (!threw) fail(`${name}: whitespace-only lyrics must throw`);
    else ok(`${name}: whitespace-only lyrics count as empty`);

    threw = null;
    try { h.assertGenerateSongLyrics(SONG_O2, null); } catch (e) { threw = e; }
    if (!threw) fail(`${name}: o2/generate-song (not only 9.5) must throw`);
    else ok(`${name}: any …/generate-song id is gated`);

    threw = null;
    try { h.assertGenerateSongLyrics(SONG, "hello from the other side"); } catch (e) { threw = e; }
    if (threw) fail(`${name}: generate-song + lyrics must not throw: ${threw.message}`);
    else ok(`${name}: generate-song + lyrics is allowed`);

    for (const id of [BGM, PTS, "minimax/music-3"]) {
      threw = null;
      try { h.assertGenerateSongLyrics(id, ""); } catch (e) { threw = e; }
      if (threw) fail(`${name}: ${id} must not require lyrics, got ${threw.message}`);
    }
    ok(`${name}: BGM / Prompt-to-Song / Music 3 stay omit-empty`);

    const msg = h.audioApiMessage(API_400);
    if (msg !== "Mureka v9.5 Generate Song requires lyrics")
      fail(`${name}: audioApiMessage missed error.message, got ${JSON.stringify(msg)}`);
    else ok(`${name}: audioApiMessage prefers error.message`);

    const prefixed = h.audioApiMessage("400: " + API_400);
    if (prefixed !== "Mureka v9.5 Generate Song requires lyrics")
      fail(`${name}: audioApiMessage must strip a 400: prefix, got ${JSON.stringify(prefixed)}`);
    else ok(`${name}: audioApiMessage accepts httpRunError-shaped 400: JSON`);

    if (h.audioApiMessage("400: not json at all") != null)
      fail(`${name}: audioApiMessage must return null on non-JSON`);
    else ok(`${name}: audioApiMessage ignores non-JSON bodies`);
  }
}

/* ---- editor collectAudioParams (stub catalog) ---------------------------- */

{
  const ctx = {
    console, JSON, String, Error, isNaN, Number,
    catItem: () => ({ params: {}, voices: [] }),
    audioFields: () => [
      { id: "lyrics", type: "textarea", jsonKey: "lyrics", appliesTo: "all" },
      { id: "instrumental", type: "boolean", jsonKey: "instrumental", appliesTo: "all" },
    ],
  };
  vm.createContext(ctx);
  vm.runInContext(
    extractFn(IDX, "assertGenerateSongLyrics") + "\n" + extractFn(IDX, "collectAudioParams"),
    ctx,
  );

  let threw = null;
  try { ctx.collectAudioParams({ type: "music", fields: { model: SONG, prompt: "upbeat pop" } }); }
  catch (e) { threw = e; }
  if (!threw) fail("editor collectAudioParams: generate-song without lyrics must throw");
  else ok("editor collectAudioParams: generate-song without lyrics throws before POST");

  const withLyrics = ctx.collectAudioParams({
    type: "music",
    fields: { model: SONG, prompt: "upbeat pop", lyrics: "[Verse]\nhello" },
  });
  if (withLyrics.lyrics !== "[Verse]\nhello")
    fail(`editor collectAudioParams: lyrics not forwarded, got ${JSON.stringify(withLyrics)}`);
  else ok("editor collectAudioParams: generate-song forwards lyrics");

  const viaExtra = ctx.collectAudioParams({
    type: "music",
    fields: { model: SONG, prompt: "upbeat pop", extraJson: JSON.stringify({ lyrics: "from extra" }) },
  });
  if (viaExtra.lyrics !== "from extra")
    fail(`editor collectAudioParams: extraJson lyrics must satisfy the preflight, got ${JSON.stringify(viaExtra)}`);
  else ok("editor collectAudioParams: extraJson lyrics count");

  const bgm = ctx.collectAudioParams({ type: "music", fields: { model: BGM, prompt: "lofi rain" } });
  if ("lyrics" in bgm) fail(`editor collectAudioParams: BGM must omit empty lyrics, got ${JSON.stringify(bgm)}`);
  else ok("editor collectAudioParams: BGM omits empty lyrics");
}

/* ---- editor collectAudioParams on catalog miss --------------------------- */

{
  const ctx = {
    console, JSON, String, Error, isNaN, Number,
    catItem: () => null,   // cold cache / typed-in id / id mismatch
    AUDIO_PARAMS: {
      music: [
        { id: "lyrics", type: "textarea", appliesTo: "all" },
        { id: "instrumental", type: "boolean", appliesTo: "all" },
        { id: "duration", type: "number", appliesTo: "cat:duration", default: null },
      ],
    },
    audioFields: () => { throw new Error("audioFields must not run on catalog miss"); },
  };
  vm.createContext(ctx);
  vm.runInContext(
    extractFn(IDX, "assertGenerateSongLyrics") + "\n" + extractFn(IDX, "collectAudioParams"),
    ctx,
  );
  const wired = ctx.collectAudioParams({
    type: "music",
    fields: { model: SONG, prompt: "upbeat pop", lyrics: "[Verse]\nfrom a lyrics wire" },
  });
  if (wired.lyrics !== "[Verse]\nfrom a lyrics wire")
    fail(`editor catalog miss must still forward lyrics, got ${JSON.stringify(wired)}`);
  else ok("editor collectAudioParams: catalog miss still forwards lyrics");

  let threw = null;
  try { ctx.collectAudioParams({ type: "music", fields: { model: SONG, prompt: "upbeat pop" } }); }
  catch (e) { threw = e; }
  if (!threw || !/needs Lyrics/.test(threw.message))
    fail("editor catalog miss: generate-song without lyrics must still preflight");
  else ok("editor collectAudioParams: catalog miss still prefights empty lyrics");

  const bgmMiss = ctx.collectAudioParams({ type: "music", fields: { model: BGM, prompt: "lofi" } });
  if ("lyrics" in bgmMiss) fail("editor catalog miss: BGM must omit empty lyrics");
  else ok("editor collectAudioParams: catalog miss BGM still omits empty lyrics");
}

/* ---- play runGraph (built-in send path) ---------------------------------- */

const app = loadEngine();

async function runMusic(fields) {
  calls.length = 0;
  const statuses = [];
  const g = app.materialize({ nodes: [node("m1", "music", fields)], links: [] });
  await app.runGraph(g, { onStatus: (id, kind, msg) => statuses.push({ id, kind, msg }) });
  return { statuses, posts: audioPosts() };
}

{
  const { statuses, posts } = await runMusic({ model: SONG, prompt: "upbeat pop" });
  if (posts.length) fail(`generate-song with no lyrics POSTed ${posts.length} time(s): ${JSON.stringify(posts[0]?.body)}`);
  else ok("play: generate-song with no lyrics never POSTs");
  const err = statuses.find((s) => s.kind === "error");
  if (!err) fail("play: generate-song with no lyrics must surface a node error");
  else if (!/needs Lyrics/.test(err.msg) || !/Generate BGM/.test(err.msg))
    fail(`play: node error unhelpful: ${JSON.stringify(err.msg)}`);
  else ok("play: generate-song with no lyrics shows the real requirement");
}

{
  const { statuses, posts } = await runMusic({ model: SONG, prompt: "upbeat pop", lyrics: "" });
  if (posts.length) fail("play: empty-string lyrics still POSTed");
  else if (!statuses.some((s) => s.kind === "error" && /needs Lyrics/.test(s.msg)))
    fail("play: empty-string lyrics must error locally");
  else ok("play: empty-string lyrics never POST");
}

{
  const { posts } = await runMusic({ model: BGM, prompt: "lofi rain on a window" });
  if (posts.length !== 1) fail(`generate-bgm should POST once, got ${posts.length}`);
  else if (posts[0].body.prompt !== "lofi rain on a window")
    fail(`generate-bgm must send prompt (not input): ${JSON.stringify(posts[0].body)}`);
  else if ("input" in posts[0].body)
    fail(`generate-bgm must omit input, got ${JSON.stringify(posts[0].body)}`);
  else if ("lyrics" in posts[0].body)
    fail(`generate-bgm must omit empty lyrics, got ${JSON.stringify(posts[0].body)}`);
  else ok("play: generate-bgm POSTs prompt (not input)");
}

{
  const { posts } = await runMusic({
    model: SONG,
    prompt: "warm acoustic pop",
    lyrics: "[Verse]\nMorning light across the road",
  });
  if (posts.length !== 1) fail(`generate-song + lyrics should POST once, got ${posts.length}`);
  else if (posts[0].body.lyrics !== "[Verse]\nMorning light across the road")
    fail(`generate-song lyrics not forwarded: ${JSON.stringify(posts[0].body.lyrics)}`);
  else if (posts[0].body.model !== SONG)
    fail(`generate-song model not forwarded: ${JSON.stringify(posts[0].body.model)}`);
  else ok("play: generate-song with lyrics forwards lyrics");
}

{
  const { posts } = await runMusic({
    model: SONG,
    prompt: "via extra",
    extraJson: JSON.stringify({ lyrics: "extra hatch" }),
  });
  if (posts.length !== 1 || posts[0].body.lyrics !== "extra hatch")
    fail(`extraJson lyrics must POST, got ${JSON.stringify(posts[0]?.body)}`);
  else ok("play: generate-song extraJson lyrics forward");
}

{
  const { posts } = await runMusic({ model: "music3shape", prompt: "lofi instrumental beat", instrumental: true });
  if (posts.length !== 1) fail("Music 3 instrumental should still POST");
  else if ("lyrics" in posts[0].body)
    fail(`Music 3 instrumental must omit empty lyrics, got ${JSON.stringify(posts[0].body)}`);
  else if (posts[0].body.instrumental !== true)
    fail(`Music 3 instrumental:true must forward, got ${JSON.stringify(posts[0].body.instrumental)}`);
  else ok("play: Music 3 instrumental still POSTs prompt-only");
}

{
  const { posts } = await runMusic({ model: PTS, prompt: "a song about rain" });
  if (posts.length !== 1) fail("Prompt-to-Song should POST without lyrics");
  else if ("lyrics" in posts[0].body)
    fail("Prompt-to-Song must omit empty lyrics");
  else ok("play: Prompt-to-Song POSTs prompt-only");
}

/* ---- Sing-style wired lyrics port (textarea empty) ----------------------- */

async function runWiredSong(engine, njs = false) {
  calls.length = 0;
  const statuses = [];
  const g = engine.materialize({
    nodes: [
      node("t1", "text", { text: "[Verse]\nWired morning light\n[Chorus]\nSing it" }),
      node("m1", "music", { model: SONG, prompt: "warm acoustic pop" }), // lyrics field intentionally empty
    ],
    links: [{ id: "l1", from: { node: "t1", port: "text" }, to: { node: "m1", port: "lyrics" } }],
  });
  await engine.runGraph(g, { onStatus: (id, kind, msg) => statuses.push({ id, kind, msg }) });
  return { statuses, posts: audioPosts(), g };
}

{
  const { statuses, posts } = await runWiredSong(app);
  if (posts.length !== 1)
    fail(`play wired lyrics: expected 1 POST, got ${posts.length}; statuses=${JSON.stringify(statuses)}`);
  else if (posts[0].body.lyrics !== "[Verse]\nWired morning light\n[Chorus]\nSing it")
    fail(`play wired lyrics not on POST: ${JSON.stringify(posts[0].body)}`);
  else if (posts[0].body.model !== SONG)
    fail(`play wired lyrics wrong model: ${JSON.stringify(posts[0].body.model)}`);
  else ok("play: wired lyrics port appears on the generate-song POST");
}

{
  // Example-flow model swap: load a MiniMax Music 3 / BGM-shaped node (prompt filled,
  // lyrics empty, instrumental:false, response_format:mp3) and only change model →
  // …/generate-song. Preflight must fire for that existing node — not only a blank Music node.
  const { statuses, posts } = await runMusic({
    model: SONG,
    prompt: "warm acoustic pop, intimate lead vocal",
    lyrics: "",
    instrumental: false,
    response_format: "mp3",
  });
  if (posts.length)
    fail(`play: MiniMax-shaped example swapped to generate-song POSTed: ${JSON.stringify(posts[0]?.body)}`);
  else if (!statuses.some((s) => s.kind === "error" && /needs Lyrics/.test(s.msg) && /Generate BGM/.test(s.msg)))
    fail(`play: example-swap generate-song must preflight with a clear error, got ${JSON.stringify(statuses)}`);
  else ok("play: example MiniMax fields + model swapped to generate-song never POSTs");

  // Same leftover fields, but Generate BGM — empty lyrics must still POST prompt-only.
  const bgmSwap = await runMusic({
    model: BGM,
    prompt: "warm acoustic pop, intimate lead vocal",
    lyrics: "",
    instrumental: false,
    response_format: "mp3",
  });
  if (bgmSwap.posts.length !== 1)
    fail(`play: example fields swapped to generate-bgm should POST once, got ${bgmSwap.posts.length}`);
  else if ("lyrics" in bgmSwap.posts[0].body)
    fail(`play: generate-bgm after example swap must omit empty lyrics, got ${JSON.stringify(bgmSwap.posts[0].body)}`);
  else ok("play: example MiniMax fields + model swapped to generate-bgm still POSTs prompt-only");
}

/* ---- njs send path ------------------------------------------------------- */

if (existsSync(VENDOR)) {
  const w = {};
  new Function("window", readFileSync(VENDOR, "utf8"))(w);
  let captured;
  const njsApp = loadEngine((ctx) => {
    captured = ctx;
    ctx.URLSearchParams = URLSearchParams;
    ctx.localStorage = ctx.sessionStorage = {
      getItem: (k) => (k === "ngpt_key" ? "test-api-key" : k === "njs_engine" ? "1" : null),
      setItem() {}, removeItem() {},
    };
  });
  captured.NanoodleEngine = w.NanoodleEngine;

  calls.length = 0;
  const statuses = [];
  const g = njsApp.materialize({ nodes: [node("m1", "music", { model: SONG, prompt: "upbeat pop" })], links: [] });
  await njsApp.runGraph(g, { onStatus: (id, kind, msg) => statuses.push({ id, kind, msg }) });
  const posts = audioPosts();
  if (posts.length) fail(`njs: generate-song with no lyrics POSTed: ${JSON.stringify(posts[0]?.body)}`);
  else if (!statuses.some((s) => s.kind === "error" && /needs Lyrics/.test(s.msg)))
    fail(`njs: generate-song with no lyrics must error locally, got ${JSON.stringify(statuses)}`);
  else ok("njs: generate-song with no lyrics never POSTs");

  calls.length = 0;
  const gBgm = njsApp.materialize({ nodes: [node("m1", "music", { model: BGM, prompt: "lofi rain" })], links: [] });
  await njsApp.runGraph(gBgm, {});
  const bgmPosts = audioPosts();
  if (bgmPosts.length !== 1) fail(`njs: generate-bgm should POST once, got ${bgmPosts.length}`);
  else if (bgmPosts[0].body.prompt !== "lofi rain")
    fail(`njs: generate-bgm must send prompt (not input): ${JSON.stringify(bgmPosts[0].body)}`);
  else if ("input" in bgmPosts[0].body)
    fail(`njs: generate-bgm must omit input, got ${JSON.stringify(bgmPosts[0].body)}`);
  else if ("lyrics" in bgmPosts[0].body)
    fail(`njs: generate-bgm must omit empty lyrics, got ${JSON.stringify(bgmPosts[0].body)}`);
  else ok("njs: generate-bgm POSTs prompt (not input)");

  calls.length = 0;
  const gSong = njsApp.materialize({
    nodes: [node("m1", "music", { model: SONG, prompt: "pop", lyrics: "la la" })],
    links: [],
  });
  await njsApp.runGraph(gSong, {});
  const songPosts = audioPosts();
  if (songPosts.length !== 1 || songPosts[0].body.lyrics !== "la la")
    fail(`njs: generate-song + lyrics must POST lyrics, got ${JSON.stringify(songPosts[0]?.body)}`);
  else ok("njs: generate-song with lyrics forwards lyrics");

  const wired = await runWiredSong(njsApp, true);
  if (wired.posts.length !== 1)
    fail(`njs wired lyrics: expected 1 POST, got ${wired.posts.length}; statuses=${JSON.stringify(wired.statuses)}`);
  else if (wired.posts[0].body.lyrics !== "[Verse]\nWired morning light\n[Chorus]\nSing it")
    fail(`njs wired lyrics not on POST: ${JSON.stringify(wired.posts[0].body)}`);
  else ok("njs: wired lyrics port appears on the generate-song POST");
} else {
  console.log("⊘ skip njs send-path cases: vendor/njs-engine.js missing");
}

/* ---- friendlyRunError (editor) ------------------------------------------- */

{
  const start = IDX.indexOf("function friendlyRunError(");
  const fn = braceMatch(IDX, start);
  const ctx = {
    t: (s) => s,
    isPromptTooLong: () => false,
    promptCapFromError: () => null,
    learnPromptCap: () => false,
    refreshPromptCaps: () => {},
    modelLabel: () => "model",
    NODE_TYPES: {},
  };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx);
  const lyric = ctx.friendlyRunError(new Error("400: " + API_400));
  if (/may have changed/.test(lyric))
    fail("friendlyRunError suffixed a lyrics/invalid_request 400: " + JSON.stringify(lyric));
  else ok("friendlyRunError keeps the lyrics 400 sentence");
  const model = ctx.friendlyRunError(new Error("400: Invalid value for parameter 'model'"));
  if (!/may have changed on NanoGPT/.test(model))
    fail("friendlyRunError dropped the model-changed suffix for a real model 4xx: " + JSON.stringify(model));
  else ok("friendlyRunError still suffixes a genuine model-id 4xx");
}

if (failed) {
  console.error(`\n${failed} mureka-lyrics check(s) failed`);
  process.exit(1);
}
console.log("\n✓ mureka-lyrics: generate-song preflight + API 400 message + BGM prompt key (not input)");
