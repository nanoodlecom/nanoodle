/* data-hash=5ed8109f38068b8a */
/* nanoodle-js browser engine — generated from nanoodle-js@src-9996878def83 (15 modules) */
(function () {
  "use strict";
  var __mods = {};
  function __def(name, fn) { __mods[name] = { fn: fn, x: null }; }
  function __req(name) {
    var m = __mods[name];
    if (!m) throw new Error("njs-engine: missing module " + name);
    if (!m.x) { m.x = {}; m.fn(m.x, __req); }
    return m.x;
  }
__def("browser.mjs", function (__x, __req) {
/**
 * Browser-oriented package entry (`import … from "nanoodle/browser"`).
 *
 * Goal: one engine for play/export/CLI. No module on this surface top-level
 * imports Node builtins (Phase D): the pure local-media paths (MP4CAT remux,
 * PCM-WAV trim, PNG resize/mask composite) and share-link decoding run in a
 * browser as-is — zlib work goes through Compression/DecompressionStream
 * there. Only the ffmpeg fallback and file-path helpers dynamically import
 * Node builtins when those code paths actually run.
 * See docs/DESIGN.md § "Replacing the browser executor".
 *
 * Prefer `Workflow.fromJSON(obj, { apiKey, fetch, payment })` in the browser;
 * `Workflow.load(path)` and `mediaFromFile` remain Node-only (dynamic `node:fs`).
 */
{ const __m = __req("workflow.mjs"); __x.Workflow = __m.Workflow; __x.RunResult = __m.RunResult; }
{ const __m = __req("errors.mjs"); __x.NanoodleError = __m.NanoodleError; __x.UnsupportedNodeError = __m.UnsupportedNodeError; __x.RunError = __m.RunError; }
{ const __m = __req("media.mjs"); __x.MediaRef = __m.MediaRef; __x.MEDIA_INLINE_MAX = __m.MEDIA_INLINE_MAX; __x.coerceMediaInput = __m.coerceMediaInput; __x.assertInlineMediaSize = __m.assertInlineMediaSize; __x.bytesToDataUrl = __m.bytesToDataUrl; __x.dataUrlBytes = __m.dataUrlBytes; __x.bytesToBase64 = __m.bytesToBase64; __x.base64ToBytes = __m.base64ToBytes; __x.sniffMime = __m.sniffMime; __x.b64ImageMime = __m.b64ImageMime; __x.extForMime = __m.extForMime; }
{ const __m = __req("client.mjs"); __x.NanoClient = __m.NanoClient; __x.httpError = __m.httpError; __x.costFromJson = __m.costFromJson; __x.costFromHeaders = __m.costFromHeaders; __x.costWithHeaders = __m.costWithHeaders; __x.sleep = __m.sleep; }
{ const __m = __req("graph.mjs"); __x.NODE_TYPES = __m.NODE_TYPES; __x.displayName = __m.displayName; __x.materialize = __m.materialize; __x.topoSort = __m.topoSort; __x.wiredFramesFloor = __m.wiredFramesFloor; __x.MAX_FRAMES = __m.MAX_FRAMES; }
{ const __m = __req("nodes.mjs"); __x.RUNNERS = __m.RUNNERS; } // per-node executors — the play delegation shim drives these directly
{ const __m = __req("catalog.mjs"); __x.catItem = __m.catItem; __x.chatModelCan = __m.chatModelCan; }
{ const __m = __req("io.mjs"); __x.deriveInputs = __m.deriveInputs; __x.deriveOutputs = __m.deriveOutputs; __x.deriveSettings = __m.deriveSettings; __x.INPUT_SPECS = __m.INPUT_SPECS; __x.SETTING_SPECS = __m.SETTING_SPECS; }
{ const __m = __req("share.mjs"); __x.decodeShareUrl = __m.decodeShareUrl; __x.decodeShareFragment = __m.decodeShareFragment; __x.isShareRef = __m.isShareRef; }
{ const __m = __req("local-media.mjs"); __x.resizePlan = __m.resizePlan; __x.maskToSource = __m.maskToSource; __x.resizeCropImage = __m.resizeCropImage; __x.encodeWavMono = __m.encodeWavMono; }
{ const __m = __req("x402.mjs"); __x.parseNanoInvoice = __m.parseNanoInvoice; }
{ const __m = __req("qr.mjs"); __x.qrTerminal = __m.qrTerminal; __x.qrModules = __m.qrModules; }

});
__def("workflow.mjs", function (__x, __req) {
const { NanoodleError, RunError, UnsupportedNodeError } = __req("errors.mjs");
const { NODE_TYPES, displayName, isInputPort, materialize, topoSort, wiredFramesFloor, MAX_FRAMES } = __req("graph.mjs");
const { deriveInputs, deriveOutputs, deriveSettings, resolveInputKey, resolveSettingKey } = __req("io.mjs");
const { NanoClient } = __req("client.mjs");
const { MediaRef, coerceMediaInput } = __req("media.mjs");
const { RUNNERS } = __req("nodes.mjs");
const { decodeShareUrl, isShareRef } = __req("share.mjs");

/** Env / process access — safe when `process` is missing (browsers, some workers). */
function envApiKey() {
  try {
    return typeof process !== "undefined" && process.env ? process.env.NANOGPT_API_KEY : undefined;
  } catch {
    return undefined;
  }
}

function warnGraph(msg) {
  try {
    if (typeof process !== "undefined" && typeof process.emitWarning === "function") {
      process.emitWarning(msg, { code: "NANOODLE_GRAPH" });
      return;
    }
  } catch { /* ignore */ }
  if (typeof console !== "undefined" && console.warn) console.warn("[nanoodle]", msg);
}

const MEDIA_KINDS = new Set(["image", "audio", "video", "inpaint"]);

function abortReason(signal) {
  const r = signal && signal.reason;
  if (r instanceof Error) return r;
  return new NanoodleError(r != null ? String(r) : "run aborted", { code: "aborted" });
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortReason(signal);
}

/** The outcome of Workflow.run(). Media values are MediaRef; text values plain strings. */
class RunResult {
  constructor({ outputs, nodes, errors, costUsd, costExact, remainingBalance }) {
    /** { [friendlyKey | nodeId]: value } — sink node primary outputs */
    this.outputs = outputs;
    /** per-node { status: "done"|"error"|"skipped", out, error, costUsd, ms } */
    this.nodes = nodes;
    /** [{ nodeId, name, message }] for every node that failed (incl. non-sink warnings) */
    this.errors = errors;
    /** summed USD cost of all calls that reported one */
    this.costUsd = costUsd;
    /** false when any network call omitted its price (total is a floor) */
    this.costExact = costExact;
    /** last remaining-balance the API reported, or null */
    this.remainingBalance = remainingBalance;
  }

  /** Output lookup by friendly key or node id (case-insensitive). */
  get(key) {
    // own-key check: `in` would leak Object.prototype members (get("toString") → a function)
    if (Object.hasOwn(this.outputs, key)) return this.outputs[key];
    const norm = String(key).trim().toLowerCase();
    for (const k of Object.keys(this.outputs)) {
      if (k.toLowerCase() === norm) return this.outputs[k];
    }
    throw new NanoodleError(`no output "${key}" — available outputs: ${Object.keys(this.outputs).map((k) => `"${k}"`).join(", ") || "(none)"}`);
  }
}

function isPlainObject(v) {
  if (v == null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

class Workflow {
  /**
   * @param {object} graphData parsed noodle-graph.json
   * @param {{ apiKey?, payment?, baseUrl?, fetch?, pollIntervals?, timeouts?, quiet?, catalog? }} [opts]
   *   catalog: opt-in raw model-catalog arrays ({ chat, image, video, audio }) enabling
   *   the same payload gates play RUNTIME_JS applies (see src/catalog.mjs) — data only,
   *   never fetched by the library
   */
  constructor(graphData, opts = {}) {
    const { nodes, links, warnings } = materialize(graphData);
    this.graph = { nodes, links };
    this.catalog = opts.catalog || null;
    /** Load-time warnings (unknown / unsupported node types). load() only warns; run() fails fast. */
    this.warnings = warnings;
    this.client = new NanoClient({
      apiKey: opts.apiKey !== undefined ? opts.apiKey : envApiKey(),
      baseUrl: opts.baseUrl,
      fetch: opts.fetch,
      pollIntervals: opts.pollIntervals,
      timeouts: opts.timeouts,
      payment: opts.payment, // accountless x402: a callback that sends the Nano invoice (never a seed)
    });
    /** [{ key, nodeId, field, kind, label, optional, def, options? }] */
    this.inputs = deriveInputs(this.graph);
    /** [{ key, nodeId, type, ports }] */
    this.outputs = deriveOutputs(this.graph);
    /** [{ key, nodeId, field, kind, def, options? }] */
    this.settings = deriveSettings(this.graph);
    if (warnings.length && !opts.quiet) {
      for (const w of warnings) warnGraph(w);
    }
  }

  /**
   * Load a workflow from a noodle-graph.json file on disk, or from any nanoodle
   * share link — a full URL (nanoodle.com/#g=…, /play.html#a=…, a da.gd/TinyURL
   * short link) or a bare #g=/#j=/#a= fragment. Direct fragment links decode
   * offline; only fragment-less short links touch the network (redirect-header
   * reads, no credentials attached).
   *
   * File paths use Node's `fs` (dynamic import). In browsers, pass a parsed
   * object / JSON string to `Workflow.fromJSON`, or a share URL/fragment.
   */
  static async load(src, opts = {}) {
    if (isShareRef(src)) {
      const { graph, recovered } = await decodeShareUrl(src, { fetch: opts.fetch });
      if (recovered && !opts.quiet) {
        warnGraph("share link was damaged (usually a copy/paste artifact) — recovered the graph's nodes and wires best-effort; re-copy the link from the editor for a pristine version");
      }
      return new Workflow(graph, opts);
    }
    if (typeof src === "string" && /^\s*[\[{]/.test(src)) {
      return Workflow.fromJSON(src, opts);
    }
    const { readFile } = await import("node:fs/promises");
    return Workflow.fromJSON(await readFile(src, "utf8"), opts);
  }

  /** Build from a parsed object or a JSON string. */
  static fromJSON(objOrString, opts = {}) {
    const data = typeof objOrString === "string" ? JSON.parse(objOrString) : objOrString;
    return new Workflow(data, opts);
  }

  /**
   * Execute the whole graph.
   * @param {object|string|Uint8Array|MediaRef} inputs friendly-keyed values, or a bare scalar
   *   when the workflow has exactly one required input
   * @param {{ settings?, defaults?, timeoutMs?, signal?, onProgress? }} [runOpts]
   *   defaults: false treats graph fields as authoritative — no def backfill for
   *   unsupplied inputs (the play UI materializes defs into fields itself, so a
   *   deliberately blank field must stay blank when it delegates to this engine)
   * @returns {Promise<RunResult>} rejects with RunError (carrying .result) when a sink failed
   */
  async run(inputs = {}, runOpts = {}) {
    const { settings = {}, defaults = true, timeoutMs, signal, onProgress } = runOpts;
    const graph = this.graph;

    // bare scalar → the single required input
    if (!isPlainObject(inputs)) {
      const required = this.inputs.filter((i) => !i.optional);
      if (required.length !== 1) {
        throw new NanoodleError(
          `a bare input value needs exactly one required input; this workflow has ${required.length} ` +
          `(${required.map((i) => `"${i.key}"`).join(", ")}) — pass an object instead`);
      }
      inputs = { [required[0].key]: inputs };
    }

    // ---- upfront validation: resolve every key BEFORE running/spending anything ----
    const inputAssignments = [];
    for (const [key, value] of Object.entries(inputs)) {
      const entry = resolveInputKey(graph, this.inputs, key);
      inputAssignments.push({ entry, value });
    }
    const settingAssignments = [];
    for (const [key, value] of Object.entries(settings)) {
      const entry = resolveSettingKey(graph, this.settings, key);
      settingAssignments.push({ entry, value });
    }

    // unknown node types fail fast — before any network call
    for (const n of graph.nodes) {
      if (n.unknown) {
        throw new UnsupportedNodeError(
          `node ${n.id}: unknown node type '${n.type}' — this graph needs a newer nanoodle library`,
          { nodeId: n.id, nodeType: n.type });
      }
    }

    const order = topoSort(graph); // throws naming cyclic nodes

    // Local-only graphs never POST media — skip the ~4 MB inline cap on inputs.
    // Mixed/network graphs keep the cap so we fail before spending on an oversize body.
    const hasNetwork = graph.nodes.some((n) => NODE_TYPES[n.type] && NODE_TYPES[n.type].network);
    const mediaCoerceOpts = { enforceInlineMax: hasNetwork };

    // effective fields: graph fields + settings overrides + user inputs
    const effFields = new Map(graph.nodes.map((n) => [n.id, { ...n.fields }]));
    for (const { entry, value } of settingAssignments) {
      effFields.get(entry.nodeId)[entry.field] = this._coerceSetting(entry, value);
    }
    const explicit = new Set();
    for (const { entry, value } of inputAssignments) {
      effFields.get(entry.nodeId)[entry.field] = this._coerceInput(entry, value, mediaCoerceOpts);
      explicit.add(entry);
    }
    // vframes: raise frames to highest wired frameK (play.html wiredFramesFloor) so a
    // persisted frames=1 with frame3 wired doesn't starve the consumer after paid upstream.
    for (const n of graph.nodes) {
      if (n.type !== "vframes") continue;
      const fields = effFields.get(n.id);
      const floor = wiredFramesFloor(graph, n.id);
      const cur = Math.max(1, Math.min(MAX_FRAMES, parseInt(fields.frames, 10) || 1));
      if (floor > cur) fields.frames = String(floor);
    }
    // defaults + required check
    for (const entry of this.inputs) {
      const fields = effFields.get(entry.nodeId);
      const v = fields[entry.field];
      if (v == null || String(v).trim() === "") {
        // an EXPLICIT empty value clears an optional input (e.g. run with no system prompt) —
        // the def only backfills when the key wasn't supplied at all (the app's prefilled textarea)
        if (entry.optional && (explicit.has(entry) || !defaults)) continue;
        if (defaults && entry.def != null && String(entry.def) !== "") fields[entry.field] = entry.def;
        else if (!entry.optional) {
          throw new NanoodleError(`missing required input "${entry.key}" (${entry.nodeId}.${entry.field})`);
        }
      }
    }

    // API key (or an x402 payment callback) required only when the graph actually calls NanoGPT
    if (!this.client.apiKey && !this.client.payment && hasNetwork) {
      throw new NanoodleError("no API key — pass { apiKey } to Workflow.load/fromJSON, set NANOGPT_API_KEY, or pass { payment } for accountless x402 runs (this workflow calls the NanoGPT API)");
    }

    // ---- execution ----
    const ac = new AbortController();
    let timer = null;
    const onOuterAbort = () => ac.abort(signal.reason);
    if (signal) {
      if (signal.aborted) ac.abort(signal.reason);
      else signal.addEventListener("abort", onOuterAbort, { once: true });
    }
    if (timeoutMs) {
      timer = setTimeout(() => ac.abort(new NanoodleError(`run timed out after ${timeoutMs}ms`, { code: "timeout" })), timeoutMs);
    }

    const emit = (evt) => { if (onProgress) { try { onProgress(evt); } catch { /* listener errors never kill the run */ } } };
    const nodesRec = {};
    const errors = [];
    const cost = { total: 0, exact: true, balance: null };
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const promises = new Map();
    const mediaFetch = this.client.fetch;

    const ctxFor = (node, rec) => {
      const onCost = (c) => {
        if (!c) return;
        if (c.usd != null) { rec.costUsd = (rec.costUsd || 0) + c.usd; cost.total += c.usd; }
        else cost.exact = false;
        if (c.balance != null) cost.balance = c.balance;
      };
      const onPoll = (info) => emit({ type: "poll", nodeId: node.id, name: displayName(node), ...info });
      const io = { onCost, onPoll, signal: ac.signal };
      return {
        chat: (messages, model, opts) => this.client.chat(messages, model, opts, io),
        chatImage: (messages, model, opts) => this.client.chatImage(messages, model, opts, io),
        image: (args) => this.client.image(args, io),
        video: (model, prompt, opts, imageDataUrl) => this.client.video(model, prompt, opts, imageDataUrl, io),
        audio: (model, input, extra) => this.client.audio(model, input, extra, io),
        transcribe: (model, audioUrl, language) => this.client.transcribe(model, audioUrl, language, io),
        fetchMedia: (url) => this.client.fetchMediaDataUrl(url, io),
        // local media (resize/combine/…) — same fetch + signal as network I/O
        fetch: mediaFetch,
        signal: ac.signal,
        catalog: this.catalog,
        progress: (msg) => emit({ type: "node-progress", nodeId: node.id, name: displayName(node), message: msg }),
      };
    };

    const execNode = async (n) => {
      const rec = nodesRec[n.id];
      try {
        throwIfAborted(ac.signal);
        const inbound = graph.links.filter((l) => l.to.node === n.id);
        const inp = {};
        let fields = effFields.get(n.id);
        let upstreamFail = null;
        for (const l of inbound) {
          let srcOut;
          try { srcOut = await promises.get(l.from.node); }
          catch { if (!upstreamFail) upstreamFail = displayName(byId.get(l.from.node)); continue; }
          const v = srcOut[l.from.port];
          if (isInputPort(n, l.to.port)) inp[l.to.port] = v;
          // wired textarea port = field override; a missing upstream port (degraded save) must
          // NOT clobber the typed field with undefined — the app only applies v != null
          else if (v != null) fields = { ...fields, [l.to.port]: v };
        }
        if (upstreamFail) throw new NanoodleError("upstream failed: " + upstreamFail);
        throwIfAborted(ac.signal);
        emit({ type: "node-start", nodeId: n.id, name: displayName(n) });
        const t0 = Date.now();
        const out = await RUNNERS[n.type]({ ...n, fields }, inp, ctxFor(n, rec));
        throwIfAborted(ac.signal);
        rec.status = "done";
        rec.out = out;
        rec.ms = Date.now() - t0;
        emit({ type: "node-done", nodeId: n.id, name: displayName(n), ms: rec.ms, costUsd: rec.costUsd });
        return out;
      } catch (e) {
        rec.status = "error";
        rec.error = e.message;
        errors.push({ nodeId: n.id, name: displayName(n), message: e.message });
        emit({ type: "node-error", nodeId: n.id, name: displayName(n), error: e.message });
        throw e;
      }
    };

    try {
      for (const n of order) {
        if (NODE_TYPES[n.type].note) { nodesRec[n.id] = { status: "skipped", out: null, error: null, costUsd: null, ms: null }; continue; }
        nodesRec[n.id] = { status: "pending", out: null, error: null, costUsd: null, ms: null };
        promises.set(n.id, execNode(n)); // siblings run concurrently; a node starts when ITS deps finish
      }
      await Promise.allSettled([...promises.values()]);
    } finally {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onOuterAbort);
    }

    // ---- result ----
    const outputsMap = {};
    for (const o of this.outputs) {
      const rec = nodesRec[o.nodeId];
      if (!rec || rec.status !== "done") continue;
      const primary = o.ports[0];
      const value = this._wrapValue(rec.out[primary.name], primary.type);
      outputsMap[o.key] = value;
      outputsMap[o.nodeId] = value;
    }
    const result = new RunResult({
      outputs: outputsMap,
      nodes: nodesRec,
      errors,
      costUsd: cost.total,
      costExact: cost.exact,
      remainingBalance: cost.balance,
    });

    // timeout/abort must fail the run even when local media finished after the deadline
    // (or nodes never observed the signal). Prefer the abort reason when present.
    if (ac.signal.aborted) {
      const reason = abortReason(ac.signal);
      const msg = reason.message || "run aborted";
      // mark any still-pending nodes so result.errors is complete
      for (const n of order) {
        const rec = nodesRec[n.id];
        if (rec && rec.status === "pending") {
          rec.status = "error";
          rec.error = msg;
          if (!errors.some((e) => e.nodeId === n.id)) {
            errors.push({ nodeId: n.id, name: displayName(n), message: msg });
          }
        }
      }
      throw new RunError(msg, result, reason.code ? { code: reason.code } : {});
    }

    const failedSinks = this.outputs.filter((o) => nodesRec[o.nodeId] && nodesRec[o.nodeId].status === "error");
    if (failedSinks.length) {
      let detail = failedSinks.map((o) => `"${o.key}": ${nodesRec[o.nodeId].error}`).join("; ");
      // "upstream failed: X" only names the sink's neighbor — name the node(s) that actually broke
      const sinkIds = new Set(failedSinks.map((o) => o.nodeId));
      const roots = errors.filter((e) => !sinkIds.has(e.nodeId) && !/^upstream failed: /.test(e.message));
      if (roots.length) {
        detail += ` (root cause — ${roots.map((e) => `"${e.name}": ${e.message}`).join("; ")})`;
      }
      throw new RunError("run failed — " + detail, result);
    }
    return result;
  }

  _coerceInput(entry, value, mediaOpts) {
    if (MEDIA_KINDS.has(entry.kind)) {
      // Plain image inputs skip the load-time inline cap: every image-sending node
      // downscales an oversized image to the send budget (fitImage), so a big photo
      // is a shrink, not a refusal. Audio/video (and inpaint, whose mask must keep
      // the source's dimensions) can't be shrunk that way — keep their early,
      // before-any-spend guard.
      const opts = entry.kind === "image" ? { ...mediaOpts, enforceInlineMax: false } : mediaOpts;
      return coerceMediaInput(value, `input "${entry.key}"`, opts);
    }
    if (entry.kind === "choice") {
      const v = String(value);
      if (!(entry.options || []).includes(v)) {
        throw new NanoodleError(`input "${entry.key}": "${v}" is not one of the choices (${(entry.options || []).join(", ")})`);
      }
      return v;
    }
    if (value != null && typeof value === "object" && !(value instanceof String)) {
      throw new NanoodleError(`input "${entry.key}" expects text — got ${Array.isArray(value) ? "an array" : "an object"}`);
    }
    return value == null ? value : String(value);
  }

  _coerceSetting(entry, value) {
    // settings come from DOM inputs in the app, so runners assume strings — coerce scalars
    // (numbers/booleans) the same way instead of crashing a runner mid-run
    if (value == null) return value;
    if (typeof value === "object" && !(value instanceof String)) {
      throw new NanoodleError(`setting "${entry.key}" expects a scalar — got ${Array.isArray(value) ? "an array" : "an object"}`);
    }
    return String(value);
  }

  _wrapValue(value, portType) {
    if (portType !== "text" && typeof value === "string" && value) {
      return new MediaRef(value, { fetch: this.client.fetch });
    }
    return value;
  }
}

__x.RunResult = RunResult; __x.Workflow = Workflow;
});
__def("errors.mjs", function (__x, __req) {
/** Base error for everything nanoodle throws deliberately. */
class NanoodleError extends Error {
  /**
   * @param {string} message
   * @param {object} [props] extra fields (e.g. { code: "auth" | "funds" | "http", status })
   */
  constructor(message, props = {}) {
    super(message);
    this.name = "NanoodleError";
    Object.assign(this, props);
  }
}

/** A node in the graph cannot be executed by this library (browser-only media op / unknown type). */
class UnsupportedNodeError extends NanoodleError {
  constructor(message, props = {}) {
    super(message, props);
    this.name = "UnsupportedNodeError";
  }
}

/**
 * run() rejects with this when a sink (output) node failed.
 * `.result` carries the partial RunResult (successful lanes, per-node errors, cost so far).
 */
class RunError extends NanoodleError {
  constructor(message, result, props = {}) {
    super(message, props);
    this.name = "RunError";
    this.result = result;
  }
}

__x.NanoodleError = NanoodleError; __x.UnsupportedNodeError = UnsupportedNodeError; __x.RunError = RunError;
});
__def("media.mjs", function (__x, __req) {
const { NanoodleError } = __req("errors.mjs");

/** NanoGPT's edge rejects request bodies over ~4.5 MB; media rides inline as base64 (no upload endpoint). */
const MEDIA_INLINE_MAX = 4.4 * 1024 * 1024;

/* ---------- base64 (browser + Node; no hard Buffer dependency) ------------ */

/** @param {Uint8Array|ArrayBuffer|number[]} bytes */
function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  // chunked to avoid call-stack / arg limits on large media
  const CH = 0x8000;
  let bin = "";
  for (let i = 0; i < u8.length; i += CH) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  }
  return btoa(bin);
}

/** @param {string} b64 @returns {Uint8Array} */
function base64ToBytes(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Sniff an image's format from its base64 magic bytes (mirrors the nanoodle app runtime). */
function b64ImageMime(b64) {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("R0lG")) return "image/gif";
  if (b64.startsWith("UklG")) return "image/webp";
  return "image/png";
}

const EXT_MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".bmp": "image/bmp",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".opus": "audio/ogg",
  ".aac": "audio/aac", ".flac": "audio/flac", ".m4a": "audio/mp4",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
  ".txt": "text/plain", ".json": "application/json",
};

const MIME_EXT = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/aac": "aac",
  "audio/flac": "flac", "audio/mp4": "m4a",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "text/plain": "txt", "application/json": "json",
};

/** Best-effort file extension for a MIME type (used by the CLI --out saver). */
function extForMime(mime) {
  return MIME_EXT[String(mime || "").split(";")[0].trim().toLowerCase()] || "bin";
}

/** Extension → MIME (for mediaFromFile and friends). */
function mimeFromExt(ext) {
  return EXT_MIME[String(ext || "").toLowerCase()] || null;
}

/** Sniff a MIME type from magic bytes of common media containers. */
function sniffMime(bytes) {
  const b = bytes;
  const ascii = (off, s) => {
    for (let i = 0; i < s.length; i++) if (b[off + i] !== s.charCodeAt(i)) return false;
    return true;
  };
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, "PNG")) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (ascii(0, "GIF8")) return "image/gif";
  if (ascii(0, "RIFF") && b.length >= 12 && ascii(8, "WEBP")) return "image/webp";
  if (ascii(0, "RIFF") && b.length >= 12 && ascii(8, "WAVE")) return "audio/wav";
  if (ascii(0, "ID3") || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(0, "OggS")) return "audio/ogg";
  if (ascii(0, "fLaC")) return "audio/flac";
  if (b.length >= 12 && ascii(4, "ftyp")) return "video/mp4";
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  return "application/octet-stream";
}

/** Encode bytes as a data: URL, sniffing the MIME when not given. */
function bytesToDataUrl(bytes, mime) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return "data:" + (mime || sniffMime(u8)) + ";base64," + bytesToBase64(u8);
}

/** Decode a data: URL into { bytes, mime }. */
function dataUrlBytes(url) {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) throw new NanoodleError("not a data: URL");
  const head = url.slice(5, comma);
  const mime = (head.split(";")[0] || "application/octet-stream") || "application/octet-stream";
  const body = url.slice(comma + 1);
  const bytes = /;base64$/i.test(head) || /;base64;/i.test(head + ";")
    ? base64ToBytes(body)
    : new TextEncoder().encode(decodeURIComponent(body));
  return { bytes, mime };
}

/**
 * A media output value: a data: or https URL plus lazy byte access.
 * String-coerces to the URL so it drops into templates / JSON naturally.
 *
 * `.save(path)` is Node-only (dynamic `node:fs`); browsers should use `.bytes()` + download.
 */
class MediaRef {
  /**
   * @param {string} url data: or http(s) URL
   * @param {{ mime?: string, fetch?: typeof fetch }} [opts]
   */
  constructor(url, opts = {}) {
    this.url = url;
    this._mime = opts.mime || null;
    this._fetch = opts.fetch || globalThis.fetch;
    if (!this._mime && url.startsWith("data:")) {
      const head = url.slice(5, url.indexOf(","));
      this._mime = head.split(";")[0] || null;
    }
  }

  get mime() { return this._mime; }

  toString() { return this.url; }
  toJSON() { return this.url; }

  /** @returns {Promise<Uint8Array>} the raw media bytes (decodes data:, fetches http(s)). */
  async bytes() {
    if (this.url.startsWith("data:")) return dataUrlBytes(this.url).bytes;
    const r = await this._fetch(this.url);
    if (!r.ok) throw new NanoodleError("couldn't download media (" + r.status + "): " + this.url);
    if (!this._mime) {
      const ct = r.headers && r.headers.get && r.headers.get("content-type");
      if (ct) this._mime = ct.split(";")[0].trim();
    }
    return new Uint8Array(await r.arrayBuffer());
  }

  /** Write the media bytes to `path` (Node only); resolves to the path. */
  async save(path) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, await this.bytes());
    return path;
  }
}

/**
 * Read a local file as a media input value: `{ data, mime }` (Node only).
 * MIME comes from the extension, else magic-byte sniffing.
 */
async function mediaFromFile(path, mime) {
  const { readFile } = await import("node:fs/promises");
  const { extname } = await import("node:path");
  const data = await readFile(path);
  const u8 = new Uint8Array(data);
  return { data: u8, mime: mime || mimeFromExt(extname(path)) || sniffMime(u8) };
}

/**
 * Refuse a data: URL that exceeds NanoGPT's inline body cap.
 * Used at network send sites and when coercing inputs for graphs that call NanoGPT.
 * Local-only graphs (resize/combine/vframes/…) skip this — they never POST media.
 */
function assertInlineMediaSize(url, what = "media") {
  if (typeof url === "string" && url.startsWith("data:") && url.length > MEDIA_INLINE_MAX) {
    throw new NanoodleError(
      what + ": media is too large to send inline (~4 MB max). nanoodle sends media as base64 in the request body " +
      "(NanoGPT has no upload endpoint) — use a smaller file.");
  }
}

/**
 * Coerce a user-supplied media input into a URL string (data: or http(s)).
 * Accepts: data:/https URL strings, MediaRef, Uint8Array/Buffer, { data, mime }.
 *
 * @param {*} value
 * @param {string} what label for errors
 * @param {{ enforceInlineMax?: boolean }} [opts] when true (default), refuse data: URLs
 *   over MEDIA_INLINE_MAX. Pass false for local-only workflows that never hit NanoGPT.
 */
function coerceMediaInput(value, what, opts = {}) {
  const enforceInlineMax = opts.enforceInlineMax !== false;
  let url;
  if (value instanceof MediaRef) url = value.url;
  else if (typeof value === "string") {
    if (/^data:/i.test(value) || /^https?:/i.test(value)) url = value;
    else {
      throw new NanoodleError(
        what + ": expected a data: URL, an http(s) URL, bytes, or mediaFromFile(path) — got a plain string. " +
        "For a local file use mediaFromFile(\"" + value.slice(0, 60) + "\").");
    }
  } else if (value instanceof Uint8Array) url = bytesToDataUrl(value);
  else if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(value)) {
    url = bytesToDataUrl(new Uint8Array(value));
  } else if (value && typeof value === "object" && value.data != null) {
    const data = typeof value.data === "string"
      ? base64ToBytes(value.data)
      : new Uint8Array(value.data);
    url = bytesToDataUrl(data, value.mime);
  } else {
    throw new NanoodleError(what + ": unsupported media value (" + typeof value + ")");
  }
  if (enforceInlineMax) assertInlineMediaSize(url, what);
  return url;
}

__x.MEDIA_INLINE_MAX = MEDIA_INLINE_MAX; __x.bytesToBase64 = bytesToBase64; __x.base64ToBytes = base64ToBytes; __x.b64ImageMime = b64ImageMime; __x.extForMime = extForMime; __x.mimeFromExt = mimeFromExt; __x.sniffMime = sniffMime; __x.bytesToDataUrl = bytesToDataUrl; __x.dataUrlBytes = dataUrlBytes; __x.MediaRef = MediaRef; __x.mediaFromFile = mediaFromFile; __x.assertInlineMediaSize = assertInlineMediaSize; __x.coerceMediaInput = coerceMediaInput;
});
__def("client.mjs", function (__x, __req) {
const { NanoodleError } = __req("errors.mjs");
const { b64ImageMime, bytesToDataUrl, dataUrlBytes, MEDIA_INLINE_MAX } = __req("media.mjs");
const { assertPaymentOption, parseNanoInvoice, looksLikeResult } = __req("x402.mjs");

const AUDIO_MIME = { mp3: "audio/mpeg", opus: "audio/ogg", aac: "audio/aac", flac: "audio/flac", wav: "audio/wav", pcm: "audio/wav" };

/** Map an HTTP failure to an actionable error (mirrors the app's httpRunError). Never leaks the key. */
function httpError(status, bodyText) {
  if (status === 401 || status === 403) {
    return new NanoodleError(`API key rejected (HTTP ${status}) — check your NanoGPT key / NANOGPT_API_KEY`, { code: "auth", status });
  }
  if (status === 402 || /insufficient|balance|funds|not enough|payment required/i.test(String(bodyText || ""))) {
    return new NanoodleError("out of balance — this run needs more credit. Top up at nano-gpt.com, then run again.", { code: "funds", status });
  }
  return new NanoodleError(status + ": " + String(bodyText).slice(0, 160), { code: "http", status });
}

/**
 * Cost extraction (mirrors the app's costFromJson). USD priority:
 * j.cost (>0) → x_nanogpt_pricing.(costUsd|cost|amount) → metadata.cost → j.cost even when 0.
 * Present-but-zero = known-free (kept); absent = unknown.
 */
function costFromJson(j) {
  if (!j) return { usd: null, balance: null };
  const p = j.x_nanogpt_pricing;
  const pUsd = p && (p.costUsd != null ? p.costUsd : p.cost != null ? p.cost : p.amount);
  const mUsd = j.metadata && j.metadata.cost;
  const usd = typeof j.cost === "number" && j.cost > 0 ? j.cost
    : pUsd != null && isFinite(Number(pUsd)) ? Number(pUsd)
    : mUsd != null && isFinite(Number(mUsd)) ? Number(mUsd)
    : typeof j.cost === "number" ? j.cost
    : null;
  const balance = typeof j.remainingBalance === "number" ? j.remainingBalance
    : p && typeof p.remainingBalance === "number" ? p.remainingBalance
    : null;
  return { usd, balance };
}

/** Header-borne cost/balance (binary audio path): x-cost / x-nano-cost, x-remaining-balance. */
function costFromHeaders(r) {
  const g = (k) => (r && r.headers && r.headers.get ? r.headers.get(k) : null);
  const c = parseFloat(g("x-cost") || g("x-nano-cost") || "");
  const b = parseFloat(g("x-remaining-balance") || "");
  return { usd: isNaN(c) ? null : c, balance: isNaN(b) ? null : b };
}

/** JSON cost wins for usd; the x-remaining-balance header wins for balance. */
function costWithHeaders(j, r) {
  const fromJson = costFromJson(j);
  const fromHeaders = costFromHeaders(r);
  return {
    usd: fromJson.usd != null ? fromJson.usd : fromHeaders.usd,
    balance: fromHeaders.balance != null ? fromHeaders.balance : fromJson.balance,
  };
}

function abortError(reason) {
  return reason instanceof Error ? reason : new NanoodleError(reason ? String(reason) : "run aborted", { code: "aborted" });
}

/** Abortable sleep. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError(signal.reason));
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() { clearTimeout(t); reject(abortError(signal.reason)); }
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * NanoGPT transport. `baseUrl` and `fetch` are injectable (that's how the offline test harness runs);
 * pollIntervals / timeouts are per-media-kind knobs (ms).
 */
class NanoClient {
  constructor({ apiKey, baseUrl = "https://nano-gpt.com", fetch = globalThis.fetch, pollIntervals = {}, timeouts = {}, payment } = {}) {
    // non-enumerable: console.log/util.inspect/JSON.stringify of a client (or a Workflow holding
    // one) must never print the key
    Object.defineProperty(this, "apiKey", { value: apiKey, writable: true, enumerable: false, configurable: true });
    assertPaymentOption(payment); // a callback or nothing — never a seed/private key
    this.payment = payment || null;
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.fetch = fetch;
    this.pollIntervals = { video: 5000, audio: 3000, x402: 3000, ...pollIntervals };
    this.timeouts = { video: 600000, audio: 300000, ...timeouts };
  }

  _auth() {
    if (this.apiKey) return { Authorization: "Bearer " + this.apiKey, "x-api-key": this.apiKey };
    if (this.payment) return { "x-x402": "true" }; // keyless: opt into accountless 402 invoices
    return {};
  }

  /**
   * fetch that settles HTTP 402 via the x402 flow when running keyless with a
   * `payment` callback: parse the Nano invoice → callback sends XNO (its own
   * wallet/signer — the library never touches funds) → poll the complete URL
   * until the deposit is seen → return the replayed result, or re-send the
   * original request stamped with the settled payment id. Each API call pays
   * at most once; a second 402 after settling is an error, never a second send.
   */
  async _paidFetch(url, init, signal) {
    const r = await this.fetch(url, init);
    if (r.status !== 402 || !this.payment || this.apiKey) return r;
    const settled = await this._settle402(r, signal);
    if (settled.response) return settled.response; // complete replayed the stored request
    const r2 = await this.fetch(url, { ...init, headers: { ...init.headers, "x-x402-payment-id": settled.paymentId } });
    if (r2.status === 402) {
      throw new NanoodleError(
        "payment " + settled.paymentId + " settled, but the API still answered 402 on retry — " +
        "check " + (settled.statusUrl || "the payment status") + " before paying again",
        { code: "x402", status: 402, paymentId: settled.paymentId });
    }
    return r2;
  }

  async _settle402(r, signal) {
    let body = null;
    try { body = await r.json(); } catch { /* fall through to the generic funds error */ }
    const invoice = body && parseNanoInvoice(body, this.baseUrl);
    if (!invoice || !invoice.paymentId || !invoice.completeUrl) {
      throw new NanoodleError(
        "payment required, but the 402 response offered no usable Nano option" +
        (body ? " — " + JSON.stringify(body).slice(0, 200) : ""), { code: "x402", status: 402 });
    }
    await this.payment(invoice); // ← the callback does the actual XNO send
    // The complete endpoint doubles as the poll: 402 = not seen on-chain yet.
    const deadline = invoice.expiresAt || Date.now() + 15 * 60 * 1000;
    while (true) {
      const cr = await this.fetch(invoice.completeUrl, {
        method: "POST", headers: { "Content-Type": "application/json", "x-x402": "true" }, body: "{}", signal,
      });
      if (cr.ok) {
        const ct = ((cr.headers && cr.headers.get && cr.headers.get("content-type")) || "");
        let cj = null;
        if (ct.includes("json")) { try { cj = await cr.json(); } catch { /* treat as settle-only */ } }
        if (looksLikeResult(cj)) {
          // wrap so call sites keep their Response contract (ok/json/text/headers)
          const response = { ok: true, status: 200, headers: cr.headers, json: async () => cj, text: async () => JSON.stringify(cj) };
          return { paymentId: invoice.paymentId, statusUrl: invoice.statusUrl, response };
        }
        return { paymentId: invoice.paymentId, statusUrl: invoice.statusUrl };
      }
      if (cr.status !== 402) throw httpError(cr.status, await cr.text());
      await cr.text().catch(() => {}); // drain the "not verified yet" body
      if (Date.now() >= deadline) {
        throw new NanoodleError(
          "payment window expired before the Nano deposit was detected (payment " + invoice.paymentId + ", " +
          (invoice.amount || invoice.amountRaw) + " to " + invoice.payTo + ") — if you already sent it, check " +
          (invoice.explorerUrl || invoice.statusUrl), { code: "x402-expired", paymentId: invoice.paymentId });
      }
      await sleep(this.pollIntervals.x402, signal);
    }
  }

  async _postJson(path, body, signal) {
    const payload = JSON.stringify(body);
    if (payload.length > MEDIA_INLINE_MAX) {
      throw new NanoodleError("request body is too large (~4 MB max) — nanoodle sends media inline as base64; use smaller/shorter media");
    }
    return this._paidFetch(this.baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this._auth() },
      body: payload,
      signal,
    }, signal);
  }

  async _get(path, signal) {
    return this.fetch(this.baseUrl + path, { headers: this._auth(), signal });
  }

  /** POST /api/v1/chat/completions (non-streaming). Returns the assistant text. */
  async chat(messages, model, opts = {}, { onCost, signal } = {}) {
    const body = { model, messages };
    body.temperature = opts.temperature != null && opts.temperature !== "" ? +opts.temperature : 0.8;
    if (opts.max_tokens) body.max_tokens = +opts.max_tokens;
    if (opts.response_format) body.response_format = opts.response_format;
    if (opts.reasoning_effort) body.reasoning_effort = opts.reasoning_effort;
    const r = await this._postJson("/api/v1/chat/completions", body, signal);
    if (!r.ok) throw httpError(r.status, await r.text());
    const j = await r.json();
    if (onCost) onCost(costWithHeaders(j, r));
    const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
    const txt = msg.content;
    // empty-string content is a billed-but-empty reply, not a protocol failure — return it
    // (showThinking can still surface msg.reasoning), matching the editor/play built-in parsers
    if (txt == null) throw new NanoodleError("no text in response");
    let out = typeof txt === "string" ? txt : txt.map((p) => p.text || "").join("");
    if (opts.showThinking && msg.reasoning) {
      out = "```thinking\n" + msg.reasoning + "\n```\n\n" + out;
    }
    return out;
  }

  /** Draw-node twin of chat(): the model answers with images in message.images[]. */
  async chatImage(messages, model, opts = {}, { onCost, signal } = {}) {
    const body = { model, messages };
    body.temperature = opts.temperature != null && opts.temperature !== "" ? +opts.temperature : 0.8;
    const r = await this._postJson("/api/v1/chat/completions", body, signal);
    if (!r.ok) throw httpError(r.status, await r.text());
    const j = await r.json();
    if (onCost) onCost(costWithHeaders(j, r));
    const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
    const images = (msg.images || [])
      .map((im) => (im && im.image_url && im.image_url.url) || (im && im.url) || (typeof im === "string" ? im : null))
      .filter(Boolean);
    const text = typeof msg.content === "string" ? msg.content
      : Array.isArray(msg.content) ? msg.content.map((p) => p.text || "").join("") : "";
    if (!images.length) {
      throw new NanoodleError(text ? "this model replied with text, not an image — pick an image-output model" : "no image in response");
    }
    return { images, text, reasoning: msg.reasoning || "" };
  }

  /** POST /v1/images/generations (NOTE: not /api/v1). Returns data: / https URL(s). */
  async image({ prompt, model, size, imageDataUrl, maskDataUrl, extra, n = 1, multi = false }, { onCost, signal } = {}) {
    const body = { model, size: size || "1024x1024", n, response_format: "b64_json" };
    if (prompt) body.prompt = prompt; // omit when blank — upscalers run with no instruction
    if (imageDataUrl) body.imageDataUrl = imageDataUrl; // string OR array (edit multi-reference)
    if (maskDataUrl) body.maskDataUrl = maskDataUrl; // white = repaint
    if (extra) Object.assign(body, extra);
    const r = await this._postJson("/v1/images/generations", body, signal);
    if (!r.ok) throw httpError(r.status, await r.text());
    const j = await r.json();
    const urls = (j.data || [])
      .map((d) => (d.b64_json ? "data:" + b64ImageMime(d.b64_json) + ";base64," + d.b64_json : d.url))
      .filter(Boolean);
    if (!urls.length) throw new NanoodleError("no image in response");
    if (onCost) onCost(costWithHeaders(j, r));
    return multi ? urls : urls[0];
  }

  /** POST /api/generate-video then poll GET /api/video/status?requestId= until COMPLETED. */
  // io.onRunId(runId) fires the moment a FRESH submit returns its job id — a caller
  // keeping a resume registry (play's PENDING_VIDEO) records it before any await.
  // io.resume (a runId) skips the submit — and its charge — and goes straight to
  // polling: how a timed-out job is picked back up without paying twice.
  async video(model, prompt, opts = {}, imageDataUrl, { onCost, onPoll, onRunId, resume, signal } = {}) {
    const body = { model, prompt };
    if (opts.duration) body.duration = opts.duration;
    if (opts.aspect_ratio) body.aspect_ratio = opts.aspect_ratio;
    if (opts.resolution) body.resolution = opts.resolution;
    // catalog-declared wire names (videoDims with an opt-in catalog): Sora-style seconds/orientation
    if (opts.seconds) body.seconds = opts.seconds;
    if (opts.orientation) body.orientation = opts.orientation;
    if (opts.resolution_ratio) body.resolution_ratio = opts.resolution_ratio;
    if (imageDataUrl) body.imageDataUrl = imageDataUrl;
    if (opts.last_image) body.last_image = opts.last_image;
    if (opts.videoUrl) body.videoUrl = opts.videoUrl;
    if (opts.videoDataUrl) body.videoDataUrl = opts.videoDataUrl;
    if (opts.audioUrl) body.audioUrl = opts.audioUrl;
    if (opts.audioDataUrl) body.audioDataUrl = opts.audioDataUrl;
    if (opts.lora) Object.assign(body, opts.lora); // LoRA params (lora_url_1.. for LTX video)
    if (opts.extra) Object.assign(body, opts.extra); // fields.modelOpts — per-model knobs incl. seed
    // node-owned dims win over stale modelOpts copies (twin of the app runtime)
    if (opts.duration) body.duration = opts.duration;
    if (opts.aspect_ratio) body.aspect_ratio = opts.aspect_ratio;
    if (opts.resolution) body.resolution = opts.resolution;
    if (opts.seconds) body.seconds = opts.seconds;
    if (opts.orientation) body.orientation = opts.orientation;
    if (opts.resolution_ratio) body.resolution_ratio = opts.resolution_ratio;
    if (opts.refImages && opts.refImages.length) body[opts.refKey || "reference_images"] = opts.refImages; // wired refs win last
    let runId = resume || null;
    if (!runId) {
      const r = await this._postJson("/api/generate-video", body, signal);
      if (!r.ok) throw httpError(r.status, await r.text());
      const j = await r.json();
      if (onCost) onCost(costWithHeaders(j, r));
      runId = j.runId || j.id;
      if (!runId) throw new NanoodleError("no runId returned");
      if (onRunId) onRunId(runId);
    }

    const t0 = Date.now();
    while (Date.now() - t0 < this.timeouts.video) {
      await sleep(this.pollIntervals.video, signal);
      let s;
      try {
        s = await (await this._get("/api/video/status?requestId=" + encodeURIComponent(runId), signal)).json();
      } catch (e) {
        if (signal && signal.aborted) throw abortError(signal.reason);
        continue; // transient poll failure — keep polling until timeout
      }
      const st = String((s.data && s.data.status) || s.status || "").toUpperCase();
      if (onPoll) onPoll({ status: st, elapsedMs: Date.now() - t0, runId });
      if (st === "COMPLETED" || st === "SUCCEEDED") {
        const out = (s.data && s.data.output) || s.output || {};
        const url = (out.video && out.video.url) || out.url || (Array.isArray(out.video) ? out.video[0] && out.video[0].url : null);
        if (!url) throw new NanoodleError("completed but no video url");
        return url;
      }
      if (["FAILED", "ERROR", "CANCELED"].includes(st)) {
        throw new NanoodleError("video failed: " + ((s.data && s.data.error) || st));
      }
    }
    throw new NanoodleError(`video timed out (${Math.round(this.timeouts.video / 1000)}s) — the job may still be running on NanoGPT's side`, { code: "timeout" });
  }

  /**
   * POST /api/v1/audio/speech (music + tts + remix). Returns an audio URL (https or data:).
   * io.onRunId(job) fires when an async job enters the poll branch (job = the submit
   * response — runId + refund metadata the status poll needs); io.resume (that same job
   * object) skips the submit + charge and resumes polling a prior run's job.
   */
  async audio(model, input, extra = {}, { onCost, onPoll, onRunId, resume, signal } = {}) {
    if (resume) {
      const url = await this._pollAudio(model, resume, { onPoll, signal });
      if (!url) throw new NanoodleError("no audio url in response");
      return url;
    }
    const body = Object.assign({ model, input }, extra);
    const r = await this._postJson("/api/v1/audio/speech", body, signal);
    if (!r.ok) throw httpError(r.status, await r.text());
    const ct = (r.headers && r.headers.get && r.headers.get("content-type")) || "";
    if (ct.includes("application/json")) {
      const j = await r.json();
      if (onCost) onCost(costWithHeaders(j, r));
      let url = j.url || j.audioUrl || (j.data && j.data.url) || (j.data && j.data.audioUrl);
      if (!url && (j.runId || j.id)) {
        if (onRunId) onRunId(j);
        url = await this._pollAudio(model, j, { onPoll, signal });
      }
      if (!url) throw new NanoodleError("no audio url in response");
      return url;
    }
    // binary body → the audio bytes; MIME from content-type, pinned from the requested format when generic
    if (onCost) onCost(costFromHeaders(r));
    const bytes = new Uint8Array(await r.arrayBuffer());
    let mime = ct.split(";")[0].trim().toLowerCase();
    if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream") {
      mime = AUDIO_MIME[extra.response_format || "mp3"] || "audio/mpeg";
    }
    return bytesToDataUrl(bytes, mime);
  }

  async _pollAudio(model, j, { onPoll, signal } = {}) {
    const runId = j.runId || j.id;
    const qs = new URLSearchParams({ runId: String(runId), model });
    if (j.cost != null) qs.set("cost", String(j.cost)); // lets the server auto-refund on failure
    if (j.paymentSource) qs.set("paymentSource", String(j.paymentSource));
    if (j.isApiRequest != null) qs.set("isApiRequest", String(j.isApiRequest));
    const t0 = Date.now();
    while (Date.now() - t0 < this.timeouts.audio) {
      await sleep(this.pollIntervals.audio, signal);
      let s;
      try {
        s = await (await this._get("/api/tts/status?" + qs, signal)).json();
      } catch (e) {
        if (signal && signal.aborted) throw abortError(signal.reason);
        continue;
      }
      const st = String(s.status || "").toLowerCase();
      if (onPoll) onPoll({ status: st, elapsedMs: Date.now() - t0, runId, queuePosition: s.queuePosition });
      if (st === "completed" || st === "succeeded") {
        const url = s.audioUrl || s.url || (s.data && s.data.audioUrl) || (s.data && s.data.url);
        if (!url) throw new NanoodleError("completed but no audio url");
        return url;
      }
      if (["error", "failed", "content_policy_violation"].includes(st)) {
        throw new NanoodleError("audio failed: " + (s.error || s.message || st));
      }
    }
    throw new NanoodleError(`audio timed out (${Math.round(this.timeouts.audio / 1000)}s) — the job may still be running on NanoGPT's side`, { code: "timeout" });
  }

  /** POST /api/v1/audio/transcriptions (multipart; the audio form field MUST be "file"). */
  async transcribe(model, audioUrl, language, { onCost, signal } = {}) {
    let bytes, mime;
    if (/^data:/i.test(audioUrl)) {
      ({ bytes, mime } = dataUrlBytes(audioUrl));
    } else {
      const r = await this.fetch(audioUrl, { signal }); // media CDN — no auth headers
      if (!r.ok) throw new NanoodleError("couldn't download the audio to transcribe (" + r.status + ")");
      bytes = new Uint8Array(await r.arrayBuffer());
      mime = ((r.headers && r.headers.get && r.headers.get("content-type")) || "audio/mpeg").split(";")[0];
    }
    if (bytes.length > 3.5 * 1024 * 1024) {
      throw new NanoodleError("this clip is too big to transcribe directly (~3.5 MB max) — nanoodle sends audio inline; use a shorter clip");
    }
    const ext = ((mime || "audio/mp3").split("/")[1] || "mp3").split(";")[0];
    const fd = new FormData();
    fd.append("file", new Blob([bytes], { type: mime || "audio/mpeg" }), "audio." + ext);
    fd.append("model", model);
    if (language) fd.append("language", language);
    // no explicit Content-Type — fetch sets the multipart boundary
    const r = await this._paidFetch(this.baseUrl + "/api/v1/audio/transcriptions", { method: "POST", headers: this._auth(), body: fd, signal }, signal);
    if (!r.ok) throw httpError(r.status, await r.text());
    const j = await r.json();
    if (onCost) onCost(costWithHeaders(j, r));
    const txt = j.transcription != null ? j.transcription
      : j.text != null ? j.text
      : j.data && (j.data.transcription != null ? j.data.transcription : j.data.text);
    if (txt == null) throw new NanoodleError("no transcription in response");
    return txt;
  }

  /**
   * Download hosted media (CDN — no auth headers) and inline it as a data: URL.
   * Used when a chat audio part needs base64 bytes but the upstream node produced an https URL.
   */
  async fetchMediaDataUrl(url, { signal } = {}) {
    const r = await this.fetch(url, { signal });
    if (!r.ok) throw new NanoodleError("couldn't download media to inline (" + r.status + "): " + url);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const ct = (((r.headers && r.headers.get && r.headers.get("content-type")) || "").split(";")[0] || "").trim().toLowerCase();
    const mime = ct && ct !== "application/octet-stream" && ct !== "binary/octet-stream" ? ct : undefined;
    return bytesToDataUrl(bytes, mime); // sniffs magic bytes when the CDN's content-type is generic
  }

  /** Optional helper: POST /api/check-balance → { usd_balance }. */
  async checkBalance(signal) {
    const r = await this._postJson("/api/check-balance", {}, signal);
    if (!r.ok) throw httpError(r.status, await r.text());
    return r.json();
  }
}

__x.httpError = httpError; __x.costFromJson = costFromJson; __x.costFromHeaders = costFromHeaders; __x.costWithHeaders = costWithHeaders; __x.sleep = sleep; __x.NanoClient = NanoClient;
});
__def("graph.mjs", function (__x, __req) {
const { NanoodleError } = __req("errors.mjs");

/* Dynamic input-port families (mirrors the nanoodle app's runGraph). A wire landing on one of
   these ports — or on a port declared in NODE_TYPES[type].inputs — is a data input; a wire
   landing on ANY other port is a field override (wired prompt/system/lyrics/q/...). */
const IMG_PORT_RE = /^img\d+$/;      // llm / draw vision references
const EDIT_IMG_RE = /^image\d*$/;    // edit multi-reference: image, image2, ...
const VID_PORT_RE = /^vid\d+$/;
const CLIP_PORT_RE = /^clip\d+$/;    // combine clips
const REF_PORT_RE = /^ref\d+$/;      // tvideo reference images
const FRAME_PORT_RE = /^frame\d+$/;  // vframes outputs
const MAX_FRAMES = 12;

const DYNAMIC_INPUT_RES = [IMG_PORT_RE, EDIT_IMG_RE, VID_PORT_RE, CLIP_PORT_RE, REF_PORT_RE];
const DYNAMIC_INPUT_NAMES = new Set(["audio", "endframe"]);

/**
 * Highest frameN port wired OUT of a vframes node. fields.frames is shape-affecting:
 * run() emits frame1..frameN and downstream links read fixed frameK ports. A count below
 * the highest wired port starves consumers mid-run (after upstream paid steps). Mirrors
 * play.html wiredFramesFloor — floor is raised at run and in deriveSettings.
 */
function wiredFramesFloor(graph, nodeId) {
  let floor = 1;
  for (const l of (graph && graph.links) || []) {
    if (l.from.node !== nodeId) continue;
    const m = /^frame(\d+)$/.exec(String(l.from.port));
    if (m) floor = Math.max(floor, parseInt(m[1], 10) || 1);
  }
  return Math.min(floor, MAX_FRAMES);
}

/**
 * Node-type registry (execution-relevant subset of the app's NODE_TYPES).
 * flags: local (pure logic / on-device media) | network (calls NanoGPT) | note.
 * Local media: pure-JS first (MP4CAT / PCM-WAV / PNG); ffmpeg on PATH is the heavy fallback.
 */
const NODE_TYPES = {
  text:    { title: "Text",            inputs: [], outputs: [{ name: "text", type: "text" }], local: true },
  upload:  { title: "Image input",     inputs: [], outputs: [{ name: "image", type: "image" }], local: true },
  aupload: { title: "Audio input",     inputs: [], outputs: [{ name: "audio", type: "audio" }], local: true },
  vupload: { title: "Video input",     inputs: [], outputs: [{ name: "video", type: "video" }], local: true },
  choice:  { title: "Choice",          inputs: [], outputs: [{ name: "text", type: "text" }], local: true },
  join:    { title: "Join",            inputs: ["a", "b"], outputs: [{ name: "text", type: "text" }], local: true },
  llm:     { title: "LLM",             inputs: [], outputs: [{ name: "text", type: "text" }], network: true },
  image:   { title: "Image",           inputs: [], outputs: [{ name: "image", type: "image" }], network: true },
  draw:    { title: "Draw",            inputs: [], outputs: [{ name: "image", type: "image" }, { name: "text", type: "text" }], network: true },
  edit:    { title: "Edit",            inputs: [], outputs: [{ name: "image", type: "image" }], network: true },
  inpaint: { title: "Inpaint",         inputs: ["image", "mask"], outputs: [{ name: "image", type: "image" }], network: true },
  resize:  { title: "Resize / crop",   inputs: ["image"], outputs: [{ name: "image", type: "image" }], local: true },
  vision:  { title: "Vision",          inputs: ["image"], outputs: [{ name: "text", type: "text" }], network: true },
  tvideo:  { title: "Text→Video",      inputs: [], outputs: [{ name: "video", type: "video" }], network: true },
  ivideo:  { title: "Image→Video",     inputs: ["image"], outputs: [{ name: "video", type: "video" }], network: true },
  vedit:   { title: "Video edit",      inputs: ["video"], outputs: [{ name: "video", type: "video" }], network: true },
  vframes: { title: "Video → frames",  inputs: ["video"], outputs: [{ name: "frame1", type: "image" }], local: true, framesOut: true }, // dynamic frame1..N
  combine: { title: "Combine videos",  inputs: [], outputs: [{ name: "video", type: "video" }], local: true },
  soundtrack: { title: "Soundtrack",   inputs: ["video", "audio"], outputs: [{ name: "video", type: "video" }], local: true },
  lipsync: { title: "Avatar / lipsync", inputs: ["image", "audio"], outputs: [{ name: "video", type: "video" }], network: true },
  music:   { title: "Music",           inputs: [], outputs: [{ name: "audio", type: "audio" }], network: true },
  remix:   { title: "Remix audio",     inputs: ["audio"], outputs: [{ name: "audio", type: "audio" }], network: true },
  tts:     { title: "Speech",          inputs: [], outputs: [{ name: "audio", type: "audio" }], network: true },
  trim:    { title: "Trim audio",      inputs: ["audio"], outputs: [{ name: "audio", type: "audio" }], local: true },
  extractaudio: { title: "Extract audio", inputs: ["video"], outputs: [{ name: "audio", type: "audio" }], local: true },
  transcribe: { title: "Transcribe",   inputs: ["audio"], outputs: [{ name: "text", type: "text" }], network: true },
  comment: { title: "Comment",         inputs: [], outputs: [], note: true, local: true },
};

/** Display name: node.name (trimmed) → type title → type → "?". */
function displayName(node) {
  const nm = (node.name || "").trim();
  if (nm) return nm;
  const t = NODE_TYPES[node.type];
  return (t && t.title) || node.type || "?";
}

/**
 * Author-marked optional node: fields.optional (the editor's "optional" checkbox on
 * input nodes) makes every input this node surfaces skippable — the run proceeds and
 * the node yields an empty value instead of failing. Serialized inside fields so it
 * survives save/share/materialize with zero format changes.
 */
function optionalNode(node) {
  const v = node && node.fields && node.fields.optional;
  return v === true || v === "true";
}

/** Is a wire landing on `port` of `node` a data input (vs a field override)? */
function isInputPort(node, port) {
  const t = NODE_TYPES[node.type];
  if (t && (t.inputs || []).includes(port)) return true;
  if (DYNAMIC_INPUT_NAMES.has(port)) return true;
  return DYNAMIC_INPUT_RES.some((re) => re.test(port));
}

/**
 * Load raw parsed graph JSON into an executable graph (mirrors the app's applyGraphData):
 * - `audio` type aliases to `tts` (legacy saves)
 * - unknown node types are KEPT but flagged (`unknown: true`) + a warning; run() fails fast on them
 * - links are kept only when both endpoints exist
 * - links into music/tts port "text" migrate to "prompt"
 * @returns {{ nodes, links, warnings: string[] }}
 */
function materialize(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.nodes)) {
    throw new NanoodleError("not a nanoodle graph: expected an object with a nodes array (the noodle-graph.json save)");
  }
  const warnings = [];
  const nodes = [];
  for (const raw of data.nodes) {
    if (!raw || raw.id == null || !raw.type) continue;
    const type = raw.type === "audio" ? "tts" : raw.type;
    const n = { id: String(raw.id), type, name: raw.name, fields: { ...(raw.fields || {}) } };
    if (!NODE_TYPES[type]) {
      n.unknown = true;
      warnings.push(`unknown node type "${raw.type}" (node ${n.id}) — kept, but running this workflow will fail; you may need a newer nanoodle library`);
    }
    nodes.push(n);
  }
  const ids = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = [];
  for (const l of data.links || []) {
    if (!l || !l.from || !l.to) continue;
    const from = { node: String(l.from.node), port: String(l.from.port) };
    const to = { node: String(l.to.node), port: String(l.to.port) };
    if (!ids.has(from.node) || !ids.has(to.node)) continue;
    const toNode = byId.get(to.node);
    if ((toNode.type === "music" || toNode.type === "tts") && to.port === "text") to.port = "prompt"; // legacy port migration
    links.push({ id: l.id, from, to });
  }
  return { nodes, links, warnings };
}

/**
 * Kahn topological sort. Throws naming the cyclic nodes.
 * @returns node array in dependency order
 */
function topoSort(graph) {
  const indeg = new Map(graph.nodes.map((n) => [n.id, 0]));
  const outAdj = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const l of graph.links) {
    indeg.set(l.to.node, (indeg.get(l.to.node) || 0) + 1);
    outAdj.get(l.from.node).push(l.to.node);
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const queue = graph.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(byId.get(id));
    for (const next of outAdj.get(id)) {
      indeg.set(next, indeg.get(next) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== graph.nodes.length) {
    const cyclic = graph.nodes.filter((n) => !order.includes(n)).map((n) => `${displayName(n)} (${n.id})`);
    throw new NanoodleError("workflow has a cycle involving: " + cyclic.join(", "));
  }
  return order;
}

__x.IMG_PORT_RE = IMG_PORT_RE; __x.EDIT_IMG_RE = EDIT_IMG_RE; __x.VID_PORT_RE = VID_PORT_RE; __x.CLIP_PORT_RE = CLIP_PORT_RE; __x.REF_PORT_RE = REF_PORT_RE; __x.FRAME_PORT_RE = FRAME_PORT_RE; __x.MAX_FRAMES = MAX_FRAMES; __x.wiredFramesFloor = wiredFramesFloor; __x.NODE_TYPES = NODE_TYPES; __x.displayName = displayName; __x.optionalNode = optionalNode; __x.isInputPort = isInputPort; __x.materialize = materialize; __x.topoSort = topoSort;
});
__def("nodes.mjs", function (__x, __req) {
const { NanoodleError } = __req("errors.mjs");
const { catItem, chatModelCan } = __req("catalog.mjs");
const { IMG_PORT_RE, EDIT_IMG_RE, REF_PORT_RE, CLIP_PORT_RE, VID_PORT_RE, optionalNode } = __req("graph.mjs");
const { MEDIA_INLINE_MAX } = __req("media.mjs");
const { resizeCropImage, trimAudioToWav, extractAudioToWav, extractVideoFrames, concatVideos, muxSoundtrack, maskToSource, fitImageInline } = __req("local-media.mjs");

function mdl(n) {
  const m = String((n.fields && n.fields.model) || "").trim();
  if (!m) throw new NanoodleError(`pick a model first (node ${n.id})`);
  return m; // model strings pass through VERBATIM — endpoint choice is by node TYPE
}

/** Local-media opts from the workflow ctx (custom fetch + AbortSignal). */
function mediaOpts(ctx) {
  if (!ctx) return {};
  return {
    ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  };
}

function portIdx(name) {
  const m = /(\d+)$/.exec(name);
  return m ? +m[1] : 1;
}

/**
 * Shrink an inline image under the ~4.4 MB request-body budget before a paid send —
 * over it, NanoGPT 413s (FUNCTION_PAYLOAD_TOO_LARGE, verified live; there is no upload
 * endpoint), so a downscaled image beats a dead node. Modern image models routinely
 * return 4K PNGs (~13 MB as base64), which killed every generate→animate/edit chain.
 * Browser hosts may inject ctx.fitImage (canvas path); default is local-media's
 * (pure-JS for PNG, ffmpeg otherwise). http(s) URLs and already-fitting images pass
 * through untouched.
 */
async function fitImage(url, ctx, what) {
  if (url == null) return url;
  const fit = (ctx && ctx.fitImage) || fitImageInline;
  const out = await fit(url, mediaOpts(ctx));
  if (out !== url && ctx && ctx.progress) ctx.progress(what + " resized to fit the ~4 MB send limit");
  return out;
}

function collectPorts(inp, re) {
  return Object.keys(inp)
    .filter((k) => re.test(k))
    .sort((a, b) => portIdx(a) - portIdx(b))
    .map((k) => inp[k])
    .filter(Boolean);
}

function promptOf(n, inp, errMsg) {
  const raw = inp.prompt != null ? inp.prompt : n.fields.prompt != null ? n.fields.prompt : "";
  const p = String(raw).trim();
  if (!p && errMsg) throw new NanoodleError(errMsg);
  return p;
}

/**
 * Wired audio data: URL → OpenAI-style inline input_audio part (base64 body, no data: prefix).
 * Callers must inline https URLs first (ctx.fetchMedia) — the spec mandates base64 bytes, and
 * shipping a raw URL string as "base64 data" makes a paid call with garbage audio.
 */
function audioInputPart(url) {
  if (typeof url !== "string" || !url) return null;
  if (!/^data:/i.test(url)) {
    throw new NanoodleError("audio input must be a data: URL — download the clip and inline it before building the chat part");
  }
  if (url.length > MEDIA_INLINE_MAX) {
    throw new NanoodleError("audio clip is too large to inline (~4 MB send limit) — use a shorter clip");
  }
  const comma = url.indexOf(",");
  const head = comma >= 0 ? url.slice(0, comma) : "";
  const data = comma >= 0 ? url.slice(comma + 1) : url;
  const mt = head.match(/data:([^;]+)/);
  let fmt = ((mt && mt[1] ? mt[1].split("/")[1] : "") || "wav").toLowerCase();
  if (fmt === "mpeg" || fmt === "mp3") fmt = "mp3";
  else if (fmt === "x-wav" || fmt === "wave") fmt = "wav";
  return { type: "input_audio", input_audio: { data, format: fmt } };
}

function llmOpts(n) {
  const f = n.fields, o = {};
  if (f.temperature != null && f.temperature !== "") o.temperature = +f.temperature;
  if (f.maxTokens) o.max_tokens = +f.maxTokens;
  if (f.format === "JSON") o.response_format = { type: "json_object" };
  if (f.reasoningEffort && f.reasoningEffort !== "default") o.reasoning_effort = f.reasoningEffort;
  if (f.showThinking === true || f.showThinking === "true") o.showThinking = true;
  return o;
}

/* ---------- LoRA (image/video style adapters) — verbatim behavior from the app runtime ----------
   HuggingFace + any direct .safetensors URL; the URL is forwarded to NanoGPT and pulled
   server-side. CivitAI links are signed/login-gated, so we reject them with guidance BEFORE
   the paid call instead of eating a charged 422. */
function normalizeLoraUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return "";
  if (/\b(civitai\.com|civitai\.red|civit\.ai)\b/i.test(u)) {
    throw new NanoodleError("CivitAI links can't be fetched directly — download the .safetensors and re-host it (e.g. on HuggingFace), then paste that URL.");
  }
  if (/(^|\/\/|\.)huggingface\.co\//i.test(u)) {
    u = u.replace("/blob/", "/resolve/");
    if (!/\/resolve\/.+\.safetensors(\?|$)/i.test(u)) {
      throw new NanoodleError("Link the .safetensors file on HuggingFace: open it and use Copy download link (…/resolve/main/your-lora.safetensors).");
    }
    return u;
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(u)) {
    throw new NanoodleError("That looks like a HuggingFace repo id — open the .safetensors file and copy its download link (…/resolve/main/your-lora.safetensors).");
  }
  if (!/^https?:\/\//i.test(u)) {
    throw new NanoodleError("LoRA must be a direct https URL to a .safetensors file (HuggingFace or any host).");
  }
  return u;
}

function loraFamily(model) {
  const m = String(model || "");
  if (/spicy/i.test(m)) return null;
  if (/p-image/i.test(m)) return "pimage";
  if (/klein/i.test(m)) return "flux2klein";
  if (/flux-2/i.test(m)) return "flux2dev";
  if (/z-image/i.test(m)) return "zimage";
  if (/ltx/i.test(m)) return "ltx";
  if (/lora/i.test(m)) return "flux";
  return null;
}

function loraKind(type) { return (type === "image" || type === "edit" || type === "inpaint") ? "image" : "video"; }

function imageTakesLora(id) {
  id = String(id || "");
  if (/inpaint/i.test(id)) return false;
  if (/klein/i.test(id)) return true;
  return /(^|[-\/])lora($|[-\/])/i.test(id);
}

// name-based check (video by family, image by allow-list) — the editor already gated LoRA
// input to truly lora-capable models, so this stays in lockstep without a live catalog
function modelTakesLora(kind, id) {
  if (!id || loraFamily(id) == null) return false;
  return kind === "video" ? true : imageTakesLora(id);
}

function loraCap(model) {
  switch (loraFamily(model)) {
    case "flux2dev": return 4;
    case "flux2klein": case "zimage": case "ltx": return 3;
    default: return 1; // flux-lora, pimage — single slot
  }
}

function nodeLoras(n) {
  if (Array.isArray(n.fields.loras)) return n.fields.loras;
  if ((n.fields.loraUrl || "").trim() || (n.fields.loraStrength || "") !== "") {
    return [{ url: n.fields.loraUrl || "", strength: n.fields.loraStrength || "" }]; // legacy single-slot fields
  }
  return [];
}

function loraBodyFor(model, items) {
  const fam = loraFamily(model), sc = (v) => (isNaN(v) ? 1 : v);
  if (fam === "pimage") return { lora_weights: items[0].url, lora_scale: sc(items[0].scale) };
  if (fam === "flux2dev" || fam === "flux2klein" || fam === "zimage" || fam === "ltx") {
    const b = {};
    items.forEach((it, i) => { b["lora_url_" + (i + 1)] = it.url; b["lora_scale_" + (i + 1)] = sc(it.scale); });
    return b;
  }
  if (items.length === 1) return { lora_url: items[0].url, lora_strength: sc(items[0].scale) };
  return { loras: items.map((it) => ({ path: it.url, scale: sc(it.scale) })) };
}

/** LoRA body params for a node (SPEC-engine "+ LoRA params"): {} when the model takes none. */
function loraParams(n) {
  if (!modelTakesLora(loraKind(n.type), n.fields.model)) return {};
  const rows = nodeLoras(n).filter((r) => r && (r.url || "").trim());
  if (!rows.length) return {};
  const items = rows.slice(0, loraCap(n.fields.model)).map((r) => ({
    url: normalizeLoraUrl(r.url),
    scale: (r.strength == null || r.strength === "") ? 1 : Number(r.strength),
  }));
  return loraBodyFor(n.fields.model, items);
}

/* ---------- custom-civitai AIR normalization/validation (pre-charge, mirrors the app) ---------- */
function normalizeCustomCivitaiAir(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^civitai:\d+@\d+/i.test(s)) return s.replace(/^civitai:/i, "civitai:");
  if (/^persona:\d+@\d+/i.test(s)) return s.replace(/^persona:/i, "persona:");
  if (/^runware:[^\s@]+@[^\s@]+$/i.test(s)) return s.replace(/^runware:/i, "runware:");
  const bare = /^(\d+)@(\d+)$/.exec(s);
  if (bare) return "civitai:" + bare[1] + "@" + bare[2];
  const mid = /civitai\.com\/models\/(\d+)/i.exec(s);
  const vid = /[?&]modelVersionId=(\d+)/i.exec(s);
  if (mid && vid) return "civitai:" + mid[1] + "@" + vid[1];
  return s;
}

function isValidCustomAir(air) {
  return /^(civitai:\d+@\d+|persona:\d+@\d+|runware:[^\s@]+@[^\s@]+)$/i.test(air);
}

// FLUX-family platform AIRs are guidance-distilled (CFG=1) — a negative prompt has no effect, so
// omit it. Ids: 100/101 FLUX.1, 103/104 depth/canny, 106 kontext, 107 krea, 111 SRPO, 160 Flex.1,
// 400 FLUX.2/klein. Mirrors the app.
function airTakesNegative(air) { return !/^runware:(100|101|103|104|106|107|111|160|400)@/i.test(String(air || "")); }

// The NanoGPT catalog also lists AIR-style ids as DIRECT models (e.g. persona:376130@2456367) —
// same Runware path, same negative_prompt support, same FLUX gate.
function airModelTakesNegative(model) {
  const m = String(model || "");
  return /^(persona:|civitai:|runware:)/i.test(m) && airTakesNegative(m);
}

/** Per-call image extras: LoRA params + fixed seed (when numeric) + custom-civitai AIR. */
function imgExtra(n) {
  const e = loraParams(n);
  const s = n.fields.seed;
  if (s != null && String(s).trim() !== "" && !isNaN(Number(s))) e.seed = Number(s);
  if (n.fields.model === "custom-civitai") {
    const air = normalizeCustomCivitaiAir(n.fields.customCivitaiAir);
    if (!air) throw new NanoodleError("select a CivitAI model — pick a preset or paste an AIR (civitai:/runware:/persona:…)");
    if (!isValidCustomAir(air)) {
      throw new NanoodleError("AIR must look like civitai:MODEL@VERSION, runware:id@rev, or persona:MODEL@VERSION");
    }
    e.customCivitaiAir = air;
    // snake_case only — negativePrompt (camelCase) is silently dropped by the API; same-seed
    // probe on persona:376130@2456367 confirmed negative_prompt reaches the sampler (2026-07-18)
    const np = String(n.fields.negativePrompt || "").trim();
    if (np && airTakesNegative(air)) e.negative_prompt = np;
  } else if (airModelTakesNegative(n.fields.model)) {
    const np = String(n.fields.negativePrompt || "").trim();
    if (np) e.negative_prompt = np;
  }
  return e;
}

/**
 * Video dims. Standard wire names by default; with a catalog, the chosen model's
 * declared param names win (aspect → aspect_ratio | orientation | resolution_ratio,
 * duration → duration | seconds) and blank fields backfill from the catalog default —
 * mirrors play's videoDimParams so Sora/WAN-style models honour the chosen dims.
 */
function videoDims(n, ctx) {
  const out = {};
  const f = n.fields;
  const m = catItem(ctx && ctx.catalog, "video", f.model);
  const p = (m && m.supported_parameters && m.supported_parameters.parameters) || {};
  const aP = p.aspect_ratio || p.orientation || p.resolution_ratio;
  const aWire = p.aspect_ratio ? "aspect_ratio" : p.orientation ? "orientation" : p.resolution_ratio ? "resolution_ratio" : "aspect_ratio";
  const dP = p.duration || p.seconds;
  const dWire = p.duration ? "duration" : p.seconds ? "seconds" : "duration";
  let asp = f.aspect, dur = f.duration;
  if ((asp == null || asp === "") && aP && aP.default != null) asp = aP.default;
  if ((dur == null || dur === "") && dP && dP.default != null) dur = dP.default;
  if (f.resolution != null && f.resolution !== "") out.resolution = f.resolution;
  if (asp != null && asp !== "") out[aWire] = asp;
  if (dur != null && dur !== "") out[dWire] = dur;
  return out;
}

/* ---------- reference-image wire key + cap (mirrors play's modelAllowsRefs) ----------
   Video models disagree on the ref-array param name AND its size limit; sending the wrong
   key silently degrades to a plain video, sending too many can over-bill. Resolve the
   model's REAL key from the catalog and clamp to its declared max. */
function refMaxFor(model) {
  const id = String(model || "");
  if (/seedance/i.test(id)) return 9;
  if (/luma|ray/i.test(id)) return 4;
  return 4;
}

/**
 * {key, cap} for the model's reference-image param, or null when the model is KNOWN
 * not to take refs. Catalog-absent / no-catalog models honor authored wires under the
 * most common spelling (a wrong guess degrades the render, it never double-charges).
 */
function modelRefSpec(model, ctx) {
  const keys = ["reference_images", "reference_image_urls", "referenceImages"];
  const m = catItem(ctx && ctx.catalog, "video", model);
  if (!m) return { key: "reference_images", cap: refMaxFor(model) };
  const sp = m.supported_parameters || {}, pp = sp.parameters || sp;
  const key = keys.find((k) => k in pp);
  if (!key) return null; // known model with no ref-image param
  const d = pp[key];
  let cap = null;
  if (d && typeof d === "object") {
    const mx = d.max != null ? d.max : d.maxItems != null ? d.maxItems : d.max_items;
    if (mx != null && +mx > 0) cap = +mx;
  }
  return { key, cap: cap != null ? cap : refMaxFor(model) };
}

/** Attach wired refs to video opts under the model's real key, clamped to its cap (twin of the app runtimes: say so, never silently discard). */
function applyRefs(opts, refs, n, ctx) {
  if (!refs.length) return;
  const spec = modelRefSpec(mdl(n), ctx);
  if (spec && spec.key) {
    opts.refImages = refs.slice(0, spec.cap);
    opts.refKey = spec.key;
    if (refs.length > spec.cap && ctx && ctx.progress) {
      ctx.progress("dropped " + (refs.length - spec.cap) + " reference image(s) over this model's limit of " + spec.cap);
    }
  } else if (ctx && ctx.progress) {
    ctx.progress("reference image(s) ignored — this model doesn't support them");
  }
}

function videoSourceOpts(url) {
  return /^https?:/i.test(url) ? { videoUrl: url } : { videoDataUrl: url };
}

function audioSourceOpts(url) {
  return /^https?:/i.test(url) ? { audioUrl: url } : { audioDataUrl: url };
}

const nonEmpty = (v) => v != null && String(v).trim() !== "";

/**
 * Faithful to the app's collectAudioParams: only-when-nonempty, defaults omitted,
 * then fields.extraJson merged verbatim last. With an opt-in catalog, the cat:*
 * applies gates match play: a param is dropped only when the chosen model is IN
 * the catalog and doesn't advertise it (duration needs a min/max_duration range;
 * remix duration additionally needs per-second pricing; tts voice needs a voice
 * list). No catalog → send-everything fallback, exactly like an offline export.
 */
function audioParams(n, ctx) {
  const f = n.fields, body = {};
  const num = (v) => { const x = Number(v); return isNaN(x) ? null : x; };
  const m = catItem(ctx && ctx.catalog, "audio", f.model);
  const sp = (m && m.supported_parameters) || null;
  const durOk = !sp || (sp.min_duration != null && sp.max_duration != null);                                     // cat:duration
  const secDurOk = !sp || (sp.min_duration != null && sp.max_duration != null && +((m.pricing || {}).per_second) > 0); // cat:secduration
  const voiceOk = !sp || (Array.isArray(sp.voices) && sp.voices.length > 0);                                     // cat:voices
  if (n.type === "music") {
    if (nonEmpty(f.lyrics)) body.lyrics = f.lyrics;
    if (f.instrumental === true || f.instrumental === "true") body.instrumental = true;
    if (nonEmpty(f.duration) && num(f.duration) != null && durOk) body.duration = num(f.duration);
    if (nonEmpty(f.negative_prompt)) body.negative_prompt = f.negative_prompt;
    if (nonEmpty(f.seed) && num(f.seed) != null) body.seed = num(f.seed);
    if (nonEmpty(f.response_format) && f.response_format !== "mp3") body.response_format = f.response_format;
  } else if (n.type === "tts") {
    if (nonEmpty(f.voice) && voiceOk) body.voice = f.voice;
    if (nonEmpty(f.speed) && num(f.speed) != null && num(f.speed) !== 1) body.speed = num(f.speed); // omit when 1
    if (nonEmpty(f.instructions)) body.instructions = f.instructions;
    if (nonEmpty(f.response_format) && f.response_format !== "mp3") body.response_format = f.response_format;
  } else if (n.type === "remix") {
    if (nonEmpty(f.lyrics)) body.lyrics = f.lyrics;
    if (nonEmpty(f.duration) && num(f.duration) != null && secDurOk) body.duration = num(f.duration);
    if (nonEmpty(f.response_format) && f.response_format !== "mp3") body.response_format = f.response_format;
  }
  if ((f.extraJson || "").trim()) {
    try { Object.assign(body, JSON.parse(f.extraJson)); }
    catch { throw new NanoodleError("advanced params: invalid JSON in extraJson"); }
  }
  // Re-enforce the surface-one-track contract AFTER extraJson (twin of the app runtime): advanced
  // params can reintroduce number_of_songs / generation_count / n and bill N songs while the runner
  // only keeps the single returned URL. Drop every song-count key (omit = one track at the model
  // default). remix shares the extraJson escape hatch and surfaces one URL too — same clamp.
  if (n.type === "music" || n.type === "remix") {
    for (const k of Object.keys(body)) {
      if (/^(number_of_songs|n|num_songs|song_count|generation_count|generation_count_parameter)$/i.test(k)
        || /generation_count|num_?songs|song_?count/i.test(k)) delete body[k];
    }
  }
  return body;
}

function chatMessages(n, prompt, imgs, audioPart) {
  const messages = [];
  if ((n.fields.system || "").trim()) messages.push({ role: "system", content: n.fields.system.trim() });
  messages.push(imgs.length || audioPart
    ? {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...imgs.map((url) => ({ type: "image_url", image_url: { url } })),
          ...(audioPart ? [audioPart] : []),
        ],
      }
    : { role: "user", content: prompt });
  return messages;
}

function guardRefsSize(imgs) {
  if (imgs.reduce((s, u) => s + (u ? u.length : 0), 0) > MEDIA_INLINE_MAX) {
    throw new NanoodleError("reference images too large (~4 MB combined limit) — use fewer or smaller images");
  }
}

/**
 * Per-node executors. Each: async run(node, inp, ctx) → out map keyed by output port name.
 * `node.fields` already carries wired field overrides + user inputs + settings.
 * ctx = { chat, chatImage, image, video, audio, transcribe, progress } (cost/poll wired by the engine).
 */
const RUNNERS = {
  async text(n) { return { text: n.fields.text || "" }; },

  async upload(n) {
    if (!n.fields.image) {
      if (optionalNode(n)) return { image: "" }; // skipped optional input — consumers drop empty media (collectPorts)
      throw new NanoodleError("no image — this Image input has no image");
    }
    return { image: n.fields.image };
  },
  async aupload(n) {
    if (!n.fields.audio) {
      if (optionalNode(n)) return { audio: "" };
      throw new NanoodleError("no audio — this Audio input has no clip");
    }
    return { audio: n.fields.audio };
  },
  async vupload(n) {
    if (!n.fields.video) {
      if (optionalNode(n)) return { video: "" };
      throw new NanoodleError("no video — this Video input has no clip");
    }
    return { video: n.fields.video };
  },

  async choice(n) {
    const opts = String(n.fields.options || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const sel = n.fields.selected;
    const val = sel != null && opts.indexOf(sel) >= 0 ? sel : opts[0] || "";
    if (!val) throw new NanoodleError("no options — this Choice has no options to pick from");
    return { text: val };
  },

  async join(n, inp) {
    const sep = (n.fields.sep != null ? n.fields.sep : " ").replace(/\\n/g, "\n");
    return { text: [inp.a, inp.b].filter((v) => v != null && v !== "").join(sep) };
  },

  // ---- local media (pure-JS first like the browser; ffmpeg soft fallback) ----

  async resize(n, inp, ctx) {
    if (!inp.image) throw new NanoodleError("no image input");
    const media = mediaOpts(ctx);
    return {
      image: await resizeCropImage(inp.image, n.fields.mode || "fit", n.fields.width, n.fields.height, media),
    };
  },

  async vframes(n, inp, ctx) {
    if (!inp.video) throw new NanoodleError("no video input");
    const media = mediaOpts(ctx);
    return extractVideoFrames(inp.video, {
      count: n.fields.frames,
      gap: n.fields.gap,
      dir: n.fields.dir || "end",
      ...media,
      onProgress: ctx && ctx.progress,
    });
  },

  async combine(n, inp, ctx) {
    // Browser wires vid1..; some docs/saves use clip1.. — accept both, ordered by port number
    // (not CLIP-then-VID, which reorders mixed graphs).
    const keys = Object.keys(inp)
      .filter((k) => CLIP_PORT_RE.test(k) || VID_PORT_RE.test(k))
      .sort((a, b) => portIdx(a) - portIdx(b) || a.localeCompare(b));
    const clips = [];
    const seen = new Set();
    for (const k of keys) {
      const v = inp[k];
      if (!v || seen.has(v)) continue;
      seen.add(v);
      clips.push(v);
    }
    if (clips.length < 2) throw new NanoodleError("wire at least two clips to combine");
    const dedup = n.fields.dedup == null ? true
      : !(n.fields.dedup === false || n.fields.dedup === "false" || n.fields.dedup === 0 || n.fields.dedup === "0");
    const media = mediaOpts(ctx);
    return { video: await concatVideos(clips, dedup, { ...media, onProgress: ctx && ctx.progress }) };
  },

  async soundtrack(n, inp, ctx) {
    if (!inp.video) throw new NanoodleError("no video input");
    if (!inp.audio) throw new NanoodleError("no audio input");
    const loop = n.fields.loop === true || n.fields.loop === "true" || n.fields.loop === 1 || n.fields.loop === "1";
    const media = mediaOpts(ctx);
    return { video: await muxSoundtrack(inp.video, inp.audio, loop, { ...media, onProgress: ctx && ctx.progress }) };
  },

  async trim(n, inp, ctx) {
    if (!inp.audio) throw new NanoodleError("no audio input");
    const start = parseFloat(n.fields.start) || 0;
    const length = parseFloat(n.fields.length);
    return { audio: await trimAudioToWav(inp.audio, start, Number.isFinite(length) ? length : 30, 16000, mediaOpts(ctx)) };
  },

  async extractaudio(n, inp, ctx) {
    if (!inp.video) throw new NanoodleError("no video input");
    const start = parseFloat(n.fields.start) || 0;
    const lenRaw = parseFloat(n.fields.length);
    const length = (Number.isFinite(lenRaw) && lenRaw > 0) ? lenRaw : 0;
    return { audio: await extractAudioToWav(inp.video, start, length, 16000, mediaOpts(ctx)) };
  },

  async llm(n, inp, ctx) {
    const prompt = promptOf(n, inp, "no prompt");
    const imgs = await Promise.all(collectPorts(inp, IMG_PORT_RE).map((u) => fitImage(u, ctx, "wired image")));
    // hosted audio (music/tts nodes return https CDN URLs verbatim) → download + inline as base64:
    // the chat input_audio part carries bytes, never a URL
    let audioPart = null;
    if (inp.audio) {
      // a KNOWN text-only model can't hear the (large, still-billed) input_audio part — drop it
      // and note it; permissive for catalog-absent models (mirrors play's chatModelCan gate)
      if (chatModelCan(ctx.catalog, mdl(n), "audio_input")) {
        const audioSrc = /^https?:/i.test(inp.audio) ? await ctx.fetchMedia(inp.audio) : inp.audio;
        audioPart = audioInputPart(audioSrc);
      } else {
        ctx.progress("audio ignored — this model is text-only");
      }
    }
    const messages = chatMessages(n, prompt, imgs, audioPart);
    // JSON response_format on a non-structured_output model bills but returns empty — strip it
    const opts = llmOpts(n);
    if (opts.response_format && !chatModelCan(ctx.catalog, mdl(n), "structured_output")) delete opts.response_format;
    return { text: await ctx.chat(messages, mdl(n), opts) };
  },

  async vision(n, inp, ctx) {
    if (!inp.image) throw new NanoodleError("no image input");
    const q = (n.fields.q || "Describe this image.").trim();
    const img = await fitImage(inp.image, ctx, "image");
    const messages = [{
      role: "user",
      content: [{ type: "text", text: q }, { type: "image_url", image_url: { url: img } }],
    }];
    return { text: await ctx.chat(messages, mdl(n), {}) };
  },

  async image(n, inp, ctx) {
    const prompt = promptOf(n, inp, "no prompt");
    let want = Math.max(1, parseInt(n.fields.variations, 10) || 1);
    // clamp to the model's real max output (catalog item present but silent → 1, the
    // conservative default; absent → unclamped) so we never bill for surplus images
    const catIt = catItem(ctx.catalog, "image", mdl(n));
    if (catIt) want = Math.min(want, (catIt.supported_parameters && catIt.supported_parameters.max_output_images) || 1);
    const urls = await ctx.image({ prompt, model: mdl(n), size: n.fields.size || "1024x1024", extra: imgExtra(n), n: want, multi: true });
    const sel = Math.min(Math.max(0, parseInt(n.fields.sel, 10) || 0), urls.length - 1);
    return { image: urls[sel], images: urls };
  },

  async edit(n, inp, ctx) {
    let imgs = collectPorts(inp, EDIT_IMG_RE);
    if (!imgs.length) throw new NanoodleError("no image input");
    // cap to the model's max_input_images (item present but silent → 1; absent → no cap):
    // a baked graph can carry more refs than a later-swapped model composites
    const m = catItem(ctx.catalog, "image", n.fields.model);
    if (m) {
      const mi = m.supported_parameters && m.supported_parameters.max_input_images;
      const cap = mi > 0 ? mi : 1;
      if (imgs.length > cap) {
        ctx.progress(`dropped ${imgs.length - cap} image(s) over this model's limit`);
        imgs = imgs.slice(0, cap);
      }
    }
    const prompt = promptOf(n, inp);
    if (!prompt && !/upscal/i.test(n.fields.model || "")) throw new NanoodleError("no edit instruction");
    imgs = await Promise.all(imgs.map((u) => fitImage(u, ctx, "source image")));
    guardRefsSize(imgs);
    const src = imgs.length > 1 ? imgs : imgs[0]; // array → multi-image composite; string → single edit
    return { image: await ctx.image({ prompt, model: mdl(n), size: n.fields.size || "1024x1024", imageDataUrl: src, extra: imgExtra(n) }) };
  },

  async draw(n, inp, ctx) {
    const prompt = promptOf(n, inp, "no prompt");
    const imgs = await Promise.all(collectPorts(inp, IMG_PORT_RE).map((u) => fitImage(u, ctx, "wired image")));
    guardRefsSize(imgs);
    const messages = chatMessages(n, prompt, imgs, null);
    const res = await ctx.chatImage(messages, mdl(n), {});
    const sel = Math.min(Math.max(0, parseInt(n.fields.sel, 10) || 0), res.images.length - 1);
    const showThinking = n.fields.showThinking !== false && n.fields.showThinking !== "false";
    const text = showThinking && res.reasoning
      ? "```thinking\n" + res.reasoning + "\n```\n\n" + (res.text || "")
      : res.text;
    return { image: res.images[sel], images: res.images, text };
  },

  async inpaint(n, inp, ctx) {
    const source = inp.image != null ? inp.image : n.fields.image;
    const rawMask = inp.mask != null ? inp.mask : n.fields.mask;
    if (!source) throw new NanoodleError("no image — supply the image to repaint");
    if (!rawMask) throw new NanoodleError("no mask — supply a B/W mask (white = repaint)");
    const prompt = promptOf(n, inp, "no prompt — say what to paint into the masked area");
    // Match play.html maskToSource: composite mask onto black at the source's pixel size.
    // ctx.maskToSource lets a browser host inject its canvas compositor (handles JPEG/WebP
    // sources the pure-PNG path can't, where ffmpeg isn't an option).
    const mask = await (ctx.maskToSource || maskToSource)(rawMask, source, mediaOpts(ctx));
    return { image: await ctx.image({ prompt, model: mdl(n), size: n.fields.size || "1024x1024", imageDataUrl: source, maskDataUrl: mask, extra: imgExtra(n) }) };
  },

  async tvideo(n, inp, ctx) {
    const prompt = promptOf(n, inp, "no prompt");
    const opts = { ...videoDims(n, ctx), lora: loraParams(n), extra: n.fields.modelOpts || {} };
    applyRefs(opts, collectPorts(inp, REF_PORT_RE), n, ctx);
    return { video: await ctx.video(mdl(n), prompt, opts, null) };
  },

  async ivideo(n, inp, ctx) {
    if (!inp.image) throw new NanoodleError("no image input");
    const prompt = promptOf(n, inp);
    const opts = { ...videoDims(n, ctx), lora: loraParams(n), extra: n.fields.modelOpts || {} };
    if (inp.endframe) opts.last_image = await fitImage(inp.endframe, ctx, "end frame");
    return { video: await ctx.video(mdl(n), prompt, opts, await fitImage(inp.image, ctx, "source image")) };
  },

  async vedit(n, inp, ctx) {
    if (!inp.video) throw new NanoodleError("no video input");
    const prompt = promptOf(n, inp);
    const opts = { ...videoSourceOpts(inp.video), ...videoDims(n, ctx), lora: loraParams(n), extra: n.fields.modelOpts || {} };
    applyRefs(opts, collectPorts(inp, REF_PORT_RE), n, ctx); // ref wires (seedance video-edit family) — same key/cap resolution as tvideo
    return { video: await ctx.video(mdl(n), prompt, opts, null) };
  },

  async lipsync(n, inp, ctx) {
    if (!inp.image) throw new NanoodleError("no image input");
    if (!inp.audio) throw new NanoodleError("no audio input");
    const prompt = promptOf(n, inp);
    // Avatar models cap audio length (LongCat = 30s) and the cap isn't reliably in the catalog,
    // so submit the audio as-is first (a remote song rides full-length as a url). If the model
    // REJECTS the submit (HTTP error — not yet charged), read its real cap from the error, trim
    // to fit (mono WAV) and retry ONCE; an oversize local clip that can't inline trims to 15s.
    // NEVER auto-retry after a post-submit job failure ("video failed: …"): that path already
    // reserved credits, and a second submit would double-charge. (Twin of the app runtimes.)
    // ctx.trimAudio lets a browser host inject its Web Audio trimmer so the retry bytes match
    // its built-in runner exactly; default is the local-media trimmer (pure-JS WAV, ffmpeg).
    const trim = ctx.trimAudio || ((url, start, len, rate) => trimAudioToWav(url, start, len, rate, mediaOpts(ctx)));
    const img = await fitImage(inp.image, ctx, "portrait image");
    let trimSec = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      let opts;
      if (trimSec != null) {
        if (ctx.progress) ctx.progress("trimming audio to " + Math.round(trimSec) + "s…");
        let trimmed;
        try { trimmed = await trim(inp.audio, 0, trimSec, 24000); }
        catch (e) {
          // a hosted song's CDN may refuse byte downloads (browser CORS) — surface the model's
          // cap and the way out instead of a bare "Failed to fetch"
          if (/^https?:/i.test(inp.audio)) {
            throw new NanoodleError("This avatar model accepts about " + Math.round(trimSec) + "s of audio, but the source track can't be downloaded to trim (the provider's audio CDN blocks it). Shorten it at the source — e.g. set the Music node's length to " + Math.round(trimSec) + "s or less — or use a Speech node (its audio can be trimmed).");
          }
          throw e;
        }
        opts = { audioDataUrl: trimmed };
      } else {
        opts = audioSourceOpts(inp.audio);
      }
      Object.assign(opts, videoDims(n, ctx));
      opts.extra = n.fields.modelOpts || {};
      try {
        return { video: await ctx.video(mdl(n), prompt, opts, img) };
      } catch (e) {
        if (attempt > 0) throw e;
        const msg = (e && e.message) || "";
        if (/^video failed:/i.test(msg)) throw e; // post-submit poll failure: already charged — no second job
        const cap = /up to\s+(\d+(?:\.\d+)?)\s*second/i.exec(msg);
        if (cap && /INVALID_AUDIO_DURATION|audio.{0,15}duration/i.test(msg)) {
          trimSec = Math.min(60, Math.max(1, parseFloat(cap[1]) - 0.1)); // the model told us its real cap
        } else if (/\blarge\b|MEDIA_INLINE|~4 MB|inline/i.test(msg)) {
          trimSec = 15; // oversize local clip → safe default (a 30s guess can re-trip a 30s-cap avatar)
        } else if (/left.{0,6}audio|right.{0,6}audio|left and right/i.test(msg)) {
          throw new NanoodleError("This avatar model needs two separate audio tracks (multi-speaker). Pick a single-speaker avatar model.");
        } else throw e;
      }
    }
  },

  async music(n, inp, ctx) {
    const text = promptOf(n, inp, "no prompt — describe the track");
    return { audio: await ctx.audio(mdl(n), text, audioParams(n, ctx)) };
  },

  async tts(n, inp, ctx) {
    const text = promptOf(n, inp, "no text — give the Speech node something to say");
    return { audio: await ctx.audio(mdl(n), text, audioParams(n, ctx)) };
  },

  async remix(n, inp, ctx) {
    if (!inp.audio) throw new NanoodleError("no audio — wire a source track into the audio port");
    const text = promptOf(n, inp, "no prompt — describe the cover / extension first");
    const params = audioParams(n, ctx);
    // https source rides as-is (providers take hosted URLs); local data: is inlined
    if (/^https?:/i.test(inp.audio)) params.audio = inp.audio;
    else {
      if (inp.audio.length > MEDIA_INLINE_MAX) {
        throw new NanoodleError("source audio is too large to inline (~4 MB send limit) — use a shorter clip");
      }
      params.audio = inp.audio;
    }
    return { audio: await ctx.audio(mdl(n), text, params) };
  },

  async transcribe(n, inp, ctx) {
    if (!inp.audio) throw new NanoodleError("no audio input");
    return { text: await ctx.transcribe(mdl(n), inp.audio, (n.fields.language || "auto").trim()) };
  },
};

__x.loraParams = loraParams; __x.RUNNERS = RUNNERS;
});
__def("catalog.mjs", function (__x, __req) {
/**
 * Opt-in model catalog (replace-prep: catalog gates behave like play RUNTIME_JS).
 *
 * Data-only: pass `{ catalog: { chat, image, video, audio } }` to Workflow with
 * the raw arrays the NanoGPT public catalog endpoints return (/api/v1/models,
 * /api/v1/image-models, …) — the library never fetches them itself. Every gate
 * is permissive: no catalog, or a model absent from it, changes nothing, so
 * authored graphs keep their behavior offline. Only a KNOWN-incapable model has
 * the gated part/knob stripped (mirrors play's chatModelCan / rawCatItem).
 */

function catItem(catalog, kind, id) {
  if (!catalog || !id) return null;
  const raw = catalog[kind];
  return (Array.isArray(raw) && raw.find((m) => m && m.id === id)) || null;
}

/** Permissive capability probe: true unless the model is in the catalog AND lacks the flag. */
function chatModelCan(catalog, model, flag) {
  const m = catItem(catalog, "chat", model);
  return !m || !!((m.capabilities || {})[flag]);
}

__x.catItem = catItem; __x.chatModelCan = chatModelCan;
});
__def("io.mjs", function (__x, __req) {
const { NanoodleError } = __req("errors.mjs");
const { NODE_TYPES, displayName, optionalNode, topoSort, wiredFramesFloor, MAX_FRAMES } = __req("graph.mjs");

/* ============================== INPUTS ============================== */

/** Which node types contribute user inputs, and with what fields (mirrors play.html INPUT_SPECS). */
const INPUT_SPECS = {
  text:    [{ f: "text",   label: "Text",  kind: "textarea" }],
  upload:  [{ f: "image",  label: "Image", kind: "image" }],
  aupload: [{ f: "audio",  label: "Audio", kind: "audio" }],
  vupload: [{ f: "video",  label: "Video", kind: "video" }],
  llm:     [{ f: "prompt", label: "Prompt", kind: "textarea" },
            { f: "system", label: "System prompt", kind: "textarea", optional: true, def: "You are a helpful, concise assistant." }],
  image:   [{ f: "prompt", label: "Image prompt", kind: "textarea" }],
  draw:    [{ f: "prompt", label: "Prompt", kind: "textarea" },
            { f: "system", label: "System prompt", kind: "textarea", optional: true }],
  tvideo:  [{ f: "prompt", label: "Video prompt", kind: "textarea" }],
  music:   [{ f: "prompt", label: "Style / prompt", kind: "textarea" }],
  remix:   [{ f: "prompt", label: "Style / direction", kind: "textarea" }],
  tts:     [{ f: "prompt", label: "Text to speak", kind: "textarea" }],
};

/**
 * Derive the workflow's user inputs: INPUT_SPECS fields not fed by a wire, plus the
 * inpaint / choice special cases. Each entry gets a unique friendly `key`.
 * @returns [{ key, nodeId, field, kind, label, optional, def, options?, title }]
 */
function deriveInputs(graph) {
  const fed = (id, port) => graph.links.some((l) => l.to.node === id && l.to.port === port);
  const entries = [];
  const mk = (n, field, label, kind, optional, specDef) => {
    const cur = n.fields[field];
    return {
      nodeId: n.id, field, label, kind, optional: !!optional || optionalNode(n),
      def: cur != null && String(cur) !== "" ? cur : specDef,
      title: displayName(n), _node: n,
    };
  };
  for (const n of graph.nodes) {
    if (n.unknown) continue;
    if (n.type === "inpaint") {
      if (!fed(n.id, "prompt")) entries.push(mk(n, "prompt", "What to paint in", "textarea", false));
      // image and/or mask surface whenever not wired (SPEC-io). The app's combined brush widget
      // captures both at once when neither is wired; the library derives two plain image inputs —
      // dropping the mask half would make such graphs un-runnable (the sink needs a mask, and
      // "n.mask" wouldn't even resolve as an input key).
      const imgFed = fed(n.id, "image"), maskFed = fed(n.id, "mask");
      if (!imgFed) entries.push(mk(n, "image", maskFed ? "Image" : "Image — the picture to repaint", "image", false));
      if (!maskFed) entries.push(mk(n, "mask", "Mask (white = repaint)", "image", false));
      continue;
    }
    if (n.type === "choice") {
      const options = String(n.fields.options || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const e = { ...mk(n, "selected", "Choice", "choice", false), options };
      // The play page renders this input as a <select>, which always holds a value: an unset or
      // stale `selected` shows (and submits) the FIRST option — mirror that here, matching the
      // choice runner's own fallback, instead of tripping the upfront required-input check.
      if (e.def == null || !options.includes(String(e.def))) e.def = options[0];
      entries.push(e);
      continue;
    }
    const specs = INPUT_SPECS[n.type];
    if (!specs) continue;
    for (const s of specs) {
      if (fed(n.id, s.f)) continue;
      entries.push(mk(n, s.f, s.label, s.kind, s.optional, s.def));
    }
  }
  // Friendly keys: a node's custom name labels its input when it contributes exactly one
  // REQUIRED input (app PR #138) — or exactly one input at all, so an author-optional
  // renamed node (e.g. an optional "Style reference" upload) keeps its name as the key.
  // Otherwise the generic spec label. Dedupe with " 2", " 3".
  const used = new Map();
  for (const e of entries) {
    const nodeEntries = entries.filter((x) => x.nodeId === e.nodeId);
    const required = nodeEntries.filter((x) => !x.optional);
    const custom = (e._node.name || "").trim();
    const names = (required.length === 1 && required[0] === e) ||
                  (required.length === 0 && nodeEntries.length === 1);
    let key = custom && names ? custom : e.label;
    const lower = key.toLowerCase();
    const count = (used.get(lower) || 0) + 1;
    used.set(lower, count);
    if (count > 1) key = key + " " + count;
    e.key = key;
  }
  for (const e of entries) delete e._node;
  return entries;
}

function ambiguous(userKey, candidates) {
  return new NanoodleError(
    `input "${userKey}" is ambiguous — matches ${candidates.map((c) => `${c.nodeId}.${c.field} ("${c.key}")`).join(", ")}; ` +
    "use the nodeId.field form to disambiguate");
}

/**
 * Resolve a user-supplied input name to a derived input entry (case-insensitive, trimmed).
 * Order: derived key → exact node custom name → nodeId.field / bare nodeId → label/field if unique.
 */
function resolveInputKey(graph, inputs, userKey) {
  const norm = String(userKey).trim().toLowerCase();
  const byKey = inputs.filter((i) => i.key.toLowerCase() === norm);
  if (byKey.length === 1) return byKey[0];

  const named = graph.nodes.filter((n) => (n.name || "").trim().toLowerCase() === norm);
  if (named.length) {
    const cand = inputs.filter((i) => named.some((n) => n.id === i.nodeId));
    if (cand.length === 1) return cand[0];
    if (cand.length > 1) throw ambiguous(userKey, cand);
  }

  const dot = norm.lastIndexOf(".");
  if (dot > 0) {
    const nid = norm.slice(0, dot), field = norm.slice(dot + 1);
    const hit = inputs.find((i) => i.nodeId.toLowerCase() === nid && i.field.toLowerCase() === field);
    if (hit) return hit;
    const node = graph.nodes.find((n) => n.id.toLowerCase() === nid);
    if (node && graph.links.some((l) => l.to.node === node.id && l.to.port.toLowerCase() === field)) {
      throw new NanoodleError(`"${userKey}" is wired from another node in this workflow and can't be supplied as an input`);
    }
  }
  const byNode = inputs.filter((i) => i.nodeId.toLowerCase() === norm);
  if (byNode.length === 1) return byNode[0];
  if (byNode.length > 1) throw ambiguous(userKey, byNode);

  const byLabel = inputs.filter((i) => i.label.toLowerCase() === norm || i.field.toLowerCase() === norm);
  if (byLabel.length === 1) return byLabel[0];
  if (byLabel.length > 1) throw ambiguous(userKey, byLabel);

  const avail = inputs.map((i) => `"${i.key}"`).join(", ") || "(none)";
  throw new NanoodleError(`unknown input "${userKey}" — available inputs: ${avail}`);
}

/* ============================== OUTPUTS ============================== */

/**
 * Output nodes = nodes with outputs and no outgoing link (sinks).
 * Keyed by display name; duplicates suffixed " 2", " 3" in topological order. Always also
 * addressable by node id (handled at result-build time).
 * @returns [{ key, nodeId, type, ports }]
 */
function deriveOutputs(graph) {
  let ordered;
  try { ordered = topoSort(graph); } catch { ordered = graph.nodes; } // cyclic graphs still get keys; run() errors properly
  const sinks = ordered.filter((n) => {
    if (n.unknown) return false;
    const t = NODE_TYPES[n.type];
    if (!t.outputs || !t.outputs.length) return false;
    return !graph.links.some((l) => l.from.node === n.id);
  });
  const used = new Map();
  return sinks.map((n) => {
    let key = displayName(n);
    const lower = key.toLowerCase();
    const count = (used.get(lower) || 0) + 1;
    used.set(lower, count);
    if (count > 1) key = key + " " + count;
    const t = NODE_TYPES[n.type];
    let ports = t.outputs.map((p) => ({ ...p }));
    // vframes grows frame1..frameN from max(fields.frames, wired floor) (mirrors browser)
    if (n.type === "vframes") {
      const authored = Math.max(1, Math.min(MAX_FRAMES, parseInt(n.fields && n.fields.frames, 10) || 1));
      const count = Math.max(authored, wiredFramesFloor(graph, n.id));
      ports = [];
      for (let i = 1; i <= count; i++) ports.push({ name: "frame" + i, type: "image" });
    }
    return { key, nodeId: n.id, type: n.type, ports };
  });
}

/* ============================== SETTINGS ============================== */

// Option lists verbatim from play.html (SIZES line 897, DURATIONS line 3232).
const SIZES = ["1024x1024", "1024x1536", "1536x1024", "auto"];
const DURATIONS = ["5", "10"];

/** Per-node knobs that are not part of the IO shape (mirrors play.html SETTING_SPECS). */
const SETTING_SPECS = {
  llm: [
    { f: "model", label: "Model", kind: "model" },
    { f: "temperature", label: "Temperature", kind: "number", def: "0.8" },
    { f: "maxTokens", label: "Max tokens", kind: "number" },
    { f: "format", label: "Output format", kind: "select", options: ["Text", "JSON"], def: "Text" },
    { f: "reasoningEffort", label: "Reasoning effort", kind: "select", options: ["default", "low", "medium", "high"], def: "default" },
    { f: "showThinking", label: "Show thinking", kind: "boolean" },
  ],
  vision: [
    { f: "model", label: "Model", kind: "model" },
    { f: "q", label: "Question", kind: "textarea", def: "Describe this image." },
  ],
  image: [
    { f: "model", label: "Model", kind: "model" },
    { f: "size", label: "Image size", kind: "select", options: SIZES, def: "1024x1024" },
    { f: "variations", label: "Variations", kind: "number", def: "1" },
    { f: "seed", label: "Seed", kind: "number" },
  ],
  edit: [
    { f: "model", label: "Model", kind: "model" },
    { f: "prompt", label: "Edit instruction", kind: "textarea" },
    { f: "size", label: "Image size", kind: "select", options: SIZES, def: "1024x1024" },
    { f: "seed", label: "Seed", kind: "number" },
  ],
  draw: [
    { f: "model", label: "Model", kind: "model" },
    { f: "showThinking", label: "Show thinking", kind: "boolean", def: true },
  ],
  tvideo: [
    { f: "model", label: "Model", kind: "model" },
    { f: "resolution", label: "Resolution", kind: "select", def: "" },
    { f: "aspect", label: "Aspect ratio", kind: "select", options: ["16:9", "9:16", "1:1", "4:3", "3:4"], def: "16:9" },
    { f: "duration", label: "Duration", kind: "select", options: DURATIONS, def: "5" },
  ],
  ivideo: [
    { f: "model", label: "Model", kind: "model" },
    { f: "prompt", label: "Motion prompt", kind: "textarea" },
    { f: "resolution", label: "Resolution", kind: "select", def: "" },
    { f: "aspect", label: "Aspect ratio", kind: "select", options: ["16:9", "9:16", "1:1", "4:3", "3:4"], def: "16:9" },
    { f: "duration", label: "Duration", kind: "select", options: DURATIONS, def: "5" },
  ],
  vedit: [
    { f: "model", label: "Model", kind: "model" },
    { f: "prompt", label: "Edit instruction", kind: "textarea" },
    { f: "resolution", label: "Resolution", kind: "select", def: "" },
  ],
  lipsync: [
    { f: "model", label: "Model", kind: "model" },
    { f: "prompt", label: "Guidance prompt", kind: "textarea" },
    { f: "resolution", label: "Resolution", kind: "select", def: "" },
  ],
  music: [
    { f: "model", label: "Model", kind: "model" },
    { f: "lyrics", label: "Lyrics", kind: "textarea" },
    { f: "instrumental", label: "Instrumental", kind: "boolean" },
    { f: "duration", label: "Duration (s)", kind: "number" },
    { f: "negative_prompt", label: "Negative prompt", kind: "textarea" },
    { f: "seed", label: "Seed", kind: "number" },
  ],
  remix: [
    { f: "model", label: "Model", kind: "model" },
    { f: "lyrics", label: "Lyrics", kind: "textarea" },
    { f: "duration", label: "Duration (s)", kind: "number" },
  ],
  tts: [
    { f: "model", label: "Model", kind: "model" },
    { f: "voice", label: "Voice", kind: "text" },
    { f: "speed", label: "Speed", kind: "number", def: "1" },
    { f: "instructions", label: "Voice instructions", kind: "textarea" },
  ],
  transcribe: [
    { f: "model", label: "Model", kind: "model" },
    { f: "language", label: "Language", kind: "text", def: "auto" },
  ],
  join: [{ f: "sep", label: "Separator (use \\n for a line break)", kind: "text", def: " " }],
  inpaint: [
    { f: "model", label: "Model", kind: "model" },
    { f: "size", label: "Image size", kind: "select", options: SIZES, def: "1024x1024" },
    { f: "seed", label: "Seed", kind: "number" },
  ],
  // local media knobs (play.html SETTING_SPECS) — shape-affecting fields for vframes/combine
  resize: [
    { f: "mode", label: "Mode", kind: "select", options: ["fit", "fill", "exact"], def: "fit" },
    { f: "width", label: "Width", kind: "number" },
    { f: "height", label: "Height", kind: "number" },
  ],
  vframes: [
    { f: "dir", label: "Start from", kind: "select", options: ["end", "start"], def: "end" },
    { f: "frames", label: "Frames", kind: "number", def: "1", min: 1, max: 12 },
    { f: "gap", label: "Gap (s)", kind: "number", def: "0.5" },
  ],
  combine: [
    { f: "dedup", label: "Trim duplicate seam frame", kind: "boolean", def: true },
  ],
  soundtrack: [
    { f: "loop", label: "Loop audio to fill video", kind: "boolean", def: false },
  ],
  trim: [
    { f: "start", label: "Start (s)", kind: "number", def: "0" },
    { f: "length", label: "Length (s)", kind: "number", def: "30" },
  ],
  extractaudio: [
    { f: "start", label: "Start (s)", kind: "number", def: "0" },
    { f: "length", label: "Length (s)", kind: "number" },
  ],
};

/**
 * Derive overridable settings: SETTING_SPECS fields that aren't wired.
 * @returns [{ key, nodeId, field, kind, label, def, options?, title }]
 */
function deriveSettings(graph) {
  const out = [];
  for (const n of graph.nodes) {
    if (n.unknown) continue;
    const specs = SETTING_SPECS[n.type];
    if (!specs) continue;
    for (const s of specs) {
      if (graph.links.some((l) => l.to.node === n.id && l.to.port === s.f)) continue; // wired knob is decided upstream
      const cur = n.fields[s.f];
      // vframes frames is shape-affecting — never offer a floor below the highest wired frameK
      const min = (n.type === "vframes" && s.f === "frames")
        ? Math.max(s.min || 1, wiredFramesFloor(graph, n.id))
        : s.min;
      out.push({
        key: `${n.id}.${s.f}`, nodeId: n.id, field: s.f, kind: s.kind, label: s.label,
        def: cur != null && String(cur) !== "" ? cur : s.def,
        ...(s.options ? { options: [...s.options] } : {}),
        ...(min != null ? { min } : {}),
        ...(s.max != null ? { max: s.max } : {}),
        title: displayName(n),
      });
    }
    if (n.type === "image" && n.fields && n.fields.model === "custom-civitai") {
      out.push({ key: `${n.id}.customCivitaiAir`, nodeId: n.id, field: "customCivitaiAir", kind: "text", label: "CivitAI model", def: n.fields.customCivitaiAir || "", title: displayName(n) });
    }
  }
  return out;
}

/**
 * Resolve a settings key: "nodeId.field" → "customName.field" / "Title.field" → bare field/label if unique.
 * Refuses wired fields with a clear error.
 */
function resolveSettingKey(graph, settings, userKey) {
  const norm = String(userKey).trim().toLowerCase();
  const exact = settings.find((s) => s.key.toLowerCase() === norm);
  if (exact) return exact;

  const dot = norm.lastIndexOf(".");
  if (dot > 0) {
    const head = norm.slice(0, dot), field = norm.slice(dot + 1);
    const nodes = graph.nodes.filter((n) =>
      n.id.toLowerCase() === head ||
      (n.name || "").trim().toLowerCase() === head ||
      displayName(n).toLowerCase() === head);
    const cand = settings.filter((s) => nodes.some((n) => n.id === s.nodeId) && s.field.toLowerCase() === field);
    if (cand.length === 1) return cand[0];
    if (cand.length > 1) {
      throw new NanoodleError(`setting "${userKey}" is ambiguous — matches ${cand.map((c) => c.key).join(", ")}`);
    }
    for (const n of nodes) {
      if (graph.links.some((l) => l.to.node === n.id && l.to.port.toLowerCase() === field)) {
        throw new NanoodleError(`setting "${userKey}": that field is wired from another node and can't be overridden`);
      }
    }
  }

  const byField = settings.filter((s) => s.field.toLowerCase() === norm || s.label.toLowerCase() === norm);
  if (byField.length === 1) return byField[0];
  if (byField.length > 1) {
    throw new NanoodleError(`setting "${userKey}" is ambiguous — matches ${byField.map((c) => c.key).join(", ")}`);
  }

  const avail = settings.map((s) => s.key).join(", ") || "(none)";
  throw new NanoodleError(`unknown setting "${userKey}" — available settings: ${avail}`);
}

__x.INPUT_SPECS = INPUT_SPECS; __x.deriveInputs = deriveInputs; __x.resolveInputKey = resolveInputKey; __x.deriveOutputs = deriveOutputs; __x.SETTING_SPECS = SETTING_SPECS; __x.deriveSettings = deriveSettings; __x.resolveSettingKey = resolveSettingKey;
});
__def("share.mjs", function (__x, __req) {
const { gunzip, gunzipLax } = __req("zlib.mjs");
const { base64ToBytes } = __req("media.mjs");
const { NanoodleError } = __req("errors.mjs");

/**
 * Decode-only codec for nanoodle share links — the editor stays the single
 * encoder of record; these functions only ever read.
 *
 * Wire formats (mirrors index.html's loadFromHash / buildShareUrl, locked by
 * the golden fixtures in tests/fixtures/share/ — regenerate them from a real
 * editor with tests/harness/gen-share-fixtures.mjs when the encoder changes):
 *   #g=<b64url(gzip(graph JSON))>          workflow link (editor 🔗 Share)
 *   #j=<b64url(graph JSON)>                uncompressed fallback (no CompressionStream)
 *   #a=<b64url(gzip(app payload))>         app link (play.html); payload = { v, graph, files?, name?, lang?, ... }
 *   #a=u<b64url(app payload)>              uncompressed app fallback ('u' tag inside the value)
 *   #ga=…                                  editor↔play handoff — internal transport, deliberately NOT supported
 */

const URL_RE = /^https?:\/\//i;
const FRAG_RE = /^#?(ga|[gja])=/;

/** True when a string is addressable as a share link: an http(s) URL, or a bare #g=/#j=/#a= fragment. */
function isShareRef(s) {
  return typeof s === "string" && (URL_RE.test(s) || FRAG_RE.test(s));
}

function b64urlToBytes(s, what) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) {
    throw new NanoodleError(`share link: ${what} payload is not base64url data — is the URL complete?`);
  }
  try { return base64ToBytes(s.replace(/-/g, "+").replace(/_/g, "/")); }
  catch { throw new NanoodleError(`share link: ${what} payload is not base64url data — is the URL complete?`); }
}

const utf8 = new TextDecoder();

function parseJson(text, what) {
  try { return JSON.parse(text); }
  catch { throw new NanoodleError(`share link: ${what} payload decoded but is not valid JSON — the link may be truncated`); }
}

async function gunzipText(buf, what) {
  try { return utf8.decode(await gunzip(buf)); }
  catch { throw new NanoodleError(`share link: ${what} payload is not valid gzip data — the link may be truncated`); }
}

/* ---- best-effort salvage for damaged links ----------------------------------
   Links get mangled in transit all the time — chat apps, line wraps, and manual
   copy/paste flip or drop a character, which breaks the gzip CRC (and often a
   few JSON characters) while leaving most of the payload intact. Executors only
   need `nodes` and `links`, so when strict decoding fails we lax-decompress
   (trailer ignored, partial output kept) and pull those two arrays out of the
   damaged text. Cosmetic editor state (view, nid/lid) is sacrificed; damage
   inside the graph itself still fails with the original error. Results carry
   `recovered: true` so callers can warn. */

/** Index of the bracket closing text[i] (a "[" or "{"), string-aware; -1 when unbalanced. */
function matchBracket(text, i) {
  const open = text[i];
  if (open !== "[" && open !== "{") return -1;
  let depth = 0, inStr = false;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (inStr) {
      if (c === "\\") j++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") { depth--; if (!depth) return j; }
  }
  return -1;
}

/** Parse the value of `"key": …` out of possibly-damaged JSON text; null when no occurrence parses. */
function extractJsonValue(text, key) {
  const needle = `"${key}"`;
  for (let from = 0; ;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return null;
    from = at + 1;
    let j = at + needle.length;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] !== ":") continue;
    j++;
    while (j < text.length && /\s/.test(text[j])) j++;
    const end = matchBracket(text, j);
    if (end === -1) continue;
    try { return JSON.parse(text.slice(j, end + 1)); } catch { /* damaged here — try the next occurrence */ }
  }
}

function salvageGraph(text) {
  if (!text) return null;
  const nodes = extractJsonValue(text, "nodes");
  if (!Array.isArray(nodes) || !nodes.length || !nodes.every((n) => n && typeof n === "object" && typeof n.type === "string")) return null;
  const links = extractJsonValue(text, "links");
  return { v: 1, nodes, links: Array.isArray(links) ? links : [] };
}

const laxText = (bytes) => (bytes && bytes.length ? utf8.decode(bytes) : null);

/**
 * Decode a share fragment ("#g=…", "g=…", "#a=…", …) to its graph.
 * Async since v0.4: gzip decoding goes through DecompressionStream in the
 * browser, which has no synchronous form.
 * @returns {Promise<{ graph: object, kind: "g"|"j"|"a", app: { name?, lang?, hasFiles: boolean }|null, recovered?: true }>}
 *   `recovered: true` marks a damaged link whose graph was salvaged best-effort
 *   (nodes + links only — cosmetic editor state is dropped); warn the user and
 *   suggest re-copying the link.
 */
async function decodeShareFragment(fragment) {
  let f = String(fragment);
  if (f.startsWith("#")) f = f.slice(1);
  if (f.startsWith("ga=")) {
    throw new NanoodleError(
      "share link: #ga= is the editor↔app-builder handoff — an internal, unstable format. " +
      "Open the link in a browser and use 🔗 Share to mint a #g= workflow link instead.");
  }
  if (f.startsWith("g=")) {
    const buf = b64urlToBytes(f.slice(2), "#g=");
    let text = null, strictErr;
    try { text = await gunzipText(buf, "#g="); } catch (e) { strictErr = e; }
    if (text !== null) {
      try { return { graph: parseJson(text, "#g="), kind: "g", app: null }; }
      catch (e) { strictErr = e; }
    } else {
      text = laxText(await gunzipLax(buf));
    }
    const graph = salvageGraph(text);
    if (!graph) throw strictErr;
    return { graph, kind: "g", app: null, recovered: true };
  }
  if (f.startsWith("j=")) {
    const text = utf8.decode(b64urlToBytes(f.slice(2), "#j="));
    try { return { graph: parseJson(text, "#j="), kind: "j", app: null }; }
    catch (e) {
      const graph = salvageGraph(text);
      if (!graph) throw e;
      return { graph, kind: "j", app: null, recovered: true };
    }
  }
  if (f.startsWith("a=")) {
    const tag = f.slice(2);
    let json = null, strictErr;
    if (tag[0] === "u") {
      json = utf8.decode(b64urlToBytes(tag.slice(1), "#a=u"));
    } else {
      const buf = b64urlToBytes(tag, "#a=");
      try { json = await gunzipText(buf, "#a="); }
      catch (e) { strictErr = e; json = laxText(await gunzipLax(buf)); }
    }
    if (!strictErr) {
      let payload;
      try { payload = parseJson(json, "#a="); } catch (e) { strictErr = e; payload = null; }
      if (payload) {
        if (typeof payload !== "object" || !payload.graph) {
          throw new NanoodleError("share link: #a= app payload has no graph in it");
        }
        // files/samples/lang are play.html presentation — executors run graphs, not apps.
        return {
          graph: payload.graph,
          kind: "a",
          app: {
            ...(typeof payload.name === "string" && payload.name ? { name: payload.name } : {}),
            ...(typeof payload.lang === "string" && payload.lang ? { lang: payload.lang } : {}),
            hasFiles: !!payload.files,
          },
        };
      }
    }
    // salvage: the app payload nests its graph — prefer the intact "graph" object, else its nodes/links
    const nested = json != null ? extractJsonValue(json, "graph") : null;
    const graph = nested && typeof nested === "object" && Array.isArray(nested.nodes) ? nested : salvageGraph(json);
    if (!graph) throw strictErr;
    return { graph, kind: "a", app: { hasFiles: false }, recovered: true };
  }
  throw new NanoodleError(`share link: no #g=/#j=/#a= fragment found in "${fragment}"`);
}

function fragmentOf(url) {
  const i = url.indexOf("#");
  return i === -1 ? null : url.slice(i);
}

/**
 * Decode any nanoodle share reference — a full URL, a bare fragment, or a
 * shortener link (da.gd/TinyURL/…) whose redirect target carries the fragment.
 *
 * Direct fragment links decode with ZERO network calls. Only fragment-less
 * http(s) URLs trigger fetches, and those are redirect-header reads with no
 * credentials attached (the codec never sees an API key by construction).
 *
 * @param {string} input
 * @param {{ fetch?: typeof fetch, maxHops?: number }} [opts]
 * @returns {Promise<{ graph: object, kind: "g"|"j"|"a", app: object|null, url: string, recovered?: true }>}
 */
async function decodeShareUrl(input, opts = {}) {
  const s = String(input).trim();
  if (!URL_RE.test(s)) return { ...(await decodeShareFragment(s)), url: s };

  let url = s;
  const frag = fragmentOf(url);
  if (frag && FRAG_RE.test(frag)) return { ...(await decodeShareFragment(frag)), url };

  // No fragment on the URL itself → treat it as a short link and follow
  // redirects by hand: fragments ride in the Location header, which automatic
  // redirect handling would consume before we could read it.
  const f = opts.fetch ?? globalThis.fetch;
  const maxHops = opts.maxHops ?? 5;
  for (let hop = 0; hop < maxHops; hop++) {
    let res;
    try { res = await f(url, { method: "GET", redirect: "manual" }); }
    catch (e) { throw new NanoodleError(`share link: could not resolve ${url}: ${e.message}`); }
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!loc) {
      throw new NanoodleError(
        `share link: ${url} answered ${res.status} with no #g=/#j=/#a= fragment and no redirect — ` +
        "open it in a browser and share the long nanoodle.com URL instead");
    }
    url = new URL(loc, url).href;
    const hopFrag = fragmentOf(url);
    if (hopFrag && FRAG_RE.test(hopFrag)) return { ...(await decodeShareFragment(hopFrag)), url };
  }
  throw new NanoodleError(`share link: gave up after ${maxHops} redirects without finding a share fragment`);
}

__x.isShareRef = isShareRef; __x.decodeShareFragment = decodeShareFragment; __x.decodeShareUrl = decodeShareUrl;
});
__def("local-media.mjs", function (__x, __req) {
/**
 * Local media ops that the browser runs with canvas / Web Audio / MediaRecorder / MP4CAT.
 *
 * Strategy (mirrors nanoodle/ play.html + index.html):
 *   1. Pure-JS path first — same algorithms the app uses when it can avoid re-encode
 *      (MP4CAT remux for matching mp4s, PCM-WAV trim, PNG canvas-equivalent resize).
 *   2. ffmpeg/ffprobe on PATH when pure JS can't handle the format (mismatched combine,
 *      JPEG resize, video frame grab, soundtrack mux, non-WAV audio, …). Soft dependency
 *      — not an npm package.
 *
 * Eventually the pure path is meant to cover everything the browser does and replace the
 * ffmpeg "custom executor" path; until then ffmpeg remains the heavy fallback.
 *
 * Outputs are data: URLs so they plug into the existing MediaRef / network-inline pipeline.
 */
const { inflate, deflate } = __req("zlib.mjs");
const { NanoodleError } = __req("errors.mjs");
const { bytesToDataUrl, dataUrlBytes, sniffMime, MEDIA_INLINE_MAX } = __req("media.mjs");
const { MP4CAT } = __req("mp4cat.mjs");

const MAX_FRAMES = 12;
/** Refuse pure PNG decode above this edge (memory guard; canvas-class bound). */
const MAX_IMAGE_DIM = 8192;
/** Refuse pure WAV decode above this many interleaved samples (~17 min mono @ 48 kHz). */
const MAX_WAV_SAMPLES = 50_000_000;
const PROC_STDOUT_MAX = 32 * 1024 * 1024;

/* ---------- process helpers ------------------------------------------------ */

// The ffmpeg fallback needs Node builtins; they load lazily so this module
// imports cleanly in a browser, where only the pure-JS paths ever run.
let spawn, mkdtemp, readFile, writeFile, rm, tmpdir, join;
async function ensureNodeDeps() {
  if (spawn) return;
  const [cp, fsp, os, path] = await Promise.all([
    import("node:child_process"),
    import("node:fs/promises"),
    import("node:os"),
    import("node:path"),
  ]);
  spawn = cp.spawn;
  mkdtemp = fsp.mkdtemp; readFile = fsp.readFile; writeFile = fsp.writeFile; rm = fsp.rm;
  tmpdir = os.tmpdir; join = path.join;
}

function abortError(signal) {
  const r = signal && signal.reason;
  if (r instanceof Error) return r;
  return new NanoodleError(r != null ? String(r) : "run aborted", { code: "aborted" });
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError(signal);
}

async function runProc(bin, args, { timeoutMs = 120000, signal } = {}) {
  await ensureNodeDeps();
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError(signal));
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0);
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      if (signal) signal.removeEventListener("abort", onAbort);
      fn();
    };
    const to = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new NanoodleError(`${bin} timed out after ${timeoutMs}ms`, { code: "timeout" })));
    }, timeoutMs);
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() => reject(abortError(signal)));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d) => {
      if (stdout.length < PROC_STDOUT_MAX) {
        stdout = Buffer.concat([stdout, d.length + stdout.length > PROC_STDOUT_MAX
          ? d.subarray(0, PROC_STDOUT_MAX - stdout.length) : d]);
      }
    });
    child.stderr.on("data", (d) => {
      // keep a trailing window for error messages
      stderr = Buffer.concat([stderr, d]);
      if (stderr.length > 64 * 1024) stderr = stderr.subarray(stderr.length - 64 * 1024);
    });
    child.on("error", (e) => {
      if (e && e.code === "ENOENT") {
        finish(() => reject(new NanoodleError(
          `local media nodes need ffmpeg on PATH (not found: ${bin}). ` +
          "Install ffmpeg, or run this graph in the nanoodle browser app.")));
      } else finish(() => reject(e));
    });
    child.on("close", (code) => {
      if (code === 0) finish(() => resolve({ stdout, stderr: stderr.toString("utf8") }));
      else finish(() => reject(new NanoodleError(
        `${bin} failed (exit ${code}): ${(stderr.toString("utf8") || "").trim().slice(-400) || "no stderr"}`)));
    });
  });
}

function isMissingFfmpeg(err) {
  return err instanceof NanoodleError && /need ffmpeg on PATH/i.test(err.message || "");
}

async function withTemp(fn) {
  await ensureNodeDeps();
  const dir = await mkdtemp(join(tmpdir(), "nanoodle-media-"));
  try { return await fn(dir); }
  finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/** data:/https URL (or raw string MediaRef url) → bytes. */
async function urlBytes(url, fetchFn) {
  if (url == null) throw new NanoodleError("no media input");
  const u = typeof url === "object" && url.url != null ? url.url : String(url);
  if (/^data:/i.test(u)) return dataUrlBytes(u).bytes;
  if (/^https?:/i.test(u)) {
    const fetchImpl = fetchFn || globalThis.fetch;
    if (!fetchImpl) throw new NanoodleError("can't download media: no fetch available");
    const r = await fetchImpl(u);
    if (!r.ok) throw new NanoodleError(`couldn't download media (${r.status}): ${u.slice(0, 120)}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  throw new NanoodleError("media must be a data: or http(s) URL");
}

async function writeInput(dir, name, url, fetchFn) {
  await ensureNodeDeps();
  const bytes = await urlBytes(url, fetchFn);
  // preserve a sensible extension so ffmpeg picks the demuxer
  let ext = ".bin";
  if (/^data:/i.test(String(typeof url === "object" ? url.url : url))) {
    const mime = sniffMime(bytes);
    ext = mime.includes("png") ? ".png"
      : mime.includes("jpeg") ? ".jpg"
      : mime.includes("webp") ? ".webp"
      : mime.includes("gif") ? ".gif"
      : mime.includes("wav") ? ".wav"
      : mime.includes("mpeg") || mime.includes("mp3") ? ".mp3"
      : mime.includes("mp4") ? ".mp4"
      : mime.includes("webm") ? ".webm"
      : ".bin";
  } else {
    const m = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(String(typeof url === "object" ? url.url : url));
    if (m) ext = "." + m[1].toLowerCase();
  }
  const path = join(dir, name + ext);
  await writeFile(path, bytes);
  return path;
}

async function dataUrlFromFile(path, mimeHint) {
  await ensureNodeDeps();
  const buf = await readFile(path);
  const u8 = new Uint8Array(buf);
  const mime = mimeHint || sniffMime(u8);
  return bytesToDataUrl(u8, mime);
}

function dataUrlFromBytes(bytes, mime) {
  return bytesToDataUrl(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), mime);
}

/* ---------- resizePlan (verbatim from index.html / play.html) -------------- */

/** @returns {{ cw, ch, dx, dy, dw, dh }|null} */
function resizePlan(sw, sh, mode, tw, th) {
  if (!(tw > 0) && !(th > 0)) return null;
  if (mode === "fit") {
    let scale;
    if (tw > 0 && th > 0) scale = Math.min(tw / sw, th / sh);
    else if (tw > 0) scale = tw / sw;
    else scale = th / sh;
    if (scale > 1) scale = 1; // never upscale
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    return { cw: w, ch: h, dx: 0, dy: 0, dw: w, dh: h };
  }
  const bw = tw > 0 ? tw : Math.max(1, Math.round(th * sw / sh));
  const bh = th > 0 ? th : Math.max(1, Math.round(tw * sh / sw));
  if (mode === "exact") return { cw: bw, ch: bh, dx: 0, dy: 0, dw: bw, dh: bh };
  // fill & crop: cover, centered
  const scale = Math.max(bw / sw, bh / sh);
  const dw = sw * scale, dh = sh * scale;
  return { cw: bw, ch: bh, dx: (bw - dw) / 2, dy: (bh - dh) / 2, dw, dh };
}

/* ---------- pure PNG (canvas-equivalent resize for PNG sources) ------------ */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function catBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Decode 8-bit RGB/RGBA/gray/gray+alpha PNG → { w, h, rgba:Uint8ClampedArray }. */
async function decodePng(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 8 || u8[0] !== 0x89 || u8[1] !== 0x50) {
    throw new NanoodleError("couldn't read that image to resize");
  }
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (u8[i] !== sig[i]) throw new NanoodleError("couldn't read that image to resize");

  let w = 0, h = 0, bitDepth = 8, colorType = 2;
  const idats = [];
  let p = 8;
  while (p + 8 <= u8.length) {
    // >>> 0: PNG chunk lengths are unsigned; JS << is signed 32-bit
    const len = ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0;
    if (p + 12 + len > u8.length) throw new NanoodleError("couldn't read that image to resize");
    const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
    const data = u8.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (type === "IHDR") {
      w = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
      h = ((data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]) >>> 0;
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new NanoodleError("couldn't read that image to resize"); // compressed/filter/interlace
      }
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") break;
  }
  if (!(w > 0) || !(h > 0) || bitDepth !== 8) {
    throw new NanoodleError("couldn't read that image to resize");
  }
  if (w > MAX_IMAGE_DIM || h > MAX_IMAGE_DIM) {
    throw new NanoodleError(
      `image is too large to resize in-process (${w}×${h}; max ${MAX_IMAGE_DIM}px) — use smaller source dimensions`);
  }
  // colorType: 0 gray, 2 RGB, 4 gray+A, 6 RGBA (no palette)
  if (colorType !== 0 && colorType !== 2 && colorType !== 4 && colorType !== 6) {
    throw new NanoodleError("couldn't read that image to resize");
  }
  const cpp = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  const raw = await inflate(catBytes(idats));
  const stride = w * cpp;
  const expected = h * (1 + stride);
  if (raw.length < expected) throw new NanoodleError("couldn't read that image to resize");

  const unfiltered = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const ftype = raw[y * (1 + stride)];
    const row = raw.subarray(y * (1 + stride) + 1, y * (1 + stride) + 1 + stride);
    const dest = unfiltered.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? unfiltered.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const left = x >= cpp ? dest[x - cpp] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= cpp ? prev[x - cpp] : 0;
      let v = row[x];
      if (ftype === 1) v = (v + left) & 255; // Sub
      else if (ftype === 2) v = (v + up) & 255; // Up
      else if (ftype === 3) v = (v + ((left + up) >> 1)) & 255; // Average
      else if (ftype === 4) { // Paeth
        const p0 = left + up - upLeft;
        const pa = Math.abs(p0 - left), pb = Math.abs(p0 - up), pc = Math.abs(p0 - upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        v = (v + pr) & 255;
      } else if (ftype !== 0) {
        throw new NanoodleError("couldn't read that image to resize");
      }
      dest[x] = v;
    }
  }

  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, px = 0; i < w * h; i++, px += cpp) {
    const o = i * 4;
    if (colorType === 0) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = unfiltered[px];
      rgba[o + 3] = 255;
    } else if (colorType === 2) {
      rgba[o] = unfiltered[px]; rgba[o + 1] = unfiltered[px + 1]; rgba[o + 2] = unfiltered[px + 2];
      rgba[o + 3] = 255;
    } else if (colorType === 4) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = unfiltered[px];
      rgba[o + 3] = unfiltered[px + 1];
    } else {
      rgba[o] = unfiltered[px]; rgba[o + 1] = unfiltered[px + 1];
      rgba[o + 2] = unfiltered[px + 2]; rgba[o + 3] = unfiltered[px + 3];
    }
  }
  return { w, h, rgba };
}

async function encodePngRgba(w, h, rgba) {
  // Filter type 0 (None) per row — simple, correct.
  const stride = w * 4;
  const raw = new Uint8Array(h * (1 + stride));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + stride)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1);
  }
  const compressed = await deflate(raw, { level: 9 });
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return catBytes([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/** Bilinear sample of source RGBA at floating pixel coords (canvas-like smoothing). */
function sampleBilinear(src, sw, sh, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
  const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
  const out = new Uint8ClampedArray(4);
  for (let c = 0; c < 4; c++) {
    const v =
      src[i00 + c] * (1 - fx) * (1 - fy) +
      src[i10 + c] * fx * (1 - fy) +
      src[i01 + c] * (1 - fx) * fy +
      src[i11 + c] * fx * fy;
    out[c] = Math.round(v);
  }
  return out;
}

/**
 * Inpaint mask prep (play.html `maskToSource` / index.html canvas path):
 * composite the mask onto opaque black at the **source image's** exact pixel size
 * so maskDataUrl dimensions always match imageDataUrl. White (or opaque white-on-
 * transparent brush strokes) = repaint; black = keep.
 *
 * Pure PNG path first; ffmpeg soft-fallback for JPEG/WebP/etc.
 *
 * @param {string} maskUrl data: or http(s)
 * @param {string} sourceUrl data: or http(s) — dimensions only (pixels not sent as mask)
 * @returns {Promise<string>} data:image/png;base64,…
 */
async function maskToSource(maskUrl, sourceUrl, { fetch: fetchFn, signal } = {}) {
  throwIfAborted(signal);
  if (!maskUrl) throw new NanoodleError("couldn't read the mask");
  if (!sourceUrl) throw new NanoodleError("couldn't read the source image");

  const srcBytes = await urlBytes(sourceUrl, fetchFn);
  throwIfAborted(signal);
  const maskBytes = await urlBytes(maskUrl, fetchFn);
  throwIfAborted(signal);

  const srcMime = sniffMime(srcBytes);
  const maskMime = sniffMime(maskBytes);
  if (srcMime === "image/png" && maskMime === "image/png") {
    try {
      return dataUrlFromBytes(await maskToSourcePngPure(maskBytes, srcBytes), "image/png");
    } catch (e) {
      if (e instanceof NanoodleError) {
        if (/couldn't read the (mask|source)/i.test(e.message || "")) throw e;
        if (/too large/i.test(e.message || "")) throw e;
        // exotic PNG → try ffmpeg
      } else {
        throw e;
      }
    }
  }

  return maskToSourceFfmpeg(maskUrl, sourceUrl, { fetch: fetchFn, signal });
}

/** Pure PNG composite matching canvas: black fill + drawImage(mask → source size). */
async function maskToSourcePngPure(maskBytes, srcBytes) {
  let src, mask;
  try { src = await decodePng(srcBytes); }
  catch { throw new NanoodleError("couldn't read the source image"); }
  try { mask = await decodePng(maskBytes); }
  catch { throw new NanoodleError("couldn't read the mask"); }

  const sw = src.w, sh = src.h;
  if (!(sw > 0) || !(sh > 0)) throw new NanoodleError("couldn't read the source image");
  if (sw > MAX_IMAGE_DIM || sh > MAX_IMAGE_DIM) {
    throw new NanoodleError(
      `image is too large to composite mask in-process (${sw}×${sh}; max ${MAX_IMAGE_DIM}px)`);
  }

  // Opaque black canvas (keep = black), same size as source.
  const out = new Uint8ClampedArray(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const o = i * 4;
    out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 255;
  }

  // drawImage(mask, 0, 0, sw, sh) with source-over (browser default).
  const mw = mask.w, mh = mask.h;
  const mrgba = mask.rgba;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const u = (x + 0.5) / sw * mw - 0.5;
      const v = (y + 0.5) / sh * mh - 0.5;
      const sx = Math.max(0, Math.min(mw - 1, u));
      const sy = Math.max(0, Math.min(mh - 1, v));
      const pix = sampleBilinear(mrgba, mw, mh, sx, sy);
      const a = pix[3] / 255;
      const o = (y * sw + x) * 4;
      // source-over onto opaque black dst
      out[o] = Math.round(pix[0] * a + out[o] * (1 - a));
      out[o + 1] = Math.round(pix[1] * a + out[o + 1] * (1 - a));
      out[o + 2] = Math.round(pix[2] * a + out[o + 2] * (1 - a));
      out[o + 3] = 255;
    }
  }
  return encodePngRgba(sw, sh, out);
}

async function maskToSourceFfmpeg(maskUrl, sourceUrl, { fetch: fetchFn, signal } = {}) {
  return withTemp(async (dir) => {
    throwIfAborted(signal);
    const srcPath = await writeInput(dir, "src", sourceUrl, fetchFn);
    const maskPath = await writeInput(dir, "mask", maskUrl, fetchFn);
    const probe = await runProc("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", srcPath,
    ], { signal }).catch(() => {
      throw new NanoodleError("couldn't read the source image");
    });
    const dims = String(probe.stdout).trim().split("x").map(Number);
    const sw = dims[0], sh = dims[1];
    if (!(sw > 0) || !(sh > 0)) throw new NanoodleError("couldn't read the source image");
    const outPath = join(dir, "mask-out.png");
    // black base of source size + scaled mask overlaid (matches canvas path)
    try {
      await runProc("ffmpeg", [
        "-y",
        "-f", "lavfi", "-i", `color=c=black:s=${sw}x${sh}:d=1`,
        "-i", maskPath,
        "-filter_complex",
        `[1:v]scale=${sw}:${sh}:flags=bilinear,format=rgba[m];[0:v][m]overlay=0:0:format=auto`,
        "-frames:v", "1", outPath,
      ], { signal });
    } catch {
      throw new NanoodleError("couldn't read the mask");
    }
    return dataUrlFromFile(outPath, "image/png");
  });
}

/**
 * Pure resize matching canvas drawImage(img, dx, dy, dw, dh) onto cw×ch.
 * PNG only (JPEG needs ffmpeg). Output always PNG (preserves alpha like browser PNG path).
 */
async function resizeCropPngPure(bytes, mode, tw, th) {
  const { w: sw, h: sh, rgba } = await decodePng(bytes);
  const p = resizePlan(sw, sh, mode, tw, th);
  if (!p) throw new NanoodleError("set a width or height to resize to");
  // Canvas default: transparent black outside the draw rect.
  const out = new Uint8ClampedArray(p.cw * p.ch * 4);
  for (let y = 0; y < p.ch; y++) {
    for (let x = 0; x < p.cw; x++) {
      // Inverse of drawImage(img, dx, dy, dw, dh): dest pixel → continuous source coords.
      const u = (x + 0.5 - p.dx) / p.dw * sw - 0.5;
      const v = (y + 0.5 - p.dy) / p.dh * sh - 0.5;
      if (u < -0.5 || v < -0.5 || u > sw - 0.5 || v > sh - 0.5) continue;
      const sx = Math.max(0, Math.min(sw - 1, u));
      const sy = Math.max(0, Math.min(sh - 1, v));
      const pix = sampleBilinear(rgba, sw, sh, sx, sy);
      const o = (y * p.cw + x) * 4;
      out[o] = pix[0]; out[o + 1] = pix[1]; out[o + 2] = pix[2]; out[o + 3] = pix[3];
    }
  }
  return encodePngRgba(p.cw, p.ch, out);
}

/* ---------- pure WAV (encodeWavMono + PCM trim — from play.html) ----------- */

/** encodeWavMono from play.html — Float32 mono samples → PCM16 WAV bytes. */
function encodeWavMono(samples, sampleRate) {
  const n = samples.length, dataLen = n * 2;
  const ab = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); dv.setUint32(4, 36 + dataLen, true); ws(8, "WAVE");
  ws(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  ws(36, "data"); dv.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    off += 2;
  }
  return new Uint8Array(ab);
}

/** Parse PCM WAV → { sampleRate, channels, samples: Float32Array interleaved }. */
function parsePcmWav(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 44) throw new NanoodleError("couldn't decode that audio for trimming (unsupported format?)");
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const ascii = (o, n) => String.fromCharCode(...u8.subarray(o, o + n));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new NanoodleError("couldn't decode that audio for trimming (unsupported format?)");
  }
  let sampleRate = 0, channels = 0, bits = 0, dataOff = -1, dataLen = 0;
  let p = 12;
  while (p + 8 <= u8.length) {
    const id = ascii(p, 4);
    const size = dv.getUint32(p + 4, true);
    const body = p + 8;
    if (id === "fmt ") {
      const format = dv.getUint16(body, true);
      if (format !== 1 && format !== 3) {
        throw new NanoodleError("couldn't decode that audio for trimming (unsupported format?)");
      }
      channels = dv.getUint16(body + 2, true);
      sampleRate = dv.getUint32(body + 4, true);
      bits = dv.getUint16(body + 14, true);
      // store format in bits high for float32: mark via bits===32 && format===3
      if (format === 3) bits = -32; // float32 sentinel
    } else if (id === "data") {
      dataOff = body;
      // clamp claimed size to bytes actually present (truncated / lying headers)
      dataLen = Math.min(size, Math.max(0, u8.length - body));
      break;
    }
    p = body + size + (size & 1); // word-align
  }
  if (dataOff < 0 || !(sampleRate > 0) || !(channels > 0)) {
    throw new NanoodleError("couldn't decode that audio for trimming (unsupported format?)");
  }
  let samples;
  if (bits === 16) {
    const n = Math.floor(dataLen / 2);
    if (n > MAX_WAV_SAMPLES) {
      throw new NanoodleError("audio is too long to trim in-process — use a shorter clip");
    }
    samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = dv.getInt16(dataOff + i * 2, true) / 0x8000;
  } else if (bits === 8) {
    const n = dataLen;
    if (n > MAX_WAV_SAMPLES) {
      throw new NanoodleError("audio is too long to trim in-process — use a shorter clip");
    }
    samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = (u8[dataOff + i] - 128) / 128;
  } else if (bits === -32) {
    const n = Math.floor(dataLen / 4);
    if (n > MAX_WAV_SAMPLES) {
      throw new NanoodleError("audio is too long to trim in-process — use a shorter clip");
    }
    samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = dv.getFloat32(dataOff + i * 4, true);
  } else if (bits === 32) {
    const n = Math.floor(dataLen / 4);
    if (n > MAX_WAV_SAMPLES) {
      throw new NanoodleError("audio is too long to trim in-process — use a shorter clip");
    }
    samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = dv.getInt32(dataOff + i * 4, true) / 0x80000000;
  } else {
    throw new NanoodleError("couldn't decode that audio for trimming (unsupported format?)");
  }
  return { sampleRate, channels, samples };
}

function downmixMono(samples, channels) {
  if (channels === 1) return samples;
  const frames = Math.floor(samples.length / channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += samples[i * channels + c];
    out[i] = s / channels;
  }
  return out;
}

/** Linear resample mono Float32 to target rate (OfflineAudioContext stand-in). */
function resampleMono(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const n = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const f = x - i0;
    out[i] = samples[i0] * (1 - f) + samples[i1] * f;
  }
  return out;
}

/**
 * Pure PCM-WAV trim — same slice semantics as play.html trimAudioToWavUrl.
 * wholeIfBlank: extractaudio path (blank length → rest of clip).
 */
function trimPcmWavPure(bytes, start, len, rate, { wholeIfBlank = false } = {}) {
  const { sampleRate, channels, samples } = parsePcmWav(bytes);
  let mono = downmixMono(samples, channels);
  const dur = mono.length / sampleRate;
  const s0 = start || 0;
  if (s0 >= dur) {
    throw new NanoodleError(
      `the start point (${Math.round(s0 * 10) / 10}s) is past the end of this clip, which is only ${dur.toFixed(1)}s long — pick an earlier start`);
  }
  const s = Math.max(0, Math.min(s0, Math.max(0, dur - 0.05)));
  let take;
  if (wholeIfBlank && !(len > 0)) take = Math.max(0.05, dur - s);
  else {
    const L = Number.isFinite(Number(len)) && Number(len) > 0 ? Number(len) : 30;
    take = Math.max(0.05, Math.min(L, dur - s));
  }
  const i0 = Math.floor(s * sampleRate);
  const n = Math.max(1, Math.floor(take * sampleRate));
  const sliced = mono.subarray(i0, Math.min(mono.length, i0 + n));
  const targetRate = rate || 16000;
  const out = resampleMono(sliced, sampleRate, targetRate);
  return encodeWavMono(out, targetRate);
}

/* ---------- resize (pure PNG → ffmpeg) ------------------------------------- */

/**
 * Resize/crop an image URL. mode: fit | fill | exact.
 * Pure path: PNG via zlib (canvas-equivalent geometry). JPEG/WebP/… → ffmpeg.
 * Browser keeps PNG for PNG sources (alpha); others → JPEG q≈0.92 (ffmpeg -q:v 2).
 */
async function resizeCropImage(url, mode, tw, th, { fetch: fetchFn, signal } = {}) {
  throwIfAborted(signal);
  const w = Math.max(0, parseInt(tw, 10) || 0);
  const h = Math.max(0, parseInt(th, 10) || 0);
  if (!w && !h) throw new NanoodleError("set a width or height to resize to");
  const m = mode || "fit";

  const bytes = await urlBytes(url, fetchFn);
  throwIfAborted(signal);
  const mime = sniffMime(bytes);

  if (mime === "image/png") {
    try {
      const out = await resizeCropPngPure(bytes, m, w, h);
      const dataUrl = dataUrlFromBytes(out, "image/png");
      if (dataUrl.length > MEDIA_INLINE_MAX) {
        throw new NanoodleError("resized image is still over the ~4 MB inline limit — pick smaller dimensions");
      }
      return dataUrl;
    } catch (e) {
      // rethrow user-facing limits; only fall through for "couldn't read" / exotic PNG
      if (e instanceof NanoodleError) {
        if (/width or height|inline limit|too large to resize/i.test(e.message || "")) throw e;
        if (!/couldn't read that image/i.test(e.message || "")) throw e;
      } else {
        throw e; // unexpected (OOM etc.) — don't mask with ffmpeg
      }
      // exotic PNG → try ffmpeg
    }
  }

  return resizeCropImageFfmpeg(url, m, w, h, { fetch: fetchFn, signal });
}

/* ---------- fit an oversized image under the inline send budget ------------ */

/** Ladder of long-edge caps tried in order; "fit" never upscales, so a dense
    small image just re-encodes at its own size until a smaller rung shrinks it. */
const FIT_DIMS = [2048, 1448, 1024, 724, 512];
/** Headroom under MEDIA_INLINE_MAX for the JSON envelope around the data URL
    (model id, prompt, opts) so a just-fitting image doesn't tip the whole body over. */
const INLINE_IMAGE_BUDGET = MEDIA_INLINE_MAX - 128 * 1024;

/**
 * Return `url` unchanged when it already fits the inline send budget; otherwise
 * downscale it (aspect preserved) until it does. NanoGPT has no upload endpoint —
 * media rides base64 inside a ~4.4 MB request body (verified live: 413
 * FUNCTION_PAYLOAD_TOO_LARGE at 4.5 MB) — so an image over the budget is a
 * guaranteed reject; a resized frame beats a dead node. http(s) URLs pass through
 * (they ride by reference). Callers announce the shrink via onShrink/progress.
 */
async function fitImageInline(url, { budget = INLINE_IMAGE_BUDGET, fetch: fetchFn, signal, onShrink } = {}) {
  if (typeof url !== "string" || !url.startsWith("data:") || url.length <= budget) return url;
  for (const dim of FIT_DIMS) {
    throwIfAborted(signal);
    let out;
    try {
      out = await resizeCropImage(url, "fit", dim, dim, { fetch: fetchFn, signal });
    } catch (e) {
      // pure-PNG path refuses results still over MEDIA_INLINE_MAX at this rung → try smaller
      if (e instanceof NanoodleError && /inline limit/i.test(e.message || "")) continue;
      throw new NanoodleError(
        "image is too large to send inline (~4 MB max) and couldn't be resized down (" +
        (e && e.message ? e.message : e) + ") — use a smaller image");
    }
    if (out.length <= budget) {
      if (onShrink) onShrink(dim);
      return out;
    }
  }
  throw new NanoodleError("image is too large to send inline even after resizing (~4 MB max) — use a smaller image");
}

async function resizeCropImageFfmpeg(url, m, w, h, { fetch: fetchFn, signal } = {}) {
  return withTemp(async (dir) => {
    throwIfAborted(signal);
    const inPath = await writeInput(dir, "in", url, fetchFn);
    const probe = await runProc("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", inPath,
    ], { signal });
    const dims = String(probe.stdout).trim().split("x").map(Number);
    const sw = dims[0], sh = dims[1];
    if (!(sw > 0) || !(sh > 0)) throw new NanoodleError("couldn't read that image to resize");
    const p = resizePlan(sw, sh, m, w, h);
    if (!p) throw new NanoodleError("set a width or height to resize to");

    const srcUrl = typeof url === "object" && url.url != null ? url.url : String(url);
    const wantPng = /^data:image\/png/i.test(srcUrl) || /\.png$/i.test(inPath);
    const outPath = join(dir, wantPng ? "out.png" : "out.jpg");

    let vf;
    if (m === "fit" || m === "exact") {
      vf = `scale=${p.cw}:${p.ch}`;
    } else {
      vf = `scale=${p.cw}:${p.ch}:force_original_aspect_ratio=increase,crop=${p.cw}:${p.ch}`;
    }

    const args = ["-y", "-i", inPath, "-vf", vf];
    if (wantPng) args.push("-frames:v", "1", outPath);
    else args.push("-frames:v", "1", "-q:v", "2", outPath);
    await runProc("ffmpeg", args, { signal });

    const out = await dataUrlFromFile(outPath, wantPng ? "image/png" : "image/jpeg");
    if (out.length > MEDIA_INLINE_MAX) {
      throw new NanoodleError("resized image is still over the ~4 MB inline limit — pick smaller dimensions");
    }
    return out;
  });
}

/* ---------- audio trim / extract (pure WAV → ffmpeg) ----------------------- */

/**
 * Decode audio (or demux audio from video), slice [start, start+len], mono at `rate` Hz → data:audio/wav.
 * Pure path for PCM WAV (encodeWavMono + slice, same defaults as play.html).
 * len<=0 means "to end" for extract; for trim browser default length is 30 when blank.
 */
async function trimAudioToWav(url, start, len, rate = 16000, { fetch: fetchFn, wholeIfBlank = false, signal } = {}) {
  throwIfAborted(signal);
  const bytes = await urlBytes(url, fetchFn);
  throwIfAborted(signal);
  const mime = sniffMime(bytes);

  if (mime === "audio/wav") {
    try {
      const wav = trimPcmWavPure(bytes, start, len, rate, { wholeIfBlank });
      return dataUrlFromBytes(wav, "audio/wav");
    } catch (e) {
      // past-end / too-long are final; only "unsupported format" falls through to ffmpeg
      if (e instanceof NanoodleError) {
        if (/past the end|too long to trim/i.test(e.message || "")) throw e;
        if (!/unsupported format/i.test(e.message || "")) throw e;
      } else {
        throw e;
      }
      // non-PCM or exotic WAV → ffmpeg
    }
  }

  return trimAudioToWavFfmpeg(url, start, len, rate, { fetch: fetchFn, wholeIfBlank, signal });
}

async function trimAudioToWavFfmpeg(url, start, len, rate = 16000, { fetch: fetchFn, wholeIfBlank = false, signal } = {}) {
  return withTemp(async (dir) => {
    throwIfAborted(signal);
    const inPath = await writeInput(dir, "in", url, fetchFn);
    const outPath = join(dir, "out.wav");
    const s = Math.max(0, Number(start) || 0);

    let dur = null;
    try {
      const pr = await runProc("ffprobe", [
        "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inPath,
      ], { signal });
      dur = parseFloat(String(pr.stdout).trim());
    } catch (e) {
      if (e instanceof NanoodleError && (e.code === "aborted" || e.code === "timeout" || /timed out|aborted/i.test(e.message || ""))) throw e;
      if (signal && signal.aborted) throw abortError(signal);
      /* some containers lack duration; ffmpeg -t still works */
    }

    if (dur != null && isFinite(dur) && s >= dur) {
      throw new NanoodleError(
        `the start point (${Math.round(s * 10) / 10}s) is past the end of this clip, which is only ${dur.toFixed(1)}s long — pick an earlier start`);
    }

    let take;
    if (wholeIfBlank && !(len > 0)) {
      take = dur != null && isFinite(dur) ? Math.max(0.05, dur - s) : null;
    } else {
      const L = Number.isFinite(Number(len)) && Number(len) > 0 ? Number(len) : 30;
      take = dur != null && isFinite(dur) ? Math.max(0.05, Math.min(L, dur - s)) : L;
    }

    const args = ["-y", "-ss", String(s), "-i", inPath];
    if (take != null) args.push("-t", String(take));
    args.push("-vn", "-ac", "1", "-ar", String(rate || 16000), "-f", "wav", outPath);
    try {
      await runProc("ffmpeg", args, { signal });
    } catch (e) {
      if (e instanceof NanoodleError && (e.code === "aborted" || e.code === "timeout")) throw e;
      const msg = e.message || "";
      if (/does not contain any stream|Output file does not contain|no audio/i.test(msg)
        || /Stream map|matches no streams/i.test(msg)) {
        throw new NanoodleError("this video is silent — generated videos usually have no audio track to extract");
      }
      if (/Invalid data|could not find codec/i.test(msg)) {
        throw new NanoodleError("couldn't decode that audio for trimming (unsupported format?)");
      }
      throw e;
    }
    return dataUrlFromFile(outPath, "audio/wav");
  });
}

async function extractAudioToWav(url, start, len, rate = 16000, opts = {}) {
  return trimAudioToWav(url, start, len, rate, { ...opts, wholeIfBlank: true });
}

/* ---------- vframes (ffmpeg — needs a video decoder) ----------------------- */

async function extractVideoFrames(url, { count = 1, gap = 0.5, dir = "end", fetch: fetchFn, onProgress, signal } = {}) {
  throwIfAborted(signal);
  const n = Math.max(1, Math.min(MAX_FRAMES, parseInt(count, 10) || 1));
  const stepSec = Number.isFinite(Number(gap)) ? Math.max(0, Number(gap)) : 0.5;
  const fromEnd = (dir || "end") === "end";

  return withTemp(async (dir) => {
    const inPath = await writeInput(dir, "in", url, fetchFn);
    throwIfAborted(signal);
    const pr = await runProc("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=duration,avg_frame_rate", "-show_entries", "format=duration",
      "-of", "json", inPath,
    ], { signal });
    let probed = {};
    try { probed = JSON.parse(String(pr.stdout)); } catch { /* handled by the finite checks below */ }
    const v0 = (probed.streams && probed.streams[0]) || {};
    // Prefer the VIDEO stream's duration: the container's format duration includes the
    // audio track, which routinely outlasts the last video frame (-shortest muxes,
    // padded AAC) — seeking near THAT end decodes zero frames.
    const vdur = parseFloat(v0.duration);
    const fdur = parseFloat((probed.format || {}).duration);
    const dur = [vdur, fdur].filter((d) => isFinite(d) && d > 0).reduce((a, b) => Math.min(a, b), Infinity);
    if (!isFinite(dur)) throw new NanoodleError("video has no readable duration");
    // The last frame's PTS sits a full frame interval before the stream end, so the
    // back-off from the end must exceed one frame or ffmpeg outputs nothing (pts >= t
    // selection). 1.5 frames at the probed rate; 0.1s when the rate is unreadable.
    const rate = String(v0.avg_frame_rate || "").split("/").map(Number);
    const fps = rate.length === 2 && rate[0] > 0 && rate[1] > 0 ? rate[0] / rate[1] : 0;
    const EPS = fps > 0 ? Math.max(0.04, 1.5 / fps) : 0.1;

    const grab = async (t, framePath) => {
      await runProc("ffmpeg", [
        "-y", "-ss", String(t), "-i", inPath, "-frames:v", "1", "-q:v", "2", framePath,
      ], { signal });
    };
    const out = {};
    for (let i = 0; i < n; i++) {
      throwIfAborted(signal);
      if (onProgress) onProgress(`extracting frame ${i + 1}/${n}…`);
      let t = fromEnd ? (dur - EPS - i * stepSec) : (i * stepSec);
      t = Math.max(0, Math.min(Math.max(0, dur - EPS), t));
      const framePath = join(dir, `f${i + 1}.jpg`);
      try {
        await grab(t, framePath);
      } catch (e) {
        // Reported durations can still overshoot the last decodable frame (VFR, sloppy
        // muxes) — step back once before giving up.
        if (t <= 0) throw e;
        await grab(Math.max(0, t - 0.5), framePath);
      }
      out["frame" + (i + 1)] = await dataUrlFromFile(framePath, "image/jpeg");
    }
    return out;
  });
}

/* ---------- combine videos (MP4CAT pure → ffmpeg) -------------------------- */

/**
 * Concatenate clips in order — same dispatcher shape as play.html concatVideos:
 *   1. When every clip is mp4 with matching codec params → MP4CAT lossless remux
 *      (dedup is ignored on remux, as in the browser — dropping the first sample
 *      would kill the keyframe).
 *   2. Else re-encode via ffmpeg (browser falls back to MediaRecorder).
 */
async function concatVideos(urls, dedup = true, { fetch: fetchFn, onProgress, signal } = {}) {
  if (!urls || urls.length < 2) throw new NanoodleError("wire at least two clips to combine");
  throwIfAborted(signal);

  // Pure path: load all bytes, try MP4CAT (exact browser primary path)
  try {
    const bufs = [];
    for (let i = 0; i < urls.length; i++) {
      throwIfAborted(signal);
      if (onProgress) onProgress(`loading clip ${i + 1}/${urls.length}…`);
      bufs.push(await urlBytes(urls[i], fetchFn));
    }
    if (bufs.every((b) => MP4CAT.isMp4(b)) && MP4CAT.mp4ParamsMatch(bufs)) {
      if (onProgress) onProgress("combining…");
      // Browser remux never applies dedup (would drop a keyframe).
      const out = MP4CAT.concatMp4(bufs, { dedup: false });
      return dataUrlFromBytes(out, "video/mp4");
    }
  } catch (e) {
    if (e && (e.code === "aborted" || e.code === "timeout")) throw e;
    if (e instanceof NanoodleError) {
      if (/wire at least two|no media|download media|aborted|timed out/i.test(e.message || "")) throw e;
      throw e; // other deliberate errors (not remux glitches)
    }
    // MP4CAT throws plain Error on parse issues → fall through to ffmpeg
  }

  return concatVideosFfmpeg(urls, dedup, { fetch: fetchFn, onProgress, signal });
}

async function concatVideosFfmpeg(urls, dedup = true, { fetch: fetchFn, onProgress, signal } = {}) {
  return withTemp(async (dir) => {
    const paths = [];
    for (let i = 0; i < urls.length; i++) {
      throwIfAborted(signal);
      if (onProgress) onProgress(`loading clip ${i + 1}/${urls.length}…`);
      paths.push(await writeInput(dir, `c${i}`, urls[i], fetchFn));
    }

    // When dedup: trim ~1/30s from the start of clips 2..N (approximate seam-frame drop —
    // MediaRecorder path equivalent; pure remux path above never drops frames).
    const prepared = [];
    for (let i = 0; i < paths.length; i++) {
      throwIfAborted(signal);
      if (dedup && i > 0) {
        const trimmed = join(dir, `t${i}.mp4`);
        await runProc("ffmpeg", [
          "-y", "-ss", "0.033", "-i", paths[i],
          "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
          "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", trimmed,
        ], { signal });
        prepared.push(trimmed);
      } else {
        prepared.push(paths[i]);
      }
    }

    const listPath = join(dir, "list.txt");
    const listBody = prepared.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
    await writeFile(listPath, listBody);

    const outPath = join(dir, "out.mp4");
    if (onProgress) onProgress("combining…");
    try {
      await runProc("ffmpeg", [
        "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outPath,
      ], { signal });
    } catch (e) {
      if (e instanceof NanoodleError && (e.code === "aborted" || e.code === "timeout" || /aborted|timed out/i.test(e.message || ""))) throw e;
      await runProc("ffmpeg", [
        "-y", "-f", "concat", "-safe", "0", "-i", listPath,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outPath,
      ], { signal });
    }
    return dataUrlFromFile(outPath, "video/mp4");
  });
}

/* ---------- soundtrack mux (ffmpeg — no pure AAC encoder yet) -------------- */

/**
 * Replace video audio with the given track. loop=true loops audio to fill video length.
 * Browser re-records via MediaRecorder; headless uses ffmpeg. (Pure mp4 audio-track
 * replace is a future pure-path candidate once we can encode AAC without ffmpeg.)
 */
async function muxSoundtrack(videoUrl, audioUrl, loop = false, { fetch: fetchFn, onProgress, signal } = {}) {
  return withTemp(async (dir) => {
    throwIfAborted(signal);
    if (onProgress) onProgress("adding soundtrack…");
    const vPath = await writeInput(dir, "v", videoUrl, fetchFn);
    const aPath = await writeInput(dir, "a", audioUrl, fetchFn);
    const outPath = join(dir, "out.mp4");

    let vdur = null;
    try {
      const pr = await runProc("ffprobe", [
        "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", vPath,
      ], { signal });
      vdur = parseFloat(String(pr.stdout).trim());
    } catch (e) {
      if (e instanceof NanoodleError && (e.code === "aborted" || e.code === "timeout" || /timed out|aborted/i.test(e.message || ""))) throw e;
      if (signal && signal.aborted) throw abortError(signal);
      /* optional */
    }

    const args = ["-y", "-i", vPath];
    if (loop) args.push("-stream_loop", "-1");
    args.push("-i", aPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k");
    if (loop && vdur != null && isFinite(vdur)) args.push("-t", String(vdur));
    else args.push("-shortest");
    args.push("-movflags", "+faststart", outPath);

    try {
      await runProc("ffmpeg", args, { signal });
    } catch (e) {
      if (isMissingFfmpeg(e)) throw e;
      if (e instanceof NanoodleError && (e.code === "aborted" || e.code === "timeout" || /aborted|timed out/i.test(e.message || ""))) throw e;
      const args2 = ["-y", "-i", vPath];
      if (loop) args2.push("-stream_loop", "-1");
      args2.push("-i", aPath, "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
        "-c:a", "aac", "-b:a", "128k");
      if (loop && vdur != null && isFinite(vdur)) args2.push("-t", String(vdur));
      else args2.push("-shortest");
      args2.push("-movflags", "+faststart", outPath);
      await runProc("ffmpeg", args2, { signal });
    }
    return dataUrlFromFile(outPath, "video/mp4");
  });
}

__x.MAX_FRAMES = MAX_FRAMES; __x.MAX_IMAGE_DIM = MAX_IMAGE_DIM; __x.MP4CAT = MP4CAT;
// PNG codec internals — used by the nanoodle repo's dual-engine parity harness
// (pixel-level mask comparison + headless canvas shim). Not part of the stable API.
__x.decodePng = decodePng; __x.encodePngRgba = encodePngRgba;

__x.throwIfAborted = throwIfAborted; __x.resizePlan = resizePlan; __x.maskToSource = maskToSource; __x.encodeWavMono = encodeWavMono; __x.resizeCropImage = resizeCropImage; __x.INLINE_IMAGE_BUDGET = INLINE_IMAGE_BUDGET; __x.fitImageInline = fitImageInline; __x.trimAudioToWav = trimAudioToWav; __x.extractAudioToWav = extractAudioToWav; __x.extractVideoFrames = extractVideoFrames; __x.concatVideos = concatVideos; __x.muxSoundtrack = muxSoundtrack;
});
__def("x402.mjs", function (__x, __req) {
const { NanoodleError } = __req("errors.mjs");

/**
 * x402 accountless payments (NanoGPT) — request with `x-x402: true` and no key,
 * get HTTP 402 with payment options, pay in Nano (XNO), call the complete URL,
 * receive the original response.
 *
 * The library NEVER holds funds or keys: the actual send happens inside the
 * user-supplied `payment` callback (their own wallet, signer, or a human
 * scanning a QR). Wire shape live-verified against nano-gpt.com 2026-07-12
 * (tests/fixtures/x402/402.json is a real captured response).
 */

/** Reject anything that isn't a callback — a seed/private key must never reach this library. */
function assertPaymentOption(payment) {
  if (payment == null) return;
  if (typeof payment !== "function") {
    throw new NanoodleError(
      "payment must be a callback function — nanoodle never accepts wallet seeds or private keys. " +
      "Do the send inside your callback with your own wallet/signer (it receives the invoice: " +
      "{ payTo, amountRaw, uri, ... }).", { code: "x402" });
  }
}

/** ISO string or unix seconds → epoch ms (null when absent/unparsable). */
function toMs(v) {
  if (v == null) return null;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v; // seconds vs ms
  const t = Date.parse(v);
  return isNaN(t) ? null : t;
}

/**
 * Pull the Nano payment option out of a 402 response body.
 * Looks in the x402-standard `accepts` array first, then the NanoGPT
 * `payment.accepted` list. Returns a frozen invoice for the payment callback.
 */
function parseNanoInvoice(body, baseUrl) {
  const pay = body && body.payment;
  const pool = [
    ...(Array.isArray(body && body.accepts) ? body.accepts : []),
    ...(Array.isArray(pay && pay.accepted) ? pay.accepted : []),
  ];
  const nano = pool.find((a) => a && a.scheme === "nano" && /^nano_[a-z0-9]+$/.test(String(a.payTo || "")));
  if (!nano) return null;
  const paymentId = nano.paymentId || (pay && pay.paymentId) || null;
  const abs = (u) => (u ? new URL(u, baseUrl).href : null);
  const amountRaw = String(nano.maxAmountRequired || nano.amount || "");
  const usd = nano.maxAmountRequiredUSD != null ? Number(nano.maxAmountRequiredUSD)
    : nano.amountUsd != null ? Number(nano.amountUsd)
    : pay && pay.amountUsd != null ? Number(pay.amountUsd) : null;
  return Object.freeze({
    scheme: "nano",
    paymentId,
    payTo: nano.payTo,
    /** integer raw units (1 XNO = 10^30 raw), as a string */
    amountRaw,
    /** human string, e.g. "0.00018406 XNO" */
    amount: nano.maxAmountRequiredFormatted || nano.amountFormatted || null,
    amountUsd: usd != null && isFinite(usd) ? usd : null,
    /** ready-to-scan/click nano: URI */
    uri: "nano:" + nano.payTo + (amountRaw ? "?amount=" + amountRaw : ""),
    expiresAt: toMs(nano.expiresAt != null ? nano.expiresAt : pay && pay.expiresAt),
    statusUrl: abs(nano.statusUrl || nano.callbackUrl || (pay && pay.statusUrl) || (paymentId && "/api/x402/status/" + paymentId)),
    completeUrl: abs(nano.completeUrl || (pay && pay.completeUrl) || (paymentId && "/api/x402/complete/" + paymentId)),
    explorerUrl: (nano.extra && nano.extra.explorerUrl) || null,
    description: nano.description || null,
    requestHash: (pay && pay.requestHash) || body.requestHash || null,
  });
}

const RESULT_KEYS = ["choices", "data", "output", "runId", "url", "audioUrl", "transcription", "text"];

/** Does a complete-endpoint body already carry the replayed API result? */
function looksLikeResult(j) {
  return !!j && typeof j === "object" && RESULT_KEYS.some((k) => j[k] != null);
}

__x.assertPaymentOption = assertPaymentOption; __x.parseNanoInvoice = parseNanoInvoice; __x.looksLikeResult = looksLikeResult;
});
__def("qr.mjs", function (__x, __req) {
/*
 * qrModules — self-contained QR code generator (module matrix output).
 *
 * Derived from the "QR Code generator library" by Project Nayuki
 * (https://www.nayuki.io/page/qr-code-generator-library), trimmed to
 * byte mode + ECC level M + automatic mask selection. Algorithm unmodified.
 *
 * Copyright (c) Project Nayuki. (MIT License)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 */
function qrModules(text) {
  // ---- UTF-8 encode the text into bytes ----
  var data = [];
  var enc = encodeURIComponent(text);
  for (var ei = 0; ei < enc.length; ei++) {
    var ch = enc.charAt(ei);
    if (ch === "%") { data.push(parseInt(enc.substr(ei + 1, 2), 16)); ei += 2; }
    else data.push(ch.charCodeAt(0));
  }

  // ---- Tables for ECC level M (index = version; index 0 unused) ----
  var ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  var NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

  function numRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }
  function numDataCodewords(ver) {
    return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
  }

  // ---- Choose the smallest version that fits (byte mode) ----
  var version = -1;
  for (var v = 1; v <= 40; v++) {
    var used = 4 + (v < 10 ? 8 : 16) + data.length * 8;
    if (used <= numDataCodewords(v) * 8) { version = v; break; }
  }
  if (version < 0) throw new RangeError("Data too long");

  // ---- Bit buffer: mode + char count + data, terminator, padding ----
  var bb = [];
  function appendBits(val, len) {
    for (var i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
  }
  appendBits(4, 4); // byte-mode indicator
  appendBits(data.length, version < 10 ? 8 : 16);
  for (var di = 0; di < data.length; di++) appendBits(data[di], 8);
  var capacityBits = numDataCodewords(version) * 8;
  appendBits(0, Math.min(4, capacityBits - bb.length));
  appendBits(0, (8 - bb.length % 8) % 8);
  for (var padByte = 0xEC; bb.length < capacityBits; padByte ^= 0xEC ^ 0x11)
    appendBits(padByte, 8);
  var dataCodewords = [];
  for (var ci = 0; ci * 8 < bb.length; ci++) dataCodewords.push(0);
  for (var bi = 0; bi < bb.length; bi++)
    dataCodewords[bi >>> 3] |= bb[bi] << (7 - (bi & 7));

  // ---- Reed-Solomon over GF(2^8/0x11D) ----
  function rsMultiply(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (var d = 0; d < degree; d++) {
      for (var j = 0; j < result.length; j++) {
        result[j] = rsMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = rsMultiply(root, 0x02);
    }
    return result;
  }
  function rsRemainder(dat, divisor) {
    var result = divisor.map(function () { return 0; });
    for (var i = 0; i < dat.length; i++) {
      var factor = dat[i] ^ result.shift();
      result.push(0);
      for (var j = 0; j < divisor.length; j++)
        result[j] ^= rsMultiply(divisor[j], factor);
    }
    return result;
  }

  // ---- Split into blocks, append ECC, interleave ----
  var numBlocks = NUM_BLOCKS[version];
  var blockEccLen = ECC_PER_BLOCK[version];
  var rawCodewords = Math.floor(numRawDataModules(version) / 8);
  var numShortBlocks = numBlocks - rawCodewords % numBlocks;
  var shortBlockLen = Math.floor(rawCodewords / numBlocks);
  var blocks = [];
  var rsDiv = rsDivisor(blockEccLen);
  for (var b = 0, k = 0; b < numBlocks; b++) {
    var dat = dataCodewords.slice(k, k + shortBlockLen - blockEccLen + (b < numShortBlocks ? 0 : 1));
    k += dat.length;
    var ecc = rsRemainder(dat, rsDiv);
    if (b < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  var allCodewords = [];
  for (var p = 0; p < blocks[0].length; p++) {
    for (var q = 0; q < blocks.length; q++) {
      if (p != shortBlockLen - blockEccLen || q >= numShortBlocks)
        allCodewords.push(blocks[q][p]);
    }
  }

  // ---- Module grid ----
  var size = version * 4 + 17;
  var modules = [];
  var isFunction = [];
  for (var r = 0; r < size; r++) {
    var row = [], frow = [];
    for (var c = 0; c < size; c++) { row.push(false); frow.push(false); }
    modules.push(row);
    isFunction.push(frow);
  }

  function setFunctionModule(x, y, isDark) {
    modules[y][x] = isDark;
    isFunction[y][x] = true;
  }
  function getBitOf(x, i) {
    return ((x >>> i) & 1) != 0;
  }
  function drawFinderPattern(x, y) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        var xx = x + dx, yy = y + dy;
        if (0 <= xx && xx < size && 0 <= yy && yy < size)
          setFunctionModule(xx, yy, dist != 2 && dist != 4);
      }
    }
  }
  function drawAlignmentPattern(x, y) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++)
        setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) != 1);
    }
  }
  function alignmentPatternPositions() {
    if (version == 1) return [];
    var numAlign = Math.floor(version / 7) + 2;
    var step = (version == 32) ? 26 :
      Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = size - 7; result.length < numAlign; pos -= step)
      result.splice(1, 0, pos);
    return result;
  }
  // ECC level M has formatBits = 0, so format data = mask alone.
  function drawFormatBits(mask) {
    var fdata = 0 << 3 | mask;
    var rem = fdata;
    for (var i = 0; i < 10; i++)
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = (fdata << 10 | rem) ^ 0x5412;
    for (var a = 0; a <= 5; a++)
      setFunctionModule(8, a, getBitOf(bits, a));
    setFunctionModule(8, 7, getBitOf(bits, 6));
    setFunctionModule(8, 8, getBitOf(bits, 7));
    setFunctionModule(7, 8, getBitOf(bits, 8));
    for (var i2 = 9; i2 < 15; i2++)
      setFunctionModule(14 - i2, 8, getBitOf(bits, i2));
    for (var i3 = 0; i3 < 8; i3++)
      setFunctionModule(size - 1 - i3, 8, getBitOf(bits, i3));
    for (var i4 = 8; i4 < 15; i4++)
      setFunctionModule(8, size - 15 + i4, getBitOf(bits, i4));
    setFunctionModule(8, size - 8, true); // always dark
  }
  function drawVersion() {
    if (version < 7) return;
    var rem = version;
    for (var i = 0; i < 12; i++)
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = version << 12 | rem;
    for (var j = 0; j < 18; j++) {
      var color = getBitOf(bits, j);
      var a = size - 11 + j % 3;
      var bpos = Math.floor(j / 3);
      setFunctionModule(a, bpos, color);
      setFunctionModule(bpos, a, color);
    }
  }
  function drawFunctionPatterns() {
    for (var i = 0; i < size; i++) {
      setFunctionModule(6, i, i % 2 == 0);
      setFunctionModule(i, 6, i % 2 == 0);
    }
    drawFinderPattern(3, 3);
    drawFinderPattern(size - 4, 3);
    drawFinderPattern(3, size - 4);
    var alignPatPos = alignmentPatternPositions();
    var numAlign = alignPatPos.length;
    for (var i5 = 0; i5 < numAlign; i5++) {
      for (var j = 0; j < numAlign; j++) {
        if (!(i5 == 0 && j == 0 || i5 == 0 && j == numAlign - 1 || i5 == numAlign - 1 && j == 0))
          drawAlignmentPattern(alignPatPos[i5], alignPatPos[j]);
      }
    }
    drawFormatBits(0); // dummy; overwritten after mask choice
    drawVersion();
  }
  function drawCodewords(cw) {
    var i = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right == 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) == 0;
          var y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && i < cw.length * 8) {
            modules[y][x] = getBitOf(cw[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }
  function applyMask(mask) {
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 == 0; break;
          case 1: invert = y % 2 == 0; break;
          case 2: invert = x % 3 == 0; break;
          case 3: invert = (x + y) % 3 == 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 == 0; break;
          case 5: invert = x * y % 2 + x * y % 3 == 0; break;
          case 6: invert = (x * y % 2 + x * y % 3) % 2 == 0; break;
          default: invert = ((x + y) % 2 + x * y % 3) % 2 == 0; break;
        }
        if (!isFunction[y][x] && invert)
          modules[y][x] = !modules[y][x];
      }
    }
  }
  var PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;
  function finderPenaltyCountPatterns(runHistory) {
    var n = runHistory[1];
    var core = n > 0 && runHistory[2] == n && runHistory[3] == n * 3 && runHistory[4] == n && runHistory[5] == n;
    return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0)
      + (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
  }
  function finderPenaltyAddHistory(currentRunLength, runHistory) {
    if (runHistory[0] == 0) currentRunLength += size; // light border on initial run
    runHistory.pop();
    runHistory.unshift(currentRunLength);
  }
  function finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory) {
    if (currentRunColor) {
      finderPenaltyAddHistory(currentRunLength, runHistory);
      currentRunLength = 0;
    }
    currentRunLength += size; // light border on final run
    finderPenaltyAddHistory(currentRunLength, runHistory);
    return finderPenaltyCountPatterns(runHistory);
  }
  function getPenaltyScore() {
    var result = 0;
    var x, y, runColor, run, runHistory;
    for (y = 0; y < size; y++) {
      runColor = false; run = 0; runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (x = 0; x < size; x++) {
        if (modules[y][x] == runColor) {
          run++;
          if (run == 5) result += PENALTY_N1;
          else if (run > 5) result++;
        } else {
          finderPenaltyAddHistory(run, runHistory);
          if (!runColor) result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = modules[y][x];
          run = 1;
        }
      }
      result += finderPenaltyTerminateAndCount(runColor, run, runHistory) * PENALTY_N3;
    }
    for (x = 0; x < size; x++) {
      runColor = false; run = 0; runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (y = 0; y < size; y++) {
        if (modules[y][x] == runColor) {
          run++;
          if (run == 5) result += PENALTY_N1;
          else if (run > 5) result++;
        } else {
          finderPenaltyAddHistory(run, runHistory);
          if (!runColor) result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = modules[y][x];
          run = 1;
        }
      }
      result += finderPenaltyTerminateAndCount(runColor, run, runHistory) * PENALTY_N3;
    }
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var color = modules[y][x];
        if (color == modules[y][x + 1] && color == modules[y + 1][x] && color == modules[y + 1][x + 1])
          result += PENALTY_N2;
      }
    }
    var dark = 0;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        if (modules[y][x]) dark++;
      }
    }
    var total = size * size;
    var kk = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += kk * PENALTY_N4;
    return result;
  }

  // ---- Assemble: function patterns, codewords, best-of-8 mask ----
  drawFunctionPatterns();
  drawCodewords(allCodewords);
  var bestMask = 0;
  var minPenalty = Infinity;
  for (var m = 0; m < 8; m++) {
    applyMask(m);
    drawFormatBits(m);
    var penalty = getPenaltyScore();
    if (penalty < minPenalty) { bestMask = m; minPenalty = penalty; }
    applyMask(m); // undo (XOR)
  }
  applyMask(bestMask);
  drawFormatBits(bestMask);

  return modules;
}

/**
 * Render a QR as terminal text using half-block characters (two module rows per
 * text line), with a 2-module quiet zone. Dark modules are "on" (background),
 * matching how phone cameras expect QR contrast on a dark terminal is inverted —
 * so this emits LIGHT blocks for light modules over the terminal default, which
 * scans reliably on both dark and light terminals.
 */
function qrTerminal(text) {
  const m = qrModules(text);
  const size = m.length, border = 2, dim = size + border * 2;
  const at = (x, y) => x >= border && x < size + border && y >= border && y < size + border
    ? m[y - border][x - border] : false;
  const lines = [];
  for (let y = 0; y < dim; y += 2) {
    let line = "";
    for (let x = 0; x < dim; x++) {
      const top = at(x, y), bot = at(x, y + 1);
      // light modules are drawn (block chars), dark modules are terminal background
      line += top && bot ? " " : top ? "\u2584" : bot ? "\u2580" : "\u2588";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

__x.qrModules = qrModules; __x.qrTerminal = qrTerminal;
});
__def("zlib.mjs", function (__x, __req) {
/**
 * Env-adaptive zlib: node:zlib in Node (dynamic import, cached), Compression/
 * DecompressionStream in the browser. Everything is async because browsers have
 * no synchronous form — callers (PNG codec, share links) are async paths anyway.
 */

let _zlib; // undefined = untried, null = unavailable (browser)
async function nodeZlib() {
  if (_zlib === undefined) {
    try { _zlib = await import("node:zlib"); } catch { _zlib = null; }
  }
  return _zlib;
}

async function pipeThrough(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

async function inflate(bytes) {
  const z = await nodeZlib();
  if (z) return new Uint8Array(z.inflateSync(bytes));
  return streamZlib.inflate(bytes);
}

async function deflate(bytes, { level = 9 } = {}) {
  const z = await nodeZlib();
  if (z) return new Uint8Array(z.deflateSync(bytes, { level }));
  return streamZlib.deflate(bytes); // level is a Node-only hint
}

async function gunzip(bytes) {
  const z = await nodeZlib();
  if (z) return new Uint8Array(z.gunzipSync(bytes));
  return streamZlib.gunzip(bytes);
}

/** Offset of the deflate body inside a gzip member, or -1 when the header is not gzip. */
function gzipBodyStart(b) {
  if (b.length < 11 || b[0] !== 0x1f || b[1] !== 0x8b || b[2] !== 8) return -1;
  const flg = b[3];
  let i = 10;
  if (flg & 4) { if (i + 2 > b.length) return -1; i += 2 + (b[i] | (b[i + 1] << 8)); } // FEXTRA
  if (flg & 8) { while (i < b.length && b[i] !== 0) i++; i++; }                        // FNAME
  if (flg & 16) { while (i < b.length && b[i] !== 0) i++; i++; }                       // FCOMMENT
  if (flg & 2) i += 2;                                                                 // FHCRC
  return i < b.length ? i : -1;
}

async function streamInflateRawPartial(body) {
  const chunks = [];
  try {
    const reader = new Blob([body]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } catch { /* keep whatever decompressed before the stream errored */ }
  } catch { return null; }
  let len = 0;
  for (const c of chunks) len += c.length;
  if (!len) return null;
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/**
 * Best-effort gunzip for damaged members: inflates the raw deflate body and
 * ignores the CRC32/ISIZE trailer entirely, returning partial output on
 * truncation. null when nothing decompressible remains.
 */
async function gunzipLax(bytes) {
  const start = gzipBodyStart(bytes);
  if (start < 0) return null;
  // The 8-byte trailer is junk to a raw-deflate decoder; dropping it up front
  // keeps strict stream implementations from erroring on trailing garbage.
  // (When the payload is truncated mid-body this trims real data — the
  // partial-output paths below still salvage everything before the cut.)
  const body = bytes.subarray(start, Math.max(start + 1, bytes.length - 8));
  const z = await nodeZlib();
  if (z) {
    try { return new Uint8Array(z.inflateRawSync(body, { finishFlush: z.constants.Z_SYNC_FLUSH })); }
    catch { return null; }
  }
  return streamInflateRawPartial(body);
}

// The browser implementations, exported so tests can exercise them in Node
// (which also ships Compression/DecompressionStream) without hiding node:zlib.
const streamZlib = {
  inflate: (b) => pipeThrough(b, new DecompressionStream("deflate")),
  deflate: (b) => pipeThrough(b, new CompressionStream("deflate")),
  gunzip: (b) => pipeThrough(b, new DecompressionStream("gzip")),
  gunzipLax: (b) => {
    const start = gzipBodyStart(b);
    return start < 0 ? Promise.resolve(null) : streamInflateRawPartial(b.subarray(start, Math.max(start + 1, b.length - 8)));
  },
};

__x.inflate = inflate; __x.deflate = deflate; __x.gunzip = gunzip; __x.gunzipLax = gunzipLax; __x.streamZlib = streamZlib;
});
__def("mp4cat.mjs", function (__x, __req) {
/**
 * Lossless in-browser mp4 concatenation (Combine node) — ported from nanoodle
 * play.html / index.html MP4CAT IIFE (keep in sync; see nanoodle/scripts/check-combine.mjs).
 *
 * Copies compressed H.264+AAC samples onto one timeline with no decode/re-encode.
 * Used when every clip is mp4 with matching codec params; concatVideos falls back
 * to ffmpeg otherwise (browser falls back to MediaRecorder).
 */
const MP4CAT = (()=>{
const fourcc = (dv, p) => String.fromCharCode(dv.getUint8(p), dv.getUint8(p+1), dv.getUint8(p+2), dv.getUint8(p+3));

function walk(dv, start, end){
  const out = [];
  let p = start;
  while(p + 8 <= end){
    let size = dv.getUint32(p);
    const type = fourcc(dv, p+4);
    let hs = 8;
    if(size === 1){ size = Number(dv.getBigUint64(p+8)); hs = 16; }
    else if(size === 0){ size = end - p; }
    if(size < 8 || p + size > end) break;
    out.push({ type, start: p, end: p+size, body: p+hs });
    p += size;
  }
  return out;
}
const find = (boxes, type) => boxes.find(b => b.type === type);

// Scan a byte range for a box of the given 4cc and return its bytes (used to pull avcC/esds out of
// an stsd for the match gate — the surrounding sample entry can carry clip-specific boxes like btrt).
function scanForBox(u8, type){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for(let p=0; p+8<=u8.length; p++){
    if(fourcc(dv, p+4) === type){
      const size = dv.getUint32(p);
      if(size >= 8 && p + size <= u8.length) return u8.slice(p, p+size);
    }
  }
  return null;
}

// Parse one mp4 into { moovTimescale, tracks:[{kind, timescale, stsdRaw, samples:[{offset,size,dur,cts,sync}], width,height}] }
function parseMp4(u8){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const top = walk(dv, 0, u8.byteLength);
  const moov = find(top, "moov");
  if(!moov) throw new Error("no moov");
  const moovBoxes = walk(dv, moov.body, moov.end);
  const traks = moovBoxes.filter(b => b.type === "trak");
  const tracks = [];
  for(const trak of traks){
    const tb = walk(dv, trak.body, trak.end);
    const mdia = find(tb, "mdia"); if(!mdia) continue;
    const mb = walk(dv, mdia.body, mdia.end);
    const mdhd = find(mb, "mdhd");
    const hdlr = find(mb, "hdlr");
    const mdhdV1 = dv.getUint8(mdhd.body) === 1;
    // v0: [ver/flags 4][ctime 4][mtime 4][timescale 4]; v1: [ver/flags 4][ctime 8][mtime 8][timescale 4]
    const timescale = dv.getUint32(mdhd.body + (mdhdV1 ? 20 : 12));
    const handler = fourcc(dv, hdlr.body + 8); // after ver/flags(4)+pre_defined(4)
    const kind = handler === "vide" ? "video" : handler === "soun" ? "audio" : handler;
    const minf = find(mb, "minf"); const minfB = walk(dv, minf.body, minf.end);
    const stbl = find(minfB, "stbl"); const sb = walk(dv, stbl.body, stbl.end);
    const stsd = find(sb, "stsd");
    const stsdRaw = u8.slice(stsd.start, stsd.end); // whole stsd box, copied verbatim into output
    // codec config only (SPS/PPS or audio decoder config) — the equality signal for the match gate,
    // excluding clip-specific sample-entry boxes (btrt etc) that differ by content.
    const codecCfg = scanForBox(stsdRaw, kind==="video" ? "avcC" : "esds")
                  || scanForBox(stsdRaw, "hvcC") || scanForBox(stsdRaw, "vpcC") || scanForBox(stsdRaw, "av1C");
    // video dims from tkhd
    let width = 0, height = 0;
    const tkhd = find(tb, "tkhd");
    if(tkhd && kind === "video"){ width = dv.getUint16(tkhd.end - 8) ; height = dv.getUint16(tkhd.end - 4); }
    // audio rate/channels from the mp4a sample entry (esds carries clip-specific bitrate, so it's not
    // a stable equality signal — rate+channels is what decides concat compatibility).
    let channels = 0, sampleRate = 0;
    if(kind === "audio"){ const mp4a = scanForBox(stsdRaw, "mp4a"); if(mp4a){ const adv = new DataView(mp4a.buffer, mp4a.byteOffset, mp4a.byteLength); channels = adv.getUint16(24); sampleRate = adv.getUint16(32); } }

    // --- sample tables ---
    const stts = find(sb, "stts"), stsc = find(sb, "stsc"), stsz = find(sb, "stsz");
    const stco = find(sb, "stco"), co64 = find(sb, "co64"), ctts = find(sb, "ctts"), stss = find(sb, "stss");

    // stsz
    const stszSampleSize = dv.getUint32(stsz.body + 4);
    const sampleCount = dv.getUint32(stsz.body + 8);
    const sizes = new Array(sampleCount);
    if(stszSampleSize === 0){ for(let i=0;i<sampleCount;i++) sizes[i] = dv.getUint32(stsz.body + 12 + i*4); }
    else sizes.fill(stszSampleSize);

    // stts -> per-sample duration
    const sttsN = dv.getUint32(stts.body + 4);
    const durs = new Array(sampleCount); let si = 0;
    for(let e=0;e<sttsN;e++){ const cnt = dv.getUint32(stts.body + 8 + e*8); const delta = dv.getUint32(stts.body + 12 + e*8); for(let k=0;k<cnt && si<sampleCount;k++) durs[si++] = delta; }
    while(si < sampleCount) durs[si++] = durs[si-2] || 0;

    // ctts -> per-sample composition offset (may be signed in v1; treat as int32)
    const cts = new Array(sampleCount).fill(0);
    if(ctts){ const n = dv.getUint32(ctts.body + 4); let ci = 0; for(let e=0;e<n;e++){ const cnt = dv.getUint32(ctts.body + 8 + e*8); const off = dv.getInt32(ctts.body + 12 + e*8); for(let k=0;k<cnt && ci<sampleCount;k++) cts[ci++] = off; } }

    // stss -> sync set (1-based). absent => all sync
    let syncSet = null;
    if(stss){ syncSet = new Set(); const n = dv.getUint32(stss.body + 4); for(let e=0;e<n;e++) syncSet.add(dv.getUint32(stss.body + 8 + e*4)); }

    // chunk offsets
    const co = stco || co64; const is64 = !!co64;
    const coN = dv.getUint32(co.body + 4);
    const chunkOffsets = new Array(coN);
    for(let e=0;e<coN;e++) chunkOffsets[e] = is64 ? Number(dv.getBigUint64(co.body + 8 + e*8)) : dv.getUint32(co.body + 8 + e*4);

    // stsc -> samples per chunk
    const stscN = dv.getUint32(stsc.body + 4);
    const stscEntries = [];
    for(let e=0;e<stscN;e++) stscEntries.push({ first: dv.getUint32(stsc.body + 8 + e*12), spc: dv.getUint32(stsc.body + 12 + e*12) });

    // compute per-sample file offset
    const samples = [];
    let sIdx = 0;
    for(let c=0;c<coN;c++){
      // samples in this chunk = spc from the applicable stsc entry
      let spc = 1;
      for(let e=stscEntries.length-1;e>=0;e--){ if((c+1) >= stscEntries[e].first){ spc = stscEntries[e].spc; break; } }
      let off = chunkOffsets[c];
      for(let k=0;k<spc && sIdx<sampleCount;k++){
        samples.push({ offset: off, size: sizes[sIdx], dur: durs[sIdx], cts: cts[sIdx], sync: syncSet ? syncSet.has(sIdx+1) : true });
        off += sizes[sIdx];
        sIdx++;
      }
    }
    if(samples.length !== sampleCount) throw new Error("sample count mismatch " + samples.length + "/" + sampleCount);
    tracks.push({ kind, timescale, stsdRaw, codecCfg, samples, width, height, channels, sampleRate });
  }
  return { tracks };
}

// ---- box writers ----
const enc = (s) => Uint8Array.from(s, c => c.charCodeAt(0));
function u32(n){ const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n>>>0); return a; }
function u16(n){ const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n & 0xffff); return a; }
function concat(arrs){ let len=0; for(const a of arrs) len += a.length; const out = new Uint8Array(len); let p=0; for(const a of arrs){ out.set(a, p); p += a.length; } return out; }
function box(type, ...payload){ const body = concat(payload); return concat([u32(body.length + 8), enc(type), body]); }
function fullbox(type, version, flags, ...payload){ return box(type, Uint8Array.from([version, (flags>>16)&255, (flags>>8)&255, flags&255]), ...payload); }

function rle(values){ // -> [count,val] runs, returns entries array of Uint8Array pairs
  const runs = []; let i=0;
  while(i<values.length){ let j=i+1; while(j<values.length && values[j]===values[i]) j++; runs.push([j-i, values[i]]); i=j; }
  return runs;
}

// Concatenate. buffers: array of Uint8Array (whole mp4 files). opts.dedup drops each later clip's first video sample.
function concatMp4(buffers, opts){
  const dedup = !!(opts && opts.dedup);
  const parsed = buffers.map(parseMp4);
  // gather track kinds present in clip0
  const base = parsed[0];
  const outTracks = [];
  for(let ti=0; ti<base.tracks.length; ti++){
    const kind = base.tracks[ti].kind;
    if(kind !== "video" && kind !== "audio") continue;
    const outTs = base.tracks[ti].timescale;
    const merged = { kind, timescale: outTs, stsdRaw: base.tracks[ti].stsdRaw, width: base.tracks[ti].width, height: base.tracks[ti].height, samples: [] };
    for(let ci=0; ci<parsed.length; ci++){
      const t = parsed[ci].tracks.find((x,i)=> x.kind===kind && (kind!=="video" || true) );
      if(!t){ throw new Error("clip "+ci+" missing "+kind+" track"); }
      const scale = outTs / t.timescale;
      let list = t.samples;
      if(dedup && kind==="video" && ci>0) list = list.slice(1);
      for(const s of list){
        merged.samples.push({ bufIdx: ci, offset: s.offset, size: s.size, dur: Math.round(s.dur*scale), cts: Math.round(s.cts*scale), sync: s.sync });
      }
    }
    outTracks.push(merged);
  }

  // Build mdat first so chunk offsets are known. Layout: ftyp + mdat + moov.
  const ftyp = box("ftyp", enc("isom"), u32(0x200), enc("isomiso2avc1mp41"));
  // assemble mdat data, recording each sample's absolute offset
  const mdatParts = [];
  let cursor = ftyp.length + 8; // 8 = mdat header
  for(const t of outTracks){
    for(const s of t.samples){
      s.newOffset = cursor;
      const src = buffers[s.bufIdx].subarray(s.offset, s.offset + s.size);
      mdatParts.push(src);
      cursor += s.size;
    }
  }
  const mdatData = concat(mdatParts);
  const mdat = concat([u32(mdatData.length + 8), enc("mdat"), mdatData]);

  // moov
  const mvTimescale = 1000;
  let maxDurMs = 0;
  const trakBoxes = [];
  let trackId = 1;
  for(const t of outTracks){
    const totalTicks = t.samples.reduce((a,s)=>a+s.dur, 0);
    const durMs = Math.round(totalTicks / t.timescale * mvTimescale);
    if(durMs > maxDurMs) maxDurMs = durMs;

    // stbl children
    const sttsRuns = rle(t.samples.map(s=>s.dur));
    const stts = fullbox("stts", 0, 0, u32(sttsRuns.length), ...sttsRuns.map(r=>concat([u32(r[0]), u32(r[1])])));
    const stsz = fullbox("stsz", 0, 0, u32(0), u32(t.samples.length), ...t.samples.map(s=>u32(s.size)));
    const stsc = fullbox("stsc", 0, 0, u32(1), concat([u32(1), u32(1), u32(1)]));
    const stco = fullbox("stco", 0, 0, u32(t.samples.length), ...t.samples.map(s=>u32(s.newOffset)));
    const children = [t.stsdRaw, stts];
    if(t.kind==="video"){
      const anyCts = t.samples.some(s=>s.cts!==0);
      if(anyCts){ const cttsRuns = rle(t.samples.map(s=>s.cts)); children.push(fullbox("ctts", 0, 0, u32(cttsRuns.length), ...cttsRuns.map(r=>concat([u32(r[0]), u32(r[1]>>>0)])))); }
      const syncIdx = []; t.samples.forEach((s,i)=>{ if(s.sync) syncIdx.push(i+1); });
      if(syncIdx.length && syncIdx.length !== t.samples.length) children.push(fullbox("stss", 0, 0, u32(syncIdx.length), ...syncIdx.map(u32)));
    }
    children.push(stsc, stsz, stco);
    const stbl = box("stbl", ...children);

    const mediaHeader = t.kind==="video"
      ? box("vmhd", Uint8Array.from([0,0,0,1]), new Uint8Array(8))
      : box("smhd", new Uint8Array(8));
    const dref = fullbox("dref", 0, 0, u32(1), fullbox("url ", 0, 1));
    const dinf = box("dinf", dref);
    const minf = box("minf", mediaHeader, dinf, stbl);

    const hdlrName = enc(t.kind==="video" ? "VideoHandler\0" : "SoundHandler\0");
    const hdlr = fullbox("hdlr", 0, 0, u32(0), enc(t.kind==="video"?"vide":"soun"), new Uint8Array(12), hdlrName);
    const mdhd = fullbox("mdhd", 0, 0, u32(0), u32(0), u32(t.timescale), u32(totalTicks), Uint8Array.from([0x55,0xc4,0,0]));
    const mdia = box("mdia", mdhd, hdlr, minf);

    // tkhd (enabled+in_movie flags=7)
    const w = (t.width||0), h = (t.height||0);
    const tkhdBody = concat([
      u32(0), u32(0), u32(trackId), u32(0), u32(durMs),
      new Uint8Array(8), u16(0), u16(0), u16(t.kind==="audio"?0x0100:0), u16(0),
      // matrix
      concat([u32(0x00010000),u32(0),u32(0),u32(0),u32(0x00010000),u32(0),u32(0),u32(0),u32(0x40000000)]),
      u32(w<<16), u32(h<<16)
    ]);
    const tkhd = fullbox("tkhd", 0, 7, tkhdBody);
    trakBoxes.push(box("trak", tkhd, mdia));
    trackId++;
  }
  const mvhd = fullbox("mvhd", 0, 0, u32(0), u32(0), u32(mvTimescale), u32(maxDurMs),
    u32(0x00010000), u16(0x0100), u16(0), new Uint8Array(8),
    concat([u32(0x00010000),u32(0),u32(0),u32(0),u32(0x00010000),u32(0),u32(0),u32(0),u32(0x40000000)]),
    new Uint8Array(24), u32(trackId));
  const moov = box("moov", mvhd, ...trakBoxes);

  return concat([ftyp, mdat, moov]);
}

// quick sniff
function isMp4(u8){ if(u8.length<12) return false; const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength); return fourcc(dv,4)==="ftyp"; }

function bytesEqual(a, b){ if(!a || !b || a.length !== b.length) return false; for(let i=0;i<a.length;i++) if(a[i]!==b[i]) return false; return true; }

// Strict gate: every clip must have the same track shape and byte-identical codec config
// (avcC / esds live in stsd). A false positive silently corrupts output, so default to NO on any doubt.
function mp4ParamsMatch(bufs){
  try{
    if(bufs.length < 2) return false;
    const ps = bufs.map(parseMp4);
    const sig = (p)=>{
      const vids = p.tracks.filter(t=>t.kind==="video");
      const auds = p.tracks.filter(t=>t.kind==="audio");
      if(vids.length !== 1) return null;                 // need exactly one video track
      if(auds.length > 1) return null;
      return { v: vids[0], a: auds[0] || null, na: auds.length };
    };
    const base = sig(ps[0]); if(!base) return false;
    for(let i=1;i<ps.length;i++){
      const s = sig(ps[i]); if(!s) return false;
      if(s.na !== base.na) return false;                 // all-or-none audio
      if(s.v.width !== base.v.width || s.v.height !== base.v.height) return false;
      if(!bytesEqual(s.v.codecCfg, base.v.codecCfg)) return false;   // same video SPS/PPS (avcC)
      if(base.a && (s.a.sampleRate !== base.a.sampleRate || s.a.channels !== base.a.channels)) return false; // audio concat-compatible
    }
    return true;
  }catch(e){ return false; }
}
  return { concatMp4, isMp4, mp4ParamsMatch, parseMp4 };
})();


__x.MP4CAT = MP4CAT;
__x.default = MP4CAT;
});
  window.NanoodleEngine = __req("browser.mjs");
  window.NanoodleEngine.version = "src-9996878def83";
})();
