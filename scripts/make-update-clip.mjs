#!/usr/bin/env node
// Build a narrated 📣 Updates clip: the PR's real-editor usage recording + a short
// voiceover (NanoGPT TTS), burned-in captions + WebVTT tracks, and the nanoodle logo
// fading in (intro) and out (outro). Loudness-normalized, faststart H.264/AAC.
//
//   NANOGPT_API_KEY=… node scripts/make-update-clip.mjs scripts/update-clips/decide-node.json \
//     [--source path/to/raw.webm] [--qa] [--attach] [--dry-run]
//
// Needs ffmpeg + ffprobe (libass) on PATH, and Playwright for the logo card
// (NANOODLE_PLAYWRIGHT=/path/to/playwright/index.mjs, same as smoke-first-run.mjs).
// Spec (scripts/update-clips/<name>.json):
//   { name, entry:"updates.json text prefix", source, ss?, to?, width?, fps?, crf?,
//     blur?:[{x,y,w,h}] (source px — the balance chip), extend?:"freeze"|"loop",
//     posterAt?: clip seconds, introTitle?, outroTitle?,
//     voice:{ model, voice, instructions?, speed? }, music?: { file, db? },
//     cues:[{ at: clip seconds, text:"English VO line", i18n?:{es,fr,de,pt,ja} }] }
// Writes updates-media/<name>.mp4 + .webp + .<lang>.vtt (en + every lang all cues
// translate to) and prints the updates.json `media` object (--attach writes it).
// TTS takes are cached by (model, voice, text), so re-renders cost nothing.
// --qa transcribes the finished audio (Whisper) and diffs it against the cues,
// prints loudness, and writes a 1-fps contact sheet to look at. --dry-run swaps
// TTS for silence of a plausible length (layout/timing only, no spend).
// Rules + VO guidance + QA checklist: CONTRIBUTING.md "Usage clips on Updates entries".
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, mkdtempSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const specPath = args.find((a, i) => !a.startsWith("--") && !(i > 0 && ["--source"].includes(args[i - 1])));
if (!specPath) { console.error("usage: make-update-clip.mjs <spec.json> [--source file] [--qa] [--attach] [--dry-run]"); process.exit(2); }
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const DRY = flag("--dry-run");
const KEY = process.env.NANOGPT_API_KEY;
if (!DRY && !KEY) { console.error("NANOGPT_API_KEY is not set (or pass --dry-run)"); process.exit(2); }
const API = "https://nano-gpt.com";
const LANGS = ["en", "es", "fr", "de", "pt", "ja"];

const W = spec.width || 960, FPS = spec.fps || 20, CRF = spec.crf || 24;
const INTRO = 1.6, OUTRO = 1.6, XF = 0.4, FADE = 0.8;          // card lengths, crossfade, logo fade
const LEAD = INTRO - XF;                                         // output time of clip t=0
const work = mkdtempSync(join(tmpdir(), "update-clip-"));
const cacheDir = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "nanoodle-update-clip");
mkdirSync(cacheDir, { recursive: true });
const sh = (cmd, a, o = {}) => execFileSync(cmd, a, { stdio: o.capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"], maxBuffer: 1 << 28 })?.toString();
const ff = (a) => sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a]);
const probe = (f, entries) => execFileSync("ffprobe", ["-v", "error", "-show_entries", entries, "-of", "csv=p=0", f]).toString().trim();
const dur = (f) => parseFloat(probe(f, "format=duration"));
const r3 = (x) => Math.round(x * 1000) / 1000;
const log = (...m) => console.log("·", ...m);

// ---------- 1) the clip itself: trim, blur private bits, scale, fps ----------
const source = resolve(opt("--source") || join(ROOT, spec.source));
const base = join(work, "base.mp4");
{
  const vf = [];
  let chain = "[0:v]";
  if (spec.blur && spec.blur.length) {
    // each box: crop → heavy blur → overlay back in place (source pixels, before scaling)
    const n = spec.blur.length;
    vf.push(`${chain}split=${n + 1}[bb0]${spec.blur.map((_, i) => `[bs${i}]`).join("")}`);
    spec.blur.forEach((b, i) => vf.push(`[bs${i}]crop=${b.w}:${b.h}:${b.x}:${b.y},boxblur=10:3[bl${i}]`));
    spec.blur.forEach((b, i) => vf.push(`[bb${i}][bl${i}]overlay=${b.x}:${b.y}[bb${i + 1}]`));
    chain = `[bb${n}]`;
  }
  vf.push(`${chain}fps=${FPS},scale=${W}:-2:flags=lanczos,format=yuv420p,setsar=1[v]`);
  const a = [];
  if (spec.ss) a.push("-ss", String(spec.ss));
  if (spec.to) a.push("-to", String(spec.to));
  ff([...a, "-i", source, "-an", "-filter_complex", vf.join(";"), "-map", "[v]", "-c:v", "libx264", "-crf", "14", "-preset", "fast", base]);
}
const [, H] = probe(base, "stream=width,height").split(",").map(Number);
let C = dur(base);
log(`clip ${W}x${H} @${FPS}fps, ${C.toFixed(2)}s from ${source.replace(ROOT + "/", "")}`);

// ---------- 2) voiceover takes (cached) ----------
async function tts(text) {
  const v = spec.voice;
  const key = createHash("sha256").update(JSON.stringify([v.model, v.voice, v.instructions || "", v.speed || 1, text])).digest("hex").slice(0, 20);
  const raw = join(cacheDir, key + ".mp3");
  if (DRY) {
    const s = Math.max(1.2, text.length / 15);
    ff(["-f", "lavfi", "-i", `sine=frequency=220:sample_rate=48000`, "-af", "volume=-20dB", "-ac", "1", "-t", String(s), join(work, key + ".wav")]);   // a quiet tone so loudnorm has something to measure
    return { file: join(work, key + ".wav"), chars: 0 };
  }
  let chars = 0;
  if (!existsSync(raw)) {
    const body = { model: v.model, voice: v.voice, input: text, response_format: "mp3" };
    if (v.instructions) body.instructions = v.instructions;
    if (v.speed) body.speed = v.speed;
    const r = await fetch(`${API}/api/v1/audio/speech`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`TTS HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    let buf;
    if ((r.headers.get("content-type") || "").includes("json")) {
      const j = await r.json(); const url = j.audioUrl || j.url || (j.data && j.data[0] && j.data[0].url);
      if (!url) throw new Error("TTS returned JSON without an audio url");
      buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    } else buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(raw, buf); chars = text.length;
  }
  // trim leading/trailing silence so cue times mean "first word"
  const out = join(work, key + ".wav");
  ff(["-i", raw, "-af", "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.08,areverse,aresample=48000", "-ac", "1", out]);
  return { file: out, chars };
}
const takes = [];
let spentChars = 0;
for (const c of spec.cues) { const t = await tts(c.text); takes.push({ ...c, ...t, d: dur(t.file) }); spentChars += t.chars; }

// ---------- 3) timing: lines must not overlap; extend the clip if the VO runs past it ----------
takes.forEach((t, i) => {
  const next = takes[i + 1];
  if (next && t.at + t.d + 0.25 > next.at) throw new Error(`cue ${i + 1} ("${t.text.slice(0, 40)}…") runs ${(t.at + t.d + 0.25 - next.at).toFixed(2)}s into cue ${i + 2} — shorten it or move cue ${i + 2} later`);
});
const needEnd = Math.max(...takes.map((t) => t.at + t.d)) + 0.9;
if (needEnd > C) {
  const ext = join(work, "ext.mp4");
  if (spec.extend === "loop") ff(["-stream_loop", String(Math.ceil(needEnd / C)), "-i", base, "-t", needEnd.toFixed(3), "-c:v", "libx264", "-crf", "14", "-preset", "fast", ext]);
  else ff(["-i", base, "-vf", `tpad=stop_mode=clone:stop_duration=${(needEnd - C).toFixed(3)}`, "-c:v", "libx264", "-crf", "14", "-preset", "fast", ext]);
  log(`VO ends at ${needEnd.toFixed(2)}s > clip ${C.toFixed(2)}s → ${spec.extend === "loop" ? "looped" : "held last frame"}`);
  copyFileSync(ext, base); C = dur(base);
}
const T = INTRO + C + OUTRO - 2 * XF;

// ---------- 4) logo cards (real icon + Righteous wordmark, rendered by Chrome) ----------
async function cards() {
  const mod = process.env.NANOODLE_PLAYWRIGHT;
  const { chromium } = await import(mod ? pathToFileURL(resolve(mod)).href : "playwright");
  const b64 = (p) => readFileSync(join(ROOT, p)).toString("base64");
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const html = (title) => `<!doctype html><html><head><style>
    @font-face{font-family:R;src:url(data:font/woff2;base64,${b64("vendor/righteous/righteous-latin.woff2")}) format("woff2")}
    html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
    body{background:radial-gradient(${W * 0.9}px ${H * 0.7}px at 50% 42%,#1a1f3a,#0b0d12 70%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${H * 0.03}px;font-family:Inter,system-ui,sans-serif}
    .lock{display:flex;align-items:center;gap:${H * 0.03}px}
    img{width:${H * 0.15}px;height:${H * 0.15}px;border-radius:22%;filter:drop-shadow(0 0 ${H * 0.04}px #7c8cff66)}
    .w{font-family:R;font-size:${H * 0.12}px;color:#eef1f7;letter-spacing:.01em}
    .w b{font-weight:400;background:linear-gradient(90deg,#67e8f9,#7c8cff 70%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 ${H * 0.02}px #7c8cff77)}
    .t{color:#9aa3b2;font-size:${H * 0.042}px;font-weight:500;letter-spacing:.01em;min-height:1.2em}
  </style></head><body><div class="lock"><img src="data:image/png;base64,${b64("icon-512.png")}"><div class="w"><b>nano</b>odle</div></div><div class="t">${esc(title)}</div></body></html>`;
  const exe = process.env.NANOODLE_CHROMIUM;   // same knob as smoke-first-run.mjs
  const br = await chromium.launch(exe ? { executablePath: exe } : {}).catch(() => chromium.launch({ channel: "chrome" }));
  const pg = await br.newPage({ viewport: { width: W, height: H } });
  for (const [f, title] of [["intro.png", spec.introTitle], ["outro.png", spec.outroTitle ?? "nanoodle.com"]]) {
    await pg.setContent(html(title)); await pg.evaluate(() => document.fonts.ready);
    await pg.screenshot({ path: join(work, f) });
  }
  await br.close();
}
await cards();

// ---------- 5) captions: ASS (burned, English) + WebVTT per language ----------
// Long lines split at clause breaks, timed by character share of the take.
function chunks(text, start, d) {
  const parts = text.length <= 84 ? [text] : text.split(/(?<=[.!?;—,])\s+/).reduce((acc, p) => {
    if (acc.length && (acc[acc.length - 1] + " " + p).length <= 84) acc[acc.length - 1] += " " + p; else acc.push(p); return acc; }, []);
  const total = parts.reduce((s, p) => s + p.length, 0); let t = start;
  return parts.map((p) => { const len = d * p.length / total; const c = { s: t, e: t + len, text: p }; t += len; return c; });
}
const ts = (x, sep) => { const h = Math.floor(x / 3600), m = Math.floor(x / 60) % 60, s = x % 60;
  return sep === "." ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}` : `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`; };
const enCues = takes.flatMap((t) => chunks(t.text, LEAD + t.at, t.d + 0.35));
const fs = Math.round(H * 0.042);
const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Inter,${fs},&H00FFFFFF,&H00FFFFFF,&H2A0B0D12,&H00000000,0,0,0,0,100,100,0.2,0,3,${Math.round(fs * 0.38)},0,2,${Math.round(W * 0.1)},${Math.round(W * 0.1)},${Math.round(H * 0.07)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${enCues.map((c) => `Dialogue: 0,${ts(c.s)},${ts(c.e)},Cap,,0,0,0,,{\\fad(140,160)}${c.text.replace(/\n/g, " ")}`).join("\n")}
`;
writeFileSync(join(work, "subs.ass"), ass);
const outDir = join(ROOT, "updates-media");
const vtts = {};
for (const lang of LANGS) {
  const lines = lang === "en" ? takes.map((t) => t.text) : takes.map((t) => t.i18n && t.i18n[lang]);
  if (lines.some((l) => !l)) continue;
  // non-English tracks sit at the top: the burned-in English line owns the bottom
  const setting = lang === "en" ? "" : " line:5% size:86% align:center";
  const cues = takes.flatMap((t, i) => chunks(lines[i], LEAD + t.at, t.d + 0.35));
  const body = "WEBVTT\n\n" + cues.map((c, i) => `${i + 1}\n${ts(c.s, ".")} --> ${ts(c.e, ".")}${setting}\n${c.text}\n`).join("\n");
  const f = `updates-media/${spec.name}.${lang}.vtt`;
  writeFileSync(join(ROOT, f), body); vtts[lang] = f;
}

// ---------- 6) audio: place takes, optional ducked music bed, 2-pass loudnorm ----------
const mix = join(work, "vo.wav");
{
  const ins = takes.flatMap((t) => ["-i", t.file]);
  const parts = takes.map((t, i) => `[${i}:a]adelay=${Math.round((LEAD + t.at) * 1000)}:all=1[a${i}]`);
  let graph = `${parts.join(";")};${takes.map((_, i) => `[a${i}]`).join("")}amix=inputs=${takes.length}:normalize=0,apad,atrim=0:${T.toFixed(3)}[vo]`;
  let map = "[vo]";
  if (spec.music && spec.music.file) {
    ins.push("-stream_loop", "-1", "-i", resolve(ROOT, spec.music.file));
    const m = takes.length;
    graph += `;[${m}:a]aresample=48000,pan=mono|c0=0.5*c0+0.5*c1,volume=${spec.music.db ?? -26}dB,atrim=0:${T.toFixed(3)},afade=t=in:d=${FADE},afade=t=out:st=${(T - 1.2).toFixed(3)}:d=1.2[mu];[vo]asplit[v1][v2];[mu][v2]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck];[v1][duck]amix=inputs=2:normalize=0[mx]`;
    map = "[mx]";
  }
  ff([...ins, "-filter_complex", graph, "-map", map, "-ar", "48000", "-ac", "1", mix]);
}
const norm = join(work, "vo-norm.wav");
{
  // pass 1 measures (loudnorm reports on stderr), pass 2 applies linearly — no pumping
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", mix, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" });
  const j = JSON.parse(r.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
  ff(["-i", mix, "-af", `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000`, "-ar", "48000", norm]);
}

// ---------- 7) compose: intro card ⟶ clip ⟶ outro card, captions burned, AAC ----------
const out = join(outDir, `${spec.name}.mp4`);
{
  const fsDir = "/usr/share/fonts";
  const g = [
    `[0:v]fps=${FPS},format=yuv420p,setsar=1,fade=t=in:st=0:d=${FADE},settb=AVTB[i]`,
    `[1:v]fps=${FPS},format=yuv420p,setsar=1,settb=AVTB[m]`,
    `[2:v]fps=${FPS},format=yuv420p,setsar=1,fade=t=out:st=${OUTRO - FADE}:d=${FADE},settb=AVTB[o]`,
    `[i][m]xfade=transition=fade:duration=${XF}:offset=${r3(INTRO - XF)}[im]`,
    `[im][o]xfade=transition=fade:duration=${XF}:offset=${r3(INTRO - XF + C - XF)}[v0]`,
    `[v0]subtitles=${join(work, "subs.ass")}:fontsdir=${fsDir}[v]`,
  ];
  ff(["-loop", "1", "-framerate", String(FPS), "-t", String(INTRO), "-i", join(work, "intro.png"),
      "-i", base,
      "-loop", "1", "-framerate", String(FPS), "-t", String(OUTRO), "-i", join(work, "outro.png"),
      "-i", norm,
      "-filter_complex", g.join(";"), "-map", "[v]", "-map", "3:a",
      "-c:v", "libx264", "-preset", "veryslow", "-crf", String(CRF), "-tune", "animation", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", spec.music ? "96k" : "72k", "-ac", "1", "-t", T.toFixed(3), "-movflags", "+faststart", out]);
}
const poster = join(outDir, `${spec.name}.webp`);
ff(["-ss", String(r3(LEAD + (spec.posterAt ?? Math.min(C * 0.75, C - 0.5)))), "-i", out, "-frames:v", "1", "-c:v", "libwebp", "-quality", "72", poster]);

const media = { src: `updates-media/${spec.name}.mp4`, poster: `updates-media/${spec.name}.webp`, w: W, h: H, audio: true, captions: vtts, burned: "en" };
const sizeKB = (f) => Math.round(statSync(f).size / 1024);
log(`wrote ${media.src} (${sizeKB(out)} KB, ${T.toFixed(2)}s), poster ${sizeKB(poster)} KB, captions ${Object.keys(vtts).join("/")}`);
takes.forEach((t, i) => log(`cue ${i + 1}: ${ts(LEAD + t.at, ".")}–${ts(LEAD + t.at + t.d, ".")}  "${t.text}"`));

// spend: priced from the live catalog (cached takes cost nothing)
if (!DRY && spentChars) {
  try {
    const cat = await (await fetch(`${API}/api/v1/audio-models`)).json();
    const m = (cat.data || cat).find((x) => x.id === spec.voice.model);
    const per = m && m.pricing && m.pricing.per_thousand_chars;
    log(`TTS spend: ${spentChars} chars${per ? ` ≈ $${(spentChars / 1000 * per).toFixed(4)}` : ""} (${spec.voice.model} · ${spec.voice.voice})`);
  } catch { log(`TTS spend: ${spentChars} chars`); }
} else log("TTS spend: $0 (all takes cached" + (DRY ? " / dry run" : "") + ")");

if (flag("--attach")) {
  const file = join(ROOT, "updates.json");
  const list = JSON.parse(readFileSync(file, "utf8"));
  const hits = list.filter((e) => e.text.startsWith(spec.entry));
  if (hits.length !== 1) { console.error(`--attach: ${hits.length} entries start with "${spec.entry}"`); process.exit(1); }
  hits[0].media = media;
  writeFileSync(file, JSON.stringify(list, null, 2) + "\n");
  log(`attached to updates.json entry "${spec.entry}…" — now run: node scripts/gen-changelog.mjs`);
} else console.log(JSON.stringify({ media }, null, 2));

// ---------- 8) QA: transcript vs script, loudness, contact sheet ----------
if (flag("--qa") && !DRY) {
  const wav = join(work, "qa.mp3");
  ff(["-i", out, "-vn", "-ac", "1", "-b:a", "64k", wav]);
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(wav)], { type: "audio/mpeg" }), "qa.mp3");
  fd.append("model", "Whisper-Large-V3"); fd.append("language", "en");
  const r = await fetch(`${API}/api/v1/audio/transcriptions`, { method: "POST", headers: { Authorization: "Bearer " + KEY }, body: fd });
  const heard = r.ok ? ((await r.json()).text || "") : `(transcription failed: HTTP ${r.status})`;
  const words = (s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
  const want = words(takes.map((t) => t.text).join(" ")), got = words(heard);
  const dp = Array.from({ length: want.length + 1 }, (_, i) => [i, ...Array(got.length).fill(0)]);
  for (let j = 1; j <= got.length; j++) dp[0][j] = j;
  for (let i = 1; i <= want.length; i++) for (let j = 1; j <= got.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (want[i - 1] === got[j - 1] ? 0 : 1));
  log(`QA heard: "${heard.trim()}"`);
  log(`QA word error rate vs script: ${(100 * dp[want.length][got.length] / want.length).toFixed(1)}%`);
  const rr = spawnSync("ffmpeg", ["-hide_banner", "-i", out, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const sum = rr.stderr.slice(rr.stderr.lastIndexOf("Summary:"));
  log(`QA loudness: I=${(sum.match(/I:\s+(-?[\d.]+) LUFS/) || [])[1]} LUFS, peak-ish LRA=${(sum.match(/LRA:\s+([\d.]+) LU/) || [])[1]} LU (target −16 LUFS)`);
  const sheet = join(tmpdir(), `${spec.name}-qa-sheet.png`);
  const cols = 6, rows = Math.ceil(T / cols);
  ff(["-i", out, "-vf", `fps=1,scale=${Math.round(W / 2.5)}:-2,drawtext=fontfile=/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz\\,wght.ttf:text='%{pts\\:hms}':x=6:y=6:fontsize=16:fontcolor=yellow:box=1:boxcolor=black@0.6,tile=${cols}x${rows}`, "-frames:v", "1", sheet]);
  log(`QA contact sheet (look at every frame): ${sheet}`);
}
