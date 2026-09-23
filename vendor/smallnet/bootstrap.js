/** Load catalog.json and register every manifest (weights still absent until load()). */
import { SmallnetRegistry } from "./registry.js";

/**
 * @param {{ catalogUrl?: string, fetch?: typeof fetch }} [opts]
 * @returns {Promise<SmallnetRegistry>}
 */
export async function bootstrapSmallnet(opts = {}) {
  const url = opts.catalogUrl || new URL("./catalog.json", import.meta.url).href;
  const fetchFn = opts.fetch || globalThis.fetch;
  const reg = new SmallnetRegistry();
  if (!fetchFn) return reg;
  const res = await fetchFn(url);
  if (!res.ok) return reg;
  const catalog = await res.json();
  for (const m of catalog.models || []) reg.register(m);
  return reg;
}
