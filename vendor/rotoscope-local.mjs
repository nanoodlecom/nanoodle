// Browser-only media for the editor and app player.
const MAX_BYTES = 64 * 1024 * 1024;
const localSignal = signal => AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120000)]);

async function mediaBytes(source, signal, decodeData) {
  signal.throwIfAborted();
  const url = new URL(source, document.baseURI);
  if (url.protocol === "data:") {
    if (source.length > MAX_BYTES * 3 + 256) throw new Error("Media exceeds 64 MiB");
    if (!decodeData) throw new Error("Could not start the local media engine");
    const { bytes } = decodeData(source);
    if (bytes.byteLength > MAX_BYTES) throw new Error("Media exceeds 64 MiB");
    return bytes;
  }
  if (!["blob:", "http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Expected a local file or an HTTP(S) media URL");
  }
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok || !response.body) throw new Error("Could not read the media file");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Media exceeds 64 MiB");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function abortable(promise, signal) {
  signal.throwIfAborted();
  let stop;
  const cancelled = new Promise((_, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
  });
  return Promise.race([promise, cancelled]).finally(() => signal.removeEventListener("abort", stop));
}

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const number = (value, fallback) => Number.isFinite(parseFloat(value)) ? parseFloat(value) : fallback;
const nameOrIndex = value => /^-?\d+$/.test(String(value).trim()) ? Number(value) : value;
const checked = value => value === true || value === "true";

async function openSceneFrame(signal) {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.title = "Local 3D renderer";
  const loaded = new Promise(resolve => frame.addEventListener("load", resolve, { once: true }));
  frame.src = new URL("./rotoscope-render3d/scene.html", import.meta.url).href;
  document.body.append(frame);
  try {
    await abortable(loaded, signal);
    const scene = frame.contentWindow.__render3d;
    const canvas = frame.contentDocument?.querySelector("canvas");
    if (!scene?.load || !canvas) throw new Error("Could not start the local Render 3D scene");
    return { scene, canvas, dispose: () => frame.remove() };
  } catch (error) {
    frame.remove();
    throw error;
  }
}

function muxAvc(samples, width, height, fps, description, writer) {
  const { box, fullbox, u16, u32, writeMp4 } = writer;
  const avc1 = box("avc1", new Uint8Array(6), u16(1), new Uint8Array(16),
    u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0),
    u16(1), new Uint8Array(32), u16(24), u16(0xffff), box("avcC", description));
  return writeMp4(samples.map(s=>s.bytes), [{ kind:"video", width, height, timescale:fps,
    stsdRaw:fullbox("stsd",0,0,u32(1),avc1),
    samples:samples.map((s,i)=>({ bufIdx:i,offset:0,size:s.bytes.length,dur:1,cts:0,sync:s.sync })) }]);
}

export async function render3d(source, fields, { decodeData, signal: outerSignal, mp4Writer, progress, createScene }) {
  if (!source) throw new Error("Connect a 3D model first");
  const signal = localSignal(outerSignal);
  const width = Math.max(16, Math.round(number(fields.width, 800)));
  const height = Math.max(16, Math.round(number(fields.height, 600)));
  if (width > 2048 || height > 2048) throw new Error("Render 3D dimensions must be 16–2048 pixels");
  const video = fields.mode === "video";
  const fps = Math.round(number(fields.fps, 24));
  const seconds = number(fields.duration, 2);
  const requestedFrames = fps * seconds;
  const count = Math.round(requestedFrames);
  if (video && (fps < 1 || fps > 60 || seconds < 0.1 || seconds > 10 || count > 240 ||
    width * height * count > 200000000 || width % 2 || height % 2)) {
    throw new Error("Render 3D video needs even dimensions, 1–60 fps, 0.1–10 seconds and at most 240 frames or 200 million pixels");
  }
  if (video && requestedFrames < 1) {
    throw new Error("Render 3D video duration must be at least one frame at the selected fps");
  }
  const model = await mediaBytes(source, signal, decodeData);
  let view;
  if (createScene) {
    // The app already runs at an isolated origin. A nested iframe would have
    // a different opaque origin, making its canvas unreadable to this app.
    const canvas = document.createElement("canvas");
    const scene = createScene(canvas);
    view = { scene, canvas, dispose: () => scene.dispose() };
  } else {
    view = await openSceneFrame(signal);
  }
  const {scene, canvas} = view;
  try {
    await abortable(scene.load(model), signal);
    const base = {
      width, height,
      background: fields.background || "dark",
      azimuth: number(fields.azimuth, 35), elevation: number(fields.elevation, 18), distance: number(fields.distance, 1.9),
      isolate: nameOrIndex(fields.isolate), explode: number(fields.explode, 0),
      clipAxis: fields.clipAxis, clipPos: number(fields.clipPos, 0),
      animClip: nameOrIndex(fields.animClip), animTime: number(fields.animTime, 0),
    };
    if (!video) {
      scene.apply(base);
      return { image: canvas.toDataURL("image/png") };
    }
    if (!globalThis.VideoEncoder || !globalThis.VideoFrame) throw new Error("This browser cannot encode Render 3D MP4 video");
    const prefs = { codec: "avc1.42E034", width, height, framerate: fps, bitrate: Math.max(200000, width * height * fps / 8),
      hardwareAcceleration: "prefer-software", latencyMode: "realtime", avc: { format: "avc" } };
    if (!(await VideoEncoder.isConfigSupported(prefs)).supported) throw new Error("This browser cannot encode H.264 at these settings");
    const samples = [];
    let description, codecError;
    const encoder = new VideoEncoder({
      output(chunk, metadata) {
        if (metadata?.decoderConfig?.description) description = new Uint8Array(metadata.decoderConfig.description);
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        samples.push({ bytes, timestamp: chunk.timestamp, sync: chunk.type === "key" });
      },
      error(error) { codecError = error; },
    });
    try {
      encoder.configure(prefs);
      const turntable = number(fields.turntable, 360);
      for (let i = 0; i < count; i++) {
        signal.throwIfAborted();
        if (codecError) throw codecError;
        const t = count === 1 ? 0 : i / (count - 1);
        scene.apply({ ...base,
          azimuth: base.azimuth + turntable * t,
          ...(base.animClip != null && base.animClip !== "" ? { animTime: seconds * t } : {}),
          ...(checked(fields.clipSweep) ? { clipPos: 1.05 - 2.1 * t } : {}),
        });
        const timestamp = Math.round(i * 1e6 / fps);
        const image = new VideoFrame(canvas, { timestamp, duration: Math.round((i + 1) * 1e6 / fps) - timestamp });
        try { encoder.encode(image, { keyFrame: i % fps === 0 }); }
        finally { image.close(); }
        if (encoder.encodeQueueSize >= 4 || (i + 1) % 8 === 0) {
          await abortable(encoder.flush(), signal);
          progress("Rendering frame " + (i + 1) + "/" + count + "…");
        }
      }
      await abortable(encoder.flush(), signal);
      if (codecError) throw codecError;
      if (!description || samples.length !== count ||
        samples.some((sample, i) => sample.timestamp !== Math.round(i * 1e6 / fps))) {
        throw new Error("Render 3D encoder did not return every frame in order");
      }
      const mp4 = new Blob([muxAvc(samples, width, height, fps, description, mp4Writer)], { type: "video/mp4" });
      return { video: await abortable(dataUrl(mp4), signal) };
    } finally {
      if (encoder.state !== "closed") encoder.close();
    }
  } finally {
    view.dispose();
  }
}

function rangeValue(value, label) {
  if (value == null || value === "") return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error(label + " must be a non-negative time in seconds");
  return seconds;
}

export async function indexedFrames(source, fields, { decodeData, parseMp4, count, signal: outerSignal, progress }) {
  const signal = localSignal(outerSignal);
  const start = rangeValue(fields.startSec, "Range start") ?? 0;
  const end = rangeValue(fields.endSec, "Range end") ?? Infinity;
  const stride = fields.stride == null || fields.stride === "" ? undefined : Number(fields.stride);
  const gap = Math.max(0, number(fields.gap, 0.5));
  if (stride !== undefined && (!Number.isSafeInteger(stride) || stride < 1)) throw new Error("Frame stride must be a positive integer");
  if (end < start) throw new Error("Range end must be at or after range start");
  if (!globalThis.VideoDecoder) throw new Error("Exact frame extraction requires browser video decoding support");
  const bytes = await mediaBytes(source, signal, decodeData);
  let track;
  try { track = parseMp4(bytes, true).tracks.find(track => track.kind === "video"); }
  catch (error) { throw new Error("Exact frame extraction needs a supported MP4: " + error.message); }
  const cfg = track?.codecCfg;
  if (!cfg || !track.timescale || !track.samples.length || cfg.length < 15 ||
    String.fromCharCode(...cfg.subarray(4, 8)) !== "avcC") {
    throw new Error("Exact frame extraction needs an H.264 MP4");
  }
  const codec = "avc1." + [...cfg.subarray(9, 12)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  let dts = 0;
  const decodeOrder = track.samples.map((sample, index) => {
    const pts = dts + sample.cts;
    dts += sample.dur;
    return { ...sample, pts, index };
  });
  const display = [...decodeOrder].sort((a, b) => a.pts - b.pts || a.index - b.index);
  const timestamp = pts => Math.round((pts - display[0].pts) * 1e6 / track.timescale);
  for (let i = 1; i < display.length; i++) {
    if (timestamp(display[i - 1].pts) === timestamp(display[i].pts)) throw new Error("Video has duplicate presentation timestamps");
  }
  const visible = display.filter(sample => sample.pts >= track.editStart && sample.pts < track.editEnd);
  const origin = visible[0]?.pts;
  const inRange = visible.filter(sample => {
    const seconds = (sample.pts - origin) / track.timescale;
    return seconds + 1e-9 >= start && seconds <= end + 1e-9;
  });
  if (!inRange.length) throw new Error("No video frames in the requested range");
  if ((fields.dir || "end") === "end") inRange.reverse();
  const chosen = [];
  for (const [offset, sample] of inRange.entries()) {
    if (stride ? offset % stride !== 0 : chosen.length && Math.abs(sample.pts - chosen.at(-1).pts) / track.timescale + 1e-9 < gap) continue;
    chosen.push(sample);
    if (chosen.length === count) break;
  }

  const config = { codec, description: cfg.subarray(8), hardwareAcceleration: "prefer-software" };
  if (!(await VideoDecoder.isConfigSupported(config)).supported) throw new Error("This browser cannot decode the selected H.264 video");
  const wanted = new Map(chosen.map((sample, i) => [timestamp(sample.pts), i]));
  const low = Math.min(...chosen.map(sample => sample.index));
  const high = Math.max(...chosen.map(sample => sample.index));
  let key = low;
  while (key > 0 && !decodeOrder[key].sync) key--;
  if (!decodeOrder[key].sync) throw new Error("Video has no usable keyframe");
  const result = new Array(chosen.length);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  let codecError, outputSize = 0;
  const decoder = new VideoDecoder({
    output(frame) {
      try {
        const i = wanted.get(frame.timestamp);
        if (i === undefined || signal.aborted || codecError) return;
        if (frame.displayWidth * frame.displayHeight > 16777216) throw new Error("Video frame exceeds 16 million pixels");
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
        ctx.drawImage(frame, 0, 0);
        const jpeg = canvas.toDataURL("image/jpeg", 0.9);
        outputSize += jpeg.length;
        if (outputSize > MAX_BYTES) throw new Error("Selected frame images exceed 64 MiB");
        result[i] = jpeg;
        wanted.delete(frame.timestamp);
      } catch (error) { codecError = error; }
      finally { frame.close(); }
    },
    error(error) { codecError = error; },
  });
  try {
    decoder.configure(config);
    progress("Extracting " + chosen.length + " source frames…");
    for (let i = key; i <= high; i++) {
      signal.throwIfAborted();
      if (codecError) throw codecError;
      const s = decodeOrder[i];
      if (s.size <= 0 || s.offset < 0 || s.offset + s.size > bytes.length) throw new Error("MP4 sample is outside the file");
      decoder.decode(new EncodedVideoChunk({ type: s.sync ? "key" : "delta", timestamp: timestamp(s.pts),
        data: bytes.subarray(s.offset, s.offset + s.size) }));
      if (decoder.decodeQueueSize >= 16) {
        const progressed = new Promise(resolve => decoder.addEventListener("dequeue", resolve, { once: true }));
        await abortable(progressed, signal);
      }
    }
    await abortable(decoder.flush(), signal);
    if (codecError) throw codecError;
    if (wanted.size) throw new Error("Video decoder did not return every selected frame");
    return Object.fromEntries(result.map((image, i) => ["frame" + (i + 1), image]));
  } finally {
    if (decoder.state !== "closed") decoder.close();
  }
}
