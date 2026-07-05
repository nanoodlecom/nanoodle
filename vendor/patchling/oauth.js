/**
 * "Sign in with NanoGPT" — OAuth 2.0 Authorization Code flow with PKCE (S256).
 *
 * Reference: https://nano-gpt.com/blog/sign-in-with-nanogpt-oauth-pkce
 *
 * Endpoints:
 *   register : POST https://nano-gpt.com/oauth/register
 *   authorize: GET  https://nano-gpt.com/oauth/authorize
 *   token    : POST https://nano-gpt.com/oauth/token
 *
 * The low-level functions are environment-agnostic. The high-level
 * `beginSignIn` / `completeSignIn` helpers drive the browser redirect flow and
 * stash the returned access token as the GPTDIFF_LLM_API_KEY override so the
 * rest of gptdiff-js can use it transparently.
 */

import { setEnv } from './env.js';

export const NANOGPT_ORIGIN = 'https://nano-gpt.com';
export const REGISTER_URL = `${NANOGPT_ORIGIN}/oauth/register`;
export const AUTHORIZE_URL = `${NANOGPT_ORIGIN}/oauth/authorize`;
export const TOKEN_URL = `${NANOGPT_ORIGIN}/oauth/token`;
export const DEFAULT_SCOPE = 'api.use models.read';

const STORAGE_KEY = 'gptdiff_oauth_pkce';

function getCrypto() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (!c || !c.subtle) {
    throw new Error('Web Crypto (crypto.subtle) is required for PKCE but is unavailable.');
  }
  return c;
}

/**
 * Base64url-encode an ArrayBuffer or Uint8Array (no padding).
 * @param {ArrayBuffer | Uint8Array} buffer
 * @returns {string}
 */
export function base64UrlEncode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa !== 'undefined'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate a high-entropy PKCE code verifier (base64url, 43+ chars). */
export function generateCodeVerifier(byteLength = 64) {
  const random = new Uint8Array(byteLength);
  getCrypto().getRandomValues(random);
  return base64UrlEncode(random);
}

/**
 * Compute the S256 code challenge for a verifier.
 * @param {string} verifier
 * @returns {Promise<string>}
 */
export async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await getCrypto().subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

/** Generate a random CSRF `state` value. */
export function generateState(byteLength = 16) {
  const random = new Uint8Array(byteLength);
  getCrypto().getRandomValues(random);
  return base64UrlEncode(random);
}

/** Generate a complete PKCE pair: `{ verifier, challenge }`. */
export async function generatePkce() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  return { verifier, challenge };
}

/**
 * Dynamically register a public client with NanoGPT.
 * @param {object} [opts]
 * @param {string} [opts.clientName]
 * @param {string} [opts.redirectUri]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{ client_id: string, [k: string]: any }>}
 */
export async function registerClient({ clientName, redirectUri, fetchImpl } = {}) {
  const doFetch = fetchImpl || fetch;
  const resp = await doFetch(REGISTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Client registration failed (${resp.status}): ${body}`);
  }
  return resp.json();
}

/**
 * Build the authorization URL the user's browser should be sent to.
 * @param {object} opts
 * @param {string} opts.clientId
 * @param {string} opts.redirectUri
 * @param {string} [opts.scope]
 * @param {string} opts.state
 * @param {string} opts.codeChallenge
 * @returns {string}
 */
export function buildAuthorizeUrl({
  clientId,
  redirectUri,
  scope = DEFAULT_SCOPE,
  state,
  codeChallenge,
}) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for an access token.
 * @param {object} opts
 * @param {string} opts.clientId
 * @param {string} opts.redirectUri
 * @param {string} opts.code
 * @param {string} opts.codeVerifier
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{ access_token: string, token_type: string, scope: string }>}
 */
export async function exchangeCodeForToken({
  clientId,
  redirectUri,
  code,
  codeVerifier,
  fetchImpl,
}) {
  const doFetch = fetchImpl || fetch;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: codeVerifier,
  });
  const resp = await doFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

/* -------------------------------------------------------------------------- */
/* High-level browser redirect flow                                            */
/* -------------------------------------------------------------------------- */

function requireBrowser() {
  if (typeof window === 'undefined' || !window.location || !window.sessionStorage) {
    throw new Error('beginSignIn/completeSignIn require a browser environment.');
  }
}

/**
 * Start the sign-in redirect. Stores the PKCE verifier, state, client_id and
 * redirect_uri in sessionStorage and navigates the browser to NanoGPT.
 *
 * @param {object} opts
 * @param {string} [opts.clientId]  a pre-registered NanoGPT client_id (ngpt_...)
 * @param {string} [opts.redirectUri] defaults to the current page URL
 * @param {string} [opts.scope]
 * @param {boolean} [opts.redirect=true] navigate automatically
 * @returns {Promise<string>} the authorization URL
 */
export async function beginSignIn({
  clientId,
  redirectUri,
  scope = DEFAULT_SCOPE,
  redirect = true,
} = {}) {
  requireBrowser();
  if (!clientId) throw new Error('beginSignIn requires a clientId.');
  const finalRedirect = redirectUri || window.location.origin + window.location.pathname;
  const { verifier, challenge } = await generatePkce();
  const state = generateState();
  window.sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ verifier, state, clientId, redirectUri: finalRedirect }),
  );
  const authUrl = buildAuthorizeUrl({
    clientId,
    redirectUri: finalRedirect,
    scope,
    state,
    codeChallenge: challenge,
  });
  if (redirect) window.location.assign(authUrl);
  return authUrl;
}

/**
 * Complete the sign-in after NanoGPT redirects back with `?code=...&state=...`.
 * Validates state, exchanges the code, registers the access token as the
 * GPTDIFF_LLM_API_KEY override, and clears the URL query string.
 *
 * @param {object} [opts]
 * @param {string} [opts.search] query string to parse (defaults to window.location.search)
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<string | null>} the access token, or null if no code present
 */
export async function completeSignIn({ search, fetchImpl } = {}) {
  requireBrowser();
  const params = new URLSearchParams(search ?? window.location.search);
  const code = params.get('code');
  if (!code) return null;

  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error('No stored PKCE state; cannot complete sign-in.');
  const stored = JSON.parse(raw);

  const returnedState = params.get('state');
  if (returnedState !== stored.state) {
    throw new Error('OAuth state mismatch — possible CSRF, aborting.');
  }

  const tokenResponse = await exchangeCodeForToken({
    clientId: stored.clientId,
    redirectUri: stored.redirectUri,
    code,
    codeVerifier: stored.verifier,
    fetchImpl,
  });

  window.sessionStorage.removeItem(STORAGE_KEY);
  setEnv('GPTDIFF_LLM_API_KEY', tokenResponse.access_token);

  // Clean the code/state out of the URL.
  const cleanUrl = window.location.origin + window.location.pathname;
  if (window.history && window.history.replaceState) {
    window.history.replaceState({}, document.title, cleanUrl);
  }

  return tokenResponse.access_token;
}
