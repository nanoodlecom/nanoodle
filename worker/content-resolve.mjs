// Server-side resolution of NanoGPT content URLs.
//
// A browser fetch with redirect:"manual" is an opaque redirect: status 0, no
// body, and no Location, even when the API sends one. Node and the Workers
// runtime still expose the 307. This module is that runtime. It walks hops
// itself and builds a fresh header list for each request. The API key is
// attached only when the hop URL is an allowlisted content path on the
// NanoGPT origin. It is never copied from the previous request onto the next
// one, and an off-origin Location (the presigned file) is returned without
// being fetched — so a custom key header cannot ride along to the file host.
//
// No network of its own: callers pass fetch. Synthetic tests only.

const MEDIA_INLINE_MAX = 4.4 * 1024 * 1024;
const DEFAULT_BASE = "https://nano-gpt.com";

/** Content paths the key may be sent to. Anything else is not fetched. */
export const CONTENT_PATHS = [
  "/api/generate-video/content",
  "/api/images/content",
  "/v1/images/content",
  "/v1/audio/content",
  "/api/v1/audio/content",
];

export function scrubSecrets(text, apiKey) {
  let s = String(text || "");
  if (apiKey && String(apiKey).length >= 4) s = s.split(String(apiKey)).join("[redacted]");
  s = s.replace(/bearer\s+\S+/gi, "Bearer [redacted]");
  s = s.replace(/[?#][^\s)"']*/g, "");
  s = s.replace(/(?:X-Amz-[A-Za-z-]*|Signature|sig|token|api_key|apikey)\s*[:=]\s*\S+/gi, (m) => m.split(/[:=]/)[0] + "=[redacted]");
  return s.replace(/\s+/g, " ").trim().slice(0, 160);
}

function apiOrigin(baseUrl) {
  const base = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
  return { base, origin: new URL(base + "/").origin };
}

/** True only for an allowlisted content path on the API origin. */
export function isAllowedContentUrl(url, baseUrl) {
  let u;
  try { u = new URL(String(url), apiOrigin(baseUrl).base + "/"); }
  catch { return false; }
  if (u.username || u.password) return false;
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.origin !== apiOrigin(baseUrl).origin) return false;
  return CONTENT_PATHS.indexOf(u.pathname) !== -1;
}

function dataUrlWouldExceed(byteLength, mime) {
  const header = ("data:" + (mime || "application/octet-stream") + ";base64,").length;
  return header + Math.ceil(Math.max(0, byteLength) / 3) * 4 > MEDIA_INLINE_MAX;
}

function bytesToDataUrl(bytes, mime) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    const slice = u8.subarray(i, Math.min(i + CHUNK, u8.length));
    const arr = new Array(slice.length);
    for (let j = 0; j < slice.length; j++) arr[j] = slice[j];
    bin += String.fromCharCode.apply(null, arr);
  }
  if (typeof btoa !== "function") throw new Error("couldn't inline provider media: no base64 encoder");
  return "data:" + (mime || "application/octet-stream") + ";base64," + btoa(bin);
}

function responseMime(r) {
  const ct = ((r && r.headers && r.headers.get && r.headers.get("content-type")) || "").split(";")[0].trim().toLowerCase();
  if (!ct || ct === "application/octet-stream" || ct === "binary/octet-stream") return "";
  return ct;
}

function isAbort(e) {
  return !!(e && (e.name === "AbortError" || e.code === "aborted"));
}

async function drainBody(r) {
  try {
    if (r && r.body && typeof r.body.cancel === "function") await r.body.cancel();
    else if (r && typeof r.arrayBuffer === "function") await r.arrayBuffer();
  } catch { /* already consumed, or an opaque redirect has no body */ }
}

function tooLargeInline() {
  return new Error("provider media is too large to send inline (~4 MB max) and did not redirect to a fetchable file");
}

/**
 * Read a body without buffering past the inline cap. A missing content-length
 * used to pull the whole stream into memory and only then check the size.
 * Chunked reads stop and cancel once the next chunk would exceed the cap.
 */
async function readCappedBody(r, mime, apiKey, signal) {
  const body = r && r.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        let step;
        try { step = await reader.read(); }
        catch (e) {
          if (isAbort(e) || (signal && signal.aborted)) throw e;
          const detail = scrubSecrets(e && e.message, apiKey);
          throw new Error("couldn't fetch provider media" + (detail ? " (" + detail + ")" : ""));
        }
        if (step.done) break;
        const value = step.value instanceof Uint8Array ? step.value : new Uint8Array(step.value || []);
        if (dataUrlWouldExceed(total + value.byteLength, mime)) {
          try { await reader.cancel(); } catch { /* drop the unread tail */ }
          throw tooLargeInline();
        }
        chunks.push(value);
        total += value.byteLength;
      }
    } finally {
      try { reader.releaseLock(); } catch { /* already released by cancel */ }
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    return out;
  }
  let bytes;
  try { bytes = new Uint8Array(await r.arrayBuffer()); }
  catch (e) {
    if (isAbort(e) || (signal && signal.aborted)) throw e;
    const detail = scrubSecrets(e && e.message, apiKey);
    throw new Error("couldn't fetch provider media" + (detail ? " (" + detail + ")" : ""));
  }
  if (dataUrlWouldExceed(bytes.length, mime)) throw tooLargeInline();
  return bytes;
}

/** Fresh headers for this hop only. Never a copy of the previous request's headers. */
function headersForHop(url, apiKey, baseUrl) {
  if (!apiKey || !isAllowedContentUrl(url, baseUrl)) return {};
  return { Authorization: "Bearer " + apiKey, "x-api-key": apiKey };
}

function hiddenRedirect(r) {
  if (!r) return true;
  if (r.type === "opaqueredirect") return true;
  const loc = r.headers && r.headers.get && r.headers.get("location");
  const status = r.status;
  return (status === 0 || status == null) && !loc;
}

/**
 * Walk one content URL. Returns `{ url }` (absolute file URL, not downloaded)
 * or `{ dataUrl }` when the API itself returned a small body.
 * Throws an Error whose message has already been scrubbed.
 */
export async function resolveProviderContent(url, { fetch: fetchImpl, apiKey, baseUrl, signal } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (!doFetch) throw new Error("couldn't fetch provider media: no fetch available");
  const { base } = apiOrigin(baseUrl);
  let current;
  try { current = new URL(String(url), base + "/").href; }
  catch { throw new Error("couldn't fetch provider media"); }
  if (!isAllowedContentUrl(current, baseUrl)) {
    throw new Error("couldn't fetch provider media");
  }
  for (let hop = 0; hop < 5; hop++) {
    // New object every hop. Do not reuse or spread a previous hop's headers.
    const headers = headersForHop(current, apiKey, baseUrl);
    let r;
    try {
      r = await doFetch(current, { method: "GET", headers, redirect: "manual", signal });
    } catch (e) {
      if (isAbort(e) || (signal && signal.aborted)) throw e;
      const detail = scrubSecrets(e && e.message, apiKey);
      throw new Error("couldn't fetch provider media" + (detail ? " (" + detail + ")" : ""));
    }
    if (hiddenRedirect(r)) {
      await drainBody(r);
      throw new Error("provider media redirected, but the redirect target was not exposed");
    }
    const status = r.status;
    const loc = r.headers && r.headers.get && r.headers.get("location");
    if (loc && (status === 0 || (status >= 300 && status < 400))) {
      await drainBody(r);
      let next;
      try { next = new URL(loc, current); }
      catch { throw new Error("provider media redirect had no usable location"); }
      // File host, or any non-content path: hand back the URL. Do not fetch it,
      // and do not attach the key that belonged to this hop.
      if (!isAllowedContentUrl(next.href, baseUrl)) return { url: next.href };
      current = next.href;
      continue;
    }
    if (status >= 300 && status < 400) {
      await drainBody(r);
      throw new Error("provider media redirect had no location");
    }
    if (!r.ok) {
      let raw = "";
      try { raw = String(await r.text()).slice(0, 500); }
      catch (e) {
        if (isAbort(e) || (signal && signal.aborted)) throw e;
        raw = (e && e.message) || "";
      }
      const snippet = scrubSecrets(raw, apiKey);
      throw new Error("couldn't fetch provider media (HTTP " + status + ")" + (snippet ? ": " + snippet : ""));
    }
    const mimeHeader = responseMime(r);
    const declared = Number(r.headers && r.headers.get && r.headers.get("content-length"));
    if (Number.isFinite(declared) && declared >= 0 && dataUrlWouldExceed(declared, mimeHeader)) {
      await drainBody(r);
      throw tooLargeInline();
    }
    const mime = mimeHeader || "application/octet-stream";
    const bytes = await readCappedBody(r, mime, apiKey, signal);
    return { dataUrl: bytesToDataUrl(bytes, mime) };
  }
  throw new Error("provider media redirect did not resolve to a fetchable file");
}

function corsHeaders(request, extra) {
  const headers = Object.assign({ "cache-control": "no-store" }, extra || {});
  const origin = request && request.headers && request.headers.get && request.headers.get("origin");
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
    headers["access-control-allow-headers"] = "authorization, content-type";
    headers["access-control-allow-methods"] = "POST, OPTIONS";
  }
  return headers;
}

function jsonResponse(obj, status, request) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: corsHeaders(request, { "content-type": "application/json; charset=utf-8" }),
  });
}

// 204 and 205 cannot carry a body. JSON.stringify here makes Response throw.
function emptyResponse(status, request) {
  return new Response(null, { status, headers: corsHeaders(request) });
}

/**
 * POST /api/resolve-content
 * Body: `{ url }` — an absolute NanoGPT content URL.
 * Header: `Authorization: Bearer <key>`. The key is not read from the query
 * or from `x-api-key` (that custom header is not forwarded to this hop).
 */
export async function handleContentResolveRequest(request, fetchImpl) {
  if (!request || request.method === "OPTIONS") return emptyResponse(204, request);
  if (request.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405, request);
  const auth = (request.headers && request.headers.get && request.headers.get("authorization")) || "";
  const m = /^Bearer\s+(\S+)/i.exec(auth);
  const apiKey = m ? m[1] : "";
  if (!apiKey || apiKey.length < 4) return jsonResponse({ error: "sign in to resolve provider media" }, 401, request);
  let raw = "";
  try { raw = await request.text(); }
  catch (e) {
    const detail = scrubSecrets(e && e.message, apiKey);
    return jsonResponse({ error: "couldn't fetch provider media" + (detail ? " (" + detail + ")" : "") }, 400, request);
  }
  if (raw.length > 8192) return jsonResponse({ error: "couldn't fetch provider media" }, 400, request);
  let body = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  const url = body && typeof body.url === "string" ? body.url : "";
  if (!isAllowedContentUrl(url)) return jsonResponse({ error: "couldn't fetch provider media" }, 400, request);
  try {
    const out = await resolveProviderContent(url, { fetch: fetchImpl, apiKey, signal: request.signal });
    return jsonResponse(out, 200, request);
  } catch (e) {
    if (isAbort(e)) return jsonResponse({ error: "couldn't fetch provider media" }, 499, request);
    const detail = scrubSecrets(e && e.message, apiKey);
    return jsonResponse({ error: detail || "couldn't fetch provider media" }, 502, request);
  }
}
