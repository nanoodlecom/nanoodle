// Only /api/resolve-content is routed here (wrangler assets.run_worker_first).
// Every other request is served as a static asset and does not enter this script.
import { handleContentResolveRequest } from "./content-resolve.mjs";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/resolve-content") {
      return new Response("not found", { status: 404 });
    }
    return handleContentResolveRequest(request);
  },
};
