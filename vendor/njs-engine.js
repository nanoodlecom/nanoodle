/* data-hash=21720365741a6446 */
/* nanoodle-js browser engine — generated from nanoodle-js@src-6ca5f20ba248 (35 modules) */
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
{ const __m = __req("resumable-media.mjs"); __x.runResumableMedia = __m.runResumableMedia; }
{ const __m = __req("graph.mjs"); __x.NODE_TYPES = __m.NODE_TYPES; __x.displayName = __m.displayName; __x.materialize = __m.materialize; __x.topoSort = __m.topoSort; __x.wiredFramesFloor = __m.wiredFramesFloor; __x.MAX_FRAMES = __m.MAX_FRAMES; }
{ const __m = __req("nodes.mjs"); __x.RUNNERS = __m.RUNNERS; __x.IMG_INPUT_ROLES = __m.IMG_INPUT_ROLES; } // per-node executors — the play delegation shim drives these directly
{ const __m = __req("catalog.mjs"); __x.catItem = __m.catItem; __x.chatModelCan = __m.chatModelCan; }
{ const __m = __req("io.mjs"); __x.deriveInputs = __m.deriveInputs; __x.deriveOutputs = __m.deriveOutputs; __x.deriveSettings = __m.deriveSettings; __x.INPUT_SPECS = __m.INPUT_SPECS; __x.SETTING_SPECS = __m.SETTING_SPECS; }
{ const __m = __req("branches.mjs"); __x.planBranches = __m.planBranches; }
{ const __m = __req("share.mjs"); __x.decodeShareUrl = __m.decodeShareUrl; __x.decodeShareFragment = __m.decodeShareFragment; __x.isShareRef = __m.isShareRef; }
{ const __m = __req("local-media.mjs"); __x.resizePlan = __m.resizePlan; __x.maskToSource = __m.maskToSource; __x.resizeCropImage = __m.resizeCropImage; __x.encodeWavMono = __m.encodeWavMono; }
{ const __m = __req("x402.mjs"); __x.parseNanoInvoice = __m.parseNanoInvoice; }
{ const __m = __req("qr.mjs"); __x.qrTerminal = __m.qrTerminal; __x.qrModules = __m.qrModules; }

});
__def("workflow.mjs", function (__x, __req) {
const { NanoodleError, RunError, UnsupportedNodeError } = __req("errors.mjs");
const { abortReason, enforceDeadline, normalizeTimeoutMs, startDeadline, throwIfAborted } = __req("deadline.mjs");
const { NODE_TYPES, assertNodeRecord, displayName, isInputPort, lockedNode, materialize, topoSort, wireIssue, wiredFramesFloor, MAX_FRAMES } = __req("graph.mjs");
const { COMPETING_INPUT_WIRES, competingInputIssues, staticCompetingInputIssues } = __req("input-wires.mjs");
const { endpointOutPort } = __req("endpoint.mjs");
const { MEDIA_INPUT_KINDS, deriveInputs, deriveOutputs, deriveSettings, resolveInputKey, resolveSettingKey } = __req("io.mjs");
const { NanoClient } = __req("client.mjs");
const { MediaRef, coerceMediaInput } = __req("media.mjs");
const { RUNNERS } = __req("nodes.mjs");
const { learnPromptCap, withFittedPrompt } = __req("prompt-caps.mjs");
const { decodeShareUrl, isShareRef } = __req("share.mjs");
const { isBranchDecider, planBranches } = __req("branches.mjs");

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

/** Ports whose value is media a later node will fetch or inline. */
const HANDED_MEDIA_PORT = /^(?:video|audio|image|mask|endframe|model)$|^(?:img|image|vid|clip|ref|frame)\d+$/;
const MEDIA_OUT_TYPES = new Set(["image", "audio", "video", "model3d"]);

function mediaOutputKeys(node, out) {
  const keys = [];
  const add = (k) => { if (k && !keys.includes(k)) keys.push(k); };
  if (!out || typeof out !== "object") return keys;
  if (node.type === "endpoint") {
    const p = endpointOutPort(node, out);
    if (MEDIA_OUT_TYPES.has(p.type)) add(p.name);
  } else if (node.type === "vframes") {
    for (const k of Object.keys(out)) if (/^frame\d+$/.test(k)) add(k);
  } else {
    const spec = NODE_TYPES[node.type];
    for (const p of (spec && spec.outputs) || []) {
      if (MEDIA_OUT_TYPES.has(p.type)) add(p.name);
    }
  }
  if (Array.isArray(out.images)) add("images");
  return keys;
}

/**
 * Resolve provider-relative content URLs on a node's media outputs before they
 * are stored or wired onward. One fetch per distinct URL (image + images[]).
 */
async function publishNodeMedia(client, node, out, signal) {
  if (!out || typeof out !== "object" || Array.isArray(out)) return out;
  const keys = mediaOutputKeys(node, out);
  if (!keys.length) return out;
  const cache = new Map();
  const resolve = async (value) => {
    if (typeof value === "string") {
      if (!value) return value;
      if (cache.has(value)) return cache.get(value);
      throwIfAborted(signal);
      const resolved = await client.resolveContentUrl(value, { signal });
      cache.set(value, resolved);
      return resolved;
    }
    if (Array.isArray(value)) {
      let changed = false;
      const next = [];
      for (const item of value) {
        const r = await resolve(item);
        if (r !== item) changed = true;
        next.push(r);
      }
      return changed ? next : value;
    }
    return value;
  };
  let copy = null;
  for (const k of keys) {
    const resolved = await resolve(out[k]);
    if (resolved !== out[k]) {
      if (!copy) copy = { ...out };
      copy[k] = resolved;
    }
  }
  return copy || out;
}

/** Bound an async stage even when injected I/O ignores AbortSignal. Always observe late rejection. */
function withSignal(work, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(async () => {
      throwIfAborted(signal);
      const value = await work();
      throwIfAborted(signal);
      return value;
    }).then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** The outcome of Workflow.run(). Media values are MediaRef; text values plain strings. */
/** Internal: thrown by a node skipped behind a closed gate, so ITS dependents skip too. Never surfaced. */
class GateSkip extends Error {
  constructor(gatedBy) { super("skipped — a gate upstream said no"); this.gatedBy = gatedBy; }
}

class RunResult {
  constructor({ outputs, nodes, errors, gated = [], payments = [], costUsd, costExact, remainingBalance }) {
    /** { [friendlyKey | nodeId]: value } — sink node primary outputs (a sink skipped by a closed gate has none) */
    this.outputs = outputs;
    /**
     * per-node { status: "done"|"error"|"gated"|"skipped", out, error, costUsd, ms, runId }.
     * runId: the provider's async video/3D/audio job ID, or null when none was returned.
     * Retained on failure/timeout too, so an accepted job can be traced without resubmitting.
     * "gated": a ⚖️ Decide yes/no gate that answered no — it ran and billed, `out` holds its answer
     * ({ text: "no", decision }), and it carries `gate: { yes, message }`. Not an error.
     * "skipped" + `gatedBy: <decide node id>`: downstream of a closed gate — never ran, never billed.
     * (Annotation notes are "skipped" with no gatedBy.)
     */
    this.nodes = nodes;
    /** [{ nodeId, name, message }] for every node that failed (incl. non-sink warnings) — never gates */
    this.errors = errors;
    /**
     * [{ nodeId, name, message, yes, skipped: [nodeId…] }] — every Decide gate that closed this run.
     * A closed gate is a deliberate, successful outcome: run() resolves, it never throws for one.
     */
    this.gated = gated;
    /** summed USD cost of all calls that reported one */
    this.costUsd = costUsd;
    /** false when any network call omitted its price (total is a floor) */
    this.costExact = costExact;
    /** last remaining-balance the API reported, or null */
    this.remainingBalance = remainingBalance;
    /** x402 wallet attempts and provider acknowledgement/recovery details for this run */
    this.payments = payments;
  }

  /** Output lookup by friendly key or node id (case-insensitive). */
  get(key) {
    // own-key check: `in` would leak Object.prototype members (get("toString") → a function)
    if (Object.hasOwn(this.outputs, key)) return this.outputs[key];
    const norm = String(key).trim().toLowerCase();
    for (const k of Object.keys(this.outputs)) {
      if (k.toLowerCase() === norm) return this.outputs[k];
    }
    const g = (this._gatedOutputs || []).find((o) => o.key.toLowerCase() === norm || o.nodeId.toLowerCase() === norm);
    if (g) throw new NanoodleError(`output "${g.key}" was skipped — the gate "${g.gateName}" answered no, so it never ran (see result.gated)`, { code: "gated" });
    throw new NanoodleError(`no output "${key}" — available outputs: ${Object.keys(this.outputs).map((k) => `"${k}"`).join(", ") || "(none)"}`);
  }
}

function isPlainObject(v) {
  if (v == null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isTrimmedAudioInput(entry, graph, byId) {
  if (entry.kind !== "audio" || byId.get(entry.nodeId)?.type !== "aupload") return false;
  const destinations = graph.links.filter(link => link.from.node === entry.nodeId);
  return destinations.length > 0 && destinations.every(({ from, to }) =>
    from.port === "audio" && to.port === "audio" && byId.get(to.node)?.type === "trim");
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
    /**
     * Prompt character caps learned from live 400s ("kind:id" → cap), on top of the probed table in
     * prompt-caps.mjs. Per-instance and in-memory: a run that hits an unknown model's limit teaches
     * the next run of the same Workflow, which is where a retry actually happens.
     */
    this._promptCaps = new Map();
    /** Load-time graph warnings, including unknown node types and invalid wires. */
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

    for (const [index, n] of graph.nodes.entries()) {
      // Workflow.graph can be edited after materialize; validate before scheduling it.
      assertNodeRecord(n, index);
      if (n.unknown || !Object.hasOwn(NODE_TYPES, n.type)) {
        throw new UnsupportedNodeError(
          `node ${n.id}: unknown node type '${n.type}' — this graph needs a newer nanoodle library`,
          { nodeId: n.id, nodeType: n.type });
      }
    }

    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const link of graph.links) {
      const issue = wireIssue(link, byId);
      if (issue) throw new NanoodleError(issue.message, { code: issue.code });
    }

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
      const target = graph.nodes.find((x) => x.id === entry.nodeId);
      if (lockedNode(target)) {
        throw new NanoodleError(
          `setting "${key}" targets locked node ${entry.nodeId} (${displayName(target)}) — ` +
          `a locked node always runs with its stored fields, so settings can't override ${entry.nodeId}.${entry.field}`,
          { code: "locked" });
      }
      settingAssignments.push({ entry, value });
    }

    const order = topoSort(graph); // throws naming cyclic nodes
    const branches = planBranches(graph, order.map(n => n.id));

    // Local-only graphs never POST media — skip the ~4 MB inline cap on inputs.
    // Mixed/network graphs keep the cap so we fail before spending on an oversize body.
    const hasNetwork = graph.nodes.some((n) => NODE_TYPES[n.type] && NODE_TYPES[n.type].network);
    const mediaCoerceOpts = { enforceInlineMax: hasNetwork };

    // effective fields: graph fields + settings overrides + user inputs
    const effFields = new Map(graph.nodes.map((n) => [n.id, { ...n.fields }]));
    for (const { entry, value } of settingAssignments) {
      effFields.get(entry.nodeId)[entry.field] = this._coerceSetting(entry, value);
    }
    const inputConflict = staticCompetingInputIssues(graph, order, branches, node => effFields.get(node.id))[0];
    if (inputConflict) throw new NanoodleError(inputConflict, { code: COMPETING_INPUT_WIRES });
    const explicit = new Set();
    for (const { entry, value } of inputAssignments) {
      // When all uses go through Trim, only the trimmed output can reach a request.
      const opts = hasNetwork && isTrimmedAudioInput(entry, graph, byId)
        ? { enforceInlineMax: false } : mediaCoerceOpts;
      effFields.get(entry.nodeId)[entry.field] = this._coerceInput(entry, value, opts);
      explicit.add(entry);
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

    const runTimeoutMs = normalizeTimeoutMs(timeoutMs, "run timeoutMs");
    for (const n of graph.nodes) {
      normalizeTimeoutMs(effFields.get(n.id).timeoutMs, `node ${n.id} timeoutMs`);
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
    if (runTimeoutMs != null) {
      timer = startDeadline(ac, runTimeoutMs, `run timed out after ${runTimeoutMs}ms`);
    }

    const emit = (evt) => { if (onProgress) { try { onProgress(evt); } catch { /* listener errors never kill the run */ } } };
    const nodesRec = Object.fromEntries(graph.nodes.map(n => [n.id, null]));
    const errors = [];
    const payments = [];
    const canPay = !this.client.apiKey && this.client.payment;
    const cost = { total: 0, exact: true, balance: null };
    const promises = new Map();
    const mediaFetch = this.client.fetch;

    // Once a node is finalized (done / skipped / error) or the run has settled, late
    // callbacks from a runner that ignored its abort signal must not mutate anything.
    let runSettled = false;
    const frozen = (rec) => runSettled || rec.final === true;
    const ctxFor = (node, rec, nodeSignal, trackPayment) => {
      const report = (evt) => {
        if (frozen(rec)) return;
        emit(evt);
        throwIfAborted(nodeSignal);
      };
      const onCost = (c) => {
        if (!c || frozen(rec)) return;
        if (c.usd != null) { rec.costUsd = (rec.costUsd || 0) + c.usd; cost.total += c.usd; }
        else cost.exact = false;
        if (c.balance != null) cost.balance = c.balance;
      };
      const onPoll = (info) => report({ type: "poll", nodeId: node.id, name: displayName(node), ...info });
      const onRunId = (job) => {
        if (frozen(rec)) return;
        const runId = job && typeof job === "object" ? (job.runId || job.id) : job;
        if (runId == null) return;
        rec.runId = runId;
        report({ type: "node-run-id", nodeId: node.id, name: displayName(node), runId });
      };
      const io = { onCost, onPoll, onRunId, signal: nodeSignal, trackPayment };
      return {
        chat: (messages, model, opts) => this.client.chat(messages, model, opts, io),
        decide: (body) => this.client.decide(body, io),
        image: (args) => this.client.image(args, io),
        video: (model, prompt, opts, imageDataUrl) => this.client.video(model, prompt, opts, imageDataUrl, io),
        audio: (model, input, extra) => this.client.audio(model, input, extra, io),
        transcribe: (model, audioUrl, language) => this.client.transcribe(model, audioUrl, language, io),
        fetchMedia: (url) => this.client.fetchMediaDataUrl(url, io),
        // local media (resize/combine/…) — same fetch + signal as network I/O
        fetch: mediaFetch,
        signal: nodeSignal,
        catalog: this.catalog,
        progress: (msg) => report({ type: "node-progress", nodeId: node.id, name: displayName(node), message: msg }),
      };
    };

    const gated = [];
    // a node whose upstream settled as a closed gate (or was itself skipped by one) → that gate's id
    const gateOf = (id) => {
      const r = nodesRec[id];
      if (!r) return null;
      if (r.status === "gated") return id;
      if (r.status === "skipped" && r.gatedBy) return r.gatedBy;
      return null;
    };
    const execNode = async (n) => {
      const rec = nodesRec[n.id];
      let nodeTimer = null, unlinkNode = null;
      let nodeController = null;
      let nodeSignal = ac.signal;
      const nodePayments = [];
      const activePayments = canPay ? new Set() : null;
      const trackPayment = canPay ? (record, drained) => {
        record.nodeId = n.id;
        nodePayments.push(record);
        payments.push(record);
        activePayments.add(drained);
        drained.then(() => activePayments.delete(drained));
      } : undefined;
      try {
        throwIfAborted(ac.signal);
        let inbound = graph.links.filter((l) => l.to.node === n.id);
        if (branches) {
          await Promise.allSettled(inbound.map(l => promises.get(l.from.node)));
          inbound = branches.activeLinks(n.id, id => nodesRec[id]?.status === "done" ? nodesRec[id].out : null);
          if (inbound === null) {
            rec.status = "skipped";
            rec.skipReason = "branch";
            emit({ type: "node-skipped", nodeId: n.id, name: displayName(n), reason: "branch" });
            return {};
          }
        }
        const supplied = [];
        let upstreamFail = null, gatedBy = null, skippedIn = 0;
        for (const l of inbound) {
          let srcOut;
          try {
            srcOut = await promises.get(l.from.node);
            if (nodesRec[l.from.node] && nodesRec[l.from.node].skippedOnError) { skippedIn++; continue; }
          }
          catch {
            const g = gateOf(l.from.node);
            if (g) { if (!gatedBy) gatedBy = g; } else if (!upstreamFail) upstreamFail = displayName(byId.get(l.from.node));
            continue;
          }
          const v = srcOut[l.from.port];
          if (v != null) supplied.push({ link: l, value: v });
        }
        // a real failure upstream wins over a gate (the browser runners agree): that is an error
        if (upstreamFail) throw new NanoodleError("upstream failed: " + upstreamFail);
        // onError:"skip" upstreams leave their ports undefined (ignored above). A node whose
        // EVERY wire comes from a skipped node has nothing left to work with — fail clearly.
        if (inbound.length && skippedIn === inbound.length) {
          throw new NanoodleError("all inputs were skipped after failing: " +
            [...new Set(inbound.map((l) => displayName(byId.get(l.from.node))))].join(", "));
        }
        if (gatedBy) {
          rec.status = "skipped";
          rec.gatedBy = gatedBy;
          const gr = gated.find((x) => x.nodeId === gatedBy);
          if (gr) gr.skipped.push(n.id);
          emit({ type: "node-skipped", nodeId: n.id, name: displayName(n), reason: "gated", gatedBy });
          throw new GateSkip(gatedBy);
        }
        throwIfAborted(ac.signal);
        const conflict = competingInputIssues(supplied.map(({ link }) => link))[0];
        if (conflict) throw new NanoodleError(conflict, { code: COMPETING_INPUT_WIRES });
        const inp = {};
        let fields = effFields.get(n.id);
        for (const { link, value } of supplied) {
          const port = link.to.port;
          if (isInputPort(n, port)) {
            // Resolve an upstream provider's content URL before the consumer builds its payload.
            inp[port] = (typeof value === "string" && value && HANDED_MEDIA_PORT.test(port))
              ? await withSignal(() => this.client.resolveContentUrl(value, { signal: ac.signal }), ac.signal)
              : value;
          }
          // Custom endpoint url/mode: a Choice path like "/post" must ride inp so
          // endpointResolveTarget can join it onto the typed host.
          else if (n.type === "endpoint" && (port === "url" || port === "mode")) {
            inp[port] = value;
          }
          else fields = { ...fields, [port]: value };
        }
        // The floor applies to the resolved frame count, which a wire can override.
        // The extractor still uses the requested stride and range.
        if (n.type === "vframes") {
          const floor = wiredFramesFloor(graph, n.id);
          const count = Math.max(1, Math.min(MAX_FRAMES, parseInt(fields.frames, 10) || 1));
          if (floor > count) fields = { ...fields, frames: String(floor) };
        }
        throwIfAborted(ac.signal);
        // Prompt length caps (see prompt-caps.mjs). Many image/video models reject an over-long
        // prompt at the route, and in a graph the prompt is WRITTEN by an upstream LLM — so a
        // caller has nothing to shorten. Trim it to fit rather than send a request certain to 400,
        // and report it below. The graph's own prompts are never rewritten to avoid this.
        if (n.type === "decide" && fields.branch !== n.fields.branch) fields = { ...fields, branch: n.fields.branch };
        const fit = withFittedPrompt(n, fields, { catalog: this.catalog, learned: this._promptCaps });
        fields = fit.fields;
        throwIfAborted(ac.signal);
        const t0 = Date.now();
        // The node deadline covers progress callbacks, the runner and media publication.
        // Incoming wires can override the stored timeout after preflight.
        const timeoutMs = normalizeTimeoutMs(fields.timeoutMs, `node ${n.id} timeoutMs`);
        if (timeoutMs != null || canPay) {
          nodeController = new AbortController();
          const onRunAbort = () => nodeController.abort(ac.signal.reason);
          ac.signal.addEventListener("abort", onRunAbort, { once: true });
          unlinkNode = () => ac.signal.removeEventListener("abort", onRunAbort);
          nodeSignal = nodeController.signal;
          nodeTimer = startDeadline(nodeController, timeoutMs, `node timed out after ${timeoutMs}ms`, ac.signal);
        }
        rec.started = true;
        emit({ type: "node-start", nodeId: n.id, name: displayName(n) });
        throwIfAborted(nodeSignal);
        // A fitted prompt changed what this run pays for — never silent, even headless.
        if (fit.trimmed) {
          emit({ type: "prompt-trimmed", nodeId: n.id, name: displayName(n), ...fit.trimmed });
          warnGraph(`node ${n.id}: prompt trimmed ${fit.trimmed.from} → ${fit.trimmed.to} characters — ` +
            `${fields.model} rejects prompts over ${fit.trimmed.cap}`);
        }
        throwIfAborted(nodeSignal);
        const nodeForRun = { ...n, fields };
        const out = await withSignal(async () => {
          const rawOut = await RUNNERS[n.type](nodeForRun, inp, ctxFor(n, rec, nodeSignal, trackPayment));
          throwIfAborted(nodeSignal);
          return publishNodeMedia(this.client, nodeForRun, rawOut, nodeSignal);
        }, nodeSignal);
        throwIfAborted(nodeSignal);
        rec.final = true;
        rec.status = "done";
        rec.out = out;
        rec.ms = Date.now() - t0;
        emit({ type: "node-done", nodeId: n.id, name: displayName(n), ms: rec.ms, costUsd: rec.costUsd });
        return out;
      } catch (e) {
        rec.final = true;
        if (e instanceof GateSkip) throw e;
        // A node can make concurrent paid calls. Close the losing branch's
        // transport, then wait only for any wallet callbacks already entered.
        const failure = e;
        enforceDeadline(nodeSignal);
        if (ac.signal.aborted) e = abortReason(ac.signal);
        else if (nodeSignal.aborted) e = abortReason(nodeSignal);
        if (canPay && nodeController && !nodeSignal.aborted) nodeController.abort(e);
        if (activePayments?.size) {
          await Promise.all(activePayments);
          enforceDeadline(ac.signal);
          if (ac.signal.aborted) e = abortReason(ac.signal);
        }
        // ⚖️ Decide gate answered no: a settled, billed decision — not an error. Downstream skips.
        if (e && e.gate === true && !ac.signal.aborted) {
          rec.status = "gated";
          rec.out = e.out || null;
          rec.gate = { yes: e.decision && typeof e.decision.yes === "number" ? e.decision.yes : null, message: e.message };
          gated.push({ nodeId: n.id, name: displayName(n), message: e.message, yes: rec.gate.yes, skipped: [] });
          emit({ type: "node-gated", nodeId: n.id, name: displayName(n), message: e.message, yes: rec.gate.yes, costUsd: rec.costUsd });
          throw e;
        }
        // A prompt-length rejection is free (nothing generated) and, once banked, preventable: the
        // next run budgets the LLM above this node and fits whatever is left. Say that, rather than
        // relaying "please shorten it" about a prompt the caller never wrote.
        let message = e?.message ?? String(e);
        if (learnPromptCap(this._promptCaps, n, message)) {
          message += " — noted: nanoodle keeps this model's prompt inside that limit from now on, so running again should succeed";
        }
        const error = { nodeId: n.id, name: displayName(n), ...(e?.code ? { code: e.code } : {}) };
        const reference = canPay && typeof failure?.paymentId === "string" ? failure : null;
        const payment = reference
          ? nodePayments.find(p => p.paymentId === reference.paymentId)
          : nodePayments.length === 1 ? nodePayments[0] : null;
        if (payment || reference) {
          const { paymentId, statusUrl, completeUrl, stage, status, requestId } = reference || {};
          error.paymentId = paymentId ?? payment?.paymentId;
          error.statusUrl = statusUrl ?? payment?.statusUrl;
          error.completeUrl = completeUrl ?? payment?.completeUrl;
          error.stage = stage ?? payment?.stage;
          error.status = status ?? payment?.httpStatus ?? null;
          error.requestId = requestId ?? payment?.requestId ?? null;
        }
        for (const p of nodePayments) {
          if (e?.paymentId === p.paymentId) continue; // the typed transport error already gives that reference
          if (p.status === "callback-failed") message += " The wallet callback failed and may already have sent a transfer.";
          message += ` Payment ${p.paymentId}. Check ${p.statusUrl || "the payment status"} before paying again.`;
        }
        rec.error = message;
        errors.push({ ...error, message });
        // fields.onError:"skip" — a failed (or timed-out) node is recorded and skipped; its
        // dependents see undefined ports. A run-level abort/timeout is never skipped.
        const onError = (effFields.get(n.id) || {}).onError;
        if (onError === "skip" && !isBranchDecider(n) && !ac.signal.aborted) {
          rec.status = "skipped";
          rec.skippedOnError = true;
          rec.out = {};
          emit({ type: "node-skipped", nodeId: n.id, name: displayName(n), reason: "error", error: message });
          return {};
        }
        rec.status = "error";
        emit({ type: "node-error", nodeId: n.id, name: displayName(n), error: message });
        throw e;
      } finally {
        if (nodeTimer) clearTimeout(nodeTimer);
        if (unlinkNode) unlinkNode();
      }
    };

    try {
      for (const n of order) {
        if (NODE_TYPES[n.type].note) { nodesRec[n.id] = { status: "skipped", out: null, error: null, costUsd: null, ms: null, runId: null }; continue; }
        nodesRec[n.id] = { status: "pending", out: null, error: null, costUsd: null, ms: null, runId: null };
        promises.set(n.id, execNode(n)); // siblings run concurrently; a node starts when ITS deps finish
      }
      await Promise.allSettled([...promises.values()]);
    } finally {
      runSettled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onOuterAbort);
    }

    // A network node that started but was skipped, timed out or aborted without ever reporting
    // a price may still have been billed: the total can't be exact.
    for (const n of order) {
      const rec = nodesRec[n.id];
      const t = NODE_TYPES[n.type];
      if (!rec || !rec.started || rec.status === "done" || rec.costUsd != null || (t && t.local)) continue;
      cost.exact = false;
    }
    // ---- result ----
    const outputEntries = [];
    for (const o of this.outputs) {
      const rec = nodesRec[o.nodeId];
      if (!rec || !(rec.status === "done" || (rec.status === "gated" && rec.out))) continue;
      let primary = o.ports[0];
      if (o.type === "endpoint") primary = endpointOutPort(byId.get(o.nodeId), rec.out);
      else if (o.type === "render3d") {
        // Render 3D emits only one port. Settings and wires can change its mode after inspection.
        primary = o.ports.find(p => Object.hasOwn(rec.out, p.name)) ?? primary;
      }
      const value = this._wrapValue(rec.out[primary.name], primary.type);
      outputEntries.push([o.key, value], [o.nodeId, value]);
    }
    const outputsMap = Object.fromEntries(outputEntries);
    const result = new RunResult({
      outputs: outputsMap,
      nodes: nodesRec,
      errors,
      gated,
      payments: payments.map(p => ({ ...p })), // an injected fetch may still settle after abort
      costUsd: cost.total,
      costExact: cost.exact,
      remainingBalance: cost.balance,
    });
    // sinks a closed gate skipped: get() names the gate instead of "no output"
    Object.defineProperty(result, "_gatedOutputs", {
      enumerable: false,
      value: this.outputs.filter((o) => nodesRec[o.nodeId] && nodesRec[o.nodeId].gatedBy)
        .map((o) => ({ key: o.key, nodeId: o.nodeId, gateName: displayName(byId.get(nodesRec[o.nodeId].gatedBy)) })),
    });
    const failedSinks = this.outputs.filter((o) => nodesRec[o.nodeId] && nodesRec[o.nodeId].status === "error");
    const skippedSinks = this.outputs.filter((o) => nodesRec[o.nodeId] && nodesRec[o.nodeId].skippedOnError);

    // timeout/abort must fail the run even when local media finished after the deadline
    // (or nodes never observed the signal). Prefer the abort reason when present.
    enforceDeadline(ac.signal);
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
      const pending = result.payments.filter(p => !p.redeemed);
      const recovery = pending.length ? ` Check the original payment status before paying again (${pending.map(p => p.paymentId).join(", ")}).` : "";
      throw new RunError(msg + recovery, result, reason.code ? { code: reason.code } : {});
    }

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
    // onError:"skip" never makes a run succeed with nothing: if every output skipped, fail.
    if (this.outputs.length && skippedSinks.length === this.outputs.length) {
      throw new RunError("run failed — every output was skipped after failing: " +
        skippedSinks.map((o) => `"${o.key}": ${nodesRec[o.nodeId].error}`).join("; "), result);
    }
    return result;
  }

  _coerceInput(entry, value, mediaOpts) {
    if (MEDIA_INPUT_KINDS.has(entry.kind)) {
      // Images may shrink before sending. A model can stay local in Slice 3D
      // even when another branch uses NanoGPT. The client caps actual POST bodies.
      if (entry.kind === "model3d" && (value == null || value === "")) return value;
      const localOrResizable = entry.kind === "model3d" || entry.kind === "image";
      const opts = localOrResizable ? { ...mediaOpts, enforceInlineMax: false } : mediaOpts;
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
   * @param {object} [props] extra fields (e.g. { code: "auth" | "blocked" | "funds" | "http", status })
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
const { enforceDeadline } = __req("deadline.mjs");

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
  // SVG may start with a BOM, XML declaration, or comments. Inspect a bounded
  // prefix as text only; no XML parsing or execution.
  try {
    const head = atob(b64.slice(0, 8192));
    if (/^(?:\xef\xbb\xbf)?\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|\/?>)/i.test(head)) return "image/svg+xml";
  } catch { /* malformed/unknown base64 keeps the raster fallback */ }
  return "image/png";
}

const EXT_MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".opus": "audio/ogg",
  ".aac": "audio/aac", ".flac": "audio/flac", ".m4a": "audio/mp4",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".ply": "model/ply",
  ".txt": "text/plain", ".json": "application/json",
};

const MIME_EXT = {
  "image/svg+xml": "svg", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/aac": "aac",
  "audio/flac": "flac", "audio/mp4": "m4a",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "model/gltf-binary": "glb", "model/gltf+json": "gltf", "model/ply": "ply", "application/ply": "ply", "application/x-ply": "ply",
  "text/plain": "txt", "application/json": "json",
};

/**
 * A URL safe to put in an error or log line: origin + path only.
 * Presigned query strings (and any other search/fragment) are dropped, so a
 * signature or a key that rode along in the query cannot leak via an error.
 */
function redactUrl(url) {
  const s = String(url || "");
  try {
    const u = new URL(s);
    return u.origin + u.pathname;
  } catch {
    const cut = s.search(/[?#]/);
    return (cut >= 0 ? s.slice(0, cut) : s).slice(0, 120);
  }
}

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
  if (b.length >= 4 && ascii(0, "glTF")) return "model/gltf-binary";
  if (/^ply\r?\nformat (?:ascii|binary_little_endian|binary_big_endian) 1\.0\r?\n/.test(new TextDecoder().decode(b.subarray(0, 64)))) return "model/ply";
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
 * Internal hosted-media GET. Retry connection/body interruptions from scratch,
 * never generation POSTs. Keep errors redacted even when fetch includes a signed
 * URL in its exception. HTTP rejections and deliberate cancellation are final.
 */
async function downloadMedia(url, { fetch: fetchFn = globalThis.fetch, signal, what = "media" } = {}) {
  const checkAbort = () => {
    enforceDeadline(signal);
    if (signal && signal.aborted) throw signal.reason || new NanoodleError("download aborted", { code: "aborted" });
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    checkAbort();
    try {
      if (typeof fetchFn !== "function") throw new NanoodleError("can't download media: no fetch available");
      const r = await fetchFn(url, { signal }); // CDN: no credentials or API auth headers
      if (!r.ok) throw new NanoodleError(`couldn't download ${what} (${r.status}): ${redactUrl(url)}`, { status: r.status });
      const bytes = new Uint8Array(await r.arrayBuffer());
      checkAbort();
      return { bytes, response: r };
    } catch (e) {
      checkAbort();
      if (e && (e.name === "AbortError" || e.code === "aborted")) throw e;
      if (e instanceof NanoodleError) throw e;
      if (attempt === 3) throw new NanoodleError(`couldn't download ${what}: ${redactUrl(url)}`, { code: "download", attempts: attempt });
    }
    // Short, bounded backoff; cancellation also interrupts the retry delay.
    await new Promise((resolve, reject) => {
      const done = () => { if (signal) signal.removeEventListener("abort", cancel); resolve(); };
      const timer = setTimeout(done, 100 * attempt);
      const cancel = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        reject(signal.reason || new NanoodleError("download aborted", { code: "aborted" }));
      };
      if (signal) {
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
      }
    });
  }
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

  /** Read the raw media bytes, optionally cancelling the download with a signal. */
  async bytes({ signal } = {}) {
    signal?.throwIfAborted();
    let bytes;
    if (this.url.startsWith("data:")) bytes = dataUrlBytes(this.url).bytes;
    else {
      const downloaded = await downloadMedia(this.url, { fetch: this._fetch, signal });
      bytes = downloaded.bytes;
      if (!this._mime) {
        const r = downloaded.response;
        const ct = r.headers && r.headers.get && r.headers.get("content-type");
        if (ct) this._mime = ct.split(";")[0].trim();
      }
    }
    // CDNs commonly serve model assets as generic binary. Sniff their actual
    // format before the CLI or save() chooses a filename extension.
    if (!this._mime || /^(?:application|binary)\/octet-stream$/i.test(this._mime)) this._mime = sniffMime(bytes);
    return bytes;
  }

  /** Write bytes (Node only); append a media extension if absent, and return the saved path. */
  async save(path) {
    const { writeFile } = await import("node:fs/promises");
    const { extname } = await import("node:path");
    const bytes = await this.bytes();
    if (typeof path === "string" && !extname(path)) path += "." + extForMime(this.mime);
    await writeFile(path, bytes);
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

__x.MEDIA_INLINE_MAX = MEDIA_INLINE_MAX; __x.bytesToBase64 = bytesToBase64; __x.base64ToBytes = base64ToBytes; __x.b64ImageMime = b64ImageMime; __x.redactUrl = redactUrl; __x.extForMime = extForMime; __x.mimeFromExt = mimeFromExt; __x.sniffMime = sniffMime; __x.bytesToDataUrl = bytesToDataUrl; __x.dataUrlBytes = dataUrlBytes; __x.downloadMedia = downloadMedia; __x.MediaRef = MediaRef; __x.mediaFromFile = mediaFromFile; __x.assertInlineMediaSize = assertInlineMediaSize; __x.coerceMediaInput = coerceMediaInput;
});
__def("client.mjs", function (__x, __req) {
const { imageModelOpts } = __req("image-options.mjs");
const { NanoodleError } = __req("errors.mjs");
const { abortReason, throwIfAborted } = __req("deadline.mjs");
const { b64ImageMime, bytesToDataUrl, dataUrlBytes, downloadMedia, sniffMime, MEDIA_INLINE_MAX } = __req("media.mjs");
const { assertPaymentOption, parseNanoInvoice, looksLikeResult } = __req("x402.mjs");

const AUDIO_MIME = { mp3: "audio/mpeg", opus: "audio/ogg", aac: "audio/aac", flac: "audio/flac", wav: "audio/wav", pcm: "audio/wav" };
// Native music endpoints use prompt for musical direction; lyrics remain separate.
const AUDIO_PROMPT_MODEL_RE = /(?:^|\/)(?:prompt-to-song|generate-bgm)$|(?:^|\/)mureka-ai\/[^/]+\/generate-song$|^minimax\/music-3$/i;
// Yue2 catalogs take `style` + `lyrics` (+ `audio` for music-to-music), not OpenAI-style `input`.
const AUDIO_STYLE_MODEL_RE = /yue2-3b\/(?:text|music)-to-music$/i;

/** Map an HTTP failure to an actionable error (mirrors the app's httpRunError). Never leaks the key. */
function httpError(status, bodyText, headers) {
  if (status === 403 && (headers?.get?.("x-vercel-mitigated") === "challenge" ||
      (/^\s*<(?:!doctype\s+html\b|html\b)/i.test(bodyText) &&
       /<title>\s*Vercel Security Checkpoint\s*<\/title>/i.test(bodyText)))) {
    return new NanoodleError("NanoGPT's automated traffic protection challenged this request (HTTP 403).", { code: "blocked", status });
  }
  if (status === 401 || status === 403) {
    return new NanoodleError(`API key rejected (HTTP ${status}) — check your NanoGPT key / NANOGPT_API_KEY`, { code: "auth", status });
  }
  if (status === 402 || /insufficient|balance|funds|not enough|payment required/i.test(String(bodyText || ""))) {
    return new NanoodleError("out of balance — this run needs more credit. Top up at nano-gpt.com, then run again.", { code: "funds", status });
  }
  return new NanoodleError(status + ": " + String(bodyText).slice(0, 160), { code: "http", status });
}

function notePaymentResponse(payment, response) {
  const requestId = response.headers?.get?.("x-request-id");
  payment.httpStatus = response.status;
  payment.requestId = typeof requestId === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(requestId) ? requestId : null;
}

function paymentError(payment, message, code = "x402") {
  const { paymentId, statusUrl, completeUrl, stage, httpStatus, requestId } = payment;
  const uncertain = payment.status === "callback-failed" ? " The wallet callback failed and may already have sent a transfer." : "";
  return new NanoodleError(
    `${message}${uncertain} Payment ${paymentId}. Check ${statusUrl || "the payment status"} before paying again.`,
    { code, paymentId, statusUrl, completeUrl, stage, status: httpStatus, requestId },
  );
}

function paidResponseError(response, payment) {
  // The recovery reference is available from headers even if the body hangs.
  response.body?.cancel?.().catch(() => {});
  const { stage, httpStatus, requestId } = payment;
  return paymentError(payment, `NanoGPT x402 ${stage} failed (HTTP ${httpStatus}${requestId ? `, request ${requestId}` : ""}).`);
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

/** Account for a successful HTTP response even if its body cannot be decoded or used. */
async function readBilledJson(response, onCost, useUsageCost = false) {
  let body;
  try {
    body = await response.json();
    return body;
  } finally {
    if (onCost) {
      const usage = useUsageCost && typeof body?.usage?.cost === "number" ? body.usage.cost : null;
      onCost(costWithHeaders(usage != null ? { ...body, cost: usage } : body, response));
    }
  }
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
/**
 * Model URL from a 3D status poll. A completed payload is 3D only when
 * output.kind is "3d" or output.format is "glb" — a bare video url is not a model.
 * Idol's model_url is only a point-cloud preview: its real Gaussian splat is
 * model_mesh.url. Other models retain model_url, model.url, video.url, videoUrls[0].
 */
function model3dStatusUrl(s, model) {
  const out = (s && s.data && s.data.output) || (s && s.output) || {};
  const kind = String(out.kind || "").toLowerCase();
  const format = String(out.format || "").toLowerCase();
  if (kind !== "3d" && format !== "glb") return "";
  if (model === "speridlabs/idol") return (out.model_mesh && out.model_mesh.url) || "";
  const list = Array.isArray(out.videoUrls) ? out.videoUrls : [];
  const first = list.length ? list[0] : null;
  const fromList = typeof first === "string" ? first : (first && first.url) || "";
  return out.model_url || (out.model && out.model.url) || (out.video && out.video.url) || fromList || "";
}

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
    // video: no default deadline — NanoGPT jobs keep running server-side and long renders
    // routinely exceed 10 min. Pass timeouts.video (ms) to cap a headless/CI run. Audio keeps
    // a 5-min default (shorter jobs; still overridable). 3D stops at 25 min (the editor's
    // MODEL3D_DEADLINE_MS); the job may still be running after that.
    this.timeouts = { video: Infinity, audio: 300000, model3d: 25 * 60 * 1000, ...timeouts };
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
  async _paidFetch(url, init, { signal, trackPayment } = {}) {
    throwIfAborted(signal);
    const r = await this.fetch(url, init);
    if (r.status !== 402 || !this.payment || this.apiKey) return r;
    let body = null;
    try { body = await r.json(); } catch { /* fall through to the generic funds error */ }
    const invoice = body && parseNanoInvoice(body, this.baseUrl);
    if (typeof invoice?.paymentId !== "string" || !invoice.paymentId || !invoice.completeUrl) {
      throw new NanoodleError(
        "payment required, but the 402 response offered no usable Nano option" +
        (body ? " — " + JSON.stringify(body).slice(0, 200) : ""), { code: "x402", status: 402 });
    }
    throwIfAborted(signal);
    if (invoice.expiresAt && invoice.expiresAt <= Date.now()) {
      throw new NanoodleError("payment window expired before payment (" + invoice.paymentId + ", to " + invoice.payTo + ") — request a fresh invoice",
        { code: "x402-expired", paymentId: invoice.paymentId, statusUrl: invoice.statusUrl, completeUrl: invoice.completeUrl, stage: "payment" });
    }
    const payment = {
      paymentId: invoice.paymentId, statusUrl: invoice.statusUrl, completeUrl: invoice.completeUrl,
      stage: "payment", status: "callback-pending", redeemed: false, httpStatus: null, requestId: null,
    };
    throwIfAborted(signal);
    try {
      // Register before calling user code, which can synchronously cancel the run.
      let finish;
      const drained = new Promise(resolve => { finish = resolve; });
      try {
        trackPayment?.(payment, drained);
        await this.payment(invoice);
        payment.status = "callback-returned";
      } catch (cause) {
        payment.status = "callback-failed";
        const error = paymentError(payment, "Cannot confirm the x402 transfer.");
        Object.defineProperty(error, "cause", { value: cause, configurable: true });
        throw error;
      } finally {
        finish();
      }

      throwIfAborted(signal);
      payment.stage = "completion";
      const result = await this._settle402(invoice, payment, signal);
      if (result) {
        payment.redeemed = true;
        throwIfAborted(signal);
        return result;
      }

      throwIfAborted(signal);
      payment.stage = "replay";
      payment.httpStatus = null;
      payment.requestId = null;
      const replay = await this.fetch(url, { ...init, headers: { ...init.headers, "x-x402-payment-id": invoice.paymentId } });
      notePaymentResponse(payment, replay);
      if (!replay.ok) throw paidResponseError(replay, payment);
      payment.redeemed = true;
      throwIfAborted(signal);
      return replay;
    } catch (e) {
      if (e?.paymentId === payment.paymentId) throw e;
      if (signal?.aborted) {
        const reason = abortReason(signal);
        throw paymentError(payment, reason.message, reason.code || "aborted");
      }
      throw paymentError(payment, `NanoGPT x402 ${payment.stage} could not be verified.`);
    }
  }

  async _settle402(invoice, payment, signal) {
    // The complete endpoint doubles as the poll: 402 = not seen on-chain yet.
    const deadline = invoice.expiresAt || Date.now() + 15 * 60 * 1000;
    while (true) {
      throwIfAborted(signal);
      const cr = await this.fetch(invoice.completeUrl, {
        method: "POST", headers: { "Content-Type": "application/json", "x-x402": "true" }, body: "{}", signal,
      });
      notePaymentResponse(payment, cr);
      if (cr.ok) {
        const ct = ((cr.headers && cr.headers.get && cr.headers.get("content-type")) || "");
        const mime = ct.split(";")[0].trim().toLowerCase();
        // A binary 2xx IS the replayed result: TTS (/api/v1/audio/speech) replays raw audio bytes,
        // typed audio/* or a generic application/octet-stream. It's the only paid call that answers
        // binary — images, video, chat and decisions all answer JSON — so image/* and video/* are
        // not accepted here. The payment is now completed and can't be reused, so dropping this
        // body and re-POSTing only gets a 402.
        if (mime.startsWith("audio/") || mime === "application/octet-stream") {
          return cr;
        }
        // Any other non-JSON 2xx (a text/plain settlement ack, a text/html error page) is neither
        // the result nor a settle receipt we can act on. The complete call may already have
        // consumed the payment, so re-POSTing could get a second 402 and paying again would
        // double-charge: fail with the payment id instead. No second payment, no re-POST.
        if (mime && !mime.includes("json")) {
          const snippet = String(await cr.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 160);
          throw paymentError(payment, "The complete call answered HTTP " + cr.status +
            " with " + mime + " instead of a result" + (snippet ? " (" + snippet + ")." : "."));
        }
        let cj = null;
        if (mime.includes("json")) { try { cj = await cr.json(); } catch { /* fail closed below */ } }
        if (!cj || typeof cj !== "object") {
          throw paymentError(payment, "Completion returned no readable JSON receipt.");
        }
        if (looksLikeResult(cj)) {
          // wrap so call sites keep their Response contract (ok/json/text/headers)
          return { ok: true, status: 200, headers: cr.headers, json: async () => cj, text: async () => JSON.stringify(cj) };
        }
        return null;
      }
      if (cr.status !== 402) throw paidResponseError(cr, payment);
      await cr.text().catch(() => {}); // drain the "not verified yet" body
      if (Date.now() >= deadline) {
        throw paymentError(payment, "Payment window expired before the Nano deposit was detected.", "x402-expired");
      }
      await sleep(this.pollIntervals.x402, signal);
    }
  }

  async _postJson(path, body, io) {
    const payload = JSON.stringify(body);
    if (payload.length > MEDIA_INLINE_MAX) {
      throw new NanoodleError("request body is too large (~4 MB max) — nanoodle sends media inline as base64; use smaller/shorter media");
    }
    return this._paidFetch(this.baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this._auth() },
      body: payload,
      signal: io.signal,
    }, io);
  }

  async _pollJson(path, signal, remainingMs) {
    const ac = new AbortController();
    const onAbort = () => ac.abort(abortError(signal.reason));
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = Number.isFinite(remainingMs) ? setTimeout(() => ac.abort(
      new NanoodleError("poll deadline reached", { code: "poll-timeout" })), Math.max(0, remainingMs)) : null;
    let rejectAbort;
    const aborted = new Promise((_, reject) => {
      rejectAbort = () => reject(ac.signal.reason);
      ac.signal.addEventListener("abort", rejectAbort, { once: true });
      if (ac.signal.aborted) rejectAbort();
    });
    const work = Promise.resolve().then(async () => {
      throwIfAborted(signal);
      if (ac.signal.aborted) throw ac.signal.reason;
      const r = await this._get(path, ac.signal);
      if (!r.ok) throw httpError(r.status, await r.text(), r.headers);
      return r.json();
    });
    try { return await Promise.race([work, aborted]); }
    finally {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      ac.signal.removeEventListener("abort", rejectAbort);
    }
  }

  async _get(path, signal) {
    return this.fetch(this.baseUrl + path, { headers: this._auth(), signal });
  }

  /** POST /api/v1/chat/completions (non-streaming). Returns the assistant text. */
  async chat(messages, model, opts = {}, io = {}) {
    const { onCost } = io;
    const body = { model, messages };
    // Carbon has no sampling-temperature control; omit it rather than restoring a default.
    if (model !== "google/gemini-4-carbon") body.temperature = opts.temperature != null && opts.temperature !== "" ? +opts.temperature : 0.8;
    if (opts.response_format) body.response_format = opts.response_format;
    // Carbon's selected NanoGPT provider rejects explicit thinking controls (HTTP 400).
    // Let the provider use its default rather than forwarding reasoning_effort.
    if (model !== "google/gemini-4-carbon" && opts.reasoning_effort) body.reasoning_effort = opts.reasoning_effort;
    // max_tokens is the one token budget forwarded, and only when a runner
    // explicitly opts in via opts (the graph's maxTokens field, D1 ruling).
    // The legacy spellings (max_completion_tokens, max_output_tokens,
    // maxTokens) are never read here, so they can never leak into the body.
    if (opts.max_tokens != null) body.max_tokens = opts.max_tokens;
    const r = await this._postJson("/api/v1/chat/completions", body, io);
    if (!r.ok) throw httpError(r.status, await r.text(), r.headers);
    const j = await readBilledJson(r, onCost);
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

  /**
   * POST /api/v1/decisions (⚖️ Decide). Returns the JSON ({ answers, usage:{ input_tokens, output_tokens, cost } }).
   * Decision models bill input tokens only; the real price rides usage.cost.
   */
  async decide(body, io = {}) {
    const { onCost } = io;
    const r = await this._postJson("/api/v1/decisions", body, io);
    if (!r.ok) throw httpError(r.status, await r.text(), r.headers);
    return readBilledJson(r, onCost, true);
  }

  /** POST /v1/images/generations (NOTE: not /api/v1). Returns data: / https URL(s).
   * With multi + items, returns { urls, layers } instead: layers is the per-item
   * `layer` metadata aligned by index with urls (layer-decomposition models return
   * { z_index, name, description, bounding_box } per item), or null when no item
   * carries any. Items with neither b64_json nor url drop out of both arrays. */
  async image({ prompt, model, size, imageDataUrl, maskDataUrl, extra, n = 1, multi = false, items = false }, io = {}) {
    const { onCost } = io;
    const body = { model, size: size || "1024x1024", n, response_format: "b64_json" };
    if (prompt) body.prompt = prompt; // omit when blank — upscalers run with no instruction
    if (imageDataUrl) body.imageDataUrl = imageDataUrl; // string OR array (edit multi-reference)
    if (maskDataUrl) body.maskDataUrl = maskDataUrl; // white = repaint
    Object.assign(body, imageModelOpts(extra));
    const r = await this._postJson("/v1/images/generations", body, io);
    if (!r.ok) throw httpError(r.status, await r.text(), r.headers);
    const j = await readBilledJson(r, onCost);
    const pairs = (j.data || [])
      .map((d) => {
        const url = d.b64_json ? "data:" + b64ImageMime(d.b64_json) + ";base64," + d.b64_json : d.url;
        return url ? { url, layer: d.layer != null ? d.layer : null } : null;
      })
      .filter(Boolean);
    const urls = pairs.map((p) => p.url);
    if (!urls.length) throw new NanoodleError("no image in response");
    if (!multi) return urls[0];
    if (items) {
      const layers = pairs.map((p) => p.layer);
      return { urls, layers: layers.some((l) => l != null) ? layers : null };
    }
    return urls;
  }

  /** POST /api/generate-video then poll GET /api/video/status?requestId= until COMPLETED. */
  // io.onRunId(runId) fires the moment a FRESH submit returns its job id — a caller
  // keeping a resume registry (play's PENDING_VIDEO) records it before any await.
  // io.resume (a runId) skips the submit — and its charge — and goes straight to
  // polling: how a timed-out job is picked back up without paying twice.
  async video(model, prompt, opts = {}, imageDataUrl, io = {}) {
    const { onCost, onPoll, onRunId, resume, signal } = io;
    const is3d = opts.mediaKind === "model3d";
    const body = { model };
    // 3D omits an empty prompt (image-only models). Video still sends a blank prompt.
    if (!(is3d && !String(prompt || "").trim())) body.prompt = prompt;
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
      const r = await this._postJson("/api/generate-video", body, io);
      if (!r.ok) throw httpError(r.status, await r.text(), r.headers);
      const j = await readBilledJson(r, onCost);
      runId = j.runId || j.id;
      if (!runId) throw new NanoodleError("no runId returned");
      if (onRunId) onRunId(runId);
    }

    try {
      const t0 = Date.now();
      const videoCap = is3d ? this.timeouts.model3d : this.timeouts.video;
      const pollEvery = is3d ? (this.pollIntervals.model3d || this.pollIntervals.video) : this.pollIntervals.video;
      // Infinity/non-finite = wait forever (default). Finite ms = headless/CI cap.
      while (!Number.isFinite(videoCap) || Date.now() - t0 < videoCap) {
        await sleep(Number.isFinite(videoCap) ? Math.min(pollEvery, Math.max(0, videoCap - (Date.now() - t0))) : pollEvery, signal);
        if (Number.isFinite(videoCap) && Date.now() - t0 >= videoCap) break;
        let s;
        try {
          s = await this._pollJson("/api/video/status?requestId=" + encodeURIComponent(runId), signal, videoCap - (Date.now() - t0));
        } catch (e) {
          if (signal && signal.aborted) throw abortError(signal.reason);
          if (e.code === "poll-timeout") break;
          if (e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status)) throw e;
          continue; // transient poll failure — keep polling until complete or optional cap
        }
        const st = String((s.data && s.data.status) || s.status || "").toUpperCase();
        if (onPoll) onPoll({ status: st, elapsedMs: Date.now() - t0, runId });
        if (st === "COMPLETED" || st === "SUCCEEDED") {
          if (is3d) {
            const url = model3dStatusUrl(s, model);
            if (!url) throw new NanoodleError("completed but no model url");
            return url;
          }
          const out = (s.data && s.data.output) || s.output || {};
          const url = (out.video && out.video.url) || out.url || (Array.isArray(out.video) ? out.video[0] && out.video[0].url : null);
          if (!url) throw new NanoodleError("completed but no video url");
          return url;
        }
        if (["FAILED", "ERROR", "CANCELED", "CANCELLED", "CONTENT_POLICY_VIOLATION"].includes(st)) {
          const why = (s.data && s.data.error) || st;
          throw new NanoodleError((is3d ? "3D failed: " : "video failed: ") + why, { code: "job-failed" });
        }
      }
      const label = is3d ? "3D" : "video";
      throw new NanoodleError(`${label} timed out (${Math.round(videoCap / 1000)}s) — the job may still be running on NanoGPT's side`, { code: "timeout" });
    } catch (e) {
      if (signal && signal.aborted) throw e;
      throw new NanoodleError(e && e.message ? e.message : String(e), {
        ...(e && e.code ? { code: e.code } : {}),
        ...(e && e.status ? { status: e.status } : {}), runId, cause: e,
      });
    }
  }

  /**
   * POST /api/v1/audio/speech (music + tts + remix). Returns an audio URL (https or data:).
   * io.onRunId(job) fires when an async job enters the poll branch (job = the submit
   * response — runId + refund metadata the status poll needs); io.resume (that same job
   * object) skips the submit + charge and resumes polling a prior run's job.
   */
  async audio(model, input, extra = {}, io = {}) {
    const { onCost, onPoll, onRunId, resume, signal } = io;
    if (resume) {
      const url = await this._pollAudio(model, resume, { onPoll, signal });
      if (!url) throw new NanoodleError("no audio url in response");
      return url;
    }
    const body = Object.assign({ model, input }, extra);
    if (AUDIO_PROMPT_MODEL_RE.test(String(model || "").trim())) {
      if (body.prompt == null || String(body.prompt).trim() === "") body.prompt = input;
      delete body.input;
    } else if (AUDIO_STYLE_MODEL_RE.test(String(model || "").trim())) {
      if (body.style == null || String(body.style).trim() === "") body.style = input;
      delete body.input;
      delete body.prompt;
    }
    const r = await this._postJson("/api/v1/audio/speech", body, io);
    if (!r.ok) throw httpError(r.status, await r.text(), r.headers);
    const ct = (r.headers && r.headers.get && r.headers.get("content-type")) || "";
    if (ct.includes("application/json")) {
      const j = await readBilledJson(r, onCost);
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
      mime = AUDIO_MIME[(extra && (extra.output_format || extra.response_format)) || "mp3"] || "audio/mpeg";
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
      await sleep(Math.min(this.pollIntervals.audio, Math.max(0, this.timeouts.audio - (Date.now() - t0))), signal);
      if (Date.now() - t0 >= this.timeouts.audio) break;
      let s;
      try {
        s = await this._pollJson("/api/tts/status?" + qs, signal, this.timeouts.audio - (Date.now() - t0));
      } catch (e) {
        if (signal && signal.aborted) throw abortError(signal.reason);
        if (e.code === "poll-timeout") break;
        if (e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status)) throw e;
        continue;
      }
      const st = String(s.status || "").toLowerCase();
      if (onPoll) onPoll({ status: st, elapsedMs: Date.now() - t0, runId, queuePosition: s.queuePosition });
      if (st === "completed" || st === "succeeded") {
        const url = s.audioUrl || s.url || (s.data && s.data.audioUrl) || (s.data && s.data.url);
        if (!url) throw new NanoodleError("completed but no audio url");
        return url;
      }
      if (["error", "failed", "canceled", "cancelled", "content_policy_violation"].includes(st)) {
        throw new NanoodleError("audio failed: " + (s.error || s.message || st), { code: "job-failed" });
      }
    }
    throw new NanoodleError(`audio timed out (${Math.round(this.timeouts.audio / 1000)}s) — the job may still be running on NanoGPT's side`, { code: "timeout" });
  }

  /** POST /api/v1/audio/transcriptions (multipart; the audio form field MUST be "file"). */
  async transcribe(model, audioUrl, language, io = {}) {
    const { onCost, signal } = io;
    let bytes, mime;
    if (/^data:/i.test(audioUrl)) {
      ({ bytes, mime } = dataUrlBytes(audioUrl));
    } else {
      const downloaded = await downloadMedia(audioUrl, { fetch: this.fetch, signal, what: "the audio to transcribe" });
      const r = downloaded.response;
      bytes = downloaded.bytes;
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
    const r = await this._paidFetch(this.baseUrl + "/api/v1/audio/transcriptions", { method: "POST", headers: this._auth(), body: fd, signal }, io);
    if (!r.ok) throw httpError(r.status, await r.text(), r.headers);
    const j = await readBilledJson(r, onCost);
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
    const { bytes, response: r } = await downloadMedia(url, { fetch: this.fetch, signal, what: "media to inline" });
    const ct = (((r.headers && r.headers.get && r.headers.get("content-type")) || "").split(";")[0] || "").trim().toLowerCase();
    const mime = ct && ct !== "application/octet-stream" && ct !== "binary/octet-stream" ? ct : undefined;
    return bytesToDataUrl(bytes, mime); // sniffs magic bytes when the CDN's content-type is generic
  }

  /**
   * Resolve a provider media URL before it is handed to another node or returned
   * as a node output. Relative content paths (Grok Imagine's
   * `/api/generate-video/content?...`) and the exact same-origin content paths
   * in CONTENT_API_PATHS are joined onto `baseUrl` and fetched with the API key,
   * redirects manual so the key is never forwarded to the file host. Any other
   * same-origin `/api` or `/v1` URL, including a user-supplied upload URL, is
   * refused and not fetched — a 200 from those paths must not be inlined with
   * the caller's credentials. A redirect Location becomes the
   * absolute file URL (presigned queries stay on that URL — the next provider
   * needs them — and are never put in errors). A direct 200 is inlined as a
   * data URL only when it fits MEDIA_INLINE_MAX; an over-cap clip must come
   * back as a redirect URL rather than failing the inline budget.
   */
  async resolveContentUrl(url, { signal } = {}) {
    return resolveProviderMediaUrl(url, {
      baseUrl: this.baseUrl,
      fetch: this.fetch,
      authHeaders: this._auth(),
      apiKey: this.apiKey,
      signal,
    });
  }

  /** Optional helper: POST /api/check-balance → { usd_balance }. */
  async checkBalance(signal) {
    const r = await this._postJson("/api/check-balance", {}, { signal });
    if (!r.ok) throw httpError(r.status, await r.text(), r.headers);
    return r.json();
  }
}

/**
 * Exact content paths that return provider media. Credentials are sent only here.
 * A prefix (`/api/…`, `/v1/…`) is not enough: `/api/v1/models`, an upload URL, or
 * `/api/generate-video/content/extra` would otherwise be fetched with the key and
 * a 200 body inlined into the graph output.
 */
const CONTENT_API_PATHS = new Set([
  "/api/generate-video/content",
  "/api/images/content",
  "/v1/audio/content",
]);

function isContentApiPath(pathname) {
  return CONTENT_API_PATHS.has(pathname);
}

/** Same-origin API surface. These are not fetched unless the path is allowlisted. */
function isSameOriginApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/")
    || pathname === "/v1" || pathname.startsWith("/v1/");
}

function refuseNonContentApi(pathname) {
  if (!isSameOriginApiPath(pathname) || isContentApiPath(pathname)) return;
  throw new NanoodleError("that URL is not a provider content file, so it was not fetched");
}

function apiBase(baseUrl) {
  const base = String(baseUrl || "https://nano-gpt.com").replace(/\/+$/, "");
  const origin = new URL(base + "/").origin;
  return { base, origin };
}

/** Estimated data-URL length for `byteLength` raw bytes. Matches the inline cap's string check. */
function dataUrlWouldExceed(byteLength, mime) {
  const header = ("data:" + (mime || "application/octet-stream") + ";base64,").length;
  return header + Math.ceil(Math.max(0, byteLength) / 3) * 4 > MEDIA_INLINE_MAX;
}

/** Drop the API key, bearer tokens, and query strings from text that may be shown. */
function scrubSecrets(text, apiKey) {
  let s = String(text || "");
  if (apiKey && String(apiKey).length >= 4) s = s.split(String(apiKey)).join("[redacted]");
  s = s.replace(/bearer\s+\S+/gi, "Bearer [redacted]");
  s = s.replace(/[?#][^\s)"']*/g, "");
  s = s.replace(/(?:X-Amz-[A-Za-z-]*|Signature|sig|token|api_key|apikey)\s*[:=]\s*\S+/gi, (m) => m.split(/[:=]/)[0] + "=[redacted]");
  return s.replace(/\s+/g, " ").trim().slice(0, 160);
}

function authHeadersFor(url, origin, authHeaders) {
  try {
    if (new URL(url).origin !== origin) return {};
  } catch {
    return {};
  }
  return authHeaders ? { ...authHeaders } : {};
}

async function drainBody(r) {
  try {
    if (r && r.body && typeof r.body.cancel === "function") await r.body.cancel();
    else if (r && typeof r.arrayBuffer === "function") await r.arrayBuffer();
  } catch { /* already consumed, or the peer hung up */ }
}

function responseMime(r) {
  const ct = ((r && r.headers && r.headers.get && r.headers.get("content-type")) || "").split(";")[0].trim().toLowerCase();
  if (!ct || ct === "application/octet-stream" || ct === "binary/octet-stream") return "";
  return ct;
}

/**
 * Resolve one provider media URL.
 * - data:, blob:, and ordinary http(s) URLs pass through (no fetch, no key).
 * - A path-absolute URL is joined onto the NanoGPT base. Non-API paths become
 *   that absolute URL and are not fetched (the next node can GET them).
 * - `/api` and `/v1` URLs (relative, or already on the API origin) are fetched
 *   with the key and `redirect: "manual"`. An off-origin or non-API Location is
 *   the fetchable file URL and is returned without downloading it — so a clip
 *   over the ~4.4 MB inline cap still chains. A 200 body is inlined only when
 *   the data URL fits MEDIA_INLINE_MAX.
 * Errors never include the API key or a presigned query string.
 */
async function resolveProviderMediaUrl(url, { baseUrl, fetch: fetchImpl, authHeaders, apiKey, signal } = {}) {
  if (typeof url !== "string") return url;
  const s = url.trim();
  if (!s || /^(data:|blob:)/i.test(s)) return s;
  const { base, origin } = apiBase(baseUrl);
  let start;
  try {
    if (/^https?:/i.test(s)) {
      const abs = new URL(s);
      if (abs.origin !== origin) return s;
      refuseNonContentApi(abs.pathname);
      if (!isContentApiPath(abs.pathname)) return s;
      start = abs;
    } else if (s.startsWith("/") && !s.startsWith("//")) {
      start = new URL(s, base + "/");
      refuseNonContentApi(start.pathname);
      if (!isContentApiPath(start.pathname)) return start.href;
    } else {
      return s;
    }
  } catch (e) {
    // A refused /api or /v1 URL must not be swallowed as "leave it unchanged".
    if (e && e.name === "NanoodleError") throw e;
    return s;
  }

  const doFetch = fetchImpl || globalThis.fetch;
  if (!doFetch) throw new NanoodleError("couldn't fetch provider media: no fetch available");
  let current = start.href;
  for (let hop = 0; hop < 5; hop++) {
    throwIfAborted(signal);
    let r;
    try {
      r = await doFetch(current, {
        method: "GET",
        headers: authHeadersFor(current, origin, authHeaders),
        redirect: "manual",
        signal,
      });
    } catch (e) {
      if (e && (e.name === "AbortError" || e.code === "aborted")) throw e;
      if (signal && signal.aborted) throw e;
      const detail = scrubSecrets(e && e.message, apiKey);
      throw new NanoodleError("couldn't fetch provider media" + (detail ? " (" + detail + ")" : ""));
    }
    const status = r.status;
    const loc = r.headers && r.headers.get && r.headers.get("location");
    if (loc && (status === 0 || (status >= 300 && status < 400))) {
      await drainBody(r);
      let next;
      try { next = new URL(loc, current); }
      catch { throw new NanoodleError("provider media redirect had no usable location"); }
      // File host or a non-API path: hand back the absolute URL. Do not fetch it
      // (that would pull a multi-megabyte clip and might attach the key).
      // A same-origin /api or /v1 hop that is not itself a content file is refused
      // outright — its body must never be inlined with the caller's credentials.
      if (next.origin === origin) refuseNonContentApi(next.pathname);
      if (next.origin !== origin || !isContentApiPath(next.pathname)) return next.href;
      current = next.href;
      continue;
    }
    if (status >= 300 && status < 400) {
      await drainBody(r);
      throw new NanoodleError("provider media redirect had no location");
    }
    if (!r.ok) {
      const raw = String(await r.text().catch(() => "")).slice(0, 500);
      const snippet = scrubSecrets(raw, apiKey);
      throw new NanoodleError("couldn't fetch provider media (HTTP " + status + ")" + (snippet ? ": " + snippet : ""));
    }
    const mimeHeader = responseMime(r);
    const declared = Number(r.headers && r.headers.get && r.headers.get("content-length"));
    if (Number.isFinite(declared) && declared >= 0 && dataUrlWouldExceed(declared, mimeHeader)) {
      await drainBody(r);
      throw new NanoodleError("provider media is too large to send inline (~4 MB max) and did not redirect to a fetchable file");
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    const mime = mimeHeader || sniffMime(bytes);
    if (dataUrlWouldExceed(bytes.length, mime)) {
      throw new NanoodleError("provider media is too large to send inline (~4 MB max) and did not redirect to a fetchable file");
    }
    return bytesToDataUrl(bytes, mime);
  }
  throw new NanoodleError("provider media redirect did not resolve to a fetchable file");
}

__x.httpError = httpError; __x.costFromJson = costFromJson; __x.costFromHeaders = costFromHeaders; __x.costWithHeaders = costWithHeaders; __x.sleep = sleep; __x.model3dStatusUrl = model3dStatusUrl; __x.NanoClient = NanoClient; __x.resolveProviderMediaUrl = resolveProviderMediaUrl;
});
__def("resumable-media.mjs", function (__x, __req) {
// Track the newest attempt separately from accepted jobs. A new attempt cannot
// discard a paid job merely by starting, but older callbacks lose write authority.
const attemptsByRegistry = new WeakMap();

/**
 * Run or resume a provider media job using the browser host's job registry.
 * `idField` is "runId" for video or "job" for audio's full submission record.
 * Retain accepted work through poll failures and finished URLs through delivery
 * failures. Only a terminal provider job failure or successful delivery retires it.
 */
async function runResumableMedia({
  jobs, key, sig, idField, signal, run, resolve, onTerminalFailure,
}) {
  let attempts;
  let owner;
  const attempt = {};
  if (key) {
    attempts = attemptsByRegistry.get(jobs);
    if (!attempts) {
      attempts = new Map();
      attemptsByRegistry.set(jobs, attempts);
    }
    attempts.set(key, attempt);
    owner = jobs.get(key);
  }
  const ownsSlot = () => attempts?.get(key) === attempt && jobs.get(key) === owner;
  let accepted = owner?.njs && owner.sig === sig ? owner : undefined;
  function remember(entry) {
    accepted = entry;
    if (ownsSlot()) {
      jobs.set(key, entry);
      owner = entry;
    }
  }

  try {
    let url = accepted?.resultUrl;
    if (!url) {
      try {
        url = await run({
          resume: accepted?.[idField],
          onRunId: id => remember({ sig, njs: true, [idField]: id }),
        });
      } catch (error) {
        if (accepted && error?.code === "job-failed" && !signal?.aborted && ownsSlot()) {
          jobs.delete(key);
          onTerminalFailure?.();
        }
        throw error;
      }
    }
    remember({ ...accepted, sig, njs: true, resultUrl: url });
    const result = await resolve(url);
    // The host may drop a result that finishes after Stop. Keep it resumable.
    if (!signal?.aborted && ownsSlot()) jobs.delete(key);
    return result;
  } finally {
    if (attempts?.get(key) === attempt) attempts.delete(key);
  }
}

__x.runResumableMedia = runResumableMedia;
});
__def("graph.mjs", function (__x, __req) {
const { NanoodleError } = __req("errors.mjs");
const { INPUT_SPECS, SETTING_SPECS } = __req("io-specs.mjs");
const { planBranches } = __req("branches.mjs");
const { competingInputIssues, staticCompetingInputIssues } = __req("input-wires.mjs");

/* Dynamic input-port families also used by the runners to collect their values. */
const IMG_PORT_RE = /^img\d*$/;      // llm vision references, decide candidates
const EDIT_IMG_RE = /^image\d*$/;    // edit multi-reference: image, image2, ...
const VID_PORT_RE = /^vid\d*$/;
const CLIP_PORT_RE = /^clip\d*$/;    // combine clips
const REF_PORT_RE = /^ref\d*$/;      // tvideo reference images
const FRAME_PORT_RE = /^frame[1-9]\d*$/;  // vframes outputs
const MAX_FRAMES = 48;

const DYNAMIC_INPUTS = new Map([
  ["llm", [IMG_PORT_RE]],
  ["decide", [IMG_PORT_RE]],
  ["edit", [EDIT_IMG_RE]],
  ["tvideo", [REF_PORT_RE]],
  ["vedit", [REF_PORT_RE]],
  ["combine", [VID_PORT_RE, CLIP_PORT_RE]],
]);

// Runtime-consumed fields that aren't surfaced as workflow inputs or settings.
const LORA_FIELDS = ["loras", "loraUrl", "loraStrength"];
const IMAGE_FIELDS = ["modelOpts", "aspect", "customCivitaiAir", "negativePrompt", ...LORA_FIELDS];
const VIDEO_FIELDS = ["modelOpts", ...LORA_FIELDS];
const AUDIO_FIELDS = ["response_format", "extraJson"];
const EXTRA_WIRED_FIELDS = new Map([
  ["upload", ["optional"]],
  ["aupload", ["optional"]],
  ["vupload", ["optional"]],
  ["mupload", ["optional"]],
  ["choice", ["options", "selected"]],
  ["image", ["sel", ...IMAGE_FIELDS]],
  ["edit", IMAGE_FIELDS],
  ["inpaint", ["prompt", ...IMAGE_FIELDS]],
  ["tvideo", VIDEO_FIELDS],
  ["ivideo", VIDEO_FIELDS],
  ["vedit", ["aspect", "duration", ...VIDEO_FIELDS]],
  ["lipsync", ["aspect", "duration", "modelOpts"]],
  ["model3d", ["modelOpts"]],
  ["music", AUDIO_FIELDS],
  ["remix", AUDIO_FIELDS],
  ["tts", AUDIO_FIELDS],
  ["endpoint", ["system", "size"]],
]);

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
    const port = String(l.from.port);
    if (FRAME_PORT_RE.test(port)) floor = Math.max(floor, Number(port.slice(5)));
  }
  return Math.min(floor, MAX_FRAMES);
}

/**
 * Node-type registry (execution-relevant subset of the app's NODE_TYPES).
 * flags: local (pure logic / on-device media) | network (calls NanoGPT) | note.
 * extraSourcePorts lists runtime outputs that are absent from the standard port list.
 * Local media: pure-JS first (MP4CAT / PCM-WAV / PNG); ffmpeg on PATH is the heavy fallback.
 */
const NODE_TYPES = {
  text:    { title: "Text",            inputs: [], outputs: [{ name: "text", type: "text" }], local: true },
  upload:  { title: "Image input",     inputs: [], outputs: [{ name: "image", type: "image" }], local: true },
  aupload: { title: "Audio input",     inputs: [], outputs: [{ name: "audio", type: "audio" }], local: true },
  vupload: { title: "Video input",     inputs: [], outputs: [{ name: "video", type: "video" }], local: true },
  "slice-3d": { title: "Slice 3D", inputs: ["model", "paletteImage"], outputs: [{ name: "sheet", type: "image" }, { name: "layout", type: "text" }, { name: "image", type: "image" }], local: true },
  "sprite-stack-render": { title: "Sprite stack render", inputs: ["sheet"], outputs: [{ name: "image", type: "image" }, { name: "video", type: "video" }], local: true },
  mupload: { title: "3D input",        inputs: [], outputs: [{ name: "model", type: "model3d" }], local: true },
  choice:  { title: "Choice",          inputs: [], outputs: [{ name: "text", type: "text" }], local: true },
  join:    { title: "Join",            inputs: ["a", "b"], outputs: [{ name: "text", type: "text" }], local: true },
  llm:     { title: "LLM",             inputs: ["audio", "video"], outputs: [{ name: "text", type: "text" }], network: true },
  image:   { title: "Image",           inputs: [], outputs: [{ name: "image", type: "image" }], extraSourcePorts: ["images"], network: true },
  edit:    { title: "Edit",            inputs: [], outputs: [{ name: "image", type: "image" }], extraSourcePorts: ["images", "layers"], network: true },
  inpaint: { title: "Inpaint",         inputs: ["image", "mask"], outputs: [{ name: "image", type: "image" }], extraSourcePorts: ["images", "layers"], network: true },
  resize:  { title: "Resize / crop",   inputs: ["image"], outputs: [{ name: "image", type: "image" }], local: true },
  vision:  { title: "Vision",          inputs: ["image"], outputs: [{ name: "text", type: "text" }], network: true },
  decide:  { title: "Decide",          inputs: ["text"], outputs: [{ name: "text", type: "text" }, { name: "image", type: "image" }], extraSourcePorts: ["yes", "no", "decision"], network: true }, // img1… candidates (IMG_PORT_RE)
  tvideo:  { title: "Text→Video",      inputs: [], outputs: [{ name: "video", type: "video" }], network: true },
  ivideo:  { title: "Image→Video",     inputs: ["image", "endframe"], outputs: [{ name: "video", type: "video" }], network: true },
  model3d: { title: "3D model",        inputs: ["image", "model"], outputs: [{ name: "model", type: "model3d" }], network: true },
  vedit:   { title: "Video edit",      inputs: ["video", "image"], outputs: [{ name: "video", type: "video" }], network: true },
  vframes: { title: "Video → frames",  inputs: ["video"], outputs: [{ name: "frame1", type: "image" }], local: true, framesOut: true }, // dynamic frame1..N
  render3d: { title: "Render 3D",      inputs: ["model"], outputs: [{ name: "image", type: "image" }, { name: "video", type: "video" }], local: true },
  combine: { title: "Combine videos",  inputs: [], outputs: [{ name: "video", type: "video" }], local: true },
  soundtrack: { title: "Soundtrack",   inputs: ["video", "audio"], outputs: [{ name: "video", type: "video" }], local: true },
  lipsync: { title: "Avatar / lipsync", inputs: ["image", "audio"], outputs: [{ name: "video", type: "video" }], network: true },
  music:   { title: "Music",           inputs: [], outputs: [{ name: "audio", type: "audio" }], network: true },
  remix:   { title: "Remix audio",     inputs: ["audio"], outputs: [{ name: "audio", type: "audio" }], network: true },
  tts:     { title: "Speech",          inputs: [], outputs: [{ name: "audio", type: "audio" }], network: true },
  trim:    { title: "Trim audio",      inputs: ["audio"], outputs: [{ name: "audio", type: "audio" }], local: true },
  extractaudio: { title: "Extract audio", inputs: ["video"], outputs: [{ name: "audio", type: "audio" }], local: true },
  transcribe: { title: "Transcribe",   inputs: ["audio"], outputs: [{ name: "text", type: "text" }], network: true },
  cleanvoice: { title: "Clean voice", inputs: ["audio", "video"], outputs: [{ name: "audio", type: "audio" }], network: true },
  // Custom URL — not a NanoGPT call, so `network` stays unset (no API key required).
  // Output port follows the selected route mode (see deriveOutputs / endpointOutPort).
  endpoint: { title: "Custom endpoint", inputs: ["text", "image", "audio", "video"], outputs: [{ name: "text", type: "text" }], extraSourcePorts: ["image", "audio", "video", "images"] },
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

/** Author-locked node: fields.locked keeps every field at its stored value (no inputs derived). */
function lockedNode(node) {
  const v = node && node.fields && node.fields.locked;
  return v === true || v === "true";
}

/** Is a wire landing on `port` of `node` a data input (vs a field override)? */
function isInputPort(node, port) {
  const t = NODE_TYPES[node.type];
  return t?.inputs?.includes(port) || DYNAMIC_INPUTS.get(node.type)?.some((re) => re.test(port));
}

/** Check the possible source ports without depending on what a particular run emits. */
function isSourcePort(source, port) {
  const type = NODE_TYPES[source.type];
  return type?.outputs?.some(output => output.name === port) || type?.extraSourcePorts?.includes(port) ||
    (type?.framesOut && FRAME_PORT_RE.test(port) && Number(port.slice(5)) <= MAX_FRAMES);
}

function isTargetPort(target, port) {
  return isInputPort(target, port) ||
    INPUT_SPECS[target.type]?.some(spec => spec.f === port) ||
    SETTING_SPECS[target.type]?.some(spec => spec.f === port) ||
    EXTRA_WIRED_FIELDS.get(target.type)?.includes(port) ||
    (port === "timeoutMs" && !NODE_TYPES[target.type].note);
}

/** Report the first problem with a link, using the same checks on load and before a run. */
function wireIssue({ from, to }, byId) {
  const source = byId.get(from.node);
  const target = byId.get(to.node);
  const wire = `wire ${from.node ?? "(missing)"}.${from.port} → ${to.node ?? "(missing)"}.${to.port}`;
  if (!source) return { code: "missing-wire-node", message: `${wire} references missing source node "${from.node ?? ""}"` };
  if (!target) return { code: "missing-wire-node", message: `${wire} references missing target node "${to.node ?? ""}"` };
  if (!source.unknown && !isSourcePort(source, from.port)) {
    return { code: "invalid-source-port", message: `${wire} uses undeclared source port "${from.port}" on ${displayName(source)}` };
  }
  if (!target.unknown && !isTargetPort(target, to.port)) {
    return { code: "invalid-target-port", message: `${wire} uses undeclared target port "${to.port}" on ${displayName(target)}` };
  }
  if (target.type === "llm" && to.port === "video") {
    return {
      code: "unsupported-target-port",
      message: `${wire} uses unsupported LLM input "video" in the JavaScript executor. Run this workflow in the nanoodle editor or player to use the clip.`,
    };
  }
}

/**
 * Media fields (upload image, inpaint image/mask, audio/video clips) hold a data: or
 * http(s) URL — the editor writes data: URLs, hand-authored graphs may inline either.
 * Agents authoring graphs sometimes leave a prose placeholder instead ("[image will be
 * provided at run time]") or a bare file path: those LOOK filled (inspect prints a
 * default, run() skips the required-input check) but post garbage to the API. Anything
 * that isn't a real media URL is treated as EMPTY at load, with a warning that says how
 * to actually supply the media.
 */
const MEDIA_FIELD_KEYS = ["image", "mask", "audio", "video"];
const MEDIA_URL_RE = /^(data:|https?:)/i;

function scrubMediaPlaceholders(n, warnings) {
  // mupload stores the .glb on fields.model. That key is an AI model id on every
  // other node, so it is only treated as media here.
  const keys = n.type === "mupload" ? MEDIA_FIELD_KEYS.concat(["model"]) : MEDIA_FIELD_KEYS;
  for (const k of keys) {
    const v = n.fields[k];
    // Built-in editor examples store their same-origin assets as relative paths.
    if (typeof v === "string" && /^examples\/[A-Za-z0-9_./-]+$/.test(v) && !v.includes("..")) {
      const origin = globalThis.location?.origin;
      n.fields[k] = (/^https?:\/\//.test(origin || "") ? origin : "https://nanoodle.com") + "/" + v;
      continue;
    }
    if (v == null || v === "" || (typeof v === "string" && MEDIA_URL_RE.test(v.trim()))) continue;
    const shown = typeof v === "string"
      ? `"${v.length > 60 ? v.slice(0, 57) + "…" : v}"`
      : Array.isArray(v) ? "an array" : typeof v === "object" ? "an object" : `a ${typeof v}`;
    n.fields[k] = "";
    warnings.push(
      `node ${n.id} (${displayName(n)}): fields.${k} held ${shown} — not a data: or http(s) URL, so it was ` +
      `treated as empty. Leave media fields "" in the graph and supply the ${k} at run time ` +
      `(CLI: --input "<key>=@file", library: run({ "<key>": mediaFromFile(path) }), key from inspect/wf.inputs), ` +
      `or inline a data: URL.`);
  }
}

function nonblankString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** Reject structurally invalid records before normalizing their IDs or types. */
function assertNodeRecord(node, index) {
  let issue;
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    issue = "must be an object";
  } else if (!Object.hasOwn(node, "id") || !(nonblankString(node.id) || Number.isFinite(node.id))) {
    issue = "has a missing or invalid id (expected a non-empty string or finite number)";
  } else if (!Object.hasOwn(node, "type") || !nonblankString(node.type)) {
    issue = "has a missing or invalid type (expected a non-empty string)";
  }
  if (issue) throw new NanoodleError(`node at position ${index + 1} ${issue}`, { code: "invalid-node-record" });
}

/**
 * Load raw parsed graph JSON into an executable graph (mirrors the app's applyGraphData):
 * - malformed node records are rejected with their position in the nodes array
 * - `audio` type aliases to `tts` (legacy saves)
 * - unknown node types are KEPT but flagged (`unknown: true`) + a warning; run() fails fast on them
 * - media fields that aren't a data:/http(s) URL (prose placeholders, file paths) are blanked + a warning
 * - links into music/tts port "text" migrate to "prompt"
 * - links with missing nodes or undeclared ports are kept with a warning so they can be repaired
 * @returns {{ nodes, links, warnings: string[] }}
 */
function materialize(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.nodes)) {
    throw new NanoodleError("not a nanoodle graph: expected an object with a nodes array (the noodle-graph.json save)");
  }
  const warnings = [];
  const nodes = [];
  const seenIds = new Set();
  for (const [index, raw] of data.nodes.entries()) {
    assertNodeRecord(raw, index);
    const id = String(raw.id);
    if (seenIds.has(id)) throw new NanoodleError(`duplicate node id "${id}" — every node must have a unique id`);
    seenIds.add(id);
    const type = raw.type === "audio" ? "tts" : raw.type === "decide-branch" ? "decide" : raw.type;
    const n = { id, type, name: raw.name, fields: { ...(raw.fields || {}) } };
    if (raw.type === "decide-branch") n.fields.branch = true;
    if (!Object.hasOwn(NODE_TYPES, type)) {
      n.unknown = true;
      warnings.push(`unknown node type "${raw.type}" (node ${n.id}) — kept, but running this workflow will fail; you may need a newer nanoodle library`);
    } else {
      scrubMediaPlaceholders(n, warnings);
    }
    nodes.push(n);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = [];
  const validLinks = [];
  for (const l of data.links || []) {
    const from = normalizeEndpoint(l?.from);
    const to = normalizeEndpoint(l?.to);
    const toNode = byId.get(to.node);
    if ((toNode?.type === "music" || toNode?.type === "tts") && to.port === "text") to.port = "prompt"; // legacy port migration
    const link = { id: l?.id, from, to };
    const issue = wireIssue(link, byId);
    if (issue) warnings.push(issue.message);
    else validLinks.push(link);
    links.push(link);
  }
  if (competingInputIssues(validLinks).length) {
    const validGraph = { nodes, links: validLinks };
    try {
      const order = topoSort(validGraph);
      const branches = planBranches(validGraph, order.map(node => node.id));
      warnings.push(...staticCompetingInputIssues(validGraph, order, branches));
    } catch (error) {
      if (!(error instanceof NanoodleError)) throw error;
      // Invalid routing or cycles will be reported by run's graph preflight.
    }
  }
  return { nodes, links, warnings };
}

function normalizeEndpoint(endpoint) {
  return { node: endpoint?.node == null ? null : String(endpoint.node), port: String(endpoint?.port ?? "") };
}

/**
 * Kahn topological sort. Throws naming the cyclic nodes.
 * @returns node array in dependency order
 */
function topoSort(graph) {
  const indeg = new Map(graph.nodes.map((n) => [n.id, 0]));
  const outAdj = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const l of graph.links) {
    // Inspection still sorts the existing nodes when a retained wire dangles.
    if (!indeg.has(l.from.node) || !indeg.has(l.to.node)) continue;
    indeg.set(l.to.node, indeg.get(l.to.node) + 1);
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

__x.IMG_PORT_RE = IMG_PORT_RE; __x.EDIT_IMG_RE = EDIT_IMG_RE; __x.VID_PORT_RE = VID_PORT_RE; __x.CLIP_PORT_RE = CLIP_PORT_RE; __x.REF_PORT_RE = REF_PORT_RE; __x.FRAME_PORT_RE = FRAME_PORT_RE; __x.MAX_FRAMES = MAX_FRAMES; __x.wiredFramesFloor = wiredFramesFloor; __x.NODE_TYPES = NODE_TYPES; __x.displayName = displayName; __x.optionalNode = optionalNode; __x.lockedNode = lockedNode; __x.isInputPort = isInputPort; __x.wireIssue = wireIssue; __x.assertNodeRecord = assertNodeRecord; __x.materialize = materialize; __x.topoSort = topoSort;
});
__def("nodes.mjs", function (__x, __req) {
const { slice3d, renderSpriteStack } = __req("sprite-stack.mjs");
const { imageModelOpts } = __req("image-options.mjs");
const { NanoodleError } = __req("errors.mjs");
const { catItem, chatModelCan, pricingAdvertisesRefs } = __req("catalog.mjs");
const { IMG_PORT_RE, EDIT_IMG_RE, REF_PORT_RE, CLIP_PORT_RE, VID_PORT_RE, optionalNode } = __req("graph.mjs");
const { MEDIA_INLINE_MAX } = __req("media.mjs");
const { resizeCropImage, trimAudioToWav, extractAudioToWav, extractVideoFrames, concatVideos, muxSoundtrack, maskToSource, fitImageInline, fitImageJpeg } = __req("local-media.mjs");
const { decideRun, decideImageLimits } = __req("decide.mjs");
const { cleanVoiceRun, CLEANVOICE_DEFAULT_MODEL } = __req("cleanvoice.mjs");
const { runEndpoint } = __req("endpoint.mjs");

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

/**
 * Edit models that demand a FIXED, ORDERED set of input images. Nothing in the live catalog
 * declares a minimum — a full 215-model scan (2026-07-31) found no min_items/min_input_images
 * field, only free text — so the roles live here. The order IS the slot order: role 1 = the
 * `image` port, role 2 = `image2`, … (flux vto auto-detects the wearer either way, but a
 * garment-first send drifts the identity toward the garment photo's model).
 */
const IMG_INPUT_ROLES = {
  "flux-pro/v1/vto": ["person", "garment"],
};

const imgSlot = (i) => (i === 1 ? "image" : "image" + i); // slot index → EDIT_IMG_RE port name

/**
 * Refuse a role-model edit BEFORE the paid call unless every slot is wired. Read the RAW inp
 * keys, never collectPorts: that compacts (.filter(Boolean)), so wiring only `image2` promotes
 * the garment into the person slot and buys a silently wrong result.
 */
function guardInputRoles(model, inp) {
  const roles = IMG_INPUT_ROLES[String(model || "").trim()];
  if (!roles) return;
  const missing = roles.filter((r, i) => !inp[imgSlot(i + 1)]);
  if (!missing.length) return;
  const slots = roles.map((r, i) => `${r} (${imgSlot(i + 1)})`).join(", ");
  throw new NanoodleError(
    `${model} needs ${roles.length} images: ${slots} — ${roles.length - missing.length} wired (missing: ${missing.join(", ")})`,
  );
}

/**
 * edit/inpaint surface EVERY image a model returns. `image` stays the first — the
 * long-standing single-output contract, unchanged for existing graphs — `images`
 * carries them all in response order (mirroring the image node's variations
 * output), and when response items carry layer metadata (layer-decomposition
 * models), `layers` carries it aligned by index with `images`. Fixed-batch
 * models (midjourney fixed_image_count: 4) surface their variants the same way;
 * nothing a model returns is dropped silently anymore.
 */
function multiOut(res) {
  if (typeof res === "string") return { image: res, images: [res] }; // a host-injected ctx.image that ignores multi/items → already one url
  const urls = Array.isArray(res) ? res : res.urls; // …or one that honors multi but not `items` → bare urls
  const out = { image: urls[0], images: urls };
  if (!Array.isArray(res) && res.layers) out.layers = res.layers;
  return out;
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
  // maxTokens is opt-in (D1 ruling, 2026-11-18): absent by default, honored
  // exactly when the node sets it — twin of nanoodle-py _run_llm (truthy +
  // numeric → int(float(v)); non-numeric degrades gracefully, sends nothing).
  if (f.maxTokens && Number.isFinite(+f.maxTokens)) o.max_tokens = Math.trunc(+f.maxTokens);
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
  if (/p-h3-image/i.test(m)) return "ph3"; // wavespeed p-h3-image: lora_url_1..3 (ids lack "lora")
  if (/p-image/i.test(m)) return "pimage";
  if (/klein/i.test(m)) return "flux2klein";
  if (/flux-2/i.test(m)) return "flux2dev";
  if (/z-image/i.test(m)) return "zimage";
  if (/ltx/i.test(m)) return "ltx";
  if (/minimax-h3/i.test(m)) return "h3";
  if (/anima/i.test(m) && /lora/i.test(m)) return "anima";
  if (/qwen-image-2\.1/i.test(m) && /lora/i.test(m)) return "qwen21";
  if (/lora/i.test(m)) return /krea/i.test(m) ? "krea" : "flux";
  return null;
}

function loraKind(type) { return (type === "image" || type === "edit" || type === "inpaint") ? "image" : "video"; }

function imageTakesLora(id) {
  id = String(id || "");
  if (/inpaint/i.test(id)) return false;
  // twin of the app's imageTakesLora (nanoodle #732, #764): flux-2-klein-* is lora-capable;
  // FLUX.3 Klein text-to-image (base + distilled) gained lora_url_1..3 in the catalog on
  // 2026-10-27, but FLUX.3 Klein edit-image still takes no lora_url
  if (/flux-2-klein/i.test(id)) return true;
  if (/flux-3\/klein\/(base\/)?text-to-image/i.test(id)) return true;
  if (/minimax-h3\/(text-to-image|image-edit)/i.test(id)) return true;
  if (/p-h3-image/i.test(id)) return true; // Pruna P-H3 Image (2026-11-05): lora_url_1..3
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
    case "flux2klein": case "zimage": case "ltx": case "krea": case "h3": case "anima": case "qwen21": case "ph3": return 3;
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
  if (fam === "flux2dev" || fam === "flux2klein" || fam === "zimage" || fam === "ltx" || fam === "krea" || fam === "h3" || fam === "anima" || fam === "qwen21" || fam === "ph3") {
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
  const e = { ...imageModelOpts(n.fields.modelOpts), ...loraParams(n) };
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
  // FIBO 1.5: size is 1mp/4mp; shape rides as aspect_ratio. Only this advertised id —
  // leftover fields.aspect after a model swap must not go out on Muse/Recraft/etc.
  // Marketing /api/models additionalParams.aspect_ratio (v1 image-models still omits it).
  if (n.fields.model === "bria/fibo-generate-1.5/text-to-image") {
    const av = (n.fields.aspect != null && n.fields.aspect !== "") ? n.fields.aspect : "1:1";
    if (av !== "") e.aspect_ratio = String(av);
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
  // tvideo/ivideo soft-send aspect+duration (those nodes always show the knobs).
  // vedit/lipsync and resolution never forward a leftover the model did not list.
  // Gallery: Omni v1 has duration+aspect only; leftover 720p/4k from v1.1 must not POST.
  // Matches play videoDimParams (pack.resolution / dimDefs) — including catalog-miss omit.
  const soft = n.type !== "vedit" && n.type !== "lipsync";
  let asp = f.aspect, dur = f.duration;
  if ((asp == null || asp === "") && aP && aP.default != null) asp = aP.default;
  if ((dur == null || dur === "") && dP && dP.default != null) dur = dP.default;
  if (p.resolution && f.resolution != null && f.resolution !== "") out.resolution = f.resolution;
  if ((aP || soft) && asp != null && asp !== "") out[aWire] = asp;
  if ((dP || soft) && dur != null && dur !== "") out[dWire] = dur;
  return out;
}

/* ---------- reference-image wire key + cap (mirrors play's modelAllowsRefs) ----------
   Video models disagree on the ref-array param name AND its size limit; sending the wrong
   key silently degrades to a plain video, sending too many can over-bill. Resolve the
   model's REAL key from the catalog and clamp to its declared max. */
function refMaxFor(model, pricing) {
  const id = String(model || "");
  if (/seedance/i.test(id)) return 9;
  if (/minimax-h3/i.test(id)) return 9; // upstream cap; the first 5 are included, 6-9 bill extra_reference_image each
  if (/gemini-omni-flash\/v1\.2/i.test(id)) return 6;
  if (/luma|ray/i.test(id)) return 4;
  const inc = pricing && +pricing.included_reference_images;
  if (inc > 0) return inc; // no family entry: the included count is the only number the catalog gives us
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
  const modeOptions = pp.mode && pp.mode.options;
  const referenceMode = Array.isArray(modeOptions) && modeOptions.some((o) =>
    o && /^reference\b/i.test(String(o.value != null ? o.value : "")));
  const key = keys.find((k) => k in pp) ||
    (referenceMode || pricingAdvertisesRefs(m.pricing) ? "reference_images" : null);
  if (!key) return null; // known model with no ref-image param, reference mode, or ref pricing
  const d = pp[key];
  let cap = null;
  if (d && typeof d === "object") {
    const mx = d.max != null ? d.max : d.maxItems != null ? d.maxItems : d.max_items;
    if (mx != null && +mx > 0) cap = +mx;
  }
  return { key, cap: cap != null ? cap : refMaxFor(model, m.pricing) };
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
  // Yue2 catalogs the file type as output_format (mp3/wav/flac). The OpenAI response_format
  // key is ignored, so a wav/flac choice came back as mp3. No output_format in the catalog
  // (or no catalog) keeps the old response_format send.
  const putFormat = (fmt) => {
    if (!nonEmpty(fmt)) return;
    const of = sp && sp.output_format;
    const values = of && Array.isArray(of.values) ? of.values : null;
    if (values) {
      if (values.indexOf(fmt) < 0) return;
      const def = of.default != null ? of.default : "mp3";
      if (fmt === def) return;
      body.output_format = fmt;
      return;
    }
    if (fmt !== "mp3") body.response_format = fmt;
  };
  if (n.type === "music") {
    if (nonEmpty(f.lyrics)) body.lyrics = f.lyrics;
    if (f.instrumental === true || f.instrumental === "true") body.instrumental = true;
    if (nonEmpty(f.duration) && num(f.duration) != null && durOk) body.duration = num(f.duration);
    if (nonEmpty(f.negative_prompt)) body.negative_prompt = f.negative_prompt;
    if (nonEmpty(f.seed) && num(f.seed) != null) body.seed = num(f.seed);
    putFormat(f.response_format);
  } else if (n.type === "tts") {
    if (nonEmpty(f.voice) && voiceOk) body.voice = f.voice;
    if (nonEmpty(f.speed) && num(f.speed) != null && num(f.speed) !== 1) body.speed = num(f.speed); // omit when 1
    if (nonEmpty(f.instructions)) body.instructions = f.instructions;
    putFormat(f.response_format);
  } else if (n.type === "remix") {
    if (nonEmpty(f.lyrics)) body.lyrics = f.lyrics;
    if (nonEmpty(f.duration) && num(f.duration) != null && secDurOk) body.duration = num(f.duration);
    // Format is a remix knob only when the catalog lists output_format (Yue2 music-to-music).
    // A cover model with no such key must not receive a stale response_format.
    const of = sp && sp.output_format;
    const fmtListed = !!(of && Array.isArray(of.values) && of.values.length);
    if (!sp || fmtListed) putFormat(f.response_format);
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
 * ctx = { chat, image, video, audio, transcribe, progress } (cost/poll wired by the engine).
 */
const RUNNERS = {
  "slice-3d": slice3d,
  "sprite-stack-render": renderSpriteStack,
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
  async mupload(n) {
    if (!n.fields.model) {
      if (optionalNode(n)) return { model: "" };
      throw new NanoodleError("no 3D file — drop a .glb first");
    }
    return { model: n.fields.model };
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
      stride: n.fields.stride,
      startSec: n.fields.startSec,
      endSec: n.fields.endSec,
      ...media,
      onProgress: ctx && ctx.progress,
    });
  },

  async render3d(n, inp, ctx) {
    if (!inp.model) throw new NanoodleError("render3d: connect a model first");
    // Keep the headless driver and its module-relative assets out of the classic browser bundle.
    if (!globalThis.process?.versions?.node) throw new NanoodleError("render3d requires a Node.js executor with Chromium");
    const { render3dMedia } = await import("./render3d.mjs");
    const media = mediaOpts(ctx);
    return render3dMedia(inp.model, n.fields || {}, { ...media, onProgress: ctx && ctx.progress });
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
    // Wired image ports: a text-only chat model can't see the pictures and NanoGPT still
    // bills the image tokens, so drop them for a KNOWN text-only model and note it —
    // mirrors play's chatModelCan("vision") / editor modelSupportsImages gate (permissive
    // for catalog-absent models; twin of the audio gate below).
    const allImgs = collectPorts(inp, IMG_PORT_RE);
    const seesImages = chatModelCan(ctx.catalog, mdl(n), "vision");
    const imgs = seesImages
      ? await Promise.all(allImgs.map((u) => fitImage(u, ctx, "wired image")))
      : [];
    if (allImgs.length && !seesImages) ctx.progress("image(s) ignored — this model is text-only");
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

  // ⚖️ Decide: one typed question to a NanoGPT decision model (twin of the editor/play node).
  // A closed yes/no gate throws a NanoodleError with code "decide-gate" — downstream skips, unbilled.
  async decide(n, inp, ctx) {
    const model = mdl(n);
    const it = catItem(ctx.catalog, "chat", model);
    // a catalog row WITHOUT decision_input (e.g. the non-detailed /api/v1/models list) is "unknown", not text-only
    const lim = decideImageLimits(it && it.decision_input, !!(it && it.decision_input));
    const fit = (u, maxDim, budget) => fitImageJpeg(u, maxDim, budget, mediaOpts(ctx));
    return decideRun(n.fields || {}, model, inp.text, collectPorts(inp, IMG_PORT_RE), lim, (body) => ctx.decide(body), fit);
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
    guardInputRoles(n.fields.model, inp); // role models: refuse holes before spending
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
    if (!prompt && !/upscal/i.test(n.fields.model || "")
        && !(n.fields.model === "ideogram/vector" && n.fields.modelOpts?.vector_operation === "convert")) throw new NanoodleError("no edit instruction");
    imgs = await Promise.all(imgs.map((u) => fitImage(u, ctx, "source image")));
    guardRefsSize(imgs);
    const src = imgs.length > 1 ? imgs : imgs[0]; // array → multi-image composite; string → single edit
    return multiOut(await ctx.image({ prompt, model: mdl(n), size: n.fields.size || "1024x1024", imageDataUrl: src, extra: imgExtra(n), multi: true, items: true }));
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
    return multiOut(await ctx.image({ prompt, model: mdl(n), size: n.fields.size || "1024x1024", imageDataUrl: source, maskDataUrl: mask, extra: imgExtra(n), multi: true, items: true }));
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
    // Character image (image+video->video motion-control / replace models, e.g. Wan 2.2 Animate):
    // the wired still rides as imageDataUrl next to the driver video. Gated on the catalog so a
    // stale wire left after a swap to a plain v2v model is never sent; catalog miss → send (the
    // wire was authored deliberately, same permissive-ON stance as ivideo's endframe).
    const image = inp.image && vEditTakesImage(ctx && ctx.catalog, n.fields.model) ? await fitImage(inp.image, ctx, "character image") : null;
    return { video: await ctx.video(mdl(n), prompt, opts, image) };
  },

  async lipsync(n, inp, ctx) {
    // Portrait required only for image_to_video avatars. Preset-only talking avatars (audio→video,
    // catalog image_to_video false — e.g. HeyGen Avatar V) run from the preset + audio alone, and a
    // wired image is NOT forwarded. Catalog miss / no catalog keeps the portrait requirement.
    // Twin of play's built-in lipsync runner (nanoodle #733).
    const needsPortrait = avatarNeedsPortrait(ctx && ctx.catalog, String((n.fields && n.fields.model) || "").trim());
    if (needsPortrait && !inp.image) throw new NanoodleError("no image input");
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
    const img = needsPortrait ? await fitImage(inp.image, ctx, "portrait image") : null;
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
        if ((e && e.runId != null) || /^video failed:/i.test(msg)) throw e; // post-submit poll failure: already charged — no second job
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

  // 🎧 Clean voice: hosted audio or video → voice-only audio. data:/blob: refused before any request.
  async cleanvoice(n, inp, ctx) {
    const model = String((n.fields && n.fields.model) || "").trim() || CLEANVOICE_DEFAULT_MODEL;
    return cleanVoiceRun(model, inp, n.fields, (m, extra) => ctx.audio(m, "", extra));
  },

  // 🧊 3D model: image and/or text → model asset via the video submit/poll API.
  // Mesh-processing models (e.g. Hyper3D Rigging) instead take an existing
  // model on the `model` wire and receive it as the `model_url` parameter.
  async model3d(n, inp, ctx) {
    const model = String((n.fields && n.fields.model) || "").trim() || MODEL3D_IMAGE_DEFAULT;
    const mods = model3dInputMods(ctx && ctx.catalog, model);
    const prompt = promptOf(n, inp);
    let image = mods.image ? (inp.image || "") : "";
    const mesh = mods.mesh ? (inp.model || "") : "";
    if (inp.image && !mods.image && ctx && ctx.progress) {
      ctx.progress("This model takes text only — the image wire stays, but this run ignores it.");
    }
    if (inp.model && !mods.mesh && ctx && ctx.progress) {
      ctx.progress("This model generates from scratch — the model wire stays, but this run ignores it.");
    }
    if (prompt && !mods.text && ctx && ctx.progress) {
      ctx.progress("This model takes an image only — the prompt stays, but this run ignores it.");
    }
    if (mods.mesh && !mesh) throw new NanoodleError("Connect a model first.");
    if (!mods.mesh && mods.image && !mods.text && !image) throw new NanoodleError("Connect an image first.");
    if (!mods.mesh && mods.text && !mods.image && !prompt) throw new NanoodleError("Add a prompt first.");
    if (!mods.mesh && mods.image && mods.text && !image && !prompt) throw new NanoodleError("Add a prompt or connect an image first.");
    if (image) image = await fitImage(image, ctx, "source image");
    const extra = { ...(n.fields.modelOpts || {}) };
    if (mesh) extra.model_url = mesh; // the wire wins over a static modelOpts copy
    const url = await ctx.video(model, mods.text ? prompt : "", {
      extra,
      mediaKind: "model3d",
    }, image || null);
    return { model: url };
  },

  // 🔌 Custom endpoint: POST to the graph's own URL. ctx.fetch so tests can point it at a mock.
  async endpoint(n, inp, ctx) {
    return runEndpoint(n, inp, { fetch: ctx && ctx.fetch, signal: ctx && ctx.signal });
  },
};

/**
 * Does this avatar/lipsync model need a portrait image? True unless the model is in the
 * opt-in catalog and is preset-only (no image_to_video — audio→video talking avatars such as
 * HeyGen Avatar V). Catalog miss → true (the long-standing portrait requirement).
 * Mirrors play's built-in lipsync runner: raw `capabilities.image_to_video` or a normalized `i2v`.
 */
// Video-edit models that take a character/reference still AND a driver video but no text prompt
// (architecture image+video->video: Wan 2.2 Animate replace/animate, Kling / PixVerse motion
// control, P-Video Animate). Text+image+video "unified" models are excluded: for them an image
// usually switches the job to image→video and drops the source clip. Catalog miss → true.
function vEditTakesImage(catalog, model) {
  const m = catItem(catalog, "video", model);
  if (!m) return true;
  const a = m.architecture || {};
  const mods = Array.isArray(a.input_modalities) ? a.input_modalities : String(a.modality || "").split("->")[0].split("+");
  return mods.includes("image") && mods.includes("video") && !mods.includes("text");
}

function avatarNeedsPortrait(catalog, model) {
  const m = catItem(catalog, "video", model);
  return !m || !!((m.capabilities || {}).image_to_video) || !!m.i2v;
}

// Image→3D (Tripo) takes a photo only. Hunyuan Rapid takes text and an optional image.
// Anything else, including a catalog miss, accepts either — the editor's same fallback.
const MODEL3D_IMAGE_DEFAULT = "tripo3d/v2.5";
const MODEL3D_TEXT_DEFAULT = "wavespeed-ai/hunyuan-3d-v3.1-rapid";

function model3dInputMods(catalog, id) {
  const it = catItem(catalog, "model3d", id);
  const raw = it && (
    (Array.isArray(it.modalities) && it.modalities)
    || (it.architecture && Array.isArray(it.architecture.input_modalities) && it.architecture.input_modalities)
  );
  if (raw && raw.length) {
    const mods = raw.filter((x) => x === "image" || x === "text" || x === "3d");
    if (mods.length) return { image: mods.includes("image"), text: mods.includes("text"), mesh: mods.includes("3d") };
  }
  if (id === MODEL3D_IMAGE_DEFAULT) return { image: true, text: false, mesh: false };
  if (id === MODEL3D_TEXT_DEFAULT) return { image: true, text: true, mesh: false };
  return { image: true, text: true, mesh: false };
}

__x.IMG_INPUT_ROLES = IMG_INPUT_ROLES; __x.loraParams = loraParams; __x.RUNNERS = RUNNERS; __x.vEditTakesImage = vEditTakesImage;
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

/**
 * True when a video model's PRICING block prices reference images even though its
 * supported_parameters never names the param (minimax-h3 ships that way). A billing
 * line for refs is the catalog stating the model takes them, so the ref gates accept
 * it as evidence; models with neither the param nor the pricing stay "no refs",
 * because an ignored-but-sent ref array is still charged.
 *
 * Also true for a billed `reference_to_video` MODE under per_second_by_mode or
 * per_second_by_mode_and_resolution (Gemini Omni Flash v1 / v1.1) — same class of
 * evidence as extra_reference_image. Exact key only; kling-o1's
 * reference_to_video_image / _video stay on the mode gate (different shape).
 */
function pricingAdvertisesRefs(pricing) {
  if (!pricing) return false;
  if (pricing.included_reference_images != null || pricing.extra_reference_image != null) return true;
  const mm = pricing.per_second_by_mode || pricing.per_second_by_mode_and_resolution;
  return !!(mm && mm.reference_to_video != null);
}

/** Permissive capability probe: true unless the model is in the catalog AND lacks the flag. */
function chatModelCan(catalog, model, flag) {
  const m = catItem(catalog, "chat", model);
  return !m || !!((m.capabilities || {})[flag]);
}

__x.catItem = catItem; __x.pricingAdvertisesRefs = pricingAdvertisesRefs; __x.chatModelCan = chatModelCan;
});
__def("io.mjs", function (__x, __req) {
const { NanoodleError } = __req("errors.mjs");
const { NODE_TYPES, displayName, lockedNode, optionalNode, topoSort, wiredFramesFloor, MAX_FRAMES } = __req("graph.mjs");
const { endpointOutPort } = __req("endpoint.mjs");
const { CHARACTER_SLICE_DEFAULTS } = __req("sprite-slices.mjs");
const { INPUT_SPECS, SETTING_SPECS } = __req("io-specs.mjs");

__x.INPUT_SPECS = INPUT_SPECS; __x.SETTING_SPECS = SETTING_SPECS;

// Allocate the final key, not just a count of the unsuffixed name: an authored
// "Out 2" can otherwise collide with the suffix generated for a second "Out".
function uniqueKey(base, used, isReserved) {
  let key = base;
  for (let suffix = 2; used.has(key.toLowerCase()) || isReserved(key.toLowerCase()); suffix++) key = base + " " + suffix;
  used.add(key.toLowerCase());
  return key;
}

/* ============================== INPUTS ============================== */

const MEDIA_INPUT_KINDS = new Set(["image", "audio", "video", "model3d", "inpaint"]);

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
    // fields.locked: the node's fields are fixed by the graph — never surfaced as inputs,
    // so runs use the stored values.
    if (lockedNode(n)) continue;
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
      const optional = s.optional || (n.type === "endpoint" && s.f === "prompt" && fed(n.id, "text"));
      entries.push(mk(n, s.f, s.label, s.kind, optional, s.def));
    }
  }
  // Friendly keys: a node's custom name labels its input when it contributes exactly one
  // REQUIRED input (app PR #138) — or exactly one input at all, so an author-optional
  // renamed node (e.g. an optional "Style reference" upload) keeps its name as the key.
  // Otherwise the generic spec label. Suffix collisions with other names or addresses.
  const byNode = new Map();
  for (const e of entries) {
    if (!byNode.has(e.nodeId)) byNode.set(e.nodeId, []);
    byNode.get(e.nodeId).push(e);
  }
  const reserved = new Map();
  const reserve = (address, owner) => {
    const key = address.trim().toLowerCase();
    reserved.set(key, reserved.has(key) && reserved.get(key) !== owner ? null : owner);
  };
  for (const e of entries) {
    reserve(`${e.nodeId}.${e.field}`, e);
    if (byNode.get(e.nodeId).length === 1) reserve(e.nodeId, e);
  }
  for (const { to } of graph.links) {
    if (to.node != null) reserve(`${to.node}.${to.port}`, null);
  }
  const used = new Set();
  for (const e of entries) {
    const nodeEntries = byNode.get(e.nodeId);
    const required = nodeEntries.filter((x) => !x.optional);
    const custom = (e._node.name || "").trim();
    const names = (required.length === 1 && required[0] === e) ||
                  (required.length === 0 && nodeEntries.length === 1);
    e.key = uniqueKey(custom && names ? custom : e.label, used, key => reserved.has(key) && reserved.get(key) !== e);
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
 * Order: derived key → nodeId.field / bare nodeId → node custom name → label/field if unique.
 */
function resolveInputKey(graph, inputs, userKey) {
  const spelling = String(userKey).trim();
  const norm = spelling.toLowerCase();
  const byKey = inputs.filter((i) => i.key.toLowerCase() === norm);
  if (byKey.length === 1) return byKey[0];

  const dot = spelling.lastIndexOf(".");
  if (dot > 0) {
    const head = spelling.slice(0, dot);
    const field = spelling.slice(dot + 1).toLowerCase();
    const canonical = new Map(inputs.filter(i => `${i.nodeId}.${i.field}`.trim().toLowerCase() === norm)
      .map(i => [i.nodeId, i]));
    for (const { to } of graph.links) {
      if (to.node != null && `${to.node}.${to.port}`.trim().toLowerCase() === norm) {
        canonical.set(to.node, null);
      }
    }
    const addressed = canonical.has(head) ? [head] : [...canonical.keys()];
    if (addressed.length === 1) {
      const input = canonical.get(addressed[0]);
      if (input) return input;
      throw new NanoodleError(`"${userKey}" is wired from another node in this workflow and can't be supplied as an input`);
    }
    if (addressed.length > 1) {
      const keys = addressed.map(id => {
        const input = canonical.get(id);
        return input ? `${id}.${input.field}` : `${id}.${field} (wired)`;
      });
      throw new NanoodleError(`input "${userKey}" is ambiguous — matches ${keys.join(", ")}`);
    }
  }
  const byNode = inputs.filter(i => i.nodeId.trim().toLowerCase() === norm);
  const exact = byNode.filter(i => i.nodeId === spelling);
  const addressed = exact.length ? exact : byNode;
  if (addressed.length === 1) return addressed[0];
  if (addressed.length > 1) throw ambiguous(userKey, addressed);

  const named = graph.nodes.filter((n) => (n.name || "").trim().toLowerCase() === norm);
  if (named.length) {
    const cand = inputs.filter((i) => named.some((n) => n.id === i.nodeId));
    if (cand.length === 1) return cand[0];
    if (cand.length > 1) throw ambiguous(userKey, cand);
  }

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
  const used = new Set();
  return sinks.map((n) => {
    const aliases = new Set(sinks.filter(other => other.id !== n.id).map(other => other.id.toLowerCase()));
    const key = uniqueKey(displayName(n), used, key => aliases.has(key));
    const t = NODE_TYPES[n.type];
    let ports = t.outputs.map((p) => ({ ...p }));
    // vframes grows frame1..frameN from max(fields.frames, wired floor) (mirrors browser)
    if (n.type === "vframes") {
      const authored = Math.max(1, Math.min(MAX_FRAMES, parseInt(n.fields && n.fields.frames, 10) || 1));
      const count = Math.max(authored, wiredFramesFloor(graph, n.id));
      ports = [];
      for (let i = 1; i <= count; i++) ports.push({ name: "frame" + i, type: "image" });
    }
    // The authored endpoint route predicts the port before run-time wires or settings.
    if (n.type === "endpoint") ports = [endpointOutPort(n)];
    if (n.type === "render3d" && n.fields?.mode === "video") ports = [ports[1], ports[0]];
    return { key, nodeId: n.id, type: n.type, ports };
  });
}

/* ============================== SETTINGS ============================== */

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
    const preset = n.type === "slice-3d" && n.fields.preset === "character" ? CHARACTER_SLICE_DEFAULTS : {};
    for (const s of specs) {
      if (graph.links.some((l) => l.to.node === n.id && l.to.port === s.f)) continue; // wired knob is decided upstream
      const cur = n.fields[s.f];
      const fallback = s.kind === "number" && preset[s.f] != null ? String(preset[s.f]) : preset[s.f] ?? s.def;
      // vframes frames is shape-affecting — never offer a floor below the highest wired frameK
      const min = (n.type === "vframes" && s.f === "frames")
        ? Math.max(s.min || 1, wiredFramesFloor(graph, n.id))
        : s.min;
      out.push({
        key: `${n.id}.${s.f}`, nodeId: n.id, field: s.f, kind: s.kind, label: s.label,
        def: cur != null && String(cur) !== "" ? cur : fallback,
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
  const spelling = String(userKey).trim();
  const norm = spelling.toLowerCase();
  const dot = spelling.lastIndexOf(".");
  if (dot >= 0) {
    const spelledHead = spelling.slice(0, dot);
    const head = spelledHead.toLowerCase(), field = spelling.slice(dot + 1).toLowerCase();
    const wiredError = `setting "${userKey}": that field is wired from another node and can't be overridden`;
    const canonical = new Map(settings.filter((s) => s.key.toLowerCase() === norm).map((s) => [s.nodeId, s]));
    const wired = new Set();
    for (const { to } of graph.links) {
      if (to.port.toLowerCase() !== field) continue;
      wired.add(to.node);
      // A wire reserves the canonical address even when the settings list omits it.
      if (`${to.node}.${to.port}`.toLowerCase() === norm) canonical.set(to.node, null);
    }

    const addressed = canonical.has(spelledHead) ? [spelledHead] : [...canonical.keys()];
    if (addressed.length === 1) {
      const spec = canonical.get(addressed[0]);
      if (spec) return spec;
      throw new NanoodleError(wiredError);
    }
    if (addressed.length > 1) {
      const keys = addressed.map((id) => canonical.get(id)?.key ?? `${id}.${field} (wired)`);
      throw new NanoodleError(`setting "${userKey}" is ambiguous — matches ${keys.join(", ")}`);
    }

    const nodes = graph.nodes.filter((n) => displayName(n).toLowerCase() === head);
    const cand = settings.filter((s) => nodes.some((n) => n.id === s.nodeId) && s.field.toLowerCase() === field);
    if (cand.length === 1) return cand[0];
    if (cand.length > 1) {
      throw new NanoodleError(`setting "${userKey}" is ambiguous — matches ${cand.map((c) => c.key).join(", ")}`);
    }
    if (nodes.some((n) => wired.has(n.id))) throw new NanoodleError(wiredError);
  }

  const byField = settings.filter((s) => s.field.toLowerCase() === norm || s.label.toLowerCase() === norm);
  if (byField.length === 1) return byField[0];
  if (byField.length > 1) {
    throw new NanoodleError(`setting "${userKey}" is ambiguous — matches ${byField.map((c) => c.key).join(", ")}`);
  }

  const avail = settings.map((s) => s.key).join(", ") || "(none)";
  throw new NanoodleError(`unknown setting "${userKey}" — available settings: ${avail}`);
}

__x.MEDIA_INPUT_KINDS = MEDIA_INPUT_KINDS; __x.deriveInputs = deriveInputs; __x.resolveInputKey = resolveInputKey; __x.deriveOutputs = deriveOutputs; __x.deriveSettings = deriveSettings; __x.resolveSettingKey = resolveSettingKey;
});
__def("branches.mjs", function (__x, __req) {
const { NanoodleError } = __req("errors.mjs");

function isBranchDecider(node) {
  return node.type === "decide" && node.fields?.branch === true;
}

const branchPort = (port) => port === "yes" || port === "no";

/**
 * Build per-run routing over a topologically ordered set of node IDs.
 * Explicit Yes/No wires control entry to a branch. Further downstream, any
 * active routed input opens a join. Ordinary dependencies never open a branch.
 */
function planBranches(graph, order) {
  const deciders = new Map(graph.nodes.filter(n => n.type === "decide").map(n => [n.id, n]));
  const direct = new Set();
  for (const link of graph.links) {
    const source = deciders.get(link.from.node);
    if (!source || !branchPort(link.from.port)) continue;
    if (!isBranchDecider(source)) {
      throw new NanoodleError(`node ${source.id}: enable branching on Decide to wire ${link.from.port}`, { code: "decide-branch" });
    }
    direct.add(link);
  }
  if (!direct.size) return null;

  const inbound = new Map(order.map(id => [id, []]));
  for (const link of graph.links) inbound.get(link.to.node)?.push(link);
  const selectors = new Map();
  for (const id of order) {
    const links = inbound.get(id);
    const fromDeciders = links.filter(link => direct.has(link));
    const controls = fromDeciders.length ? fromDeciders : links.filter(link => selectors.has(link.from.node));
    if (controls.length) selectors.set(id, controls);
  }
  const skipped = new Set();
  return {
    isRouted: id => selectors.has(id),
    // Call after this node's upstreams have settled. A failed router is left
    // to the usual upstream-error handling, which must also prevent execution.
    activeLinks(id, outFor) {
      const closed = (link) => {
        if (skipped.has(link.from.node)) return true;
        if (!direct.has(link)) return false;
        const branch = outFor(link.from.node)?.decision?.branch;
        return branchPort(branch) && branch !== link.from.port;
      };
      const controls = selectors.get(id);
      if (controls?.every(closed)) {
        skipped.add(id);
        return null;
      }
      return inbound.get(id).filter(link => !closed(link));
    },
  };
}

__x.isBranchDecider = isBranchDecider; __x.planBranches = planBranches;
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
const { deflate } = __req("zlib.mjs");
const { decodePngPixels } = __req("png-decoder.mjs");
const { NanoodleError } = __req("errors.mjs");
const { abortReason, throwIfAborted } = __req("deadline.mjs");
const { MAX_FRAMES } = __req("graph.mjs");
const { bytesToDataUrl, dataUrlBytes, downloadMedia, sniffMime, MEDIA_INLINE_MAX } = __req("media.mjs");
const { MP4CAT } = __req("mp4cat.mjs");

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

__x.throwIfAborted = throwIfAborted;

async function runProc(bin, args, { timeoutMs = 120000, signal } = {}) {
  await ensureNodeDeps();
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
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
      finish(() => reject(abortReason(signal)));
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
async function urlBytes(url, fetchFn, signal) {
  if (url == null) throw new NanoodleError("no media input");
  const u = typeof url === "object" && url.url != null ? url.url : String(url);
  if (/^data:/i.test(u)) return dataUrlBytes(u).bytes;
  if (/^https?:/i.test(u)) {
    const fetchImpl = fetchFn || globalThis.fetch;
    if (!fetchImpl) throw new NanoodleError("can't download media: no fetch available");
    return (await downloadMedia(u, { fetch: fetchImpl, signal })).bytes;
  }
  throw new NanoodleError("media must be a data: or http(s) URL");
}

async function writeInput(dir, name, url, fetchFn, signal) {
  await ensureNodeDeps();
  return writeInputBytes(dir, name, url, await urlBytes(url, fetchFn, signal));
}

async function writeInputBytes(dir, name, url, bytes) {
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

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  return c;
});

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC32_TABLE[(c ^ buf[i]) & 0xff];
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

/** Decode a PNG texture to straight-alpha 8-bit RGBA. */
async function decodePng(bytes, allowSpriteStrip = false) {
  return decodePngPixels(bytes, {maxDim:MAX_IMAGE_DIM, allowSpriteStrip});
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

  const srcBytes = await urlBytes(sourceUrl, fetchFn, signal);
  throwIfAborted(signal);
  const maskBytes = await urlBytes(maskUrl, fetchFn, signal);
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
    const srcPath = await writeInput(dir, "src", sourceUrl, fetchFn, signal);
    const maskPath = await writeInput(dir, "mask", maskUrl, fetchFn, signal);
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

  const bytes = await urlBytes(url, fetchFn, signal);
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

/**
 * Shrink an image to fit a decision model's limits (⚖️ Decide): long edge ≤ maxDim and the
 * data: URL ≤ budget characters. JPEG on white (a transparent PNG can't turn black), stepping
 * quality down, then size, until it fits — the twin of the browser's canvas decideFitImage.
 * Needs ffmpeg (decisions without images never touch this).
 */
async function fitImageJpeg(url, maxDim, budget, { fetch: fetchFn, signal } = {}) {
  return withTemp(async (dir) => {
    throwIfAborted(signal);
    const inPath = await writeInput(dir, "in", url, fetchFn, signal);
    const probe = await runProc("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", inPath,
    ], { signal });
    const dims = String(probe.stdout).trim().split("x").map(Number);
    const sw = dims[0], sh = dims[1];
    if (!(sw > 0) || !(sh > 0)) throw new NanoodleError("couldn’t read an image to judge");
    let s = Math.min(1, maxDim / Math.max(sw, sh));
    const qs = [3, 5, 8, 12]; // mjpeg -q:v (2 = best … 31 = worst) ≈ canvas quality 0.85 → 0.48
    for (let round = 0; round < 6; round++) {
      const w = Math.max(2, Math.round(sw * s / 2) * 2), h = Math.max(2, Math.round(sh * s / 2) * 2);
      for (const q of qs) {
        throwIfAborted(signal);
        const outPath = join(dir, `fit-${round}-${q}.jpg`);
        await runProc("ffmpeg", [
          "-y", "-i", inPath, "-filter_complex",
          `color=c=white:s=${w}x${h}[bg];[0:v]scale=${w}:${h},format=rgba[fg];[bg][fg]overlay=shortest=1,format=yuvj420p`,
          "-frames:v", "1", "-q:v", String(q), outPath,
        ], { signal });
        const out = await dataUrlFromFile(outPath, "image/jpeg");
        if (out.length <= budget) return out;
      }
      s *= 0.75;
    }
    throw new NanoodleError("couldn’t shrink an image small enough for the decision model");
  });
}

async function resizeCropImageFfmpeg(url, m, w, h, { fetch: fetchFn, signal } = {}) {
  return withTemp(async (dir) => {
    throwIfAborted(signal);
    const inPath = await writeInput(dir, "in", url, fetchFn, signal);
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
  const bytes = await urlBytes(url, fetchFn, signal);
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

  // The format check already loaded the input. Decode those same bytes if PCM trimming is unavailable.
  return trimAudioToWavFfmpeg(url, bytes, start, len, rate, { wholeIfBlank, signal });
}

async function trimAudioToWavFfmpeg(url, bytes, start, len, rate, { wholeIfBlank, signal }) {
  return withTemp(async (dir) => {
    throwIfAborted(signal);
    const inPath = await writeInputBytes(dir, "in", url, bytes);
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
      throwIfAborted(signal);
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

function frameRangeValue(value, name) {
  if (value == null || value === "") return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) throw new NanoodleError(`${name} must be a non-negative time in seconds`);
  return seconds;
}

async function extractIndexedFrames(inPath, dir, { n, stride, gap, start, end, fromEnd, onProgress, signal }) {
  if (onProgress) onProgress("reading frame timestamps…");
  const { stdout } = await runProc("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_frames",
    "-show_entries", "stream=time_base:frame=best_effort_timestamp", "-of", "json", inPath,
  ], { signal });
  let probe;
  try { probe = JSON.parse(stdout); } catch { throw new NanoodleError("could not read the video frame timestamps"); }
  const [units, scale] = String(probe.streams?.[0]?.time_base || "").split("/").map(Number);
  const frames = probe.frames || [];
  const origin = frames[0]?.best_effort_timestamp;
  if (!(units > 0 && scale > 0) || !Number.isSafeInteger(origin)) {
    throw new NanoodleError("video has no readable frame timestamps");
  }
  const available = [];
  let previous = origin;
  for (const [index, frame] of frames.entries()) {
    const pts = frame.best_effort_timestamp;
    if (!Number.isSafeInteger(pts) || pts < previous) {
      throw new NanoodleError("video frame timestamps are missing or out of order");
    }
    previous = pts;
    const time = (pts - origin) * units / scale;
    if (time > end + 1e-9) break;
    if (time + 1e-9 >= start) available.push({ index, time });
  }
  if (fromEnd) available.reverse();
  if (available.length === 0) throw new NanoodleError("no video frames in the requested time range");

  const selected = [];
  let lastTime;
  for (const [offset, { index, time }] of available.entries()) {
    if (stride ? offset % stride !== 0 : lastTime !== undefined && Math.abs(time - lastTime) + 1e-9 < gap) continue;
    selected.push(index);
    lastTime = time;
    if (selected.length === n) break;
  }

  // Decode the first video stream in the same display order as ffprobe.
  // Select by frame number, so VFR gaps and seek rounding cannot change the result.
  const filter = selected.map(index => `eq(n,${index})`).join("+");
  if (onProgress) onProgress(`extracting ${selected.length} frames…`);
  await runProc("ffmpeg", [
    "-y", "-i", inPath, "-map", "0:v:0", "-vf", `select='${filter}'`,
    "-fps_mode", "passthrough", "-frames:v", String(selected.length), "-q:v", "2",
    "-start_number", "1", join(dir, "frame-%d.jpg"),
  ], { signal });
  const out = {};
  for (const [i] of selected.entries()) {
    throwIfAborted(signal);
    const fileNumber = fromEnd ? selected.length - i : i + 1;
    out[`frame${i + 1}`] = await dataUrlFromFile(join(dir, `frame-${fileNumber}.jpg`), "image/jpeg");
  }
  return out;
}

async function extractVideoFrames(url, { count = 1, gap = 0.5, dir = "end", stride, startSec, endSec, fetch: fetchFn, onProgress, signal } = {}) {
  throwIfAborted(signal);
  const n = Math.max(1, Math.min(MAX_FRAMES, parseInt(count, 10) || 1));
  const stepSec = Number.isFinite(Number(gap)) ? Math.max(0, Number(gap)) : 0.5;
  const fromEnd = (dir || "end") === "end";
  const rangeStart = frameRangeValue(startSec, "startSec");
  const rangeEnd = frameRangeValue(endSec, "endSec");
  const strideN = stride != null && stride !== "" ? Number(stride) : undefined;
  if (strideN !== undefined && (!Number.isSafeInteger(strideN) || strideN < 1)) {
    throw new NanoodleError("stride must be a positive integer");
  }
  if (rangeEnd !== undefined && rangeEnd < (rangeStart ?? 0)) {
    throw new NanoodleError("endSec must be at or after startSec");
  }

  return withTemp(async (dir) => {
    const inPath = await writeInput(dir, "in", url, fetchFn, signal);
    throwIfAborted(signal);
    if (strideN !== undefined || rangeStart !== undefined || rangeEnd !== undefined) {
      return extractIndexedFrames(inPath, dir, {
        n, stride: strideN, gap: stepSec, start: rangeStart ?? 0, end: rangeEnd ?? Infinity,
        fromEnd, onProgress, signal,
      });
    }
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
    // Keep the legacy gap-only sampling for existing graphs.
    const out = {};
    for (let i = 0; i < n; i++) {
      throwIfAborted(signal);
      if (onProgress) onProgress(`extracting frame ${i + 1}/${n}…`);
      const target = fromEnd ? dur - EPS - i * stepSec : i * stepSec;
      const t = Math.max(0, Math.min(Math.max(0, dur - EPS), target));
      const framePath = join(dir, `f${i + 1}.jpg`);
      try {
        await grab(t, framePath);
      } catch (e) {
        if (e?.code === "aborted" || e?.code === "timeout") throw e;
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
      bufs.push(await urlBytes(urls[i], fetchFn, signal));
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
      paths.push(await writeInput(dir, `c${i}`, urls[i], fetchFn, signal));
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
    const vPath = await writeInput(dir, "v", videoUrl, fetchFn, signal);
    const aPath = await writeInput(dir, "a", audioUrl, fetchFn, signal);
    const outPath = join(dir, "out.mp4");

    let vdur = null;
    try {
      const pr = await runProc("ffprobe", [
        "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", vPath,
      ], { signal });
      vdur = parseFloat(String(pr.stdout).trim());
    } catch (e) {
      if (e instanceof NanoodleError && (e.code === "aborted" || e.code === "timeout" || /timed out|aborted/i.test(e.message || ""))) throw e;
      throwIfAborted(signal);
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
__x.decodePng = decodePng; __x.encodePngRgba = encodePngRgba; __x.crc32 = crc32; __x.pngChunk = pngChunk; __x.catBytes = catBytes;

__x.resizePlan = resizePlan; __x.maskToSource = maskToSource; __x.encodeWavMono = encodeWavMono; __x.resizeCropImage = resizeCropImage; __x.INLINE_IMAGE_BUDGET = INLINE_IMAGE_BUDGET; __x.fitImageInline = fitImageInline; __x.fitImageJpeg = fitImageJpeg; __x.trimAudioToWav = trimAudioToWav; __x.extractAudioToWav = extractAudioToWav; __x.extractVideoFrames = extractVideoFrames; __x.concatVideos = concatVideos; __x.muxSoundtrack = muxSoundtrack;
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

/**
 * Does a complete-endpoint body already carry the replayed API result?
 * A paid decision comes back as { answers, usage }. That is success. Treating
 * it as a bare receipt makes the client resend the original request, and the
 * API answers 402 because the payment was already consumed.
 */
function looksLikeResult(j) {
  if (!j || typeof j !== "object") return false;
  if (RESULT_KEYS.some((k) => j[k] != null)) return true;
  return j.answers != null && j.usage != null && typeof j.usage === "object";
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
__def("deadline.mjs", function (__x, __req) {
const { NanoodleError } = __req("errors.mjs");

const MAX_TIMEOUT_MS = 2_147_483_647;

function normalizeTimeoutMs(value, label) {
  const ms = typeof value === "string" ? Number(value) : value ?? 0;
  // A nonzero decimal string can round down to zero during conversion.
  const underflow = ms === 0 && typeof value === "string" && /[1-9]/.test(value.split(/[eE]/, 1)[0]);
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_TIMEOUT_MS || underflow) {
    throw new NanoodleError(`${label} expects milliseconds between 0 and ${MAX_TIMEOUT_MS}`, { code: "invalid-timeout" });
  }
  return ms === 0 ? null : ms;
}

// Keep the absolute deadline alongside the real signal. The timer wakes idle
// work, while I/O and completion checks also catch an overdue timer when
// synchronous code or a chain of microtasks keeps the event loop busy.
const checks = new WeakMap();

function startDeadline(controller, timeoutMs, message, parentSignal) {
  const until = timeoutMs == null ? Infinity : performance.now() + timeoutMs;
  const expire = () => controller.abort(new NanoodleError(message, { code: "timeout" }));
  const signal = controller.signal;
  checks.set(signal, () => {
    enforceDeadline(parentSignal);
    if (!signal.aborted && performance.now() >= until) expire();
  });
  return timeoutMs == null ? null : setTimeout(expire, Math.ceil(timeoutMs));
}

function enforceDeadline(signal) {
  checks.get(signal)?.();
}

function abortReason(signal) {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new NanoodleError(reason != null ? String(reason) : "run aborted", { code: "aborted" });
}

function throwIfAborted(signal) {
  enforceDeadline(signal);
  if (signal?.aborted) throw abortReason(signal);
}

__x.normalizeTimeoutMs = normalizeTimeoutMs; __x.startDeadline = startDeadline; __x.enforceDeadline = enforceDeadline; __x.abortReason = abortReason; __x.throwIfAborted = throwIfAborted;
});
__def("input-wires.mjs", function (__x, __req) {
const { isBranchDecider } = __req("branches.mjs");

const COMPETING_INPUT_WIRES = "competing-input-wires";

/** One logical input can receive one value. Repeated copies of a wire share a supplier. */
function competingInputIssues(links) {
  const inputs = new Map();
  for (const { from, to } of links) {
    const inputKey = JSON.stringify([to.node, to.port]);
    if (!inputs.has(inputKey)) inputs.set(inputKey, { to, sources: new Set() });
    inputs.get(inputKey).sources.add(`${from.node}.${from.port}`);
  }
  const issues = [];
  for (const { to, sources } of inputs.values()) {
    if (sources.size < 2) continue;
    const suppliers = [...sources].sort().join(", ");
    issues.push(`input ${to.node}.${to.port} has competing wires from ${suppliers}. Leave one active wire for this input.`);
  }
  return issues.sort();
}

function canOmitOutput(node, port) {
  if (node.type === "endpoint" || node.type === "render3d" || node.type === "vframes") return true;
  if (node.type === "sprite-stack-render") return port === "video";
  return port === "layers" && (node.type === "edit" || node.type === "inpaint");
}

/** Defer to the run when an upstream output or the consumer can be inactive. */
function staticCompetingInputIssues(graph, order, branches, fieldsFor = node => node.fields) {
  const inbound = new Map(order.map(node => [node.id, []]));
  const byId = new Map(order.map(node => [node.id, node]));
  for (const link of graph.links) inbound.get(link.to.node)?.push(link);

  const mayGate = new Set();
  const steady = [];
  for (const node of order) {
    const links = inbound.get(node.id);
    if (links.some(link => mayGate.has(link.from.node))) {
      mayGate.add(node.id);
      continue;
    }
    if (node.type === "decide" && !isBranchDecider(node)) {
      const fields = fieldsFor(node);
      const canEnable = fields.gate === true || fields.gate === "true" || links.some(link => link.to.port === "gate");
      const canBeYesNo = fields.mode === "yesno" || links.some(link => link.to.port === "mode");
      if (canEnable && canBeYesNo) mayGate.add(node.id);
    }
    if (branches?.isRouted(node.id)) continue;
    for (const link of links) {
      const supplier = byId.get(link.from.node);
      if (!supplier || supplier.unknown || fieldsFor(supplier).onError === "skip" || canOmitOutput(supplier, link.from.port)) continue;
      steady.push(link);
    }
  }
  return competingInputIssues(steady);
}

__x.COMPETING_INPUT_WIRES = COMPETING_INPUT_WIRES; __x.competingInputIssues = competingInputIssues; __x.staticCompetingInputIssues = staticCompetingInputIssues;
});
__def("endpoint.mjs", function (__x, __req) {
/**
 * 🔌 Custom endpoint — POST a NanoGPT-shaped body to a URL the graph names.
 * Twin of the editor/play helpers (index.html runEndpoint). The request goes
 * straight to that URL: never the NanoGPT client, never the API key.
 * Custom auth is only fields.auth. http is allowed for loopback and LAN;
 * a public host must be https.
 */
const { NanoodleError } = __req("errors.mjs");
const { throwIfAborted } = __req("deadline.mjs");
const { b64ImageMime, bytesToDataUrl } = __req("media.mjs");

const ENDPOINT_DEF_URL = "http://127.0.0.1:8787/v1/chat/completions";
const ENDPOINT_MODES = ["chat", "image", "video", "audio", "json"];

function endpointOutPort(n, out) {
  // Inspection knows the authored route. At runtime the parser already selected
  // the primary port, including mode/URL wires and per-run settings overrides.
  const emitted = out && ["text", "image", "video", "audio"].find(name => Object.hasOwn(out, name));
  const mode = emitted || endpointResolveTarget(n).mode;
  const name = mode === "chat" || mode === "json" ? "text" : mode;
  return { name, type: name };
}

function endpointIsLoopbackHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function endpointIsPrivateIPv4(host) {
  const p = String(host || "").split(".");
  if (p.length !== 4) return false;
  if (!p.every((x) => /^\d+$/.test(x) && +x >= 0 && +x <= 255)) return false;
  const a = +p[0], b = +p[1];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function endpointUrlOk(url) {
  const s = String(url || "").trim();
  if (!s) return "URL required — set the custom endpoint URL";
  let u;
  try { u = new URL(s); } catch {
    return "that URL isn’t allowed — use http://localhost, 127.0.0.1, a LAN host, or https";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return "that URL isn’t allowed — use http://localhost, 127.0.0.1, a LAN host, or https";
  }
  if (u.username || u.password) {
    return "that URL isn’t allowed — don’t put credentials in the URL; use the Authorization field";
  }
  if (u.protocol === "https:") return true;
  const host = u.hostname;
  if (endpointIsLoopbackHost(host) || endpointIsPrivateIPv4(host) || /\.local$/i.test(host)) return true;
  return "that URL isn’t allowed — http is only for localhost, 127.0.0.1, or a LAN host; use https for a public host";
}

function endpointHeaders(auth) {
  const headers = { "Content-Type": "application/json" };
  const a = String(auth || "").trim();
  if (a) headers.Authorization = /\s/.test(a) ? a : ("Bearer " + a);
  return headers;
}

function endpointPrompt(n, inp) {
  inp = inp || {};
  const v = inp.prompt != null ? inp.prompt : (inp.text != null ? inp.text : (n.fields && n.fields.prompt));
  return String(v == null ? "" : v).trim();
}

function endpointIsPath(s) {
  const raw = String(s == null ? "" : s).trim();
  if (!raw || raw.charAt(0) !== "/") return false;
  if (raw.length < 2) return false;
  if (/[\s\u00b7|\u2022]/.test(raw)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return false;
  return true;
}

function endpointJoinPath(base, path) {
  const u = new URL(String(base || "").trim());
  let p = String(path || "").trim();
  if (p.charAt(0) !== "/") p = "/" + p;
  const q = p.indexOf("?");
  if (q >= 0) { u.pathname = p.slice(0, q); u.search = p.slice(q); }
  else { u.pathname = p; u.search = ""; }
  return u.toString();
}

function endpointParseRoute(s) {
  const raw = String(s == null ? "" : s).trim();
  const out = {};
  if (!raw) return out;
  const low = raw.toLowerCase();
  if (ENDPOINT_MODES.includes(low)) { out.mode = low; return out; }
  let mode = "", rest = raw;
  for (const prefix of ENDPOINT_MODES) {
    if (!low.startsWith(prefix)) continue;
    const after = raw.slice(prefix.length);
    const ch = after.charAt(0);
    if (ch === "\u00b7" || ch === "|" || ch === ":" || ch === "\u2022" || ch === "-" || /\s/.test(ch)) {
      mode = prefix;
      rest = after.replace(/^[\s\u00b7|\u2022:\-]+/, "");
      break;
    }
  }
  rest = String(rest || "").replace(/\s+\([^)]*\)\s*$/, "").trim();
  let url = "";
  const m = rest.match(/https?:\/\/[^\s)]+/i);
  if (m) url = m[0].replace(/[.,;]+$/, "");
  if (mode) out.mode = mode;
  if (url) out.url = url;
  else if (endpointIsPath(rest)) out.path = rest;
  else if (!mode && endpointIsPath(raw)) out.path = raw;
  return out;
}

function endpointResolveTarget(n, inp) {
  inp = inp || {};
  const hasFieldUrl = n && n.fields && Object.prototype.hasOwnProperty.call(n.fields, "url");
  const fieldUrl = hasFieldUrl ? n.fields.url : ENDPOINT_DEF_URL;
  const urlRaw = (inp.url != null && String(inp.url).trim() !== "") ? inp.url : fieldUrl;
  const modeRaw = (inp.mode != null && String(inp.mode).trim() !== "") ? inp.mode : (n && n.fields && n.fields.mode);
  const parsedUrl = endpointParseRoute(urlRaw);
  const parsedMode = endpointParseRoute(modeRaw);
  const parsedField = endpointParseRoute(fieldUrl);
  const path = parsedUrl.path || parsedMode.path;
  let resolvedUrl = parsedUrl;
  if (path && !parsedUrl.url) {
    const base = parsedField.url || String(fieldUrl == null ? "" : fieldUrl).trim();
    if (base && !endpointIsPath(base)) {
      try { resolvedUrl = { mode: parsedUrl.mode, url: endpointJoinPath(base, path) }; } catch { /* leave the raw path to fail urlOk */ }
    }
  }
  let url = resolvedUrl.url || String(urlRaw == null ? "" : urlRaw).trim();
  let mode;
  if (resolvedUrl.url && resolvedUrl.mode) mode = resolvedUrl.mode;
  else if (parsedMode.url && parsedMode.mode) { url = parsedMode.url; mode = parsedMode.mode; }
  else mode = parsedMode.mode || resolvedUrl.mode || (n && n.fields && n.fields.mode) || "chat";
  mode = ENDPOINT_MODES.includes(String(mode).toLowerCase()) ? String(mode).toLowerCase() : "chat";
  return { url, mode };
}

function endpointModel(n) {
  const m = String((n.fields && n.fields.model) || "").trim();
  return m || "local";
}

function endpointRequestBody(mode, n, inp) {
  inp = inp || {};
  const model = endpointModel(n);
  if (mode === "chat") {
    const prompt = endpointPrompt(n, inp);
    const messages = [];
    const sys = String((n.fields && n.fields.system) || "").trim();
    if (sys) messages.push({ role: "system", content: sys });
    const imgs = inp.image ? (Array.isArray(inp.image) ? inp.image : [inp.image]) : [];
    const aud = inp.audio
      ? { type: "input_audio", input_audio: { data: String(inp.audio).replace(/^data:[^,]*,/, ""), format: "wav" } }
      : null;
    if (imgs.length || aud) {
      const parts = [{ type: "text", text: prompt || "" }];
      for (const url of imgs) parts.push({ type: "image_url", image_url: { url } });
      if (aud) parts.push(aud);
      messages.push({ role: "user", content: parts });
    } else {
      messages.push({ role: "user", content: prompt });
    }
    return { model, messages, temperature: 0.8 };
  }
  if (mode === "image") {
    const ib = { model, size: (n.fields && n.fields.size) || "1024x1024", n: 1, response_format: "b64_json" };
    const ip = endpointPrompt(n, inp);
    if (ip) ib.prompt = ip;
    if (inp.image) ib.imageDataUrl = inp.image;
    return ib;
  }
  if (mode === "video") {
    const vb = { model, prompt: endpointPrompt(n, inp) };
    if (inp.image) vb.imageDataUrl = inp.image;
    if (inp.video) {
      if (/^https?:/i.test(inp.video)) vb.videoUrl = inp.video;
      else vb.videoDataUrl = inp.video;
    }
    return vb;
  }
  if (mode === "audio") {
    const ab = { model, input: endpointPrompt(n, inp) };
    if (inp.audio) {
      if (/^https?:/i.test(inp.audio)) ab.audioUrl = inp.audio;
      else ab.audioDataUrl = inp.audio;
    }
    return ab;
  }
  const jb = {};
  if (inp.text != null && inp.text !== "") jb.text = inp.text;
  else {
    const tp = endpointPrompt(n, inp);
    if (tp) jb.text = tp;
  }
  if (inp.image) jb.image = inp.image;
  if (inp.video) jb.video = inp.video;
  if (inp.audio) jb.audio = inp.audio;
  return jb;
}

function endpointShapeHint(mode) {
  if (mode === "chat") return "OpenAI chat JSON { choices:[{ message:{ content } }] }";
  if (mode === "image") return "{ data:[{ b64_json }] } or { data:[{ url }] }";
  if (mode === "video") return '{ "url" } or NanoGPT { output: { video: { url } } }';
  if (mode === "audio") return '{ "url" } or a binary audio body';
  return '{ "text" } or { "data": ... }';
}

function endpointApiMessage(body) {
  try {
    const j = JSON.parse(String(body || "").replace(/^\d{3}:\s*/, ""));
    const err = j && j.error;
    let msg = (typeof err === "string" && err)
      || (err && typeof err.message === "string" && err.message)
      || (j && typeof j.message === "string" && j.message)
      || (j && typeof j.detail === "string" && j.detail)
      || (j && typeof j.title === "string" && j.title);
    msg = String(msg || "").replace(/\s+/g, " ").trim();
    return msg || null;
  } catch { return null; }
}

function endpointHttpError(status, body) {
  const extracted = endpointApiMessage(body);
  let hint = "";
  if (status === 404) hint = "check the custom endpoint URL";
  else if (status === 401 || status === 403) hint = "check the Authorization field";
  else if (status === 405) hint = "this endpoint must accept POST";
  else if (status === 413) hint = "payload too large; send a smaller body";
  else if (status === 415) hint = "send JSON (Content-Type: application/json)";
  if (extracted) return extracted + (hint ? " — " + hint : "");
  if (/<html|<body|<!doctype/i.test(String(body || ""))) {
    return status + " — the URL returned a web page, not JSON; check the custom endpoint URL";
  }
  if (hint) return status + " — " + hint;
  if (!String(body || "").replace(/\s+/g, "").trim()) {
    return status + " — the endpoint returned an error with no body; check the URL and mode";
  }
  if (/^\s*[{\[]/.test(String(body || ""))) {
    return status + " — the endpoint rejected the request (check URL, mode, and the posted JSON)";
  }
  return status + ": " + String(body).replace(/\s+/g, " ").trim().slice(0, 160);
}

function endpointNotJsonError(mode, ct, raw) {
  const sample = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (/<html|<body|<!doctype/i.test(raw || "") || /text\/html/i.test(ct || "")) {
    return "the endpoint returned a web page, not JSON — check the URL (it must POST " + endpointShapeHint(mode) + ")";
  }
  return "response is not JSON — return " + endpointShapeHint(mode) + (sample ? " (got: " + sample + ")" : "");
}

function endpointParseChat(j) {
  const msg = (j && j.choices && j.choices[0] && j.choices[0].message) || {};
  const txt = msg.content;
  if (txt == null) throw new NanoodleError("no text in response — return " + endpointShapeHint("chat"));
  return { text: typeof txt === "string" ? txt : txt.map((p) => p.text || "").join("") };
}

function endpointParseImage(j) {
  const urls = ((j && j.data) || []).map((d) => {
    if (d.b64_json) return "data:" + b64ImageMime(d.b64_json) + ";base64," + d.b64_json;
    return d.url;
  }).filter(Boolean);
  if (!urls.length) throw new NanoodleError("no image in response — return " + endpointShapeHint("image"));
  return { image: urls[0], images: urls };
}

function endpointParseVideo(j) {
  const out = (j && j.data && j.data.output) || (j && j.output) || {};
  const url = (j && (j.url || j.videoUrl))
    || (out.video && out.video.url)
    || out.url
    || (Array.isArray(out.video) ? (out.video[0] && out.video[0].url) : null)
    || (j && j.data && j.data.url);
  if (!url) throw new NanoodleError('no video url in response — return { "url" } or NanoGPT { output: { video: { url } } }');
  return { video: url };
}

function endpointParseAudioJson(j) {
  const url = (j && (j.url || j.audioUrl)) || (j && j.data && (j.data.url || j.data.audioUrl));
  if (!url) throw new NanoodleError('no audio url in response — return { "url" } or a binary audio body');
  return { audio: url };
}

function endpointLooksLikeEcho(j) {
  if (!j || typeof j !== "object") return false;
  const h = j.headers;
  if (!h || typeof h !== "object" || Array.isArray(h)) return false;
  if (!Object.prototype.hasOwnProperty.call(j, "data") && !Object.prototype.hasOwnProperty.call(j, "json")) return false;
  return j.url != null || j.origin != null || j.method != null;
}

function endpointJsonModeText(v) {
  if (typeof v === "string") {
    const s = v.trim();
    if (s) {
      try {
        const p = JSON.parse(s);
        if (p && typeof p === "object") return endpointJsonModeText(p);
      } catch { /* plain text */ }
    }
    return v;
  }
  if (v && typeof v === "object") {
    if (endpointLooksLikeEcho(v)) {
      const inner = (Object.prototype.hasOwnProperty.call(v, "json") && v.json != null) ? v.json : v.data;
      if (inner !== v) return endpointJsonModeText(inner);
    }
    if (v.text != null) return String(v.text);
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }
  return v == null ? "" : String(v);
}

function endpointParseJsonMode(j) {
  if (j && j.text != null && !endpointLooksLikeEcho(j)) return { text: String(j.text) };
  if (endpointLooksLikeEcho(j)) {
    return { text: endpointJsonModeText((Object.prototype.hasOwnProperty.call(j, "json") && j.json != null) ? j.json : j.data) };
  }
  if (j && Object.prototype.hasOwnProperty.call(j, "data")) return { text: endpointJsonModeText(j.data) };
  throw new NanoodleError('json mode expected { "text" } or { "data": ... } — not a chat/completions wrapper');
}

async function endpointParseResponse(mode, r) {
  const ct = (r.headers && r.headers.get && r.headers.get("content-type")) || "";
  if (mode === "audio" && !/json/i.test(ct)) {
    const bytes = new Uint8Array(await r.arrayBuffer());
    let mime = ct.split(";")[0].trim().toLowerCase();
    if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream") mime = "audio/mpeg";
    return { audio: bytesToDataUrl(bytes, mime) };
  }
  let raw = "";
  try { raw = await r.text(); } catch { raw = ""; }
  if (!String(raw).trim()) {
    throw new NanoodleError("empty response — the endpoint returned no body; check the URL and mode");
  }
  let j;
  try { j = JSON.parse(raw); } catch {
    throw new NanoodleError(endpointNotJsonError(mode, ct, raw));
  }
  if (mode === "chat") return endpointParseChat(j);
  if (mode === "image") return endpointParseImage(j);
  if (mode === "video") return endpointParseVideo(j);
  if (mode === "audio") return endpointParseAudioJson(j);
  return endpointParseJsonMode(j);
}

function endpointUrlIsLocal(url) {
  try {
    const u = new URL(String(url || "").trim());
    const host = u.hostname;
    return endpointIsLoopbackHost(host) || endpointIsPrivateIPv4(host) || /\.local$/i.test(host);
  } catch { return false; }
}

function endpointFetchIsOpaque(e) {
  const m = ((e && e.message) || String(e)).trim();
  if (/^(TypeError: )?(Failed to fetch|Load failed|NetworkError)/i.test(m)) return true;
  return !!(e && e.name === "TypeError" && /fetch|network|cors/i.test(m));
}

function endpointFetchError(e, url) {
  if (!endpointFetchIsOpaque(e)) return (e && e.message) || String(e);
  if (!endpointUrlIsLocal(url)) return "blocked by CORS — your server needs Access-Control-Allow-Origin";
  return "blocked — CORS (Access-Control-Allow-Origin + OPTIONS) or Chrome local-network permission";
}

/**
 * POST the mode's body and parse the reply.
 * @param {{ fetch?: typeof fetch, signal?: AbortSignal }} [io]
 */
async function runEndpoint(n, inp, io = {}) {
  const target = endpointResolveTarget(n, inp || {});
  const url = target.url;
  const ok = endpointUrlOk(url);
  if (ok !== true) throw new NanoodleError(ok);
  const mode = target.mode;
  const body = endpointRequestBody(mode, n, inp || {});
  const headers = endpointHeaders(n.fields && n.fields.auth);
  const doFetch = io.fetch || globalThis.fetch;
  let r;
  try {
    const payload = JSON.stringify(body);
    throwIfAborted(io.signal);
    r = await doFetch(url, { method: "POST", headers, body: payload, signal: io.signal });
  } catch (e) {
    if (io.signal?.aborted || e?.name === "AbortError") throw e;
    throw new NanoodleError(endpointFetchError(e, url));
  }
  if (!r.ok) {
    let errBody = "";
    try { errBody = (await r.text()).slice(0, 800); } catch { /* ignore */ }
    throw new NanoodleError(endpointHttpError(r.status, errBody));
  }
  return endpointParseResponse(mode, r);
}

__x.ENDPOINT_DEF_URL = ENDPOINT_DEF_URL; __x.ENDPOINT_MODES = ENDPOINT_MODES; __x.endpointOutPort = endpointOutPort; __x.endpointUrlOk = endpointUrlOk; __x.endpointResolveTarget = endpointResolveTarget; __x.endpointRequestBody = endpointRequestBody; __x.runEndpoint = runEndpoint;
});
__def("prompt-caps.mjs", function (__x, __req) {
/**
 * Prompt length caps — the wired prompt nobody can shorten.
 *
 * Many image and video models reject an over-long prompt at NanoGPT's route, before the provider is
 * called and before anything is charged:
 *
 *     400 {"error":"Your prompt is too long for Qwen Image 3. Please shorten it to 800 characters
 *          or less (current: 831 characters).","code":"prompt_too_long"}
 *
 * Free, but a dead end. In a graph the prompt is generated, not typed — an LLM node writes it and a
 * wire carries it into the image node — so "please shorten it" names something no caller controls
 * directly. For a headless or agent-driven run that's the whole workflow lost to a limit nobody was
 * told about.
 *
 * So: trim it to fit at a sentence boundary (fitPromptText) and REPORT it — a `prompt-trimmed`
 * progress event plus a process warning. A silent trim would be a bug; the report is what makes the
 * trim defensible. A cap we didn't know is learned from the live 400 (promptCapFromError) and kept
 * on the Workflow, so a retry states the limit instead of rediscovering it.
 *
 * What this deliberately does NOT do is edit the graph's own prompts to avoid the trim. An llm
 * node's system prompt goes to the model exactly as its author wrote it — injecting a "keep it
 * under N characters" directive on their behalf would silently change what their workflow produces.
 *
 * The image/video catalogs advertise no prompt limit at all (checked live 2026-07-26), hence the
 * probed table below. Audio's caps ARE catalog metadata (supported_parameters.max_chars) and are
 * read from the opt-in catalog instead — never listed here. Absent id = no cap found, or never
 * probed: unknown stays unconstrained, matching this library's permissive-gate rule everywhere else.
 *
 * Table generated by nanoodle's scripts/probe-prompt-caps.mjs; keep it in step with the copies in
 * nanoodle's index.html / play.html.
 */
const { catItem } = __req("catalog.mjs");

const PROMPT_CAPS = {
  generated: "2026-07-26",
  image: {
    "step-image-edit-2": 512,
    "qwen-image-3": 800,
    "z-image-turbo": 1200,
    "z-image-turbo-image-to-image": 1200,
    "z-image-turbo-lora": 1200,
    "2dn-pony-v2": 3000,
    "aniflatmix-anime": 3000,
    "aniflatmix-anime-sfwnsfw": 3000,
    "animagine-xl-31": 3000,
    "artiwaifu-diffusion": 3000,
    "atomix-xl": 3000,
    "boltning": 3000,
    "crystal-clear-xl": 3000,
    "crystal-clear-xlightning": 3000,
    "cyberrealistic-pony-v9": 3000,
    "cyberrealistic-xl": 3000,
    "dreamshaper-v1": 3000,
    "dreamshaper-xl": 3000,
    "fluently-xl": 3000,
    "flux-schnell": 3000,
    "hassaku-hentai": 3000,
    "hidream": 3000,
    "hidream-i1-fast": 3000,
    "ideogram:4@0": 3000,
    "infinite-illustrious": 3000,
    "juggernaut-lightning-flux": 3000,
    "juggernaut-pro-flux": 3000,
    "juggernaut-z": 3000,
    "miusmius-xl": 3000,
    "nsfw-gen-illustrious": 3000,
    "persona:376130@2456367": 3000,
    "pixelwave": 3000,
    "proteus": 3000,
    "prunaai:1@1": 3000,
    "qwen-image": 3000,
    "realpony-xl": 3000,
    "rev-animated": 3000,
    "riverflow-2-fast": 3000,
    "riverflow-2-max": 3000,
    "riverflow-2-standard": 3000,
    "runware:106@1": 3000,
    "runware:107@1": 3000,
    "stable-diffusion-xl-turbo": 3000,
    "stoiqo-new-reality": 3000,
    "wai-illustrious-sdxl": 3000,
  },
  video: {
    "minimax-hailuo-02": 2000,
    "lightricks-ltx-2-fast": 3000,
  },
};

// node type → which catalog its model comes from. Same split as estimate.mjs's PRICE_KIND, minus
// the types that take no prompt (transcribe) — chat is present so promptCap can say "no" for it:
// an LLM's own limit is tokens, and it is never the node being fitted.
const CAP_KIND = {
  llm: "chat", vision: "chat",
  image: "image", edit: "image", inpaint: "image",
  tvideo: "video", ivideo: "video", vedit: "video", lipsync: "video",
  music: "audio", remix: "audio", tts: "audio",
};

/**
 * The prompt character cap for a node, or null when the model has none / we don't know one.
 * `learned` (a Map of "kind:id" → cap) wins over the table: it came from this account hitting this
 * model today, and the table is a snapshot.
 */
function promptCap(node, { catalog, learned } = {}) {
  const kind = CAP_KIND[node && node.type];
  const id = node && node.fields && node.fields.model;
  if (!kind || !id || kind === "chat") return null;
  const hit = learned && learned.get(kind + ":" + id);
  if (hit) return hit;
  if (kind === "audio") {
    const m = catItem(catalog, "audio", id);
    return (m && m.supported_parameters && m.supported_parameters.max_chars) || null;
  }
  return (PROMPT_CAPS[kind] && PROMPT_CAPS[kind][id]) || null;
}

/**
 * Cut to the last sentence end inside the cap, then the last word — never mid-word, and never below
 * 70% of the cap, where honouring a boundary would throw away more than the overflow did.
 */
function fitPromptText(s, cap) {
  if (s.length <= cap) return s;
  const head = s.slice(0, cap), floor = Math.floor(cap * 0.7);
  const sent = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "), head.lastIndexOf("\n"));
  if (sent >= floor) return head.slice(0, sent + 1).trim();
  const word = head.lastIndexOf(" ");
  return (word >= floor ? head.slice(0, word) : head).trim();
}

/**
 * Fit the prompt rather than lose the run to a 400 the caller can't act on. Returns
 * { fields, trimmed } — `trimmed` is non-null exactly when the caller owes the user an explanation,
 * and reporting it is not optional.
 */
function withFittedPrompt(node, fields, opts = {}) {
  const cap = promptCap({ ...node, fields }, opts);
  const p = fields && fields.prompt;
  if (!cap || typeof p !== "string" || p.length <= cap) return { fields, trimmed: null };
  const prompt = fitPromptText(p, cap);
  return { fields: { ...fields, prompt }, trimmed: { from: p.length, to: prompt.length, cap } };
}

/**
 * NanoGPT phrases the rejection three ways (all live-verified 2026-07-26):
 *   {"error":"…Please shorten it to 800 characters or less (current: 831 characters).","code":"prompt_too_long"}
 *   {"error":{"message":"…512 characters or less…","code":"prompt_too_long"}}   ← nested
 *   {"error":"Prompt is too long. Please keep it under 3000 characters."}        ← no code at all
 * so match the sentence, not the envelope. "current: N" is deliberately unmatched — that's the
 * length we SENT, and learning it as the cap would grow the limit with every failure.
 */
const PROMPT_TOO_LONG_RE = /(?:shorten (?:it )?to|keep it under|at most|maximum of|limit of)\s*([\d,]{2,})\s*characters/i;

const isPromptTooLong = (msg) => /prompt_too_long/i.test(String(msg || "")) || /prompt is too long/i.test(String(msg || ""));

function promptCapFromError(msg) {
  const m = PROMPT_TOO_LONG_RE.exec(String(msg || ""));
  const v = m ? +m[1].replace(/,/g, "") : 0;
  return v > 0 ? v : null;
}

/** Bank a cap learned from a live rejection. Returns true when it's new information. */
function learnPromptCap(learned, node, msg) {
  const cap = promptCapFromError(msg);
  const kind = CAP_KIND[node && node.type];
  const id = node && node.fields && node.fields.model;
  if (!cap || !kind || !id || learned.get(kind + ":" + id) === cap) return false;
  learned.set(kind + ":" + id, cap);
  return true;
}

__x.PROMPT_CAPS = PROMPT_CAPS; __x.promptCap = promptCap; __x.fitPromptText = fitPromptText; __x.withFittedPrompt = withFittedPrompt; __x.isPromptTooLong = isPromptTooLong; __x.promptCapFromError = promptCapFromError; __x.learnPromptCap = learnPromptCap;
});
__def("image-options.mjs", function (__x, __req) {
// Model knobs may tune generation, but cannot replace node-owned request fields
// or smuggle routing/authentication settings into an image request.
function imageModelOpts(opts) {
  const out = {};
  if (!opts || typeof opts !== "object" || Array.isArray(opts)) return out;
  for (const [key, value] of Object.entries(opts)) {
    if (/^(?:model|prompt|size|n|responseformat|image|images|imageurl|imagedataurl|mask|maskurl|maskdataurl|key|apikey|xapikey|token|accesstoken|authorization|auth|headers|url|endpoint|baseurl|method|body|credentials|proxy|runid|requestid|isapirequest|paymentsource|paymentid|tojson|proto|prototype|constructor)$/i.test(key.replace(/[_-]/g, ""))) continue;
    out[key] = value;
  }
  return out;
}

__x.imageModelOpts = imageModelOpts;
});
__def("io-specs.mjs", function (__x, __req) {
/** Which node types contribute user inputs, and with what fields (mirrors play.html INPUT_SPECS). */
const INPUT_SPECS = {
  text:    [{ f: "text",   label: "Text",  kind: "textarea" }],
  upload:  [{ f: "image",  label: "Image", kind: "image" }],
  aupload: [{ f: "audio",  label: "Audio", kind: "audio" }],
  vupload: [{ f: "video",  label: "Video", kind: "video" }],
  mupload: [{ f: "model",  label: "3D file", kind: "model3d" }],
  llm:     [{ f: "prompt", label: "Prompt", kind: "textarea" },
            { f: "system", label: "System prompt", kind: "textarea", optional: true, def: "You are a helpful, concise assistant." }],
  image:   [{ f: "prompt", label: "Image prompt", kind: "textarea" }],
  tvideo:  [{ f: "prompt", label: "Video prompt", kind: "textarea" }],
  music:   [{ f: "prompt", label: "Style / prompt", kind: "textarea" }],
  remix:   [{ f: "prompt", label: "Style / direction", kind: "textarea" }],
  tts:     [{ f: "prompt", label: "Text to speak", kind: "textarea" }],
  // Optional: image-only 3D models run with a photo and no prompt.
  model3d: [{ f: "prompt", label: "3D prompt", kind: "textarea", optional: true }],
  endpoint:[{ f: "prompt", label: "Prompt", kind: "textarea" }],
};

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
  decide: [
    { f: "model", label: "Model", kind: "model" },
    { f: "mode", label: "Decide", kind: "select", options: ["pick", "choose", "score", "yesno"], def: "pick" },
    { f: "question", label: "Question", kind: "textarea" },
    { f: "options", label: "Labels (one per line)", kind: "textarea" },
    { f: "levels", label: "Scale (worst → best, one per line)", kind: "textarea", def: "poor\nokay\ngood\ngreat" },
    { f: "gate", label: "Gate: stop downstream on no", kind: "boolean" },
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
  cleanvoice: [
    { f: "model", label: "Model", kind: "model" },
    { f: "url", label: "Public link (when nothing is wired)", kind: "text" },
  ],
  model3d: [
    { f: "model", label: "Model", kind: "model" },
  ],
  endpoint: [
    { f: "url", label: "URL", kind: "text", def: "http://127.0.0.1:8787/v1/chat/completions" },
    { f: "mode", label: "Mode", kind: "select", options: ["chat", "image", "video", "audio", "json"], def: "chat" },
    { f: "model", label: "Model", kind: "text", def: "local" },
    { f: "auth", label: "Authorization (optional)", kind: "text", def: "" },
  ],
  join: [{ f: "sep", label: "Separator (use \\n for a line break)", kind: "text", def: " " }],
  inpaint: [
    { f: "model", label: "Model", kind: "model" },
    { f: "size", label: "Image size", kind: "select", options: SIZES, def: "1024x1024" },
    { f: "seed", label: "Seed", kind: "number" },
  ],
  // local media knobs (play.html SETTING_SPECS) — shape-affecting fields for vframes/combine
  "slice-3d": [
    { f: "preset", label: "Preset", kind: "select", options: ["default", "character"], def: "default" },
    { f: "clip", label: "Animation clip", kind: "text", def: "" },
    { f: "frames", label: "Pose frames", kind: "number", min: 1, max: 64, def: "1" },
    { f: "slices", label: "Slices", kind: "number", min: 8, max: 128, def: "48" },
    { f: "resolution", label: "Tile resolution", kind: "number", min: 16, max: 128, def: "48" },
    { f: "palette", label: "Palette colors", kind: "number", min: 0, max: 64, def: "16" },
    { f: "outline", label: "Outline", kind: "boolean", def: true },
    { f: "upAxis", label: "Up axis", kind: "select", options: ["auto", "x", "y", "z"], def: "auto" },
  ],
  "sprite-stack-render": [
    { f: "yaw", label: "Yaw (degrees)", kind: "number", def: "35" },
    { f: "pitch", label: "Pitch (degrees)", kind: "number", min: 0, max: 90, def: "30" },
    { f: "spacing", label: "Layer spacing", kind: "number", min: 0, max: 4, def: "1" },
    { f: "scale", label: "Pixel scale", kind: "number", min: 1, max: 8, def: "3" },
    { f: "turntable", label: "Record turntable", kind: "boolean", def: false },
    { f: "duration", label: "Duration (s)", kind: "number", min: 0.25, max: 30, def: "3" },
    { f: "fps", label: "Frames per second", kind: "number", min: 1, max: 60, def: "24" },
    { f: "yawStart", label: "Start yaw", kind: "number", def: "0" },
    { f: "yawEnd", label: "End yaw", kind: "number", def: "360" },
  ],
  resize: [
    { f: "mode", label: "Mode", kind: "select", options: ["fit", "fill", "exact"], def: "fit" },
    { f: "width", label: "Width", kind: "number" },
    { f: "height", label: "Height", kind: "number" },
  ],
  vframes: [
    { f: "dir", label: "Start from", kind: "select", options: ["end", "start"], def: "end" },
    { f: "frames", label: "Frames", kind: "number", def: "1", min: 1, max: 48 },
    { f: "gap", label: "Gap (s)", kind: "number", def: "0.5" },
    { f: "stride", label: "Stride (every Nth frame)", kind: "number", def: "1", min: 1 },
    { f: "startSec", label: "Range start (s)", kind: "number" },
    { f: "endSec", label: "Range end (s)", kind: "number" },
  ],
  render3d: [
    { f: "mode", label: "Output", kind: "select", options: ["image", "video"], def: "image" },
    { f: "azimuth", label: "Azimuth (deg)", kind: "number", def: "35" },
    { f: "elevation", label: "Elevation (deg)", kind: "number", def: "18" },
    { f: "distance", label: "Distance (× size)", kind: "number", def: "1.9" },
    { f: "width", label: "Width", kind: "number", def: "800" },
    { f: "height", label: "Height", kind: "number", def: "600" },
    { f: "background", label: "Background", kind: "select", options: ["dark", "light", "transparent"], def: "dark" },
    { f: "clipAxis", label: "Slice axis", kind: "select", options: ["none", "x", "y", "z"], def: "none" },
    { f: "clipPos", label: "Slice position (-1..1)", kind: "number", def: "0" },
    { f: "clipSweep", label: "Video: sweep the slice", kind: "boolean" },
    { f: "explode", label: "Explode parts (0..1)", kind: "number", def: "0" },
    { f: "isolate", label: "Isolate part (index, name, or largest)", kind: "text" },
    { f: "animClip", label: "Animation clip (name or index)", kind: "text" },
    { f: "animTime", label: "Animation time (s)", kind: "number", def: "0" },
    { f: "turntable", label: "Video: turntable (deg)", kind: "number", def: "360" },
    { f: "duration", label: "Video: duration (s)", kind: "number", def: "2" },
    { f: "fps", label: "Video: fps", kind: "number", def: "24" },
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

__x.INPUT_SPECS = INPUT_SPECS; __x.SETTING_SPECS = SETTING_SPECS;
});
__def("sprite-stack.mjs", function (__x, __req) {
const { number, viewPlan, softwareView, flag, turntablePlan } = __req("sprite-projection.mjs");
const { encodePngRgba } = __req("local-media.mjs");
const { encodeSpriteMp4 } = __req("sprite-video.mjs");
const { MediaRef, bytesToDataUrl } = __req("media.mjs");
const { gaussianModel, trianglePoses } = __req("sprite-model.mjs");
const { CHARACTER_SLICE_DEFAULTS, expandModelBounds, slicePixels } = __req("sprite-slices.mjs");
const { readStackApng, writeStackApng } = __req("sprite-sequence.mjs");
const { decodePngPixels } = __req("png-decoder.mjs");

function canvas(width, height) {
  if (typeof document === "undefined") throw new Error("Sprite stacking requires a browser with Canvas 2D.");
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  return el;
}
async function bitmap(blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const url = URL.createObjectURL(blob),
    img = new Image();
  try {
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function imagePixels(blob) {
  const img = await bitmap(blob);
  try {
    const ctx = canvas(img.width, img.height).getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);
  } finally {
    img.close?.();
  }
}
async function readMedia(value, ctx) {
  const media = new MediaRef(String(value), { fetch: ctx?.fetch });
  return media.bytes({ signal: ctx?.signal });
}
function png(el) {
  const result = el.toDataURL("image/png");
  if (!result.startsWith("data:image/png")) throw new Error("The atlas exceeds this browser’s canvas limit.");
  return result;
}

function stackView(sheet, fields) {
  const { tile, layers, scale, rise, squash, w, h } = viewPlan(sheet, fields);
  const el = canvas(w, h),
    ctx = el.getContext("2d", { willReadFrequently: flag(fields.turntable, false) });
  function draw(yaw) {
    ctx.resetTransform();
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    const a = (yaw * Math.PI) / 180,
      c = Math.cos(a) * scale,
      s = Math.sin(a) * scale;
    for (let l = 0; l < layers; l++) {
      ctx.setTransform(c, s * squash, -s, c * squash, w / 2, h / 2 + ((layers - 1) / 2 - l) * rise * scale);
      ctx.drawImage(sheet, l * tile, 0, tile, tile, -tile / 2, -tile / 2, tile, tile);
    }
    ctx.resetTransform();
  }
  return { el, ctx, draw };
}

async function frameUrl(frame) {
  return bytesToDataUrl(await encodePngRgba(frame.width, frame.height, frame.data), "image/png");
}

// Long clips can spend several frames entirely in synchronous pixel code.
function frameCheckpoint(signal) {
  let lastYield = performance.now();
  return async () => {
    if (performance.now() - lastYield >= 16) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastYield = performance.now();
    }
    signal?.throwIfAborted();
  };
}

async function encodeViews(count, duration, drawFrame, signal) {
  const check = frameCheckpoint(signal);
  async function* frames() {
    for (let i = 0; i < count; i++) {
      await check();
      yield drawFrame(i);
    }
  }
  return bytesToDataUrl(await encodeSpriteMp4(frames(), duration), "video/mp4");
}

function encodeTurntable(draw, fields, signal) {
  const { duration, from, to, count } = turntablePlan(fields);
  return encodeViews(count, duration, (i) => draw(from + ((to - from) * i) / (count - 1)), signal);
}

async function slice3d(node, inp, ctx) {
  if (!inp.model) throw new Error("Wire a 3D model into Slice 3D.");
  const fields = node.fields || {};
  const defaults = fields.preset === "character" ? CHARACTER_SLICE_DEFAULTS : {};
  const size = number(fields, "resolution", defaults.resolution ?? 48, 16, 128, true);
  const layers = number(fields, "slices", defaults.slices ?? 48, 8, 128, true);
  const palette = number(fields, "palette", defaults.palette ?? 16, 0, 64, true);
  const frames = number(fields, "frames", 1, 1, 64, true);
  const clip = fields.clip ?? "";
  const headless = typeof document === "undefined";
  const pixels = headless
    ? (await import("./sprite-image.mjs")).decodeSpriteBytes
    : (raw, mime) => imagePixels(new Blob([raw], { type: mime }));
  const bytes = await readMedia(inp.model, ctx);
  let poses;
  if (bytes[0] === 112 && bytes[1] === 108 && bytes[2] === 121) {
    if (frames > 1 || clip)
      throw new Error("Gaussian PLY has no animation clips. Clear clip and set frames to 1 for a static sheet.");
    const model = gaussianModel(bytes);
    poses = { pose: () => model };
  } else {
    poses = await trianglePoses(bytes, pixels, { clip, frames });
  }
  const check = frameCheckpoint(ctx?.signal);
  const firstModel = poses.pose(0);
  const bounds = expandModelBounds(firstModel);
  for (let i = 1; i < frames; i++) {
    await check();
    expandModelBounds(poses.pose(i), bounds);
  }
  const supplied = palette && inp.paletteImage ? await pixels(await readMedia(inp.paletteImage, ctx)) : null;
  const options = { size, layers, axis: fields.upAxis || "auto", outline: flag(fields.outline, true), palette };
  await check();
  const first = slicePixels(firstModel, options, supplied, bounds);
  const sheet = { width: first.width, height: first.height, data: first.rgba };
  if (frames > 1) {
    async function* pngFrames() {
      yield encodePngRgba(first.width, first.height, first.rgba);
      for (let i = 1; i < frames; i++) {
        await check();
        const frame = slicePixels(poses.pose(i), options, supplied, bounds);
        yield encodePngRgba(frame.width, frame.height, frame.rgba);
      }
    }
    const animation = poses.animation;
    const encoded = await writeStackApng(frames, animation.duration / frames, pngFrames());
    return {
      sheet: bytesToDataUrl(encoded, "image/png"),
      image: await frameUrl(softwareView(sheet, {})(35)),
      layout: JSON.stringify({ ...first.layout, animation }),
    };
  }
  if (headless) {
    return {
      sheet: await frameUrl(sheet),
      layout: JSON.stringify(first.layout),
      image: await frameUrl(softwareView(sheet, {})(35)),
    };
  }
  const el = canvas(size * layers, size);
  el.getContext("2d").putImageData(new ImageData(first.rgba, first.width, first.height), 0, 0);
  const view = stackView(el, {});
  view.draw(35);
  return { sheet: png(el), layout: JSON.stringify(first.layout), image: png(view.el) };
}

// Keep only the current decoded atlas. Long gait loops can reuse one pose for
// several output frames, or skip poses when the turntable fps is lower.
async function renderSequence(sequence, fields, yaw, signal) {
  let previous = -1, draw;
  async function pose(index, angle) {
    if (previous !== index) {
      const { w, h, rgba } = await decodePngPixels(sequence.png(index), { maxDim: 128, allowSpriteStrip: true });
      draw = softwareView({ width: w, height: h, data: rgba }, fields);
      previous = index;
    }
    return draw(angle);
  }
  const first = await pose(0, yaw);
  const image = await frameUrl(first);
  if (!flag(fields.turntable, false)) {
    const video = await encodeViews(sequence.length, sequence.duration, i => i === 0 ? first : pose(i, yaw), signal);
    return { image, video };
  }
  const { duration, from, to, count } = turntablePlan(fields);
  const video = await encodeViews(count, duration, i => {
    const time = i * duration / count;
    const index = Math.floor(time * sequence.length / sequence.duration) % sequence.length;
    return pose(index, from + (to - from) * i / (count - 1));
  }, signal);
  return { image, video };
}

async function renderSpriteStack(node, inp, ctx) {
  if (!inp.sheet) throw new Error("Wire the Slice 3D sheet into Sprite stack render.");
  const fields = node.fields || {},
    bytes = await readMedia(inp.sheet, ctx);
  const yaw = number(fields, "yaw", 35, -3600, 3600);
  const sequence = readStackApng(bytes);
  if (sequence) return renderSequence(sequence, fields, yaw, ctx?.signal);
  if (typeof document === "undefined") {
    const { decodeSpriteBytes } = await import("./sprite-image.mjs");
    const sheet = await decodeSpriteBytes(bytes);
    const draw = softwareView(sheet, fields);
    const image = await frameUrl(draw(yaw));
    if (!flag(fields.turntable, false)) return { image };
    return { image, video: await encodeTurntable(draw, fields, ctx?.signal) };
  }
  const sheet = await bitmap(new Blob([bytes]));
  try {
    const view = stackView(sheet, fields);
    view.draw(yaw);
    const image = png(view.el);
    if (!flag(fields.turntable, false)) return { image };
    const draw = (angle) => {
      view.draw(angle);
      return view.ctx.getImageData(0, 0, view.el.width, view.el.height);
    };
    return { image, video: await encodeTurntable(draw, fields, ctx?.signal) };
  } finally {
    sheet.close?.();
  }
}

__x.slice3d = slice3d; __x.renderSpriteStack = renderSpriteStack;
});
__def("decide.mjs", function (__x, __req) {
// ⚖️ Decide — typed judgments from NanoGPT decision models (POST /api/v1/decisions).
// Port of the editor/play twin block (nanoodle index.html / play.html "⚖️ DECIDE"): same
// question shapes, same image state parts, same in-order + reversed pick debias, same
// outputs. Only the on-device image shrink differs: browsers use canvas, this library
// uses ffmpeg (fitImageJpeg) — text-only decisions need no ffmpeg at all.
const { NanoodleError } = __req("errors.mjs");

const DECIDE_DEFAULT_MODEL = "perplexity/pplx-decider-v1.2";
const DECIDE_SCALE_DEFAULT = "poor\nokay\ngood\ngreat";
/** The live limits of every image-capable decision model at launch (catalog decision_input.image_limits). */
const DECIDE_IMG_FALLBACK = { maxImages: 4, maxDimension: 512, maxEncodedBytes: 240000 };

function decideMode(f) {
  if (f?.branch === true) return "yesno";
  const m = f && f.mode;
  return (m === "choose" || m === "score" || m === "yesno") ? m : "pick";
}
function decideLines(s) {
  return String(s == null ? "" : s).split("\n").map((x) => x.trim()).filter(Boolean);
}
function decideDefaultQuestion(mode) {
  if (mode === "pick") return "Which image best matches the brief?";
  if (mode === "choose") return "Which label fits best?";
  if (mode === "score") return "How good is it?";
  return "Is it good enough to use?";
}
/** Image limits from a catalog decision_input; known=false (absent / offline) → permissive launch limits; known text-only → null. */
function decideImageLimits(di, known) {
  if (!known) return DECIDE_IMG_FALLBACK;
  if (!di || !di.image_input) return null;
  const l = di.image_limits || {};
  return {
    maxImages: l.maxImages > 0 ? l.maxImages : DECIDE_IMG_FALLBACK.maxImages,
    maxDimension: l.maxDimension > 0 ? l.maxDimension : DECIDE_IMG_FALLBACK.maxDimension,
    maxEncodedBytes: l.maxEncodedBytes > 0 ? l.maxEncodedBytes : DECIDE_IMG_FALLBACK.maxEncodedBytes,
  };
}
/** The one typed question this node asks. Throws (before any request) on an unanswerable setup. */
function decideQuestionFor(mode, f, nImgs) {
  const q = String((f && f.question) || "").trim() || decideDefaultQuestion(mode);
  if (mode === "pick") {
    if (nImgs < 2) throw new NanoodleError("pick needs at least two images — wire 2 or more into the image ports");
    const c = {};
    for (let i = 1; i <= nImgs; i++) c["image_" + i] = "image " + i;
    return { type: "choice", instructions: q, criteria: c };
  }
  if (mode === "choose") {
    const labels = decideLines(f && f.options).filter((x, i, a) => a.indexOf(x) === i);
    if (labels.length < 2) throw new NanoodleError("add at least two labels to choose from (one per line)");
    if (labels.length > 255) throw new NanoodleError("too many labels — 255 at most");
    const cc = {};
    labels.forEach((x) => { cc[x] = null; });
    return { type: "choice", instructions: q, criteria: cc };
  }
  if (mode === "score") {
    const lv = decideLines((f && f.levels != null && String(f.levels).trim()) ? f.levels : DECIDE_SCALE_DEFAULT);
    if (lv.length < 2 || lv.length > 10) throw new NanoodleError("the scale needs 2 to 10 levels, worst first (one per line)");
    return { type: "score", instructions: q, criteria: lv };
  }
  return { type: "noul", instructions: q };
}
/** state: plain text, or (with images) text + labelled inline image_url parts. */
function decideState(text, imgs) {
  if (!imgs.length) return text;
  const s = [];
  if (text) s.push(text);
  imgs.forEach((u, i) => {
    if (imgs.length > 1) s.push("image_" + (i + 1) + ":");
    s.push({ type: "image_url", image_url: { url: u } });
  });
  return s;
}
/** API answer → node outputs: text, image (pick: the winner; else the first image, passed through), decision detail. */
function decideOutputs(mode, ans, q, imgs, usage, model) {
  if (!ans || !ans.type) throw new NanoodleError("the decision model returned no answer");
  const d = { mode, model, cost: (usage && typeof usage.cost === "number") ? usage.cost : null, rows: [] };
  const probs = ans.probabilities || {};
  if (mode === "pick") {
    const k = String(ans.choice || ""), idx = parseInt(k.replace(/^image_/, ""), 10) || 1;
    d.pick = idx; d.confidence = ans.confidence;
    d.rows = Object.keys(q.criteria).map((key, i) => ({ label: "image " + (i + 1), p: +probs[key] || 0, win: key === k }));
    return { text: "image " + idx, image: imgs[idx - 1] || "", decision: d };
  }
  if (mode === "choose") {
    d.confidence = ans.confidence;
    d.rows = Object.keys(q.criteria).map((key) => ({ label: key, p: +probs[key] || 0, win: key === ans.choice }));
    return { text: String(ans.choice || ""), image: imgs[0] || "", decision: d };
  }
  if (mode === "score") {
    const sc = (+ans.score || 0) + 1; // 1 = the first (worst) level
    d.score = sc; d.levels = q.criteria.length; d.confidence = ans.confidence;
    let top = 0;
    q.criteria.forEach((x, i) => { if ((+probs[String(i)] || 0) > (+probs[String(top)] || 0)) top = i; });
    d.rows = q.criteria.map((x, i) => ({ label: (i + 1) + " · " + x, p: +probs[String(i)] || 0, win: i === top }));
    return { text: String(Math.round(sc * 100) / 100), image: imgs[0] || "", decision: d };
  }
  const py = Math.max(0, Math.min(1, +ans.noul || 0));
  d.yes = py;
  d.rows = [{ label: "yes", p: py, win: py >= 0.5 }, { label: "no", p: 1 - py, win: py < 0.5 }];
  return { text: py >= 0.5 ? "yes" : "no", image: imgs[0] || "", decision: d };
}
/**
 * A closed yes/no gate: a deliberate stop, not a failure. The runner throws this (so the browser
 * twin and any direct RUNNERS caller see err.gate), and Workflow.run() settles it as node status
 * "gated" — the decision ran and billed, `out` carries its answer, everything downstream is
 * "skipped" unbilled, and the run itself succeeds.
 */
function decideGateError(d, out) {
  return new NanoodleError(
    "gate closed — the answer was no (yes " + Math.round(d.yes * 100) + "%), so nothing downstream ran",
    { code: "decide-gate", gate: true, decision: d, out: out || null });
}
/** Average pick probabilities across runs that saw the candidates in different orders; costs add up. */
function decideMergeOrders(js, orders) {
  const n = orders[0].length, sum = new Array(n).fill(0);
  let cost = 0, costKnown = true;
  js.forEach((j, r) => {
    const a = j && j.answers && j.answers.answer;
    if (!a || !a.probabilities) throw new NanoodleError("the decision model returned no answer");
    orders[r].forEach((orig, k) => { sum[orig] += (+a.probabilities["image_" + (k + 1)] || 0) / js.length; });
    if (j.usage && typeof j.usage.cost === "number") cost += j.usage.cost; else costKnown = false;
  });
  let best = 0;
  const probs = {};
  sum.forEach((p, i) => { probs["image_" + (i + 1)] = p; if (p > sum[best]) best = i; });
  return {
    answers: { answer: { type: "choice", choice: "image_" + (best + 1), confidence: sum[best], probabilities: probs } },
    usage: { cost: costKnown ? cost : null }, runs: js.length,
  };
}
/**
 * The whole run. send(body) POSTs /api/v1/decisions and returns the JSON; fit(url, maxDim, budget)
 * returns a data: URL that fits (inlining remote URLs as needed).
 */
async function decideRun(f, model, text, imgs, lim, send, fit) {
  const mode = decideMode(f);
  text = String(text == null ? "" : text).trim();
  imgs = (imgs || []).filter(Boolean);
  if (imgs.length && !lim) throw new NanoodleError("this decision model can’t see images — pick one that can (e.g. PPLX Decider or Clef)");
  if (lim && imgs.length > lim.maxImages) throw new NanoodleError("this decision model takes at most " + lim.maxImages + " images — unwire the extras");
  const q = decideQuestionFor(mode, f, imgs.length);
  if (!text && !imgs.length && !String((f && f.question) || "").trim()) throw new NanoodleError("nothing to judge — wire text or an image into Decide");
  const sent = [];
  if (imgs.length) {
    const budget = Math.floor(lim.maxEncodedBytes * 0.95 / imgs.length);
    for (const u of imgs) sent.push(await fit(u, lim.maxDimension, budget));
  }
  let j;
  if (mode === "pick") {
    // decision models lean toward the first image they see: ask in order and reversed, average
    const fwd = sent.map((x, i) => i), rev = fwd.slice().reverse();
    const both = await Promise.all([fwd, rev].map((ord) =>
      send({ model, state: decideState(text, ord.map((i) => sent[i])), questions: { answer: q } })));
    j = decideMergeOrders(both, [fwd, rev]);
  } else {
    j = await send({ model, state: decideState(text, sent), questions: { answer: q } });
  }
  const answer = j?.answers?.answer;
  const branching = f?.branch === true;
  if (branching && (answer?.type !== "noul" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1)) {
    throw new NanoodleError("Decide needs a valid yes/no answer to select a branch", { code: "decide-branch" });
  }
  const out = decideOutputs(mode, answer, q, imgs, j && j.usage, model);
  if (branching) {
    out.decision.branch = out.text;
    out[out.text] = text || out.text;
    return out;
  }
  if (mode === "yesno" && (f.gate === true || f.gate === "true") && out.decision.yes < 0.5) throw decideGateError(out.decision, out);
  return out;
}

__x.DECIDE_DEFAULT_MODEL = DECIDE_DEFAULT_MODEL; __x.DECIDE_SCALE_DEFAULT = DECIDE_SCALE_DEFAULT; __x.DECIDE_IMG_FALLBACK = DECIDE_IMG_FALLBACK; __x.decideMode = decideMode; __x.decideLines = decideLines; __x.decideDefaultQuestion = decideDefaultQuestion; __x.decideImageLimits = decideImageLimits; __x.decideQuestionFor = decideQuestionFor; __x.decideState = decideState; __x.decideOutputs = decideOutputs; __x.decideGateError = decideGateError; __x.decideMergeOrders = decideMergeOrders; __x.decideRun = decideRun;
});
__def("cleanvoice.mjs", function (__x, __req) {
/**
 * 🎧 Clean voice — strip background noise / music, keep the voice.
 * Twin of the editor/play block (nanoodle #709). NanoGPT's noise_reduction
 * models (ElevenLabs Audio Isolation, VEED Clean Audio) ride
 * POST /api/v1/audio/speech with { model, audio:<public URL>, duration }
 * and answer 202 + runId (charged up front) → GET /api/tts/status → hosted audio.
 * The source MUST be a public http(s) URL: data: and blob: are refused before
 * any request. duration is only a quote; the server re-measures and bills that.
 */
const { NanoodleError } = __req("errors.mjs");

const CLEANVOICE_DEFAULT_MODEL = "elevenlabs/audio-isolation"; // $0.121/min
const CLEANVOICE_FALLBACK_SECS = 60; // length unknown → quote a minute
const CLEANVOICE_VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi)(\?|#|$)/i;

/** Which file to clean: a wired audio clip, else a wired video, else the pasted link. */
function cleanVoiceSource(inp, f) {
  const a = inp && typeof inp.audio === "string" ? inp.audio.trim() : "";
  const v = inp && typeof inp.video === "string" ? inp.video.trim() : "";
  const link = String((f && f.url) || "").trim();
  const url = a || v || link;
  const video = a ? false : (v ? true : CLEANVOICE_VIDEO_EXT.test(link));
  if (!url) throw new NanoodleError("no audio — wire audio or a video in, or paste a public link to the recording");
  if (!/^https?:\/\//i.test(url)) {
    throw new NanoodleError(
      "Clean voice needs a hosted file — NanoGPT downloads it from a public link, and a clip uploaded or made in your browser has none. Wire a generated video or track, or paste a public https link to the recording.");
  }
  return { url, video };
}

/** Duration quote NanoGPT requires (0.6–3600 s); unknown → CLEANVOICE_FALLBACK_SECS. */
function cleanVoiceSeconds(secs) {
  const s = +secs;
  if (!isFinite(s) || s <= 0) return CLEANVOICE_FALLBACK_SECS;
  return Math.min(3600, Math.max(0.6, Math.round(s * 100) / 100));
}

function cleanVoiceExtra(url, secs) {
  return { audio: url, duration: cleanVoiceSeconds(secs) };
}

/** Seconds the cost forecast assumes: the wired source node's duration knob, else 30 s. */
function cleanVoiceEstSeconds(srcFields) {
  const d = parseFloat(srcFields && srcFields.duration);
  return (isFinite(d) && d > 0) ? d : 30;
}

/** NanoGPT's 400s, reworded into the fix. Unrelated errors (and aborts) pass through. */
function cleanVoiceError(e) {
  if (e && (e.name === "AbortError" || e.code === "aborted")) return e;
  const m = String((e && e.message) || e || "");
  if (/verify the source (audio )?duration/i.test(m)) {
    return new NanoodleError("NanoGPT couldn't read this file's length — use MP3, WAV, M4A/AAC or MP4 (OGG isn't accepted).");
  }
  if (/unable to download/i.test(m)) {
    return new NanoodleError("NanoGPT couldn't download the file — the link must be public (no sign-in, not expired).");
  }
  if (/public http\(?s?\)? source/i.test(m)) {
    return new NanoodleError("Clean voice needs a public https link — clips uploaded in the browser can't reach it.");
  }
  return e;
}

/**
 * The source's length from media metadata. Browsers can read it without CORS;
 * Node has no media element, so this resolves null and the quote falls back to
 * CLEANVOICE_FALLBACK_SECS (the server re-measures before billing).
 */
function cleanVoiceMediaSeconds(url, isVideo) {
  return new Promise((res) => {
    const doc = globalThis.document;
    if (!doc || typeof doc.createElement !== "function") { res(null); return; }
    let el = null;
    let done = false;
    const fin = (v) => {
      if (done) return;
      done = true;
      try { el.removeAttribute("src"); el.load(); } catch { /* element may already be gone */ }
      res(v);
    };
    try { el = doc.createElement(isVideo ? "video" : "audio"); }
    catch { res(null); return; }
    el.preload = "metadata";
    el.muted = true;
    el.onloadedmetadata = () => {
      const d = el.duration;
      fin(isFinite(d) && d > 0 ? d : null);
    };
    el.onerror = () => fin(null);
    setTimeout(() => fin(null), 10000);
    el.src = url;
  });
}

/** send(model, extra) → audio URL (the runtime's audio submit + poll). */
async function cleanVoiceRun(model, inp, f, send) {
  const src = cleanVoiceSource(inp, f);
  const secs = await cleanVoiceMediaSeconds(src.url, src.video);
  try {
    return { audio: await send(model || CLEANVOICE_DEFAULT_MODEL, cleanVoiceExtra(src.url, secs)) };
  } catch (e) {
    throw cleanVoiceError(e);
  }
}

__x.CLEANVOICE_DEFAULT_MODEL = CLEANVOICE_DEFAULT_MODEL; __x.CLEANVOICE_FALLBACK_SECS = CLEANVOICE_FALLBACK_SECS; __x.cleanVoiceSource = cleanVoiceSource; __x.cleanVoiceSeconds = cleanVoiceSeconds; __x.cleanVoiceExtra = cleanVoiceExtra; __x.cleanVoiceEstSeconds = cleanVoiceEstSeconds; __x.cleanVoiceError = cleanVoiceError; __x.cleanVoiceMediaSeconds = cleanVoiceMediaSeconds; __x.cleanVoiceRun = cleanVoiceRun;
});
__def("sprite-slices.mjs", function (__x, __req) {
const CHARACTER_SLICE_DEFAULTS = { resolution: 128, slices: 80, palette: 0, outline: true };

// A clip uses one world-space grid across its poses so feet, scale and root
// motion stay aligned. Only the bounds need to be retained between poses.
function expandModelBounds(model, bounds = {
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
}) {
  const { min, max } = bounds;
  function grow(x, y, z) {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  }
  for (const m of model.meshes || []) {
    const p = m.positions;
    for (let i = 0; i < p.length; i += 3) grow(p[i], p[i + 1], p[i + 2]);
  }
  for (const s of model.splats || []) {
    const [x, y, z] = s.center,
      [a, b, c] = s.extent;
    grow(x - a, y - b, z - c);
    grow(x + a, y + b, z + c);
  }
  return bounds;
}

// Grid coordinates are (column, row, layer). Each square tile has the same
// world-to-pixel scale in both directions; layer thickness is recorded separately.
function gridFor({ min, max }, axis, size, layers) {
  const axes = { x: [1, 2, 0, -1], y: [0, 2, 1, 1], z: [0, 1, 2, -1] }[axis];
  if (!axes) throw new Error("Up axis must be auto, x, y or z.");
  const [u, v, h, sign] = axes;
  const span = Math.max(...min.map((n, i) => max[i] - n));
  if (!(span > 0) || !Number.isFinite(span)) throw new Error("Model bounds have no usable extent.");
  const unit = span / (size - 2),
    step = span / layers,
    cu = (max[u] + min[u]) / 2,
    cv = (max[v] + min[v]) / 2;
  return {
    size,
    layers,
    unit,
    step,
    axes,
    min,
    max,
    project(p) {
      return [(p[u] - cu) / unit + size / 2, (sign * (p[v] - cv)) / unit + size / 2, (p[h] - min[h]) / step];
    },
    world(x, y, l) {
      const p = [];
      p[u] = (x - size / 2) * unit + cu;
      p[v] = sign * (y - size / 2) * unit + cv;
      p[h] = min[h] + l * step;
      return p;
    },
  };
}

function wrap(t, mode) {
  if (mode === 33071) return Math.min(1, Math.max(0, t));
  if (mode === 33648) return 1 - Math.abs((((t % 2) + 2) % 2) - 1);
  return t - Math.floor(t);
}
function srgb(v) {
  return v < 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
function linear(v) {
  return v < 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function sample(mesh, ids, weights) {
  const color = mesh.factor.slice();
  function interpolate(attr, channel) {
    return weights.reduce((sum, w, j) => sum + w * attr.data[ids[j] * attr.n + channel], 0);
  }
  if (mesh.color) for (let k = 0; k < mesh.color.n; k++) color[k] *= interpolate(mesh.color, k);
  if (mesh.texture) {
    const { pixels, sampler } = mesh.texture;
    const x = Math.min(
      pixels.width - 1,
      Math.floor(wrap(interpolate(mesh.uv, 0), sampler.wrapS) * pixels.width),
    );
    const y = Math.min(
      pixels.height - 1,
      Math.floor(wrap(interpolate(mesh.uv, 1), sampler.wrapT) * pixels.height),
    );
    const p = (y * pixels.width + x) * 4;
    for (let k = 0; k < 3; k++) color[k] *= linear(pixels.data[p + k] / 255);
    color[3] *= pixels.data[p + 3] / 255;
  }
  const alpha =
    mesh.alphaMode === "OPAQUE" ? 1 : mesh.alphaMode === "MASK" ? Number(color[3] >= mesh.cutoff) : color[3];
  return [srgb(color[0]) * 255, srgb(color[1]) * 255, srgb(color[2]) * 255, alpha * 255];
}

// Scan a triangle in an axis-aligned projection at cell centers. The dominant
// projection catches vertical walls and flat caps. A floor projection also
// supplies signed ray intersections for filling closed interiors.
function scanTriangle(verts, a, b, width, height, visit) {
  const [p, q, r] = verts;
  const dx = q[a] - p[a],
    dy = q[b] - p[b],
    ex = r[a] - p[a],
    ey = r[b] - p[b];
  const det = dx * ey - dy * ex;
  if (Math.abs(det) < 1e-12) return;
  const startX = Math.max(0, Math.ceil(Math.min(p[a], q[a], r[a]) - 0.5));
  const startY = Math.max(0, Math.ceil(Math.min(p[b], q[b], r[b]) - 0.5));
  const endX = Math.min(width - 1, Math.floor(Math.max(p[a], q[a], r[a]) - 0.5));
  const endY = Math.min(height - 1, Math.floor(Math.max(p[b], q[b], r[b]) - 0.5));
  for (let y = startY; y <= endY; y++)
    for (let x = startX; x <= endX; x++) {
      const px = x + 0.5 - p[a],
        py = y + 0.5 - p[b];
      const v = (px * ey - py * ex) / det,
        w = (dx * py - dy * px) / det,
        u = 1 - v - w;
      if (Math.min(u, v, w) >= -1e-8) visit(x, y, [u, v, w], Math.sign(det));
    }
}

function paintMesh(grid, model, put) {
  const { size, layers } = grid,
    dims = [size, size, layers],
    rays = new Array(size * size);
  for (const mesh of model.meshes) {
    const points = [];
    for (let i = 0; i < mesh.positions.length; i += 3)
      points.push(grid.project(mesh.positions.subarray(i, i + 3)));
    for (let i = 0; i + 2 < mesh.length; i += mesh.mode === 4 ? 3 : 1) {
      const corners =
        mesh.mode === 6
          ? [0, i + 1, i + 2]
          : mesh.mode === 5 && i % 2
            ? [i + 1, i, i + 2]
            : [i, i + 1, i + 2];
      const ids = mesh.idx ? corners.map((k) => mesh.idx[k]) : corners,
        verts = ids.map((k) => points[k]);
      const [p, q, r] = verts,
        planes = [
          [0, 1, 2],
          [1, 2, 0],
          [2, 0, 1],
        ];
      const areas = planes.map(([a, b]) =>
        Math.abs((q[a] - p[a]) * (r[b] - p[b]) - (q[b] - p[b]) * (r[a] - p[a])),
      );
      const dominant = areas.indexOf(Math.max(...areas));
      if (!areas[dominant]) continue;
      let painted = false;
      for (const j of dominant === 0 ? [0] : [dominant, 0]) {
        const [a, b, c] = planes[j];
        scanTriangle(verts, a, b, dims[a], dims[b], (x, y, weights, sign) => {
          const depth = weights.reduce((s, w, k) => s + w * verts[k][c], 0);
          const color = sample(mesh, ids, weights);
          if (j === dominant) {
            const cell = [];
            cell[a] = x;
            cell[b] = y;
            cell[c] = Math.min(dims[c] - 1, Math.max(0, Math.floor(depth)));
            put(...cell, color);
            painted = true;
          }
          if (j === 0) (rays[y * size + x] ||= []).push({ depth, sign, color });
        });
      }
      // A subpixel triangle may cover no cell center in any projection.
      if (!painted) {
        const cell = dims.map((d, k) => Math.min(d - 1, Math.max(0, Math.floor((p[k] + q[k] + r[k]) / 3))));
        put(...cell, sample(mesh, ids, [1 / 3, 1 / 3, 1 / 3]));
      }
    }
  }
  for (let i = 0; i < rays.length; i++) {
    const ray = rays[i];
    if (!ray || ray.length < 2) continue;
    ray.sort((a, b) => a.depth - b.depth);
    // Collapse shared triangle edges before counting volume crossings.
    const hits = [];
    for (const hit of ray) {
      const prev = hits.at(-1);
      if (prev && Math.abs(prev.depth - hit.depth) < 1e-6) prev.sum += hit.sign;
      else hits.push({ ...hit, sum: hit.sign });
    }
    if (hits.reduce((n, h) => n + Math.sign(h.sum), 0) !== 0) continue;
    let winding = 0;
    for (let k = 0; k + 1 < hits.length; k++) {
      const a = hits[k],
        b = hits[k + 1];
      winding += Math.sign(a.sum);
      if (!winding) continue;
      for (let l = Math.max(0, Math.ceil(a.depth - 0.5)); l < layers && l + 0.5 < b.depth; l++)
        put(i % size, Math.floor(i / size), l, l + 0.5 < (a.depth + b.depth) / 2 ? a.color : b.color, true);
    }
  }
}

function paintSplats(grid, model, rgba, index) {
  const { size, layers, axes, unit, step } = grid,
    weights = new Float32Array(rgba.length / 4);
  const dims = [size, size, layers];
  for (const s of model.splats) {
    const center = grid.project(s.center);
    const radius = [s.extent[axes[0]] / unit, s.extent[axes[1]] / unit, s.extent[axes[2]] / step];
    const lo = center.map((n, i) => Math.max(0, Math.floor(n - radius[i])));
    const hi = center.map((n, i) => Math.min(dims[i] - 1, Math.floor(n + radius[i])));
    const peak = center.map((n, i) => Math.min(dims[i] - 1, Math.max(0, Math.floor(n))));
    for (let l = lo[2]; l <= hi[2]; l++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let x = lo[0]; x <= hi[0]; x++) {
          const d = grid.world(x + 0.5, y + 0.5, l + 0.5).map((v, k) => v - s.center[k]);
          const atCenter = x === peak[0] && y === peak[1] && l === peak[2];
          let distance = 0;
          for (let k = 0; k < 3; k++)
            distance +=
              ((d[0] * s.rotation[k * 4] + d[1] * s.rotation[k * 4 + 1] + d[2] * s.rotation[k * 4 + 2]) /
                s.scales[k]) **
              2;
          if (distance > 9 && !atCenter) continue;
          const alpha = s.alpha * Math.exp(-0.5 * (atCenter ? 0 : distance));
          if (alpha < 0.5 / 255) continue;
          const p = index(x, y, l),
            old = weights[p / 4],
            sum = old + alpha;
          for (let k = 0; k < 3; k++) rgba[p + k] = (rgba[p + k] * old + s.color[k] * alpha) / sum;
          rgba[p + 3] += alpha * (255 - rgba[p + 3]);
          weights[p / 4] = sum;
        }
  }
}

// Weighted median-cut over 5-bit RGB bins. Small supplied palettes keep their
// exact colors, including near-neighbors in the same histogram bin.
function paletteOf(data, limit) {
  const exact = new Set(),
    hist = new Map();
  for (let p = 0; p < data.length; p += 4) {
    if (!data[p + 3]) continue;
    const r = data[p],
      g = data[p + 1],
      b = data[p + 2],
      key = (r >> 3) * 1024 + (g >> 3) * 32 + (b >> 3);
    if (exact.size <= limit) exact.add(r * 65536 + g * 256 + b);
    const bin = hist.get(key) || [0, 0, 0, 0];
    bin[0] += r;
    bin[1] += g;
    bin[2] += b;
    bin[3]++;
    hist.set(key, bin);
  }
  if (!exact.size) throw new Error("Palette source has no visible pixels.");
  if (exact.size <= limit) return [...exact].map((c) => [c >> 16, (c >> 8) & 255, c & 255]);
  const bins = [...hist.values()].map(([r, g, b, n]) => [r / n, g / n, b / n, n]);
  function box(colors) {
    const low = [255, 255, 255],
      high = [0, 0, 0];
    let count = 0;
    for (const c of colors) {
      for (let k = 0; k < 3; k++) {
        low[k] = Math.min(low[k], c[k]);
        high[k] = Math.max(high[k], c[k]);
      }
      count += c[3];
    }
    const range = high.map((v, k) => v - low[k]),
      span = Math.max(...range);
    return { colors, count, axis: range.indexOf(span), score: colors.length > 1 ? span * count : 0 };
  }
  const boxes = [box(bins)];
  while (boxes.length < limit) {
    boxes.sort((a, b) => b.score - a.score);
    if (!boxes[0].score) break;
    const { colors, count, axis } = boxes.shift();
    colors.sort((a, b) => a[axis] - b[axis]);
    let cut = 0,
      weight = 0;
    do {
      weight += colors[cut++][3];
    } while (cut < colors.length - 1 && weight < count / 2);
    boxes.push(box(colors.slice(0, cut)), box(colors.slice(cut)));
  }
  return boxes.map(({ colors, count }) =>
    [0, 1, 2].map((k) => Math.round(colors.reduce((n, c) => n + c[k] * c[3], 0) / count)),
  );
}

function slicePixels(model, { size, layers, axis, palette, outline }, supplied, bounds = expandModelBounds(model)) {
  if (axis === "auto") axis = model.kind === "splat" ? "z" : "y";
  const grid = gridFor(bounds, axis, size, layers),
    width = size * layers,
    rgba = new Uint8ClampedArray(width * size * 4);
  const index = (x, y, l) => (y * width + l * size + x) * 4;
  if (model.kind === "splat") paintSplats(grid, model, rgba, index);
  else
    paintMesh(grid, model, (x, y, l, c, onlyEmpty = false) => {
      const p = index(x, y, l);
      if (c[3] && (!onlyEmpty || !rgba[p + 3])) rgba.set(c, p);
    });
  let ink = [24, 24, 24];
  if (palette && (supplied || rgba.some((v, i) => i % 4 === 3 && v))) {
    // Reserve one ink color for generated palettes. An explicit reference
    // palette supplies its own darkest color for the outline.
    const reserveInk = outline && !supplied && palette > 1;
    const colors = paletteOf(supplied?.data || rgba, palette - Number(reserveInk));
    if (!reserveInk) ink = colors.reduce((a, b) => (a[0] + a[1] + a[2] <= b[0] + b[1] + b[2] ? a : b));
    const cache = new Map();
    for (let p = 0; p < rgba.length; p += 4) {
      if (!rgba[p + 3]) continue;
      const key = rgba[p] * 65536 + rgba[p + 1] * 256 + rgba[p + 2];
      let color = cache.get(key);
      if (!color) {
        let best = Infinity;
        for (const c of colors) {
          const d = (c[0] - rgba[p]) ** 2 + (c[1] - rgba[p + 1]) ** 2 + (c[2] - rgba[p + 2]) ** 2;
          if (d < best) {
            best = d;
            color = c;
          }
        }
        cache.set(key, color);
      }
      rgba.set(color, p);
    }
  }
  if (outline) {
    const before = rgba.slice();
    for (let l = 0; l < layers; l++)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const p = index(x, y, l);
          if (before[p + 3]) continue;
          const alpha = Math.max(
            x > 0 ? before[p - 4 + 3] : 0,
            x + 1 < size ? before[p + 4 + 3] : 0,
            y > 0 ? before[p - width * 4 + 3] : 0,
            y + 1 < size ? before[p + width * 4 + 3] : 0,
          );
          if (alpha) {
            rgba.set(ink, p);
            rgba[p + 3] = alpha;
          }
        }
  }
  return {
    rgba,
    width,
    height: size,
    layout: {
      version: 1,
      order: "bottom-to-top",
      columns: layers,
      rows: 1,
      tileWidth: size,
      tileHeight: size,
      upAxis: axis,
      source: model.kind,
      bounds: { min: grid.min, max: grid.max },
      pixelSize: grid.unit,
      layerHeight: grid.step,
    },
  };
}

__x.CHARACTER_SLICE_DEFAULTS = CHARACTER_SLICE_DEFAULTS; __x.expandModelBounds = expandModelBounds; __x.slicePixels = slicePixels;
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

async function pipeThrough(bytes, stream, maxOutputLength) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  if (maxOutputLength === undefined) return new Uint8Array(await new Response(out).arrayBuffer());
  const reader = out.getReader();
  const data = new Uint8Array(maxOutputLength);
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) return data.subarray(0, size);
      if (value.length > data.length-size) {
        await reader.cancel();
        throw new Error("Decompressed data exceeds the declared image size");
      }
      data.set(value, size);
      size += value.length;
    }
  } finally {
    reader.releaseLock();
  }
}

async function inflate(bytes, maxOutputLength) {
  const z = await nodeZlib();
  if (z) return new Uint8Array(z.inflateSync(bytes, {maxOutputLength}));
  return streamZlib.inflate(bytes, maxOutputLength);
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
  inflate: (b, limit) => pipeThrough(b, new DecompressionStream("deflate"), limit),
  deflate: (b) => pipeThrough(b, new CompressionStream("deflate")),
  gunzip: (b) => pipeThrough(b, new DecompressionStream("gzip")),
  gunzipLax: (b) => {
    const start = gzipBodyStart(b);
    return start < 0 ? Promise.resolve(null) : streamInflateRawPartial(b.subarray(start, Math.max(start + 1, b.length - 8)));
  },
};

__x.inflate = inflate; __x.deflate = deflate; __x.gunzip = gunzip; __x.gunzipLax = gunzipLax; __x.streamZlib = streamZlib;
});
__def("png-decoder.mjs", function (__x, __req) {
// PNG scanlines share their filtering and sample reconstruction across Adam7
// passes. The atlas can be wider than an ordinary texture (128 x 128 tiles).
const { inflate } = __req("zlib.mjs");
const { NanoodleError } = __req("errors.mjs");

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

function check(condition, detail) {
  if (!condition) throw new NanoodleError("Invalid PNG: " + detail);
}

function unfilter(row, prev, step, mode) {
  check(mode <= 4, "unknown scanline filter");
  if (!mode) return;
  for (let x = 0; x < row.length; x++) {
    const a = x >= step ? row[x - step] : 0;
    const b = prev ? prev[x] : 0;
    if (mode === 1) row[x] += a;
    else if (mode === 2) row[x] += b;
    else if (mode === 3) row[x] += (a + b) >> 1;
    else {
      const c = prev && x >= step ? prev[x - step] : 0;
      const da = Math.abs(b - c),
        db = Math.abs(a - c),
        dc = Math.abs(a + b - 2 * c);
      row[x] += da <= db && da <= dc ? a : db <= dc ? b : c;
    }
  }
}

function sample(row, n, depth) {
  if (depth === 8) return row[n];
  if (depth === 16) return row[2 * n] * 256 + row[2 * n + 1];
  const bit = n * depth;
  return (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
}

async function decodePngPixels(bytes, { maxDim, allowSpriteStrip, firstAnimationFrame = false }) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  check(
    SIGNATURE.every((v, i) => u[i] === v),
    "signature",
  );
  const view = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let w,
    h,
    depth,
    type,
    interlace,
    palette,
    trns,
    ended = false,
    compressedSize = 0;
  let animated = false,
    sawIdat = false,
    controlCount = 0,
    firstFrame;
  const chunks = [];
  for (let p = 8; p + 12 <= u.length; ) {
    const length = view.getUint32(p),
      start = p + 8;
    check(start + length + 4 <= u.length, "truncated chunk");
    const name = String.fromCharCode(...u.subarray(p + 4, start));
    const data = u.subarray(start, start + length);
    check(name === "IHDR" || w, "missing header");
    if (name === "IHDR") {
      check(p === 8 && length === 13, "header");
      w = view.getUint32(start);
      h = view.getUint32(start + 4);
      depth = data[8];
      type = data[9];
      interlace = data[12];
      const maxWidth = allowSpriteStrip && h <= 128 ? 16384 : maxDim;
      check(w > 0 && h > 0, "empty dimensions");
      if (w > maxWidth || h > maxDim)
        throw new NanoodleError(
          `image is too large to resize in-process (${w}×${h}; max ${maxDim}px) — use smaller source dimensions`,
        );
      check(DEPTHS[type]?.includes(depth) && !data[10] && !data[11] && interlace <= 1, "header encoding");
    } else if (name === "PLTE") {
      check(!sawIdat && length > 0 && length <= 768 && length % 3 === 0, "palette");
      palette = data;
    } else if (name === "tRNS") {
      check(
        !sawIdat &&
          ((type === 3 && palette && length <= palette.length / 3) ||
            (type === 0 && length === 2) ||
            (type === 2 && length === 6)),
        "transparency",
      );
      trns = data;
    } else if (firstAnimationFrame && name === "acTL") {
      check(!sawIdat && !animated && length === 8 && view.getUint32(start), "animation control");
      animated = true;
    } else if (animated && name === "fcTL") {
      check(length === 26, "animation frame control");
      if (++controlCount === 1) {
        const width = view.getUint32(start + 4),
          height = view.getUint32(start + 8);
        const x = view.getUint32(start + 12),
          y = view.getUint32(start + 16);
        check(
          width && height && x + width <= w && y + height <= h && data[24] <= 2 && data[25] <= 1,
          "animation frame bounds or operation",
        );
        check(sawIdat || (width === w && height === h && !x && !y), "animated IDAT dimensions");
        firstFrame = { width, height, x, y, poster: sawIdat, over: data[25] === 1 };
        // With fcTL after IDAT, IDAT is a separate poster outside the animation.
        if (sawIdat) {
          chunks.length = 0;
          compressedSize = 0;
        }
      }
    } else if (animated && name === "fdAT") {
      check(firstFrame && sawIdat && length >= 4, "animation frame data");
      if (controlCount === 1 && firstFrame.poster) {
        chunks.push(data.subarray(4));
        compressedSize += length - 4;
      }
    } else if (name === "IDAT") {
      check(!firstFrame?.poster, "IDAT after animation frame data");
      sawIdat = true;
      compressedSize += length;
      chunks.push(data);
    } else if (name === "IEND") {
      check(length === 0, "end chunk");
      ended = true;
      break;
    } else check((u[p + 4] & 32) !== 0, "unsupported critical chunk " + name);
    p = start + length + 4;
  }
  check(ended && chunks.length && (type !== 3 || palette), "missing image data or palette");
  const frame = firstFrame || { width: w, height: h, x: 0, y: 0 };
  const channels = CHANNELS[type],
    bpp = channels * depth;
  const passes = [];
  let expected = 0;
  for (const [x0, y0, dx, dy] of interlace ? ADAM7 : [[0, 0, 1, 1]]) {
    const cols = Math.ceil((frame.width - x0) / dx),
      rows = Math.ceil((frame.height - y0) / dy);
    if (cols <= 0 || rows <= 0) continue;
    const stride = Math.ceil((cols * bpp) / 8);
    passes.push({ x0, y0, dx, dy, cols, rows, stride });
    expected += rows * (stride + 1);
  }
  let compressed = chunks[0];
  if (chunks.length > 1) {
    compressed = new Uint8Array(compressedSize);
    let at = 0;
    for (const chunk of chunks) {
      compressed.set(chunk, at);
      at += chunk.length;
    }
  }
  const raw = await inflate(compressed, expected);
  check(raw.length === expected, "unexpected decompressed length");
  const rgba = new Uint8ClampedArray(w * h * 4);
  const max = (1 << depth) - 1;
  const uint8 = depth === 8 ? (v) => v : (v) => Math.round((v * 255) / max);
  const key = [];
  if (trns && type !== 3) {
    for (let i = 0; i < trns.length; i += 2) key.push(trns[i] * 256 + trns[i + 1]);
  }
  let p = 0;
  for (const { x0, y0, dx, dy, cols, rows, stride } of passes) {
    let prev;
    for (let y = 0; y < rows; y++) {
      const filter = raw[p++];
      const row = raw.subarray(p, p + stride);
      p += stride;
      unfilter(row, prev, Math.ceil(bpp / 8), filter);
      prev = row;
      let dst = ((frame.y + y0 + y * dy) * w + frame.x + x0) * 4;
      if (type === 6 && depth === 8 && dx === 1) {
        rgba.set(row, dst);
        continue;
      }
      for (let col = 0, n = 0; col < cols; col++, n += channels, dst += dx * 4) {
        const first = sample(row, n, depth);
        if (type === 3) {
          check(3 * first + 2 < palette.length, "palette index");
          rgba[dst] = palette[3 * first];
          rgba[dst + 1] = palette[3 * first + 1];
          rgba[dst + 2] = palette[3 * first + 2];
          rgba[dst + 3] = trns?.[first] ?? 255;
        } else if (type === 0 || type === 4) {
          rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = uint8(first);
          rgba[dst + 3] = type === 4 ? uint8(sample(row, n + 1, depth)) : first === key[0] ? 0 : 255;
        } else {
          const g = sample(row, n + 1, depth),
            b = sample(row, n + 2, depth);
          rgba[dst] = uint8(first);
          rgba[dst + 1] = uint8(g);
          rgba[dst + 2] = uint8(b);
          rgba[dst + 3] =
            type === 6
              ? uint8(sample(row, n + 3, depth))
              : first === key[0] && g === key[1] && b === key[2]
                ? 0
                : 255;
        }
      }
    }
  }
  // The first animation frame blends onto transparent black. Only fully
  // transparent samples differ between SOURCE and OVER on an empty canvas.
  if (frame.over)
    for (let y = frame.y; y < frame.y + frame.height; y++) {
      for (let x = frame.x; x < frame.x + frame.width; x++) {
        const dst = (y * w + x) * 4;
        if (!rgba[dst + 3]) rgba.fill(0, dst, dst + 3);
      }
    }
  return { w, h, rgba };
}

__x.decodePngPixels = decodePngPixels;
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

  return muxTracks(buffers, outTracks);
}

// Both a lossless concat and a newly encoded sprite track use the same muxer.
function muxTracks(buffers, outTracks, fastStart = false) {
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
  if(cursor > 0xffffffff) throw new Error("MP4 exceeds 32-bit chunk offsets");
  const mdatHeader = concat([u32(cursor - ftyp.length), enc("mdat")]);

  let moov = movieBox(outTracks, 0);
  if (cursor + moov.length > 0xffffffff) throw new Error("MP4 exceeds 32-bit file size");
  if (fastStart) {
    // All chunk offsets are fixed-width stco entries. Moving moov in
    // front of mdat shifts each entry by exactly the size of moov.
    moov = movieBox(outTracks, moov.length);
    return concat([ftyp, moov, mdatHeader, ...mdatParts]);
  }
  return concat([ftyp, mdatHeader, ...mdatParts, moov]);
}

function movieBox(outTracks, chunkShift) {
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
    const stco = fullbox("stco", 0, 0, u32(t.samples.length), ...t.samples.map(s=>u32(s.newOffset + chunkShift)));
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
  return box("moov", mvhd, ...trakBoxes);
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
// A single AVC track, with one length-prefixed NAL per sample. Keep the
// visual sample entry and AVC decoder configuration in the sample table.
function muxAvc(samples, width, height, seconds, sps, pps) {
  const avcC = box("avcC", Uint8Array.of(1, sps[1], sps[2], sps[3], 0xff, 0xe1),
    u16(sps.length), sps, Uint8Array.of(1), u16(pps.length), pps);
  const avc1 = box("avc1", new Uint8Array(6), u16(1), new Uint8Array(16),
    u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0),
    u16(1), new Uint8Array(32), u16(24), u16(0xffff), avcC);
  // Long source animations must also fit the version-0 mdhd duration field.
  const timescale = Math.min(90000, Math.floor(0xffffffff / seconds));
  const total = Math.round(seconds * timescale);
  const buffers = samples.map(s => s.bytes);
  const entries = samples.map((s, i) => ({
    bufIdx: i, offset: 0, size: s.bytes.length, cts: 0, sync: s.sync,
    dur: Math.round((i + 1) * total / samples.length) - Math.round(i * total / samples.length)
  }));
  return muxTracks(buffers, [{kind:"video", width, height, timescale,
    stsdRaw:fullbox("stsd", 0, 0, u32(1), avc1), samples:entries}], true);
}
  return { concatMp4, isMp4, mp4ParamsMatch, parseMp4, muxAvc };
})();


__x.MP4CAT = MP4CAT;
__x.default = MP4CAT;
});
__def("sprite-projection.mjs", function (__x, __req) {
function number(fields, key, fallback, min, max, integer = false) {
  const value = fields[key] == null || fields[key] === "" ? fallback : Number(fields[key]);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
    throw new Error(
      key + " must be " + (integer ? "an integer " : "") + "between " + min + " and " + max + ".",
    );
  return value;
}

function viewPlan(sheet, fields) {
  const tile = sheet.height,
    layers = sheet.width / tile;
  if (!Number.isInteger(layers) || layers < 8 || layers > 128 || tile < 16 || tile > 128)
    throw new Error("Expected a horizontal Slice 3D sheet with 8–128 square tiles of 16–128 pixels.");
  const pitch = (number(fields, "pitch", 30, 0, 90) * Math.PI) / 180,
    scale = number(fields, "scale", 3, 1, 8);
  const spacing = (number(fields, "spacing", 1, 0, 4) * (tile - 2)) / layers;
  const rise = spacing * Math.cos(pitch),
    squash = Math.max(1 / tile, Math.sin(pitch));
  // Fixed even bounds for every yaw, including both turntable endpoints.
  const floor = tile * Math.SQRT2;
  const w = 2 * Math.ceil((floor * scale + 4) / 2),
    h = 2 * Math.ceil(((floor * squash + rise * (layers - 1)) * scale + 4) / 2);
  return { tile, layers, scale, rise, squash, w, h };
}

// Scan transparency once per sheet. Empty sky and empty layers are common in a sliced mesh.
function occupiedLayers(sheet, plan) {
  const { tile, layers, rise, scale, h } = plan;
  const result = [];
  for (let layer = 0; layer < layers; layer++) {
    let left = tile, top = tile, right = 0, bottom = 0;
    for (let y = 0; y < tile; y++) {
      let alpha = (y * sheet.width + layer * tile) * 4 + 3;
      for (let x = 0; x < tile; x++, alpha += 4) {
        if (!sheet.data[alpha]) continue;
        left = Math.min(left, x);
        right = Math.max(right, x + 1);
        top = Math.min(top, y);
        bottom = y + 1;
      }
    }
    if (right === 0) continue;
    result.push({
      offset: layer * tile,
      x: (left + right - tile) / 2, y: (top + bottom - tile) / 2,
      halfWidth: (right - left) / 2, halfHeight: (bottom - top) / 2,
      cy: h / 2 + ((layers - 1) / 2 - layer) * rise * scale,
    });
  }
  return result;
}

// Invert the orthographic transform at each output pixel center, then composite
// layers in ground-to-top order. draw() can be reused for every turntable angle.
function softwareView(sheet, fields) {
  const plan = viewPlan(sheet, fields);
  const { tile, scale, squash, w, h } = plan;
  const layers = occupiedLayers(sheet, plan);
  return function draw(yaw) {
    const data = new Uint8ClampedArray(w * h * 4);
    const angle = (yaw * Math.PI) / 180, c = Math.cos(angle), s = Math.sin(angle);
    const cosX = new Float64Array(w), sinX = new Float64Array(w);
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / scale;
      cosX[x] = c * dx;
      sinX[x] = -s * dx;
    }
    for (const layer of layers) {
      const cx = w / 2 + scale * (c * layer.x - s * layer.y);
      const cy = layer.cy + scale * squash * (s * layer.x + c * layer.y);
      const rx = scale * (Math.abs(c) * layer.halfWidth + Math.abs(s) * layer.halfHeight);
      const ry = scale * squash * (Math.abs(s) * layer.halfWidth + Math.abs(c) * layer.halfHeight);
      const left = Math.max(0, Math.floor(cx - rx)), right = Math.min(w, Math.ceil(cx + rx));
      const top = Math.max(0, Math.floor(cy - ry)), bottom = Math.min(h, Math.ceil(cy + ry));
      for (let y = top; y < bottom; y++) {
        const dy = (y + 0.5 - layer.cy) / (scale * squash);
        const sinY = s * dy, cosY = c * dy;
        for (let x = left; x < right; x++) {
          const u = Math.floor(cosX[x] + sinY + tile / 2), v = Math.floor(sinX[x] + cosY + tile / 2);
          if (u < 0 || u >= tile || v < 0 || v >= tile) continue;
          const src = (v * sheet.width + layer.offset + u) * 4, alpha = sheet.data[src + 3];
          if (!alpha) continue;
          const dst = (y * w + x) * 4;
          if (alpha === 255 || !data[dst + 3]) {
            data[dst] = sheet.data[src];
            data[dst + 1] = sheet.data[src + 1];
            data[dst + 2] = sheet.data[src + 2];
            data[dst + 3] = alpha;
          } else {
            const under = data[dst + 3] * (1 - alpha / 255), a = alpha + under;
            for (let k = 0; k < 3; k++)
              data[dst + k] = (sheet.data[src + k] * alpha + data[dst + k] * under) / a;
            data[dst + 3] = a;
          }
        }
      }
    }
    return { width: w, height: h, data };
  };
}

function flag(value, fallback) {
  return value == null ? fallback : value === true || value === "true";
}
function turntablePlan(fields) {
  const fps = number(fields, "fps", 24, 1, 60, true),
    duration = number(fields, "duration", 3, 0.25, 30);
  const from = number(fields, "yawStart", 0, -3600, 3600),
    to = number(fields, "yawEnd", 360, -3600, 3600);
  return { fps, duration, from, to, count: Math.max(2, Math.round(fps * duration)) };
}

__x.number = number; __x.viewPlan = viewPlan; __x.softwareView = softwareView; __x.flag = flag; __x.turntablePlan = turntablePlan;
});
__def("sprite-video.mjs", function (__x, __req) {
// A small H.264 Baseline encoder for software-rendered pixel art. I_PCM
// preserves changed macroblocks; P_Skip cheaply repeats stationary areas.
// These are standard H.264 macroblock types. MP4CAT supplies the container.
const { MP4CAT } = __req("mp4cat.mjs");

const GOP = 60;
const BLOCK_BYTES = 16 * 16 + 2 * 8 * 8;

class Bits {
  constructor() {
    this.buffer = new Uint8Array(128);
    this.size = 0;
    this.partial = 0;
    this.used = 0;
  }

  reserve(count) {
    if (this.size + count <= this.buffer.length) return;
    const next = new Uint8Array(Math.max(this.buffer.length * 2, this.size + count));
    next.set(this.buffer.subarray(0, this.size));
    this.buffer = next;
  }

  bit(value) {
    this.partial = (this.partial << 1) | Number(value);
    if (++this.used === 8) this.align();
  }

  align() {
    if (!this.used) return;
    this.reserve(1);
    this.buffer[this.size++] = this.partial << (8 - this.used);
    this.partial = 0;
    this.used = 0;
  }

  uint(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bit((value >>> i) & 1);
  }

  ue(value) {
    const code = value + 1;
    const length = 32 - Math.clz32(code);
    this.uint(0, length - 1);
    this.uint(code, length);
  }

  bytes(bytes) {
    this.align();
    this.reserve(bytes.length);
    this.buffer.set(bytes, this.size);
    this.size += bytes.length;
  }

  finish() {
    this.bit(1);
    this.align();
    return this.buffer.subarray(0, this.size);
  }
}

// H.264 7.4.1: escape start-code emulation even inside raw PCM. MP4 video
// samples carry a four-byte length; avcC stores the parameter sets separately.
function nal(header, rbsp, lengthPrefixed = false) {
  let extra = 0, zeros = 0;
  for (const b of rbsp) {
    if (zeros === 2 && b <= 3) { extra++; zeros = 0; }
    zeros = b === 0 ? zeros + 1 : 0;
  }
  const length = 1 + rbsp.length + extra;
  const out = new Uint8Array((lengthPrefixed ? 4 : 0) + length);
  let pos = lengthPrefixed ? 4 : 0;
  if (lengthPrefixed) new DataView(out.buffer).setUint32(0, length);
  out[pos++] = header;
  if (!extra) {
    out.set(rbsp, pos);
    return out;
  }
  zeros = 0;
  for (const b of rbsp) {
    if (zeros === 2 && b <= 3) { out[pos++] = 3; zeros = 0; }
    out[pos++] = b;
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return out;
}

// Annex A, Tables A-1/A-2: frame size in macroblocks, MB/s, baseline kb/s.
// Start at level 3, supported by conventional mobile and desktop AVC players.
function avcLevel(cols, rows, fps, kbps) {
  const levels = [
    [30, 1620, 40500, 10000], [31, 3600, 108000, 14000], [32, 5120, 216000, 20000],
    [40, 8192, 245760, 20000], [41, 8192, 245760, 50000], [42, 8704, 522240, 50000],
    [50, 22080, 589824, 135000], [51, 36864, 983040, 240000], [52, 36864, 2073600, 240000],
    [60, 139264, 4177920, 240000], [61, 139264, 8355840, 480000], [62, 139264, 16711680, 800000],
  ];
  const blocks = cols * rows;
  const level = levels.find(([, fs, mbps, br]) => blocks <= fs && Math.max(cols, rows) ** 2 <= 8 * fs &&
    blocks * fps <= mbps && kbps <= br);
  if (!level) throw new Error("Sprite video exceeds H.264 Baseline level limits.");
  return level[0];
}

function parameterSets(width, height, cols, rows, level) {
  const s = new Bits();
  s.bytes(Uint8Array.of(66, 0xc0, level));
  s.ue(0); s.ue(0); s.ue(2); s.ue(1); // SPS id, four frame_num bits, POC type 2, one reference
  s.bit(0); s.ue(cols - 1); s.ue(rows - 1);
  s.bit(1); s.bit(1);                 // progressive, direct_8x8_inference
  const right = (cols * 16 - width) / 2;
  const bottom = (rows * 16 - height) / 2;
  s.bit(!!(right || bottom));
  if (right || bottom) { s.ue(0); s.ue(right); s.ue(0); s.ue(bottom); }
  // Square pixels, limited-range BT.601 matrix applied to sRGB primaries
  // and transfer. Explicit metadata keeps large and small clips consistent.
  s.bit(1);                            // VUI present
  s.bit(1); s.uint(1, 8);              // 1:1 sample aspect ratio
  s.bit(0);                            // no overscan information
  s.bit(1); s.uint(5, 3); s.bit(0); s.bit(1);
  s.uint(1, 8); s.uint(13, 8); s.uint(6, 8);
  s.bit(1); s.ue(1); s.ue(1);          // centred 2x2 chroma samples
  s.uint(0, 5);                        // timing, NAL/VCL HRD, pic_struct, restrictions
  const p = new Bits();
  p.ue(0); p.ue(0); p.bit(0); p.bit(0); // CAVLC, one slice group
  p.ue(0); p.ue(0); p.ue(0);
  p.bit(0); p.uint(0, 2);             // weighted prediction
  p.ue(0); p.ue(0); p.ue(0);         // signed Exp-Golomb zero QP offsets
  p.bit(1); p.bit(0); p.bit(0);       // deblock control present
  return [nal(0x67, s.finish()), nal(0x68, p.finish())];
}

// BT.601 limited-range Y'CbCr. Composite onto black before subsampling;
// repeat the outermost pixel for partial right/bottom macroblocks. Store
// each block contiguously in H.264's Y, Cb, Cr order for direct I_PCM writes.
function packBlocks(frame, cols, rows, blocks) {
  const { data, width, height } = frame;
  for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++) {
    const start = (by * cols + bx) * BLOCK_BYTES;
    let chroma = 0;
    for (let y = 0; y < 16; y += 2) for (let x = 0; x < 16; x += 2) {
      let red = 0, green = 0, blue = 0;
      for (let dy = 0; dy < 2; dy++) {
        const sy = Math.min(by * 16 + y + dy, height - 1);
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(bx * 16 + x + dx, width - 1);
          const pixel = (sy * width + sx) * 4;
          const alpha = data[pixel + 3];
          let r = 0, g = 0, b = 0;
          if (alpha === 255) {
            r = data[pixel]; g = data[pixel + 1]; b = data[pixel + 2];
          } else if (alpha) {
            r = Math.floor((data[pixel] * alpha + 127) / 255);
            g = Math.floor((data[pixel + 1] * alpha + 127) / 255);
            b = Math.floor((data[pixel + 2] * alpha + 127) / 255);
          }
          blocks[start + (y + dy) * 16 + x + dx] = 16 + ((66 * r + 129 * g + 25 * b + 128) >> 8);
          red += r; green += g; blue += b;
        }
      }
      blocks[start + 256 + chroma] = 128 + ((-38 * red - 74 * green + 112 * blue + 512) >> 10);
      blocks[start + 320 + chroma] = 128 + ((112 * red - 94 * green - 18 * blue + 512) >> 10);
      chroma++;
    }
  }
}

// A flat block can use an Intra_16x16 directional prediction when its
// left or top neighbour is the same colour. No transform coefficients then
// need transmitting. Record a colour only when every sample matches.
function flatColor(words, offset) {
  const y = words[offset], cb = words[offset + 64], cr = words[offset + 80];
  if (y !== (y >>> 24) * 0x01010101 || cb !== (cb >>> 24) * 0x01010101 ||
      cr !== (cr >>> 24) * 0x01010101) return -1;
  for (let i = 1; i < 64; i++) if (words[offset + i] !== y) return -1;
  for (let i = 1; i < 16; i++) {
    if (words[offset + 64 + i] !== cb || words[offset + 80 + i] !== cr) return -1;
  }
  return ((y & 255) << 16) | ((cb & 255) << 8) | (cr & 255);
}

function encodeSlice(index, current, previous, cols) {
  const idr = index % GOP === 0;
  const s = new Bits();
  s.ue(0); s.ue(idr ? 2 : 0); s.ue(0); // first macroblock, I/P slice, PPS id
  s.uint((index % GOP) & 15, 4);
  if (idr) {
    s.ue(Math.floor(index / GOP) & 1);  // alternate idr_pic_id
    s.bit(0); s.bit(0);                // no_output_of_prior_pics, long_term_reference
  } else {
    s.bit(0); s.bit(0); s.bit(0);      // default reference list and sliding reference window
  }
  s.ue(0); s.ue(1);                    // zero QP delta, disabled deblocking (exact P_Skip)
  const curWords = new Uint32Array(current.buffer);
  const refWords = new Uint32Array(previous.buffer);
  const colors = new Int32Array(cols);
  const pcm = new Uint8Array(cols);
  let skipped = 0;
  for (let offset = 0, block = 0; offset < current.length; offset += BLOCK_BYTES, block++) {
    const x = block % cols;
    const hasLeft = x !== 0, hasTop = block >= cols;
    const color = flatColor(curWords, offset / 4);
    const matchLeft = color >= 0 && hasLeft && colors[x - 1] === color;
    const matchTop = color >= 0 && hasTop && colors[x] === color;
    colors[x] = color;
    if (!idr) {
      let word = offset / 4;
      const end = word + BLOCK_BYTES / 4;
      while (word < end && curWords[word] === refWords[word]) word++;
      if (word === end) { pcm[x] = 0; skipped++; continue; }
      s.ue(skipped);
      skipped = 0;
    }
    if (matchLeft || matchTop) {
      const horizontal = matchLeft;
      s.ue((idr ? 1 : 6) + Number(horizontal)); // zero AC/chroma, luma vertical or horizontal
      s.ue(horizontal ? 1 : 2);                 // chroma horizontal or vertical
      s.ue(0);                                 // no QP delta
      // A PCM neighbour contributes 16 to nC. With our only other modes
      // (skipped or zero residual), the CAVLC nC table is either 0 or >=8.
      if ((hasLeft && pcm[x - 1]) || (hasTop && pcm[x])) s.uint(3, 6);
      else s.bit(1);                           // coeff_token for zero luma DC coefficients
      pcm[x] = 0;
    } else {
      s.ue(idr ? 25 : 30);                    // I_PCM in the I/P mb_type tables
      s.bytes(current.subarray(offset, offset + BLOCK_BYTES));
      pcm[x] = 1;
    }
  }
  if (skipped) s.ue(skipped);
  return { bytes: nal(idr ? 0x65 : 0x41, s.finish(), true), sync: idr };
}

async function encodeSpriteMp4(frames, duration) {
  if (!(Number.isFinite(duration) && duration > 0)) throw new Error("Invalid sprite video duration.");
  let width, height, cols, rows, current, previous;
  const samples = [];
  let totalBytes = 0;
  for await (const frame of frames) {
    if (!samples.length) {
      ({ width, height } = frame);
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 ||
          width > 65534 || height > 65534 || (width & 1) || (height & 1))
        throw new Error("Sprite video requires even pixel dimensions.");
      cols = Math.ceil(width / 16); rows = Math.ceil(height / 16);
      current = new Uint8Array(cols * rows * BLOCK_BYTES);
      previous = new Uint8Array(current.length);
    }
    if (frame.width !== width || frame.height !== height || frame.data.length !== width * height * 4)
      throw new Error("Sprite video frames have inconsistent dimensions.");
    packBlocks(frame, cols, rows, current);
    const sample = encodeSlice(samples.length, current, previous, cols);
    samples.push(sample);
    totalBytes += sample.bytes.length;
    // One 32-bit chunk offset per frame. Reject before accumulating further
    // samples; muxTracks also checks the final layout before allocating it.
    if (totalBytes + 40 > 0xffffffff) throw new Error("Sprite video exceeds the 32-bit MP4 size limit.");
    [current, previous] = [previous, current];
  }
  if (!samples.length) throw new Error("Sprite video needs at least one frame.");
  const level = avcLevel(cols, rows, samples.length / duration, totalBytes * 8 / duration / 1000);
  return MP4CAT.muxAvc(samples, width, height, duration, ...parameterSets(width, height, cols, rows, level));
}

__x.encodeSpriteMp4 = encodeSpriteMp4;
});
__def("sprite-model.mjs", function (__x, __req) {
const { dataUrlBytes, sniffMime } = __req("media.mjs");

const { trs, unpackGlb } = __req("gltf-scene.mjs");
const { prepareClip } = __req("gltf-animation.mjs");
const { sceneNodes, readSkin, skinInfluences, skinMatrices, posedPositions } = __req("gltf-skin.mjs");

const decodeText = (bytes) => new TextDecoder().decode(bytes);
const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const glTypes = {
  5120: [1, "getInt8", 127],
  5121: [1, "getUint8", 255],
  5122: [2, "getInt16", 32767],
  5123: [2, "getUint16", 65535],
  5125: [4, "getUint32", 4294967295],
  5126: [4, "getFloat32", 1],
};

function unpack(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint32(0, true) !== 0x46546c67) {
    try {
      return { json: JSON.parse(decodeText(bytes)) };
    } catch {
      throw new Error("Expected a GLB, a self-contained glTF 2 mesh, or a Gaussian PLY.");
    }
  }
  return unpackGlb(bytes);
}

function embedded(uri) {
  if (!uri?.startsWith("data:"))
    throw new Error("External glTF buffers and images require a self-contained .gltf or .glb export.");
  return dataUrlBytes(uri);
}

async function triangleModel(bytes, imagePixels) {
  return (await trianglePoses(bytes, imagePixels)).pose(0);
}

async function trianglePoses(bytes, imagePixels, { clip = "", frames = 1 } = {}) {
  const { json, bin } = unpack(bytes);
  if (json?.asset?.version !== "2.0") throw new Error("Expected glTF 2.0.");
  const unsupported = (json.extensionsRequired || []).filter((name) => name !== "EXT_texture_webp");
  if (unsupported.length) throw new Error("Unsupported required glTF extensions: " + unsupported.join(", "));
  const buffers = (json.buffers || []).map((b, i) => {
    const data = b.uri ? embedded(b.uri).bytes : i === 0 && bin;
    if (!data || data.length < b.byteLength) throw new Error("Missing or truncated glTF buffer.");
    return data;
  });
  function bufferView(index) {
    const bv = json.bufferViews?.[index],
      buffer = buffers[bv?.buffer],
      start = bv?.byteOffset ?? 0;
    if (
      !buffer ||
      !Number.isSafeInteger(bv.byteLength) ||
      !Number.isSafeInteger(start) ||
      start < 0 ||
      bv.byteLength < 0 ||
      start + bv.byteLength > buffer.length
    )
      throw new Error("Invalid glTF buffer view.");
    if (bv.extensions?.EXT_meshopt_compression)
      throw new Error("Meshopt-compressed buffers are unsupported.");
    return buffer.subarray(start, start + bv.byteLength);
  }
  const cache = new Map();
  function accessor(index, shapes, count) {
    const a = json.accessors?.[index],
      spec = glTypes[a?.componentType];
    if (!spec || !shapes.includes(a.type)) throw new Error("Unsupported glTF accessor type.");
    if (!Number.isSafeInteger(a.count) || a.count < 1 || (count != null && a.count !== count))
      throw new Error("Invalid glTF accessor count.");
    if (cache.has(index)) return cache.get(index);
    const n = components[a.type],
      [size, get, max] = spec;
    function source(viewIndex, offset, stride, length, elements, bytes) {
      const buf = bufferView(viewIndex);
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(stride) ||
        stride < elements * bytes ||
        offset + (length - 1) * stride + elements * bytes > buf.length
      )
        throw new Error("Invalid glTF accessor bounds.");
      return new DataView(buf.buffer, buf.byteOffset + offset, buf.byteLength - offset);
    }
    function row(view, offset, data, output) {
      for (let c = 0; c < n; c++) {
        const v = view[get](offset + c * size, true);
        if (!Number.isFinite(v)) throw new Error("Non-finite glTF attribute.");
        data[output + c] = a.normalized ? Math.max(-1, v / max) : v;
      }
    }
    const stride = json.bufferViews?.[a.bufferView]?.byteStride ?? n * size;
    const base =
      a.bufferView == null ? null : source(a.bufferView, a.byteOffset ?? 0, stride, a.count, n, size);
    // Sparse-only accessors can expand far beyond the size of the uploaded file.
    if (!base && a.count * n > 16_777_216) throw new Error("glTF sparse accessor is too large.");
    const data = new Float64Array(n * a.count);
    if (base) for (let i = 0; i < a.count; i++) row(base, i * stride, data, i * n);
    if (a.sparse) {
      const { indices, values, count: length } = a.sparse;
      if (
        !Number.isSafeInteger(length) ||
        length < 1 ||
        length > a.count ||
        ![5121, 5123, 5125].includes(indices?.componentType) ||
        !values
      )
        throw new Error("Invalid glTF sparse accessor.");
      const [indexSize, indexGet] = glTypes[indices.componentType];
      const indicesView = source(
        indices.bufferView,
        indices.byteOffset ?? 0,
        indexSize,
        length,
        1,
        indexSize,
      );
      const valuesView = source(values.bufferView, values.byteOffset ?? 0, n * size, length, n, size);
      let previous = -1;
      for (let i = 0; i < length; i++) {
        const target = indicesView[indexGet](i * indexSize, true);
        if (target <= previous || target >= a.count) throw new Error("Invalid glTF sparse index.");
        row(valuesView, i * n * size, data, target * n);
        previous = target;
      }
    }
    const result = { data, n, count: a.count };
    cache.set(index, result);
    return result;
  }
  const textures = new Map();
  async function texture(info) {
    const tex = json.textures?.[info.index];
    const useWebp = Object.hasOwn(tex?.extensions || {}, "EXT_texture_webp");
    const source = useWebp ? tex.extensions.EXT_texture_webp?.source : tex?.source;
    const img = json.images?.[source];
    if (useWebp && (!Number.isSafeInteger(source) || source < 0 || !img))
      throw new Error("Invalid EXT_texture_webp image source.");
    if (!img || info.extensions?.KHR_texture_transform)
      throw new Error("Unsupported base-color texture encoding or transform.");
    if (useWebp && !img.uri && img.mimeType !== "image/webp")
      throw new Error("EXT_texture_webp bufferView requires image/webp.");
    if (!textures.has(source)) {
      const image = img.uri ? embedded(img.uri) : { bytes: bufferView(img.bufferView), mime: img.mimeType };
      const webp = sniffMime(image.bytes) === "image/webp";
      if (useWebp && !webp) throw new Error("EXT_texture_webp source must contain a WebP image.");
      textures.set(source, { pixels: await imagePixels(image.bytes, image.mime), webp });
    }
    const cached = textures.get(source);
    if (useWebp && !cached.webp) throw new Error("EXT_texture_webp source must contain a WebP image.");
    return { pixels: cached.pixels, sampler: json.samplers?.[tex.sampler] || {} };
  }
  const meshes = [],
    skins = new Map(),
    scene = sceneNodes(json);
  async function emit(index, nodeIndex) {
    const node = json.nodes?.[nodeIndex] ?? {};
    if (node.skin != null && !skins.has(node.skin)) {
      skins.set(node.skin, readSkin(json, node.skin, accessor, scene));
    }
    if (!json.meshes?.[index]) throw new Error("Missing glTF mesh.");
    for (const p of json.meshes[index].primitives) {
      const mode = p.mode ?? 4;
      if (![4, 5, 6].includes(mode))
        throw new Error(
          "Slice 3D requires triangles. For a point-cloud preview, supply the original Gaussian PLY.",
        );
      if (p.extensions?.KHR_draco_mesh_compression)
        throw new Error("Draco-compressed meshes are unsupported.");
      const pos = accessor(p.attributes.POSITION, ["VEC3"]);
      const targets = (p.targets || []).map((target) =>
        target.POSITION == null ? null : accessor(target.POSITION, ["VEC3"], pos.count).data,
      );
      const influences =
        node.skin == null
          ? null
          : skinInfluences(json, p.attributes, pos.count, skins.get(node.skin), accessor);
      if (p.indices != null) {
        const indexSpec = json.accessors?.[p.indices];
        if (!indexSpec || ![5121, 5123, 5125].includes(indexSpec.componentType) || indexSpec.normalized)
          throw new Error("glTF triangle indices must be unsigned integers.");
      }
      const idx = p.indices != null ? accessor(p.indices, ["SCALAR"]).data : null;
      if (idx?.some((v) => !Number.isInteger(v) || v < 0 || v >= pos.count))
        throw new Error("Invalid triangle index.");
      const length = idx?.length ?? pos.count;
      if (length < 3 || (mode === 4 && length % 3)) throw new Error("Incomplete triangle primitive.");
      const mat = json.materials?.[p.material] || {},
        pbr = mat.pbrMetallicRoughness || {},
        info = pbr.baseColorTexture;
      const factor = pbr.baseColorFactor ?? [1, 1, 1, 1];
      if (
        !Array.isArray(factor) ||
        factor.length !== 4 ||
        !factor.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)
      )
        throw new Error("Invalid glTF base color factor.");
      if (mat.alphaMode != null && !["OPAQUE", "MASK", "BLEND"].includes(mat.alphaMode))
        throw new Error("Invalid glTF alpha mode.");
      const color =
        p.attributes.COLOR_0 == null ? null : accessor(p.attributes.COLOR_0, ["VEC3", "VEC4"], pos.count);
      const uv = info
        ? accessor(p.attributes["TEXCOORD_" + (info.texCoord ?? 0)], ["VEC2"], pos.count)
        : null;
      meshes.push({
        base: pos.data,
        targets,
        influences,
        nodeIndex,
        skin: node.skin,
        weights: node.weights ?? json.meshes[index].weights,
        material: {
          idx,
          mode,
          length,
          color,
          uv,
          factor,
          texture: info && (await texture(info)),
          alphaMode: mat.alphaMode || "OPAQUE",
          cutoff: mat.alphaCutoff ?? 0.5,
        },
      });
    }
  }
  if (json.nodes?.length) {
    for (const i of scene.active) {
      const node = json.nodes[i];
      if (node.mesh != null) await emit(node.mesh, i);
    }
  } else for (let i = 0; i < (json.meshes || []).length; i++) await emit(i);
  if (!meshes.length) throw new Error("No triangles in the selected glTF scene.");
  const sampler = prepareClip(json, accessor, clip, frames);
  const animation = sampler?.info ?? null;
  function pose(index) {
    if (!Number.isInteger(index) || index < 0 || index >= frames) throw new Error("Invalid frame index.");
    const overrides = sampler?.sample(animation.times[index]);
    const world = scene.worldMatrices(overrides),
      palettes = new Map();
    for (const [id, joints] of skins) palettes.set(id, skinMatrices(joints, world));
    return {
      kind: "mesh",
      meshes: meshes.map((mesh) => ({
        ...mesh.material,
        positions: posedPositions(
          mesh,
          world.get(mesh.nodeIndex),
          overrides?.get(mesh.nodeIndex)?.weights ?? mesh.weights,
          palettes.get(mesh.skin),
        ),
      })),
    };
  }
  return {
    pose,
    animation,
    count: frames,
    clip: animation?.clip ?? "",
    start: animation?.times[0] ?? 0,
    duration: animation?.duration ?? 0,
  };
}

const plyTypes = {
  char: glTypes[5120],
  int8: glTypes[5120],
  uchar: glTypes[5121],
  uint8: glTypes[5121],
  short: glTypes[5122],
  int16: glTypes[5122],
  ushort: glTypes[5123],
  uint16: glTypes[5123],
  int: [4, "getInt32"],
  int32: [4, "getInt32"],
  uint: glTypes[5125],
  uint32: glTypes[5125],
  float: glTypes[5126],
  float32: glTypes[5126],
  double: [8, "getFloat64"],
  float64: [8, "getFloat64"],
};

function gaussianModel(bytes) {
  const head = decodeText(bytes.subarray(0, 65536)),
    end = /^end_header\r?\n/m.exec(head);
  if (!end) throw new Error("Missing PLY header terminator.");
  const header = head.slice(0, end.index + end[0].length),
    offset = new TextEncoder().encode(header).length;
  let format,
    count,
    stride = 0,
    element;
  const props = new Map();
  for (const line of header.trim().split(/\r?\n/)) {
    const [key, a, b, version] = line.trim().split(/\s+/);
    if (key === "format") {
      if (b !== "1.0" || !["ascii", "binary_little_endian"].includes(a))
        throw new Error("Supported Gaussian PLY formats are ASCII and binary little-endian 1.0.");
      format = a;
    }
    if (key === "element") {
      element = a;
      if (a !== "vertex" && Number(b) !== 0)
        throw new Error("Expected an uncompressed vertex-only Gaussian PLY.");
      if (a === "vertex") count = Number(b);
    }
    if (key === "property" && element === "vertex") {
      if (!plyTypes[a] || version || props.has(b))
        throw new Error("Unsupported Gaussian PLY property encoding.");
      props.set(b, { type: plyTypes[a], offset: stride, index: props.size });
      stride += plyTypes[a][0];
    }
  }
  const required = [
    "x",
    "y",
    "z",
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
  ];
  const dc = ["f_dc_0", "f_dc_1", "f_dc_2"],
    rgb = ["red", "green", "blue"];
  const hasDC = dc.every((p) => props.has(p));
  if (!format || !required.every((p) => props.has(p)) || !(hasDC || rgb.every((p) => props.has(p))))
    throw new Error(
      "Expected Gaussian PLY positions, log scales, quaternion, opacity logit, and DC or RGB colors. Ordinary point clouds are unsupported.",
    );
  if (!hasDC && rgb.some((name) => props.get(name).type !== glTypes[5121]))
    throw new Error(
      "Gaussian RGB properties must be unsigned bytes, or supply floating-point DC coefficients.",
    );
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid Gaussian PLY vertex count.");
  const rows = format === "ascii" ? decodeText(bytes.subarray(offset)).trim().split(/\r?\n/) : null;
  if (rows ? rows.length !== count : count * stride !== bytes.length - offset)
    throw new Error("Gaussian PLY payload does not match its declared vertex count.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    splats = [];
  for (let i = 0; i < count; i++) {
    const row = rows && rows[i].trim().split(/\s+/);
    if (row && row.length !== props.size) throw new Error("Invalid ASCII PLY vertex.");
    const read = (key) => {
      const p = props.get(key);
      const v = row ? Number(row[p.index]) : view[p.type[1]](offset + i * stride + p.offset, true);
      if (!Number.isFinite(v)) throw new Error("Non-finite Gaussian PLY attribute.");
      return v;
    };
    const center = ["x", "y", "z"].map(read),
      scales = ["scale_0", "scale_1", "scale_2"].map((p) => Math.exp(read(p)));
    const quaternion = ["rot_0", "rot_1", "rot_2", "rot_3"].map(read),
      norm = Math.hypot(...quaternion);
    if (!norm || !scales.every((s) => Number.isFinite(s) && s > 0))
      throw new Error("Invalid Gaussian scale or rotation.");
    const [w, x, y, z] = quaternion.map((v) => v / norm);
    const rotation = trs([0, 0, 0], [x, y, z, w], [1, 1, 1]);
    const extent = center.map((_, k) => 3 * Math.hypot(...scales.map((s, j) => rotation[j * 4 + k] * s)));
    const color = hasDC ? dc.map((p) => 255 * (0.5 + 0.2820947918 * read(p))) : rgb.map(read);
    splats.push({ center, scales, rotation, extent, color, alpha: 1 / (1 + Math.exp(-read("opacity"))) });
  }
  return { kind: "splat", splats };
}

__x.triangleModel = triangleModel; __x.trianglePoses = trianglePoses; __x.gaussianModel = gaussianModel;
});
__def("sprite-sequence.mjs", function (__x, __req) {
// A Nanoodle pose sequence is an ordinary APNG whose frames are full RGBA
// sprite strips. Only the private nsTA marker opts a sheet into pose playback.
const { NanoodleError } = __req("errors.mjs");
const { catBytes, crc32, pngChunk } = __req("local-media.mjs");

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const END = pngChunk("IEND", new Uint8Array());
const MAX_FILE_BYTES = 544 * 1024 * 1024;
const MAX_CHUNKS = 65_536;

function check(ok, detail) {
  if (!ok) throw new NanoodleError("Invalid sprite stack PNG: " + detail);
}

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function countValid(n) {
  return Number.isInteger(n) && n >= 2 && n <= 64;
}

// Probe just chunk headers so unmarked stills and ordinary APNGs keep their
// existing decode path. Recognition does not depend on the marker's validity.
function isMarked(bytes) {
  if (!SIGNATURE.every((b, i) => bytes[i] === b)) return false;
  const data = view(bytes);
  for (let p = 8, count = 0; p + 8 <= bytes.length && count < MAX_CHUNKS; count++) {
    if (data.getUint32(p + 4) === 0x6e735441) return true; // nsTA
    if (data.getUint32(p + 4) === 0x49454e44) return false; // IEND
    p += 12 + data.getUint32(p);
  }
  return false;
}

function* chunks(bytes) {
  check(
    SIGNATURE.every((b, i) => bytes[i] === b),
    "signature",
  );
  check(bytes.length <= MAX_FILE_BYTES, "file too large");
  const data = view(bytes);
  let p = 8,
    count = 0;
  while (p < bytes.length) {
    check(++count <= MAX_CHUNKS && p + 12 <= bytes.length, "excessive or truncated chunks");
    const length = data.getUint32(p);
    const stop = p + 8 + length;
    check(stop + 4 <= bytes.length, "truncated chunk data");
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    check(/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type), "chunk type");
    check(crc32(bytes.subarray(p + 4, stop)) === data.getUint32(stop), "CRC of " + type);
    check(count !== 1 || type === "IHDR", "missing IHDR");
    check(type !== "IHDR" || count === 1, "duplicate IHDR");
    if (type === "IEND") check(!length && stop + 4 === bytes.length, "IEND or trailing bytes");
    yield { type, payload: bytes.subarray(p + 8, stop) };
    if (type === "IEND") return;
    p = stop + 4;
  }
  check(false, "missing IEND");
}

function header(payload) {
  check(payload.length === 13, "IHDR size");
  const data = view(payload);
  const width = data.getUint32(0),
    height = data.getUint32(4);
  const layers = width / height;
  check(height >= 16 && height <= 128 && Number.isInteger(layers) && layers >= 8 && layers <= 128, "strip dimensions");
  check(
    payload[8] === 8 && payload[9] === 6 && !payload[10] && !payload[11] && !payload[12],
    "expected noninterlaced RGBA8",
  );
  return { width, height, maxCompressed: (width * 4 + 1) * height + 65_536 };
}

function ancillary(type) {
  // PLTE is permitted in truecolor images as a suggested palette.
  check(type === "PLTE" || type[0] >= "a", "unsupported critical chunk " + type);
}

function appendData(frame, payload, limit) {
  frame.size += payload.length;
  check(frame.size <= limit, "compressed frame too large");
  frame.parts.push(payload);
}

/** Return null for an unmarked image, or validate and index all compressed poses. */
function readStackApng(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isMarked(bytes)) return null;
  let ihdr,
    shape,
    marked = false,
    count = 0,
    seq = 0,
    frame;
  let num, den, previous;
  const frames = [];
  for (const { type, payload } of chunks(bytes)) {
    const data = view(payload);
    switch (type) {
      case "IHDR":
        shape = header(payload);
        ihdr = pngChunk("IHDR", payload);
        break;
      case "nsTA":
        check(!marked && !count && payload.length === 1 && payload[0] === 1, "nsTA version or order");
        marked = true;
        break;
      case "acTL":
        check(marked && !count && payload.length === 8, "acTL order or size");
        count = data.getUint32(0);
        check(countValid(count) && !data.getUint32(4), "pose count or loop count");
        break;
      case "fcTL": {
        check(
          frames.length < count && (!frame || frame.size) && payload.length === 26,
          "frame control or missing frame data",
        );
        check(data.getUint32(0) === seq++, "frame sequence number");
        check(
          data.getUint32(4) === shape.width &&
            data.getUint32(8) === shape.height &&
            !data.getUint32(12) &&
            !data.getUint32(16) &&
            !payload[24] &&
            !payload[25],
          "frame geometry or operations",
        );
        const n = data.getUint16(20),
          d = data.getUint16(22);
        check(n && d && (!frame || n * den === num * d), "nonpositive or unequal pose delays");
        num = n;
        den = d;
        frame = { parts: [], size: 0 };
        frames.push(frame);
        break;
      }
      case "IDAT":
        check(frames.length === 1 && (!frame.parts.length || previous === "IDAT"), "unexpected IDAT");
        appendData(frame, payload, shape.maxCompressed);
        break;
      case "fdAT":
        check(
          frames.length > 1 && payload.length >= 4 && data.getUint32(0) === seq++,
          "unexpected fdAT or sequence number",
        );
        appendData(frame, payload.subarray(4), shape.maxCompressed);
        break;
      case "IEND":
        check(count && frames.length === count && frame.size, "missing poses or image data");
        break;
      default:
        ancillary(type);
    }
    previous = type;
  }
  const delay = num / den;
  return {
    length: count,
    width: shape.width,
    height: shape.height,
    duration: delay * count,
    delays: Array(count).fill(delay),
    png(index) {
      check(Number.isInteger(index) && index >= 0 && index < count, "pose index");
      return catBytes([SIGNATURE, ihdr, ...frames[index].parts.map((part) => pngChunk("IDAT", part)), END]);
    },
  };
}

// Slice 3D already PNG-encodes tiles. Reuse its deflate stream instead of
// expanding it into RGBA again when all we're doing is wrapping each pose.
function stillFrame(bytes) {
  let ihdr, shape, previous;
  const frame = { parts: [], size: 0 };
  for (const { type, payload } of chunks(bytes)) {
    if (type === "IHDR") {
      ihdr = payload;
      shape = header(payload);
    } else if (type === "IDAT") {
      check(!frame.parts.length || previous === "IDAT", "nonconsecutive IDAT");
      appendData(frame, payload, shape.maxCompressed);
    } else if (type === "IEND") {
      check(frame.size, "empty pose");
    } else {
      check(!["nsTA", "acTL", "fcTL", "fdAT"].includes(type), "expected a still image per pose");
      ancillary(type);
    }
    previous = type;
  }
  return { ...shape, ihdr, compressed: frame.parts.length === 1 ? frame.parts[0] : catBytes(frame.parts) };
}

function u32(number) {
  const bytes = new Uint8Array(4);
  view(bytes).setUint32(0, number);
  return bytes;
}

/** Pack a sync/async iterable of independently encoded PNG strips. Delay is seconds per pose. */
async function writeStackApng(frameCount, frameDuration, frames) {
  check(countValid(frameCount), "expected 2 to 64 poses");
  check(Number.isFinite(frameDuration) && frameDuration > 0 && frameDuration <= 65_535, "invalid pose duration");
  const den = Math.max(1, Math.min(60_000, Math.floor(65_535 / frameDuration)));
  const num = Math.max(1, Math.min(65_535, Math.round(frameDuration * den)));
  const chunksOut = [SIGNATURE];
  let width,
    height,
    seq = 0,
    i = 0;
  for await (const bytes of frames) {
    check(i < frameCount && bytes instanceof Uint8Array, "unexpected pose");
    const frame = stillFrame(bytes);
    if (i === 0) {
      width = frame.width;
      height = frame.height;
      chunksOut.push(
        pngChunk("IHDR", frame.ihdr),
        pngChunk("nsTA", Uint8Array.of(1)),
        pngChunk("acTL", catBytes([u32(frameCount), u32(0)])),
      );
    }
    check(frame.width === width && frame.height === height, "poses must have the same dimensions");
    const control = new Uint8Array(26);
    const data = view(control);
    data.setUint32(0, seq++);
    data.setUint32(4, width);
    data.setUint32(8, height);
    data.setUint16(20, num);
    data.setUint16(22, den);
    chunksOut.push(
      pngChunk("fcTL", control),
      i ? pngChunk("fdAT", catBytes([u32(seq++), frame.compressed])) : pngChunk("IDAT", frame.compressed),
    );
    i++;
  }
  check(i === frameCount, "pose count mismatch");
  return catBytes([...chunksOut, END]);
}

__x.readStackApng = readStackApng; __x.writeStackApng = writeStackApng;
});
__def("gltf-scene.mjs", function (__x, __req) {
// The editor also embeds these helpers in its standalone GLB viewer.
function ident() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function mul(a, b) {
  var o = new Array(16),
    c,
    r;
  for (c = 0; c < 4; c++)
    for (r = 0; r < 4; r++)
      o[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function trs(t, r, s) {
  var x = r[0],
    y = r[1],
    z = r[2],
    w = r[3];
  var sx = s[0],
    sy = s[1],
    sz = s[2];
  var x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  var xx = x * x2,
    xy = x * y2,
    xz = x * z2,
    yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  var wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
}
function xform(m, x, y, z, dir) {
  var w = dir ? 0 : 1;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
  ];
}
function unpackGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length)
    throw new Error("Invalid GLB v2 header or length.");
  let json,
    bin = new Uint8Array(0);
  for (let p = 12; p < bytes.length; ) {
    if (p + 8 > bytes.length) throw new Error("Truncated GLB chunk header.");
    const length = view.getUint32(p, true),
      type = view.getUint32(p + 4, true);
    p += 8;
    if (p + length > bytes.length) throw new Error("Truncated GLB chunk.");
    const chunk = bytes.subarray(p, p + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    if (type === 0x004e4942) bin = chunk;
    p += length;
  }
  return { json, bin };
}

__x.ident = ident; __x.mul = mul; __x.trs = trs; __x.xform = xform; __x.unpackGlb = unpackGlb;
});
__def("gltf-animation.mjs", function (__x, __req) {
// Sample each channel on its own keyframe timeline. glTF quaternions are xyzw.
function unitRotation(values) {
  const length = Math.hypot(...values);
  if (!length || !Number.isFinite(length)) throw new Error("Invalid glTF rotation quaternion.");
  return values.map((v) => v / length);
}

function slerp(a, b, u) {
  a = unitRotation(a);
  b = unitRotation(b);
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  if (dot < 0) b = b.map((v) => -v);
  const angle = Math.acos(Math.min(1, Math.abs(dot)));
  let left = 1 - u,
    right = u;
  if (angle > 0.00001) {
    left = Math.sin(left * angle) / Math.sin(angle);
    right = Math.sin(right * angle) / Math.sin(angle);
  }
  return unitRotation(a.map((v, i) => left * v + right * b[i]));
}

function sampleTrack(track, time) {
  const { times, values, width, interpolation, path } = track;
  const cubic = interpolation === "CUBICSPLINE";
  const read = (key, part = cubic ? 1 : 0) => {
    const at = (key * (cubic ? 3 : 1) + part) * width;
    return values.slice(at, at + width);
  };
  let lo = 0,
    hi = times.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (times[mid] <= time) lo = mid + 1;
    else hi = mid;
  }
  const key = Math.max(0, lo - 1);
  const a = read(key);
  if (!lo || lo === times.length || time === times[key] || interpolation === "STEP") {
    return path === "rotation" ? unitRotation(a) : a;
  }
  const b = read(lo),
    dt = times[lo] - times[key],
    u = (time - times[key]) / dt;
  if (!cubic) {
    return path === "rotation" ? slerp(a, b, u) : a.map((v, i) => v + u * (b[i] - v));
  }
  const u2 = u * u,
    u3 = u2 * u;
  const outgoing = read(key, 2),
    incoming = read(lo, 0);
  const value = a.map(
    (v, i) =>
      (2 * u3 - 3 * u2 + 1) * v +
      (u3 - 2 * u2 + u) * dt * outgoing[i] +
      (3 * u2 - 2 * u3) * b[i] +
      (u3 - u2) * dt * incoming[i],
  );
  return path === "rotation" ? unitRotation(value) : value;
}

function prepareClip(json, accessor, clip, frames) {
  if (!Number.isInteger(frames) || frames < 1 || frames > 64)
    throw new Error("Slice 3D requires an integer frame count from 1 to 64.");
  if (!clip && frames === 1) return null;
  const clips = json.animations || [];
  const labels = clips.map((a, i) => a.name || "Animation " + (i + 1));
  const selected = clip ? labels.indexOf(clip) : 0;
  if (!clips[selected]) {
    throw new Error(
      labels.length
        ? "Unknown glTF clip " + clip + ". Available clips: " + labels.join(", ")
        : "No animation clips in this model. Use one frame for the rest pose.",
    );
  }
  const animation = clips[selected];
  const tracks = [];
  let start = Infinity,
    end = -Infinity;
  for (const channel of animation.channels || []) {
    const { node, path } = channel.target;
    if (node == null) continue; // Extension-only animation targets have no core glTF node.
    const target = json.nodes?.[node],
      sampler = animation.samplers?.[channel.sampler];
    if (!target || !sampler || !["translation", "scale", "rotation", "weights"].includes(path))
      throw new Error("Invalid glTF animation channel.");
    if (target.matrix && path !== "weights") throw new Error("Cannot animate TRS on a glTF matrix node.");
    const interpolation = sampler.interpolation ?? "LINEAR";
    if (!["STEP", "LINEAR", "CUBICSPLINE"].includes(interpolation))
      throw new Error("Unsupported glTF interpolation: " + interpolation);
    const times = accessor(sampler.input, ["SCALAR"]).data;
    if (times[0] < 0 || times.some((t, i) => i > 0 && t <= times[i - 1]))
      throw new Error("glTF keyframe times must be nonnegative and strictly increasing.");
    const morph = path === "weights",
      rotation = path === "rotation";
    const width = morph ? json.meshes?.[target.mesh]?.primitives?.[0]?.targets?.length : rotation ? 4 : 3;
    if (!width) throw new Error("Animation weights require morph targets.");
    const count = times.length * (interpolation === "CUBICSPLINE" ? 3 : 1) * (morph ? width : 1);
    const values = accessor(sampler.output, [morph ? "SCALAR" : rotation ? "VEC4" : "VEC3"], count).data;
    tracks.push({ node, path, times, values, width, interpolation });
    start = Math.min(start, times[0]);
    end = Math.max(end, times[times.length - 1]);
  }
  if (!tracks.length) throw new Error("Selected glTF clip has no supported node animation channels.");
  const duration = end - start;
  if (duration === 0 && frames > 1) throw new Error("This glTF clip has zero duration. Use one frame.");
  const times = Array.from({ length: frames }, (_, i) => start + (duration * i) / frames);
  return {
    info: { clip: labels[selected], frames, duration, times },
    sample(time) {
      const overrides = new Map();
      for (const track of tracks) {
        if (!overrides.has(track.node)) overrides.set(track.node, {});
        overrides.get(track.node)[track.path] = sampleTrack(track, time);
      }
      return overrides;
    },
  };
}

__x.prepareClip = prepareClip;
});
__def("gltf-skin.mjs", function (__x, __req) {
const { ident, mul, trs, xform } = __req("gltf-scene.mjs");

function sceneNodes(json) {
  const nodes = json.nodes || [],
    parents = new Map();
  for (let i = 0; i < nodes.length; i++) {
    for (const child of nodes[i].children || []) {
      if (!nodes[child] || parents.has(child)) throw new Error("Invalid glTF node hierarchy.");
      parents.set(child, i);
    }
  }
  const roots =
    json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i).filter((i) => !parents.has(i));
  const stack = roots.slice().reverse(),
    active = new Set();
  while (stack.length) {
    const i = stack.pop();
    if (!nodes[i] || active.has(i)) throw new Error("Invalid or cyclic glTF node tree.");
    active.add(i);
    const children = nodes[i].children || [];
    for (let j = children.length - 1; j >= 0; j--) stack.push(children[j]);
  }
  return {
    active,
    worldMatrices(overrides) {
      const world = new Map();
      for (const i of active) {
        const node = nodes[i],
          pose = overrides?.get(i);
        let local = node.matrix;
        if (!local) {
          const q = pose?.rotation ?? node.rotation ?? [0, 0, 0, 1];
          const norm = Math.hypot(...q);
          if (!norm || !Number.isFinite(norm)) throw new Error("Invalid glTF rotation.");
          local = trs(
            pose?.translation ?? node.translation ?? [0, 0, 0],
            q.map((v) => v / norm),
            pose?.scale ?? node.scale ?? [1, 1, 1],
          );
        }
        const parent = world.get(parents.get(i));
        world.set(i, parent ? mul(parent, local) : local);
      }
      return world;
    },
  };
}

function readSkin(json, skinIndex, accessor, scene) {
  const skin = json.skins?.[skinIndex];
  if (!skin?.joints?.length || skin.joints.some((j) => !scene.active.has(j)))
    throw new Error("glTF skin references missing joints in the scene.");
  const matrices = skin.inverseBindMatrices == null ? null : accessor(skin.inverseBindMatrices, ["MAT4"]);
  if (matrices && matrices.count < skin.joints.length) throw new Error("Missing glTF inverse bind matrices.");
  return skin.joints.map((node, i) => ({ node, bind: matrices?.data.subarray(i * 16, i * 16 + 16) }));
}

function skinInfluences(json, attributes, count, joints, accessor) {
  const sets = [];
  const indices = Object.keys(attributes)
    .filter((name) => /^(JOINTS|WEIGHTS)_\d+$/.test(name))
    .map((name) => Number(name.split("_")[1]));
  if (!indices.includes(0)) throw new Error("A skinned glTF mesh requires JOINTS_0 and WEIGHTS_0.");
  for (const i of new Set(indices)) {
    const jointIndex = attributes["JOINTS_" + i],
      weightIndex = attributes["WEIGHTS_" + i];
    const jointType = json.accessors?.[jointIndex],
      weightType = json.accessors?.[weightIndex];
    if (
      !jointType ||
      ![5121, 5123].includes(jointType.componentType) ||
      jointType.normalized ||
      !weightType ||
      !(
        weightType.componentType === 5126 ||
        ([5121, 5123].includes(weightType.componentType) && weightType.normalized)
      )
    )
      throw new Error("Invalid glTF joint or weight attributes.");
    const joint = accessor(jointIndex, ["VEC4"], count).data,
      weight = accessor(weightIndex, ["VEC4"], count).data;
    if (joint.some((v) => v >= joints.length) || weight.some((w) => w < 0))
      throw new Error("Invalid glTF skin influence.");
    sets.push({ joint, weight });
  }
  return sets;
}

function skinMatrices(joints, world) {
  return joints.map(({ node, bind }) => (bind ? mul(world.get(node), bind) : world.get(node)));
}

function posedPositions(mesh, nodeMatrix, weights, jointMatrices) {
  const { base, targets, influences } = mesh;
  const positions = new Float64Array(base.length);
  if (weights && (weights.length !== targets.length || !weights.every(Number.isFinite)))
    throw new Error("Invalid glTF morph weights.");
  const matrix = nodeMatrix ?? ident();
  for (let p = 0; p < positions.length; p += 3) {
    let x = base[p],
      y = base[p + 1],
      z = base[p + 2];
    for (let m = 0; m < targets.length; m++) {
      const w = weights?.[m],
        delta = targets[m];
      if (!w || !delta) continue;
      x += w * delta[p];
      y += w * delta[p + 1];
      z += w * delta[p + 2];
    }
    if (!jointMatrices) positions.set(xform(matrix, x, y, z, false), p);
    else {
      // Joint matrices already contain the scene transform; the skinned mesh node's transform cancels out.
      let dx = 0,
        dy = 0,
        dz = 0,
        total = 0;
      for (const { joint, weight } of influences) {
        const offset = (p / 3) * 4;
        for (let k = offset; k < offset + 4; k++) {
          const w = weight[k];
          if (!w) continue;
          const j = jointMatrices[joint[k]];
          dx += w * (j[0] * x + j[4] * y + j[8] * z + j[12]);
          dy += w * (j[1] * x + j[5] * y + j[9] * z + j[13]);
          dz += w * (j[2] * x + j[6] * y + j[10] * z + j[14]);
          total += w;
        }
      }
      if (!total) throw new Error("A skinned glTF vertex has zero total joint weight.");
      positions[p] = dx / total;
      positions[p + 1] = dy / total;
      positions[p + 2] = dz / total;
    }
  }
  if (positions.some((v) => !Number.isFinite(v))) throw new Error("Invalid glTF scene transform.");
  return positions;
}

__x.sceneNodes = sceneNodes; __x.readSkin = readSkin; __x.skinInfluences = skinInfluences; __x.skinMatrices = skinMatrices; __x.posedPositions = posedPositions;
});
  window.NanoodleEngine = __req("browser.mjs");
  window.NanoodleEngine.version = "src-6ca5f20ba248";
})();
