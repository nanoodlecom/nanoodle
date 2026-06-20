/**
 * LLM completion client for gptdiff-js.
 *
 * Speaks the OpenAI-compatible chat-completions protocol (used by NanoGPT)
 * over `fetch`, so it runs unchanged in the browser and in Node 18+. An
 * Anthropic branch is included for parity with the Python implementation.
 */

import { getEnv, DEFAULT_BASE_URL } from './env.js';

/**
 * Normalize a base URL so it has no trailing slash, then append `path`.
 */
function joinUrl(baseUrl, path) {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}${path}`;
}

function domainForUrl(baseUrl) {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

/**
 * Convert an OpenAI-style message (possibly with image_url blocks) to the
 * Anthropic content-block shape.
 */
function convertOpenAiMessageToAnthropic(message) {
  if (!Array.isArray(message.content)) return message;
  const converted = [];
  for (const block of message.content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text') {
      converted.push({ type: 'text', text: block.text || '' });
    } else if (block.type === 'image_url') {
      const url = block.image_url?.url || '';
      if (url.startsWith('data:') && url.includes(';base64,')) {
        const [header, data] = url.split(',', 2);
        const mediaType = header.split(':', 2)[1].split(';', 1)[0];
        converted.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data },
        });
      }
    } else {
      converted.push(block);
    }
  }
  return { ...message, content: converted };
}

/**
 * Call a chat-completions endpoint.
 *
 * @param {object} opts
 * @param {string} [opts.apiKey]
 * @param {string} [opts.baseUrl]
 * @param {string} opts.model
 * @param {Array<object>} opts.messages
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @param {number} [opts.budgetTokens] Anthropic extended-thinking budget
 * @param {typeof fetch} [opts.fetchImpl] override for testing
 * @param {number} [opts.maxRetries] retries on transient 429/5xx (default 3)
 * @param {number} [opts.retryBaseMs] base backoff in ms (default 1500, exponential, capped 30s)
 * @returns {Promise<{choices: Array<{message: {content: string}}>, usage: object}>}
 */
export async function callLlm({
  apiKey,
  baseUrl,
  model,
  messages,
  maxTokens = null,
  temperature = 1.0,
  budgetTokens = null,
  fetchImpl,
  maxRetries = 3,
  retryBaseMs = 1500,
}) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) {
    throw new Error('No fetch implementation available. Pass opts.fetchImpl in this environment.');
  }
  const url = baseUrl || DEFAULT_BASE_URL;

  if (url.includes('api.anthropic.com')) {
    const anthropicUrl = 'https://api.anthropic.com/v1/messages';
    let systemMessage = null;
    const filtered = [];
    for (const m of messages) {
      if (m.role === 'system') systemMessage = m.content;
      else filtered.push(convertOpenAiMessageToAnthropic(m));
    }
    // Anthropic's API requires max_tokens, so fall back to a generous default
    // only on this path; callers can still pass an explicit cap.
    const data = { model, messages: filtered, max_tokens: maxTokens ?? 32000, temperature };
    if (systemMessage) data.system = systemMessage;
    if (budgetTokens) {
      data.temperature = 1;
      data.thinking = { budget_tokens: budgetTokens, type: 'enabled' };
    }
    const resp = await doFetch(anthropicUrl, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(data),
    });
    const responseData = await resp.json();
    if (responseData.error) {
      throw new Error(`Error from Anthropic API: ${JSON.stringify(responseData)}`);
    }
    const thinkingItems = responseData.content.filter((c) => c.type === 'thinking').map((c) => c.thinking);
    const textItems = responseData.content.filter((c) => c.type === 'text').map((c) => c.text);
    if (!textItems.length) throw new Error("No 'text' type found in response content");
    let messageContent = textItems[0];
    if (thinkingItems.length) {
      messageContent = `<think>${thinkingItems[0]}</think>\n${messageContent}`;
    }
    const inputTokens = responseData.usage.input_tokens;
    const outputTokens = responseData.usage.output_tokens;
    return {
      choices: [{ message: { content: messageContent } }],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    };
  }

  // OpenAI-compatible (NanoGPT) path, with backoff on transient errors.
  const endpoint = joinUrl(url, '/chat/completions');
  // Only send max_tokens when explicitly capped; otherwise let the model emit its full output.
  const requestBody = JSON.stringify({ model, messages, temperature, ...(maxTokens ? { max_tokens: maxTokens } : {}) });
  let resp;
  for (let attempt = 0; ; attempt++) {
    resp = await doFetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: requestBody,
    });
    // Retry transient overload / rate-limit / server errors with backoff.
    const transient = resp.status === 429 || resp.status >= 500;
    if (resp.ok || !transient || attempt >= maxRetries) break;
    const retryAfter = parseFloat(resp.headers.get?.('retry-after'));
    const waitMs = Number.isFinite(retryAfter)
      ? Math.min(retryAfter * 1000, 30000)
      : Math.min(retryBaseMs * 2 ** attempt, 30000);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`LLM request failed (${resp.status}) from ${domainForUrl(url)}: ${body}`);
  }
  const json = await resp.json();
  if (json.error) {
    throw new Error(`LLM API error from ${domainForUrl(url)}: ${JSON.stringify(json.error)}`);
  }
  return json;
}

/**
 * Resolve the effective API key, preferring an explicit override then the
 * GPTDIFF_LLM_API_KEY environment variable.
 */
export function resolveApiKey(apiKey) {
  return apiKey || getEnv('GPTDIFF_LLM_API_KEY');
}

/**
 * Resolve the effective base URL, preferring an explicit override then the
 * GPTDIFF_LLM_BASE_URL environment variable, then the NanoGPT default.
 */
export function resolveBaseUrl(baseUrl) {
  return baseUrl || getEnv('GPTDIFF_LLM_BASE_URL', DEFAULT_BASE_URL) || DEFAULT_BASE_URL;
}

export { domainForUrl };
