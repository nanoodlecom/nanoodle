/**
 * Environment access that works in both Node and the browser.
 *
 * In Node, reads from `process.env`. In the browser there is no `process`, so
 * callers can register overrides (e.g. values obtained via OAuth sign-in)
 * through `setEnv`, which are consulted first.
 */

const overrides = Object.create(null);

/**
 * Set an environment-style override (used in the browser where there is no
 * `process.env`). Pass `undefined` to clear an override.
 * @param {string} name
 * @param {string | undefined} value
 */
export function setEnv(name, value) {
  if (value === undefined) {
    delete overrides[name];
  } else {
    overrides[name] = value;
  }
}

/**
 * Read an environment variable. Overrides take precedence over `process.env`.
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string | undefined}
 */
export function getEnv(name, fallback = undefined) {
  if (name in overrides) return overrides[name];
  if (typeof process !== 'undefined' && process.env && name in process.env) {
    return process.env[name];
  }
  return fallback;
}

export const DEFAULT_MODEL = 'xiaomi/mimo-v2.5-pro-ultraspeed';
export const DEFAULT_BASE_URL = 'https://nano-gpt.com/api/v1/';
